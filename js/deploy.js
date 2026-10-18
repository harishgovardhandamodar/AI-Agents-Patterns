/* deploy.js — Deployment Planner.
   A guided intake that turns "what are you deploying and how risky is it?"
   into a reusable deployment plan. Iteration 15 ships the wizard and the
   profile section; later iterations append to DP_SECTIONS (readiness
   scorecard, recommended stack + guardrail config, rollout dial, residual
   risk register, ADR generator) without touching the wizard. */

"use strict";

const DP_STORE = "aap.deploy";

/* ---------------- reference data ---------------- */
const DP_AUTONOMY = [
  { v: 0, label: "L0 · Manual",      desc: "Humans do the work. The agent only reads, searches and summarises." },
  { v: 1, label: "L1 · Assist",      desc: "Agent drafts or proposes; a human executes and signs off every change." },
  { v: 2, label: "L2 · Supervised",  desc: "Agent acts on its own, but irreversible steps require human approval." },
  { v: 3, label: "L3 · Bounded",     desc: "Agent acts inside policy caps; anything outside them escalates to a human." },
  { v: 4, label: "L4 · Autonomous",  desc: "Agent acts end-to-end, monitors outcomes and rolls back its own changes." }
];

const DP_BLAST = ["single-request", "single-agent", "service", "tenant", "fleet", "org", "ecosystem"];

const DP_ACTIONS   = ["read", "write", "approve", "transact", "publish", "delete", "escalate"];
const DP_DATACLASS = ["pii", "financial", "health", "credentials", "internal-ip"];
const DP_COMPLIANCE = [
  ["soc2", "SOC 2"], ["iso27001", "ISO 27001"], ["gdpr", "GDPR"], ["hipaa", "HIPAA"],
  ["pci-dss", "PCI-DSS"], ["eu-ai-act", "EU AI Act"], ["nist-ai-rmf", "NIST AI RMF"], ["sox", "SOX"]
];

const DP_CRIT = [
  ["low", "Low", "Internal aid; a wrong answer is an annoyance"],
  ["medium", "Medium", "User-facing tooling; mistakes cost time"],
  ["high", "High", "Customer or revenue impact; mistakes cost money"],
  ["critical", "Critical", "Regulated, safety-relevant, or unsafe if wrong"]
];

const DP_VOLUME = [
  ["lt1k", "under 1k / mo"], ["1k", "1k – 10k / mo"], ["10k", "10k – 100k / mo"],
  ["100k", "100k – 1M / mo"], ["1m", "over 1M / mo"]
];

const DP_SENS = [
  ["public", "Public"], ["internal", "Internal"], ["confidential", "Confidential"], ["restricted", "Restricted"]
];

const DP_HOSTING  = [["cloud-managed", "Cloud (managed)"], ["hybrid", "Hybrid"], ["on-prem", "On-prem"], ["serverless", "Serverless"]];
const DP_TEAM     = [["solo", "Solo"], ["small", "2–5"], ["mid", "6–20"], ["large", "20+"]];
const DP_ROLLOUT  = [["shadow", "Shadow"], ["canary", "Canary"], ["staged", "Staged"], ["big-bang", "Big bang"]];
const DP_ONCALL   = [["none", "None"], ["business", "Business hours"], ["follow", "Follow-the-sun"]];

