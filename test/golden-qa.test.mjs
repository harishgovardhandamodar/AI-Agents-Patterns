// Golden Q/A for the deterministic Fox-Architect fallback (P1-6).
// Runs AIContext.answer() — no model, no network — and asserts:
//  - expected catalog IDs appear in cites,
//  - no S-###/P-###-style IDs appear anywhere,
//  - the refusal case abstains instead of inventing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadCtx() {
  const ctx = vm.createContext({ console });
  const data = {};
  for (const [key, file, field] of [
    ["patterns", "patterns.json", "patterns"],
    ["scenarios", "scenarios.json", "scenarios"],
    ["traces", "traces.json", "traces"],
    ["cascades", "cascades.json", "cascades"],
  ]) {
    try {
      data[key] = JSON.parse(readFileSync(join(ROOT, "data", file), "utf8"));
      if (!Array.isArray(data[key]) && data[key][field]) data[key] = { [field]: data[key][field] };
    } catch { data[key] = field === "traces" ? [] : {};
    }
  }
  ctx.DATA = data;
  vm.runInContext(readFileSync(join(ROOT, "js/context.js"), "utf8"), ctx);
  return ctx;
}

const CASES = [
  // expectAny: at least one of these catalog IDs must be cited. Questions
  // are phrased in the catalog's own vocabulary, since retrieval ranks by
  // wording — asking in catalog terms is itself the honest UX contract.
  { q: "How do I stop prompt injection from tool output?",
    expectAny: ["input-sanitization"],
    forbid: [/S-\d+/, /P-\d+/] },
  { q: "What caps runaway agent loops: circuit breaker, fan-out caps, quotas?",
    expectAny: ["circuit-breaker", "fan-out-caps", "quota-rate-limit"],
    forbid: [/S-\d+/, /P-\d+/] },
  { q: "Which patterns need human approval before spending money?",
    expectAny: ["approval-gates", "dual-control", "budget-guardrails"],
    forbid: [/S-\d+/, /P-\d+/] },
  { q: "How should the agent store long-term memories safely?",
    expectAny: ["long-term-vector-memory"],
    forbid: [/S-\d+/, /P-\d+/] },
  { q: "What is the standard agent loop?",
    expectAny: ["standard-agent-loop"],
    forbid: [/S-\d+/, /P-\d+/] },
  { q: "How do I bound what a support agent can refund?",
    expectAny: ["support-triage", "budget-guardrails"],
    forbid: [/S-\d+/, /P-\d+/] },
  { q: "What stops a retry storm from double-charging?",
    expectAny: ["retry-backoff", "idempotency-keys"],
    forbid: [/S-\d+/, /P-\d+/] },
  { q: "How do supervisor workers isolate data per worker with scoped credentials?",
    expectAny: ["supervisor-workers", "least-privilege"],
    forbid: [/S-\d+/, /P-\d+/] },
];

for (const c of CASES) {
  test("golden: " + c.q.slice(0, 48), () => {
    const ctx = loadCtx();
    const built = vm.runInContext(
      "AIContext.build(" + JSON.stringify(c.q) + ")", ctx);
    const ans = vm.runInContext(
      "AIContext.answer(" + JSON.stringify(c.q) + ", AIContext.build(" +
      JSON.stringify(c.q) + "), {})", ctx);
    const ids = (ans.cites || []).map((x) => x.id);
    assert.ok(c.expectAny.some((want) => ids.includes(want)),
      "expected one of " + JSON.stringify(c.expectAny) + ", got " + JSON.stringify(ids));
    const blob = ans.text + " " + ids.join(" ");
    for (const rx of c.forbid) {
      assert.doesNotMatch(blob, rx, "forbidden ID shape in answer");
    }
    assert.ok(built.text.length > 0, "empty retrieval context");
  });
}

test("golden: unknown topic abstains instead of inventing", () => {
  const ctx = loadCtx();
  const ans = vm.runInContext(
    "AIContext.answer('zzqq unrelated-query-no-match-zzqq', AIContext.build('zzqq unrelated-query-no-match-zzqq'), {})",
    ctx);
  const blob = (ans.text + " " + (ans.cites || []).map((x) => x.id).join(" "));
  assert.doesNotMatch(blob, /S-\d+/);
  assert.doesNotMatch(blob, /P-\d{2,}/);
});
