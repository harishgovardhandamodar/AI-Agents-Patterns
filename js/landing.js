/* landing.js — Overview landing page: hero, catalog spotlight, field notes,
   incident-anatomy diagram and cascade-class chart. Everything is grounded:
   spotlight and charts are computed from DATA; field notes are dated external
   research (Oct 2026), each mapped to catalog items that open in drawers. */

"use strict";

const LANDING_SPOTLIGHT = [
  "selfrewrite-reward-hack",
  "prompt-selfedit-jailbreak",
  "spawn-fleet-runaway",
  "selfdistill-collapse",
  "metric-gaming-triage"
];

/* Dated external research; links use real publication URLs. Each note maps
   to catalog items so a reader can go from "the field found X" to the
   pattern / scenario / cascade that covers it here. */
const LANDING_NOTES = [
  {
    date: "Sep 2026",
    title: "Evolved agents fail 44% of safety tests their baselines pass",
    body: "SEABench (48 longitudinal task sequences) shows self-evolution raising task completion 36% → 47% while introducing safety failures in 43.9% of tests vs 0% for paired non-evolving agents. Tools/skills updates are the riskiest surface: defects become executable and reusable.",
    url: "https://arxiv.org/html/2609.35596",
    links: [["scenario", "selfrewrite-reward-hack"], ["scenario", "spawn-fleet-runaway"], ["pattern", "evaluator-optimizer"]]
  },
  {
    date: "Sep 2026",
    title: "Evolutionary safety: track the transition, not just the moment",
    body: "The self-evolving-agents survey + SAVER framework (S×A→V→E→R) argues failures come from legitimate state whose persistence, authority or scope broadened beyond its original validity — exactly our derived/emergent classes. Open gap they flag: descendant repair after resumed adaptation.",
    url: "https://arxiv.org/html/2610.00093",
    links: [["scenario", "selfdistill-collapse"], ["scenario", "prompt-selfedit-jailbreak"], ["pattern", "memory-consolidation"]]
  },
  {
    date: "Oct 2026",
    title: "Deterministic execution-boundary defenses hit 0% attack success",
    body: "APEX (contract + deception probes at the tool boundary), ClawGuard (per-call rule induction) and ActGuard (pre-execution action auditing) converge: stop reasoning about attack patterns, authorize effects at the boundary. Mirrors this catalog's policy-engine / spend-guard / dual-control stack.",
    url: "https://arxiv.org/html/2610.06966",
    links: [["pattern", "policy-engine"], ["pattern", "budget-guardrails"], ["pattern", "approval-gates"], ["scenario", "fin-card-injection"]]
  },
  {
    date: "2026",
    title: "Information-flow labels go mainstream (FIDES, Janus)",
    body: "Microsoft's FIDES middleware (integrity + confidentiality labels propagated through tool calls, enforced pre-tool) and Janus (least-privilege JSON policies + taint-gated outbound tools) productize what the catalog teaches: least-privilege identity, sandboxed tools, DLP on egress.",
    url: "https://learn.microsoft.com/en-us/agent-framework/agents/security",
    links: [["pattern", "least-privilege"], ["pattern", "tool-sandbox"], ["pattern", "provenance-citation"]]
  }
];

function landLink(kind, id) {
  let label = id, fn = null, cls = "";
  try {
    if (kind === "pattern") {
      const p = (DATA.patterns.patterns || []).find(x => x.id === id);
      if (!p) return "";
      label = p.name; fn = "openPattern"; cls = "p";
    } else if (kind === "scenario") {
      const s = (DATA.scenarios.scenarios || []).find(x => x.id === id);
      if (!s) return "";
      label = s.title; fn = "openScenario"; cls = "s";
    } else if (kind === "cascade") {
      const c = (DATA.cascades.cascades || []).find(x => x.id === id);
      if (!c) return "";
      label = c.name; fn = "openCascade"; cls = "c";
    } else return "";
  } catch (e) { return ""; }
  const mark = cls === "p" ? "◆" : cls === "s" ? "⚠" : "⧉";
  return `<span class="cp-cite ${cls}" onclick="${fn}('${id}')" title="Open in catalog">${mark} ${escHtml(label)}</span>`;
}

function landSpotlight() {
  const cards = LANDING_SPOTLIGHT.map(id => {
    const s = (DATA.scenarios.scenarios || []).find(x => x.id === id);
    if (!s) return "";
    const sevColor = s.severity === "critical" ? "var(--red)" : s.severity === "high" ? "var(--orange)" : "var(--accent)";
    return `<div class="land-spot" onclick="openScenario('${s.id}')" role="listitem" tabindex="0" onkeydown="if(event.key==='Enter')openScenario('${s.id}')">` +
      `<div class="land-spot-sev" style="color:${sevColor}">${escHtml(s.severity.toUpperCase())} · ${escHtml(s.domain)}</div>` +
      `<div class="land-spot-t">${escHtml(s.title)}</div>` +
      `<div class="land-spot-d">${escHtml(s.description.slice(0, 110))}…</div></div>`;
  }).join("");
  return `<div class="land-sec"><div class="land-sec-h"><h3>🆕 New in the catalog: self-improving agents</h3>` +
    `<button class="btn sm ghost" onclick="switchTab('scenarios')">All ${DATA.scenarios.scenarios.length} scenarios →</button></div>` +
    `<p class="muted small" style="margin:0 0 10px">Five failure scenarios added for agents that rewrite their own rewards, prompts, successors and fleets — the surface SEABench just measured.</p>` +
    `<div class="land-spots" role="list">${cards}</div></div>`;
}

