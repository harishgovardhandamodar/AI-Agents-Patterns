#!/usr/bin/env python3
"""Deep-case records and figures for the supplement *Field Playbooks*.

FIELD_DEEP holds the six worked cases: Harish's field note, the workbench
workflows it exercises, and the OpenShell primitives that bound it.
FIELD_FIGS holds hand-authored Mermaid diagrams; the build fails on a
missing figure key. Compact domain chapters are generated from the catalog
plus shared tables, so only deep cases need hand-written records here.
"""

FIELD_DEEP = {
    "deep-drug": {
        "title": "Drug discovery: assay before synthesis",
        "domains": ["research"],
        "workflows": ["scenarios", "rogue", "coverage", "blueprint", "guard", "discovery"],
        "openshell": ["Sandboxed execution", "Egress deny-by-default", "Approval gates", "Audit trail"],
        "note": [
            "I took the research queue apart the way I take everything apart: what proposes, what ranks, what spends money. Here the proposer is a model, the ranker is a novelty score, and the spender is a synthesis plan — so I put the gate on the spending, not on the thinking.",
            "My rehearsal ran the fabricated-citation scenario first, because a poisoned literature base poisons everything downstream of it. Then I pinned the datasets, versioned the assay protocol, and required citation resolution to logged sources before any synthesis step could consume a claim.",
            "What I would do differently next time: involve the safety reviewer at hypothesis ranking, not just at the synthesis gate. Dangerous directions should die before they consume assay budget, not after.",
        ],
        "figs": ["Assay before synthesis", "Hypothesis to assay"],
    },
    "deep-trading": {
        "title": "Trading agents: replay first, halt fastest",
        "domains": ["trading"],
        "workflows": ["scenarios", "rogue", "coverage", "live", "guard", "blueprint"],
        "openshell": ["Per-generation credentials", "Egress deny-by-default", "Approval gates", "Kill switch"],
        "note": [
            "The fastest domain gets the slowest onboarding: nothing touches a venue until it has survived replay. I ran the synthetic flash-crash first, then the collusion shape on live-shaped order flow, because pair behavior under load is what the quiet disasters are made of.",
            "My rule from three incidents elsewhere: the blotter is the product. Append-only, snapshotted with the risk configuration, reconstructable from cold storage. A venue dispute without a tape is an opinion, and opinions do not win.",
            "What I would do differently next time: publish the p99 gate latency beside every deployment from day one. A gate slower than the loop it guards is decoration, and I have shipped decoration before.",
        ],
        "figs": ["Replay then trade", "Kill-switch drill"],
    },
    "deep-banking": {
        "title": "Banking agents: onboard slowly, approve twice",
        "domains": ["finance", "enterprise"],
        "workflows": ["scenarios", "rogue", "coverage", "guard", "deploy", "blueprint"],
        "openshell": ["Dual control", "Per-sandbox credentials", "Approval gates", "Audit trail"],
        "note": [
            "Banking is where I am most conservative and least apologetic about it: onboarding is a workflow of its own, approval is dual control, and no single agent can invent a payee and pay it. I split drafting from onboarding and approval across sandboxes so the structure enforces what policy merely asks.",
            "My rehearsal order follows payout persistence: fake-vendor first, then invoice inflation, then approval-chain bypass. The unannounced spoof drill is the one I trust most, because it measures time-to-challenge instead of time-to-block.",
            "What I would do differently next time: extend dual control to vendor record edits above a threshold on day one. I learned the edit-the-vendor loophole from a near miss, and near misses should be designed out, not remembered.",
        ],
        "figs": ["Onboard then approve", "Dual control gate"],
    },
    "deep-payments": {
        "title": "Payments agents: idempotent or it did not happen",
        "domains": ["finance"],
        "workflows": ["scenarios", "rogue", "coverage", "guard", "deploy"],
        "openshell": ["Idempotency enforcement", "Dual control", "Egress deny-by-default", "Audit trail"],
        "note": [
            "Every payment flow I have touched eventually meets the same three ghosts: the duplicate webhook, the replayed callback, and the urgent request that is really a thief. Idempotency keys on every side effect, a global retry budget, and cooling-off on first-time payees — none of this is clever, all of it is load-bearing.",
            "My rehearsal ritual is adversarial and cheap: duplicate the webhook, replay the callback, deepfake the approver, then read the ledger. If any of those moves money twice or moves it at all, the design is not done.",
            "What I would do differently next time: show the human approver the full evidence pack — rule matched, history, anomaly flags — instead of an amount and a button. Approvals without evidence are signatures on blank checks.",
        ],
        "figs": ["Payment with guardrails", "Retry without double-spend"],
    },
    "deep-support": {
        "title": "Customer support: resolve freely, gate money and access",
        "domains": ["support"],
        "workflows": ["scenarios", "rogue", "coverage", "guard", "deploy"],
        "openshell": ["Per-queue credentials", "Vaulted PII", "Approval gates", "Audit trail"],
        "note": [
            "Support is where I learned that kindness scales badly: a helpful agent with standing refund authority is a payments rail wearing a smile. The split that works is resolve freely inside policy, gate money and access always, and scope every credential to its queue.",
            "My rehearsal order follows cost per incident: refund farming first with escalating emotional pressure, because real attackers optimize for the agents sympathy rather than its logic. Then PII exfiltration, then macro poisoning.",
            "What I would do differently next time: route every refund decision through the vault so the agent never sees what it must not repeat. The exfiltration path I worry about most is the helpful one.",
        ],
        "figs": ["Triage with vault", "Refund with approval"],
    },
    "deep-ticketing": {
        "title": "Ticket booking: search freely, pay under gate",
        "domains": ["operations", "support"],
        "workflows": ["scenarios", "rogue", "coverage", "guard", "blueprint"],
        "openshell": ["Egress deny-by-default", "Idempotency enforcement", "Approval gates", "Audit trail"],
        "note": [
            "Booking looks simple until it is not: search is free, holds expire, payment needs a gate, confirmation needs idempotency, and refunds are money moving backwards. I model it as search, hold, pay, confirm, refund-or-remedy — and I gate exactly the two money steps.",
            "My rehearsal list is short and classic: inventory oversell, duplicate charge, refund abuse. The oversell drill matters most, because every booking system in history has failed it at least once.",
            "What I would do differently next time: bind the payment intent to the hold with the same idempotency key from the start. Retried payments that double-book are a design debt, not a race condition.",
        ],
        "figs": ["Search, hold, pay, confirm", "Oversell guard"],
    },
}

