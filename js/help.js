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
    b: `<p>This tab answers <b>“where do I stand?”</b> — catalog size, severity split, domain coverage, and a Next-step pointer that looks at your actual planner, blueprint and copilot state.</p>
    <ul><li>Start here after any break: the <b>Next</b> box tells you the single most useful thing to do.</li>
    <li><b>Pins you make</b> in any catalog drawer collect in the Working set below for review and export.</li></ul>
    <p class="muted small">Tip: Alt+1…− jumps between tabs; ? shows every shortcut.</p>`
  },
  copilot: {
    t: "Architect Copilot",
    b: `<p>Ask in plain language. Answers are <b>grounded in this catalog</b> — every claim cites the pattern, scenario or cascade it came from, via the local model with a deterministic fallback when no backend answers.</p>
    <ul><li>Scope answers with the <b>Ground answers in</b> checkboxes.</li><li><b>Grounding</b> shows the exact context sent to the model — audit what it was allowed to know.</li><li>The top-bar pill shows which backend answered: Fox-Services, axiom, or the local fallback.</li></ul>
    <p class="muted small">Tip: “Ask the Copilot” buttons inside catalog drawers pre-fill a grounded question about that item.</p>`
  },
  patterns: {
    t: "Patterns",
    b: `<p>107 reusable <b>design patterns</b> — the building blocks blueprints are made of. Each card shows failure modes and protections at a glance; the drawer has the full control flow.</p>
    <ul><li>Filter by category, domain, or “has diagram / has failures”.</li><li><b>Least-protected-first sort</b> surfaces the patterns most worth hardening.</li><li>☰ switches to a dense list when you are scanning, not reading.</li></ul>
    <p class="muted small">Tip: “Add to blueprint” in any drawer drops the pattern straight onto your canvas.</p>`
  },
  scenarios: {
    t: "Scenarios",
    b: `<p>38 concrete <b>failure stories</b>: attack chain, protections that stop it, detection signals, incident response. Scenarios are what the threat model matches your blueprint against.</p>
    <ul><li>Sort by least-protected to find the scenarios your controls don't cover yet.</li><li>“▶ mock run” replays the scenario as a trace in Live View.</li><li>“Add linked patterns” builds a blueprint from the scenario's defences.</li></ul>`
  },
  cascades: {
    t: "Cascades",
    b: `<p>175 ways small faults <b>propagate and amplify</b>, in four classes: <b>inherent</b> (one part fails alone), <b>emergent</b> (only the interaction fails), <b>derived</b> (A must lead to B), <b>cascading</b> (crosses a boundary and amplifies).</p>
    <ul><li>The Mitigation planner de-duplicates every control across all cascades, ranked by leverage — fix the top rows first.</li><li>Assign owners and status; it persists locally and exports to CSV.</li><li>The propagation simulator shows how a trigger fans out step by step.</li></ul>
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
    <ul><li>Work top to bottom; each section unlocks from the same answers, so changing an answer re-grounds everything.</li><li>Acknowledge risks to record that a human saw them; export the ADR for your repo.</li></ul>
    <p class="muted small">Tip: the recommended stack can be materialised as a blueprint in one step (section 2).</p>`
  },
  blueprint: {
    t: "Blueprints",
    b: `<p>Compose your <b>reference architecture</b> from stages and controls. Coverage, cost, latency, risk and the threat-model <b>exposure index</b> recompute live.</p>
    <ul><li>Templates are starting points, not answers — the warnings row tells you what's structurally wrong.</li><li><b>Compare</b> pits your canvas against any template or saved blueprint before you restore it.</li><li>Ctrl+Z undoes removes, clears, template swaps and library deletes.</li></ul>`
  },
  live: {
    t: "Live View",
    b: `<p><b>Replayable execution traces</b> — watch an agent run step by step: inputs, tool calls, outputs. The player controls work like a media player.</p>
    <ul><li>Open any trace, then scrub, pause and inspect each step's payload.</li><li>Scenarios with a “mock run” chip link straight here.</li></ul>`
  },
  design: {
    t: "Design & Architecture",
    b: `<p>The <b>seven design documents</b> behind the app: system context, UML, control flow, the financial guardrail architecture, data model, threat model and the architect value map.</p>
    <ul><li>Read 07 first if you want the “why” — it explains the cascade taxonomy the whole app is built on.</li><li>⤢ enlarges any diagram with zoom and pan.</li></ul>`
  },
  guard: {
    t: "Guardrail Lab",
    b: `<p>Turn catalog knowledge into <b>enforceable rules</b>: analyse a request, get cascade-aware control recommendations, save them to a collection, export as JSON.</p>
    <ul><li>Every analysis is stored locally and re-openable from the collection rail.</li><li>The report's 8 sections cite the exact cascades each rule defends against.</li></ul>`
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
