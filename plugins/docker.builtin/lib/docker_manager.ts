import { fail } from "std/testing/asserts.ts";
import Docker from "https://deno.land/x/denocker@v0.2.1/index.ts";
import { HostConfig } from "https://deno.land/x/denocker@v0.2.1/lib/types/container/container.ts";

type ActionProcess = Deno.Process<{ cmd: string[], stderr: "piped", stdin: "piped", stdout: "piped" }>;

const actionsContainerName = "rungpt-actions";

const dockerSocket = await tryFiles([
  `/var/run/docker.sock`,
  `${Deno.env.get("HOME")}/.docker/run/docker.sock`,
]);
const docker = new Docker(dockerSocket);

export class ActionController {
  constructor(public readonly container: ActionContainer) {}

  public invokeShell<T>(script: string, callback: (process: ActionProcess) => T): T {
    let callbackIsAsync = false;

    const cmd = [
      "docker",
      "exec",
      this.container.containerId,
      "bash",
      "-c",
      script.trim() + "\nexit $?\n",
    ];

    const process = Deno.run({
      cmd,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    const cleanUp = () => {
      process.stdin.writable.close();
      process.stdout.readable.cancel();
      process.stderr.readable.cancel();
      process.close();
    };

    try {
      let result = callback(process);
      // deno-lint-ignore no-explicit-any
      if (result && typeof (result as any).then === "function") {
        callbackIsAsync = true;
        // deno-lint-ignore no-explicit-any
        result = (result as unknown as Promise<any>).then(
          (res) => { cleanUp(); return res; },
          (err) => { cleanUp(); throw err; },
        ) as unknown as T;
      }
      return result;
    } finally {
      if (!callbackIsAsync) {
        cleanUp();
      }
    }
  }
}

export class ActionContainer {
  constructor(
    public readonly containerId: string,
  ) {}

  public readonly actions = new ActionController(this);

  async remove(): Promise<void> {
    await docker.containers.rm(this.containerId);
  }

  async running(): Promise<boolean> {
    const containers = await docker.containers.list({ all: true });
    const container = containers.find((c) => c.Id === this.containerId);

    return container?.State === "running";
  }

  async start(): Promise<void> {
    await docker.containers.start(this.containerId);
  }

  async stop(): Promise<void> {
    await docker.containers.stop(this.containerId);
  }
}

export async function createActionContainer(
  image: string,
  hostConfig?: HostConfig & { Binds?: `${string}:${string}`[] },
): Promise<ActionContainer> {
  const name = actionsContainerName;
  const container = await docker.containers.create(name, {
    Image: image,
    Hostname: name,
    HostConfig: {
      RestartPolicy: {
        Name: "on-failure",
      },
      ...hostConfig,
    // deno-lint-ignore no-explicit-any
    } as any,
    StopTimeout: 1,
  });

  if (!container.Id) {
    throw new Error(`Failed to create actions container '${name}' using image '${image}': ${container.message}`);
  }

  return (await getExistingActionContainer()) || fail(`Failed to retrieve newly created actions container '${name}' with ID '${container.Id}'`);
}

export async function getExistingActionContainer(): Promise<ActionContainer | null> {
  const containers = await docker.containers.list({ all: true });
  const container = containers.find((c) => (c.Names ?? []).includes(`/${actionsContainerName}`));

  if (!container) {
    return null;
  }
  if (!container.Id) {
    throw new Error(`Failed to retrieve actions container '${actionsContainerName}'`);
  }
  if (container.State === "exited") {
    await docker.containers.rm(container.Id);
    return null;
  }

  const actionContainer = new ActionContainer(container.Id);

  if (container.State !== "running") {
    await actionContainer.start();
  }

  return actionContainer;
}

async function tryFiles(files: string[]): Promise<string> {
  for (const file of files) {
    try {
      await Deno.stat(file);
      return file;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to find a file at any of the following locations: ${files.join(", ")}`);
}
