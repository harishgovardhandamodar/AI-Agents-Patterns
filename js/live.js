/* live.js — control-flow playback + tracking for mock execution traces */
"use strict";

const live = { trace: null, step: -1, playing: false, timer: null, speed: 700 };

function initLive() {
  const T = DATA.traces;
  el("traceList").innerHTML = T.traces.map(t => `
    <div class="trace-item" id="ti-${t.id}" onclick="loadTrace('${t.id}')">
      <div class="t">${escHtml(t.name.split(" — ")[1] || t.name)}</div>
      <div class="m">${t.metrics.steps} steps · ${fmtUsd(t.metrics.costUsd)} tokens · ${escHtml(t.verdict)}</div>
    </div>`).join("");
  loadTrace(T.traces[0].id);
}

function loadTrace(id) {
  stopPlay();
  const t = DATA.traces.traces.find(x => x.id === id);
  if (!t) return;
  live.trace = t;
  live.step = -1;
  document.querySelectorAll(".trace-item").forEach(i => i.classList.remove("active"));
  const ti = el("ti-" + id); if (ti) ti.classList.add("active");
  el("traceVerdict").className = "verdict " + t.verdict;
  el("traceVerdict").textContent = t.verdict;
  el("traceTitle").textContent = t.name;
  // flow diagram
  el("liveFlowWrap").innerHTML =
    `<button class="design-expand" onclick="openZoom(this)">⤢ enlarge</button><pre class="mermaid" data-src="${escHtml(t.flow)}">${escHtml(t.flow)}</pre>`;
  // re-apply highlight once the flow SVG actually exists (mermaid render is async)
  Promise.resolve(mmRenderAll(el("liveFlowWrap"))).then(() => paintStep()).catch(() => {});
  // gauges
  renderGauges();
  // step list (all steps, dimmed until reached)
  el("stepList").innerHTML = t.steps.map((s, i) => `
    <div class="step-row" id="sr-${i}">
      <span class="n">${s.n}</span>
      <span class="tt tt-${s.t}">${s.t}</span>
      <span class="ti"><b>${escHtml(s.title)}</b><br><span class="muted">${escHtml(s.detail)}</span>
      <br><span class="small mono muted">${s.latencyMs >= 60000 ? (s.latencyMs / 60000).toFixed(1) + " min" : s.latencyMs + " ms"}${s.tokens ? " · " + s.tokens + " tok" : ""}</span></span>
    </div>`).join("");
  el("logBox").innerHTML = `<div class="log-line"><span class="ts">--:--</span><span class="msg muted">press Play or Step to begin replay…</span></div>`;
  // clear previous highlight classes
  el("liveFlowWrap").querySelectorAll("svg .node").forEach(n => n.classList.remove("trace-active", "trace-past"));
}

function renderGauges() {
  const t = live.trace; if (!t) return;
  const m = t.metrics;
  const done = Math.max(0, live.step + 1);
  const frac = done / t.steps.length;
  const cost = (m.costUsd * frac);
  const tok = Math.round((m.tokensIn + m.tokensOut) * frac);
  const steps = done;
  const guardrailHits = t.steps.slice(0, done).filter(s => s.t === "guardrail").length;

  const pct = (v, max) => Math.min(100, 100 * v / max);
  el("liveGauges").innerHTML = `
    <div class="gauge ${frac >= .8 ? "warn" : ""}"><div class="k">Steps</div><div class="v">${steps} / ${t.steps.length}</div><div class="track"><div class="fill" style="width:${100 * frac}%"></div></div></div>
    <div class="gauge ${cost / m.budgetUsd >= .8 ? "crit" : cost / m.budgetUsd >= .6 ? "warn" : ""}"><div class="k">Token cost (budget ${fmtUsd(m.budgetUsd)})</div><div class="v">${fmtUsd(cost)}</div><div class="track"><div class="fill" style="width:${pct(cost, m.budgetUsd)}%"></div></div></div>
    <div class="gauge"><div class="k">Tokens used</div><div class="v">${tok.toLocaleString()}</div><div class="track"><div class="fill" style="width:${100 * frac}%"></div></div></div>
    <div class="gauge ${m.spendBlockedUsd > 0 && frac >= .7 ? "crit" : ""}"><div class="k">Spend attempted</div><div class="v">${frac >= .5 ? fmtUsd(m.spendAttemptedUsd) : "—"}</div><div class="track"><div class="fill" style="width:${frac >= .5 ? 100 : 0}%"></div></div></div>
    <div class="gauge"><div class="k">Tool calls</div><div class="v">${t.steps.slice(0, done).filter(s => s.t === "tool").length} / ${m.toolCalls}</div><div class="track"><div class="fill" style="width:${100 * frac}%"></div></div></div>
    <div class="gauge ${guardrailHits > 0 ? "warn" : ""}"><div class="k">Guardrail events</div><div class="v">${guardrailHits}</div><div class="track"><div class="fill" style="width:${pct(guardrailHits, Math.max(1, m.guardrailHits))}%;background:var(--red)"></div></div></div>`;
}

