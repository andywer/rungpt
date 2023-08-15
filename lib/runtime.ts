import { debug } from "debug/mod.ts";
import * as JTD from "jtd";
import { CallbackManager } from "langchain/callbacks";
import { AgentFinish } from "langchain/schema";
import { httpErrors } from "oak/mod.ts";
import { AppState, BaseAppEvent, BaseSessionEvent, BaseSessionStore, ChainID, SessionID, SessionState } from "../types/app.d.ts";
import { ChatMessage } from "../types/chat.d.ts";
import { FeatureRegistry, Plugin, PluginClass } from "../types/plugins.d.ts";
import { Runtime as RuntimeT, Session } from "../types/runtime.d.ts";
import { EventMiddleware, StateReducer, StateStore } from "../types/state.d.ts";
import { ISODateTimeString } from "../types/types.d.ts";
import { FeaturesProvided, InternalFeatureRegistry, PluginInitializer } from "./plugin_initializer.ts";
import { PluginLoader } from "./plugin_loader.ts";
import { createStateStore } from "./state.ts";
import { throttle } from "./utils.ts";
import { fail } from "https://deno.land/std@0.184.0/testing/asserts.ts";

enum ChatRole {
  Assistant = "assistant",
  Error = "error",
  System = "system",
  User = "user",
}

/**
 * Center piece of the application.
 *
 * The runtime is where state management, plugins, sessions and storage meet.
 */
export class Runtime implements RuntimeT {
  public readonly instantiatedPlugins: [Plugin, PluginClass, FeaturesProvided][] = [];
  public readonly plugins: PluginClass[] = [];
  public readonly sessions = new Map<SessionID, Promise<Session<BaseSessionStore>>>();
  public readonly store: StateStore<AppState, BaseAppEvent>;

  private nextRunId = 1;

  private pluginInitializer: PluginInitializer;
  private pluginLoader = new PluginLoader();

  protected builtin = {
    app: {
      middleware: (async (event, stack, store) => {
        await stack.next(event);
        await this.appStorage.storeThrottled(store.getState());
      }) satisfies EventMiddleware<AppState, BaseAppEvent>,
      reducer: ((state, event) => {
        const lastOf = <T>(array: T[]) => array.length > 0 ? array[array.length - 1] : undefined;
        const truncate = (text: string, length: number) => text.length > length ? `${text.slice(0, length)}…` : text;
        const getTitle = (session: SessionState) => {
          const message = lastOf(session.messages.filter((msg) => !!msg.message.text));
          return truncate((message?.message.text ?? "New session") || "Unnamed session", 50);
        };
        if (event.type === "session/created" || event.type === "session/read") {
          if (state.sessions.some((session) => session.id === event.payload.id)) {
            return state;
          }
          return {
            ...state,
            sessions: [
              ...state.sessions,
              { id: event.payload.id, createdAt: event.payload.createdAt, title: getTitle(event.payload) },
            ],
          };
        } else {
          return state;
        }
      }) satisfies StateReducer<AppState, BaseAppEvent>,
    },
    session: (getFeatures: (store: BaseSessionStore) => FeatureRegistry) => ({
      middleware: (async (event, stack, store) => {
        if (event.type === "message/added" && event.payload.message.role === ChatRole.User) {
          const session = store.getState();
          const runId = this.nextRunId++;
          await stack.next(event);
          await stack.dispatch({
            type: "chain/run",
            payload: { chainId: session.chain, runId, prompt: event.payload.message.text },
          });
        } else if (event.type === "chain/run") {
          let lastAction: AgentFinish | undefined;

          const actions: ChatMessage["actions"] = [];
          const chain = await getFeatures(store).chains.get(event.payload.chainId).init();
          const createdAt = new Date().toISOString() as ISODateTimeString;
          const messageIndex = store.getState().messages.length;
          const message: ChatMessage["message"] = {
            role: ChatRole.Assistant,
            text: "",
          };

          await stack.next(event);
          await stack.dispatch({
            type: "message/added",
            payload: {
              actions,
              createdAt,
              index: messageIndex,
              message,
            },
          });

          try {
            let response = await chain.run(event.payload.prompt, CallbackManager.fromHandlers({
              handleAgentEnd(result) {
                lastAction = result;
              },
              async handleToolStart(tool, input) {
                actions.push({
                  input,
                  // deno-lint-ignore no-explicit-any
                  tool: (tool as any).name ?? tool.id[tool.id.length - 1],
                });
                await stack.dispatch({
                  type: "tool/call",
                  payload: {
                    isJson: false,
                    params: JSON.stringify(input),
                    runId: event.payload.runId,
                    toolName: tool.id[tool.id.length - 1],
                  },
                });
                await stack.dispatch({
                  type: "message/updated",
                  payload: {
                    actions,
                    createdAt,
                    index: messageIndex,
                    message,
                  },
                });
              },
              async handleToolEnd(output) {
                actions[actions.length - 1].result = output;
                await stack.dispatch({
                  type: "tool/call/response",
                  payload: { runId: event.payload.runId, isJson: false, response: output },
                });
                await stack.dispatch({
                  type: "message/updated",
                  payload: {
                    actions,
                    createdAt,
                    index: messageIndex,
                    message,
                  },
                });
              },
              async handleToolError(error) {
                await stack.dispatch({
                  type: "tool/call/error",
                  payload: { runId: event.payload.runId, error },
                });
              },
            }));

            if (!response && lastAction?.returnValues?.output) {
              response = lastAction.returnValues.output;
            }

            await stack.dispatch({
              type: "chain/run/response",
              payload: { runId: event.payload.runId, isJson: false, response },
            });
            await stack.dispatch({
              type: "message/finalized",
              payload: {
                actions,
                createdAt,
                index: messageIndex,
                message: {
                  ...message,
                  text: response,
                },
              },
            });
          } catch (error) {
            await stack.dispatch({
              type: "chain/run/error",
              payload: { runId: event.payload.runId, error },
            });
          }
        } else if (event.type === "chain/run/error") {
          await stack.next(event);
          await stack.dispatch({
            type: "message/added",
            payload: {
              actions: [],
              createdAt: new Date().toISOString() as ISODateTimeString,
              index: store.getState().messages.length,
              message: {
                role: ChatRole.Error,
                text: event.payload.error.message,
              },
            },
          });
        } else {
          await stack.next(event);
        }
        await this.sessionStorage.storeThrottled(store.getState());
      }) satisfies EventMiddleware<SessionState, BaseSessionEvent>,
      reducer: ((state, event) => {
        if (event.type === "message/added") {
          return {
            ...state,
            messages: [
              ...state.messages,
              event.payload,
            ],
          } satisfies SessionState;
        } else if (event.type === "message/updated" || event.type === "message/finalized") {
          return {
            ...state,
            messages: [
              ...state.messages.slice(0, event.payload.index),
              event.payload,
              ...state.messages.slice(event.payload.index + 1),
            ],
          } satisfies SessionState;
        } else {
          return state;
        }
      }) satisfies StateReducer<SessionState, BaseSessionEvent>,
    }),
  };

