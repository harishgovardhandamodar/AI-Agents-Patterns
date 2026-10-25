# Architect Value Map & Cascade Taxonomy

This document is the design rationale for the architect-facing upgrade: what the
dashboard knew, what an architect needs, and the four-class cascade model that
connects them. It is the reference behind the **Fox - Architect**, **Cascades**,
**Coverage**, **Planner** and **Discovery Lab** tabs.

## 1. From catalog to advisory system

```mermaid
flowchart LR
  subgraph TODAY["Today — reference"]
    P["107 patterns"]
    S["54 scenarios"]
    T["55 traces"]
    C["191 cascades"]
    D["9 design docs"]
  end
  subgraph ASK["Architect's four questions"]
    Q1["What do I need to build?"]
    Q2["What am I missing?"]
    Q3["How far does failure spread?"]
    Q4["What do I do, in what order?"]
  end
  subgraph NEW["New — advisory"]
    CP["Fox - Architect<br/>(grounded, local model)"]
    CV["Coverage &amp; gap analysis"]
    CA["Cascade explorer + simulator"]
    PL["Planner: readiness, stack,<br/>rollout, risk register"]
    BP["Blueprint + threat model"]
    RP["Exportable review"]
  end
  P --> CP
  S --> CP
  T --> CP
  C --> CP
  D --> CP
  P --> CV
  S --> CV
  C --> CV
  CP --> Q1
  CP --> Q4
  CV --> Q2
  CA --> Q3
  CA --> PL
  CV --> PL
  PL --> BP
  BP --> RP
  PL --> RP
  CP --> RP
```

## 2. The four cascade classes

Cascades are not one thing. They have different origins, so they are found by
different methods and fixed by different controls.

```mermaid
flowchart TB
  subgraph CLASSES["Cascade classes"]
    INH["<b>Inherent</b><br/>property of one part<br/>fails in isolation"]
    EME["<b>Emergent</b><br/>from the interaction<br/>of 2+ parts"]
    DER["<b>Derived</b><br/>necessary consequence<br/>chain from a trigger"]
    CAS["<b>Cascading</b><br/>local failure crosses a<br/>boundary and amplifies"]
  end
  INH -->|"trusted downstream"| DER
  EME -->|"hardens into a path"| DER
  DER -->|"crosses a boundary"| CAS
  CAS -->|"feedback + shared fate"| CAS
```

```mermaid
flowchart LR
  subgraph ORIGIN["Origin"]
    A["one component"]
    B["interaction topology"]
    C["causal chain"]
    D["shared substrate + feedback"]
  end
  subgraph FIND["How you find it"]
    A --> A2["unit tests · evals · model cards"]
    B --> B2["integration tests · invariants · simulation"]
    C --> C2["attack-path analysis · taint tracking"]
    D --> D2["dependency / common-mode analysis · chaos drills"]
  end
  subgraph FIX["How you fix it"]
    A2 --> A3["schema-locked tools · least privilege · validation"]
    B2 --> B3["bulkheads · circuit breakers · iteration caps"]
    C2 --> C3["confirm-before-irreversible · dual control · scoped creds"]
    D2 --> D3["isolation · rate+queue caps · kill switch · rollback"]
  end
```

## 3. Mitigation must cover four control functions

Every cascade gets controls across all four NIST-style functions; a plan that
only *prevents* is a plan that cannot survive a detection miss.

```mermaid
flowchart LR
  TR["Trigger"] --> PREV["<b>Prevent</b><br/>reduce likelihood"]
  PREV --> DET["<b>Detect</b><br/>reduce time-to-know"]
  DET --> CON["<b>Contain</b><br/>limit blast radius"]
  CON --> REC["<b>Recover</b><br/>restore + reconcile"]
  REC -.->|"learn"| PREV
```

## 4. Deployment lifecycle the Planner encodes

```mermaid
flowchart LR
  I["Intake<br/>(what is the agent?)"] --> R["Readiness score<br/>(9 axes)"]
  R --> ST["Recommended stack<br/>(patterns + guardrails)"]
  ST --> AU["Autonomy dial<br/>shadow → assisted →<br/>supervised → autonomous"]
  AU --> RO["Rollout + rollback plan"]
  RO --> RR["Residual risk register"]
  RR --> ADR["Decision record (ADR)"]
  RR -.->|"gaps feed back"| ST
```

## 5. Where the local model sits

```mermaid
sequenceDiagram
  participant UI as Fox - Architect UI
  participant PX as serve.py /api/llm
  participant AX as axiom :8210 (primary)
  participant FS as Fox-Services :8210
  UI->>PX: chat(messages, model, context)
  PX->>AX: /v1/chat/completions (stream)
  alt axiom healthy
    AX-->>PX: SSE deltas (served model reported)
  else axiom down and Fox-Services online
    PX->>FS: /v1/chat/completions (stream)
    FS-->>PX: SSE deltas
  else neither available
    PX-->>UI: 503 → UI runs deterministic fallback
  end
  PX-->>UI: SSE deltas + X-Fox-Backend
```

The model is an accelerator, never a dependency: retrieval, scoring, coverage,
cascade simulation, and the risk register are all computed locally and work with
the model switched off.
