import * as path from "https://deno.land/std@0.184.0/path/mod.ts";
import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { BaseLanguageModel } from "https://esm.sh/v118/langchain@0.0.67/base_language.js";
import { Tool } from "https://esm.sh/v118/langchain@0.0.67/tools.js";
import { PluginInstance, SessionController } from "../types/plugins.d.ts";
import { PluginContext } from "./plugins.ts";

interface Initializer<T> {
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
    const [controllers, models, tools] = await Promise.all([
      this.loadPluginControllers(pluginPath, context),
      this.loadPluginModels(pluginPath, context),
      this.loadPluginTools(pluginPath, context),
    ]);
    const plugin: PluginInstance = {
      metadata: metadata.default,
      controllers,
      models,
      tools,
    };
    this.events.emit("plugin/loaded", plugin);
    return plugin;
  }

  private loadPluginControllers(pluginPath: string, context: PluginContext): Promise<PluginInstance["controllers"]> {
    return this.loadPluginModules<SessionController>(pluginPath, "controllers", context);
  }

  private loadPluginModels(pluginPath: string, context: PluginContext): Promise<PluginInstance["models"]> {
    return this.loadPluginModules<BaseLanguageModel>(pluginPath, "models", context);
  }

  private async loadPluginTools(pluginPath: string, context: PluginContext): Promise<PluginInstance["tools"]> {
    const loaded = await this.loadPluginModules<Tool>(pluginPath, "tools", context);
    const validate = (tool: Tool, name: string) => {
      try {
        if (!tool.name) throw new Error(`Tool name is required`);
        if (!tool.description) throw new Error(`Tool description is required`);
      } catch (err) {
        throw new Error(`Invalid tool "${name}": ${err.message}`);
      }
    };
    loaded.forEach(validate);
    return loaded;
  }

  private async loadPluginModules<T>(
    pluginPath: string,
    subdirName: string,
    context: PluginContext,
  ): Promise<Map<string, T>> {
    const modules = new Map<string, T>();
    const modulesPath = path.join(pluginPath, subdirName);

    try {
      await Deno.stat(modulesPath);
    } catch {
      return modules;
    }

    for await (const dirEntry of Deno.readDir(modulesPath)) {
      if (dirEntry.isFile && dirEntry.name.match(/\.(js|ts)$/i) && !dirEntry.name.match(/^[\._]/)) {
        const modPath = path.join(modulesPath, dirEntry.name);
        const name = dirEntry.name.replace(/\.(js|ts)$/i, "");

        try {
          const stat = await Deno.stat(modPath);
          if (stat.isFile) {
            const mod = await import(modPath) as { default: Initializer<T> };
            try {
              const loaded = await mod.default(context);
              modules.set(name, loaded);
            } catch (err) {
              throw new Error(`Failed to load ${modPath}: ${err.stack || err.message}\n`);
            }
          }
        } catch {
          continue;
        }

        if (!modules.has(name)) {
          throw new Error(`No default export in ${modPath}`);
        }
      }
    }

    return modules;
  }
}
