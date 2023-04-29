import { mergeReadableStreams, readableStreamFromIterable } from "https://deno.land/std@0.184.0/streams/mod.ts";
import { ChatMessage, PluginContext, RuntimeImplementation } from "../../../../plugins.d.ts";
import { ActionContainer, createActionContainer, getExistingActionContainer } from "../../../../lib/docker_manager.ts";
import { ChatGPTSSEDecoder, DeltaMessageTransformer, MarkdownCodeBlockDecoder, OnStreamEnd, ParsedTaggedCodeBlock, TagInvocationBlockDecoder, streamExecutedCommand } from "../../../../lib/stream_transformers.ts";
import { ChatGPT } from "./lib/chat_gpt_api.ts";

class ChatGPTRuntime implements RuntimeImplementation {
  private chatGPT: ChatGPT | undefined;
  private container: ActionContainer | undefined;

  async userMessageReceived(message: ChatMessage, context: PluginContext) {
    const chatGPT = await this.getChatGPT(context);
    return this.submitChatMessages(chatGPT, context, [message], context.chatConfig.get("engine") ?? "gpt-3.5-turbo");
  }

  async submitChatMessages(chatGPT: ChatGPT, context: PluginContext, _messages: ChatMessage[], engine: string): Promise<ReadableStream<Error>> {
    const { chatHistory } = context;
    const inputActionErrors: Error[] = [];

    const container = await this.getContainer();

    const TagExecutor = () => new TransformStream<ParsedTaggedCodeBlock, Error>({
      transform: async (taggedBlock, controller) => {
        try {
          if (["bash", "sh", "shell"].includes(taggedBlock.tag.language) && taggedBlock.tag.additional.some((add) => add.raw === "rungpt")) {
            await container.actions.invokeShell(taggedBlock.block.content, async (process) => {
              const messageIndex = await chatHistory.addMessage({ content: "", role: "system" }, { noPostProcess: true });

              const reader = streamExecutedCommand(process).getReader();
              const writeMessage = async () => {
                let read: ReadableStreamDefaultReadResult<string>;
                while (!(read = await reader.read()).done) {
                  await chatHistory.appendToMessage(messageIndex, read.value);
                }
              };

              await Promise.all([
                writeMessage(),
                process.status(),
              ]);
            });
          }
        } catch (err) {
          console.error(err);
          controller.enqueue(err);
        }
      },
    });

    const MessagePostprocessor = () => (
      new ReadableStream<ChatMessage>({
        pull(controller) {
          if (chatHistory.processingQueue.length > 0) {
            const msg = chatHistory.processingQueue.shift()!;
            // Quirk: The AI-sent messages are already processed by the GPT SSE decoder
            if (msg.role !== "assistant") {
              controller.enqueue(msg);
            }
          } else {
            controller.close();
          }
        },
      })
      .pipeThrough(new TransformStream({
        transform(message, controller) {
          controller.enqueue(message.content);
        },
      }))
      .pipeThrough(MarkdownCodeBlockDecoder(true))
      .pipeThrough(TagInvocationBlockDecoder())
      .pipeThrough(TagExecutor())
    );

    {
      let read: ReadableStreamDefaultReadResult<Error>;
      const inputTags = MessagePostprocessor();

      const reader = inputTags.getReader();
      while (!(read = await reader.read()).done) {
        const event = read.value;
        inputActionErrors.push(event);
      }
    }

    const gptResponse = await chatGPT.sendMessage(chatHistory.getMessages(), engine);

    if (!gptResponse.body) {
      throw new Error("Failed to get response body from ChatGPT API call");
    }

    const responseMessage: ChatMessage = { content: "", role: "assistant" };
    const responseMessageIndex = await chatHistory.addMessage(responseMessage, { noPostProcess: true });
    const totalMessageCountBefore = chatHistory.getMessages().length;

    const sseDecoder = ChatGPTSSEDecoder(chatHistory.getMessages()[responseMessageIndex]);
    const messageTransformer = DeltaMessageTransformer(chatHistory, responseMessageIndex);

    // const responseActionErrors = sseDecoder.actions.pipeThrough(ActionExecutor());
    const deltaMsgErrors = sseDecoder.messages.pipeThrough(messageTransformer);
    const responseTagErrors = sseDecoder.tags.pipeThrough(TagExecutor());

    gptResponse.body.pipeTo(sseDecoder.ingress);

    const errorStream = mergeReadableStreams(
      readableStreamFromIterable(inputActionErrors),
      // responseActionErrors,
      responseTagErrors,
      deltaMsgErrors,
      MessagePostprocessor(),
    );

    const output = errorStream
      .pipeThrough(OnStreamEnd(() => {
        if (chatHistory.processingQueue.length > 0) {
          // Now that the message has been received completely, we can post-process it
          chatHistory.processingQueue.push(responseMessage);
          return MessagePostprocessor();
        } else {
          return readableStreamFromIterable([]);
        }
      }))
      .pipeThrough(OnStreamEnd(async () => {
        if (chatHistory.getMessages().length > totalMessageCountBefore) {
          // Wait a bit, so that if we end up in a deep recursion, we have throttled it a bit
          await new Promise((resolve) => setTimeout(resolve, 200));
          return this.submitChatMessages(chatGPT, context, chatHistory.getMessages().slice(totalMessageCountBefore), engine);
        } else {
          return readableStreamFromIterable([]);
        }
      }));

    return output;
  }

  private async getChatGPT(context: PluginContext): Promise<ChatGPT> {
    if (!this.chatGPT) {
      this.chatGPT = new ChatGPT(await context.secrets.read("api.openai.com"));
    }
    return this.chatGPT;
  }

  private async getContainer(): Promise<ActionContainer> {
    if (!this.container) {
      this.container = await getExistingActionContainer() ?? await createActionContainer("rungpt_actions:latest", Deno.cwd());
    }
    return this.container;
  }
}

export default new ChatGPTRuntime();
