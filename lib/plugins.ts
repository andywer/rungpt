import { fail } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import {
  PluginContext as PluginContextT,
  PluginInstance,
  PluginProvision,
  PluginSet as PluginSetT,
  RuntimeImplementation,
  SecretsStore as SecretsStoreT,
} from "../plugins.d.ts";
import { BaseLanguageModel } from "https://esm.sh/v118/langchain@0.0.75/dist/base_language/index.js";
import { Tool } from "https://esm.sh/v118/langchain@0.0.75/dist/tools/index.js";

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
    public readonly enabledPlugins: PluginSetT,
  ) { }

  secrets = new SecretsStore();
}

export class PluginSet implements PluginSetT {
  models = this.aggregateUtils<BaseLanguageModel>("models");
  runtimes = this.aggregateUtils<RuntimeImplementation>("runtimes");
  tools = this.aggregateUtils<Tool>("tools");

  constructor(
    public readonly plugins: PluginInstance[],
  ) { }

  private aggregateUtils<T, K extends "models" | "runtimes" | "tools" = "models" | "runtimes" | "tools">(key: K): PluginProvision<T> {
    const lookup = new Map<string, PluginInstance>();
    for (const plugin of this.plugins) {
      for (const name of plugin[key].list()) {
        lookup.set(name, plugin);
      }
    }
    const aggregated: PluginProvision<T> = {
      load(name: string): Promise<T> {
        const plugin = lookup.get(name);
        if (!plugin) {
          return fail(`No ${key} with that name found: ${name}`);
        }
        return plugin[key].load(name) as Promise<T>;
      },
      async loadAll(): Promise<T[]> {
        return (await Promise.all(
          Array.from(lookup.values())
            .map((plugin) => plugin[key].loadAll())
        )).flat() as T[];
      },
      list(): string[] {
        return Array.from(lookup.keys());
      },
    };
    return aggregated;
  }
}
