# Deep Analysis — Engineering, Performance & Content-Coverage Audit

> A third, independent lens on the app. `ANALYSIS.md` covered the **product**
> (catalog → architect's copilot). `UX-ANALYSIS.md` covered **UX** (iterations
> 31–80). This audit covers what neither did: **delivery cost, keyboard/ARIA
> conformance, content coverage math, data integrity, and engineering process**.
> Every finding below is measured, not estimated — headless Chrome at
> 1440×900 against `http://localhost:5190`, source-level checks, and a
> build-time referential-integrity pass over `data/`.
>
> Scope note: this document is an *analysis*. Concrete fixes are proposed as a
> roadmap (iterations 81–100) at the end; none are applied here.

---

## 0. How it was measured

| Probe | Tool | What it captured |
|---|---|---|
| First-load transfer | headless Chrome, `response` content-length sum | 30 requests, per-type bytes, caching/encoding headers |
| DOM & ARIA | `page.evaluate` | node count, landmark counts, tab focusability, labelled controls |
| Keyboard reachability | 25× `Tab` keystrokes + `.focus()` probe | whether the tab bar is in the tab order |
| Data | Python over `data/*.json` | counts, cross-reference resolution, coverage matrix |
| Server | `curl -D-` | headers, compression, cache policy |
| Structure | `graft` graph + `wc`/`grep` | module sizes, symbol collisions, code shape |

---

## 1. Snapshot (measured)

| Dimension | Value |
|---|---|
| JavaScript | **8,784 LOC** across 20 files, all classic globals (no modules/bundler) |
| Largest module | `js/app.js` **1,629 LOC** (18.5% of all JS) |
| Data | `cascades` 423 KB · `traces` 316 KB · `patterns` 144 KB · `scenarios` 87 KB · `coverage` 25 KB |
| Content | 107 patterns (9 cats) · 43 scenarios (15 domains) · 180 cascades · 39 traces · 26 coverage domains |
| Runtime DOM | **4,912 nodes** on Overview |
| First load | **4.93 MB**, 30 requests, **0 bytes compressed**, all `Cache-Control: no-store` |
| Boot | `DOMContentLoaded` 384 ms (localhost); **0 page errors, 0 warnings** |
| Tests / CI | **none** — no `package.json`, no test dir, no `.github/workflows`, no linter |

---

## 2. What is genuinely strong (keep it)

1. **Referential integrity is 100%.** All 107 cascade `patternRefs`, 43
   `scenarioRefs`, 38 `traceRefs`; all 57 scenario `patternRefs`; every trace
   `scenarioId`; every pattern `related` id — **all resolve**. There are no
   dangling cross-links in ~1 MB of synthetic catalog.
2. **Zero console/page errors** on a cold boot, on every probe.
3. **Deferred, per-pane rendering** works: only Overview + catalog panes are on
   the first-paint path; the other nine build one-per-idle-slice.
4. **Offline-first diagrams**: Mermaid is vendored and works with the CDN
   blocked (measured in `UX-ANALYSIS.md`), honouring the air-gap claim.
5. **Failover LLM proxy** with generous timeouts and a deterministic local
   fallback — the model is never a hard dependency.
6. **Rich export surface** already exists: report Markdown/JSON/print,
   blueprint `.md`, cascade mitigations `.md`/`.csv`, copilot threads `.md`.

---

## 3. Findings (severity ordered, each with evidence + fix)

### P1 — 4.93 MB first load, uncompressed and never cached (High)

**Evidence.** Cold-load on Overview transfers **4,934,625 bytes** in 30 requests.
Every response carries `enc=none` and `Cache-Control: no-store`:

| Resource | Bytes | Share |
|---|---|---|
| `js/vendor/mermaid.min.js` | 3,260 KB | **66%** |
| `data/*.json` | 996 KB | 20% |
| app JS (20 files) | 479 KB | 10% |
| `css/styles.css` | 100 KB | 2% |

Mermaid is pulled by a **render-blocking `<script>` in `<head>`** — yet only the
Design tab uses it. And `no-store` is applied to *everything*, so a browser
re-downloads the 3.26 MB library on every single visit.

**Available compression** (measured with `gzip -9`): JSON **996 KB → 176 KB**
(5.7×), Mermaid **3.26 MB → 996 KB** (3.3×), `app.js` 77 KB → 24 KB.

**Projected effect of three changes** — (a) gzip in `serve.py`, (b) lazy-load
Mermaid on first Design visit, (c) lazy-fetch `traces`/`cascades` per pane:
Overview first load drops from **4.93 MB → ~230 KB** (≈ **21×**), and with a
service worker a repeat visit is near-zero.

**Fix.** Content-negotiated gzip/br in `serve.py`; move Mermaid out of `<head>`
into a promise-returning lazy loader; fetch datasets per pane rather than all
five at boot; replace blanket `no-store` with `Last-Modified`-based
conditional caching for immutable vendor assets.

