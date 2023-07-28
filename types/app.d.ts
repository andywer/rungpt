import { ChatMessage } from "./chat.d.ts";
import { StateStore } from "./state.d.ts";
import { ChainID, ISODateTimeString, ModelID, SessionID, ToolID } from "./types.d.ts";

export {
  ChainID,
  ModelID,
  SessionID,
  ToolID,
}

export type SessionSummary = Pick<SessionState, "createdAt" | "id"> & { title: string };

// Must be JSON-serializable!
export interface AppState {
  sessions: SessionSummary[];
}

// Must be JSON-serializable!
export interface SessionState {
  readonly config: {
    readonly chain: ChainID;
    readonly model: ModelID;
    readonly tools: (ToolID | "*")[];
  };
  readonly createdAt: ISODateTimeString;
  readonly id: SessionID;
  messages: ChatMessage[];
}

export type BaseAppStore = StateStore<AppState, BaseAppEvent>;
export type BaseSessionStore = StateStore<SessionState, BaseSessionEvent>;

export type BaseAppEvent =
  // deno-lint-ignore ban-types
  | { type: "app/init"; payload: {} }
  | { type: "app/loaded"; payload: AppState }
  | { type: "plugin/discovered"; payload: { path: string } }
  | { type: "plugin/failed"; payload: { error: Error; path: string } }
  | { type: "plugin/initialized"; payload: { path: string } }
  | { type: "session/created"; payload: SessionState }
  | { type: "session/read"; payload: SessionState };

export type BaseSessionEvent =
  | { type: "chain/run"; payload: { chainId: ChainID; runId: number; prompt: string } }
  | { type: "chain/run/response"; payload: { runId: number; isJson: boolean; response: string } }
  | { type: "chain/run/error"; payload: { runId: number; error: Error } }
  | { type: "message/added"; payload: ChatMessage & { index: number} }
  | { type: "message/updated"; payload: ChatMessage & { index: number}; debug?: boolean }
  | { type: "message/finalized"; payload: ChatMessage & { index: number} }
  | { type: "tool/call"; payload: { isJson: boolean; params: string; runId: number; toolName: string; } }
  | { type: "tool/call/response"; payload: { runId: number; isJson: boolean; response: string } }
  | { type: "tool/call/error"; payload: { runId: number; error: Error } }