/* ---------------- wizard ---------------- */
const DP_STEPS = [
  { id: "profile", title: "System profile", blurb: "What you are deploying, and how much it matters.",
    fields: [
      { k: "system", label: "System or agent name", type: "text", required: true, placeholder: "e.g. Payments Reconciliation Agent", hint: "Used verbatim in the exported plan and ADR." },
      { k: "domain", label: "Primary domain", type: "select", opts: "domains" },
      { k: "criticality", label: "Business criticality", type: "cards", opts: DP_CRIT },
      { k: "volume", label: "Throughput", type: "cards", opts: DP_VOLUME }
    ] },

  { id: "autonomy", title: "Autonomy & blast radius", blurb: "How much the agent is allowed to do on its own, and how far a single mistake can travel.",
    fields: [
      { k: "autonomy", label: "Autonomy level", type: "autonomy" },
      { k: "blast", label: "Blast radius of one bad action", type: "chips", single: true, opts: "blast" },
      { k: "actions", label: "Action classes the agent may take", type: "chips", opts: DP_ACTIONS, hint: "Pick everything it is allowed to attempt, not just what it does today." },
      { k: "approvalGate", label: "Human approval required for irreversible actions", type: "toggle" }
    ] },

  { id: "data", title: "Data & compliance", blurb: "What it can see, and which regimes the answer has to satisfy.",
    fields: [
      { k: "sensitivity", label: "Data sensitivity ceiling", type: "cards", opts: DP_SENS },
      { k: "dataClasses", label: "Data classes handled", type: "chips", opts: DP_DATACLASS },
      { k: "compliance", label: "Applies to", type: "compliance", opts: DP_COMPLIANCE }
    ] },

  { id: "delivery", title: "Delivery & operations", blurb: "Where it runs and who owns it when it breaks.",
    fields: [
      { k: "hosting", label: "Hosting", type: "cards", opts: DP_HOSTING },
      { k: "team", label: "Team size", type: "cards", opts: DP_TEAM },
      { k: "rollout", label: "Rollout strategy", type: "cards", opts: DP_ROLLOUT },
      { k: "oncall", label: "On-call coverage", type: "cards", opts: DP_ONCALL }
    ] }
];

/* Append-only: iteration 16+ register sections here. */
const DP_SECTIONS = [
  { id: "profile", title: "Deployment profile", render: dpSectionProfile }
];

const dpDefault = () => ({
  system: "", domain: "finance", criticality: "high", volume: "10k",
  autonomy: 2, blast: "tenant", actions: ["read", "write"], approvalGate: true,
  sensitivity: "confidential", dataClasses: ["financial"], compliance: ["soc2"],
  hosting: "cloud-managed", team: "small", rollout: "canary", oncall: "business"
});

const dpState = { step: 0, done: false, a: dpDefault(), err: null };

function dpLoad() {
  try {
    const raw = localStorage.getItem(DP_STORE);
    if (!raw) return;
    const j = JSON.parse(raw);
    if (j && j.a) Object.assign(dpState.a, j.a);
    if (typeof j.step === "number") dpState.step = Math.min(Math.max(0, j.step), DP_STEPS.length);
    dpState.done = !!j.done;
  } catch (e) { /* ignore corrupt state */ }
}
function dpSave() {
  try { localStorage.setItem(DP_STORE, JSON.stringify({ a: dpState.a, step: dpState.step, done: dpState.done })); } catch (e) {}
}
function dpReset() {
  dpState.step = 0; dpState.done = false; dpState.err = null;
  dpState.a = dpDefault(); dpSave(); dpRender();
  showNotif("Deployment plan reset");
}

function initDeploy() {
  if (!el("dpRoot")) return;
  dpLoad();
  dpRender();
}

/* ---------------- option helpers ---------------- */
function dpOpts(kind) {
  if (kind === "domains") {
    const fromCov = DATA.coverage && DATA.coverage.domains;
    const list = fromCov || uniq((DATA.patterns.patterns || []).flatMap(p => p.domains)).sort();
    return list.map(d => [d, d]);
  }
  if (kind === "blast") return DP_BLAST.map(b => [b, b]);
  return [];
}

function dpLabel(k, v) {
  if (k === "autonomy") { const x = DP_AUTONOMY.find(o => o.v === Number(v)); return x ? x.label : String(v); }
  const f = dpFieldOf(k);
  const opts = f && f.type === "select" ? dpOpts(f.opts) : (f ? (f.opts || []) : []);
  const hit = (opts || []).find(o => (Array.isArray(o) ? o[0] : o) === v);
  if (hit) return Array.isArray(hit) ? hit[1] : hit;
  if (k === "blast") return v;
  return String(v);
}
function dpFieldOf(k) {
  for (const s of DP_STEPS) { const f = (s.fields || []).find(x => x.k === k); if (f) return f; }
  return null;
}
function dpDomainLabel() { return dpLabel("domain", dpState.a.domain); }

/* ---------------- validation ---------------- */
function dpErrors(stepIdx) {
  const step = DP_STEPS[stepIdx];
  if (!step) return [];
  const errs = [];
  step.fields.forEach(f => {
    const v = dpState.a[f.k];
    if (f.required && !(v && String(v).trim())) errs.push(`${f.label} is required`);
    if (f.type === "chips" && !f.single && (!v || !v.length)) errs.push(`${f.label}: pick at least one`);
  });
  return errs;
}

