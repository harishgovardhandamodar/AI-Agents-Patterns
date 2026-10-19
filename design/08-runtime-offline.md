# Runtime, Offline & Delivery

How the app actually runs: a no-build shell that paints the panes you opened before the heavy datasets land, renders diagrams through one vendored queue, keeps working with no network at all, and is delivered with compression, caching and defensive headers — plus the tests that keep all of it honest.

## The shell is one global namespace, loaded in order

`index.html` loads classic scripts — no modules, no bundler, no build step. `app.js` defines the shell (`switchTab`, `mmRender`, `openDetail`, `openZoom`, the `tabLoaders` registry and the `PANE_INIT` bookkeeping); each tab module then registers its `init*()` and its `tabLoaders` entry. Cross-module calls are guarded with `typeof … === "function"`, so any single module can fail without blanking the app.

```mermaid
flowchart LR
  HTML["index.html"] --> APP["app.js — shell"]
  APP --> MOD["per-tab modules<br/>patterns · scenarios<br/>cascades · coverage<br/>deploy · blueprints · copilot · live<br/>design · guardrail · discovery<br/>landing · dashboard"]
  MOD -->|"register init*() + tabLoaders"| APP
  APP --> SW["sw.js registration<br/>(offline shell)"]
```

## Phased boot: first paint never waits for the whole catalog

`loadAll()` awaits only what the first paint and the first panes read — patterns, scenarios, traces and coverage — paints the count badges, and kicks off `cascades.json` in parallel. Cascades (the largest dataset, ~423 KB) is awaited only by the panes that need it, so the tab a user actually opened renders before it lands. Traces stay eager because the Overview stat cards read their count.

```mermaid
flowchart TB
  L["loadAll()"] --> P1["Phase 1 — await<br/>patterns · scenarios · traces · coverage"]
  P1 --> PAINT["paintCounts()<br/>tab badges + dataStatus"]
  PAINT --> EARLY["first panes: overview · patterns · scenarios<br/>plus the hash's pane"]
  PAINT --> P2["Phase 2 — cascades.json in parallel"]
  EARLY --> IDLE["idle queue — one pane init per slice"]
  P2 --> CAT["catalogReady resolves"]
  CAT --> WIDE["palette · dashboard · landing"]
  IDLE --> DONE["all panes built"]
```

### Any pane can jump the queue

`switchTab` calls `paneEnsure`, which runs a not-yet-built pane's init immediately (through `catalogReady`) instead of waiting for the idle pump. A JS-built pane shows a skeleton until its init finishes, so a slow pane can never look blank.

```mermaid
flowchart LR
  CLICK["switchTab(tab)"] --> ENSURE["paneEnsure(tab)"]
  ENSURE -->|"not built"| RUN["paneRunNow<br/>PANE_INIT[tab]() once"]
  RUN --> READY["wait catalogReady"]
  READY --> INIT["initPane()"]
  INIT --> OFF["paneSkeletonOff(tab)"]
  ENSURE -->|"already built"| LOAD["tabLoaders[tab]()"]
  ENSURE -->|"building"| WAIT["let it finish"]
```

## Diagrams: vendored first, one queue

Mermaid ships under `js/vendor/mermaid.min.js`, so diagrams render on a LAN-only or air-gapped host; the CDN is loaded **only if the vendored copy is missing**. Every render — including `mermaid.initialize`, which resets shared global state — passes through a single promise chain (`mmQueue`), because concurrent `run()` calls corrupt each other's label measurement. A node whose SVG is absent gets an inline `.mm-err-note` instead of a silent blank, and a heal pass re-runs only nodes whose layout raced the fonts.

```mermaid
flowchart TB
  REQ["mmRender(nodes)"] --> Q["mmQueue<br/>(single promise chain)"]
  Q --> ENS["mmEnsure()"]
  ENS -->|"window.mermaid?"| HAVE["use it"]
  ENS -->|"no"| VEND["load js/vendor/mermaid.min.js"]
  VEND -->|"missing"| CDN["fall back to jsDelivr"]
  HAVE --> INIT["initialize — theme vars<br/>securityLevel strict"]
  CDN --> INIT
  INIT --> RUN["for each node: mermaid.run"]
  RUN --> OK{"SVG present?"}
  OK -->|"yes"| HEAL["heal pass if fonts raced"]
  OK -->|"no"| ERR["inline .mm-err-note"]
```

