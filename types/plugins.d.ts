import { BaseLanguageModel } from "langchain/base_language";
import { BaseChain } from "langchain/chains";
import { Tool } from "langchain/tools";
import { Schema } from "jtd";
import { AppState, BaseAppEvent, BaseSessionEvent, SessionState } from "./app.d.ts";
import { ChainID, ModelID, ToolID } from "./types.d.ts";
import { EventMiddleware, StateReducer } from "./state.d.ts";
import { init } from "https://deno.land/x/base64@v0.2.1/base.ts";

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
  chain: FeatureProvision<ChainFeatureDescriptor<BaseChain>>;
  model: FeatureProvision<FeatureDescriptor<BaseLanguageModel>>;
  tool: FeatureProvision<FeatureDescriptor<Tool>>;
}

export interface FeatureProvision<T> {
  (id: string, thing: T): FeatureProvisions;
}

export interface FeatureDescriptor<T> {
  description: string;
  init(features: FeatureRegistry, session: SessionState): Promise<T> | T;
}

export interface ChainFeatureDescriptor<T = BaseChain> extends FeatureDescriptor<T> {
  config(featureIndexes: Record<keyof FeatureRegistry, string[]>): Promise<Schema> | Schema;
}

export interface BoundFeatureDescriptor<T> extends FeatureDescriptor<T> {
  init(): Promise<T>;
}

export interface BoundChainFeatureDescriptor<T = BaseChain> extends ChainFeatureDescriptor<T> {
  config(): Promise<Schema>;
  init(): Promise<T>;
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
  chains: RegistryNamespace<ChainID, BoundChainFeatureDescriptor>;
  models: RegistryNamespace<ModelID, BoundFeatureDescriptor<BaseLanguageModel>>;
  tools: RegistryNamespace<ToolID, BoundFeatureDescriptor<Tool>>;
}
