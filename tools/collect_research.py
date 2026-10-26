#!/usr/bin/env python3
"""Research collectors for the interlinked knowledge graphs.

The app ships two curated graphs plus the collectors that keep them fresh:

    data/rl_landscape.json        RL knowledge graph (curated, in-repo)
    data/sl_landscape.json        vendored snapshot of the sibling lab's
                                  reference/landscape.json (offline copy)
    data/research_collectors.json reading trails + collector definitions

Commands (stdlib only; network only for fetch-arxiv):

    validate       check every cross-graph reference resolves:
                   rl works -> patterns, rl_links, sl_links, concepts;
                   sl snapshot -> internal consistency (ids unique);
                   trails -> rl:/sl: work ids. Exit 1 with a report on failure.
    sync-sl        copy the sibling checkout's reference/landscape.json over
                   data/sl_landscape.json (byte-compare first; no-op if equal).
                   Fails if the sibling checkout is absent.
    fetch-arxiv    query the arXiv API and stage candidates into
                   exports/research_inbox.json for human triage. Never touches
                   data/*.json unless --apply is passed with --ids, in which
                   case fetched metadata is merged as draft works with
                   needs_review=true (still human-gated: validate warns on them).
    report         one-line counts for serve.py / humans.

Nothing here invents records: sync copies bytes, fetch stages metadata,
and only a human edit to data/rl_landscape.json curates.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RL_PATH = ROOT / "data" / "rl_landscape.json"
SL_PATH = ROOT / "data" / "sl_landscape.json"
COL_PATH = ROOT / "data" / "research_collectors.json"
PAT_PATH = ROOT / "data" / "patterns.json"
INBOX_PATH = ROOT / "exports" / "research_inbox.json"

SL_DIR = Path(os.environ.get("SL_DIR", "/home/fox/WorkBook/self-learning-agents"))


def load(p):
    return json.loads(Path(p).read_text())


def validate(report=False):
    errors = []
    rl = load(RL_PATH)
    sl = load(SL_PATH)
    col = load(COL_PATH)
    pats = {p["id"] for p in load(PAT_PATH)["patterns"]}

    rl_ids = [w["id"] for w in rl.get("works", [])]
    if len(set(rl_ids)) != len(rl_ids):
        errors.append("rl_landscape: duplicate work ids")
    rl_set = set(rl_ids)
    rl_concepts = {c["id"] for c in rl.get("concepts", [])}
    rl_dims = {d["id"] for d in rl.get("dimensions", [])}

    sl_ids = [w["id"] for w in sl.get("works", [])]
    if len(set(sl_ids)) != len(sl_ids):
        errors.append("sl_landscape: duplicate work ids")
    sl_set = set(sl_ids)

    for w in rl.get("works", []):
        wid = w.get("id", "?")
        for pid in w.get("patterns", []):
            if pid not in pats:
                errors.append(f"rl:{wid} -> unknown pattern {pid}")
        for tgt in w.get("rl_links", []):
            if tgt not in rl_set:
                errors.append(f"rl:{wid} -> unknown rl_link {tgt}")
            if tgt == wid:
                errors.append(f"rl:{wid} links to itself")
        for tgt in w.get("sl_links", []):
            if tgt not in sl_set:
                errors.append(f"rl:{wid} -> unknown sl_link {tgt}")
        for c in w.get("concepts", []):
            if c not in rl_concepts:
                errors.append(f"rl:{wid} -> unknown concept {c}")
        for dim, val in w.get("align", {}).items():
            if dim not in rl_dims:
                errors.append(f"rl:{wid} -> unknown dimension {dim}")

    for t in col.get("trails", []):
        for ref in t.get("works", []):
            if ref.startswith("rl:"):
                if ref[3:] not in rl_set:
                    errors.append(f"trail {t['id']} -> unknown {ref}")
            elif ref.startswith("sl:"):
                if ref[3:] not in sl_set:
                    errors.append(f"trail {t['id']} -> unknown {ref}")
            else:
                errors.append(f"trail {t['id']} has unprefixed ref {ref}")

    drafts = [w["id"] for w in rl.get("works", []) if w.get("needs_review")]
    if report or errors or drafts:
        print(f"rl: {len(rl_ids)} works, {len(rl_concepts)} concepts, {len(rl_dims)} dims")
        print(f"sl: {len(sl_ids)} works (snapshot {sl.get('version', '?')})")
        print(f"trails: {len(col.get('trails', []))}, collectors: {len(col.get('collectors', []))}")
        if drafts:
            print(f"drafts awaiting review: {', '.join(drafts)}")
    if errors:
        print("ERRORS:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("OK: every reference resolves")
    return 0


def sync_sl():
    src = SL_DIR / "reference" / "landscape.json"
    if not src.exists():
        sys.exit(f"collect_research: sibling checkout lacks reference/landscape.json "
                 f"(looked in {SL_DIR}; set SL_DIR)")
    new = src.read_bytes()
    if SL_PATH.exists() and SL_PATH.read_bytes() == new:
        print("sl_landscape.json already in sync — no-op")
        return 0
    SL_PATH.write_bytes(new)
    got = json.loads(new)
    print(f"synced sl_landscape.json: {len(got.get('works', []))} works, "
          f"{len(got.get('concepts', []))} concepts (version {got.get('version', '?')})")
    return 0


def fetch_arxiv(query, max_results=10, apply=False, ids=""):
    params = {"search_query": query or ("ti:reinforcement+learning+agent"),
              "start": 0, "max_results": max_results,
              "sortBy": "submittedDate", "sortOrder": "descending"}
    url = "http://export.arxiv.org/api/query?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as res:
            xml = res.read().decode("utf-8", "replace")
    except Exception as e:
        sys.exit(f"collect_research: arXiv fetch failed: {e}")
    import re
    entries = []
    for m in re.finditer(r"<entry>(.*?)</entry>", xml, re.S):
        block = m.group(1)
        def tag(name):
            mm = re.search(rf"<{name}>(.*?)</{name}>", block, re.S)
            return (mm.group(1).strip() if mm else "")
        aid = re.search(r"<id>http://arxiv.org/abs/([^<]+)</id>", block)
        entries.append({
            "arxiv": aid.group(1).split("v")[0] if aid else "",
            "title": re.sub(r"\s+", " ", tag("title")),
            "summary": re.sub(r"\s+", " ", tag("summary"))[:600],
            "published": tag("published")[:10],
            "url": f"https://arxiv.org/abs/{aid.group(1).split('v')[0]}" if aid else "",
        })
    INBOX_PATH.parent.mkdir(parents=True, exist_ok=True)
    inbox = []
    if INBOX_PATH.exists():
        try:
            inbox = json.loads(INBOX_PATH.read_text())
        except Exception:
            inbox = []
    seen = {e.get("arxiv") for e in inbox}
    fresh = [e for e in entries if e["arxiv"] and e["arxiv"] not in seen]
    inbox.extend(fresh)
    INBOX_PATH.write_text(json.dumps(inbox, indent=1) + "\n")
    print(f"staged {len(fresh)} new entries ({len(inbox)} total) -> {INBOX_PATH}")
    if apply:
        wanted = {x.strip() for x in ids.split(",") if x.strip()}
        if not wanted:
            sys.exit("collect_research: --apply needs --ids <arxiv-id,...>")
        rl = load(RL_PATH)
        have = {w["id"] for w in rl["works"]}
        added = 0
        for e in inbox:
            if e["arxiv"] not in wanted:
                continue
            wid = "arxiv-" + e["arxiv"].replace(".", "-")
            if wid in have:
                print(f"  skip {wid}: already in graph")
                continue
            rl["works"].append({
                "id": wid, "kind": "paper", "title": e["title"] or e["arxiv"],
                "authors": "", "venue": "arXiv", "year": int((e["published"] or "0")[:4] or 0),
                "url": e["url"], "summary": e["summary"],
                "mechanism": "Staged by fetch-arxiv; replace with a read summary before clearing needs_review.",
                "align": {}, "concepts": [], "patterns": [],
                "sl_links": [], "rl_links": [], "needs_review": True,
            })
            added += 1
        RL_PATH.write_text(json.dumps(rl, indent=1) + "\n")
        print(f"merged {added} draft works (needs_review=true) -> {RL_PATH}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Research collectors for the knowledge graphs")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate", help="check every cross-graph reference resolves")
    sub.add_parser("report", help="one-line counts")
    sub.add_parser("sync-sl", help="vendor the sibling lab landscape snapshot")
    f = sub.add_parser("fetch-arxiv", help="stage arXiv candidates into the inbox")
    f.add_argument("--query", default="", help="arXiv search_query (default: recent RL-agent titles)")
    f.add_argument("--max", type=int, default=10)
    f.add_argument("--apply", action="store_true", help="also merge --ids as needs_review drafts")
    f.add_argument("--ids", default="", help="comma-separated arXiv ids to merge with --apply")
    args = ap.parse_args()
    if args.cmd == "validate":
        return validate(report=True)
    if args.cmd == "report":
        return validate(report=True)
    if args.cmd == "sync-sl":
        return sync_sl()
    if args.cmd == "fetch-arxiv":
        return fetch_arxiv(args.query, args.max, args.apply, args.ids)


if __name__ == "__main__":
    sys.exit(main())
