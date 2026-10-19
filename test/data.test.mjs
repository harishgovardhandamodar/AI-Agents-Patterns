// Data-integrity + schema guard for the catalog.
//
// Zero dependencies: run with `npm test` (node --test). Everything the app
// ships lives in data/*.json, so a typo or a dangling reference is a shipped
// bug. This suite is the CI gate that catches it before the browser does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));

const patterns = load("patterns.json").patterns;
const scenarios = load("scenarios.json").scenarios;
const traces = load("traces.json").traces;
const cascades = load("cascades.json").cascades;
const cascadesMeta = load("cascades.json");
const coverage = load("coverage.json");

// Allowed keys per record. An unknown key is almost always a typo (this is
// how the misspelled `proteations` was caught), so it fails the build.
const SCHEMA = {
  patterns: {
    required: ["id", "name", "cat", "domains", "summary", "how", "components", "failures", "protections", "related"],
    optional: ["diagram"],
  },
  scenarios: {
    required: ["id", "title", "domain", "severity", "likelihood", "vector", "description", "attackChain", "protections", "detection", "response", "patternRefs"],
    optional: ["traceId"],
  },
  traces: {
    required: ["id", "name", "scenarioId", "verdict", "summary", "metrics", "flow", "steps", "events"],
    optional: [],
  },
  cascades: {
    required: ["id", "name", "cls", "domain", "summary", "trigger", "path", "amplifiers", "blastRadius", "likelihood", "impact", "speed", "detection", "mitigations", "patternRefs", "scenarioRefs", "traceRefs", "residual"],
    optional: [],
  },
};

const SEV = new Set(["critical", "high", "medium", "low"]);
const CLS = new Set(["inherent", "emergent", "derived", "cascading"]);

const catalogs = { patterns, scenarios, traces, cascades };

function checkShape(name, records) {
  const { required, optional } = SCHEMA[name];
  const allowed = new Set([...required, ...optional]);
  records.forEach((r, i) => {
    const where = `${name}[${i}] (${r.id || "no-id"})`;
    for (const k of required) {
      assert.ok(k in r, `${where} is missing required key "${k}"`);
    }
    for (const k of Object.keys(r)) {
      assert.ok(allowed.has(k), `${where} has unexpected key "${k}" (typo?)`);
    }
    assert.equal(typeof r.id, "string", `${where} id must be a string`);
    assert.ok(r.id.length > 0, `${where} id must be non-empty`);
  });
}

test("ids are unique within each catalog", () => {
  for (const [name, records] of Object.entries(catalogs)) {
    const seen = new Set();
    for (const r of records) {
      assert.ok(!seen.has(r.id), `duplicate id in ${name}: ${r.id}`);
      seen.add(r.id);
    }
  }
});

test("records match their schema (no missing or unexpected keys)", () => {
  for (const [name, records] of Object.entries(catalogs)) checkShape(name, records);
});

test("enums hold: severity, likelihood and cascade class", () => {
  for (const s of scenarios) {
    assert.ok(SEV.has(s.severity), `scenario ${s.id} bad severity "${s.severity}"`);
    assert.ok(SEV.has(s.likelihood), `scenario ${s.id} bad likelihood "${s.likelihood}"`);
  }
  for (const c of cascades) {
    assert.ok(CLS.has(c.cls), `cascade ${c.id} bad class "${c.cls}"`);
    assert.ok(SEV.has(c.impact), `cascade ${c.id} bad impact "${c.impact}"`);
    assert.ok(SEV.has(c.likelihood), `cascade ${c.id} bad likelihood "${c.likelihood}"`);
  }
});

test("every reference resolves (referential integrity)", () => {
  const pids = new Set(patterns.map((p) => p.id));
  const sids = new Set(scenarios.map((s) => s.id));
  const tids = new Set(traces.map((t) => t.id));
  const dangling = [];

  for (const s of scenarios) {
    for (const r of s.patternRefs) if (!pids.has(r)) dangling.push(`scenario ${s.id} -> pattern ${r}`);
    if (s.traceId && !tids.has(s.traceId)) dangling.push(`scenario ${s.id} -> trace ${s.traceId}`);
  }
  for (const p of patterns) {
    for (const r of p.related || []) if (!pids.has(r)) dangling.push(`pattern ${p.id} -> related ${r}`);
  }
  for (const c of cascades) {
    for (const r of c.patternRefs) if (!pids.has(r)) dangling.push(`cascade ${c.id} -> pattern ${r}`);
    for (const r of c.scenarioRefs) if (!sids.has(r)) dangling.push(`cascade ${c.id} -> scenario ${r}`);
    for (const r of c.traceRefs) if (!tids.has(r)) dangling.push(`cascade ${c.id} -> trace ${r}`);
  }
  for (const t of traces) {
    if (t.scenarioId && !sids.has(t.scenarioId)) dangling.push(`trace ${t.id} -> scenario ${t.scenarioId}`);
  }
  assert.deepEqual(dangling, [], `dangling references:\n  ${dangling.join("\n  ")}`);
});

