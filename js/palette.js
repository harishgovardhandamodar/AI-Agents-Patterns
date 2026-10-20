/* js/palette.js — global search / command palette (Ctrl/Cmd+K)
   One overlay over the whole app: catalog items (patterns, scenarios,
   cascades), tabs, blueprint templates and saved blueprints. Purely
   keyboard-driven; every result calls the same function the UI buttons do. */
"use strict";

const PAL_KINDS = {
  tab:      { label: "Go to",       run: x => switchTab(x.id) },
  pattern:  { label: "Pattern",     run: x => goTo("patterns", x.id) },
  scenario: { label: "Scenario",    run: x => goTo("scenarios", x.id) },
  cascade:  { label: "Cascade",     run: x => goTo("cascades", x.id) },
  template: { label: "Blueprint",   run: x => goTo("blueprint", "tpl:" + x.id) },
  library:  { label: "Saved bp",    run: x => goTo("blueprint", "lib:" + x.id) },
  cmd:      { label: "Command",     run: x => x.run() },
  project:  { label: "Project",     run: x => { if (typeof projSwitch === "function") projSwitch(x.id); } },
  resset:   { label: "Research set", run: x => { if (typeof resApply === "function") resApply(x.id); } },
  recent:   { label: "Recent",      run: x => { const i = el("palInput"); if (i) { i.value = x.id; palSel = 0; palRender(); i.focus(); } } }
};

/* One-shot commands: things users otherwise hunt through tabs to find. */
const PAL_COMMANDS = [
  { id: "cmd-theme",   title: "Toggle theme (dark / light)", run: () => toggleTheme() },
  { id: "cmd-display", title: "Display preferences (density, text size)", run: () => uxPanelToggle(true) },
  { id: "cmd-undo",    title: "Undo last change", run: () => undoOnce() },
  { id: "cmd-redo",    title: "Redo", run: () => redoOnce() },
  { id: "cmd-newchat", title: "New copilot chat", run: () => { switchTab("copilot"); copilotNew(); } },
  { id: "cmd-expmd",   title: "Export architect report (Markdown)", run: () => rpDownload("md") },
  { id: "cmd-expjson", title: "Export architect report (JSON)", run: () => rpDownload("json") },
  { id: "cmd-guide",   title: "Open guide for this tab", run: () => helpOpen() },
  { id: "cmd-tour",    title: "Replay the welcome tour", run: () => onbShow(true) },
  { id: "cmd-bpcopy",  title: "Copy blueprint as Markdown", run: () => bpCopy("md", "Blueprint copied as Markdown") },
  { id: "cmd-bpsave",  title: "Save blueprint to library", run: () => bpSaveToLib() },
  { id: "cmd-backup",  title: "Back up all saved data (download JSON)", run: () => backupAll() },
  { id: "cmd-restore", title: "Restore saved data from a backup file", run: () => restoreAll() }
];

/* Project-aware and workflow commands (iteration 118).
   The palette used to know about tabs, catalog items and templates — but
   not about the *work*: which project you are in, which stage you are at,
   or what the app thinks you should do next. Those are the things a user
   actually wants when they reach for a command palette. */
function palDynamicCommands() {
  const out = [];
  /* the current project */
  try {
    if (typeof projGet === "function") {
      const p = projGet();
      if (p) {
        out.push({ id: "cmd-project", title: "Project: " + p.name + " (switch / rename)", run: () => projPanelToggle(true) });
        out.push({ id: "cmd-project-new", title: "New project", run: () => { projPanelToggle(true); } });
      }
    }
  } catch (e) { /* project module unavailable */ }
  /* the workflow: the next step, and each stage */
  try {
    if (typeof wfNext === "function") {
      const n = wfNext();
      out.push({ id: "cmd-next", title: "Next: " + n.cta, run: () => { switchTab(n.tab); focusPane(n.tab); } });
    }
    if (typeof wfStatus === "function") {
      wfStatus().stages.forEach(function (g) {
        out.push({ id: "cmd-stage-" + g.k, title: "Stage: " + g.label + " — " + g.detail, run: () => wfGo(g.tab) });
      });
    }
  } catch (e) { /* workflow module unavailable */ }
  /* the current blueprint and plan */
  try {
    if (typeof bpState !== "undefined" && bpState.comps.length) {
      out.push({ id: "cmd-bp-threat", title: "Open the blueprint threat model", run: () => { switchTab("blueprint"); focusPane("blueprint"); } });
    }
    if (typeof dpState !== "undefined" && dpState.done) {
      out.push({ id: "cmd-dp-stack", title: "Materialise the recommended stack as a blueprint", run: () => dpMaterialise("add") });
    }
    if (typeof guardState !== "undefined" && guardState.items.length) {
      out.push({ id: "cmd-guard-bp", title: "Add the guardrail analysis to the blueprint", run: () => guardAddToBlueprint(guardState.items[0], "add") });
    }
  } catch (e) { /* a tool is not ready */ }
  return out;
}

