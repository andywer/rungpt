import * as YAML from "https://deno.land/std@0.187.0/yaml/mod.ts";
import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts";
import { CallbackManager } from "https://esm.sh/v118/langchain@0.0.75/callbacks";
import { BaseLLM } from "https://esm.sh/v118/langchain@0.0.75/llms";
import { Tool } from "https://esm.sh/v118/langchain@0.0.75/tools";
import { BaseOutputParser } from "https://esm.sh/v118/langchain@0.0.75/schema/output_parser";
import { Plan, PlanStep, PlanStepYamlItem } from "./plan.ts";
import { PLANNER_SYSTEM_PROMPT_MESSAGE_TEMPLATE, PLANNER_WORK_PROMPT } from "./prompt.ts";
import { shorten } from "./util.ts";

export interface Planner {
  plan(task: string, runManager?: CallbackManager): Promise<Plan>;
  refineStep(step: PlanStep, runManager?: CallbackManager): Promise<void>;
}

export type LLMPlannerInput = {
  max_steps: string;
  step_context: string;
  step_no: string;
  task: string;
};

export class LLMPlanner implements Planner {
  private debugContext = debug("rungpt:rpe:planner:context");
  private debugPlan = debug("rungpt:rpe:planner:plan");
  private debugRefine = debug("rungpt:rpe:planner:refine");

  constructor(
    private readonly llm: BaseLLM,
    private readonly parser: BaseOutputParser<PlanStepYamlItem[]>,
    private readonly tools: Tool[],
    private readonly maxPlanSteps: number,
  ) {}

  plan(task: string): Promise<Plan> {
    this.debugPlan("Creating plan root step for task:", task);
    const rootStep = PlanStep.createRoot(task);
    return Promise.resolve(new Plan([rootStep]));
  }

  async refineStep(step: PlanStep, runManager?: CallbackManager): Promise<void> {
    this.debugRefine(`Refining step ${step.stepNo.toString()} (${shorten(JSON.stringify(step.title), 60)})…`);

    const stepContext = step.getContext();
    this.debugContext(`Context for step ${step.stepNo.toString()}:`, stepContext);

    const draftPrompt = await PLANNER_WORK_PROMPT.format({
      context: stepContext,
      max_steps: this.maxPlanSteps.toString(),
      step_no: step.stepNo.toString(),
      task: `${step.title}\n\n${step.description}`,
      tools: this.tools.map((tool) => `- ${tool.name}: ${tool.description}\n`).join(""),
    });

    const output = await this.llm.call(draftPrompt, {}, runManager);
    const substeps = await this.parser.parse(output);

    step.finalize(substeps);
    this.debugRefine(`Refined step ${step.stepNo.toString()}, created ${substeps.length} substeps:\n`, substeps);
  }
}

export class DefaultPlanningOutputParser extends BaseOutputParser<PlanStepYamlItem[]> {
  private debugParsing = debug("rungpt:rpe:planner:parsing");

  constructor(
    private readonly maxPlanSteps: number,
  ) {
    super();
  }

  parse(text: string): Promise<PlanStepYamlItem[]> {
    this.debugParsing("Parsing plan steps from text:\n", text);

    text = text.trim()
      .replace(/^Breakdown:/, "breakdown:")
      .replace(/Final Answer$/, "")
      .trim();

    const parsed = YAML.parse(text) as { breakdown: Array<{ step: number, title: string, description: string }> };
    const { breakdown } = parsed;

    if (!breakdown) {
      throw new Error(`No breakdown found in output:\n${shorten(text, 100)}}`);
    }
    if (!Array.isArray(breakdown)) {
      throw new Error(`Breakdown is not an array:\n${shorten(text, 100)}`);
    }

    if (breakdown.length < 2) {
      this.debugParsing("Parsing plan steps done. No substeps.");
      return Promise.resolve([]);
    }

    this.debugParsing("Parsing plan steps done. Substeps:\n", breakdown);
    return Promise.resolve(
      breakdown.map((step) => ({ step: "", title: step.title, description: step.description }))
    );
  }

  getFormatInstructions(): string {
    return PLANNER_SYSTEM_PROMPT_MESSAGE_TEMPLATE
      .replaceAll("{max_steps}", String(this.maxPlanSteps));
  }
}
