import { Tool } from "https://esm.sh/v118/langchain@0.0.67/tools";
import { ActionContainer } from "../lib/docker_manager.ts";
import { streamExecutedCommand } from "../lib/stream_transformers.ts";

export class ShellTool extends Tool {
  public readonly name = "shell";
  public readonly description = "Useful to execute linux shell commands with access to the filesystem and the internet. The input to this tool should be a valid shell command.";

  public constructor(
    private container: ActionContainer,
  ) {
    super();
  }

  public _call(command: string): Promise<string> {
    return this.container.actions.invokeShell(command, async (process) => {
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
