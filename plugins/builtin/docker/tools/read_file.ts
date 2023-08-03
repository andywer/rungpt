import { ActionContainer, getContainer } from "../lib/docker_manager.ts";
import { DockerTool } from "../lib/tool.ts";

class FileReaderTool extends DockerTool {
  public readonly name = "docker_read_file";
  public readonly description = "Read the content of a single file from the filesystem of the docker container. The input to this tool should be the file path.";

  private container: ActionContainer | null = null;

  public async _call(filePath: string): Promise<string> {
    const container = this.container = this.container || await getContainer();

    return container.actions.invokeShell(`cat ${JSON.stringify(filePath)}`, async (process) => {
      const output = await process.output();
      const status = await process.status();

      if (status.code !== 0) {
        throw new Error(`Failed to read file "${filePath}"`);
      }
      return new TextDecoder().decode(output);
    });
  }
}

export default FileReaderTool;
