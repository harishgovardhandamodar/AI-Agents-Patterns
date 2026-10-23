/* help.js — contextual guide for the current tab + a plain-language glossary.
   Opened from the topbar "guide" button; rendered in the shared detail
   drawer so it inherits focus management and Esc handling. */

"use strict";

const GLOSSARY = [
  ["Inherent", "Fails inside one component on its own — no interaction needed. Example: a prompt-injection string that tricks a lone LLM call."],
  ["Emergent", "Only exists when components interact — no single part is at fault. Example: two agents that are safe alone but livelock when paired."],
  ["Derived", "The necessary consequence chain from a first failure — A must lead to B. Example: a bad refund forces a reconciliation write, which forces a notification."],
  ["Cascading", "Crosses a trust or system boundary and amplifies or correlates there. Example: one tenant's poisoned retrieval pollutes a shared cache for everyone."],
  ["Blast radius", "How far a failure can reach: single-request → single-agent → service → tenant → fleet → org → ecosystem. The cascades tab ranks every entry on this ladder."],
  ["STRIDE", "Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege — the six threat buckets the Design docs map to protections."],
  ["Autonomy tier", "How much the agent may do unsupervised, from human approves everything to fully autonomous. Higher tiers demand stronger gates."],
  ["Guardrail", "A runtime control that bounds what an agent can do: budgets, approvals, sandboxes, output shields, audit trails."],
  ["Dual control", "Two independent approvals before an irreversible action — borrowed from finance, applied to agent tool calls."],
  ["Canary / shadow", "Run the new agent on a slice of traffic (canary) or beside production without effects (shadow) before full rollout."],
  ["Provenance", "A record of where each piece of data came from, so retrieved text is never silently trusted as instruction."],
  ["Red team", "Deliberately attacking your own agent (prompt injection, tool abuse) to find holes before someone else does."],
  ["Eval", "A repeatable test that scores agent behaviour — the only way to know a guardrail still holds after a model swap."],
  ["Tool use", "Any moment the agent acts on the world: API calls, refunds, emails, code execution. Every tool call is a trust decision."],
  ["RAG", "Retrieval-augmented generation: the agent looks up documents before answering. Powerful — and the main road poisoned data drives in on."],
  ["Trace", "A replayable record of one agent run: inputs, tool calls, outputs. Live View replays them step by step."],
  ["Exposure index", "The Blueprint tab's 0–100 estimate of residual threat surface: matched scenarios and cascades, discounted by the controls you actually added."],
  ["Residual risk", "What is left after your controls. A control you haven't added yet doesn't reduce anything — the index only credits what's on the canvas."]
];

