# Workflow Analysis — AI Agent Patterns & Guardrails (iterations 101–120)

> A **fourth, independent lens** on the app. `ANALYSIS.md` covered the
> **product** (catalog → Fox-Architect). `UX-ANALYSIS.md` covered
> **UX** (iterations 31–80). `DEEP-ANALYSIS.md` covered **engineering,
> performance and content coverage** (iterations 81–100).
> This document covers what none of them did: **the work itself** — the
> sequence of actions a user performs to take an agent design from an idea
> to a defensible architecture, and the seams between the twelve tools that
> work must cross.
>
> Every finding below is measured against the running app (headless Chrome
> at 1440×900 on `http://localhost:5199`), not estimated.

---

## 0. How it was measured

| Probe | Tool | What it captured |
|---|---|---|
| Handoff inventory | headless Chrome, per-pane `[onclick]` scan | which panes can hand off to which other pane |
| Journey test | scripted click-through | scenario → blueprint → report, end to end |
| Report coverage | `rpMarkdown()` in-page | which tool outputs reach the exported document |
| State spine | live `dpState` / `bpState` / `guardState` | whether the tools share a subject |
| Static audit | `grep` over `js/*.js` | undo coverage, missing `switchTab` calls, claim/code drift |

---

## 1. The workflow, as it actually is

The app's real work is a five-stage chain:

```
  discover  →  research  →  design  →  harden  →  deliver
  (Overview)   (Patterns/   (Deploy/   (Guardrail  (Blueprint/
                Scenarios/    Blueprints/ Lab/        Live View/
                Cascades)     Coverage)   Discovery)  Report)
```

Twelve tabs serve those five stages. The *catalog* tabs (Patterns,
Scenarios, Cascades) are reference material; the *authoring* tabs
(Deployment, Blueprints, Guardrail Lab) produce the work product; Live View
demonstrates it; the Overview assembles and exports it.

**Measured handoff graph** (per-pane `[onclick]` scan, cross-pane calls only):

| From | Cross-pane handoffs measured | To |
|---|---|---|
| Overview | 51 | scenarios, patterns |
| Patterns | 107 | patterns (same pane) |
| Scenarios | 54 | scenarios (same pane) |
| Cascades | 61 | cascades, design |
| Coverage | 76 | **Fox-Architect only** (76× `covAsk`) |
| Deployment | **0** | — |
| Blueprints | 18 | blueprint (same pane) |
| Live View | 39 | live (same pane) |
| Design | 0 | — |
| Guardrail Lab | **0** | — |
| Discovery | 0 | — |

**Read-out.** The catalog is richly cross-linked *inward* (every card opens
its own drawer). The four **authoring** tabs — the ones that actually
produce the deliverable — have **zero** handoffs to each other. The
workflow between them is copy-paste and retyping.

---

## 2. Findings (severity ordered)

### W1 — There is no project. The three authoring tools describe three different systems (Critical)

**Evidence.** Live state after boot:

```
dpSystem:  ""            (Deployment Planner — the intake's system name)
bpName:    ""            (Blueprints — the canvas name)
guardTitles: ["Guardrails: agent that can spend money using company/corporate cards…"]
```

The three authoring tools have **three independent, unrelated identity
fields**. A user who answers the intake for "Stripe refunds agent", builds
a blueprint for it, and runs a Guardrail Lab analysis on it produces three
records that share no key, no name and no link. The exported report stitches
them together (iteration 40's `rpMarkdown`) but the report says nothing that
ties them — and the *pins* and *mitigation backlog* are not in the report at
all.

**Impact.** This is the root cause of W2, W3, W4, W5 and W6. Every
cross-tool workflow improvement is a special case of "give the work a
subject".

### W2 — The Deployment Planner's recommended stack cannot become a blueprint (High)

**Evidence.** `dpStack()` returns 13 controls, **12 of which carry a valid
catalog pattern id** (`agent-identity`, `least-privilege`,
`input-sanitization`, `policy-engine`, `quota-rate-limit`, …). `dpSectionStack()`
renders each as a `dpOpenCite` link that *only opens the catalog entry* —
there is no "add to blueprint" anywhere in `js/deploy.js` (grep: zero
`bpAdd` / `bpAddMany` calls in the file).

Meanwhile `js/help.js` (the in-app Deployment guide) tells the user:

> "Tip: the recommended stack can be materialised as a blueprint in one step
> (section 2)."

**That claim is false.** There is no such button. The user is told to take a
one-step action that does not exist, and the 12 already-correct, already-
domain-appropriate pattern ids are the single most valuable artefact the
planner produces — and they must be re-picked by hand in the Blueprints
palette.

### W3 — The Guardrail Lab is a dead end (High)

**Evidence.** `js/guardrail.js` contains **zero** references to `bpAdd` /
`bpAddMany` / `bpRefsBtnHtml`. The Guardrail Lab produces, per analysis:

- 9 **reference controls** (name, layer, mode, rationale)
- 6 **cascade-aware rules**, each citing a catalog cascade
- a full **mock run** with a replayable flow

and the report renders all of it beautifully — with **no exit**. The only
outbound affordance in the whole pane is `openCascade(r.cas)` inside the
cascade-rules section. A user's natural next move — "add these controls to my
architecture" — is impossible.

**Impact.** The Guardrail Lab is the app's most differentiated tool (an
8-part deterministic design with a live replay), and it is a terminal node in
the workflow graph.

