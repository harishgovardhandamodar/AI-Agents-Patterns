# Findings & Improvements

**Project:** AI-Agents-Patterns (`/home/fox/WorkBook/AI-Agents-Patterns`)
**Date:** 2026-10-28
**Scope:** the six books, the three-generation book pipeline, the app's agents (Fox-Architect, Expander, Bookshelf), the renderer, the server, CI, and repository hygiene.
**Method:** read the generated books against `data/*.json` and the generators; checked every quoted ID/count/schema claim; compared PDFs (bookmarks, metadata, blank pages, text layer); inspected git history and the HTTP surface. Reproducible commands are in §10.

> **Short verdict.** The catalog and its data tests are strong. The *prose layer* is not. The expanded editions systematically claim a provenance, a verification process, and a deterministic build that the repository does not have. In the worst case the PDF says, in visible text, that no language model wrote it, while the only admission that `qwen3.8` wrote it is an HTML comment that the PDF strips. That is the central issue, and it is fixable.

---

## 1. What exists

Six books, up to three generations each:

| Book | Source (deterministic) | Pass 1 (LLM "humanized") | Pass 2 (`.axiom` "humanized + formal") | Expansion | PDF pages (src / p1 / p2) | Bookmarks (src / p1 / p2) |
|---|---:|---:|---:|---:|---:|---:|
| Agentic Patterns & Guardrails | 123,381 w | 154,723 w | — | 1.3× | 506 / 632 / — | 28 / 0 / — |
| Self-Learning Agents | 51,271 w | 118,894 w | — | 2.3× | 119 / 145 / — | 19 / 0 / — |
| Field Playbooks | 12,024 w | 23,654 w | 108,723 w | 9.0× | 63 / 83 / 131 | 9 / 0 / 0 |
| OpenShell Reference Architecture | 22,483 w | 34,481 w | 184,443 w | 8.2× | 73 / 106 / 215 | 15 / 0 / 0 |
| Rogue Agents | 23,981 w | 32,036 w | 134,208 w | 5.6× | 53 / 52 / 155 | 19 / 0 / 0 |
| Workflows | 16,417 w | 29,568 w | 161,938 w | 9.9× | 65 / 88 / 188 | 15 / 0 / 0 |

- **~0.86 M words of expanded editions** on top of ~0.25 M source words.
- **17 PDFs on disk**, 13 tracked, 4 AXIOM PDFs untracked; **all 11 humanized PDFs have 0 bookmarks**; the deterministic PDFs have 9–28.
- The real catalog is **107 patterns, 54 scenarios, 191 cascades, 55 traces, 26 domains**; the research graphs add **51 + 35 works, 21 + 18 concepts, 9 dimensions, 7 trails**.
- **What is good:** the data layer has a real schema test (`test/data.test.mjs`) that checks dangling references, coverage freshness, and counts; the deterministic build is coherent; the book skeleton (parts, chapters, diagrams, field notes) is genuinely useful; the app has CSP/link-safety tests and a thoughtful UI.

The problem is not the catalog. It is what the books say *about* the catalog and about themselves.

---

## 2. Findings index

| ID | Severity | Finding | Primary evidence |
|---|---|---|---|
| P0-1 | **P0** | Expanded PDFs ship false provenance; the true disclosure is an HTML comment removed from the PDF | `AXIOM-OPENSHELL…md:8058`; `…:1`; PDF text line 20071 |
| P0-2 | **P0** | A fictional "counsel quorum" is presented as a real review with signatures; the book cannot agree whether it has 3, 4, or 5 architects | `AXIOM-FIELD…md:17,41,261,285`; `tools/field_book_prose.py:11` |
| P0-3 | **P0** | Fabricated data schemas, IDs, environment variables, and build behavior are presented as worked examples | `AXIOM-FIELD…md:4628-4647`; `AXIOM-OPENSHELL…md:7959-8052`; `AXIOM-WORKFLOWS…md:7254-7315` |
| P0-4 | **P0** | The quality gate is "longer than input + contains three markers"; failed sections are silently published | `tools/expand_humanized.py:20-24,45,58-82` |
| P0-5 | **P0** | Unauthenticated destructive endpoints bind all interfaces; cross-origin pages can trigger them | `serve.py:70,827-829,926-928,1002-1015` |
| P0-6 | **P0** | The renderer needs the public CDN, swallows Mermaid/MathJax failures, and prints unsanitized LLM HTML | `tools/render_humanized_pdf.py:19-20,45-50` |
| P1-1 | **P1** | Formalization is forced and sometimes wrong (unit errors, conflation, tautology, per-chapter numbering) | `AGENTIC…md:453,572`; `AXIOM-FIELD…md:33,4594` |
| P1-2 | **P1** | Internal contradictions: 26 vs 22 vs 21 domains; "most domains carry two" vs 19/26 with one; chapter 40/47 in a 29-chapter book | `AXIOM-FIELD…md:23,31,189,414` |
| P1-3 | **P1** | Repetition and padding: 115 forced Definition/Theorem pairs and repeated paragraphs; source-level headings also collide (115× "How It Works") | `AGENTIC…md`; `book/AGENTIC…md`; `ROGUE-AGENTS.md:792-1006`; `AXIOM-ROGUE…md:4932-5710` |
| P1-4 | **P1** | PDF usability regressions: 0 bookmarks, no Title/Author, 2 blank pages, hidden TeX in the text layer | PDF inspection (`pypdf`, `pdftotext`) |
| P1-5 | **P1** | Invented/unsupported biography and process claims ("9 months", "4 draft cycles", "3 works failed verification") | `SELF…md:167,213`; no source/data match |
| P1-6 | **P1** | App agent "grounding" is retrieval context, not claim-level verification; no semantic eval | `js/copilot.js:503`; `test/copilot.test.mjs` |
| P1-7 | **P1** | Docs and build surface drift: 39 vs 55 traces; "three books" vs six; no npm scripts for three books; CI never builds a book | `README.md:35,252,315`; `package.json`; `ci.yml` |
| P1-8 | **P1** | Repo bloat: 92 MB `.git`; the same 7.3–8.5 MB PDF committed 9 times; 34 MB tracked; 31 MB untracked AXIOM | git history |
| P2-1 | P2 | No single source of truth for counts; every book/README copies numbers by hand | `data/*.json`, `README.md` |
| P2-2 | P2 | No real review ledger, no provenance manifest, no release/archival process | pipeline-wide |

---

## 3. P0 findings

### P0-1. The PDFs make a false provenance claim, and the only true disclosure is stripped

The AXIOM OpenShell PDF contains this visible sentence:

> "For transparency: no large language model generated the prose in this book. … The build pipeline is deterministic end-to-end."
> — `Books/Humanized/.axiom/AXIOM-OPENSHELL-REFERENCE-ARCHITECTURE.md:8058`, rendered in the PDF at `pdftotext` line 20071.

The same file begins with:

> `<!-- Expanded: qwen3.8:latest (temp 0.7). … -->`
> — `AXIOM-OPENSHELL-REFERENCE-ARCHITECTURE.md:1`

The comment is an HTML comment. Chromium does not render it, and `pdftotext` finds **zero** occurrences of "qwen" or "expanded by" in the PDF. So the reader of the artifact gets the denial, not the admission.

