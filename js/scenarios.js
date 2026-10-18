/* scenarios.js — failure-scenario catalog tab */
"use strict";

const scnState = { domains: new Set(), sevs: new Set(), vectors: new Set() };

function initScenarios() {
  const S = DATA.scenarios;
  const doms = uniq(S.scenarios.map(s => s.domain)).sort();
  el("scnDomains").innerHTML = doms.map(d =>
    `<label class="filter-item"><input type="checkbox" data-dom="${escHtml(d)}" onchange="onScnFilter(this,'domains')"> ${escHtml(d)}<span class="cnt">${S.scenarios.filter(s => s.domain === d).length}</span></label>`).join("");
  el("scnSev").innerHTML = ["critical", "high", "medium", "low"].map(sv =>
    `<label class="filter-item"><input type="checkbox" data-sev="${sv}" onchange="onScnFilter(this,'sevs')"> <span class="sev-dot sev-${sv}"></span>${sv}<span class="cnt">${S.scenarios.filter(s => s.severity === sv).length}</span></label>`).join("");
  const vecs = uniq(S.scenarios.map(s => s.vector)).sort();
  el("scnVectors").innerHTML = vecs.map(v =>
    `<label class="filter-item"><input type="checkbox" data-vec="${escHtml(v)}" onchange="onScnFilter(this,'vectors')"> ${escHtml(v)}<span class="cnt">${S.scenarios.filter(s => s.vector === v).length}</span></label>`).join("");
  renderScenarios();
}
function onScnFilter(inp, key) {
  const val = inp.dataset.dom || inp.dataset.sev || inp.dataset.vec;
  inp.checked ? scnState[key].add(val) : scnState[key].delete(val);
  renderScenarios();
}
function resetScnFilters() {
  scnState.domains.clear(); scnState.sevs.clear(); scnState.vectors.clear();
  document.querySelectorAll("#scenariosPane .side input[type=checkbox]").forEach(i => i.checked = false);
  el("scnSearch").value = "";
  renderScenarios();
}

function scnClearQ() { el("scnSearch").value = ""; renderScenarios(); }
function scnUncheck(group, val) {
  scnState[group].delete(val);
  const sel = group === "domains" ? "#scnDomains" : group === "sevs" ? "#scnSev" : "#scnVectors";
  const attr = group === "domains" ? "data-dom" : group === "sevs" ? "data-sev" : "data-vec";
  document.querySelectorAll(sel + " input").forEach(i => { if (i.getAttribute(attr) === val) i.checked = false; });
  renderScenarios();
}
function scnActiveChips(q) {
  const chips = [];
  if (q) chips.push({ label: "“" + q.slice(0, 24) + "”", title: "Search text — click × to clear", fn: "scnClearQ()" });
  [...scnState.domains].forEach(d => chips.push({ label: d, title: "Domain filter — click × to remove", fn: "scnUncheck('domains','" + escJs(d) + "')" }));
  [...scnState.sevs].forEach(s => chips.push({ label: s, title: "Severity filter — click × to remove", fn: "scnUncheck('sevs','" + escJs(s) + "')" }));
  [...scnState.vectors].forEach(v => chips.push({ label: v, title: "Vector filter — click × to remove", fn: "scnUncheck('vectors','" + escJs(v) + "')" }));
  return chips;
}

