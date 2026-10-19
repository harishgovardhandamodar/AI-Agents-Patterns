# UX Analysis — AI Agent Patterns & Guardrails (iterations 31–50)

Audit method: headless-browser DOM/computed-style inspection of every pane at
1440×900 and 390×844, plus a code review of feedback, persistence and
affordance paths. Findings below drove the 20 UI/UX iterations that follow.

## Findings (severity ordered)

### F1 — No undo anywhere; destructive actions are one-way (High)
`bpRemove`, `bpClear`, `bpDeleteLib`, `deleteGuardItem`, `dpReset` all mutate
immediately. The only feedback is a 4.2-second toast. A mis-click on a
10-component blueprint (threat model, estimate and all) is unrecoverable.

### F2 — Notifications are ephemeral, silent and inert (High)
`showNotif` builds a fixed inline-styled box with a 4.2s timer: no
`role="status"` / `aria-live` (invisible to screen readers), no actions, no
history, no stacking limits, hover doesn't pause the timer. 0 aria-live regions
exist app-wide.

### F3 — Density: the Cascades pane renders ~1,912 live elements / 58k chars (High)
Cascades is the app's core differentiator but its most punishing pane: every
card carries path, amplifiers, mitigations and links at once. Patterns (23k
chars) and Scenarios (13k) follow. No user control over density; body text is
13px.

### F4 — Sub-24px hit targets concentrated where mobile users need them (High)
Coverage pane: 25 tiny targets; Blueprint: 9; Guardrail Lab: 5. At 390px these
are below the 44px touch guideline (and even the 24px desktop minimum I
measure against).

### F5 — Cross-tool workflow requires copy-paste (Medium-High)
Scenario protections, cascade mitigations and pattern drawers *describe* the
controls a blueprint needs but offer no one-click "add to blueprint" or "ask
the copilot about this". The user context-switches and retypes ids.

### F6 — No onboarding path; first-run is a wall of stats (Medium)
A first-time architect sees counters and 11 tabs. The dashboard's "Next:"
helps, but there is no stated path for the three real jobs (plan a
deployment / design an architecture / research failure modes).

### F7 — Copilot messages have no affordances (Medium)
No copy, no regenerate, no suggested follow-ups, streaming is not announced
(`aria-live`), and there's no visible backend status — the user can't tell
Fox-Services from axiom from the deterministic fallback without reading meta.

### F8 — Jargon is unexplained (Medium)
"Emergent" vs "cascading" vs "derived", STRIDE, blast radius, autonomy tiers —
load-bearing terms with no inline glossary. The Design docs explain them, but
a user mid-task shouldn't have to leave the pane.

### F9 — Empty states are mostly absent (Medium)
Only Patterns, Blueprint and Copilot have designed empty states (3 of 11
panes). Searching Scenarios/Cascades/Coverage to zero leaves an unexplained
blank grid.

### F10 — No pane help, no preferences, no skip link (Low-Medium)
Only a global shortcuts overlay. No per-pane help, no font-size/density
control, no skip-to-content, and switching tabs doesn't move focus into the
pane (keyboard users re-tab from the top bar each time).

## Iteration plan (31–50)

| # | Iteration | Findings |
|---|---|---|
| 31 | Notification v2: aria-live, actions, history, hover-pause | F2 |
| 32 | Undo/redo stack (blueprint, library, guardrail) + Ctrl+Z | F1 |
| 33 | Backend status pill in topbar (Fox-Services / axiom / fallback) | F7 |
| 34 | Autosave/saved-status feedback on stateful tools | F2 |
| 35 | Density + font-size preferences, persisted | F3 |
| 36 | Cascades progressive disclosure (collapsed cards, expand) | F3 |
| 37 | Patterns/Scenarios list density + sort controls | F3 |
| 38 | Sticky filter bars with live counts on catalog panes | F9 |
| 39 | "Add to blueprint" from every drawer and gap row | F5 |
| 40 | "Ask copilot" deep-links auto-send from every drawer + coverage | F5, F7 |
| 41 | Pinned working set (patterns/scenarios/cascades) + Overview panel + export | F5 |
| 42 | Blueprint compare (current vs template/library: diff + delta) | F5 |
| 43 | First-run onboarding with three guided paths | F6 |
| 44 | Per-pane help + inline glossary tooltips | F8 |
| 45 | Designed empty states across all 11 panes | F9 |
| 46 | Copilot message actions, follow-up suggestions, announced streaming | F7 |
| 47 | Skip link, focus trap, focus-after-jump, list semantics, full form labels | F10, F2 |
| 48 | 24px+ touch targets on all panes at 390px | F4 |
| 49 | Palette v2: commands, recents, usage learning, match highlights | F5, F9 |
| 50 | Final UX validation + docs | all |

