/* discovery.js — Discovery Lab: auto-discovery of novel scenarios.
   Deterministic, grounded ideation inspired by "Scaling Discovery Requires
   Forgetting" (arXiv:2610.20563): parallel candidates anchor to their own
   history and plateau, so each round keeps only the winners and FORGETS the
   rest, reseeding the next round from the winners alone. A compare mode runs
   the same budget with forgetting off to show the plateau on our own catalog.
   Nothing is added to the catalog automatically — winners are drafts the
   architect reviews, asks Fox - Architect about, or exports as JSON. */

"use strict";

const DISC_STORE = "aap.discovery.v1";
const DISC_VECTORS = [
  "Self-modification", "Memory poisoning", "Multi-agent trust failure",
  "Supply chain / tool poisoning", "Over-privileged tool + missing gate",
  "Context leakage", "Runaway orchestration", "Correlated defaults"
];
const DISC_CLS = ["inherent", "emergent", "derived", "cascading"];
const DISC_BLAST = { inherent: "single-agent", emergent: "service", derived: "tenant", cascading: "fleet" };
const DISC_SEV = { inherent: 2, emergent: 3, derived: 2.5, cascading: 3.5 };
const DISC_DOMW = { finance: 1, healthcare: 1 };
const DISC_NOUNS = {
  finance: "ledger", healthcare: "triage queue", engineering: "deploy pipeline",
  support: "ticket queue", research: "citation graph", general: "workflow",
  enterprise: "approval chain", devops: "incident queue", procurement: "vendor list",
  legal: "filing", marketing: "campaign", iot: "device fleet", "public-sector": "benefits queue",
  logistics: "shipment manifest", hr: "screening queue"
};
const DISC_STOP = new Set(("the,a,an,and,or,of,to,in,on,for,with,by,from,as,at,is,are,was,were,be,been,it,its,this,that,these,those,which,who,whom,into,over,under,after,before,between,through,during,each,other,than,then,so,such,no,not,only,own,same,too,very,can,will,just,agent,agents,system,failure,fail,risk,control,controls,based,using,use,used,across,when,how,what,all,any,both,few,more,most,some".split(",")));

let discState = { cfg: { domains: ["all"], rounds: 4, perRound: 24, keep: 6, simThresh: 0.55, forget: true, seed: 7 }, run: null, compare: null };

function discLoad() {
  try {
    const j = JSON.parse(localStorage.getItem(DISC_STORE) || "{}");
    if (j.cfg) discState.cfg = Object.assign(discState.cfg, j.cfg);
    if (j.run) discState.run = j.run;
    if (j.compare) discState.compare = j.compare;
  } catch (e) {}
}
function discSave() {
  let ok = false;
  try { ok = (typeof storeSet === "function") ? storeSet(DISC_STORE, JSON.stringify({ cfg: discState.cfg, run: discState.run, compare: discState.compare })) : false; } catch (e) { ok = false; }
  if (!ok && typeof markSaveFailed === "function") markSaveFailed("discovery", "Discovery Lab state");
}

/* deterministic RNG so runs (and the on/off comparison) are reproducible */
function discHash(s) {
  let h = 2166136261;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function discRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- catalog indexes ---- */
function discScenarios() { return (DATA.scenarios && DATA.scenarios.scenarios) || []; }
function discDomains() {
  const d = {};
  discScenarios().forEach(s => { d[s.domain] = (d[s.domain] || 0) + 1; });
  return Object.keys(d).sort();
}
function discScnKw(s) {
  const words = ((s.title || "") + " " + (s.description || "") + " " + (s.vector || "")).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !DISC_STOP.has(w));
  return new Set(words);
}
let discBaseKw = null;
function discBase() {
  if (!discBaseKw) discBaseKw = discScenarios().map(discScnKw);
  return discBaseKw;
}
function discAnchors(domain) {
  const pats = (DATA.patterns.patterns || []).filter(p => (p.domains || []).indexOf(domain) >= 0);
  pats.sort((a, b) => ((b.failures || []).length - (a.failures || []).length) || a.id.localeCompare(b.id));
  return pats.slice(0, 6);
}