  constructor(
    private appStorage: AppStorage,
    private sessionStorage: SessionStorage,
    public features: InternalFeatureRegistry = InternalFeatureRegistry.empty(),
  ) {
    const initialState: AppState = {
      sessions: [],
    };

    const appStore = createStateStore<AppState, BaseAppEvent>("app", initialState, [this.builtin.app.reducer], [this.builtin.app.middleware]);

    this.pluginInitializer = new PluginInitializer(appStore, features);
    this.store = appStore;

    for (const sessionId of sessionStorage.list()) {
      this.store.dispatch({ type: "session/read", payload: sessionStorage.get(sessionId)! });
    }
  }

  async init(pluginsPaths: string[]): Promise<void> {
    const appState = await this.appStorage.read();
    if (appState) {
      this.store.dispatch({ type: "app/loaded", payload: appState });
    }

    for (const pluginsPath of pluginsPaths) {
      for (const PluginClass of await this.preloadPlugins(pluginsPath)) {
        this.plugins.push(PluginClass);
        await this.initializePlugin(PluginClass);
      }
    }

    this.store.dispatch({ type: "app/init", payload: {} });
    await this.appStorage.store(this.store.getState());
  }

  protected async preloadPlugins(pluginsPath: string): Promise<PluginClass[]> {
    const plugins: PluginClass[] = [];

    for await (const pluginPath of this.pluginLoader.discoverPlugins(pluginsPath)) {
      this.store.dispatch({ type: "plugin/discovered", payload: { path: pluginPath } });

      try {
        const PluginClass = await this.pluginLoader.loadPlugin(pluginPath);
        plugins.push(PluginClass);
      } catch (error: unknown) {
        this.store.dispatch({ type: "plugin/failed", payload: { error: error as Error, path: pluginPath } });
      }
    }
    return plugins;
  }

  async initializePlugin(PluginClass: PluginClass): Promise<Plugin> {
    const [initialized, provided] = await this.pluginInitializer.initializePlugin(PluginClass);
    this.instantiatedPlugins.push([initialized, PluginClass, provided]);
    return initialized;
  }

  async createSession(id: SessionID, chainId: ChainID, config: SessionState["config"]): Promise<Session<BaseSessionStore>> {
    if (this.sessionStorage.get(id)) {
      throw new httpErrors.BadRequest(`Session ${id} already exists`);
    }

    const descriptor = this.features.chains.get(chainId) || fail(`Chain ${chainId} not found`);
    const configErrors = JTD.validate(await descriptor.config(this.features.keys()), config);

    if (configErrors.length > 0) {
      const error = configErrors[0];
      console.error(`Schema error:`, error);
      console.error(`Supplied config:`, config);
      throw new httpErrors.BadRequest(`Invalid session config: ${JSON.stringify(config, null, 2)}\nSchema path: "${error.schemaPath.join(".")}"\nInstance path: "${error.instancePath.join(".")}"`);
    }

    const state: SessionState = {
      chain: chainId,
      config,
      createdAt: new Date().toISOString() as ISODateTimeString,
      id,
      messages: [],
    };
    const session = await this.instantiateSession(state);
    this.store.dispatch({ type: "session/created", payload: state });
    await this.storeSession(session);
    return session;
  }

