/* js/dashboard.js — Architect dashboard (Overview tab)
   Aggregates the three planning tools (Deployment Planner, Blueprint builder,
   Copilot) plus the Guardrail Lab into one "where am I, what's next" panel.
   Read-only over their state objects: no separate persistence, the dashboard
   is always a projection of the real tools. */
"use strict";

function dashNext() {
  /* Deterministic suggestion: the first unfinished step wins. */
  if (!dpState.done) return { t: "Complete the deployment intake — the planner scores readiness and picks a recommended stack from your answers.", tab: "deploy", cta: "Open Deployment Planner" };
  if (!bpState.comps.length) {
    const rec = dpState.done ? dpStack() : null;
    return { t: "No reference architecture yet. Build one in the Blueprint tab" + (rec && rec.length ? " — the planner recommends e.g. " + rec.slice(0, 3).map(r => r.name.split(" — ")[0]).join(", ") : "") + ".", tab: "blueprint", cta: "Open Blueprint builder" };
  }
  const c = bpCoverage();
  const gaps = c.rows.filter(r => !r.ok);
  if (gaps.length) return { t: "Your blueprint leaves " + gaps.length + " control famil" + (gaps.length === 1 ? "y" : "ies") + " uncovered (" + gaps.slice(0, 3).map(g => g.label).join(", ") + ").", tab: "blueprint", cta: "Close the gaps" };
  const tm = bpThreatModel();
  if (tm.has && (tm.band[0] === "High" || tm.band[0] === "Severe") && tm.scns.length) return { t: "Exposure is " + tm.band[0].toLowerCase() + " — worst matched scenario: " + tm.scns[0].s.title + ".", tab: "blueprint", cta: "Open threat model" };
  if (!cpMessages.length) return { t: "Everything is covered. Stress-test the architecture with the copilot — it goes out with your blueprint, exposure and cost estimates.", tab: "copilot", cta: "Ask the copilot" };
  return { t: "All planning steps done — export the full report below (Markdown, JSON or print) to share it.", tab: "overview", cta: "Use the export buttons" };
}