### W4 — The Discovery Lab's drafts cannot enter the catalog (High)

**Evidence.** `discExportJson()` emits `{version: "draft-1", drafts: [...]}`;
`discExportMd()` emits a Markdown draft. The only two exits are
`discAsk(i)` (→ Fox-Architect) and the two exports. A **curator** — the person the
app says these drafts are "for curator review" — has no path to turn a draft
into a catalog scenario, and the app has no `data/` write path at all
(`data/*.json` is static, served read-only).

### W5 — The report silently omits four of the seven work products (High)

**Evidence.** `rpMarkdown()` returns exactly 3 top-level sections:

```
## 1. Deployment plan
## 2. Reference architecture
## 3. Fox-Architect consult
```

Measured against the live app:

| Work product | In the report? |
|---|---|
| Deployment plan (score, stack, risks, ADR) | ✅ |
| Blueprint (pipeline, coverage, estimate, threat model) | ✅ |
| Fox-Architect transcript | ✅ |
| **Guardrail Lab analyses** | ❌ |
| **Cascade mitigation backlog** (owners, status, CSV) | ❌ |
| **Pinned working set** | ❌ |
| **Discovery drafts** | ❌ |

So a user who does the *real* work — analyses a guardrail, works the
mitigation backlog, pins the patterns they care about — produces a report
that contains none of it. The export is the deliverable; it is incomplete.

### W6 — The mitigation backlog is a localStorage island (Medium-High)

**Evidence.** `MIT_STORE = "aap.mitigations"` in `js/cascades.js` is written
by `mitSet()` and read by `mitLoad()`. Measured live: after boot the store
holds **0 keys**; it is only populated when the user opens the Mitigation
planner and touches a row. Nothing else in the app reads it:

```
grep -rn "MIT_STORE\|mitLoad\|mitSet" js/  →  js/cascades.js only
```

It is not in the report (W5), not in the dashboard, not in the pins, not in
the backup manifest's *reach* (it is included in the raw `aap.*` sweep, but
invisible). Owners and status — real team process — die with the browser
profile.

### W7 — The Overview "Next:" spine is linear and blind to four tools (Medium-High)

**Evidence.** `dashNext()` returns, in strict order:

```
1. dpState.done?         → Deployment Planner
2. bpState.comps.length? → Blueprints
3. blueprint gaps?        → Close the gaps
4. exposure high?         → Open threat model
5. cpMessages.length?     → Ask Fox-Architect
6. else                   → export the report
```

It **never inspects** `guardState.items`, `discState.run`, the mitigation
backlog, or the pins. A user whose only work is a guardrail analysis is told
to "Complete the deployment intake". The suggestion engine is the app's
primary workflow guide and it knows about 3 of 7 work products.

### W8 — Cross-pane navigation loses the user's place and the drawer context (Medium-High)

**Evidence.** Every cross-pane call in the app is one of:

```js
switchTab('patterns'); setTimeout(() => openPattern(pid), 80);
switchTab('live');     setTimeout(() => { loadTrace(tid); focusPane('live'); }, 100);
switchTab('scenarios');setTimeout(() => openScenario(id), 70);
```

Ten distinct hand-rolled `setTimeout` delays (60–100 ms) across
`js/scenarios.js`, `js/deploy.js`, `js/palette.js`, `js/cascades.js`,
`js/copilot.js`, `js/blueprints.js`. The delay is a race: it works only
because the target pane happened to initialise within the window. The
`dlOpen()` deep-link path already solves this properly — it uses
`dlWhenReady(tab, fn)`, which polls `paneInited[tab]` until the pane is
actually ready — and the hand-rolled paths **do not use it**.