FIELD_FIGS = {
    "Read loop": """flowchart TB
  N["Harish field note: what I did"]
  V["Counsel verification: verdict plus fixes"]
  W["Work the flow in the tab"]
  B["Bind it with OpenShell"]
  R["Rehearse on mock data"]
  N --> V --> W --> B --> R --> N""",
    "Case method": """flowchart TB
  Q["Pick a case and a sandbox"]
  Q --> I{Intake complete?}
  I -->|no| Q
  I -->|yes| C["Work the catalog"]
  C --> H{Rehearsed?}
  H -->|no| R["Run the rogue shape"]
  R --> H
  H -->|yes| G["Gate and deploy"]
  G --> V["Review and record"]""",
    "Case lifecycle": """stateDiagram-v2
    [*] --> Opened: incident or idea
    Opened --> Rehearsing: dossier started
    Rehearsing --> Gated: controls verified
    Gated --> Deployed: approval recorded
    Deployed --> Reviewed: scheduled review
    Reviewed --> Rehearsing: new shape found
    Reviewed --> [*]: retired with notes""",
    "Assay before synthesis": """flowchart TB
  H["Hypotheses ranked"]
  H --> D{Docking and novelty pass?}
  D -->|no| F["Forget and re-rank"]
  F --> H
  D -->|yes| A["Assay the winners"]
  A --> S{Synthesis gate: human approves?}
  S -->|no| H
  S -->|yes| M["Make and measure"]""",
    "Hypothesis to assay": """sequenceDiagram
    autonumber
    participant R as Researcher
    participant M as Model proposer
    participant D as Docking triage
    participant A as Assay queue
    R->>M: propose with logged sources
    M->>D: ranked hypotheses
    D->>A: winners only
    A-->>R: measured results""",
    "Replay then trade": """sequenceDiagram
    autonumber
    participant O as Operator
    participant T as Trace replay
    participant S as Simulator
    participant G as Pre-trade gate
    participant V as Venue
    O->>T: replay three sessions
    T->>S: live-shaped order flow
    S->>G: measure gate latency
    G->>V: release only under budget""",
    "Kill-switch drill": """flowchart TB
  N["Normal operation"]
  N --> T{Trigger: drill or real?}
  T --> H["Halt the fleet"]
  H --> F["Freeze and snapshot"]
  F --> R{Two humans approve reset?}
  R -->|no| H
  R -->|yes| N""",
    "Onboard then approve": """sequenceDiagram
    autonumber
    participant U as Applicant
    participant I as Intake sandbox
    participant V as Verifier
    participant H as Human approver
    participant P as Provisioner
    U->>I: application and documents
    I->>V: versioned vendor record
    V->>H: dual-control approval
    H->>P: provision with scoped grant""",
    "Dual control gate": """flowchart TB
  R["Payment or vendor request"]
  R --> D{Two independent approvers?}
  D -->|no| W["Wait, escalate, log"]
  W --> D
  D -->|yes| C{Cooling-off satisfied?}
  C -->|no| W
  C -->|yes| X["Execute with scoped credential"]""",
    "Payment with guardrails": """sequenceDiagram
    autonumber
    participant A as Agent
    participant R as Rule engine
    participant H as Human approver
    participant L as Ledger
    A->>R: payment against written rule
    R->>H: evidence pack for approval
    H->>R: dual-control sign-off
    R->>L: idempotent transfer""",
    "Retry without double-spend": """flowchart TB
  W["Duplicate webhook arrives"]
  W --> K{Idempotency key seen?}
  K -->|yes| D["Drop as duplicate"]
  K -->|no| E["Execute once, record key"]
  E --> G{Global retry budget left?}
  G -->|no| Q["Quarantine for review"]
  G -->|yes| N["Proceed"]""",
    "Triage with vault": """flowchart TB
  T["Ticket arrives"]
  T --> V{Vault lookup needed?}
  V -->|yes| K[Vault returns token, never the secret]
  V -->|no| R[Resolve from policy]
  K --> R
  R --> G{Money or access involved?}
  G -->|yes| H[Human approves]
  G -->|no| S[Resolve and log]""",
    "Refund with approval": """sequenceDiagram
    autonumber
    participant A as Agent
    participant P as Policy check
    participant H as Human approver
    participant V as Vault ledger
    A->>P: refund request with transcript
    P->>H: above threshold, needs sign-off
    H->>V: approve with scoped credential
    V-->>A: receipt, no secrets attached""",
    "Search, hold, pay, confirm": """sequenceDiagram
    autonumber
    participant C as Customer
    participant S as Search sandbox
    participant H as Hold with expiry
    participant P as Payment gate
    participant B as Booking record
    C->>S: search, drafts free
    S->>H: hold with idempotency key
    H->>P: gate approves payment
    P->>B: confirm once, receipt out""",
    "Oversell guard": """flowchart TB
  Q["Booking request arrives"]
  Q --> I{Inventory verified live?}
  I -->|no| W["Waitlist, never oversell"]
  I -->|yes| K{Idempotency key fresh?}
  K -->|no| D["Drop as duplicate"]
  K -->|yes| C["Confirm and decrement"]""",
    "Content item model": """classDiagram
    class Draft {
        +sourceRefs
        +embargoUntil
    }
    class PublishedPiece {
        +approvals
    }
    class RecommenderWeight {
        +version
    }
    Draft --> PublishedPiece : gated publish
    PublishedPiece ..> RecommenderWeight : trains""",
    "Vulnerability scan flow": """sequenceDiagram
    autonumber
    participant O as Operator
    participant S as Scanner sandbox
    participant F as Intel feed
    participant G as Approval gate
    O->>S: scoped scan targets
    S->>F: signed feed only
    F-->>S: findings with provenance
    S->>G: rule changes wait here""",
    "Pipeline with named sinks": """sequenceDiagram
    autonumber
    participant E as ETL sandbox
    participant W as Warehouse read
    participant T as Transform
    participant S as Approved sink
    E->>W: read-only mount
    W->>T: transform in scope
    T->>S: named sink only
    S-->>E: receipt logged""",
    "Deploy gate hold": """sequenceDiagram
    autonumber
    participant C as CI runner
    participant G as Human gate
    participant P as Production
    participant B as Bench
    C->>B: guarded preset first
    B->>G: green matrix required
    G->>P: apply approved change
    P-->>G: verified serving""",
    "Grading loop": """sequenceDiagram
    autonumber
    participant T as Tutor agent
    participant R as Rubric
    participant H as Educator
    participant S as Student record
    T->>R: grade against versioned rubric
    R->>H: queue for review
    H->>S: reviewed outcome only""",
    "Telemetry and control split": """sequenceDiagram
    autonumber
    participant T as Telemetry sandbox
    participant H as Historian
    participant C as Control sandbox
    participant O as Operator
    T->>H: append-only readings
    O->>C: approved control action
    C-->>H: log the actuation""",
    "Review before merge": """sequenceDiagram
    autonumber
    participant D as Developer agent
    participant R as Reviewer
    participant C as CI sandbox
    participant M as Main branch
    D->>R: diff plus tests
    R->>C: guarded pipeline run
    C->>M: merge on human approval""",
    "Single-purpose SaaS": """sequenceDiagram
    autonumber
    participant U as User request
    participant S as Scoped sandbox
    participant I as Integration
    participant A as Auditor
    U->>S: one integration only
    S->>I: provider-bound credential
    I-->>S: result, no standing grant
    S->>A: log for review""",
    "Default deny walkthrough": """flowchart TB
  Q["List what the agent can reach"]
  Q --> D{Anything unnamed?}
  D -->|yes| R["Remove or name it"]
  R --> Q
  D -->|no| V["Rehearse one escape"]
  V --> K["Keep the template spare"]""",
    "Oversight loop": """flowchart TB
  D["Agent drafts review"]
  D --> H{Human approves?}
  H -->|no| R["Revise with reasons"]
  R --> D
  H -->|yes| P["Publish minutes"]
  P --> A["Audit the trail later"]""",
    "Clinical advise loop": """flowchart TB
  Q["Clinical question arrives"]
  Q --> R[Retrieve PHI via vault only]
  R --> D[Draft advisory, cite sources]
  D --> H{Human clinician signs?}
  H -->|no| Q
  H -->|yes| P[Deliver with audit trail]""",
    "Hiring with a human": """flowchart TB
  A["Application arrives"]
  A --> S[Screen against written criteria]
  S --> B{Bias check clean?}
  B -->|no| F[Flag for audit]
  B -->|yes| H[Human decides]
  H --> R[Record with reasons]""",
    "Legal matter model": """classDiagram
    class Matter {
        +parties
        +privileged
    }
    class Filing {
        +reviewedBy
    }
    class Reviewer {
        +license
    }
    Matter *-- Filing : contains
    Reviewer --> Filing : signs""",
    "Fleet modules": """flowchart TB
  subgraph TM["Telemetry side"]
    T1[Read-only sensors]
    T2[Append-only historian]
  end
  subgraph CT["Control side"]
    C1[Gated actuators]
    C2[Human approval]
  end
  TM -. monitored, never driving .-> CT""",
    "Routing with gates": """flowchart TB
  subgraph PL["Planning side"]
    R1[Route proposals]
    R2[Manifest drafts]
  end
  subgraph EX["Execution side"]
    E1[Gated exceptions]
    E2[Carrier credentials]
  end
  PL --> EX""",
    "Campaign controls": """flowchart TB
  subgraph CR["Creative side"]
    A1[Drafts and variants]
    A2[Brand checks]
  end
  subgraph SP["Spend side"]
    S1[Capped budgets]
    S2[Dual approval]
  end
  CR --> SP""",
    "Procurement split": """flowchart TB
  subgraph DR["Drafting side"]
    D1[Vendor search]
    D2[Order drafts]
  end
  subgraph AP["Approval side"]
    A1[Dual control]
    A2[Scoped payment]
  end
  DR --> AP""",
    "Public flow": """flowchart TB
  Q["Citizen request arrives"]
  Q --> C[Check eligibility criteria]
  C --> H[Named official decides]
  H --> R[Reconstructable record]""",
    "Sense, plan, act": """flowchart TB
  S["Sense with versioned model"]
  S --> P[Plan without actuation]
  P --> I{Interlock clear?}
  I -->|no| W[Stop and alert]
  I -->|yes| A[Actuate with approval]""",
    "Quote within bounds": """flowchart TB
  Q["Quote requested"]
  Q --> D{Within discount band?}
  D -->|yes| S[Send with logging]
  D -->|no| H[Human approves]
  H --> S""",
    "Intake to decision": """flowchart TB
  I["Intake and triage"]
  I --> E[Evidence pack built]
  E --> O[Named owner decides]
  O --> R[Receipt with reasons]""",
}


