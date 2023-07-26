import { CallbackManager } from "langchain/callbacks";
import { AppState, BaseAppEvent, BaseSessionEvent, BaseSessionStore, SessionID, SessionState } from "../types/app.d.ts";
import { ChatMessage } from "../types/chat.d.ts";
import { FeatureRegistry, Plugin, PluginClass } from "../types/plugins.d.ts";
import { Runtime as RuntimeT, Session } from "../types/runtime.d.ts";
import { EventMiddleware, StateReducer, StateStore } from "../types/state.d.ts";
import { ISODateTimeString } from "../types/types.d.ts";
import { FeaturesProvided, InternalFeatureRegistry, PluginInitializer } from "./plugin_initializer.ts";
import { PluginLoader } from "./plugin_loader.ts";
import { createStateStore } from "./state.ts";

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
  public readonly sessions = new WeakMap<SessionID, Promise<Session<BaseSessionStore>>>();
  public readonly store: StateStore<AppState, BaseAppEvent>;

  private nextRunId = 1;

  private pluginInitializer: PluginInitializer;
  private pluginLoader = new PluginLoader();

  protected builtin = {
    app: {
      middleware: (async (event, stack, getState) => {
        await stack.next(event);
        await this.appStorage.store(getState());
      }) satisfies EventMiddleware<AppState, BaseAppEvent>,
      reducer: ((state, event) => {
        const lastOf = <T>(array: T[]) => array.length > 0 ? array[array.length - 1] : undefined;
        const truncate = (text: string, length: number) => text.length > length ? `${text.slice(0, length)}…` : text;
        const getTitle = (session: SessionState) => (
          truncate(lastOf(session.messages)?.message.text ?? "New session", 50)
        );
        if (event.type === "session/created" || event.type === "session/read") {
          return {
            ...state,
            sessions: state.sessions.map((session) => (
              session.id === event.payload.id
                ? { id: event.payload.id, createdAt: event.payload.createdAt, title: getTitle(event.payload) }
                : session
            )),
          };
        } else {
          return state;
        }
      }) satisfies StateReducer<AppState, BaseAppEvent>,
    },
    session: (getFeatures: () => FeatureRegistry) => ({
      middleware: (async (event, stack, getState) => {
        if (event.type === "message/added" && event.payload.message.role === ChatRole.User) {
          const session = getState();
          const runId = this.nextRunId++;
          const prompt = session.messages.filter((message) => message.message.role === ChatRole.User);
          await stack.next(event);
          await stack.dispatch({
            type: "chain/run",
            payload: { chainId: session.config.chain, runId, prompt },
          });
        } else if (event.type === "chain/run") {
          const actions: ChatMessage["actions"] = [];
          const chain = await getFeatures().chains.get(event.payload.chainId)();
          const createdAt = new Date().toISOString() as ISODateTimeString;
          const messageIndex = getState().messages.length;
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
            const response = await chain.run(event.payload.prompt, CallbackManager.fromHandlers({
              async handleAgentAction(action) {
                actions.push({
                  input: action.toolInput,
                  tool: action.tool,
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
              async handleAgentEnd(result) {
                actions[actions.length - 1] = {
                  ...actions[actions.length - 1],
                  results: result.returnValues,
                };
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
              async handleLLMNewToken(token) {
                message.text += token;
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
              async handleToolStart(tool, input) {
                await stack.dispatch({
                  type: "tool/call",
                  payload: {
                    isJson: false,
                    params: JSON.stringify(input),
                    runId: event.payload.runId,
                    toolName: tool.id.join("."),
                  },
                });
              },
              async handleToolEnd(output) {
                await stack.dispatch({
                  type: "tool/call/response",
                  payload: { runId: event.payload.runId, isJson: false, response: output },
                });
              },
              async handleToolError(error) {
                await stack.dispatch({
                  type: "tool/call/error",
                  payload: { runId: event.payload.runId, error },
                });
              },
            }));
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
              index: getState().messages.length,
              message: {
                role: ChatRole.Error,
                text: event.payload.error.message,
              },
            },
          });
        } else {
          await stack.next(event);
        }
        await this.sessionStorage.store(getState());
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
              ...state.messages.slice(event.payload.index),
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

    const appStore = createStateStore<AppState, BaseAppEvent>(initialState, [this.builtin.app.reducer], [this.builtin.app.middleware]);

    this.pluginInitializer = new PluginInitializer(appStore, features);
    this.store = appStore;
  }

  async init(pluginsPath: string): Promise<void> {
    const appState = await this.appStorage.read();
    if (appState) {
      this.store.dispatch({ type: "app/loaded", payload: appState });
    }

    for (const PluginClass of await this.preloadPlugins(pluginsPath)) {
      this.plugins.push(PluginClass);
      await this.initializePlugin(PluginClass);
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

  async createSession(id: SessionID, config: SessionState["config"]): Promise<Session<BaseSessionStore>> {
    if (this.sessionStorage.get(id)) {
      throw new Error(`Session ${id} already exists`);
    }

    const state: SessionState = {
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

  protected instantiateSession(state: SessionState): Promise<Session<BaseSessionStore>> {
    if (!this.sessions.has(state.id)) {
      this.sessions.set(state.id, this.instantiateSessionUncached(state));
    }
    return this.sessions.get(state.id)!;
  }

  private async instantiateSessionUncached(state: SessionState): Promise<Session<BaseSessionStore>> {
    const builtin = this.builtin.session(() => this.features.public(state));
    const sessionStore = createStateStore<SessionState, BaseSessionEvent>(state, [builtin.reducer], [builtin.middleware]);

    for (const [_plugin, _PluginClass, provided] of this.instantiatedPlugins) {
      sessionStore.registerMiddlewares(...provided.session.middlewares);
      sessionStore.registerReducers(...provided.session.reducers);
    }

    const features = this.features.public(state);
    const chain = await (features.chains.get(state.config.chain))();

    const session: Session<BaseSessionStore> = {
      chain,
      id: state.id,
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
  constructor(
    public readonly path: string,
  ) {}

  async read(): Promise<AppState | null> {
    try {
      const content = await Deno.readTextFile(this.path);
      return JSON.parse(content) as AppState;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      } else {
        throw error;
      }
    }
  }

  async store(state: AppState): Promise<void> {
    await Deno.writeTextFile(this.path, JSON.stringify(state));
  }
}

class SessionStorage {
  protected index: SessionID[] = [];
  protected storedSessions: Map<SessionID, SessionState> = new Map();

  constructor(
    public readonly path: string,
  ) {}

  async init(): Promise<void> {
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
  }

  get(id: SessionID): SessionState | undefined {
    return this.storedSessions.get(id);
  }

  list(): SessionID[] {
    return this.index;
  }

  async store(session: SessionState): Promise<void> {
    const sessionPath = `${this.path}/${session.createdAt} - ${session.id}.json`;
    await Deno.writeTextFile(sessionPath, JSON.stringify(session));
  }
}
