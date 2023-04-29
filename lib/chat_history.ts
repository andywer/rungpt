import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { ChatHistory, ChatHistoryEvents, ChatMessage } from "../plugins.d.ts";
import { ChatRole, EventType, MessageAppendEvent } from "./rungpt_chat_api.ts";

export class InMemoryChatHistory implements ChatHistory {
  public readonly events = new EventEmitter<ChatHistoryEvents>();
  public readonly processingQueue: ChatMessage[] = [];

  private messages: ChatMessage[] = [];

  public addMessage(message: ChatMessage, options: { noPostProcess?: boolean } = {}): Promise<number> {
    const messageIndex = this.messages.length;
    this.messages.push(message);

    if (!options.noPostProcess) {
      this.processingQueue.push(message);
    }

    this.events.emit("messageAdded", message, messageIndex);
    return Promise.resolve(messageIndex);
  }

  public appendToMessage(messageIndex: number, append: string): Promise<void> {
    const message = this.messages[messageIndex];
    message.content += append;
    this.events.emit("messageAppended", message, messageIndex, append);
    return Promise.resolve();
  }

  public getMessages(): ChatMessage[] {
    return this.messages;
  }

  public messageExists(messageIndex: number): boolean {
    return messageIndex < this.messages.length;
  }
}

export function eventStreamFromChatHistory(chatHistory: ChatHistory): ReadableStream<MessageAppendEvent> {
  let messageAddedListener: (message: ChatMessage, messageIndex: number) => void;
  let messageAppendedListener: (message: ChatMessage, messageIndex: number, appended: string) => void;

  return new ReadableStream<MessageAppendEvent>({
    start(controller) {
      chatHistory.events.on("messageAdded", messageAddedListener = (message, index) => {
        controller.enqueue({
          type: EventType.MessageAppend,
          data: {
            index,
            append: message.content,
            role: message.role as ChatRole,
          },
        });
      });
      chatHistory.events.on("messageAppended", messageAppendedListener = (message, index, append) => {
        controller.enqueue({
          type: EventType.MessageAppend,
          data: {
            index,
            append,
            role: message.role as ChatRole,
          },
        });
      });
    },
    cancel() {
      chatHistory.events.off("messageAdded", messageAddedListener);
      chatHistory.events.off("messageAppended", messageAppendedListener);
    },
  });
}

export function AutoInitialMessages(
  chatHistory: ChatHistory,
  initialMessages: ChatMessage[],
): ChatHistory {
  const derived: ChatHistory = {
    async addMessage(message: ChatMessage): Promise<number> {
      if (chatHistory.getMessages().length === 0) {
        for (const initialMessage of initialMessages) {
          await chatHistory.addMessage(initialMessage, { noPostProcess: true });
        }
      }
      return chatHistory.addMessage(message);
    },
    appendToMessage: chatHistory.appendToMessage.bind(chatHistory),
    events: chatHistory.events,
    getMessages: chatHistory.getMessages.bind(chatHistory),
    messageExists: chatHistory.messageExists.bind(chatHistory),
    processingQueue: chatHistory.processingQueue,
  };
  return derived;
}