## Offline app shell (service worker)

`sw.js` precaches the whole shell — `index.html`, the stylesheet, every script, the vendored Mermaid, and all of `data/*.json` and `design/*.md` — then serves same-origin GETs network-first with a cache fallback. It never touches `/api/*` (the LLM proxy and the diagnostics beacon), so model calls and telemetry always reach the network. After one visit the app works with no network at all; the offline chip reads *Offline · cached*.

```mermaid
flowchart TB
  INST["install"] --> PRE["precache PRECACHE list<br/>(revalidates the shell the page just fetched)"]
  PRE --> ACT["activate — drop older caches<br/>and claim clients"]
  ACT --> FETCH{"fetch — GET, same-origin,<br/>not /api/"}
  FETCH -->|"yes"| NET["network-first"]
  NET -->|"ok"| STASH["stash decoded body in cache<br/>+ x-aap-len size header"]
  NET -->|"offline"| HIT["cache.match(req)<br/>navigation falls back to index.html"]
  FETCH -->|"no"| PASS["pass through untouched"]
```

`VERSION` in `sw.js` is bumped whenever the shell changes; `activate()` deletes every cache that is not the current version, so clients re-precache rather than serve a stale shell.

## Delivery: compression, caching, headers

`serve.py` is the whole server: a thin static host plus the same-origin LLM proxy. It compresses compressible responses once and caches the result per `(path, mtime, size)`, serves the vendored Mermaid as `immutable`, revalidates everything else with `If-Modified-Since`/`Last-Modified` (cheap 304s), and adds defensive headers to every response.

```mermaid
flowchart LR
  REQ["GET /…"] --> GZ{"compressible?"}
  GZ -->|"yes"| CACHE["gzip once<br/>cache by (mtime, size)"]
  GZ -->|"no"| RAW["send as-is"]
  CACHE --> COND{"If-Modified-Since?"}
  RAW --> COND
  COND -->|"not modified"| E304["304 Not Modified"]
  COND -->|"newer"| E200["200 + Last-Modified<br/>+ security headers"]
```

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'`; inline script + style; Mermaid CDN allowed; `connect-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'` | No third-party script, no exfil channel, no framing |
| `X-Content-Type-Options` | `nosniff` | No MIME confusion |
| `X-Frame-Options` | `DENY` | No clickjacking frame |
| `Referrer-Policy` | `no-referrer` | No referrer leakage |
| `Server` | suppressed (`server_version = "aap"`) | No build/version banner |

## Making the wins visible, not claims

The Display panel (⛭ display) prints a live perf budget: requests this session, how many were answered locally, bytes actually pulled over the wire (from the `x-aap-len` sizes the worker recorded), and the size of the offline cache. First load is ~1.37 MB compressed rather than ~4.9 MB raw; a repeat visit transfers ~0.02 MB.

## Guardrails for the app itself

The catalog's thesis — deterministic enforcement outside the model — applies to the project too. There is no build step, but there is a gate.

```mermaid
flowchart LR
  EDIT["edit catalog or shell"] --> LINT["npm run lint<br/>ESLint no-undef<br/>over the shared globals"]
  EDIT --> TEST["npm test (node:test)<br/>ids · schema · references<br/>coverage freshness · SW precache sync"]
  EDIT --> E2E["npm run test:e2e<br/>headless: boot, walk all 12 tabs, 0 errors"]
  LINT --> CI{"CI"}
  TEST --> CI
  E2E -.->|"non-blocking"| CI
  CI -->|"green"| SHIP["ship"]
```

`npm test` fails when a catalog reference dangles, a record gains an unexpected key (how the misspelled `proteations` was caught), `data/coverage.json` is stale, or a shell file is missing from `sw.js`'s precache list. CI gates on lint + data integrity, with the headless smoke test as a non-blocking job.