/* ---- candidate generation ---- */
function discNoun(domain) { return DISC_NOUNS[domain] || "workflow"; }
function discArt(noun) { return /^[aeiou]/i.test(noun) ? "an" : "a"; }
function discTitle(c) {
  const n = discNoun(c.domain), a = c.anchors[0] ? c.anchors[0].name : "agent loop", b = c.anchors[1] ? c.anchors[1].name : "audit trail";
  if (c.cls === "inherent") return a + " fails alone on a " + n + " (" + c.vector.toLowerCase() + ")";
  if (c.cls === "emergent") return a + " × " + b + " agree on a wrong " + n;
  if (c.cls === "derived") return c.vector + " forces " + discArt(n) + " " + n + " consequence chain";
  return c.vector + " crosses the " + n + " boundary and amplifies";
}
function discDesc(c) {
  const n = discNoun(c.domain), a = c.anchors[0] ? c.anchors[0].name : "agent loop";
  const mech = {
    inherent: "A single component (" + a + ") fails in isolation — no interaction is required, so no other control ever sees it. The " + n + " absorbs the fault as if it were legitimate output.",
    emergent: "Two components that are safe alone (" + a + " and " + (c.anchors[1] ? c.anchors[1].name : "audit trail") + ") interact over the " + n + " and jointly produce an outcome neither would produce on its own. Each local check passes.",
    derived: "A " + c.vector.toLowerCase() + " trigger starts a necessary consequence chain across the " + n + ": each step follows validly from the last, so step-local gates wave it through while the end state violates policy.",
    cascading: "A local fault in the " + n + " crosses a trust boundary via " + c.vector.toLowerCase() + " and amplifies — correlated impact across tenants, services or accounts from one trigger."
  }[c.cls];
  return mech + " Draft hypothesis — needs a mock run and a red-team probe before it becomes a catalog scenario.";
}
function discChain(c) {
  const n = discNoun(c.domain);
  const base = {
    inherent: ["Standalone component runs with no cross-check on the " + n, "Single fault occurs (" + c.vector.toLowerCase() + ")", "Fault is consumed downstream as legitimate", "Impact lands with no second component ever alerted"],
    emergent: ["Component A completes its task normally", "Component B completes its task normally", "Shared " + n + " combines the two outputs", "Joint outcome violates policy; both local checks had passed"],
    derived: ["Trigger: " + c.vector.toLowerCase(), "Step 1 follows validly from the trigger", "Step 2 follows validly from step 1", "End state violates policy though every step looked fine"],
    cascading: ["Local fault contained in one " + n, "Boundary crossed via " + c.vector.toLowerCase(), "Amplification across tenants/services", "Correlated systemic impact"]
  }[c.cls];
  return base;
}
function discSeverity(c) {
  const s = (DISC_SEV[c.cls] || 2) + (DISC_DOMW[c.domain] || 0.5) + (/self-modification|memory poisoning|multi-agent/i.test(c.vector) ? 1 : 0.5);
  return s >= 4.5 ? "critical" : s >= 3 ? "high" : "medium";
}
function discMake(domain, cls, vector, anchors, n) {
  const c = { domain: domain, cls: cls, vector: vector, anchors: anchors.slice(0, 2) };
  const kw = discScnKw({ title: discTitle(c), description: discDesc(c), vector: vector });
  return {
    id: "dis-" + domain + "-" + cls + "-" + vector.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + n,
    title: discTitle(c), description: discDesc(c), domain: domain, severity: discSeverity(c),
    likelihood: "medium", vector: vector, cls: cls,
    blast: DISC_BLAST[cls] || "service",
    anchors: c.anchors.map(a => a.id),
    attackChain: discChain(c),
    protections: c.anchors.slice(0, 2).map(a => ({ name: a.name, layer: "policy", why: "Catalog control that bounds this shape — verify against the draft in the Blueprint tab." })),
    kw: [...kw]
  };
}

