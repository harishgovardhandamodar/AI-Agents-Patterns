/* guardrail.js — Guardrail Lab: intake an agent idea, analyze risk,
   generate advice, design proposals, guardrail architecture, solution,
   and a synthetic mock run with data. Collection persisted in localStorage. */
"use strict";

const GUARD_STORE = "aap.guardrail.collection.v1";
let guardState = { items: [], currentId: null };

function initGuardrail() {
  try { guardState.items = JSON.parse(localStorage.getItem(GUARD_STORE) || "[]"); } catch (e) { guardState.items = []; }
  if (!guardState.items.length) { guardState.items = [seedExample()]; persistGuard(); }
  renderGuardCollection();
  showGuardIntro();
}

function persistGuard() {
  try { localStorage.setItem(GUARD_STORE, JSON.stringify(guardState.items)); } catch (e) { showNotif("Could not persist collection (storage unavailable)"); }
}
function seedExample() {
  return analyzeRequest(
    "Think of AI agent that can spend money using company/corporate cards to complete tasks. One prompt injection may trigger $50000 purchase of unnecessary services. How do you design financial guardrails for autonomous agents?",
    "seed"
  );
}

/* ---------------- collection UI ---------------- */
function renderGuardCollection() {
  el("guardCollection").innerHTML = guardState.items.map(it => `
    <div class="g-item ${it.id === guardState.currentId ? "active" : ""}" onclick="openGuardItem('${it.id}')">
      <div class="t">${escHtml(it.title)}</div>
      <div class="m">${escHtml(it.meta.domain)} · risk ${it.meta.riskScore} · ${escHtml(it.meta.tier)} · ${it.controls.length} controls</div>
    </div>`).join("");
}
function newGuardAnalysis() {
  guardState.currentId = null;
  renderGuardCollection();
  showGuardIntro();
}
function openGuardItem(id) {
  guardState.currentId = id;
  renderGuardCollection();
  const it = guardState.items.find(x => x.id === id);
  if (it) renderGuardReport(it);
}
function deleteGuardItem(id, ev) {
  ev.stopPropagation();
  guardState.items = guardState.items.filter(x => x.id !== id);
  persistGuard(); renderGuardCollection(); newGuardAnalysis();
  showNotif("Analysis removed from collection");
}
function exportCollection() {
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), items: guardState.items }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "guardrail-analyses.json";
  a.click();
  showNotif("Collection exported");
}

function showGuardIntro() {
  el("guardMain").innerHTML = `
    <div class="g-input-box">
      <h3 style="margin:0 0 8px;font-size:13px">Describe the agent you're building (or the risk you're worried about)</h3>
      <textarea id="guardInput" placeholder="e.g. Think of an AI agent that can spend money using company cards to complete tasks. One prompt injection may trigger a $50,000 purchase of unnecessary services. How do I design financial guardrails for autonomous agents?"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <button class="btn primary" onclick="submitGuard()">⚡ Analyze & design guardrails</button>
        <span class="muted small">The analyzer detects domain, action classes, risk signals — and produces advice, proposals, architecture, and a mock run.</span>
      </div>
      <div class="g-examples">
        <span class="g-example" onclick="fillExample(0)">💳 corporate-card spend agent</span>
        <span class="g-example" onclick="fillExample(1)">💻 coding agent with prod access</span>
        <span class="g-example" onclick="fillExample(2)">📨 auto-emailing support agent</span>
        <span class="g-example" onclick="fillExample(3)">🏥 clinical triage agent</span>
        <span class="g-example" onclick="fillExample(4)">📊 autonomous trading agent</span>
      </div>
    </div>
    <div class="g-sec">
      <h3>How this lab works</h3>
      <ul>
        <li><b>Understand:</b> your request is decomposed into agent capabilities, action classes, and risk signals (injection exposure, money movement, irreversible effects, PII, scale).</li>
        <li><b>Assess:</b> a risk score is computed from the action classes × exposure, mapped to a tier.</li>
        <li><b>Design:</b> tailored guardrail proposals with pros/cons, a reference control set, and a Mermaid architecture diagram of the enforcement points.</li>
        <li><b>Simulate:</b> a synthetic mock run replays both the attack path (blocked by your new guardrails) and the legitimate path, with data.</li>
        <li><b>Collect:</b> every analysis is stored in your collection (localStorage) and exportable as JSON.</li>
      </ul>
      <p class="muted small">Analyses are generated deterministically in-browser from a rule engine — no data leaves this page.</p>
    </div>`;
}
const EXAMPLES = [
  "Think of AI agent that can spend money using company/corporate cards to complete tasks. One prompt injection may trigger $50000 purchase of unnecessary services. How do you design financial guardrails for autonomous agents?",
  "I want a coding agent with access to our production database and deploy pipeline so it can fix incidents autonomously. What guardrails does it need so one bad prompt can't wipe our data?",
  "Build an email-drafting support agent that can look up customer accounts and send replies automatically, including refunds. What can go wrong and how do I protect against it?",
  "A clinical triage agent that talks to patients, reads their records, and suggests next steps. Design the safety architecture.",
  "An autonomous trading agent that adjusts strategy based on market news it reads from the web. Guardrails?"
];
function fillExample(i) { el("guardInput").value = EXAMPLES[i]; el("guardInput").focus(); }
function submitGuard() {
  const txt = el("guardInput").value.trim();
  if (!txt) { showNotif("Describe your agent first"); return; }
  el("guardMain").innerHTML = `<div class="thinking"><div class="spinner"></div>Analyzing request · detecting action classes · matching threat patterns · designing guardrails…</div>`;
  setTimeout(() => {
    const item = analyzeRequest(txt, "user");
    guardState.items.unshift(item);
    guardState.currentId = item.id;
    persistGuard(); renderGuardCollection(); renderGuardReport(item);
    showNotif("Analysis added to collection");
  }, 900);
}

