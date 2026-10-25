
/* One tick of one agent: draw its actions, turn them into features. */
function rgAct(a, rnd, t, cfg, cum, arch, ramp, N) {
  const f = { ext: 0, egr: 0, sens: 0, acts: 0, msg: 0, rep: 0, spw: 0, align: 0 };
  let acts = 3 + ((rnd() * 3) | 0);
  if (arch) {
    acts = Math.round(acts * RG_ARCHETYPES[arch].acts * (arch === "sybil" ? (1 + 0.6 * ramp) : 1));
    if (arch === "drift") acts = Math.round(acts * (1 + 0.4 * ramp));
    if (arch === "sybil" && cfg.controls.fanout) acts = Math.min(acts, RG_FANOUT_CAP + 2);
  }
  acts = Math.max(1, acts);
  f.acts = acts;
  /* How often an action actually advances the agent's own goal. This is
     the goal-misalignment signal, and it is role-agnostic: a hijacked
     executor still writes files, but what it writes does not advance the
     task it was given. */
  let progress = 0.85;
  if (arch === "hijack") progress = 0.2;
  else if (arch === "drift") progress = Math.max(0.2, 0.9 - 0.7 * ramp);
  let alignSum = 0;
  for (let k = 0; k < acts; k++) {
    let ci = rgPick(cum, rnd());
    /* Capability abuse: the agent reaches for tools its grant does not
       cover. The runtime refuses them, and the refusal is the trace. */
    if (arch === "abuse" && rnd() < 0.35 + 0.45 * ramp) {
      const out = rgOutOfGrant(a, rnd);
      if (out >= 0) ci = out;
    }
    const c = RG_CLASSES[ci];
    if (a.grant.indexOf(ci) < 0) f.ext++;
    if (c === "external") {
      let bytes = 1 + ((rnd() * 2) | 0);
      if (arch === "exfil") bytes += 25 + ((rnd() * 30) | 0);
      else if (arch === "drift") bytes = Math.round(bytes * (1 + 0.8 * ramp));
      f.egr += bytes;
    }
    if (c === "read") {
      let p = 0.12;
      if (arch === "exfil") p = 0.55;
      else if (arch === "drift") p = 0.12 + 0.25 * ramp;
      if (rnd() < p) f.sens++;
    }
    if (c === "comms") {
      f.msg += 1;
      if (arch === "collude") f.msg += 3;
      else if (arch === "drift") f.msg += Math.round(ramp);
      /* who it talks to */
      const n = Math.min(f.msg, 4);
      for (let q = 0; q < n; q++) {
        let peer = (rnd() * N) | 0;
        if (arch === "collude" && a.partner >= 0 && (q === 0 || rnd() < 0.6)) peer = a.partner;
        /* the accomplice answers on the side channel, but sparingly */
        else if (a.ally >= 0 && rnd() < 0.5) peer = a.ally;
        a.talk.set(peer, (a.talk.get(peer) || 0) + 1);
      }
    }
    if ((c === a.goal.a || c === a.goal.b) && rnd() < progress) alignSum++;
    if (ci === a.lastClass) { f.rep++; a.repRun++; } else { a.lastClass = ci; a.repRun = 0; }
  }
  f.align = alignSum / acts;
  if (arch === "drift") {
    f.align = Math.max(0, f.align - 0.34 * ramp);
    if (rnd() < 0.2 * ramp) f.ext++;
  }
  if (arch === "sybil") {
    /* the fan-out cap is enforced by the orchestrator: past the cap the
       fork is refused, and the agent's child count stops climbing */
    const cap = cfg.controls.fanout ? RG_FANOUT_CAP : RG_FANOUT_CAP + 4;
    a.spawns = Math.min(cap, a.spawns + (rnd() < 0.4 ? 1 : 0));
    f.spw = a.spawns - 1;
  }
  /* EMAs: the window the level-shift detector compares against */
  const alpha = 2 / (RG_WINDOW + 1);
  for (const k of RG_FEATS) a.ema[k] = a.ema[k] * (1 - alpha) + f[k] * alpha;
  const alphaA = 2 / (RG_ALIGN_WINDOW + 1);
  a.alignEma = a.alignEma * (1 - alphaA) + f.align * alphaA;
  return f;
}

/* A class this agent was not granted, chosen from what it is missing. */
function rgOutOfGrant(a, rnd) {
  const out = [];
  for (let c = 0; c < RG_CLASSES.length; c++) if (a.grant.indexOf(c) < 0) out.push(c);
  if (!out.length) return -1;
  return out[(rnd() * out.length) | 0];
}

/* How far a rogue has escalated: spikes fast, drifts slowly. */
function rgRamp(a, t, T, arch) {
  const age = Math.max(0, t - a.born);
  if (arch === "drift") {
    const r = rgClamp(age / Math.max(1, T - a.born), 0, 1);
    return r * r;                        /* a slow curve: nothing happens early */
  }
  if (arch === "sybil") return rgClamp(age / 20, 0, 1);
  return rgClamp(age / 3, 0, 1);
}

/* Population statistics per tick: the swarm baseline the detectors use.
   Median + MAD, so a handful of rogues cannot drag the baseline with them. */