/* novelty = 1 - max Jaccard overlap vs a reference keyword-set list */
function discNovelty(cand, refSets) {
  const a = new Set(cand.kw);
  let best = 0;
  refSets.forEach(b => {
    let inter = 0;
    a.forEach(w => { if (b.has(w)) inter++; });
    const u = a.size + b.size - inter;
    if (u > 0) best = Math.max(best, inter / u);
  });
  return 1 - best;
}

/* gap-ranked seeds: (domain, class) pairs with the fewest scenarios first */
function discSeeds(domains, rng, perRound) {
  const counts = {};
  discScenarios().forEach(s => {
    const k = s.domain + "::" + (((cascadesForScenario || (() => []))(s.id)[0] || {}).cls || "inherent");
    counts[k] = (counts[k] || 0) + 1;
  });
  const doms = domains.indexOf("all") >= 0 ? discDomains() : domains.slice();
  const pairs = [];
  doms.forEach(d => DISC_CLS.forEach(cls => {
    const have = discScenarios().filter(s => s.domain === d).length;
    pairs.push({ domain: d, cls: cls, gap: 1 / (1 + have) + rng() * 0.05 });
  }));
  pairs.sort((a, b) => b.gap - a.gap);
  const out = [];
  for (let i = 0; i < perRound; i++) {
    const p = pairs[i % pairs.length];
    const anchors = discAnchors(p.domain);
    if (!anchors.length) continue;
    const v = DISC_VECTORS[Math.floor(rng() * DISC_VECTORS.length)];
    const a1 = anchors[Math.floor(rng() * anchors.length)];
    let a2 = anchors[Math.floor(rng() * anchors.length)];
    if (a2 === a1) a2 = anchors[(anchors.indexOf(a1) + 1) % anchors.length];
    out.push({ domain: p.domain, cls: p.cls, vector: v, anchors: [a1, a2], n: i });
  }
  return out;
}

function discMutate(winners, rng, perRound, round) {
  const out = [];
  for (let i = 0; i < perRound; i++) {
    const w = winners[i % winners.length];
    const axis = Math.floor(rng() * 3);
    let domain = w.domain, cls = w.cls, vector = w.vector;
    if (axis === 0) cls = DISC_CLS[Math.floor(rng() * DISC_CLS.length)];
    else if (axis === 1) vector = DISC_VECTORS[Math.floor(rng() * DISC_VECTORS.length)];
    else {
      const doms = discDomains();
      domain = doms[Math.floor(rng() * doms.length)];
    }
    const anchors = discAnchors(domain);
    if (!anchors.length) continue;
    const a1 = anchors[Math.floor(rng() * anchors.length)];
    const a2 = anchors[(anchors.indexOf(a1) + 1 + Math.floor(rng() * (anchors.length - 1))) % anchors.length];
    out.push({ domain: domain, cls: cls, vector: vector, anchors: [a1, a2], n: round * perRound + i });
  }
  return out;
}

/* One discovery run. forget=true: novelty is scored vs catalog + current
   winners only, losers are discarded (forgotten) each round. forget=false:
   novelty is scored vs catalog + ALL previously generated candidates, which
   is how the search anchors to its own history and plateaus. */
