import { ChatRole, MessageType } from "./chat.d.ts";

export interface ChatEventInterface<Type extends string, Data extends Record<string, unknown>> {
  type: Type;
  data: Data;
}

export type ChatEvent =
  | ChatAgentAction
  | ChatAgentActionEnd
  | ChatError
  | MessageAppend
  | MessageFinalize;

///////////////
// Event types

export type ChatAgentAction = ChatEventInterface<"agent/action", {
  tool: string;
  messageIndex: number;
  input: string;
}>;

export type ChatAgentActionEnd = ChatEventInterface<"agent/endofaction", {
  messageIndex: number;
  returnValues: Record<string, unknown>;
}>;

export type ChatError = ChatEventInterface<"error", { message: string }>;

export type MessageAppend = ChatEventInterface<"message/append", {
  messageIndex: number;
  append: string;
  role?: ChatRole;
  type: MessageType;
}>;

export type MessageFinalize = ChatEventInterface<"message/finalize", {
  messageIndex: number;
  actions?: {
    tool: string;
    input: string;
    results: Record<string, unknown>;
  }[];
  role?: ChatRole;
  text: string;
  type: MessageType;
}>;
