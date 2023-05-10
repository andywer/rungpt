import { MessageType } from "https://esm.sh/v118/langchain@0.0.67/schema.js";

export {
  MessageType,
};

// Consistent with the OpenAI API
export enum ChatRole {
  Assistant = "assistant",
  System = "system",
  User = "user",
}

export type ISODateTimeString = string;

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
    role?: ChatRole;
    text: string;
    type: MessageType;
  };
}

/** AI interacting with the outside world, like fetching data from the internet */
export interface ChatAction {
  type: "action";
  action: {
    tool: string;
    input: string;
    results: Record<string, unknown>;
  };
}
