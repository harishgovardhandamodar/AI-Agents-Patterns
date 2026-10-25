// Scenario checks: edge configurations the UI will expose as ablations.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../js/rogue.js", import.meta.url), "utf8");
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
vm.runInContext(src + "\n;globalThis.__rg = { rgSim, rgNormalizeCfg, RG_PRESETS, RG_DEFAULT_CFG };", ctx);
const { rgSim, rgNormalizeCfg, RG_DEFAULT_CFG } = ctx.__rg;

function run(label, over) {
  const cfg = rgNormalizeCfg(Object.assign({}, RG_DEFAULT_CFG, over));
  const r = rgSim(cfg);
  console.log(
    label.padEnd(30) +
    " det=" + r.detected + "/" + r.rogues +
    " fp=" + r.falsePositives +
    " cont=" + r.contained + " imp=" + r.impact + " late=" + r.late + " rel=" + r.relapses +
    " esc=" + r.escaped + " bnd=" + r.bounded + " dmgEsc=" + r.damaging +
    " blast=" + (r.blastMean == null ? "-" : r.blastMean.toFixed(1)) + "/" + r.blastMax +
    " sla=" + (r.slaCompliance == null ? "-" : (r.slaCompliance * 100).toFixed(0) + "%") +
    " steps=" + r.slaSteps + " br=" + r.slaBreaches + " beyond=" + r.slaBeyond +
    " mttd=" + (r.mttd == null ? "-" : r.mttd.toFixed(0)) +
    " compromised=" + r.compromised +
    " harm=" + r.harmTotal + " waste=" + r.wasteTotal + " denied=" + r.harmDenied + " dropped=" + r.harmDropped + " harmEsc=" + r.harmEscaped
  );
  return r;
}

const C = (id, v) => ({ controls: Object.assign({}, RG_DEFAULT_CFG.controls, { [id]: v }) });

run("baseline guarded", {});
run("sandbox off", C("sandbox", false));
run("egress off", C("egress", false));
run("leastPriv off", C("leastPriv", false));
run("fanout off", C("fanout", false));
run("approval off", C("approval", false));
run("autoQuarantine off", C("autoQuarantine", false));
run("killSwitch off", C("killSwitch", false));
run("memoryScrub off", C("memoryScrub", false));
run("audit off", C("audit", false));
run("attestation off", C("attestation", false));
run("no behaviour", { detectors: { behaviour: false, goal: true, collusion: true } });
run("no goal", { detectors: { behaviour: true, goal: false, collusion: true } });
run("no collusion", { detectors: { behaviour: true, goal: true, collusion: false } });
run("long run 300t", { ticks: 300 });
run("long run 300t, no scrub", { ticks: 300, controls: Object.assign({}, RG_DEFAULT_CFG.controls, { memoryScrub: false }) });
run("small swarm 40", { swarm: 40, ticks: 80, inject: 10 });
run("big swarm 800", { swarm: 800, ticks: 120 });
run("persist 1", { persist: 1 });
run("persist 4", { persist: 4 });
run("tight thresholds", { thresholds: { behaviour: 2.0, goal: 2.0, collusion: 0.3 } });
run("loose thresholds", { thresholds: { behaviour: 5.0, goal: 4.0, collusion: 0.7 } });
