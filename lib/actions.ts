export interface ActionMetadata {
  schema_version: string;
  name_for_human: string;
  name_for_model: string;
  description_for_human: string;
  description_for_model: string;
  logo_url: string;
}

export async function installAction(actionsDir: string, repo: string, version: string): Promise<string> {
  const [user, repoName] = repo.split("/");
  const installUrl = `https://github.com/${user}/${repoName}.git`;

  const targetDir = `${actionsDir}/${user}_${repoName}`;

  await Deno.mkdir(actionsDir, { recursive: true });
  const status = await Deno.run({
    cmd: ["git", "-c", "advice.detachedHead=false", "clone", "--branch", version, "--depth", "1", installUrl, targetDir],
  }).status();

  if (!status.success) {
    throw new Error(`Failed to install action '${repo}'`);
  }
  return targetDir;
}

export async function getActionMetadata(actionPath: string): Promise<ActionMetadata> {
  const metadataPath = `${actionPath}/manifest.json`;

  try {
    const metadataContent = await Deno.readTextFile(metadataPath);
    const metadata = JSON.parse(metadataContent) as ActionMetadata;

    validateActionMetadata(metadata);

    return metadata;
  } catch (error) {
    throw new Error(`Failed to retrieve or validate action metadata at '${metadataPath}': ${error.message}`);
  }
}

function validateActionMetadata(metadata: any): metadata is ActionMetadata {
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

  // Add additional validation checks here, if necessary

  return true;
}

export async function getInstalledActions(actionsDir: string): Promise<string[]> {
  try {
    const entries = Deno.readDir(actionsDir);
    const actionDirs: string[] = [];

    for await (const entry of entries) {
      if (entry.isDirectory && !entry.name.startsWith(".")) {
        const actionPath = `${actionsDir}/${entry.name}`;
        actionDirs.push(actionPath);
      }
    }

    return actionDirs;
  } catch (error) {
    throw new Error(`Failed to retrieve installed actions from '${actionsDir}': ${error.message}`);
  }
}
