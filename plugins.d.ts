import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";

export interface PluginMetadata {
  schema_version: string;
  name_for_human: string;
  name_for_model: string;
  description_for_human: string;
  description_for_model: string;
  logo_url: string;
}

export interface TagMetadata {
  schema_version: string;
  name_for_human: string;
  name_for_model: string;
  description_for_human: string;
  description_for_model: string;
}

type ChatHistoryEvents = {
  messageAdded: [message: ChatMessage, messageIndex: number];
  messageAppended: [message: ChatMessage, messageIndex: number, appended: string];
};

export interface ChatHistory {
  readonly events: EventEmitter<ChatHistoryEvents>;
  readonly processingQueue: ChatMessage[];
  addMessage(message: ChatMessage, options?: { noPostProcess?: boolean }): Promise<number>;
  appendToMessage(messageIndex: number, append: string): Promise<void>;
  getMessages(): ChatMessage[];
  messageExists(messageIndex: number): boolean;
}

export interface ChatMessage {
  content: string;
  name?: string;
  role: "assistant" | "error" | "user" | "system";
}

/// Transparently checks permissions before invoking the action
export interface FileSystem {
  mkdir: typeof Deno.mkdir;
  readDir: typeof Deno.readDir;
  readTextFile: typeof Deno.readTextFile;
  remove: typeof Deno.remove;
  rename: typeof Deno.rename;
  symlink: typeof Deno.symlink;
  writeTextFile: typeof Deno.writeTextFile;
}

export interface PermissionsManager {
  assertPermission(resourceType: "filesystem", path: string | URL, access?: "read" | "write"): void | never;
  isPermitted(resourceType: "filesystem", path: string | URL, access?: "read" | "write"): boolean;
}

export interface PluginInstance {
  metadata: PluginMetadata;
  runtimes?: Record<string, RuntimeImplementation>;
  tags?: Record<string, TagImplementation>;
}

export interface PluginSet {
  readonly plugins: PluginInstance[];
  readonly runtimes: Map<string, RuntimeImplementation>;
  readonly tags: Map<string, TagImplementation>;
}

export type WellKnownSecretID = "api.openai.com";

export interface SecretsStore {
  exists(secretName: WellKnownSecretID | string): Promise<boolean>;
  read(secretName: WellKnownSecretID | string): Promise<string>;
  store(secretName: WellKnownSecretID | string, secretData: string): Promise<void>;
}

export interface PluginContext {
  chatConfig: Map<"engine" | string, string>;
  chatHistory: ChatHistory;
  enabledPlugins: PluginSet;
  filesystem: FileSystem;
  permissions: PermissionsManager;
  secrets: SecretsStore;
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
  chatCreated?(context: PluginContext): Promise<void>;
  userMessageReceived?(message: ChatMessage, context: PluginContext): Promise<ReadableStream<Error> | void> | ReadableStream<Error>;
}

/**
 * A tag implementation can customize the handling of code blocks whose
 * tag references the tag implementation's name.
 *
 * For example, the `write_file` tag implementation writes the code block
 * contents to a file.
 *
 * ```python;write_file("./example.py")
 * print("Hello world!")
 * ```
 */
export interface TagImplementation {
  metadata: TagMetadata;
  invoke(codeBlockContent: string, codeBlockTag: ParsedCodeBlockTag, message: ChatMessage, context: PluginContext): Promise<void>;
}
