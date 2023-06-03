import * as YAML from "https://deno.land/std@0.187.0/yaml/mod.ts";

export class Plan {
  public constructor(
    public readonly rootSteps: PlanStep[],
  ) {}

  /// Depth-first traversal of the plan tree
  public *traverse(): Generator<PlanStep> {
    if (this.rootSteps.length === 0) {
      return;
    }
    for (let currentStep = this.rootSteps[0]; currentStep !== null; currentStep = currentStep.nextStep()!) {
      yield currentStep;
    }
  }
}

export interface PlanStepYamlItem {
  /// Step number in the plan, e.g. "1.2.3"
  step: string;

  /// Brief summary of what needs to be done in this step.
  title: string;

  /// Description of what needs to be done in this step.
  description: string;

  /// Breakdown of this step into substeps.
  substeps?: PlanStepYamlItem[];
}

export class PlanStep {
  /// If true, this step has already been evaluated whether to
  /// divide it into substeps or not.
  public finalized = false;

  public substeps: PlanStep[] = [];

  private constructor(
    public readonly stepNo: HierarchicalSerialNumber,
    public readonly title: string,
    public readonly description: string,
    public readonly parent: PlanStep | null = null,
  ) {}

  public static createRoot(task: string, startingNumber?: number): PlanStep {
    const stepNo = HierarchicalSerialNumber.first(startingNumber);
    return new PlanStep(stepNo, "Main objective", task, null);
  }

  public finalize(substeps: Array<{ title: string, description: string }> | null): void {
    if (this.finalized) {
      throw new Error("Already finalized");
    }
    if (substeps) {
      let nextStepNo = this.stepNo.child();
      this.substeps = substeps.map(task => {
        const step = new PlanStep(nextStepNo, task.title, task.description, this);
        nextStepNo = nextStepNo.next();
        return step;
      });
    }
    this.finalized = true;
  }

  /// Returns the ancestors of this step, starting with the root.
  public getAncestors(): PlanStep[] {
    if (this.parent) {
      return [
        ...this.parent.getAncestors(),
        this.parent,
      ];
    } else {
      return [];
    }
  }

  getContext(): string {
    return this.getAncestors()
      .map((parentStep) => {
        const obj = {
          step: parentStep.stepNo.toString(),
          title: parentStep.title,
          description: parentStep.description,
        };
        return `${YAML.stringify(obj)}\n`;
      })
      .join("")
      .trimEnd();

    // const items: PlanStepYamlItem[] = [];
    // const stepAncestors = new Set(this.getAncestors());
    // const rootStep = [...this.getAncestors(), this][0];
    // const rootStepSiblings = rootStep.getSiblings();

    // for (const topLevelStep of [...rootStepSiblings[0], rootStep, ...rootStepSiblings[1]]) {
    //   if (topLevelStep === this) {
    //     continue;
    //   }
    //   const yamlItem = this.toYamlItem(topLevelStep, (it) => stepAncestors.has(it));
    //   items.push(yamlItem);
    // }

    // return YAML.stringify({ steps: items });
  }

  private toYamlItem(step: PlanStep, shouldIncludeSubsteps: (it: PlanStep) => boolean): PlanStepYamlItem {
    const output: PlanStepYamlItem = {
      step: step.stepNo.toString(),
      title: step.title,
      description: step.description,
    };
    if (shouldIncludeSubsteps(step)) {
      output.substeps = step.substeps.map((it) => this.toYamlItem(it, shouldIncludeSubsteps));
    }
    return output;
  }

  /// Returns the siblings of this step as [earlierSiblings, laterSiblings]
  public getSiblings(): [PlanStep[], PlanStep[]] {
    if (!this.parent) {
      return [[], []];
    }
    const siblingIndex = this.stepNo.siblingIndex();
    return [
      this.parent.substeps.slice(0, siblingIndex),
      this.parent.substeps.slice(siblingIndex + 1),
    ];
  }

  public nextStep(): PlanStep | null {
    if (this.substeps.length > 0) {
      return this.substeps[0];
    }
    if (this.parent) {
      const siblingIndex = this.stepNo.siblingIndex();
      if (siblingIndex < this.parent.substeps.length - 1) {
        return this.parent.substeps[siblingIndex + 1];
      }
      return this.parent.nextStep();
    }
    return null;
  }
}

export class HierarchicalSerialNumber {
  private constructor(
    /// Order: Root to leaf
    public readonly numberFragments: number[],
    private readonly startingNumber: number,
  ) {}

  public child(): HierarchicalSerialNumber {
    return new HierarchicalSerialNumber([
      ...this.numberFragments,
      1,
    ], this.startingNumber);
  }

  public next(): HierarchicalSerialNumber {
    return new HierarchicalSerialNumber([
      ...this.numberFragments.slice(0, -1),
      this.numberFragments[this.numberFragments.length - 1] + 1,
    ], this.startingNumber);
  }

  public siblingIndex(): number {
    return this.numberFragments[this.numberFragments.length - 1] - this.startingNumber;
  }

  public siblingNumber(): number {
    return this.numberFragments[this.numberFragments.length - 1];
  }

  public toString(): string {
    return this.numberFragments.join(".");
  }

  public static first(startingNumber = 1): HierarchicalSerialNumber {
    return new HierarchicalSerialNumber([startingNumber], startingNumber);
  }
}
