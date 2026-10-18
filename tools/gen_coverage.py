#!/usr/bin/env python3
"""Generate data/coverage.json — the domain coverage index.

Deterministic and grounded: domains are the union of pattern `domains`,
scenario `domain` and cascade `domain` (missing cascade domain means
"general"); each domain lists the member ids per catalog. Mirrors the
checked-in index exactly — verified by recomputation.

Usage:  python3 tools/gen_coverage.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name):
    with open(os.path.join(ROOT, "data", name), encoding="utf-8") as f:
        return json.load(f)


def main():
    patterns = load("patterns.json")["patterns"]
    scenarios = load("scenarios.json")["scenarios"]
    cascades = load("cascades.json")["cascades"]

    def casdom(c):
        return c.get("domain") or "general"

    domains = sorted(
        set(sum([p.get("domains", []) for p in patterns], [])
            + [s["domain"] for s in scenarios]
            + [casdom(c) for c in cascades])
    )
    by_domain = {}
    for d in domains:
        dc = [c["id"] for c in cascades if casdom(c) == d]
        by_cls = {}
        for c in cascades:
            if casdom(c) == d:
                by_cls.setdefault(c["cls"], []).append(c["id"])
        # member lists keep catalog order (like the checked-in index);
        # only the domain list itself is sorted.
        by_domain[d] = {
            "patterns": [p["id"] for p in patterns if d in p.get("domains", [])],
            "scenarios": [s["id"] for s in scenarios if s["domain"] == d],
            "cascades_all": dc,
            "cascades_inherent": by_cls.get("inherent", []),
            "cascades_emergent": by_cls.get("emergent", []),
            "cascades_derived": by_cls.get("derived", []),
            "cascades_cascading": by_cls.get("cascading", []),
        }
    out = {
        "domains": domains,
        "by_domain": by_domain,
        "totals": {
            "patterns": len(patterns),
            "scenarios": len(scenarios),
            "cascades": len(cascades),
            "domains": len(domains),
        },
    }
    with open(os.path.join(ROOT, "data", "coverage.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("domains:", len(domains), "totals:", out["totals"])


if __name__ == "__main__":
    main()
