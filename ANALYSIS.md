# Deep Analysis — From Catalog to Architect's Copilot

> Scope: an architect-facing review of the **AI Agent Patterns & Guardrails**
> dashboard and a 30-iteration roadmap that turns a static catalog into a
> working advisory system for planning, deploying, and de-risking autonomous
> agents. Local reasoning model: **Qwen 3.8-27B** served by **Fox-Services**
> (`http://localhost:8210`, OpenAI-compatible), with **axiom** used as a
> secondary backend when the tailnet node is online.

---

## 1. What the app is today

| Layer | Today | Gap for an architect |
|---|---|---|
| Patterns | 107 patterns in 9 categories, 207 failure modes, 32 diagrams | Read-only reference; no "which of these do *I* need?" |
| Scenarios | 38 scenarios, 15 domains, attack chains + protections + detection + response | Risk register, but no coverage/gap math |
| Live View | 39 replayable traces (38 scenarios + 1 approved path) | Explains *a* path; doesn't explain *systemic* propagation |
| Design & Arch | 6 docs, 24 Mermaid diagrams | Static; not generated from *my* deployment |
| Guardrail Lab | Heuristic analyzer + persisted collection | Single-request scope; no cascade reasoning |
| Overview | Counts and distributions | No recommendations, no readiness, no plan |

**Verdict:** the app answers *"what patterns exist and what has gone wrong before?"*
It does not yet answer the four questions an architect actually asks:

1. **"What do I need to build for *my* agent?"** → planning, stack, readiness.
2. **"What am I missing?"** → coverage and gap analysis.
3. **"If this goes wrong, how far does it spread?"** → cascade analysis.
4. **"What do I do about it, in what order?"** → mitigation and mitigation planning.

## 2. The missing intellectual core: a cascade taxonomy

The prompt asks to highlight **inherent, emergent, derived, and cascading**
issues. Those are four *distinct propagation classes* with different origins,
different detection methods, and different mitigations. The app currently has no
model for this at all. This is the single highest-value addition.

| Class | Origin | Signature | Detected by | Primary mitigations |
|---|---|---|---|---|
| **Inherent** | A property of one component in isolation (model, tool, pattern) | Exists before integration; reproducible in a unit test | Unit tests, evals, model cards | Constrain at the source: schema-locked tools, least privilege, input/output validation |
| **Emergent** | Interaction topology of ≥2 components; no single part exhibits it | Surprising, non-linear, invisible in component tests | Integration/system tests, runtime invariants, simulation | Bulkheads, circuit breakers, loop/iteration caps, contract tests between agents |
| **Derived** | Logically necessary consequence chain from a trigger | Deterministic "if X then Y then Z" across authority boundaries | Attack-path analysis, taint tracking | Break the chain at the earliest link: confirm-before-irreversible, dual control, scoped credentials |
| **Cascading** | A local failure crosses a boundary and *amplifies* or *correlates* | Non-linear blast-radius growth, shared fate, feedback | Dependency/common-mode analysis, chaos drills, blast-radius sim | Isolation, per-tenant bulkheads, rate+queue caps, kill switch, rollback, reconciliation |

Worked example (the corporate-card scenario, `fin-card-injection`):

- **Inherent** — the instruction-following model is susceptible to injected
  instructions (`prompt-injection` pattern). A property of the model.
- **Derived** — injected text → tool call `purchase($50,000)` → charge → booking
  → reconciliation breach. Necessary chain if nothing intervenes.
- **Emergent** — the browsing tool + memory + planner together let an *external
  page* become a *standing instruction* the agent honours on later turns — a
  behaviour no component has alone.
- **Cascading** — one compromised vendor page in a shared browsing cache →
  every agent instance reading it → correlated spend attempts across the fleet
  → budget halt → total stop of the procurement service.

That four-way framing is what an architect needs, and the app has none of it.

## 3. Concrete gaps found in the codebase

1. **No model integration.** `serve.py` is a pure static server; there is no
   path to the local Qwen model. Nothing is grounded, summarized, or generated.