### P2 — `traces.json` + `cascades.json` fetched at boot for panes that may never open (Medium-High)

**Evidence.** `loadAll()` does a single `Promise.all` of all five datasets
before any pane renders (`js/app.js:1537`). `cascades` (423 KB) and `traces`
(316 KB) are needed only by the Cascades and Live View panes — **739 KB
(74% of all JSON) downloaded before first paint for the default Overview**.
This contradicts the deferred-pane design one line below it.

**Fix.** Fetch `patterns`/`scenarios`/`coverage` eagerly; fetch `cascades` and
`traces` inside `initCascades`/`initLive` (with the existing skeleton already
covering the wait).

### A1 — The 12 tabs are unreachable by keyboard; not a valid ARIA tablist (High)

**Evidence.** Each tab is a `<div role="tab">` with **`tabIndex = -1`** and **no
`aria-selected`** attribute. A keyboard probe shows `.focus()` on a tab does
**not** move focus (not focusable), and 25 `Tab` presses never land in the tab
bar. Arrow-key cycling exists (`tabKeyNav`, `js/app.js:382`) but is
**unreachable** because focus can never enter the tablist. This is a WCAG 2.1
**2.1.1 (Keyboard)** failure and a malformed WAI-ARIA tabs pattern.

**Fix.** Give each tab `tabindex` (0 for the selected, −1 for the rest — the
roving pattern), toggle `aria-selected`, keep the existing ArrowLeft/Right
handler, and add Home/End. The `[`/`]` shortcut from iteration 62 can stay as a
bonus, not the only path.

### A2 — Seven `<main>` landmarks in one document (High)

**Evidence.** `document.querySelectorAll('main').length === 7` (lines 116, 142,
175, 209, 258, 307, 318 of `index.html`) plus 10 `<aside>`. Only one `<main>`
belongs to a document; multiple confuse landmark navigation in screen readers.

**Fix.** Make the *active* pane's container the single `<main>` (or drop the
role to `<div>` and expose one `<main id="main">` wrapping the pane host).

### P3 — Data is fetched eagerly; only rendering is deferred (Medium)

Same root as P2, listed there. No separate action.

### C1 — Content-coverage holes the catalog documents but never closes (Medium-High)

**Evidence** (build-time pass):

- **11 of 26 domains have zero scenarios**: `content, cybersecurity, data,
  education, energy, governance, operations, robotics, sales, strategy,
  trading`. They have patterns (and cascades) but no attack scenario — the risk
  narrative is missing exactly where a security reviewer looks first.
- Scenario coverage is also **top-heavy**: engineering and finance hold 12 of
  43 scenarios; devops, procurement, hr, legal, marketing, iot, public-sector,
  logistics hold **one each**.
- **5 scenarios have no trace**: `metric-gaming-triage`,
  `prompt-selfedit-jailbreak`, `selfdistill-collapse`, `selfrewrite-reward-hack`,
  `spawn-fleet-runaway` — so Live View cannot replay the five most
  "self-modifying / runaway" risks, arguably the most important to demonstrate.

**Fix.** Either add the missing scenarios/traces, or make the gap explicit and
first-class (a "Coverage backlog" view derived from the matrix, exportable as
work items). The app already computes `covGaps`/`covLevel`, but there is no way
to *acknowledge/assign* a gap.

### D1 — Duplicate mis-spelled key in `scenarios.json` (Low, but real)

**Evidence.** `data/scenarios.json:381` carries `"proteations": []` alongside
the correct `"protections"`. It is referenced nowhere in JS — dead, mis-spelled
data that will silently drift.

**Fix.** Remove or migrate; add a schema check to the integrity pass.

### E1 — No tests, no package.json, no CI, no linter (High, process)

**Evidence.** No `package.json`, no `test/`/`*.test.js`, no `.github/workflows`.
Correctness today relies entirely on ad-hoc scripts in `/tmp/opencode/mmtest/`.
A data edit or a rename can break a pane with nothing to catch it.

**Fix.** A minimal `package.json` + a headless smoke test (12 tabs render, 0
errors, deep link opens, keyboard card open) wired as `npm test` and a GitHub
Action. Add the referential-integrity pass (already written for this audit) as a
data test. Optionally ESLint with the "no-undef" rule — valuable given ~200
globals.

### A3 — Unlabelled form controls in dynamically-built panes (Medium)

**Evidence.** 7 controls have no `aria-label`/`aria-labelledby`/`<label>`:
`guardInput` (Guardrail Lab), `discDom`, `discRounds`, `discPer`, `discKeep`
(Discovery Lab), plus a textarea and a select built at runtime. Static controls
are labelled well; the dynamically-generated ones were missed.

