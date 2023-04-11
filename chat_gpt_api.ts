// chat_gpt_api.ts

export interface Message {
  content: string;
  role: string;
}

export class ChatGPT {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async sendMessage(message: string, model = "gpt-3.5-turbo"): Promise<Response> {
    return await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are ChatGPT, a large language model trained by OpenAI, based on the GPT-3.5 Turbo architecture." },
          { role: "user", content: message },
        ],
        max_tokens: 150,
        n: 1,
        stop: null,
        stream: true,
        temperature: 0.5,
      }),
    });
  }
}
