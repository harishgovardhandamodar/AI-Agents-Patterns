/* live.js — Live View: an exhaustive, filterable library of replayable
   execution traces (one per scenario) driven by the shared LivePlayer. */
"use strict";

const liveState = { q: "", domains: new Set(), sevs: new Set(), verdicts: new Set(), byScenario: {} };
let livePlayer = null;

/* Locally authored traces (iteration 105): a Guardrail Lab mock run promoted
   into the trace library. They live beside the shipped catalog traces, are
   marked as local so nobody mistakes them for catalog data, and are part of
   the project so they travel with it. */
const LIVE_LOCAL_STORE = "aap.traces.local.v1";
function liveLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LIVE_LOCAL_STORE) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function liveLocalSave(list) {
  try { localStorage.setItem(LIVE_LOCAL_STORE, JSON.stringify(list)); } catch (e) {}
  if (typeof projTouch === "function") projTouch();
}

/* Every trace the Live View can show: the shipped catalog plus local ones. */
function liveAllTraces() {
  const base = (typeof DATA !== "undefined" && DATA.traces) ? DATA.traces.traces : [];
  const locals = liveLocal().filter(t => t && t.id && t.steps && t.steps.length);
  return base.concat(locals);
}

function initLive() {
  const all = liveAllTraces();
  liveState.byScenario = {};
  DATA.scenarios.scenarios.forEach(s => { liveState.byScenario[s.id] = s; });

  const domains = uniq(all.map(t => traceDomain(t))).sort();
  el("traceDomains").innerHTML = domains.map(d => `
    <label class="filter-item"><input type="checkbox" data-dom="${escHtml(d)}" onchange="onLiveFilter(this,'domains')">
    ${escHtml(d)}<span class="cnt">${all.filter(t => traceDomain(t) === d).length}</span></label>`).join("");

  const sevs = ["critical", "high", "medium"];
  el("traceSevs").innerHTML = sevs.map(sv => `
    <label class="filter-item"><input type="checkbox" data-sev="${sv}" onchange="onLiveFilter(this,'sevs')">
    <span class="sev-dot sev-${sv}"></span>${sv}<span class="cnt">${all.filter(t => traceSeverity(t) === sv).length}</span></label>`).join("");

  el("traceVerdicts").innerHTML = ["blocked", "degraded", "allowed"].map(v => `
    <label class="filter-item"><input type="checkbox" data-ver="${v}" onchange="onLiveFilter(this,'verdicts')">
    <span class="verdict ${v}">${v}</span><span class="cnt">${all.filter(t => t.verdict === v).length}</span></label>`).join("");

  livePlayer = LivePlayer(el("livePlayer"), { speed: 700 });
  renderTraceList();
  /* The default trace loads on first tab visit (see tabLoaders.live), not
     here: rendering mermaid into the hidden pane at boot produces spurious
     "Syntax error in text" diagrams that then sit baked into the DOM. */
}

function traceScenario(t) { return t.scenarioId ? liveState.byScenario[t.scenarioId] : null; }
function traceDomain(t) {
  const s = traceScenario(t);
  if (s) return s.domain;
  if (t.local) return t.domain || "local";
  const m = String(t.name).match(/^([A-Za-z0-9-]+) agent/);
  return m ? m[1].toLowerCase() : "general";
}
function traceSeverity(t) { const s = traceScenario(t); return s ? s.severity : (t.severity || "medium"); }
function traceLabel(t) { return String(t.name).split(" — ").slice(1).join(" — ") || t.name; }

function onLiveFilter(inp, key) {
  const val = inp.dataset.dom || inp.dataset.sev || inp.dataset.ver;
  inp.checked ? liveState[key].add(val) : liveState[key].delete(val);
  renderTraceList();
}
function onLiveSearch(v) { liveState.q = v.trim().toLowerCase(); renderTraceList(); }
function resetLiveFilters() {
  liveState.domains.clear(); liveState.sevs.clear(); liveState.verdicts.clear(); liveState.q = "";
  document.querySelectorAll("#livePane .side input[type=checkbox]").forEach(i => i.checked = false);
  el("traceSearch").value = "";
  renderTraceList();
}

function renderTraceList() {
  const all = liveAllTraces();
  const list = all.filter(t => {
    if (liveState.domains.size && !liveState.domains.has(traceDomain(t))) return false;
    if (liveState.sevs.size && !liveState.sevs.has(traceSeverity(t))) return false;
    if (liveState.verdicts.size && !liveState.verdicts.has(t.verdict)) return false;
    if (liveState.q) {
      const s = traceScenario(t);
      const hay = (t.name + " " + t.id + " " + (t.summary || "") + " " +
        (s ? s.title + " " + s.vector + " " + s.domain : "")).toLowerCase();
      if (!hay.includes(liveState.q)) return false;
    }
    return true;
  });
  el("traceCount").textContent = list.length + " / " + all.length;
  el("traceList").innerHTML = list.map(t => `
    <div class="trace-item ${livePlayer && livePlayer.state.data && livePlayer.state.data.id === t.id ? "active" : ""}" role="listitem" data-tid="${escHtml(t.id)}" onclick="loadTrace('${escHtml(t.id)}')">
      <div class="t">${t.local ? '<span class="chip" style="margin-right:5px">local</span>' : ""}${escHtml(traceLabel(t))}</div>
      <div class="m"><span class="verdict ${t.verdict}">${t.verdict}</span> ${escHtml(traceDomain(t))} · ${t.metrics.steps} steps · ${escHtml(traceSeverity(t))}</div>
    </div>`).join("") || (typeof emptyState === "function"
      ? emptyState("▶", "No traces match", "Every trace is filtered out — clear a verdict, severity or domain filter to get the replay list back.", "Reset filters", "resetLiveFilters()")
      : `<p class="muted small" style="padding:0 6px">No traces match the current filters.</p>`);
}

function loadTrace(id) {
  const t = liveAllTraces().find(x => x.id === id);
  if (!t) return;
  const s = traceScenario(t);
  document.querySelectorAll(".trace-item").forEach(i => i.classList.toggle("active", i.dataset.tid === id));
  const links = [];
  if (s && typeof casAll === "function") {
    const cl = casAll().filter(function (c) { return (c.scenarioRefs || []).indexOf(s.id) >= 0; });
    if (cl.length) {
      links.push({ text: "Cascades: " + cl.length, onClick: function () {
        switchTab("cascades");
        dlWhenReady("cascades", function () {
          document.querySelectorAll("#casClasses input, #casDomains input").forEach(function (i) { i.checked = false; });
          const i = document.querySelector('#casDomains input[data-v="' + s.domain + '"]');
          if (i) { i.checked = true; i.dispatchEvent(new Event("change")); }
          if (typeof renderCascadeList === "function") renderCascadeList();
        });
      }});
    }
  }
  livePlayer.load({
    id: t.id,
    title: traceLabel(t) + (s ? "  ·  " + s.domain + " · " + s.severity : ""),
    verdict: t.verdict, verdictClass: t.verdict,
    flow: t.flow, steps: t.steps, events: t.events, metrics: t.metrics,
    links: links
  });
}

let liveBooted = false;

tabLoaders.live = () => {
  if (liveBooted || !livePlayer) return;
  liveBooted = true;
  const all = (typeof DATA !== "undefined" && DATA.traces) ? DATA.traces.traces : [];
  if (all.length) loadTrace(all[0].id);
};
