import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { AgentAction, BaseChatMessage } from "https://esm.sh/v118/langchain@0.0.75/schema.js";
import { ChatMessage } from "https://esm.sh/langchain/schema";
import { ChatMessage as ChatMessageT, ChatRole } from "../chat.d.ts";
import { ChatEvent } from "../chat_events.d.ts";
import { ChatHistory, ChatHistoryEvents } from "../plugins.d.ts";

export class InMemoryChatHistory implements ChatHistory {
  public readonly events = new EventEmitter<ChatHistoryEvents>();

  private messages: {
    actions: ChatMessageT["actions"];
    createdAt: Date;
    message: BaseChatMessage;
  }[] = [];

  public addError(error: Error): Promise<number> {
    const message = new ChatMessage(error.message, "error");
    const messageIndex = this.messages.length;

    this.messages.push({
      actions: [],
      createdAt: new Date(),
      message,
    });

    this.events.emit("chat", {
      type: "message/finalize",
      data: {
        messageIndex: messageIndex,
        role: (message as ChatMessage).role as ChatRole | undefined,
        text: message.text,
        type: message._getType(),
      },
    });
    return Promise.resolve(messageIndex);
  }

  public addMessage(message: BaseChatMessage): Promise<number> {
    const messageIndex = this.messages.length;
    this.messages.push({
      actions: [],
      createdAt: new Date(),
      message,
    });

    this.events.emit("chat", {
      type: "message/append",
      data: {
        append: message.text,
        messageIndex: messageIndex,
        role: (message as ChatMessage).role as ChatRole | undefined,
        type: message._getType(),
      },
    });
    return Promise.resolve(messageIndex);
  }

  public appendToMessage(messageIndex: number, append: string): Promise<void> {
    const { message } = this.messages[messageIndex];
    message.text += append;

    this.events.emit("chat", {
      type: "message/append",
      data: {
        append,
        messageIndex: messageIndex,
        role: (message as ChatMessage).role as ChatRole | undefined,
        type: message._getType(),
      },
    });
    return Promise.resolve();
  }

  public addAction(messageIndex: number, action: AgentAction): Promise<number> {
    const { actions } = this.messages[messageIndex];
    actions.push({
      tool: action.tool,
      input: action.toolInput,
    });

    this.events.emit("chat", {
      type: "agent/action",
      data: {
        tool: action.tool,
        input: action.toolInput,
        messageIndex,
      },
    });
    return Promise.resolve(actions.length - 1);
  }

  public getMessages(): { actions: ChatMessageT["actions"], createdAt: Date, message: BaseChatMessage }[] {
    return this.messages;
  }

  public finalizeMessage(
    messageIndex: number,
    text: string = this.messages[messageIndex].message.text,
    actionResult?: Record<string, unknown>,
  ): Promise<void> {
    const { actions, message } = this.messages[messageIndex];

    message.text = text;
    for (const [idx, action] of actions.entries()) {
      actions[idx] = action;
    }

    this.events.emit("chat", {
      type: "message/finalize",
      data: {
        messageIndex,
        actions: actions
          .map((action, idx, all) => (
            idx === all.length - 1
              ? { ...action, results: (actionResult || action.results)! }
              : { results: {}, ...action }
          )),
        role: (message as ChatMessage).role as ChatRole | undefined,
        text,
        type: message._getType(),
      },
    });
    return Promise.resolve();
  }

  public messageExists(messageIndex: number): boolean {
    return messageIndex < this.messages.length;
  }

  public setActionResults(messageIndex: number, actionIndex: number, results: Record<string, unknown>): Promise<void> {
    const actions = this.messages[messageIndex].actions;
    actions[actionIndex] = { ...actions[actionIndex], results };
    return Promise.resolve();
  }

  public async streamMessage(message: Omit<BaseChatMessage, "text">, text: ReadableStream<string>): Promise<number> {
    const messageIndex = await this.addMessage({ ...message, text: "" });

    let read: ReadableStreamDefaultReadResult<string> | undefined;
    const reader = text.getReader();

    while ((read = await reader.read()) && !read.done) {
      await this.appendToMessage(messageIndex, read.value);
    }

    return messageIndex;
  }
}

export function eventStreamFromChatHistory(chatHistory: ChatHistory): ReadableStream<ChatEvent> {
  let listener: (event: ChatEvent) => void;

  return new ReadableStream<ChatEvent>({
    start(controller) {
      chatHistory.events.on("chat", listener = (event) => {
        controller.enqueue(event);
      });
    },
    cancel() {
      chatHistory.events.off("chat", listener);
    },
  });
}