/* ---------------- rule engine ---------------- */
const SIGNALS = [
  { id: "spend", re: /\b(spend|spending|purchase|buy|order|corporate card|company card|credit card|budget|pay|payment|invoice|procure)\b/i,
    label: "Money movement (spend/purchase/payments)", weight: 24, cls: "effect.value" },
  { id: "card", re: /\b(card|cards|card-on-file|wire|ach|sepa)\b/i,
    label: "Payment instrument access (cards/wires)", weight: 18, cls: "effect.value" },
  { id: "inject", re: /\b(prompt injection|injected|injection|jailbreak|ignore (previous|prior|above) instructions|untrusted (content|input|data|web|email|page))\b/i,
    label: "Explicit prompt-injection concern", weight: 22, cls: "threat.injection" },
  { id: "web", re: /\b(web|browse|browser|scrape|scraping|search the web|internet|url|page|sites?)\b/i,
    label: "Reads untrusted external content (web/email/docs)", weight: 14, cls: "exposure.external" },
  { id: "email", re: /\b(email|send (an )?email|inbox|smtp|outbound message|notify|notification)\b/i,
    label: "Outbound communication (email/messages)", weight: 14, cls: "effect.outbound" },
  { id: "delete", re: /\b(delete|drop|wipe|destroy|remove|erase|purge|truncate|rm -rf)\b/i,
    label: "Destructive/irreversible actions", weight: 20, cls: "effect.irreversible" },
  { id: "prod", re: /\b(production|prod database|prod db|deploy|deployment|deploy pipeline|live system|ship to prod)\b/i,
    label: "Production system access", weight: 18, cls: "exposure.production" },
  { id: "pii", re: /\b(pii|phi|personal (data|information)|customer (data|records)|patient|medical|ssn|social security|card number|account details|private)\b/i,
    label: "Handles personal/sensitive data", weight: 16, cls: "data.sensitive" },
  { id: "autonomy", re: /\b(autonomous|automatically|on its own|without (human )?supervision|fully automatic|end[- ]to[- ]end)\b/i,
    label: "High autonomy (acts without per-action human review)", weight: 12, cls: "control.autonomy" },
  { id: "multiagent", re: /\b(multi[- ]?agent|team of agents|sub[- ]?agents|workers|delegate|delegation|orchestrat\w+)\b/i,
    label: "Multi-agent delegation (fan-out risk)", weight: 10, cls: "topology.multi" },
  { id: "memory", re: /\b(memory|remember|long[- ]term|learn from (past|previous)|vector store)\b/i,
    label: "Persistent memory (poisoning surface)", weight: 10, cls: "surface.memory" },
  { id: "scale", re: /\b(scale|bulk|thousands|mass|batch|at scale|every user|all users|million)\b/i,
    label: "Scale amplifier (blast radius multiplier)", weight: 10, cls: "blast.scale" },
  { id: "physical", re: /\b(lock|door|robot|vehicle|iot|sensor|smart ?home|hardware|medical device|infusion|dosage|dose)\b/i,
    label: "Physical-world effects", weight: 18, cls: "effect.physical" },
  { id: "code", re: /\b(code|coding|coding agent|execute (code|commands)|shell|terminal|run commands|script|sql|database)\b/i,
    label: "Code/command execution", weight: 14, cls: "effect.code" }
];

