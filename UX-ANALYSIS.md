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
