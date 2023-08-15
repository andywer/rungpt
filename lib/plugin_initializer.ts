// deno-lint-ignore-file no-explicit-any
import { BaseLanguageModel } from "langchain/base_language";
import { BaseChain } from "langchain/chains";
import { Tool } from "langchain/tools";
import { httpErrors } from "oak/mod.ts";
import {
BoundChainFeatureDescriptor,
  BoundFeatureDescriptor,
  ChainFeatureDescriptor,
  FeatureDescriptor,
  FeatureProvision,
  FeatureProvisions,
  FeatureRegistry as FeatureRegistryT,
  Plugin,
  PluginClass,
  PluginProvisions,
  RegistryNamespace as RegistryNamespaceT,
} from "../types/plugins.d.ts";
import { AppState, BaseAppEvent, BaseSessionEvent, ChainID, ModelID, SessionState, ToolID } from "../types/app.d.ts";
import { EventMiddleware, ExtendableStateStore, StateReducer } from "../types/state.d.ts";

type Dtor<T> = FeatureDescriptor<T> | ChainFeatureDescriptor<T>;

export interface FeaturesProvided {
  app: {
    middlewares: EventMiddleware<AppState, BaseAppEvent>[];
    reducers: StateReducer<AppState, BaseAppEvent>[];
  };
  features: InternalFeatureRegistry;
  session: {
    middlewares: EventMiddleware<SessionState, BaseSessionEvent>[];
    reducers: StateReducer<SessionState, BaseSessionEvent>[];
  };
}

export class PluginInitializer {
  constructor(
    protected appStore: ExtendableStateStore<AppState, BaseAppEvent>,
    protected features: InternalFeatureRegistry = InternalFeatureRegistry.empty(),
  ) {}

  async initializePlugin(PluginClass: PluginClass): Promise<[Plugin, FeaturesProvided]> {
    const [provide, provided] = createProvisioning();
    const plugin = new PluginClass(PluginClass.metadata);

    try {
      await plugin.init(provide);
    } catch (error) {
      console.error(error);
      throw new Error(`Failed to initialize plugin ${PluginClass.path}: ${error.message}`);
    }

    this.appStore.registerMiddlewares(...provided.app.middlewares);
    this.appStore.registerReducers(...provided.app.reducers);
    this.features.import(provided.features);

    await this.appStore.dispatch({ type: "plugin/initialized", payload: { path: PluginClass.path } });
    return [plugin, provided];
  }
}

function createProvisioning(): [PluginProvisions, FeaturesProvided] {
  const provided: FeaturesProvided = {
    app: {
      middlewares: [],
      reducers: [],
    } as FeaturesProvided["app"],
    features: InternalFeatureRegistry.empty(),
    session: {
      middlewares: [],
      reducers: [],
    } as FeaturesProvided["session"],
  };

  const createFeatureProvision = <K extends keyof FeatureRegistryT>(subject: K, getSelf: () => FeatureProvisions): FeatureProvision<any> => {
    type T = FeatureRegistryT[K] extends RegistryNamespaceT<any, infer T> ? T : never;
    const provision = (id: string, thing: T) => {
      provided.features[subject].set(id as any, thing as any);
      return getSelf();
    };
    return provision satisfies FeatureProvision<T>;
  };

  const provisioning: PluginProvisions = {
    app: {
      middleware: (middleware: EventMiddleware<AppState, BaseAppEvent>) => {
        provided.app.middlewares.push(middleware);
        return provisioning.app;
      },
      reducer: (reducer: StateReducer<AppState, BaseAppEvent>) => {
        provided.app.reducers.push(reducer);
        return provisioning.app;
      },
    },
    features: {
      chain: createFeatureProvision("chains", () => provisioning.features),
      model: createFeatureProvision("models", () => provisioning.features),
      tool: createFeatureProvision("tools", () => provisioning.features),
    },
    session: {
      middleware: (middleware: EventMiddleware<SessionState, BaseSessionEvent>) => {
        provided.session.middlewares.push(middleware);
        return provisioning.session;
      },
      reducer: (reducer: StateReducer<SessionState, BaseSessionEvent>) => {
        provided.session.reducers.push(reducer);
        return provisioning.session;
      },
    },
  };

  return [provisioning, provided];
}

export class InternalFeatureRegistry {
  protected constructor(
    public chains: InternalRegistryNamespace<ChainID, BaseChain, ChainFeatureDescriptor>,
    public models: InternalRegistryNamespace<ModelID, BaseLanguageModel, FeatureDescriptor<BaseLanguageModel>>,
    public tools: InternalRegistryNamespace<ToolID, Tool, FeatureDescriptor<Tool>>,
  ) {}

  static empty(): InternalFeatureRegistry {
    return new InternalFeatureRegistry(
      InternalRegistryNamespace.empty("chain"),
      InternalRegistryNamespace.empty("model"),
      InternalRegistryNamespace.empty("tool"),
    );
  }

