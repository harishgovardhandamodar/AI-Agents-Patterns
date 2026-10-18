/* coverage.js — Coverage & Gap Analysis view
   Domain-level view of how well each domain is covered across patterns,
   scenarios and the four cascade classes. Renders a heatmap, ranked gap
   cards and concrete, actionable suggestions. Heuristics, deterministic. */
"use strict";

let covView = null;
let covSort = "risk";   // risk | alpha | name

/* --- heuristic targets: what "good" looks like per domain ------------- */
const COV_TARGETS = { patterns: 3, scenarios: 2, derived: 3, cascading: 2 };

function initCoverage() {
  if (!el("coveragePane")) return;
  if (typeof DATA !== "undefined" && DATA.coverage) {
    covView = DATA.coverage;
    renderCoverage();
    return;
  }
  covView = null;
  fetch("data/coverage.json", { cache: "no-store" })
    .then(r => r.json())
    .then(j => { covView = j; if (typeof DATA !== "undefined") DATA.coverage = j; renderCoverage(); })
    .catch(() => renderCoverageStub("Could not load data/coverage.json"));
  renderCoverageStub("Loading coverage…");
}

function renderCoverageStub(msg) {
  const main = el("covMain");
  if (main) main.innerHTML = `<div class="muted small">${escHtml(msg || "Loading coverage…")}</div>`;
}

/* --- build a normalized row model from the raw coverage index -------- */
function covRows() {
  const list = (covView && covView.domains) ? covView.domains : [];
  return list.map(d => {
    const bd = (covView.by_domain && covView.by_domain[d]) || {};
    const pick = k => (bd[k] || []);
    const row = {
      d,
      patterns: pick("patterns"),
      scenarios: pick("scenarios"),
      cascades: pick("cascades_all"),
      inherent: pick("cascades_inherent"),
      emergent: pick("cascades_emergent"),
      derived: pick("cascades_derived"),
      cascading: pick("cascades_cascading")
    };
    row.gaps = covGaps(row);
    row.penalty = row.gaps.reduce((s, g) => s + g.weight, 0);
    row.score = row.patterns.length * 2 + row.scenarios.length * 3 + row.cascades.length;
    return row;
  });
}

/* --- deterministic gap detection + actionable suggestions ------------ */
function covGaps(r) {
  const t = COV_TARGETS, out = [];
  if (r.patterns.length === 0) out.push({ key: "patterns", weight: 3, text: "No patterns at all", fix: "Design or map at least one reusable pattern for this domain." });
  else if (r.patterns.length < t.patterns) out.push({ key: "patterns", weight: 1, text: `Thin pattern coverage (${r.patterns.length}/${t.patterns})`, fix: `Add ${t.patterns - r.patterns} more pattern(s) — look for recurring control-flow shapes.` });

  if (r.scenarios.length === 0) out.push({ key: "scenarios", weight: 3, text: "No concrete scenarios", fix: "Author a threat/failure scenario so risks in this domain are testable." });
  else if (r.scenarios.length < t.scenarios) out.push({ key: "scenarios", weight: 1, text: `Few concrete scenarios (${r.scenarios.length}/${t.scenarios})`, fix: `Write ${t.scenarios - r.scenarios} more scenario(s) grounded in real incidents.` });

  if (r.derived.length < t.derived) out.push({ key: "derived", weight: 2, text: `Derived cascades underrepresented (${r.derived.length}/${t.derived})`, fix: "Model second-order effects that follow from a first failure." });
  if (r.cascading.length < t.cascading) out.push({ key: "cascading", weight: 2, text: `Few systemic / cascading views (${r.cascading.length}/${t.cascading})`, fix: "Add a multi-domain cascading chain crossing a trust boundary." });
  if (r.emergent.length === 0) out.push({ key: "emergent", weight: 1, text: "No emergent cascades", fix: "Capture interactions that only appear when components combine." });
  return out;
}

/* --- coverage level 0..4 for heatmap cell colour --------------------- */
function covLevel(count, target) {
  if (count <= 0) return 0;
  const ratio = count / Math.max(1, target);
  if (ratio >= 2) return 4;
  if (ratio >= 1) return 3;
  if (ratio >= 0.5) return 2;
  return 1;
}

