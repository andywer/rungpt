import Docker from "https://deno.land/x/denocker@v0.2.1/index.ts";
import { readableStreamFromIterable } from "https://deno.land/std@0.184.0/streams/mod.ts";
import { ActionMetadata } from "./actions.ts";

type ActionProcess = Deno.Process<{ cmd: string[], stderr: "piped", stdin: "piped", stdout: "piped" }>;
type ActionProcessHandler<T> = (process: ActionProcess) => Promise<T> | T;

const actionsContainerName = "rungpt-actions";
const actionsMountTarget = "/actions/installed";

const dockerSocket = await tryFiles([
  `/var/run/docker.sock`,
  `${Deno.env.get("HOME")}/.docker/run/docker.sock`,
]);
const docker = new Docker(dockerSocket);

async function readStreamToString(stream: ReadableStream) {
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();

  let read: ReadableStreamDefaultReadResult<Uint8Array>;
  let result = "";

  while ((read = await reader.read()) && !read.done) {
    const chunk = decoder.decode(read.value);
    result += chunk;
  }

  // Return the result string
  return result;
}

function stringToReadableStream(str: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(str));
      controller.close();
    },
  });
}

export class ActionController {
  constructor(public readonly container: ActionContainer) {}

  private async invoke<T>(action: string[], input: ReadableStream, handler: ActionProcessHandler<T>): Promise<T> {
    const cmd = [
      "docker",
      "exec",
      this.container.containerId,
      "/app/docker/action.sh",
      ...action,
    ];

    const process = Deno.run({
      cmd,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    try {
      input.pipeTo(process.stdin.writable);
      return await handler(process);
    } finally {
      process.close();
    }
  }

  invokeAction<T, Params extends { _?: string[] }>(action: string, params: Params, handler: ActionProcessHandler<T>): Promise<T> {
    const input = readableStreamFromIterable([]);
    const paramList: string[] = [
      ...(params._ ?? []),
      ...Object.entries(params)
        .filter(([param]) => param !== "_")
        .map(([param, value]) => `${param}=${value}`),
    ];

    return this.invoke(["invoke", action, ...paramList], input, async (process) => {
      try {
        const result = await handler(process);
        const status = await process.status();

        if (!status.success) {
          throw new Error(`Failed to invoke action "${action}" (code ${status.code}, signal ${status.signal ?? "-"})`);
        }
        return result;
      } catch(error) {
        const stderrBinary = await process.stderrOutput();
        const stderr = new TextDecoder().decode(stderrBinary);
        if (stderr) {
          error.message += `\nUnread stderr from action "${action}": ${stderr.trim()}`;
        }
        throw error;
      } finally {
        if (!process.stderr.readable.locked) {
          process.stderr.readable.cancel();
        }
        if (!process.stdout.readable.locked) {
          process.stdout.readable.cancel();
        }
      }
    });
  }

  listActions(): Promise<string[]> {
    return this.invoke(["list"], stringToReadableStream(""), async (process: ActionProcess) => {
      const { status, stderr, stdout } = await capture(process);

      if (!status.success) {
        throw new Error(`Failed to list actions (code ${status.code}, signal ${status.signal ?? "-"}): ${stderr.trim() || stdout.trim()}`);
      }

      const actionNames = stdout.split("\n").filter((name) => name.trim().length > 0);
      return actionNames;
    });
  }

  actionMetadata(action: string): Promise<ActionMetadata> {
    return this.invoke(["show", action, "--json"], stringToReadableStream(""), async (process: ActionProcess) => {
      const { status, stderr, stdout } = await capture(process);

      if (!status.success) {
        throw new Error(`Failed to get action metadata of "${action}" (code ${status.code}, signal ${status.signal ?? "-"}): ${stderr.trim() || stdout.trim()}`);
      }

      const metadata = parseJSON(stdout.trim());
      return metadata;
    });
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
  actionsHostPath: string,
): Promise<ActionContainer> {
  const name = actionsContainerName;
  const container = await docker.containers.create(name, {
    Image: image,
    Hostname: name,
    HostConfig: {
      Binds: [`${actionsHostPath}:${actionsMountTarget}`],
      RestartPolicy: {
        Name: "on-failure",
      },
    // deno-lint-ignore no-explicit-any
    } as any,
    StopTimeout: 1,
  });

  if (!container.Id) {
    throw new Error(`Failed to create actions container '${name}' using image '${image}' with mount point '${actionsHostPath}': ${container.message}`);
  }

  return new ActionContainer(container.Id);
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

async function capture(process: ActionProcess): Promise<{ status: Deno.ProcessStatus, stderr: string, stdout: string }> {
  const [stdout, stderr, status] = await Promise.all([
    process.stdout ? readStreamToString(process.stdout.readable) : Promise.resolve(""),
    process.stderr ? readStreamToString(process.stderr.readable) : Promise.resolve(""),
    process.status(),
  ]);

  return { status, stdout, stderr };
}

// deno-lint-ignore no-explicit-any
function parseJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${err.message}\nJSON: ${text}`);
  }
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
