import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("../js/rogue.js", import.meta.url), "utf8");
const ctx = { console, tabLoaders: {}, window: {},
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  escHtml: (s) => String(s ?? ""), setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Array, Object, Number, String, isFinite, parseInt, parseFloat };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src + "\n;globalThis.__rg = { rgSim, rgNormalizeCfg, RG_THEMES, RG_DEFAULT_CFG, rgParseLivePlan, rgLivePrompt, rgTheme };", ctx);
const g = ctx.__rg;
let fail = 0;
const assert = (c, m) => { if (!c) { fail++; console.error("FAIL: " + m); } else console.log("ok: " + m); };
// unmanaged fintech: rogues must actually escape and damage
const base = JSON.parse(JSON.stringify(g.RG_DEFAULT_CFG));
base.theme = "fintech";
base.detectors = { behaviour: false, goal: false, collusion: false };
Object.keys(base.controls).forEach((k) => (base.controls[k] = false));
const r = g.rgSim(g.rgNormalizeCfg(base));
assert(r.escaped === r.rogues && r.blastTotal > 0, "fintech unmanaged escapes with damage (" + r.escaped + "/" + r.rogues + ", blast " + r.blastTotal + ")");
// parser: fences, labels, theme vocabulary, numbers, holes
const th = g.rgTheme({ theme: "vuln" });
const p1 = g.rgParseLivePlan('```json\n["read", "code/config read", "patch", "bogus-tool", "external"]\n```', 8, th);
assert(JSON.stringify(p1.slice(0, 5)) === JSON.stringify([1, 1, 2, null, 5]), "parser maps names+theme labels, holes unknown (got " + JSON.stringify(p1.slice(0, 5)) + ")");
const p2 = g.rgParseLivePlan("[1, 3, 6]", 5, th);
assert(JSON.stringify(p2.slice(0, 3)) === JSON.stringify([0, 2, 5]), "parser accepts 1-based numbers");
assert(g.rgParseLivePlan("no json here", 5, th).length === 0, "parser tolerates prose");
// prompt contains the essentials
const pr = g.rgLivePrompt(th, { role: "scanner", arch: "exfil", born: 15, grant: ["read", "compute"] }, 60);
assert(pr.includes("scanner") && pr.includes("exfil") && pr.includes("45") && pr.includes("read, compute"), "prompt carries role/arch/horizon/grant");
// live plan executes: all-external campaign in generic theme
const cfg = g.rgNormalizeCfg(JSON.parse(JSON.stringify(g.RG_DEFAULT_CFG)));
const dry = g.rgSim(cfg);
const plans = {};
dry.perRogue.forEach((x) => { plans[x.agent] = { classes: new Array(120).fill(5), model: "test", backend: "test" }; });
const live = g.rgSim(cfg, plans);
assert(live.perRogue.every((x) => x.live === true), "per-rogue live flags set");
assert(live.id.endsWith("-live"), "live run id tagged");
assert(live.live && live.live.planned === dry.perRogue.length, "run.live summary present");
console.log(fail ? "LIVE TESTS FAILED" : "LIVE TESTS PASSED");
process.exit(fail ? 1 : 0);