/* The command list the palette searches, including the dynamic ones. */
function palAllCommands() {
  return PAL_COMMANDS.concat(palDynamicCommands());
}


/* Recents + usage learning (persisted; palette gets smarter the more it is used). */
const PAL_STORE = "aap.pal.v1";
const palMem = { recent: [], used: {} };
(function palMemLoad() {
  try {
    const j = JSON.parse(localStorage.getItem(PAL_STORE) || "{}");
    if (Array.isArray(j.recent)) palMem.recent = j.recent.filter(x => typeof x === "string").slice(0, 8);
    if (j.used && typeof j.used === "object") palMem.used = j.used;
  } catch (e) {}
})();
function palMemSave() {
  try {
    const used = {};
    Object.keys(palMem.used).slice(-200).forEach(k => { used[k] = Math.min(9, palMem.used[k] || 0); });
    palMem.used = used;
    localStorage.setItem(PAL_STORE, JSON.stringify(palMem));
  } catch (e) {}
}
function palUseKey(it) { return it.kind + ":" + it.id; }

const PAL_TABS = [
  ["overview", "Overview"], ["copilot", "Fox - Architect"], ["patterns", "Patterns"],
  ["scenarios", "Failure Scenarios"], ["cascades", "Cascade Explorer"], ["coverage", "Coverage"],
  ["deploy", "Deployment Planner"], ["blueprint", "Blueprints"], ["live", "Live View"],
  ["design", "Design & Architecture"], ["guard", "Guardrail Lab"], ["discovery", "Discovery Lab"]
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
  /* projects and research sets (iteration 118) */
  if (typeof projAll === "function") projAll().forEach(p => {
    items.push({ kind: "project", id: p.id, title: p.name, sub: "project" + (p.id === projActiveId() ? " · current" : "") });
  });
  if (typeof resAll === "function") resAll().forEach(s => {
    items.push({ kind: "resset", id: s.id, title: s.name, sub: "research set · " + (s.pane || "") });
  });
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
  if (!q) {
    const out = palMem.recent.slice(0, 5).map(r => ({ it: { kind: "recent", id: r, title: r, sub: "search again" }, sc: -1, grp: 0 }));
    /* the next step and the current project lead the empty state — they
       are what the user came to the palette for (iteration 118) */
    palDynamicCommands().slice(0, 3).forEach(c => {
      out.push({ it: { kind: "cmd", id: c.id, title: c.title, sub: "command", run: c.run }, sc: 0, grp: 0 });
    });
    items.filter(it => it.kind === "tab" || it.kind === "template").slice(0, 12)
      .forEach(it => out.push({ it: it, sc: 0, grp: 1 }));
    return out;
  }
  /* kind prefixes: ">…" commands only, "pat:/scn:/cas:/tab:" scope to one kind */
  let onlyCmd = false, onlyKind = null;
  const m = q.match(/^(>|pat:|scn:|cas:|tab:|proj:|stage:)\s*(.*)$/);
  if (m) {
    if (m[1] === ">") onlyCmd = true;
    else if (m[1] === "proj:") onlyKind = "cmd-project";
    else if (m[1] === "stage:") onlyKind = "cmd-stage-";
    else onlyKind = { "pat:": "pattern", "scn:": "scenario", "cas:": "cascade", "tab:": "tab" }[m[1]];
    q = m[2];
  }
  const hits = [];
  if (!onlyKind) {
    palAllCommands().forEach(c => {
      if (!q || c.title.toLowerCase().indexOf(q) >= 0 || c.id.toLowerCase().indexOf(q) >= 0)
        hits.push({ it: { kind: "cmd", id: c.id, title: c.title, sub: "command", run: c.run }, sc: onlyCmd ? 0 : 2.5 });
    });
  } else if (onlyKind === "cmd-project" || onlyKind === "cmd-stage-") {
    palAllCommands().forEach(c => {
      if (c.id.indexOf(onlyKind) !== 0) return;
      if (!q || c.title.toLowerCase().indexOf(q) >= 0 || c.id.toLowerCase().indexOf(q) >= 0)
        hits.push({ it: { kind: "cmd", id: c.id, title: c.title, sub: "command", run: c.run }, sc: 0 });
    });
  }
  if (!onlyCmd) {
    items.forEach(it => {
      if (onlyKind && it.kind !== onlyKind) return;
      const sc = q ? palScore(it, q) : 0;
      if (sc >= 0) hits.push({ it: it, sc: sc });
    });
  }
  /* usage learning + pin boost: frequently used and pinned items float up */
  hits.forEach(h => {
    const u = palMem.used[palUseKey(h.it)] || 0;
    h.boost = Math.min(3, u) * 0.3;
    try {
      if (typeof pinHas === "function" &&
        ((h.it.kind === "pattern" && pinHas("patterns", h.it.id)) ||
         (h.it.kind === "scenario" && pinHas("scenarios", h.it.id)) ||
         (h.it.kind === "cascade" && pinHas("cascades", h.it.id)))) h.boost += 0.6;
    } catch (e) {}
  });
  hits.sort((a, b) => (a.grp || 0) - (b.grp || 0) || (a.sc - (a.boost || 0)) - (b.sc - (b.boost || 0)) || a.it.title.length - b.it.title.length);
  return hits.slice(0, 30);
}

