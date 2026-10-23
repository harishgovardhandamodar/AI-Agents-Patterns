// Rogue Agents tab, tested without a browser: the simulator, the live-fire
// parsers and the tab UI are all plain functions over stubbed shell globals,
// so node --test drives them in a vm. (These harnesses lived as ad-hoc
// scripts in tmp/; they are real assertions now, and CI runs them.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "js/rogue.js"), "utf8");

function stubShell(extra) {
  const escHtml = (s) => String(s == null ? "" : s);
  return Object.assign({
    console, tabLoaders: {}, window: {},
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] == null ? null : this._d[k]; },
      setItem(k, v) { this._d[k] = String(v); },
    },
    escHtml,
    /* dataArgs lives in js/app.js in the browser (always loaded first);
       the vm harness provides the identical implementation. */
    dataArgs: function () {
      return escHtml("[" + Array.prototype.map.call(arguments, function (x) {
        return JSON.stringify(String(x));
      }).join(",") + "]");
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Array, Object, Number, String, Boolean,
    isFinite, parseInt, parseFloat,
  }, extra || {});
}

function loadSim() {
  const ctx = stubShell();
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC + "\n;globalThis.__rg = { rgSim, rgNormalizeCfg, RG_PRESETS, RG_DEFAULT_CFG };", ctx);
  return ctx.__rg;
}

test("simulator: deterministic, totals consistent, clean swarm has no false positives", () => {
  const g = loadSim();
  const a = g.rgSim(g.rgNormalizeCfg({}));
  const b = g.rgSim(g.rgNormalizeCfg({}));
  assert.deepEqual(a, b, "same config must give the same run (seeded)");
  assert.ok(a.rogues > 0, "default config injects rogues");
  assert.equal(a.detected + a.missed, a.rogues, "every rogue is detected or missed");
  assert.ok(a.detected >= a.contained, "contained implies detected");

  const archOff = {};
  for (const k of Object.keys(g.RG_DEFAULT_CFG.archetypes)) archOff[k] = false;
  const clean = g.rgSim(g.rgNormalizeCfg({ inject: 0, archetypes: archOff }));
  assert.equal(clean.falsePositives, 0, "a bare swarm accuses nobody");
});

test("simulator: an unmanaged swarm escapes and does damage", () => {
  const g = loadSim();
  const base = JSON.parse(JSON.stringify(g.RG_DEFAULT_CFG));
  base.detectors = { behaviour: false, goal: false, collusion: false };
  Object.keys(base.controls).forEach((k) => (base.controls[k] = false));
  const r = g.rgSim(g.rgNormalizeCfg(base));
  assert.equal(r.escaped, r.rogues, "nothing stops the unmanaged rogues");
  assert.ok(r.blastTotal > 0, "escapes do damage");
});

test("simulator: every shipped preset runs to completion", () => {
  const g = loadSim();
  assert.ok(g.RG_PRESETS.length > 0, "presets exist");
  for (const p of g.RG_PRESETS) {
    const r = g.rgSim(g.rgNormalizeCfg(Object.assign({}, g.RG_DEFAULT_CFG, p.cfg)));
    assert.equal(r.detected + r.missed, r.rogues, p.name + ": totals consistent");
  }
});

test("live-fire parsers and prompt builder", () => {
  const ctx = stubShell();
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC + "\n;globalThis.__rg = { rgSim, rgNormalizeCfg, RG_THEMES, RG_DEFAULT_CFG, rgParseLivePlan, rgLivePrompt, rgTheme };", ctx);
  const g = ctx.__rg;
  const th = g.rgTheme({ theme: "vuln" });
  // fences, labels, theme vocabulary, numbers, holes (Array.from: the vm
  // realm has its own Array, which strict equality rejects)
  assert.deepEqual(
    Array.from(g.rgParseLivePlan('```json\n["read", "code/config read", "patch", "bogus-tool", "external"]\n```', 8, th).slice(0, 5)),
    [1, 1, 2, null, 5]);
  assert.deepEqual(Array.from(g.rgParseLivePlan("[1, 3, 6]", 5, th).slice(0, 3)), [0, 2, 5]);
  assert.deepEqual(Array.from(g.rgParseLivePlan("no json here", 5, th)), []);
  const pr = g.rgLivePrompt(th, { role: "scanner", arch: "exfil", born: 15, grant: ["read", "compute"] }, 60);
  assert.ok(pr.includes("scanner") && pr.includes("exfil") && pr.includes("45") && pr.includes("read, compute"),
    "prompt carries role/arch/horizon/grant");
});

test("tab UI: setup, run, board, guardrails and ablations render", async () => {
  const html = {};
  const ctx = stubShell({
    el: (id) => (html[id] = html[id] || { innerHTML: "" }),
    showNotif: () => {}, openDetail: () => {}, openPattern: () => {}, projTouch: () => {},
    document: { activeElement: null, querySelector: () => null },
    confirm: () => false,
  });
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const g = vm.runInContext(
    "({initRogue, renderRogue, rgSetView, rgRun, rgPreset, rgToggle, rgRunAblations, rgMarkdown, rgBoardSeedFromRun, rgCaseAction, rogueState})", ctx);

  g.initRogue();
  assert.match(html.rogueMain.innerHTML, /Scenario/, "setup renders");
  g.rgSetView("results");
  assert.match(html.rogueMain.innerHTML, /No run yet|Run the simulation first/, "results empty state");
  g.rgRun();
  assert.ok(g.rogueState.run && g.rogueState.run.rogues > 0, "run produces rogues");
  assert.match(html.rogueMain.innerHTML, /Rogues/, "results render per-rogue rows");
  assert.match(html.rogueMain.innerHTML, /Reading this honestly/, "caveat present");
  const md = g.rgMarkdown();
  assert.ok(md.includes("## Detectors") && md.includes("proves the controls are wired"), "markdown report");
  g.rgSetView("board");
  assert.match(html.rogueMain.innerHTML, /Board is empty|No cases/, "board empty state");
  g.rgBoardSeedFromRun();
  assert.ok(g.rogueState.board.length > 0, "seed from run opens cases");
  assert.match(html.rogueMain.innerHTML, /SLA/, "board renders SLA clocks");
  g.rgCaseAction(g.rogueState.board[0].id, "step", "isolate");
  assert.equal(g.rogueState.board[0].steps.isolate.done, true, "step completion works");
  g.rgSetView("guardrails");
  assert.match(html.rogueMain.innerHTML, /Runtime primitive/, "guardrails render");

  g.rgRunAblations();
  const deadline = Date.now() + 60000;
  while (g.rogueState.ablating && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(!g.rogueState.ablating, "ablations finish within 60s");
  assert.ok(!!g.rogueState.ablations, "ablations produce verdicts");
  assert.match(html.rogueMain.innerHTML, /load-bearing/, "ablation verdicts render");
  const sandbox = g.rogueState.ablations.rows
    .filter((r) => r.kind === "off" && r.id === "sandbox")[0];
  assert.ok(sandbox && sandbox.loadBearing === true && sandbox.dHarm > 0, "sandbox is load-bearing");
  clearInterval(ctx.window.__rgClock);
});
