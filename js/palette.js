/* js/palette.js — global search / command palette (Ctrl/Cmd+K)
   One overlay over the whole app: catalog items (patterns, scenarios,
   cascades), tabs, blueprint templates and saved blueprints. Purely
   keyboard-driven; every result calls the same function the UI buttons do. */
"use strict";

const PAL_KINDS = {
  tab:      { label: "Go to",       run: x => switchTab(x.id) },
  pattern:  { label: "Pattern",     run: x => { switchTab("patterns"); setTimeout(() => openPattern(x.id), 60); } },
  scenario: { label: "Scenario",    run: x => { switchTab("scenarios"); setTimeout(() => openScenario(x.id), 60); } },
  cascade:  { label: "Cascade",     run: x => { switchTab("cascades"); setTimeout(() => openCascade(x.id), 60); } },
  template: { label: "Blueprint",   run: x => { switchTab("blueprint"); setTimeout(() => bpApplyTemplate(x.id), 60); } },
  library:  { label: "Saved bp",    run: x => { switchTab("blueprint"); setTimeout(() => bpLoadLib(Number(x.id)), 60); } }
};

const PAL_TABS = [
  ["overview", "Overview"], ["copilot", "Architect Copilot"], ["patterns", "Patterns"],
  ["scenarios", "Failure Scenarios"], ["cascades", "Cascade Explorer"], ["coverage", "Coverage"],
  ["deploy", "Deployment Planner"], ["blueprint", "Blueprints"], ["live", "Live View"],
  ["design", "Design & Architecture"], ["guard", "Guardrail Lab"]
];

let palItems = null;
let palSel = 0;
let palHits = [];

function palBuild() {
  if (palItems) return palItems;
  const items = [];
  PAL_TABS.forEach(([id, name]) => items.push({ kind: "tab", id: id, title: name, sub: "tab" }));
  if (typeof DATA !== "undefined" && DATA.patterns) {
    DATA.patterns.patterns.forEach(p => items.push({ kind: "pattern", id: p.id, title: p.name, sub: p.id + " · " + p.cat, hay: (p.name + " " + p.id + " " + (p.summary || "") + " " + (p.domains || []).join(" ")).toLowerCase() }));
    DATA.scenarios.scenarios.forEach(s => items.push({ kind: "scenario", id: s.id, title: s.title, sub: s.id + " · " + s.severity + " · " + s.domain, hay: (s.title + " " + s.id + " " + (s.description || "") + " " + s.domain).toLowerCase() }));
    (DATA.cascades.cascades || []).forEach(c => items.push({ kind: "cascade", id: c.id, title: c.name, sub: c.id + " · " + c.cls + " · " + c.domain, hay: (c.name + " " + c.id + " " + (c.summary || "") + " " + (c.trigger || "") + " " + c.domain).toLowerCase() }));
  }
  if (typeof BP_TEMPLATES !== "undefined") BP_TEMPLATES.forEach(t => items.push({ kind: "template", id: t.k, title: t.name, sub: "template · " + t.comps.length + " components" }));
  if (typeof bpState !== "undefined" && Array.isArray(bpState.lib)) bpState.lib.forEach((e, i) => items.push({ kind: "library", id: String(i), title: e.name || "Blueprint " + (i + 1), sub: (e.comps || []).length + " components · saved" }));
  items.forEach(it => { if (!it.hay) it.hay = (it.title + " " + it.sub).toLowerCase(); });
  palItems = items;
  return items;
}

function palInvalidate() { palItems = null; } /* library changes call this */

function palScore(it, q) {
  const t = it.title.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.indexOf(q) >= 0) return 2;
  if (it.hay.indexOf(q) >= 0) return 3;
  /* subsequence match (letters in order) — lets "dppi" find "Dual pane prompt injection" */
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) j++;
  if (j === q.length) return 4;
  return -1;
}

function palSearch(q) {
  q = q.trim().toLowerCase();
  const items = palBuild();
  if (!q) return items.filter(it => it.kind === "tab" || it.kind === "template").slice(0, 12).map(it => ({ it: it, sc: 0 }));
  const hits = [];
  items.forEach(it => { const sc = palScore(it, q); if (sc >= 0) hits.push({ it: it, sc: sc }); });
  hits.sort((a, b) => a.sc - b.sc || a.it.title.length - b.it.title.length);
  return hits.slice(0, 30);
}

function palRender() {
  const q = el("palInput") ? el("palInput").value : "";
  palHits = palSearch(q);
  palSel = Math.min(palSel, Math.max(0, palHits.length - 1));
  const list = el("palList");
  if (!list) return;
  if (!palHits.length) { list.innerHTML = `<div class="pal-empty">No matches for "${escHtml(q)}"</div>`; return; }
  list.innerHTML = palHits.map((h, i) =>
    `<div class="pal-item ${i === palSel ? "sel" : ""}" data-i="${i}" onmousedown="event.preventDefault()" onclick="palPick(${i})">
      <span class="pal-kind k-${h.it.kind}">${escHtml(PAL_KINDS[h.it.kind].label)}</span>
      <span class="pal-title">${escHtml(h.it.title)}</span>
      <span class="pal-sub">${escHtml(h.it.sub || "")}</span>
    </div>`).join("");
  const sel = list.querySelector(".pal-item.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function palPick(i) {
  const h = palHits[i != null ? i : palSel];
  if (!h) return;
  palClose();
  PAL_KINDS[h.it.kind].run(h.it);
}

function palOpen() {
  const o = el("palOverlay");
  if (!o) return;
  o.classList.add("open");
  const inp = el("palInput");
  inp.value = ""; palSel = 0; palRender(); inp.focus();
}
function palClose() {
  const o = el("palOverlay");
  if (o) o.classList.remove("open");
}

function palKey(e) {
  const o = el("palOverlay");
  if (!o || !o.classList.contains("open")) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palOpen(); }
    return;
  }
  if (e.key === "Escape") { e.preventDefault(); palClose(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palSel + 1, palHits.length - 1); palRender(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(palSel - 1, 0); palRender(); }
  else if (e.key === "Enter") { e.preventDefault(); palPick(); }
}

function initPalette() {
  if (el("palOverlay")) return;
  const d = document.createElement("div");
  d.id = "palOverlay";
  d.className = "pal-overlay";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.setAttribute("aria-label", "Command palette");
  d.innerHTML = `<div class="pal-box">
    <input id="palInput" class="pal-input" aria-label="Search everything" placeholder="Search patterns, scenarios, cascades, tabs, templates… (↑↓ to move, Enter to open)" oninput="palSel=0;palRender()" autocomplete="off">
    <div id="palList" class="pal-list"></div>
    <div class="pal-foot"><span><b>Ctrl/⌘ K</b> open · <b>↑↓</b> move · <b>Enter</b> open · <b>Esc</b> close</span></div>
  </div>`;
  d.addEventListener("mousedown", e => { if (e.target === d) palClose(); });
  document.body.appendChild(d);
  document.addEventListener("keydown", palKey);
}
