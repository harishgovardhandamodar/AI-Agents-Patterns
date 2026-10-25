# AI Agent Patterns & Guardrails

An interactive dashboard for the full lifecycle of designing an AI agent: **design patterns → what can go wrong → how to protect → live control-flow simulation → architecture (UML) → a lab that turns your own agent idea into a guardrail design with a mock run → a battle-test bench that runs the catalog's 54 failure scenarios against a configuration and grades whether the controls held.**

It is a **no-build single-page app** — vanilla JS, CSS custom properties, and Mermaid diagrams rendered at view time (Mermaid is vendored under `js/vendor/`, so diagrams work on a LAN-only or air-gapped host with no third-party fetch). The only server piece is `serve.py`: a thin static host plus an optional **same-origin LLM proxy** (`/api/llm/*`) that fans out to tailnet model backends (axiom first, Fox-Services fallback). No data ever leaves your network for a third-party cloud.

The **Design & Architecture** tab follows the same pattern as the *Agentic Knowledge Mapper* classic GUI: markdown documents in `design/` are fetched and rendered live, with ` ```mermaid ` fenced blocks becoming interactive diagrams (with a pan/zoom "enlarge" viewer). Nothing is a screenshot.

---

## The workflow

The app is built around a five-stage chain, and every tool belongs to one of
its stages. A **project** (the 📁 chip in the top bar) is a named workspace
that holds everything you produce for one system, so the planner, the
blueprint, the guardrail analyses, the mitigation backlog and the pins all
describe the *same* system.

```
  discover  →  research  →  design  →  harden  →  deliver
  Overview     Scenarios     Deployment   Blueprints     Export
  Patterns     Cascades      Planner      Guardrail Lab  (report)
                             Coverage     Discovery
                                         Battle Bench
```

The Overview shows this chain as a **rail** with each stage's live state, and
a **Next:** box that reads *every* tool — not just the three it used to know
about — to name the single most useful next action.

| Seam | What it does |
|---|---|
| Planner → Blueprint | "Materialise as blueprint" turns the recommended stack's 13 catalog patterns into a canvas. |
| Guardrail Lab → Blueprint | The analysis's 9 reference controls are mapped to the catalog patterns that implement them and land on the canvas. |
| Guardrail Lab → Live View | The mock run is already a replayable trace — promote it into the trace library and play it beside the 39 catalog traces. |
| Mitigation backlog → Blueprint | "Seed blueprint from top 10" pushes the highest-leverage un-owned controls onto the canvas. |
| Anything → Fox - Architect | "Ask" sends the *artefact* (the pattern's failure modes, the scenario's attack chain, the cascade's propagation path), not its title. |

Every destination is a real link: `#blueprint/current`, `#deploy/plan`,
`#discovery/run`, `#blueprint/lib:N`, `#overview/proj:<id>` and the catalog
ids — all shareable, and the browser Back button closes the drawer rather
than leaving the app.

---

## Run it

### Docker — LAN + Tailscale (recommended)

```bash
docker compose up -d --build
```

Published on `0.0.0.0:${APP_PORT:-5175}`. It is reachable immediately from:

| From | URL |
|---|---|
| The host | `http://localhost:5175` |
| Your LAN | `http://<host-lan-ip>:5175` |
| Tailscale tailnet | `http://<host>.<tailnet>.ts.net:5175` · `http://<host-tailscale-ip>:5175` |

This rides on the Tailscale already running on the host, so **no auth key is needed**. Change the port with `APP_PORT` in a `.env` file.

**Dedicated Tailscale node** (its own hostname and an HTTPS URL) via the sidecar pattern:

```bash
cp .env.example .env                                   # set TS_AUTHKEY (+ TS_HOSTNAME)
docker compose -f docker-compose.tailscale.yml up -d --build
# -> https://<TS_HOSTNAME>.<your-tailnet>.ts.net   (and still LAN on :5175)
```

The `web` container shares the Tailscale sidecar's network namespace, so `tailscale serve` proxies to it on `127.0.0.1:8080`. Requires HTTPS certificates enabled for the tailnet (admin console → DNS → HTTPS Certificates); if they are not, switch `tailscale/serve.json` to plain HTTP on port 80.

The image is ~42 MB, runs as unprivileged `uid 10001` with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, and a container healthcheck.

### Without Docker

```bash
python3 serve.py           # then open http://localhost:5175
python3 serve.py 8080      # custom port
```