const DOMAIN_RULES = [
  { id: "finance", name: "Financial services", re: /\b(financ\w+|payment|spend|purchase|card|invoice|budget|trading|procure\w+|billing|refund)\b/i },
  { id: "engineering", name: "Software engineering", re: /\b(coding|code|deploy|production|database|repo|pipeline|migration|sre|devops|server)\b/i },
  { id: "support", name: "Customer support", re: /\b(support|ticket|customer|helpdesk|refund|complaint)\b/i },
  { id: "healthcare", name: "Healthcare / clinical", re: /\b(clinical|patient|health\w*|medical|triage|dosage|dose|phi)\b/i },
  { id: "legal", name: "Legal / compliance", re: /\b(legal|law|contract|compliance|regulat|privileg|discovery)\b/i },
  { id: "data", name: "Data / research", re: /\b(research|analy\w+|report|data scien|citation|source)\b/i }
];

function analyzeRequest(text, origin) {
  const signals = SIGNALS.filter(s => s.re.test(text)).map(s => ({ ...s, evidence: (text.match(s.re) || [""])[0] }));
  let risk = 8; // baseline
  signals.forEach(s => risk += s.weight);
  if (/\$\s?\d|usd|\d{2,}\s?(dollars|k\b)/i.test(text)) risk += 8; // concrete money figure
  const tier = risk >= 70 ? "CRITICAL" : risk >= 45 ? "HIGH" : risk >= 25 ? "MEDIUM" : "LOW";
  const domain = (DOMAIN_RULES.find(d => d.re.test(text)) || { name: "General-purpose", id: "general" });
  const cls = new Set(signals.map(s => s.cls));

  const title = makeTitle(text);
  const controls = pickControls(cls, signals);
  const proposals = buildProposals(domain, cls, risk);
  const advice = buildAdvice(cls, signals, risk);
  const mockRun = buildMockRun(text, cls, signals, tier);

  return {
    id: "ga-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    origin, createdAt: new Date().toISOString(), request: text, title,
    meta: { domain: domain.name, domainId: domain.id, riskScore: Math.min(99, risk), tier },
    signals, classes: [...cls], advice, controls, proposals,
    architecture: buildArchitecture(cls, controls),
    mockRun,
    rollout: buildRollout(tier, controls.length)
  };
}

function makeTitle(text) {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.match(/agent (?:that|which|who)?\s*([^.,;]{5,60})/i);
  if (m) return "Guardrails: agent that " + m[1].trim().toLowerCase();
  return "Guardrails: " + (t.length > 64 ? t.slice(0, 61) + "…" : t);
}

