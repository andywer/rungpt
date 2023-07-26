import { PluginClass } from "../types/plugins.d.ts";

export class PluginLoader {
  async* discoverPlugins(pluginsPath: string): AsyncIterable<string> {
    for await (const dirEntry of Deno.readDir(pluginsPath)) {
      if (dirEntry.isDirectory && !dirEntry.name.match(/^[\._]/)) {
        try {
          await Deno.stat(`${pluginsPath}/${dirEntry.name}/manifest.json`);
        } catch {
          continue;
        }
        const pluginPath = `${pluginsPath}/${dirEntry.name}`;
        yield pluginPath;
      }
    }
  }

  async loadPlugin(pluginPath: string): Promise<PluginClass> {
    const metadata = (await import(`${pluginPath}/manifest.json`, { assert: { type: "json" } })).default;
    const PluginClass = await this.loadPluginModule<PluginClass>(`${pluginPath}/index`);
    PluginClass.metadata = metadata;
    PluginClass.path = pluginPath;
    return PluginClass;
  }

  private async loadPluginModule<T>(modulePath: string): Promise<T> {
    if (!modulePath.match(/\.(js|json|ts)$/)) {
      let found = false;
      for (const resolvedPath of [`${modulePath}.ts`, `${modulePath}.js`]) {
        try {
          await Deno.stat(resolvedPath);
          modulePath = resolvedPath;
          found = true;
          break;
        } catch {
          continue;
        }
      }
      if (!found) {
        throw new Error(`Plugin module not found: ${modulePath}`);
      }
    }

    try {
      const mod = await import(modulePath) as { default: T };
      return mod.default;
    } catch (err) {
      throw new Error(`Failed to load ${modulePath}: ${err.stack || err.message}\n`);
    }
  }
}
