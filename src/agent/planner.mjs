// Planner providers. The agent's "brain" sits behind this interface:
//   provider.name
//   provider.planStep(step, snapshot) -> {type:"act", action}
//                                      | {type:"skip", reason}
//                                      | {type:"assert", assertion}
//
// DeterministicPlanner is the real brain used for validation: it reads the
// current snapshot (structured DOM signals) and the goal step's intent,
// decides whether the step applies on this page state (e.g. login steps are
// skipped when a session already exists), and emits a concrete action.
//
// FakeLlmProvider is a clearly-labeled stand-in for a real LLM planner: it
// delegates every decision to DeterministicPlanner and attaches canned
// "reasoning" text, so the provider seam can be exercised end-to-end with
// no API keys. It makes no decisions of its own.
import { matchDescriptor } from "./assertions.mjs";

export class DeterministicPlanner {
  constructor() {
    this.name = "deterministic";
  }
  async planStep(step, snapshot) {
    if (step.do === "assert") {
      return { type: "assert", assertion: step.assert };
    }
    if (step.skipIfPresent) {
      const m = matchDescriptor(snapshot.elements, step.skipIfPresent).filter((e) => e.visible);
      if (m.length) {
        return { type: "skip", reason: `precondition already satisfied (found ${step.skipIfPresent.testId || step.skipIfPresent.name})` };
      }
    }
    if (step.skipIfAbsent) {
      const m = matchDescriptor(snapshot.elements, step.skipIfAbsent).filter((e) => e.visible);
      if (!m.length) {
        return { type: "skip", reason: `step not applicable on this page (missing ${step.skipIfAbsent.testId || step.skipIfAbsent.name})` };
      }
    }
    return { type: "act", action: { kind: step.do, value: step.value } };
  }
}

export class FakeLlmProvider {
  constructor(inner = new DeterministicPlanner()) {
    this.inner = inner;
    this.name = "fake-llm (deterministic stand-in — NOT a real LLM)";
  }
  async planStep(step, snapshot) {
    const decision = await this.inner.planStep(step, snapshot);
    return {
      ...decision,
      reasoning: `[fake-llm] I observe ${snapshot.elements.length} interactive elements on ${snapshot.hash || "the page"}; the goal step "${step.intent}" maps to ${decision.type}. (Canned text: this provider delegates to the deterministic planner.)`,
    };
  }
}

export function createProvider(name = "deterministic") {
  return name === "fake" ? new FakeLlmProvider() : new DeterministicPlanner();
}
