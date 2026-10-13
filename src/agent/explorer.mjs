// Exploration agent. Executes a goal flow against the live app via a driver,
// deciding each step from structured DOM snapshots. Every action is:
//   1. planned by the provider from the current snapshot,
//   2. checked against the safety policy (irreversible actions refused),
//   3. grounded in the live DOM by the multi-strategy helper,
//   4. recorded in a trace with full grounding diagnostics.
// Task outcome is decided only by assertions over observed page state.
import { evaluateAssertion } from "./assertions.mjs";
import { scanForInjections, checkActionAllowed } from "./safety.mjs";

function specFromDescriptor(d) {
  if (!d) return null;
  const spec = {};
  if (d.testId) spec.testId = d.testId;
  if (d.role) spec.role = d.role;
  if (d.name) spec.name = d.name;
  if (d.text) spec.text = d.text;
  if (d.css) spec.css = d.css;
  return spec;
}

export async function exploreFlow({ driver, flow, provider, budget = 40, screenshotsDir = null }) {
  const trace = {
    flowId: flow.id,
    task: flow.task,
    driver: driver.kind,
    provider: provider.name,
    origin: driver.origin,
    startedAt: new Date().toISOString(),
    steps: [],
    injections: [],
    assertions: [],
    budget: { max: budget, used: 0 },
    refused: [],
    outcome: null,
    failure: null,
  };
  const seenInjections = new Set();
  const noteInjections = (snap) => {
    for (const flag of scanForInjections(snap)) {
      const key = `${flag.pattern}|${flag.source}`;
      if (!seenInjections.has(key)) {
        seenInjections.add(key);
        trace.injections.push(flag);
      }
    }
  };

  let snap = await driver.snapshot();
  noteInjections(snap);

  for (let idx = 0; idx < flow.steps.length; idx++) {
    const step = flow.steps[idx];
    const n = idx + 1;
    const decision = await provider.planStep(step, snap);

    if (decision.type === "skip") {
      trace.steps.push({ n, intent: step.intent, skipped: decision.reason });
      continue;
    }
    if (decision.type === "assert") {
      const result = evaluateAssertion(decision.assertion, snap, trace);
      trace.steps.push({ n, intent: step.intent, assertion: decision.assertion, result });
      if (!result.pass) {
        trace.outcome = "failed";
        trace.failure = { phase: "assertion", detail: result.detail, step: n };
        return trace;
      }
      continue;
    }

    // Policy gate: checked against the step's target before any actuation.
    const policy = checkActionAllowed(step.find);
    if (!policy.allowed) {
      trace.refused.push({ n, intent: step.intent, reason: policy.reason });
      trace.steps.push({ n, intent: step.intent, refused: policy.reason });
      trace.outcome = "blocked";
      trace.failure = { phase: "policy", detail: policy.reason, step: n };
      return trace;
    }

    if (trace.budget.used + 1 > trace.budget.max) {
      trace.outcome = "failed";
      trace.failure = { phase: "budget", detail: `action budget ${trace.budget.max} exceeded`, step: n };
      return trace;
    }

    let acted;
    try {
      acted = await driver.act(step.find, decision.action);
    } catch (e) {
      trace.outcome = "failed";
      trace.failure = { phase: "environment", detail: String(e.message || e), step: n };
      return trace;
    }
    trace.budget.used += 1;

    if (!acted.ok) {
      trace.steps.push({
        n, intent: step.intent, action: decision.action, target: step.find,
        grounding: acted.strategies || [], result: "failed",
      });
      trace.outcome = "failed";
      trace.failure = { phase: acted.phase || "grounding", detail: `action failed at step ${n}`, step: n, grounding: acted.strategies || [] };
      return trace;
    }

    const q = await driver.waitForQuiescence();
    snap = await driver.snapshot();
    noteInjections(snap);

    let screenshot = null;
    if (screenshotsDir && driver.supportsScreenshots) {
      screenshot = `${flow.id}-step${n}.png`;
      try { await driver.screenshot(`${screenshotsDir}/${screenshot}`); } catch { screenshot = null; }
    }

    trace.steps.push({
      n,
      intent: step.intent,
      action: decision.action,
      target: step.find,
      descriptor: acted.descriptor || null,
      recordedSpec: specFromDescriptor(acted.descriptor),
      strategyUsed: acted.strategy,
      grounding: acted.strategies || [],
      quiescenceMs: q.waitedMs,
      view: snap.hash,
      screenshot,
      ...(decision.reasoning ? { reasoning: decision.reasoning } : {}),
    });
  }

  // Final verdict: assertions over observed state only.
  let allPass = true;
  for (const assertion of flow.verify) {
    const result = evaluateAssertion(assertion, snap, trace);
    trace.assertions.push({ assertion, result });
    if (!result.pass) allPass = false;
  }
  trace.outcome = allPass ? "success" : "failed";
  if (!allPass) {
    const firstBad = trace.assertions.find((a) => !a.result.pass);
    trace.failure = { phase: "assertion", detail: firstBad.result.detail };
  }
  return trace;
}
