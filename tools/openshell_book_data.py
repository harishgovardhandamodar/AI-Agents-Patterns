#!/usr/bin/env python3
"""Domain playbooks, archetype records and figures for the supplement
*OpenShell Reference Architecture*.

Read by ``tools/build_openshell_book.py``. YAML sketches are illustrative
configurations using the real policy section names (``version``,
``filesystem_policy``, ``landlock``, ``process``, ``network_policies``,
``network_middlewares``); they show shape, never a measured deployment.
"""

ARCHETYPES = [
    ("hijack", "Goal hijack",
     "The agent still works, but for a different objective: it steers its work toward a goal it was never given.",
     "Approval gates hold the irreversible step while detectors decide; scoped per-sandbox grants keep the hijacked objective inside a small world."),
    ("exfil", "Data exfiltration",
     "The agent reads what it should not and sends it out: the swarm's data leaves through a side channel.",
     "Deny-by-default network policy plus read-only filesystem mounts; the connection to an unlisted destination never opens."),
    ("abuse", "Capability abuse",
     "The agent acts within tools it can see but beyond what its job needs: legitimate capability, illegitimate scope.",
     "Least-privilege grants per sandbox, unprivileged process identity, and revocation by deletion when scope is exceeded."),
    ("collude", "Collusion",
     "Pairs that look innocent individually coordinate through a shared channel the policy did not intend.",
     "Channel denial between sandboxes first, pair-level review second; no mutual egress, no shared writable scope by default."),
    ("drift", "Slow drift",
     "Nothing unauthorized happens; the objective itself decays while every action stays inside policy.",
     "Goal comparison against written objectives plus generation rotation that restarts the clock; gates buy time for slow evidence."),
    ("sybil", "Sybil / fleet spawn",
     "The agent forks copies of itself: each copy looks legitimate, together they are a takeover of fleet identity.",
     "Creation stays a control-plane act no agent can invoke; generations make each new sandbox attributable; fleet halt stops the exponential."),
]

