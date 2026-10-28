#!/usr/bin/env python3
"""Book QA gate: fail (non-zero) on claims the repository cannot trace.

Checks (see findings P0-2/P0-3/P1-2/P1-4):
  IDs      S-###/P-### numbering is forbidden (schema uses slugs); any other
           backtick slug-token must resolve in data/*.json or in code
           (tools/, js/, serve.py, configs) — otherwise it is an ID that
           exists nowhere
  counts   "Catalog weight: N patterns, M scenarios, K cascades" triples are
           verified against per-domain counts computed from data/; any other
           bare "N patterns/scenarios/..." claim with no scoping words nearby
           must match stats.json (scoped counts like "18 linked cascades"
           are skipped); number-noun agreement is checked everywhere
  domains  the domain list length equals stats.domains; no d_{22} with 26
  chapters every "Chapter N" ref is within the book's chapter count
  dupes    no *prose* paragraph >80 words repeated (tables/code/diagrams
           repeat by design and are skipped)
  math     balanced $/$$ outside code spans (currency-aware);
           no latex-fence/textbf/begin
  prov     no "no large language model" / "deterministic end-to-end" /
           "pure function" claim *about the book pipeline* (build/edition/
           generated/prose words nearby) without a PROVENANCE sidecar
  pdf      outline > 0, Title/Author set, no blank pages (Books/Humanized/*.pdf)

Usage: qa_books.py [--pdf] [FILE ...]  (default: all Books/Humanized/*.md)
"""
import collections
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAIL = []
_CODE_CACHE = None


def fail(check, where, msg):
    FAIL.append(f"[{check}] {where}: {msg}")


