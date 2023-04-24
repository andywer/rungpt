import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { ChatMessage } from "./chat_gpt_api.ts";
import { ChatEvent, ChatRole, EventType, MessageAppendEvent } from "./rungpt_chat_api.ts";

type ChatHistoryEvents = {
  messageAdded: [message: ChatMessage, messageIndex: number];
  messageAppended: [message: ChatMessage, messageIndex: number, appended: string];
};

export class ChatHistory {
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

  public eventStream(): ReadableStream<MessageAppendEvent> {
    let messageAddedListener: (message: ChatMessage, messageIndex: number) => void;
    let messageAppendedListener: (message: ChatMessage, messageIndex: number, appended: string) => void;

    return new ReadableStream<MessageAppendEvent>({
      start: (controller) => {
        this.events.on("messageAdded", messageAddedListener = (message, index) => {
          controller.enqueue({
            type: EventType.MessageAppend,
            data: {
              index,
              append: message.content,
              role: message.role as ChatRole,
            },
          });
        });
        this.events.on("messageAppended", messageAppendedListener = (message, index, append) => {
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
      cancel: () => {
        this.events.off("messageAdded", messageAddedListener);
        this.events.off("messageAppended", messageAppendedListener);
      },
    });
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
