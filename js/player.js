/* player.js — reusable control-flow playback widget.
 *
 * Used in two places:
 *   • the Live View  (replays the mock execution traces)
 *   • the Guardrail Lab  (replays the synthetic mock run of a design)
 *
 * It renders a self-contained control bar, a Mermaid flow whose active node is
 * highlighted as playback advances, live gauges, a step tracker and an event
 * log — all scoped to the container it is given (no global ids), reusing the
 * shared .live-* styles.
 *
 * LivePlayer(container, { compact, speed }) → { load, play, pause, toggle,
 *                                                step, reset, setSpeed }
 */
"use strict";

function LivePlayer(container, opts) {
  opts = opts || {};
  const st = { data: null, step: -1, playing: false, timer: null, speed: opts.speed || 700 };

  container.classList.add("live-main");
  if (opts.compact) container.classList.add("live-main--compact");
  container.innerHTML = `
    <div class="live-ctrl">
      <button class="btn primary" data-p="play">▶ Play</button>
      <button class="btn" data-p="step">⏭ Step</button>
      <button class="btn" data-p="back">⏮ Back</button>
      <button class="btn" data-p="reset">↺ Reset</button>
      <select class="search" style="width:auto" data-p="speed">
        <option value="1200">slow</option>
        <option value="700" selected>normal</option>
        <option value="300">fast</option>
        <option value="80">turbo</option>
      </select>
      <span class="muted small mono" data-p="clock"></span>
      <div style="flex:1"></div>
      <span class="verdict" data-p="verdict"></span>
      <span class="muted small mono" data-p="title"></span>
      <span data-p="links" style="display:flex;gap:6px;flex-wrap:wrap"></span>
    </div>
    <div class="live-body">
      <div class="live-flow panel">
        <div class="diagram-wrap" data-p="flow"></div>
      </div>
      <div class="live-side">
        <div class="gauges" data-p="gauges"></div>
        <div class="panel" style="flex:1;display:grid;grid-template-rows:auto 1fr;min-height:0">
          <h3>Step tracker</h3>
          <div class="step-list" data-p="steps"></div>
        </div>
      </div>
      <div class="live-log">
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:0 0 6px">Event log</h3>
        <div class="log-box" data-p="log"></div>
      </div>
    </div>`;

  const q = s => container.querySelector('[data-p="' + s + '"]');
  const clampStep = v => Math.max(-1, Math.min(v, st.data ? st.data.steps.length - 1 : -1));

  /* ---------- public ---------- */
  function load(data) {
    stopPlay();
    st.data = data;
    st.step = -1;
    q("verdict").className = "verdict " + (data.verdictClass || data.verdict || "degraded");
    q("verdict").textContent = data.verdictText || data.verdict || "";
    q("title").textContent = data.title || "";
    const L = q("links");
    if (L) {
      L.innerHTML = "";
      (data.links || []).forEach(function (lnk) {
        const b = document.createElement("span");
        b.className = "cp-cite c";
        b.textContent = lnk.text;
        b.title = "Open cascade";
        b.onclick = lnk.onClick;
        L.appendChild(b);
      });
    }
    q("speed").value = String(st.speed);
    q("flow").innerHTML =
      `<button class="design-expand" onclick="openZoom(this)">⤢ enlarge</button>` +
      `<pre class="mermaid" data-src="${escHtml(data.flow)}">${escHtml(data.flow)}</pre>`;
    q("steps").innerHTML = data.steps.map((s, i) => `
      <div class="step-row" data-p="sr-${i}">
        <span class="n">${s.n}</span>
        <span class="tt tt-${s.t}">${s.t}</span>
        <span class="ti"><b>${escHtml(s.title)}</b><br><span class="muted">${escHtml(s.detail)}</span>
        <br><span class="small mono muted">${fmtDur(s.latencyMs)}${s.tokens ? " · " + s.tokens.toLocaleString() + " tok" : ""}</span></span>
      </div>`).join("");
    q("log").innerHTML = `<div class="log-line"><span class="ts">--:--</span><span class="msg muted">press Play or Step to begin replay…</span></div>`;
    q("flow").querySelectorAll("svg .node").forEach(n => n.classList.remove("trace-active", "trace-past"));
    paintGauges();
    // mermaid renders async — re-apply highlight once the SVG exists
    Promise.resolve(mmRenderAll(q("flow"))).then(paint).catch(() => {});
  }

  function step(dir) {
    if (!st.data) return;
    const next = clampStep(st.step + dir);
    if (next === st.step) { if (dir > 0) stopPlay(); return; }
    st.step = next;
    paint();
  }

  function toggle() { st.playing ? stopPlay() : startPlay(); }
  function startPlay() {
    if (!st.data) return;
    if (st.step >= st.data.steps.length - 1) { st.step = -1; paint(); }
    st.playing = true;
    q("play").textContent = "⏸ Pause";
    st.timer = setInterval(() => {
      if (st.step >= st.data.steps.length - 1) { stopPlay(); return; }
      step(1);
    }, st.speed);
  }
  function stopPlay() {
    st.playing = false;
    clearInterval(st.timer);
    const b = q("play"); if (b) b.textContent = "▶ Play";
  }
  function reset() { stopPlay(); st.step = -1; paint(); }
  function setSpeed(ms) { st.speed = ms; if (st.playing) { stopPlay(); startPlay(); } }

  function destroy() { stopPlay(); container.innerHTML = ""; }

  /* ---------- internals ---------- */
  function paint() {
    const d = st.data; if (!d || !q("log")) return;
    d.steps.forEach((s, i) => {
      const row = q("sr-" + i);
      if (!row) return;
      row.classList.toggle("done", i < st.step);
      row.classList.toggle("current", i === st.step);
    });
    const cur = q("sr-" + st.step);
    if (cur) cur.scrollIntoView({ block: "nearest", behavior: "smooth" });

    // flow highlight
    const nodes = q("flow").querySelectorAll("svg .node");
    nodes.forEach(n => { n.classList.remove("trace-active"); n.classList.toggle("trace-past", stepIndexOfNode(n) < st.step && stepIndexOfNode(n) >= 0); });
    if (st.step >= 0) {
      const nodeId = d.steps[st.step].node;
      nodes.forEach(n => { if (nodeMatches(n, nodeId)) n.classList.add("trace-active"); });
      scrollFlowToActive();
    }

    // event log: reveal events proportionally to step progress
    const evCount = Math.ceil(d.events.length * (st.step + 1) / d.steps.length);
    q("log").innerHTML = d.events.slice(0, Math.max(0, evCount)).map(e =>
      `<div class="log-line lvl-${e.level}"><span class="ts">${escHtml(e.ts)}</span><span class="msg">${escHtml(e.msg)}</span></div>`).join("") ||
      `<div class="log-line"><span class="ts">--:--</span><span class="msg muted">replay not started</span></div>`;
    q("log").scrollTop = q("log").scrollHeight;

    q("clock").textContent = st.step >= 0
      ? "T+" + fmtDur(d.steps.slice(0, st.step + 1).reduce((a, s) => a + s.latencyMs, 0)) + " · step " + (st.step + 1) + "/" + d.steps.length
      : "";
    paintGauges();
  }

  function scrollFlowToActive() {
    const flowEl = q("flow").parentElement;
    const act = q("flow").querySelector("svg .node.trace-active");
    if (!flowEl || !act) return;
    const r = act.getBoundingClientRect(), fr = flowEl.getBoundingClientRect();
    if (r.top < fr.top || r.bottom > fr.bottom) {
      flowEl.scrollTop += (r.top - fr.top) - fr.height / 2 + r.height / 2;
    }
  }

  function stepIndexOfNode(nodeEl) {
    const d = st.data; if (!d) return -1;
    return d.steps.findIndex(s => nodeMatches(nodeEl, s.node));
  }

  function paintGauges() {
    const d = st.data; if (!d) return;
    const m = d.metrics || deriveMetrics(d);
    const total = d.steps.length || 1;
    const done = Math.max(0, st.step + 1);
    const frac = done / total;
    const cost = m.costUsd * frac;
    const tok = Math.round((m.tokensIn + m.tokensOut) * frac);
    const pct = (v, max) => Math.min(100, 100 * v / (max || 1));
    const gHits = d.steps.slice(0, done).filter(s => s.t === "guardrail").length;

    q("gauges").innerHTML = `
      <div class="gauge ${frac >= .8 ? "warn" : ""}"><div class="k">Steps</div><div class="v">${done} / ${d.steps.length}</div><div class="track"><div class="fill" style="width:${100 * frac}%"></div></div></div>
      <div class="gauge ${cost / (m.budgetUsd || 1) >= .8 ? "crit" : cost / (m.budgetUsd || 1) >= .6 ? "warn" : ""}"><div class="k">Token cost (budget ${fmtUsd(m.budgetUsd)})</div><div class="v">${fmtUsd(cost)}</div><div class="track"><div class="fill" style="width:${pct(cost, m.budgetUsd)}%"></div></div></div>
      <div class="gauge"><div class="k">Tokens used</div><div class="v">${tok.toLocaleString()}</div><div class="track"><div class="fill" style="width:${100 * frac}%"></div></div></div>
      <div class="gauge ${m.spendBlockedUsd > 0 && frac >= .7 ? "crit" : ""}"><div class="k">Spend attempted</div><div class="v">${frac >= .5 ? fmtUsd(m.spendAttemptedUsd) : "—"}</div><div class="track"><div class="fill" style="width:${frac >= .5 ? 100 : 0}%"></div></div></div>
      <div class="gauge"><div class="k">Tool calls</div><div class="v">${d.steps.slice(0, done).filter(s => s.t === "tool").length} / ${m.toolCalls}</div><div class="track"><div class="fill" style="width:${100 * frac}%"></div></div></div>
      <div class="gauge ${gHits > 0 ? "warn" : ""}"><div class="k">Guardrail events</div><div class="v">${gHits}</div><div class="track"><div class="fill" style="width:${pct(gHits, Math.max(1, m.guardrailHits))}%;background:var(--red)"></div></div></div>`;
  }

  /* ---------- wire controls ---------- */
  q("play").onclick = toggle;
  q("step").onclick = () => step(1);
  q("back").onclick = () => step(-1);
  q("reset").onclick = reset;
  q("speed").onchange = e => setSpeed(parseInt(e.target.value, 10));

  return { load, play: startPlay, pause: stopPlay, toggle, step, reset, setSpeed, destroy, state: st };
}

/* mermaid node ids look like "flowchart-N_intake-3"; match our id as a whole token */
function nodeMatches(nodeEl, ourId) {
  const id = nodeEl.id || "";
  return id.startsWith("flowchart-" + ourId + "-") || id === "flowchart-" + ourId ||
    id.includes("-" + ourId + "-") || id.endsWith("-" + ourId);
}

function fmtDur(ms) {
  ms = Number(ms) || 0;
  if (ms >= 60000) return (ms / 60000).toFixed(1) + " min";
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return ms + " ms";
}

/* Fallback metrics when a data set does not carry them */
function deriveMetrics(d) {
  const tokensIn = d.steps.reduce((a, s) => a + (s.tokens || 0), 0);
  return {
    steps: d.steps.length,
    tokensIn, tokensOut: 0,
    costUsd: +(tokensIn / 1e6 * 6).toFixed(2),
    budgetUsd: 25,
    toolCalls: d.steps.filter(s => s.t === "tool").length,
    guardrailHits: d.steps.filter(s => s.t === "guardrail" && s.status !== "ok").length,
    spendAttemptedUsd: 0, spendBlockedUsd: 0
  };
}
