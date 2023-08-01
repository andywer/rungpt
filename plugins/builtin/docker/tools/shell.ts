import { ActionContainer, getContainer } from "../lib/docker_manager.ts";
import { streamExecutedCommand } from "../lib/streams.ts";
import { DockerTool } from "../lib/tool.ts";

class ShellTool extends DockerTool {
  public readonly name = "docker_shell";
  public readonly description = "Useful to execute linux shell commands with access to the filesystem and the internet in the docker container. The input to this tool should be a valid shell command.";

  private container: ActionContainer | null = null;

  get lc_namespace() {
    return ["rungpt", "docker", this.name];
  }

  public async _call(command: string): Promise<string> {
    const container = this.container = this.container || await getContainer();

    return container.actions.invokeShell(command, async (process) => {
      let output = "";
      let read: ReadableStreamDefaultReadResult<string>;
      const reader = streamExecutedCommand(process).getReader();

      while (!(read = await reader.read()).done) {
        output += read.value;
      }
      return output;
    });
  }
}

export default ShellTool;