function pickControls(cls, signals) {
  const C = [];
  const has = x => cls.has(x);
  // ALWAYS
  C.push({ name: "Runtime budget caps (steps/tokens/dollars)", layer: "runtime", mode: "hard-stop", why: "Every agent needs a ceiling the model cannot raise. Set by caller+policy, enforced by runtime." });
  C.push({ name: "Immutable audit trail (hash-chained)", layer: "observability", mode: "always-on", why: "You cannot review or learn from what you cannot reconstruct." });
  if (has("exposure.external") || has("threat.injection"))
    C.push({ name: "Injection shield on all untrusted content", layer: "context", mode: "block/quarantine", why: "Web/email/doc content is data, never instructions. Strip hidden text; wrap in untrusted delimiters; re-assert policy after." });
  if (has("effect.value") || has("effect.outbound") || has("effect.irreversible") || has("effect.physical") || has("effect.code")) {
    C.push({ name: "Deterministic policy engine at the tool layer", layer: "policy", mode: "default-deny", why: "Allow/deny rules in runtime middleware — independent of the model, so injection can't negotiate with them." });
    C.push({ name: "Approval gates for high-impact classes", layer: "process", mode: "require-human", why: "Irreversible or high-value effects stop for a human with a full evidence pack. Keyed on EFFECT, not tool name — no bypass via alternate paths." });
  }
  if (has("effect.value")) {
    C.push({ name: "Per-transaction + rolling-window spend caps", layer: "policy", mode: "hard-stop", why: "Catches both single large charges and threshold-splitting. Aggregate by requester/vendor/category." });
    C.push({ name: "Vendor/payee allowlist + first-time cooling-off", layer: "policy", mode: "require-approval", why: "New payees and urgency framing are risk signals that raise scrutiny, never lower it." });
    C.push({ name: "Dual control above threshold", layer: "process", mode: "2-human-approval", why: "The acting agent can never be an approver; two distinct authenticated humans (or human+policy engine)." });
    C.push({ name: "In-depth caps outside the agent runtime", layer: "infrastructure", mode: "in-depth", why: "Processor/broker/pipeline-level limits enforce the same bounds even if every software layer above fails — the last line that cannot be talked out of them." });
  }
  return C;
}

function buildAdvice(cls, signals, risk) {
  const a = [];
  const has = x => cls.has(x);
  a.push("<b>Separate the model from the money.</b> The LLM should <i>propose</i> actions; a deterministic runtime <i>executes</i> them. Guardrails that live only in the prompt are suggestions — an injection erases them. Enforcement belongs at the tool layer where the model isn't in the room.");
  if (has("effect.value"))
    a.push("<b>Assume the agent will be told to spend money it shouldn't.</b> Web pages, emails, tickets, and even tool error strings are all instruction channels. Design as if every one of them says 'buy $50k of something'. The spend guard is what makes that harmless.");
  if (has("threat.injection") || has("exposure.external"))
    a.push("<b>Defense in depth beats a perfect shield.</b> No injection classifier is 100%. Layer 1 (shield) can fail — layer 2 (least privilege: no standing card credentials) limits blast radius, layer 3 (spend caps) catches the residue, layer 4 (dual control) is the final human backstop. Test by deliberately failing each layer.");
  if (has("autonomy"))
    a.push("<b>Autonomy is a dial, not a switch.</b> Let the agent run fully autonomous below conservative thresholds (e.g., ≤$500, known vendor) and degrade to approval-required above them. Most tasks complete in the autonomous band; the risky tail is gated.");
  if (has("effect.irreversible") || has("effect.physical"))
    a.push("<b>Design for reversibility first.</b> Queue-and-delay beats execute-now for anything irreversible. A 15-minute cancel window defeats most injection payloads because the attacker's ask is urgent by nature.");
  if (has("data.sensitive"))
    a.push("<b>Never let sensitive data enter the model context.</b> Tokenize at ingress (the model sees 'card ending 4242', not the PAN). Every context entry is a leak surface — provider logs, transcripts, memory. Minimize at the source, not at the output filter.");
  if (has("blast.scale"))
    a.push("<b>Scale changes the math.</b> At 10k items/day, a 0.1% error rate is 10 harmful actions daily. Ramp with canaries, cap absolute side-effect volume (not just percentages), and auto-rollback on SLO breach.");
  if (has("surface.memory"))
    a.push("<b>Treat memory as an attack surface.</b> Anything that persists (memories, RAG corpus, scratchpads) can be planted today and auto-retrieved forever. Gate writes, attach provenance+TTL, and treat retrieved memory strictly as untrusted data.");
  if (has("topology.multi"))
    a.push("<b>Children inherit the parent's budget and nothing more.</b> Enforce delegation depth/width caps and meter the whole descendant tree — runaway fan-out is the #1 multi-agent cost failure.");
  a.push("<b>Make refusal a first-class outcome.</b> An agent that says 'I can't do that without approval' is working correctly. Measure abstain rates; investigate both spikes and lulls.");
  a.push("<b>Rehearse the incident before it happens.</b> Kill switch tested weekly, revocation automated, blast-radius query ready. The first hour of an agent incident is decided by how much you prepared, not how smart your model is.");
  return a;
}