A server is needed because the Design tab fetches `design/*.md` (`file://` would block that fetch) and because Fox - Architect answers through the same-origin `/api/llm/*` proxy. Any static host works if you don't need the model backend (the app degrades to a deterministic catalog fallback).

---

## Six sections, fifteen tabs

The top strip holds six sections; the strip beneath holds the active
section's tabs (each section remembers its last tab). Panes, hashes and deep
links still use the fifteen tab ids, so every saved link keeps working:

| Section | Tabs |
|---|---|
| 📊 Overview | Overview |
| ◆ Catalog | Patterns · Scenarios · Cascades · Coverage & Gaps · Live View |
| 🧭 Design | Deployment Plan · Blueprints |
| 🧪 Labs | Guardrail Lab · Discovery Lab · Battle Bench |
| 🛡 Agents | Rogue Agents · Self-Learning |
| 🤖 Architect | Fox - Architect · Design & Architecture |

| Tab | What it does |
|---|---|
| **Overview** | Landing page (hero, new-in-catalog spotlight, dated field notes mapped to the catalog, incident-anatomy diagram, cascade-class chart) plus the architect dashboard: a **five-stage workflow rail** (discover → research → design → harden → deliver) with each stage's live state, a "Next:" suggestion that reads every tool, the planner / blueprint / copilot / guardrail / mitigation / discovery cards, a pinned working set and report export. Also totals, patterns-per-category, scenarios-by-severity, domain coverage, and a "how defenses stack" view of protection layers. |
| **Fox - Architect** | Chat with Qwen 3.8-27B (`quai-qwen3.8-27b`, served via **axiom first**, Fox-Services fallback, `LLM_PRIMARY` to flip) grounded in the catalog through the server-side proxy; streaming, citations, scope toggles, tables and Mermaid diagrams in answers, message actions (copy/regenerate), follow-ups, and a deterministic offline fallback. |
| **Patterns** | The catalog: **107 design patterns** across 9 categories, each with how it works, components, failure modes, protections, related patterns, and a control-flow diagram (32 diagrams; every pattern also gets its category diagram). Filter by category, domain, or "has diagram / has failures"; card or compact-list layout; least-protected-first sort. |
| **Scenarios** | **54 failure scenarios** across 26 domains (18 critical / 27 high / 9 medium) — including five on **self-improving agents** (reward hacking, self-distillation collapse, prompt self-editing, spawn-fleet runaway, metric gaming) and a pack covering the formerly patterns-only domains (content, cybersecurity, data, education, energy, governance, operations, robotics, sales, strategy, trading). Each opens to the attack chain, protection table, detection signals, incident response, and — where a replay is published — a mock run; scenarios without one are badged **no replay** and route you to Coverage & Gaps. |
| **Cascades** | **191 catalogued composition cascades** in four classes (inherent, derived, emergent, cascading) with propagation paths, amplifiers, blast radius, detection and mitigation columns, plus a simulator and bidirectional links to the patterns/scenarios they involve. Paged explorer + ranked mitigation backlog (leverage-scored, owner/status tracked, with a progress panel and a "seed blueprint from the top 10" action). |
| **Coverage** | Gap view: heatmap of patterns/scenarios/cascade-classes per domain, a **scenario-budget** bar chart (target ≥ 2 per domain, 7/26 meet it), ranked gap cards with concrete authoring suggestions, an **exportable backlog** (Markdown checklist / CSV) for a team to pick up, and domain drill-downs into the catalog. |
| **Deployment Plan** | Four-step intake → readiness scorecard across weighted dimensions → recommended stack + guardrail config → autonomy/rollout dial → residual-risk register → ADR generator (citations validated against the catalog). |
| **Blueprints** | Reference-architecture builder: compose patterns from templates or the palette into a pipeline + control overlay, with Mermaid export, deterministic warnings, a cost/latency/risk estimator, a per-blueprint **threat model** (exposure index vs. the catalog ceiling, matched scenarios/cascades/failure modes, one-click add of missing defenses) and **baseline compare** (template/library diff with metric deltas, undoable restore). The palette multi-selects, with a live preview of what the addition will close. |
| **Live View** | An exhaustive, filterable library of **55 mock execution traces**, linked from the scenarios that have replays. The control-flow diagram highlights the active node while the step tracker, budget/cost/token gauges, guardrail counters, and event log advance in sync. Play / step / back / reset with adjustable speed; filter by domain, severity, verdict or free text. |
| **Design & Architecture** | UML & architecture documents with live Mermaid — **eleven docs**: system context, component/class UML, control flow & runtime, financial guardrail architecture, data model (ER), threat model, the architect value map, runtime/offline/delivery, the Battle Bench architecture, the Rogue Agents architecture, and the self-learning add-on bridge. Rail + scroll-spy outline + source toggle + zoom viewer (wheel zoom, drag pan, ←/→ step). Loaded lazily on first visit. |
| **Guardrail Lab** | Type any agent idea and it is analyzed into a full design (see below). Every analysis is saved to a collection in `localStorage` and exportable as JSON. The analysis is not a dead end: its controls map to catalog patterns that land on your blueprint, and its mock run can be promoted into the Live View trace library. |
| **Discovery Lab** | Deterministic, grounded *ideation* of novel scenarios (after "Scaling Discovery Requires Forgetting"): each round generates parallel candidates, keeps only the winners and forgets the rest, reseeding the next round from the winners alone — with a compare mode that runs the same budget with forgetting off to show the plateau on this catalog. Winners are drafts only (never auto-added): **promote** one into a catalog-shaped scenario you can review, ask Fox - Architect about, or export as JSON. |
| **Battle Bench** | The catalog **testing itself**: every one of the 54 failure scenarios becomes a test case against a *configuration* (a set of controls an agent would deploy), run through interchangeable adapters — deterministic guardrail simulation, golden trace replay (all 55 traces), or the live local model with the backend pinned per run — and graded by an oracle that derives its assertions from each scenario's own protections. Full coverage by construction (cases = corpus × configs); configs are checked against the Deployment Plan's option tables so the bench cannot drift from the app. Includes an **adversary** (ranked exposure, a mutation sweep that finds the load-bearing control, a live red-team loop), **model comparison** (diff verdicts across two models, regressions flagged), a run store for cross-time comparison, and Markdown/JSON report export. See `BATTLE-ANALYSIS.md` for the analysis and findings. |
| **Rogue Agents** | One compromised agent in a 300-agent swarm: injects six rogue archetypes (goal hijack, exfiltration, capability abuse, collusion, slow drift, sybil spawn) into a deterministic simulation, scores three detectors (behavioural deviation, goal misalignment, collusion) with median + MAD baselines, runs the automated isolation workflow against remediation SLAs, and keeps what works as runtime guardrails. Four staged views (setup → results → quarantine board → guardrails) with per-rogue inspection, a live wall-clock SLA board with owners and a fleet kill switch, and leave-one-out + solo counterfactuals proving which controls carry the result. Seven domain themes (fintech, trading, medical advice, research landscape, vulnerability detection, drug discovery, plus the general swarm) reskin roles and tool vocabulary on the same engine; **live fire** hands each rogue's campaign to the model via fox-services (capped swarm/horizon, fallbacks flagged) while detection and quarantine stay engine-side. See the tab's honest caveat: a passing run proves the controls are wired, not that any agent is safe. |
| **Self-Learning** | Add-on bridge to the Self-Learning Agent Lab (sibling checkout, FastAPI on :8220): live reachability status, deep links and run instructions, plus a concept bridge mapping each lab mechanism (task-scoped learning, workflow conditioning, evolvers, streams, continual-learning metrics) to the catalog patterns and scenarios that already cover it. Companion book via `npm run book:self`. |