function stepTrace(dir) {
  const t = live.trace; if (!t) return;
  const next = live.step + dir;
  if (next < -1 || next >= t.steps.length) { if (dir > 0) stopPlay(); return; }
  live.step = next;
  paintStep();
}

function paintStep() {
  const t = live.trace; if (!t) return;
  // step rows
  t.steps.forEach((s, i) => {
    const row = el("sr-" + i);
    if (!row) return;
    row.classList.toggle("done", i < live.step);
    row.classList.toggle("current", i === live.step);
  });
  const cur = el("sr-" + live.step);
  if (cur) cur.scrollIntoView({ block: "nearest", behavior: "smooth" });
  // flow highlight
  const nodes = el("liveFlowWrap").querySelectorAll("svg .node");
  nodes.forEach(n => { n.classList.remove("trace-active"); n.classList.toggle("trace-past", stepIndexOfNode(n) < live.step); });
  if (live.step >= 0) {
    const nodeId = t.steps[live.step].node;
    nodes.forEach(n => { if (nodeMatches(n, nodeId)) n.classList.add("trace-active"); });
  }
  // log: show all events up to this step (map events to steps by order)
  const evCount = Math.ceil(t.events.length * (live.step + 1) / t.steps.length);
  el("logBox").innerHTML = t.events.slice(0, Math.max(0, evCount)).map(e =>
    `<div class="log-line lvl-${e.level}"><span class="ts">${escHtml(e.ts)}</span><span class="msg">${escHtml(e.msg)}</span></div>`).join("") ||
    `<div class="log-line"><span class="ts">--:--</span><span class="msg muted">replay not started</span></div>`;
  el("logBox").scrollTop = el("logBox").scrollHeight;
  renderGauges();
}

/* mermaid node ids are like "flowchart-N_intake-3"; match by our id as a whole token */
function nodeMatches(nodeEl, ourId) {
  const id = nodeEl.id || "";
  return id.startsWith("flowchart-" + ourId + "-") || id === "flowchart-" + ourId ||
    id.includes("-" + ourId + "-") || id.endsWith("-" + ourId);
}
function stepIndexOfNode(nodeEl) {
  const t = live.trace; if (!t) return -1;
  const idx = t.steps.findIndex(s => nodeMatches(nodeEl, s.node));
  return idx;
}

function togglePlay() { live.playing ? stopPlay() : startPlay(); }
function startPlay() {
  if (!live.trace) return;
  if (live.step >= live.trace.steps.length - 1) { live.step = -1; paintStep(); }
  live.playing = true;
  el("btnPlay").textContent = "⏸ Pause";
  live.timer = setInterval(() => {
    if (live.step >= live.trace.steps.length - 1) { stopPlay(); return; }
    stepTrace(1);
  }, live.speed);
}
function stopPlay() {
  live.playing = false;
  clearInterval(live.timer);
  const b = el("btnPlay"); if (b) b.textContent = "▶ Play";
}
function resetTrace() { stopPlay(); live.step = -1; paintStep(); }
function onSpeedChange() {
  live.speed = parseInt(el("traceSpeed").value, 10);
  if (live.playing) { stopPlay(); startPlay(); }
}
tabLoaders.live = () => { /* already loaded in init */ };
