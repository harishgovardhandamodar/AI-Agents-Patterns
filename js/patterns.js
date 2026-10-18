/* patterns.js — Overview tab + Patterns catalog tab */
"use strict";

/* =============== OVERVIEW =============== */
function initOverview() {
  const P = DATA.patterns, S = DATA.scenarios, T = DATA.traces;
  const critical = S.scenarios.filter(s => s.severity === "critical").length;
  const protections = uniq(S.scenarios.flatMap(s => (s.protections || []).map(p => p.layer))).length;
  const cards = [
    { v: P.patterns.length, k: "Design patterns" },
    { v: S.scenarios.length, k: "Failure scenarios" },
    { v: P.categories.length, k: "Pattern categories" },
    { v: T.traces.length, k: "Live traces" },
    { v: critical, k: "Critical scenarios" },
    { v: uniq(P.patterns.flatMap(p => p.domains)).length, k: "Domains covered" },
    { v: P.patterns.reduce((n, p) => n + (p.failures || []).length, 0), k: "Failure modes documented" },
    { v: protections, k: "Protection layers in use" }
  ];
  el("ovCards").innerHTML = cards.map(c =>
    `<div class="stat-card"><div class="v">${c.v}</div><div class="k">${escHtml(c.k)}</div></div>`).join("");

  const catCounts = P.categories.map(c => ({ ...c, n: P.patterns.filter(p => p.cat === c.id).length }));
  const maxCat = Math.max(...catCounts.map(c => c.n));
  el("ovCats").innerHTML = catCounts.map(c =>
    `<div class="bar-row"><span class="lbl">${escHtml(c.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${100 * c.n / maxCat}%;background:${c.color}"></div></div><span class="n">${c.n}</span></div>`).join("");

  const sevs = ["critical", "high", "medium", "low"];
  const sevCounts = sevs.map(sv => ({ sv, n: S.scenarios.filter(s => s.severity === sv).length }));
  const maxSev = Math.max(1, ...sevCounts.map(s => s.n));
  el("ovSev").innerHTML = sevCounts.map(s =>
    `<div class="bar-row"><span class="lbl"><span class="sev-dot sev-${s.sv}"></span>${s.sv}</span><div class="bar-track"><div class="bar-fill" style="width:${100 * s.n / maxSev}%;background:var(--${s.sv === "critical" ? "red" : s.sv === "high" ? "orange" : s.sv === "medium" ? "accent" : "green"})"></div></div><span class="n">${s.n}</span></div>`).join("") +
    `<p class="muted small" style="margin-top:10px">Likelihood: ${S.scenarios.filter(s => s.likelihood === "high").length} high · ${S.scenarios.filter(s => s.likelihood === "medium").length} medium · ${S.scenarios.filter(s => s.likelihood === "low").length} low</p>`;

  const domCounts = {};
  S.scenarios.forEach(s => { domCounts[s.domain] = (domCounts[s.domain] || 0) + 1; });
  el("ovDomains").innerHTML = Object.entries(domCounts).sort((a, b) => b[1] - a[1]).map(([d, n]) =>
    `<span class="domain-chip" onclick="jumpToScenarioDomain('${escHtml(d)}')">${escHtml(d)} <b>${n}</b></span>`).join("");

  const layerDefs = [
    ["identity", "Least-privilege identity — scoped, short-lived credentials"],
    ["context", "Context hygiene — injection shields, data/instruction separation"],
    ["policy", "Deterministic policy — rules in runtime, not prompts"],
    ["process", "Human process — approvals, dual control, review queues"],
    ["infrastructure", "Infrastructure — sandboxes, egress allowlists, processor caps"],
    ["data", "Data layer — tokenization, trust tiers, row-level scoping"],
    ["dlp", "Egress DLP — output shields, secret/PII scanning"],
    ["observability", "Observability — audit trails, drift & spend monitoring"]
  ];
  const layerCounts = {};
  S.scenarios.forEach(s => (s.protections || []).forEach(p => { layerCounts[p.layer] = (layerCounts[p.layer] || 0) + 1; }));
  const maxL = Math.max(1, ...Object.values(layerCounts));
  el("ovLayers").innerHTML = layerDefs.map(([id, label]) => {
    const n = layerCounts[id] || 0;
    return `<div class="bar-row"><span class="lbl" title="${escHtml(label)}">${escHtml(label.split(" — ")[0])}</span><div class="bar-track"><div class="bar-fill" style="width:${100 * n / maxL}%;background:var(--teal)"></div></div><span class="n">${n}</span></div>`;
  }).join("") + `<p class="muted small" style="margin-top:8px">Defense in depth: no single layer is trusted to hold. The $50k card scenario alone is stopped by 4 independent layers.</p>`;
}

function jumpToScenarioDomain(dom) {
  switchTab("scenarios");
  setTimeout(() => {
    const box = el("scnDomains");
    const input = box.querySelector(`input[data-dom="${CSS.escape(dom)}"]`);
    if (input) { box.querySelectorAll("input").forEach(i => i.checked = false); input.checked = true; renderScenarios(); }
  }, 30);
}