function buildProposals(domain, cls, risk) {
  const has = x => cls.has(x);
  const props = [];
  // Proposal A: baseline
  props.push({
    tier: "BASELINE",
    recommended: risk < 45,
    title: "Guardrail gateway (single enforcement point)",
    desc: "Route every tool call through one gateway that runs: identity check → deterministic policy → budget meter → allow/deny/approve. The agent talks only to the gateway; tools are unreachable directly.",
    pros: ["One place to audit, test, and tune", "Injection-proof by construction (model can't reach tools)", "Easy to extend: new rules, no agent changes"],
    cons: ["Gateway becomes a critical path component (needs HA)", "Initial integration work per tool"]
  });
  // Proposal B
  if (has("effect.value") || has("effect.irreversible") || has("effect.outbound") || has("effect.physical")) {
    props.push({
      tier: "HARDENED",
      recommended: risk >= 45,
      title: "Two-key execution (agent proposes, humans dispose)",
      desc: "Agent builds the full action package (what, why, provenance of every input, simulated diff) and submits it. Nothing executes until a second, independent authority approves: a human (above thresholds) or the policy engine (below). Approvals are bound to the exact action hash and expire.",
      pros: ["Stops the entire class of 'agent did it under attacker influence'", "Evidence pack makes review fast (<1 min) and informed", "Approval-bound-to-hash prevents TOCTOU swaps"],
      cons: ["Adds latency above thresholds", "Requires staffed review coverage (tier + alerting to avoid fatigue)"]
    });
  }
  // Proposal C
  if (has("exposure.external") || has("threat.injection")) {
    props.push({
      tier: "SUPPLY-CHAIN",
      recommended: risk >= 45,
      title: "Zero-trust context pipeline",
      desc: "Every context item carries a provenance tag and trust tier (user=2, internal=3, web=1). Instructions are only honored from tier-3 pinned sources; lower tiers are rendered as quoted data. Content is normalized (hidden-text stripped), scanned, and wrapped in untrusted delimiters. Actions require corroboration across ≥2 independent tier-2+ sources.",
      pros: ["Neutralizes indirect injection (the web page, the email, the tool error)", "Provenance makes post-incident forensics trivial", "Works for web, email, RAG, memory, and tool outputs uniformly"],
      cons: ["Trust-tier registry needs ownership and maintenance", "Some legitimate low-trust workflows need explicit exceptions"]
    });
  }
  // Proposal D
  if (has("effect.code") || has("exposure.production")) {
    props.push({
      tier: "INFRASTRUCTURE",
      recommended: risk >= 45,
      title: "Capability-scoped sandboxes + effect-layer gates",
      desc: "Agent code runs in per-task microVMs: default-deny egress, no ambient secrets, read-only rootfs. Production changes flow only through human-owned pipelines; the agent has no prod credentials at all. Destructive statements (DROP, rm, truncate) are statically flagged and gated regardless of author.",
      pros: ["Prod access is impossible by construction, not by policy text", "Sandbox blast radius bounded even on total compromise", "Gates at the effect layer can't be bypassed via a different tool"],
      cons: ["Some autonomous remediation use-cases need a curated allowlist", "Sandbox fleet has ops cost"]
    });
  }
  return props;
}

function buildArchitecture(cls, controls) {
  const has = x => cls.has(x);
  const lines = ["flowchart TB"];
  lines.push('  H["👤 Human requester<br/>(identity + task budget)"] --> AG["🤖 Agent runtime<br/>(LLM · read-only context)"]');
  lines.push('  AG -->|propose action| GW{"🛡 Guardrail gateway<br/>identity → policy → budget → approval"}');
  lines.push('  GW -->|"deny"| BLK["⛔ Block + alert + audit"]');
  lines.push('  GW -->|"require approval"| APR["👥 Approval queue<br/>(evidence pack · dual control)"]');
  lines.push('  GW -->|"allow"| TOOL["🔧 Tool / spend / send<br/>(capability-scoped)"]');
  if (has("effect.value")) {
    lines.push('  TOOL --> SPEND["💳 Spend guard<br/>per-txn cap · rolling window · vendor allowlist"]');
    lines.push('  SPEND --> PROC["🏦 Processor-level hard cap<br/>(in-depth, outside agent)"]');
  }
  if (has("exposure.external") || has("threat.injection")) {
    lines.push('  EXT["🌐 Web / email / docs<br/>(untrusted)"] --> SH["🧪 Injection shield<br/>normalize · strip · scan · wrap as data"]');
    lines.push('  SH --> AG');
  }
  if (has("data.sensitive")) {
    lines.push('  DATA["🗄 Sensitive data"] --> VAULT["🔐 Vault / tokenizer<br/>(minimize before context)"]');
    lines.push('  VAULT -->|"last4 / tokens only"| AG');
  }
  lines.push('  GW -.-> AUD[("📜 Hash-chained audit<br/>replay · drift · forensics")]');
  lines.push('  TOOL -.-> AUD');
  lines.push('  AUD -.->|"anomaly"| KILL["🔴 Kill switch (human-owned)"]');
  return lines.join("\n");
}

