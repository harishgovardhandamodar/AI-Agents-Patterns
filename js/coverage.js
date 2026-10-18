/* coverage.js — Coverage & Gap Analysis view */
"use strict";
let covView = null;

function initCoverage() {
  if (!el("coveragePane")) return;
  if (typeof DATA !== "undefined" && DATA.coverage) {
    covView = DATA.coverage;
    renderCoverage();
    return;
  }
  covView = null;
  fetch("data/coverage.json", {cache:"no-store"})
    .then(r=>r.json())
    .then(j=>{ covView=j; if (typeof DATA!=="undefined") DATA.coverage=j; renderCoverage(); })
    .catch(()=>{});
  renderCoverageStub();
}


function renderCoverageStub() {
  const main = el("covMain");
  if (!main) return;
  main.innerHTML = '<div class="muted small">Loading coverage…</div>';
}

function renderCoverage() {
  const main = el("covMain");
  if (!main || !covView) return;
  const dlist = covView.domains || [];
  const rows = dlist.map(d => {
    const bd = covView.by_domain[d] || {};
    const p = bd.patterns||[], s = bd.scenarios||[], ca = bd.cascades_all||[], cin = bd.cascades_inherent||[], cem = bd.cascades_emergent||[], cdr = bd.cascades_derived||[], ccs = bd.cascades_cascading||[];
    const score = p.length * 2 + s.length * 3 + ca.length * 1;
    const gaps = [];
    if (p.length < 3) gaps.push("thin pattern coverage");
    if (s.length < 2) gaps.push("few concrete scenarios");
    if (cdr.length < 3) gaps.push("derived cascades underrepresented");
    if (ccs.length < 2) gaps.push("few systemic/cascading views");
    return {d,p,s,ca,cin,cem,cdr,ccs,score,gaps};
  }).sort((a,b)=>b.score-a.score);
  const grid = rows.map(r => `<div class="panel"><h3>${escHtml(r.d)} <span class="muted small">(${r.p.length} patterns · ${r.s.length} scens · ${r.ca.length} cascades)</span></h3><div>${r.gaps.length? "<b>Gaps:</b> "+escHtml(r.gaps.join("; ")): "<span class='muted small'>Coverage adequate</span>"}</div></div>`).join("");
  main.innerHTML = `<h2>Coverage & Gap Analysis</h2><p class="muted small">Domain-level view: pattern, scenario and cascade coverage across the four classes. Gaps are heuristic to focus planning.</p><div class="ov-grid">${grid}</div>`;
}

tabLoaders.coverage = () => initCoverage();