  protected instantiateSession(currentState: SessionState): Promise<Session<BaseSessionStore>> {
    if (!this.sessions.has(currentState.id)) {
      this.sessions.set(currentState.id, this.instantiateSessionUncached(currentState));
    }
    return this.sessions.get(currentState.id)!;
  }

  private async instantiateSessionUncached(currentState: SessionState): Promise<Session<BaseSessionStore>> {
    const builtin = this.builtin.session((store) => this.features.public(store.getState.bind(store)));
    const sessionStore = createStateStore<SessionState, BaseSessionEvent>("session", currentState, [builtin.reducer], [builtin.middleware]);

    for (const [_plugin, _PluginClass, provided] of this.instantiatedPlugins) {
      sessionStore.registerMiddlewares(...provided.session.middlewares);
      sessionStore.registerReducers(...provided.session.reducers);
    }

    const features = this.features.public(() => currentState);
    const chain = await (features.chains.get(currentState.chain)).init();

    const session: Session<BaseSessionStore> = {
      chain,
      id: currentState.id,
      features,
      store: sessionStore,
    };

    return session;
  }

  async readSession(id: SessionID): Promise<Session<BaseSessionStore> | null> {
    const state = this.sessionStorage.get(id);
    if (!state) {
      return null;
    }

    const session = await this.instantiateSession(state);
    this.store.dispatch({ type: "session/read", payload: state });
    return session;
  }

  storeSession(session: Session<BaseSessionStore>): Promise<void> {
    return this.sessionStorage.store(session.store.getState());
  }
}

export async function loadRuntime(appStatePath: string, sessionsRootPath: string) {
  const appStorage = new AppStorage(appStatePath);
  const sessionStorage = new SessionStorage(sessionsRootPath);
  await sessionStorage.init();

  const runtime = new Runtime(appStorage, sessionStorage);
  return runtime
}

class AppStorage {
  private lastKnownState: AppState | null = null;

  constructor(
    public readonly path: string,
  ) {}

  async read(): Promise<AppState | null> {
    try {
      const content = await Deno.readTextFile(this.path);

      // It is possible that `content` is empty if the file is being written to right now
      return content
        ? JSON.parse(content) as AppState
        : this.lastKnownState;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      } else {
        throw error;
      }
    }
  }

  async store(state: AppState): Promise<void> {
    this.lastKnownState = state;
    await Deno.writeTextFile(this.path, JSON.stringify(state));
  }

  storeThrottled = throttle(this.store.bind(this), 1000);
}

const debugSessionStorage = debug("session:storage");

class SessionStorage {
  protected index: SessionID[] = [];
  protected storedSessions: Map<SessionID, SessionState> = new Map();

  private _storeThrottled = throttle(this._store.bind(this), 1000);

  constructor(
    public readonly path: string,
  ) {}

  async init(): Promise<void> {
    debugSessionStorage("Initializing session storage at %s", this.path);

    for await (const dirEntry of Deno.readDir(this.path)) {
      if (dirEntry.isFile && !dirEntry.name.match(/^[\._]/) && dirEntry.name.match(/\.json$/i)) {
        const content = await Deno.readTextFile(`${this.path}/${dirEntry.name}`);
        const session = JSON.parse(content) as SessionState;

        if (!this.storedSessions.has(session.id)) {
          this.index.push(session.id);
          this.storedSessions.set(session.id, session);
        }
      }
    }

    this.index.sort((a, b) => {
      const sessionA = this.storedSessions.get(a)!;
      const sessionB = this.storedSessions.get(b)!;
      return sessionA.createdAt.localeCompare(sessionB.createdAt);
    });
  }

  get(id: SessionID): SessionState | undefined {
    return this.storedSessions.get(id);
  }

  list(): SessionID[] {
    return this.index;
  }

  async store(session: SessionState): Promise<void> {
    this.storedSessions.set(session.id, session);
    await this._store(session);
  }

  async storeThrottled(session: SessionState): Promise<void> {
    this.storedSessions.set(session.id, session);
    await this._storeThrottled(session);
  }

  private async _store(session: SessionState): Promise<void> {
    debugSessionStorage("Storing session: %o", session);

    const sessionPath = `${this.path}/${session.createdAt} - ${session.id}.json`;
    await Deno.writeTextFile(sessionPath, JSON.stringify(session));
  }
}
