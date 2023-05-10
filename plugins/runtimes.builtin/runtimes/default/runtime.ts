import { AgentExecutor, initializeAgentExecutorWithOptions } from "https://esm.sh/v118/langchain@0.0.67/agents";
import { ChatOpenAI } from "https://esm.sh/v118/langchain@0.0.67/chat_models/openai";
import { CallbackManager } from "https://esm.sh/v118/langchain@0.0.67/dist/callbacks/manager.js";
import { AIChatMessage, AgentAction, AgentFinish, BaseChatMessage } from "https://esm.sh/langchain/schema";
import { PluginContext, RuntimeImplementation } from "../../../../plugins.d.ts";
import { ActionContainer, createActionContainer, getExistingActionContainer } from "../../../../lib/docker_manager.ts";
import { ShellTool } from "../../../../tools/shell.ts";
import { ChatEvent } from "../../../../chat_events.d.ts";

class ChatGPTRuntime implements RuntimeImplementation {
  private model = new ChatOpenAI({
    streaming: true,
    temperature: 0,
  });

  private container: ActionContainer | undefined;
  private executor: AgentExecutor | undefined;

  async handleUserMessage(userMessage: BaseChatMessage, context: PluginContext) {
    const { chatHistory } = context;
    await chatHistory.addMessage(userMessage);

    const responseMessage = new AIChatMessage("");
    const responseMessageIndex = await chatHistory.addMessage(responseMessage);

    const outputTransformer = new TransformStream();
    const outputTransformerWriter = outputTransformer.writable.getWriter();

    const messageTokenReader = processJsonStream(outputTransformer.readable).pipeThrough(JsonStringEscapeSeqDecoder()).getReader();
    await outputTransformerWriter.ready;

    // FIXME: Turn into a stream and merge with messageChatEventStream
    (async() => {
      let read: ReadableStreamDefaultReadResult<string>;
      while ((read = await messageTokenReader.read()).done === false) {
        const token = read.value;
        await chatHistory.appendToMessage(responseMessageIndex, token);
      }
    })().catch((err) => console.error(err));

    const messageChatEventStream =
      new ReadableStream<ChatEvent>({
        start: async () => {
          const executor = await this.getExecutor();
          await executor.call({ input: userMessage.text }, CallbackManager.fromHandlers({
            async handleAgentAction(action: AgentAction) {
              await chatHistory.addAction(responseMessageIndex, action);
            },
            async handleAgentEnd(result: AgentFinish) {
              const prevActions = chatHistory.getMessages()[responseMessageIndex].actions;
              const lastActionIndex = prevActions.length - 1;
              await chatHistory.setActionResults(responseMessageIndex, lastActionIndex, result.returnValues);

              if (typeof result.returnValues.output === "string") {
                await chatHistory.finalizeMessage(responseMessageIndex, result.returnValues.output, result.returnValues);
                outputTransformerWriter.close();
              }
            },
            handleLLMNewToken(token) {
              outputTransformerWriter.write(token);
            },
          }));
        },
      });

    return messageChatEventStream;
  }

  private async getContainer(): Promise<ActionContainer> {
    if (!this.container) {
      this.container = await getExistingActionContainer() ?? await createActionContainer("rungpt_actions:latest", Deno.cwd());
    }
    return this.container;
  }

  private async getExecutor(): Promise<AgentExecutor> {
    if (!this.executor) {
      const container = await this.getContainer();
      const tools = [
        new ShellTool(container)
      ];
      this.executor = await initializeAgentExecutorWithOptions(
        tools,
        this.model,
        {
          agentType: "chat-conversational-react-description",
        }
      );
    }
    return this.executor;
  }
}

export default () => new ChatGPTRuntime();

const lastCharOf = (str: string) => str[str.length - 1];

async function* processStream(input: ReadableStream<string>): AsyncGenerator<string> {
  let actionSeen = false;
  let partialJson = "";
  let inString = false;
  let streaming = false;
  const reader = input.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      let output = "";
      for (const char of value) {
        // Poor man's JSON streaming parser
        if (!inString && char === ',' && partialJson.match(/"action":\s*"Final Answer"$/)) {
          actionSeen = true;
        } else if (!inString && char === '"') {
          const prevChar = lastCharOf(partialJson.trimEnd());
          if (prevChar === ':') {
            inString = true;
            streaming = actionSeen && partialJson.match(/"action_input":\s*$/) ? true : false;
            actionSeen = false;
            partialJson += char;
            continue;
          }
        } else if (inString && char === '"') {
          const trailingBackslashes = partialJson.match(/\\+$/)?.[0].length ?? 0;
          if (trailingBackslashes % 2 === 0) {
            inString = false;
            streaming = false;
          }
        }

        partialJson += char;

        if (streaming) {
          output += char;
        }
      }

      if (output) {
        yield output;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function processJsonStream(input: ReadableStream<string>): ReadableStream<string> {
  const readableStream = new ReadableStream({
    async start(controller) {
      for await (const value of processStream(input)) {
        controller.enqueue(value);
      }
      controller.close();
    }
  });

  return readableStream;
}

function JsonStringEscapeSeqDecoder(): TransformStream<string, string> {
  let buffered = "";

  return new TransformStream({
    transform(chunk, controller) {
      let output = "";
      for (const char of chunk) {
        if (!buffered && char !== "\\") {
          output += char;
        } else {
          buffered += char;
          if (buffered.length > 1) {
            switch (buffered[1]) {
              case "n": {
                output += "\n";
                buffered = "";
                break;
              }
              case "r": {
                output += "\r";
                buffered = "";
                break;
              }
              default: {
                output += buffered[1];
                buffered = "";
                break;
              }
            }
          }
        }
      }
      controller.enqueue(output);
    },
  });
}
