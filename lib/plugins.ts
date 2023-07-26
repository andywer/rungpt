import { fail } from "std/testing/asserts.ts";
import { PluginMetadata } from "../types/plugins.d.ts";

export async function installPlugin(pluginsDir: string, repo: string, version: string): Promise<string> {
  const [user, repoName] = repo.split("/");
  const installUrl = `https://github.com/${user}/${repoName}.git`;

  const targetDir = `${pluginsDir}/${user}_${repoName}`;

  await Deno.mkdir(pluginsDir, { recursive: true });
  const status = await Deno.run({
    cmd: ["git", "-c", "advice.detachedHead=false", "clone", "--branch", version, "--depth", "1", installUrl, targetDir],
  }).status();

  if (!status.success) {
    throw new Error(`Failed to install plugin '${repo}'`);
  }
  return targetDir;
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

// deno-lint-ignore no-explicit-any
function validatePluginMetadata(metadata: any): metadata is PluginMetadata {
  const requiredProperties: { [key: string]: string } = {
    schema_version: "string",
    name_for_human: "string",
    name_for_model: "string",
    description_for_human: "string",
  };

  for (const [property, type] of Object.entries(requiredProperties)) {
    // deno-lint-ignore valid-typeof
    if (typeof metadata[property] !== type) {
      throw new Error(`Invalid metadata: '${property}' is missing or not a ${type}`);
    }
  }

  // Add additional validation checks here, if necessary

  return true;
}

export async function getInstalledActions(installedDir: string): Promise<string[]> {
  try {
    const entries = Deno.readDir(installedDir);
    const pluginDirs: string[] = [];

    for await (const entry of entries) {
      if (entry.isDirectory && !entry.name.startsWith(".")) {
        const pluginPath = `${installedDir}/${entry.name}`;
        pluginDirs.push(pluginPath);
      }
    }

    return pluginDirs;
  } catch (error) {
    throw new Error(`Failed to retrieve installed plugins from '${installedDir}': ${error.message}`);
  }
}
