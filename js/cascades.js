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
