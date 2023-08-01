import { BaseLanguageModel } from "langchain/base_language";
import { BaseChain } from "langchain/chains";
import { Tool } from "langchain/tools";
import { AppState, BaseAppEvent, BaseSessionEvent, SessionState } from "./app.d.ts";
import { ChainID, ModelID, ToolID } from "./types.d.ts";
import { EventMiddleware, StateReducer } from "./state.d.ts";

export interface PluginMetadata {
  schema_version: string;
  name: string;
  description: string;
}

export interface Plugin {
  init(provide: PluginProvisions): Promise<void> | void;
}

export interface PluginClass<P extends Plugin = Plugin> {
  new(metadata: PluginMetadata): P;

  /** Property set by our plugin loader */
  metadata: PluginMetadata;
  /** Property set by our plugin loader */
  path: string;
}

export interface PluginProvisions {
  app: RuntimeProvision<AppState, BaseAppEvent>;
  features: FeatureProvisions;
  session: RuntimeProvision<SessionState, BaseSessionEvent>;
}

export interface FeatureProvisions {
  chain: FeatureProvision<BaseChain>;
  model: FeatureProvision<BaseLanguageModel>;
  tool: FeatureProvision<Tool>;
}

export interface FeatureProvision<T> {
  (id: string, thing: FeatureCtor<T>): FeatureProvisions;
}

export interface FeatureCtor<T> {
  (features: FeatureRegistry, session: SessionState): Promise<T> | T;
}

export interface RuntimeProvision<State, Event> {
  middleware(middleware: EventMiddleware<State, Event>): this;
  reducer(reducer: StateReducer<State, Event>): this;
}

export type ChatMessageRole = "briefing" | "error";

export type WellKnownSecretID = "api.openai.com";

export interface RegistryNamespace<K extends string, T> {
  subject: string;
  entries(): IterableIterator<[K, T]>;
  get(name: K): T;
  has(name: K): boolean;
  keys(): IterableIterator<K>;
}

export interface FeatureRegistry {
  chains: RegistryNamespace<ChainID, () => Promise<BaseChain>>;
  models: RegistryNamespace<ModelID, () => Promise<BaseLanguageModel>>;
  tools: RegistryNamespace<ToolID, () => Promise<Tool>>;
}