/* ---------------- field rendering ---------------- */
function dpField(f) {
  const v = dpState.a[f.k];
  const label = `<span class="dp-label">${escHtml(f.label)}${f.required ? ' <b class="req">*</b>' : ""}</span>`;
  const hint = f.hint ? `<small class="dp-hint">${escHtml(f.hint)}</small>` : "";

  switch (f.type) {
    case "text":
      return `<div class="dp-field">${label}<input class="dp-input" type="text" value="${escHtml(v)}" placeholder="${escHtml(f.placeholder || "")}" oninput="dpSet('${f.k}', this.value, true)">${hint}</div>`;

    case "select":
      return `<div class="dp-field">${label}<select class="dp-input" onchange="dpSet('${f.k}', this.value)">${
        dpOpts(f.opts).map(o => `<option value="${escHtml(o[0])}"${o[0] === v ? " selected" : ""}>${escHtml(o[1])}</option>`).join("")
      }</select>${hint}</div>`;

    case "cards":
      return `<div class="dp-field">${label}<div class="dp-cards">${
        f.opts.map(o => `<button class="dp-card${o[0] === v ? " on" : ""}" onclick="dpSet('${f.k}','${escHtml(o[0])}')">
          <b>${escHtml(o[1])}</b>${o[2] ? `<span>${escHtml(o[2])}</span>` : ""}</button>`).join("")
      }</div>${hint}</div>`;

    case "autonomy":
      return `<div class="dp-field">${label}<div class="dp-cards dp-auto">${
        DP_AUTONOMY.map(o => `<button class="dp-card${Number(v) === o.v ? " on" : ""}" onclick="dpSet('autonomy',${o.v})">
          <b>${escHtml(o.label)}</b><span>${escHtml(o.desc)}</span></button>`).join("")
      }</div>${hint}</div>`;

    case "chips": {
      const opts = Array.isArray(f.opts) ? f.opts.map(o => [o, o]) : dpOpts(f.opts);
      const sel = f.single ? [v] : (v || []);
      return `<div class="dp-field">${label}<div class="dp-chiprow">${
        opts.map(o => dpChipBtn(f.k, o[0], o[1], sel, f.single)).join("")
      }</div>${hint}</div>`;
    }

    case "compliance":
      return `<div class="dp-field">${label}<div class="dp-chiprow">${
        f.opts.map(o => dpChipBtn(f.k, o[0], o[1], v || [], false)).join("")
      }</div>${hint}</div>`;

    case "toggle":
      return `<div class="dp-field dp-toggle-row">${label}
        <button class="dp-toggle${v ? " on" : ""}" role="switch" aria-checked="${v ? "true" : "false"}" onclick="dpSet('${f.k}', ${v ? "false" : "true"})">
          <i></i><span>${v ? "Required" : "Not required"}</span>
        </button>${hint}</div>`;

    default: return "";
  }
}

function dpChipBtn(k, val, text, sel, single) {
  const on = sel.indexOf(val) >= 0;
  const fn = single ? "dpPick" : "dpToggle";
  return `<button class="dp-chip${on ? " on" : ""}" onclick="${fn}('${k}','${escHtml(val)}')">${escHtml(text)}</button>`;
}

/* ---------------- mutations ---------------- */
function dpSet(k, v, soft) {
  dpState.a[k] = v;
  if (dpState.err) {
    dpState.err = null;
    const box = document.querySelector(".dp-err");
    if (box) box.remove();
  }
  dpSave();
  /* soft = typing in a text field: refresh only the live rail so the input
     keeps focus. Everything else re-renders the step (options are buttons). */
  if (soft) { dpRefreshRail(); return; }
  dpRender();
}
function dpRefreshRail() {
  const rail = document.querySelector("#dpRoot .dp-rail");
  if (rail) rail.innerHTML = dpRailHTML();
}
function dpPick(k, v) { dpState.a[k] = v; dpSave(); dpRender(); }
function dpToggle(k, v) {
  const arr = dpState.a[k] || [];
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1); else arr.push(v);
  dpState.a[k] = arr;
  dpSave(); dpRender();
}
function dpGo(i) {
  const errs = dpErrors(dpState.step);
  if (i > dpState.step && errs.length) { dpState.err = errs; dpRender(); return; }
  dpState.step = Math.max(0, Math.min(DP_STEPS.length, i));
  dpState.err = null; dpSave(); dpRender();
  const wrap = document.querySelector("#deployPane .ov-wrap");
  if (wrap) wrap.scrollTo({ top: 0, behavior: "smooth" });
}
function dpNext() { dpGo(dpState.step + 1); }
function dpPrev() { dpGo(dpState.step - 1); }
function dpFinish() {
  const errs = DP_STEPS.reduce((acc, _, i) => acc.concat(dpErrors(i)), []);
  if (errs.length) { dpState.err = errs; dpRender(); return; }
  dpState.done = true; dpState.err = null; dpSave(); dpRender();
  showNotif("Plan generated — " + (dpState.a.system || "deployment"));
}
function dpEditIntake() { dpState.done = false; dpState.step = 0; dpSave(); dpRender(); }

