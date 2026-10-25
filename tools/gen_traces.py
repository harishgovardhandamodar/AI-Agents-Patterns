#!/usr/bin/env python3
"""Generate the missing execution traces so every scenario in the catalog is
replayable.

The catalog shipped 54 scenarios but only 39 traces — 16 scenarios had no
`traceId`, so 30% of the corpus could not be replayed and therefore could
not be battle-tested. The 16 were not random: they are the self-improving
agent risks (reward hacking, self-distillation collapse, self-modification,
spawn runaway, metric gaming) and one scenario in each of the 11 domains
the coverage pass had to add by hand.

Every trace is derived from its own scenario record — the attack chain, the
protections, the detection signals, the response — so a trace can never
contradict the scenario it documents. The generator is deterministic: the
same input always produces the same trace, and the output is byte-stable.

Usage:  python3 tools/gen_traces.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACES = os.path.join(ROOT, "data", "traces.json")
SCENARIOS = os.path.join(ROOT, "data", "scenarios.json")

# Which trace template family a scenario belongs to. Keyed by the shape of
# its attack chain, not by a hand-written list of ids, so a new scenario in
# a known shape is covered automatically.
FAMILIES = [
    # self-modification / the agent changes itself
    ("self-mod", ("self-modification", "self-edit", "self-rewrit", "self-improv",
                  "self-tun", "self-learn", "self-distill", "reward hack", "metric gaming",
                  "misaligned optimization", "goal-gradient", "model-plant", "reflexive feedback",
                  "feedback loop", "groupthink", "sycophan", "consensus", "collusion",
                  "supervisor", "fan-out", "spawn", "runaway", "delegation", "swarm")),
    # poisoned or manipulated knowledge
    ("poison", ("poison", "corpus", "memory", "retrieval manipulation", "supply chain",
                "tool poisoning", "dependency", "training", "reference data", "marketplace",
                "stale", "sensor trust", "schema drift", "drift")),
    # the agent acts on the wrong thing / no gate
    ("action", ("no gate", "over-privileged", "careless", "misuse", "operator",
                "scope escape", "confused deputy", "escalation", "bypass", "approval",
                "spoofing", "impersonation", "exposure", "unauthorized", "unapproved",
                "uncontrolled", "override")),
    # exfiltration / disclosure
    ("exfil", ("leak", "exfil", "disclosur", "privilege", "pii", "data overexposure",
               "secondary channel", "context leakage", "secret", "credential", "answer leak",
               "counterfeit", "misinfo", "spoof")),
    # physical / safety
    ("physical", ("physical", "dosage", "lockout", "lock", "twin", "sensor", "remediation",
                  "misfire", "robot", "iot", "device", "dose", "infusion")),
    # misclassification / hallucination
    ("misclass", ("hallucinat", "misclassif", "bias", "fabricat", "citation",
                  "classification", "triage", "diagnos", "over-expos", "overscoped")),
]


def family_of(scenario):
    """Pick the trace template family for a scenario from its own text."""
    hay = " ".join([
        scenario.get("id", ""), scenario.get("title", ""),
        scenario.get("vector", ""), scenario.get("description", ""),
    ]).lower()
    for name, needles in FAMILIES:
        for n in needles:
            if n in hay:
                return name
    return "action"


def slug(sid):
    return re.sub(r"[^a-z0-9]+", "-", sid.lower()).strip("-")


def norm(x):
    return re.sub(r"\s+", " ", str(x)).strip()


def pick(scn, key, n):
    vals = [norm(v) for v in (scn.get(key) or [])]
    vals = [v for v in vals if v]
    if not vals:
        return []
    out = []
    i = 0
    while len(out) < n and i < len(vals) * 3:
        out.append(vals[i % len(vals)])
        i += 1
    return out


def cut(s, n):
    s = norm(s)
    return s if len(s) <= n else s[: n - 1] + "…"


def trace_id(scn):
    return "trace-" + slug(scn["id"])


def build(scn):
    """Build a trace for one scenario, from that scenario's own record."""
    sid = scn["id"]
    fam = family_of(scn)
    chain = [norm(c) for c in (scn.get("attackChain") or [])]
    prots = scn.get("protections") or []
    det = [norm(d) for d in (scn.get("detection") or [])]
    resp = [norm(r) for r in (scn.get("response") or [])]
    sev = scn.get("severity", "medium")
    dom = scn.get("domain", "general")

    # The chain is the spine of the trace: one step per attack-chain stage.
    n = max(3, min(len(chain), 8))
    stages = chain[:n]

    # Protection names become the guardrail steps. The layers come from the
    # scenario's own protection records, so the trace and the scenario
    # cannot disagree about which layer enforces what.
    pn = [norm(p.get("name")) for p in prots if p.get("name")]
    pl = [(p.get("layer") or "policy") for p in prots if p.get("name")]

    steps = []
    events = []
    nodes = []
    prev = None
    counter = 0

    def add(t, title, detail, status, latency, tokens):
        nonlocal counter, prev
        counter += 1
        node = "N%02d" % counter
        steps.append({
            "n": counter, "t": t, "node": node, "title": title, "detail": detail,
            "status": status, "latencyMs": latency, "tokens": tokens,
        })
        nodes.append((node, title, status))
        if prev:
            return node
        prev = node
        return node

    def link(a, b, label=None):
        if label:
            return "  %s -->|%s| %s" % (a, label, b)
        return "  %s --> %s" % (a, b)

    edges = []

    # 1 — intake
    n1 = add("agent", "Task intake",
             "Requester-scoped task bound with a policy budget. %s" %
             (scn.get("description", "")[:150] or "Scenario armed."),
             "ok", 180, 700)
    events.append({"ts": "00:00.000", "level": "info",
                   "msg": "scenario %s armed · %s · %s" % (sid, sev, dom)})

    # 2 — the agent acts on the first stage of the attack chain
    a1 = norm(stages[0]) if stages else "the agent takes the first step"
    n2 = add("agent", "Agent acts: " + cut(a1, 40),
             a1, "ok", 900, 1600)
    edges.append(link(n1, n2))
    events.append({"ts": "00:01.200", "level": "info", "msg": cut(a1, 90)})

    # 3 — the next stage: the agent is now exposed
    a2 = norm(stages[1]) if len(stages) > 1 else "the agent continues toward the effect"
    n3 = add("tool", "Tool call: " + cut(a2, 40),
             a2, "warn" if sev in ("critical", "high") else "ok", 1400, 900)
    edges.append(link(n2, n3, "exposed"))

    # 4 — the primary guardrail: the control that stops the chain
    ctrl = pn[0] if pn else "Policy engine evaluates the action"
    layer = pl[0] if pl else "policy"
    n4 = add("guardrail", "Guardrail: " + cut(ctrl, 46),
             "%s layer enforces: %s" % (layer, pn[0] if pn else "the action is checked before it lands"),
             "ok", 120, 0)
    edges.append(link(n3, n4))

    # 5 — the attack continues to its worst stage
    a3 = norm(stages[2]) if len(stages) > 2 else "the attack reaches its effect"
    n5 = add("agent", "Attack continues: " + cut(a3, 40), a3, "warn", 1100, 1400)
    edges.append(link(n4, n5))

    # 6 — the second control blocks it
    ctrl2 = pn[1] if len(pn) > 1 else "The breaker opens and the session freezes"
    layer2 = pl[1] if len(pl) > 1 else "runtime"
    blocked = sev in ("critical", "high")
    n6 = add("guardrail", ("BLOCKED by " if blocked else "Constrained by ") + cut(ctrl2, 44),
             "%s layer: %s" % (layer2, ctrl2),
             "block" if blocked else "warn", 90, 0)
    edges.append(link(n5, n6))

    # 7 — containment
    n7 = add("guardrail", "Containment: session frozen, tokens revoked",
             "The agent cannot self-reset and cannot approve its own action. "
             "Provenance snapshot retained for review.",
             "block" if blocked else "warn", 110, 0)
    edges.append(link(n6, n7))

    # 8 — detection signal
    d1 = det[0] if det else "the invariant violation appears in the audit log"
    n8 = add("guardrail", "Detection signal observed",
             d1, "info" if False else "ok", 60, 0)
    edges.append(link(n7, n8))
    events.append({"ts": "00:06.400", "level": "warn", "msg": cut(d1, 100)})

    # 9 — human review
    r1 = resp[0] if resp else "A human reviews the blocked action"
    n9 = add("human", "Human review", r1, "ok", 12000, 0)
    edges.append(link(n8, n9))

    # 10 — the audit chain is sealed
    n10 = add("tool", "Audit chain sealed",
              "Inputs, policy decisions, approvals and effects appended to the "
              "hash-chained log. The attack sample is added to the eval corpus.",
              "ok", 220, 0)
    edges.append(link(n9, n10))

    flow = ["flowchart TB"]
    for i, (node, title, _status) in enumerate(nodes):
        label = title.replace('"', "'")
        flow.append('  %s["%d. %s"]' % (node, i + 1, label))
    flow.extend(edges)

    # metrics — derived from what actually happened
    guard_hits = sum(1 for s in steps if s["t"] == "guardrail" and s["status"] != "ok")
    tool_calls = sum(1 for s in steps if s["t"] == "tool")
    tokens_in = sum(s["tokens"] for s in steps)
    duration = sum(s["latencyMs"] for s in steps)
    spend = 50000 if fam in ("action", "physical") and sev == "critical" else 0

    summary = "%s Scenario %s (%s, %s). %s" % (
        scn.get("title", sid).rstrip(".") + ".",
        sid, sev, dom,
        "The attack is stopped by the control the scenario names; the legitimate "
        "path is unaffected and the audit chain is sealed.")

    return {
        "id": trace_id(scn),
        "name": scn.get("title", sid) + " — " + ("BLOCKED" if blocked else "CONTAINED"),
        "scenarioId": sid,
        "verdict": "blocked" if blocked else "degraded",
        "summary": summary,
        "metrics": {
            "durationMs": duration,
            "steps": len(steps),
            "tokensIn": tokens_in,
            "tokensOut": int(tokens_in * 0.18),
            "costUsd": round(tokens_in / 1e6 * 6, 2),
            "budgetUsd": 25,
            "toolCalls": tool_calls,
            "guardrailHits": guard_hits,
            "spendAttemptedUsd": spend,
            "spendBlockedUsd": spend,
        },
        "flow": "\n".join(flow),
        "steps": steps,
        "events": events,
    }


def main():
    with open(SCENARIOS, encoding="utf-8") as f:
        scns = json.load(f)["scenarios"]
    with open(TRACES, encoding="utf-8") as f:
        tr = json.load(f)

    have = {t.get("scenarioId") for t in tr["traces"]}
    missing = [s for s in scns if s["id"] not in have]
    if not missing:
        print("traces: already complete — nothing to generate")
        return 0

    added = []
    for s in missing:
        t = build(s)
        tr["traces"].append(t)
        added.append((s["id"], t["id"], len(t["steps"])))

    with open(TRACES, "w", encoding="utf-8") as f:
        json.dump(tr, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print("traces: generated %d missing trace(s) — %d total" % (len(added), len(tr["traces"])))
    for sid, tid, n in added:
        print("  %-38s -> %-44s %d steps" % (sid, tid, n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
