import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("../js/rogue.js", import.meta.url), "utf8");
const ctx = { console, tabLoaders: {}, window: {},
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  escHtml: (s) => String(s ?? ""), setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Array, Object, Number, String, isFinite, parseInt, parseFloat };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src + "\n;globalThis.__rg = { rgSim, rgNormalizeCfg, RG_THEMES, RG_DEFAULT_CFG };", ctx);
const { rgSim, rgNormalizeCfg, RG_THEMES, RG_DEFAULT_CFG } = ctx.__rg;
for (const t of RG_THEMES) {
  for (const preset of ["guarded"]) {
    const base = JSON.parse(JSON.stringify(RG_DEFAULT_CFG));
    base.theme = t.id;
    const cfg = rgNormalizeCfg(base);
    const r = rgSim(cfg);
    console.log(t.id.padEnd(9) + " det=" + r.detected + "/" + r.rogues + " fp=" + r.falsePositives +
      " cont=" + r.contained + " esc=" + r.escaped + " sla=" + (r.slaCompliance == null ? "-" : r.slaCompliance.toFixed(2)) +
      " blast=" + (r.blastMean == null ? "-" : r.blastMean.toFixed(1)) + "/" + r.blastMax);
  }
}
// clean-swarm FP floor per theme
for (const t of RG_THEMES) {
  const base = JSON.parse(JSON.stringify(RG_DEFAULT_CFG));
  base.theme = t.id; base.inject = 1;
  const archOff = {}; for (const k of Object.keys(base.archetypes)) archOff[k] = false;
  base.archetypes = archOff;
  const r = rgSim(rgNormalizeCfg(base));
  console.log(t.id.padEnd(9) + " CLEAN fp=" + r.falsePositives + "/" + r.swarm);
}
