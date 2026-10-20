/* js/workflow.js — the workflow spine (iterations 107, 117).
 *
 * The app has twelve tabs but only five *stages* of work:
 *
 *   discover → research → design → harden → deliver
 *
 * Until now the "what next?" guidance lived in one place (dashNext) and
 * knew about three of the seven work products. This module is the single
 * place that knows the shape of the work:
 *
 *   - wfStatus()  → the state of every stage, for the rail and the
 *                    dashboard, derived from the real tool state.
 *   - wfNext()    → the one most useful next action, reading every tool.
 *   - wfRail()    → the persistent breadcrumb of the five stages.
 *
 * Everything is a *projection* of the real tools — nothing here owns state,
 * so it can never drift from what the tools actually contain.
 */
"use strict";

/* The five stages, and what "done" means for each. `weight` orders them;
   `tab` is where the CTA goes. */
const WF_STAGES = [
  { k: "discover", label: "Discover", tab: "overview",  icon: "📊",
    what: "Know the landscape", done: "You have looked at the catalog" },
  { k: "research", label: "Research", tab: "scenarios", icon: "⚠",
    what: "Know what can go wrong", done: "You have triaged the scenarios" },
  { k: "design",   label: "Design",   tab: "deploy",    icon: "🧭",
    what: "Decide the shape of the system", done: "The intake is complete" },
  { k: "harden",   label: "Harden",   tab: "blueprint", icon: "🧩",
    what: "Build and attack the architecture", done: "The canvas covers the control families" },
  { k: "deliver",  label: "Deliver",  tab: "overview",  icon: "📦",
    what: "Hand the design to the team", done: "The report is exported" }
];

/* How much work exists in each tool, as a 0..1 progress signal. */
function wfSignals() {
  const s = {};
  /* discover — pins and the landing spotlight show the user has engaged */
  s.pins = (typeof pinState !== "undefined")
    ? (pinState.patterns.length + pinState.scenarios.length + pinState.cascades.length) : 0;
  s.looked = (typeof uiMem !== "undefined" && uiMem.patSearch) ? 1 : 0;
  /* research — scenarios triaged: pins + scenarios opened */
  s.scenarios = (typeof DATA !== "undefined" && DATA.scenarios) ? DATA.scenarios.scenarios.length : 0;
  s.scenTriage = (typeof pinState !== "undefined") ? pinState.scenarios.length : 0;
  /* design */
  s.plan = (typeof dpState !== "undefined" && dpState.done) ? 1 : 0;
  s.planStep = (typeof dpState !== "undefined") ? (dpState.step || 0) : 0;
  /* harden */
  s.comps = (typeof bpState !== "undefined") ? bpState.comps.length : 0;
  s.covOk = 0; s.covTotal = 0; s.gaps = 0;
  if (typeof bpCoverage === "function") {
    try {
      const c = bpCoverage();
      s.covOk = c.ok; s.covTotal = c.total;
      s.gaps = c.rows.filter(r => !r.ok).length;
    } catch (e) { /* blueprint not ready */ }
  }
  /* guardrail analyses + mitigation backlog + discovery */
  s.guards = (typeof guardState !== "undefined" && guardState.items) ? guardState.items.length : 0;
  s.mit = 0;
  if (typeof buildMitigationBacklog === "function") {
    try { s.mit = buildMitigationBacklog().length; } catch (e) { /* cascades not ready */ }
  }
  s.mitOwned = 0;
  if (typeof mitLoad === "function") {
    try { s.mitOwned = Object.keys(mitLoad()).length; } catch (e) {}
  }
  s.runs = (typeof discState !== "undefined" && discState.run) ? (discState.run.winners || []).length : 0;
  /* deliver */
  s.copilot = (typeof cpMessages !== "undefined") ? cpMessages.length : 0;
  s.exported = 0;
  try { s.exported = parseInt(localStorage.getItem("aap.reported.v1") || "0", 10) || 0; } catch (e) {}
  return s;
}