const HELP = {
  overview: {
    t: "Overview",
    b: `<p>This tab answers <b>“where do I stand?”</b> — the workflow rail shows the five stages of the job (discover → research → design → harden → deliver) and where each one stands, and the <b>Next</b> box names the single most useful thing to do. It reads every tool: the planner, the blueprint, the copilot, the guardrail lab, the mitigation backlog and the discovery run.</p>
    <ul><li>The landing strip on top collects what's new (spotlight scenarios), what the field just found (field notes with paper links), an incident-anatomy diagram and the cascade-class chart — everything below it is the standing catalog summary.</li>
    <li><b>📁 Projects</b> in the top bar group everything you produce for one system — the plan, the blueprint, the guardrail analyses, the mitigation backlog and the pins. Switching projects keeps every one of them.</li>
    <li><b>Pins you make</b> in any catalog drawer collect in the Working set below for review and export.</li>
    <li>The export row produces the full architect report — all eight work products in one document.</li></ul>
    <p class="muted small">Tip: Alt+1…− jumps between tabs; ? shows every shortcut.</p>`
  },
  copilot: {
    t: "Fox - Architect",
    b: `<p>Ask in plain language. Answers are <b>grounded in this catalog</b> — every claim cites the pattern, scenario or cascade it came from, via the local model with a deterministic fallback when no backend answers.</p>
    <ul><li>Scope answers with the <b>Ground answers in</b> checkboxes.</li><li>Pick a <b>persona</b> (AI Agent Architect, Security Architect, PhD Researcher, Council of Researchers) and an <b>audience</b> — the live model reshapes its voice and depth; the offline fallback always uses the default catalog voice.</li><li><b>Grounding</b> shows the exact context sent to the model — audit what it was allowed to know.</li><li>The top-bar pill shows which backend answered: Fox-Services, axiom, or the local fallback.</li><li><b>Ask Fox - Architect</b> buttons inside catalog drawers send the <i>artefact</i> — the pattern's failure modes, the scenario's attack chain, the cascade's propagation path — so the answer is grounded in the substance, not the title.</li><li>Citations are real links: focusable, copyable, and openable in a new tab.</li></ul>`
  },
  patterns: {
    t: "Patterns",
    b: `<p>107 reusable <b>design patterns</b> — the building blocks blueprints are made of. Each card shows failure modes and protections at a glance; the drawer has the full control flow.</p>
    <ul><li>Filter by category, domain, or “has diagram / has failures”.</li><li><b>Least-protected-first sort</b> surfaces the patterns most worth hardening.</li><li>☰ switches to a dense list when you are scanning, not reading.</li><li><b>💾 Save set</b> stores the current filters as a named <b>research set</b> you can come back to or share.</li></ul>
    <p class="muted small">Tip: “Add to blueprint” in any drawer drops the pattern straight onto your canvas.</p>`
  },
  scenarios: {
    t: "Scenarios",
    b: `<p>${catN("scenarios", 43)} concrete <b>failure stories</b>: attack chain, protections that stop it, detection signals, incident response. Scenarios are what the threat model matches your blueprint against.</p>
    <ul><li>Sort by least-protected to find the scenarios your controls don't cover yet.</li><li>“▶ mock run” replays the scenario as a trace in Live View.</li><li>“Add linked patterns” builds a blueprint from the scenario's defences.</li><li><b>💾 Save set</b> stores the current filters as a named <b>research set</b>.</li></ul>`
  },
  cascades: {
    t: "Cascades",
    b: `<p>${catN("cascades", 180)} ways small faults <b>propagate and amplify</b>, in four classes: <b>inherent</b> (one part fails alone), <b>emergent</b> (only the interaction fails), <b>derived</b> (A must lead to B), <b>cascading</b> (crosses a boundary and amplifies).</p>
    <ul><li>The Mitigation planner de-duplicates every control across all cascades, ranked by leverage — fix the top rows first. The progress panel shows how much is owned and how much is done.</li><li><b>🎯 Focus un-owned</b> narrows the backlog to the work that still needs an owner; <b>🧩 Seed blueprint</b> pushes the top 10 onto your canvas.</li><li>Assign owners and status; it persists locally, travels with the project, and exports to CSV.</li>
    <li>The propagation simulator shows how a trigger fans out step by step.</li></ul>
    <p class="muted small">Tip: adding more controls can never raise the Blueprint exposure index — it only discounts matched cascades.</p>`
  },
  coverage: {
    t: "Coverage & Gaps",
    b: `<p>Which <b>domains</b> have patterns, scenarios and cascades behind them — and where the catalog itself is thin. Gap cards tell you exactly what to author next.</p>
    <ul><li>Click a domain to jump into the catalog pre-filtered to it.</li><li>“Ask the copilot” drafts a gap-closing plan for that domain.</li></ul>`
  },
  deploy: {
    t: "Deployment Planner",
    b: `<p>Answer four intake questions; the planner returns a <b>readiness score, recommended stack, rollout plan, risk register and ADR</b> — every recommendation cited to the catalog.</p>
    <ul><li>Work top to bottom; each section unlocks from the same answers, so changing an answer re-grounds everything.</li><li><b>🧩 Materialise as blueprint</b> turns the recommended stack into a canvas in one step — the 13 catalog patterns it names, already chosen for your domain.</li><li>Acknowledge risks to record that a human saw them; export the ADR for your repo. Acknowledgements are undoable.</li></ul>
    <p class="muted small">Tip: the recommended stack can be materialised as a blueprint in one step (section 2).</p>`
  },
  blueprint: {
    t: "Blueprints",
    b: `<p>Compose your <b>reference architecture</b> from stages and controls. Coverage, cost, latency, risk and the threat-model <b>exposure index</b> recompute live.</p>
    <ul><li>Templates are starting points, not answers — the warnings row tells you what's structurally wrong.</li><li><b>Compare</b> pits your canvas against any template or saved blueprint before you restore it.</li><li>The palette <b>multi-selects</b>: tick patterns and the preview tells you how many will be added, how many are already there, and which control families the addition closes.</li><li>Ctrl+Z undoes removes, clears, template swaps, library deletes — and now mitigation edits, risk acknowledgements and copilot regeneration.</li></ul>`
  },
  live: {
    t: "Live View",
    b: `<p><b>Replayable execution traces</b> — watch an agent run step by step: inputs, tool calls, outputs. The player controls work like a media player.</p>
    <ul><li>Open any trace, then scrub, pause and inspect each step's payload.</li><li>Scenarios with a “mock run” chip link straight here.</li><li>Traces you promoted from the Guardrail Lab are marked <b>local</b> and play in the same player.</li></ul>`
  },
  design: {
    t: "Design & Architecture",
    b: `<p>The <b>nine design documents</b> behind the app: system context, UML, control flow, the financial guardrail architecture, data model, threat model, the architect value map, runtime/offline delivery, and the Battle Bench.</p>
    <ul><li>Read 07 for the “why” (the cascade taxonomy the app is built on) and 08 for how it boots, renders diagrams, works offline and is delivered.</li><li>Read 09 for how the catalog <b>tests itself</b> — the battle-test bench that runs the 54 failure scenarios against a configuration and grades the controls.</li><li>⤢ enlarges any diagram with zoom and pan.</li></ul>`
  },
  guard: {
    t: "Guardrail Lab",
    b: `<p>Turn catalog knowledge into <b>enforceable rules</b>: analyse a request, get cascade-aware control recommendations, save them to a collection, export as JSON.</p>
    <ul><li>Every analysis is stored locally and re-openable from the collection rail — the pane re-opens the one you were last reading.</li><li>The report's 8 sections cite the exact cascades each rule defends against.</li>
    <li>The <b>handoff bar</b> takes the analysis further: <b>🧩 Add patterns to blueprint</b> maps its controls onto the catalog patterns that implement them, and <b>▶ Promote mock run to Live View</b> puts the replay in the trace library.</li></ul>`
  },
  discovery: {
    t: "Discovery Lab",
    b: `<p><b>Auto-discovery of novel scenarios</b>: gap-seeded candidates scored for novelty, iterated in forgetting rounds after arXiv:2610.20563 — winners are reseeded, near-duplicates are discarded each round.</p>
    <ul><li>Run with forgetting off (compare mode) to watch novelty plateau on accumulated history.</li><li><b>⬆ Promote to draft scenario</b> turns a winner into a catalog-shaped scenario — the same fields the shipped scenarios carry — kept in your draft collection and exportable for curation. The shipped catalog is never modified.</li><li>Winners are review drafts, never catalog entries: ask Fox - Architect about one, copy it, or export JSON.</li></ul>`
  },
  bench: {
    t: "Battle Bench",
    b: `<p><b>The catalog testing itself.</b> Every one of the ${catN("scenarios", 54)} failure scenarios becomes a test case against a <b>configuration</b> — a set of controls an agent would actually deploy. Pick configurations, run the matrix, and the oracle grades whether each scenario's defenses held.</p>
    <ul><li><b>Three adapters</b> answer the same cases: <b>guardrail</b> (deterministic, instant), <b>golden</b> (replays the catalog's ${catN("traces", 55)} execution traces), and <b>live</b> (the local model, backend pinned per run and recorded in every result).</li><li><b>Configs are data</b> — derived from the Deployment Plan's option tables, with a drift check, so the bench can never quietly disagree with the app.</li><li><b>🤖 Adversary</b> attacks the configuration, not the app: ranked <b>exposure</b> (which scenarios a config leaves uncovered), a <b>mutation sweep</b> that erodes a passing baseline one dial at a time to find the load-bearing control, and a <b>red-team</b> loop where the live model writes the attack and the oracle grades it.</li><li><b>Compare models</b> runs the same cases against two models and diffs the verdicts — regressions and improvements listed explicitly.</li><li><b>💾 Save run</b> stores results locally so runs are comparable across time; the report exports as Markdown or JSON.</li></ul>
    <p class="muted small">Honest caveats: errored runs are never counted as passes, and a passing synthetic run proves the <i>controls are wired</i> — not that any agent is safe. The full analysis lives in BATTLE-ANALYSIS.md; the architecture in Design doc 09.</p>`
  },
  rogue: {
    t: "Rogue Agents",
    b: `<p><b>One compromised agent in the swarm — what stops it, how fast, and what does it cost?</b> Injects rogue agents (goal hijack, exfiltration, capability abuse, collusion, slow drift, sybil spawn) into a deterministic swarm simulation, scores three detectors (behavioural deviation, goal misalignment, collusion), and runs the automated isolation workflow against remediation SLAs.</p>
    <ul><li><b>Setup</b> picks the swarm, the injection rate, the detectors and the ten enforcement controls — or one of four presets (unmanaged, detect-only, enforce-only, guarded).</li>
    <li><b>Themes</b> reskin the swarm per domain — fintech, trading, medical advice, research landscape, vulnerability detection, drug discovery — with different roles and tool vocabulary on the same engine, so results stay comparable.</li>
    <li><b>🔴 Live fire</b> hands the attack to the model backend (fox-services by default): one call per rogue writes its tool-call campaign, the deterministic engine executes it, and anything the model never answers for stays simulated and flagged.</li><li><b>Results</b> reports detection (recall/precision/false positives), containment, blast radius, the harm ledger, and per-rogue rows you can inspect.</li><li><b>📋 Quarantine board</b> is the live ops side: confirmed detections become cases with wall-clock SLA clocks, owners and remediation steps, plus a fleet kill switch.</li><li><b>Guardrails</b> maps each control to its runtime primitive and catalog pattern, with <b>counterfactuals</b> (leave-one-out + solo) showing which controls actually carry the result.</li></ul>
    <p class="muted small">Honest caveat: a passing synthetic run proves the <i>controls are wired</i> — not that any agent is safe. Enforcement lives outside the model, in readable code.</p>`
  },
  selflearn: {
    t: "Self-Learning",
    b: `<p><b>The add-on bridge</b> to the Self-Learning Agent Lab (sibling checkout, FastAPI on :8220): continual learning, task-scoped adaptation, and the evaluation discipline that keeps them honest.</p>
    <ul><li><b>Status dot</b> probes the lab with a no-cors fetch — reachable or not, everything below works either way.</li><li><b>Concept bridge</b> maps each lab mechanism to the catalog patterns and scenarios that already cover it — click through to the record.</li><li>Run the lab with <span class="mono">./run.sh</span> or <span class="mono">docker compose up --build -d</span>, then open its dashboard from the tab.</li></ul>
    <p class="muted small">The bridge is a map, not a measurement: run the lab's 50-iteration gate for proof. The companion book is built by <span class="mono">npm run book:self</span>.</p>`
  }
};

