import { FeatureDescriptor } from "../../../../types/plugins.d.ts";
import { ActionContainer, getContainer } from "../lib/docker_manager.ts";
import { DockerTool } from "../lib/tool.ts";

class FileWriterTool extends DockerTool {
  public readonly name = "docker_write_file";
  public readonly description = "Write to a file in the filesystem of the docker container. The input to this tool should be '$PATH::$CONTENT'.";

  private container: ActionContainer | null = null;

  get lc_namespace() {
    return ["rungpt", "docker", this.name];
  }

  public async _call(input: string): Promise<string> {
    const [filePath, content] = input.split("::");
    const bytes = new TextEncoder().encode(content);

    const container = this.container = this.container || await getContainer();
    container.actions.writeFile(filePath, bytes);

    return Promise.resolve(`Wrote ${bytes.byteLength} bytes to ${filePath}`);
  }
}

const descriptor: FeatureDescriptor<DockerTool> = {
  description: "Write files in docker container",
  init: () => new FileWriterTool(),
};

export default descriptor;
