import * as path from "https://deno.land/std@0.184.0/path/mod.ts";
import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { PluginInstance, PluginProvision, RuntimeImplementation } from "../types/plugins.d.ts";
import { PluginContext } from "./plugins.ts";
import { BaseLanguageModel } from "https://esm.sh/v118/langchain@0.0.67/base_language.js";
import { Tool } from "https://esm.sh/v118/langchain@0.0.67/tools.js";

export interface Initializer<T> {
  (ctx: PluginContext): Promise<T> | T;
}

export type PluginEvents = {
  "plugin/discovered": [string];
  "plugin/loaded": [PluginInstance];
};

export class PluginLoader {
  public readonly events = new EventEmitter<PluginEvents>();

  constructor(
    private readonly pluginsPath: string,
  ) {}

  async* loadPlugins(context: PluginContext): AsyncIterable<PluginInstance> {
    for await (const dirEntry of Deno.readDir(this.pluginsPath)) {
      if (dirEntry.isDirectory && !dirEntry.name.match(/^[\._]/)) {
        try {
          await Deno.stat(`${this.pluginsPath}/${dirEntry.name}/manifest.json`);
        } catch {
          continue;
        }
        const pluginPath = `${this.pluginsPath}/${dirEntry.name}`;
        this.events.emit("plugin/discovered", pluginPath);

        yield this.loadPlugin(pluginPath, context);
      }
    }
  }

  async loadPlugin(pluginPath: string, context: PluginContext): Promise<PluginInstance> {
    const metadata = await import(`${pluginPath}/manifest.json`, { assert: { type: "json" } });
    const [models, runtimes, tools] = await Promise.all([
      this.loadPluginModels(pluginPath, context),
      this.loadPluginRuntimes(pluginPath, context),
      this.loadPluginTools(pluginPath, context),
    ]);
    const plugin: PluginInstance = {
      metadata: metadata.default,
      models,
      runtimes,
      tools,
    };
    this.events.emit("plugin/loaded", plugin);
    return plugin;
  }

  private async loadPluginModels(pluginPath: string, context: PluginContext): Promise<PluginInstance["models"]> {
    const initializers = await this.loadPluginModules<BaseLanguageModel>(pluginPath, "models", "model.ts");
    return new Provision(initializers, context, () => void(0));
  }

  private async loadPluginRuntimes(pluginPath: string, context: PluginContext): Promise<PluginInstance["runtimes"]> {
    const initializers = await this.loadPluginModules<RuntimeImplementation>(pluginPath, "runtimes", "runtime.ts");
    return new Provision(initializers, context, () => void(0));
  }

  private async loadPluginTools(pluginPath: string, context: PluginContext): Promise<PluginInstance["tools"]> {
    const initializers = await this.loadPluginModules<Tool>(pluginPath, "tools", "tool.ts");
    const validate = (tool: Tool, name: string) => {
      try {
        if (!tool.name) throw new Error(`Tool name is required`);
        if (!tool.description) throw new Error(`Tool description is required`);
      } catch (err) {
        throw new Error(`Invalid tool "${name}": ${err.message}`);
      }
    };
    return new Provision(initializers, context, validate);
  }

  private async loadPluginModules<T>
    (pluginPath: string, subdirName: string, moduleName: string): Promise<Map<string, Initializer<T>>>
  {
    const modules = new Map<string, Initializer<T>>();
    const modulesPath = path.join(pluginPath, subdirName);

    try {
      await Deno.stat(modulesPath);
    } catch {
      return modules;
    }

    for await (const dirEntry of Deno.readDir(modulesPath)) {
      if (dirEntry.isDirectory) {
        const modPath = path.join(modulesPath, dirEntry.name, moduleName);
        try {
          const stat = await Deno.stat(modPath);
          if (stat.isFile) {
            const mod = await import(modPath) as { default: Initializer<T> };
            modules.set(dirEntry.name, mod.default);
          }
        } catch {
          continue;
        }

        if (!modules.has(dirEntry.name)) {
          throw new Error(`No default export in ${modPath}`);
        }
      }
    }

    return modules;
  }
}

class Provision<T> implements PluginProvision<T> {
  constructor(
    private initializers: Map<string, (ctx: PluginContext) => Promise<T> | T>,
    private context: PluginContext,
    private validate: (loaded: T, name: string) => void,
  ) {}

  async load(name: string): Promise<T> {
    const initializer = this.initializers.get(name);
    if (!initializer) {
      throw new Error(`No initializer for ${name}`);
    }
    const loaded = await initializer(this.context);
    this.validate(loaded, name);
    return loaded;
  }

  async loadAll(): Promise<T[]> {
    return await Promise.all(Array.from(this.initializers.values())
      .map((initializer) => initializer(this.context)));
  }

  list(): string[] {
    return Array.from(this.initializers.keys());
  }
}