/* Jump to Patterns tab filtered to a single domain (used by Coverage view). */
function goPatternDomain(dom) {
  switchTab("patterns");
  setTimeout(() => {
    const box = el("patDomains");
    if (!box) return;
    box.querySelectorAll("input").forEach(i => i.checked = false);
    const input = box.querySelector(`input[data-dom="${CSS.escape(dom)}"]`);
    if (input) { patState.domains.clear(); input.checked = true; onPatDomain(input); }
  }, 40);
}

/* =============== PATTERNS =============== */
const patState = { cats: new Set(), domains: new Set() };

function initPatterns() {
  const P = DATA.patterns;
  el("patCats").innerHTML = P.categories.map(c =>
    `<label class="filter-item"><input type="checkbox" data-cat="${c.id}" onchange="onPatCat(this)" checked> ${escHtml(c.name)}<span class="cnt">${P.patterns.filter(p => p.cat === c.id).length}</span></label>`).join("");
  const doms = uniq(P.patterns.flatMap(p => p.domains)).sort();
  el("patDomains").innerHTML = doms.map(d =>
    `<label class="filter-item"><input type="checkbox" data-dom="${escHtml(d)}" onchange="onPatDomain(this)"> ${escHtml(d)}<span class="cnt">${P.patterns.filter(p => p.domains.includes(d)).length}</span></label>`).join("");
  P.categories.forEach(c => patState.cats.add(c.id));
  renderPatterns();
}
function onPatCat(inp) { inp.checked ? patState.cats.add(inp.dataset.cat) : patState.cats.delete(inp.dataset.cat); renderPatterns(); }
function onPatDomain(inp) { inp.checked ? patState.domains.add(inp.dataset.dom) : patState.domains.delete(inp.dataset.dom); renderPatterns(); }
function resetPatFilters() {
  patState.cats.clear(); patState.domains.clear();
  DATA.patterns.categories.forEach(c => patState.cats.add(c.id));
  el("patSearch").value = ""; el("patHasDiagram").checked = false; el("patHasFailures").checked = false;
  document.querySelectorAll("#patCats input").forEach(i => i.checked = true);
  document.querySelectorAll("#patDomains input").forEach(i => i.checked = false);
  renderPatterns();
}

function patClearQ() { el("patSearch").value = ""; renderPatterns(); }
function patRecheckCat(id) {
  patState.cats.add(id);
  document.querySelectorAll("#patCats input").forEach(i => { if (i.dataset.cat === id) i.checked = true; });
  renderPatterns();
}
function patUncheckDom(d) {
  patState.domains.delete(d);
  document.querySelectorAll("#patDomains input").forEach(i => { if (i.dataset.dom === d) i.checked = false; });
  renderPatterns();
}
function patUnflag(which) {
  if (which === "dia") el("patHasDiagram").checked = false;
  if (which === "fail") el("patHasFailures").checked = false;
  renderPatterns();
}
function patActiveChips(q, needDia, needFail) {
  const P = DATA.patterns, chips = [];
  if (q) chips.push({ label: "“" + q.slice(0, 24) + "”", title: "Search text — click × to clear", fn: "patClearQ()" });
  P.categories.forEach(c => {
    if (!patState.cats.has(c.id)) chips.push({ label: "not: " + c.name, title: "Category hidden — click × to show again", fn: "patRecheckCat('" + escJs(c.id) + "')" });
  });
  [...patState.domains].forEach(d => chips.push({ label: d, title: "Domain filter — click × to remove", fn: "patUncheckDom('" + escJs(d) + "')" }));
  if (needDia) chips.push({ label: "has diagram", title: "Quick filter — click × to remove", fn: "patUnflag('dia')" });
  if (needFail) chips.push({ label: "has failures", title: "Quick filter — click × to remove", fn: "patUnflag('fail')" });
  return chips;
}

