import { fail } from "std/testing/asserts.ts";
import { ChatHistory, PluginContext as PluginContextT } from "../types/plugins.d.ts";
import { SecretsStore as SecretsStoreT } from "../types/session.d.ts";
import { InMemoryChatHistory } from "./chat_history.ts";

export class SecretsStore implements SecretsStoreT {
  #secrets = new Map<string, string>();

  // deno-lint-ignore require-await
  async exists(secretName: string): Promise<boolean> {
    return this.#secrets.has(secretName);
  }

  // deno-lint-ignore require-await
  async read(secretName: string): Promise<string> {
    return this.#secrets.get(secretName) || fail(`Secret not found: ${secretName}`);
  }

  // deno-lint-ignore require-await
  async store(secretName: string, secretValue: string): Promise<void> {
    this.#secrets.set(secretName, secretValue);
  }
}

export class PluginContext implements PluginContextT {
  constructor(
    public readonly secrets: SecretsStoreT,
  ) { }

  public readonly utils = {
    createChatHistory(): ChatHistory {
      // TODO: Make this configurable
      return new InMemoryChatHistory();
    },
  };
}