This is not an inherited line: the pass-1 OpenShell book does not contain it. It was **added by the pass that was itself LLM-generated**. The same expansion added "five-member counsel" and "three independent architects" to a source that says "four architects."

The same pattern appears across the expanded editions:

- `Books/Humanized/FIELD-PLAYBOOKS.md:77`, `OPENSHELL-REFERENCE-ARCHITECTURE.md:94`, `AXIOM-FIELD…md:281`, `AXIOM-WORKFLOWS…md:285`, `AXIOM-ROGUE…md:295` all say the book was generated by a deterministic script and typeset with the **vendored** Mermaid engine `tools/render_pdf.mjs`.
- The humanized path uses `tools/render_humanized_pdf.py`, which loads **MathJax and Mermaid from `cdn.jsdelivr.net`** (`tools/render_humanized_pdf.py:19-20`). There is no vendored engine in that path, and the build is not offline.
- `AXIOM-FIELD…md:4592-4605` goes further and **proves** the build is a pure function: "No wall-clock timestamps, no random seeds, no network fetches are permitted." The actual expander runs at `temperature: 0.7` with no seed (`tools/expand_humanized.py:58-65`), calls a model over the network, and the renderer fetches CDN assets. The proof is not merely unsupported; it is false of the document that contains it.
- `AXIOM-ROGUE…md:5878` says a missing/broken diagram makes the build fail. The renderer catches Mermaid errors and continues (`tools/render_humanized_pdf.py:47-49`), and the AXIOM Rogue edition has 24 Mermaid blocks versus 25 in its source.

**Why it matters.** A book about auditability and guardrails is using a provenance claim as its trust anchor. If the provenance is false, every "verified" claim downstream loses credibility. This is the single highest-value fix.

**Fix.**
1. Put a **visible** "About this edition" page at the front of every expanded PDF: source commit, model, temperature/seed, prompt version, date, section-level status, and reviewer (or "no human review").
2. Delete every sentence that claims a deterministic/vendored/offline pipeline for the humanized path, or make it true by vendoring the assets and pinning the model/seed.
3. Never let the build write "no LLM" unless the build can prove it.
4. Add a CI check that fails if a book contains "deterministic", "no network", "vendored", or "no large language model" without a matching `provenance.json`.

---

### P0-2. The "counsel of architects" is a fictional quorum

The expanded Field book says:

- "at least three independent architects … must sign a verification line for every scenario … Two signatures approve the logic. Three signatures approve the guardrails." — `AXIOM-FIELD…md:17`
- "the volume ships with a five-member counsel" — `AXIOM-FIELD…md:41`
- "a counsel verification from four architects" — `AXIOM-FIELD…md:261`
- "four architects reading every chapter and stamping a verdict" — `AXIOM-FIELD…md:285`

Those are three different quorum sizes in one preface. The underlying implementation is a Python dict:

- `FIELD_VERIFY` is a hardcoded dict of **31 keys** (chapters/domains, not 54 scenarios) with **4 fixed persona names** (`tools/field_book_prose.py:11`).
- The build only checks that the keys exist: `set(FIELD_VERIFY) != _need → sys.exit(...)` (`tools/build_field_book.py:139`).
- There is no signature, timestamp, reviewer identity, diff, or per-scenario verdict anywhere. The "verification line" is generated prose, written once, and reused.

The source book already used four persona voices as a rhetorical device (`book/FIELD-PLAYBOOKS.md:60`). That is defensible as a literary form if labelled. The expanded edition **escalates the device into a factual claim**: a five-member counsel, signatures, a quorum rule, and "no exceptions." It even defines it formally:

> `Definition 2 (Counsel Quorum Rule)` … `A = {a1,…,a5}` … `σ_s(a) ∈ {approve, flag, abstain}` … — `AXIOM-FIELD…md:41`

No such `σ_s` exists. The "quorum" is a lookup table.

**Fix.**
- Either remove the claim ("the following are editorial persona notes, not independent review") or build a real review ledger: `reviews/<book>/<section>.json` with reviewer, date, commit, verdict, and a signed diff. Render it in the PDF.
- Delete "signature/quorum/no exceptions" language until it is true.
- If you keep the personas, call them "editorial passes" and state that the text was generated, not reviewed.

---

### P0-3. Fabricated schemas, IDs, and build behavior are presented as worked examples

These are not minor illustrative simplifications. They teach a data model that does not exist.

**Field: "scenario 7, retry budget"** — `AXIOM-FIELD…md:4628-4647`

```json
{"id": "S-007", "pattern": "P-003", "retry_budget": 5, "timeout_ms": 45000, "escalate_to": "P-007"}
{"id": "P-003", "name": "Bounded Retry with Escalation", "max_retries_default": 5}
```

Reality:

- Scenario 7 is `code-secrets-gist` ("Agent commits secrets and pastes them into a public gist"), not a retry budget.
- IDs are slugs (`code-secrets-gist`, `chain-of-thought`), not `S-007`/`P-003`.
- Scenarios use `patternRefs`, not `pattern`; there is no `retry_budget`, `timeout_ms`, `escalate_to`, or `max_retries_default` in `data/scenarios.json` or `data/patterns.json`.
- `tools/field_book_data.py` does not "read S-007 and emit a table row"; the claim that `v1`/`v2` verify the sentence is invented.

**OpenShell: `P-024` / `SBX-004`** — `AXIOM-OPENSHELL…md:7959-8052`

The book says `data/coverage.json` has a per-scenario coverage triple, and that adding `P-024` ("Quorum-Gated Exclusion") to scenario `SBX-004` causes the build to check the cross-reference. Reality:

- `P-024` does not exist; pattern IDs are slugs. `SBX-004` does not exist; scenario IDs are slugs.
- `data/coverage.json` is `{domains, by_domain, totals}`, where `by_domain[domain]` has `patterns`, `scenarios`, and cascade lists. There is no per-scenario "coverage list" to append to.
- `build_openshell_book.py` loads the catalog and `coverage.by_domain`, checks archetype IDs and domain keys; it does not validate `P-024` or `SBX-004` (`tools/build_openshell_book.py:90-100`).

**Workflows: `circuit-breaker-v2` / Scenario 19** — `AXIOM-WORKFLOWS…md:7254-7315`

- `circuit-breaker-v2` is not in `data/patterns.json`; there is no validator that produces the quoted `Workflow reference 'circuit-breaker-v2' … has no scenario assignment` error.
- Real Scenario 19 is `procurement-seo-injection` ("Vendor selection steered by attacker SEO content"), not a scenario assigning `["circuit-breaker-v2", "graceful-degradation"]`.
- There is no "prose extractor in `workflows_book_data.py`"; `build_workflows_book.py` only checks that council-deliberation keys exist (`tools/build_workflows_book.py:49`).
- The book's own back matter says "every workflow reference is validated against the shipped sources" (`book/WORKFLOWS.md:1137`, emitted by `tools/build_workflows_book.py:587-590`). That sentence is generated by the build, and it is false: no such prose-reference validator exists.

**`REPRODUCIBLE=1`** — `AXIOM-WORKFLOWS…md:7304`