**Global**: `Ctrl/⌘ K` (or `/`) opens a command palette over everything — patterns,
scenarios, cascades, tabs, templates, saved blueprints, **projects, research sets
and workflow commands** — plus one-shot **commands** (`>` prefix), scoped prefixes
(`pat:`/`scn:`/`cas:`/`proj:`/`stage:`), recents and usage learning.
`?` shows keyboard shortcuts; `Alt+1…6` jump between the six sections; `ⓘ guide` opens a
contextual guide for the current tab (with glossary). `Ctrl+Z` / `Ctrl+Shift+Z`
undo and redo destructive actions (including mitigation owners, risk
acknowledgements and copilot regeneration); the 🔔 bell keeps a notification
history; `⛭ display` controls density and text size. The Overview export row
produces a full architect report — Markdown, JSON, or a print-friendly page —
covering **all eight work products**: the deployment plan, the blueprint and its
threat model, the guardrail analyses, the cascade mitigation backlog with its
owners, the pinned working set, the discovery drafts, the Fox - Architect
transcript and the saved battle-bench runs.

---

## The Guardrail Lab

Paste a request such as:

> *"Think of AI agent that can spend money using company/corporate cards to complete tasks. One prompt injection may trigger $50,000 purchase of unnecessary services. How do you design financial guardrails for autonomous agents?"*

