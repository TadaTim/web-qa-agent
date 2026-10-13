// Safety policy for the exploration agent.
//
// 1. Content trust boundary: text rendered by a page is DATA, never
//    instructions. The planner only ever follows its own goal plan. Page
//    content that tries to instruct an agent is detected and flagged.
// 2. Irreversible actions are refused by policy, no matter what any plan,
//    page, or injected text asks for. There is no override.
// 3. Budgets and origin restriction are enforced by the explorer/driver.

const INJECTION_PATTERNS = [
  { id: "ignore-instructions", re: /ignore\s+(your\s+|all\s+|the\s+)?(previous\s+|prior\s+|current\s+)?(task|instructions?|directions?)/i },
  { id: "addressed-to-agent", re: /\b(AI\s+assistants?|automated\s+agents?|language\s+model|LLM)\b/i },
  { id: "imperative-must", re: /\byou\s+must\s+(immediately\s+)?(navigate|click|delete|go\s+to|press)\b/i },
  { id: "fake-system-note", re: /\b(system\s+(note|message|maintenance)|admin\s+instruction)\b/i },
  { id: "concealment", re: /\bdo\s+not\s+(report|tell|mention)\b.*\b(user|human)\b/i },
];

export function scanForInjections(snapshot) {
  const flags = [];
  const corpora = [
    { source: "pageText", text: snapshot.pageText || "" },
    { source: "hiddenText", text: snapshot.hiddenText || "" },
  ];
  for (const { source, text } of corpora) {
    if (!text) continue;
    for (const { id, re } of INJECTION_PATTERNS) {
      const m = re.exec(text);
      if (m) {
        flags.push({
          pattern: id,
          source,
          excerpt: text.slice(Math.max(0, m.index - 30), m.index + 90),
        });
      }
    }
  }
  return flags;
}

// An action target is irreversible if its identity advertises destruction:
// delete/destroy/erase in a test-id, or delete/permanent wording in the
// accessible name or visible text. Refusal is unconditional.
export function irreversibleReason(spec) {
  if (!spec) return null;
  const testId = spec.testId || "";
  const label = `${spec.name || ""} ${spec.text || ""}`;
  if (/(delete|destroy|erase|wipe)/i.test(testId)) {
    return `target testId "${testId}" indicates a destructive action`;
  }
  if (/\b(delete|destroy|erase)\b/i.test(label) || /permanently/i.test(label)) {
    return `target label "${label.trim()}" indicates an irreversible action`;
  }
  return null;
}

export function checkActionAllowed(spec) {
  const reason = irreversibleReason(spec);
  return reason ? { allowed: false, reason } : { allowed: true };
}
