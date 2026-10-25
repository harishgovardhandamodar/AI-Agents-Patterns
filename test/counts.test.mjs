// Book/README reproducibility: the README's headline numbers are hand-written
// prose, so they rot (design docs said 9 at 11, diagrams said 42 at 60).
// This recomputes every count from disk and asserts the README agrees —
// the same "a stale number fails the build" discipline the book generator
// applies to its own chapters.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));
const README = readFileSync(join(ROOT, "README.md"), "utf8");

const patterns = load("patterns.json").patterns;
const scenarios = load("scenarios.json").scenarios;
const traces = load("traces.json").traces;
const cascades = load("cascades.json").cascades;
const designDocs = readdirSync(join(ROOT, "design")).filter((f) => f.endsWith(".md"));
const fences = designDocs.reduce((n, f) =>
  n + (readFileSync(join(ROOT, "design", f), "utf8").match(/```mermaid/g) || []).length, 0);
const sev = { critical: 0, high: 0, medium: 0 };
scenarios.forEach((s) => { if (sev[s.severity] != null) sev[s.severity]++; });

function expectCount(n, label) {
  assert.ok(README.includes(String(n) + " " + label) || README.includes(String(n) + " " + label),
    `README should state the recomputed count: ${n} ${label}`);
}

test("catalog headline counts match data/*.json", () => {
  expectCount(patterns.length, "design patterns");
  expectCount(scenarios.length, "failure scenarios");
  expectCount(traces.length, "replayable mock traces");
  expectCount(cascades.length, "composition cascades");
  expectCount(new Set(scenarios.map((s) => s.domain)).size, "scenario domains");
  expectCount(patterns.reduce((n, p) => n + (p.failures || []).length, 0), "documented failure modes");
  const sevStr = `${sev.critical} critical / ${sev.high} high / ${sev.medium} medium`;
  assert.ok(README.includes(sevStr), `README should state severity split: ${sevStr}`);
});

test("design doc and diagram counts match design/*.md", () => {
  expectCount(designDocs.length, "architecture documents");
  expectCount(fences, "Mermaid diagrams in the design docs");
  expectCount(patterns.filter((p) => p.diagram).length, "pattern control-flow diagrams");
});
