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

    const messageChatEventStream =
      new ReadableStream<ChatEvent>({
        start: async () => {
          const executor = await this.getExecutor();
          await executor.call({ input: userMessage.text }, CallbackManager.fromHandlers({
            async handleAgentAction(action: AgentAction) {
              await chatHistory.addAction(responseMessageIndex, action);
            },
            async handleAgentEnd(result: AgentFinish) {
              const prevActions = chatHistory.getMessageActions(responseMessageIndex);
              const lastActionIndex = prevActions.length - 1;
              await chatHistory.setActionResults(responseMessageIndex, lastActionIndex, result.returnValues);

              if (typeof result.returnValues.output === "string") {
                await chatHistory.finalizeMessage(responseMessageIndex, result.returnValues.output, result.returnValues);
              }
            },
            handleLLMNewToken() {
              // TODO: Live-stream tokens, but only the relevant string
              // in the JSON response
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