function renderPatterns() {
  const P = DATA.patterns;
  const q = el("patSearch").value.trim().toLowerCase();
  const needDia = el("patHasDiagram").checked, needFail = el("patHasFailures").checked;
  let list = P.patterns.filter(p => {
    if (!patState.cats.has(p.cat)) return false;
    if (patState.domains.size && !p.domains.some(d => patState.domains.has(d))) return false;
    if (needDia && !p.diagram) return false;
    if (needFail && !(p.failures || []).length) return false;
    if (q) {
      const hay = (p.id + " " + p.name + " " + p.summary + " " + p.domains.join(" ") + " " + (p.failures || []).map(f => f.n).join(" ") + " " + (p.protections || []).join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const sort = el("patSort").value;
  if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "risk") list.sort((a, b) => (b.failures || []).length - (a.failures || []).length);
  else if (sort === "gap") list.sort((a, b) => (a.protections || []).length - (b.protections || []).length || (b.failures || []).length - (a.failures || []).length);
  else list.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));

  el("patCount").textContent = `${list.length} of ${P.patterns.length} patterns`;
  if (typeof paintActiveChips === "function") paintActiveChips("patActive", patActiveChips(q, needDia, needFail));
  if ((uxPrefs.patView || "cards") === "list") return renderPatternList(list, P);
  const catName = id => (P.categories.find(c => c.id === id) || {}).name || id;
  el("patGrid").innerHTML = list.map(p => `
    <div class="pat-card" role="listitem" onclick="openPattern('${p.id}')">
      <div class="cat">${escHtml(catName(p.cat))}</div>
      <div class="nm">${escHtml(p.name)}</div>
      <div class="sm">${escHtml(p.summary)}</div>
      <div class="chips">
        ${(p.failures || []).slice(0, 2).map(f => `<span class="chip risk">${escHtml(f.n)}</span>`).join("")}
        <span class="chip ok">${(p.protections || []).length} protections</span>
        ${p.diagram ? `<span class="chip">◇ diagram</span>` : ""}
      </div>
    </div>`).join("") || (typeof emptyState === "function"
      ? emptyState("◆", "No patterns match", "The catalog holds " + catN("patterns", 107) + " patterns — loosen a filter or clear the search to see them again.", "Reset filters", "resetPatFilters()")
      : `<p class="muted">No patterns match the current filters.</p>`);
}

/* Compact list view: one dense row per pattern for fast scanning. */
function renderPatternList(list, P) {
  const catName = id => (P.categories.find(c => c.id === id) || {}).name || id;
  if (!list.length) {
    el("patGrid").innerHTML = typeof emptyState === "function"
      ? emptyState("◆", "No patterns match", "The catalog holds " + catN("patterns", 107) + " patterns — loosen a filter or clear the search to see them again.", "Reset filters", "resetPatFilters()")
      : `<p class="muted">No patterns match the current filters.</p>`;
    return;
  }
  el("patGrid").innerHTML = `<div class="mini-list" role="list">` + list.map(p => `
    <div class="mini-row" role="listitem" tabindex="0" onclick="openPattern('${p.id}')" onkeydown="if(event.key==='Enter')openPattern('${p.id}')">
      <span class="mini-nm">${escHtml(p.name)}</span>
      <span class="mini-meta">${escHtml(catName(p.cat))} · ${(p.failures || []).length} failure${(p.failures || []).length === 1 ? "" : "s"} · ${(p.protections || []).length} protections${p.diagram ? " · ◇ diagram" : ""}</span>
    </div>`).join("") + `</div>`;
}

function openPattern(id) {
  const P = DATA.patterns;
  const p = P.patterns.find(x => x.id === id);
  if (!p) return;
  const cat = P.categories.find(c => c.id === p.cat) || {};
  const sevCls = { critical: "var(--red)", high: "var(--orange)", medium: "var(--accent)", low: "var(--green)" };
  const rel = (p.related || []).map(rid => {
    const rp = P.patterns.find(x => x.id === rid);
    return rp ? `<a href="#" onclick="openPattern('${rid}');return false;">${escHtml(rp.name)}</a>` : escHtml(rid);
  }).join(" · ");

  const html = `
    <div class="dsec d-actions">${typeof bpDrawerBtnHtml === "function" ? bpDrawerBtnHtml(p.id) : ""}<button class="btn sm" onclick="askCopilotAbout('pattern: ${escHtml(p.name)}')">🤖 Ask Fox - Architect</button>${typeof pinBtnHtml === "function" ? pinBtnHtml("patterns", p.id) : ""}</div>
    <div class="dsec"><p>${escHtml(p.summary)}</p>
      <p class="small muted">Domains: ${p.domains.map(escHtml).join(", ")} · Pattern ID: <code>${escHtml(p.id)}</code></p></div>
    ${p.diagram ? `<div class="dsec"><h4>Control flow</h4>${diagramHtml(p.diagram, p.name)}</div>` : ""}
    <div class="dsec"><h4>How it works</h4><ul>${p.how.map(h => `<li>${escHtml(h)}</li>`).join("")}</ul></div>
    <div class="dsec"><h4>Components</h4><p>${p.components.map(escHtml).join(" · ")}</p></div>
    <div class="dsec"><h4>What can go wrong</h4>
      <table class="tbl"><tr><th>Failure mode</th><th>Severity</th><th>Description</th></tr>
      ${(p.failures || []).map(f => `<tr><td>${escHtml(f.n)}</td><td style="color:${sevCls[f.sev] || "var(--text2)"}">${escHtml(f.sev)}</td><td>${escHtml(f.d)}</td></tr>`).join("")}
      </table></div>
    <div class="dsec"><h4>How to protect</h4><ul>${p.protections.map(x => `<li>${escHtml(x)}</li>`).join("")}</ul></div>
    ${rel ? `<div class="dsec"><h4>Related patterns</h4><p>${rel}</p></div>` : ""}
    ${typeof casLinksForPattern === "function" ? casLinksForPattern(p.id) : ""}
    <div class="dsec"><h4>Category context</h4>${diagramHtml(P.categoryDiagrams[p.cat] || "", cat.name)}<p class="small muted">${escHtml(cat.desc || "")}</p></div>`;
  openDetail(p.name, cat.name || p.cat, html);
}
