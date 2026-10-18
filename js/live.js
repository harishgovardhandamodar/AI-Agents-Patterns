/* live.js — Live View: an exhaustive, filterable library of replayable
   execution traces (one per scenario) driven by the shared LivePlayer. */
"use strict";

const liveState = { q: "", domains: new Set(), sevs: new Set(), verdicts: new Set(), byScenario: {} };
let livePlayer = null;

function initLive() {
  const all = DATA.traces.traces;
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
  loadTrace(all[0].id);
}

function traceScenario(t) { return t.scenarioId ? liveState.byScenario[t.scenarioId] : null; }
function traceDomain(t) {
  const s = traceScenario(t);
  if (s) return s.domain;
  const m = String(t.name).match(/^([A-Za-z0-9-]+) agent/);
  return m ? m[1].toLowerCase() : "general";
}
function traceSeverity(t) { const s = traceScenario(t); return s ? s.severity : "medium"; }
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
  const all = DATA.traces.traces;
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
    <div class="trace-item ${livePlayer && livePlayer.state.data && livePlayer.state.data.id === t.id ? "active" : ""}" role="listitem" data-tid="${escHtml(t.id)}" onclick="loadTrace('${t.id}')">
      <div class="t">${escHtml(traceLabel(t))}</div>
      <div class="m"><span class="verdict ${t.verdict}">${t.verdict}</span> ${escHtml(traceDomain(t))} · ${t.metrics.steps} steps · ${escHtml(traceSeverity(t))}</div>
    </div>`).join("") || (typeof emptyState === "function"
      ? emptyState("▶", "No traces match", "Every trace is filtered out — clear a verdict, severity or domain filter to get the replay list back.", "Reset filters", "resetLiveFilters()")
      : `<p class="muted small" style="padding:0 6px">No traces match the current filters.</p>`);
}

function loadTrace(id) {
  const t = DATA.traces.traces.find(x => x.id === id);
  if (!t) return;
  const s = traceScenario(t);
  document.querySelectorAll(".trace-item").forEach(i => i.classList.toggle("active", i.dataset.tid === id));
  const links = [];
  if (s && typeof casAll === "function") {
    const cl = casAll().filter(function (c) { return (c.scenarioRefs || []).indexOf(s.id) >= 0; });
    if (cl.length) {
      links.push({ text: "Cascades: " + cl.length, onClick: function () {
        switchTab("cascades");
        setTimeout(function () {
          document.querySelectorAll("#casClasses input, #casDomains input").forEach(function (i) { i.checked = false; });
          const i = document.querySelector('#casDomains input[data-v="' + s.domain + '"]');
          if (i) { i.checked = true; i.dispatchEvent(new Event("change")); }
          if (typeof renderCascadeList === "function") renderCascadeList();
        }, 80);
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

tabLoaders.live = () => { /* loaded during init */ };