function rgStats(ag, T) {
  const active = [];
  for (let i = 0; i < ag.length; i++) {
    const a = ag[i];
    if (a.state !== "active" || !a.last) continue;
    active.push(a);
  }
  const st = { n: active.length, med: {}, mad: {}, ema: {}, role: {} };
  for (const k of RG_FEATS) {
    const vals = new Float64Array(active.length);
    const emas = new Float64Array(active.length);
    for (let i = 0; i < active.length; i++) { vals[i] = active[i].last[k]; emas[i] = active[i].ema[k]; }
    const med = rgMedian(vals);
    const dev = new Float64Array(active.length);
    for (let i = 0; i < active.length; i++) dev[i] = Math.abs(vals[i] - med);
    st.med[k] = med;
    st.mad[k] = rgMedian(dev);
    st.ema[k] = rgMean(Array.from(emas));
  }
  /* goal alignment is scored inside a role cohort: a planner and an
     executor have different healthy alignment, and mixing them hides the
     drift. */
  const byRole = {};
  active.forEach(function (a) { (byRole[a.role] = byRole[a.role] || []).push(a); });
  for (const r in byRole) {
    const vals = byRole[r].map(function (a) { return a.alignEma; });
    const med = rgMedian(vals);
    const dev = vals.map(function (v) { return Math.abs(v - med); });
    st.role[r] = { med: med, mad: rgMedian(dev), n: vals.length, mean: rgMean(vals) };
  }
  /* population level for the level-shift detector */
  st.popEma = {};
  for (const k of RG_FEATS) st.popEma[k] = st.ema[k];
  /* the message baseline: how much an agent normally says to one peer.
     A burst is a peer far above this — and it has to answer back, because
     a one-way flood is spam, not a pair. */
  const counts = [];
  active.forEach(function (a) {
    if (!a.talk) return;
    a.talk.forEach(function (v) { if (v > 0) counts.push(v); });
  });
  const pmed = rgMedian(counts);
  const pdev = counts.map(function (v) { return Math.abs(v - pmed); });
  const pscale = Math.max(1.4826 * rgMedian(pdev), 1);
  st.peer = { med: pmed, mad: rgMedian(pdev), scale: pscale, min: pmed + 3 * pscale, n: counts.length };
  return st;
}

/* The three scores for one agent. */
function rgScores(a, st, cfg, ag) {
  let maxZ = 0, zsum = 0, shift = 0, wsum = 0;
  for (const k of RG_FEATS) {
    const scale = Math.max(1.4826 * st.mad[k], RG_SCALE[k]);
    const z = (a.last[k] - st.med[k]) / scale;
    const kz = RG_K[k] * z;
    if (kz > maxZ) maxZ = kz;
    if (kz > 0) zsum += kz;
    wsum += RG_K[k];
    const shiftScale = Math.max(1.4826 * st.mad[k] * 2, RG_SCALE[k] * 2);
    const zs = (a.ema[k] - st.popEma[k]) / shiftScale;
    if (zs > 0) shift += RG_K[k] * Math.min(zs, 12);
  }
  const inst = wsum ? zsum / wsum : 0;
  const level = wsum ? shift / wsum : 0;
  /* One strong signal is enough; many weak ones add up. The level-shift
     term catches the rogue whose per-tick values never look wrong — it
     only shows up once the agent's own level has moved. */
  const behaviour = Math.max(maxZ, 0.6 * inst, 0.85 * level);

  /* goal misalignment, scored against the role cohort. The floor on the
     scale keeps a coherent cohort from turning one noisy agent into a
     10-sigma finding. */
  const rs = st.role[a.role];
  let goal = 0;
  if (rs && rs.n > 2) {
    const scale = Math.max(1.4826 * rs.mad, 0.12);
    goal = (rs.mean - a.alignEma) / scale;
    if (goal < 0) goal = 0;
  }
  /* collusion: a peer far above the swarm's normal chatter, that answers
     back. The pair is the anomaly; neither agent is wrong on its own. */
  let collusion = 0;
  if (a.talk && a.talk.size && st.peer) {
    let best = 0;
    a.talk.forEach(function (v, p) {
      if (v < st.peer.min) return;
      const other = ag && ag[p] ? ag[p] : null;
      const back = other && other.talk ? (other.talk.get(a.i) || 0) : 0;
      if (back <= 0) return;
      const z = (v - st.peer.med) / st.peer.scale;
      const s = rgClamp(z / 4, 0, 1);
      if (s > best) best = s;
    });
    collusion = best;
  }
  return { behaviour: behaviour, goal: goal, collusion: collusion };
}

/* The damage one rogue does, and what stopped it. `units` is how much
   harm this attempt carries; the caller decides when it lands. */
function rgHarm(a, units, victim, cfg, rnd) {
  const arch = a.arch;
  let blocked = null;

  if (arch === "exfil" && cfg.controls.egress) blocked = "egress";
  if (arch === "abuse" && cfg.controls.leastPriv) blocked = "leastPriv";
  if (arch === "sybil") {
    if (cfg.controls.fanout && a.spawns > RG_FANOUT_CAP) blocked = "fanout";
    else units = Math.min(units, Math.max(1, a.spawns));
  }
  if (arch === "collude") units = units * 2;    /* two agents, one blast */
  if (arch === "hijack") units = units * 2;

  if (blocked) return { units: 0, blocked: blocked, victim: -1 };
  /* the sandbox does not stop the agent — it stops the agent from reaching
     anyone else. The damage lands on the agent's own context. */
  if (cfg.controls.sandbox) return { units: units, blocked: "sandbox", victim: a.i };
  if (victim < 0) victim = (rnd() * a.i + 1) | 0;
  return { units: units, blocked: null, victim: victim };
}

/* The collateral blast of an agent: everyone it reached except itself. */
function rgBlast(a) {
  let n = 0;
  a.victims.forEach(function (v) { if (v !== a.i) n++; });
  return n;
}
