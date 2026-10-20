# Control Flow & Runtime

How the dashboard executes: the canonical agent loop it documents, the trace playback state machine, and the Mermaid render pipeline.

## The canonical agent loop (the pattern the whole catalog describes)

```mermaid
sequenceDiagram
  autonumber
  participant U as Human requester
  participant RT as Agent runtime
  participant CTX as Context assembler
  participant LLM as LLM
  participant GW as Guardrail gateway
  participant T as Tool / world
  participant AUD as Audit trail

  U->>RT: task + budget (identity bound)
  RT->>AUD: task.accepted
  loop until done / cap / breaker
    CTX->>CTX: assemble (pinned policy + task + retrieved + history)
    CTX->>LLM: prompt (policy never truncated)
    LLM-->>RT: proposed action (structured)
    RT->>GW: action + provenance
    alt allow
      GW->>T: execute (scoped token, idem key)
      T-->>RT: observation
    else require approval
      GW-->>U: evidence pack (diff, sources, risk)
      U-->>GW: approve / reject (bound to action hash)
    else deny
      GW-->>RT: block + reason code
      RT->>AUD: policy.denied
    end
    RT->>AUD: loop iteration logged (hash-chained)
  end
  RT-->>U: result + audit id
```

Key property: **the guardrail gateway sits between intent and effect.** The model proposes; the runtime disposes. Injection can influence the *proposal* but never the *rules*.

## Trace playback state machine (Live View)

```mermaid
stateDiagram-v2
  [*] --> Idle: loadTrace(id)
  Idle --> Playing: play
  Idle --> Stepped: step(+1)
  Playing --> Playing: interval tick → advance
  Playing --> Paused: pause
  Playing --> Finished: last step reached
  Paused --> Playing: play
  Paused --> Stepped: step(±1)
  Stepped --> Playing: play
  Stepped --> Paused: (implicit)
  Finished --> Idle: reset
  Playing --> Idle: reset
  note right of Playing
    each transition calls paintStep():
      1. dim/activate step rows
      2. highlight current Mermaid node
      3. mark past nodes
      4. re-derive gauges from step progress
      5. slice event log to current step
  end note
```

## Data flow: JSON → tab → view

```mermaid
flowchart LR
  BOOT["loadAll()"] --> P1["Phase 1 · fetch<br/>patterns · scenarios · traces · coverage"]
  BOOT --> P2["Phase 2 · fetch cascades<br/>(deferred, in parallel)"]
  P1 --> EARLY["first panes: init*()<br/>(build filters, defaults)"]
  P2 --> CAT["catalogReady"]
  EARLY --> RENDER["render*( )<br/>(filter → sort → innerHTML)"]
  CAT --> WIDE["palette · dashboard · landing<br/>+ deferred panes"]
  RENDER --> DETAIL["openPattern/openScenario<br/>(drawer + diagramHtml)"]
  DETAIL --> MM["mmRender(queue)<br/>mermaid.run per node"]
  WIDE --> MM
```

Every render is a pure function of filter state — no hidden caches, so the same filters always produce the same view (the dashboard's own form of idempotency).

### Boot is phased, and any pane can jump the queue

Only the first paint path (overview, patterns, scenarios, plus whatever pane the hash names) is awaited up front; `cascades.json` — the largest dataset — loads in parallel and gates `catalogReady`, which the remaining panes wait on. A tab visit runs a not-yet-built pane's `init` immediately instead of waiting for the idle pump. The full boot sequence, the offline read path and the service worker are in *Runtime, Offline & Delivery*.

## Mermaid render queue (why sequential)

Mermaid measures label widths in shared global state; concurrent `run()` calls corrupt each other's layout. The library is vendored (`js/vendor/mermaid.min.js`, CDN only as a fallback); all renders pass through a single promise chain:

```mermaid
flowchart LR
  A["render request<br/>(nodes)"] --> Q["mmQueue<br/>Promise chain"]
  Q --> I["init(theme vars)"]
  I --> R["for each node:<br/>mermaid.run({nodes:[node]})"]
  R --> FIX["verify SVG present<br/>else .mm-err-note"]
  FIX --> NEXT["next node"]
  NEXT -.->|"failed job must not wedge queue"| Q
```

Theme variables are recomputed from the light/dark CSS class at each batch, and every `pre.mermaid` keeps its source in `data-src` so a theme toggle re-renders without re-fetching.
