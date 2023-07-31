import { Tool } from "langchain/tools";
import { ActionContainer, getContainer } from "../lib/docker_manager.ts";

class FileWriterTool extends Tool {
  public readonly name = "docker_write_file";
  public readonly description = "Write to a file in the filesystem of the docker container. The input to this tool should be '$PATH::$CONTENT'.";

  private container: ActionContainer | null = null;

  public async _call(input: string): Promise<string> {
    const [filePath, content] = input.split("::");
    const bytes = new TextEncoder().encode(content);

    const container = this.container = this.container || await getContainer();
    container.actions.writeFile(filePath, bytes);

    return Promise.resolve(`Wrote ${bytes.byteLength} bytes to ${filePath}`);
  }
}

export default FileWriterTool;
