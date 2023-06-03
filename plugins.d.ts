import { BaseChain } from "https://esm.sh/v118/langchain@0.0.75/chains";
import { BufferMemoryInput } from "https://esm.sh/v118/langchain@0.0.75/memory.js";
import { AgentAction, BaseChatMessage } from "https://esm.sh/langchain/schema";
import { BaseLanguageModel } from "https://esm.sh/v118/langchain@0.0.75/base_language";
import { Tool } from "https://esm.sh/v118/langchain@0.0.75/tools";
import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { ChatEvent } from "./chat_events.d.ts";
import { ChatMessage } from "./chat.d.ts";
import { RecursivePlanExecuteAgentExecutor } from "./lib/recursive_plan_execute/index.ts";

export interface PluginMetadata {
  schema_version: string;
  name_for_human: string;
  name_for_model: string;
  description_for_human: string;
  description_for_model: string;
  logo_url: string;
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

export type ChatMessageRole = "briefing" | "error";

export interface PluginInstance {
  readonly metadata: PluginMetadata;
  readonly models: PluginProvision<BaseLanguageModel>;
  readonly runtimes: PluginProvision<RuntimeImplementation>;
  readonly tools: PluginProvision<Tool>;
}

export interface PluginSet {
  readonly plugins: PluginInstance[];
  readonly models: PluginProvision<BaseLanguageModel>;
  readonly runtimes: PluginProvision<RuntimeImplementation>;
  readonly tools: PluginProvision<Tool>;
}

export type WellKnownSecretID = "api.openai.com";

export interface SecretsStore {
  exists(secretName: WellKnownSecretID | string): Promise<boolean>;
  read(secretName: WellKnownSecretID | string): Promise<string>;
  store(secretName: WellKnownSecretID | string, secretData: string): Promise<void>;
}

export interface PluginProvision<T> {
  load(name: string): Promise<T>;
  loadAll(): Promise<T[]>;
  list(): string[];
}

export interface PluginContext {
  enabledPlugins: PluginSet;
  secrets: SecretsStore;
}

export interface SessionContext extends PluginContext {
  chatConfig: Map<"engine" | string, string>;
  chatHistory: ChatHistory;
  executor: BaseChain | RecursivePlanExecuteAgentExecutor;
  memory: BufferMemoryInput;
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

/**
 * A runtime implementation can provide custom functionality for the
 * whole chat, not just single code blocks in messages.
 *
 * Runtime implementations can for example provide a question-answer
 * kind of dialog where messages are handled by the runtime and not
 * immediately sent to the AI.
 */
export interface RuntimeImplementation {
  handleChatCreation(context: PluginContext): Promise<SessionContext>;
  handleUserMessage(message: BaseChatMessage, session: SessionContext): Promise<ReadableStream<ChatEvent>> | ReadableStream<ChatEvent>;
}