Worse: `switchTab()` rewrites the hash to the bare tab
(`history.replaceState(null, "", "#" + tab)`), and the drawer is opened
*after* the tab switch, so the deep link is lost — a shared URL points at
the tab, not the item. Only `dlOpen()` (used by the deep-link router) keeps
`#tab/item` intact.

### W9 — "Ask Fox-Architect" sends a title, not the artifact (Medium)

**Evidence.** `askCopilotAbout('pattern: ' + p.name)`,
`askCopilotAbout('scenario: ' + s.title)`. Fox-Architect's own
`AIContext.build()` does a *deterministic retrieval* from the catalog keyed
on the query text — so asking about `"scenario: fin-card-injection"` retrieves
by that string. But the *provenance* (the pattern's own catalogue record, the
scenario's attack chain, the cascade's propagation path) is not passed.

Compare `dpAdrToCopilot()` and `bpAskCopilot()`, which *do* build a
structured prompt from the real artefact. The drawer-level "ask" is the
thin version of the same idea, and it is the one users click most.

### W10 — The catalog filters are not a research workflow (Medium)

**Evidence.** Each catalog pane has an independent filter set with a
`Reset filters` button, but **no way to express "show me the un-protected
ones in this domain"** as a saved, shareable, sequential research pass. The
`uiMem` store remembers filter state per pane (iteration 76) so it survives
reloads — but there is no notion of a *query set* or a *research trail*.

Concretely: a security reviewer's workflow is *enumerate → triage → narrow →
re-enumerate*. The app supports exactly one step of that (filter) and
forgets the rest.

### W11 — Undo does not cover the authoring tools' own destructive ops (Medium)

**Evidence.** `undoPush` call sites:

| File | Ops covered |
|---|---|
| `js/blueprints.js` | add, remove, clear, template, load lib, delete lib |
| `js/deploy.js` | reset plan |
| `js/guardrail.js` | delete analysis |
| `js/dashboard.js` | clear working set |

Not covered: `mitSet()` — the mitigation backlog's owner/status edits
(`js/cascades.js:227`) mutate a 5-field nested object per row with **no
undo and no confirmation**. The planner's risk **acknowledgements**
(`dpAckRisk`, `dpAckAll`) likewise. And `cpRegen(i)` replaces a Fox-Architect
answer in place with no undo.

### W12 — Deep links cover 5 kinds; the work products are not addressable (Medium)

**Evidence.** `dlOpen()` handles `patterns`, `scenarios`, `cascades`,
`design`, `guard`. Not addressable: a **blueprint**, a **saved library
entry**, a **deployment plan**, a **guardrail analysis** (it is, but only via
`#guard/<id>`), a **mitigation row**, a **discovery run**, a **pin set**.

So the *deliverable* cannot be linked, bookmarked or shared. The catalog can.

### W13 — Fox-Architect's citations are the app's best cross-nav, and they are text-only (Medium)

**Evidence.** `cpOpenCite(c)` handles `pattern` / `scenario` / `trace`.
`landLink()` in `js/landing.js` builds `.cp-cite` chips for pattern/scenario/
cascade with a `title="Open in catalog"` tooltip. But a citation is
`<span onclick=…>` — **not a link, not focusable, not keyboard-reachable**,
and not copyable as a URL. In a chat answer, the citations are the user's
path from prose back into the catalog, and they are the weakest links in the
app.

### W14 — No "state of this system" view exists (Medium)

**Evidence.** The Overview dashboard shows four cards: Deployment Planner,
Blueprint, Fox-Architect, Guardrail Lab. It does **not** show the
mitigation backlog, the discovery run, or the pins (pins are shown, but in a
separate `pinPanelHtml()` block below the cards). There is no single place
that answers *"what is the state of the system I am designing?"* — which is
the question the app's own landing page and README promise to answer.

### W15 — Multi-item selection is a one-shot "add all" (Low-Medium)

**Evidence.** `bpAddMany(ids)` adds everything at once. `bpRefsBtnHtml` offers
"＋ Add 6 linked patterns from this scenario to blueprint". There is no way
to select 3 of 6, or to preview what will be added, or to see which of them
the blueprint already has before committing. The one-click adds are
convenient; they are also the mechanism by which a blueprint accumulates
patterns the user never chose.

---

## 3. Prioritised roadmap (iterations 101–120)

Ordered by (impact ÷ effort). Each is a real, testable increment.

