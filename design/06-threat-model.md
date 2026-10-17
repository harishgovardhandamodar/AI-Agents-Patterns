# Threat Model & Protections Map

A STRIDE-style view of what agents (as described in this catalog) get wrong, plus the defense-in-depth map that ties scenarios to the layers that stop them.

## Asset & actor model

```mermaid
flowchart LR
  ACTOR["Adversary<br/>controls some content the agent reads<br/>(web page, email, ticket, doc, tool error)"] -->|"instruction injection"| AGENT["Agent<br/>(spends · sends · deletes · deploys · decides)"]
  AGENT -->|"effect"| ASSET["Assets:<br/>money · data · production systems<br/>brand · safety · other humans"]
```

The single most important modeling decision: **the adversary does not need to compromise the agent.** Any content channel the agent consumes is an attack surface. This is why "input sanitization" is never the last line.

## STRIDE applied to agents

```mermaid
flowchart TB
  subgraph S["Spoofing"]
    S1["Prompt-injected 'policy' text impersonates a trusted instruction"]
    S2["Lookalike vendor / payee"]
    S3["Impersonated agent identity to downstream systems"]
  end
  subgraph T2["Tampering"]
    T21["Poisoned RAG corpus / memory"]
    T22["Tool description rewritten (MCP poisoning)"]
    T23["Injected tool error strings"]
  end
  subgraph R["Repudiation"]
    R1["No audit trail → cannot prove what the agent did"]
    R2["Agent 'forgets' (context truncated) mid-task"]
  end
  subgraph I["Information Disclosure"]
    I1["PII/PHI echoed to wrong recipient"]
    I2["Secrets in context → provider logs / transcripts / memory"]
    I3["Exfil via egress, webhooks, gists, DNS"]
  end
  subgraph D["Denial of Service"]
    D1["Infinite loop / retry storm"]
    D2["Budget exhaustion denies real work"]
    D3["Provider rate ban from runaway"]
  end
  subgraph E["Elevation of Privilege"]
    E1["Injection steers a permitted tool to a forbidden effect"]
    E2["Worker/handoff inherits broad credentials"]
    E3["Self-approval of own spend"]
  end
```

## Attack tree: the $50k card purchase

```mermaid
flowchart TB
  GOAL["🎯 Transfer $50,000 to attacker"]
  GOAL --> P1["Control agent's proposed action"]
  GOAL --> P2["Bypass spend controls"]
  GOAL --> P3["Bypass human approval"]

  P1 --> A1["Inject instruction via web/email/doc"]
  P1 --> A2["Poison RAG / memory with 'policy'"]
  P1 --> A3["Compromise tool description"]

  P2 --> B1["Raise budget via prompt (FAILS: runtime-bound)"]
  P2 --> B2["Split under thresholds (CAUGHT: rolling windows)"]
  P2 --> B3["Use unguarded tool path (CAUGHT: effect-layer gates)"]
  P2 --> B4["Lookalike vendor (CAUGHT: registry + cooling-off)"]

  P3 --> C1["Self-approve (IMPOSSIBLE: agents not approvers)"]
  P3 --> C2["Fatigue a human (CAUGHT: fatigue metrics + evidence packs)"]
  P3 --> C3["Deepfake voice approval (CAUGHT: authenticated channels only)"]
  P3 --> C4["Rubber-stamp via volume (CAUGHT: tiered escalation)"]

  classDef caught fill:#1f2d1f,stroke:#3fb950,color:#3fb950
  class B1,B2,B3,B4,C1,C2,C3,C4 caught
```

Every leaf marked *caught* is a place the design deliberately fails safe. The attack tree is the design's own regression suite: add a test for each node.

## Defense-in-depth map

Which scenario class each layer stops, and what happens when a layer fails:

```mermaid
flowchart TB
  ATK["Attack begins"] --> L1{"L1 injection shield<br/>strips/quarantines"}
  L1 -->|"content blocked"| WIN1["✅ contained"]
  L1 -->|"residue (0.1%)"| L2{"L2 least privilege<br/>no standing authority"}
  L2 -->|"effect impossible"| WIN2["✅ contained"]
  L2 -->|"authorized-but-steered"| L3{"L3 runtime policy<br/>deterministic caps"}
  L3 -->|"denied"| WIN3["✅ contained + alerted"]
  L3 -->|"within policy"| L4{"L4 human process<br/>dual control"}
  L4 -->|"rejected"| WIN4["✅ contained + learned"]
  L4 -->|"approved (deceived)"| L5{"L5 processor caps<br/>in-depth"}
  L5 -->|"hard limit"| WIN5["✅ bounded loss"]
  L5 -->|"passes all"| LOSS["❌ residual risk<br/>→ insurance + monitoring"]
```

The last box matters: **a design that claims zero residual risk is lying.** Name the residual, bound it (processor caps limit worst-case loss), and monitor for it (drift + anomaly detection).

## Protections registry (by layer)

| Layer | Representative controls | Scenarios primarily stopped |
|---|---|---|
| `context` | Injection shield, data/instruction separation, pinned policy block | Hidden web injection, tool-error injection, memory poisoning |
| `identity` | Scoped short-lived tokens, workload identity, caller propagation | Confused deputy, agent impersonation, standing-authority abuse |
| `policy` | Deterministic allow/deny, spend caps, vendor registry, effect-layer gates | $50k purchase, threshold splitting, escalation bypass |
| `process` | Approval gates, dual control, cooling-off, review queues | Approval fatigue, deepfake approval, payee-change fraud |
| `infrastructure` | Sandboxes, default-deny egress, metadata-service block | Sandbox escape, code execution, secrets exfil |
| `data` | Tokenization/vault, trust tiers, row-level tenancy scoping | PII echo, cross-tenant leak, RAG poisoning |
| `dlp` | Output shields, secret scanning, destination reputation | Card/PII egress, secret-in-log, exfil via artifacts |
| `observability` | Hash-chained audit, drift monitoring, spend dashboards | Silent drift, budget runaway, undetected abuse (detection, not prevention) |

## Governance checklist (pre-deployment)

```mermaid
flowchart LR
  A["1. Enumerate effects<br/>(read · write · send · pay · delete · deploy)"] --> B["2. Classify by reversibility<br/>+ blast radius"]
  B --> C["3. Assign an enforcement layer<br/>per effect (none may be 'prompt only')"]
  C --> D["4. Prove each layer fails safe<br/>(fault injection per layer)"]
  D --> E["5. Rehearse incidents<br/>kill switch · revocation · blast-radius query"]
  E --> F["6. Ship in shadow → canary → ramp<br/>with continuous red-team"]
  F --> G{"Red-team finds<br/>an ungated path?"}
  G -->|yes| C
  G -->|no| H["7. Monitor drift; add every<br/>incident to the eval corpus"]
```

## Residual-risk register (worked, for the card agent)

| Residual risk | Bound applied | Monitoring |
|---|---|---|
| Novel injection defeats classifier | Least privilege means no card in context; worst case is a within-policy charge | Block-rate canary probes; quarterly external red-team |
| Human approves a cleverly disguised charge | Processor hard cap limits single loss; evidence packs raise detection odds | Override sampling + canary (seeded malicious) approvals |
| Insider abuse of agent access | Effect-layer caps + dual control apply equally to insiders | Insider-risk monitoring on agent usage patterns |
| Third-party model/provider incident | Model pinned + eval-gated upgrades; no sensitive data in context | Behavioral drift alerts; shadow-parity checks |

Each row names an owner, a bound, and a monitor — the minimum bar for accepting residual risk rather than ignoring it.
