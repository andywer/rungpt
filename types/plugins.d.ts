import { AgentAction, BaseChatMessage } from "https://esm.sh/langchain/schema";
import { BaseLanguageModel } from "https://esm.sh/v118/langchain@0.0.67/base_language";
import { Tool } from "https://esm.sh/v118/langchain@0.0.67/tools";
import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { ChatEvent } from "./chat_events.d.ts";
import { ChatMessage } from "./chat.d.ts";
import { SecretsStore, SessionController } from "./session.d.ts";

export {
  SessionController,
};

export interface PluginMetadata {
  schema_version: string;
  name: string;
  description: string;
}

export type ChatHistoryEvents = {
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

export type ChatMessageRole = "briefing" | "error";

export interface PluginInstance {
  readonly metadata: PluginMetadata;
  readonly controllers: Map<string, SessionController>;
  readonly models: Map<string, BaseLanguageModel>;
  readonly tools: Map<string, Tool>;
}

export interface PluginContext {
  secrets: SecretsStore;
  utils: {
    createChatHistory(): ChatHistory;
  };
}

export type ParameterType = string | number | boolean;
export type Parameters = { _: ParameterType[] } & Record<string, ParameterType>;

export interface ParsedCodeBlockTag {
  /// can be an empty string (!)
  language: string;

  /// additional code block tags, semicolon-separated after language
  additional: {
    invocation?: {
      name: string;
      parameters: Parameters;
    };
    raw: string;
  }[];
}
