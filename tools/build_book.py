#!/usr/bin/env python3
"""Build the book *Agentic Design Patterns & Guardrails* from the catalog.

Deterministic and dependency-free (stdlib only). It reads the same JSON the app
ships (`data/*.json`) plus the glossary in `js/help.js`, and emits:

    book/AGENTIC-PATTERNS-AND-GUARDRAILS.md    book-structured Markdown
    book/agent-patterns-and-guardrails.html    self-contained print HTML

`tools/render_pdf.mjs` then turns the HTML into a PDF with headless Chrome,
rendering every Mermaid block to a real SVG with the vendored Mermaid (so the
book's diagrams are identical to the app's, and the build stays air-gap safe).

Every sentence in a chapter is either the catalog's own text or a sentence built
from catalog fields — nothing is invented about a pattern.
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

    # -- primitives -------------------------------------------------------- #
    def m(self, text=""):
        self.md.append(text)

    def h(self, text):
        self.html.append(text)

    def heading(self, level, text, cls=""):
        aid = slug(text)
        self.m("#" * level + " " + text)
        self.m()
        self.h(f'<h{level} id="{aid}" class="{cls}">{inline_html(text)}</h{level}>')

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
    doc.heading(1, f"Chapter {num}: {p['name']}", cls="chapter")
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
    cap = (
        f"{p['name']} — control flow as rendered by the catalog."
        if has_own
        else f"{p['name']} uses its part's control-flow diagram ({part['name']}): "
        "the catalog ships an authored diagram for 32 of the 107 patterns, and "
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
                "num": num,
                "part": part,
                "scenarios": sorted(cat["scen_by_pat"].get(pattern["id"], []), key=lambda s: (SEV_ORDER.get(s["severity"], 9), s["title"])),
                "cascades": sorted(cat["casc_by_pat"].get(pattern["id"], []), key=lambda c: (SEV_ORDER.get(c.get("impact"), 9), c.get("name", ""))),
                "related": [cat["by_id"][r] for r in pattern.get("related", []) if r in cat["by_id"]],
                "diagram": pattern.get("diagram") or part["diagram"],
            }
            part["contexts"].append(ctx)

    total_chapters = num

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
        f"{total_chapters} chapters across {len(parts)} parts, one chapter per "
        "catalog pattern. Each part is one category of the catalog:"
    )
    doc.table(
        ["Part", "Category", "Patterns", "What it covers"],
        [
            [part["n"], part["name"], str(len(part["patterns"])), part["desc"]]
            for part in parts
        ],
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
    doc.raw_html('<nav class="toc">')
    for part in parts:
        doc.raw_html(f'<div class="toc-part">Part {part["n"]} — {esc(part["name"])}</div>')
        doc.raw_html("<ul>")
        for ctx in part["contexts"]:
            doc.raw_html(
                f'<li><a class="toc-ch" href="#chapter-{ctx["num"]}-{slug(ctx["pattern"]["name"])}">'
                f'Chapter {ctx["num"]} &middot; {esc(ctx["pattern"]["name"])}</a></li>'
            )
        doc.raw_html("</ul>")
    doc.raw_html("</nav>")
    doc.m("**Contents**")
    doc.m()
    for part in parts:
        doc.m(f"**Part {part['n']} — {part['name']}**")
        doc.m()
        doc.m("\n".join(f"- Chapter {c['num']}: {c['pattern']['name']}" for c in part["contexts"]))
        doc.m()
    doc.m("Glossary · Index of Terms · Conclusion · Colophon")
    doc.m()

    # --------------------------------------------------------------- parts
    for part in parts:
        write_part(doc, part, cat)
        for ctx in part["contexts"]:
            write_chapter(doc, ctx, cat)

    # ------------------------------------------------------------- back matter
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
    doc.p(f"All {total_chapters} patterns, alphabetical, with chapter numbers.")
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
        f"*{BOOK_TITLE}* was written by {AUTHOR} and generated from the *AI Agent "
        "Patterns & Guardrails* catalog by a deterministic script "
        "(`tools/build_book.py`), then typeset to PDF with headless Chrome and the "
        "vendored Mermaid engine (`tools/render_pdf.mjs`) — the same Mermaid that "
        "renders the diagrams in the app, so no diagram in this book was drawn by "
        "hand or screenshotted."
    )
    doc.p(
        f"Catalog revision: {cat['coverage']['totals']['patterns']} patterns · "
        f"{cat['coverage']['totals']['scenarios']} scenarios · "
        f"{cat['coverage']['totals']['cascades']} cascades · "
        f"{cat['coverage']['totals']['domains']} domains. Edition: {EDITION}."
    )
    doc.p(f"© {AUTHOR}. Generated artifact — regenerate with `npm run book`.")

    return doc, total_chapters


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
.toc a { color: #1a1a1a; text-decoration: none; }
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
    doc, total_chapters = write_book(cat)

    BOOK_DIR.mkdir(exist_ok=True)
    MD_OUT.write_text(doc.render())
    HTML_OUT.write_text(
        HTML_SHELL.format(title=esc(BOOK_TITLE), css=CSS, body="\n".join(doc.html))
    )

    md = doc.render()
    print(f"wrote {MD_OUT.relative_to(ROOT)}  ({len(md.splitlines())} lines)")
    print(f"wrote {HTML_OUT.relative_to(ROOT)}  ({len(doc.html)} blocks)")
    print(
        f"book: {total_chapters} chapters, {len(cat['parts'])} parts, "
        f"{len(doc.html)} diagrams: {md.count('```mermaid')}"
    )


if __name__ == "__main__":
    main()
