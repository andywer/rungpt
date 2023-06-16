import { AgentAction, BaseChatMessage } from "https://esm.sh/langchain@0.0.95/schema";
import { MessageType } from "https://esm.sh/v118/langchain@0.0.95/schema.js";
import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { ChatEvent } from "./chat_events.d.ts";

export {
  MessageType,
};

// Consistent with the OpenAI API
export enum ChatRole {
  Assistant = "assistant",
  System = "system",
  User = "user",
}

export type ISODateTimeString = string;

/**
 * Single message in a chat, sent by the user, the AI or the framework.
 * Custom data type for our API instead of langchain's `BaseChatMessage`
 * as we need something JSON-serializable.
 */
export interface ChatMessage {
  createdAt: ISODateTimeString;
  actions: {
    tool: string;
    input: string;
    results?: Record<string, unknown>;
  }[];
  message: {
    role?: ChatRole;
    text: string;
    type: MessageType;
  };
}

/** AI interacting with the outside world, like fetching data from the internet */
export interface ChatAction {
  type: "action";
  action: {
    tool: string;
    input: string;
    results: Record<string, unknown>;
  };
}

type ChatHistoryEvents = {
  chat: [event: ChatEvent];
};

export interface ChatHistory {
  readonly events: EventEmitter<ChatHistoryEvents>;
  addAction(messageIndex: number, action: AgentAction): Promise<number>;
  addError(error: Error): Promise<number>;
  addMessage(message: BaseChatMessage): Promise<number>;
  appendToMessage(messageIndex: number, append: string): Promise<void>;
  finalizeMessage(messageIndex: number): Promise<void>;
  finalizeMessage(messageIndex: number, text: string, actionResult?: Record<string, unknown>): Promise<void>;
  getMessages(): { actions: ChatMessage["actions"], createdAt: Date, message: BaseChatMessage }[];
  messageExists(messageIndex: number): boolean;
  setActionResults(messageIndex: number, actionIndex: number, results: Record<string, unknown>): Promise<void>;
  streamMessage(message: Omit<BaseChatMessage, "text">, text: ReadableStream<string>): Promise<number>;
}