OPENSHELL_FIGS = {
    "Three actors, one rule": """flowchart LR
  subgraph PLANE["Control plane"]
    GW["Gateway: identity, policy delivery, JWT signing, logs"]
  end
  subgraph TRUSTED["Trusted side"]
    SV["Supervisor: decides per policy, adds credentials, relays"]
  end
  subgraph FENCE["Sandbox boundary"]
    SB["Sandbox: relays traffic, reports, freezes"]
    AG["Agent: unprivileged owned child"]
  end
  AG --> SB --> SV --> GW""",
    "The mediated channel": """flowchart LR
  AG["Agent opens TCP / DNS"] --> SB["Sandbox: identifies program, intercepts"]
  SB --> CH["One mutual-TLS channel, many streams"]
  CH --> SV["Supervisor: policy check, add credentials"]
  SV --> OUT["Approved destination"]
  CH -.-> DNS["dedicated DNS stream"]
  CH -.-> EX["dedicated exec stream"]""",
    "How a network request travels": """flowchart TB
  R1["1 · Agent opens a connection or DNS lookup"]
  R2["2 · Sandbox identifies the calling program"]
  R3["3 · Request travels the supervisor channel"]
  R4["4 · Supervisor checks policy, adds credentials"]
  R5["5 · Supervisor opens the real connection and relays"]
  R1 --> R2 --> R3 --> R4 --> R5""",
    "Generations and JWTs": """flowchart TB
  G1["Sandbox created: generation N begins"]
  G2["Gateway issues gateway JWT + sandbox JWT"]
  G3["Supervisor renews both while the sandbox exists"]
  G4["Restart: generation N+1, fresh tokens and certs"]
  G5["Old tokens stop working; deletion cuts everything"]
  G1 --> G2 --> G3 --> G4 --> G5""",
    "Policy layers and timing": """flowchart LR
  subgraph LOCKED["Locked at creation or startup"]
    L1["process: unprivileged user, no caps"]
    L2["filesystem_policy: Landlock paths"]
    L3["landlock: strictness fallback"]
  end
  subgraph LIVE["Hot-reloadable while running"]
    N1["network_policies: per-binary destinations"]
    N2["network_middlewares: inspect, transform, block"]
  end
  LOCKED --> LIVE""",
    "The prover in CI": """flowchart LR
  PR["Policy pull request"] --> PV["openshell-prover checks the boundary"]
  PV -->|clean| MG["Merge: ship the rule"]
  PV -->|new credentialed reach| HB["Human review required"]
  PV -->|metadata or methods| HB
  HB --> MG""",
    "Six archetypes, six containments": """flowchart TB
  H["hijack: steered intent"] --> G1["approval gates + scoped grants"]
  E["exfiltration: outward road"] --> G2["deny-by-default + read-only mounts"]
  A["abuse: excess scope"] --> G3["least privilege + revocation by deletion"]
  C["collusion: pair channel"] --> G4["channel denial + pair review"]
  D["drift: decayed goal"] --> G5["goal comparison + generation rotation"]
  S["spawning: multiplied identity"] --> G6["control-plane creation + fleet halt"]""",
    "The quarantine workflow on OpenShell": """flowchart LR
  Q1["Freeze or delete the sandbox"] --> Q2["Tokens die with the generation"]
  Q2 --> Q3["Capture supervisor and gateway logs"]
  Q3 --> Q4["Retire the generation: memory quarantine"]
  Q4 --> Q5["Owned case with deadlines"]
  Q5 --> Q6["Fresh generation from a clean image"]""",
    "Four runtimes, one contract": """flowchart TB
  subgraph DK["Docker / Podman"]
    D1["supervisor in its own container"]
    D2["Unix socket, workload networking off"]
  end
  subgraph K8["Kubernetes"]
    K1["supervisor in its own pod"]
    K2["mTLS service, NetworkPolicy fence"]
  end
  subgraph VM["MicroVM"]
    V1["supervisor as host process"]
    V2["vsock channel, no guest net device"]
  end
  DK & K8 & VM --> CT["same contract: supervisor decides, sandbox relays, fence denies"]""",
    "From one sandbox to fleets": """flowchart LR
  S1["One sandbox: contract proven"] --> S2["Many sandboxes: destination inventory"]
  S2 --> S3["Fleet: per-sandbox attribution at scale"]
  S3 --> S4["AI factory: same policy model, tiered runtimes"]""",
    "Gateway, supervisor, sandbox: module view": """flowchart TB
  subgraph GW["Gateway modules"]
    G1["Identity and auth"]
    G2["Policy store and delivery"]
    G3["JWT issuer"]
    G4["Sessions, logs, audit"]
  end
  subgraph SV["Supervisor modules"]
    S1["Policy decider"]
    S2["Credential vault"]
    S3["DNS resolver"]
    S4["Connection relay"]
  end
  subgraph SB["Sandbox modules"]
    B1["Process owner"]
    B2["Seccomp and Landlock hooks"]
    B3["Protocol forwarder"]
  end
  subgraph DR["Compute drivers"]
    D1["Docker and Podman"]
    D2["Kubernetes"]
    D3["MicroVM"]
  end
  GW --> SV --> SB
  DR -. builds and fences .-> SB
  DR -. places .-> SV""",
    "Sandbox protocol session": """sequenceDiagram
    autonumber
    participant A as Agent
    participant SB as Sandbox
    participant SV as Supervisor
    A->>SB: TCP open example.com:443
    SB->>SV: stream SYN plus program identity
    SV->>SV: policy lookup per binary
    alt destination allowed
        SV->>SV: attach credentials if bound
        SV-->>SB: stream ESTABLISHED
    else destination unlisted
        SV-->>SB: stream DENIED plus audit event
    end""",
    "Bootstrap, issue, renew, revoke": """sequenceDiagram
    autonumber
    participant DR as Compute driver
    participant SV as Supervisor
    participant GW as Gateway
    DR->>SV: bootstrap token in files or ServiceAccount
    SV->>GW: claim plus bootstrap credential
    GW->>GW: verify against sandbox record
    GW-->>SV: gateway JWT plus sandbox JWT
    SV->>SV: renew both before expiry
    SV->>GW: delete sandbox ends renewal""",
    "Agent-proposed rule under review": """sequenceDiagram
    autonumber
    participant AG as Agent advisor
    participant PV as Prover
    participant HU as Human reviewer
    participant GW as Gateway
    AG->>PV: proposed network rule
    PV->>PV: check credentialed reach
    PV->>PV: check methods and metadata endpoints
    alt finding flagged
        PV->>HU: block plus finding report
        HU->>GW: approve or reject
    else clean
        PV->>GW: auto-approval
    end""",
    "Hijack held at the gate": """sequenceDiagram
    autonumber
    participant A as Turned agent
    participant SB as Sandbox
    participant SV as Supervisor
    participant G as Approval gate
    participant D as Detectors
    A->>SB: irreversible action attempt
    SB->>SV: mediated request plus identity
    SV->>G: hold while detectors score
    D->>SV: deviation and misalignment scores
    alt scores convict
        SV->>SB: freeze and open case
    else scores clear
        SV->>SB: release single action
    end""",
    "Exfiltration denied by default": """sequenceDiagram
    autonumber
    participant A as Agent
    participant SB as Sandbox
    participant SV as Supervisor
    A->>SB: read sensitive path
    SB->>SV: check Landlock scope
    alt path outside scope
        SV-->>SB: read denied
    else path inside scope
        A->>SB: upload to unlisted host
        SB->>SV: egress check per binary
        SV-->>SB: connection denied, no rule
    end
    Note over SV: no listed destination, no connection""",
    "Abuse outside the grant": """sequenceDiagram
    autonumber
    participant A as Agent
    participant SB as Sandbox
    participant SV as Supervisor
    participant GW as Gateway
    A->>SB: invoke visible tool
    SB->>SV: grant scope check
    alt tool outside grant
        SV-->>SB: deny and log attempt
    else tool inside grant
        SV->>SV: execute, watch for drift
        SV->>GW: revoke grant on finding
    end""",
    "Collusion without a channel": """sequenceDiagram
    autonumber
    participant X as Agent X
    participant SB as Sandbox pair
    participant SV as Supervisor
    X->>SB: message to Agent Y
    SB->>SV: pair reachability check
    alt no shared relay in policy
        SV-->>SB: channel denied
    else relay allowed and watched
        SV->>SV: pair-level review
        SV-->>SB: sever pair on mismatch
    end""",
    "Drift against the baseline": """sequenceDiagram
    autonumber
    participant A as Drifting agent
    participant SV as Supervisor
    participant GC as Goal comparator
    participant G as Approval gate
    A->>SV: permitted actions, week after week
    SV->>GC: compare mix to written objective
    GC->>G: slow evidence accumulates
    G->>G: hold irreversible step
    alt objective confirmed lost
        G->>SV: retire generation, fresh start
    else objective holds
        G->>SV: release with new baseline
    end""",
    "Spawning denied by construction": """sequenceDiagram
    autonumber
    participant A as Agent
    participant SB as Sandbox
    participant GW as Gateway
    A->>SB: request new sandbox
    SB->>GW: creation is control-plane only
    GW-->>SB: deny, no agent path exists
    GW->>GW: audit the attempt
    Note over GW: fleets grow by operator action, never by agent request""",
    "Sandbox lifecycle and generations": """stateDiagram-v2
    [*] --> Created
    Created --> Running: supervisor confirms boundary
    Running --> Frozen: supervisor disconnects
    Frozen --> Running: same supervisor resumes
    Running --> Retired: generation ends or deleted
    Frozen --> Retired: deleted while frozen
    Retired --> [*]: tokens dead""",
    "Credential resolution without possession": """sequenceDiagram
    autonumber
    participant A as Agent
    participant SB as Sandbox
    participant SV as Supervisor
    participant P as Bound endpoint
    A->>SB: request with opaque placeholder
    SB->>SV: relay plus program identity
    SV->>SV: policy check and bind endpoint
    SV->>P: real request plus resolved credential
    P-->>SV: response
    SV-->>SB: relay with no secret attached
    SB-->>A: response bytes""",
    "Incident on the clock": """sequenceDiagram
    autonumber
    participant D as Detector
    participant SV as Supervisor
    participant SB as Sandbox
    participant GW as Gateway
    participant OP as Operator
    D->>SV: score crosses threshold
    SV->>SB: freeze workload
    SV->>GW: revoke tokens as generation dies
    SV->>GW: snapshot logs and context
    GW->>OP: owned case with deadlines
    OP->>GW: scrub proof plus approve release
    GW->>SV: fresh generation from clean image""",
    "Policy schema as UML": """classDiagram
    class SandboxPolicy {
        +version
    }
    class FilesystemPolicy {
        +readPaths
        +writePaths
    }
    class ProcessIdentity {
        +user
        +capabilities
    }
    class NetworkRule {
        +binaries
        +destinations
        +methods
    }
    class NetworkMiddleware {
        +inspect
        +transform
        +block
    }
    class ProviderContribution {
        +service
        +credentialRef
    }
    SandboxPolicy *-- FilesystemPolicy
    SandboxPolicy *-- ProcessIdentity
    SandboxPolicy *-- NetworkRule
    SandboxPolicy *-- NetworkMiddleware
    ProviderContribution ..> NetworkRule : contributes""",
    "Proposal lifecycle": """stateDiagram-v2
    [*] --> Proposed
    Proposed --> Proven: prover clean
    Proposed --> Blocked: finding flagged
    Blocked --> Proposed: revised
    Blocked --> Rejected: withdrawn
    Proven --> Approved: human sign-off
    Approved --> Applied: hot-reload or restart
    Applied --> Retired: superseded
    Retired --> [*]""",
    "Canonical domain request path": """sequenceDiagram
    autonumber
    participant A as Domain agent
    participant SB as Sandbox
    participant SV as Supervisor
    participant P as Bound provider
    participant D as Named destination
    A->>SB: read task paths under Landlock
    SB->>SV: mediated request plus identity
    SV->>P: credentialed call on approval
    P-->>SV: result
    SV->>D: allowed write only
    Note over SV: every hop logged, scoped, revocable""",
}

