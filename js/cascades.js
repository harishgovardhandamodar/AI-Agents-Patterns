/* cascades.js — Cascade Explorer.
   The four-class cascade taxonomy (inherent / emergent / derived / cascading)
   with filtering, a propagation view, and mitigation planning per cascade.
   Exposes initCascades, openCascade, and the shared cascade state. */

"use strict";

const casState = { q: "", cls: new Set(), domain: new Set(), blast: new Set(), sort: "impact" };

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
  renderCascadeList();
}
function resetCasFilters() {
  casState.q = ""; casState.cls.clear(); casState.domain.clear(); casState.blast.clear();
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

function renderCascadeList() {
  const grid = el("casGrid");
  if (!grid) return;
  const list = casFilterList();
  const cnt = el("casCount");
  if (cnt) cnt.textContent = list.length + " of " + casAll().length + " cascades";
  grid.innerHTML = list.map(casCardHtml).join("");
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
