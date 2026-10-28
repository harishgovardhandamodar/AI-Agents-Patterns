#!/usr/bin/env python3
"""Generate data/stats.json: the single source of truth for catalog counts.

README, books, and UI must consume these numbers instead of copying them by
hand (see findings P1-7/P2-1: 39 vs 55 traces, three vs six books).
Run: python3 tools/gen_stats.py [--check]  (--check exits non-zero on drift)
"""
import collections
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name):
    with open(os.path.join(ROOT, "data", name), encoding="utf-8") as f:
        return json.load(f)


def build():
    pats = load("patterns.json").get("patterns", [])
    scen = load("scenarios.json")
    scen = scen.get("scenarios", scen if isinstance(scen, list) else [])
    casc = load("cascades.json")
    casc = casc.get("cascades", casc if isinstance(casc, list) else [])
    traces = load("traces.json")
    traces = traces.get("traces", traces if isinstance(traces, list) else [])
    cov = load("coverage.json")
    by_domain = cov.get("by_domain", {})
    scount = collections.Counter(x.get("domain", "?") for x in scen
                                 if isinstance(x, dict))
    rl, tr = {}, {}
    for name in ("rl_landscape.json", "research_collectors.json"):
        try:
            d = load(name)
        except OSError:
            continue
        if name.startswith("rl_"):
            rl = {"works": len(d.get("works", [])),
                  "concepts": len(d.get("concepts", [])),
                  "dimensions": len(d.get("dimensions", []))}
        else:
            tr = {"trails": len(d.get("trails", []))}
    try:
        sl = load("sl_landscape.json")
        slinfo = {"works": len(sl.get("works", [])),
                  "concepts": len(sl.get("concepts", []))}
    except OSError:
        slinfo = {}
    return {
        "patterns": len(pats),
        "scenarios": len(scen),
        "cascades": len(casc),
        "traces": len(traces),
        "domains": len(by_domain),
        "domain_scenario_counts": {k: scount.get(k, 0) for k in by_domain},
        "works": {"sl": slinfo.get("works", 0), "rl": rl.get("works", 0)},
        "concepts": {"sl": slinfo.get("concepts", 0), "rl": rl.get("concepts", 0)},
        "dimensions": rl.get("dimensions", 0),
        "trails": tr.get("trails", 0),
    }


def main():
    stats = build()
    path = os.path.join(ROOT, "data", "stats.json")
    if "--check" in sys.argv:
        try:
            disk = json.load(open(path, encoding="utf-8"))
        except OSError:
            print("data/stats.json missing; run tools/gen_stats.py")
            return 2
        if disk != stats:
            print("data/stats.json is stale; run tools/gen_stats.py")
            for k in stats:
                if disk.get(k) != stats[k]:
                    print(f"  {k}: disk={disk.get(k)!r} actual={stats[k]!r}")
            return 1
        print("stats.json fresh")
        return 0
    json.dump(stats, open(path, "w", encoding="utf-8"), indent=2, sort_keys=True)
    open(path, "a", encoding="utf-8").write("\n")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