function helpOpen(which) {
  const tab = which || currentTab;
  let body, title;
  if (tab === "glossary") {
    title = "Glossary";
    body = `<p>Load-bearing terms, in one place. Every tab's guide links here.</p>` +
      GLOSSARY.map(g => `<div class="dsec"><h4>${escHtml(g[0])}</h4><p style="margin:0">${escHtml(g[1])}</p></div>`).join("");
  } else {
    const h = HELP[tab] || HELP.overview;
    title = "Guide: " + h.t;
    const terms = (GLOSSARY.filter(g => h.b.toLowerCase().indexOf(g[0].toLowerCase()) >= 0)).slice(0, 4);
    body = h.b +
      (terms.length ? `<div class="dsec"><h4>Terms used above</h4>` +
        terms.map(g => `<p style="margin:4px 0"><b>${escHtml(g[0])}</b> — ${escHtml(g[1])}</p>`).join("") + `</div>` : "");
  }
  body += `<div class="dsec"><p class="muted small"><a href="#" onclick="helpOpen('glossary');return false;">Full glossary (${GLOSSARY.length} terms)</a> · <a href="#" onclick="closeDetail();skHelpOpen();return false;">Keyboard shortcuts</a> · <a href="#" onclick="closeDetail();onbShow(true);return false;">Replay the welcome tour</a></p></div>`;
  openDetail(title, "guide", body);
}