function dashRender() {
  const root = el("ovDash");
  if (!root || typeof DATA === "undefined" || !DATA.patterns) return;

  /* — deployment planner — */
  let dpCard;
  if (dpState.done) {
    const sc = dpScore();
    dpCard = `<div class="dash-card">
      <div class="dash-h">📋 Deployment Planner</div>
      <div class="dash-v">${sc.overall}<i>/100</i> <span class="chip ${sc.band[1]}">${escHtml(sc.band[0])}</span></div>
      <div class="dash-m">${sc.dims.length} dimensions scored · target autonomy ${dpState.target == null ? "unset" : "tier " + (dpState.target + 1)}</div>
      <button class="btn sm ghost" onclick="switchTab('deploy')">Review plan</button>
    </div>`;
  } else {
    dpCard = `<div class="dash-card dim">
      <div class="dash-h">📋 Deployment Planner</div>
      <div class="dash-v muted">intake incomplete</div>
      <div class="dash-m">Step ${dpState.step + 1} of 4 — readiness scorecard, stack and rollout plan come from the intake.</div>
      <button class="btn sm" onclick="switchTab('deploy')">Continue intake</button>
    </div>`;
  }

  /* — blueprint — */
  let bpCard;
  if (bpState.comps.length) {
    const c = bpCoverage();
    const est = bpEstimate();
    const tm = bpThreatModel();
    bpCard = `<div class="dash-card">
      <div class="dash-h">🧩 Blueprint <span class="muted small">${escHtml(bpState.name || "Untitled")}</span></div>
      <div class="dash-v">${bpState.comps.length}<i> components</i></div>
      <div class="dash-m">Coverage <b>${c.ok}/${c.total}</b> families · risk <b>${est.risk.score}</b>/100 (${escHtml(est.risk.band[0])}) · exposure <b>${tm.idx}</b>/100 <span class="chip ${tm.band[1]}">${escHtml(tm.band[0])}</span></div>
      <button class="btn sm ghost" onclick="switchTab('blueprint')">Open builder</button>
    </div>`;
  } else {
    bpCard = `<div class="dash-card dim">
      <div class="dash-h">🧩 Blueprint</div>
      <div class="dash-v muted">no architecture yet</div>
      <div class="dash-m">Start from a template (research, worker, pipeline, support, batch) or drag patterns onto the canvas.</div>
      <button class="btn sm" onclick="switchTab('blueprint')">Start a blueprint</button>
    </div>`;
  }

  /* — copilot — */
  const cpCard = `<div class="dash-card ${cpMessages.length ? "" : "dim"}">
    <div class="dash-h">🤖 Fox - Architect</div>
    <div class="dash-v">${cpMessages.length}<i> messages</i></div>
    <div class="dash-m">${cpMessages.length ? "Last question answered " + escHtml(cpMessages.filter(m => m.role === "user").slice(-1).map(m => (m.content || "").slice(0, 60) + "…")[0] || "") : "Grounded in the catalog via the local Qwen model, with deterministic fallback."}</div>
    <button class="btn sm ghost" onclick="switchTab('copilot')">Open Fox - Architect</button>
  </div>`;

  /* — guardrail lab — */
  const glCard = `<div class="dash-card ${guardState.items.length ? "" : "dim"}">
    <div class="dash-h">🛡 Guardrail Lab</div>
    <div class="dash-v">${guardState.items.length}<i> rules</i></div>
    <div class="dash-m">${guardState.items.length ? "Saved guardrail rules in your collection." : "Write, test and replay guardrail rules against sample agent output."}</div>
    <button class="btn sm ghost" onclick="switchTab('guard')">Open lab</button>
  </div>`;

  const nx = dashNext();
  const anyWork = dpState.done || bpState.comps.length || cpMessages.length;
  root.innerHTML =
    `<div class="dash-next"><span class="dash-next-ico">➡</span><div><b>Next:</b> ${escHtml(nx.t)} <button class="btn sm accent" onclick="switchTab('${nx.tab}')">${escHtml(nx.cta)}</button></div></div>` +
    `<div class="dash-grid">${dpCard}${bpCard}${cpCard}${glCard}</div>` +
    (typeof pinPanelHtml === "function" ? pinPanelHtml() : "") +
    `<div class="dash-export${anyWork ? "" : " dim"}">
      <b>Export architect report</b>
      <span class="muted small">Deployment plan + blueprint + threat model + Fox - Architect consult in one document</span>
      <span class="dash-export-btns">
        <button class="btn sm" onclick="rpDownload('md')" ${anyWork ? "" : "disabled"}>⬇ Markdown</button>
        <button class="btn sm" onclick="rpDownload('json')" ${anyWork ? "" : "disabled"}>⬇ JSON</button>
        <button class="btn sm" onclick="rpPrint()" ${anyWork ? "" : "disabled"}>🖨 Print</button>
      </span>
    </div>`;
}

tabLoaders.overview = function () { dashRender(); };

/* ---------------- pinned working set --------------------
   Pin patterns / scenarios / cascades from any drawer into one cross-tab
   working set on the Overview, exportable as Markdown. */
const PIN_STORE = "aap.pins.v1";
const pinState = { patterns: [], scenarios: [], cascades: [] };

function pinLoad() {
  try {
    const j = JSON.parse(localStorage.getItem(PIN_STORE) || "{}");
    ["patterns", "scenarios", "cascades"].forEach(k => {
      if (Array.isArray(j[k])) pinState[k] = j[k].filter(x => typeof x === "string").slice(0, 60);
    });
  } catch (e) {}
}
function pinSave() {
  try { localStorage.setItem(PIN_STORE, JSON.stringify(pinState)); } catch (e) {}
  if (typeof projTouch === "function") projTouch();
}
function pinHas(kind, id) { return (pinState[kind] || []).indexOf(id) >= 0; }

function pinItem(kind, id) {
  try {
    if (kind === "patterns") {
      const p = (DATA.patterns.patterns || []).find(x => x.id === id);
      return p ? { name: p.name, open: "openPattern" } : null;
    }
    if (kind === "scenarios") {
      const s = (DATA.scenarios.scenarios || []).find(x => x.id === id);
      return s ? { name: s.title, open: "openScenario" } : null;
    }
    if (kind === "cascades") {
      const c = (DATA.cascades.cascades || []).find(x => x.id === id);
      return c ? { name: c.name, open: "openCascade" } : null;
    }
  } catch (e) {}
  return null;
}