/* --- main render ----------------------------------------------------- */
function renderCoverage() {
  const main = el("covMain");
  if (!main || !covView) return;

  const rows = covRows();
  const sorted = rows.slice().sort((a, b) => covSort === "alpha"
    ? a.d.localeCompare(b.d)
    : covSort === "name" ? b.score - a.score : b.penalty - a.penalty || b.score - a.score);

  const t = covView.totals || {};
  const gapDomains = rows.filter(r => r.gaps.length);
  const clean = rows.length - gapDomains.length;
  const health = rows.length ? Math.round((clean / rows.length) * 100) : 0;

  const cols = [
    { k: "patterns", label: "Patterns", target: COV_TARGETS.patterns },
    { k: "scenarios", label: "Scenarios", target: COV_TARGETS.scenarios },
    { k: "cascades", label: "Cascades", target: 4 },
    { k: "inherent", label: "Inherent", target: 1 },
    { k: "emergent", label: "Emergent", target: 1 },
    { k: "derived", label: "Derived", target: COV_TARGETS.derived },
    { k: "cascading", label: "Cascading", target: COV_TARGETS.cascading }
  ];

  const head = cols.map(c => `<th title="${escHtml(c.label)} coverage">${escHtml(c.label)}</th>`).join("");
  const body = sorted.map(r => {
    const cells = cols.map(c => {
      const n = r[c.k].length;
      const lvl = covLevel(n, c.target);
      return `<td class="heat heat-${lvl}" title="${escHtml(r.d)} · ${escHtml(c.label)}: ${n}">${n || ""}</td>`;
    }).join("");
    return `<tr onclick="covOpenDomain('${escAttr(r.d)}')" class="cov-row"><th class="cov-domain">${escHtml(r.d)}</th>${cells}<td class="cov-band">${covBand(r)}</td></tr>`;
  }).join("");

  const cards = `
    <div class="ov-cards">
      <div class="stat-card"><div class="v">${t.domains || rows.length}</div><div class="k">domains</div></div>
      <div class="stat-card"><div class="v">${t.patterns || 0}</div><div class="k">patterns</div></div>
      <div class="stat-card"><div class="v">${t.scenarios || 0}</div><div class="k">scenarios</div></div>
      <div class="stat-card"><div class="v">${t.cascades || 0}</div><div class="k">cascades</div></div>
      <div class="stat-card"><div class="v">${gapDomains.length}</div><div class="k">gaps flagged</div></div>
      <div class="stat-card"><div class="v">${health}%</div><div class="k">domains adequate</div></div>
    </div>`;

  const gapCards = sorted.filter(r => r.gaps.length).map(r => {
    const items = r.gaps.map(g => `<li>${escHtml(g.text)} <span class="cov-fix">→ ${escHtml(g.fix)}</span></li>`).join("");
    return `<div class="panel cov-gapcard">
      <h3>${navDomain(r.d)} <span class="chip risk">${r.penalty} risk</span></h3>
      <ul class="cov-gaplist">${items}</ul>
      <div class="cov-actions">
        <button class="iconbtn" onclick="covOpenDomain('${escAttr(r.d)}')">Inspect</button>
        <button class="iconbtn" onclick="covAsk('${escAttr(r.d)}')">Ask Fox - Architect</button>
      </div>
    </div>`;
  }).join("") || '<div class="panel"><div class="muted small">No gaps flagged — every domain meets its heuristic targets.</div></div>';

  main.innerHTML = `
    <h2>Coverage &amp; Gap Analysis</h2>
    <p class="muted small">Domain-level coverage across patterns, scenarios and the four cascade classes. Cell shading is coverage vs. a heuristic target (green = met/exceeded, red = missing). Gaps are advisory, not authoritative — use them to focus planning.</p>
    ${cards}
    <div class="cov-controls">
      <span class="muted small">Sort:</span>
      <button class="iconbtn${covSort === "risk" ? " on" : ""}" onclick="covSetSort('risk')">by risk</button>
      <button class="iconbtn${covSort === "name" ? " on" : ""}" onclick="covSetSort('name')">by volume</button>
      <button class="iconbtn${covSort === "alpha" ? " on" : ""}" onclick="covSetSort('alpha')">A–Z</button>
      <span class="spacer"></span>
      <span class="cov-legend muted small">low <i class="heat heat-0"></i><i class="heat heat-1"></i><i class="heat heat-2"></i><i class="heat heat-3"></i><i class="heat heat-4"></i> high</span>
    </div>
    <div class="panel cov-heatpanel">
      <h3>Coverage heatmap</h3>
      <div class="cov-heatwrap">
        <table class="cov-heat"><thead><tr><th class="cov-domain">domain</th>${head}<th>status</th></tr></thead>
        <tbody>${body}</tbody></table>
      </div>
    </div>
    <h3 class="cov-sub">Gap cards <span class="muted small">(${gapDomains.length})</span></h3>
    <div class="ov-grid cov-gaps">${gapCards}</div>`;
}

function covBand(r) {
  if (!r.gaps.length) return '<span class="chip ok">adequate</span>';
  if (r.penalty >= 5) return '<span class="chip risk">critical</span>';
  if (r.penalty >= 3) return '<span class="chip risk">thin</span>';
  return '<span class="chip">watch</span>';
}

function covSetSort(k) { covSort = k; renderCoverage(); }

/* --- domain navigation / copilot deep-link --------------------------- */
function covOpenDomain(d) {
  const ids = [];
  ["patterns", "scenarios", "cascades"].forEach(k => (covView.by_domain[d] && covView.by_domain[d][k] || []).forEach(x => ids.push({ k, x })));
  const pats = (covView.by_domain[d].patterns || []);
  // jump to Patterns tab filtered by domain when patterns exist, else Cascades
  if (pats.length && typeof document !== "undefined") {
    if (typeof state !== "undefined" && state && state.patterns) { /* existing filter state */ }
    if (typeof goPatternDomain === "function") { goPatternDomain(d); return; }
  }
  if (typeof casOpenDomain === "function" && (covView.by_domain[d].cascades_all || []).length) { casOpenDomain(d); return; }
  showNotif(`Domain "${d}" — ${pats.length} patterns, ${(covView.by_domain[d].scenarios || []).length} scenarios`);
}

function covAsk(d) {
  const bd = covView.by_domain[d] || {};
  const q = `How should I close the coverage gaps in the "${d}" domain? We currently have ${(bd.patterns || []).length} patterns, ${(bd.scenarios || []).length} scenarios and ${(bd.cascades_all || []).length} cascades (derived: ${(bd.cascades_derived || []).length}, cascading: ${(bd.cascades_cascading || []).length}).`;
  if (typeof copilotAsk === "function") { switchTab("copilot"); copilotAsk(q); }
  else showNotif("Fox - Architect unavailable");
}

/* Small helper: link a domain name to a copilot-ready prompt */
function navDomain(d) {
  return `<a href="#" onclick="covAsk('${escAttr(d)}');return false" title="Ask Fox - Architect about this domain">${escHtml(d)}</a>`;
}

function escAttr(s) { return String(s == null ? "" : s).replace(/['"\\]/g, ""); }

tabLoaders.coverage = () => initCoverage();