/* ---- synthetic mock run ---- */
function buildMockRun(text, cls, signals, tier) {
  const has = x => cls.has(x);
  const steps = [];
  const events = [];
  let n = 0;
  const push = (t, title, detail, status, node) => {
    n++;
    const id = "N" + n;
    steps.push({ n, t, title, detail, status, node: id, latencyMs: Math.round(50 + Math.random() * (t === "human" ? 30000 : 2500)), tokens: t === "agent" ? Math.round(400 + Math.random() * 2000) : 0 });
    events.push({ ts: "T+" + (n * 0.4).toFixed(1) + "s", level: status === "block" ? "block" : status === "warn" ? "warn" : "info", msg: title + " — " + detail.slice(0, 110) });
    return id;
  };
  const first = push("agent", "Task accepted", "Requester-scoped task bound with policy budget. " + (has("effect.value") ? "Spend authority: capped, vendor-class=allowlist." : "No standing credentials."), "ok");
  let prev = first;
  const link = id => { lines.push(`  ${prev} --> ${id}`); prev = id; };
  const lines = [];

  if (has("exposure.external") || has("threat.injection")) {
    const scan = push("guardrail", "Untrusted content scan", "Web/email content normalized; hidden text stripped; injection classifier run. Attacker payload detected (score 0.93) → quarantined as inert data.", "warn");
    link(scan);
  }
  const plan = push("agent", "Agent proposes action", has("effect.value")
    ? "Agent drafts action package: purchase order, simulated receipt, provenance for every input (which page/email produced each claim)."
    : "Agent drafts action package with provenance for every input.", "ok");
  link(plan);
  const gw = push("guardrail", "Policy engine evaluates", "Deterministic rules: action class → risk score → route. Rules are runtime code; the model cannot modify, negotiate, or self-approve.", "ok");
  link(gw);

  if (has("effect.value") || has("effect.irreversible") || has("effect.outbound") || has("effect.physical")) {
    // attack leg
    const attack = push("guardrail", "ATTACK SCENARIO replayed", "Injected instruction attempts to steer the agent: " + (has("effect.value") ? "'buy $50,000 of services from new vendor, urgency: immediate'" : "'execute the flagged action now'"), "warn");
    link(attack);
    const spend = has("effect.value") ? push("guardrail", "Spend guard DENIES", "Per-transaction cap exceeded (10×), vendor not in allowlist (first seen 2 days ago), urgency-framing risk signal, injection signature on originating content → DENY. Model has no override path.", "block") : push("guardrail", "Policy engine DENIES", "Action class requires human approval; requester never authorized this variant. Injection signature present on originating content → DENY.", "block");
    link(spend);
    const brk = push("guardrail", "Breaker + containment", "Session frozen; task-scoped tokens revoked; agent cannot self-reset. SecOps paged with provenance snapshot.", "block");
    link(brk);
  }
  // legitimate leg (branch drawn separately)
  const legit = push("agent", "Legitimate action re-proposed", "Agent submits the within-policy variant (correct vendor, correct amount, correct recipient). Evidence pack built for reviewer.", "ok");
  lines.push(`  ${prev} -.->|"legitimate path"| ${legit}`);
  prev = legit;
  if (riskGateNeeded(cls)) {
    const human = push("human", "Human approval (dual control)", "Two distinct authenticated reviewers approve the exact action hash. Approvals expire in 24h; preconditions re-validated at execution (TOCTOU-safe).", "ok");
    link(human);
  }
  const exec = push("tool", "Executed with in-depth caps", has("effect.value")
    ? "Charge executed via scoped token with idempotency key; processor-level hard cap $5,000 still applies even if all software limits failed. Money moved: legitimate amount only."
    : "Action executed via capability-scoped tool with idempotency key; full audit entry written.", "ok");
  link(exec);
  const done = push("guardrail", "Audit sealed + monitoring", "Hash-chained log complete: inputs, policy decisions, approvals, execution. Drift metrics updated. Attack sample added to eval corpus.", "ok");
  link(done);

  const flow = ["flowchart TB", ...lines].join("\n");
  return { verdict: "blocked-then-approved", flow, steps, events,
    data: {
      attackAttempted: has("effect.value") ? "$50,000 to unvetted vendor 'AcmeCloud-Urgent'" : "unauthorized flagged action",
      attackOutcome: "DENIED at policy gateway — $0 / no effect",
      legitimateOutcome: has("effect.value") ? "approved + executed within caps" : "approved + executed",
      timeToContain: "2.8s", approvals: riskGateNeeded(cls) ? 2 : 0,
      tokensSpent: steps.reduce((s, x) => s + x.tokens, 0)
    } };
}
function riskGateNeeded(cls) {
  return ["effect.value", "effect.irreversible", "effect.physical", "effect.outbound"].some(c => cls.has(c));
}