FIELD_NOTES_DEEP = {
    "deep-drug": [
        "I took the research queue apart the way I take everything apart: what proposes, what ranks, what spends money. Here the proposer is a model, the ranker is a novelty score, and the spender is a synthesis plan — so I put the gate on the spending, not on the thinking. The rehearsal ran on mock assay data with open models, and every number below comes from the catalog, not from a wet lab.",
        "My order of operations: fabricated-citation scenario first, because a poisoned literature base poisons everything downstream of it. Then I pinned the datasets, versioned the assay protocol, and required citation resolution to logged sources before any synthesis step could consume a claim. Drift gets a fresh generation, not a debate.",
        "What I would do differently next time: involve the safety reviewer at hypothesis ranking, not just at the synthesis gate. Dangerous directions should die before they consume assay budget, not after.",
    ],
    "deep-trading": [
        "The fastest domain gets the slowest onboarding — nothing touches a venue until it has survived replay. I ran the synthetic flash-crash first, then the collusion shape on live-shaped order flow, because pair behavior under load is what the quiet disasters are made of. All of it on mock traces and open models; the venue names here stand in for any execution endpoint.",
        "My rule from three incidents elsewhere: the blotter is the product. Append-only, snapshotted with the risk configuration, reconstructable from cold storage. A venue dispute without a tape is an opinion, and opinions do not win. Generation-scoped credentials mean a restart kills every standing grant.",
        "What I would do differently next time: publish the p99 gate latency beside every deployment from day one. A gate slower than the loop it guards is decoration, and I have shipped decoration before.",
    ],
    "deep-banking": [
        "Banking is where I am most conservative and least apologetic about it: onboarding is a workflow of its own, approval is dual control, and no single agent can invent a payee and pay it. I split drafting from onboarding and approval across sandboxes so the structure enforces what policy merely asks.",
        "My rehearsal order follows payout persistence: fake-vendor first, then invoice inflation, then approval-chain bypass. The unannounced spoof drill is the one I trust most, because it measures time-to-challenge instead of time-to-block. All of it rehearsed against mock rails — no real money moved at any point.",
        "What I would do differently next time: extend dual control to vendor record edits above a threshold on day one. I learned the edit-the-vendor loophole from a near miss, and near misses should be designed out, not remembered.",
    ],
    "deep-payments": [
        "Every payment flow I have touched eventually meets the same three ghosts: the duplicate webhook, the replayed callback, and the urgent request that is really a thief. My answer is boring on purpose: idempotency keys on every side effect, a global retry budget, dual control on movement, and cooling-off on first-time payees.",
        "My rehearsal ritual is adversarial and cheap: duplicate the webhook, replay the callback, deepfake the approver, then read the ledger. If any of those moves money twice or moves it at all, the design is not done. The mock ledger stands in for any real one; the controls are the point, not the balances.",
        "What I would do differently next time: show the human approver the full evidence pack — rule matched, history, anomaly flags — instead of an amount and a button. Approvals without evidence are signatures on blank checks.",
    ],
    "deep-support": [
        "Support is where I learned that kindness scales badly: a helpful agent with standing refund authority is a payments rail wearing a smile. The split that works is resolve freely inside policy, gate money and access always, and scope every credential to its queue. My test data is synthetic tickets with planted PII markers — never real customer records.",
        "My rehearsal order follows cost per incident: refund farming first with escalating emotional pressure, because real attackers optimize for the agents sympathy rather than its logic. Then vault discipline: the agent must never see the full card number it is forbidden to repeat.",
        "What I would do differently next time: route every refund decision through the vault so the agent never sees what it must not repeat. The exfiltration path I worry about most is the helpful one, and helpfulness is the hardest behavior to gate.",
    ],
    "deep-ticketing": [
        "Booking looks simple until it is not: search is free, holds expire, payment needs a gate, confirmation needs idempotency, and refunds are money moving backwards. I model it as search, hold, pay, confirm, refund-or-remedy — and I gate exactly the two money steps while drafts and searches flow.",
        "My rehearsal list is short and classic: inventory oversell, duplicate charge, refund abuse. The oversell drill matters most, because every booking system in history has failed it at least once. Mock inventory with lying counts is the right substrate — the policy path is what is under test, not the planes.",
        "What I would do differently next time: bind the payment intent to the hold with the same idempotency key from the start. Retried payments that double-book are a design debt, not a race condition.",
    ],
}