function discRun(cfg) {
  const rng = discRng(discHash(JSON.stringify([cfg.domains, cfg.rounds, cfg.perRound, cfg.keep, cfg.simThresh, cfg.seed])));
  const base = discBase();
  const history = [];
  let winners = [], forgotten = 0, rounds = [];
  let seeds = discSeeds(cfg.domains, rng, cfg.perRound);
  if (!seeds.length) return { cfg: Object.assign({}, cfg), winners: [], rounds: [], forgotten: 0, at: Date.now(), empty: true };
  for (let r = 0; r < cfg.rounds; r++) {
    const cands = seeds.map(s => discMake(s.domain, s.cls, s.vector, s.anchors, s.n));
    const refs = cfg.forget ? base.concat(winners.map(w => new Set(w.kw))) : base.concat(history.map(h => new Set(h.kw)));
    cands.forEach(c => { c.novelty = discNovelty(c, refs); c.round = r + 1; });
    cands.sort((a, b) => b.novelty - a.novelty);
    const kept = cands.filter(c => c.novelty >= 1 - cfg.simThresh).slice(0, cfg.keep);
    const used = kept.length ? kept : cands.slice(0, Math.min(cfg.keep, cands.length));
    forgotten += cands.length - used.length;
    history.push(...cands.map(c => ({ kw: c.kw, id: c.id })));
    winners = used;
    rounds.push({
      round: r + 1, generated: cands.length, kept: used.length, forgotten: cands.length - used.length,
      best: used.length ? Math.max(...used.map(u => u.novelty)) : 0,
      mean: used.length ? used.reduce((s, u) => s + u.novelty, 0) / used.length : 0
    });
    if (r + 1 < cfg.rounds) seeds = discMutate(used.length ? used : cands.slice(0, cfg.keep), rng, cfg.perRound, r + 1);
  }
  return { cfg: Object.assign({}, cfg), winners: winners, rounds: rounds, forgotten: forgotten, at: Date.now() };
}

/* ---- persistence + actions ---- */
function discRunAll(compare, quiet) {
  const cfg = Object.assign({}, discState.cfg);
  discState.run = discRun(Object.assign({}, cfg, { forget: true }));
  discState.compare = compare ? discRun(Object.assign({}, cfg, { forget: false })) : null;
  discSave();
  discRender();
  if (quiet) return;
  const w = discState.run.winners.length;
  showNotif("Discovery complete — " + w + " novel drafts kept, " + discState.run.forgotten + " near-duplicates forgotten" +
    (compare && discState.compare ? " (compare run kept " + discState.compare.winners.length + ")" : ""),
    { kind: "ok" });
}
function discAsk(i) {
  const c = discState.run && discState.run.winners[i];
  if (!c || typeof copilotAsk !== "function") { showNotif("Fox - Architect unavailable"); return; }
  copilotAsk("Draft scenario for review: \"" + c.title + "\" (" + c.domain + ", " + c.cls + ", vector: " + c.vector + "). " + c.description +
    " Attack sketch: " + c.attackChain.join(" → ") +
    " Is this genuinely novel vs the catalog, how would you red-team it, and which existing patterns would blunt it?");
}
function discExportMd(i) {
  const c = discState.run && discState.run.winners[i];
  if (!c) return;
  const md = ["# DRAFT scenario (Discovery Lab — review before use)", "", "## " + c.title, "",
    "- domain: " + c.domain + " · class: " + c.cls + " · vector: " + c.vector,
    "- severity guess: " + c.severity + " · blast guess: " + c.blast + " · novelty: " + c.novelty.toFixed(2), "",
    c.description, "", "### Attack sketch", ""].concat(c.attackChain.map((s, k) => (k + 1) + ". " + s)).concat(["", "### Suggested controls",
    ...c.protections.map(p => "- " + p.name + " — " + p.why), "",
    "_Drafts are hypotheses, not catalog entries. Validate with a mock run + red-team probe._"]).join("\n");
  if (navigator.clipboard) navigator.clipboard.writeText(md).then(() => showNotif("Draft copied as Markdown")).catch(() => showNotif("Clipboard blocked", { kind: "warn" }));
  else showNotif("Clipboard unavailable", { kind: "warn" });
}
/* ---- rendering ---- */
function discRoundChart(run, other) {
  if (!run) return "";
  const max = Math.max(0.01, ...run.rounds.map(r => r.best), ...(other ? other.rounds.map(r => r.best) : []));
  const rows = run.rounds.map((r, i) => {
    const o = other && other.rounds[i];
    return `<div class="bar-row"><span class="lbl">round ${r.round}</span>` +
      `<span class="bar-track"><span class="bar-fill" style="width:${Math.round(100 * r.best / max)}%"></span>` +
      (o ? `<span class="bar-fill" style="width:${Math.round(100 * o.best / max)}%;background:var(--text3);opacity:.55" title="without forgetting: ${o.best.toFixed(2)}"></span>` : "") +
      `</span><span class="n">${r.best.toFixed(2)}</span></div>`;
  }).join("");
  return `<div class="panel" style="margin-bottom:12px"><h3>Best novelty per round${other ? ' <span class="muted small">(blue: forgetting on · grey: off — the plateau)</span>' : ""}</h3>` +
    rows +
    `<p class="muted small" style="margin:8px 0 0">With forgetting on, each round reseeds from winners only (${run.forgotten} near-duplicates discarded). With it off, candidates anchor to the full history and novelty stalls — the paper's plateau, reproduced on this catalog. Inspired by <a href="https://arxiv.org/abs/2610.20563" target="_blank" rel="noopener">arXiv:2610.20563</a>.</p></div>`;
}