2. **No coverage math.** 15 domains × 107 patterns × 38 scenarios exist but no
   cell is ever scored "covered / thin / missing".
3. **No planning artifacts.** No readiness score, no stack recommendation, no
   rollout/rollback plan, no ADRs, no residual-risk register.
4. **No cascade model or simulation.** Scenarios describe one attack chain;
   systemic propagation and amplification are absent.
5. **No blueprint composition.** Patterns have `related`, but you cannot select
   a set and get a composed reference architecture.
6. **No export.** A Guardrail-Lab collection exports JSON; a *review* does not.
7. **No global search / command palette.** Each tab searches only its own data.
8. **No cross-links in the reverse direction.** Scenario → Live View exists;
   cascade/pattern → scenario → trace does not.
9. **Degraded-mode UX is thin.** If Mermaid CDN is offline, diagrams note it;
   nothing else degrades gracefully.
10. **The Overview is descriptive, not prescriptive.** It counts; it should advise.

## 4. Roadmap — 30 iterations

**A. Local-model copilot (it. 2–6)** — proxy, client, grounded retrieval,
streaming UI, citations, offline fallback.

**B. Cascade core (it. 7–12)** — taxonomy dataset, explorer, propagation
diagrams, simulator, mitigation planner, bidirectional cross-links.

**C. Coverage & planning (it. 13–20)** — coverage index, gap view, deployment
wizard, readiness scorecard, stack + guardrail generator, rollout/autonomy dial,
residual-risk register, ADR generator.

**D. Blueprint & composition (it. 21–23)** — reference-architecture builder,
cost/latency/risk estimator, per-blueprint threat model.

**E. UX & integration (it. 24–30)** — architect dashboard, global search +
command palette, keyboard shortcuts, full review export, cascade-aware
guardrail rules, a11y/perf polish, docs + validation.

Each iteration is a real, committed increment; the app must stay green after
every one. **Status: complete** — A–E delivered across 30 commits on
`feat/architect-copilot`:

| Block | Iterations | Delivered |
|---|---|---|
| A | 2–6 | LLM proxy + watchdog, client, grounded copilot, offline fallback |
| B | 7–12 | cascade taxonomy (175), explorer, diagrams, simulator, mitigation planner, cross-links |
| C | 13–20 | coverage index, deploy wizard → scorecard → stack → rollout → risk register → ADR |
| D | 21–23 | blueprint builder, cost/latency/risk estimator, per-blueprint threat model |
| E | 24–30 | architect dashboard, command palette, shortcuts, report export, cascade-aware rules, a11y/perf/mobile, docs |

Validation: headless-browser smoke test after each iteration — 11 tabs render,
0 console/page errors, state persists across reload, keyboard paths work.

## 5. How the local model is used (and when it is not)

- **Backend A — Fox-Services** (`FOX_LLM_URL`, default `http://localhost:8210`):
  OpenAI-compatible `/v1/chat/completions` and `/v1/models`, CORS open, SSE
  streaming, no auth. Model `quai-qwen3.8-27b:latest`. Its *managed router* may
  substitute an already-loaded preferred model for latency; the response's
  `model` field reports what actually served, and the UI surfaces that honestly.
- **Backend B — axiom** (`AXIOM_LLM_URL`, a tailnet/mesh node): probed for
  health; promoted to primary when reachable. Currently reachable and serving
  live calls.
- **Proxy, not direct:** the browser calls `serve.py`'s `/api/llm/*`, which
  forwards server-side. This keeps one origin, works from any LAN/Tailscale
  client, hides backend URLs, and lets us fall back A→B transparently.
- **Degraded mode is first-class:** every copilot feature has a deterministic
  fallback computed locally (retrieval + template synthesis). The model adds
  judgement and prose; it is never required for the app to be useful.

## 6. Non-goals

- Not a runtime agent framework; the app advises, it does not execute agents.
- No fine-tuning; the model is used zero-shot with grounded context.
- Datasets stay synthetic and clearly labelled.
