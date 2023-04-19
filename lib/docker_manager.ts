import Docker from "https://deno.land/x/denocker@v0.2.1/index.ts";

const actionsContainerName = "rungpt-actions";
const actionsContainerPort = 8080;
const actionsMountTarget = "/actions";

const docker = new Docker("/var/run/docker.sock");

export class ActionContainer {
  constructor(
    public readonly containerId: string,
    public readonly actionPath: string,
    public readonly hostname: string,
    public readonly port: number,
  ) {}

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

  async waitFor(): Promise<void> {
    await docker.containers.wait(this.containerId);
  }

  // deno-lint-ignore ban-types
  async invokeAction<Params extends {}>(action: string, params: Params): Promise<Response> {
    const response = await fetch(`http://${this.hostname}:${this.port}/action/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Failed to invoke action '${action}': ${response.statusText}`);
    }

    return response;
  }
}

export async function createActionContainer(
  image: string,
  actionPath: string,
): Promise<ActionContainer> {
  const name = actionsContainerName;
  const container = await docker.containers.create(name, {
    Image: image,
    Env: [
      `PORT=${JSON.stringify(actionsContainerPort)}`,
    ],
    HostConfig: {
      Binds: [`${actionPath}:${actionsMountTarget}`],
      RestartPolicy: {
        Name: "on-failure",
      },
    // deno-lint-ignore no-explicit-any
    } as any,
  });

  if (!container.Id) {
    throw new Error(`Failed to create actions container '${name}' using image '${image}' with mount point '${actionPath}'`);
  }

  return new ActionContainer(container.Id, actionPath, actionsContainerName, actionsContainerPort);
}

export async function getRunningActionContainer(): Promise<ActionContainer | null> {
  const containers = await docker.containers.list({ all: true });
  const container = containers.find((c) => (c.Names ?? []).includes(`/${actionsContainerName}`));

  if (!container) {
    return null;
  }
  if (!container.Id) {
    throw new Error(`Failed to retrieve actions container '${actionsContainerName}'`);
  }

  return new ActionContainer(container.Id, actionsMountTarget, actionsContainerName, actionsContainerPort);
}
