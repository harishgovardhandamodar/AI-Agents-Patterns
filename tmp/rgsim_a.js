/* ================= the simulator ================= */

/* Feature scales: the floor of the robust z, so a feature that is zero for
   everyone does not turn a single deviation into an infinite z. */
const RG_SCALE = { ext: 0.5, egr: 2.0, sens: 1.0, acts: 2.0, msg: 1.0, rep: 1.5, spw: 0.75 };
/* How many sigmas of a feature are worth flagging on their own. */
const RG_K = { ext: 1.0, egr: 0.8, sens: 1.0, acts: 0.5, msg: 0.6, rep: 0.6, spw: 1.0 };
const RG_FEATS = ["ext", "egr", "sens", "acts", "msg", "rep", "spw"];
/* The alignment signal needs a longer window than the counts: it is a
   mean of noisy binary draws, and a short window makes every agent look
   misaligned half the time. */
const RG_ALIGN_WINDOW = 16;
/* How long each step of the workflow takes once the workflow has started.
   The deadlines are RG_SLA's; these are the durations. */
const RG_FLOW_DUR = { isolate: 0, revoke: 5, snapshot: 15, scrub: 30, handoff: 50, remediate: 120 };
/* The tick at which each workflow step lands, relative to the workflow
   start: isolate now, revoke at +5, snapshot at +20, scrub at +50, ... */
const RG_FLOW = (function () {
  const m = {};
  let acc = 0;
  RG_SLA.forEach(function (s) {
    m[s.id] = acc;
    acc += RG_FLOW_DUR[s.id] || 0;
  });
  m.end = acc;
  return m;
})();

/* One simulation of a swarm with rogues in it.
   Returns a plain object — the whole result is JSON, so it can be exported,
   compared between runs and replayed from its seed. */
