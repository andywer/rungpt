// Consistent with the OpenAI API
export enum ChatRole {
  Assistant = "assistant",
  System = "system",
  User = "user",
}

export enum EventType {
  Error = "error",
  MessageAppend = "message/append",
}

export interface MessageAppendEvent {
  type: EventType.MessageAppend;
  data: {
    index: number;
    append: string;
    role: ChatRole;
  };
}