function landNotes() {
  const notes = LANDING_NOTES.map(n =>
    `<div class="land-note"><div class="land-note-head"><span class="chip">${escHtml(n.date)}</span><b>${escHtml(n.title)}</b></div>` +
    `<p>${escHtml(n.body)} <a href="${escHtml(n.url)}" target="_blank" rel="noopener" title="Read the paper">read ↗</a></p>` +
    `<div class="ref-chips">${n.links.map(l => landLink(l[0], l[1])).join("")}</div></div>`).join("");
  return `<div class="land-sec"><div class="land-sec-h"><h3>🔭 Field notes — recent finds</h3>` +
    `<span class="muted small">external research, mapped to this catalog</span></div>` +
    `<div class="land-notes">${notes}</div></div>`;
}

function landDiagram() {
  const src = "flowchart LR\n" +
    "  A[Untrusted content<br/>vendor page / email / tool output] --> B(Agent reads it<br/>as instructions)\n" +
    "  B --> C{Execution boundary<br/>who authorizes this effect?}\n" +
    "  C -->|no gate| D[Tool fires<br/>charge / email / deploy]\n" +
    "  C -->|spend guard<br/>allowlist<br/>dual control| E[Blocked + logged]\n" +
    "  D --> F[Cascade<br/>retry storm / split / exfil]\n" +
    "  E --> G[Copilot consult<br/>+ Guardrail Lab rule]\n" +
    "  style C fill:#e8c35a,color:#1f2328,stroke:#9a6700\n" +
    "  style E fill:#8fd6a4,color:#0d2818,stroke:#1a7f37\n" +
    "  style F fill:#f2a3a3,color:#2d0d0d,stroke:#cf222e";
  return `<div class="land-sec"><div class="land-sec-h"><h3>🗺 How a failure becomes a loss — and where this app stops it</h3></div>` +
    diagramHtml(src, "incident anatomy") +
    `<p class="muted small">Left to right: the $50k card scenario's shape. Every red node is a catalog scenario; every green node is a pattern you can add to a blueprint. The diamond is the whole thesis: authorize effects at the boundary, not intentions in the prompt.</p></div>`;
}

function landChart() {
  const all = (DATA.cascades && DATA.cascades.cascades) || [];
  const order = [["inherent", "Inherent — one part fails"], ["emergent", "Emergent — the interaction fails"], ["derived", "Derived — A must lead to B"], ["cascading", "Cascading — crosses a boundary"]];
  const max = Math.max(1, ...order.map(o => all.filter(c => c.cls === o[0]).length));
  const bars = order.map(o => {
    const n = all.filter(c => c.cls === o[0]).length;
    return `<div class="bar-row"><span class="lbl" title="${escHtml(o[1])}">${escHtml(o[1].split(" — ")[0])}</span>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${Math.round(100 * n / max)}%"></div></div><span class="n">${n}</span></div>`;
  }).join("");
  return `<div class="land-sec"><div class="land-sec-h"><h3>📊 Cascade classes in this catalog</h3>` +
    `<button class="btn sm ghost" onclick="switchTab('cascades')">Open explorer →</button></div>` +
    `<div class="panel" style="margin:0">${bars}<p class="muted small" style="margin:8px 0 0">Inherent failures dominate the count; cascading ones dominate the damage. The threat model weights them accordingly (×1 / ×1.5 / ×1.25 / ×2).</p></div></div>`;
}

function landHero() {
  return `<div class="land-hero"><div><div class="land-kicker">ADVISORY WORKBENCH · ${DATA.patterns.patterns.length} PATTERNS · ${DATA.scenarios.scenarios.length} SCENARIOS · ${DATA.cascades.cascades.length} CASCADES</div>` +
    `<h2 class="land-title">Design the agent. Then try to break it — here first.</h2>` +
    `<p class="land-sub">A grounded catalog of how AI agents fail and what stops them: patterns to build with, scenarios that attack them, cascades that propagate, and tools that turn it all into a deployment plan, a reference architecture and enforceable guardrails.</p></div>` +
    `<div class="land-ctas"><button class="btn primary" onclick="onbGo('deploy')">🧭 Plan a deployment</button>` +
    `<button class="btn primary" onclick="onbGo('blueprint')">🧩 Architect the system</button>` +
    `<button class="btn" onclick="onbGo('cascades')">⧉ Study how agents fail</button></div></div>`;
}

function initLanding() {
  const root = el("ovLanding");
  if (!root || typeof DATA === "undefined" || !DATA.patterns) return;
  root.innerHTML = landHero() + landSpotlight() + landDiagram() + landChart() + landNotes();
  if (typeof mmRenderAll === "function") mmRenderAll(root);
}