function renderScenarios() {
  const S = DATA.scenarios;
  const q = el("scnSearch").value.trim().toLowerCase();
  let list = S.scenarios.filter(s => {
    if (scnState.domains.size && !scnState.domains.has(s.domain)) return false;
    if (scnState.sevs.size && !scnState.sevs.has(s.severity)) return false;
    if (scnState.vectors.size && !scnState.vectors.has(s.vector)) return false;
    if (q) {
      const hay = (s.title + " " + s.description + " " + s.vector + " " + s.domain + " " + (s.protections || []).map(p => p.name + p.mechanism).join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const sort = (el("scnSort") && el("scnSort").value) || "severity";
  if (sort === "name") list.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "gaps") list.sort((a, b) => (a.protections || []).length - (b.protections || []).length || sevRank[a.severity] - sevRank[b.severity]);
  else if (sort === "vector") list.sort((a, b) => a.vector.localeCompare(b.vector) || sevRank[a.severity] - sevRank[b.severity]);
  else list.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.title.localeCompare(b.title));

  el("scnCount").textContent = `${list.length} of ${S.scenarios.length} scenarios — click for attack chain, protections, and mock run`;
  if (typeof paintActiveChips === "function") paintActiveChips("scnActive", scnActiveChips(q));
  if ((uxPrefs.scnView || "cards") === "list") return renderScenarioList(list);
  el("scnGrid").innerHTML = list.map(s => `
    <div class="pat-card" onclick="openScenario('${s.id}')">
      <div class="cat" style="color:var(--${s.severity === "critical" ? "red" : s.severity === "high" ? "orange" : "accent"})">${escHtml(s.severity.toUpperCase())} · ${escHtml(s.domain)}</div>
      <div class="nm">${escHtml(s.title)}</div>
      <div class="sm">${escHtml(s.description.slice(0, 180))}…</div>
      <div class="chips">
        <span class="chip">${escHtml(s.vector)}</span>
        <span class="chip ok">${(s.protections || []).length} protections</span>
        ${s.traceId ? `<span class="chip" style="color:var(--teal)">▶ mock run</span>` : ""}
      </div>
    </div>`).join("") || (typeof emptyState === "function"
      ? emptyState("⚠", "No scenarios match", "Try a broader vector or severity — or clear the search to browse all 38 scenarios.", "Reset filters", "resetScnFilters()")
      : `<p class="muted">No scenarios match the current filters.</p>`);
}

/* Compact list view: one dense row per scenario for fast scanning. */
function renderScenarioList(list) {
  if (!list.length) {
    el("scnGrid").innerHTML = typeof emptyState === "function"
      ? emptyState("⚠", "No scenarios match", "Try a broader vector or severity — or clear the search to browse all 38 scenarios.", "Reset filters", "resetScnFilters()")
      : `<p class="muted">No scenarios match the current filters.</p>`;
    return;
  }
  const dot = s => s.severity === "critical" ? "var(--red)" : s.severity === "high" ? "var(--orange)" : s.severity === "medium" ? "var(--accent)" : "var(--green)";
  el("scnGrid").innerHTML = `<div class="mini-list" role="list">` + list.map(s => `
    <div class="mini-row" role="listitem" tabindex="0" onclick="openScenario('${s.id}')" onkeydown="if(event.key==='Enter')openScenario('${s.id}')">
      <span class="sev-dot sev-${s.severity}"></span>
      <span class="mini-nm">${escHtml(s.title)}</span>
      <span class="mini-meta">${escHtml(s.vector)} · ${(s.protections || []).length} protections${s.traceId ? " · ▶ mock run" : ""}</span>
      <span class="mini-sev" style="color:${dot(s)}">${escHtml(s.severity)}</span>
    </div>`).join("") + `</div>`;
}

function openScenario(id) {
  const S = DATA.scenarios, P = DATA.patterns;
  const s = S.scenarios.find(x => x.id === id);
  if (!s) return;
  const patLinks = (s.patternRefs || []).map(pid => {
    const p = P.patterns.find(x => x.id === pid);
    return p ? `<a href="#" onclick="closeDetail();switchTab('patterns');setTimeout(()=>openPattern('${pid}'),80);return false;">${escHtml(p.name)}</a>` : escHtml(pid);
  }).join(" · ");

  const scnActions = ((typeof bpRefsBtnHtml === "function" && (s.patternRefs || []).length) ? bpRefsBtnHtml(s.patternRefs, "from this scenario") : "") +
    `<button class="btn sm" onclick="askCopilotAbout('scenario: ${escHtml(s.title)}')">🤖 Ask the Copilot about this scenario</button>` +
    (typeof pinBtnHtml === "function" ? pinBtnHtml("scenarios", s.id) : "");
  const html = `
    <div class="dsec d-actions">${scnActions}</div>
    <div class="dsec">
      <p><span class="sev-dot sev-${s.severity}"></span><b style="color:var(--${s.severity === "critical" ? "red" : s.severity === "high" ? "orange" : "accent"})">${s.severity.toUpperCase()}</b>
      &nbsp; likelihood: <b>${escHtml(s.likelihood)}</b> &nbsp; vector: <b>${escHtml(s.vector)}</b> &nbsp; domain: <b>${escHtml(s.domain)}</b></p>
      <p>${escHtml(s.description)}</p>
    </div>
    <div class="dsec"><h4>Attack chain (how it unfolds)</h4>
      <ol style="padding-left:20px;margin:0">${s.attackChain.map(a => `<li style="color:var(--text2);margin-bottom:5px">${escHtml(a)}</li>`).join("")}</ol></div>
    <div class="dsec"><h4>Protections (how to stop it)</h4>
      <table class="tbl"><tr><th>Control</th><th>Layer</th><th>Mechanism</th></tr>
      ${s.protections.map(p => `<tr><td>${escHtml(p.name)}</td><td><span class="chip">${escHtml(p.layer)}</span></td><td>${escHtml(p.mechanism)}</td></tr>`).join("")}
      </table></div>
    <div class="dsec"><h4>Detection signals</h4><ul>${s.detection.map(d => `<li>${escHtml(d)}</li>`).join("")}</ul></div>
    <div class="dsec"><h4>Incident response</h4><ul>${s.response.map(r => `<li>${escHtml(r)}</li>`).join("")}</ul></div>
    ${patLinks ? `<div class="dsec"><h4>Relevant design patterns</h4><p>${patLinks}</p></div>` : ""}
    ${casLinksForScenario(s.id)}
    ${s.traceId ? `<div class="dsec"><h4>Mock run</h4><p>This scenario has a replayable execution trace in the Live View.</p>
      <button class="btn primary" onclick="closeDetail();switchTab('live');setTimeout(()=>loadTrace('${s.traceId}'),100);">▶ Open in Live View</button></div>` : ""}`;
  openDetail(s.title, `${s.severity} · ${s.domain}`, html);
}
