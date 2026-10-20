#!/usr/bin/env python3
"""Build the book *Agentic Design Patterns & Guardrails* from the catalog.

Deterministic and dependency-free (stdlib only). It reads the same JSON the app
ships (`data/*.json`), the glossary in `js/help.js`, and the files Part X is
written from (`README.md`, `design/*.md`, `serve.py`, `sw.js`, `index.html`),
and emits:

    book/AGENTIC-PATTERNS-AND-GUARDRAILS.md    book-structured Markdown
    book/agent-patterns-and-guardrails.html    self-contained print HTML

`tools/render_pdf.mjs` then turns the HTML into a PDF with headless Chrome,
rendering every Mermaid block to a real SVG with the vendored Mermaid (so the
book's diagrams are identical to the app's, and the build stays air-gap safe).

Every sentence in a pattern chapter is either the catalog's own text or a
sentence built from catalog fields — nothing is invented about a pattern. The
six chapters of Part X (*The Application*) are written from the repository the
catalog ships in (README, design/*.md, serve.py, sw.js, the container files),
and every count in them is computed from disk by book_stats() rather than
written down.
"""
import html
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK_DIR = ROOT / "book"
MD_OUT = BOOK_DIR / "AGENTIC-PATTERNS-AND-GUARDRAILS.md"
HTML_OUT = BOOK_DIR / "agent-patterns-and-guardrails.html"

# Hand-edited so rebuilds are byte-identical for identical catalog + this string.
BOOK_TITLE = "Agentic Design Patterns & Guardrails"
SUBTITLE = "A Hands-On Guide to Designing, Hardening and Operating AI Agents"
AUTHOR = "Harish Govardhan Damodar"
EDITION = "First edition — October 2026"

# h1 headings that live outside the parts and are listed in Contents too.
# write_book() fails the build if any of these (or a part, or a chapter) does
# not resolve to exactly one heading id — so renaming one side of the pair can
# never ship a Contents page that jumps nowhere.
FRONT_MATTER = [
    "Preface",
    "Acknowledgment",
    "Introduction",
    'What Makes an AI System an "Agent"?',
]
BACK_MATTER = ["Glossary", "Index of Terms", "Conclusion", "Colophon"]

SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
SEV_RANK = {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low"}

# --------------------------------------------------------------------------- #
#  data
# --------------------------------------------------------------------------- #


def load_json(name):
    return json.loads((ROOT / "data" / name).read_text())


def load_glossary():
    """The book's glossary is the app's glossary (single source of truth)."""
    src = (ROOT / "js" / "help.js").read_text()
    block = src[src.index("const GLOSSARY"):]
    block = block[: block.index("];")]
    pairs = re.findall(r'\[\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]', block)
    if not pairs:
        sys.exit("tools/build_book.py: could not parse GLOSSARY out of js/help.js")
    return [(t, d.encode().decode("unicode_escape")) for t, d in pairs]


def load_catalog():
    pats = load_json("patterns.json")
    scen = load_json("scenarios.json")["scenarios"]
    casc = load_json("cascades.json")["cascades"]
    cov = load_json("coverage.json")

    by_id = {p["id"]: p for p in pats["patterns"]}
    scen_by_pat = defaultdict(list)
    for s in scen:
        for ref in s.get("patternRefs", []):
            scen_by_pat[ref].append(s)
    casc_by_pat = defaultdict(list)
    for c in casc:
        for ref in c.get("patternRefs", []):
            casc_by_pat[ref].append(c)

    parts = []
    for i, cat in enumerate(pats["categories"], start=1):
        parts.append({
            "n": roman(i),
            "key": cat["id"],
            "name": cat["name"],
            "desc": cat["desc"],
            "diagram": pats["categoryDiagrams"].get(cat["id"]),
            "patterns": [p for p in pats["patterns"] if p["cat"] == cat["id"]],
        })

    return {
        "patterns": pats["patterns"],
        "scenarios": scen,
        "cascades": casc,
        "coverage": cov,
        "by_id": by_id,
        "scen_by_pat": scen_by_pat,
        "casc_by_pat": casc_by_pat,
        "parts": parts,
        "glossary": load_glossary(),
    }


def roman(n):
    table = [(10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
    out = []
    for v, s in table:
        while n >= v:
            out.append(s)
            n -= v
    return "".join(out)


# --------------------------------------------------------------------------- #
#  dual renderer: one call writes both Markdown and HTML
# --------------------------------------------------------------------------- #


def esc(s):
    return html.escape(str(s), quote=True)


def inline_html(text):
    """Markdown-ish inline (already HTML-escaped) — bold, italics, code, links."""
    s = esc(text)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", s)
    # single-asterisk italics AFTER bold, so **x** isn't half-consumed by it
    s = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<i>\1</i>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    return s


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


class Doc:
    """Appends to a Markdown buffer and an HTML buffer in lockstep."""

    def __init__(self):
        self.md = []
        self.html = []
        # When set (by write_chapter), every heading id is prefixed with it.
        # The section titles repeat in every chapter, so without scoping the
        # document would carry 10 duplicate-id groups and a link to
        # `#conclusion` would resolve to chapter 1's section instead of the
        # back-matter heading of the same name.
        self.id_base = ""

    # -- primitives -------------------------------------------------------- #
    def m(self, text=""):
        self.md.append(text)

    def h(self, text):
        self.html.append(text)

    def heading(self, level, text, cls=""):
        aid = slug(f"{self.id_base} {text}")
        self.m("#" * level + " " + text)
        self.m()
        self.h(f'<h{level} id="{aid}" class="{cls}">{inline_html(text)}</h{level}>')
        return aid

    def title_page(self, title, subtitle, author, edition):
        self.m(f"# {title}")
        self.m()
        self.m(f"**{subtitle}**")
        self.m()
        self.m(f"*{author}*")
        self.m()
        self.m(edition)
        self.m()
        self.m("---")
        self.m()
        self.h(
            '<section class="titlepage"><div class="tp-rule"></div>'
            f"<h1>{esc(title)}</h1><p class=\"tp-sub\">{esc(subtitle)}</p>"
            f'<p class="tp-author">{esc(author)}</p><p class="tp-ed">{esc(edition)}</p>'
            '<div class="tp-rule"></div></section>'
        )

    def p(self, text):
        self.m(text)
        self.m()
        self.h(f"<p>{inline_html(text)}</p>")

    def ul(self, items):
        for i in items:
            self.m("- " + i)
        self.m()
        self.h("<ul>" + "".join(f"<li>{inline_html(i)}</li>" for i in items) + "</ul>")

    def ol(self, items):
        for n, i in enumerate(items, start=1):
            self.m(f"{n}. {i}")
        self.m()
        self.h("<ol>" + "".join(f"<li>{inline_html(i)}</li>" for i in items) + "</ol>")

    def table(self, headers, rows, caption=None):
        self.m("| " + " | ".join(headers) + " |")
        self.m("|" + "|".join(["---"] * len(headers)) + "|")
        for r in rows:
            self.m("| " + " | ".join(str(c).replace("|", "\\|") for c in r) + " |")
        self.m()
        head = "".join(f"<th>{inline_html(h)}</th>" for h in headers)
        body = "".join(
            "<tr>" + "".join(f"<td>{inline_html(c)}</td>" for c in r) + "</tr>" for r in rows
        )
        cap = f'<div class="cap">{inline_html(caption)}</div>' if caption else ""
        self.h(cap + f'<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>')

    def quote(self, text):
        self.m("> " + text)
        self.m()
        self.h(f'<blockquote>{inline_html(text)}</blockquote>')

    def mermaid(self, src, caption):
        self.m("```mermaid")
        self.m(src)
        self.m("```")
        self.m()
        self.h(
            # data-src mirrors js/app.js: mermaid.run() REPLACES the node's text
            # with the rendered SVG (style block included), so the pristine source
            # must live in an attribute or a re-render feeds mermaid its own CSS.
            '<figure class="diagram">'
            f'<pre class="mermaid" data-src="{esc(src)}">{esc(src)}</pre>'
            f'<figcaption>{inline_html(caption)}</figcaption></figure>'
        )

    def pagebreak(self):
        self.m("---")
        self.m()
        self.h('<div class="pb"></div>')

    def chapter_break(self):
        """Markdown gets a rule for visual separation; HTML relies on the CSS
        `page-break-before` on h1.chapter, so an extra div here would blank a page."""
        self.m("---")
        self.m()

    def raw_html(self, html_):
        self.h(html_)

    def render(self):
        return "\n".join(self.md).rstrip() + "\n"


# --------------------------------------------------------------------------- #
#  book content
# --------------------------------------------------------------------------- #


def severity_cell(sev):
    return SEV_RANK.get(sev, str(sev).title())


def write_chapter(doc, ctx, cat):
    p = ctx["pattern"]
    num, part = ctx["num"], ctx["part"]
    has_own = bool(p.get("diagram"))

    doc.chapter_break()
    doc.id_base = ""  # the chapter's own h1 is top-level; sections below are not
    doc.heading(1, f"Chapter {num}: {p['name']}", cls="chapter")
    # Scope the section ids that follow to this chapter (see Doc.id_base).
    doc.id_base = slug(f"Chapter {num}: {p['name']}")
    doc.p(f"**Part {part['n']} — {part['name']}**")
    doc.heading(2, f"{p['name']} Pattern Overview")

    doc.p(p["summary"])
    doc.p(
        f"**{p['name']}** is catalogued in the **{part['name']}** part of the "
        f"catalog (id `{p['id']}`). It is tagged for "
        f"{', '.join(p['domains'])} and is assembled from "
        f"{len(p['components'])} component{'s' if len(p['components']) != 1 else ''}."
    )

    # -- practical applications ------------------------------------------- #
    doc.heading(2, "Practical Applications & Use Cases")
    doc.p("Domains the catalog tags this pattern for:")
    doc.ul(p["domains"])
    if ctx["scenarios"]:
        n_s = len(ctx["scenarios"])
        doc.p(
            f"{n_s} documented failure scenario{'s' if n_s != 1 else ''} "
            f"{'exercise' if n_s != 1 else 'exercises'} it:"
        )
        doc.table(
            ["Scenario", "Severity", "Likelihood", "Domain"],
            [[s["title"], severity_cell(s["severity"]), s["likelihood"].title(), s["domain"]] for s in ctx["scenarios"]],
        )
    else:
        doc.p(
            "No catalogued scenario names this pattern yet — in the app it shows up "
            "in the Coverage tab's backlog as a domain that deserves a written "
            "failure scenario."
        )
    if ctx["cascades"]:
        shown = ctx["cascades"][:6]
        n_c = len(ctx["cascades"])
        how_many = (
            "" if n_c <= len(shown)
            else f" — the {len(shown)} most impactful of {n_c}"
        )
        doc.p(
            f"It also appears in {n_c} composition cascade"
            f"{'s' if n_c != 1 else ''}{how_many}:"
        )
        doc.table(
            ["Cascade", "Class", "Blast radius", "Impact"],
            [[c["name"], c["cls"].title(), c["blastRadius"], severity_cell(c["impact"])] for c in shown],
        )

    # -- how it works ------------------------------------------------------- #
    doc.heading(2, "How It Works")
    doc.ol(p["how"])

    doc.heading(2, "Components")
    doc.ul(p["components"])

    # -- diagram ----------------------------------------------------------- #
    doc.heading(2, "Control-Flow Diagram")
    n_own = sum(1 for x in cat["patterns"] if x.get("diagram"))
    cap = (
        f"{p['name']} — control flow as rendered by the catalog."
        if has_own
        else f"{p['name']} uses its part's control-flow diagram ({part['name']}): "
        f"the catalog ships an authored diagram for {n_own} of "
        f"{len(cat['patterns'])} patterns, and "
        "every other pattern inherits its part's."
    )
    doc.mermaid(ctx["diagram"], cap)

    # -- failures ---------------------------------------------------------- #
    doc.heading(2, "Failure Modes and Risks")
    if p["failures"]:
        n_f = len(p["failures"])
        doc.p(
            f"{n_f} failure mode{'s' if n_f != 1 else ''} "
            f"{'are' if n_f != 1 else 'is'} documented for this pattern:"
        )
        doc.table(
            ["Failure mode", "Severity", "What happens"],
            [[f["n"], severity_cell(f["sev"]), f["d"]] for f in p["failures"]],
        )
    else:
        doc.p("The catalog documents no distinct failure mode for this pattern.")

    doc.heading(2, "Protections")
    doc.ol(p["protections"])

    # -- at a glance ------------------------------------------------------- #
    doc.heading(2, "At a Glance")
    doc.table(
        ["Field", "Value"],
        [
            ["Catalog id", f"`{p['id']}`"],
            ["Part", f"{part['n']} — {part['name']}"],
            ["Domains", ", ".join(p["domains"])],
            ["Components", ", ".join(p["components"])],
            ["Failure modes", str(len(p["failures"]))],
            ["Protections", str(len(p["protections"]))],
            ["Related patterns", ", ".join(r["name"] for r in ctx["related"]) or "—"],
            ["Linked scenarios", str(len(ctx["scenarios"]))],
            ["Linked cascades", str(len(ctx["cascades"]))],
        ],
    )

    # -- takeaways --------------------------------------------------------- #
    doc.heading(2, "Key Takeaways")
    takeaways = [p["summary"]]
    takeaways += list(p["protections"])
    if p["failures"]:
        takeaways.append(
            "Know its failure modes: "
            + "; ".join(f"{f['n']} ({f['sev']})" for f in p["failures"])
            + "."
        )
    doc.ul(takeaways)

    # -- references -------------------------------------------------------- #
    doc.heading(2, "References and Related Patterns")
    if ctx["related"]:
        doc.table(
            ["Related pattern", "Part", "Summary"],
            [
                [r["name"], next(c["name"] for c in cat["parts"] if c["key"] == r["cat"]), r["summary"]]
                for r in ctx["related"]
            ],
        )
    else:
        doc.p("No cross-references are catalogued for this pattern.")

    doc.heading(2, "Conclusion")
    n_f, n_p = len(p["failures"]), len(p["protections"])
    doc.p(
        f"In the catalog this chapter was generated from, **{p['name']}** is one of "
        f"{len(cat['patterns'])} patterns in *{part['name']}*, carrying "
        f"{n_f} documented failure mode{'s' if n_f != 1 else ''} and {n_p} "
        f"listed protection{'s' if n_p != 1 else ''}. Use it as a starting point, "
        "not a specification: the protection list is the part that survives "
        "contact with an adversary."
    )


def write_part(doc, part, cat):
    doc.id_base = ""  # part and chapter ids are top-level, never scoped
    doc.chapter_break()
    doc.heading(1, f"Part {part['n']}: {part['name']}", cls="part")
    doc.p(part["desc"])
    n = len(part["patterns"])
    ids = {p["id"] for p in part["patterns"]}
    scen = [s for s in cat["scenarios"] if ids & set(s.get("patternRefs", []))]
    cas = [c for c in cat["cascades"] if ids & set(c.get("patternRefs", []))]
    doc.p(
        f"*{part['name']}* holds {n} of the catalog's {len(cat['patterns'])} patterns, "
        f"which appear in {len(scen)} catalogued failure scenario"
        f"{'s' if len(scen) != 1 else ''} and {len(cas)} composition cascade"
        f"{'s' if len(cas) != 1 else ''}. Each chapter below follows the same order "
        "and shape as every other part."
    )
    doc.table(
        ["Chapter", "Pattern", "Domains"],
        [[str(c["num"]), c["pattern"]["name"], ", ".join(c["pattern"]["domains"])] for c in part["contexts"]],
    )
    if part["diagram"]:
        doc.mermaid(part["diagram"], f"The {part['name']} control-flow diagram.")


# --------------------------------------------------------------------------- #
#  Part X — the application that publishes the catalog
#
#  The chapters above are built from catalog records; these six are built from
#  the repository the catalog ships in (README, design/*.md, serve.py, sw.js,
#  Dockerfile, docker-compose.yml, .env.example). Every count in the prose goes
#  through book_stats()/format_map(), so a record that changes on disk changes
#  the next edition of these chapters too.
# --------------------------------------------------------------------------- #

APP_PART_N = "X"
APP_PART_NAME = "The Application"
APP_PART_DESC = (
    "The dashboard that publishes the catalog — what it is, how it carries a "
    "design workflow, how it is designed and built, and how it keeps your data "
    "and your model on hardware you control."
)

APP_PART_INTRO = [
    "This book has been read through an application for its whole life, and so "
    "has every diagram in it. *AI Agent Patterns & Guardrails* is a "
    "{tabs}-tab single-page dashboard of plain HTML, CSS and JavaScript, served "
    "by one small Python program, rendered by a vendored Mermaid engine, and "
    "reachable over a LAN, a tailnet or no network at all. This part opens that "
    "machine up.",
    "It closes the book deliberately. The pattern chapters argue that safety "
    "comes from deterministic enforcement outside the model; the application is "
    "where that argument is applied to the tool itself — a rule engine instead "
    "of a model for the analysis, a gate instead of a build step, a cache "
    "instead of a CDN dependency, and a same-origin proxy instead of a "
    "third-party API. The six chapters below follow the same shape as every "
    "chapter above them, and every claim in them points at a file in the "
    "repository the catalog ships in.",
]

# Each chapter: title, covers (part table), the eleven sections, and the
# figures it carries. Figures are pulled from design/*.md by heading — the same
# files the app's Design tab renders — so the book and the app cannot diverge.
APP_CHAPTERS = [
    {
        "title": "What the Application Is",
        "covers": "What the dashboard is and what it is for",
        "overview": [
            "This book's catalog does not arrive as a folder of JSON files. It "
            "arrives as *AI Agent Patterns & Guardrails* — a {tabs}-tab "
            "single-page dashboard of plain HTML, CSS and JavaScript, rendered "
            "at view time by a vendored Mermaid engine, with no build step, no "
            "bundler, no framework and no account anywhere in the stack.",
            "The lifecycle it covers is the one this book describes from its "
            "first chapter: design patterns, then what can go wrong, then how "
            "to protect against it, then a live replay of the control flow, "
            "then the architecture, and finally a lab that turns your own agent "
            "idea into a guardrail design with a mock run. The whole thing is "
            "served by `serve.py`, {serve_lines} lines of standard-library "
            "Python that also doubles as a same-origin relay to an optional "
            "model running on your own network.",
            "It is a reference you can interrogate rather than a shelf you can "
            "only read: filter, sort, replay, compose, compare, and take the "
            "result out as Markdown, JSON, CSV or a print-friendly page.",
        ],
        "why": [
            "A catalog earns its keep when it can be asked questions. The "
            "application is organized around the four questions every architect "
            "brings to a new agent — *what do I need to build?*, *what am I "
            "missing?*, *how far does failure spread?*, and *what do I do, in "
            "what order?* — and each answer comes back as an artifact: a "
            "filtered pattern set, a ranked gap backlog, a cascade with its "
            "blast radius, a readiness score, an ADR you can hand to a "
            "reviewer.",
            "The flagship example is the proof. A $50,000 card charge enters "
            "the Guardrail Lab and is stopped by five independent layers — "
            "context, authority, runtime policy, human process, infrastructure "
            "— each one assuming the layers above it have already failed. The "
            "replay reports the charge denied at the policy gateway, contained "
            "in 2.8 seconds with $0 moved, while a legitimate $3,850 order "
            "passes through the same five.",
            "The output is reproducible. The lab's analysis comes from a "
            "deterministic rule engine running in your browser rather than from "
            "a model, so the same agent idea produces the same design tomorrow "
            "— which is what makes it discussable in a review.",
            "And it runs where it is needed: after a single visit the service "
            "worker holds the whole shell, so a LAN-only or air-gapped host "
            "keeps working with the cable unplugged.",
        ],
        "how": [
            "`index.html` loads the shell script first. The shell owns the tab "
            "switcher, the theme, the data load, the Mermaid queue and the zoom "
            "viewer, and exposes two registries — `tabLoaders` and `PANE_INIT` "
            "— that every tab module fills with its own `init*()`.",
            "First paint is phased rather than total: patterns, scenarios, "
            "traces and coverage are awaited before the count badges appear, "
            "while `cascades.json` — the largest dataset — loads in parallel and "
            "is awaited only by the panes that actually need it.",
            "A tab builds on first visit behind a skeleton and stays built "
            "afterwards. `switchTab` runs a pending pane immediately instead of "
            "waiting its turn in the idle queue, so a slow pane is never blank.",
            "Every diagram enters one queue. The vendored Mermaid is loaded "
            "once, initialised with `securityLevel: 'strict'`, and run node by "
            "node — sequential, because Mermaid measures labels in shared global "
            "state and concurrent renders would race each other — with a CDN "
            "copy used only if the vendored file is missing.",
            "Opening Fox - Architect posts to `/api/llm/chat` on the page's own "
            "origin; `serve.py` walks its backend list in failover order and "
            "relays the reply as it arrives. With no backend online it answers "
            "with a payload the interface understands, and the chat falls back "
            "to a deterministic catalog answer instead of an error.",
            "Everything you build is kept in `localStorage` on this origin, and "
            "leaves only when you export it — as JSON, Markdown, CSV or a print "
            "page.",
        ],
        "components": (
            "table",
            ["Tab", "What it does"],
            [
                ["Overview", "Landing page and architect dashboard: catalog totals, spotlights, a deterministic \"Next:\" suggestion, the pinned working set, and the report export row."],
                ["Fox - Architect", "Grounded chat with a local model through the server-side proxy: streaming, citations, tables and Mermaid in answers, plus a deterministic offline fallback."],
                ["Patterns", "{patterns} design patterns across {categories} categories, each with failure modes, protections, related patterns and a control-flow diagram; filter by category, domain or diagram."],
                ["Scenarios", "{scenarios} failure scenarios across {domains} domains — {critical} critical, {high} high, {medium} medium — each opening onto its attack chain, protection table, detection signals and response."],
                ["Cascades", "{cascades} composition cascades in four classes, with propagation paths, amplifiers, blast radius and mitigation columns, plus a simulator and a ranked mitigation backlog."],
                ["Coverage", "Gap view: heatmap per domain, a scenario-budget chart ({budget_ok} of {domains} meet it), ranked gap cards and an exportable authoring backlog."],
                ["Deployment Plan", "Four-step intake, readiness scorecard, recommended stack, autonomy and rollout dial, residual-risk register, and an ADR generator with validated citations."],
                ["Blueprints", "Reference-architecture builder with Mermaid export, deterministic warnings, a cost/latency/risk estimator, a per-blueprint threat model and baseline compare."],
                ["Live View", "{traces} filterable mock execution traces, replayed on the control-flow diagram with step tracker, gauges and streaming event log."],
                ["Design & Architecture", "{design_docs} design documents rendered live with their Mermaid diagrams, a scroll-spy outline, a source toggle and a zoom viewer."],
                ["Guardrail Lab", "Any agent idea analyzed into a full guardrail design with a mock run, saved to a collection in `localStorage` and exportable as JSON."],
                ["Discovery Lab", "Deterministic ideation of novel scenarios: candidates compete, winners are kept, the rest are forgotten. Winners are drafts only, never auto-added."],
            ],
        ),
        "figures": [
            ("System Context", "design/01-system-context.md", "Context diagram",
             "The system context: three kinds of people, one dashboard with a same-origin model proxy, static versioned knowledge on the same origin, and two optional tailnet backends."),
        ],
        "risks": [
            "The catalog is deliberately unfinished: {scenarios} scenarios "
            "across {domains} domains, and only {budget_ok} of the {domains} "
            "meet the two-per-domain budget the Coverage tab charts. The gap "
            "ships as an exportable backlog rather than being papered over.",
            "The blueprint exposure index measures matched threat *surface* "
            "from the catalog, not measured risk — compare like-for-like "
            "designs rather than index numbers against feelings.",
            "Fox - Architect grounds itself by deterministic retrieval over "
            "the catalog, not by fine-tuning: it names the record it used, and "
            "reading that record is still your job.",
            "Cost, latency and benefit figures in the estimator are stated "
            "assumptions for comparison, not benchmarks on your infrastructure.",
            "There is no build step, so nothing stops a mistake before runtime "
            "the way a type checker would; the substitute is the gate — lint, "
            "data-integrity tests, and a headless smoke test that boots the "
            "server and walks all {tabs} tabs.",
            "It designs enforcement, it does not enforce. No part of this "
            "application sits between your agent and the world: what it "
            "produces is a design, a rule set and an ADR that your own runtime "
            "still has to implement.",
        ],
        "safeguards": [
            "Every recommendation carries its source: cascade rules cite the "
            "cascade they break, guardrail configs name the layer they are "
            "enforced at, and the ADR generator validates its citations against "
            "the catalog before you see them.",
            "The lab's analysis is a rule engine, so it is auditable line by "
            "line and identical on every machine.",
            "Data integrity is tested, not trusted: `npm test` enforces id "
            "uniqueness, full referential integrity and a required/unexpected-"
            "key schema guard — the check that caught the historical "
            "`proteations` typo — plus coverage freshness and the offline "
            "precache list.",
            "A model is an accelerator, never a dependency: nothing else in "
            "the application calls one, and the chat degrades to a "
            "deterministic answer when both backends are down.",
            "Rendered text is treated as data: user content is escaped before "
            "it reaches the DOM, and Mermaid runs in strict mode.",
        ],
        "glance": [
            ["Form", "Static single-page app; no build step, no account"],
            ["Tabs", "{tabs} tabs over one shell and {scripts} modules"],
            ["Catalog", "{patterns} patterns · {categories} categories · {failures} failure modes · {protections} protections"],
            ["Evidence", "{scenarios} scenarios · {cascades} cascades · {traces} traces · {domains} domains"],
            ["Diagrams", "Vendored Mermaid in one queue; CDN only as a fallback"],
            ["Server", "`serve.py` — static host plus same-origin model proxy"],
            ["Offline", "Service worker precaches the shell ({precache} entries)"],
            ["Persistence", "`localStorage`; exports are user-initiated"],
            ["Model", "Optional; local backend first, deterministic fallback"],
            ["Gate", "ESLint · node:test · headless smoke · CI"],
        ],
        "takeaways": [
            "The catalog is an application, not a document: {patterns} patterns, "
            "{scenarios} scenarios and {cascades} cascades that you filter, "
            "replay and export instead of merely indexing.",
            "Its unit of output is a reviewable artifact — a pattern set, a "
            "backlog, a rule set, a scorecard, an ADR — and each one names the "
            "record behind it.",
            "The deterministic parts are deterministic on purpose, so a design "
            "review reproduces instead of drifting.",
            "Offline is a first-class state: one visit, then no network.",
            "What it makes is a design your runtime still has to implement.",
        ],
        "refs": [
            "`README.md` — run instructions, the twelve tabs, testing and "
            "performance, and the scope caveats quoted above.",
            "`design/01-system-context.md` — context and container diagrams, "
            "trust boundaries, deployment.",
            "`design/07-architect-analysis.md` — the four questions and the "
            "value map this chapter is organized around.",
            "`index.html` and `js/app.js` — the shell, the tab registry and "
            "the panes themselves.",
            "`serve.py` — the static host and the same-origin model proxy.",
            "`sw.js` — the offline shell and its precache list.",
        ],
        "conclusion": [
            "Read the rest of this book through it. Every diagram, count and "
            "failure mode in the pattern chapters is one of this application's "
            "screens, and Part X is what happens when you take the catalog's "
            "own advice and apply it to the tool that publishes the catalog: "
            "deterministic where it can be, gated where it cannot, and inside "
            "your network either way.",
        ],
    },
    {
        "title": "Supporting the Agentic Workflow",
        "covers": "How the app carries a design workflow end to end",
        "overview": [
            "The loop this book describes has two halves. One is the runtime "
            "that executes it — context assembled, model proposes, gateway "
            "disposes, every iteration lands in an audit trail. The other is "
            "the design work that decides what that runtime should be in the "
            "first place.",
            "This application is about the second half. It does not run your "
            "agent; it carries the workflow that happens before runs, between "
            "runs and after runs — choosing patterns, writing the failure mode "
            "before the feature, deciding how much autonomy to grant, rehearsing "
            "the control flow, and producing the artifacts a review can approve.",
            "Its spine is the catalog's four questions: *what do I need to "
            "build?*, *what am I missing?*, *how far does failure spread?*, and "
            "*what do I do, in what order?* Each one is answered by a tab, and "
            "each answer leaves something behind.",
        ],
        "why": [
            "Design work fails in a team when it stays verbal. \"We should add "
            "a spend guard\" is an opinion; a rule set with a per-transaction "
            "cap, a rolling window, a vendor allowlist and velocity detection — "
            "citing the cascade it breaks — is a design someone can implement "
            "and someone else can review.",
            "Keeping the evidence next to the advice is what makes that review "
            "possible: every proposal names the records behind it, so the "
            "argument happens about the catalog rather than about prose.",
            "It also compresses the loop. One session can go from a one-line "
            "agent idea to a threat model, a rollout plan and an exportable "
            "report, with a replayed control flow to show the team what failure "
            "looks like before it looks like that.",
        ],
        "how": [
            "Frame the system on Overview: planner readiness, blueprint "
            "coverage, the state of the chat and the rule lab, a deterministic "
            "*Next:* suggestion, and the working set you have pinned.",
            "Choose the vocabulary in Patterns — {patterns} designs across "
            "{categories} categories, filtered by domain or by whether they "
            "carry a diagram or documented failures.",
            "Test the threats in Scenarios: {scenarios} recorded failures "
            "across {domains} domains, each with its attack chain, protection "
            "table, detection signals and incident response.",
            "Trace the spread in Cascades — {cascades} composition cascades in "
            "four classes, with propagation paths, blast radius, a simulator "
            "and a leverage-ranked mitigation backlog.",
            "Find the gaps in Coverage: the heatmap, the two-per-domain budget "
            "chart ({budget_ok} of {domains} meet it today) and the exportable "
            "authoring backlog.",
            "Compose in Blueprints: patterns into a pipeline with a control "
            "overlay, Mermaid export, a cost/latency/risk estimator, and a "
            "threat model scored against the catalog ceiling.",
            "Bound it in the Guardrail Lab: the idea is analyzed into a full "
            "design — risk score, advice, tiered proposals, an enforcement "
            "diagram, a reference control set, cascade-aware rules and a mock "
            "run — then saved to a collection.",
            "Plan the rollout in Deployment Plan: intake, readiness scorecard, "
            "recommended stack, autonomy dial from shadow to autonomous, "
            "residual-risk register, then an ADR whose citations are validated "
            "against the catalog.",
            "Rehearse in Live View: {traces} execution traces, filterable and "
            "replayable step by step on the control-flow diagram, with budget, "
            "cost and guardrail counters advancing beside them.",
            "Take it out of the app from the Overview export row: the whole "
            "architect report as Markdown, JSON or a print-friendly page.",
        ],
        "components": (
            "table",
            ["Workflow stage", "Tab", "Artifact produced"],
            [
                ["Frame the system", "Overview", "Dashboard state, pinned working set, \"Next:\" suggestion"],
                ["Choose the vocabulary", "Patterns", "Filtered pattern set with failure modes and protections"],
                ["Test the threats", "Scenarios", "Attack chain, protection table, detection signals"],
                ["Trace the spread", "Cascades", "Propagation path, blast radius, simulator run, backlog"],
                ["Find the gaps", "Coverage", "Gap cards and an exportable authoring backlog"],
                ["Compose the design", "Blueprints", "Architecture, estimator, threat model vs. ceiling"],
                ["Bound it", "Guardrail Lab", "Rule set citing cascades, mock run, saved collection"],
                ["Plan the rollout", "Deployment Plan", "Scorecard, stack, autonomy dial, risk register, ADR"],
                ["Rehearse", "Live View", "Replayed trace with step tracker, gauges and event log"],
                ["Hand it over", "Overview export", "Architect report as Markdown, JSON or print page"],
            ],
        ),
        "figures": [
            ("From Catalog to Advisory System", "design/07-architect-analysis.md",
             "1. From catalog to advisory system",
             "The reference becomes an advisory system: the records on the left feed the four questions in the middle, and the advisory tools on the right answer them with designs you can export."),
        ],
        "risks": [
            "Design-time only. Nothing here is runtime enforcement — the "
            "gateway you diagram in the lab still has to be built and deployed "
            "by you.",
            "Discovery Lab results are drafts. Winners are kept and the rest "
            "forgotten by design, but they are never auto-added to the catalog: "
            "a novel scenario stays an idea until a human reviews it.",
            "Coverage is thin in places: {budget_ok} of {domains} domains meet "
            "the scenario budget, and the Coverage tab says which ones.",
            "Scores are starting points. A readiness score or an exposure "
            "index opens a conversation; neither certifies anything, and "
            "neither measures real-world risk.",
            "Estimates stay estimates: cost and latency figures come from "
            "stated assumptions, not from benchmarks on your stack.",
        ],
        "safeguards": [
            "Citations are validated, not decorative: the ADR generator checks "
            "its references against the catalog, and each cascade rule names "
            "the cascade it breaks.",
            "Every stage is inspectable in place — the same records drive the "
            "filter, the diagram, the rule and the export, so they cannot "
            "quietly disagree with each other.",
            "A seeded example ships with the lab, so the whole flow is visible "
            "on first load before you put your own idea into it.",
            "The mock run is replayable — play, step, back and reset over the "
            "same trace — so a review can stop at the exact step where it "
            "disagrees.",
            "Everything leaves the app explicitly, through export, copy or "
            "print, and stays in your browser until it does.",
        ],
        "glance": [
            ["Input", "An agent idea, in plain language"],
            ["Questions", "Build? missing? spread? in what order?"],
            ["Stages", "frame → choose → test → trace → gap → compose → bound → plan → rehearse → export"],
            ["Artifacts", "pattern set, gap backlog, rule set, architecture, scorecard, ADR, report"],
            ["Evidence", "every artifact names the catalog record behind it"],
            ["Rehearsal", "{traces} traces, step-controllable, on the control-flow diagram"],
            ["Determinism", "rule engine in the browser; model optional"],
            ["Flagship", "$50k card: five layers, denied in 2.8s, $0 moved"],
        ],
        "takeaways": [
            "Treat design as a workflow with stages and artifacts, not as a "
            "document you start writing.",
            "Write the failure mode before the feature — the Scenarios and "
            "Cascades tabs are the inputs to the design, not an appendix to it.",
            "Attach the record to the recommendation: a citation that validates "
            "is worth more than a paragraph that persuades.",
            "Rehearse the control flow before you ship it; the replay is "
            "cheaper than the incident.",
            "Export before you review, so the artifact survives outside the "
            "tool.",
        ],
        "refs": [
            "`README.md` — the twelve tabs and what each one produces.",
            "`design/07-architect-analysis.md` — the four questions, the value "
            "map, and the deployment lifecycle the planner encodes.",
            "`design/04-guardrails.md` — the flagship's enforcement sequence "
            "and charge lifecycle.",
            "`design/03-control-flow.md` — the canonical agent loop and the "
            "replay state machine.",
            "`data/scenarios.json`, `data/cascades.json`, `data/traces.json` — "
            "the records every artifact cites.",
        ],
        "conclusion": [
            "A design workflow is only as good as what it hands over. The test "
            "of this one is whether a colleague can take the export — the "
            "pattern set, the rule set, the scorecard and the ADR — and build "
            "the thing without asking you what you meant. Every stage above "
            "exists to make that hand-over boring, and boring is the highest "
            "compliment a design review can pay itself.",
        ],
    },
    {
        "title": "Design Principles",
        "covers": "The principles the tool holds itself to",
        "overview": [
            "The catalog's thesis is that safety lives in deterministic "
            "enforcement outside the model. The application applies that thesis "
            "to itself: it is not a toolchain project, it is a short list of "
            "constraints chosen so that what you read on screen is what the "
            "files on disk say.",
            "Seven principles, each one visible in a file — a rule engine "
            "instead of a model, a gate instead of a build step, plain JSON "
            "instead of a database, one namespace instead of a bundle, one "
            "diagram queue instead of concurrent renders, degradation instead "
            "of failure, and a printed budget instead of a claim.",
        ],
        "why": [
            "A tool that tells you where your controls live has to be "
            "inspectable itself: you should be able to open the file it named "
            "and find the line.",
            "A reference that runs on a LAN, a tailnet or an air-gapped host "
            "cannot depend on a package registry, a font CDN, or a service that "
            "might be gone tomorrow.",
            "And claims about speed and offline behaviour are worthless unless "
            "they are measured. A tool that prints its own numbers can be "
            "caught being wrong — which is exactly the point of printing them.",
        ],
        "how": [
            "**Deterministic outside the model.** The Guardrail Lab's analysis "
            "is a rule engine running in the browser: signals times weights, "
            "mapped to a tier, matched to proposals. The chat is optional, and "
            "when it is unavailable the analysis does not change.",
            "**No build step, but there is a gate.** Plain files that any "
            "editor can change, wrapped in `npm run lint` (ESLint `no-undef` "
            "over the shared globals), `npm test` (ids, schema, references, "
            "coverage freshness, precache sync) and a headless smoke test that "
            "boots the server and walks all {tabs} tabs.",
            "**Plain, versioned JSON with no hidden defaults.** The datasets "
            "are diffable and exportable, and a missing field renders as "
            "absent rather than as a silently-chosen value.",
            "**One global namespace with guarded edges.** `index.html` loads "
            "classic scripts — no modules, no bundler. Cross-module calls are "
            "checked with `typeof … === 'function'`, so any single module can "
            "fail to define itself without blanking the application.",
            "**One queue for every diagram.** Mermaid measures text in shared "
            "global state, so renders are serialised behind one promise chain: "
            "vendored engine first, CDN only as a fallback, initialise once in "
            "strict mode, run node by node, heal if fonts raced, and write an "
            "inline note instead of throwing.",
            "**Degrade, don't fail.** Phased boot, skeletons for panes that "
            "are still building, a pane that can jump the idle queue, a "
            "deterministic copilot fallback, and a worker that serves from "
            "cache when the network is gone.",
            "**Make the wins visible, not claims.** The Display panel prints a "
            "live budget from the sizes the worker recorded: first load about "
            "1.37 MB compressed against 4.9 MB raw, and a repeat visit about "
            "0.02 MB.",
        ],
        "components": [
            "**The shell** — `index.html` plus `js/app.js`: one namespace, two "
            "registries, and `typeof`-guarded edges between them.",
            "**The gate** — lint, the `node:test` suite, the headless smoke "
            "test, and CI wiring that makes lint and data integrity blocking.",
            "**The queue** — one promise chain around Mermaid, preserving each "
            "block's `data-src` so a re-render never feeds the engine its own "
            "generated CSS.",
            "**The worker** — `sw.js`, with a `VERSION`, a {precache}-entry "
            "precache list, network-first fetches and `/api/*` excluded.",
            "**The store** — plain JSON on disk, `localStorage` in the browser, "
            "exports on the way out.",
            "**The budget** — the Display panel, reading the worker's own size "
            "records instead of a hard-coded number.",
        ],
        "figures": [
            ("Guardrails for the App Itself", "design/08-runtime-offline.md",
             "Guardrails for the app itself",
             "The catalog's thesis applied to the catalog's own tooling: no build step, but a gate — lint, tests and a smoke test — between an edit and a ship."),
            ("One Diagram Queue", "design/08-runtime-offline.md",
             "Diagrams: vendored first, one queue",
             "Vendored first, one queue: load the local engine, fall back to the CDN only if it is missing, initialise once in strict mode, then run every node in turn."),
        ],
        "risks": [
            "No bundler means no type checker: a mistake in a module surfaces "
            "when that module runs, not when you save. The gate narrows the "
            "window; it does not close it.",
            "One namespace means an accidental redefinition is possible. "
            "`no-undef` is what turns a typo into a failed lint instead of a "
            "runtime surprise.",
            "Sequential rendering is a correctness decision that costs "
            "perceived speed — a diagram-heavy pane fills in one figure at a "
            "time.",
            "The CSP keeps `'unsafe-inline'` for scripts and styles because the "
            "shell is inline-handler heavy and the print view writes its own "
            "`<style>`. That is a real widening of `script-src 'self'`, and the "
            "clearest concession the hardening makes.",
            "Saved work lives in `localStorage`, which belongs to the browser "
            "profile: a fresh profile starts empty, so export before you move "
            "machines.",
            "A precached shell is a stale shell until `VERSION` moves; the "
            "worker's activation step exists to keep that window short.",
        ],
        "safeguards": [
            "`no-undef` runs over every `js/*.js`, with the shell's own "
            "top-level declarations declared as shared globals, so genuine "
            "typos fail and legitimate cross-file calls do not.",
            "A schema guard on the data fails the test on an unexpected key — "
            "the check that caught the misspelled `proteations` field.",
            "`VERSION` plus an activation step that deletes every cache that is "
            "not current, so a bumped shell cannot be served stale.",
            "`data-src` on every diagram plus a heal pass: a re-render never "
            "feeds Mermaid its own CSS, and a font race cannot leave a "
            "half-drawn figure.",
            "A deterministic fallback wherever a model could fail, so the tool "
            "still answers when the network or the backend does not.",
            "The perf budget is read from the worker's recorded sizes at "
            "runtime — measured, not asserted.",
        ],
        "glance": [
            ["Thesis", "deterministic enforcement outside the model, applied to the tool itself"],
            ["Build", "none — plain files, no bundler, no framework"],
            ["Gate", "lint · node:test · headless smoke · CI"],
            ["Data", "plain versioned JSON; no hidden defaults"],
            ["Namespace", "one global namespace, `typeof`-guarded edges"],
            ["Diagrams", "vendored Mermaid, strict mode, one sequential queue"],
            ["Failure policy", "degrade and skeleton, never blank"],
            ["Budget", "first load ~1.37 MB (~4.9 MB raw); repeat ~0.02 MB"],
        ],
        "takeaways": [
            "The catalog's thesis — deterministic enforcement outside the model "
            "— is applied to the tool itself, not just to the agents it "
            "describes.",
            "A gate is not a build step: lint, tests and a smoke test catch "
            "what a compiler would, without producing a bundle.",
            "Serialising the diagram queue is a correctness requirement of the "
            "engine, and the fallback ladder keeps it offline-safe.",
            "Degradation is designed: skeletons, guards and deterministic "
            "fallbacks mean a failure narrows the app instead of blanking it.",
            "Print the measurement. If a performance or offline claim cannot be "
            "read off the running tool, it is marketing.",
        ],
        "refs": [
            "`design/08-runtime-offline.md` — the namespace, the boot phases, "
            "the queue, the worker and the gate.",
            "`design/06-threat-model.md` — the threat model these constraints "
            "are answers to.",
            "`README.md` — testing, offline behaviour and the published perf "
            "budget.",
            "`tools/gen_cascades.py` and `tools/gen_coverage.py` — the "
            "deterministic generators behind the derived datasets.",
        ],
        "conclusion": [
            "Principles are only worth writing down if you can point at where "
            "they are enforced, and each one here points at a file: a rule "
            "engine, a test, a queue, a version string, a printed budget. Take "
            "the list to your own system — it costs nothing to be deterministic "
            "outside the model, and everything to leave that part to the model.",
        ],
    },
    {
        "title": "Architecture",
        "covers": "How the pieces fit together at runtime",
        "overview": [
            "The deployed shape is static files plus one small server process: "
            "a delivery layer that serves and hardens those files, a shell that "
            "owns the tab switcher and its registries, {scripts} feature modules "
            "that register into it, five JSON datasets loaded in phases, "
            "{design_docs} markdown documents fetched live, a service worker "
            "that caches the shell, and an optional same-origin model proxy.",
            "Nothing is compiled, so the architecture you read in the source is "
            "the architecture that runs: no bundle to unwind, no generated code "
            "to trace back, and no build output that can drift away from the "
            "repository.",
        ],
        "why": [
            "Knowing which layer a control lives in is how you change it "
            "safely. A header belongs to the delivery layer, a rule to an "
            "engine, a record to the data layer and a cache to the worker — "
            "naming the layer is what stops a fix in one place becoming a bug "
            "in another.",
            "It also explains the deployment story. The image copies exactly "
            "what the server serves, the compose file adds privilege "
            "restrictions rather than behaviour, and any other static host can "
            "serve the same files, because nothing has to be generated first.",
        ],
        "how": [
            "**Delivery.** `serve.py` serves the files with gzip, conditional "
            "revalidation for a cheap 304, immutable caching for the vendored "
            "engine, and the same header block on every single response.",
            "**Shell.** `index.html` and `js/app.js` own the tab switcher, "
            "theme, data load, Mermaid queue, zoom viewer and the registries "
            "every module plugs into.",
            "**Feature modules.** {scripts} plain scripts: one per pane — "
            "overview, catalog, scenarios, cascades, coverage, deployment "
            "planner, blueprints, copilot, live view, design, guardrail lab and "
            "discovery — plus the shared playback widget, LLM client, grounding "
            "context, report, dashboard, help, command palette and shortcuts.",
            "**Data.** Five JSON datasets. Phase one (patterns, scenarios, "
            "traces, coverage) is awaited for first paint; `cascades.json` "
            "streams in beside it and is awaited only by the panes that read "
            "it.",
            "**Documents.** `design/*.md` — {design_docs} of them — are fetched "
            "live and rendered, which is the one reason a server is needed at "
            "all beyond hosting the optional model proxy.",
            "**Offline.** `sw.js` precaches {precache} entries, answers "
            "same-origin GETs network-first with a cache fallback, and never "
            "touches `/api/*`.",
            "**Model.** `/api/llm/*` relays to a configured backend in "
            "failover order with watchdog timeouts, streaming the reply back "
            "chunked so the interface can render it as it arrives.",
        ],
        "components": (
            "table",
            ["Layer", "Files", "Responsibility"],
            [
                ["Delivery", "`serve.py`", "Static host: gzip, ETag and Last-Modified revalidation, immutable vendor cache, security headers, CSP."],
                ["Shell", "`index.html` · `js/app.js`", "Tab switcher, theme, data load, Mermaid queue, zoom viewer, `tabLoaders` and `PANE_INIT` registries."],
                ["Feature modules", "`js/*.js` — {scripts} files", "One per pane — overview, catalog, scenarios, cascades, coverage, planner, blueprints, copilot, live view, design, guardrail lab, discovery — plus the shared player, LLM client, context, report, dashboard, help, palette and shortcuts."],
                ["Data", "`data/*.json` — 5 datasets", "Patterns, scenarios, cascades, traces and coverage; plain, versioned, diffable."],
                ["Documents", "`design/*.md` — {design_docs} docs", "Architecture documents fetched at view time and rendered with live Mermaid."],
                ["Offline", "`sw.js`", "{precache} precache entries; network-first with cache fallback; `/api/*` exempt."],
                ["Model", "`serve.py` → `/api/llm/*`", "Same-origin proxy: failover list, watchdogs, chunked relay, deterministic fallback."],
            ],
        ),
        "figures": [
            ("Component Diagram", "design/02-uml.md", "Component diagram",
             "Presentation, engine and data layers: every pane is a view over an engine, and every engine reads the same five datasets."),
            ("Phased Boot", "design/08-runtime-offline.md",
             "Phased boot: first paint never waits for the whole catalog",
             "Phased boot: paint what the first screen reads, stream the largest dataset beside it, and let any pane jump the idle queue instead of waiting."),
        ],
        "risks": [
            "One small threaded server is sized for a team, not for the "
            "internet: there is no authentication anywhere in it, and it does "
            "not pretend otherwise.",
            "The Design pane needs an HTTP origin, because `file://` blocks "
            "its fetch — so even a bare static host is required for that pane, "
            "however the rest of the app is deployed.",
            "State lives in each browser's `localStorage` rather than in a "
            "database: no multi-user sync, and a fresh profile starts from "
            "nothing.",
            "Modules share one global namespace, so an accidental "
            "redefinition is possible; the lint configuration is the guard "
            "(chapter 110).",
            "The corpus is loaded rather than paged: five datasets and "
            "{design_docs} documents sit in memory together, which is right at "
            "catalog scale and a limit well before it.",
        ],
        "safeguards": [
            "One header block for every response — `nosniff`, "
            "`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and the "
            "content security policy — so a file added next month is hardened "
            "before anyone asks.",
            "Caching that cannot go stale silently: vendored assets are "
            "immutable, everything else revalidates with `If-Modified-Since`, "
            "and the worker drops old caches whenever `VERSION` moves.",
            "Blast radius inside the shell: a module that fails to register "
            "leaves a skeleton or a narrower pane, never a blank application, "
            "because every cross-module call is guarded.",
            "`/api/*` is excluded from the cache, so a model answer or a "
            "diagnostic beacon can never be replayed out of it.",
            "The image copies only what the server serves, and CI keeps the "
            "offline precache list in step with the files on disk.",
        ],
        "glance": [
            ["Delivery", "`serve.py` — gzip, 304 revalidation, immutable vendor"],
            ["Shell", "`index.html` + `js/app.js`, one global namespace"],
            ["Modules", "{scripts} scripts, one pane each, `typeof`-guarded"],
            ["Data", "5 JSON datasets, phased load with cascades deferred"],
            ["Documents", "{design_docs} `design/*.md`, fetched live"],
            ["Offline", "`sw.js`, {precache} entries, network-first"],
            ["Model", "`/api/llm/*` — failover, watchdogs, chunked relay"],
            ["Container", "python:3.12-slim, non-root, read-only, about 42 MB"],
            ["Health", "urllib healthcheck on `/`, 3s interval, 1s timeout"],
        ],
        "takeaways": [
            "Seven layers, one process, zero generated files: the source is the "
            "deployment.",
            "The delivery layer is where the headers, the compression and the "
            "cache policy live — hardening a response is one block of code, not "
            "a per-file decision.",
            "Phased loading is an architecture decision, not an optimisation: "
            "first paint waits for what the first screen reads and nothing "
            "more.",
            "The model sits behind the server, never beside the browser, which "
            "is what keeps the application one origin.",
            "Deployment modes differ in privilege, not in behaviour — the same "
            "files are served by a laptop, a container or a static host.",
        ],
        "refs": [
            "`design/01-system-context.md` — context and container overview, "
            "trust boundaries, deployment.",
            "`design/02-uml.md` — the component diagram and the classes behind "
            "each pane.",
            "`design/03-control-flow.md` — boot phases, data flow and the "
            "render queue.",
            "`design/08-runtime-offline.md` — delivery, offline shell and the "
            "perf budget.",
            "`Dockerfile`, `docker-compose.yml`, `.env.example` — the container "
            "and its configuration.",
        ],
        "conclusion": [
            "Architecture is the set of decisions that are expensive to change "
            "later, and this one is deliberately small: static files, one "
            "process, one origin, one queue, one worker. Everything else — the "
            "twelve panes, the engines, the lab — is replaceable detail built "
            "on top of it, which is the only kind of complexity a catalog tool "
            "should be allowed to carry.",
        ],
    },
    {
        "title": "Privacy: Local Models and Data That Stay Put",
        "covers": "Where your data goes, and where it does not",
        "overview": [
            "The privacy posture fits in one line from the README: *no data "
            "ever leaves your network for a third-party cloud*. It is enforced "
            "structurally rather than promised — the page can only reach its own "
            "origin, the model only reaches a backend you configured on your "
            "own network, and the things you build are kept in your browser.",
            "That matters more in this domain than most. A tool that holds your "
            "agent's architecture, your spend thresholds, your incident "
            "scenarios and your threat model is exactly the kind of thing you "
            "do not want phoning home before you have shipped anything.",
        ],
        "why": [
            "Agents touch money, personal data, health records and customer "
            "content; the design document you write for them is the map of "
            "where those things move. Publishing that map by using a design tool "
            "would be a leak on day one.",
            "A local model keeps the questions inside the boundary. Fox - "
            "Architect is grounded in the catalog and answered by a model on "
            "your own network, so asking how your spend guard should work does "
            "not become somebody else's telemetry.",
            "There is no account, no cloud store and no analytics vendor: "
            "there is no server-side copy of your work to breach, because there "
            "is no server-side copy.",
        ],
        "how": [
            "The browser talks to itself first. Every `fetch` and "
            "`XMLHttpRequest` the page's scripts make is bound by "
            "`connect-src 'self'`, so the network client in the page cannot "
            "open a connection to any origin but the one that served it.",
            "The proxy walks its backends in failover order. `/api/llm/chat` "
            "tries the primary backend on your tailnet first and the local one "
            "second (`LLM_PRIMARY` flips the order), with watchdogs of 5 seconds "
            "to connect, 60 to the first token, 45 of silence mid-answer and "
            "600 in total.",
            "The reply is relayed as it arrives, tagged with the backend that "
            "produced it. If neither backend answers, the proxy returns a "
            "normal response carrying `ok: false` and the reason, and the chat "
            "runs its deterministic catalog fallback instead of showing an "
            "error.",
            "What you save stays in `localStorage` on this origin — patterns, "
            "scenarios, blueprints, collections and preferences — with no sync "
            "and no background upload. Exports happen only when you ask for "
            "one.",
            "Diagnostics are small and server-side: the beacon accepts a "
            "short payload, truncates the message, kind, tab and user-agent "
            "fields before writing, logs at DEBUG to the server's own stderr, "
            "and is never served back to anyone.",
        ],
        "components": (
            "table",
            ["Path", "Where it lives", "Crosses the machine boundary?"],
            [
                ["Patterns, scenarios, cascades, traces, coverage", "`data/*.json` on the same origin", "No — fetched once, then from cache"],
                ["Design documents and diagrams", "`design/*.md`, rendered by the vendored engine", "No — CDN only if the vendored file is missing"],
                ["Collections, blueprints, plans, preferences", "`localStorage` on this origin", "No — browser-local until you export"],
                ["Model prompts and answers", "Browser → `/api/llm/*` → your backend", "Only to the backend you configured on your network"],
                ["Diagnostics beacon", "`/api/diag` → server stderr, DEBUG level", "To the same server; truncated before it is written"],
                ["Perf counters and session state", "Page memory", "No — printed in the Display panel, not sent"],
                ["Anything a third party could buy", "Nowhere — no account, no cloud, no analytics", "No"],
            ],
        ),
        "figures": [
            ("Where the Local Model Sits", "design/07-architect-analysis.md",
             "5. Where the local model sits",
             "The model sits behind the server: the browser posts to its own origin, the proxy fans out to backends on your network, and a deterministic answer is waiting if neither replies."),
        ],
        "risks": [
            "On your network is not the same as zero transmission. Prompts do "
            "leave the browser for the backend you configured — point "
            "`AXIOM_LLM_URL` or `FOX_LLM_URL` at a public API and the traffic "
            "follows them, because the browser's security policy governs the "
            "page, not the server's egress.",
            "The proxy has no authentication and no secrets, by design; its own "
            "documentation says so. Anyone who can reach the port can use "
            "whatever backend you pointed it at, which is why the stated scope "
            "is a LAN, a tailnet or a CIDR rather than the open internet.",
            "`localStorage` is plain, per-browser storage: a fresh profile has "
            "none of your collections, and clearing site data clears them. "
            "Export before you switch machines.",
            "The diagnostics beacon still carries your user agent and client "
            "IP into the server's log — server-side only, DEBUG level, but it "
            "is a log.",
            "Offline is earned after one visit, so a genuinely air-gapped host "
            "has to be seeded once before it can run with the network out.",
        ],
        "safeguards": [
            "The page's own reach is pinned by `connect-src 'self'`, "
            "`Referrer-Policy: no-referrer`, no third-party script beyond the "
            "documented Mermaid CDN fallback, and no analytics of any kind.",
            "The service worker never caches `/api/*`, so model calls and "
            "diagnostics always go to the network rather than being frozen into "
            "a cache someone could read later.",
            "Watchdogs bound a hung backend, and an upstream 5xx skips that "
            "backend for the next one in the failover list.",
            "The beacon is truncated at the source — message to 300 characters, "
            "kind and tab to 20, user-agent to 120 — before anything is "
            "written.",
            "No account and no cloud store means the only copies of your work "
            "are the one in your browser and whatever you exported.",
            "A model outage is not a tool outage: everything except the chat "
            "works with no backend at all.",
        ],
        "glance": [
            ["Page egress", "same origin only (`connect-src 'self'`)"],
            ["Model egress", "your network: primary backend, then fallback; `LLM_PRIMARY` flips"],
            ["Model", "Qwen 3.8-27B, optional; deterministic answer if it is down"],
            ["Saved work", "`localStorage`; exports are user-initiated"],
            ["Account / cloud", "none"],
            ["Analytics", "none — one truncated same-origin beacon, DEBUG to stderr"],
            ["Diagrams", "vendored Mermaid; CDN only as a documented fallback"],
            ["Retention", "no server-side store; clearing the profile clears the collections"],
            ["Scope", "LAN, tailnet or CIDR — not published to the internet"],
        ],
        "takeaways": [
            "Privacy here is structural: one origin, one optional proxy, one "
            "local model — not a policy page.",
            "Prompts and answers do travel, and they travel only to a backend "
            "you chose on a network you own.",
            "Your artifacts never leave the browser unless you export them, and "
            "there is no account that could hold a copy.",
            "The honest limitations are real: no proxy authentication, plain "
            "browser storage, and a log line for the beacon.",
            "Point the backend URLs somewhere public and the guarantees move "
            "with them — the boundary is where you put it.",
        ],
        "refs": [
            "`README.md` — the no-third-party-cloud claim and the deployment "
            "scopes.",
            "`serve.py` — the proxy, the failover order, the watchdogs and the "
            "truncating diagnostics handler.",
            "`design/05-data-model.md` — retention and privacy: what is stored, "
            "where, and what leaves.",
            "`design/07-architect-analysis.md` — where the local model sits in "
            "the architecture.",
            "`design/06-threat-model.md` — the STRIDE table this posture "
            "answers.",
            "`.env.example` — the backend URLs and watchdog timeouts you can "
            "change.",
        ],
        "conclusion": [
            "Privacy in a tool like this is a topology, not a promise: one "
            "origin the page cannot leave, one proxy that only knows backends "
            "you configured, one browser profile that holds your work, and a "
            "deterministic answer waiting when the model is not there. Know the "
            "three places data can move — browser to origin, server to backend, "
            "browser to export — and you know exactly what this application can "
            "and cannot leak.",
        ],
    },
    {
        "title": "Isolation, Hardening and Offline Operation",
        "covers": "Boundaries, container hardening and the offline shell",
        "overview": [
            "Isolation here means four different things at once: the browser "
            "from the page's own content, the process from its host, the "
            "service from the network, and the application from the clock — the "
            "last one being offline operation, which is what makes an air-gap "
            "deployment real instead of aspirational.",
            "Each has a control you can read in a file: a header block in the "
            "server, a Dockerfile, a compose file, and a service worker. None of "
            "them requires trusting the model, the vendor or each other.",
        ],
        "why": [
            "A static shell plus one small server is a small surface, but only "
            "if it is a bounded one. Small surfaces that listen on a port still "
            "need to say who may talk to them and what they may do.",
            "This application holds your threat model and your spend "
            "thresholds. Neither should be one missing escape or one open port "
            "away from being readable by something you did not invite.",
            "And a LAN or air-gapped deployment is only honest if it keeps "
            "working with the cable out — otherwise the offline claim is a "
            "screenshot, not a capability.",
        ],
        "how": [
            "**In the browser.** Every response carries the same hardening — "
            "`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` "
            "and a content security policy with `frame-ancestors 'none'` — and "
            "the server declines to advertise its version. User text is escaped "
            "before it is rendered, and Mermaid runs in strict mode.",
            "**In the container.** The image is a slim Python base with only "
            "the served files copied in, running as a non-root uid with a "
            "nologin shell; compose runs it with a read-only root filesystem, "
            "`cap_drop: ALL`, `no-new-privileges`, a tmpfs for `/tmp`, and a "
            "health check that re-requests `/` on a short interval.",
            "**On the network.** The service is published on an address you "
            "choose — your LAN, your tailnet, a CIDR — and the dedicated "
            "Tailscale variant shares the container's network namespace so "
            "`tailscale serve` fronts the loopback port and nothing else is "
            "exposed.",
            "**In time.** After one visit the service worker has precached the "
            "shell, so same-origin requests are answered network-first with a "
            "cache fallback and the offline chip reads *Offline · cached*. A "
            "`VERSION` bump drops the old caches so clients re-precache instead "
            "of running a stale shell.",
        ],
        "components": (
            "table",
            ["Axis", "Control", "What it buys you"],
            [
                ["Content", "Escaped user text; Mermaid `securityLevel: 'strict'`", "Answers and markdown are data, never code"],
                ["Headers", "`nosniff` · `DENY` · `no-referrer` · `frame-ancestors 'none'`", "No sniffing, no framing, no referrer leak"],
                ["Fingerprint", "Fixed server token, system version suppressed", "The server does not advertise what it is"],
                ["Identity", "Non-root uid with a nologin shell; only served files copied in", "A compromised request runs as nothing useful"],
                ["Privilege", "Read-only rootfs · `cap_drop: ALL` · `no-new-privileges` · tmpfs `/tmp`", "The process cannot write, escalate or hold a capability"],
                ["Exposure", "Published on your LAN, tailnet or CIDR; loopback behind `tailscale serve`", "The port exists exactly where you put it"],
                ["Model path", "Same-origin proxy, no secrets, `/api/*` never cached, watchdogs, truncated beacon", "The one outbound path is bounded and auditable"],
                ["Time", "`sw.js` precaches {precache} entries; network-first; `VERSION` invalidation", "After one visit, no network is needed"],
            ],
        ),
        "figures": [
            ("The App's Own Threat Model", "design/06-threat-model.md",
             "The app's own threat model (short)",
             "The web threats this dashboard faces and the control that answers each: strict content policy, escaped rendering, hardened headers, a worker that caches only the shell, and a same-origin proxy."),
            ("The Offline Shell", "design/08-runtime-offline.md",
             "Offline app shell (service worker)",
             "Install precaches the shell, activate drops older versions, and fetch answers same-origin GETs network-first — never touching the model proxy or the diagnostics beacon."),
        ],
        "risks": [
            "The content security policy keeps `'unsafe-inline'` for scripts "
            "and styles because the shell is inline-handler heavy. It is a "
            "backstop against third-party script, not a sandbox against inline "
            "handlers.",
            "Nothing in the deployment authenticates a user. Whoever can reach "
            "the port can read the catalog and use the proxy — the trust "
            "boundary is the network you published it on, and that is stated as "
            "scope rather than hidden behind a login.",
            "A precached shell is a stale shell until `VERSION` bumps; the "
            "worker's activation step exists precisely so that window cannot "
            "persist.",
            "A read-only root filesystem means the container keeps nothing: "
            "logs go to stderr, `/tmp` is a tmpfs, and anything you want to "
            "keep has to leave through an export.",
            "Offline state is per-browser. Clearing site data, opening a new "
            "profile or moving to another machine all cost one more visit.",
        ],
        "safeguards": [
            "Spoofing: answers are untrusted data, rendered as escaped text and "
            "markdown, never executed.",
            "Tampering: same-origin fetch, `nosniff`, `frame-ancestors 'none'`, "
            "and a pinned vendored Mermaid.",
            "Repudiation: the data is versioned in git, and exports are "
            "explicit and stamped.",
            "Information disclosure: `connect-src 'self'`, "
            "`Referrer-Policy: no-referrer`, and browser-local storage with "
            "nothing auto-sent.",
            "Denial of service: proxy watchdogs, `VERSION` invalidation and "
            "per-pane boot isolation so one stuck pane cannot stop the shell.",
            "Elevation of privilege: no in-app shell, a CSP that blocks "
            "third-party inline script, and strict Mermaid rendering.",
            "Container: non-root, read-only, capability-free, "
            "no-new-privileges, health-checked.",
        ],
        "glance": [
            ["Browser", "escaped text · strict Mermaid · hardened header set · no version leak"],
            ["Container", "slim image, non-root uid, read-only rootfs, `cap_drop: ALL`, health check"],
            ["Network", "LAN / tailnet / CIDR scope; loopback only behind `tailscale serve`"],
            ["Model path", "same-origin proxy, no secrets, `/api/*` never cached"],
            ["Offline", "{precache} precached entries, network-first with cache fallback"],
            ["Invalidation", "`VERSION` bump drops every older cache on activate"],
            ["Retention", "no server-side store; exports are how data leaves"],
            ["Scope", "a team tool on infrastructure you control — not an internet service"],
        ],
        "takeaways": [
            "Isolation is four boundaries — content, process, network and time "
            "— and each one is a control you can point at in a file.",
            "The hardening is the same on every response, so a new file cannot "
            "be served without it.",
            "A read-only, capability-free, non-root container turns the server "
            "from a foothold into a process with nowhere to go.",
            "Offline is a tested state, not a fallback: precache, network-first, "
            "and a version that invalidates stale shells.",
            "State the scope out loud. This is published on a network you "
            "control, and every control above assumes you meant to.",
        ],
        "refs": [
            "`design/06-threat-model.md` — the STRIDE table condensed above.",
            "`design/01-system-context.md` — trust boundaries and deployment.",
            "`design/08-runtime-offline.md` — the offline shell, delivery and "
            "header story.",
            "`Dockerfile` and `docker-compose.yml` — image hygiene, privilege "
            "drops and the health check.",
            "`docker-compose.tailscale.yml` — the dedicated tailnet node "
            "behind `tailscale serve`.",
            "`sw.js` — precache list, fetch strategy and `VERSION`.",
        ],
        "conclusion": [
            "None of these controls is exotic: a header block, a non-root user, "
            "a dropped capability set, a cache that knows its own version. What "
            "makes them worth writing down is that they are all that stands "
            "between a tool holding your threat model and a network that would "
            "read it — and that every one of them keeps working when the "
            "network itself is gone.",
        ],
    },
]


def design_figure(relpath, heading):
    """The first Mermaid block under `heading` in a design/*.md document.

    The app's Design tab renders these same files, so the book and the app
    always show one source. Failing loudly if a heading or its block moved
    keeps a figure from ever silently disappearing from a rebuilt edition.
    """
    src = (ROOT / relpath).read_text()
    m = re.search(rf"^#+\s+{re.escape(heading)}\s*$", src, re.M)
    if not m:
        sys.exit(f"build_book: {relpath}: no heading {heading!r}")
    rest = src[m.end():]
    nxt = re.search(r"^#+\s+", rest, re.M)
    if nxt:
        rest = rest[:nxt.start()]
    start = rest.find("```mermaid")
    end = rest.find("```", start + 10) if start >= 0 else -1
    if start < 0 or end < 0:
        sys.exit(f"build_book: {relpath}: no Mermaid block under {heading!r}")
    return rest[start + 10:end].strip("\n")


def book_stats(cat):
    """Every count Part X prose cites, computed from disk at build time.

    Placeholders in the chapter text (`{patterns}`, `{tabs}`, …) are filled
    from this dict by format_map(), which raises on a placeholder that has no
    value — so a stale number cannot be papered over, it fails the build.
    """
    scen, sev, by_dom = cat["scenarios"], defaultdict(int), defaultdict(int)
    for s in scen:
        sev[s["severity"]] += 1
        by_dom[s["domain"]] += 1
    traces = load_json("traces.json")
    traces = traces["traces"] if isinstance(traces, dict) else traces
    design = sorted((ROOT / "design").glob("*.md"))
    index_html = (ROOT / "index.html").read_text()
    sw = (ROOT / "sw.js").read_text()
    precache = re.search(r"const PRECACHE = \[(.*?)\];", sw, re.S).group(1)
    return {
        "patterns": len(cat["patterns"]),
        "categories": len(cat["parts"]),
        "failures": sum(len(p.get("failures", [])) for p in cat["patterns"]),
        "protections": sum(len(p.get("protections", [])) for p in cat["patterns"]),
        "scenarios": len(scen),
        "critical": sev["critical"],
        "high": sev["high"],
        "medium": sev["medium"],
        "domains": cat["coverage"]["totals"]["domains"],
        "budget_ok": sum(1 for v in by_dom.values() if v >= 2),
        "cascades": len(cat["cascades"]),
        "traces": len(traces),
        "glossary": len(cat["glossary"]),
        "tabs": len(set(re.findall(r'data-tab="([^"]+)"', index_html))),
        "scripts": len(list((ROOT / "js").glob("*.js"))),
        "design_docs": len(design),
        "mermaid_design": sum(len(re.findall(r"^```mermaid", d.read_text(), re.M)) for d in design),
        "precache": len(re.findall(r'"[^"]+"', precache)),
        "pattern_diagrams": sum(1 for p in cat["patterns"] if p.get("diagram")),
        "serve_lines": len((ROOT / "serve.py").read_text().splitlines()),
    }


def fmt(value, stats):
    """Recursively fill every `{placeholder}` in a chapter's data."""
    if isinstance(value, str):
        return value.format_map(stats)
    if isinstance(value, dict):
        return {k: fmt(v, stats) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return type(value)(fmt(v, stats) for v in value)
    return value


def write_app_part(doc, part, stats):
    """The closing part: same shape as write_part, catalog fields replaced."""
    doc.id_base = ""
    doc.chapter_break()
    doc.heading(1, f"Part {part['n']}: {part['name']}", cls="part")
    doc.p(part["desc"])
    for para in part["intro"]:
        doc.p(para.format_map(stats))
    doc.table(
        ["Chapter", "Chapter title", "Covers"],
        [[str(c["num"]), c["title"], c["covers"]] for c in part["contexts"]],
    )
    doc.mermaid(part["diagram"], f"The {part['name']} container overview.")


def write_app_chapter(doc, ctx, part, stats):
    ch = fmt(ctx["ch"], stats)
    num = ctx["num"]

    doc.chapter_break()
    doc.id_base = ""
    doc.heading(1, f"Chapter {num}: {ctx['title']}", cls="chapter")
    doc.id_base = slug(f"Chapter {num}: {ctx['title']}")
    doc.p(f"**Part {part['n']} — {part['name']}**")

    doc.heading(2, "Overview")
    for para in ch["overview"]:
        doc.p(para)

    doc.heading(2, "Why It Matters")
    for para in ch["why"]:
        doc.p(para)

    doc.heading(2, "How It Works")
    doc.ol(ch["how"])

    comp = ch["components"]
    doc.heading(2, "Components")
    if isinstance(comp, tuple):        # ("table", headers, rows)
        doc.table(comp[1], comp[2])
    else:                              # a plain bullet list
        doc.ul(comp)

    for heading, relpath, design_heading, caption in ch["figures"]:
        doc.heading(2, heading)
        doc.mermaid(design_figure(relpath, design_heading), caption)

    doc.heading(2, "Risks and Limitations")
    doc.ul(ch["risks"])

    doc.heading(2, "Safeguards")
    doc.ol(ch["safeguards"])

    doc.heading(2, "At a Glance")
    doc.table(["Field", "Value"], ch["glance"])

    doc.heading(2, "Key Takeaways")
    doc.ul(ch["takeaways"])

    doc.heading(2, "References")
    doc.ul(ch["refs"])

    doc.heading(2, "Conclusion")
    for para in ch["conclusion"]:
        doc.p(para)


def write_book(cat):
    doc = Doc()
    parts = cat["parts"]

    # assign chapters continuously across parts
    num = 0
    for part in parts:
        part["contexts"] = []
        for pattern in part["patterns"]:
            num += 1
            ctx = {
                "pattern": pattern,
                "title": pattern["name"],
                "num": num,
                "part": part,
                "scenarios": sorted(cat["scen_by_pat"].get(pattern["id"], []), key=lambda s: (SEV_ORDER.get(s["severity"], 9), s["title"])),
                "cascades": sorted(cat["casc_by_pat"].get(pattern["id"], []), key=lambda c: (SEV_ORDER.get(c.get("impact"), 9), c.get("name", ""))),
                "related": [cat["by_id"][r] for r in pattern.get("related", []) if r in cat["by_id"]],
                "diagram": pattern.get("diagram") or part["diagram"],
            }
            part["contexts"].append(ctx)

    total_chapters = num

    # ------------------------------------------------- Part X: the app itself
    stats = book_stats(cat)
    app_part = {
        "n": APP_PART_N,
        "name": APP_PART_NAME,
        "desc": APP_PART_DESC,
        "intro": APP_PART_INTRO,
        "diagram": design_figure("design/01-system-context.md", "Container overview"),
        "contexts": [
            {"num": num + i + 1, "title": ch["title"], "covers": ch["covers"], "ch": ch}
            for i, ch in enumerate(APP_CHAPTERS)
        ],
    }
    all_parts = parts + [app_part]
    total_chapters = num + len(app_part["contexts"])
    n_parts = len(all_parts)

    # ---------------------------------------------------------------- front
    doc.title_page(BOOK_TITLE, SUBTITLE, AUTHOR, EDITION)
    doc.p(
        f"*{BOOK_TITLE}* — {len(cat['patterns'])} design patterns, "
        f"{len(cat['cascades'])} composition cascades and "
        f"{len(cat['scenarios'])} failure scenarios, generated from the "
        "*AI Agent Patterns & Guardrails* catalog."
    )
    doc.p(
        "Pattern text, failure modes, protections, scenarios and cascades are the "
        "catalog's own records; the surrounding prose frames them. Diagrams are the "
        "catalog's Mermaid sources, rendered at build time."
    )

    doc.chapter_break()
    doc.heading(1, "Preface", cls="front")
    doc.p(
        "This book exists because the reference shelf for building AI agents and the "
        "reference shelf for breaking them are usually two different shelves. The "
        "first teaches you prompt chaining, routing, reflection, tool use, memory and "
        "multi-agent topologies. The second teaches you prompt injection, reward "
        "hacking, threshold splitting, approval fatigue and poisoned retrieval. An "
        "agent built from only the first shelf is a demo; an agent built from both is "
        "a system you can put in front of real money, real customers and real data."
    )
    doc.p(
        "So this book uses the same format for both. Every pattern carries its design "
        "— what it is, how it works, what it is built from — and then the same "
        "honest accounting of what it costs when it fails: the documented failure "
        "modes, the protection list, and the real scenarios and composition cascades "
        "the catalog has recorded against it. A pattern with no failure modes listed "
        "is not safer than the others; it is less studied."
    )
    doc.p(
        f"The material is the *AI Agent Patterns & Guardrails* catalog: "
        f"{len(cat['patterns'])} patterns across {len(parts)} parts, "
        f"{len(cat['scenarios'])} failure scenarios, and {len(cat['cascades'])} "
        "composition cascades, all of it inspectable, diffable and exportable. "
        "The book is generated from those files by a deterministic script, so it can "
        "never drift from the catalog it describes — update a protection in the "
        "catalog and the next edition carries it."
    )
    doc.p(f"— {AUTHOR}")

    doc.p(
        "The final part steps outside the catalog and into the application that "
        "publishes it: what the dashboard is for, how it carries a design "
        "workflow end to end, how it is put together, and what it does to keep "
        "your data, your diagrams and your model on hardware you control. It is "
        "written from the repository itself — README, design documents, server, "
        "worker and container files — for the same reason the pattern chapters "
        "are written from records: so that every claim can be checked against a "
        "file."
    )

    doc.chapter_break()
    doc.heading(1, "Acknowledgment", cls="front")
    doc.p(
        "The catalog behind this book was built in the open, one entry at a time, "
        "with a rule that every claim in it had to point at a record: a failure mode "
        "had to name what breaks, a protection had to name where it is enforced, and "
        "a cascade had to name the boundary it crosses. Thank you to everyone who "
        "reviewed an entry and asked which layer does that. This book is the receipt."
    )

    doc.chapter_break()
    doc.heading(1, "Introduction", cls="front")
    doc.p(
        "AI agents are programs that decide their own steps. That single property is "
        "why the design vocabulary below exists: once a system chooses its own "
        "actions, you cannot enumerate its behavior in advance, so you have to design "
        "its boundaries instead."
    )
    doc.p(
        "The book is organized as "
        f"{total_chapters} chapters across {n_parts} parts — "
        f"{total_chapters - len(app_part['contexts'])} of them, one per catalog "
        f"pattern, across {len(parts)} parts, then {len(app_part['contexts'])} "
        "chapters on the application that publishes the catalog. Each of the "
        f"first {len(parts)} parts is one category of the catalog:"
    )
    doc.table(
        ["Part", "Category", "Chapters", "What it covers"],
        [
            [part["n"], part["name"], str(len(part["patterns"])), part["desc"]]
            for part in parts
        ]
        + [[app_part["n"], app_part["name"], str(len(app_part["contexts"])), app_part["desc"]]],
    )
    doc.p("**How to read a chapter.** Every chapter follows the same shape:")
    doc.ul([
        "*Pattern Overview* — what the pattern is and where the catalog files it.",
        "*Practical Applications & Use Cases* — the domains it is tagged for, plus the scenarios and cascades recorded against it.",
        "*How It Works* and *Components* — the design itself.",
        "*Control-Flow Diagram* — the catalog's Mermaid source, rendered.",
        "*Failure Modes and Risks* then *Protections* — the honest half.",
        "*At a Glance*, *Key Takeaways*, *References and Related Patterns*, *Conclusion*.",
    ])
    doc.p(
        f"**Part {app_part['n']} uses the same order.** Its "
        f"{len(app_part['contexts'])} chapters open with *Overview* and *Why It "
        "Matters*, then *How It Works*, *Components*, the chapter's diagram, "
        "*Risks and Limitations*, *Safeguards*, *At a Glance*, *Key Takeaways*, "
        "*References* and *Conclusion* — the same shape, applied to the "
        "application instead of to a pattern."
    )
    doc.p(
        "**Severity.** Failure modes, scenarios and cascades carry one of four "
        "severity labels — critical, high, medium, low — used consistently across the "
        "catalog so a critical entry in one part means the same thing as a critical "
        "entry in another."
    )
    doc.p(
        "**Cascade classes.** Cascades are classified as inherent, emergent, derived "
        "or cascading; the definitions are in the glossary at the back, and they "
        "matter because each class is found by a different method and fixed by a "
        "different control."
    )
    doc.p(
        "**Everything here is inspectable.** Nothing in this book is a screenshot of "
        "an opinion. Each diagram is a Mermaid source file, each number is a count of "
        "records, and each protection names a layer where the control is enforced."
    )

    doc.chapter_break()
    doc.heading(1, 'What Makes an AI System an "Agent"?', cls="front")
    doc.p(
        "An AI system becomes an agent at the moment it chooses its own next action. "
        "A model that answers one question is a function; a model that decides which "
        "tool to call, reads the result, and decides whether to call another is a "
        "control loop — and a control loop is a thing that can fail in ways a "
        "function cannot."
    )
    doc.p(
        "The catalog frames that loop explicitly: a task and a budget go in, the "
        "context assembler pins the policy, the model proposes a structured action, a "
        "guardrail gateway decides whether it happens, and every iteration lands in an "
        "audit trail. The model proposes; the runtime disposes. That sentence is the "
        "thesis of this book."
    )
    doc.p(
        "Everything else in the catalog follows from it. Memory exists so the loop can "
        "carry state. Tools exist so the loop can touch the world. Multi-agent "
        "topologies exist so the loop can be split across roles. And every guardrail "
        "in the safety part exists because a loop you cannot bound is a loop that will "
        "eventually spend your money, send your data, or delete your database."
    )

    # ------------------------------------------------------------- contents
    doc.pagebreak()
    doc.heading(1, "Contents")

    toc_targets = []

    def toc_line(label, target):
        """One contents line: label, dotted leader, right-aligned page number.

        `data-pg` carries the anchor id and is filled with the real page number
        during the second rendering pass (tools/render_pdf.mjs) — Chrome has no
        `target-counter`, so a page number can only be read back off a rendered
        PDF, never computed in the first pass.
        """
        toc_targets.append(target)
        doc.raw_html(
            f'<li><a href="#{target}"><span class="t">{esc(label)}</span>'
            f'<span class="dots"></span>'
            f'<span class="pg" data-pg="{target}">000</span></a></li>'
        )

    doc.raw_html('<nav class="toc">')
    doc.raw_html("<ul>")
    for label in FRONT_MATTER:
        toc_line(label, slug(label))
    doc.raw_html("</ul>")
    for part in all_parts:
        part_target = slug(f"Part {part['n']}: {part['name']}")
        toc_targets.append(part_target)
        doc.raw_html(
            f'<div class="toc-part"><a href="#{part_target}">'
            f'<span class="t">Part {part["n"]} — {esc(part["name"])}</span>'
            f'<span class="dots"></span>'
            f'<span class="pg" data-pg="{part_target}">000</span></a></div>'
        )
        doc.raw_html("<ul>")
        for ctx in part["contexts"]:
            toc_line(
                f"Chapter {ctx['num']} · {ctx['title']}",
                slug(f"Chapter {ctx['num']}: {ctx['title']}"),
            )
        doc.raw_html("</ul>")
    doc.raw_html("<ul>")
    for label in BACK_MATTER:
        toc_line(label, slug(label))
    doc.raw_html("</ul>")
    doc.raw_html("</nav>")

    doc.m("**Contents**")
    doc.m()
    doc.m("\n".join(f"- {t}" for t in FRONT_MATTER))
    doc.m()
    for part in all_parts:
        doc.m(f"**Part {part['n']} — {part['name']}**")
        doc.m()
        doc.m("\n".join(f"- Chapter {c['num']}: {c['title']}" for c in part["contexts"]))
        doc.m()
    doc.m("\n".join(f"- {t}" for t in BACK_MATTER))
    doc.m()

    # --------------------------------------------------------------- parts
    for part in parts:
        write_part(doc, part, cat)
        for ctx in part["contexts"]:
            write_chapter(doc, ctx, cat)

    # ------------------------------------------- Part X: the application
    write_app_part(doc, app_part, stats)
    for ctx in app_part["contexts"]:
        write_app_chapter(doc, ctx, app_part, stats)

    # ------------------------------------------------------------- back matter
    doc.id_base = ""
    doc.pagebreak()
    doc.heading(1, "Glossary")
    doc.p(
        f"The {len(cat['glossary'])} terms below are the app's own glossary — the "
        "vocabulary the catalog uses consistently across patterns, scenarios and "
        "cascades."
    )
    doc.table(
        ["Term", "Definition"],
        [[t, d] for t, d in sorted(cat["glossary"], key=lambda x: x[0].lower())],
    )

    doc.pagebreak()
    doc.heading(1, "Index of Terms")
    doc.p(f"All {len(cat['patterns'])} patterns, alphabetical, with chapter numbers.")
    rows = []
    for part in parts:
        for ctx in part["contexts"]:
            rows.append((ctx["pattern"]["name"], ctx["num"], part["name"]))
    doc.table(
        ["Pattern", "Chapter", "Part"],
        [[name, str(n), part] for name, n, part in sorted(rows, key=lambda r: r[0].lower())],
    )

    doc.pagebreak()
    doc.heading(1, "Conclusion")
    doc.p(
        "The catalog this book was generated from is deliberately unfinished. "
        f"{len(cat['scenarios'])} scenarios and {len(cat['cascades'])} cascades are "
        "recorded today; the coverage gap is published rather than hidden, because a "
        "gap you can see is a backlog and a gap you cannot see is a surprise."
    )
    doc.p(
        "Three habits are worth taking from the chapters above. Name the layer where "
        "each control is enforced, because a control with no enforcement point is a "
        "suggestion. Write the failure mode before the feature, because the "
        "protection list that follows it is usually the more useful half. And treat "
        "composition as a first class risk: most of what goes wrong in agent systems "
        "is not a single broken part but two correct parts that interact."
    )
    doc.p(
        "The rest of the shelf keeps moving — new patterns, new attack chains, new "
        "cascades. This book is a snapshot of a catalog that is meant to be read in "
        "its live form too, where every diagram above is a running page you can "
        "filter, replay and export."
    )

    doc.pagebreak()
    doc.heading(1, "Colophon")
    doc.p(
        f"*{BOOK_TITLE}* was written and compiled from study and experiment "
        f"observation notes of {AUTHOR} and generated by the *AI Agent Patterns "
        "& Guardrails* catalog by a deterministic script "
        "(`tools/build_book.py`), then typeset to PDF with headless Chrome and "
        "the vendored Mermaid engine (`tools/render_pdf.mjs`) — the same "
        "Mermaid that renders the diagrams in the app, so no diagram in this "
        "book was drawn by hand or screenshotted."
    )
    doc.p(
        f"Catalog revision: {cat['coverage']['totals']['patterns']} patterns · "
        f"{cat['coverage']['totals']['scenarios']} scenarios · "
        f"{cat['coverage']['totals']['cascades']} cascades · "
        f"{cat['coverage']['totals']['domains']} domains. Edition: {EDITION}."
    )
    doc.p(f"© {AUTHOR}. Generated artifact — regenerate with `npm run book`.")

    # Contents links must each resolve to exactly one heading (see FRONT_MATTER).
    rendered = "".join(doc.html)
    for target in toc_targets:
        n = rendered.count(f'id="{target}"')
        if n != 1:
            sys.exit(
                f"tools/build_book.py: Contents target #{target} matches {n} headings "
                "in the generated HTML (expected exactly 1)"
            )

    return doc, total_chapters, n_parts


# --------------------------------------------------------------------------- #
#  HTML shell
# --------------------------------------------------------------------------- #

CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  font-family: Georgia, "Times New Roman", serif;
  color: #1a1a1a; font-size: 10.5pt; line-height: 1.55; margin: 0;
}
h1, h2, h3 { font-family: "Helvetica Neue", Arial, sans-serif; color: #0b2545; }
h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 10pt; }
h2 { font-size: 13.5pt; margin: 18pt 0 6pt; border-bottom: 1px solid #d8dee6; padding-bottom: 3pt; }
h3 { font-size: 11.5pt; margin: 14pt 0 4pt; }
p { margin: 0 0 8pt; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 9pt 16pt; padding-left: 8pt; }
li { margin-bottom: 3pt; }
code { font-family: Menlo, Consolas, monospace; font-size: 9pt; background: #f2f4f7; padding: 0 2px; border-radius: 2px; }
blockquote { margin: 8pt 0; padding: 6pt 10pt; border-left: 3px solid #0b2545; background: #f6f8fa; font-size: 10pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.2pt; }
th, td { border: 1px solid #ccd4dd; padding: 3.5pt 5pt; text-align: left; vertical-align: top; }
th { background: #eef2f6; font-family: "Helvetica Neue", Arial, sans-serif; font-size: 8.6pt; text-transform: uppercase; letter-spacing: .02em; }
figure.diagram { margin: 8pt 0 12pt; page-break-inside: avoid; text-align: center; }
figure.diagram svg { max-width: 100%; height: auto; }
figcaption { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 8.4pt; color: #55606c; margin-top: 4pt; }
.pb { page-break-after: always; break-after: page; height: 0; }
h1.chapter, h1.part, h1.front { page-break-before: always; break-before: page; }
h1.chapter + .pb { display: none; }
.titlepage { text-align: center; padding-top: 22%; page-break-after: always; break-after: page; }
.titlepage h1 { font-size: 30pt; color: #0b2545; margin-bottom: 12pt; }
.tp-rule { width: 120px; height: 2px; background: #0b2545; margin: 0 auto 26pt; }
.tp-sub { font-size: 13pt; font-style: italic; color: #33404d; margin-bottom: 30pt; }
.tp-author { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 14pt; letter-spacing: .06em; text-transform: uppercase; margin-bottom: 6pt; }
.tp-ed { font-size: 9.5pt; color: #55606c; }
.toc { page-break-after: always; break-after: page; }
.toc-part { font-family: "Helvetica Neue", Arial, sans-serif; font-weight: 700; margin: 12pt 0 4pt; color: #0b2545; }
.toc ul { list-style: none; margin: 0 0 6pt 0; }
.toc li { margin: 1.5pt 0; font-size: 9.6pt; }
.toc a { display: flex; align-items: baseline; text-decoration: none; color: inherit; }
.toc li a { color: #1a1a1a; }
.toc-part a { color: #0b2545; }
.toc .t { flex: 0 1 auto; }
.toc .dots { flex: 1 1 8pt; min-width: 8pt; border-bottom: .7pt dotted #9aa3ad; margin: 0 4pt; }
.toc .pg { flex: 0 0 auto; min-width: 2.6em; text-align: right;
           font-variant-numeric: tabular-nums; color: #55606c; }
"""

HTML_SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
{body}
</body>
</html>
"""


def main():
    cat = load_catalog()
    doc, total_chapters, n_parts = write_book(cat)

    BOOK_DIR.mkdir(exist_ok=True)
    MD_OUT.write_text(doc.render())
    HTML_OUT.write_text(
        HTML_SHELL.format(title=esc(BOOK_TITLE), css=CSS, body="\n".join(doc.html))
    )

    md = doc.render()
    print(f"wrote {MD_OUT.relative_to(ROOT)}  ({len(md.splitlines())} lines)")
    print(f"wrote {HTML_OUT.relative_to(ROOT)}  ({len(doc.html)} blocks)")
    print(
        f"book: {total_chapters} chapters, {n_parts} parts, "
        f"{md.count('```mermaid')} diagrams in {len(doc.html)} blocks"
    )


if __name__ == "__main__":
    main()
