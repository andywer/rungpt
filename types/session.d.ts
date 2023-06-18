import { BaseLanguageModel } from "langchain/base_language";
import { Tool } from "langchain/tools";
import { BaseChatMessage } from "langchain/schema";
import { ChatHistory } from "./chat.d.ts";
import { ChatEvent } from "./chat_events.d.ts";

type Brand<T, Id extends string> = T & { __brand: Id };

export type SessionID = Brand<string, "SessionID">;
export type SessionControllerID = Brand<string, "SessionControllerID">;

/**
 * A session is an isolated instance of a human <-> AI interaction
 * that can span over numerous messages.
 */
export interface Session<
  // deno-lint-ignore ban-types
  Cfg extends {} = Record<string, unknown>,
  Ctx extends SessionContext<Cfg> = SessionContext<Cfg>,
> {
  readonly id: SessionID;
  readonly context: Ctx;
  readonly controller: SessionController<Session<Cfg, Ctx>>;
  readonly createdAt: Date;
  handleUserMessage(message: BaseChatMessage): Promise<ReadableStream<ChatEvent>> | ReadableStream<ChatEvent>;
}

/**
 * A session type is a class that implements a specific type of session.
 * For instance a basic chat or a plan & execute session.
 */
// deno-lint-ignore ban-types
export interface SessionController<S extends Session<{}> = Session> {
  id: SessionControllerID;
  createSession(id: SessionID, config: S extends Session<infer C> ? C : never, features: FeatureRegistry): Promise<S> | S;
  deserializeSession(serializedSession: string, allFeatures: FeatureRegistry): Promise<S> | S;
  serializeSession(session: S): Promise<string> | string;
}

// deno-lint-ignore ban-types
export interface SessionContext<Cfg extends {} = Record<string, unknown>> {
  chatHistory: ChatHistory;
  config: Cfg;
  features: FeatureRegistry;
  secrets: SecretsStore;
}

export type WellKnownSecretID = "api.openai.com";

export interface SecretsStore {
  exists(secretName: WellKnownSecretID | string): Promise<boolean>;
  read(secretName: WellKnownSecretID | string): Promise<string>;
  store(secretName: WellKnownSecretID | string, secretData: string): Promise<void>;
}

export interface RegistryNamespace<T> {
  get(name: string): T;
  has(name: string): boolean;
  keys(): IterableIterator<string>;
}

export interface FeatureRegistry {
  controllers: RegistryNamespace<SessionController>;
  models: RegistryNamespace<BaseLanguageModel>;
  tools: RegistryNamespace<Tool>;
}