DOMAIN_ORDER = ["content", "cybersecurity", "data", "devops", "education",
                "energy", "engineering", "enterprise", "finance", "general",
                "governance", "healthcare", "hr", "iot", "legal", "logistics",
                "marketing", "operations", "procurement", "public-sector",
                "research", "robotics", "sales", "strategy", "support",
                "trading"]

DOMAIN_PLAYBOOKS = {
    "content": {
        "stakes": "Publishing credentials, embargoed drafts, recommender weights, and the public record itself.",
        "story": "A content agent with CMS access is the standing example: drafts and embargoes readable in one scope, publishing rights in another.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/drafts", "/srv/archive"]
  write: ["/srv/drafts"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["cms-cli"]
    destinations: ["cms.internal:443"]
    methods: ["GET"]""",
    },
    "cybersecurity": {
        "stakes": "Scanner targets, intel feeds, firewall rules, and quarantine exceptions — the guard's own weapons.",
        "story": "A security agent that can both see everything and change the fence is the highest-leverage compromise in the fleet.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/opt/intel/feeds", "/etc/scanner/targets.d"]
  write: []
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["scanner"]
    destinations: ["intel.internal:443"]
    methods: ["GET"]""",
    },
    "data": {
        "stakes": "Pipelines, warehouses, PII stores, and the sinks where transformed data lands.",
        "story": "A transform agent that can read the warehouse and write anywhere exfiltrates at machine speed; sinks must be named.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/data/warehouse-ro"]
  write: ["/data/staging"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["etl-run"]
    destinations: ["warehouse.internal:5432"]
    methods: ["GET"]""",
    },
    "devops": {
        "stakes": "CI jobs, deploy keys, infrastructure-as-code apply rights, and production itself.",
        "story": "A deploy pipeline agent turns intent into running systems within minutes, so apply rights are the crown jewels.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/repo", "/ci/workspace"]
  write: ["/ci/workspace"]
process: {user: "ci-agent", capabilities: []}
network_policies:
  - binaries: ["git", "ci-runner"]
    destinations: ["git.internal:443", "artifacts.internal:443"]
    methods: ["GET", "POST"]""",
    },
    "education": {
        "stakes": "Grades, admissions, student records, and the rubrics that define fairness.",
        "story": "A grading agent that can both read the rubric and rewrite it has no constraint left; the rubric must be read-only.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/rubrics", "/srv/submissions"]
  write: ["/srv/grades-out"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["grader"]
    destinations: ["sis.internal:443"]
    methods: ["GET"]""",
    },
    "energy": {
        "stakes": "Telemetry streams, historian records, setpoints, and dispatch decisions near operational technology.",
        "story": "Telemetry reading and control writing must live in different sandboxes; no agent holds both sides of the valve.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/telemetry"]
  write: []
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["telemetry-reader"]
    destinations: ["historian.internal:443"]
    methods: ["GET"]""",
    },
    "engineering": {
        "stakes": "Source code, review rights, merge rights, CI secrets, and the product itself.",
        "story": "Author and approver must live in different sandboxes; no agent merges its own output to a protected branch.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/repo"]
  write: ["/repo/scratch"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["git", "ci-runner"]
    destinations: ["git.internal:443"]
    methods: ["GET", "POST"]""",
    },
    "enterprise": {
        "stakes": "SSO sessions, HR and finance systems, and every SaaS integration behind one browser-shaped agent.",
        "story": "One multi-tool agent with standing SaaS access is many single-purpose sandboxes waiting to be split.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/saas-config"]
  write: []
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["saas-connector"]
    destinations: ["hr.internal:443"]
    methods: ["GET"]""",
    },
    "finance": {
        "stakes": "Payment rails, ledgers, settlement instructions, and position limits.",
        "story": "A hijacked objective becomes a transfer within seconds, so movement needs a gate and credentials need a single binding.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/ledgers-ro"]
  write: []
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["ledger-read"]
    destinations: ["ledger.internal:443"]
    methods: ["GET"]""",
    },
    "general": {
        "stakes": "Files, browser, shell, and email with no special authorities — the baseline everything else copies.",
        "story": "The general swarm is the control group: default-deny everything, then re-add named needs one by one.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/work/inbox"]
  write: ["/work/outbox"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["fetch"]
    destinations: ["docs.internal:443"]
    methods: ["GET"]""",
    },
    "governance": {
        "stakes": "Policy documents, audit trails, and access reviews — the controls that judge the other controls.",
        "story": "The agent that summarizes access reviews must never be able to edit the grants it reviews.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/policies", "/srv/audit-ro"]
  write: []