> "The PDF metadata block … is written with a fixed epoch timestamp when the `REPRODUCIBLE=1` environment variable is set, which the CI pipeline always sets."

`REPRODUCIBLE` appears **only in the book**. It is not in the code, and CI never builds a book. The PDF metadata has a real `CreationDate` and no fixed epoch.

**Other fabricated operational details:**

- "The build prints the orphan's ID and exits with code 2" (`AXIOM-FIELD…md:4626,4667`). There is no orphan check in `build_field_book.py`, and `sys.exit("msg")` exits **1**; there is no `sys.exit(2)` anywhere in `tools/`.
- "The tabs in `js/shortcuts.js` are generated by iterating over the keys of `data/patterns.json`" (`AXIOM-FIELD…md:4657`). `SK_TABS` is a hardcoded array (`js/shortcuts.js:7`).
- "typing `S-007` or `P-003` or `K-012` jumps you to the right pane" (`AXIOM-FIELD…md:4657`). Those IDs do not exist.

**Fix.** This is exactly what a **claim ledger** is for. Every ID, field name, count, and environment variable in prose should resolve to a path in `data/` or `tools/`. The build should fail on unresolved claims. Until then, the books should use the real schema or clearly say "illustrative, not this repository's schema."

---

### P0-4. The quality gate cannot catch any of the above

`tools/expand_humanized.py` is the gate for pass 1/pass 2. Its rules:

- "Your output MUST be LONGER than the input section." — `:20-21`
- "MUST contain at least one **Definition**, one **Theorem**, and one *Proof.* block with real `$...$` mathematics." — `:22-23`
- "If no obvious theorem exists, formalize the section's core control as a state-transition rule and prove it preserves its invariant." — `:24`
- `_passes_checks` accepts only if `len(out) >= max(800, 1.2 * len(sec))` and the three markers appear — `:45-52`.
- On failure it retries 4 times; if all fail, it **keeps the best attempt and publishes it** with a console note `[NEEDS-REVIEW kept best: …]` — `:58-82`.
- The checkpoint is keyed by chunk index only; there is no source hash, prompt version, or model version — `:94-98`.

Consequences:

1. **Truth is never checked.** No ID validation, no numeric check, no schema check, no fact check, no duplicate check, no math check.
2. **Formalization is mandatory even when there is nothing to formalize.** This is the direct cause of tautological "theorems" and forced proofs.
3. **Failures are invisible.** A section that failed all four attempts is published identically to one that passed; the only trace is a line in a terminal log. The PDF has no `NEEDS-REVIEW` marker.
4. **Reproducibility is impossible.** Temperature 0.7, no seed, no prompt hash; the checkpoint can silently mix old chunks with a changed source.
5. **The header is an HTML comment.** The warning "verify before relying on them" is stripped from the PDF.

**Fix.**
- Make the gate **claim-based**, not length-based. At minimum: IDs exist, counts match `data/stats.json`, chapter refs are in range, no duplicate paragraphs > 80 words, math delimiters balance, and every `Definition/Theorem` is either linked to a source claim or labelled "illustrative."
- Add a per-section status (`verified`, `illustrative`, `needs-review`) and **exclude `needs-review` from the PDF** or print it with a visible banner. Never publish a failed section silently.
- Store `{source_sha256, prompt_version, model, temperature, seed, chunk_index}` in the checkpoint; refuse to reuse a chunk when the source hash changes.
- Add a "no theorem required" path and a "this is an argument, not a proof" label.

---

### P0-5. Unauthenticated destructive endpoints are exposed on all interfaces

`serve.py` describes the book/expand endpoints as "Same-origin only, like the /api/llm/* relay — a local operator tool, not a public API" (`serve.py:224`, `:546`). That is not what the code does.

- `HOST = os.environ.get("HOST", "")` — `serve.py:70`. An empty host passed to `HTTPServer((HOST, PORT))` binds **all interfaces** on Linux, so the "local" tool is reachable from the LAN/tailnet.
- `do_OPTIONS` sends `Access-Control-Allow-Origin: *` and allows `content-type` — `serve.py:926-928`. A preflight from any website succeeds.
- `do_POST` parses JSON from the body **without checking `Origin`, `Sec-Fetch-Site`, `Content-Type`, or a token** — `serve.py:1002-1015`. A malicious page can send `POST /api/books/build` or `/api/expand/launch` with `Content-Type: text/plain` (no preflight), and the handler will still parse it.
- `_read_body` trusts `Content-Length` with no cap — `serve.py:827-829` — so a request can allocate unbounded memory.
- Expansion jobs run up to **4 hours** (`proc.wait(timeout=14400)`, `serve.py:687-688`); there is no cancel endpoint (routes at `serve.py:25-31` list status/launch/job only).

The actual responses do not send `Access-Control-Allow-Origin`, so a cross-origin page cannot read the result. It does not need to: the **side effect** (rebuild all books, start a GPU-bound expansion, overwrite the humanized Markdown/PDF) is the attack. On a tailnet, a compromised laptop or a malicious page is enough.

**Fix.**
- Default `HOST=127.0.0.1`; require an explicit `--lan`/`HOST=0.0.0.0` opt-in.
- Add a per-session bearer token (printed at startup / stored in `~/.config`), require it on every `/api/books/*` and `/api/expand/*` call, and check `Origin`/`Sec-Fetch-Site`.
- Require `Content-Type: application/json`; cap `Content-Length` (e.g., 64 KB); add a job cancel route; add a per-job budget/time limit; serialize jobs.
- Remove `Access-Control-Allow-Origin: *` unless a specific origin is configured.

---

### P0-6. The renderer is network-dependent, silently lossy, and trusts LLM HTML

`tools/render_humanized_pdf.py` is the actual renderer for every humanized edition.

- It loads MathJax and Mermaid from the public CDN (`:19-20`). The build fails or degrades offline; the "vendored Mermaid / no CDN / no network" claims in the books are false for this path.
- It catches Mermaid errors and only logs `mermaid skipped: …` (`:47-49`); it catches MathJax errors with an empty `catch` and then prints. There is no assertion that every diagram/formula rendered, no page-level check, and no failure exit.
- It feeds Markdown through `markdown.markdown(...)` (`:45-50`) with raw HTML enabled by default; the HTML has no CSP. A model-generated `<script>`/`onerror` payload runs in Chromium with network access during the print. The source is LLM output, so this is an untrusted-content boundary.
- It sets no PDF metadata and no outline. `pypdf` reports `/Title: None`, `/Author: None`, 0 outlines for all 11 humanized PDFs; the deterministic renderer has 9–28 outlines.

**Evidence of lossy output:** two completely blank pages (0 text, 0 XObjects) at AXIOM Rogue p36 and Self-Learning p30; AXIOM Rogue has one fewer Mermaid block than its source; and the PDF text layer contains raw TeX from the hidden assistive MathML (`pdftotext` returns `\mathcal`, `\text`, `$…$` alongside prose). Math **is** visually rendered — MathJax fonts are embedded (`MathJax_Main`, `MathJax_Calligraphic`, etc.) — so do not call this a math failure. It is a copy/search/accessibility problem: copied text can include raw TeX.

