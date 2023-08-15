import { BaseLanguageModel } from "langchain/base_language";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { OpenAI } from "langchain/llms/openai";
import { FeatureDescriptor } from "../../../../types/plugins.d.ts";

const models = {
  // OpenAI models assume `process.env.OPENAI_API_KEY` to be set
  "chatgpt-3.5": {
    description: "OpenAI ChatGPT-3.5 (Turbo)",
    init() {
      return new ChatOpenAI({
        modelName: "gpt-3.5-turbo",
        streaming: true,
      });
    },
  },
  "chatgpt-4": {
    description: "OpenAI ChatGPT-4",
    init() {
      return new ChatOpenAI({
        modelName: "gpt-4",
        streaming: true,
      });
    },
  },
  "gpt-3.5": {
    description: "OpenAI GPT-3.5 (Turbo)",
    init() {
      return new OpenAI({
        modelName: "gpt-3.5-turbo",
        streaming: true,
      });
    },
  },
  "gpt-4": {
    description: "OpenAI GPT-4",
    init() {
      return new OpenAI({
        modelName: "gpt-4",
        streaming: true,
      });
    },
  },
} satisfies Record<string, FeatureDescriptor<BaseLanguageModel>>;

export default models;
