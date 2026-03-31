import { describe, it, expect } from "bun:test";
import type { FlowStep } from "./flows.js";

// Pure logic helpers extracted from progress.ts for unit testing (no DB required)

interface TestFlow {
  steps: FlowStep[];
}

interface TestProgress {
  completed_steps: string[];
}

function computeProgressSummary(flow: TestFlow, progress: TestProgress | null) {
  const steps = flow.steps;
  const completedSteps = progress?.completed_steps ?? [];

  const requiredSteps = steps.filter(s => s.required !== false);
  const completedRequired = requiredSteps.filter(s => completedSteps.includes(s.id));

  const percentage =
    requiredSteps.length === 0
      ? 100
      : Math.round((completedRequired.length / requiredSteps.length) * 100);

  const isComplete =
    requiredSteps.length === 0 ||
    requiredSteps.every(s => completedSteps.includes(s.id));

  const pendingSteps = steps
    .filter(s => !completedSteps.includes(s.id))
    .map(s => ({ id: s.id, title: s.title, required: s.required !== false }));

  return { percentage, is_complete: isComplete, pending_steps: pendingSteps, completed_steps: completedSteps };
}

function addStep(progress: TestProgress, stepId: string): TestProgress {
  if (progress.completed_steps.includes(stepId)) {
    return progress; // idempotent — no duplicates
  }
  return { ...progress, completed_steps: [...progress.completed_steps, stepId] };
}

describe("progress logic", () => {
  it("percentage = completed_required / total_required * 100", () => {
    const flow: TestFlow = {
      steps: [
        { id: "step-1", title: "Step 1", required: true },
        { id: "step-2", title: "Step 2", required: true },
        { id: "step-3", title: "Step 3", required: true },
        { id: "step-4", title: "Step 4", required: true },
      ],
    };
    const progress: TestProgress = { completed_steps: ["step-1", "step-2"] };
    const { percentage } = computeProgressSummary(flow, progress);
    expect(percentage).toBe(50);
  });

  it("markStep is idempotent — adding the same step twice does not duplicate it", () => {
    let progress: TestProgress = { completed_steps: [] };
    progress = addStep(progress, "step-1");
    progress = addStep(progress, "step-1"); // second time — should be no-op
    expect(progress.completed_steps).toEqual(["step-1"]);
    expect(progress.completed_steps.length).toBe(1);
  });

  it("is_complete = all required steps done; optional steps do not block completion", () => {
    const flow: TestFlow = {
      steps: [
        { id: "step-req", title: "Required step", required: true },
        { id: "step-opt", title: "Optional step", required: false },
      ],
    };
    // Only required step is done — optional is still pending
    const progress: TestProgress = { completed_steps: ["step-req"] };
    const { is_complete, pending_steps } = computeProgressSummary(flow, progress);
    expect(is_complete).toBe(true);
    // optional step still shows as pending but flow is complete
    expect(pending_steps.some(s => s.id === "step-opt")).toBe(true);
  });

  it("flow with no steps is immediately complete and percentage is 100", () => {
    const flow: TestFlow = { steps: [] };
    const progress: TestProgress = { completed_steps: [] };
    const { percentage, is_complete } = computeProgressSummary(flow, progress);
    expect(is_complete).toBe(true);
    expect(percentage).toBe(100);
  });

  it("percentage rounds to integer", () => {
    const flow: TestFlow = {
      steps: [
        { id: "a", title: "A", required: true },
        { id: "b", title: "B", required: true },
        { id: "c", title: "C", required: true },
      ],
    };
    const progress: TestProgress = { completed_steps: ["a"] };
    const { percentage } = computeProgressSummary(flow, progress);
    // 1/3 = 33.333... should round to 33
    expect(Number.isInteger(percentage)).toBe(true);
    expect(percentage).toBe(33);
  });

  it("is_complete is false when some required steps are still pending", () => {
    const flow: TestFlow = {
      steps: [
        { id: "step-1", title: "Step 1", required: true },
        { id: "step-2", title: "Step 2", required: true },
      ],
    };
    const progress: TestProgress = { completed_steps: ["step-1"] };
    const { is_complete } = computeProgressSummary(flow, progress);
    expect(is_complete).toBe(false);
  });

  it("null progress (not started) produces 0% and no completed steps", () => {
    const flow: TestFlow = {
      steps: [
        { id: "step-1", title: "Step 1", required: true },
      ],
    };
    const { percentage, completed_steps, is_complete } = computeProgressSummary(flow, null);
    expect(percentage).toBe(0);
    expect(completed_steps).toEqual([]);
    expect(is_complete).toBe(false);
  });
});