**Fix.**
- Vendor `mathjax` and `mermaid` locally (npm packages or pinned files); add a `requirements.txt`/`pyproject.toml` for `markdown`, `playwright`, `pypdf`.
- Fail the build if `window.__renderState !== 'done'`, if any `.mermaid`/`mjx-container` is missing, or if the console has a Mermaid/MathJax error.
- Sanitize LLM HTML (disable raw HTML or use `bleach`) and add a CSP to the render page; block network requests in Playwright except `file://`/local assets.
- Generate PDF metadata and an outline from headings; assert `len(outline) > 0`, `Title`/`Author` set, and no blank pages.

---

## 4. P1 findings

### P1-1. Formalization is forced, and some of it is wrong

The expander's mandate ("if no obvious theorem exists, formalize…") produces math where none belongs. Three concrete examples from the main expanded book:

1. **Unit error in the ToT bound** — `AGENTIC-PATTERNS-AND-GUARDRAILS.md:572`

   > "explores at most `min(b^d, k · d · L)` node-expansions (for mean node cost `L` tokens)"

   `b^d` is a node count; `k · d · L` is beam width × depth × tokens/node = **tokens**. The `min` compares nodes to tokens. A token cap should be `min(b^d, B/L)`; the beam width is a per-level bound, not a total. This is a genuine dimensional error, not a stylistic quibble.

2. **Variance/error conflation** — `AGENTIC…md:453-455`

   > "Majority vote … reduces variance as `1/√N` …"
   > "*Proof.* … the majority error falls exponentially in `N` (Condorcet)."

   `1/√N` is the standard-error scaling of a mean; the variance of the mean scales `1/N`; the majority **error probability** decays exponentially. The theorem's statement and proof are about different quantities. It is a good intuition wrapped in an invalid proof.

3. **A tautological "coverage completeness" theorem** — `AXIOM-FIELD…md:33`

   > "If the partition is total … and the catalog is a faithful encoding … then there exists a domain … provided `s* ∈ S`."

   The conclusion is essentially the premise. The proof then adds "the generation is deterministic" — false for this edition (P0-1). A theorem that assumes its conclusion and a property the artifact lacks is worse than no theorem: it makes the claim look checked.

4. **Numbering is not usable across the book.** The main expanded book contains **115** `Definition 1` and **115** `Theorem 1` headings, one per pattern chapter. AXIOM has 37/63/47/56 pairs. "See Definition 3" is ambiguous without a chapter. In a reference work, definitions/theorems should be globally numbered or scoped in the label (`Def. 4.3`).

5. **Proof/QED discipline is inconsistent.** AXIOM Field has 63 theorems, 65 `*Proof.*` markers, 64 `∎`; Workflows has 94/96/77. Some proofs simply stop. If these are proofs, they need a closing marker and a checked step; if they are arguments, label them arguments.

**Fix.** Formalize only claims with a concrete invariant. Add a "no theorem" path. Require a math reviewer for any `Theorem`; check units and quantifiers; number globally; test formulas with a small script where possible; distinguish `Proof` from `Argument`/`Sketch`.

---

### P1-2. Internal contradictions and arithmetic

- **26 vs 22 vs 21 domains.** `AXIOM-FIELD…md:23` defines `D = {d1…d26}`; `:189` defines `D = {d1…d22}` but lists **21** names; the catalog has **26** (`data/coverage.json`). Part II covers six domains and Part III covers 21, so "22" is neither the catalog count nor the chapter count.
- **"Most domains carry two."** `AXIOM-FIELD…md:31` says `54/26 ≈ 2.08`, "so most domains carry two." The distribution is **19 domains with exactly 1 scenario, 3 with 2, 2 with 6, 1 with 8, 1 with 9**. "Most" is false; 19/26 are singletons. The average is not the mode.
- **3 vs 4 vs 5 architects.** `AXIOM-FIELD…md:17` (three), `:41` (five), `:261`/`:285` (four). The implementation has four personas.
- **Chapter 40/47 in a 29-chapter book.** `AXIOM-FIELD…md:414` says "when chapter 47 says…" and "by chapter 40…"; the book has 29 chapters (`grep -c '^## Chapter'` = 29). This is a broken cross-reference in the front matter.
- **"Numbers came from a production incident report."** `AXIOM-FIELD…md:15` says the numbers came from a production incident report or post-mortem; `:265` says the rehearsals ran on synthetic catalog scenarios and mock traces, "never on production systems." The source says the same (`book/FIELD-PLAYBOOKS.md:62`). One of these sentences has to go.

**Fix.** Generate counts from `data/` at build time; assert them; make the domain list a single constant; run a chapter-ref check; remove "production incident" provenance from synthetic material.

---

### P1-3. Repetition and padding

Two different problems are visible, and they should not be conflated:

**A. The source design repeats headings.** The deterministic main book already contains 115 `How It Works`, 126 `Council deliberation`, 116 `Conclusion`, and 115 `Council reading` headings (`book/AGENTIC-PATTERNS-AND-GUARDRAILS.md`: 1,649 headings, 274 unique). The humanized version is structurally almost identical (1,648 headings, 273 unique). This is a **source-level navigation defect**: identical heading text means colliding anchors and indistinguishable PDF/nav labels. It is not caused by the rewrite, but it is worth fixing in the deterministic build.

**B. The expansion adds padded/repeated prose.** This *is* expansion-specific:

- **ROGUE pass 1** repeats the paragraph "Limits: a pattern is a specification, not a deployment…" at least ten times (lines 792–1006), once per control.
- **AXIOM Rogue** repeats the "Safety researcher" paragraph seven times (lines 4932, 5079, 5221, 5366, 5478, 5609, 5710), sometimes with a different final sentence.
- **SELF** repeats a "Verdict: unmeasured by its own protocol…" paragraph four times.
- The 115 forced `Definition 1`/`Theorem 1` pairs in the main expanded book are new; the deterministic source has **zero** definitions/theorems.
- The expansion ratios (5.6–9.9× for AXIOM) mean that for every source claim there are 5–10× as many words of connective tissue. Fact density falls; review cost rises faster than length.

**Fix.** Add a duplicate-paragraph detector (>80 words, normalized) for the expansion, and a repeated-heading detector for the deterministic build (or make headings unique by including the pattern/part name). Require each expanded section to add *new* evidence, not new adjectives; cap expansion at, say, 2× unless a reviewer approves more; allow "no expansion" when the source is already complete.

---

### P1-4. PDF usability and provenance regressions

The deterministic PDFs are better artifacts than the "humanized" ones:

| Property | Deterministic (`book/*.pdf`) | Humanized (`Books/Humanized/*.pdf`) |
|---|---|---|
| Bookmarks/outline | 9–28 | **0** (all 11) |
| `/Title` metadata | set | **None** |
| `/Author` metadata | not set | **None** |
| TOC page numbers | generated by two-pass renderer | no outline; links only |
| Blank pages | none observed | **2** (Rogue p36, Self p30) |
| Provenance disclosure | build/provenance page | HTML comment only, stripped from PDF |

The `.gitignore` comment says "page numbers and bookmarks are folded into the shipped PDF" — true for `book/*.pdf`, but the humanized PDFs are a different renderer and were never given that treatment.

