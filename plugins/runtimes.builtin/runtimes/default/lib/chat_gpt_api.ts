// chat_gpt_api.ts

export interface ChatMessage {
  content: string;
  name?: string;
  role: "assistant" | "user" | "system";
}

export interface ChatChoice {
  index: number;
  finish_reason: "stop" | "length" | "temperature" | "presence" | "timeout";
  message: ChatMessage;
}

export class ChatGPT {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async sendMessage(messages: ChatMessage[], model = "gpt-3.5-turbo"): Promise<Response> {
    return await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1000,
        n: 1,
        stop: null,
        stream: true,
        temperature: 0.5,
      }),
    });
  }
}