…and the lab produces an eight-part design (all generated in-browser by a deterministic rule engine — auditable and reproducible, which is the point):

1. **Risk assessment** — a 0–100 score from detected action classes (money movement, injection exposure, irreversible effects, PII, autonomy, scale, physical effects, code execution) × signal weights, mapped to a tier.
2. **Advice** — how to think about the problem (e.g. *separate the model from the money*; *defense in depth beats a perfect shield*).
3. **Design proposals** — tiered options (baseline gateway → two-key execution → zero-trust context pipeline → capability-scoped sandboxes) with pros/cons and a recommendation matched to the risk level.
4. **Guardrail architecture** — a Mermaid diagram of the actual enforcement points for this request.
5. **Reference control set** — a table of concrete controls with their layer, enforcement mode, and rationale.
6. **Cascade-aware rules** — the composition cascades catalogued for the detected domain (plus general), each broken into a copyable pseudo-config rule (`when` detection signals, `then` containment, `else` residual alert) that cites the cascade it breaks.
7. **Mock run with data — a live replay** — the attack path (blocked) and the legitimate path (approved) played back through the same player as the Live View: control-flow highlighting, step tracker, gauges and streaming event log, driven by a **Play / step / back / reset** control bar. Outcome metrics are shown alongside.
8. **Rollout plan** — instrument → shadow → ramp → continuous red-teaming, with success criteria.

A **seeded example** (the corporate-card scenario above) ships in the collection so the flow is visible on first load. Twelve one-click example requests are provided: card spend, prod-access coding agent, auto-emailing support, clinical triage, autonomous trading, finance and clinical agent swarms, self-tuning spend controls, self-learning triage, drug discovery, novelty-check research, and risk-landscape monitoring.

---

## The Battle Bench

The Guardrail Lab designs controls; the **Battle Bench** tests whether they hold. It is the catalog turned on itself: every one of the 54 failure scenarios becomes a test case against a *configuration* — the set of controls an agent would actually deploy.

- **Cases by derivation, not by hand.** A case = (scenario × configuration × context), so full coverage is a property of the math: add a scenario or a config and its cases appear. `btCoverage()` reports what a run did *not* test.
- **Configs cannot drift from the app.** The bench's configuration dimensions are derived from the Deployment Plan's own option tables, and a drift check (`btCheckDimSync`) fails loudly if the two ever disagree.
- **Three adapters answer the same cases**: `guardrail` (deterministic simulation — 108 cases in ~190 ms, so the bench works with no GPU), `golden` (replays all 55 catalog traces), and `live` (the local Qwen 3.8-27B, with the backend **pinned per run** via `X-Fox-Backend` and recorded in every result). A new executor registers with `btRegisterAdapter` and slots straight in.
- **The oracle grades honestly.** Assertions are derived from each scenario's own protections; errored and skipped runs are never counted as passes. It found two of its own rules to be wrong (a coverage ratio, not an identity check; escaped spend, not attempted spend) and one real catalog gap (`infinite-loop-cost` has no stopping control).
- **An adversary attacks the configuration**: ranked *exposure* (which scenarios a config leaves uncovered), a *mutation sweep* that erodes a passing baseline one dial at a time to name the load-bearing control (measured: the human gate), and a live *red-team* loop where the model writes the attack and the oracle grades it for named-but-missing controls.
- **Compare models** runs the same cases against two backends and diffs the verdicts — regressions and improvements listed explicitly, errors kept visible.

