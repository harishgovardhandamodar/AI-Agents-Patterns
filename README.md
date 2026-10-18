# AI Agent Patterns & Guardrails

An interactive dashboard for the full lifecycle of designing an AI agent: **design patterns → what can go wrong → how to protect → live control-flow simulation → architecture (UML) → a lab that turns your own agent idea into a guardrail design with a mock run.**

It is a **no-build, browser-only single-page app** — vanilla JS, CSS custom properties, and Mermaid diagrams rendered at view time. There is no backend and no data leaves the page.

The **Design & Architecture** tab follows the same pattern as the *Agentic Knowledge Mapper* classic GUI: markdown documents in `design/` are fetched and rendered live, with ` ```mermaid ` fenced blocks becoming interactive diagrams (with a pan/zoom "enlarge" viewer). Nothing is a screenshot.

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

A server is needed only because the Design tab fetches `design/*.md`; `file://` would block that fetch. Any static host works.

---

## The eleven tabs

| Tab | What it does |
|---|---|
| **Overview** | Architect dashboard (planner readiness, blueprint coverage/risk/exposure, copilot and rule-lab state, a deterministic "Next:" suggestion and report export), plus totals, patterns-per-category, scenarios-by-severity, domain coverage, and a "how defenses stack" view of protection layers. |
| **Architect Copilot** | Chat with a local model (`quai-qwen3.8-27b` via Fox-Services, axiom fallback) grounded in the catalog through a server-side proxy; streaming, citations, scope toggles, and a deterministic offline fallback when no backend answers. |
| **Patterns** | The catalog: **107 design patterns** across 9 categories, each with how it works, components, failure modes, protections, related patterns, and a control-flow diagram (32 diagrams; every pattern also gets its category diagram). Filter by category, domain, or "has diagram / has failures". |
| **Scenarios** | **38 failure scenarios** across 15 domains (12 critical / 18 high / 8 medium). Each opens to the attack chain, protection table, detection signals, incident response, and links to a replayable mock run. |
| **Cascades** | **175 catalogued composition cascades** in four classes (inherent, derived, emergent, cascading) with propagation paths, amplifiers, blast radius, detection and mitigation columns, plus a simulator and bidirectional links to the patterns/scenarios they involve. |
| **Coverage** | Gap view: control families mapped to catalog patterns, what's covered and what isn't. |
| **Deployment Plan** | Four-step intake → readiness scorecard across weighted dimensions → recommended stack + guardrail config → autonomy/rollout dial → residual-risk register → ADR generator (citations validated against the catalog). |
| **Blueprints** | Reference-architecture builder: compose patterns from templates or the palette into a pipeline + control overlay, with Mermaid export, deterministic warnings, a cost/latency/risk estimator and a per-blueprint **threat model** (exposure index vs. the catalog ceiling, matched scenarios/cascades/failure modes, one-click add of missing defenses). |
| **Live View** | An exhaustive, filterable library of **39 mock execution traces — one for every scenario** (plus the flagship approved path). The control-flow diagram highlights the active node while the step tracker, budget/cost/token gauges, guardrail counters, and event log advance in sync. Play / step / back / reset with adjustable speed; filter by domain, severity, verdict or free text. |
| **Design & Architecture** | UML & architecture documents with live Mermaid: system context, component/class UML, control flow & runtime, financial guardrail architecture, data model (ER), and threat model. Rail + scroll-spy outline + source toggle + zoom viewer (wheel zoom, drag pan, ←/→ step). Loaded lazily on first visit. |
| **Guardrail Lab** | Type any agent idea and it is analyzed into a full design (see below). Every analysis is saved to a collection in `localStorage` and exportable as JSON. |

**Global**: `Ctrl/⌘ K` (or `/`) opens a command palette over everything — patterns,
scenarios, cascades, tabs, templates, saved blueprints. `?` shows keyboard
shortcuts; `Alt+1…9/0/-` jump between tabs. The Overview export row produces a
full architect report as Markdown, JSON, or a print-friendly page.

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

A **seeded example** (the corporate-card scenario above) ships in the collection so the flow is visible on first load. Five one-click example requests are provided (card spend, prod-access coding agent, auto-emailing support agent, clinical triage, autonomous trading).

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
js/app.js                  shell: tabs, theme, data load, Mermaid queue, zoom viewer, drawer
js/player.js               reusable playback widget (Live View + Guardrail Lab)
js/patterns.js             Overview stats + Patterns catalog
js/scenarios.js            Scenarios catalog + detail drawer
js/cascades.js             Cascade explorer, simulator, mitigation planner
js/coverage.js             control-family coverage index
js/deploy.js               deployment planner (intake, scorecard, stack, rollout, risks, ADR)
js/blueprints.js           reference-architecture builder + estimator + threat model
js/copilot.js              architect copilot chat (grounding, citations, fallback)
js/context.js              catalog grounding context builder
js/llm.js                  LLM client (watchdog, streaming)
js/live.js                 trace library (filters) driving the player
js/design.js               markdown renderer + Design & Architecture tab (lazy)
js/guardrail.js            Guardrail Lab rule engine + collection + replay + cascade rules
js/dashboard.js            architect dashboard projection on Overview
js/palette.js              Ctrl/⌘K command palette
js/shortcuts.js            global keyboard shortcuts + help
js/report.js               full report export (Markdown / JSON / print)
data/patterns.json         107 patterns, categories, category diagrams
data/scenarios.json        43 scenarios (attack chains, protections, detection, response)
data/cascades.json         180 composition cascades (four classes)
data/traces.json           39 mock execution traces (scenarios link a replay where one exists)
data/coverage.json         control-family coverage index (26 domains)
tools/gen_cascades.py      cascade dataset generator
tools/gen_scenarios.py     scenario dataset generator
design/*.md                6 UML/architecture docs (24 Mermaid diagrams total)
serve.py                   thin static server + /api/llm/* proxy (watchdog, failover)
Dockerfile                 image: python:3.12-slim, non-root, read-only, healthcheck
docker-compose.yml         default deployment (LAN + host Tailscale)
docker-compose.tailscale.yml   dedicated Tailscale node (+ HTTPS URL)
tailscale/serve.json       Tailscale Serve config for the sidecar deployment
.env.example               APP_PORT, TS_AUTHKEY, TS_HOSTNAME
```

Load order matters and is fixed in `index.html`: `app.js` defines the shell (`switchTab`, `mmRender`, `openDetail`, `openZoom`, the `tabLoaders` registry), `player.js` defines the reusable `LivePlayer` widget, then each tab module registers its `init*` and `tabLoaders` entry. Cross-module calls are guarded with `typeof … === "function"` so a module can fail without taking the shell down.

## Design notes

- **One sequential Mermaid render queue.** Mermaid measures labels in shared global state, so concurrent renders corrupt each other. All renders pass through a single promise chain (`mmRender`), and each node's source is kept in `data-src` for theme re-renders. Re-rendering resets `data-processed` (Mermaid skips already-processed nodes otherwise).
- **The zoom viewer clones the rendered SVG** — it never re-runs Mermaid — so the "enlarge" view can never disagree with the inline diagram.
- **Theme** is a single CSS class on `<html>`; Mermaid theme variables are derived from it, and toggling re-renders every diagram with the new palette.
- **Live View joins steps to the diagram via node ids** (`step.node` ↔ Mermaid node id), which is what drives the active-node highlight.

## Extending it

- **Add a pattern:** append to `data/patterns.json` `patterns[]` with a `cat` from `categories[]`; optional `diagram` is Mermaid source (use `"double quotes"` around labels containing parentheses).
- **Add a scenario:** append to `data/scenarios.json`; set `traceId` to link a mock run.
- **Add a trace:** append to `data/traces.json`; give each step a `node` matching a node id in `flow`, and keep node ids non-overlapping (zero-pad numeric ids, e.g. `N01`, `N02`, so `N1` never matches inside `N10`).
- **Add a design doc:** add the file under `design/` and register it in `DESIGN_DOCS` at the top of `js/app.js`.

All datasets are plain JSON, versioned, and diffable. There are no hidden defaults — a missing field renders as absent, never as a silently-chosen value.

---

## Scope

107 design patterns · 207 documented failure modes · 38 failure scenarios · 175 composition cascades · 15 domains · 12 critical scenarios · 39 replayable mock traces · 6 architecture documents · 24 architecture diagrams · 32 pattern control-flow diagrams · 70+ Mermaid diagrams total, all validated to parse · local-model architect copilot (Fox-Services primary, axiom fallback, deterministic offline fallback) · deployment planner with ADR export · blueprint builder with threat-model exposure index · command palette and keyboard shortcuts · full report export.

**Caveats, honestly:** the exposure index measures matched threat *surface* from the catalog, not measured risk — compare like-for-like blueprints. The copilot's grounding is deterministic retrieval, not RAG fine-tuning; when both LLM backends are down it degrades to a deterministic catalog answer rather than failing. Cost/latency figures are estimates from stated assumptions, not benchmarks.