**Fix.** Use one renderer contract for all PDFs: outline from headings, Title/Author/Subject/Keywords, a visible provenance page, a TOC with page numbers, no blank pages, and a post-render assertion suite. If the humanized path cannot meet it, do not ship it as a "book"; ship it as a web edition.

---

### P1-5. Invented or unsupported biography/process claims

`Books/Humanized/SELF-LEARNING-AGENTS.md` says:

- "Chapter 14 · 51 works, verified … The 3 works that failed verification and why." — `:167`
- "Appendix B … The process. The 9 months. The 4 draft cycles. The verification protocol for the 51 + 35 works." — `:213`

The deterministic source already calls the 51 works "verified" (`book/SELF-LEARNING-AGENTS.md:39,908`), but there is no verification field in `data/sl_landscape.json`; "verified" is an editorial claim, not a recorded protocol. The **specific** "3 works that failed verification," "9 months," and "4 draft cycles" are added by the expansion and appear nowhere in the source. The data has 51 works and 35 works, 21/18 concepts, 9 dimensions, 7 trails — those check out. "9 months" and "4 draft cycles" are personal-history claims the model cannot know; they may be true, but they are unverifiable and presented as fact. The "3 works that failed" is more serious: it implies a verification protocol with results that do not exist.

The Field preface has the same problem in a different form: it claims production-incident provenance for synthetic scenarios (P1-2).

**Fix.** Remove unverifiable biography; if the author wants it, have the author write it and sign it. Replace "verified" with "curated" unless a verification record exists. Make "3 works failed" a data-backed count or delete it.

---

### P1-6. The app's agents are fluent, not grounded

**Fox-Architect** (`js/copilot.js`):

- The UI says "grounded in: …" and attaches citations with `assistant.cites = payload._ctx.cites` (`:503`). `_ctx` is the **retrieval context for the question**, not a set of claims the model used. If the model ignores the context and answers from parametric memory, the citations still appear. The system prompt asks the model to cite (`:349`), but nothing verifies that it did.
- There is no claim-level check (does the answer contain a catalog ID that is not in the context? does every numeric claim match `data/`?), no abstention path, and no semantic eval. `test/copilot.test.mjs` tests only markdown link safety (javascript:/data: links), which is good but unrelated to grounding.

**Expander** (`tools/expand_humanized.py`): see P0-4. It is an agent with a length objective and no truth objective.

**Bookshelf** (`serve.py`): it can launch a 4-hour job, rebuild all books, and overwrite Markdown/PDF, with no auth, no cancel, no budget, and no post-build QA. The UI treats "job done" as "book good."

**Fix.**
- Add a citation verifier: extract all catalog IDs/numbers from the answer; require each to appear in the retrieved context or `data/`; if not, mark the answer "unverified" and hide "grounded in."
- Add a small golden set (30–50 questions) with expected citations and a refusal case; run it in CI with a deterministic/recorded model backend.
- Add an abstention instruction and a visible "no source" state.
- For Expander, make the objective "every new claim has a source span or is labelled illustrative," not "longer."
- For Bookshelf, show per-book QA status and block "publish" when QA fails.

---

### P1-7. Docs and build surface drift

- `README.md:35` says "the 39 catalog traces"; the app and `README.md:112/165/229` say **55**. The stale 39 is in the Guardrail Lab row.
- `README.md:252` and `:315` say "all three books"; `serve.py` has **six** `BOOK_TARGETS` and six `EXPAND_SOURCES` (`serve.py:226`, `:548`).
- `package.json` has `book` (main), `book:rogue`, `book:self` — but **no** `book:field`, `book:openshell`, `book:workflows`, no humanized/QA script. Three of the six books have no documented rebuild command.
- There is no `requirements.txt`/`pyproject.toml`; `render_humanized_pdf.py` imports `markdown` and `playwright`, and the PDF checks use `pypdf`. A fresh machine cannot reproduce the pipeline from the repo alone.
- `.github/workflows/ci.yml` runs lint, data tests, and an e2e smoke test; it **never builds a book** and never runs a book QA check. The build validations that do exist (field/openshell/workflows) are not exercised in CI.

**Fix.** Generate the README counts from `data/stats.json`; add scripts for all six books and a `book:qa`; add Python deps; add a CI job that builds at least one deterministic book and runs `qa_books.py`; update "three" to "six" or say "the original three."

---

### P1-8. Repository bloat

- `.git` is **92 MB**; the working tree has **31 MB** of `Books/Humanized` + **17 MB** of `book/`.
- The main PDF (`book/Agentic-Design-Patterns-and-Guardrails.pdf`) appears **9 times** in history at **7.3–8.5 MB** each (~71 MB of the repo). It is a rebuildable binary.
- **34 MB** is tracked; **295 files** are tracked under `Books/Humanized`, including **281** intermediate `.parts`/`.checkpoints` files (2.3 MB + 956 KB).
- The four AXIOM PDFs (6.4 MB total) and `.axiom/` are **untracked**; the pass-1 PDFs are tracked. The release state is inconsistent: some editions are in git, some are not.
- There is no `.gitattributes`/LFS.

**Fix.** Stop committing PDFs; publish them as release assets (or use LFS if they must be in-tree). Ignore `.parts/`, `.checkpoints/`, and generated HTML. Keep one canonical Markdown source per book and a `dist/` manifest. If history size matters, use `git filter-repo` to drop old PDF blobs (after coordinating with collaborators).

---

## 5. Deeper analysis: how the pipeline produces this

### 5.0 What the second pass added

The first review established that the expanded books contain fabricated examples and PDF regressions. This second pass found the mechanism and several stronger facts:

- The false sentence "no large language model generated the prose" appears **only in the AXIOM edition**, not in the pass-1 edition — the LLM added a denial of its own authorship (`AXIOM-OPENSHELL…md:8058`).
- The expanded edition escalates the source's four-persona device into a **three/five/four-member quorum with signatures** (`AXIOM-FIELD…md:17,41,261`), and formalizes it as `Definition 2`.
- The expanded edition adds a `Theorem 1 (Determinism and idempotency)` that is **false of its own artifact** (`AXIOM-FIELD…md:4592-4605`): the expander is stochastic and the renderer uses a CDN.
- The expander **mandates** a Definition/Theorem/Proof even when no theorem exists, and the gate checks only length + three markers (`tools/expand_humanized.py:20-24,45`).
- When all retries fail, the gate **keeps the best attempt and publishes it** (`:58-82`); the PDF has no `NEEDS-REVIEW` marker.
- The checkpoint is keyed by chunk index with **no source hash** (`:94-98`), so a changed source can reuse stale chunks.
- The renderer **swallows** Mermaid/MathJax failures and prints anyway (`tools/render_humanized_pdf.py:47-49`); two PDFs contain completely blank pages.
- The humanized PDFs have **0 bookmarks, no Title/Author, and no visible provenance**; the only disclosure is an HTML comment stripped by the renderer.
- The Field book contradicts itself on **26 vs 22 vs 21 domains**, on "most domains carry two" vs 19/26 singletons, and on **chapter 40/47** in a 29-chapter book.
- The app's "grounded in" citations are **retrieval context**, not verified claims (`js/copilot.js:503`).
- The book endpoints are **unauthenticated and bind all interfaces**; the "same-origin only" comment is not enforced (`serve.py:70,926-928,1002-1015`).
- The repo's `.git` is **92 MB**, with the same 7.3–8.5 MB main PDF committed **9 times**.