function palHi(title, q) {
  const esc = escHtml(title);
  q = (q || "").trim().replace(/^(>|pat:|scn:|cas:|tab:)\s*/, "");
  if (q.length < 2) return esc;
  const i = title.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc;
  return escHtml(title.slice(0, i)) + "<mark>" + escHtml(title.slice(i, i + q.length)) + "</mark>" + escHtml(title.slice(i + q.length));
}

function palRender() {
  const q = el("palInput") ? el("palInput").value : "";
  palHits = palSearch(q);
  palSel = Math.min(palSel, Math.max(0, palHits.length - 1));
  const list = el("palList");
  if (!list) return;
  if (!palHits.length) {
    list.innerHTML = `<div class="pal-empty">No matches for "${escHtml(q)}" — try <b>pat:</b>, <b>scn:</b>, <b>cas:</b> to scope, or <b>&gt;</b> for commands.</div>`;
    return;
  }
  let lastGrp = -1;
  list.innerHTML = palHits.map((h, i) => {
    const head = (h.grp != null && h.grp !== lastGrp) ? `<div class="pal-grp">${h.grp === 0 ? "Recent" : "Browse"}</div>` : "";
    lastGrp = h.grp == null ? lastGrp : h.grp;
    return head + `<div class="pal-item ${i === palSel ? "sel" : ""}" data-i="${i}" onmousedown="event.preventDefault()" onclick="palPick(${i})">
      <span class="pal-kind k-${h.it.kind}">${escHtml(PAL_KINDS[h.it.kind].label)}</span>
      <span class="pal-title">${palHi(h.it.title, q)}</span>
      <span class="pal-sub">${escHtml(h.it.sub || "")}</span>
    </div>`;
  }).join("");
  const sel = list.querySelector(".pal-item.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function palPick(i) {
  const h = palHits[i != null ? i : palSel];
  if (!h) return;
  const q = el("palInput") ? el("palInput").value.trim() : "";
  if (h.it.kind !== "recent" && h.it.kind !== "cmd" && q) {
    palMem.recent = [q].concat(palMem.recent.filter(r => r !== q)).slice(0, 8);
  }
  palMem.used[palUseKey(h.it)] = (palMem.used[palUseKey(h.it)] || 0) + 1;
  palMemSave();
  if (h.it.kind === "recent") { const inp = el("palInput"); if (inp) { inp.value = h.it.id; palSel = 0; palRender(); inp.focus(); } return; }
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
    <div class="pal-foot"><span><b>↑↓</b> move · <b>Enter</b> open · <b>&gt;</b> commands · <b>pat: scn: cas:</b> scope · <b>Esc</b> close</span></div>
  </div>`;
  d.addEventListener("mousedown", e => { if (e.target === d) palClose(); });
  document.body.appendChild(d);
  document.addEventListener("keydown", palKey);
}
