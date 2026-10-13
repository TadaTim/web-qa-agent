// Failure classifier. Consumes the structured QA_RESULT diagnostics a
// compiled test prints (failure phase, whether any locator strategy matched
// the assertion target, and a context probe of how many recorded action
// targets still ground) and assigns exactly one class:
//
//   PASS        — the replay succeeded.
//   PRODUCT_BUG — the app's surface is intact (this run's action targets
//                 grounded via their primary strategy) but behavior is
//                 wrong: a present element has the wrong content/state, or
//                 an expected behavior is absent while everything the test
//                 touched still works exactly as recorded.
//   TEST_ROT    — the test's locators no longer match the page: an action
//                 target cannot be grounded by ANY strategy, or this run's
//                 actions had to fall back off their primary selectors
//                 (drift in progress) and the assertion target is gone.
//   ENVIRONMENT — the run never really tested the app: driver/browser
//                 failure, app unreachable, missing configuration.

export const CLASSES = ["PASS", "PRODUCT_BUG", "TEST_ROT", "ENVIRONMENT"];

export function classifyFailure(failure) {
  if (!failure) return "ENVIRONMENT";
  switch (failure.phase) {
    case "environment":
    case "timeout":
      return "ENVIRONMENT";
    case "grounding":
      // No strategy could locate the action target: selector drift.
      return "TEST_ROT";
    case "assertion": {
      if (failure.matchedAny) return "PRODUCT_BUG";
      // Assertion target matched nothing at all. If this run's actions had
      // to drift off their primary selectors, the page has shifted under
      // the test -> test rot. If every action grounded exactly as recorded,
      // the surface is intact and the behavior is simply missing -> bug.
      const drifted = failure.acts ? failure.acts.drifted : 0;
      return drifted > 0 ? "TEST_ROT" : "PRODUCT_BUG";
    }
    case "budget":
    case "policy":
    default:
      return "ENVIRONMENT";
  }
}

export function classifyRun(run) {
  if (run.parsed && run.parsed.status === "pass") return "PASS";
  if (run.exitCode === 0 && /QA_RESULT \{"status":"pass"\}/.test(run.stdout || "")) return "PASS";
  if (run.parsed) return classifyFailure(run.parsed);
  // No structured result: the harness itself failed to run the test.
  return "ENVIRONMENT";
}