/* The per-stage status used by the rail and the dashboard. */
function wfStatus() {
  const s = wfSignals();
  const stages = WF_STAGES.map(st => {
    let state = "todo", detail = st.what, cta = null, tab = st.tab;
    switch (st.k) {
      case "discover":
        if (s.pins) { state = "done"; detail = s.pins + " item" + (s.pins === 1 ? "" : "s") + " pinned"; }
        else { state = "todo"; detail = "Nothing pinned yet"; cta = "Pin what matters"; tab = "patterns"; }
        break;
      case "research":
        if (s.scenTriage) { state = "done"; detail = s.scenTriage + " scenario" + (s.scenTriage === 1 ? "" : "s") + " triaged"; }
        else { state = "todo"; detail = "No scenarios triaged"; cta = "Research the scenarios"; tab = "scenarios"; }
        break;
      case "design":
        if (s.plan) { state = "done"; detail = "Intake complete — readiness scored"; }
        else { state = "active"; detail = "Intake step " + (s.planStep + 1) + " of 4"; cta = "Complete the intake"; tab = "deploy"; }
        break;
      case "harden":
        if (!s.comps) { state = "todo"; detail = "No architecture yet"; cta = "Build the canvas"; tab = "blueprint"; }
        else if (s.gaps) { state = "active"; detail = s.covOk + "/" + s.covTotal + " control families covered — " + s.gaps + " gap" + (s.gaps === 1 ? "" : "s"); cta = "Close the gaps"; tab = "blueprint"; }
        else { state = "done"; detail = s.covOk + "/" + s.covTotal + " control families covered"; }
        break;
      case "deliver":
        if (s.exported) { state = "done"; detail = "Report exported " + s.exported + "×"; }
        else if (s.plan || s.comps || s.guards) { state = "active"; detail = "Design is ready to hand over"; cta = "Export the report"; tab = "overview"; }
        else { state = "todo"; detail = "Nothing to export yet"; cta = "Export the report"; tab = "overview"; }
        break;
    }
    return Object.assign({}, st, { state: state, detail: detail, cta: cta, tab: tab });
  });
  return { stages: stages, signals: s };
}

/* The single most useful next action (iteration 107).
   Unlike the old dashNext, this reads *every* tool — the guardrail lab,
   the mitigation backlog and the discovery run included — and it prefers to
   close a gap in work the user has already started over starting something
   new. */
function wfNext() {
  const s = wfSignals();
  const st = wfStatus();

  /* The stages run in order, so the guidance must too: a user with no
     design yet should be told to design, not to triage a backlog that
     only makes sense once there is a design to harden. Each block below
     is therefore guarded by "the earlier stage is done". */

  /* 1 — design: the intake is half-finished */
  if (s.planStep > 0 && !s.plan) {
    return { t: "Your deployment intake is " + (s.planStep + 1) + " of 4 steps in — finish it and the planner scores your readiness.", tab: "deploy", cta: "Continue the intake" };
  }
  /* 1 — design: nothing at all yet */
  if (!s.plan) {
    return { t: "Complete the deployment intake — the planner scores readiness and picks a recommended stack from your answers.", tab: "deploy", cta: "Open Deployment Planner" };
  }
  /* 2 — harden: a guardrail analysis exists but was never turned into an
     architecture (this is the lab's dead end, iteration 104) */
  if (s.guards && !s.comps) {
    return { t: "You have " + s.guards + " guardrail analys" + (s.guards === 1 ? "is" : "es") + " but no architecture — turn the recommended controls into a blueprint.", tab: "guard", cta: "Open the Guardrail Lab" };
  }
  /* 2 — harden: no architecture yet */
  if (!s.comps) {
    const rec = (typeof dpStack === "function") ? dpStack() : [];
    return { t: "No reference architecture yet. Build one in the Blueprint tab" + (rec.length ? " — the planner recommends e.g. " + rec.slice(0, 3).map(r => r.name.split(" — ")[0]).join(", ") : "") + ".", tab: "blueprint", cta: "Open Blueprint builder" };
  }
  /* 2 — harden: the canvas has gaps */
  if (s.gaps) {
    const gaps = (typeof bpCoverage === "function") ? bpCoverage().rows.filter(r => !r.ok) : [];
    return { t: "Your blueprint leaves " + s.gaps + " control famil" + (s.gaps === 1 ? "y" : "ies") + " uncovered (" + gaps.slice(0, 3).map(g => g.label).join(", ") + ").", tab: "blueprint", cta: "Close the gaps" };
  }
  /* 2 — harden: exposure is high */
  if (typeof bpThreatModel === "function") {
    try {
      const tm = bpThreatModel();
      if (tm.has && (tm.band[0] === "High" || tm.band[0] === "Severe") && tm.scns.length) {
        return { t: "Exposure is " + tm.band[0].toLowerCase() + " — worst matched scenario: " + tm.scns[0].s.title + ".", tab: "blueprint", cta: "Open threat model" };
      }
    } catch (e) { /* blueprint not ready */ }
  }
  /* 3 — deliver: the mitigation backlog exists but nobody owns the work */
  if (s.mit && !s.mitOwned) {
    return { t: "The mitigation backlog has " + s.mit + " de-duplicated controls and none of them has an owner yet — assign the top rows so the work has names on it.", tab: "cascades", cta: "Open the mitigation planner" };
  }
  /* 3 — deliver: a design exists but was never stress-tested */
  if (!s.copilot) {
    return { t: "The design is " + (s.covOk || 0) + "/" + (s.covTotal || 0) + " covered — stress-test it with Fox - Architect, which goes out with your blueprint, exposure and cost estimates.", tab: "copilot", cta: "Ask the copilot" };
  }
  /* 3 — deliver: a discovery run produced drafts nobody reviewed */
  if (s.runs && !s.guards) {
    return { t: "Your discovery run kept " + s.runs + " novel draft" + (s.runs === 1 ? "" : "s") + " — review them, or ask Fox - Architect whether they are genuinely new.", tab: "discovery", cta: "Review the drafts" };
  }
  /* everything is done — hand it over */
  return { t: "All planning steps done — export the full report below (Markdown, JSON or print) to share it.", tab: "overview", cta: "Use the export buttons" };
}

