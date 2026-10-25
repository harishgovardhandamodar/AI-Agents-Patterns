# Rogue Agents — Simulation, Detection & Quarantine

A compromised agent is not a bug in one tool call. It is a member of the swarm that works, correctly and diligently, toward the wrong objective — or toward no objective at all, while its tools reach further than its grant allows. This document describes the Rogue Agents tab (`js/rogue.js`): a deterministic swarm simulation with deliberately injected rogues, three behavioural detectors, an automated isolation workflow with remediation SLAs, and a guardrail derivation loop that turns measured results into runtime enforcement. The same thesis as the rest of the app, pointed at the insider: enforcement outside the model, in readable code.

The tab's honest caveat, printed in its own report: a passing synthetic run proves the *controls are wired*, not that any agent is safe.

## Context: where the tab sits

```mermaid
flowchart LR
  OP["Operator<br/>tunes swarm · reads board"] --> TAB["Rogue Agents tab<br/>setup → results → board → guardrails<br/>js/rogue.js"]
  CAT["Catalog<br/>patterns · scenarios · cascades<br/>data/*.json (read-only)"] --> TAB
  TAB --> FOX["fox-services / axiom<br/>live fire: model authors<br/>the rogue campaign"]
  TAB --> STORE["localStorage<br/>config · board · last run"]
  TAB --> BOARD["Quarantine board<br/>cases · SLA clocks · owners<br/>kill switch"]
  TAB --> REP["Report<br/>Markdown / JSON export"]
```

The tab reads the catalog (control-to-pattern mappings, scenario records for the book) and writes only to `localStorage` and to exported reports. The model backends are optional and fenced: they author attack campaigns in live-fire mode, nothing else. Detection, quarantine and the SLA math never call the model.

## Modules: one file, four stages

```mermaid
flowchart TB
  subgraph SIM["the simulator — deterministic, no model, no network"]
    TH["Themes<br/>7 domains · roles · tool vocabulary<br/>RG_THEMES"]
    SW["Swarm<br/>grants · goal mixes · EMA state<br/>rgSim()"]
    DET["Detectors<br/>behaviour · goal · collusion<br/>rgScores()"]
    CTL["Controls<br/>10 enforcement primitives<br/>gates · caps · refusals"]
  end
  subgraph OPS["the operations side — wall clock"]
    BD["Quarantine board<br/>cases · owners · steps<br/>rgBoard*()"]
    SLA["SLA engine<br/>6 steps · 5 min → 24 h<br/>RG_SLA"]
    KS["Kill switch<br/>fleet halt"]
  end
  subgraph DER["derivation — from run to runtime"]
    ABL["Counterfactuals<br/>leave-one-out + solo<br/>rgRunAblations()"]
    GRD["Guardrails<br/>primitive + pattern + evidence"]
    LIVE["Live fire<br/>model-authored campaigns<br/>rgPlanLive()"]
  end
  TH --> SW
  SW --> DET
  DET --> CTL
  DET --> BD
  BD --> SLA
  BD --> KS
  SW --> ABL
  ABL --> GRD
  LIVE --> SW
```

Setup owns the left column, Results owns the simulator column, the board owns the operations column, Guardrails owns derivation. Live fire feeds the simulator but never bypasses it: a model-authored campaign is still executed tick by tick by the same engine, against the same detectors and controls.

## Static structure: what a rogue is, in code

```mermaid
classDiagram
  direction LR
  class Theme {
    +string id
    +Role[] roles
    +map tools
  }
  class Agent {
    +int i
    +string role
    +string kind
    +string arch
    +int born
    +int[] grant
    +string state
  }
  class Detection {
    +string detector
    +float score
    +int tick
    +int streak
  }
  class Case {
    +string id
    +int openedAt
    +map steps
    +string owner
    +string status
  }
  class Run {
    +string id
    +int[] perRogue
    +map perDetector
    +float slaCompliance
  }
  Theme "1" --> "4..7" Agent : assigns roles
  Agent "1" --> "0..1" Detection : opens
  Detection "1" --> "0..1" Case : confirmed
  Case "0..*" --> "1" Run : caseSla
```

A rogue is an `Agent` with `kind = "rogue"`, an archetype, and an activation tick — nothing more. There is no separate rogue class at runtime, which is the point: until activation a rogue behaves exactly like everyone else, and the detectors cannot see the future, only the deviation.

## Activity: one tick of the swarm

```mermaid
flowchart TB
  TICK["tick t (1 minute)"] --> ACT["1 · act — every active agent draws tool calls<br/>rogues from the shifted mix (or a live plan)"]
  ACT --> FEAT["features — ext · egr · sens · acts · msg · rep · spw"]
  FEAT --> BASE["2 · baseline — median + MAD per feature<br/>over the whole swarm"]
  BASE --> SCORE["3 · score — robust z per agent<br/>behaviour · goal · collusion"]
  SCORE --> STREAK{"over threshold<br/>persist ticks in a row?"}
  STREAK -- no --> DECAY["streak resets"]
  STREAK -- yes --> CASE["4 · open case — detector + score + tick"]
  CASE --> FLOW["5 · workflow — isolate → revoke → snapshot<br/>scrub → handoff → remediate"]
  FLOW --> CHECK{"each step by its deadline?"}
  CHECK -- yes --> OK["compliant"]
  CHECK -- no --> BREACH["SLA breach — counted, reported"]
```

The baseline is recomputed every tick from the live swarm, with median + MAD so a handful of rogues cannot drag it. Persistence (`persist` consecutive ticks, default 2) is what turns a spike into an alert: a single noisy tick is never a detection.

## Sequence: the quarantine workflow and its deadlines

