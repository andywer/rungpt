// chat_gpt_api.ts

export class ChatGPT {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async sendMessage(message: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/engines/gpt-4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are ChatGPT, a large language model trained by OpenAI, based on the GPT-4 architecture." },
          { role: "user", content: message },
        ],
        max_tokens: 150,
        n: 1,
        stop: null,
        temperature: 0.5,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return data.choices[0].message.content.trim();
    } else {
      throw new Error(`Error in ChatGPT API: ${data.error.message}`);
    }
  }
}
