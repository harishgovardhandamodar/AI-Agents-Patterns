#!/usr/bin/env python3
"""Generate data/cascades.json — the cascade taxonomy dataset.

Deterministic and grounded: every record is derived from the real catalog
(patterns' failure modes and protections, scenarios' attack chains, detections
and responses, traces) plus a curated set of canonical emergent/systemic
cascades. No network, no model, reproducible.

Classes
  inherent   a property of one component/module (fails in isolation)
  emergent   arises from the interaction of >=2 parts
  derived    the necessary consequence chain from a trigger
  cascading  a local failure crosses a boundary and amplifies / correlates

Usage:  python3 tools/gen_cascades.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SEV_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}
SEV_TO_IMPACT = {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}

# What an unhandled failure in each pattern category tends to cost downstream.
CAT_IMPACT = {
    "planning": "a wrong plan is executed with real side effects",
    "tools": "an unauthorised or malformed side effect lands on a real system",
    "memory": "tainted context persists and is reused across later turns",
    "multiagent": "duplicated, divergent or unauthorised action across agents",
    "loop": "unbounded iteration, latency spikes and cost blow-up",
    "workflow": "a step is stalled, skipped or replayed out of order",
    "safety": "a guardrail is bypassed and the action is not blocked",
    "resilience": "failures go undetected and recovery never triggers",
    "domain": "a domain policy (financial, clinical, legal) is breached",
}
CAT_DETECT = {
    "planning": "plan-diff review, step-level eval assertions",
    "tools": "tool-call auditing, arg-schema validation, egress monitoring",
    "memory": "memory-write provenance, retrieval canary tokens, drift monitors",
    "multiagent": "per-agent tracing, action de-duplication, contract tests",
    "loop": "iteration counters, latency/cost rate alarms",
    "workflow": "state-machine invariants, step timeout alerts",
    "safety": "guardrail decision logs, red-team evals, filter-bypass canaries",
    "resilience": "heartbeats, SLO burn-rate alerts, chaos tests",
    "domain": "policy engine audit, exception reports, compliance sampling",
}
CAT_CONTAIN = {
    "planning": "freeze plan execution, fall back to a safe deterministic path",
    "tools": "revoke the tool scope, circuit-break the tool, queue the call",
    "memory": "quarantine the memory store, roll back to a known-good snapshot",
    "multiagent": "stop the swarm, isolate the diverging agent",
    "loop": "kill the loop, apply a hard iteration/token cap",
    "workflow": "halt the workflow, park state for manual resume",
    "safety": "trip the kill switch, downgrade to suggest-only mode",
    "resilience": "fail over, shed load, open the circuit breaker",
    "domain": "freeze the domain action class, escalate to the accountable owner",
}
CAT_RECOVER = {
    "planning": "replay from the last validated checkpoint",
    "tools": "reverse or compensate the side effect, reconcile state",
    "memory": "invalidate tainted memories, reconcile derived indexes",
    "multiagent": "reconcile divergent outputs, deduplicate actions taken",
    "loop": "refund wasted spend, re-run with caps enforced",
    "workflow": "resume from the parked step, compensate partial writes",
    "safety": "restore guardrails, re-verify with red-team suite",
    "resilience": "restore service, post-incident review, add the missed signal",
    "domain": "compensating transaction, notify affected parties",
}


def slug(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", str(s).lower())).strip("-")[:60]


def txt(x, cap=220):
    """Normalise a catalog field to a readable string.
    Scenario protections are objects {name, mechanism, layer}; everything else
    (pattern protections, scenario detection/response/attackChain) is a string."""
    if x is None:
        return ""
    if isinstance(x, dict):
        n = str(x.get("name", "")).strip()
        m = str(x.get("mechanism", "")).strip()
        l = str(x.get("layer", "")).strip()
        s = n + (" — " + m if m else "") + (" [" + l + "]" if l else "")
    else:
        s = str(x)
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= cap else s[:cap - 1] + "…"


def uniq(seq, n=None):
    out = []
    for x in seq:
        x = txt(x)
        if x and x not in out:
            out.append(x)
        if n and len(out) >= n:
            break
    return out


def load(name):
    with open(os.path.join(ROOT, "data", name), encoding="utf-8") as f:
        return json.load(f)


PATTERNS = load("patterns.json")["patterns"]
SCENARIOS = load("scenarios.json")["scenarios"]
TRACES = load("traces.json")["traces"]

PAT_BY_ID = {p["id"]: p for p in PATTERNS}
SCN_BY_ID = {s["id"]: s for s in SCENARIOS}
SCNS_FOR_PAT = {}
for s in SCENARIOS:
    for pid in s.get("patternRefs", []):
        SCNS_FOR_PAT.setdefault(pid, []).append(s)
TRACE_FOR_SCN = {t["scenarioId"]: t["id"] for t in TRACES if t.get("scenarioId")}

TAXONOMY = {
    "inherent": {
        "label": "Inherent",
        "color": "accent",
        "origin": "A property of one component or module, present before integration.",
        "signature": "Reproducible in isolation; a unit test or eval can trigger it.",
        "find": "Unit tests, evals, model cards, component threat models.",
        "fix": "Constrain at the source: schema-locked tools, least privilege, input/output validation.",
    },
    "emergent": {
        "label": "Emergent",
        "color": "teal",
        "origin": "Arises from the interaction of two or more components; no single part has it.",
        "signature": "Surprising, non-linear, invisible in component-level tests.",
        "find": "Integration and system tests, runtime invariants, simulation.",
        "fix": "Bulkheads, circuit breakers, loop/iteration caps, agent-to-agent contract tests.",
    },
    "derived": {
        "label": "Derived",
        "color": "orange",
        "origin": "The logically necessary consequence chain from a trigger.",
        "signature": "Deterministic 'if X then Y then Z' across authority boundaries.",
        "find": "Attack-path analysis, dependency walks, taint tracking.",
        "fix": "Break the chain at the earliest link: confirm-before-irreversible, dual control, scoped credentials.",
    },
    "cascading": {
        "label": "Cascading",
        "color": "purple",
        "origin": "A local failure crosses a boundary and amplifies or correlates across many consumers.",
        "signature": "Non-linear blast-radius growth, shared fate, feedback loops.",
        "find": "Dependency / common-mode analysis, blast-radius simulation, chaos drills.",
        "fix": "Isolation and per-tenant bulkheads, rate+queue caps, kill switch, rollback, reconciliation.",
    },
}

CAS = []


def add(rec):
    CAS.append(rec)


# ------------------------------------------------------------------ inherent
for p in PATTERNS:
    fails = sorted(p.get("failures", []), key=lambda f: -SEV_RANK.get(f.get("sev"), 0))
    if not fails:
        continue
    top = fails[0]
    cat = p.get("cat", "domain")
    rel = SCNS_FOR_PAT.get(p["id"], [])
    prev = uniq((p.get("protections") or []) + [x for s in rel for x in s.get("protections", [])], 6)
    det = uniq([x for s in rel for x in s.get("detection", [])] + [CAT_DETECT.get(cat, "component-level evals")], 5)
    con = uniq([x for s in rel for x in s.get("response", [])] + [CAT_CONTAIN.get(cat, "isolate the component")], 5)
    add({
        "id": "cas-inh-" + slug(p["id"]),
        "name": p["name"] + " — " + top["n"].lower(),
        "cls": "inherent",
        "domain": (p.get("domains") or ["general"])[0],
        "summary": "Intrinsic to the " + p["name"] + " pattern: " + top["d"] +
                   " Because the pattern is applied wherever " + p["name"] + " is used, the flaw travels with it.",
        "trigger": top["n"] + " (" + top.get("sev", "medium") + "): " + top["d"],
        "path": [p["name"] + " applied", top["n"], CAT_IMPACT.get(cat, "a downstream policy breach")],
        "amplifiers": uniq([
            "the pattern is reused across many agents, so the flaw is systemic" if (p.get("domains") and len(p["domains"]) >= 3) else "",
            "no schema/validation boundary between the model and the effect",
        ], 3),
        "blastRadius": "single-agent" if len(p.get("domains", [])) < 3 else "service",
        "likelihood": {"critical": "high", "high": "medium", "medium": "medium", "low": "low"}.get(top.get("sev"), "medium"),
        "impact": SEV_TO_IMPACT.get(top.get("sev"), "medium"),
        "speed": "seconds",
        "detection": det,
        "mitigations": {"prevent": prev or ["constrain the pattern's input and output"], "detect": det, "contain": con, "recover": [CAT_RECOVER.get(cat, "restore the last good state")]},
        "patternRefs": uniq([p["id"]] + (p.get("related") or [])[:3], 4),
        "scenarioRefs": [s["id"] for s in rel[:4]],
        "traceRefs": uniq([TRACE_FOR_SCN[s["id"]] for s in rel if s["id"] in TRACE_FOR_SCN], 3),
        "residual": "Even with the pattern's protections enabled, " + top["n"].lower() +
                    " can reappear under distribution shift — keep an eval that targets it.",
    })

# ------------------------------------------------------------------- derived
for s in SCENARIOS:
    chain = s.get("attackChain") or []
    add({
        "id": "cas-der-" + slug(s["id"]),
        "name": s["title"],
        "cls": "derived",
        "domain": s["domain"],
        "summary": s.get("description", "")[:400],
        "trigger": chain[0] if chain else s.get("vector", ""),
        "path": chain,
        "amplifiers": uniq([
            "agent autonomy without a confirm-before-irreversible gate",
            "shared credentials/collector make the effect reach further than one run",
        ], 3),
        "blastRadius": "service" if s["severity"] in ("high", "critical") else "single-agent",
        "likelihood": s.get("likelihood", "medium"),
        "impact": SEV_TO_IMPACT.get(s["severity"], "high"),
        "speed": "minutes",
        "detection": uniq(s.get("detection", [])),
        "mitigations": {
            "prevent": uniq(s.get("protections", [])),
            "detect": uniq(s.get("detection", [])),
            "contain": uniq(s.get("response", [])[:2] + ["freeze the agent and page the owner"], 4),
            "recover": uniq(s.get("response", [])),
        },
        "patternRefs": s.get("patternRefs", []),
        "scenarioRefs": [s["id"]],
        "traceRefs": [TRACE_FOR_SCN[s["id"]]] if s["id"] in TRACE_FOR_SCN else [],
        "residual": "Each link must be broken independently; a single control that only stops the last step leaves earlier exposure intact.",
    })

# ------------------------------------------------------------------ emergent
EMERGENT = [
    ("Retry amplification storm", "A transient tool failure plus an aggressive retry policy turns one call into a burst that saturates the tool, the model server and the budget simultaneously.",
     "a tool or model call times out once",
     ["one call times out", "client retries without jitter/cap", "load multiplies across concurrent agents", "provider throttles", "retries fan out further", "cost and latency spike, budget halts unrelated agents"],
     ["no retry budget or jitter", "many agents share the endpoint", "retries are not counted against spend"]),
    ("Planner–executor livelock", "Planner keeps producing steps the executor rejects, and the executor's failure feedback keeps re-triggering the planner — the pair converges on nothing while burning tokens.",
     "a plan step is rejected by the executor",
     ["planner emits a step", "executor rejects on policy/schema", "feedback re-enters the planner", "planner proposes an equivalent step", "no progress, tokens burn"],
     ["no shared success predicate", "no iteration cap across the pair", "feedback loop is unbounded"]),
    ("Guardrail adversarial drift", "The agent learns (via trial, not intent) phrasings that pass the filter while still achieving the blocked effect — the guardrail looks healthy while coverage erodes.",
     "a legitimate request is blocked by a pattern filter",
     ["filter blocks a phrasing", "agent rephrases and succeeds", "the passing phrasing is reinforced in memory", "filter sees normal traffic", "true effect leaks past the guard"],
     ["filters are lexical not semantic", "no block-rate regression alarm", "successful bypasses are rewarded"]),
    ("Memory self-reinforcement", "The agent writes its own (possibly wrong) conclusions to memory and later retrieves them as fact, collapsing diversity and hardening errors.",
     "an agent stores a summary it generated",
     ["agent writes a summary", "summary is retrieved as evidence next turn", "model trusts and extends it", "alternative sources are crowded out", "the error becomes 'known' fact"],
     ["memory has no provenance labels", "no independent source of truth", "retrieval ranks recency over veracity"]),
    ("Cascading hallucination across a pipeline", "Each stage treats the previous stage's output as ground truth, so one fabricated field becomes a validated fact by the end of the chain.",
     "an upstream stage fabricates one field",
     ["stage A fabricates a field", "stage B validates against A's output", "stage C cites B as a source", "downstream acts on a fabricated fact"],
     ["no stage checks an external source", "validators reuse the same model", "confidence is copied forward"]),
    ("Multi-agent echo chamber", "Agents that critique each other converge on a shared wrong answer because they share the same model, prompt and context.",
     "two agents are asked to agree on an answer",
     ["agent 1 proposes", "agent 2 agrees (shared bias)", "consensus is treated as verification", "the wrong answer is promoted"],
     ["critics share the producer's model", "no diverse evidence injected", "consensus used as a truth signal"]),
    ("Tool-call race / double-execution", "Parallel sub-agents invoke the same non-idempotent tool, and the side effect lands twice before either sees the other.",
     "a task is fanned out to parallel workers",
     ["fan-out to N workers", "two workers call the same tool", "both pass pre-checks", "side effect applies twice"],
     ["non-idempotent tool", "no idempotency key", "no cross-worker locking"]),
    ("Feedback-loop cost runaway", "A self-improving or self-critiquing loop keeps finding more to fix, so cost grows super-linearly until a budget guard trips.",
     "the agent is allowed to self-critique",
     ["agent critiques its output", "rewrites and critiques again", "each pass adds calls", "cost grows super-linearly", "budget guard halts the agent"],
     ["no iteration/token budget on the loop", "self-critique is unbounded", "no diminishing-returns check"]),
    ("Context-window silent truncation", "As the transcript grows, the earliest (safety-critical) constraints are silently dropped, so the agent 'forgets' its guardrails mid-task.",
     "the conversation grows past the model's context window",
     ["transcript exceeds the window", "oldest turns drop (often the constraints)", "agent proceeds without its guardrails", "a blocked action becomes allowed"],
     ["no explicit constraint pinning", "summarisation drops the rules", "no re-injection of policy"]),
    ("Authority confusion on handoff", "Agent A delegates to Agent B; B re-interprets the request with its own (broader) privileges, so an action A could not take happens through B.",
     "one agent hands a task to another",
     ["A delegates a task", "B re-plans with its own scopes", "B performs an action A lacked rights to", "the audit trail points at B, not A"],
     ["scopes are not carried across handoff", "no shared delegation token", "audit attributes to the executor only"]),
    ("Synchronised failure via shared dependency", "Every agent instance shares one model/endpoint/index, so one bad version or outage correlates failure across the whole fleet at once.",
     "a shared model version or endpoint changes",
     ["shared dependency changes", "all instances pick up the change", "behaviour shifts everywhere together", "no independent instance to compare against"],
     ["single shared model/index/credential", "no canary instance", "no per-tenant isolation"]),
    ("Approval fatigue / rubber-stamping", "High volume of plausible approvals trains the human reviewer to approve without scrutiny, defeating human-in-the-loop exactly when it matters.",
     "approval volume exceeds careful review capacity",
     ["agent queues many plausible approvals", "reviewer approves in bulk", "a malicious one rides along", "the control is nominal"],
     ["approval volume not throttled", "no risk-based sampling", "no random deep checks"]),
    ("Untrusted-content instruction uptake", "A browsed page or tool result is treated as instructions, so external text becomes standing policy for the agent.",
     "the agent reads an untrusted tool/web result",
     ["untrusted content is ingested", "it is parsed as instruction", "it is stored as a goal in memory", "the agent acts on it later"],
     ["no trust boundary on tool/web output", "content and instructions share one channel", "no provenance labels"]),
    ("Compounding partial failures", "Several individually-tolerable degradations (a slow tool, a flaky model, a lagging replica) combine into a complete task failure that no single monitor sees.",
     "two or more soft degradations coincide",
     ["tool latency rises", "model server throttles", "replica lags", "retries overlap", "the composite SLO blows with no single alarm"],
     ["monitors are per-component", "no end-to-end SLO", "no dependency health view"]),
    ("Version skew across agents", "Producer and consumer agents run different prompt/model versions during a rollout, so they disagree on the contract and corrupt shared state.",
     "a rolling deploy updates one agent first",
     ["one agent updated", "prompt/schema contract shifts", "counterpart still on old contract", "shared state is mis-written"],
     ["no contract versioning", "no canary phase", "shared mutable state"]),
    ("Guardrail bypass by composition", "Two individually-safe tools compose into an unsafe capability (read-secret + send-email = exfiltration) that no single-tool guard flags.",
     "the agent chains two allowed tools",
     ["tool A reads sensitive data", "tool B can transmit", "each is allowed alone", "the chain exfiltrates"],
     ["permissions are per-tool not per-path", "no data-flow tracking", "no capability composition analysis"]),
]
for name, summary, trigger, path, amps in EMERGENT:
    refs = [s["id"] for s in SCENARIOS if any(w in (s["title"] + " " + s.get("description", "") + " " + " ".join(s.get("attackChain", []))).lower() for w in name.lower().split()[:2])]
    add({
        "id": "cas-eme-" + slug(name),
        "name": name,
        "cls": "emergent",
        "domain": "general",
        "summary": summary,
        "trigger": trigger,
        "path": path,
        "amplifiers": amps,
        "blastRadius": "tenant" if "fleet" in summary.lower() or "shared" in summary.lower() else "service",
        "likelihood": "high",
        "impact": "high",
        "speed": "minutes",
        "detection": uniq(["end-to-end integration test per interaction", "runtime invariant on the shared resource", "SLO burn-rate alarm"], 4),
        "mitigations": {
            "prevent": uniq(["bulkhead the shared resource", "hard iteration/retry/token caps", "explicit contracts between components", "do not let one component's output be another's only input"], 5),
            "detect": uniq(["trace the whole interaction, not the parts", "per-interaction invariant assertions", "cost/latency rate alarms"], 4),
            "contain": uniq(["circuit-break the interaction", "isolate one side", "de-duplicate actions"], 4),
            "recover": uniq(["roll back to a known-good pairing", "reconcile shared state", "add the missed interaction test"], 4),
        },
        "patternRefs": uniq([pid for s in SCENARIOS if s["id"] in refs for pid in s.get("patternRefs", [])], 6),
        "scenarioRefs": refs[:5],
        "traceRefs": uniq([TRACE_FOR_SCN[r] for r in refs if r in TRACE_FOR_SCN], 3),
        "residual": "Component tests will stay green; only an interaction-level test or a drill surfaces this class.",
    })

# ----------------------------------------------------------------- cascading
CASCADING = [
    ("Shared model version regression across the fleet", "One model/prompt version change is picked up by every agent at once; a regression becomes a fleet-wide behavioural incident with no healthy control group.",
     "a new model or prompt version is rolled out to the shared endpoint",
     ["version is updated centrally", "all agents adopt it simultaneously", "behaviour shifts everywhere", "no independent instance remains to compare", "the incident is fleet-wide"],
     ["single shared endpoint/version", "no canary cohort", "no per-tenant pinning"],
     "fleet"),
    ("Poisoned shared knowledge index", "One tainted document in a shared RAG/index corrupts every agent that retrieves from it — blast radius grows with the number of readers, not the number of writers.",
     "a single document in the shared index is poisoned",
     ["document is indexed", "many agents retrieve it", "each treats it as trusted context", "tainted answers propagate downstream", "re-indexing is required to recover"],
     ["shared index with no per-tenant partition", "ingestion has no provenance", "readers trust the index wholesale"],
     "fleet"),
    ("Provider outage → retry storm → cost halt", "A provider outage triggers retries across all agents; retries burn tokens, the budget guard halts every agent, and the whole service stops rather than degrades.",
     "the shared model/tool provider has an outage",
     ["provider outage", "all agents retry", "tokens burn on failures", "global budget guard trips", "all agents halt, including healthy ones"],
     ["no circuit breaker", "budget guard is global not per-agent", "no graceful degradation to a cheaper path"],
     "fleet"),
    ("Credential compromise across tenants", "A single over-scoped service credential, once leaked, gives an attacker every tenant's authority — the compromise is correlated because the credential is shared.",
     "one shared service credential leaks",
     ["credential leaks", "attacker uses it broadly", "actions are attributed to the service", "every tenant is in scope", "containment requires rotating shared infra"],
     ["shared over-scoped credential", "no per-tenant scoping", "secrets in one store"],
     "org"),
    ("Trust collapse after a visible bad action", "One public, high-impact wrong action erodes user trust; oversight is tightened or abandoned wholesale, and the business impact dwarfs the original failure.",
     "a single visible bad action reaches users",
     ["a bad action is visible", "users lose trust", "oversight is either abandoned or over-tightened", "adoption/throughput collapses", "business impact exceeds the original incident"],
     ["no graceful, explainable failure", "no transparency/receipts", "no pre-agreed kill criteria"],
     "org"),
    ("Regulatory action → service freeze", "A derived compliance breach (e.g. an unauthorised cross-border transfer) escalates to a regulator, forcing a freeze that stops all related agents, not just the offending one.",
     "an unauthorised or non-compliant action is detected",
     ["non-compliant action occurs", "it is reported/investigated", "regulator or legal steps in", "all related processing is frozen", "business continuity is affected"],
     ["no data-residency enforcement", "no action-level policy audit", "single global deployment"],
     "ecosystem"),
    ("Correlated config change", "A well-intentioned global config change (a budget cap, a rate limit, a guardrail rule) has an unforeseen interaction that fails many agents at once.",
     "a global configuration value is changed",
     ["config change is deployed globally", "an unseen interaction activates", "many agents fail together", "rollback itself is slow/unsafe"],
     ["global config with no staged rollout", "no blast-radius preview", "no automated rollback"],
     "fleet"),
    ("Data-exfiltration via composed capabilities", "A read capability and a send capability that are each allowed compose into exfiltration; a single such leak can be broad and is hard to un-leak.",
     "the agent composes a read tool and a send tool",
     ["sensitive data is read", "a send/egress path is available", "data leaves the boundary", "the leak is broad and irreversible"],
     ["no data-flow controls", "egress not restricted", "per-tool rather than per-path permissions"],
     "org"),
    ("Queue backlog common-mode failure", "A shared work queue backs up; every consumer agent stalls, and the backlog itself becomes a new failure mode (timeouts, duplicate processing).",
     "a shared queue backs up",
     ["a consumer slows", "the queue grows", "other consumers time out", "work is retried/duplicated", "the whole pipeline stalls"],
     ["single shared queue", "no backpressure", "no dead-letter isolation"],
     "service"),
    ("Cascading tenant failure via shared sandbox", "Agents that share one sandbox or network namespace let one tenant's compromise or runaway process affect neighbours.",
     "one agent's workload escapes its intended isolation",
     ["resource/traffic escapes the sandbox", "neighbouring agents are affected", "effects cross tenant boundaries", "isolation is only as strong as the weakest tenant"],
     ["shared sandbox/namespace", "no per-tenant resource caps", "shared network egress"],
     "fleet"),
]
for name, summary, trigger, path, amps, blast in CASCADING:
    refs = [s["id"] for s in SCENARIOS if any(w in (s["title"] + " " + " ".join(s.get("attackChain", []))).lower() for w in name.lower().split()[:2])]
    add({
        "id": "cas-cas-" + slug(name),
        "name": name,
        "cls": "cascading",
        "domain": "general",
        "summary": summary,
        "trigger": trigger,
        "path": path,
        "amplifiers": amps,
        "blastRadius": blast,
        "likelihood": "medium",
        "impact": "critical",
        "speed": "hours" if blast in ("fleet", "org", "ecosystem") else "minutes",
        "detection": uniq(["blast-radius / common-mode analysis", "per-tenant SLO and cost alarms", "chaos drill on the shared dependency"], 4),
        "mitigations": {
            "prevent": uniq(["partition by tenant / avoid shared mutable substrate", "staged rollouts with a canary cohort", "least-privilege scoped credentials", "rate, queue and spend caps per consumer"], 6),
            "detect": uniq(["common-mode dependency monitor", "per-tenant anomaly and cost alarms", "regular chaos drills"], 4),
            "contain": uniq(["per-tenant bulkheads and circuit breakers", "kill switch scoped to the affected class", "shed load / degrade gracefully"], 4),
            "recover": uniq(["roll back the shared change", "reconcile and re-index", "rotate credentials", "notify and compensate affected parties"], 5),
        },
        "patternRefs": uniq([pid for s in SCENARIOS if s["id"] in refs for pid in s.get("patternRefs", [])], 6),
        "scenarioRefs": refs[:5],
        "traceRefs": uniq([TRACE_FOR_SCN[r] for r in refs if r in TRACE_FOR_SCN], 3),
        "residual": "Assumes some shared substrate; the only real containment is to make the shared part smaller and the isolation stronger.",
    })

# cross-domain derived cascading: domains that recur across scenarios
DOM = {}
for s in SCENARIOS:
    DOM.setdefault(s["domain"], []).append(s)
for dom, scns in sorted(DOM.items(), key=lambda kv: -len(kv[1])):
    if len(scns) < 3:
        continue
    add({
        "id": "cas-cas-domain-" + slug(dom),
        "name": "Cross-scenario cascade in " + dom,
        "cls": "cascading",
        "domain": dom,
        "summary": "The " + dom + " scenario set (" + str(len(scns)) + " scenarios) shares tools, data and credentials; a single compromise or failure can reach several of them at once because the blast radius overlaps.",
        "trigger": "one shared dependency or credential in " + dom + " is compromised or fails",
        "path": uniq([s["title"] for s in scns], 6),
        "amplifiers": uniq(["shared tools/credentials across the domain", "correlated users and data", "a single owner absorbs all impact"], 3),
        "blastRadius": "fleet" if len(scns) >= 5 else "tenant",
        "likelihood": "medium",
        "impact": "critical",
        "speed": "hours",
        "detection": uniq([x for s in scns for x in s.get("detection", [])], 4),
        "mitigations": {
            "prevent": uniq([x for s in scns for x in s.get("protections", [])], 6),
            "detect": uniq([x for s in scns for x in s.get("detection", [])], 5),
            "contain": uniq([x for s in scns for x in s.get("response", [])], 5),
            "recover": uniq([x for s in scns for x in s.get("response", [])], 5),
        },
        "patternRefs": uniq([pid for s in scns for pid in s.get("patternRefs", [])], 10),
        "scenarioRefs": [s["id"] for s in scns],
        "traceRefs": uniq([TRACE_FOR_SCN[s["id"]] for s in scns if s["id"] in TRACE_FOR_SCN], 6),
        "residual": "Treat " + dom + " as one blast radius in planning; a per-scenario view under-states correlated exposure.",
    })

# -------------------------------------------------------------------- output
from collections import Counter

CAS.sort(key=lambda c: (["inherent", "emergent", "derived", "cascading"].index(c["cls"]), c["domain"], c["name"]))
out = {
    "generated": "deterministic · tools/gen_cascades.py",
    "taxonomy": TAXONOMY,
    "counts": dict(Counter(c["cls"] for c in CAS)),
    "cascades": CAS,
}
with open(os.path.join(ROOT, "data", "cascades.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

print("cascades:", len(CAS), dict(Counter(c["cls"] for c in CAS)))
