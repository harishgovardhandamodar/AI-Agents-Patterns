# Financial Guardrail Architecture

The flagship worked example: an agent that can spend money on corporate cards to complete tasks, and the layered design that turns "one prompt injection triggers a $50,000 purchase" into a logged, contained, 3-second non-event.

## The thesis

> Prompt-level guardrails are *suggestions*. An injection edits the suggestions. **Money controls must live where the model isn't: deterministic middleware, human process, and the payment processor itself.**

Defense in depth — each layer assumes the layers above it will eventually fail:

```mermaid
flowchart TB
  subgraph L1["Layer 1 — Context"]
    SH["Injection shield<br/>web/email/tool-output normalized, scanned,<br/>wrapped as untrusted data"]
  end
  subgraph L2["Layer 2 — Authority"]
    LSP["Least privilege<br/>scoped payment tokens · no PAN in context<br/>task-class spend authority only"]
  end
  subgraph L3["Layer 3 — Runtime policy (deterministic)"]
    SG["Spend guard<br/>per-txn cap · rolling windows<br/>vendor allowlist · velocity · anomaly score"]
  end
  subgraph L4["Layer 4 — Human process"]
    DC["Dual control ≥ threshold<br/>2 authenticated humans · action-hash-bound<br/>24h expiry · re-validate at execution"]
  end
  subgraph L5["Layer 5 — Infrastructure"]
    PROC["Processor-level hard caps<br/>per-txn/day limits on the card itself<br/>kill + revocation API"]
  end
  L1 -->|"residue"| L2
  L2 -->|"authorized proposal"| L3
  L3 -->|"above threshold"| L4
  L4 -->|"approved"| L5
  L3 -.->|"anomaly: new vendor + 12.5× budget + injection signal"| STOP["HARD STOP → breaker → SecOps"]
  L5 -.->|"independent cap"| STOP
```

## Transaction screening sequence

```mermaid
sequenceDiagram
  autonumber
  participant A as Agent
  participant G as Spend guard
  participant V as Vendor registry
  participant W as Rolling-window ledger
  participant H as Dual-control queue
  participant P as Card processor

  A->>G: propose charge(cardToken, $50000, "AcmeCloud-Urgent")
  G->>G: amount > per-txn cap ($5,000)? → FAIL
  G->>G: amount > task budget ($4,000)? → FAIL (12.5×)
  G->>V: vendor registered + tenure?
  V-->>G: unknown (first seen 4 days ago) → FAIL
  G->>W: aggregate by requester/vendor/category/24h
  W-->>G: no history → anomaly flag
  G->>G: injection signature on originating content → FAIL
  G-->>A: DENY (reason codes + policy version)
  G->>G: trip breaker · revoke task token · freeze session
  G-->>H: escalation with full evidence pack
  Note over H: reviewers see provenance chain,<br/>diff, risk signals — not a one-liner
  H-->>G: REJECT
  G-->>P: revoke card token
  Note over A,P: money moved: $0 · contained in 2.8s<br/>everything hash-chained in the audit trail
```

## Spend authority model (class view)

```mermaid
classDiagram
  class SpendPolicy {
    +float perTransactionCap
    +float taskBudget
    +float rolling24hCap
    +float rolling7dCap
    +VendorClass vendorClass
    +int approvalsRequired
    +evaluate(Charge) Verdict
  }
  class Charge {
    +float amount
    +string vendorId
    +string idempotencyKey
    +Provenance provenance
  }
  class Verdict {
    +ALLOW | DENY | REVIEW
    +string[] reasons
    +string policyVersion
  }
  class DualControl {
    +Approver[] approvals
    +string actionHash
    +DateTime expiresAt
    +bool satisfied()
    +revalidatePreconditions()
  }
  class ProcessorCap {
    +float maxPerTransaction
    +float maxPerDay
    +revoke(token)
  }
  SpendPolicy --> Verdict : produce
  SpendPolicy --> Charge : evaluate
  DualControl --> Charge : binds to (actionHash)
  Verdict --> DualControl : REVIEW routes here
  DualControl --> ProcessorCap : approved charge executes under
```

Two rules the class model encodes:

1. **The agent holds no `SpendPolicy` reference it can mutate.** Policy is bound at task creation by requester + policy engine; the runtime treats it as immutable.
2. **`DualControl.approvalsRequired` is satisfiable only by authenticated human identities** — `Agent` is not in the approver type hierarchy, so self-approval is a type error, not a policy reminder.

## Charge lifecycle (state machine)

```mermaid
stateDiagram-v2
  [*] --> Drafted: agent proposes
  Drafted --> Screened: submit
  Screened --> Approved: policy ALLOW (below threshold)
  Screened --> PendingApproval: REVIEW (threshold / anomaly)
  Screened --> Denied: policy DENY
  PendingApproval --> Approved: 2/2 humans, hash-bound
  PendingApproval --> Denied: reject / expiry / precondition fail
  Approved --> Executing: processor call (idem key)
  Executing --> Settled: receipt
  Executing --> Failed: processor error
  Failed --> Drafted: retry (same idempotency key — no double charge)
  Denied --> [*]
  Settled --> [*]
  note right of PendingApproval
    Preconditions re-validated here at
    EXECUTION time, not approval time
    (defeats TOCTOU swaps)
  end note
```

## Splitting / velocity detection

The single-transaction cap is the *easy* part. Threshold-splitting (nine $950 charges instead of one $8,500) is caught by aggregate windows:

```mermaid
flowchart LR
  C1["charge $950"] --> AGG["Aggregate by:<br/>requester · vendor · category · cost-center"]
  C2["charge $950"] --> AGG
  C3["charge $950"] --> AGG
  AGG --> W24{"24h rolling total<br/>vs declared budget"}
  W24 -->|"< 100%"| OK["pass"]
  W24 -->|"≥ 100%"| HALT["halt category + escalate"]
  AGG --> STRUCT{"N sub-threshold<br/>in window?"}
  STRUCT -->|yes| REVIEW["treat as one large request:<br/>retro-apply approvals"]
```

## Card data handling

The card number never enters the model's context. Ingress tokenization replaces it; the model sees brand, last-4, and expiry. This single decision neutralizes the entire "context leak to provider logs / transcripts / memory" family of breaches — and it is enforced at the data layer, so even a fully-compromised model has nothing to leak.

| Concern | Enforcement point | Mechanism |
|---|---|---|
| Injection tries to raise budget | Runtime | Budget bound at task creation; model has no reference |
| New/lookalike vendor | Vendor registry | KYC-style verification; first-time cooling-off |
| Splitting under thresholds | Rolling ledger | Aggregate windows + structuring detector |
| Duplicate charge on retry | Processor + runtime | Idempotency keys, replay-safe resume |
| Approval theater | Process | Dual control, hash-bound approvals, fatigue metrics |
| Total software failure | Processor | Hard caps below software caps; revocation API |
