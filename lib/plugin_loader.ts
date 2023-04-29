import * as path from "https://deno.land/std@0.184.0/path/mod.ts";
import { EventEmitter } from "https://deno.land/x/event@2.0.1/mod.ts";
import { PluginInstance, RuntimeImplementation, TagImplementation } from "../plugins.d.ts";

export type PluginEvents = {
  "plugin/discovered": [string];
  "plugin/loaded": [PluginInstance];
};

export class PluginLoader {
  public readonly events = new EventEmitter<PluginEvents>();

  constructor(
    private readonly pluginsPath: string,
  ) {}

  async* loadPlugins(): AsyncIterable<PluginInstance> {
    for await (const dirEntry of Deno.readDir(this.pluginsPath)) {
      if (dirEntry.isDirectory && !dirEntry.name.match(/^[\._]/)) {
        try {
          await Deno.stat(`${this.pluginsPath}/${dirEntry.name}/manifest.json`);
        } catch {
          continue;
        }
        const pluginPath = `${this.pluginsPath}/${dirEntry.name}`;
        this.events.emit("plugin/discovered", pluginPath);

        yield this.loadPlugin(pluginPath);
      }
    }
  }

  async loadPlugin(pluginPath: string): Promise<PluginInstance> {
    const metadata = await import(`${pluginPath}/manifest.json`, { assert: { type: "json" } });
    const [runtimes, tags] = await Promise.all([
      this.loadPluginRuntimes(pluginPath),
      this.loadPluginTags(pluginPath),
    ]);
    const plugin: PluginInstance = {
      metadata: metadata.default,
      runtimes,
      tags,
    };
    this.events.emit("plugin/loaded", plugin);
    return plugin;
  }

  private loadPluginRuntimes(pluginPath: string): Promise<PluginInstance["runtimes"]> {
    const validate = (runtime: RuntimeImplementation, runtimePath: string) => {
      if (!runtime.chatCreated && !runtime.userMessageReceived) {
        throw new Error(`No functionality defined in ${runtimePath}`);
      }
    };
    return this.loadPluginModules(pluginPath, "runtimes", "runtime.ts", validate);
  }

  private loadPluginTags(pluginPath: string): Promise<PluginInstance["tags"]> {
    const validate = (tag: TagImplementation, tagPath: string) => {
      if (!tag.metadata) {
        throw new Error(`Missing metadata in ${tagPath}`);
      }
    };
    return this.loadPluginModules(pluginPath, "tags", "tag.ts", validate);
  }

  private async loadPluginModules<T extends RuntimeImplementation | TagImplementation>
    (pluginPath: string, subdirName: string, moduleName: string, validate: (mod: T, modPath: string) => void): Promise<Record<string, T> | undefined>
  {
    const modules: Record<string, T> = {};
    const modulesPath = path.join(pluginPath, subdirName);

    try {
      await Deno.stat(modulesPath);
    } catch {
      return undefined;
    }

    for await (const dirEntry of Deno.readDir(modulesPath)) {
      if (dirEntry.isDirectory) {
        const modPath = path.join(modulesPath, dirEntry.name, moduleName);
        try {
          const stat = await Deno.stat(modPath);
          if (stat.isFile) {
            const mod = await import(modPath) as { default: T };
            modules[dirEntry.name] = mod.default;
          }
        } catch {
          continue;
        }

        if (!modules[dirEntry.name]) {
          throw new Error(`No default export in ${modPath}`);
        }
        validate(modules[dirEntry.name], modPath);
      }
    }

    return modules;
  }
}
