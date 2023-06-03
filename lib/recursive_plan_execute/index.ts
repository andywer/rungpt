import { AgentExecutor, ChatAgent } from "https://esm.sh/v118/langchain@0.0.75/agents";
import { BaseLanguageModel } from "https://esm.sh/v118/langchain@0.0.75/base_language";
import { CallbackManager, CallbackManagerForChainRun } from "https://esm.sh/v118/langchain@0.0.75/callbacks";
import { BaseChain, ChainInputs } from "https://esm.sh/v118/langchain@0.0.75/chains";
import { BaseLLM } from "https://esm.sh/v118/langchain@0.0.75/llms";
import { ChainValues } from "https://esm.sh/v118/langchain@0.0.75/schema";
import { Tool } from "https://esm.sh/v118/langchain@0.0.75/tools";
import { LLMExecutor, StepExecutor } from "./executor.ts";
import { DefaultPlanningOutputParser, LLMPlanner, Planner } from "./planner.ts";
import { STEP_EXECUTOR_WORK_MESSAGE_TEMPLATE } from "./prompt.ts";
import { PlanStep } from "./plan.ts";

export interface RecursivePlanExecuteInput extends ChainInputs {
  inputKey: string;
  outputKey: string;
  planner: Planner;
  stepExecutor: StepExecutor<string>;
}

export class RecursivePlanExecuteAgentExecutor extends BaseChain {
  public readonly inputKeys: string[];
  public readonly outputKeys: string[];

  private readonly planner: Planner;
  private readonly stepExecutor: StepExecutor<string>;

  constructor(input: RecursivePlanExecuteInput) {
    super(input);
    this.stepExecutor = input.stepExecutor;
    this.planner = input.planner;
    this.inputKeys = [input.inputKey];
    this.outputKeys = [input.outputKey];
  }

  async _call(
    inputs: ChainValues,
    runManager?: CallbackManagerForChainRun
  ): Promise<ChainValues> {
    let result = "";
    const input = inputs[this.inputKeys[0]];
    const plan = await this.planner.plan(input, runManager?.getChild());

    for (const step of plan.rootSteps) {
      result = await this.executeRecursively(step, runManager?.getChild());
    }
    return { [this.outputKeys[0]]: result };
  }

  private async executeRecursively(step: PlanStep, runManager?: CallbackManager): Promise<string> {
    if (!step.finalized) {
      await this.planner.refineStep(step, runManager);
    }

    if (step.substeps.length > 0) {
      const results: string[] = [];
      for (const substep of step.substeps) {
        results.push(
          await this.executeRecursively(substep, runManager)
        );
      }
      // TODO: Summarize results using LLM
      return results.join("\n\n");
    } else {
      return this.stepExecutor.execute(step, runManager);
    }
  }

  _chainType() {
    return "agent_executor" as const;
  }

  static fromToolsAndLLMs({ executionLLM, humanMessageTemplate, planningLLM, tools }: {
    executionLLM: BaseLanguageModel,
    humanMessageTemplate?: string,
    planningLLM: BaseLLM,
    tools: Tool[],
  }) {
    const maxPlanSteps = 8;
    const planner = new LLMPlanner(
      planningLLM,
      new DefaultPlanningOutputParser(maxPlanSteps),
      tools,
      maxPlanSteps,
    );
    const execAgent = ChatAgent.fromLLMAndTools(executionLLM, tools, {
      humanMessageTemplate: humanMessageTemplate || STEP_EXECUTOR_WORK_MESSAGE_TEMPLATE,
    });
    const stepExecutor = new LLMExecutor(
      AgentExecutor.fromAgentAndTools({
        agent: execAgent,
        tools,
      }),
    );
    return new RecursivePlanExecuteAgentExecutor({
      inputKey: "input",
      outputKey: "output",
      planner,
      stepExecutor,
    });
  }
}