function buildRollout(tier, nControls) {
  return [
    "<b>Week 1–2 — Instrument first.</b> Stand up the audit trail and budgets before any autonomy. You cannot tune guardrails you cannot measure.",
    "<b>Week 3–4 — Shadow mode.</b> Agent proposes, humans execute manually. Collect the action distribution: what would it have done? Set thresholds from real data, not guesses.",
    "<b>Week 5–6 — Autonomy below thresholds.</b> Enable auto-execution only in the low-risk band. Canary 1% with full guardrails; verify block/allow rates match shadow predictions.",
    "<b>Week 7+ — Continuous red-teaming.</b> Every incident and novel attack becomes an eval case within 48h. Quarterly external red-team. Hold-out attack sets so tuning doesn't overfit.",
    `<b>Success criteria:</b> 100% of ${nControls} reference controls deployed and tested · zero ungated paths to ${tier === "CRITICAL" || tier === "HIGH" ? "high-impact" : "medium-impact"} effects in BAS probes · approval-fatigue metrics in band · kill-switch drill &lt; 5 min.`
  ];
}

/* ---------------- report rendering ---------------- */
function renderGuardReport(it) {
  const m = it.meta;
  const sevColor = m.tier === "CRITICAL" ? "var(--red)" : m.tier === "HIGH" ? "var(--orange)" : m.tier === "MEDIUM" ? "var(--accent)" : "var(--green)";
  const badge = it.proposals.some(p => p.recommended) ? "" : "";
  el("guardMain").innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <h2 style="margin:0;font-size:16px">${escHtml(it.title)}</h2>
      <span class="g-badge" style="color:${sevColor};border-color:${sevColor}">${m.tier} RISK</span>
      <div style="flex:1"></div>
      <span class="muted small mono">${escHtml(it.meta.domain)} · ${escHtml(it.createdAt.slice(0, 16).replace("T", " "))}</span>
      <button class="btn" onclick="deleteGuardItem('${it.id}', event)">🗑</button>
    </div>

    <div class="g-input-box" style="margin-bottom:14px">
      <div class="muted small" style="margin-bottom:4px">Your request</div>
      <div style="font-size:12.5px">${escHtml(it.request)}</div>
    </div>

    <div class="g-sec">
      <h3>1 · Risk assessment</h3>
      <div class="risk-meter">
        <div class="risk-score" style="color:${sevColor}">${m.riskScore}<span style="font-size:14px;color:var(--text3)">/100</span></div>
        <div class="risk-track"><div class="risk-fill" style="width:${m.riskScore}%"></div></div>
      </div>
      <p>Detected action classes: <span class="mono">${it.classes.map(escHtml).join(" · ") || "none beyond baseline"}</span></p>
      ${it.signals.length ? `<div>${it.signals.map(s => `<div class="sig-row"><span>${escHtml(s.label)}</span><span class="ev">+${s.weight} · “${escHtml(s.evidence)}”</span></div>`).join("")}</div>` : `<p class="muted small">No strong risk signals beyond baseline.</p>`}
    </div>

    <div class="g-sec">
      <h3>2 · Advice (how to think about it)</h3>
      <ul>${it.advice.map(a => `<li>${a}</li>`).join("")}</ul>
    </div>

    <div class="g-sec">
      <h3>3 · Design proposals</h3>
      ${it.proposals.map(p => `
        <div class="proposal">
          <div class="pt">${escHtml(p.title)} <span class="g-badge">${escHtml(p.tier)}</span> ${p.recommended ? '<span class="g-badge rec">recommended for this risk level</span>' : ""}</div>
          <div class="pd">${escHtml(p.desc)}</div>
          <div class="pc"><b>✓ ${p.pros.map(escHtml).join(" &nbsp;·&nbsp; ")}</b><br><i>△ ${p.cons.map(escHtml).join(" &nbsp;·&nbsp; ")}</i></div>
        </div>`).join("")}
    </div>

    <div class="g-sec">
      <h3>4 · Guardrail architecture (enforcement points)</h3>
      ${diagramHtml(it.architecture, "architecture")}
    </div>

    <div class="g-sec">
      <h3>5 · Reference control set (${it.controls.length} controls)</h3>
      <table class="tbl">
        <tr><th>Control</th><th>Layer</th><th>Mode</th><th>Why</th></tr>
        ${it.controls.map(c => `<tr><td>${escHtml(c.name)}</td><td><span class="chip">${escHtml(c.layer)}</span></td><td class="mono small">${escHtml(c.mode)}</td><td>${escHtml(c.why)}</td></tr>`).join("")}
      </table>
    </div>

    <div class="g-sec">
      <h3>6 · Mock run with data</h3>
      <p class="muted small">Synthetic replay of the <b>attack path</b> (blocked by the design above) and the <b>legitimate path</b> (approved and executed). Verdict: <b>${escHtml(it.mockRun.verdict)}</b></p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px">
        <div class="gauge"><div class="k">Attack outcome</div><div class="v st-block" style="font-size:12px">${escHtml(it.mockRun.data.attackOutcome)}</div></div>
        <div class="gauge"><div class="k">Attack target</div><div class="v" style="font-size:12px">${escHtml(it.mockRun.data.attackAttempted)}</div></div>
        <div class="gauge"><div class="k">Time to contain</div><div class="v" style="font-size:12px">${escHtml(it.mockRun.data.timeToContain)}</div></div>
        <div class="gauge"><div class="k">Human approvals</div><div class="v" style="font-size:12px">${it.mockRun.data.approvals} · legit path</div></div>
        <div class="gauge"><div class="k">Tokens spent</div><div class="v" style="font-size:12px">${it.mockRun.data.tokensSpent.toLocaleString()}</div></div>
        <div class="gauge"><div class="k">Legit outcome</div><div class="v st-ok" style="font-size:12px">${escHtml(it.mockRun.data.legitimateOutcome)}</div></div>
      </div>
      ${diagramHtml(it.mockRun.flow, "mock-run")}
      <table class="tbl">
        <tr><th>#</th><th>Stage</th><th>Status</th><th>Detail</th></tr>
        ${it.mockRun.steps.map(s => `<tr><td class="mono">${s.n}</td><td>${escHtml(s.title)}<br><span class="muted small">${s.t}</span></td><td class="st-${s.status}">${s.status}</td><td>${escHtml(s.detail)}</td></tr>`).join("")}
      </table>
      <h4 style="margin:14px 0 6px;font-size:11px;color:var(--text3);text-transform:uppercase">Event log</h4>
      <div class="log-box">${it.mockRun.events.map(e => `<div class="log-line lvl-${e.level}"><span class="ts">${escHtml(e.ts)}</span><span class="msg">${escHtml(e.msg)}</span></div>`).join("")}</div>
    </div>

    <div class="g-sec">
      <h3>7 · Rollout plan</h3>
      <ul>${it.rollout.map(r => `<li>${r}</li>`).join("")}</ul>
    </div>`;
  mmRenderAll(el("guardMain"));
  el("guardMain").scrollTop = 0;
}
tabLoaders.guard = () => {};