### 5.1 The expansion contract rewards the wrong thing

The expander's prompt is effectively:

1. output must be **longer** than the input;
2. output must contain **Definition + Theorem + Proof**;
3. if there is no theorem, **invent one** by formalizing a control.

There is no requirement that a new sentence be true, traceable, non-duplicative, or useful. The acceptance check is length + three strings. The model is doing exactly what it was asked. The 5.6–9.9× ratios are not a bug in the model; they are the specified objective.

This is why the books read as confident, repetitive, and formally decorated. The model is optimizing for the measurable proxy (length/markers), not the unmeasured goal (truth).

### 5.2 The "verification theater" loop

There are three layers of claimed verification, and each one is weaker than the last:

1. **The source book's "counsel"**: four fixed persona paragraphs in `FIELD_VERIFY`, generated once. It is a rhetorical device, but the text presents it as a review.
2. **Pass 1**: the LLM rewrites the prose and keeps the counsel language; the book still claims the deterministic build.
3. **Pass 2**: the LLM formalizes the claims. It adds a `Definition 2 (Counsel Quorum Rule)` with five architects and signatures, and a `Theorem 1 (Determinism)` proving the build is pure — in a document produced by a stochastic, network-bound rewrite.

This is the paradox: **the more the text asserts verification, the less verified it becomes.** The formal layer does not check the prose; it amplifies it. A false prose claim becomes a "theorem" with a "proof," which is more convincing and harder to audit.

### 5.3 Formalization without referents

The model has no access to the build code or the data schema during expansion (the prompt includes only the section text). When asked to formalize "the build is deterministic," it writes a plausible functional-extensionality proof. When asked to formalize "the counsel verifies every scenario," it invents a five-member quorum. The math is internally consistent enough to look authoritative, but its referents are fictional.

This is why the errors cluster around **the project's own process claims**: determinism, quorum, coverage, build validation. Those are the claims the model cannot check from the section text, and they are exactly the claims a reader would most want to trust.

### 5.4 The compounding-ratio problem

At 9× expansion, a 12k-word source becomes 108k words. Even a 1% error rate in the added text produces ~1,000 erroneous words. At 1.3× (the main book), the added text is smaller but the 115 forced definition/theorem pairs still add a formal apparatus that did not exist in the source. The review cost is superlinear: a reviewer must check not only the source claims but the new connective claims, the new examples, the new math, and the new provenance statements.

The correct move is not "expand less" in the abstract; it is **separate expansion from annotation**:

- **Annotation**: add explanation, examples, and cross-links, each tied to a source span or labeled illustrative.
- **Formalization**: only where a real invariant exists, with a math reviewer.
- **Provenance**: a machine-checked manifest, not a prose paragraph.

### 5.5 Why the app's agents share the failure mode

Fox-Architect, Expander, and Bookshelf optimize for **fluency/throughput**, and the UI reports **activity** ("job done", "grounded in", "51 works, verified"), not **truth**. The same pattern appears at every layer:

- the model is asked to cite, but citations are attached from retrieval, not checked;
- the expander is asked to be longer, and length is checked;
- the bookshelf is asked to build, and exit code is checked;
- the book is asked to look verified, and the counsel strings are checked.

The project has strong **data** verification and weak **claim** verification. The fix is to move verification up one level: from "does the data parse?" to "does the sentence match the data?"

---

## 6. Agent-by-agent improvements

| Agent | Current objective | Failure mode | Change |
|---|---|---|---|
| **Fox-Architect** (`js/copilot.js`) | Answer in persona, cite catalog items | Citations are retrieval context; no claim-level check; no abstention; no eval | Extract IDs/numbers from the answer; verify against `_ctx` + `data/`; show "unverified" when missing; add a golden Q/A + refusal set; log prompts/answers for regression |
| **Expander** (`tools/expand_humanized.py`) | Make each section longer with Def/Thm/Proof | Length/marker gate; forced theorems; silent `NEEDS-REVIEW`; no source hash | Replace with "annotate + verify"; allow no theorem; per-section status; checkpoint hash; publish only verified sections; visible provenance |
| **Bookshelf** (`serve.py` / `js/books.js`) | Launch builds/expansions and report progress | No auth; all interfaces; no cancel/budget; "done" ≠ "good" | Localhost+token; origin/body checks; cancel/timeout/budget; post-build QA; show QA status per book; block publish on failure |
| **Build scripts** (`tools/build_*.py`) | Deterministic Markdown/HTML | Validation exists but differs from the books' claims; no prose/ID checks; exit 1 vs claimed 2 | Single `data/stats.json`; claim ledger; validate every backtick ID and numeric claim; exit non-zero with a machine-readable report; run in CI |
| **Renderer** (`render_humanized_pdf.py`) | Markdown → PDF | CDN, silent Mermaid/MathJax failures, no outline/metadata, unsanitized HTML, blank pages | Vendored assets; fail on render errors; sanitize; outline/metadata; blank-page check; offline CI |

---

## 7. Target architecture

### 7.1 One source of truth for counts

Create `data/stats.json` (generated, committed, tested) with:

```json
{
  "patterns": 107,
  "scenarios": 54,
  "cascades": 191,
  "traces": 55,
  "domains": 26,
  "domain_scenario_counts": {"content": 1, "...": 1},
  "works": {"sl": 51, "rl": 35},
  "concepts": {"sl": 21, "rl": 18},
  "dimensions": 9,
  "trails": 7
}
```

Generate it from `data/*.json`; have `README.md`, the books, and the UI consume it; add a test that recomputes and compares (the existing coverage test is the model). This kills the 39/55 and three/six drift permanently.

### 7.2 A claim ledger

For each book, keep `Books/Humanized/<book>/claims.jsonl`:

```json
{"id":"c001","span":"...","kind":"count","path":"data/scenarios.json#/scenarios/6/id","expected":"code-secrets-gist","status":"ok"}
{"id":"c002","span":"...","kind":"id","value":"P-024","status":"unknown"}
```

The build resolves each claim; `unknown` fails the build (or marks the paragraph `illustrative`). This is the only scalable way to stop fabricated IDs/schemas. Start with three high-value checks: backtick IDs, numeric claims with units, and chapter refs.

### 7.3 A real provenance manifest

`Books/Humanized/<book>/PROVENANCE.json`:

```json
{
  "source": "book/FIELD-PLAYBOOKS.md",
  "source_sha256": "...",
  "generator": "tools/expand_humanized.py@<commit>",
  "model": "qwen3.8:latest",
  "temperature": 0.7,
  "seed": null,
  "prompt_version": "2026-10-28.1",
  "sections": {"1": "verified", "2": "needs-review"},
  "reviewers": [],
  "generated_at": "..."
}
```

