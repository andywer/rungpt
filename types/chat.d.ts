import { ISODateTimeString } from "./types.d.ts";

/** Origin of a chat message. Not an enum as this file is for type declarations only. */
export type ChatRole = "assistant" | "error" | "system" | "user";

/**
 * Single message in a chat, sent by the user, the AI or the framework.
 * Custom data type for our API instead of langchain's `BaseChatMessage`
 * as we need something JSON-serializable.
 */
export interface ChatMessage {
  createdAt: ISODateTimeString;
  actions: {
    tool: string;
    input: string;
    result?: string;
  }[];
  message: {
    role: ChatRole;
    text: string;
  };
}