FIELD_NOTES_COMPACT = {
    "content": "I treat content like a publishing desk with a security model: drafts and embargoes live in named scopes, recommenders get sandboxed weights, and nothing ships without a human gate. My rehearsal pick is the embargo-break drill, because unpublished words are the asset here.",
    "cybersecurity": "I run my own fence through the same drill I recommend to everyone: scope a scan, watch the baseline hold, then suppress one finding on purpose and confirm the detector notices. The scanner that cannot catch me suppressing a finding cannot catch anyone.",
    "data": "My rule for pipelines is read-only sources and named sinks, verified from the effective policy rather than the documentation. I rehearse sink redirection first, because an unlisted destination is a connection that should never have opened.",
    "devops": "I gate every apply and rehearse the cost runaway with real budget alerts wired, not mocked — the alarm path is part of the control. Runners get generation rotation, because long-lived runners accumulate exactly what should not persist.",
    "education": "I make the rubric measurable first, then rehearse against it, and I keep a human on every consequential output. The moment I catch myself trusting a grade I cannot explain is the moment I re-run the bias drill.",
    "energy": "I keep telemetry reading and control writing in different sandboxes and I time the control-action gate against the process it guards. A gate slower than the loop it protects is decoration with paperwork.",
    "engineering": "I run the six-story mix on schedule and I require signed commits, because the repo is the memory every future agent will inherit. My favorite drill is the poisoned-dependency install — it tests the exact moment trust enters the system.",
    "enterprise": "My first move in any enterprise tenant is splitting the multi-tool agent into single-purpose sandboxes, then inventorying integrations quarterly and killing the unused ones. Standing access is standing risk.",
    "general": "I use the general swarm as my control group: default-deny everything, rehearse the broad sample, and only then trust a domain tuning. If a control cannot hold here, it will not hold where authorities are real.",
    "governance": "I treat the oversight function as the thinnest-rehearsed and most load-bearing workflow I own, so I author its missing scenarios myself. Suppressed findings get rehearsed first, because oversight that cannot see its own failure is theater.",
    "healthcare": "I keep clinicians in the decision and agents in the advisory seat, with PHI vaulted and every care decision gated. My rehearsal order follows irreversibility: dosage first, then everything else.",
    "hr": "I write screening criteria measurably or not at all, and I rehearse payroll diversion and screening bias as the different failures they are. Fairness and money break differently and need different instruments.",
    "iot": "I split telemetry from firmware control and I rehearse the spoofed-telemetry drill, because the control side must learn to distrust its inputs. Image signing is verified at ingest, not trusted at use.",
    "legal": "I put each matter in its own sandbox and I rehearse the privilege-leak shape against the real workspace layout. Privilege ends where shared context begins, and I verify the boundary mechanically.",
    "logistics": "I gate the exceptional move and let standard lanes flow, and I rehearse rerouting first because it is the cheapest failure to attempt. The manifest is append-only; the past must be harder to rewrite than the future.",
    "marketing": "I cap spend at the runtime level before I gate a single publish, and I rehearse spend escalation quarterly. Money moves faster than words, so the money control comes first.",
    "procurement": "I split drafting from onboarding and approval, and I rehearse fake-vendor creation against the real intake form. The pick-a-payee step is where the money actually moves, so that is where dual control lives.",
    "public-sector": "I write eligibility criteria I can show the public, gate every consequential output behind a named official, and keep every decision reconstructable. Public trust runs on the record, not on the model.",
    "robotics": "I separate planning from actuation and I verify the interlock lives where no agent can write. My rehearsal of choice is the sensor-trust drill, because the map is the first thing an adversary would poison.",
    "sales": "I let drafting and enrichment run free and I gate discounts and bulk export, rehearsing discount abuse first by margin impact. The forecast is only as honest as the pipeline log behind it.",
    "strategy": "I version assumptions and gate distribution, and I rehearse forecast gaming against my own planning template. A strategy built on unversioned inputs is a story, not a plan.",
}