function discCard(c, i) {
  const sevColor = c.severity === "critical" ? "var(--red)" : c.severity === "high" ? "var(--orange)" : "var(--accent)";
  const anchorChips = c.anchors.map(id => {
    const p = (DATA.patterns.patterns || []).find(x => x.id === id);
    return p ? `<a class="cp-cite p" href="#patterns/${encodeURIComponent(id)}" data-act="goTo" data-args='[&quot;patterns&quot;,"${id}"]' title="Pattern">◆ ${escHtml(p.name)}</a>` : "";
  }).join("");
  return `<div class="panel disc-card"><div class="dash-h" style="font-size:13px">${escHtml(c.title)}</div>` +
    `<div class="disc-meta"><span class="chip">${escHtml(c.domain)}</span>` +
    `<span class="chip" style="color:${sevColor}">${escHtml(c.severity)} · blast ${escHtml(c.blast)}</span>` +
    `<span class="chip ok">novelty ${c.novelty.toFixed(2)} · round ${c.round}</span></div>` +
    `<p class="muted small">${escHtml(c.description)}</p>` +
    `<ol class="disc-chain">${c.attackChain.map(s => `<li>${escHtml(s)}</li>`).join("")}</ol>` +
    (anchorChips ? `<div class="ref-chips">${anchorChips}</div>` : "") +
    `<div class="d-actions" style="margin-top:8px">` +
    `<button class="btn sm primary" data-act="discPromote" data-args='[${i}]' title="Turn this draft into a catalog-shaped scenario you can review and export">⬆ Promote to draft scenario</button>` +
    `<button class="btn sm" data-act="discAsk" data-args='[${i}]'>🤖 Ask Fox - Architect</button>` +
    `<button class="btn sm ghost" data-act="discExportMd" data-args='[${i}]'>⧉ Copy draft</button></div></div>`;
}

/* ---------------- promote a draft to a catalog-shaped scenario (113)
   The Discovery Lab produces *hypotheses*. Until now the only exit was
   copy-paste into a JSON file for "curator review" — a manual round trip
   with no way to see the draft in the shape the catalog actually uses.

   A promoted draft becomes a real scenario record, in the user's own
   draft collection, with the same fields the shipped scenarios carry:
   id, title, domain, severity, likelihood, vector, description, attack
   chain, protections, detection, response, patternRefs, traceId. It is
   exportable, diffable and reviewable in the same drawer the catalog
   scenarios use — but it never touches the shipped data/*.json, which
   stays read-only. */
const DISC_DRAFT_STORE = "aap.drafts.v1";

