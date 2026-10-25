#!/usr/bin/env python3
"""Build the supplement book *Workflows* from the catalog and the app.

Deterministic and stdlib-only. It reads the same JSON the app ships
(`data/*.json`), the tab registry and design-doc registry out of the shipped
sources (`js/shortcuts.js`, `index.html`, `js/app.js`), the council
deliberations (`tools/workflows_book_prose.py`) and the workbench inventory
(`tools/workflows_book_data.py`), and emits:

    book/WORKFLOWS.md   supplement book in Markdown
    book/workflows.html self-contained print HTML (PDF via
                        tools/render_pdf.mjs where Chrome is available)

Nothing is invented: every tab, pane, action and design doc referenced is
validated against the shipped sources; every scenario is assigned to
workflows by the documented rule below; every domain chapter lists its real
catalog scenarios. The build fails on any drift.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_book import CSS, HTML_SHELL, Doc, esc, inline_html, load_catalog
from build_rogue_book import SCEN_ROAD
from workflows_book_prose import WORKFLOWS_DELIB
from workflows_book_data import WORKFLOW_ORDER, WORKFLOWS, WF_FIGS
from openshell_book_data import DOMAIN_PLAYBOOKS

ROOT = Path(__file__).resolve().parent.parent
BOOK_DIR = ROOT / "book"
MD_OUT = BOOK_DIR / "WORKFLOWS.md"
HTML_OUT = BOOK_DIR / "workflows.html"

BOOK_TITLE = "Workflows"
SUBTITLE = "Every Job the Workbench Does, Read by a Council of Researchers"
AUTHOR = "Harish Govardhan Damodar"
EDITION = "First edition — October 2026"

SEED_NOTE = "Catalog edition: counts below are read from data/*.json at build time."


def deliberate(body, key):
    """Council deliberation: researchers debate before the operator acts."""
    items = WORKFLOWS_DELIB.get(key)
    if not items:
        sys.exit(f"tools/build_workflows_book.py: no council deliberation for `{key}` in tools/workflows_book_prose.py")
    body.m("**Council deliberation.**")
    body.m()
    for voice, text in items:
        body.m(f"- **{voice}:** {text}")
    body.m()
    body.h("<p><b>Council deliberation.</b></p><ul>" + "".join(
        f"<li><b>{esc(voice)}:</b> {inline_html(text)}</li>" for voice, text in items) + "</ul>")


def os_fig(body, key):
    src = WF_FIGS.get(key)
    if not src:
        sys.exit(f"tools/build_workflows_book.py: no figure for `{key}`")
    body.m("```mermaid")
    body.m(src)
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(src)}">{esc(src)}</pre>'
        f"<figcaption>{esc(key)}.</figcaption></figure>"
    )


def codeblock(body, lang, src, caption=None):
    body.m(f"```{lang}")
    body.m(src)
    body.m("```")
    body.m()
    cap = f"<figcaption>{esc(caption)}</figcaption>" if caption else ""
    body.h(
        '<figure class="diagram">'
        f'<pre class="code" style="font-family:Menlo,Consolas,monospace;font-size:8.6pt;background:#f2f4f7;padding:8pt;border-radius:4px;overflow-x:auto;white-space:pre;text-align:left;">{esc(src)}</pre>'
        f"{cap}</figure>"
    )


# --------------------------------------------------------------------------- #
#  assembly
# --------------------------------------------------------------------------- #

entries = []  # (kind, label, target) in document order; kind in front|part|chapter|back
chap_n = [0]


def sk_tabs():
    src = (ROOT / "js" / "shortcuts.js").read_text()
    m = re.search(r"SK_TABS = \[(.*?)\]", src, re.S)
    return re.findall(r'"([^"]+)"', m.group(1))


def design_docs():
    src = (ROOT / "js" / "app.js").read_text()
    docs = re.findall(r'\{\s*id:\s*"([^"]+)",\s*file:\s*"([^"]+)",\s*title:\s*"([^"]+)"', src)
    return docs


def cov_targets():
    src = (ROOT / "js" / "coverage.js").read_text()
    m = re.search(r"COV_TARGETS\s*=\s*\{([^}]+)\}", src)
    return dict(re.findall(r"(\w+)\s*:\s*(\d+)", m.group(1)))


def scen_workflows(s):
    """Documented assignment rule: every scenario starts in Scenarios, gets
    rehearsed in Rogue ops against its archetype, and is read against its
    domain gap in Coverage. Traces add Live; boundary shapes add the
    Guardrail lab; authority shapes add Blueprints; high-stakes domains add
    the Deployment planner. Copilot and design docs serve every scenario and
    are covered in their own chapters rather than per-row."""
    arch = SCEN_ROAD[s["id"]][1]
    wfs = ["scenarios", "rogue", "coverage"]
    if s.get("traceId"):
        wfs.append("live")
    if arch in ("hijack", "exfil"):
        wfs.append("guard")
    if arch in ("abuse", "collude", "sybil"):
        wfs.append("blueprint")
    if s["domain"] in ("finance", "trading", "enterprise", "healthcare", "public-sector"):
        wfs.append("deploy")
    seen, out = set(), []
    for w in wfs:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def main():
    cat = load_catalog()
    by_pat = {p["id"]: p for p in cat["patterns"]}
    scen_by_id = {s["id"]: s for s in cat["scenarios"]}
    cov = json.load(open(ROOT / "data" / "coverage.json"))["by_domain"]
    tabs = sk_tabs()
    docs = design_docs()
    targets = cov_targets()

    # -- validations ----------------------------------------------------- #
    arch_ids = {a for _, a, _ in SCEN_ROAD.values()}
    if set(s["id"] for s in cat["scenarios"]) != set(SCEN_ROAD):
        sys.exit("tools/build_workflows_book.py: scenario ids drifted from build_rogue_book.SCEN_ROAD")
    for wid, w in WORKFLOWS.items():
        if w["tab"] is not None and w["tab"] not in tabs:
            sys.exit(f"tools/build_workflows_book.py: workflow `{wid}` maps to unknown tab `{w['tab']}`")
    index = (ROOT / "index.html").read_text()
    for wid, w in WORKFLOWS.items():
        if w["tab"] is not None and f'id="{w["tab"]}Pane"' not in index:
            sys.exit(f"tools/build_workflows_book.py: no pane for tab `{w['tab']}` in index.html")
    if 'id="bookshelf"' not in index:
        sys.exit("tools/build_workflows_book.py: no #bookshelf host in index.html")
    pal = (ROOT / "js" / "palette.js").read_text()
    if "function palOpen" not in pal:
        sys.exit("tools/build_workflows_book.py: no palOpen in js/palette.js")
    if len(docs) != 11:
        sys.exit(f"tools/build_workflows_book.py: expected 11 design docs, found {len(docs)}")
    if set(DOMAIN_PLAYBOOKS) != set(cov):
        sys.exit("tools/build_workflows_book.py: domain playbook keys drifted from data/coverage.json")
    assignments = {s["id"]: scen_workflows(s) for s in cat["scenarios"]}
    for sid, wfs in assignments.items():
        for w in wfs:
            if w not in WORKFLOWS:
                sys.exit(f"tools/build_workflows_book.py: scenario `{sid}` assigned to unknown workflow `{w}`")
    _need = {"preface", "introduction", "conclusion",
             "jobs-three", "jobs-shell", "jobs-yours",
             "cat-patterns", "cat-scenarios", "cat-cascades",
             "cat-coverage", "cat-live",
             "plan-deploy", "plan-blueprint",
             "lab-guard", "lab-discovery", "lab-bench", "lab-rogue", "lab-selflearn",
             "know-copilot", "know-design", "know-bookshelf"}
    _need |= {"domain-" + d for d in cov}
    if set(WORKFLOWS_DELIB) != _need:
        sys.exit(f"tools/build_workflows_book.py: deliberation keys drifted (missing={sorted(_need - set(WORKFLOWS_DELIB))}, extra={sorted(set(WORKFLOWS_DELIB) - _need)})")

    wf_for_domain = {}
    for d in cov:
        wfs = []
        for s in cat["scenarios"]:
            if s["domain"] == d:
                for w in assignments[s["id"]]:
                    if w not in wfs:
                        wfs.append(w)
        wf_for_domain[d] = wfs

    doc = Doc()
    body = Doc()

    def h(level, text, cls=""):
        return body.heading(level, text, cls)

    def CH(text):
        """A numbered chapter: heading `Chapter N: …`, toc label
        `Chapter N · …`, anchor `chapter-n-…`."""
        chap_n[0] += 1
        n = chap_n[0]
        aid = h(2, f"Chapter {n}: {text}", cls="chapter")
        entries.append(("chapter", f"Chapter {n} · {text}", aid))
        return aid

    # -- front matter ---------------------------------------------------- #
    entries.append(("front", "Preface", body.heading(1, "Preface")))
    body.p(
        "This supplement is the manual the other books assume. Patterns tells you what "
        "to build, Rogue Agents tells you what to fear, OpenShell tells you where to "
        "stand — this book tells you which tab to open, in which order, and what done "
        "looks like. Every workflow below is read the same way: where to start, what "
        "to do, and what leaves the tab as evidence."
    )
    body.p(
        "Three questions organize it around the three jobs on the Overview tab: plan a "
        "deployment safely, architect the system, and study how agents fail. The catalog "
        "workflows feed the planning workflows, the labs rehearse what the catalog "
        "teaches, and the copilot, design docs and bookshelf hold the whole program "
        "together."
    )
    body.p(
        "This book was written and compiled from study and experiment observation "
        "notes of Harish Govardhan Damodar and generated by the *AI Agent Patterns "
        "& Guardrails* catalog by a deterministic script (`tools/build_workflows_book.py`), "
        "then typeset to PDF with headless Chrome and the vendored Mermaid engine "
        "(`tools/render_pdf.mjs`) — the same Mermaid that renders the diagrams in "
        "the app, so no diagram in this book was drawn by hand or screenshotted. "
        "All experiments performed in local sandbox build and maintained by Harish "
        "Govardhan Damodar and his agents, work extensively uses local open weight "
        "model for experimentation and intelligence serving, for a live demo / "
        "suggestion feel free to drop a DM in my linkedin page "
        "(https://www.linkedin.com/in/harishgovardhan-d-44b22b47/). All records, "
        "suggestions advice is from personal experiments ran on my personal setup "
        "only and does not represent the organisation I work for."
    )
    deliberate(body, "preface")

    # -- introduction ---------------------------------------------------- #
    entries.append(("front", "Introduction: three jobs, one workbench", h(1, "Introduction: three jobs, one workbench")))
    os_fig(body, "Three jobs, one catalog")
    n_scen = len(cat["scenarios"])
    body.p(
        f"The catalog behind this book holds {len(cat['patterns'])} patterns, {n_scen} failure "
        f"scenarios and {len(__import__('json').load(open(ROOT / 'data' / 'cascades.json'))['cascades'])} cascades "
        f"across {len(cov)} domains, served through {len(tabs)} tabs in six sections plus "
        f"the command palette. {SEED_NOTE} Every scenario below is assigned to the "
        f"workflows that serve it by a stated rule; every domain chapter lists its real "
        f"catalog scenarios."
    )
    body.p(
        "The assignment rule, printed here so it can be argued with: every scenario starts "
        "in Scenarios, gets rehearsed in Rogue ops against its archetype, and is read against "
        "its domain gap in Coverage. Scenarios with mock runs add Live traces; boundary "
        "shapes (hijack, exfiltration) add the Guardrail lab; authority shapes (abuse, "
        "collusion, spawning) add Blueprints; high-stakes domains add the Deployment "
        "planner. The copilot and design docs serve every scenario and get their own "
        "chapters instead of per-row mentions."
    )
    deliberate(body, "introduction")

    # -- Part I ---------------------------------------------------------- #
    entries.append(("part", "Part I · The workbench and its three jobs",
                    body.heading(1, "Part I — The workbench and its three jobs")))
    CH("The three jobs")
    body.p(
        "Ship an agent safely, architect the system, study how agents fail. Each job lines "
        "up a different slice of the catalog, the planner and the copilot behind it, so the "
        "first click already has a purpose — and each job ends with an artifact, not a browse "
        "history: a readiness score with a rollout plan and an ADR, stages with controls and "
        "estimates in the library, or rehearsed shapes with measured bands."
    )
    deliberate(body, "jobs-three")

    CH("Shell, palette, and projects")
    body.p(
        "Fifteen panes in six sections, one palette that jumps anywhere by name, keyboard "
        "shortcuts for the pointerless, and deep links for everything with an identity — "
        "drawers, cases, scenarios, runs. The shell is navigable at speed and linkable for "
        "handoff: send the link, not the screenshot."
    )
    os_fig(body, "Shell, palette, tabs, memory")
    body.p(
        "Under the shell sits the memory: the current-project chip, per-tab save stamps, "
        "the blueprint library, saved runs and boards and promoted drafts — persisted in "
        "the browser, exportable as JSON, working from a static host with no backend at "
        "all. Context that survives is context that compounds."
    )
    deliberate(body, "jobs-shell")

    CH("Yours: offline-first and exportable")
    body.p(
        "Static hosting, browser persistence, deterministic fallbacks when backends are "
        "unreachable, and exports that stand alone: JSON for state, Markdown for reports, "
        "CSV for backlogs, PDF for books. Nothing rehearsed here needs production "
        "credentials or real customer data — mock and open data exercise the same paths."
    )
    deliberate(body, "jobs-yours")

    # -- Part II --------------------------------------------------------- #
    entries.append(("part", "Part II · Catalog workflows",
                    body.heading(1, "Part II — Catalog workflows")))
    CH("Patterns: search, filter, drawer, handoff")
    body.p(
        "Search by name, failure, or domain; filter by category; open the drawer for the "
        "full record — control flow, failures, protections, links — then hand it off: "
        "add it to a blueprint or ask the copilot about it. The handoff is the workflow; "
        "a pattern that never leaves the drawer never ships."
    )
    os_fig(body, "Catalog loop")
    body.p(
        f"Of the catalog's {len(cat['patterns'])} patterns, each carries its protections "
        f"as future blueprint controls and its failure modes as future bench cases. Convert "
        f"at least one of each: a protection into a stage control, a failure into a test."
    )
    deliberate(body, "cat-patterns")

    CH("Scenarios: read the story, run the trace")
    body.p(
        "Severity, vector and domain get you to the story; the attack chain shows the moves; "
        "protections show the answers; the mock run lets you watch it happen. Fifty-four "
        "scenarios, each with a road and an archetype, each assigned to the workflows in "
        "this chapter's table by the introduction's rule."
    )
    os_fig(body, "Scenario anatomy")
    road_n = Counter(SCEN_ROAD[s["id"]][0] for s in cat["scenarios"])
    arch_n = Counter(SCEN_ROAD[s["id"]][1] for s in cat["scenarios"])
    body.p(
        f"The mix: {road_n.get('emergent', 0)} emergent, {road_n.get('injected', 0)} injected, "
        f"{road_n.get('both', 0)} both — with hijack leading the archetypes at "
        f"{arch_n.get('hijack', 0)} scenarios. Weight rehearsal by these counts, not by drama."
    )
    deliberate(body, "cat-scenarios")

    CH("Cascades: browse by class, plan mitigations")
    cas_all = json.load(open(ROOT / "data" / "cascades.json"))["cascades"]
    body.p(
        f"Filter by the four classes first — inherent, emergent, derived, cascading live in "
        f"different places and demand different controls — then domain and blast radius. "
        f"Page through the ranked list with progress shown; the pager never loses your place "
        f"across {len(cas_all)} records."
    )
    body.p(
        "The mitigation planner is where browsing becomes work: prevent, detect, contain and "
        "recover controls per cascade, owned and exportable as a backlog. A cascade without "
        "a mitigating control is a finding, not a reading."
    )
    os_fig(body, "Mitigation backlog flow")
    deliberate(body, "cat-cascades")

    CH("Coverage: heatmap, gap cards, backlog")
    body.p(
        "Read your domain row in the heatmap first: cell shading is coverage versus a "
        f"heuristic target (patterns at least {targets.get('patterns')}, scenarios at least "
        f"{targets.get('scenarios')} per domain). Gap cards name what is missing; the export "
        f"turns gaps into assignable Markdown or CSV."
    )
    os_fig(body, "Coverage to backlog")
    body.p(
        "Targets are advisory, printed beside the verdicts — a met target is not a defended "
        "domain. Fund by gap: thin domains get rehearsal priority, missing cascade classes "
        "get authoring priority in discovery."
    )
    deliberate(body, "cat-coverage")

    CH("Live traces: press play, keep the log")
    body.p(
        "Pick a trace and press play: control flow highlights while steps, guardrail "
        "decisions, budget burn and the event log stay in sync. Step through for briefings, "
        "enlarge for war rooms, replay at speed for drills. The same trace serves onboarding, "
        "review and incident prep."
    )
    os_fig(body, "Replay in sync")
    body.p(
        "Mock runs are wiring proofs with the limits printed beside them — synthetic replays "
        "validate the control path, not adversary ingenuity. Keep the event log: timestamped, "
        "exportable, attachable to the review instead of a memory."
    )
    deliberate(body, "cat-live")

    # -- Part III -------------------------------------------------------- #
    entries.append(("part", "Part III · Planning workflows",
                    body.heading(1, "Part III — Planning workflows")))
    CH("Deployment planner: four questions, one ADR")
    body.p(
        "Describe the agent and its authorities; read the readiness score with its sources; "
        "take the recommended stack and rollout plan; record risks and file the ADR. Four "
        "questions that refuse to be skipped, in order, ending in a document that outlives "
        "the meeting."
    )
    os_fig(body, "Deployment spine")
    body.p(
        "The score is a checklist with arithmetic — coverage, cost, threat exposure and "
        "cascade analysis computed from the catalog, inspectable all the way down. Improve "
        "the inputs, not the number; halve rollout steps until nothing breaks."
    )
    deliberate(body, "plan-deploy")

    CH("Blueprint builder: compose, estimate, stress-test")
    body.p(
        "Start from a template or an empty canvas: compose stages, attach controls per stage, "
        "watch cost, coverage and exposure estimate live, stress-test with the copilot, "
        "then save to the library or export. A blueprint is a system you can price and "
        "attack on paper before building it."
    )
    os_fig(body, "Blueprint loop")
    body.p(
        "Re-estimate before approving — estimates rot as the catalog moves — and stress-test "
        "before granting. The cheapest control is the one drawn before code exists."
    )
    deliberate(body, "plan-blueprint")

    # -- Part IV --------------------------------------------------------- #
    entries.append(("part", "Part IV · Lab workflows",
                    body.heading(1, "Part IV — Lab workflows")))
    CH("Guardrail lab: describe, analyze, collect")
    body.p(
        "Say what agent you are building in plain language; get a threat analysis grounded "
        "in catalog records; accumulate a versioned collection instead of one-off analyses. "
        "Export as JSON when it is solid — and re-run before every grant widening, not just "
        "at launch."
    )
    os_fig(body, "Guardrail analysis lifecycle")
    deliberate(body, "lab-guard")

    CH("Discovery lab: gap-seeded rounds, promoted winners")
    body.p(
        "Start a gap-seeded run and watch the rounds: candidates proposed from catalog gaps, "
        "novelty-ranked, with forgetting rounds pruning the rest. Promote winners into "
        "catalog-shaped scenarios, export the run with its drafts, and assign every promoted "
        "shape to a rehearsal."
    )
    os_fig(body, "Discovery rounds")
    deliberate(body, "lab-discovery")

    CH("Battle bench: configure, run, ablate, gate")
    body.p(
        "Pin two or more configurations, run the same cases, read the pass-fail matrix — "
        "scenarios down, configurations across, one cell per case. Then ablate: remove one "
        "control, re-run, and watch which failures return. That control carries the result "
        "and earns its budget."
    )
    os_fig(body, "Bench campaign")
    deliberate(body, "lab-bench")

    CH("Rogue ops: setup, results, board, guardrails")
    body.p(
        "Configure the swarm and the injection; read per-rogue outcomes; open owned cases "
        "with deadlines on the board; verify what carries the result with counterfactuals. "
        "Run the guarded preset first and change nothing — it is the control group for "
        "every later claim. Live fire sparingly, for new shapes, with caps on and "
        "fallbacks flagged."
    )
    os_fig(body, "Rogue board clock")
    deliberate(body, "lab-rogue")

    CH("Self-learning loop: stream to checkpoint")
    body.p(
        "Point the loop at a stream and read the first lesson file: router, evolver, harness, "
        "policy, grader, lesson, checkpoint. Improvement with a ledger — and forgetting as "
        "a designed operation, with TTLs and eviction keeping context honest. Learn in "
        "rehearsal, promote deliberately, gate every policy update like a deploy."
    )
    os_fig(body, "Self-learning loop")
    deliberate(body, "lab-selflearn")

    # -- Part V ---------------------------------------------------------- #
    entries.append(("part", "Part V · Counsel and knowledge workflows",
                    body.heading(1, "Part V — Counsel and knowledge workflows")))
    CH("Asking Fox-Architect")
    body.p(
        "Ask about a pattern, a scenario, a cascade, a blueprint or a run — start from a "
        "suggested prompt or bring your own. Answers argue from catalog records with "
        "follow-ups attached; threads persist and export. Check the backend badge: it "
        "always says which model spoke, and the deterministic fallback answers from local "
        "analysis when nothing is reachable."
    )
    os_fig(body, "Ask loop")
    body.p(
        "Use the copilot to go safer, not just faster: stress-test the blueprint, red-team "
        "the deployment plan, second-guess the guardrail set — before granting anything. "
        "An adversary will ask these questions; better the copilot first."
    )
    deliberate(body, "know-copilot")

    CH("Reading the design docs")
    body.p(
        "Eleven documents, each answering one question completely — start at the threat "
        "model, then open the doc the task touches:"
    )
    body.ul([f"{d[0]} — {d[2]}" for d in docs])
    body.p(
        "The docs ship with the app, so verify them like code: check one diagram against "
        "the running tab, and link docs into reviews instead of reconstructing context "
        "from code archaeology."
    )
    deliberate(body, "know-design")

    CH("Bookshelf: status, collect, build, typeset")
    body.p(
        "The pipeline made visible: the status panel says fresh or stale with reasons, one "
        "action collects the landscape inventory, rebuilds Markdown and print HTML, and "
        "typesets PDFs with page numbers verified and bookmarks checked. The build proves "
        "its own output — read the log, not just the file."
    )
    os_fig(body, "Bookshelf pipeline")
    body.p(
        "Cite version and seed with every figure: generated books version themselves, and "
        "a changed tab yields a changed edition automatically. Stale books are flagged, "
        "not silently shelved."
    )
    deliberate(body, "know-bookshelf")

    # -- Part VI --------------------------------------------------------- #
    entries.append(("part", "Part VI · Domain playbooks: every scenario, every domain",
                    body.heading(1, "Part VI — Domain playbooks: every scenario, every domain")))
    body.p(
        "One chapter per catalog domain: what is at stake, the real scenarios that rehearse "
        "it, and the workflows that serve each one under the introduction's rule — read the "
        "story in Scenarios, rehearse the shape in Rogue ops, check the domain gap in "
        "Coverage, with traces, guardrails, blueprints and deployment planning where the "
        "scenario earns them."
    )
    os_fig(body, "Scenarios fan out to workflows")
    thin = sorted(d for d in cov if len([s for s in cat["scenarios"] if s["domain"] == d]) == 1)
    body.p(
        f"Coverage note: {len(thin)} of {len(cov)} domains hold a single catalog scenario — "
        f"{', '.join(thin)}. Treat those chapters as prompts, not coverage: author the "
        f"neighbor shapes in discovery and promote them."
    )
    for dom in sorted(cov):
        pb = DOMAIN_PLAYBOOKS[dom]
        sids = sorted(s["id"] for s in cat["scenarios"] if s["domain"] == dom)
        counts = cov[dom]
        CH(f"Domain playbook: {dom}")
        body.p(f"At stake: {pb['stakes']}")
        story_lines = []
        for sid in sids:
            s = scen_by_id[sid]
            road, arch, _ = SCEN_ROAD[sid]
            wfs = ", ".join(WORKFLOWS[w]["label"] for w in assignments[sid])
            story_lines.append(
                f"*{s['title']}* ({road}; {arch}) — served by: {wfs}.")
        body.p("Catalog rehearsal: " + " ".join(story_lines))
        if len(sids) == 1:
            body.p(
                "Single-story domain: this chapter is a prompt. Author the adjacent shapes "
                "in the discovery lab and promote them into rehearsals.")
        body.p(
            f"Catalog weight: {len(counts['patterns'])} patterns, {len(sids)} scenarios, "
            f"{len(counts['cascades_all'])} cascades (inherent {len(counts['cascades_inherent'])}, "
            f"emergent {len(counts['cascades_emergent'])}, derived {len(counts['cascades_derived'])}, "
            f"cascading {len(counts['cascades_cascading'])})."
        )
        deliberate(body, f"domain-{dom}")

    # -- back matter ----------------------------------------------------- #
    CH("Conclusion: run the jobs on a schedule")
    body.p(
        "Every tab is a job with an artifact, every artifact has an owner, and every "
        "workflow ends with evidence — an export, a case, a matrix, a backlog item, a "
        "lesson. Run the jobs on a schedule and the catalog stays a workbench instead "
        "of becoming a museum."
    )
    deliberate(body, "conclusion")
    entries.append(("back", "Sources and provenance", body.heading(1, "Sources and provenance")))
    body.p(
        "Catalog: data/patterns.json, data/scenarios.json, data/cascades.json, "
        "data/traces.json, data/coverage.json — counts and scenario-to-workflow "
        "assignments in this book are read from that catalog at build time. Tabs, panes, "
        "actions and design docs: js/shortcuts.js, index.html, js/palette.js, js/app.js — "
        "every workflow reference is validated against the shipped sources. Generated by "
        "tools/build_workflows_book.py with council prose from tools/workflows_book_prose.py "
        "and the workbench inventory from tools/workflows_book_data.py; typeset with "
        "tools/render_pdf.mjs and the vendored Mermaid engine."
    )

    # -- contents + emit (same shape as the sibling books) -------------- #
    def toc_line(label, target):
        doc.raw_html(
            f'<li><a href="#{target}"><span class="t">{esc(label)}</span>'
            f'<span class="dots"></span>'
            f'<span class="pg" data-pg="{target}">000</span></a></li>'
        )

    doc = Doc()
    doc.title_page(BOOK_TITLE, SUBTITLE, AUTHOR, EDITION)
    doc.p(
        "A supplement to *Agentic Design Patterns & Guardrails*: every workflow in the "
        "workbench — catalog, planning, labs, counsel and knowledge — read by a council "
        "of researchers, with every scenario assigned to the workflows that serve it and "
        "a playbook for all 26 catalog domains. Generated from the catalog and the app; "
        "nothing in it is hand-typed from memory."
    )
    doc.pagebreak()
    doc.heading(1, "Contents")
    doc.raw_html('<nav class="toc">')
    doc.raw_html("<ul>")
    for kind, label, target in entries:
        if kind == "front":
            toc_line(label, target)
    doc.raw_html("</ul>")
    for i, (kind, label, target) in enumerate(entries):
        if kind != "part":
            continue
        doc.raw_html(
            f'<div class="toc-part"><a href="#{target}">'
            f'<span class="t">{esc(label)}</span>'
            f'<span class="dots"></span>'
            f'<span class="pg" data-pg="{target}">000</span></a></div>'
        )
        doc.raw_html("<ul>")
        for k2, l2, t2 in entries[i + 1:]:
            if k2 != "chapter":
                break
            toc_line(l2, t2)
        doc.raw_html("</ul>")
    doc.raw_html("<ul>")
    for kind, label, target in entries:
        if kind == "back":
            toc_line(label, target)
    doc.raw_html("</ul>")
    doc.raw_html("</nav>")
    doc.m("**Contents**")
    doc.m()
    for kind, label, target in entries:
        if kind == "front":
            doc.m(f"- {label}")
    doc.m()
    cur = None
    for kind, label, target in entries:
        if kind == "part":
            cur = label
            doc.m(f"- {label}")
    doc.m()
    for kind, label, target in entries:
        if kind == "chapter":
            doc.m(f"  - {label}")
    doc.m()
    for kind, label, target in entries:
        if kind == "back":
            doc.m(f"- {label}")
    doc.m()
    doc.md.extend(body.md)
    doc.html.extend(body.html)

    BOOK_DIR.mkdir(exist_ok=True)
    md = doc.render()
    MD_OUT.write_text(md)
    HTML_OUT.write_text(HTML_SHELL.format(title=esc(BOOK_TITLE), css=CSS, body="\n".join(doc.html)))
    print(f"wrote {MD_OUT.relative_to(ROOT)}  ({len(md.splitlines())} lines)")
    print(f"wrote {HTML_OUT.relative_to(ROOT)}  ({len(doc.html)} blocks)")
    n_ch = sum(1 for k, _, _ in entries if k == "chapter")
    print(f"book: {len(entries)} headings ({n_ch} chapters), {md.count('```mermaid')} diagrams, "
          f"{n_scen} scenarios mapped, {len(cov)} domain playbooks")


if __name__ == "__main__":
    main()
