/* js/project.js — the project spine (iterations 101–102).
 *
 * The app's real work is a five-stage chain:
 *   discover → research → design → harden → deliver
 * but until now each authoring tool described its *own* system: the planner
 * had `a.system`, the blueprint had `name`, the guardrail lab had a request
 * title, the discovery lab had a run. Nothing tied them together, so the
 * exported report was a pile of unrelated documents.
 *
 * A **project** is a named workspace that owns one set of artefacts:
 *
 *   { id, name, domain, createdAt, updatedAt,
 *     plan:   <deployment intake + scorecard + risks + adr>,
 *     bp:     <blueprint components + notes + estimate>,
 *     guards: [<guardrail analyses>],
 *     runs:   [<discovery runs>],
 *     mit:    <cascade mitigation backlog>,
 *     pins:   { patterns, scenarios, cascades } }
 *
 * The design rule is deliberately simple and deliberately local:
 *   - The project owns the *authoring* state. The catalog (patterns,
 *     scenarios, cascades) stays global and read-only.
 *   - Switching projects snapshots the current tool state into the outgoing
 *     project and restores the incoming one. Nothing is lost.
 *   - A project is a plain JSON object in localStorage, exportable and
 *     importable like every other artefact in the app.
 *
 * Everything here is defensive: a missing/!project key must never stop a
 * tab from rendering, so the store falls back to a single default project
 * and the tools keep working with their pre-project behaviour.
 */
"use strict";

const PROJ_STORE = "aap.projects.v1";
const PROJ_ACTIVE = "aap.project.active.v1";
const PROJ_MAX = 12;

/* The five stages of the workflow, and which tab owns each. Used by the
   workflow rail (iteration 117) and by the "Next:" engine (107). */
const PROJ_STAGES = [
  { k: "discover", label: "Discover", tab: "overview",  hint: "What is new in the catalog" },
  { k: "research", label: "Research", tab: "scenarios", hint: "What can go wrong" },
  { k: "design",   label: "Design",   tab: "deploy",    hint: "Intake, readiness, stack" },
  { k: "harden",   label: "Harden",   tab: "blueprint", hint: "Architecture, threat model, controls" },
  { k: "deliver",  label: "Deliver",  tab: "overview",  hint: "Report, ADR, export" }
];

/* ---------------------------------------------------------------- store -- */

function projId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function projBlank(name) {
  return {
    id: projId(),
    name: name || "Untitled system",
    domain: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: null,     // deployment intake
    bp: null,       // blueprint
    guards: [],     // guardrail analyses
    runs: [],       // discovery runs
    mit: {},        // cascade mitigation backlog
    pins: { patterns: [], scenarios: [], cascades: [] }
  };
}

/* Read the raw project list. A corrupt store yields an empty list rather
   than an exception — the app must still boot. */
