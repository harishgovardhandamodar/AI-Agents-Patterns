/* cascades.js — Cascade Explorer.
   The four-class cascade taxonomy (inherent / emergent / derived / cascading)
   with filtering, a propagation view, and mitigation planning per cascade.
   Exposes initCascades, openCascade, and the shared cascade state. */

"use strict";

const casState = { q: "", cls: new Set(), domain: new Set(), blast: new Set(), sort: "impact", limit: 60 };
const CAS_LIST_STEP = 60;

const CAS_CLASSES = [
  ["inherent", "Inherent", "Fails in isolation — a property of one component."],
  ["emergent", "Emergent", "Arises only from how components interact."],
  ["derived", "Derived", "The necessary consequence chain from a trigger."],
  ["cascading", "Cascading", "Crosses a boundary and amplifies or correlates."]
];
const BLAST_ORDER = ["single-request", "single-agent", "service", "tenant", "fleet", "org", "ecosystem"];

function casAll() { return (DATA.cascades && DATA.cascades.cascades) || []; }
function casById(id) { return casAll().find(function (c) { return c.id === id; }); }
function casTaxonomy() { return (DATA.cascades && DATA.cascades.taxonomy) || {}; }
function casDomain(c) { return c.domain || "general"; }
function casBlastRank(c) { const i = BLAST_ORDER.indexOf(c.blastRadius); return i < 0 ? 0 : i; }
function casImpactRank(c) { return ({ critical: 4, high: 3, medium: 2, low: 1 })[c.impact] || 0; }

/* ---------------- filters ---------------- */
function casFilterList() {
  const list = casAll().filter(function (c) {
    if (casState.cls.size && !casState.cls.has(c.cls)) return false;
    if (casState.domain.size && !casState.domain.has(casDomain(c))) return false;
    if (casState.blast.size && !casState.blast.has(c.blastRadius)) return false;
    if (casState.q) {
      const hay = (c.name + " " + c.summary + " " + c.trigger + " " + (c.path || []).join(" ") + " " + (c.amplifiers || []).join(" ") +
        " " + Object.keys(c.mitigations || {}).map(function (k) { return (c.mitigations[k] || []).join(" "); }).join(" ")).toLowerCase();
      if (hay.indexOf(casState.q) < 0) return false;
    }
    return true;
  });
  if (casState.sort === "impact") list.sort(function (a, b) { return casImpactRank(b) - casImpactRank(a) || casBlastRank(b) - casBlastRank(a); });
  else if (casState.sort === "blast") list.sort(function (a, b) { return casBlastRank(b) - casBlastRank(a); });
  else if (casState.sort === "class") list.sort(function (a, b) { return a.cls.localeCompare(b.cls); });
  else list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return list;
}
function onCasFilter(inp, key) {
  const v = inp.dataset.v;
  if (inp.checked) casState[key].add(v); else casState[key].delete(v);
  casState.limit = CAS_LIST_STEP; /* new result set — start paged from the top */
  renderCascadeList();
}
function resetCasFilters() {
  casState.q = ""; casState.cls.clear(); casState.domain.clear(); casState.blast.clear();
  casState.limit = CAS_LIST_STEP;
  const s = el("casSearch"); if (s) s.value = "";
  document.querySelectorAll("#casClasses input,#casDomains input,#casBlast input").forEach(function (i) { i.checked = false; });
  renderCascadeList();
}

