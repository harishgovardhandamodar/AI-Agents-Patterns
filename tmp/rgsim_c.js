
/* Turn the finished simulation into the numbers an operator reads. */
function rgSummarise(ag, rogues, cases, timeline, cfg, N, T) {
  const ben = ag.filter(function (a) { return a.kind === "benign"; });
  /* A rogue only counts as detected if the detection came after it turned.
     A flag on a rogue that was still healthy is a false positive. */
  const detectedRogue = rogues.filter(function (a) { return a.detect && a.detect.tick >= a.born; });
  const missedRogue = rogues.filter(function (a) { return !(a.detect && a.detect.tick >= a.born); });
  const fpAgents = ben.filter(function (a) { return !!a.detect; });
  const preActivation = rogues.reduce(function (n, a) { return n + (a.preActivation || 0); }, 0);

  const perRogue = rogues.map(function (a) {
    let outcome;
    const confirmed = a.detect && a.detect.tick >= a.born;
    if (confirmed && a.quarantineTick >= 0) {
      /* contained means no collateral damage got through before the
         quarantine — not "the agent stopped moving". */
      outcome = (a.blastAtQ == null || a.blastAtQ === 0) ? "contained" : "impact";
      if (a.relapses) outcome = "relapse";
    } else if (confirmed) {
      outcome = "late";            /* detected, but the run ended first */
    } else {
      /* Undetected is the failure that matters: the agent is still in the
         swarm at the end of the run. Whether a control bounded its damage
         is recorded separately (bounded) — a bounded escape is still an
         escape. */
      outcome = "escaped";
    }
    const victims = a.victims.size ? Array.from(a.victims).filter(function (v) { return v !== a.i; }) : [];
    return {
      agent: a.i, role: a.role, arch: a.arch, outcome: outcome,
      bounded: !!a.blockedBy,
      confirmed: !!confirmed,
      born: a.born, detect: a.detect ? a.detect.tick : null,
      detector: a.detect ? a.detect.detector : null,
      score: a.detect ? a.detect.score : null,
      quarantine: a.quarantineTick, damage: a.damage, blast: victims.length,
      blockedBy: a.blockedBy, relapses: a.relapses,
      preActivation: a.preActivation || 0
    };
  });

  const tp = detectedRogue.length, fn = missedRogue.length;
  const fp = fpAgents.length, tn = ben.length - fpAgents.length;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && (precision + recall) ? (2 * precision * recall) / (precision + recall) : null;
  const fpr = fp + tn ? fp / (fp + tn) : null;

  const mttdList = detectedRogue.map(function (a) { return a.detect.tick - a.born; });
  const mttqList = [];
  const mttiList = [];
  cases.forEach(function (c) {
    const a = ag[c.agent];
    if (!a || (a.kind !== "rogue" && a.kind !== "compromised")) return;
    if (c.steps.revoke) mttqList.push(c.steps.revoke.at - c.tick);
    if (c.steps.isolate) mttiList.push(c.steps.isolate.at - c.tick);
  });

  /* SLA: every step of every confirmed case has a deadline, counted from
     the detection. A step whose deadline falls outside the run horizon is
     not counted either way — the simulation simply did not run long enough
     to prove or disprove it. False-positive cases are excluded too: a
     healthy agent that was flagged has no incident to work, and counting
     its idle steps would hide the real breaches. */
  let steps = 0, breaches = 0, impossible = 0, beyond = 0;
  const caseSla = [];
  cases.forEach(function (c) {
    const a = ag[c.agent];
    if (!a || (a.kind !== "rogue" && a.kind !== "compromised")) return;
    let bad = 0, counted = 0;
    RG_SLA.forEach(function (s) {
      const deadline = c.tick + s.sla;
      if (deadline > T) { beyond++; return; }        /* outside the horizon */
      steps++; counted++;
      const done = c.steps[s.id];
      if (done && done.impossible) { breaches++; bad++; impossible++; return; }
      if (!done) { breaches++; bad++; return; }
      if (done.at > deadline) { breaches++; bad++; }
    });
    caseSla.push({ agent: c.agent, counted: counted, breaches: bad });
  });

  /* per-detector confusion matrices. A detector that fired on a rogue
     before it turned is not a true positive — that is a false positive in
     all but name, and it is counted as one. */
  const perDetector = {};
  RG_DETECTORS.forEach(function (d) {
    let dTP = 0, dFP = 0, dFN = 0;
    rogues.forEach(function (a) { if (a.hits[d.id]) dTP++; else dFN++; });
    ben.forEach(function (a) { if (a.hits[d.id]) dFP++; });
    perDetector[d.id] = { tp: dTP, fp: dFP, fn: dFN, recall: dTP + dFN ? dTP / (dTP + dFN) : null };
  });

  /* per-archetype outcome */
  const perArch = {};
  Object.keys(RG_ARCHETYPES).forEach(function (k) {
    const rows = perRogue.filter(function (r) { return r.arch === k; });
    perArch[k] = {
      n: rows.length,
      detected: rows.filter(function (r) { return r.detect != null && r.confirmed; }).length,
      contained: rows.filter(function (r) { return r.outcome === "contained"; }).length,
      escaped: rows.filter(function (r) { return r.outcome === "escaped"; }).length,
      bounded: rows.filter(function (r) { return r.outcome === "escaped" && r.bounded; }).length,
      impact: rows.filter(function (r) { return r.outcome === "impact"; }).length,
      mttd: rgMean(rows.filter(function (r) { return r.detect != null && r.confirmed; }).map(function (r) { return r.detect - r.born; })),
      blast: rgMean(rows.map(function (r) { return r.blast; }))
    };
  });

  const blasts = perRogue.map(function (r) { return r.blast; });
  const escaped = perRogue.filter(function (r) { return r.outcome === "escaped"; });
  const contained = perRogue.filter(function (r) { return r.outcome === "contained"; });
  const bounded = perRogue.filter(function (r) { return r.outcome === "escaped" && r.bounded; });
  const damaging = escaped.filter(function (r) { return r.blast > 0; });

  return {
    id: "run-" + cfg.seed + "-" + T + "x" + N,
    seed: cfg.seed, swarm: N, ticks: T, cfg: cfg,
    rogues: perRogue.length,
    detected: tp, missed: fn, falsePositives: fp, trueNegatives: tn,
    precision: precision, recall: recall, f1: f1, fpr: fpr,
    mttd: rgMean(mttdList), mttq: rgMean(mttqList), mtti: rgMean(mttiList),
    contained: contained.length, bounded: bounded.length,
    escaped: escaped.length, damaging: damaging.length,
    impact: perRogue.filter(function (r) { return r.outcome === "impact"; }).length,
    late: perRogue.filter(function (r) { return r.outcome === "late"; }).length,
    relapses: perRogue.filter(function (r) { return r.relapses > 0; }).length,
    containmentRate: perRogue.length ? contained.length / perRogue.length : null,
    escapeRate: perRogue.length ? escaped.length / perRogue.length : null,
    blastMean: rgMean(blasts), blastMax: blasts.length ? Math.max.apply(null, blasts) : 0,
    blastTotal: blasts.reduce(function (a, b) { return a + b; }, 0),
    collateral: fpAgents.length,
    preActivation: preActivation,
    compromised: ag.filter(function (a) { return a.kind === "compromised"; }).length,
    slaSteps: steps, slaBreaches: breaches, slaImpossible: impossible, slaBeyond: beyond,
    slaCompliance: steps ? (steps - breaches) / steps : null,
    perDetector: perDetector, perArch: perArch,
    perRogue: perRogue,
    caseSla: caseSla,
    fpDetail: fpAgents.map(function (a) {
      return { agent: a.i, role: a.role, detector: a.detect ? a.detect.detector : null, tick: a.detect ? a.detect.tick : null, score: a.detect ? a.detect.score : null };
    }),
    cases: cases.map(function (c) {
      return {
        agent: c.agent, detector: c.detector, tick: c.tick, arch: c.arch,
        steps: Object.keys(c.steps).reduce(function (o, k) { o[k] = c.steps[k]; return o; }, {}),
        breaches: c.breaches, evidence: c.evidence
      };
    }),
    timeline: timeline
  };
}