function projAll() {
  try {
    const v = JSON.parse(localStorage.getItem(PROJ_STORE) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

function projWriteAll(list) {
  try { localStorage.setItem(PROJ_STORE, JSON.stringify(list)); return true; }
  catch (e) { return false; }
}

/* The active project id. Always returns a usable id: if the store is empty
   a default project is created lazily. */
function projActiveId() {
  let id = null;
  try { id = localStorage.getItem(PROJ_ACTIVE); } catch (e) {}
  const list = projAll();
  if (id && list.some(p => p.id === id)) return id;
  if (list.length) {
    const first = list[0].id;
    try { localStorage.setItem(PROJ_ACTIVE, first); } catch (e) {}
    return first;
  }
  const fresh = projEnsure("Default project");
  try { localStorage.setItem(PROJ_ACTIVE, fresh.id); } catch (e) {}
  return fresh.id;
}

/* Fetch a project by id, or the active one. Always returns an object with
   every field present (older stores may lack the newer ones). */
function projGet(id) {
  const list = projAll();
  const p = list.find(x => x.id === (id || projActiveId()));
  if (!p) return null;
  return projNormalize(p);
}

/* Fill in any field a stored project might be missing, so every consumer
   can rely on the shape. */
function projNormalize(p) {
  const d = projBlank();
  const out = Object.assign(d, p || {});
  out.plan = out.plan || null;
  out.bp = out.bp || null;
  out.guards = Array.isArray(out.guards) ? out.guards : [];
  out.runs = Array.isArray(out.runs) ? out.runs : [];
  out.mit = out.mit && typeof out.mit === "object" ? out.mit : {};
  out.pins = out.pins && typeof out.pins === "object" ? out.pins : { patterns: [], scenarios: [], cascades: [] };
  ["patterns", "scenarios", "cascades"].forEach(k => {
    if (!Array.isArray(out.pins[k])) out.pins[k] = [];
  });
  return out;
}

/* Create a project. By default it is NOT made active — projEnsure is also
   used as a lazy fallback by projActiveId(), and by the import path where
   making the last imported project active would be surprising. */
function projEnsure(name, makeActive) {
  const list = projAll();
  const p = projBlank(name);
  list.push(p);
  if (list.length > PROJ_MAX) list.shift();       // keep the store bounded
  projWriteAll(list);
  if (makeActive) { try { localStorage.setItem(PROJ_ACTIVE, p.id); } catch (e) {} }
  return p;
}

/* Rename / re-describe the active project. */
function projRename(name, domain) {
  const id = projActiveId();
  const list = projAll();
  const p = list.find(x => x.id === id);
  if (!p) return null;
  if (name != null && String(name).trim()) p.name = String(name).trim().slice(0, 120);
  if (domain != null) p.domain = String(domain).slice(0, 60);
  p.updatedAt = new Date().toISOString();
  projWriteAll(list);
  return projNormalize(p);
}

/* Persist a patch onto the active project. `patch` is a shallow merge. */
function projPatch(patch) {
  const id = projActiveId();
  const list = projAll();
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return null;
  const p = projNormalize(list[i]);
  Object.assign(p, patch || {});
  p.updatedAt = new Date().toISOString();
  list[i] = p;
  projWriteAll(list);
  return p;
}

/* Delete a project (never the last one). */
function projDelete(id) {
  const list = projAll();
  if (list.length <= 1) { showNotif("Keep at least one project", { kind: "warn" }); return false; }
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  projWriteAll(list);
  if (projActiveId() !== id) {
    /* keep the active id pointing at a live project */
    const alive = projAll()[0];
    if (alive) { try { localStorage.setItem(PROJ_ACTIVE, alive.id); } catch (e) {} }
  }
  return true;
}

/* ------------------------------------------------------------------ UI -- */

/* The project chip in the top bar. Clicking opens the project panel. */
function projChipHtml() {
  const p = projGet();
  if (!p) return "";
  const n = p.guards.length + (p.bp && p.bp.comps && p.bp.comps.length ? 1 : 0) + (p.plan ? 1 : 0);
  return '<button class="iconbtn proj-chip" id="projChip" data-act="projPanelToggle" title="Current project — click to switch" aria-label="Current project" aria-haspopup="dialog" aria-expanded="false">' +
    '<span aria-hidden="true">📁</span> <span id="projChipName">' + escHtml(p.name) + "</span>" +
    (n ? ' <span class="badge" id="projChipCount">' + n + "</span>" : "") +
    "</button>";
}

/* Paint the chip into the top bar (idempotent). */
function projPaintChip() {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  let chip = document.getElementById("projChip");
  if (!chip) {
    /* Prefer the static host in index.html; only create one if absent. */
    let host = document.getElementById("projChipHost");
    if (!host) {
      host = document.createElement("span");
      host.id = "projChipHost";
      host.style.display = "inline-flex";
      const spacer = bar.querySelector(".spacer");
      if (spacer) spacer.insertAdjacentElement("afterend", host);
      else bar.appendChild(host);
    }
    host.innerHTML = projChipHtml();
    return;
  }
  const name = document.getElementById("projChipName");
  const p = projGet();
  if (name && p) name.textContent = p.name;
  const badge = document.getElementById("projChipCount");
  if (badge && p) {
    const n = p.guards.length + (p.bp && p.bp.comps && p.bp.comps.length ? 1 : 0) + (p.plan ? 1 : 0);
    badge.textContent = n;
    badge.hidden = !n;
  }
}

function projPanelToggle(force) {
  let p = document.getElementById("projPanel");
  if (!p) {
    p = document.createElement("div");
    p.id = "projPanel";
    p.className = "ux-panel proj-panel";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Projects");
    document.body.appendChild(p);
  }
  p.classList.toggle("open", force == null ? !p.classList.contains("open") : !!force);
  const btn = document.getElementById("projChip");
  if (btn) btn.setAttribute("aria-expanded", p.classList.contains("open") ? "true" : "false");
  if (p.classList.contains("open")) { projPaintPanel(); const f = p.querySelector("input,button"); if (f) f.focus(); }
  else if (btn) btn.focus();
}

function projPaintPanel() {
  const p = document.getElementById("projPanel");
  if (!p || !p.classList.contains("open")) return;
  const list = projAll().map(projNormalize);
  const active = projActiveId();
  const rows = list.map(x => {
    const arts = (x.plan ? 1 : 0) + (x.bp && x.bp.comps && x.bp.comps.length ? 1 : 0) +
      x.guards.length + x.runs.length +
      (x.pins.patterns.length + x.pins.scenarios.length + x.pins.cascades.length ? 1 : 0);
    const on = x.id === active;
    return '<div class="proj-row' + (on ? " active" : "") + '">' +
      '<button class="proj-name" data-act="projSwitch" data-args="' + dataArgs(x.id) + '" aria-current="' + (on ? "true" : "false") + '">' +
      '<b>' + escHtml(x.name) + "</b>" +
      '<i>' + (x.domain ? escHtml(x.domain) + " · " : "") + arts + " artefact" + (arts === 1 ? "" : "s") + "</i></button>" +
      (list.length > 1 ? '<button class="iconbtn" data-act="projDelete" data-args="' + dataArgs(x.id) + '" title="Delete project" aria-label="Delete project ' + escHtml(x.name) + '">🗑</button>' : "") +
      "</div>";
  }).join("");

  p.innerHTML =
    '<div class="ux-head"><b>Projects</b>' +
    '<button class="iconbtn" type="button" data-act="projPanelToggle" data-args="[false]" aria-label="Close projects">✕</button></div>' +
    '<div class="ux-sec">Active</div>' +
    '<div class="ux-usage"><div class="ux-usage-row"><span>Name</span><b>' + escHtml((projGet() || {}).name || "") + "</b></div>" +
    '<div class="ux-usage-row"><span>Domain</span><b>' + escHtml((projGet() || {}).domain || "—") + "</b></div></div>" +
    (typeof dlCopyWorkLink === "function" ? '<div class="ux-btns" style="margin-top:6px"><button class="btn sm" type="button" data-act="dlCopyProject" title="Copy a link that opens this project">🔗 Copy project link</button></div>' : "") +
    '<div style="display:flex;gap:6px;margin:8px 0">' +
    '<input class="search" id="projNameInput" aria-label="Project name" placeholder="Project name…" value="' + escHtml((projGet() || {}).name || "") + '" style="flex:1">' +
    '<button class="btn sm primary" type="button" data-act="projRenameFromUI">Rename</button></div>' +
    '<div class="ux-sec">All projects</div>' +
    '<div class="proj-list">' + rows + "</div>" +
    '<div class="ux-btns"><button class="btn sm" type="button" data-act="projNewFromUI">＋ New project</button>' +
    '<button class="btn sm" type="button" data-act="projExport">⬇ Export</button>' +
    '<button class="btn sm" type="button" data-act="projImport">⬒ Import</button></div>' +
    '<div class="muted small" style="margin-top:8px">A project groups the planner, blueprint, guardrail analyses, discovery runs, mitigation backlog and pins for one system. Switching projects keeps every one of them.</div>';
}

function projRenameFromUI() {
  const v = el("projNameInput") ? el("projNameInput").value : "";
  if (!v.trim()) { showNotif("Give the project a name", { kind: "warn" }); return; }
  projRename(v);
  projPaintChip();
  projPaintPanel();
  showNotif("Project renamed to “" + v.trim() + "”");
  if (typeof dashRender === "function") dashRender();
}

/* Create a project and switch to it. */
function projNewFromUI() {
  const p = projEnsure("New project");
  projSwitch(p.id);
}

/* Switch the active project, snapshotting tool state both ways. */
function projSwitch(id) {
  if (!id) { projPanelToggle(false); return; }
  if (id === projActiveId()) { projPanelToggle(false); return; }
  /* snapshot the outgoing project's tools before the active id moves */
  projSnapshotTools();
  try { localStorage.setItem(PROJ_ACTIVE, id); } catch (e) {}
  projRestoreTools();
  projPaintChip();
  projPanelToggle(false);
  const p = projGet();
  showNotif("Switched to “" + (p ? p.name : "project") + "”");
  if (typeof dashRender === "function") dashRender();
  if (typeof window.rpPaintProjectNote === "function") window.rpPaintProjectNote();
}

/* ------------------------------------------------- tool state bridging -- */

/* Capture the live tool state into the *current* project. Called before a
   project switch and whenever a tool saves (so the project is never stale
   if the browser closes). */
function projSnapshotTools() {
  const p = projGet();
  if (!p) return null;
  try {
    if (typeof dpState !== "undefined") p.plan = {
      step: dpState.step, done: dpState.done, a: dpState.a,
      target: dpState.target, ack: dpState.ack, adrStatus: dpState.adrStatus
    };
    if (typeof bpState !== "undefined") p.bp = {
      name: bpState.name, comps: bpState.comps.slice(), notes: bpState.notes, est: bpState.est
    };
    if (typeof guardState !== "undefined" && guardState.items) p.guards = guardState.items.slice();
    if (typeof discState !== "undefined" && discState.run) {
      p.runs = [discState.run];
    }
    if (typeof pinState !== "undefined") {
      p.pins = {
        patterns: pinState.patterns.slice(),
        scenarios: pinState.scenarios.slice(),
        cascades: pinState.cascades.slice()
      };
    }
    if (typeof mitLoad === "function") p.mit = mitLoad();
  } catch (e) { /* a tool that failed to load must not block the switch */ }
  p.updatedAt = new Date().toISOString();
  projPatch(p);
  return p;
}

/* Load the incoming project's artefacts back into the tools. A project that
   has no artefact of a kind must *clear* that tool — otherwise switching to
   a fresh project would show the previous project's work. */
function projRestoreTools() {
  const p = projGet();
  if (!p) return;
  try {
    if (typeof dpState !== "undefined") {
      if (p.plan) {
        const base = (typeof dpDefault === "function") ? dpDefault() : {};
        Object.assign(dpState, {
          step: p.plan.step || 0, done: !!p.plan.done,
          a: Object.assign(base, p.plan.a || {}),
          target: p.plan.target == null ? null : p.plan.target,
          ack: p.plan.ack || {}, adrStatus: p.plan.adrStatus || "proposed"
        });
      } else {
        Object.assign(dpState, {
          step: 0, done: false, a: (typeof dpDefault === "function") ? dpDefault() : {},
          target: null, ack: {}, adrStatus: "proposed"
        });
      }
      if (typeof dpSave === "function") dpSave();
    }
    if (typeof bpState !== "undefined") {
      if (p.bp) {
        bpState.name = p.bp.name || "";
        bpState.comps = (p.bp.comps || []).slice();
        bpState.notes = p.bp.notes || "";
        const ebase = (typeof bpDefaultEst === "function") ? bpDefaultEst() : {};
        if (p.bp.est) bpState.est = Object.assign(ebase, p.bp.est);
      } else {
        bpState.name = "";
        bpState.comps = [];
        bpState.notes = "";
        bpState.est = (typeof bpDefaultEst === "function") ? bpDefaultEst() : bpState.est;
      }
      if (typeof bpSave === "function") bpSave();
    }
    if (typeof guardState !== "undefined") {
      guardState.items = Array.isArray(p.guards) ? p.guards.slice() : [];
      if (!guardState.items.some(x => x.id === guardState.currentId)) guardState.currentId = null;
      if (typeof persistGuard === "function") persistGuard();
      if (typeof renderGuardCollection === "function") renderGuardCollection();
    }
    if (typeof pinState !== "undefined") {
      pinState.patterns = (p.pins.patterns || []).slice();
      pinState.scenarios = (p.pins.scenarios || []).slice();
      pinState.cascades = (p.pins.cascades || []).slice();
      if (typeof pinSave === "function") pinSave();
    }
    if (typeof mitSave === "function") mitSave(p.mit || {});
  } catch (e) { /* ignore — a tool that failed to load must not block the switch */ }
  /* re-render whatever is on screen so the new project's state is visible */
  try {
    if (currentTab === "blueprint" && typeof bpRender === "function") bpRender();
    if (currentTab === "deploy" && typeof dpRender === "function") dpRender();
    if (currentTab === "guard" && typeof renderGuardReport === "function") {
      const it = guardState.items.find(x => x.id === guardState.currentId);
      if (it) renderGuardReport(it);
      else if (typeof showGuardIntro === "function") showGuardIntro();
    }
  } catch (e) { /* ignore */ }
}

/* Every tool save stamps the project. Cheap: one localStorage write of a
   small object. Called by the tools' own save functions. */
function projTouch() {
  const id = projActiveId();
  const list = projAll();
  const p = list.find(x => x.id === id);
  if (!p) return;
  p.updatedAt = new Date().toISOString();
  projWriteAll(list);
}

/* ------------------------------------------------------ export / import -- */

function projExport() {
  projSnapshotTools();
  const list = projAll();
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), projects: list }, null, 2)],
    { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "projects.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showNotif("Exported " + list.length + " project" + (list.length === 1 ? "" : "s"));
}

function projImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(String(r.result));
        const incoming = Array.isArray(j) ? j : (j.projects || []);
        if (!incoming.length) { showNotif("No projects in that file", { kind: "warn" }); return; }
        const list = projAll();
        let added = 0;
        incoming.forEach(p => {
          const n = projNormalize(p);
          n.id = projId();
          list.push(n);
          added++;
        });
        while (list.length > PROJ_MAX) list.shift();
        projWriteAll(list);
        showNotif("Imported " + added + " project" + (added === 1 ? "" : "s"));
        projPaintPanel();
      } catch (e) {
        showNotif("That file is not a project export", { kind: "warn" });
      }
    };
    r.readAsText(f);
  };
  input.click();
}

/* ---------------------------------------------------------- boot / sync -- */

/* Called once the shell is ready. Creates the default project if needed and
   paints the chip. */
function initProject() {
  if (!projAll().length) projEnsure("Default project");
  else if (!projActiveId()) { /* projActiveId self-heals */ }
  projPaintChip();
  /* Keep the project in step with the tools: snapshot on the way out of a
     tab, and on page hide, so a closed tab never loses work. */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") projSnapshotTools();
  });
  window.addEventListener("pagehide", function () { projSnapshotTools(); });
}