/* ---------------- propagation diagram ---------------- */
function casLabel(s, n) {
  s = String(s == null ? "" : s).replace(/\s+/g, " ").replace(/"/g, "'").replace(/[<>]/g, "");
  return s.length > (n || 64) ? s.slice(0, (n || 64) - 1) + "…" : s;
}
function casDiagram(c) {
  const path = c.path || [];
  if (!path.length) return "";
  const lines = ["flowchart TB"];
  path.forEach(function (s, i) {
    const tag = i === 0 ? "⚠ " : (i === path.length - 1 ? "◉ " : "");
    lines.push('  N' + String(i + 1).padStart(2, "0") + '["' + tag + casLabel(s) + '"]');
  });
  const amps = (c.amplifiers || []).slice();
  for (let i = 0; i < path.length - 1; i++) {
    const a = amps.length ? amps[i % amps.length] : "";
    lines.push("  N" + String(i + 1).padStart(2, "0") + " -->" + (a ? '|"' + casLabel(a, 40) + '"|' : "") + " N" + String(i + 2).padStart(2, "0"));
  }
  return lines.join("\n");
}

/* ---------------- bidirectional cross-links ---------------- */
function cascadesForScenario(sid) { return casAll().filter(function (c) { return (c.scenarioRefs || []).indexOf(sid) >= 0; }); }
function cascadesForPattern(pid) { return casAll().filter(function (c) { return (c.patternRefs || []).indexOf(pid) >= 0; }); }
function casLinksBlock(list, title) {
  if (!list || !list.length) return "";
  const order = { inherent: 0, emergent: 1, derived: 2, cascading: 3 };
  const sorted = list.slice().sort(function (a, b) { return (order[a.cls] - order[b.cls]) || (casBlastRank(b) - casBlastRank(a)); });
  const byCls = {};
  sorted.forEach(function (c) { (byCls[c.cls] = byCls[c.cls] || []).push(c); });
  const groups = Object.keys(order).filter(function (k) { return byCls[k]; }).map(function (k) {
    return '<div style="margin:5px 0"><span class="cls-chip ' + k + '">' + k + "</span> " +
      byCls[k].map(function (c) { return '<span class="cp-cite c" onclick="openCascade(\'' + c.id + '\')">' + escHtml(c.name) + "</span>"; }).join(" ") + "</div>";
  }).join("");
  return '<div class="dsec"><h4>' + escHtml(title) + ' <span class="muted small" style="text-transform:none">(' + list.length + ")</span></h4>" +
    '<p class="small muted" style="margin:0 0 4px">How this can propagate — grouped by cascade class. Click to open the full analysis, simulator and mitigation plan.</p>' +
    groups + "</div>";
}
function casLinksForScenario(sid) { return casLinksBlock(cascadesForScenario(sid), "Cascade analysis"); }
function casLinksForPattern(pid) { return casLinksBlock(cascadesForPattern(pid), "Cascade exposure"); }

/* ---------------- mitigation planner ---------------- */
const MIT_STORE = "aap.mitigations";
const MIT_FUNCS = [["prevent", "Prevent"], ["detect", "Detect"], ["contain", "Contain"], ["recover", "Recover"]];
const MIT_VERIFY = {
  prevent: "unit / eval test that fails if the control is removed",
  detect: "red-team run where the alert fires before impact",
  contain: "chaos drill that proves the blast radius is bounded",
  recover: "restore/reconcile test that returns to a known-good state"
};
let casView = "explorer";

function setCasView(v) {
  casView = v;
  document.querySelectorAll("#casSeg .seg-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.v === v); });
  const ex = el("casExplorer"), mi = el("casMitigation");
  if (ex) ex.classList.toggle("hidden", v !== "explorer");
  if (mi) mi.classList.toggle("hidden", v !== "mitigation");
  if (v === "mitigation") renderMitigation();
}
function mitLoad() { try { return JSON.parse(localStorage.getItem(MIT_STORE) || "{}"); } catch (e) { return {}; } }
function mitSave(m) { try { localStorage.setItem(MIT_STORE, JSON.stringify(m)); } catch (e) {} }
function mitKey(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90); }

/* Aggregate every cascade's controls into a de-duplicated, scored backlog. */
function buildMitigationBacklog() {
  const map = {};
  casAll().forEach(function (c) {
    MIT_FUNCS.forEach(function (f) {
      (c.mitigations && c.mitigations[f[0]] || []).forEach(function (text) {
        const k = f[0] + "::" + mitKey(text);
        if (!map[k]) map[k] = { key: k, func: f[0], text: text, cascades: [], impact: 0, blast: 0, classes: {} };
        const e = map[k];
        if (e.cascades.indexOf(c.id) < 0) e.cascades.push(c.id);
        e.impact = Math.max(e.impact, casImpactRank(c));
        e.blast = Math.max(e.blast, casBlastRank(c));
        e.classes[c.cls] = 1;
        if (text.length > e.text.length) e.text = text;
      });
    });
  });
  const list = Object.keys(map).map(function (k) {
    const e = map[k];
    e.freq = e.cascades.length;
    e.score = e.freq * 2.0 + e.impact * 1.2 + e.blast * 0.8 + (Object.keys(e.classes).length - 1) * 0.6;
    return e;
  });
  list.sort(function (a, b) { return b.score - a.score; });
  // Percentile-based priority so the buckets stay meaningful at any scale:
  // P1 = top 15% (highest leverage), P2 = next 25%, P3 = the long tail.
  const n = list.length;
  list.forEach(function (e, i) {
    e.priority = i < n * 0.15 ? "P1" : i < n * 0.40 ? "P2" : "P3";
  });
  return list;
}
const mitFilter = { func: null, pri: null, limit: 40 };
const MIT_PAGE_STEP = 40;
function setMitFilter(k, v) {
  mitFilter[k] = (k === "limit") ? v : (mitFilter[k] === v ? null : v);
  renderMitigation();
}
function mitShowMore() { mitFilter.limit += MIT_PAGE_STEP; renderMitigation(); }
function renderMitigation() {
  const box = el("casMitigation");
  if (!box) return;
  const all = buildMitigationBacklog();
  const saved = mitLoad();
  const filtered = all.filter(function (e) {
    if (mitFilter.func && e.func !== mitFilter.func) return false;
    if (mitFilter.pri && e.priority !== mitFilter.pri) return false;
    return true;
  });
  const shown = filtered.slice(0, mitFilter.limit);
  const counts = { P1: 0, P2: 0, P3: 0 };
  all.forEach(function (e) { counts[e.priority]++; });
  const fbtn = function (label, key, val, extra) {
    const on = mitFilter[key] === val;
    return '<button class="seg-btn' + (on ? " active" : "") + '" onclick="setMitFilter(\'' + key + '\',\'' + (val || "") + '\')">' + label + (extra || "") + "</button>";
  };
  box.innerHTML =
    '<div class="panel" style="margin-bottom:12px"><h3>Mitigation planner — ' + all.length + " distinct controls from " + casAll().length + " cascades</h3>" +
    '<p class="muted small">Every control across all cascades, de-duplicated and ranked by leverage (how many cascades it addresses), the worst impact it prevents and the widest blast radius it bounds. Priority is relative (top 15% / next 25% / tail) — a planning heuristic, not your risk appetite. Assign owners and track status; it persists locally.</p>' +
    '<div class="seg" style="margin:10px 0 8px">' + fbtn("All functions", "func", null) + MIT_FUNCS.map(function (f) { return fbtn(f[1], "func", f[0]); }).join("") + "</div>" +
    '<div class="seg" style="margin:0 0 8px">' + fbtn("All priorities", "pri", null) + fbtn("P1", "pri", "P1", " · " + counts.P1) + fbtn("P2", "pri", "P2", " · " + counts.P2) + fbtn("P3", "pri", "P3", " · " + counts.P3) + "</div>" +
    '<div style="display:flex;gap:8px;align-items:center;margin-top:8px">' +
    '<span class="muted small">showing ' + shown.length + " of " + filtered.length + "</span>" +
    (filtered.length > shown.length
      ? '<button class="btn" onclick="mitShowMore()">Show ' + Math.min(MIT_PAGE_STEP, filtered.length - shown.length) + " more</button>" +
        '<button class="btn ghost" onclick="setMitFilter(\'limit\',' + filtered.length + ')">Show all ' + filtered.length + "</button>"
      : (mitFilter.limit > MIT_PAGE_STEP ? '<button class="btn ghost" onclick="setMitFilter(\'limit\',' + MIT_PAGE_STEP + ')">Show top ' + MIT_PAGE_STEP + "</button>" : "")) +
    '<div style="flex:1"></div>' +
    '<button class="btn" onclick="exportMitigations(\'md\')">⬇ Export markdown</button>' +
    '<button class="btn" onclick="exportMitigations(\'csv\')">⬇ Export CSV</button></div></div>' +
    '<div class="mit-table">' + shown.map(function (e) { return mitRow(e, saved[e.key] || {}); }).join("") + "</div>";
}
function mitRow(e, st) {
  const fn = MIT_FUNCS.find(function (f) { return f[0] === e.func; });
  const status = st.status || "proposed";
  const owner = st.owner || "";
  const stOpts = ["proposed", "in progress", "done", "accepted risk"].map(function (s) {
    return '<option value="' + s + '"' + (status === s ? " selected" : "") + ">" + s + "</option>";
  }).join("");
  return '<div class="mit-row" data-key="' + escHtml(e.key) + '">' +
    '<div class="mit-p ' + e.priority + '">' + e.priority + "</div>" +
    '<div class="mit-main"><div class="mit-t">' + escHtml(e.text) + "</div>" +
    '<div class="mit-m"><span class="chip" style="font-size:9px">' + fn[1] + "</span>" +
    '<span class="muted small">' + e.freq + " cascade" + (e.freq > 1 ? "s" : "") + " · worst impact " + ({ 4: "critical", 3: "high", 2: "medium", 1: "low" }[e.impact] || "?") + " · blast " + BLAST_ORDER[e.blast] + "</span></div>" +
    '<div class="mit-links">' + e.cascades.slice(0, 6).map(function (id) {
      const c = casById(id); return c ? '<span class="cp-cite c" onclick="openCascade(\'' + id + '\')">' + escHtml(c.name.slice(0, 34)) + "</span>" : "";
    }).join("") + "</div>" +
    '<div class="mit-verify">verify: ' + escHtml(MIT_VERIFY[e.func]) + "</div></div>" +
    '<div class="mit-side"><input class="mit-owner" placeholder="owner" value="' + escHtml(owner) + '" oninput="mitSet(\'' + escHtml(e.key) + '\',\'owner\',this.value)">' +
    '<select class="mit-status" onchange="mitSet(\'' + escHtml(e.key) + '\',\'status\',this.value)">' + stOpts + "</select></div>" +
    "</div>";
}
function mitSet(key, field, val) {
  const m = mitLoad();
  m[key] = m[key] || {};
  m[key][field] = val;
  mitSave(m);
}
function exportMitigations(kind) {
  const list = buildMitigationBacklog();
  const saved = mitLoad();
  if (kind === "csv") {
    const rows = [["priority", "function", "control", "cascades", "worst_impact", "blast", "owner", "status", "verification"]];
    list.forEach(function (e) {
      const st = saved[e.key] || {};
      rows.push([e.priority, e.func, e.text, e.cascades.length, ({ 4: "critical", 3: "high", 2: "medium", 1: "low" }[e.impact] || ""), BLAST_ORDER[e.blast], st.owner || "", st.status || "proposed", MIT_VERIFY[e.func]]);
    });
    const csv = rows.map(function (r) { return r.map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
    cpDownload("mitigation-backlog.csv", csv);
  } else {
    let md = "# Mitigation backlog\n\n_Aggregated from " + casAll().length + " cascade records._\n\n";
    MIT_FUNCS.forEach(function (f) {
      const sub = list.filter(function (e) { return e.func === f[0]; });
      if (!sub.length) return;
      md += "## " + f[1] + " (" + sub.length + ")\n\n";
      sub.forEach(function (e) {
        const st = saved[e.key] || {};
        md += "- **" + e.priority + "** " + e.text + "\n  - addresses " + e.cascades.length + " cascades · worst impact " + ({ 4: "critical", 3: "high", 2: "medium", 1: "low" }[e.impact] || "?") + " · blast " + BLAST_ORDER[e.blast] + "\n";
        md += "  - owner: " + (st.owner || "—") + " · status: " + (st.status || "proposed") + "\n  - verification: " + MIT_VERIFY[e.func] + "\n";
      });
      md += "\n";
    });
    cpDownload("mitigation-backlog.md", md);
  }
}

/* ---------------- propagation simulator ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function casHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/* Monte-Carlo walk of the cascade's real path. Deterministic given the seed.
   `hardening` (0..1) models how much of the mitigation plan is actually in
   place: it raises the per-step stop probability. Amplifiers lower it. */
function casSim(c, seed, trials, hardening) {
  const path = c.path || [];
  const n = Math.max(1, path.length);
  const rng = mulberry32((seed >>> 0) ^ casHash(c.id));
  const base = { inherent: 0.50, emergent: 0.34, derived: 0.42, cascading: 0.20 }[c.cls] || 0.35;
  const ampPenalty = Math.min(0.15, (c.amplifiers || []).length * 0.035);
  const stopP = Math.max(0.03, Math.min(0.95, base + hardening * 0.55 - ampPenalty));
  const stops = new Array(n).fill(0);
  let full = 0, depthSum = 0;
  for (let t = 0; t < trials; t++) {
    let stopped = false;
    for (let i = 0; i < n; i++) {
      if (rng() < stopP) { stops[i]++; depthSum += i; stopped = true; break; }
    }
    if (!stopped) { full++; depthSum += n; }
  }
  const expectedDepth = depthSum / trials;
  const frac = expectedDepth / n;
  const maxBlast = casBlastRank(c) || 2;
  const reach = Math.max(0, Math.min(BLAST_ORDER.length - 1, Math.round(maxBlast * frac)));
  return {
    stopP: stopP, stops: stops, full: full, trials: trials, expectedDepth: expectedDepth,
    frac: frac, blast: BLAST_ORDER[reach], maxBlast: BLAST_ORDER[maxBlast],
    containRate: 1 - full / trials
  };
}
function casSimSection(c) {
  const seed = casHash(c.id) % 100000;
  return '<div class="cas-sim">' +
    '<div class="cas-sim-ctl">' +
    '<label>seed <input type="number" id="simSeed" value="' + seed + '" style="width:88px"></label>' +
    '<label>trials <select id="simTrials"><option>500</option><option selected>2000</option><option>10000</option></select></label>' +
    '<label>hardening <input type="range" id="simHard" min="0" max="100" value="40" oninput="document.getElementById(\'simHardV\').textContent=this.value+\'%\'"> <span id="simHardV">40%</span></label>' +
    '<button class="btn primary" onclick="runCascadeSim(\'' + c.id + '\')">▶ Run simulation</button>' +
    "</div>" +
    '<div id="casSimOut" class="cas-sim-out"><span class="muted small">Model the spread of this cascade across its ' +
    (c.path || []).length + " propagation steps. Deterministic Monte-Carlo — no model tokens.</span></div></div>";
}
function runCascadeSim(id) {
  const c = casById(id);
  if (!c) return;
  const seed = parseInt((el("simSeed") || {}).value || "1", 10);
  const trials = parseInt((el("simTrials") || {}).value || "2000", 10);
  const h = (parseInt((el("simHard") || {}).value || "40", 10)) / 100;
  const r = casSim(c, seed, trials, h);
  const path = c.path || [];

  // hardening curve
  const curve = [0, 0.25, 0.5, 0.75, 1].map(function (x) { return { h: x, r: casSim(c, seed, Math.max(400, trials / 4), x) }; });

  const stepBars = r.stops.map(function (cnt, i) {
    const pct = Math.round(100 * cnt / trials);
    return '<div class="bar-row"><span class="lbl" title="' + escHtml(path[i] || "") + '">step ' + (i + 1) + " · " + escHtml((path[i] || "").slice(0, 26)) + "</span>" +
      '<span class="bar-track"><span class="bar-fill inherent" style="width:' + Math.max(pct, 1) + '%"></span></span>' +
      '<span class="n">' + pct + "%</span></div>";
  }).join("");
  const fullPct = Math.round(100 * r.full / trials);

  el("casSimOut").innerHTML =
    '<div class="cas-sim-verdict">' +
    "<div><span class='muted small'>at " + Math.round(h * 100) + "% hardening</span>" +
    "<div class='big " + (fullPct > 50 ? "bad" : fullPct > 20 ? "warn" : "ok") + "'>" + fullPct + "%</div>" +
    "<span class='muted small'>reach full impact</span></div>" +
    "<div><span class='muted small'>contained before impact</span><div class='big ok'>" + Math.round(100 * r.containRate) + "%</div><span class='muted small'>" + trials + " trials, seed " + seed + "</span></div>" +
    "<div><span class='muted small'>expected depth reached</span><div class='big'>" + r.expectedDepth.toFixed(2) + " / " + path.length + "</div><span class='muted small'>per-step stop p=" + r.stopP.toFixed(2) + "</span></div>" +
    "<div><span class='muted small'>expected blast radius</span><div class='big" + (casBlastRank({ blastRadius: r.blast }) >= 4 ? " bad" : "") + "'>" + escHtml(r.blast) + "</div><span class='muted small'>worst case " + escHtml(r.maxBlast) + "</span></div>" +
    "</div>" +
    "<div class='cas-sim-cols'><div><h5>Where it gets stopped</h5>" + stepBars +
    "<p class='muted small'>Higher bars mean the cascade usually dies there — invest in the controls for the earliest strong bar.</p></div>" +
    "<div><h5>Hardening curve</h5>" +
    curve.map(function (p) {
      const fp = Math.round(100 * p.r.full / p.r.trials);
      return '<div class="bar-row"><span class="lbl">' + Math.round(p.h * 100) + "% hardening</span>" +
        '<span class="bar-track"><span class="bar-fill ' + (fp > 50 ? "hot" : "inherent") + '" style="width:' + Math.max(fp, 1) + '%"></span></span>' +
        '<span class="n">' + fp + "%</span></div>";
    }).join("") +
    "<p class='muted small'>Read this as: the residual probability of full propagation at each level of mitigation maturity.</p></div></div>";
}

/* ---------------- distribution overview ---------------- */
function renderCasOverview() {
  const box = el("casOverview");
  if (!box) return;
  const all = casAll();
  const byCls = {}, byBlast = {}, byDom = {};
  all.forEach(function (c) {
    byCls[c.cls] = (byCls[c.cls] || 0) + 1;
    byBlast[c.blastRadius] = (byBlast[c.blastRadius] || 0) + 1;
    byDom[casDomain(c)] = (byDom[casDomain(c)] || 0) + 1;
  });
  const bar = function (label, n, cls) {
    const pct = Math.round(100 * n / all.length);
    return '<div class="bar-row"><span class="lbl">' + escHtml(label) + '</span>' +
      '<span class="bar-track"><span class="bar-fill ' + (cls || "") + '" style="width:' + pct + '%"></span></span>' +
      '<span class="n">' + n + "</span></div>";
  };
  box.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">' +
    "<div><h3 style='margin-bottom:8px'>By class</h3>" +
    CAS_CLASSES.map(function (c) { return bar(c[1], byCls[c[0]] || 0, c[0]); }).join("") + "</div>" +
    "<div><h3 style='margin-bottom:8px'>By blast radius</h3>" +
    BLAST_ORDER.filter(function (b) { return byBlast[b]; }).map(function (b) { return bar(b, byBlast[b], casBlastRank({ blastRadius: b }) >= 4 ? "hot" : ""); }).join("") +
    "</div></div>";
}

function initCascades() {
  buildCasFilters();
  renderCasOverview();
  renderCascadeList();
}
function buildCasFilters() {
  const cls = el("casClasses");
  if (cls && !cls._built) {
    cls._built = true;
    cls.innerHTML = "";
    CAS_CLASSES.forEach(function (c) {
      const n = casAll().filter(function (x) { return x.cls === c[0]; }).length;
      const l = document.createElement("label");
      l.className = "filter-item";
      l.innerHTML = '<input type="checkbox" data-v="' + c[0] + '" onchange="onCasFilter(this,\'cls\')"> ' +
        '<span class="cls-chip ' + c[0] + '">' + c[1] + "</span> <span class='muted small'>" + n + "</span>";
      cls.appendChild(l);
    });
  }
  const dom = el("casDomains");
  if (dom && !dom._built) {
    dom._built = true;
    const counts = {};
    casAll().forEach(function (c) { counts[casDomain(c)] = (counts[casDomain(c)] || 0) + 1; });
    dom.innerHTML = Object.keys(counts).sort().map(function (d) {
      return '<label class="filter-item"><input type="checkbox" data-v="' + escHtml(d) + '" onchange="onCasFilter(this,\'domain\')"> ' +
        escHtml(d) + ' <span class="muted small">' + counts[d] + "</span></label>";
    }).join("");
  }
  const bl = el("casBlast");
  if (bl && !bl._built) {
    bl._built = true;
    const set = {};
    casAll().forEach(function (c) { set[c.blastRadius] = (set[c.blastRadius] || 0) + 1; });
    bl.innerHTML = BLAST_ORDER.filter(function (b) { return set[b]; }).map(function (b) {
      return '<label class="filter-item"><input type="checkbox" data-v="' + b + '" onchange="onCasFilter(this,\'blast\')"> ' +
        b + ' <span class="muted small">' + set[b] + "</span></label>";
    }).join("");
  }
}

/* Jump to Cascades tab filtered to one domain (used by Coverage view). */
function casOpenDomain(dom) {
  switchTab("cascades");
  setTimeout(function () {
    casState.q = ""; casState.cls.clear(); casState.domain.clear(); casState.blast.clear();
    const s = el("casSearch"); if (s) s.value = "";
    const box = el("casDomains");
    if (box) {
      box.querySelectorAll("input").forEach(function (i) { i.checked = i.dataset.v === dom; });
      casState.domain.add(dom);
    }
    renderCascadeList();
  }, 40);
}

function casShowMore() { casState.limit += CAS_LIST_STEP; renderCascadeList(); casScrollKeep(); }
function casShowAll() { casState.limit = casFilterList().length; renderCascadeList(); casScrollKeep(); }
function casShowFewer() { casState.limit = CAS_LIST_STEP; renderCascadeList(); }
function casScrollKeep() {
  const grid = el("casGrid");
  if (grid && grid.lastElementChild) grid.lastElementChild.scrollIntoView({ block: "nearest" });
}

function renderCascadeList() {
  const grid = el("casGrid");
  if (!grid) return;
  const list = casFilterList();
  const shown = list.slice(0, casState.limit);
  const cnt = el("casCount");
  if (cnt) cnt.textContent = "showing " + shown.length + " of " + list.length + " cascades" + (list.length !== casAll().length ? " (" + casAll().length + " total)" : "");
  grid.innerHTML = shown.map(casCardHtml).join("") +
    (list.length > shown.length
      ? '<div class="cas-more"><button class="btn" onclick="casShowMore()">Show ' + Math.min(CAS_LIST_STEP, list.length - shown.length) + ' more (' + (list.length - shown.length) + ' remaining)</button>' +
        '<button class="btn ghost" onclick="casShowAll()">Show all ' + list.length + "</button></div>"
      : (casState.limit > CAS_LIST_STEP && list.length > CAS_LIST_STEP
        ? '<div class="cas-more"><button class="btn ghost" onclick="casShowFewer()">Show fewer</button></div>' : "")) ||
    `<p class="muted">No cascades match the current filters. <button class="btn sm" onclick="resetCasFilters()">Reset filters</button></p>`;
}
function casCardHtml(c) {
  const hi = casBlastRank(c) >= 4 ? " hi" : "";
  const mit = c.mitigations || {};
  const mc = ["prevent", "detect", "contain", "recover"].reduce(function (n, k) { return n + ((mit[k] || []).length); }, 0);
  return '<div class="cas-card" onclick="openCascade(\'' + c.id + '\')">' +
    '<div class="t"><span class="cls-chip ' + c.cls + '">' + c.cls + '</span> ' + escHtml(c.name) + "</div>" +
    '<div class="m"><span class="blast-chip' + hi + '">blast: ' + escHtml(c.blastRadius) + "</span>" +
    '<span class="blast-chip">' + escHtml(c.impact) + " impact</span>" +
    '<span class="blast-chip">' + escHtml(c.likelihood) + " likelihood</span>" +
    '<span class="blast-chip">' + escHtml(casDomain(c)) + "</span>" +
    (mc ? '<span class="blast-chip">' + mc + " controls</span>" : "") +
    "</div>" +
    '<div class="d">' + escHtml(c.summary) + "</div></div>";
}

/* ---------------- detail ---------------- */
function casRefChips(c) {
  const parts = [];
  (c.patternRefs || []).forEach(function (id) {
    const p = DATA.patterns && DATA.patterns.patterns.find(function (x) { return x.id === id; });
    parts.push('<span class="cp-cite p" onclick="openPattern(\'' + id + '\')" title="Pattern">◆ ' + escHtml(p ? p.name : id) + "</span>");
  });
  (c.scenarioRefs || []).forEach(function (id) {
    const s = DATA.scenarios && DATA.scenarios.scenarios.find(function (x) { return x.id === id; });
    parts.push('<span class="cp-cite s" onclick="openScenario(\'' + id + '\')" title="Scenario">⚠ ' + escHtml(s ? s.title : id) + "</span>");
  });
  (c.traceRefs || []).forEach(function (id) {
    const t = DATA.traces && DATA.traces.traces.find(function (x) { return x.id === id; });
    parts.push('<span class="cp-cite t" onclick="switchTab(\'live\');setTimeout(function(){loadTrace(\'' + id + '\')},90)" title="Trace">▶ ' + escHtml(t ? String(t.name).split(" — ").slice(1).join(" — ") || t.name : id) + "</span>");
  });
  return parts.length ? '<div class="ref-chips">' + parts.join("") + "</div>" : '<span class="muted small">no direct catalog links</span>';
}

function openCascade(id) {
  const c = casById(id);
  if (!c) { showNotif("Cascade not found"); return; }
  const mit = c.mitigations || {};
  const col = function (k, label) {
    const items = mit[k] || [];
    return '<div class="mit-col ' + k + '"><h5>' + label + "</h5>" +
      (items.length ? "<ul>" + items.map(function (x) { return "<li>" + escHtml(x) + "</li>"; }).join("") + "</ul>" : '<span class="muted small">—</span>') + "</div>";
  };
  const html =
    '<div class="cas-meta-row">' +
    '<span>class <b>' + escHtml(c.cls) + "</b></span>" +
    '<span>domain <b>' + escHtml(casDomain(c)) + "</b></span>" +
    '<span>blast radius <b>' + escHtml(c.blastRadius) + "</b></span>" +
    '<span>likelihood <b>' + escHtml(c.likelihood) + "</b></span>" +
    '<span>impact <b>' + escHtml(c.impact) + "</b></span>" +
    '<span>speed <b>' + escHtml(c.speed) + "</b></span></div>" +
    "<p>" + escHtml(c.summary) + "</p>" +
    '<h4 style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 4px">Trigger</h4>' +
    "<p>" + escHtml(c.trigger) + "</p>" +
    '<h4 style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 4px">Propagation</h4>' +
    (casDiagram(c) ? diagramHtml(casDiagram(c), "propagation") : "") +
    '<ul class="cas-path">' + (c.path || []).map(function (s) { return "<li>" + escHtml(s) + "</li>"; }).join("") + "</ul>" +
    ((c.amplifiers || []).length ? '<h4 style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 4px">What makes it worse</h4><ul>' +
      c.amplifiers.map(function (a) { return "<li>" + escHtml(a) + "</li>"; }).join("") + "</ul>" : "") +
    ((c.detection || []).length ? '<h4 style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 4px">Detection signals</h4><ul>' +
      c.detection.map(function (d) { return "<li>" + escHtml(d) + "</li>"; }).join("") + "</ul>" : "") +
    '<h4 style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 4px">Mitigation plan</h4>' +
    '<div class="mit-grid">' + col("prevent", "Prevent · reduce likelihood") + col("detect", "Detect · reduce time-to-know") +
    col("contain", "Contain · limit blast radius") + col("recover", "Recover · restore") + "</div>" +
    '<h4 style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 4px">Propagation simulator</h4>' +
    casSimSection(c) +
    '<h4 style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 6px">Residual risk</h4>' +
    "<p>" + escHtml(c.residual || "") + "</p>" +
    '<h4 style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 6px">In the catalog</h4>' +
    casRefChips(c) +
    '<div style="margin-top:14px"><button class="btn primary" onclick="askCopilotAbout(\'cascade: ' + escHtml(c.name) + '\')">🤖 Ask the Copilot about this</button></div>';
  openDetail(c.name, c.cls + " cascade", html);
}

/* Feed a cascade (or any item) into the copilot and switch to it. */
function askCopilotAbout(text) {
  closeDetail();
  switchTab("copilot");
  setTimeout(function () {
    const i = el("cpInput");
    if (i) { i.value = text; i.focus(); }
  }, 90);
}
tabLoaders.cascades = function () { initCascades(); };
