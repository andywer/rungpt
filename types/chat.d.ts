import { ISODateTimeString } from "./types.d.ts";

// Consistent with the OpenAI API
export enum ChatRole {
  Assistant = "assistant",
  Error = "error",
  System = "system",
  User = "user",
}

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
    results?: Record<string, unknown>;
  }[];
  message: {
    role: ChatRole;
    text: string;
  };
}
