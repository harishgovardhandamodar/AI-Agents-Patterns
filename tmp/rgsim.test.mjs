// Harness: run the rogue simulator in node, no DOM, to sanity-check the model.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../js/rogue.js", import.meta.url), "utf8");
const ctx = {
  console,
  tabLoaders: {},
  window: {},
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] == null ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); },
  },
  escHtml: (s) => String(s == null ? "" : s),
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Array, Object, Number, String, Boolean, isFinite, parseInt, parseFloat,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src + "\n;globalThis.__rg = { rgSim, rgNormalizeCfg, RG_PRESETS, RG_DEFAULT_CFG, rgSummarise };", ctx);
const { rgSim, rgNormalizeCfg, RG_PRESETS, RG_DEFAULT_CFG } = ctx.__rg;

function show(label, cfg) {
  const t0 = Date.now();
  const r = rgSim(cfg);
  const ms = Date.now() - t0;
  console.log("\n=== " + label + " (" + ms + "ms) ===");
  console.log(
    "rogues=" + r.rogues + " detected=" + r.detected + " missed=" + r.missed +
    " fp=" + r.falsePositives + " contained=" + r.contained + " escaped=" + r.escaped +
    " bounded=" + r.bounded + " damaging=" + r.damaging + " impact=" + r.impact +
    " late=" + r.late + " relapse=" + r.relapses
  );
  console.log(
    "precision=" + (r.precision == null ? "-" : r.precision.toFixed(2)) +
    " recall=" + (r.recall == null ? "-" : r.recall.toFixed(2)) +
    " fpr=" + (r.fpr == null ? "-" : r.fpr.toFixed(3)) +
    " mttd=" + (r.mttd == null ? "-" : r.mttd.toFixed(1)) +
    " mttq=" + (r.mttq == null ? "-" : r.mttq.toFixed(1)) +
    " blast(mean/max)=" + (r.blastMean == null ? "-" : r.blastMean.toFixed(1)) + "/" + r.blastMax +
    " sla=" + (r.slaCompliance == null ? "-" : r.slaCompliance.toFixed(2)) +
    " breaches=" + r.slaBreaches + " compromised=" + r.compromised
  );
  for (const k in r.perArch) {
    const a = r.perArch[k];
    if (!a.n) continue;
    console.log(
      "  " + k.padEnd(9) + " n=" + a.n + " det=" + a.detected + " cont=" + a.contained +
      " esc=" + a.escaped + " bnd=" + a.bounded + " blast=" + (a.blast == null ? "-" : a.blast.toFixed(1)) +
      " mttd=" + (a.mttd == null ? "-" : a.mttd.toFixed(0))
    );
  }
  for (const d in r.perDetector) {
    const p = r.perDetector[d];
    console.log("  detector " + d.padEnd(10) + " tp=" + p.tp + " fp=" + p.fp + " fn=" + p.fn +
      " recall=" + (p.recall == null ? "-" : p.recall.toFixed(2)));
  }
  return r;
}

for (const p of RG_PRESETS) {
  const cfg = rgNormalizeCfg(Object.assign({}, RG_DEFAULT_CFG, p.cfg));
  show(p.name, cfg);
}

// A bare swarm with no rogues at all: the false-positive floor.
const archOff = {}; for (const k of Object.keys(RG_DEFAULT_CFG.archetypes)) archOff[k]=false;
const noRogue = rgNormalizeCfg({ inject: 0, archetypes: archOff });
const clean = rgSim(noRogue);
console.log("\n=== no rogues ===");
console.log("false positives (collateral): " + clean.falsePositives + " / " + clean.swarm);
