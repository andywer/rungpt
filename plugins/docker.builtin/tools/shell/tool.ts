import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts";
import { Tool } from "https://esm.sh/v118/langchain@0.0.67/tools";
import { ActionContainer, createActionContainer, getExistingActionContainer } from "../../lib/docker_manager.ts";
import { PluginContext } from "../../../../types/plugins.d.ts";
import { streamExecutedCommand } from "../../lib/streams.ts";

const appUrl = new URL(import.meta.url);
const appPath = await Deno.realPath(new URL("../../../..", appUrl).pathname);
const sharedDir = `${appPath}/shared`;

class ShellTool extends Tool {
  public readonly name = "shell";
  public readonly description = "Useful to execute linux shell commands with access to the filesystem and the internet. The input to this tool should be a valid shell command.";

  private debugInvocation = debug("rungpt:tools:shell:invocation");
  private debugOutput = debug("rungpt:tools:shell:output");

  public constructor(
    private container: ActionContainer,
  ) {
    super();
  }

  public _call(command: string): Promise<string> {
    this.debugInvocation(command);

    return this.container.actions.invokeShell(command, async (process) => {
      let output = "";
      let read: ReadableStreamDefaultReadResult<string>;
      const reader = streamExecutedCommand(process).getReader();

      while (!(read = await reader.read()).done) {
        output += read.value;
      }

      this.debugOutput(output);
      return output;
    });
  }
}

export default async (_context: PluginContext) => {
  const dockerImage = Deno.env.get("RUNGPT_DOCKER_IMAGE") || "rungpt_actions:latest";
  const container = await getExistingActionContainer()
    ?? await createActionContainer(dockerImage, {
      Binds: [`${sharedDir}:/shared`],
    });
  return new ShellTool(container);
};
