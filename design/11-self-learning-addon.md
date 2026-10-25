# Self-Learning Add-on — Bridging the Lab

The Self-Learning Agent Lab is a separate service: a FastAPI backend plus dashboard on `:8220`, backed by fox-services on `:8210`, developed in the sibling checkout `../self-learning-agents`. This app does not execute the lab — it bridges to it. The Self-Learning tab (`js/selflearn.js`) carries reachability status, deep links, run instructions, and a concept map from the lab's mechanisms to this catalog's patterns and scenarios. The companion book (`tools/build_sl_book.py`) carries the lab's reference data and evaluation results. Everything in the tab works with the lab stopped; only the status dot needs it running.

## Context: two checkouts, one operator

```mermaid
flowchart LR
  OP["Operator"] --> TAB["Self-Learning tab<br/>status · links · concept bridge<br/>js/selflearn.js"]
  TAB --> LAB["Self-Learning Agent Lab<br/>FastAPI + dashboard :8220<br/>sibling checkout"]
  LAB --> FOX["fox-services :8210<br/>model backend"]
  TAB --> CAT["Catalog<br/>patterns · scenarios<br/>data/*.json (read-only)"]
  LAB --> REF["reference/*.json<br/>landscape · benchmarks<br/>live validation"]
  REF --> BOOK["Self-Learning book<br/>tools/build_sl_book.py"]
  CAT --> BOOK
```

The arrow from the tab to the lab is deliberately thin: a reachability probe and outbound links. No lab state is read into the app, no app state is written into the lab. The thick arrow is the build-time one: the book generator reads the lab's reference data and this catalog together, so the supplement cannot disagree with either.

## Modules: what the tab owns

```mermaid
flowchart TB
  subgraph TAB2["js/selflearn.js — static, offline-first"]
    PROBE["Status probe<br/>same-origin /api/selflearn/health?port=<br/>serve.py checks lab loopback (4 s timeout)"]
    LINKS["Deep links<br/>dashboard · run.sh · compose"]
    BRIDGE["Concept bridge<br/>12 mechanisms → patterns + scenarios"]
    CFG["Port config<br/>localStorage · re-probe"]
  end
  PROBE --> DOT["status dot<br/>up · down · unknown"]
  BRIDGE --> CAT2["openPattern / goTo<br/>into the catalog"]
```

## Sequence: the probe that cannot read

```mermaid
sequenceDiagram
  autonumber
  participant T as Self-Learning tab
  participant S as This app (serve.py)
  participant L as Lab :8220
  participant O as Operator

  T->>S: GET /api/selflearn/health?port=8220 (same-origin, 4 s timeout)
  S->>L: GET /api/health on loopback
  alt port answers
    S-->>T: {ok: true}
    T->>T: status = up — show Open dashboard
  else refused / timeout
    S-->>T: {ok: false}
    T->>T: status = down — show run instructions
  end
  O->>T: Check lab / change port
  T->>S: probe again
```

The lab ships no CORS headers, so the browser never contacts it directly — and the tab never tries. The same-origin proxy proves the port answers from the server's loopback; anything else proves nothing except that the lab is not there right now. Richer live embedding (run lists, metric tables inside this tab) waits on a one-line CORS allowance on the lab side; until then the dashboard link is the integration.

## Data flow: the book reads both repos

```mermaid
flowchart LR
  subgraph ADDON["sibling checkout"]
    R["reference/*.json<br/>21 concepts · 51 works · 9 axes<br/>bands · calibration"]
    D["design/*.md figures<br/>context · suite · landscape"]
    S["app/streams.py + evolvers.py<br/>18 scenarios · 6 evolvers"]
  end
  subgraph APP["this checkout"]
    C["data/*.json<br/>patterns · scenarios"]
  end
  R & D & S & C --> GEN["tools/build_sl_book.py<br/>extract · measure · map"]
  GEN --> MD["book/SELF-LEARNING-AGENTS.md"]
  MD --> PDF["book/Self-Learning-Agents.pdf<br/>same two-pass typesetter"]
```

The generator fails loudly when the sibling checkout is absent — a supplement built without its sources would be fiction, and the build refuses to ship fiction. Scenario and evolver inventories are imported from the lab's own modules at build time, never retyped, so a renamed stream breaks the build instead of silently aging the book.