**The spine (fixes W1, W2, W3, W5, W7, W14)**

| # | Iteration | Findings |
|---|---|---|
| 101 | **Project spine** — one "current system" identity shared by planner, blueprint, guardrail lab | W1 |
| 102 | Project switcher + named projects; every tool stamps its work with the project id | W1, W14 |
| 103 | Deployment → Blueprint: "Materialise stack as blueprint" (the missing help.js promise) | W2 |
| 104 | Guardrail Lab → Blueprint: map the 9 reference controls to catalog patterns, one click | W3 |
| 105 | Guardrail Lab → Live View: promote the mock run into the trace library | W3 |
| 106 | Report v2: all 7 work products, project-stamped | W5 |
| 107 | "Next:" v2 — the suggestion engine reads all 7 work products | W7 |

**The seams (fixes W8, W9, W12, W13)**

| # | Iteration | Findings |
|---|---|---|
| 108 | `goTo()` — one navigation primitive replacing 10 hand-rolled timeouts; keeps `#tab/item` | W8 |
| 109 | Deep links for every work product (blueprint, plan, analysis, run, project) | W12 |
| 110 | "Ask Fox-Architect" sends the artifact, not the title | W9 |
| 111 | Citations become real, focusable, copyable links | W13 |

**The depth (fixes W4, W6, W10, W11, W15)**

| # | Iteration | Findings |
|---|---|---|
| 112 | Mitigation backlog → real work product: project-scoped, in the report, in the dashboard | W6 |
| 113 | Discovery → "promote to draft scenario" with a catalog-shaped editor | W4 |
| 114 | Saved research sets: a named, shareable filter set per catalog pane | W10 |
| 115 | Undo for mitigation edits, risk acknowledgements and Fox-Architect regeneration | W11 |
| 116 | Multi-select in the palette/palette panel with a preview of what will be added | W15 |

**The finish (fixes the rest)**

| # | Iteration | Findings |
|---|---|---|
| 117 | Workflow rail: a persistent breadcrumb of the 5 stages with per-stage status | W7, W14 |
| 118 | Command palette v3: project-aware, workflow commands (`>stage`, `>project`) | W1, W7 |
| 119 | Full workflow validation pass (headless, 12 tabs, all handoffs, 0 errors) | all |
| 120 | Docs refresh: README, help.js guides, UX-ANALYSIS, this file | all |

---

## 4. Non-goals

- No framework, no bundler, no build step — the no-build vanilla-JS
  philosophy stays.
- No server-side writes: `data/*.json` stays static and read-only. Iteration
  113 promotes a draft into the *user's* collection, not into the shipped
  catalog.
- No auth / multi-user. A project is a local, per-browser named workspace.
- No new content. This is a workflow pass, not a catalog pass.

---

## 5. Delivery status — iterations 101–120 (all shipped)

Every item below is implemented, committed and verified headless against the
running app. Evidence is measured, not estimated.

### The spine

| # | What shipped | Commit |
|---|---|---|
| 101 | **Project spine** — `js/project.js`: a named local workspace owning the plan, blueprint, guardrail analyses, discovery runs, mitigation backlog and pins | `eec9812` |
| 102 | Project chip + panel in the top bar: switch, rename, new, export, import; tool state is snapshotted on switch and on tab-hide | `eec9812` |
| 103 | Deployment → Blueprint: "Materialise as blueprint" — the 13 catalog patterns the recommended stack already names land on the canvas (the promise `js/help.js` had been making since iteration 44) | `6d25da0` |
| 104 | Guardrail Lab → Blueprint: the 9 reference controls map to the catalog patterns that implement them (narrow, name-first, catalog-verified) and land on the canvas | `6d25da0` |
| 105 | Guardrail Lab → Live View: the mock run is promoted into the trace library and plays in the same player as the 39 catalog traces | `6d25da0` |
| 106 | Report v2: **all seven** work products (was three), stamped with the project | `4de59a7` |
| 107 | "Next:" v2 — the suggestion engine reads every tool and follows the stage order | `4de59a7` |

### The seams

| # | What shipped | Commit |
|---|---|---|
| 108 | `goTo(tab, id)` — one navigation primitive replacing 13 hand-rolled `setTimeout` races; keeps the `#tab/item` deep link and the Back button working | `087adf8` |
| 109 | Deep links for the work products: `#blueprint/current`, `#deploy/plan`, `#discovery/run`, `#blueprint/lib:N`, `#overview/proj:<id>`, plus Copy-link buttons | `0ffcfa5` |
| 110 | "Ask Fox-Architect" sends the **artefact** (the pattern's failure modes, the scenario's attack chain, the cascade's propagation path, the guardrail design's controls) — not the title | `0ffcfa5` |
| 111 | Citations become real `<a href="#tab/id">` links — focusable, keyboard-reachable, copyable, openable in a new tab. 15 links, 0 spans | `0ffcfa5`, `5ab60e1` |