  clone(): InternalFeatureRegistry {
    return new InternalFeatureRegistry(
      this.chains.clone(),
      this.models.clone(),
      this.tools.clone(),
    );
  }

  import(registry: InternalFeatureRegistry) {
    this.chains.import(registry.chains);
    this.models.import(registry.models);
    this.tools.import(registry.tools);
  }

  keys(): Record<keyof FeatureRegistryT, string[]> {
    return {
      chains: Array.from(this.chains.keys()),
      models: Array.from(this.models.keys()),
      tools: Array.from(this.tools.keys()),
    };
  }

  public(getSessionState: () => SessionState): FeatureRegistryT {
    // deno-lint-ignore prefer-const
    let publicRegistry: FeatureRegistryT;
    const getFeatures = () => publicRegistry;

    publicRegistry = new PublicFeatureRegistry(
      this.chains.public(getFeatures, getSessionState),
      this.models.public(getFeatures, getSessionState),
      this.tools.public(getFeatures, getSessionState),
    );
    return publicRegistry;
  }
}

export class PublicFeatureRegistry implements FeatureRegistryT {
  constructor(
    public chains: RegistryNamespaceT<ChainID, BoundChainFeatureDescriptor>,
    public models: RegistryNamespaceT<ModelID, BoundFeatureDescriptor<BaseLanguageModel>>,
    public tools: RegistryNamespaceT<ToolID, BoundFeatureDescriptor<Tool>>,
  ) {}
}

class BaseRegistryNamespace<K extends string, T> {
  protected constructor(
    public readonly subject: string,
    public readonly items: Map<K, T>,
  ) {}

  entries(): IterableIterator<[K, T]> {
    return this.items.entries();
  }

  get(name: K): T | undefined {
    const item = this.items.get(name);
    return item;
  }

  has(name: K): boolean {
    return this.items.has(name);
  }

  keys(): IterableIterator<K> {
    return this.items.keys();
  }

  set(name: K | string, item: T) {
    this.items.set(name as K, item);
  }
}

class InternalRegistryNamespace<K extends string, T, C extends Dtor<T>> extends BaseRegistryNamespace<K, C> {
  static empty<K extends string, T, C extends Dtor<T>>(subject: string): InternalRegistryNamespace<K, T, C> {
    return new InternalRegistryNamespace(subject, new Map());
  }

  static merge<K extends string, T, C extends Dtor<T>>(...namespaces: InternalRegistryNamespace<K, T, C>[]) {
    const map = new Map<K, C>();
    for (const namespace of namespaces) {
      for (const [name, item] of namespace.entries()) {
        if (map.has(name)) {
          throw new Error(`Duplicate ${namespace.subject} name: ${name}`);
        }
        map.set(name, item);
      }
    }
    return new InternalRegistryNamespace<K, T, C>(namespaces[0].subject, map);
  }

  clone(): InternalRegistryNamespace<K, T, C> {
    return new InternalRegistryNamespace(this.subject, new Map(this.items));
  }

  import(registry: InternalRegistryNamespace<K, T, C>) {
    for (const [id, item] of registry.entries()) {
      if (this.items.has(id)) {
        throw new Error(`Duplicate ${this.subject} ID: ${id}`);
      }
      this.items.set(id, item);
    }
  }

  public(getFeatures: () => FeatureRegistryT, getSessionState: () => SessionState): RegistryNamespaceT<K, C extends ChainFeatureDescriptor<T> ? BoundChainFeatureDescriptor<T> : BoundFeatureDescriptor<T>> {
    type B = C extends ChainFeatureDescriptor<T> ? BoundChainFeatureDescriptor<T> : BoundFeatureDescriptor<T>;
    const items = new Map<K, B>();

    const getKeys = (features: FeatureRegistryT): Record<keyof FeatureRegistryT, string[]> => {
      return {
        chains: Array.from(features.chains.keys()),
        models: Array.from(features.models.keys()),
        tools: Array.from(features.tools.keys()),
      };
    };

    for (const [id, descriptor] of this.items.entries()) {
      items.set(id, {
        ...descriptor,
        config: "config" in descriptor
          ? () => Promise.resolve(descriptor.config(getKeys(getFeatures())))
          : undefined,
        init: () => Promise.resolve(descriptor.init(getFeatures(), getSessionState())),
      } as BoundChainFeatureDescriptor<T> as B);
    }
    return new PublicRegistryNamespace<K, B>(this.subject, items);
  }
}

function capitalize(text: string): string {
  return text && (text[0].toLocaleUpperCase() + text.substring(1));
}

class PublicRegistryNamespace<K extends string, T> extends BaseRegistryNamespace<K, T> implements RegistryNamespaceT<K, T> {
  get(name: K): T {
    const item = this.items.get(name);
    if (!item) {
      throw new httpErrors.BadRequest(`${capitalize(this.subject)} not found: ${name}`);
    }
    return item;
  }
}