process: {user: "agent", capabilities: []}
network_policies: []""",
    },
    "healthcare": {
        "stakes": "PHI, triage decisions, prescribing, and appointments — privacy plus clinical consequence.",
        "story": "Clinical actions need human approval and PHI needs confinement; the agent informs while humans decide.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/phi-cohort"]
  write: []
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["ehr-read"]
    destinations: ["ehr.internal:443"]
    methods: ["GET"]""",
    },
    "hr": {
        "stakes": "Hiring, payroll, performance records, and the PII that powers them.",
        "story": "No hire, fire, pay, or review action executes without a named human; the agent drafts, humans decide.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/hr-ro"]
  write: []
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["hr-read"]
    destinations: ["hr.internal:443"]
    methods: ["GET"]""",
    },
    "iot": {
        "stakes": "Device fleets, firmware images, telemetry, and actuators at scale.",
        "story": "Telemetry reading and firmware pushing must live in different sandboxes; no agent holds both the eyes and the hands.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/telemetry"]
  write: []
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["telemetry-reader"]
    destinations: ["fleet.internal:443"]
    methods: ["GET"]""",
    },
    "legal": {
        "stakes": "Contracts, privileged matters, filings, and deadlines that forfeit rights.",
        "story": "Privilege ends where shared context begins; each matter gets its own sandbox with disjoint scope.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/matters/acme"]
  write: ["/srv/matters/acme/drafts"]