test("traceRefs on scenarios mirror the traces' scenarioId", () => {
  const byTrace = new Map(traces.filter((t) => t.scenarioId).map((t) => [t.id, t.scenarioId]));
  for (const s of scenarios) {
    if (!s.traceId) continue;
    assert.equal(byTrace.get(s.traceId), s.id, `scenario ${s.id} points at ${s.traceId}, which belongs to ${byTrace.get(s.traceId)}`);
  }
});

// Recompute coverage.json from the catalogs using the same rules as
// tools/gen_coverage.py, and compare. This is the "generated data is fresh"
// gate: edit a catalog without regenerating and CI fails.
test("data/coverage.json is in sync with the catalogs", () => {
  const casdom = (c) => c.domain || "general";
  const domains = [...new Set([
    ...patterns.flatMap((p) => p.domains || []),
    ...scenarios.map((s) => s.domain),
    ...cascades.map(casdom),
  ])].sort();

  const byDomain = {};
  for (const d of domains) {
    const inDomain = cascades.filter((c) => casdom(c) === d);
    const ofClass = (cls) => inDomain.filter((c) => c.cls === cls).map((c) => c.id);
    byDomain[d] = {
      patterns: patterns.filter((p) => (p.domains || []).includes(d)).map((p) => p.id),
      scenarios: scenarios.filter((s) => s.domain === d).map((s) => s.id),
      cascades_all: inDomain.map((c) => c.id),
      cascades_inherent: ofClass("inherent"),
      cascades_emergent: ofClass("emergent"),
      cascades_derived: ofClass("derived"),
      cascades_cascading: ofClass("cascading"),
    };
  }
  const expected = {
    domains,
    by_domain: byDomain,
    totals: {
      patterns: patterns.length,
      scenarios: scenarios.length,
      cascades: cascades.length,
      domains: domains.length,
    },
  };
  assert.deepEqual(coverage, expected, "coverage.json is stale — run `python3 tools/gen_coverage.py`");
});

test("cascades.json class counts match the records", () => {
  const expected = { inherent: 0, emergent: 0, derived: 0, cascading: 0 };
  for (const c of cascades) expected[c.cls] = (expected[c.cls] || 0) + 1;
  assert.deepEqual(cascadesMeta.counts, expected, "cascades.json counts are stale — run `python3 tools/gen_cascades.py`");
});

// The offline shell is only as good as its precache list: a new js/data/design
// file that nobody added to sw.js silently breaks the offline promise. Keep
// the list and the files on disk in lockstep.
test("service worker precaches exactly the app shell", () => {
  const sw = readFileSync(join(ROOT, "sw.js"), "utf8");
  const start = sw.indexOf("const PRECACHE = [");
  assert.ok(start !== -1, "sw.js must declare a PRECACHE array");
  const body = sw.slice(start, sw.indexOf("];", start));
  const listed = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  assert.equal(new Set(listed).size, listed.length, "PRECACHE has duplicate entries");
  const missing = listed.filter((p) => !existsSync(join(ROOT, p)));
  assert.deepEqual(missing, [], `sw.js precaches files that do not exist:\n  ${missing.join("\n  ")}`);

  const nonEmpty = (dir) => readdirSync(join(ROOT, dir)).filter((f) => !f.startsWith("."));
  const expected = [
    "index.html",
    ...nonEmpty("css").map((f) => `css/${f}`),
    ...nonEmpty("js").filter((f) => f.endsWith(".js")).map((f) => `js/${f}`),
    ...nonEmpty("js/vendor").map((f) => `js/vendor/${f}`),
    ...nonEmpty("data").map((f) => `data/${f}`),
    ...nonEmpty("design").map((f) => `design/${f}`),
  ];
  const absent = expected.filter((p) => !listed.includes(p));
  assert.deepEqual(absent, [], `these files are not precached (add them to sw.js PRECACHE):\n  ${absent.join("\n  ")}`);
});