## Delivery status

All 20 iterations (31–50) are implemented and committed on `feat/architect-copilot`,
each verified headless (no page errors) before commit. Headline numbers:

- Notifications: announced (`role=log`/`alert`), hover-pause, history log, capped stack.
- Undo: global Ctrl+Z / Ctrl+Shift+Z over blueprint, library, guardrail and deploy ops.
- Density: cascades first paint ~1,912 → ~700 live elements (paged list + backlog);
  user density + 13–16px font preferences, persisted.
- Mobile: 0 sub-24px effective targets across all 11 panes at 390px.
- Accessibility: skip link, dialog focus traps, focus-after-jump, list semantics,
  every input labelled; streaming + toasts announced via live regions.
- Wayfinding: onboarding tour, per-tab guides + 18-term glossary, palette
  commands/recents/usage learning, pinned working set, sticky filter bars with
  removable chips, designed empty states on every pane.

## Iterations 51–60 (post-50 hardening, on `main`)

| # | Change | Commit |
|---|---|---|
| 51 | 5 self-improving-agent scenarios (43 total); cascades regen 175→180; new `tools/gen_coverage.py`; dynamic counts via `catN()` | `f31f3f7` |
| 52 | Architect Copilot renamed to **Fox - Architect** across UI, prompts, exports | `10c935d` |
| 53 | Qwen 3.8-27B default served via **axiom first** (`LLM_PRIMARY`, Fox-Services fallback) | `8d16be4` |
| 54 | Markdown tables + fenced Mermaid diagrams render in chat; prompt guidance | `4f38bba` |
| 55 | Bare (unfenced) diagram detection + error-source fallback in chat | `f50227e` |
| 56 | Mermaid native error-SVG swapped for readable source in chat | `a54c455` |
| 57 | Double-fencing fix (bare detector skips fenced blocks) + empty-fence guard | `b9de4ef` |
| 58 | Overview landing page: hero, self-improvement spotlight, field notes, incident diagram, class chart | `e37f293` |
| 59 | Light-mode Mermaid readability (dual-readable fills, label halos both themes) | `626657c` |
| 60 | Merge to `main` + docs refresh (README, design docs, this file) | — |

Field notes in the landing page cite real Oct-2026 research (SEABench, SAVER
survey, APEX/ClawGuard/ActGuard, FIDES/Janus); each note links into the catalog
items that cover it. The `X-Fox-Backend: axiom` header on every proxied chat
call is the ground truth for which backend served an answer.
---

# Iterations 61–80 — deep UI/UX audit (measured)

Audit method: headless-Chrome instrumentation of the live app at
1600/1440/1366/1280/1152/1024/900/820 px plus DOM, computed-style, contrast and
offline probes; each finding cross-checked against the code path behind it.
Numbers below are measured, not estimated.

## Findings (severity ordered)

### G1 — 12 tabs, but ~4 are invisible with no way to reach them (High)
At every width ≤ 1440 px the tab bar scrolls horizontally and the last tab is
off-screen (`lastTabOffscreen: true` at 1440/1366/1280/1152/1024/900/820).
Switching to Discovery leaves it at `left: 1409 / barRight: 1440` — i.e. the
active tab is **not scrolled into view** (`visible: false`). A mouse-only
desktop user has no horizontal-scroll affordance, so whole panes are
effectively undiscoverable.

### G2 — Catalog cards cannot be opened by keyboard (High)
`.pat-card` (patterns.js:157, scenarios.js:71) and `.cas-card`
(cascades.js:490) are clickable `<div role="listitem" onclick=…>` with **no
`tabindex` and no key handler**. Keyboard users can browse the catalog but
cannot open a single item. The compact mini-rows already do this correctly
(patterns.js:181), which makes the card view a silent trap.

