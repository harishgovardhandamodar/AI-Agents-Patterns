#!/usr/bin/env python3
"""Post-passes on the rendered book PDF (the one headless Chrome produced).

    tools/book_pdf.py dests   <book.pdf>                JSON on stdout
    tools/book_pdf.py outline <book.pdf> <spec.json>    rewrites <book.pdf>

Chrome gives us the Contents *links* but never the page *numbers*: it does not
implement CSS `target-counter`, and `page.pdf()` has no way to ask "which page
did #anchor land on". It does, however, emit a `/Dests` name tree with one
entry per in-document link — so `dests` reads that tree and reports the 1-based
page every Contents entry points at. `tools/render_pdf.mjs` calls it after a
first rendering pass, fills the numbers in, renders again, and calls it once
more to prove the printed numbers still match where the links actually go.

`dests` also reports the link-annotation and outline counts, so the same call
doubles as the post-condition check: after `outline` rewrites the file, the
renderer re-runs `dests` and fails the build if the rewrite dropped a link, a
destination or a bookmark.

`outline` builds the PDF sidebar bookmarks — `page.pdf()` never emits an
outline at all, and that sidebar is how most readers navigate a book.

Requires pypdf (the only non-stdlib dependency in the book pipeline):

    python3 -m pip install --user pypdf
"""
import json
import sys
from pathlib import Path

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject
except ImportError:  # pragma: no cover - environment problem, not logic
    sys.exit(
        "tools/book_pdf.py needs pypdf to read page destinations.\n"
        "  python3 -m pip install --user pypdf"
    )


# --------------------------------------------------------------------------- #
#  reading
# --------------------------------------------------------------------------- #


def _dest_array(value):
    """The destination array for a /Dests entry, or None if unreadable."""
    value = value.get_object()
    if isinstance(value, DictionaryObject) and "/D" in value:  # explicit dest
        value = value["/D"].get_object()
    return value if isinstance(value, ArrayObject) else None


def _count_outline(items):
    n = 0
    for item in items or []:
        n += _count_outline(item) if isinstance(item, list) else 1
    return n


def read_book(path):
    """Destinations, link annotations and outline items of one PDF."""
    reader = PdfReader(path)
    page_of = {}
    for i, page in enumerate(reader.pages):
        ref = page.indirect_reference
        if ref is not None:
            page_of[ref] = i

    dests = {}
    root = reader.trailer.get("/Root", {})
    tree = root.get("/Dests")
    if tree is not None:
        for name, value in tree.get_object().items():
            arr = _dest_array(value)
            if not arr or not arr:
                continue
            target = arr[0]
            if not isinstance(target, IndirectObject):
                continue
            index = page_of.get(target)
            if index is not None:
                # Key is a NameObject like "/chapter-1-..."; the renderer wants
                # it without the slash so it can match the element's data-pg.
                dests[str(name).lstrip("/")] = index + 1  # 1-based, as printed

    links = 0
    for page in reader.pages:
        for annot in page.get("/Annots") or []:
            obj = annot.get_object()
            if str(obj.get("/Subtype")) == "/Link":
                links += 1

    try:
        outline = _count_outline(reader.outline)
    except Exception:  # no /Outlines at all, or an unreadable one
        outline = 0

    return {"dests": dests, "links": links, "outline": outline, "pages": len(reader.pages)}


def cmd_dests(path):
    print(json.dumps(read_book(path), sort_keys=True))


# --------------------------------------------------------------------------- #
#  writing
# --------------------------------------------------------------------------- #


def cmd_outline(path, spec_path):
    """Add sidebar bookmarks from a spec: [{title, page}, {title, page, children}]."""
    spec = json.loads(Path(spec_path).read_text())
    reader = PdfReader(path)
    writer = PdfWriter(clone_from=reader)

    added = 0
    for node in spec:
        parent = writer.add_outline_item(node["title"], node["page"] - 1)
        added += 1
        for child in node.get("children", []):
            writer.add_outline_item(child["title"], child["page"] - 1, parent=parent)
            added += 1

    tmp = Path(str(path) + ".tmp")
    with tmp.open("wb") as handle:
        writer.write(handle)
    tmp.replace(path)  # atomic, so a crash mid-write can't truncate the book
    print(f"outline: added {added} bookmarks to {Path(path).name}")


def main(argv):
    if len(argv) == 3 and argv[1] == "dests":
        cmd_dests(argv[2])
    elif len(argv) == 4 and argv[1] == "outline":
        cmd_outline(argv[2], argv[3])
    else:
        sys.exit(__doc__.strip().splitlines()[0] + "\nusage: book_pdf.py dests <pdf> | outline <pdf> <spec.json>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
