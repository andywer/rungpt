import * as semver from "https://deno.land/x/semver@v1.4.1/mod.ts";

interface PluginMetadata {
  schema_version: string;
  name_for_human: string;
  name_for_model: string;
  description_for_human: string;
  description_for_model: string;
  logo_url: string;
  dependencies: {
    id: string;
    version: string;
  }[];
}

export async function installPlugin(pluginsDir: string, repo: string, version: string): Promise<string> {
  const [user, repoName] = repo.split("/");
  const installUrl = `https://github.com/${user}/${repoName}.git`;

  const normalizedVersion = version.replace(/^v([0-9]+(\.[0-9]+)*)/, (match) => match.substring(1));
  const targetDir = `${pluginsDir}/${user}_${repoName}/${normalizedVersion}`;

  await Deno.mkdir(pluginsDir, { recursive: true });
  const status = await Deno.run({
    cmd: ["git", "-c", "advice.detachedHead=false", "clone", "--branch", version, "--depth", "1", installUrl, targetDir],
  }).status();

  if (!status.success) {
    throw new Error(`Failed to install plugin '${repo}'`);
  }
  return targetDir
}

export async function getPluginMetadata(pluginPath: string): Promise<PluginMetadata> {
  const metadataPath = `${pluginPath}/manifest.json`;

  try {
    const metadataContent = await Deno.readTextFile(metadataPath);
    const metadata = JSON.parse(metadataContent) as PluginMetadata;

    validatePluginMetadata(metadata);

    return metadata;
  } catch (error) {
    throw new Error(`Failed to retrieve or validate plugin metadata at '${metadataPath}': ${error.message}`);
  }
}

function validatePluginMetadata(metadata: any): metadata is PluginMetadata {
  const requiredProperties: { [key: string]: string } = {
    schema_version: "string",
    name_for_human: "string",
    name_for_model: "string",
    description_for_human: "string",
    description_for_model: "string",
    logo_url: "string",
  };

  for (const [property, type] of Object.entries(requiredProperties)) {
    if (typeof metadata[property] !== type) {
      throw new Error(`Invalid metadata: '${property}' is missing or not a ${type}`);
    }
  }

  if (!Array.isArray(metadata.dependencies)) {
    throw new Error("Invalid metadata: 'dependencies' is missing or not an array");
  }

  for (const dep of metadata.dependencies) {
    if (typeof dep.id !== "string") {
      throw new Error("Invalid metadata: 'dependencies.id' is missing or not a string");
    }
    if (typeof dep.version !== "string") {
      throw new Error("Invalid metadata: 'dependencies.version' is missing or not a string");
    }
  }

  // Add additional validation checks here, if necessary

  return true;
}

export class ModuleLoader {
  private cache: Map<string, WebAssembly.Instance>;

  constructor(
    private pluginsDir: string,
  ) {
    this.cache = new Map();
  }

  async loadPlugin(pluginPath: string): Promise<WebAssembly.Instance | null> {
    const metadata = await getPluginMetadata(pluginPath);
    return await this.loadWasmModule(pluginPath, metadata.dependencies);
  }

  async loadWasmModule(pluginPath: string, dependencies: PluginMetadata["dependencies"]): Promise<WebAssembly.Instance | null> {
    const wasmPath = `${pluginPath}/plugin.wasm`;

    try {
      const wasmBytes = await Deno.readFile(wasmPath);
      const wasmModule = await WebAssembly.compile(wasmBytes);

      const importObject = await this.getImportObject(dependencies);
      const wasmInstance = await WebAssembly.instantiate(wasmModule, importObject);

      return wasmInstance;
    } catch (error) {
      console.error(`Failed to load wasm module from '${wasmPath}': ${error.message}`);
      return null;
    }
  }

  async locatePlugin(id: string, versionRange = "latest"): Promise<string> {
    if (versionRange === "latest") {
      versionRange = await this.matchingInstalledPluginVersion(id, versionRange);
    }
    const pluginDir = `${this.pluginsDir}/${id.replace(/\//g, "_")}/${versionRange}`;
    return pluginDir;
  }

  private async getImportObject(dependencies: PluginMetadata["dependencies"]): Promise<Record<string, Record<string, WebAssembly.ImportValue>>> {
    const importObject: Record<string, Record<string, WebAssembly.ImportValue>> = {};

    for (const dep of dependencies) {
      const { id, version } = dep;
      const cacheKey = `${id}@${version}`;

      if (!this.cache.has(cacheKey)) {
        const wasmInstance = await this.loadApiModule(id, version);
        if (wasmInstance) {
          this.cache.set(cacheKey, wasmInstance);
        } else {
          throw new Error(`Failed to load API module '${cacheKey}'`);
        }
      }

      const instance = this.cache.get(cacheKey);
      if (instance) {
        importObject[id] = instance.exports as Record<string, WebAssembly.ImportValue>;
      }
    }

    return importObject;
  }

  private async loadApiModule(id: string, version: string): Promise<WebAssembly.Instance | null> {
    const pluginPath = await this.locatePlugin(id, version);
    const metadata = await getPluginMetadata(pluginPath);
    const module = `${pluginPath}/plugin.wasm`;
    return await this.loadWasmModule(module, metadata.dependencies);
  }

  private async matchingInstalledPluginVersion(id: string, versionRange: string | "latest"): Promise<string> {
    const pluginDir = `${this.pluginsDir}/${id.replace(/\//g, "_")}`;
    const versions = await asyncToArray(Deno.readDir(pluginDir));

    if (versions.length === 0) {
      throw new Error(`No version of plugin '${id}' is installed`);
    }

    if (versionRange === "latest") {
      const latest = versions.sort((a, b) => a.name.localeCompare(b.name)).pop();
      return latest!.name;
    } else {
      const version = versions.find((v) => semver.satisfies(v.name, versionRange));
      if (version) {
        return version.name;
      } else {
        throw new Error(`No version of plugin '${id}' matching '${versionRange}' is installed`);
      }
    }
  }
}

async function asyncToArray<T>(asyncIterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of asyncIterable) {
    result.push(item);
  }
  return result;
}
