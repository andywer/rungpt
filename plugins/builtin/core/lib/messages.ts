import { AIChatMessage, BaseChatMessage, HumanChatMessage, SystemChatMessage } from "langchain/schema";
import { ChatMessage } from "../../../../types/chat.d.ts";

export enum ChatRole {
  Assistant = "assistant",
  Error = "error",
  System = "system",
  User = "user",
}

export function toLangchainMessage(message: ChatMessage): BaseChatMessage {
  switch (message.message.role) {
    case ChatRole.Assistant:
      return new AIChatMessage(message.message.text);
    case ChatRole.Error:
    case ChatRole.System:
      return new SystemChatMessage(message.message.text);
    case ChatRole.User:
      return new HumanChatMessage(message.message.text);
    default:
      throw new Error(`Unknown chat role: ${message.message.role}`);
  }
}
