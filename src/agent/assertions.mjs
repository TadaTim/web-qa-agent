// Assertion evaluation over snapshot data (Node side). Task success is
// decided ONLY here, from observed page state — never from planner say-so.
export function matchDescriptor(elements, spec) {
  if (!spec) return [];
  if (spec.testId) {
    const m = elements.filter((e) => e.testId === spec.testId);
    if (m.length) return m;
  }
  if (spec.role && spec.name) {
    const target = spec.name.toLowerCase();
    const m = elements.filter((e) => e.role === spec.role && (e.name || "").toLowerCase() === target);
    if (m.length) return m;
  }
  if (spec.text) {
    const m = elements.filter((e) => e.text === spec.text);
    if (m.length) return m;
  }
  if (spec.css) {
    // CSS paths are resolved in-page by the grounding helper; on snapshot
    // data we can only note the recorded descriptor identity via testId/id.
    if (spec.id) return elements.filter((e) => e.id === spec.id);
  }
  return [];
}

export function evaluateAssertion(assertion, snapshot, trace) {
  const a = assertion;
  switch (a.kind) {
    case "element": {
      const m = matchDescriptor(snapshot.elements, a.find).filter((e) => e.visible);
      if (!m.length) return { pass: false, detail: `element not found/visible: ${JSON.stringify(a.find)}` };
      if (a.textContains && !m[0].text.includes(a.textContains)) {
        return { pass: false, detail: `element text "${m[0].text}" does not contain "${a.textContains}"` };
      }
      return { pass: true, detail: `element present (${m[0].testId || m[0].role})` };
    }
    case "elementAbsent": {
      const m = matchDescriptor(snapshot.elements, a.find).filter((e) => e.visible);
      return m.length
        ? { pass: false, detail: `element unexpectedly present: ${JSON.stringify(a.find)}` }
        : { pass: true, detail: "element absent as expected" };
    }
    case "elementText": {
      const m = matchDescriptor(snapshot.elements, a.find);
      if (!m.length) return { pass: false, detail: `element not found: ${JSON.stringify(a.find)}` };
      const ok = a.equals !== undefined ? m[0].text === a.equals : m[0].text.includes(a.contains || "");
      return { pass: ok, detail: `element text "${m[0].text}" vs expected ${JSON.stringify(a.equals ?? a.contains)}` };
    }
    case "text": {
      const ok = snapshot.pageText.includes(a.text);
      return { pass: ok, detail: ok ? `page contains "${a.text}"` : `page missing text "${a.text}"` };
    }
    case "view": {
      const ok = snapshot.hash === a.hash;
      return { pass: ok, detail: `hash ${snapshot.hash} vs expected ${a.hash}` };
    }
    case "injectionFlagged": {
      const n = trace ? trace.injections.length : 0;
      return { pass: n > 0, detail: `${n} injection flag(s) recorded` };
    }
    default:
      return { pass: false, detail: `unknown assertion kind ${a.kind}` };
  }
}
