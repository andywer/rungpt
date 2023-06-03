import { ensureDirSync } from "https://deno.land/std@0.188.0/fs/mod.ts";

export class PromptLogItem {
  private aiName: string;
  private prompt: string;
  private filePath: string;

  private createdAt = new Date();
  private encoder = new TextEncoder();

  constructor(prompt: string, aiName: string, filePath: string) {
    this.prompt = prompt;
    this.aiName = aiName;
    this.filePath = filePath;

    Deno.writeFileSync(
      this.filePath,
      this.encoder.encode(`---PROMPT (${this.aiName})---\n${this.prompt}\n`),
      { append: true },
    );
  }

  logError(message: string) {
    const duration = (new Date().getTime() - this.createdAt.getTime()) / 1000;
    Deno.writeFileSync(
      this.filePath,
      this.encoder.encode(`---ERROR (${duration.toFixed(1)}s)---\n${message}\n`),
      { append: true },
    );
  }

  logResponse(response: string) {
    const duration = (new Date().getTime() - this.createdAt.getTime()) / 1000;
    Deno.writeFileSync(
      this.filePath,
      this.encoder.encode(`---RESPONSE (${duration.toFixed(1)}s)---\n${response}\n`),
      { append: true },
    );
  }
}

export class PromptLogger {
  private logDirectory: string;

  constructor(logDirectory: string) {
    ensureDirSync(logDirectory);
    const sessionTimestamp = new Date().toISOString();

    this.logDirectory = `${logDirectory}/${sessionTimestamp}`;
    ensureDirSync(this.logDirectory);
  }

  logPrompt(aiName: string, prompt: string): PromptLogItem {
    const callTimestamp = new Date().toISOString();
    const logFilePath = `${this.logDirectory}/${callTimestamp}.log`;

    return new PromptLogItem(prompt, aiName, logFilePath);
  }
}
