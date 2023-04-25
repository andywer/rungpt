import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { ChatMessage } from "./chat_gpt_api.ts";
import { ChatEvent, ChatRole, EventType, MessageAppendEvent } from "./rungpt_chat_api.ts";

type ChatHistoryEvents = {
  messageAdded: [message: ChatMessage, messageIndex: number];
  messageAppended: [message: ChatMessage, messageIndex: number, appended: string];
};

export interface ChatHistory {
  readonly events: EventEmitter<ChatHistoryEvents>;
  addMessage(message: ChatMessage): number;
  appendToMessage(messageIndex: number, append: string): void;
  getMessages(): ChatMessage[];
  messageExists(messageIndex: number): boolean;
}

export class InMemoryChatHistory implements ChatHistory {
  public readonly events = new EventEmitter<ChatHistoryEvents>();
  private messages: ChatMessage[] = [];

  public addMessage(message: ChatMessage): number {
    const messageIndex = this.messages.length;
    this.messages.push(message);
    this.events.emit("messageAdded", message, messageIndex);
    return messageIndex;
  }

  public appendToMessage(messageIndex: number, append: string): void {
    const message = this.messages[messageIndex];
    message.content += append;
    this.events.emit("messageAppended", message, messageIndex, append);
  }

  public getMessages(): ChatMessage[] {
    return this.messages;
  }

  public messageExists(messageIndex: number): boolean {
    return messageIndex < this.messages.length;
  }
}

export function applyChatEventToHistory(event: ChatEvent, chatHistory: ChatHistory) {
  if (event.type === EventType.MessageAppend) {
    if (chatHistory.messageExists(event.data.index)) {
      chatHistory.appendToMessage(event.data.index, event.data.append);
    } else {
      const index = chatHistory.addMessage({
        content: event.data.append,
        role: event.data.role,
      });
      if (index !== event.data.index) {
        throw new Error("Unexpected message index mismatch");
      }
    }
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
    addMessage(message: ChatMessage): number {
      if (chatHistory.getMessages().length === 0) {
        for (const initialMessage of initialMessages) {
          chatHistory.addMessage(initialMessage);
        }
      }
      return chatHistory.addMessage(message);
    },
    appendToMessage: chatHistory.appendToMessage.bind(chatHistory),
    events: chatHistory.events,
    getMessages: chatHistory.getMessages.bind(chatHistory),
    messageExists: chatHistory.messageExists.bind(chatHistory),
  };
  return derived;
}
