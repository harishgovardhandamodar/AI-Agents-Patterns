#!/usr/bin/env python3
"""Build the supplement book *Field Playbooks* from the catalog and the app.

Deterministic and stdlib-only. It reads the same catalog JSON the app ships
(`data/*.json`), the workbench inventory (`tools/workflows_book_data.py`),
the OpenShell record (`tools/openshell_book_data.py`), the council
deliberations (`tools/field_book_prose.py`) and the case records
(`tools/field_book_data.py`), and emits:

    book/FIELD-PLAYBOOKS.md   supplement book in Markdown
    book/field-playbooks.html self-contained print HTML (PDF via
                              tools/render_pdf.mjs where Chrome is available)

Nothing is invented: every scenario is a catalog record, every workflow
exists in the shipped app, every figure is hand-authored Mermaid. Council
verdicts are recorded per chapter; the build fails on a missing key, a
missing figure, or a scenario without a domain.
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_book import CSS, HTML_SHELL, Doc, esc, inline_html, load_catalog
from build_rogue_book import SCEN_ROAD
from build_workflows_book import scen_workflows
from field_book_prose import FIELD_VERIFY
from field_book_data import FIELD_DEEP, FIELD_FIGS, FIELD_NOTES_DEEP, FIELD_NOTES_COMPACT
from openshell_book_data import ARCHETYPES, DOMAIN_PLAYBOOKS
from workflows_book_data import WORKFLOWS

ROOT = Path(__file__).resolve().parent.parent
BOOK_DIR = ROOT / "book"
MD_OUT = BOOK_DIR / "FIELD-PLAYBOOKS.md"
HTML_OUT = BOOK_DIR / "field-playbooks.html"

BOOK_TITLE = "Field Playbooks"
SUBTITLE = ("Drug Discovery to Ticketing: Case and Domain Workflows from Practice, "
            "Verified by a Counsel of Architects")
AUTHOR = "Harish Govardhan Damodar"
EDITION = "First edition — October 2026"

SEED_NOTE = "Catalog edition: counts and scenario lists below are read from data/*.json at build time."

ARCH_LABEL = {a[0]: a[1] for a in ARCHETYPES}
ARCH_PRIM = {a[0]: a[3] for a in ARCHETYPES}

COMPACT_DOMAINS = ["content", "cybersecurity", "data", "devops", "education",
                   "energy", "engineering", "enterprise", "general", "governance",
                   "healthcare", "hr", "iot", "legal", "logistics", "marketing",
                   "procurement", "public-sector", "robotics", "sales", "strategy"]

COMPACT_FIGS = {
    "content": "Content item model",
    "cybersecurity": "Vulnerability scan flow",
    "data": "Pipeline with named sinks",
    "devops": "Deploy gate hold",
    "education": "Grading loop",
    "energy": "Telemetry and control split",
    "engineering": "Review before merge",
    "enterprise": "Single-purpose SaaS",
    "general": "Default deny walkthrough",
    "governance": "Oversight loop",
    "healthcare": "Clinical advise loop",
    "hr": "Hiring with a human",
    "iot": "Fleet modules",
    "legal": "Legal matter model",
    "logistics": "Routing with gates",
    "marketing": "Campaign controls",
    "procurement": "Procurement split",
    "public-sector": "Public flow",
    "robotics": "Sense, plan, act",
    "sales": "Quote within bounds",
    "strategy": "Intake to decision",
}


def deliberate(body, key):
    """Counsel verification: verdict, suggestions, and improvements."""
    items = FIELD_VERIFY.get(key)
    if not items:
        sys.exit(f"tools/build_field_book.py: no counsel verification for `{key}` in tools/field_book_prose.py")
    body.m("**Counsel verification.**")
    body.m()
    for voice, text in items:
        body.m(f"- **{voice}:** {text}")
    body.m()
    body.h("<p><b>Counsel verification.</b></p><ul>" + "".join(
        f"<li><b>{esc(voice)}:</b> {inline_html(text)}</li>" for voice, text in items) + "</ul>")


def os_fig(body, key):
    src = FIELD_FIGS.get(key)
    if src is None:
        from workflows_book_data import WF_FIGS
        src = WF_FIGS.get(key)
    if not src:
        sys.exit(f"tools/build_field_book.py: no figure for `{key}`")
    body.m("```mermaid")
    body.m(src)
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(src)}">{esc(src)}</pre>'
        f"<figcaption>{esc(key)}.</figcaption></figure>"
    )


# --------------------------------------------------------------------------- #
#  assembly
# --------------------------------------------------------------------------- #

entries = []  # (kind, label, target) in document order; kind in front|part|chapter|back
chap_n = [0]


def main():
    cat = load_catalog()
    by_pat = {p["id"]: p for p in cat["patterns"]}
    scen_by_id = {s["id"]: s for s in cat["scenarios"]}
    n_scen = len(cat["scenarios"])
    cov = json.load(open(ROOT / "data" / "coverage.json"))["by_domain"]
    n_cas = len(json.load(open(ROOT / "data" / "cascades.json"))["cascades"])

    # -- validations ----------------------------------------------------- #
    if set(s["id"] for s in cat["scenarios"]) != set(SCEN_ROAD):
        sys.exit("tools/build_field_book.py: scenarios drifted from build_rogue_book.SCEN_ROAD")
    for dom in cov:
        if not [s for s in cat["scenarios"] if s["domain"] == dom]:
            sys.exit(f"tools/build_field_book.py: domain `{dom}` has no catalog scenario")
    _need = {"preface", "introduction", "method", "conclusion"}
    order = ["scenarios", "rogue", "coverage", "live", "guard", "blueprint",
             "deploy", "copilot", "design"]
    _need |= {"deep-" + k.split("-", 1)[1] for k in FIELD_DEEP}
    _need |= {"domain-" + d for d in COMPACT_DOMAINS}
    if set(FIELD_VERIFY) != _need:
        sys.exit(f"tools/build_field_book.py: verification keys drifted (missing={sorted(_need - set(FIELD_VERIFY))}, extra={sorted(set(FIELD_VERIFY) - _need)})")
    for k, rec in FIELD_DEEP.items():
        for d in rec["domains"]:
            if d not in cov:
                sys.exit(f"tools/build_field_book.py: deep case `{k}` names unknown domain `{d}`")
    for dom, fig in COMPACT_FIGS.items():
        if fig not in FIELD_FIGS:
            sys.exit(f"tools/build_field_book.py: no figure `{fig}` for domain `{dom}`")

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
        "I wrote this book the way I work: pick a case, open the workbench, rehearse it "
        "against mock data with open models on my own machines, and write down what "
        "happened before memory edits it. Every chapter below is a field note in my voice, "
        "followed by a counsel verification from four architects who check the verdict, "
        "add what I missed, and propose improvements. Read the note for the move; read the "
        "verification for the parts I got wrong."
    )
    body.p(
        "A note on honesty, stated once and meant everywhere: the rehearsals behind these "
        "notes ran on synthetic catalog scenarios and mock traces, never on production "
        "systems or real customer data. Counts come from the catalog at build time; "
        "configurations are illustrative. What transfers to your fleet is the workflow, "
        "the gate placement, and the review discipline — not the numbers."
    )
    body.p(
        "This book was written and compiled from study and experiment observation "
        "notes of Harish Govardhan Damodar and generated by the *AI Agent Patterns "
        "& Guardrails* catalog by a deterministic script (`tools/build_field_book.py`), "
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
    entries.append(("front", "Introduction: read the note, work the flow", h(1, "Introduction: read the note, work the flow")))
    os_fig(body, "Read loop")
    body.p(
        f"The catalog behind this book holds {len(cat['patterns'])} patterns, "
        f"{len(cat['scenarios'])} failure scenarios and {n_cas} cascades across "
        f"{len(cov)} domains. Every scenario below is assigned to the workbench "
        f"workflows that serve it; every domain gets a playbook. {SEED_NOTE}"
    )
    deliberate(body, "introduction")

    # -- Part I ---------------------------------------------------------- #
    entries.append(("part", "Part I · How I work a case",
                    body.heading(1, "Part I — How I work a case")))
    CH("The method: intake to review in five moves")
    body.p(
        "Every case in this book follows the same five moves. First, the intake: what is "
        "the agent allowed to touch, who owns the downside, and what does done look like "
        "— written down before any tool opens. Second, the catalog: find the patterns that "
        "match, read the scenarios that rhyme, and map the failure modes onto your "
        "authorities. Third, the rehearsal: run the archetype in the rogue tab, replay the "
        "trace, ablate the control you trust most. Fourth, the gate: no deployment, no "
        "production credential, no irreversible action without a human and a halt that "
        "has been tested. Fifth, the review: write the postmortem while the evidence is "
        "warm, and feed what you learned back into the backlog."
    )
    os_fig(body, "Case method")
    os_fig(body, "Case lifecycle")
    body.p(
        "The method is deliberately boring. Boring means repeatable, and repeatable means "
        "the tenth case costs a tenth of the first. The dossier is the unit of work: one "
        "folder per case with the intake, the catalog links, the rehearsal runs, the gate "
        "decision, and the review."
    )
    deliberate(body, "method")

    # -- Part II --------------------------------------------------------- #
    entries.append(("part", "Part II · Deep cases: six workflows, end to end",
                    body.heading(1, "Part II — Deep cases: six workflows, end to end")))

    DEEP_ORDER = ["deep-drug", "deep-trading", "deep-banking",
                  "deep-payments", "deep-support", "deep-ticketing"]
    DEEP_FIGS = {
        "deep-drug": ["Assay before synthesis", "Hypothesis to assay"],
        "deep-trading": ["Replay then trade", "Kill-switch drill"],
        "deep-banking": ["Onboard then approve", "Dual control gate"],
        "deep-payments": ["Payment with guardrails", "Retry without double-spend"],
        "deep-support": ["Triage with vault", "Refund with approval"],
        "deep-ticketing": ["Search, hold, pay, confirm", "Oversell guard"],
    }
    for key in DEEP_ORDER:
        rec = FIELD_DEEP[key]
        for w in rec["workflows"]:
            if w not in WORKFLOWS:
                sys.exit(f"tools/build_field_book.py: deep case `{key}` uses unknown workflow `{w}`")
        note = FIELD_NOTES_DEEP[key]
        CH(rec["title"])
        sids = sorted(s["id"] for s in cat["scenarios"] if s["domain"] in rec["domains"])
        body.p(
            "Catalog grounding: " + "; ".join(
                f"*{scen_by_id[s]['title']}* ({SCEN_ROAD[s][0]}; {ARCH_LABEL[SCEN_ROAD[s][1]]})"
                for s in sids) + "."
        )
        for para in note:
            body.p(para)
        body.p(
            "Workbench path for this case: "
            + ", ".join(WORKFLOWS[w]["label"] for w in rec["workflows"]) + "."
        )
        body.p(
            "OpenShell primitives that bound it: " + ", ".join(rec["openshell"]) + "."
        )
        for fig in DEEP_FIGS[key]:
            os_fig(body, fig)
        deliberate(body, key)

    # -- Part III -------------------------------------------------------- #
    entries.append(("part", "Part III · Every domain, every scenario",
                    body.heading(1, "Part III — Every domain, every scenario")))
    body.p(
        "One chapter per remaining catalog domain: what is at stake, the real scenarios "
        "with their roads and archetypes, the workbench path the assignment rule produces, "
        "and the OpenShell primitives that bound the domain's shapes. Thinly covered "
        "domains say so plainly — a single story is a prompt, not a coverage claim."
    )
    os_fig(body, "Scenario assignment model")
    for dom in sorted(cov):
        if dom in ("research", "trading", "finance", "support", "operations"):
            continue
        pb = DOMAIN_PLAYBOOKS[dom]
        sids = sorted(s["id"] for s in cat["scenarios"] if s["domain"] == dom)
        CH(f"Domain playbook: {dom}")
        body.p(f"At stake: {pb['stakes']}")
        body.p(
            "Catalog rehearsal: " + "; ".join(
                f"*{scen_by_id[s]['title']}* ({SCEN_ROAD[s][0]}; {ARCH_LABEL[SCEN_ROAD[s][1]]})"
                for s in sids) + "."
        )
        if len(sids) == 1:
            body.p(
                "Single-story domain: treat this chapter as a prompt. Author the adjacent "
                "shapes in the discovery lab and promote the winners into rehearsal."
            )
        wfs = []
        for s in sids:
            for w in scen_workflows(next(x for x in cat["scenarios"] if x["id"] == s)):
                if w not in wfs:
                    wfs.append(w)
        wfs = sorted(wfs, key=lambda w: order.index(w) if w in order else 99)
        counts = cov[dom]
        body.p(
            f"Workbench path: " + ", ".join(WORKFLOWS[w]["label"] for w in wfs) + ". "
            f"Catalog weight: {len(counts['patterns'])} patterns, {len(sids)} scenarios, "
            f"{len(counts['cascades_all'])} cascades."
        )
        archs = sorted({SCEN_ROAD[s][1] for s in sids})
        body.p(
            "OpenShell primitives that bound these shapes: "
            + ", ".join(ARCH_PRIM[a] for a in archs) + "."
        )
        os_fig(body, COMPACT_FIGS[dom])
        deliberate(body, f"domain-{dom}")

    # -- back matter ----------------------------------------------------- #
    CH("Conclusion: run the jobs, keep the receipts")
    body.p(
        "Every workflow in this book ends the same way: with an artifact and an owner. "
        "A plan with a score. A blueprint in the library. A board with deadlines. A "
        "backlog with names. A lesson with a checkpoint. The workbench remembers what "
        "you put into it; make sure what you put in is worth remembering."
    )
    deliberate(body, "conclusion")
    entries.append(("back", "Sources and provenance", body.heading(1, "Sources and provenance")))
    body.p(
        "Catalog: data/patterns.json, data/scenarios.json, data/cascades.json, "
        "data/traces.json, data/coverage.json — every scenario, count and assignment "
        "in this book is read from that catalog at build time. App: js/shortcuts.js "
        "(tabs), index.html (panes), js/palette.js, js/app.js. Generated by "
        "tools/build_field_book.py with council verification from "
        "tools/field_book_prose.py and case records from tools/field_book_data.py; "
        "typeset with tools/render_pdf.mjs and the vendored Mermaid engine."
    )

    # -- contents + emit (same shape as the sibling books) --------------- #
    def toc_line(label, target):
        doc.raw_html(
            f'<li><a href="#{target}"><span class="t">{esc(label)}</span>'
            f'<span class="dots"></span>'
            f'<span class="pg" data-pg="{target}">000</span></a></li>'
        )

    doc = Doc()
    doc.title_page(BOOK_TITLE, SUBTITLE, AUTHOR, EDITION)
    doc.p(
        "A supplement to *Agentic Design Patterns & Guardrails*: case and domain "
        f"workflows for drug discovery, trading, banking, payments, support, ticketing "
        f"and beyond — {len(cov)} domains, {n_scen} scenarios, every chapter written "
        f"from practice and verified by a counsel of architects. Generated from the "
        f"catalog and the app; nothing in it is hand-typed from memory."
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
          f"{n_scen} scenarios mapped, {len(cov)} domains covered")


if __name__ == "__main__":
    main()
