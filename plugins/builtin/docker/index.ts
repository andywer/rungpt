import { Plugin, PluginMetadata, PluginProvisions } from "../../../types/plugins.d.ts";
import FileReaderTool from "./tools/read_file.ts";
import ShellTool from "./tools/shell.ts";
import FileWriterTool from "./tools/write_file.ts";

export default class DockerPlugin implements Plugin {
  constructor(
    public readonly metadata: PluginMetadata,
  ) {}

  init (provide: PluginProvisions) {
    provide.features.tool("docker_read_file", FileReaderTool);
    provide.features.tool("docker_shell", ShellTool);
    provide.features.tool("docker_write_file", FileWriterTool);
  }
}
