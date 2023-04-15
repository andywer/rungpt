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

export async function installPlugin(pluginsDir: string, repo: string, version?: string): Promise<void> {
  const [user, repoName] = repo.split("/");
  const versionString = version ? `#${version}` : "";
  const installUrl = `https://github.com/${user}/${repoName}.git${versionString}`;

  const targetDir = `${pluginsDir}/${user}_${repoName}${version ? `_${version}` : ""}`;

  try {
    await Deno.mkdir(pluginsDir, { recursive: true });
    await Deno.run({
      cmd: ["git", "clone", "--depth", "1", installUrl, targetDir],
    }).status();
    console.log(`Plugin '${repo}'${version ? `@${version}` : ""} installed in '${targetDir}'`);
  } catch (error) {
    console.error(`Failed to install plugin '${repo}': ${error.message}`);
  }
}

export async function getPluginMetadata(pluginPath: string): Promise<PluginMetadata | null> {
  const metadataPath = `${pluginPath}/manifest.json`;

  try {
    const metadataContent = await Deno.readTextFile(metadataPath);
    const metadata = JSON.parse(metadataContent) as PluginMetadata;

    validatePluginMetadata(metadata);

    return metadata;
  } catch (error) {
    console.error(`Failed to retrieve or validate plugin metadata at '${metadataPath}': ${error.message}`);
    return null;
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
