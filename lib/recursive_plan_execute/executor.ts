import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts";
import { CallbackManager } from "https://esm.sh/v118/langchain@0.0.75/callbacks";
import { BaseChain } from "https://esm.sh/v118/langchain@0.0.75/chains";
import { PlanStep } from "./plan.ts";
import { shorten } from "./util.ts";

export interface StepExecutor<Result> {
  execute(step: PlanStep, runManager?: CallbackManager): Promise<Result>;
}

export type LLMExecutorInput = {
  /// Summary of sibling steps, higher-order steps and their siblings.
  step_context: string;

  step_no: string;

  step_task: string;
};

export class LLMExecutor implements StepExecutor<string> {
  private debugContext = debug("rungpt:rpe:executor:context");
  private debugExecution = debug("rungpt:rpe:executor:execute");

  constructor(
    private readonly llm: BaseChain,
  ) {}

  async execute(step: PlanStep, runManager?: CallbackManager): Promise<string> {
    this.debugExecution(`Executing step ${step.stepNo.toString()}`);

    const stepContext = step.getContext();
    this.debugContext(`Context for step ${step.stepNo.toString()}:`, stepContext);

    const output = await this.llm.call({
      step_context: stepContext,
      step_no: step.stepNo.toString(),
      step_task: `${step.title}\n\n${step.description}`,
    }, runManager);

    const outputKeys = Object.keys(output);
    if (outputKeys.length !== 1) {
      throw new Error(`Invalid plan steps returned by language model: Expected exactly one key in the output object.\nGot: ${shorten(JSON.stringify(output), 100)}`);
    }

    this.debugExecution(`Step ${step.stepNo.toString()} executed. Output:`, output);
    return output[outputKeys[0]];
  }
}