Runs are stored locally so they are comparable across time, and the report exports as Markdown or JSON. Honest caveats, printed in the report itself: a passing synthetic run proves the *controls are wired*, not that any agent is safe — and ~1 live call in 4 can return an empty completion (a reasoning model's budget problem), which the bench reports as an error, never as a pass. The full analysis and findings are in `BATTLE-ANALYSIS.md`; the architecture in `design/09-battle-bench.md`.

---

## What the flagship example demonstrates

The $50k card scenario is stopped by **five independent layers**, each assuming the ones above will fail:

| Layer | Control | Stops |
|---|---|---|
| 1 · Context | Injection shield on untrusted content | The instruction never becomes an instruction |
| 2 · Authority | Scoped tokens, no PAN in model context | Even a steered agent has nothing to move |
| 3 · Runtime policy | Spend guard: per-txn cap, rolling windows, vendor allowlist, velocity | The $50k charge is denied deterministically |
| 4 · Human process | Dual control above threshold, hash-bound approvals | The acting agent can never be its own approver |
| 5 · Infrastructure | Processor-level hard caps + revocation | Worst-case loss is bounded even on total software failure |

Outcome in the mock run: attempted $50,000 → **denied at the policy gateway, contained in 2.8s, $0 moved**, full provenance chain sealed — while a legitimate $3,850 order flows through the same guardrails and completes.

---

## Project structure

```
index.html                 single-page shell (tabs + panes + overlays)
css/styles.css             GitHub-dark palette via CSS custom properties; light theme
js/app.js                  shell: tabs, theme, data load, Mermaid queue, zoom viewer, drawer, goTo()
js/project.js              project spine: named workspaces owning the plan, blueprint, guards, backlog, pins
js/workflow.js             the five stages, the "Next:" engine and the workflow rail
js/ressets.js              saved research sets (named, shareable filter states)
js/player.js               reusable playback widget (Live View + Guardrail Lab)
js/patterns.js             Overview stats + Patterns catalog
js/scenarios.js            Scenarios catalog + detail drawer
js/cascades.js             Cascade explorer, simulator, mitigation planner
js/coverage.js             control-family coverage index
js/deploy.js               deployment planner (intake, scorecard, stack, rollout, risks, ADR)
js/blueprints.js           reference-architecture builder + estimator + threat model
js/copilot.js              Fox - Architect chat (rendering, tables, diagrams, citations, fallback)
js/context.js              catalog grounding context builder
js/llm.js                  LLM client (watchdog, streaming, backend pill)
js/help.js                 contextual per-tab guide + glossary
js/landing.js              Overview landing page (hero, spotlight, field notes, diagrams)
js/live.js                 trace library (filters) driving the player
js/design.js               markdown renderer + Design & Architecture tab (lazy)
js/guardrail.js            Guardrail Lab rule engine + collection + replay + cascade rules
js/bench.js                Battle Bench engine: config/context/case model, adapters, oracle, runner, run store
js/adversary.js            bench adversary: exposure probe, mutation sweep, live red-team loop
js/benchui.js              Battle Bench tab: matrix, config editor, adversary panel, model compare, report
js/rogue.js                Rogue Agents tab: swarm simulator, detectors, quarantine board, guardrail counterfactuals
js/selflearn.js            Self-Learning tab: add-on bridge (lab status, deep links, catalog concept map)
js/books.js                Bookshelf panel (Overview): landscape inventory + rebuild all books via /api/books/*
js/dashboard.js            architect dashboard projection on Overview
js/palette.js              Ctrl/⌘K command palette (catalog, projects, research sets, workflow commands)
js/shortcuts.js            global keyboard shortcuts + help
js/vendor/mermaid.min.js   Mermaid 10, vendored so diagrams work air-gapped (no CDN fetch, ever)
js/report.js               full report export (Markdown / JSON / print) — all 7 work products
data/patterns.json         107 patterns, categories, category diagrams
data/scenarios.json        54 scenarios (attack chains, protections, detection, response)
data/cascades.json         191 composition cascades (four classes)
data/traces.json           55 mock execution traces (every scenario links a replay; 16 generated by tools/gen_traces.py)
data/coverage.json         control-family coverage index (26 domains)
tools/gen_cascades.py      cascade dataset generator
tools/gen_coverage.py      coverage-index generator (byte-identical on unchanged data)
tools/gen_traces.py        deterministic trace generator: scenario record -> replayable trace (the 16 that had none)
tools/build_book.py        book generator: catalog JSON -> book Markdown + print HTML (stdlib only)
tools/build_rogue_book.py  supplement generator: catalog + js/rogue.js + design/10 -> Rogue Agents Markdown + print HTML (stdlib only + node)
tools/build_sl_book.py     supplement generator: sibling lab + catalog -> Self-Learning Agents Markdown + print HTML (stdlib only; needs ../self-learning-agents checkout via SL_DIR)
tools/render_pdf.mjs       book typesetter: headless Chrome + vendored Mermaid -> PDF (2-pass Contents)
tools/book_pdf.py          PDF post-pass (pypdf): reads link destinations, writes sidebar bookmarks
book/AGENTIC-PATTERNS-AND-GUARDRAILS.md   generated book (114 chapters, 10 parts)
book/Agentic-Design-Patterns-and-Guardrails.pdf   rendered book (498 pp, 138 diagrams, 132 linked contents entries)
book/ROGUE-AGENTS.md   generated supplement (7 parts + appendices, 25 diagrams, rogue readings of all 54 scenarios + 7 illustrated theme case studies)
book/Rogue-Agents.pdf      rendered supplement (53 pp, 25 diagrams, 46 linked contents entries)
book/SELF-LEARNING-AGENTS.md   generated supplement (6 parts + appendices, 15 diagrams, lab inventory + landscape + catalog bridge + the learning loop in detail)
book/Self-Learning-Agents.pdf   rendered supplement (83 pp, 15 diagrams, 30 linked contents entries)
design/*.md                10 UML/architecture docs (56 Mermaid diagrams total)
BATTLE-ANALYSIS.md         battle-test bench: analysis, 20-iteration plan, first-campaign findings
sw.js                      service worker: precaches the whole shell for offline / air-gapped use
serve.py                   thin static server + /api/llm/* proxy (axiom-first failover, watchdog, LLM_PRIMARY, X-Fox-Backend pinning) + /api/selflearn/health + /api/books/* (landscape collect + rebuild jobs for all three books)
Dockerfile                 image: python:3.12-slim, non-root, read-only, healthcheck
docker-compose.yml         default deployment (LAN + host Tailscale)
docker-compose.tailscale.yml   dedicated Tailscale node (+ HTTPS URL)
tailscale/serve.json       Tailscale Serve config for the sidecar deployment
.env.example               APP_PORT, TS_AUTHKEY, TS_HOSTNAME
package.json               dev scripts: npm run serve / test / test:e2e / lint / gen / book / book:rogue / check / check:all
eslint.config.mjs          flat ESLint config; no-undef over the app's shared global namespace
test/data.test.mjs         catalog integrity, schema guard, coverage freshness, SW precache sync
test/smoke.mjs             headless smoke (boots the server, walks all 15 tabs + the workflow journey, asserts 0 errors)
.github/workflows/ci.yml   CI: lint + data integrity, headless smoke (both blocking)
```

Load order matters and is fixed in `index.html`: `app.js` defines the shell (`switchTab`, `mmRender`, `openDetail`, `openZoom`, the `tabLoaders` registry), `player.js` defines the reusable `LivePlayer` widget, then each tab module registers its `init*` and `tabLoaders` entry. Cross-module calls are guarded with `typeof … === "function"` so a module can fail without taking the shell down.

## Design notes

- **One sequential Mermaid render queue.** Mermaid measures labels in shared global state, so concurrent renders corrupt each other. All renders pass through a single promise chain (`mmRender`), and each node's source is kept in `data-src` for theme re-renders. Re-rendering resets `data-processed` (Mermaid skips already-processed nodes otherwise).
- **The zoom viewer clones the rendered SVG** — it never re-runs Mermaid — so the "enlarge" view can never disagree with the inline diagram.
- **Theme** is a single CSS class on `<html>`; Mermaid theme variables are derived from it, and toggling re-renders every diagram with the new palette.
- **Live View joins steps to the diagram via node ids** (`step.node` ↔ Mermaid node id), which is what drives the active-node highlight.

## The book

`book/` holds *Agentic Design Patterns & Guardrails — A Hands-On Guide to Designing, Hardening and Operating AI Agents* (Harish Govardhan Damodar), generated from the catalog:

- **`book/AGENTIC-PATTERNS-AND-GUARDRAILS.md`** — 114 chapters across 10 parts: one per catalog pattern across the 9 category parts, in catalog order, then 7 chapters closing on Part X, *The Application* (the seventh, *Testing the Defenses*, is the battle-test bench: the catalog testing itself). The 107 pattern chapters run *Pattern Overview → Practical Applications & Use Cases → How It Works → Components → Control-Flow Diagram → Failure Modes and Risks → Protections → At a Glance → Key Takeaways → References and Related Patterns → Council reading (red team / blue team / operator, argued from the chapter's own records) → Conclusion*; the Part X chapters keep the same order as *Overview → Why It Matters → How It Works → Components → figure → Risks and Limitations → Safeguards → At a Glance → Key Takeaways → References → Council reading → Conclusion*. Full front matter (title page with byline, edition page, preface, acknowledgment, introduction, "What makes an AI system an agent?", contents) and back matter (glossary from `js/help.js`, index of terms, conclusion, colophon).
- **`book/Agentic-Design-Patterns-and-Guardrails.pdf`** — the rendered book (498 pp, 138 diagrams), typeset by headless Chrome with the vendored Mermaid, so every figure is Mermaid source the app itself renders — same engine, same diagrams (the pattern figures come from the catalog, the Part X figures from `design/*.md`, exactly as the Design tab renders them). Its Contents (132 entries: front matter, all 10 parts, all 114 chapters, back matter) is a live link set with printed page numbers, and the reader's sidebar gets the same 132 entries as bookmarks.

Regenerate both with **`npm run book`** (`tools/build_book.py` → Markdown + print HTML, then `tools/render_pdf.mjs` → PDF). The generator is stdlib-only Python and deterministic: pattern chapters are built from `data/*.json` plus the glossary in `js/help.js`, so they cannot drift from the catalog they describe, and the six Part X chapters are built from the repo itself — `README.md`, `design/*.md`, `serve.py`, `sw.js`, `index.html`, `Dockerfile`/compose, with every count they cite recomputed from disk by `book_stats()` at build time (a stale number fails the build instead of shipping). `book/agent-patterns-and-guardrails.html` is an ignored intermediate (the PDF is printed from it).

The supplement ***Self-Learning Agents — Continual Learning, Task-Scoped Adaptation, and the Evaluation Discipline That Keeps Them Honest*** (`book/SELF-LEARNING-AGENTS.md`) is generated by **`npm run book:self`** (`tools/build_sl_book.py` → Markdown + print HTML). It imports the lab's scenario and evolver inventory from the sibling checkout's own modules, reads its reference data (`landscape.json`: 9 dimensions, 21 concepts, 51 verified works; `benchmarks.json`: measured bands with source; `live_validation.json`: simulated-vs-live calibration), embeds 12 figures from the lab's `design/*.md` — the same sources its Design tab renders — and bridges every mechanism to this catalog's patterns and scenarios. The build fails if the sibling checkout is absent, any mapped id leaves either catalog, or any placed figure goes missing. The PDF is printed with the same two-pass typesetter (`node tools/render_pdf.mjs book/self-learning-agents.html book/Self-Learning-Agents.pdf "Self-Learning Agents"`).

The supplement ***Rogue Agents — What They Are, How to Detect Them, and How to Operate Swarms Safely*** (`book/ROGUE-AGENTS.md`, rendered as `book/Rogue-Agents.pdf`) is generated by **`npm run book:rogue`** (`tools/build_rogue_book.py` → Markdown + print HTML). It pulls its archetypes, detectors, controls, SLAs and themes out of `js/rogue.js` at build time via node, runs the reference simulation campaign during the build for every measured number, reads all 54 scenarios through the rogue lens (road + archetype + one-clause reading, across all 26 domains), and embeds the 8 figures from `design/10-rogue-agents.md` — the same sources the Design tab renders. The build fails if any scenario lacks a reading, any referenced pattern id leaves the catalog, or any placed figure goes missing. The PDF is printed with the same two-pass typesetter as the main book (`node tools/render_pdf.mjs book/rogue-agents.html book/Rogue-Agents.pdf "Rogue Agents"`), so its Contents is a live link set with verified page numbers and matching sidebar bookmarks.

The Contents page numbers are the one thing that cannot be computed up front: Chrome implements neither CSS `target-counter` (it renders nothing) nor any "which page did #anchor land on" API, so `render_pdf.mjs` renders once with `000` placeholders, reads the real pages back off Chrome's own `/Dests` name tree via `tools/book_pdf.py`, fills them in, renders again, and re-reads to prove the printed numbers still equal the link targets — reflowing the Contents would change the targets, so the loop settles on a fixed point (bounded at 4 passes, then it fails the build rather than shipping wrong numbers). The same read-back is the post-condition for the final step: `book_pdf.py outline` writes the 132 sidebar bookmarks, which `page.pdf()` never emits, and the build then verifies that rewrite dropped no link, destination or page. Those two steps are the only place `pypdf` is used (`python3 -m pip install --user pypdf`); every other step is stdlib + Node + vendored Mermaid, so the pipeline stays offline-safe.

The reference book's chapter template was matched section-for-section; where it runs a *Hands-On Code Example*, this book runs the catalog's real `how`/`components`/`failures`/`protections` records — no per-pattern code was invented.

## Testing, offline & performance

- **First load is ~1.37 MB, not ~4.9 MB.** `serve.py` gzips compressible types and caches each compression on `(mtime, size)`, sends the vendored Mermaid with `immutable` caching, and revalidates everything else with `Last-Modified`/`If-Modified-Since` (cheap 304s). Repeat visits transfer ~0.02 MB.
- **Offline shell.** `sw.js` precaches the whole app (html, css, the 27 scripts, the vendored Mermaid, all `data/*.json` and `design/*.md` — 44 entries) and serves same-origin GETs network-first with a cache fallback. It never touches `/api/*` (the LLM proxy and the diagnostics beacon). After one visit the app works with no network at all; the offline chip reads *Offline · cached*. Bump `VERSION` in `sw.js` to force every client to re-precache.
- **Perf budget** is printed in the Display panel (⛭ display): requests this session, how many were answered locally, bytes actually pulled over the wire, and the size of the offline cache — so the wins above are visible, not claims.
- **Tests & lint (no build step added):** `npm test` runs a dependency-free `node:test` suite over the catalog — id uniqueness, full referential integrity, a required/unexpected-key schema guard (it catches typos like the historical `proteations`), coverage.json freshness (recomputed from the catalogs), bench/planner dimension sync, and that `sw.js`'s precache list matches the files on disk. `npm run lint` runs ESLint with `no-undef` across every `js/*.js`, treating the app's own top-level declarations as shared globals so genuine typos fail and cross-file calls don't. `npm run test:e2e` boots the real server and walks all 15 tabs headlessly; it skips cleanly when no browser is present locally, but under `CI=1` a missing browser fails the run. `npm run check` runs lint + tests; `npm run check:all` adds the headless smoke. CI (`.github/workflows/ci.yml`) gates on lint + data integrity **and** the headless smoke.

## Extending it

- **Add a pattern:** append to `data/patterns.json` `patterns[]` with a `cat` from `categories[]`; optional `diagram` is Mermaid source (use `"double quotes"` around labels containing parentheses).
- **Add a scenario:** append to `data/scenarios.json`; set `traceId` to link a mock run.
- **Add a trace:** append to `data/traces.json`; give each step a `node` matching a node id in `flow`, and keep node ids non-overlapping (zero-pad numeric ids, e.g. `N01`, `N02`, so `N1` never matches inside `N10`).
- **Add a design doc:** add the file under `design/` and register it in `DESIGN_DOCS` at the top of `js/app.js`.
- **Add a battle-bench configuration:** `btDefaultConfigs()` in `js/bench.js` (or import a saved one in the tab's config editor) — new configs automatically get cases for all 54 scenarios. Add a *dimension* by extending `btConfig` **and** the Deployment Plan's option table; `btCheckDimSync` runs when the bench initialises (and in `npm test`), so a mismatch is loud until both agree.
- **Add a battle-bench adapter:** `btRegisterAdapter({ id, label, needsModel, run(case) → result })` — the oracle, runner, store and UI pick it up unchanged.
- **Add any served file:** add it to the `PRECACHE` list in `sw.js` too — `npm test` fails if the offline shell misses a file under `js/`, `data/`, `design/` or `css/`.
- **Regenerate derived data:** after editing scenarios, run `npm run gen` (`tools/gen_cascades.py && tools/gen_coverage.py`); the integrity test fails if `data/coverage.json` is stale.

All datasets are plain JSON, versioned, and diffable. There are no hidden defaults — a missing field renders as absent, never as a silently-chosen value.

---

## Scope

107 design patterns · 207 documented failure modes · 54 failure scenarios (18 critical / 27 high / 9 medium) · 191 composition cascades · 26 scenario domains · 55 replayable mock traces · 11 architecture documents · 60 Mermaid diagrams in the design docs (+32 pattern control-flow diagrams) · Fox - Architect on Qwen 3.8-27B (axiom primary, Fox-Services fallback, deterministic offline fallback) · deployment planner with ADR export · blueprint builder with threat-model exposure index and baseline compare · battle-test bench (54 scenarios × configurations, three adapters, oracle, adversary, model comparison) · command palette (commands, recents, projects, research sets, workflow commands) and keyboard shortcuts · full report export covering all eight work products · bookshelf panel (landscape collect + one-click rebuild of all three books) · project workspaces that carry the whole job · saved research sets · offline service worker + perf budget · linted, tested, CI-gated (no build step).

**Caveats, honestly:** the exposure index measures matched threat *surface* from the catalog, not measured risk — compare like-for-like blueprints. The copilot's grounding is deterministic retrieval, not RAG fine-tuning; when both LLM backends are down it degrades to a deterministic catalog answer rather than failing. Cost/latency figures are estimates from stated assumptions, not benchmarks. A project lives in this browser's `localStorage` — back it up (⛭ display → Back up all) before clearing site data. Promoted discovery drafts are *your* drafts, not catalog entries: the shipped `data/*.json` is read-only.