function pinToggle(kind, id, btn) {
  const arr = pinState[kind];
  if (!arr) return;
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  pinSave();
  const pinned = i < 0;
  document.querySelectorAll(`[data-pin="${kind}:${id}"]`).forEach(b => {
    b.innerHTML = pinned ? "★ Pinned" : "☆ Pin to working set";
    b.classList.toggle("on", pinned);
    b.setAttribute("aria-pressed", pinned ? "true" : "false");
  });
  if (typeof dashRender === "function" && currentTab === "overview") dashRender();
  else if (btn) showNotif((pinned ? "Pinned — " : "Unpinned — ") + ((pinItem(kind, id) || {}).name || id));
}

function pinBtnHtml(kind, id) {
  if (!pinState[kind]) return "";
  const pinned = pinHas(kind, id);
  return `<button class="btn sm pin-btn${pinned ? " on" : ""}" data-pin="${kind}:${id}" aria-pressed="${pinned ? "true" : "false"}" ` +
    `onclick="pinToggle('${kind}','${escJs(id)}',this)" title="Keep this in your Overview working set">${pinned ? "★ Pinned" : "☆ Pin to working set"}</button>`;
}

function pinCount() { return pinState.patterns.length + pinState.scenarios.length + pinState.cascades.length; }

function pinPanelHtml() {
  const n = pinCount();
  if (!n) return `<div class="dash-pin dim"><b>📌 Working set</b> <span class="muted small">Pin patterns, scenarios and cascades from any drawer — they collect here for review and export.</span></div>`;
  const group = (kind, label, chipCls) => pinState[kind].map(id => {
    const it = pinItem(kind, id);
    if (!it) return "";
    return `<div class="pin-row"><span class="chip ${chipCls}">${label}</span>` +
      `<a href="#" onclick="${it.open}('${escJs(id)}');return false;">${escHtml(it.name)}</a>` +
      `<button class="btn sm ghost pin-x" onclick="pinToggle('${kind}','${escJs(id)}')" aria-label="Unpin ${escHtml(it.name)}">×</button></div>`;
  }).join("");
  return `<div class="dash-pin"><div class="dash-pin-head"><b>📌 Working set</b> <span class="muted small">${n} pinned</span>
    <span style="flex:1"></span>
    <button class="btn sm ghost" onclick="pinExport()">⬇ Export</button>
    <button class="btn sm ghost" onclick="pinClear()">Clear</button></div>` +
    group("patterns", "pattern", "") + group("scenarios", "scenario", "risk") + group("cascades", "cascade", "ok") + `</div>`;
}

function pinExport() {
  const lines = ["# Working set", "", "_Pinned from the AI Agent Patterns catalog._", ""];
  const group = (kind, label) => {
    if (!pinState[kind].length) return;
    lines.push("## " + label);
    pinState[kind].forEach(id => {
      const it = pinItem(kind, id);
      lines.push("- " + (it ? it.name : id) + " `" + id + "`");
    });
    lines.push("");
  };
  group("patterns", "Patterns"); group("scenarios", "Scenarios"); group("cascades", "Cascades");
  const md = lines.join("\n");
  if (navigator.clipboard) navigator.clipboard.writeText(md).then(() => showNotif("Working set copied as Markdown")).catch(() => showNotif("Clipboard blocked", { kind: "warn" }));
  else showNotif("Clipboard unavailable", { kind: "warn" });
}

function pinClear() {
  if (!pinCount()) return;
  const snap = JSON.parse(JSON.stringify(pinState));
  pinState.patterns = []; pinState.scenarios = []; pinState.cascades = [];
  pinSave();
  if (typeof dashRender === "function" && currentTab === "overview") dashRender();
  undoPush("clear working set", () => {
    pinState.patterns = snap.patterns.slice(); pinState.scenarios = snap.scenarios.slice(); pinState.cascades = snap.cascades.slice();
    pinSave();
    if (typeof dashRender === "function" && currentTab === "overview") dashRender();
  });
  showNotif("Working set cleared", { actions: [{ label: "Undo", primary: true, fn: undoOnce }] });
}

pinLoad();
