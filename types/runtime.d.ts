import { BaseChain } from "langchain/chains";
import { AppState, BaseAppEvent, BaseSessionEvent, BaseSessionStore, ChainID, SessionState } from "./app.d.ts";
import { FeatureRegistry, PluginClass } from "./plugins.d.ts";
import { StateStore } from "./state.d.ts";
import { SessionID } from "./types.d.ts";

export interface Runtime {
  plugins: PluginClass[];
  store: StateStore<AppState, BaseAppEvent>;
  init(pluginsPaths: string[]): Promise<void>;
  createSession(id: SessionID, chainId: ChainID, config: SessionState["config"]): Promise<Session<BaseSessionStore>>;
  readSession(sessionId: SessionID): Promise<Session<BaseSessionStore> | null>;
  storeSession(session: Session<BaseSessionStore>): Promise<void>;
}

/**
 * A session is an isolated instance of a human <-> AI interaction
 * that can span over numerous messages.
 */
export interface Session<
  SessionStore extends StateStore<SessionState, BaseSessionEvent>,
> {
  chain: BaseChain;
  features: FeatureRegistry;
  id: SessionID;
  store: SessionStore;
}