```mermaid
sequenceDiagram
  autonumber
  participant D as Detector
  participant RT as Runtime
  participant IAM as IAM / tokens
  participant FOR as Forensics
  participant SOC as On-call
  participant OWN as Service owner

  D->>RT: confirmed (agent, archetype, score)
  RT->>RT: isolate — pause, cut peers, park queue (SLA 5 min)
  RT->>IAM: revoke grant + ambient secrets (SLA 15 min)
  RT->>FOR: snapshot event log + context diff (SLA 30 min)
  RT->>FOR: quarantine memory: context + scratchpad + vectors (SLA 60 min)
  RT->>SOC: open incident, name owner (SLA 120 min)
  SOC->>OWN: root-cause, patch, re-verify (SLA 24 h)
  OWN->>RT: release (scrubbed) or terminate
```

Six steps, six deadlines, three owners. The simulation runs the same workflow on the same deadlines, so a breach in the simulation is a breach on the board — the report's SLA compliance is the share of counted steps met on time, excluding steps whose deadlines fall outside the run horizon and false-positive cases, which have no incident to work.

## Lifecycle: an agent, from healthy to released

```mermaid
stateDiagram-v2
  [*] --> Healthy: spawn with grant
  Healthy --> Dormant: injected (arch, born set)
  Dormant --> Active: t >= born
  Healthy --> Compromised: peer spread (undetected rogue)
  Active --> Detected: streak reaches persist
  Compromised --> Detected: streak reaches persist
  Detected --> Quarantined: auto-quarantine (or SLA breach → manual)
  Detected --> AtLarge: no auto-quarantine (late / escaped)
  Quarantined --> Released: scrubbed + re-verified
  Quarantined --> Terminated: owner decision
  Released --> Active: relapse (memory not scrubbed)
  Released --> Healthy: scrubbed + clean window
  AtLarge --> [*]: run ends / damage contained by bounds
```

Release without a memory scrub returns to `Active`, not `Healthy` — the context that turned is still the context it runs. The relapse edge is measured, not assumed: long runs with the scrub off end with most contained rogues relapsing.

## Live fire: the model writes the attack, the engine grades it

```mermaid
sequenceDiagram
  autonumber
  participant OP as Operator
  participant TAB as Rogue tab
  participant SIM as Deterministic engine
  participant MOD as fox-services / axiom

  OP->>TAB: Run live fire (capped: ≤24 agents, ≤60 ticks)
  TAB->>MOD: probe backend
  TAB->>SIM: dry run (same seed — fixes the assignment)
  SIM-->>TAB: rogue roster: role, grant, born, archetype
  loop one call per rogue
    TAB->>MOD: campaign prompt (role + grant + horizon)
    MOD-->>TAB: tool-call array (parsed tolerantly, holes stay simulated)
  end
  TAB->>SIM: real run with live plans
  SIM-->>TAB: detections · containment · SLA (unchanged math)
  TAB->>OP: live badge: backend · model · planned vs fallback
```

One call per rogue, not per tick — the campaign is open-loop, and the tab says so. Parsing is tolerant (names, theme labels, 1-based numbers; unknown labels become holes the engine fills by drawing), and a rogue the model never answers for stays simulated and is flagged. If every call fails, no run starts: a fully simulated run must never wear a live badge.

## Themes and archetypes: the coverage matrix

```mermaid
flowchart LR
  subgraph THEMES["7 themes — same engine, different swarm"]
    F["fintech"] & T["trading"] & M["medical"] & R["research"] & V["vuln"] & D["drug"] & G["general"]
  end
  THEMES --> ENG["swarm engine<br/>grants · features · detectors · controls"]
  ENG --> ARCH["6 archetypes<br/>hijack · exfil · abuse<br/>collude · drift · sybil"]
```

A theme changes roles and tool vocabulary, never mechanics — the six tool classes underneath are fixed, only their names change. That is what keeps results comparable across domains and what lets the book below read all 54 catalog scenarios through one rogue lens: every scenario is a (theme, archetype, road) triple, and every triple is executable.

## Archetype impact chains: how each shape turns into harm

One chain per archetype, each small enough to fit a page. Every chain ends the same way — the workflow from the quarantine section — because detection without the incident is observation, and the incident without enforcement is theater.

```mermaid
flowchart LR
  G["issued goal"] --> R["rogue steers work<br/>to another objective"]
  R --> D["goal misalignment rises"]
  D --> A["approval gate holds<br/>the irreversible step"]
  A --> Q["quarantine + revoke"]
```

```mermaid
flowchart LR
  S["sensitive reads rise"] --> E["external bytes spike"]
  E --> B["behavioural deviation fires"]
  B --> P["egress proxy denies"]
  P --> Q["quarantine + revoke"]
```

```mermaid
flowchart LR
  O["out-of-grant call"] --> F["runtime refuses + logs"]
  F --> B["behavioural deviation fires"]
  B --> V["grant revoked fleet-wide"]
  V --> Q["quarantine"]
```

```mermaid
flowchart LR
  X["agent A floods the channel"] --> P["pair burst over the window"]
  Y["agent B answers on the beat"] --> P
  P --> D["collusion detector fires"]
  D --> Q["both quarantined"]
```

```mermaid
flowchart LR
  L["behaviour creeps tick by tick"] --> E["EMA level shifts"]
  E --> D["behavioural deviation fires late"]
  D --> Q["quarantine + scrub"]
```

```mermaid
flowchart LR
  F["fork loop starts"] --> N["spawn pressure rises"]
  N --> C["fan-out cap refuses the fork"]
  C --> D["behavioural deviation fires"]
  D --> K["kill switch halts the fleet"]
```
