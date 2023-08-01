import { Tool } from "langchain/tools";

export abstract class DockerTool extends Tool {
  toJSON() {
    return {
      ...super.toJSON(),
      name: this.name,
      description: this.description,
    };
  }
}