Render a visible "About this edition" page from it. If `seed` is null, say "non-deterministic"; if `reviewers` is empty, say "no independent review." This turns the current liability into an honest feature.

### 7.4 `tools/qa_books.py`

One script, run in CI, with a non-zero exit on failure. Minimum checks:

| Check | Rule |
|---|---|
| IDs | Every `\`[A-Z]+-\d+\`` or slug in backticks exists in `data/`; `P-###`/`S-###` are forbidden (the schema uses slugs) |
| Counts | Every "N patterns/scenarios/cascades/traces/domains" matches `stats.json` |
| Domains | The domain list length equals `stats.domains`; no `d_{22}` when there are 26 |
| Chapter refs | Every `Chapter N`/`chapter N` ≤ chapter count |
| Duplicates | No paragraph >80 words repeated; no heading repeated >1 per part |
| Math | Balanced `$`/`$$` (ignoring currency), balanced `\left`/`\right`, no `min(nodes, tokens)`-style unit mix (manual allowlist) |
| Proofs | Every `Theorem` has a `Proof`/`Argument` and a closing marker; numbering is scoped |
| Provenance | No "deterministic/vendored/no network/no LLM" claim unless `PROVENANCE.json` supports it |
| PDF | Outline > 0; Title/Author set; no blank pages; no "mermaid skipped"; no raw `\mathcal` in the text layer (or accept as assistive) |
| Schema | Any JSON example in prose parses and its keys are a subset of the real schema |

Start with the first four; they catch the current P0-3/P1-2 errors immediately.

### 7.5 Renderer and PDF contract

- One renderer (or one shared post-processor) for all editions.
- Local, pinned MathJax/Mermaid; no network in the print page (Playwright route blocking).
- `markdown` with raw HTML disabled, or sanitize with `bleach`; add CSP.
- Generate outline from `h1/h2`; set `Title`/`Author`/`Subject`/`Keywords`; add a TOC with page numbers.
- Assert: every Mermaid block became an SVG; every `$…$` became an `mjx-container`; no blank pages; outline length > 0.
- Keep the deterministic renderer's two-pass page-number logic; the humanized path should reuse it rather than reinventing it.

### 7.6 Server hardening

- `HOST=127.0.0.1` default; opt-in LAN mode with a token.
- `Origin`/`Sec-Fetch-Site` check on every mutating POST; `Content-Type: application/json` required; `Content-Length` cap.
- Remove `Access-Control-Allow-Origin: *`; allow only the app origin.
- Job cancel, budget, and concurrency limit; persist job state; add a `GET /api/jobs` summary.
- Post-build QA hook: a job is "done" only if `qa_books.py` passes.

### 7.7 Repository hygiene

- Stop tracking PDFs; use GitHub Releases (or LFS if absolutely necessary).
- Ignore `.parts/`, `.checkpoints/`, generated HTML, and `Books/Humanized/SAMPLE-*`.
- Commit one canonical Markdown source per edition; keep a `dist/` manifest with hashes.
- Add `requirements.txt` (`markdown`, `playwright`, `pypdf`) and `npm` scripts for all six books.
- Add `.gitattributes` for text/binary rules; if history size matters, plan a `git filter-repo` cleanup.

---

## 8. Roadmap

### P0 — this week (ship-blockers)

1. **Visible provenance page** in every expanded PDF; delete "no LLM"/"deterministic"/"vendored"/"no network" claims that are false. Acceptance: `pdftotext` shows the model/date/status; `grep -ri 'no large language model' Books/Humanized` returns only true statements.
2. **Correct the fabricated examples**: replace `S-007`/`P-003`, `P-024`/`SBX-004`, `circuit-breaker-v2`/Scenario 19, and `REPRODUCIBLE=1` with the real schema or mark them "illustrative, not this repo." Acceptance: `qa_books.py` ID/count checks pass.
3. **Stop publishing `NEEDS-REVIEW` sections**; add a visible banner or omit them. Acceptance: no section with `best_note != ok` appears in a PDF.
4. **Secure the server**: bind 127.0.0.1, token, origin/content-type checks, body cap, cancel. Acceptance: a cross-origin `POST` without the token gets 401/403; `curl` from another host fails.
5. **Fix the quick drifts**: README 39→55, three→six, add missing npm scripts, add `requirements.txt`. Acceptance: `grep` and `npm run` agree with `serve.py`/`data/`.

### P1 — 1–2 weeks (quality)

6. Add `data/stats.json` + `tools/qa_books.py` (IDs, counts, domains, chapter refs, duplicates, provenance claims). Run in CI on all six books.
7. Add the claim ledger for numeric/ID claims; fail the build on unresolved claims; label illustrative text.
8. Fix the formalization policy: allow "no theorem"; add a math review checklist; renumber definitions/theorems; fix the ToT and variance examples; replace tautological "proofs" with arguments.
9. Renderer: vendored assets, sanitization, offline build, PDF outline/metadata, blank-page and Mermaid/MathJax assertions.
10. Deduplicate: remove the repeated ROGUE/SELF paragraphs and the 115 identical headings; cap expansion unless reviewed.
11. Fox-Architect: claim-level citation verifier, abstention, golden Q/A + refusal tests.
12. PDF QA: 0 bookmarks → outline > 0; metadata; visible provenance; no blank pages.

### P2 — 2–6 weeks (structural)

13. Rewrite the AXIOM editions with the new contract (annotate + verify, no theorem quota); re-review the books with a real external reviewer/math reviewer; retire the old AXIOM PDFs.
14. Repo cleanup: untrack PDFs/intermediates, add releases/LFS, add a `dist/` manifest; optionally rewrite history to drop the 9 PDF blobs.
15. Bookshelf: QA status per book, publish gate, job budget/cancel, build manifest, diff view.
16. Add a release process: versioned editions, changelog, provenance archive, and a "known corrections" page.

---

## 9. What to keep

- **The catalog.** 107 patterns, 54 scenarios, 191 cascades, 55 traces, 26 domains is a real asset. The data tests (dangling refs, coverage freshness, schema) are the right model for the prose layer.
- **The deterministic books.** They have bookmarks, titles, a two-pass TOC, and a build that can be audited. They are the quality bar the humanized editions should meet.
- **The book skeleton.** Parts, chapters, field notes, diagrams, and "what this book is not" sections are good. The problem is the added claims, not the structure.
- **The app's security instincts.** CSP, link sanitization, and data tests show the team knows how to harden. The new book endpoints just skipped that discipline.
- **The honesty instinct in the source prefaces.** "Synthetic scenarios, mock traces, illustrative numbers" is exactly the right disclaimer. The expansions should have amplified *that*, not overwritten it with production-incident provenance.

---

## 10. Verification appendix

Run from the project root.

