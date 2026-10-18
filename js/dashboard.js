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
    <div class="dash-h">🤖 Copilot</div>
    <div class="dash-v">${cpMessages.length}<i> messages</i></div>
    <div class="dash-m">${cpMessages.length ? "Last question answered " + escHtml(cpMessages.filter(m => m.role === "user").slice(-1).map(m => (m.content || "").slice(0, 60) + "…")[0] || "") : "Grounded in the catalog via the local Qwen model, with deterministic fallback."}</div>
    <button class="btn sm ghost" onclick="switchTab('copilot')">Open copilot</button>
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
    `<div class="dash-export${anyWork ? "" : " dim"}">
      <b>Export architect report</b>
      <span class="muted small">Deployment plan + blueprint + threat model + copilot consult in one document</span>
      <span class="dash-export-btns">
        <button class="btn sm" onclick="rpDownload('md')" ${anyWork ? "" : "disabled"}>⬇ Markdown</button>
        <button class="btn sm" onclick="rpDownload('json')" ${anyWork ? "" : "disabled"}>⬇ JSON</button>
        <button class="btn sm" onclick="rpPrint()" ${anyWork ? "" : "disabled"}>🖨 Print</button>
      </span>
    </div>`;
}

tabLoaders.overview = function () { dashRender(); };
