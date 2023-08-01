import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { BufferMemory, ChatMessageHistory } from "langchain/memory";
import { SessionState, ToolID } from "../../../../types/app.d.ts";
import { FeatureRegistry } from "../../../../types/plugins.d.ts";
import { toLangchainMessage } from "../lib/messages.ts";

export const createChatChain = async (features: FeatureRegistry, session: SessionState) => {
  const { config, messages } = session;
  const allToolNames = Array.from(features.tools.keys());
  const desiredToolNames = config.tools.includes("*") ? allToolNames : config.tools as ToolID[];

  const model = await features.models.get(config.model)();
  const tools = await Promise.all(
    desiredToolNames.map((toolName) => features.tools.get(toolName)())
  );

  const memory = new BufferMemory({
    chatHistory: new ChatMessageHistory(
      messages.map(message => toLangchainMessage(message))
    ),
    memoryKey: "chat_history",
    returnMessages: true,
  });

  const executor = await initializeAgentExecutorWithOptions(tools, model, {
    agentType: "chat-conversational-react-description",
    memory,
  });

  return executor;
};
