import { fail } from "std/testing/asserts.ts";
import Docker from "https://deno.land/x/denocker@v0.2.1/index.ts";
import { HostConfig } from "https://deno.land/x/denocker@v0.2.1/lib/types/container/container.ts";
import { ListContainerResponse } from "https://deno.land/x/denocker@v0.2.1/lib/types/container/mod.ts";

type ActionProcess = Deno.Process<{ cmd: string[], stderr: "piped", stdin: "piped", stdout: "piped" }>;

const actionsContainerName = "rungpt-actions";
const appUrl = new URL(import.meta.url);
const appPath = await Deno.realPath(new URL("../../../..", appUrl).pathname);
const sharedDir = `${appPath}/shared`;

export class ActionController {
  constructor(public readonly container: ActionContainer) {}

  protected invokeHostShell<T>(cmd: string[], callback: (process: ActionProcess) => T): T {
    let callbackIsAsync = false;

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

  invokeShell<T>(script: string, callback: (process: ActionProcess) => T): T {
    const cmd = [
      "docker",
      "exec",
      this.container.containerId,
      "bash",
      "-c",
      script.trim() + "\nexit $?\n",
    ];

    return this.invokeHostShell(cmd, callback);
  }

  writeFile(filePath: string, content: Uint8Array): void {
    const cmd = [
      "docker",
      "exec",
      this.container.containerId,
      "bash",
      "-c",
      `cat > ${JSON.stringify(filePath)}\n`,
    ];

    return this.invokeHostShell(cmd, (process) => {
      process.stdin.write(content);
    });
  }
}

export class ActionContainer {
  constructor(
    protected readonly docker: Docker,
    public readonly containerId: string,
  ) {}

  public readonly actions = new ActionController(this);

  async remove(): Promise<void> {
    await this.docker.containers.rm(this.containerId);
  }

  async running(): Promise<boolean> {
    const containers = await this.docker.containers.list({ all: true });
    const container = containers.find((c) => c.Id === this.containerId);

    return container?.State === "running";
  }

  async start(): Promise<void> {
    await this.docker.containers.start(this.containerId);
  }

  async stop(): Promise<void> {
    await this.docker.containers.stop(this.containerId);
  }
}

let dockerCached: Docker | null = null;

function getDockerInstance() {
  if (dockerCached) {
    return dockerCached;
  }

  const dockerSocket = tryFiles([
    `/var/run/docker.sock`,
    `${Deno.env.get("HOME")}/.docker/run/docker.sock`,
  ]);
  const docker = dockerCached = new Docker(dockerSocket);
  return docker;
}

async function createActionContainer(
  image: string,
  hostConfig?: HostConfig & { Binds?: `${string}:${string}`[] },
): Promise<ActionContainer> {
  const name = actionsContainerName;
  const docker = getDockerInstance();

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

  if (!container.Id && !container.message?.includes("is already in use by container")) {
    throw new Error(`Failed to create actions container '${name}' using image '${image}': ${container.message}`);
  }

  return (await getExistingActionContainer()) || fail(`Failed to retrieve newly created actions container '${name}' with ID '${container.Id}'`);
}

async function getExistingActionContainer(): Promise<ActionContainer | null> {
  let containers: ListContainerResponse[];
  let docker: Docker;

  try {
    docker = getDockerInstance();
    containers = await docker.containers.list({ all: true });
  } catch (error) {
    error.message = `Docker error: ${error.message}`;
    throw error;
  }

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

  const actionContainer = new ActionContainer(docker, container.Id);

  if (container.State !== "running") {
    await actionContainer.start();
  }

  return actionContainer;
}

export async function getContainer() {
  const dockerImage = Deno.env.get("RUNGPT_DOCKER_IMAGE") || "rungpt_actions:latest";
  const container = await getExistingActionContainer()
    ?? await createActionContainer(dockerImage, {
      Binds: [`${sharedDir}:/shared`],
    });
  return container;
}

function tryFiles(files: string[]): string {
  for (const file of files) {
    try {
      Deno.statSync(file);
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