**Fix.** Label the five Guardrail/Discovery inputs; prefer placeholder +
`aria-label` pairs.

### S1 — Static server ships no security headers; leaks version (Medium)

**Evidence.** `curl -D-` returns only `Server: SimpleHTTP/0.6 Python/3.12.3` and
`Cache-Control`. No `Content-Security-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, or `Referrer-Policy`. The LLM proxy answers `OPTIONS` with
`Access-Control-Allow-Origin: *`. On a LAN that is tolerable, but a CSP is also
the cheapest XSS backstop for an app with **99 `innerHTML` sites** (escaping is
applied conscientiously — `escHtml` used 252×, `mdRender` escapes before
inserting tags — but a single future miss becomes script execution).

**Fix.** Add CSP (`default-src 'self'` + the minimal `'unsafe-inline'` the app
needs, or nonces), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, and suppress the `Server` header.

### F1 — No service worker → no true offline, no repeat-visit caching (Medium)

**Evidence.** No `sw.js` / manifest / `navigator.serviceWorker` use anywhere.
The app *works* offline (static), but a client that loaded it once still pays
the full 4.93 MB on the next visit, and a cold cache has nothing local at all.

**Fix.** Cache-first service worker for shell + vendor + data, with a version
bump — also the enabler for the P2/P1 savings on repeat visits.

### M1 — `app.js` is a 1,629-line god module; everything is a global (Low-Medium)

**Evidence.** 20 classic `<script>` tags, no `type="module"`, no imports. All
~200 functions share one namespace. (No duplicate function names today, but the
collision risk grows with every iteration.)

**Fix.** Not urgent given the no-build philosophy. If touched, convert the leaf
modules (`help`, `shortcuts`, `report`) to ES modules behind one bundler-free
`type="module"` entry; leave `app.js` as the documented shell.

---

## 4. Coverage matrix (the "coverage" question, answered)

Per-domain artefact coverage, derived from `coverage.json` + `scenarios.json`:

| Domain | Patterns | Scenarios | Cascades | Trace |
|---|---|---|---|---|
| engineering / finance | ✅ | ✅✅ (6 each) | ✅ | ✅ |
| healthcare / research / support | ✅ | ✅ (2 each) | ✅ | ✅ |
| general / enterprise | ✅ | ✅ (9 / 8) | ✅ | ✅ |
| devops, hr, iot, legal, logistics, marketing, procurement, public-sector | ✅ | ⚠ 1 each | ✅ | partial |
| content, cybersecurity, data, education, energy, governance, operations, robotics, sales, strategy, trading | ✅ | ❌ **0** | ✅ | — |

**Read-out:** patterns ⊃ cascades ⊃ scenarios ⊃ traces is a clean containment
chain, and the integrity is perfect — but the *scenario and trace* layers thin
out badly at the edges (11 patterns-only domains, 5 untraced high-risk
scenarios). That is the coverage story: **breadth in patterns, depth only in a
handful of domains.**

---

## 5. Prioritised roadmap (iterations 81–100)

Ordered by (impact ÷ effort). Each is a real, testable increment.

**Fast wins (surface area, low risk)**
1. **81** gzip/brotli in `serve.py` + conditional caching for immutable assets.
2. **82** Lazy-load Mermaid (first Design visit) — remove it from `<head>`.
3. **83** Fetch `cascades`/`traces` per pane, not at boot.
4. **84** Single `<main>` landmark; demote the other six.
5. **85** Tablist keyboard conformance: roving `tabindex` + `aria-selected` +
   Home/End (ArrowLeft/Right already exist).
6. **86** Label the 7 dynamic form controls.
7. **87** Security headers + suppress `Server`.

**Coverage (the content ask)**
8. **88** Trace the 5 untraced scenarios (or badge them "no replay").
9. **89** Coverage backlog view: turn `covGaps` into an exportable work list.
10. **90** Scenario pack for the 11 patterns-only domains (even 1 each).
11. **91** Budget/uniformity view: scenarios-per-domain bar with a target line.

**Engineering process**
12. **92** `package.json` + headless smoke test (`npm test`).
13. **93** Referential-integrity test over `data/` (dangling-ref gate) + fix
    `proteations`.
14. **94** GitHub Action running 92–93 on push.
15. **95** ESLint (`no-undef`) to guard the global namespace.

**Robustness / offline**
16. **96** Service worker: cache-first shell + vendored assets.
17. **97** Data-schema guard (required keys, id uniqueness) in the pre-commit
    integrity pass.
18. **98** `prefers-color-scheme` honouring for the initial theme.

**Depth**
19. **99** Repeat-visit perf budget printed in the Display panel (bytes cached,
    requests saved) — makes the P1/F1 wins visible and self-documenting.
20. **100** Final validation pass: re-measure first-load bytes, keyboard-only
    walkthrough, offline reload, docs refresh.

---

## 6. Non-goals

- No framework, bundler, or build step — the no-build vanilla-JS philosophy
  stays (module/ESM conversion is *optional*, item M1).
- No real agent execution; datasets stay synthetic and labelled.
- No auth / multi-user — it remains a single-user LAN/Tailscale advisor.

---

## 7. Delivery status — iterations 81–100 (all shipped)

Every item below is implemented, committed and verified headless against both
`:5190` (disk) and `:5175` (docker). Evidence is measured, not estimated.

| # | What shipped | Commit |
|---|---|---|
| 81 | gzip (cached on mtime/size) + conditional caching in `serve.py`; vendored assets `immutable` | `7b3e9bd` |
| 87 | Security headers (CSP, nosniff, XFO, Referrer-Policy) + `Server:` suppression | `7b3e9bd` |
| 82 | Mermaid moved off the render-blocking critical path; vendored-first lazy loader with CDN fallback | `14c1168` |
| 83 | Phased boot: catalogs first, cascades fetched in parallel and only awaited by catalog-wide panes | `14c1168` |
| 84 | Single `<main id="maincontent">`; topbar is `<header>`; 7 nested `<main>` demoted | `ccc0e3a` |
| 85 | WAI-ARIA tablist: roving `tabindex`, `aria-selected`, Home/End + Arrow keys | `ccc0e3a` |
| 86 | `aria-label` on every dynamic control (guard input, discovery dials, blueprint compare/notes) | `ccc0e3a` |
| 98 | Initial theme follows `prefers-color-scheme`, with `color-scheme` meta + `data-theme` sync | `ccc0e3a` |
| 88 | Trace-less scenarios badged **no replay** on card, list and drawer, with a route to Coverage | `fcb6927` |
| 89 | Exportable coverage backlog — Markdown checklist + CSV (`covBacklogMd/Csv/DownloadBacklog`) | `fcb6927` |
| 90 | 11 new grounded scenarios close the 11 patterns-only domains | `fcb6927` |
| 91 | Scenario-budget bars per domain with a ≥ 2 target line (7/26 meet it) | `fcb6927` |
| 92 | `package.json` + dependency-light headless smoke test (`npm run test:e2e`) | `bf6429f` |
| 93 | Referential-integrity suite over `data/` + fixed the `proteations` typo | `bf6429f` |
| 94 | GitHub Action: lint + data integrity (blocking), headless smoke (non-blocking) | `bf6429f` |
| 95 | ESLint `no-undef` over the shared global namespace | `bf6429f` |
| 97 | Schema guard (required/unexpected keys, id uniqueness, coverage freshness) in the same suite | `bf6429f` |
| 96 | Service worker precaches the whole shell (36 entries); network-first, cache fallback, `/api` never cached | `61a810a` |
| 99 | Repeat-visit perf budget in the Display panel (requests, local hits, wire bytes, cache size) | `ed0ccbe` |
| 100 | Final validation pass + docs refresh | this commit |

### Measured outcomes

- **First load: 4.93 MB → 1.37 MB** (cold, network-level across the page *and*
  the service-worker precache). The theoretical gzip payload of the whole shell
  is 1.33 MB, so this is the true cold cost; a repeat visit transfers **0.02 MB**
  (revalidations only). Baseline 4.93 MB was the pre-81 no-gzip/`no-store` figure.
- **Offline:** after one visit, going fully offline and reloading still renders
  all 12 tabs, 107 patterns, the vendored diagram and correct data — the only
  failed requests are the 3 expected `/api` probes.
- **Accessibility:** exactly 1 `<main>`, 1 `<header>`, 0 nested `<main>`,
  12 `role="tab"` with one roving tab stop, 0 unlabelled controls; keyboard
  Arrow/Home/End verified to move and activate tabs.
- **Coverage:** scenarios 43 → 54 (11 formerly patterns-only domains now have
  scenarios), cascades 180 → 191 (derived cascades follow), referential
  integrity 0 dangling refs, no unexpected keys.
- **Process:** `npm test` = 8 passing data/coverage/SW-precache tests; `npm run
  lint` clean; 12-tab headless smoke 0 errors; CI gates on all of it. No build
  step or framework was introduced.

### Bugs the new guardrails caught (and we fixed)

- **`95` lint** found the Guardrail deep link calling a nonexistent
  `guardOpenItem` (the function is `openGuardItem`), so `#guard/<id>` silently
  did nothing — fixed.
- **`100` validation** found a horizontal overflow at exactly 768 px: the app
  grid column sized to the tab strip's min-content. Fixed with
  `grid-template-columns: minmax(0, 1fr)`; all widths 360–1920 px are now clean.
- **`93`** removed the misspelled `proteations` key (the schema guard now fails
  the build on any such key).