/* The persistent workflow rail (iteration 117): five stages, each with its
   state and a jump target. Rendered into the Overview, and available
   anywhere via wfRail(). */
function wfRailHtml() {
  const st = wfStatus();
  const nx = wfNext();
  return '<div class="wf-rail" role="list" aria-label="Workflow stages">' +
    st.stages.map((g, i) => {
      const icon = g.state === "done" ? "✓" : g.state === "active" ? "▸" : "○";
      const next = (nx.tab === g.tab && g.cta) ? " wf-next" : "";
      return '<button class="wf-stage wf-' + g.state + next + '" role="listitem" onclick="wfGo(\'' + g.tab + '\')" ' +
        'title="' + escHtml(g.label + " — " + g.detail) + '" aria-label="' + escHtml(g.label + ": " + g.detail) + '">' +
        '<span class="wf-ico" aria-hidden="true">' + icon + "</span>" +
        '<span class="wf-txt"><b>' + escHtml(g.label) + "</b><i>" + escHtml(g.detail) + "</i></span>" +
        "</button>";
    }).join("") + "</div>";
}

/* Jump to a stage's tab and focus it. */
function wfGo(tab) {
  if (!tab) return;
  switchTab(tab);
  focusPane(tab);
  const st = wfStatus();
  const g = st.stages.find(x => x.tab === tab && x.cta);
  if (g && g.cta) {
    showNotif(g.label + " — " + g.detail, {
      kind: "info",
      actions: [{ label: g.cta, primary: true, fn: function () { wfGoAction(g); } }]
    });
  }
}

/* The stage's own CTA: jump to the precise control that advances it. */
function wfGoAction(g) {
  if (!g) return;
  if (g.k === "design") { switchTab("deploy"); focusPane("deploy"); return; }
  if (g.k === "harden") {
    switchTab("blueprint"); focusPane("blueprint");
    const gaps = (typeof bpCoverage === "function") ? bpCoverage().rows.filter(r => !r.ok) : [];
    if (gaps.length) {
      const sug = gaps[0].sug;
      if (sug && typeof bpAdd === "function") { bpAdd(sug); return; }
    }
    return;
  }
  if (g.k === "research") { switchTab("scenarios"); focusPane("scenarios"); return; }
  if (g.k === "discover") { switchTab("patterns"); focusPane("patterns"); return; }
  if (g.k === "deliver") {
    switchTab("overview"); focusPane("overview");
    const b = document.getElementById("dashExportBtns");
    if (b) b.scrollIntoView({ block: "center" });
    return;
  }
}

/* Repaint the rail wherever it is mounted. */
function wfPaintRail() {
  const host = document.getElementById("wfRail");
  if (host) host.innerHTML = wfRailHtml();
}