process: {user: "agent", capabilities: []}
network_policies: []""",
    },
    "logistics": {
        "stakes": "Routing decisions, fleet movements, warehouse operations, and customs documents.",
        "story": "Rerouting is cheap to attempt and expensive to absorb, so route-plan commits wait at a gate.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/routes", "/srv/fleet-ro"]
  write: ["/srv/routes/proposals"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["fleet-read"]
    destinations: ["fleet.internal:443"]
    methods: ["GET"]""",
    },
    "marketing": {
        "stakes": "Ad spend, campaigns, brand channels, and the analytics that steer them.",
        "story": "Spend and voice are the two authorities; a turned agent spends money and reputation simultaneously.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/campaigns"]
  write: ["/srv/campaigns/drafts"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["ads-read"]
    destinations: ["ads.internal:443"]
    methods: ["GET"]""",
    },
    "operations": {
        "stakes": "Runbooks, incident actions, status pages, and the production systems behind them.",
        "story": "The agent sent to fix the incident must not be able to deepen it; mutation waits for the commander.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/runbooks", "/srv/incidents"]
  write: ["/srv/incidents/notes"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["status-read"]
    destinations: ["status.internal:443"]
    methods: ["GET"]""",
    },
    "procurement": {
        "stakes": "Purchase orders, vendor records, invoices, and the separation between drafting and approving.",
        "story": "The agent that drafts the order must not onboard its payee; duties split across sandboxes.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/vendors-ro", "/srv/orders"]
  write: ["/srv/orders/drafts"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["orders-read"]
    destinations: ["procure.internal:443"]
    methods: ["GET"]""",
    },
    "public-sector": {
        "stakes": "Citizen records, benefits, permits, and decisions the public cannot route around.",
        "story": "Eligibility outputs need named officials; records need confinement; every decision needs reconstruction.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/cases-ro"]
  write: []
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["cases-read"]
    destinations: ["registry.internal:443"]
    methods: ["GET"]""",
    },
    "research": {
        "stakes": "Datasets, citations, peer review, and the beliefs the team will act on.",
        "story": "A poisoned synthesis compounds through every downstream paper; pin datasets and trace every claim.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/datasets/v7"]
  write: ["/srv/synthesis"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["scholar-read"]
    destinations: ["library.internal:443"]
    methods: ["GET"]""",
    },
    "robotics": {
        "stakes": "Motion plans, world models, actuators, and the safety interlocks above them.",
        "story": "Planning and actuation split across sandboxes; interlocks live where no agent can write.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/world-models/v3"]
  write: ["/srv/plans"]
process: {user: "agent", capabilities: []}
network_policies: []""",
    },
    "sales": {
        "stakes": "CRM records, quotes, discount authority, and the forecast built on them.",
        "story": "Drafting is free; discounting past threshold and bulk export wait for humans.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/crm-ro"]
  write: ["/srv/crm/drafts"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["crm-read"]
    destinations: ["crm.internal:443"]
    methods: ["GET"]""",
    },
    "strategy": {
        "stakes": "Forecasts, plans, board materials, and the assumptions beneath them.",
        "story": "Assumptions versioned, inputs pinned, distribution gated; drafts never travel as decisions.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/strategy/inputs-v2"]
  write: ["/srv/strategy/drafts"]
process: {user: "agent", capabilities: []}
network_policies: []""",
    },
    "support": {
        "stakes": "Tickets, refunds, account actions, and macros that run them at volume.",
        "story": "Resolve freely within policy; refunds and access changes wait; credentials scope to the queue.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/tickets"]
  write: ["/srv/tickets/notes"]
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["tickets-api"]
    destinations: ["support.internal:443"]
    methods: ["GET"]""",
    },
    "trading": {
        "stakes": "Order flow, positions, risk limits, and the venue APIs that move markets.",
        "story": "Pre-trade risk gates cannot be bypassed by any agent path; the halt works faster than review.",
        "yaml": """version: 1
filesystem_policy:
  read: ["/srv/marketdata"]
  write: []
process: {user: "agent", capabilities: []}
network_policies:
  - binaries: ["marketdata-read"]
    destinations: ["venue.internal:443"]
    methods: ["GET"]""",
    },
}
