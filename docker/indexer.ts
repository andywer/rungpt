import { getInstalledActions, getActionMetadata } from "./actions.ts";

const actionsDir = Deno.env.has("ACTIONS_PATH") ? Deno.env.get("ACTIONS_PATH")! : "/actions";
const indexDir = `${actionsDir}/index`;
const installedDir = `${actionsDir}/installed`;

async function findActionPath(actionName: string, installedActionPaths: string[]): Promise<string> {
  for (const actionPath of installedActionPaths) {
    const metadata = await getActionMetadata(actionPath);
    if (metadata.name_for_model === actionName) {
      return actionPath;
    }
  }

  throw new Error(`Action '${actionName}' not found`);
}

async function updateIndex(dirPath: string, installedActionPaths: string[]) {
  let actionNames: string[] = [];

  for (const actionPath of installedActionPaths) {
    const metadata = await getActionMetadata(actionPath);
    actionNames.push(metadata.name_for_model);
  }

  const indexed = Deno.readDir(dirPath);

  for await (const entry of indexed) {
    if (entry.isSymlink && !actionNames.includes(entry.name)) {
      // Symlink exists but action is no longer installed
      console.log(`Removing action symlink '${entry.name}' from index`);
      await Deno.remove(`${dirPath}/${entry.name}`);
    } else if (entry.isSymlink && actionNames.includes(entry.name)) {
      // Symlink exists and action is still installed
      actionNames = actionNames.filter((name) => name !== entry.name);
    }
  }

  for (const actionName of actionNames) {
    const targetDir = await findActionPath(actionName, installedActionPaths);
    console.log(`Adding action symlink '${actionName}' to index`);
    await Deno.symlink(targetDir, `${dirPath}/${actionName}`);
  }
}

async function main() {
  console.log(`Indexer running. Watching for changes in '${installedDir}'...`);

  // Cannot use Deno.watchFs() because it does not work on M1 Macs
  while (true) {
    const actionPaths = await getInstalledActions(installedDir);
    await updateIndex(indexDir, actionPaths);

    await Deno.writeFile(`${indexDir}/.heartbeat`, new Uint8Array());
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

await main();