/* ---------------- section 1: profile (iteration 15) ---------------- */
function dpSectionProfile() {
  const a = dpState.a;
  const row = (k, v) => `<div class="dp-kv"><dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd></div>`;
  const auto = DP_AUTONOMY.find(o => o.v === Number(a.autonomy)) || DP_AUTONOMY[2];
  const compliance = (a.compliance || []).map(c => (DP_COMPLIANCE.find(x => x[0] === c) || [, c])[1]).join(", ") || "—";
  const actions = (a.actions || []).join(", ") || "—";
  const classes = (a.dataClasses || []).join(", ") || "—";
  return `
    <dl class="dp-kvlist">
      ${row("System", a.system || "—")}
      ${row("Domain", dpLabel("domain", a.domain))}
      ${row("Criticality", dpLabel("criticality", a.criticality))}
      ${row("Throughput", dpLabel("volume", a.volume))}
      ${row("Autonomy", auto.label)}
      ${row("Blast radius", a.blast)}
      ${row("Action classes", actions)}
      ${row("Approval gate", a.approvalGate ? "human approval required for irreversible actions" : "none — autonomous effects")}
      ${row("Data ceiling", dpLabel("sensitivity", a.sensitivity))}
      ${row("Data classes", classes)}
      ${row("Applies to", compliance)}
      ${row("Hosting", dpLabel("hosting", a.hosting))}
      ${row("Team", dpLabel("team", a.team))}
      ${row("Rollout", dpLabel("rollout", a.rollout))}
      ${row("On-call", dpLabel("oncall", a.oncall))}
    </dl>
    <p class="muted small">${escHtml(auto.desc)}</p>
    <div class="dp-actions-row">
      <button class="btn" onclick="dpEditIntake()">Edit intake</button>
      <button class="iconbtn" onclick="dpCopyPlan()">Copy Markdown</button>
      <button class="iconbtn" onclick="dpDownloadPlan()">Download .md</button>
      <button class="iconbtn" onclick="dpReset()">Reset plan</button>
    </div>`;
}

