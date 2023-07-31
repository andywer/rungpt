import { ChatOpenAI } from "langchain/chat_models/openai";
import { OpenAI } from "langchain/llms/openai";

const models = {
  // OpenAI models assume `process.env.OPENAI_API_KEY` to be set
  "chatgpt-3.5": () => {
    return new ChatOpenAI({
      modelName: "gpt-3.5-turbo",
      streaming: true,
    });
  },
  "chatgpt-4": () => {
    return new ChatOpenAI({
      modelName: "gpt-4",
      streaming: true,
    });
  },
  "gpt-3.5": () => {
    return new OpenAI({
      modelName: "gpt-3.5-turbo",
      streaming: true,
    });
  },
  "gpt-4": () => {
    return new OpenAI({
      modelName: "gpt-4",
      streaming: true,
    });
  },
};

export default models;