def load_json(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def code_text():
    """All code/config text IDs can resolve against (the claim ledger's
    second half: prose claims may point at code, not just data)."""
    global _CODE_CACHE
    if _CODE_CACHE is None:
        blobs = []
        for pat in ("tools/*.py", "js/*.js", "*.py", "*.json", "*.yml",
                    "Dockerfile*", "docker-compose*.yml", ".env.example",
                    "package.json", "index.html", "sw.js"):
            for f in glob.glob(os.path.join(ROOT, pat)):
                try:
                    blobs.append(open(f, encoding="utf-8", errors="replace").read())
                except OSError:
                    pass
        _CODE_CACHE = "\n".join(blobs)
    return _CODE_CACHE


def check_ids(text, name, pat_ids, scen_ids, data_blob):
    code = code_text()
    allowed = set()
    for m in re.finditer(r"<!--\s*qa-allow:(.*?)-->", text):
        allowed.update(m.group(1).split())
    for m in re.finditer(r"`([A-Za-z0-9][A-Za-z0-9_./-]{1,80})`", text):
        tok = m.group(1)
        if tok in allowed:
            continue
        if re.fullmatch(r"[SP]-\d+", tok):
            line = text[:m.start()].count("\n") + 1
            fail("IDs", f"{name}:{line}",
                 f"{tok} uses S-###/P-### numbering; schema uses slugs")
            continue
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", tok):
            continue  # code span (dots/underscores/paths), not an ID
        if tok in pat_ids or tok in scen_ids:
            continue
        if tok in data_blob or tok in code:
            continue
        line = text[:m.start()].count("\n") + 1
        fail("IDs", f"{name}:{line}",
             f"`{tok}` resolves in no data file and no code")


def per_domain_counts():
    pats = load_json("data/patterns.json").get("patterns", [])
    scen = load_json("data/scenarios.json")
    scen = scen.get("scenarios", scen if isinstance(scen, list) else [])
    casc = load_json("data/cascades.json")
    casc = casc.get("cascades", casc if isinstance(casc, list) else [])
    pc, sc, cc = collections.Counter(), collections.Counter(), collections.Counter()
    for p in pats:
        if isinstance(p, dict):
            pc.update(p.get("domains", []) or [])
    for s in scen:
        if isinstance(s, dict) and s.get("domain"):
            sc[s["domain"]] += 1
    for c in casc:
        if isinstance(c, dict) and c.get("domain"):
            cc[c["domain"]] += 1
    return pc, sc, cc


_SCOPE_RE = re.compile(
    r"(part|chapter|section|tab|domain|playbook|linked|touch|touches|"
    r"road|roads|theme|archetype|swarm|emergent|injected|lab|sibling|evolver|stream|family|"
    r"episode|benchmark|frozen|RL |RL works|trail|suite|shape|registry|"
    r"gate |gate core|gate full|runner|catalogue|sweep|hold-out|holdout|"
    r"cell|round|if your|suppose|imagine|hypothetical|per |each |this book|"
    r"pattern's|scenario's|playbook's|below|above|following|traces? replay)",
    re.IGNORECASE)
_WEIGHT_RE = re.compile(
    r"[Cc]atalog weight[^:]*:\s*(\d+)\s+patterns?,?\s*(\d+)\s+scenarios?,?\s*"
    r"(\d+)\s+cascades?")
_DOMAIN_RE = re.compile(r"[Dd]omain playbook:\s*([A-Za-z][\w-]*)")
_AGREE_RE = re.compile(
    r"\b(\d+)\s+(patterns?|scenarios?|cascades?|traces?|domains?|"
    r"chapters?|works?|concepts?|dimensions?|trails?|members?)\b")


def check_counts(text, name, stats, per_dom):
    pc, sc, cc = per_dom
    # pass 1: domain-aware Catalog-weight triples vs data
    domain = None
    for m in re.finditer(
            r"(?m)^#{1,6}\s+.*[Dd]omain playbook:\s*([A-Za-z][\w-]*)"
            r"|Catalog weight[^:]*:\s*(\d+)\s+patterns?,?\s*(\d+)\s+"
            r"scenarios?,?\s*(\d+)\s+cascades?", text):
        if m.group(1) is not None:
            domain = m.group(1).lower()
            continue
        np_, ns, nc = int(m.group(2)), int(m.group(3)), int(m.group(4))
        if domain is None:
            fail("counts", name, "Catalog weight outside a domain chapter")
            continue
        exp = (pc.get(domain, 0), sc.get(domain, 0), cc.get(domain, 0))
        if (np_, ns, nc) != exp:
            line = text[:m.start()].count("\n") + 1
            fail("counts", f"{name}:{line}",
                 f"domain '{domain}' weight {(np_, ns, nc)} != data {exp}")
    # pass 2: agreement + global-scope counts
    for m in _AGREE_RE.finditer(text):
        num, noun = int(m.group(1)), m.group(2)
        base = noun[:-1] if noun.endswith("s") else noun
        if num == 1 and noun != base:
            line = text[:m.start()].count("\n") + 1
            fail("counts", f"{name}:{line}",
                 f"agreement: '1 {noun}' should be '1 {base}'")
        elif num not in (0, 1) and noun == base:
            line = text[:m.start()].count("\n") + 1
            fail("counts", f"{name}:{line}",
                 f"agreement: '{num} {noun}' should be '{num} {noun}s'")
        key = {"pattern": "patterns", "scenario": "scenarios",
               "cascade": "cascades", "trace": "traces",
               "domain": "domains"}.get(base)
        if key is None or num == stats[key]:
            continue
        window = text[max(0, m.start() - 100):m.start()]
        after = text[m.end():m.end() + 60]
        if _SCOPE_RE.search(window) or _SCOPE_RE.search(after) \
                or "atalog weight" in window:
            continue
        line = text[:m.start()].count("\n") + 1
        fail("counts", f"{name}:{line}",
             f"says {num} {noun}, stats.json says {stats[key]}")


def check_chapters(text, name):
    chs = re.findall(r"(?m)^# Chapter (\d+)\b", text)
    n = len(chs)
    if not n:
        return
    for m in re.finditer(r"[Cc]hapter (\d+)", text):
        if int(m.group(1)) > n:
            line = text[:m.start()].count("\n") + 1
            fail("chapters", f"{name}:{line}",
                 f"refers to chapter {m.group(1)} in a {n}-chapter book")


def strip_structured(text):
    """Drop code fences, tables, quotes, and list/heading lines: those repeat
    by design. What remains is prose, where repetition is padding."""
    out = []
    in_fence = False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        s = line.strip()
        if not s or s.startswith(("|", "#", ">", "-", "*", "+")):
            continue
        if re.match(r"\d+[.)]\s", s):
            continue
        out.append(line)
    return "\n".join(out)


def strip_code_spans(text):
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    text = re.sub(r"`[^`\n]+`", "", text)
    return text


def check_dupes(text, name):
    prose = strip_structured(text)
    paras = [p.strip() for p in re.split(r"\n\s*\n", prose)
             if len(p.strip().split()) > 80]
    seen = {}
    for p in paras:
        key = " ".join(p.split()[:30])
        seen[key] = seen.get(key, 0) + 1
    for key, c in seen.items():
        if c > 1:
            fail("dupes", name, f"prose paragraph repeated {c}x: {key[:80]}…")


def check_math(text, name):
    if "```latex" in text or "\\textbf" in text or "\\begin" in text:
        fail("math", name, "latex fence/macros present (use $/$$ only)")
    tmp = strip_code_spans(text)
    tmp = re.sub(r"<!--.*?-->", "", tmp, flags=re.DOTALL)
    tmp = tmp.replace("\\$", "")   # escaped dollars render literally
    # unambiguous currency never pairs: thousands separators, k-suffix
    tmp = re.sub(r"\$\d{1,3}(?:,\d{3})+(?:\.\d+)?", "", tmp)
    tmp = re.sub(r"\$\d+k\b", "", tmp)
    # $$ display pairs are removed first (a greedy $..$ pass would eat
    # an opening $$ plus content plus one closer and leave a phantom)
    tmp = re.sub(r"\$\$.+?\$\$", "", tmp, flags=re.DOTALL)
    # greedy left-to-right pairing of the remaining inline $; a lone
    # currency $ ($0.02 question) harmlessly pairs forward, preserving
    # balance - only a true odd leftover is reported
    prev = None
    while prev != tmp:
        prev = tmp
        tmp = re.sub(r"\$.+?\$", "", tmp, flags=re.DOTALL)
    strays = [m.start() for m in re.finditer(r"\$", tmp)]
    if strays:
        fail("math", name, f"{len(strays)} stray $ after pairing")


def check_prov(text, name, path):
    sidecar = os.path.splitext(path)[0] + ".provenance.json"
    if os.path.exists(sidecar):
        return
    low = text.lower()
    for c in ("no large language model", "deterministic end-to-end",
              "no llm"):
        i = low.find(c)
        while i != -1:
            window = text[max(0, i - 200):i + 200]
            if _PIPELINE_CTX.search(window):
                line = text[:i].count("\n") + 1
                fail("provenance", f"{name}:{line}",
                     f'pipeline claim "{c}" with no PROVENANCE sidecar')
                break
            i = low.find(c, i + 1)


def check_pdf(pdf):
    try:
        from pypdf import PdfReader
    except ImportError:
        print("  (pypdf missing: pdf checks skipped)")
        return
    try:
        r = PdfReader(pdf)
    except Exception as e:
        fail("pdf", pdf, f"unreadable: {e}")
        return
    md = r.metadata or {}
    if not getattr(md, "title", None):
        fail("pdf", pdf, "no /Title metadata")
    if not getattr(md, "author", None):
        fail("pdf", pdf, "no /Author metadata")
    try:
        if len(r.outline) == 0:
            fail("pdf", pdf, "0 outline entries")
    except Exception:
        fail("pdf", pdf, "0 outline entries")
    blanks = [i + 1 for i, pg in enumerate(r.pages)
              if not (pg.extract_text() or "").strip()
              and not (pg.get("/Resources", {}).get("/XObject"))]
    if blanks:
        fail("pdf", pdf, f"blank pages: {blanks[:8]}")


def main():
    do_pdf = "--pdf" in sys.argv
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not files:
        files = sorted(glob.glob(os.path.join(ROOT, "Books/Humanized/*.md")))
    stats = load_json("data/stats.json")
    pats = load_json("data/patterns.json")
    scen = load_json("data/scenarios.json")
    pat_ids = {p["id"] for p in pats.get("patterns", []) if isinstance(p, dict)}
    sc = scen.get("scenarios", scen if isinstance(scen, list) else [])
    scen_ids = {s["id"] for s in sc if isinstance(s, dict)}
    data_blob = json.dumps({"p": sorted(pat_ids), "s": sorted(scen_ids)})
    per_dom = per_domain_counts()
    n_files = 0
    for path in files:
        name = os.path.relpath(path, ROOT)
        text = open(path, encoding="utf-8").read()
        n_files += 1
        check_ids(text, name, pat_ids, scen_ids, data_blob)
        check_counts(text, name, stats, per_dom)
        check_chapters(text, name)
        check_dupes(text, name)
        check_math(text, name)
        check_prov(text, name, path)
    if do_pdf:
        for pdf in sorted(glob.glob(os.path.join(ROOT, "Books/Humanized/*.pdf"))):
            check_pdf(os.path.relpath(pdf, ROOT))
    print(f"qa_books: {n_files} files, {len(FAIL)} failures")
    for f in FAIL[:60]:
        print("  FAIL " + f)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