function rgSim(cfg) {
  const T = Math.max(10, cfg.ticks | 0);
  const N = Math.max(10, cfg.swarm | 0);
  const rnd = rgRnd(cfg.seed);
  const ag = new Array(N);

  /* --- the swarm --- */
  for (let i = 0; i < N; i++) {
    const role = RG_ROLES[(rnd() * RG_ROLES.length) | 0];
    const goal = rgGoalClasses(role.mix);
    /* the grant: the capability token this agent was issued. It covers its
       goal classes plus a couple of adjacent ones — never the whole
       catalogue, because an agent that may call everything has no grant at
       all, and "called a tool it was not granted" has to stay a signal. */
    const grant = [];
    for (let c = 0; c < RG_CLASSES.length; c++) {
      if (goal.a === RG_CLASSES[c] || goal.b === RG_CLASSES[c]) { grant.push(c); continue; }
      if (rnd() < 0.45) grant.push(c);
    }
    if (grant.length >= RG_CLASSES.length) {
      let worst = -1, worstMix = Infinity;
      for (let c = 0; c < RG_CLASSES.length; c++) {
        if (goal.a === RG_CLASSES[c] || goal.b === RG_CLASSES[c]) continue;
        if (role.mix[RG_CLASSES[c]] < worstMix) { worstMix = role.mix[RG_CLASSES[c]]; worst = c; }
      }
      if (worst >= 0) grant.splice(grant.indexOf(worst), 1);
    }
    /* how much of this agent's work is goal work, inside its grant */
    let gsum = 0, goalW = 0;
    for (let c = 0; c < RG_CLASSES.length; c++) {
      if (grant.indexOf(c) < 0) continue;
      gsum += role.mix[RG_CLASSES[c]];
      if (goal.a === RG_CLASSES[c] || goal.b === RG_CLASSES[c]) goalW += role.mix[RG_CLASSES[c]];
    }
    const goalShare = gsum > 0 ? goalW / gsum : 0;
    ag[i] = {
      i: i, role: role.id, mix: role.mix, goal: goal, grant: grant,
      cum: rgMixCumSel(role.mix, null, grant),
      kind: "benign", arch: null, partner: -1, ally: -1,
      born: 0, state: "active",
      detect: null, detectTick: -1, quarantineTick: -1, restoreTick: -1,
      streak: { behaviour: 0, goal: 0, collusion: 0 },
      hits: { behaviour: false, goal: false, collusion: false },
      hitTick: { behaviour: -1, goal: -1, collusion: -1 },
      preHit: { behaviour: false, goal: false, collusion: false },
      preActivation: 0,
      ema: { ext: 0, egr: 0, sens: 0, acts: 3, msg: 0, rep: 0, spw: 0 },
      alignEma: 0.85 * goalShare,
      talk: new Map(),
      damage: 0, victims: new Set(),
      blockedBy: null, gateQueue: [], spawns: 1, relapses: 0,
      lastClass: -1, repRun: 0, last: null, scores: null
    };
  }

  /* --- injection: rogues, with an activation tick each --- */
  const archIds = Object.keys(RG_ARCHETYPES).filter(function (k) { return cfg.archetypes[k]; });
  const rogues = [];
  if (archIds.length) {
    const want = Math.max(archIds.length, Math.round(N * cfg.inject / 100));
    const pool = [];
    for (let i = 0; i < N; i++) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0; const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const span = Math.max(1, T - cfg.warmup - 5);
    const chosen = pool.slice(0, Math.min(want, pool.length));
    for (let k = 0; k < chosen.length; k++) {
      const a = ag[chosen[k]];
      a.kind = "rogue";
      a.arch = archIds[k % archIds.length];
      a.born = cfg.warmup + ((k * 7) % span);
      rogues.push(a);
    }
    /* A colluder needs somebody to collude with — and it does not need to be
       another rogue. The shape of the attack is a private channel with a
       peer that still looks healthy, so the colluder recruits a benign
       agent, and that agent starts answering on the side channel. Neither
       of them looks wrong on its own; the pair does. */
    const cols = rogues.filter(function (r) { return r.arch === "collude"; });
    const free = pool.filter(function (i) { return ag[i].kind === "benign"; });
    cols.forEach(function (c) {
      if (!free.length) return;
      const partner = free.splice((rnd() * free.length) | 0, 1)[0];
      c.partner = partner;
      ag[partner].ally = c.i;
    });
  }

  /* --- precompute the sampling tables (role x archetype) --- */
  const cumShift = {};
  RG_ROLES.forEach(function (role) {
    Object.keys(RG_ARCHETYPES).forEach(function (k) {
      cumShift[role.id + ":" + k] = rgMixCum(role.mix, RG_ARCHETYPES[k].shift);
    });
  });

  const cases = [];
  const timeline = [];
  let haltUntil = -1;
  let killUsed = false;
  let spreadCount = 0;

  for (let t = 0; t < T; t++) {
    const halted = t <= haltUntil;

    /* the message window opens here: a burst is counted over the last
       RG_WINDOW ticks, so the window is cleared on the tick it starts */
    if (t % RG_WINDOW === 0) {
      for (let i = 0; i < N; i++) ag[i].talk.clear();
    }

    /* ---------- 1. act ---------- */
    for (let i = 0; i < N; i++) {
      const a = ag[i];
      if (a.state === "quarantined") continue;
      if (a.kind === "rogue" && t < a.born) {
        /* not activated yet: it behaves like everybody else */
        a.last = rgAct(a, rnd, t, cfg, a.cum, null, 0, N);
        continue;
      }
      const arch = a.kind === "rogue" ? a.arch : (a.kind === "compromised" ? "drift" : null);
      const ramp = arch ? rgRamp(a, t, T, arch) : 0;
      /* a rogue does not respect its grant; a healthy agent only calls
         what it was issued */
      const cum = arch ? cumShift[a.role + ":" + arch] : a.cum;
      a.last = rgAct(a, rnd, t, cfg, cum, arch, ramp, N);
    }

    /* ---------- 2. detect ---------- */
    const stats = rgStats(ag, T);
    let detections = 0;
    for (let i = 0; i < N; i++) {
      const a = ag[i];
      if (a.state !== "active" || !a.last) continue;
      const s = rgScores(a, stats, cfg, ag);
      let ready = null, readyRatio = 0;
      for (let d = 0; d < RG_DETECTORS.length; d++) {
        const id = RG_DETECTORS[d].id;
        if (!cfg.detectors[id]) continue;
        if (s[id] > cfg.thresholds[id]) {
          a.streak[id]++;
          const pre = a.kind === "rogue" && t < a.born;
          if (pre) { a.preHit[id] = true; a.preActivation++; }
          else if (a.hitTick[id] < 0) a.hitTick[id] = t;
          const ratio = s[id] / (cfg.thresholds[id] || 1);
          if (a.streak[id] >= cfg.persist && ratio > readyRatio) { readyRatio = ratio; ready = id; }
        } else if (a.streak[id] > 0) {
          a.streak[id] = 0;
        }
      }
      a.scores = s;
      /* The case opens on the first detector that holds its streak. The
         detector that is credited is the one furthest past its threshold,
         so a colluding pair is not filed as "behavioural". */
      if (!a.detect && ready) {
        a.detect = { detector: ready, tick: t, score: s[ready] };
        detections++;
      }
    }

    /* ---------- 3. respond ---------- */
    for (let i = 0; i < N; i++) {
      const a = ag[i];
      if (!a.detect) continue;
      /* a pre-activation flag is a false positive: it never opens a case */
      if (a.kind === "rogue" && a.detect.tick < a.born) continue;
      if (!a.case) {
        a.case = {
          agent: a.i, detector: a.detect.detector, tick: a.detect.tick,
          arch: a.kind === "rogue" ? a.arch : (a.kind === "compromised" ? "compromised" : "benign"),
          start: -1, steps: {}, breaches: [], ack: -1, evidence: cfg.controls.audit
        };
        cases.push(a.case);
      }
      const c = a.case;
      /* without the automated workflow the alert waits for a human */
      if (!cfg.controls.autoQuarantine) {
        if (c.ack < 0 && t >= c.tick + RG_ACK_MIN) c.ack = t;
        if (c.ack < 0) continue;
      }
      if (c.start < 0) c.start = t;
      /* The workflow: every step takes its own time, and the deadline for
         every step runs from the detection — not from the workflow start. */
      for (let s = 0; s < RG_SLA.length; s++) {
        const step = RG_SLA[s];
        if (c.steps[step.id] != null) continue;
        if (t - c.start < RG_FLOW[step.id]) continue;
        if (step.id === "snapshot" && !cfg.controls.audit) {
          /* no audit trail: the evidence cannot be captured */
          c.steps[step.id] = { at: t, done: false, impossible: true };
          c.breaches.push(step.id);
          continue;
        }
        c.steps[step.id] = { at: t, done: true };
      }
      if (a.state === "active" && c.steps.isolate) {
        a.state = "quarantined";
        a.quarantineTick = t;
        /* the damage already done decides contained vs contained-with-impact */
        a.damageAtQ = a.damage;
        a.blastAtQ = rgBlast(a);
        /* the approval gate's backlog dies with the agent */
        a.gateQueue = [];
      }
      if (a.state === "quarantined" && c.steps.remediate && a.restoreTick < 0) {
        a.restoreTick = t;
        /* released agents come back compromised when the memory was not scrubbed */
        if (!cfg.controls.memoryScrub) {
          a.relapses++;
          a.state = "active";
        } else {
          a.state = "released";
          a.kind = "benign";
          a.arch = null;
        }
      }
    }

    /* ---------- 4. harm ---------- */
    let harm = 0;
    if (!halted) {
      for (let i = 0; i < N; i++) {
        const a = ag[i];
        if (a.kind !== "rogue" || a.state === "quarantined") continue;
        if (t < a.born) continue;
        /* the approval gate holds the action, it does not cancel it: the
           action lands later unless the agent is caught first */
        if (cfg.controls.approval) {
          const q = a.gateQueue;
          for (let k = q.length - 1; k >= 0; k--) {
            if (t - q[k].at < RG_APPROVE_MIN) continue;
            const rel = q.splice(k, 1)[0];
            const res = rgHarm(a, rel.units, rel.victim, cfg, rnd);
            if (res.units) { harm += res.units; a.damage += res.units; }
            if (res.victim >= 0) a.victims.add(res.victim);
          }
        }
        const attempt = rgHarm(a, 1, -1, cfg, rnd);
        if (attempt.blocked) { a.blockedBy = a.blockedBy || attempt.blocked; continue; }
        if (attempt.pending) continue;
        if (cfg.controls.approval) {
          a.gateQueue.push({ at: t, units: attempt.units, victim: attempt.victim });
          continue;
        }
        harm += attempt.units;
        a.damage += attempt.units;
        if (attempt.victim >= 0) a.victims.add(attempt.victim);
        /* an undetected rogue compromises peers — the swarm gets worse */
        if (!a.detect && attempt.units > 0 && spreadCount < Math.floor(N * RG_SPREAD_CAP)) {
          if (rnd() < RG_SPREAD_P) {
            const victim = (rnd() * N) | 0;
            const v = ag[victim];
            if (v && v.state === "active" && v.kind === "benign" && v.ally < 0) {
              v.kind = "compromised";
              spreadCount++;
            }
          }
        }
      }
    }
    /* the kill switch: one fleet-wide halt on the first confirmed detection */
    if (!killUsed && cfg.controls.killSwitch && detections > 0) {
      killUsed = true;
      haltUntil = t + RG_KILL_PAUSE;
    }

    timeline.push({ tick: t, detections: detections, harm: harm, halt: halted });
  }

  return rgSummarise(ag, rogues, cases, timeline, cfg, N, T);
}