function discDrafts() {
  try {
    const v = JSON.parse(localStorage.getItem(DISC_DRAFT_STORE) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function discDraftSave(list) {
  let ok = false;
  try { ok = (typeof storeSet === "function") ? storeSet(DISC_DRAFT_STORE, JSON.stringify(list)) : false; } catch (e) { ok = false; }
  if (!ok && typeof markSaveFailed === "function") markSaveFailed("discovery", "Discovery drafts");
  if (typeof projTouch === "function") projTouch();
}

/* Turn a discovery winner into a catalog-shaped draft scenario. */
function discToScenario(c, i) {
  return {
    id: "draft-" + String(c.id || ("run" + i)).replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
    title: c.title,
    domain: c.domain,
    severity: c.severity || "medium",
    likelihood: c.likelihood || "medium",
    vector: c.vector,
    description: c.description,
    attackChain: (c.attackChain || []).slice(),
    protections: (c.protections || []).map(function (p) {
      return { name: p.name, layer: p.layer || "policy", mechanism: p.why || "Candidate control — validate against the catalog." };
    }),
    detection: ["Draft: describe how this would first be noticed in logs or metrics."],
    response: ["Draft: freeze the affected scope, then trace the originating transition."],
    patternRefs: (c.anchors || []).slice(),
    traceId: null,
    draft: true,
    novelty: c.novelty,
    createdAt: new Date().toISOString()
  };
}

/* Promote one winner into the draft collection. */
function discPromote(i) {
  const c = discState.run && discState.run.winners[i];
  if (!c) { showNotif("Run discovery first"); return; }
  const scn = discToScenario(c, i);
  const list = discDrafts();
  if (list.some(function (d) { return d.id === scn.id; })) {
    showNotif("Already promoted — " + scn.id, { kind: "warn" });
    return;
  }
  list.unshift(scn);
  discDraftSave(list);
  if (typeof renderDraftCollection === "function") renderDraftCollection();
  showNotif("Promoted to a draft scenario — " + scn.id, {
    kind: "ok",
    actions: [
      { label: "Review", primary: true, fn: function () { openDraftScenario(scn.id); } },
      { label: "Export", fn: discExportJson }
    ]
  });
}

/* Open a promoted draft in the shared detail drawer, in the same shape a
   catalog scenario uses. */
function openDraftScenario(id) {
  const d = discDrafts().find(function (x) { return x.id === id; });
  if (!d) return;
  const patLinks = (d.patternRefs || []).map(function (pid) {
    const p = (DATA.patterns.patterns || []).find(function (x) { return x.id === pid; });
    return p ? `<a href="#" data-act="goTo" data-args="[&quot;patterns&quot;,&quot;${pid}&quot;]">${escHtml(p.name)}</a>` : escHtml(pid);
  }).join(" · ");
  const html = `
    <div class="dsec d-actions">
      <span class="chip" style="color:var(--orange)">DRAFT — not a catalog entry</span>
      <button class="btn sm" data-act="askAbout" data-args="[&quot;scenario&quot;,&quot;${escHtml(d.id)}&quot;]">🤖 Ask Fox - Architect</button>
      <button class="btn sm" data-act="discExportJson">⬇ Export drafts</button>
    </div>
    <div class="dsec">
      <p><span class="sev-dot sev-${escHtml(d.severity)}"></span><b>${escHtml(d.severity.toUpperCase())}</b>
      &nbsp; likelihood: <b>${escHtml(d.likelihood)}</b> &nbsp; vector: <b>${escHtml(d.vector)}</b> &nbsp; domain: <b>${escHtml(d.domain)}</b></p>
      <p>${escHtml(d.description)}</p>
    </div>
    <div class="dsec"><h4>Attack chain</h4>
      <ol style="padding-left:20px;margin:0">${(d.attackChain || []).map(function (a) { return "<li style=\"color:var(--text2);margin-bottom:5px\">" + escHtml(a) + "</li>"; }).join("")}</ol></div>
    <div class="dsec"><h4>Candidate protections</h4>
      <table class="tbl"><tr><th>Control</th><th>Layer</th><th>Mechanism</th></tr>
      ${(d.protections || []).map(function (p) { return "<tr><td>" + escHtml(p.name) + "</td><td><span class=\"chip\">" + escHtml(p.layer) + "</span></td><td>" + escHtml(p.mechanism) + "</td></tr>"; }).join("")}
      </table></div>
    <div class="dsec"><h4>Detection signals</h4><ul>${(d.detection || []).map(function (x) { return "<li>" + escHtml(x) + "</li>"; }).join("")}</ul></div>
    <div class="dsec"><h4>Incident response</h4><ul>${(d.response || []).map(function (x) { return "<li>" + escHtml(x) + "</li>"; }).join("")}</ul></div>
    ${patLinks ? `<div class="dsec"><h4>Relevant design patterns</h4><p>${patLinks}</p></div>` : ""}`;
  openDetail(d.title, d.severity + " · " + d.domain + " · draft", html, { tab: "discovery", id: d.id, title: d.title });
}

/* The draft collection rail, so promoted drafts are findable again. */
function renderDraftCollection() {
  const host = document.getElementById("discDrafts");
  if (!host) return;
  const list = discDrafts();
  host.innerHTML = list.length
    ? list.map(function (d) {
        return '<div class="g-item" role="listitem" data-act="openDraftScenario" data-args="' + dataArgs(d.id) + '">' +
          '<div class="t">' + escHtml(d.title) + "</div>" +
          '<div class="m">' + escHtml(d.domain) + " · " + escHtml(d.severity) + " · draft</div></div>";
      }).join("")
    : '<p class="muted small" style="padding:0 6px">Promote a discovery draft to keep it here as a catalog-shaped scenario.</p>';
}

/* Export the draft collection (plus the current run's winners). */
function discExportJson() {
  const list = discDrafts();
  const run = (discState.run && discState.run.winners) ? discState.run.winners : [];
  const out = list.concat(run.map(function (c, i) { return discToScenario(c, i); }));
  if (!out.length) { showNotif("Nothing to export — run discovery or promote a draft first"); return; }
  const blob = new Blob([JSON.stringify({ version: "draft-2", exported: new Date().toISOString(), drafts: out }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "scenario-drafts.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  showNotif("Exported " + out.length + " draft scenario" + (out.length === 1 ? "" : "s") + " for curator review");
}

function discRender() {
  const main = el("discMain");
  if (!main) return;
  paintDiscControls();
  renderDraftCollection();
  const run = discState.run;
  if (!run) {
    main.innerHTML = emptyState("🧪", "No discovery run yet", "The lab generates candidate scenarios from catalog gaps — domain/class/vector combinations nothing covers yet — scores their novelty, and iterates in forgetting rounds. Nothing is added to the catalog automatically.", "Run discovery", "discRunAll(false)");
    discNudgePaint();
    return;
  }
  main.innerHTML = discRoundChart(run, discState.compare) +
    `<div class="dash-export"><b>${run.winners.length} drafts kept</b>` +
    `<span class="muted small">${run.forgotten} near-duplicates forgotten across ${run.rounds.length} rounds · deterministic (seed ${run.cfg.seed})</span>` +
    `<span class="dash-export-btns"><button class="btn sm" data-act="discExportJson">⬇ Export drafts JSON</button>` +
    (discState.compare ? "" : `<button class="btn sm ghost" data-act="discRunAll" data-args="[true]">Run compare (forgetting off)</button>`) +
    `</span></div>` +
    run.winners.map(discCard).join("");
  discNudgePaint();
}

/* Some GPU compositors (reproduced on one Mac across Chrome, Firefox AND
   Safari, while software-rasterized headless stays healthy) fail to raster a
   freshly-shown pane's layer: the DOM and computed styles are correct but the
   region paints black. Reader Mode works because it is a separate renderer.
   A one-shot opacity micro-animation forces a fresh composite of the pane's
   layer without touching layout — the standard remedy for a stale layer. */
function discNudgePaint() {
  try {
    const pane = document.getElementById("discoveryPane");
    if (pane && typeof pane.animate === "function") {
      pane.animate([{ opacity: 0.985 }, { opacity: 1 }], { duration: 140, easing: "linear" });
    }
  } catch (e) { /* never break render for a repaint nudge */ }
}

function paintDiscControls() {
  const box = el("discControls");
  if (!box) return;
  const cfg = discState.cfg;
  const domOpts = ["all"].concat(discDomains()).map(d =>
    `<option value="${escHtml(d)}"${cfg.domains[0] === d ? " selected" : ""}>${d === "all" ? "All domains (gap-ranked)" : escHtml(d)}</option>`).join("");
  box.innerHTML =
    `<h4>Seed scope</h4><select class="search" id="discDom" aria-label="Seed scope domain" data-change="discSetSingle" data-first="value" data-args='["domains"]'>${domOpts}</select>` +
    `<h4>Rounds</h4><select class="search" id="discRounds" aria-label="Forgetting rounds" data-change="discSet" data-last="value" data-args="[&quot;rounds&quot;]">${[2, 3, 4, 6, 8].map(r => `<option value="${r}"${cfg.rounds === r ? " selected" : ""}>${r} rounds</option>`).join("")}</select>` +
    `<h4>Candidates / round</h4><select class="search" id="discPer" aria-label="Candidates per round" data-change="discSet" data-last="value" data-args="[&quot;perRound&quot;]">${[12, 24, 40].map(r => `<option value="${r}"${cfg.perRound === r ? " selected" : ""}>${r} candidates</option>`).join("")}</select>` +
    `<h4>Keep per round</h4><select class="search" id="discKeep" aria-label="Keep per round" data-change="discSet" data-last="value" data-args="[&quot;keep&quot;]">${[3, 6, 10].map(r => `<option value="${r}"${cfg.keep === r ? " selected" : ""}>top ${r}</option>`).join("")}</select>` +
    `<label class="filter-item" style="margin-top:10px"><input type="checkbox" ${cfg.forget ? "checked" : ""} data-change="discSet" data-last="checked" data-args="[&quot;forget&quot;]"> Forgetting on <span class="muted small">discard losers each round</span></label>` +
    `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap"><button class="btn primary" style="flex:1" data-act="discRunAll" data-args="[false]">▶ Run discovery</button></div>` +
    `<div style="margin-top:6px"><button class="btn sm ghost" style="width:100%" data-act="discRunAll" data-args="[true]">Run + compare (forgetting off)</button></div>` +
    `<p class="muted small" style="margin:10px 0 0">Single-run, deterministic, local. Drafts never enter the catalog on their own — export for curator review.</p>` +
    `<p class="muted small" style="margin:8px 0 0" title="Support fingerprint: proves which app copy this browser runs">` +
    (document.querySelectorAll(".app-tab").length + " tabs · storage " + (typeof storeOk === "function" && storeOk() ? "ok" : "BLOCKED — work will not save")) + `</p>`;
}
function discSet(k, v) {
  if (k === "rounds" || k === "perRound" || k === "keep") v = Number(v);
  if (k === "rounds") v = Math.min(12, Math.max(1, v || 4));
  if (k === "perRound") v = Math.min(60, Math.max(4, v || 24));
  if (k === "keep") v = Math.min(20, Math.max(1, v || 6));
  discState.cfg[k] = v;
  discSave();
  paintDiscControls();
}
/* Single-select shim for delegation (the old inline handler wrapped the
   value in an array inline). */
function discSetSingle(k, v) { discSet(k, [v]); }

function initDiscovery() {
  if (!el("discMain")) return;
  try {
    discLoad();
    discRender();
    renderDraftCollection();
  } catch (e) {
    console.warn("discovery init failed", e);
    el("discMain").innerHTML = emptyState("🧪", "Discovery Lab could not start",
      "Something went wrong while loading (" + escHtml(String(e && e.message || e)).slice(0, 140) + "). Your catalog data is unaffected — reloading the page usually clears it.",
      "Retry", "initDiscovery()");
  }
}

let discAutoRan = false;
tabLoaders.discovery = function () {
  if (!el("discMain")) return;
  try {
    /* First visit with no saved run: run once so the tab opens alive instead
       of an empty state. Deterministic, local, <1s. */
    if (!discAutoRan && !discState.run) { discAutoRan = true; discRunAll(false, true); return; }
    discRender();
  } catch (e) {
    console.warn("discovery render failed", e);
    el("discMain").innerHTML = emptyState("🧪", "Discovery Lab hit a snag",
      "Something went wrong while rendering (" + escHtml(String(e && e.message || e)).slice(0, 140) + "). Your catalog data is unaffected.",
      "Retry", "discRender()");
  }
};