```bash
# 1. Catalog counts and the real distribution
python3 - <<'PY'
import json, collections
s=json.load(open('data/scenarios.json'))['scenarios']
c=collections.Counter(x['domain'] for x in s)
print(len(s), len(c), collections.Counter(c.values()))
print({k:v for k,v in c.items() if v==1})
print('patterns', len(json.load(open('data/patterns.json'))['patterns']))
print('cascades', len(json.load(open('data/cascades.json'))['cascades']))
print('traces', len(json.load(open('data/traces.json'))['traces']))
PY

# 2. Fake IDs and schema fields
python3 - <<'PY'
import json
p={x['id'] for x in json.load(open('data/patterns.json'))['patterns']}
s={x['id'] for x in json.load(open('data/scenarios.json'))['scenarios']}
for x in ['P-024','P-003','S-007','SBX-004','circuit-breaker-v2']:
    print(x, x in p or x in s)
print('scenario 7', [x['id'] for x in json.load(open('data/scenarios.json'))['scenarios']][6])
print('scenario 19', [x['id'] for x in json.load(open('data/scenarios.json'))['scenarios']][18])
PY

# 3. The false provenance sentence is visible in the PDF; the disclosure is not
pdftotext Books/Humanized/AXIOM-OPENSHELL-REFERENCE-ARCHITECTURE.pdf - | \
  grep -in 'no large language model\|deterministic end-to-end'
pdftotext Books/Humanized/AXIOM-OPENSHELL-REFERENCE-ARCHITECTURE.pdf - | \
  grep -ci 'qwen\|expanded by'   # expect 0

# 4. PDF bookmarks / metadata / blank pages
python3 - <<'PY'
from pypdf import PdfReader
import glob
for p in sorted(glob.glob('Books/Humanized/*.pdf')):
    r=PdfReader(p)
    blanks=[i+1 for i,pg in enumerate(r.pages)
            if not (pg.extract_text() or '').strip()
            and not (pg.get('/Resources',{}).get('/XObject'))]
    print(f'{p:60s} pages={len(r.pages):4d} outlines={len(r.outline):3d} '
          f'title={str((r.metadata or {}).get("/Title"))[:20]} blanks={blanks}')
PY

# 5. Repetition / forced formalization
grep -c '^\*\*Definition 1' Books/Humanized/AGENTIC-PATTERNS-AND-GUARDRAILS.md   # 115
grep -c '^\*\*Theorem 1'   Books/Humanized/AGENTIC-PATTERNS-AND-GUARDRAILS.md   # 115
grep -n 'Limits: a pattern is a specification' Books/Humanized/ROGUE-AGENTS.md | wc -l
grep -n 'Safety researcher:\*\* I read each case study' Books/Humanized/.axiom/AXIOM-ROGUE-AGENTS.md | wc -l

# 6. The gate is length + markers
sed -n '20,24p;45,52p;58,82p' tools/expand_humanized.py

# 7. Renderer network + silent failure
grep -n 'cdn.jsdelivr\|mermaid skipped\|catch(e)' tools/render_humanized_pdf.py

# 8. Server exposure
grep -n 'HOST =\|Access-Control\|_read_body\|do_POST' serve.py | head
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<host>:5175/api/books/build \
  -H 'content-type: text/plain' --data '{"targets":["main"]}'   # from another machine

# 9. Repo bloat
du -sh .git
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '$1=="blob" && $3>7000000 {print $3, $4}' | sort -rn
git ls-files 'Books/Humanized/*.pdf' 'book/*.pdf'
```

---

## 11. Evidence index

| Finding | Evidence |
|---|---|
| False "no LLM" claim | `Books/Humanized/.axiom/AXIOM-OPENSHELL-REFERENCE-ARCHITECTURE.md:8058`; PDF `pdftotext` line 20071; header `:1` |
| Visible provenance stripped | `pdftotext AXIOM-OPENSHELL…pdf \| grep -ci 'qwen'` → 0; `SELF…pdf` → 0 |
| Deterministic/vendored claims | `AXIOM-FIELD…md:281,4578,4592,4661-4669`; `AXIOM-WORKFLOWS…md:285,340`; `AXIOM-ROGUE…md:227,295` |
| CDN renderer | `tools/render_humanized_pdf.py:19-20` |
| Silent Mermaid/MathJax | `tools/render_humanized_pdf.py:47-49` |
| Fictional quorum | `AXIOM-FIELD…md:17,41,261,285`; `tools/field_book_prose.py:11`; `tools/build_field_book.py:139` |
| Fake Field schema | `AXIOM-FIELD…md:4628-4647`; `data/scenarios.json` (real keys) |
| Fake OpenShell IDs | `AXIOM-OPENSHELL…md:7959-8052`; `data/patterns.json` (slug IDs); `data/coverage.json` (`by_domain`) |
| Fake Workflows example | `AXIOM-WORKFLOWS…md:7254-7315`; `data/scenarios.json` Scenario 19 |
| `REPRODUCIBLE=1` | `AXIOM-WORKFLOWS…md:7304`; `grep -rn REPRODUCIBLE` → only the book |
| No orphan check / exit 2 | `AXIOM-FIELD…md:4626,4667`; `tools/build_field_book.py:120-150`; no `sys.exit(2)` |
| Domain contradiction | `AXIOM-FIELD…md:23` (26), `:189` (22, lists 21), `:31` ("most two") |
| Broken chapter refs | `AXIOM-FIELD…md:414`; 29 chapters |
| Production vs synthetic | `AXIOM-FIELD…md:15` vs `:265`; `book/FIELD-PLAYBOOKS.md:62` |
| ToT unit error | `AGENTIC-PATTERNS-AND-GUARDRAILS.md:572` |
| Variance conflation | `AGENTIC-PATTERNS-AND-GUARDRAILS.md:453-455` |
| Tautological coverage theorem | `AXIOM-FIELD…md:33` |
| 115× Definition/Theorem | `grep -c '^\*\*Definition 1'` / `Theorem 1` on `AGENTIC…md` |
| Repetition | `ROGUE-AGENTS.md:792-1006`; `AXIOM-ROGUE…md:4932,5079,5221,5366,5478,5609,5710` |
| PDF regressions | `pypdf` outlines/titles; Rogue p36, Self p30 blank |
| SELF biography | `SELF-LEARNING-AGENTS.md:167,213`; source `book/SELF-LEARNING-AGENTS.md:39,908`; no verification field in `data/sl_landscape.json` |
| Fox-Architect citations | `js/copilot.js:503`; `test/copilot.test.mjs` |
| Server exposure | `serve.py:70,827-829,926-928,1002-1015,687-688` |
| CI/build drift | `.github/workflows/ci.yml` (no book steps); `package.json` scripts; `README.md:35,252,315` |
| Gate | `tools/expand_humanized.py:20-24,45,58-82,94-98` |
| Repo bloat | `.git` 92 MB; 9× 7.3–8.5 MB PDF; 34 MB tracked; 281 `.parts`/checkpoint files |

---

## 12. Limitations of this review

- I did not visually inspect every page; math rendering was checked via embedded MathJax fonts, not pixel-by-pixel. The raw TeX in `pdftotext` is the hidden assistive MathML layer, not a visual failure.
- I did not independently verify external citations in the 51/35 research lists; the findings concern claims about this repository and its data.
- "9 months" and "4 draft cycles" may be true; they are unverifiable from the repo. I flag them because they are presented as fact and because the adjacent "3 works failed verification" has no data source.
- The security test (`curl` from another machine) must be run on your network; I verified the code path, not your firewall.

---

*The shortest path to a better project is not another expansion pass. It is to make the build refuse to publish a sentence it cannot trace.*
