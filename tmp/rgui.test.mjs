// UI smoke for js/rogue.js without a browser: stub the shell globals the tab
// expects (el, escHtml, showNotif, openDetail, document, localStorage) and
// drive every sub-view + run + ablation to completion.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../js/rogue.js", import.meta.url), "utf8");
let lastNotif = "";
const html = {};
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Array, Object, Number, String, Boolean, isFinite,
  parseInt, parseFloat,
  tabLoaders: {}, window: {},
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  el: (id) => (html[id] ??= { innerHTML: "" }),
  escHtml: (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  showNotif: (m) => { lastNotif = String(m); },
  openDetail: () => {}, openPattern: () => {}, projTouch: () => {},
  document: { activeElement: null, querySelector: () => null },
  confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const g = vm.runInContext("({initRogue, renderRogue, rgSetView, rgRun, rgPreset, rgToggle, rgRunAblations, rgMarkdown, rgBoardSeedFromRun, rgCaseAction, rogueState})", ctx);

const assert = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } else console.log("ok: " + m); };

g.initRogue();
assert(html.rogueMain.innerHTML.includes("Scenario"), "setup renders");
g.rgSetView("results");
assert(/No run yet|Run the simulation first/.test(html.rogueMain.innerHTML), "results empty state");
g.rgRun();
assert(g.rogueState.run && g.rogueState.run.rogues > 0, "run produces rogues");
assert(html.rogueMain.innerHTML.includes("Rogues"), "results render with per-rogue rows");
assert(html.rogueMain.innerHTML.includes("Reading this honestly"), "caveat present");
const md = g.rgMarkdown();
assert(md.includes("## Detectors") && md.includes("## Rogues") && md.includes("proves the controls are wired"), "markdown report");
g.rgSetView("board");
assert(/Board is empty|No cases/.test(html.rogueMain.innerHTML), "board empty state");
g.rgBoardSeedFromRun();
assert(g.rogueState.board.length > 0, "seed from run opens cases (" + g.rogueState.board.length + ")");
assert(html.rogueMain.innerHTML.includes("SLA"), "board renders SLA clocks");
const id = g.rogueState.board[0].id;
g.rgCaseAction(id, "step", "isolate");
assert(g.rogueState.board[0].steps.isolate.done === true, "step completion works");
g.rgSetView("guardrails");
assert(html.rogueMain.innerHTML.includes("Runtime primitive"), "guardrails render");
g.rgRunAblations();
await new Promise((res) => {
  const t = setInterval(() => {
    if (!g.rogueState.ablating) { clearInterval(t); clearTimeout(wd); res(); }
  }, 200);
  var wd = setTimeout(() => { clearInterval(t); res(); }, 100000);
});
assert(!!g.rogueState.ablations, "ablations complete");
assert(html.rogueMain.innerHTML.includes("load-bearing"), "ablation verdicts render");
const loo = g.rogueState.ablations.rows.filter((r) => r.kind === "off");
const sandbox = loo.filter((r) => r.id === "sandbox")[0];
assert(sandbox && sandbox.loadBearing === true && sandbox.dHarm > 0, "sandbox is load-bearing (dHarm=" + (sandbox && sandbox.dHarm) + ")");
console.log("lastNotif: " + lastNotif.slice(0, 80));
clearInterval(ctx.window.__rgClock);
console.log(process.exitCode ? "UI SMOKE FAILED" : "UI SMOKE PASSED");