### G3 — `--text3` fails WCAG AA wherever it is used (High)
Measured contrast `--text3` on `--bg2`: **3.77:1** (dark) and ~3.0:1 (light) —
below the 4.5:1 AA floor for normal text. It is the colour of every rail
section label (`h4`), kicker and muted hint, i.e. the app's navigation
signage. `--text2` (5.62:1) and `--accent` (6.85:1) pass.

### G4 — No persistent live region; navigation is silent to screen readers (Medium-High)
`[aria-live]` regions present at load: **0**. Toasts create an announced
`role=log` on first use, and copilot streams into its own — but *tab changes,
filter result counts and pane loads are never announced*. A screen-reader user
gets no confirmation that anything happened.

### G5 — Diagrams depend on a public CDN in a "nothing leaves your network" app (Medium-High)
`index.html:9` loads Mermaid from `cdn.jsdelivr.net`. The README promises a
LAN/Tailscale/air-gapped deployment, but with the CDN blocked the design docs,
copilot diagrams and zoom viewer lose every diagram. This is the only
third-party runtime dependency in the product.

### G6 — User state has no backup or restore (High)
Blueprints, the pattern library, guardrail analyses, the deployment plan, the
copilot chat, pins and preferences live only in `localStorage`. Each tool can
export its own JSON, but there is **no single "back up everything / restore
everything"**, and no visible storage-health signal. A cleared profile or a
quota trim silently destroys work.

### G7 — No deep links to items (Medium)
Only `#tab` (and `#design/<doc>`) are addressable. A pattern, scenario,
cascade or guardrail result cannot be linked, bookmarked or shared, and the
browser Back button does not close an open drawer.

### G8 — Every pane renders at boot, no first-visit feedback (Medium)
`loadAll` initialises all 12 panes eagerly (~4,900 nodes at t=1.39 s) even
though only one is visible. The heavy panes (patterns 979, cascades 782,
coverage 744) are built for tabs the user may never open, and there is no
skeleton when they first appear.

### G9 — Long operations have no global affordance (Low-Medium)
Discovery runs/compare, copilot streaming and the model probe all take time;
the only signal is local to the pane (or a disabled button). Nothing in the
shell says "working…".

### G10 — Toast noise and jargon (Low-Medium)
Identical consecutive toasts stack (up to 4) and cannot be dismissed from the
keyboard; load-bearing terms (blast radius, emergent, autonomy tier) have no
inline definition outside the Design docs.

## Iteration plan (61–80)

| # | Iteration | Findings |
|---|---|---|
| 61 | Tab bar: scroll active tab into view + overflow chevrons + edge fades | G1 |
| 62 | Keyboard tab cycling (`[`/`]`, Alt+←/→) + shortcuts help | G1 |
| 63 | Persistent app live region; announce tab change + filter counts | G4 |
| 64 | Topbar responsive tiers + accessible names on icon-only buttons | G4 |
| 65 | Keyboard-operable cards (patterns/scenarios/cascades/domains) | G2 |
| 66 | Contrast: raise `--text3` (both themes) to AA | G3 |
| 67 | Vendor Mermaid locally (offline-safe) with CDN fallback | G5 |
| 68 | Backup / restore all user state (download + file picker) | G6 |
| 69 | Storage health + one-click trim in the display panel | G6 |
| 70 | Deep links `#kind/id` open the item; drawer reflected in the hash (Back closes) | G7 |
| 71 | Copy link / copy id / copy summary in the detail drawer | G7 |
| 72 | Lazy pane init on first visit | G8 |
| 73 | Skeleton placeholders while a pane first loads | G8 |
| 74 | Global busy pill for long operations (discovery, copilot, probe) | G9 |
| 75 | Toast dedupe with ×N counter; Esc dismisses the newest | G10 |
| 76 | Per-pane filter/query/sort memory across reloads | G8 |
| 77 | Inline glossary tooltips for load-bearing jargon | G10 |
| 78 | Chart accessibility: `role=img` + textual summaries | G3 |
| 79 | Empty-state actions everywhere; "clear search" from a zero-result grid | G7 |
| 80 | Final headless validation pass + docs refresh | all |

## Delivery status

Implemented and committed on `main`, each batch verified headless (no page
errors, measured before/after) before commit.
