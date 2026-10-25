// Debug: dump per-tick features and scores for the injected rogues and any FP.
import { readFileSync } from "node:fs";
import vm from "node:vm";

let src = readFileSync(new URL("../js/rogue.js", import.meta.url), "utf8");
src = src.replace(
  "return rgSummarise(ag, rogues, cases, timeline, cfg, N, T);",
  "const R = rgSummarise(ag, rogues, cases, timeline, cfg, N, T); R.__ag = ag; R.__cases = cases; return R;"
);
const ctx = {
  console,
  tabLoaders: {},
  window: {},
  localStorage: { getItem: () => null, setItem: () => {} },
  escHtml: (s) => String(s == null ? "" : s),
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Array, Object, Number, String, Boolean, isFinite, parseInt, parseFloat,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src + "\n;globalThis.__rg = { rgSim, rgNormalizeCfg, RG_DEFAULT_CFG, RG_ARCHETYPES, RG_DETECTORS };", ctx);
const { rgSim, rgNormalizeCfg, RG_DEFAULT_CFG, RG_DETECTORS } = ctx.__rg;

const mode = process.argv[2] || "guarded";
const archOff = {}; for (const k of Object.keys(RG_DEFAULT_CFG.archetypes)) archOff[k]=false;
const presets = {
  guarded: { detectors: { behaviour: true, goal: true, collusion: true } },
  clean: { inject: 0, archetypes: archOff },
  long: { ticks: 300 },
};
const cfg = rgNormalizeCfg(Object.assign({}, RG_DEFAULT_CFG, presets[mode] || presets.guarded));
const r = rgSim(cfg);
console.log(mode, "rogues:", JSON.stringify(r.perRogue.map(x => ({
  a: x.agent, arch: x.arch, born: x.born, det: x.detect, det_by: x.detector,
  score: x.score == null ? null : Math.round(x.score * 10) / 10, out: x.outcome, dmg: x.damage
}))));
console.log("per detector:", JSON.stringify(r.perDetector));
console.log("fpDetail:", JSON.stringify(r.fpDetail));

for (const a of r.__ag) {
  const isRogue = a.kind !== "benign";
  const flagged = a.detect || a.hits.behaviour || a.hits.goal || a.hits.collusion;
  if (!isRogue && !flagged) continue;
  const talk = [];
  if (a.talk) a.talk.forEach((v, k) => talk.push(k + ":" + v));
  console.log(
    "agent " + a.i + " kind=" + a.kind + " arch=" + a.arch + " role=" + a.role + " born=" + a.born +
    " detect=" + (a.detect ? a.detect.detector + "@" + a.detect.tick + "/" + a.detect.score.toFixed(2) : "-") +
    " state=" + a.state + " dmg=" + a.damage + " spawns=" + a.spawns + " ally=" + a.ally + " partner=" + a.partner
  );
  console.log("   last=" + JSON.stringify(a.last) + " scores=" + JSON.stringify(a.scores));
  console.log("   ema=" + JSON.stringify(a.ema) + " alignEma=" + a.alignEma.toFixed(3) +
    " goals=" + a.goal.a + "/" + a.goal.b + " grant=" + JSON.stringify(a.grant));
  console.log("   talk=" + JSON.stringify(talk) + " hits=" + JSON.stringify(a.hits) +
    " hitTick=" + JSON.stringify(a.hitTick) + " pre=" + JSON.stringify(a.preHit));
}