### The depth

| # | What shipped | Commit |
|---|---|---|
| 112 | Mitigation backlog → a real work product: progress panel, "focus un-owned", "seed blueprint from the top 10", in the report and on the dashboard | `b69f7f7` |
| 113 | Discovery → "promote to draft scenario": a catalog-shaped scenario (the shipped fields) kept in a draft collection, reviewable in the shared drawer, exportable. `data/*.json` stays read-only | `b69f7f7` |
| 114 | Saved **research sets**: named, shareable filter states for the Patterns and Scenarios panes. A set stores the filter *state*, never the results, so it never goes stale | `723d344` |
| 115 | Undo extended to the authoring tools' own decisions: mitigation owner/status, risk acknowledgements, Fox-Architect regeneration | `b69f7f7` |
| 116 | Multi-select in the blueprint palette with a live preview: how many will be added, how many are already there, and which control families the addition closes | `723d344` |

### The finish

| # | What shipped | Commit |
|---|---|---|
| 117 | The five-stage workflow rail on the Overview, with each stage's live state | `4de59a7` |
| 118 | Command palette v3: the current project, the next step, each workflow stage, and the actions the project enables; projects and research sets are searchable items; new `proj:` / `stage:` prefixes | `723d344` |
| 119 | Full validation: a cross-tool journey in the headless smoke test (8 workflow assertions), plus a 13-width × 12-tab overflow sweep | `5ab60e1` |
| 120 | Docs: README (the workflow, the seams, the new files, the report scope), the twelve in-app tab guides, this file | this commit |

### Measured outcomes

- **The authoring tools are no longer islands.** Before: Deployment,
  Guardrail Lab, Design and Discovery had **0** cross-pane handoffs
  between them. After: 4 working seams (planner → blueprint, guard →
  blueprint, guard → live view, backlog → blueprint), each one a single
  click from the tool that produced the work.
- **The report is complete.** Before: 3 of 7 work products. After: 7 of 7
  — measured by asserting the section headings in the headless smoke
  test, so a regression fails the build.
- **The "Next:" engine is honest.** Before it read 3 tools; after it
  reads all of them, and follows the stage order (a user with no design
  is told to design, not to triage a backlog that needs a design first).
- **Navigation is no longer a race.** 13 hand-rolled
  `switchTab(...); setTimeout(..., 60..120)` calls replaced by one
  `goTo()` that waits for the pane to be ready. The browser Back button
  still closes the drawer.
- **Everything is addressable.** 12 work-product deep-link kinds
  (`#blueprint/current`, `#deploy/plan`, `#discovery/run`,
  `#blueprint/lib:N`, `#overview/proj:<id>`, plus the 5 catalog kinds).
- **The state has a subject.** 3 independent identity fields (the
  planner's `a.system`, the blueprint's `name`, the guardrail analysis's
  title) became 1 project.
- **Validation:** 13 widths (1920 → 360) × 12 tabs, **0 horizontal
  overflow**, **0 page errors**; 1 `<main>`, 0 nested `<main>`, 12
  `role=tab` all with `aria-selected`, 0 unlabelled controls, 0 unnamed
  buttons, 15 citation links, 0 citation spans, 5 workflow rail stages.
  `npm run lint` clean, `npm test` 8/8, `npm run test:e2e` OK with the
  8 workflow assertions.

### Notes / deliberately out of scope

- `data/*.json` stays read-only. A promoted discovery draft is the
  *user's* draft, in their own collection, exported for curation — the
  shipped catalog is never modified by the app.
- A project lives in this browser's `localStorage`. It is included in the
  "Back up all" sweep, but a cleared profile still loses it — hence the
  backup button and the project export/import.
- The control → pattern map in the Guardrail Lab is a hand-written
  keyword table, not a learned model. It is deliberately narrow: it
  matches on the control's *name* first and takes the first rule that
  fires, so a loose match cannot add patterns the user never chose.
- The "add all" affordances (materialise, promote) still exist next to
  the multi-select. The preview in iteration 116 exists so the user can
  see exactly what a bulk add will do before committing it.