/* ---------------- plan markdown ---------------- */
function dpMarkdown() {
  const a = dpState.a;
  const auto = DP_AUTONOMY.find(o => o.v === Number(a.autonomy)) || DP_AUTONOMY[2];
  const kv = [
    ["System", a.system], ["Domain", dpLabel("domain", a.domain)],
    ["Criticality", dpLabel("criticality", a.criticality)], ["Throughput", dpLabel("volume", a.volume)],
    ["Autonomy", auto.label + " — " + auto.desc], ["Blast radius", a.blast],
    ["Action classes", (a.actions || []).join(", ")],
    ["Approval gate", a.approvalGate ? "required for irreversible actions" : "none"],
    ["Data ceiling", dpLabel("sensitivity", a.sensitivity)],
    ["Data classes", (a.dataClasses || []).join(", ")],
    ["Applies to", (a.compliance || []).join(", ")],
    ["Hosting", dpLabel("hosting", a.hosting)], ["Team", dpLabel("team", a.team)],
    ["Rollout", dpLabel("rollout", a.rollout)], ["On-call", dpLabel("oncall", a.oncall)]
  ];
  return "# Deployment plan — " + (a.system || "untitled") + "\n\n" +
    kv.map(([k, v]) => "- **" + k + ":** " + (v || "—")).join("\n") + "\n";
}
function dpCopyPlan() {
  const md = dpMarkdown();
  if (navigator.clipboard) navigator.clipboard.writeText(md).then(() => showNotif("Plan copied to clipboard")).catch(() => dpDownloadPlan());
  else dpDownloadPlan();
}
function dpDownloadPlan() {
  const name = "deployment-plan-" + String(dpState.a.system || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".md";
  const blob = new Blob([dpMarkdown()], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ---------------- render ---------------- */
function dpRender() {
  const root = el("dpRoot");
  if (!root) return;

  const stepper = `<ol class="dp-steps">${DP_STEPS.map((s, i) => {
    const state = i < dpState.step || (dpState.done && i <= dpState.step) ? "done" : i === dpState.step ? "on" : "";
    return `<li class="dp-step ${state}"><button onclick="dpGo(${i})" ${state === "" ? 'aria-current="false"' : ""}>
      <i>${state === "done" ? "✓" : i + 1}</i><span>${escHtml(s.title)}</span></button></li>`;
  }).join("")}</ol>`;

  let body;
  if (dpState.done) {
    body = `
      <div class="dp-planhead">
        <div>
          <h2>${escHtml(dpState.a.system || "Deployment plan")}</h2>
          <p class="muted small">${escHtml(dpLabel("criticality", dpState.a.criticality))} · ${escHtml(dpState.a.blast)} blast radius · ${escHtml(dpLabel("autonomy", dpState.a.autonomy))}</p>
        </div>
        <div class="dp-actions-row"><button class="btn" onclick="dpEditIntake()">↺ Edit intake</button></div>
      </div>
      <div class="dp-sections">${DP_SECTIONS.map(s => `
        <section class="panel dp-sec" id="dpsec-${escHtml(s.id)}">
          <h3>${escHtml(s.title)}${s.tag ? ` <span class="muted small">${escHtml(s.tag)}</span>` : ""}</h3>
          <div class="dp-sectbody">${s.render()}</div>
        </section>`).join("")}</div>`;
  } else {
    const step = DP_STEPS[Math.min(dpState.step, DP_STEPS.length - 1)];
    const errs = dpState.err || [];
    const last = dpState.step >= DP_STEPS.length - 1;
    body = `
      <div class="dp-body">
        <div class="dp-form">
          <div class="dp-stephead">
            <h2>${escHtml(step.title)}</h2>
            <p class="muted">${escHtml(step.blurb)}</p>
          </div>
          ${errs.length ? `<div class="dp-err" role="alert">${errs.map(e => "• " + escHtml(e)).join("<br>")}</div>` : ""}
          ${step.fields.map(dpField).join("")}
          <div class="dp-foot">
            <button class="iconbtn" onclick="dpPrev()" ${dpState.step === 0 ? "disabled" : ""}>← Back</button>
            <div style="flex:1"></div>
            <button class="iconbtn" onclick="dpReset()">Reset</button>
            ${last
              ? `<button class="btn primary" onclick="dpFinish()">Generate plan →</button>`
              : `<button class="btn primary" onclick="dpNext()">Continue →</button>`}
          </div>
        </div>
        <aside class="dp-rail">${dpRailHTML()}</aside>
      </div>`;
  }

  root.innerHTML = `
    <div class="dp-head">
      <div><h2>Deployment Planner</h2>
      <p class="muted small">Answer four questions about the system. The plan that comes out is grounded in this catalog — patterns, scenarios and cascades cited by name.</p></div>
    </div>
    ${stepper}
    ${body}`;
}

function dpRailHTML() {
  return `<h4>Live profile</h4>${dpRail()}<p class="muted small">Answers are saved in this browser only.</p>`;
}

function dpRail() {
  const a = dpState.a;
  const item = (k, v) => `<div class="dp-rail-item"><span>${escHtml(k)}</span><b>${escHtml(v || "—")}</b></div>`;
  const missing = !String(a.system || "").trim();
  return `
    ${item("System", a.system)}
    ${item("Criticality", dpLabel("criticality", a.criticality))}
    ${item("Autonomy", dpLabel("autonomy", a.autonomy))}
    ${item("Blast", a.blast)}
    ${item("Actions", (a.actions || []).length + " selected")}
    ${item("Data", dpLabel("sensitivity", a.sensitivity))}
    ${item("Rollout", dpLabel("rollout", a.rollout))}
    ${missing ? '<p class="dp-need">Start by naming the system.</p>' : ""}`;
}

/* ---------------- section 2: readiness scorecard (iteration 16) ---------- */
/* Every citation is validated against the loaded catalog at render time, so a
   renamed pattern can never produce a dead link — it just degrades to text. */
function dpHas(kind, id) {
  if (!id) return false;
  if (kind === "pattern") return !!(DATA.patterns && DATA.patterns.patterns || []).some(p => p.id === id);
  if (kind === "scenario") return !!(DATA.scenarios && DATA.scenarios.scenarios || []).some(s => s.id === id);
  if (kind === "cascade") return !!(DATA.cascades && DATA.cascades.cascades || []).some(c => c.id === id);
  return false;
}
function dpFinding(t, kind, id) { return { t: t, kind: kind, id: dpHas(kind, id) ? id : null }; }

function dpOpenCite(kind, id) {
  try {
    if (kind === "pattern" && typeof openPattern === "function") openPattern(id);
    else if (kind === "scenario") { switchTab("scenarios"); setTimeout(() => openScenario(id), 70); }
    else if (kind === "cascade") { switchTab("cascades"); setTimeout(() => openCascade(id), 70); }
    else showNotif("Reference: " + id);
  } catch (e) { showNotif("Couldn't open " + id); }
}

const dpClamp = n => Math.max(0, Math.min(100, Math.round(n)));

/* Domain facts from the real catalog — used by the alignment dimension. */
function dpDomainData() {
  const dom = dpState.a.domain;
  const scens = ((DATA.scenarios && DATA.scenarios.scenarios) || []).filter(s => s.domain === dom);
  const casc = ((DATA.cascades && DATA.cascades.cascades) || []).filter(c => (c.domain || "general") === dom);
  return {
    dom: dom,
    scens: scens,
    casc: casc,
    severe: scens.filter(s => s.severity === "critical" || s.severity === "high"),
    systemic: casc.filter(c => c.cls === "derived" || c.cls === "cascading")
  };
}

function dpDims() {
  const a = dpState.a, dd = dpDomainData();
  const B = ["transact", "delete", "publish"];
  const held = B.filter(x => (a.actions || []).indexOf(x) >= 0);
  const D = [];

  /* 1 — can the control model hold the autonomy we asked for? */
  {
    let s = 100; const f = [];
    if (!a.approvalGate) {
      if (a.autonomy >= 3) { s -= 35; f.push(dpFinding(`L${a.autonomy} autonomy with no human gate over irreversible actions`, "pattern", "approval-gates")); }
      if (held.length) { s -= 25; f.push(dpFinding(`Can "${held.join('", "')}" with no approval step`, "pattern", "dual-control")); }
      if (!held.length && a.autonomy < 3) f.push(dpFinding("Read-mostly action set keeps approval pressure low", "pattern", "human-in-the-loop"));
    } else {
      f.push(dpFinding("Approval gate required for irreversible actions", "pattern", "human-in-the-loop"));
      if (a.autonomy >= 3 && held.length >= 2) { s -= 15; f.push(dpFinding("Gates across a wide action surface invite review fatigue — cap by policy, not by vigilance", "scenario", "approval-fatigue")); }
    }
    if (a.autonomy === 4) { s -= 10; f.push(dpFinding("Fully autonomous operation needs a rollback path it can trigger itself", "pattern", "checkpoint-rollback")); }
    if ((a.actions || []).length > 5) { s -= 8; f.push(dpFinding("Broad action surface — express what is allowed as policy in the runtime", "pattern", "policy-engine")); }
    if (a.criticality === "critical" && a.autonomy >= 2) { s -= 10; f.push(dpFinding("Critical system acting on its own: keep an always-on eval harness, not a launch test", "pattern", "eval-harness-redteam")); }
    D.push({ id: "control", title: "Autonomy & control fit", weight: 25, score: dpClamp(s), findings: f });
  }

  /* 2 — can one mistake be contained? */
  {
    let s = 100; const f = [];
    const rank = DP_BLAST.indexOf(a.blast);
    if (rank >= 2 && a.autonomy >= 3) { s -= 25; f.push(dpFinding(`${a.blast}-sized blast radius at L${a.autonomy}: cap per-action effect`, "pattern", "quota-rate-limit")); }
    else if (rank >= 4) { s -= 12; f.push(dpFinding(`${a.blast} blast radius: isolate and shut off segments independently`, "pattern", "least-privilege")); }
    if (a.autonomy >= 2 && held.length) { f.push(dpFinding("Spend/size ceilings bound what a single run can consume", "pattern", "budget-guardrails")); }
    if (dd.systemic.length) f.push(dpFinding(`${dd.systemic.length} derived/cascading chains are already modeled for ${dd.dom}`, "cascade", dd.systemic[0].id));
    else f.push(dpFinding("No modeled propagation for this domain — assume correlation you cannot yet see", "pattern", "retry-backoff"));
    if (!f.length || s === 100) f.push(dpFinding("Blast radius is small relative to autonomy", "pattern", "least-privilege"));
    D.push({ id: "contain", title: "Blast-radius containment", weight: 20, score: dpClamp(s), findings: f });
  }

  /* 3 — does what it can see stay contained? */
  {
    let s = 100; const f = [];
    const heavy = (a.dataClasses || []).filter(c => ["pii", "health", "credentials", "financial"].indexOf(c) >= 0);
    if (a.sensitivity === "restricted") { s -= 12; f.push(dpFinding("Restricted ceiling: tokenize and row-scope before the model sees it", "pattern", "least-privilege")); }
    if ((a.dataClasses || []).indexOf("credentials") >= 0) { s -= 18; f.push(dpFinding("Never hand raw credentials to a model — issue scoped, short-lived identity", "pattern", "agent-identity")); }
    if (heavy.length >= 3) { s -= 15; f.push(dpFinding("Three or more sensitive classes in one context: separate them", "scenario", "tenant-leak")); }
    if (!heavy.length && a.sensitivity === "public") s += 0;
    f.push(dpFinding("Output shield scans what leaves the boundary", "pattern", "content-shielding"));
    D.push({ id: "data", title: "Data protection", weight: 15, score: dpClamp(s), findings: f });
  }

  /* 4 — how much control work did we sign up for? */
  {
    const n = (a.compliance || []).length;
    let s = 100 - Math.max(0, n - 1) * 8; const f = [];
    if (!n) { s = Math.min(s, 65); f.push(dpFinding("No regime selected — decide what \"compliant\" means before launch", "pattern", "audit-trail")); }
    else f.push(dpFinding(`${n} regime${n > 1 ? "s" : ""} in scope: every guardrail needs an owner, a control and evidence`, "pattern", "audit-trail"));
    const map = { "eu-ai-act": ["pattern", "human-in-the-loop"], "gdpr": ["pattern", "audit-trail"], "hipaa": ["pattern", "least-privilege"], "pci-dss": ["pattern", "content-shielding"], "nist-ai-rmf": ["pattern", "eval-harness-redteam"] };
    (a.compliance || []).slice(0, 2).forEach(c => { const m = map[c]; if (m) f.push(dpFinding(`${dpLabel("compliance", c)}: ${m[1]} is the load-bearing control`, m[0], m[1])); });
    D.push({ id: "compliance", title: "Compliance load", weight: 15, score: dpClamp(s), findings: f });
  }

  /* 5 — who catches it at 2am, and how does it reach users? */
  {
    let s = 100; const f = [];
    if (a.rollout === "big-bang") { s -= 30; f.push(dpFinding("Big-bang rollout produces no parity evidence — go shadow → canary", "pattern", "canary-shadow")); }
    else if (a.rollout === "staged") { f.push(dpFinding("Staged rollout bounds blast; add dry-run parity before each widening", "pattern", "shadow-agents")); }
    else f.push(dpFinding(`${dpLabel("rollout", a.rollout)} rollout keeps the first exposure small`, "pattern", "canary-shadow"));
    if (a.oncall === "none") { s -= 35; f.push(dpFinding("Nobody is on call when the agent misbehaves", "pattern", "drift-monitoring")); }
    if (a.oncall === "business" && a.criticality === "critical") { s -= 12; f.push(dpFinding("Critical systems don't take evenings off — round-the-clock coverage or a hard blast cap", "pattern", "drift-monitoring")); }
    if (a.team === "solo" && a.autonomy >= 3) { s -= 15; f.push(dpFinding("Solo team at L3+: the builder is also the reviewer", "pattern", "dual-control")); }
    if (a.hosting === "serverless" && a.autonomy >= 3) { s -= 8; f.push(dpFinding("Serverless egress is easy to miss — allowlist what it can reach", "pattern", "tool-sandbox")); }
    D.push({ id: "ops", title: "Operational readiness", weight: 15, score: dpClamp(s), findings: f });
  }

  /* 6 — grounded: does the catalog actually cover this domain? */
  {
    let s = 100; const f = [];
    if (!dd.scens.length) { s = 35; f.push(dpFinding(`No scenarios authored for "${dd.dom}" — planning blind from here`, null, null)); }
    else if (dd.severe.length < 2) { s = 75; f.push(dpFinding(`${dd.scens.length} scenarios on file for ${dd.dom}, ${dd.severe.length} severe — expand the severe cases`, "scenario", dd.scens[0].id)); }
    else f.push(dpFinding(`${dd.scens.length} scenarios for ${dd.dom}, ${dd.severe.length} critical/high — test against them`, "scenario", dd.severe[0].id));
    if (dd.systemic.length) f.push(dpFinding(`Run the ${dd.systemic.length} derived/cascading chains as failure drills`, "cascade", dd.systemic[0].id));
    else if (dd.casc.length) f.push(dpFinding(`${dd.casc.length} cascades modeled; none yet cross a boundary in this domain`, "cascade", dd.casc[0].id));
    else { s -= 20; f.push(dpFinding(`No cascade model for ${dd.dom} — emergent coupling is undocumented`, null, null)); }
    D.push({ id: "catalog", title: "Catalog alignment", weight: 10, score: dpClamp(s), findings: f });
  }

  return D;
}

function dpScore() {
  const dims = dpDims();
  const tw = dims.reduce((s, d) => s + d.weight, 0);
  const overall = Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0) / tw);
  const band = overall >= 85 ? ["Ready", "ok"]
    : overall >= 70 ? ["Ready with controls", "accent"]
    : overall >= 50 ? ["Needs work", "orange"]
    : ["Not ready", "red"];
  const moves = dims.slice()
    .filter(d => d.score < 85)
    .sort((x, y) => (y.weight * (100 - y.score)) - (x.weight * (100 - x.score)))
    .map(d => ({ dim: d, f: d.findings.find(x => x.id) || d.findings[0] }))
    .filter(m => m.f)
    .slice(0, 3);
  return { dims: dims, overall: overall, band: band, moves: moves };
}

function dpGrade(score) { return score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 55 ? "D" : "F"; }

function dpSectionScore() {
  const sc = dpScore();
  return `
    <div class="dp-scorehead">
      <div class="dp-scorebig"><b>${sc.overall}</b><span>${dpGrade(sc.overall)}</span></div>
      <div class="dp-scoremeta">
        <span class="chip ${sc.band[1]}">${escHtml(sc.band[0])}</span>
        <p class="muted small">Weighted across ${sc.dims.length} dimensions from your intake answers. Lower-scoring dimensions are the ones to fix first.</p>
      </div>
      <div class="dp-scorebar"><div class="dp-bar-fill" style="width:${sc.overall}%"></div></div>
    </div>
    <div class="dp-dims">${sc.dims.map(d => `
      <div class="dp-dim">
        <div class="dp-dimhead"><b>${escHtml(d.title)}</b><span>${d.score} · ${dpGrade(d.score)} <i class="muted">w${d.weight}</i></span></div>
        <div class="dp-bar"><div class="dp-bar-fill ${d.score >= 70 ? "good" : d.score >= 50 ? "mid" : "bad"}" style="width:${d.score}%"></div></div>
        <ul class="dp-find">${d.findings.map(f => `
          <li>${f.id ? `<button class="dp-cite" onclick="dpOpenCite('${escHtml(f.kind)}','${escHtml(f.id)}')" title="Open in catalog">${escHtml(f.id)}</button> ` : ""}${escHtml(f.t)}</li>`).join("")}
        </ul>
      </div>`).join("")}</div>
    ${sc.moves.length ? `
    <div class="dp-moves">
      <h4>Highest-leverage next moves</h4>
      <ol>${sc.moves.map(m => `<li><b>${escHtml(m.dim.title)}:</b> ${escHtml(m.f.t)}${m.f.id ? ` — <button class="dp-cite" onclick="dpOpenCite('${escHtml(m.f.kind)}','${escHtml(m.f.id)}')">${escHtml(m.f.id)}</button>` : ""}</li>`).join("")}</ol>
    </div>` : ""}`;
}

DP_SECTIONS.push({ id: "scorecard", title: "Readiness scorecard", render: dpSectionScore });

tabLoaders.deploy = function () { initDeploy(); };
