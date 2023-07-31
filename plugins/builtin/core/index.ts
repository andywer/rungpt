import { Plugin, PluginMetadata, PluginProvisions } from "../../../types/plugins.d.ts";
import { createChatChain } from "./chains/index.ts";
import models from "./models/index.ts";

export default class DockerPlugin implements Plugin {
  constructor(
    public readonly metadata: PluginMetadata,
  ) {}

  init (provide: PluginProvisions) {
    provide.features.chain("chat", createChatChain);

    for (const [id, model] of Object.entries(models)) {
      provide.features.model(id, model);
    }
  }
}
