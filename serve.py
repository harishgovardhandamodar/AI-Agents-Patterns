#!/usr/bin/env python3
"""Static server + local-LLM proxy for the AI Agent Patterns & Guardrails app.

Usage:
    python3 serve.py [port]     # default port 5175

The app is a no-build vanilla-JS SPA (same philosophy as the
"Agentic Knowledge Mapper" classic GUI). A server is needed because the
Design & Architecture tab fetches markdown documents from /design/.

Local model
-----------
Fox-Architect talks to a local model through this server, never
directly from the browser.  This keeps a single origin (so the app works from
any LAN / Tailscale client), hides backend URLs, and lets us fail over between
backends transparently.

Endpoints (all read-only proxies, no secrets, no auth):

    GET  /api/llm/health   -> backend status + default model + readiness
    GET  /api/llm/models   -> model list from the active backend
    GET  /api/llm/config   -> non-secret configuration for the UI
    GET  /api/selflearn/health?port=8220 -> Self-Learning Lab reachability
    POST /api/llm/chat     -> streaming chat completion (SSE passthrough)
    GET  /api/books/status -> per-book landscape inventory + output freshness
    POST /api/books/build  -> launch a background rebuild ({targets, pdf})
    GET  /api/books/job?id= -> build job state, steps and log tail
    GET  /api/expand/status -> per-source expansion inventory + output freshness
    GET  /api/expand/models?backend= -> Ollama model list on axiom/local
    POST /api/expand/launch -> launch a background expansion ({source, model, backend, pdf})
    GET  /api/expand/job?id= -> expansion job state, progress and log tail
    GET  /api/power?... -> relay to the axiom power observer (GPU+CPU watts,
                         energy + raw samples; ok:false when unreachable)

Backends are tried in order (axiom first, then Fox-Services — see LLM_PRIMARY).
If none are reachable the proxy returns 503 and the UI falls back to a
deterministic, local analysis — the model is an accelerator, never a hard
dependency.

Configuration (environment variables):

    LLM_PRIMARY    default axiom   (which backend is tried first: axiom|fox)
    FOX_LLM_URL    default http://localhost:8210   (Fox-Services gateway)
    FOX_LLM_NAME   default fox-services
    AXIOM_LLM_URL  default http://100.101.3.115:8210 (tailnet node, optional)
    AXIOM_LLM_NAME default axiom
    LLM_MODEL      default quai-qwen3.8-27b:latest
    LLM_CONNECT_TIMEOUT  default 5     (seconds, per backend)
    LLM_READ_TIMEOUT     default 600   (seconds, model may cold-load)
    LLM_FIRST_TOKEN_TIMEOUT default 60 (seconds, before first token reaches client)
    LLM_STALL_TIMEOUT    default 45    (seconds, max silence mid-stream)
"""
import gzip
import http.client
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5175
# Bind host. Default is loopback-only: the book/expand endpoints launch
# multi-hour GPU jobs and overwrite files, so they must not be reachable
# from the network by default. Pass --lan (or HOST=0.0.0.0) to opt into
# LAN/Tailscale serving, preferably together with OPERATOR_TOKEN.
_LAN = "--lan" in sys.argv[1:]
HOST = os.environ.get("HOST", "0.0.0.0" if _LAN else "127.0.0.1")

# Operator token for mutating endpoints. Same-origin browser traffic
# (Sec-Fetch-Site: same-origin or a matching Origin header) is exempt;
# everything else — curl, scripts, cross-site pages — must present it.
# Generated per boot unless OPERATOR_TOKEN is set; printed at startup.
OPERATOR_TOKEN = os.environ.get("OPERATOR_TOKEN", "")
if not OPERATOR_TOKEN:
    import secrets as _secrets
    OPERATOR_TOKEN = _secrets.token_hex(16)

MAX_JSON_BODY = 65536  # 64 KB cap on API POST bodies (_read_body)
ROOT = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------- static delivery
# The app's data alone is ~1 MB of JSON and the vendored Mermaid build is
# 3.3 MB, so compress compressible types and revalidate the rest instead of
# sending everything raw with `no-store`.
GZIP_TYPES = (".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg",
              ".md", ".txt", ".xml", ".webmanifest", ".map")
GZIP_MIN = 1024
_GZ_CACHE = {}
_GZ_LOCK = threading.Lock()


def gzip_cached(path, st):
    """gzip a file once, cached on (mtime, size); return the compressed bytes."""
    with _GZ_LOCK:
        hit = _GZ_CACHE.get(path)
        if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
            return hit[2]
    with open(path, "rb") as fh:
        raw = fh.read()
    out = gzip.compress(raw, 6)
    with _GZ_LOCK:
        _GZ_CACHE[path] = (st.st_mtime, st.st_size, out)
    return out


# Same-origin hardening applied to every response. Inline event handlers are
# gone (all interaction goes through the delegated data-act dispatcher, and
# the boot check lives in js/bootcheck.js), so script-src needs no
# 'unsafe-inline'. style-src keeps it: the app sets element styles inline
# and the print view writes an inline <style> block.
CSP = ("default-src 'self'; "
       "script-src 'self'; "
       "style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data:; font-src 'self' data:; "
       "connect-src 'self'; worker-src 'self'; "
       "object-src 'none'; base-uri 'self'; "
       "frame-ancestors 'none'; form-action 'self'")

# ---------------------------------------------------------------- backends
def _backend_list():
    """Return configured backends in failover order (primary first).

    LLM_PRIMARY selects the primary: "axiom" (default — the GPU node that
    serves the default Qwen 3.8-27B build) or "fox" (local Fox-Services)."""
    fox = {"name": os.environ.get("FOX_LLM_NAME", "fox-services"),
           "url": os.environ.get("FOX_LLM_URL", "http://localhost:8210").rstrip("/")}
    ax = {"name": os.environ.get("AXIOM_LLM_NAME", "axiom"),
          "url": os.environ.get("AXIOM_LLM_URL", "http://100.101.3.115:8210").rstrip("/")}
    first, second = (ax, fox) if os.environ.get("LLM_PRIMARY", "axiom").lower() != "fox" else (fox, ax)
    return [b for b in (first, second) if b["url"]]


DEFAULT_MODEL = os.environ.get("LLM_MODEL", "quai-qwen3.8-27b:latest")
CONNECT_TIMEOUT = float(os.environ.get("LLM_CONNECT_TIMEOUT", "5"))
READ_TIMEOUT = float(os.environ.get("LLM_READ_TIMEOUT", "600"))
# Client-facing watchdog values (served via /api/llm/config): how long js/llm.js
# waits before giving up on a backend that accepts a connection but produces no
# token (Fox-Services can report "online" while the model behind it is wedged).
FIRST_TOKEN_TIMEOUT = float(os.environ.get("LLM_FIRST_TOKEN_TIMEOUT", "60"))
STALL_TIMEOUT = float(os.environ.get("LLM_STALL_TIMEOUT", "45"))


def _split(url):
    p = urllib.parse.urlparse(url)
    host = p.hostname or "localhost"
    port = p.port or (443 if p.scheme == "https" else 80)
    return p.scheme, host, port, (p.path.rstrip("/") or "")


def _request(backend, method, path, body=None, headers=None, timeout=None, read=False):
    """One HTTP round-trip to a backend. Returns (conn, resp) or raises."""
    scheme, host, port, base = _split(backend["url"])
    cls = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
    conn = cls(host, port, timeout=timeout or CONNECT_TIMEOUT)
    conn.request(method, base + path, body=body, headers=headers or {})
    resp = conn.getresponse()
    return conn, resp


def probe(backend, timeout=4.0):
    """Fast liveness + model-count probe. Never raises."""
    t0 = time.time()
    out = {"name": backend["name"], "url": backend["url"], "online": False}
    try:
        conn, resp = _request(backend, "GET", "/v1/models", timeout=timeout)
        raw = resp.read()
        out["latency_ms"] = int((time.time() - t0) * 1000)
        if resp.status == 200:
            try:
                data = json.loads(raw.decode("utf-8", "replace"))
                ids = [m.get("id") for m in data.get("data", []) if isinstance(m, dict)]
                out["online"] = True
                out["models"] = len(ids)
                out["has_default_model"] = DEFAULT_MODEL in ids
            except Exception:
                out["online"] = True
        else:
            out["error"] = "HTTP %s" % resp.status
        conn.close()
    except Exception as e:
        out["error"] = type(e).__name__
        out["latency_ms"] = int((time.time() - t0) * 1000)
    return out


def health():
    backends = _backend_list()
    results = [None] * len(backends)

    def run(i, b):
        # Primary gets generous headroom (it may be warm-loading a large model);
        # secondary backends fail fast so the status chip settles quickly.
        results[i] = probe(b, timeout=6.0 if i == 0 else 2.5)

    threads = [threading.Thread(target=run, args=(i, b), daemon=True) for i, b in enumerate(backends)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=6.5)
    results = [r or {"name": backends[i]["name"], "url": backends[i]["url"],
                     "online": False, "error": "timeout"} for i, r in enumerate(results)]
    active = next((r["name"] for r in results if r.get("online")), None)
    return {
        "ready": active is not None,
        "active": active,
        "default_model": DEFAULT_MODEL,
        "backends": results,
        "checked_at": time.time(),
    }


# ---------------------------------------------------- self-learning bridge
# The Self-Learning Lab (../self-learning-agents) runs on its own port and
# ships no CORS headers, so a browser probe would be blocked by `connect-src
# 'self'`. Probe it server-side instead: same-origin for the browser, and it
# reaches the lab on the machine that serves this app (which is also where
# the sibling checkout runs). Only a loopback host is ever contacted — the
# query string selects a port, never a host — so this cannot be used as an
# open relay to arbitrary addresses.
SELFLEARN_PORT = int(os.environ.get("SELFLEARN_PORT", "8220"))

# Sibling checkout for the Self-Learning Agent Lab (landscape source + the
# lab the self book builds against). Same default as tools/build_sl_book.py.
SL_DIR = os.environ.get("SL_DIR", "/home/fox/WorkBook/self-learning-agents")


# ------------------------------------------------------- bookshelf (books)
# The six books are generated artifacts: tools/build_*.py read the catalog
# (main, rogue) plus the sibling lab checkout (self) and emit Markdown +
# print HTML; tools/render_pdf.mjs typesets the PDFs. The Bookshelf panel on
# the Overview tab drives this pipeline: collect the landscape inventory,
# rebuild every book, optionally re-render every PDF. Same-origin only, like
# the /api/llm/* relay — a local operator tool, not a public API.
BOOK_TARGETS = {
    "main": {
        "label": "Agentic Design Patterns & Guardrails",
        "build": ["python3", "tools/build_book.py"],
        "pdf": ["node", "tools/render_pdf.mjs"],
        "md": "book/AGENTIC-PATTERNS-AND-GUARDRAILS.md",
        "html": "book/agent-patterns-and-guardrails.html",
        "pdf_out": "book/Agentic-Design-Patterns-and-Guardrails.pdf",
        "sources": ["data/patterns.json", "data/scenarios.json",
                    "data/cascades.json", "data/traces.json",
                    "data/coverage.json", "data/rl_landscape.json",
                    "data/sl_landscape.json", "data/research_collectors.json",
                    "design/12-research-graphs.md", "tools/build_book.py",
                    "tools/book_prose.py"],
    },
    "rogue": {
        "label": "Rogue Agents",
        "build": ["python3", "tools/build_rogue_book.py"],
        "pdf": ["node", "tools/render_pdf.mjs", "book/rogue-agents.html",
                "book/Rogue-Agents.pdf", "Rogue Agents"],
        "md": "book/ROGUE-AGENTS.md",
        "html": "book/rogue-agents.html",
        "pdf_out": "book/Rogue-Agents.pdf",
        "sources": ["data/patterns.json", "data/scenarios.json",
                    "data/cascades.json", "data/traces.json",
                    "js/rogue.js", "design/10-rogue-agents.md",
                    "tools/build_rogue_book.py", "tools/rogue_book_prose.py"],
    },
    "self": {
        "label": "Self-Learning Agents",
        "build": ["python3", "tools/build_sl_book.py"],
        "pdf": ["node", "tools/render_pdf.mjs", "book/self-learning-agents.html",
                "book/Self-Learning-Agents.pdf", "Self-Learning Agents"],
        "md": "book/SELF-LEARNING-AGENTS.md",
        "html": "book/self-learning-agents.html",
        "pdf_out": "book/Self-Learning-Agents.pdf",
        "sources": ["tools/build_sl_book.py", "tools/sl_book_prose.py",
                    "data/rl_landscape.json", "data/research_collectors.json"],
        "sl_sources": ["reference/landscape.json", "reference/benchmarks.json",
                       "reference/live_validation.json", "app/streams.py",
                       "app/evolvers.py", "design/01-system-context.md",
                       "design/02-uml.md", "design/03-control-flow.md",
                       "design/04-data-model.md", "design/05-evaluation-suite.md",
                       "design/06-workflows.md", "design/07-landscape.md"],
    },
    "openshell": {
        "label": "OpenShell Reference Architecture",
        "build": ["python3", "tools/build_openshell_book.py"],
        "pdf": ["node", "tools/render_pdf.mjs", "book/openshell-reference-architecture.html",
                "book/OpenShell-Reference-Architecture.pdf", "OpenShell Reference Architecture"],
        "md": "book/OPENSHELL-REFERENCE-ARCHITECTURE.md",
        "html": "book/openshell-reference-architecture.html",
        "pdf_out": "book/OpenShell-Reference-Architecture.pdf",
        "sources": ["data/patterns.json", "data/scenarios.json",
                    "data/cascades.json", "data/traces.json",
                    "data/coverage.json",
                    "tools/build_rogue_book.py",
                    "tools/build_openshell_book.py", "tools/openshell_book_prose.py",
                    "tools/openshell_book_data.py"],
    },
    "workflows": {
        "label": "Workflows",
        "build": ["python3", "tools/build_workflows_book.py"],
        "pdf": ["node", "tools/render_pdf.mjs", "book/workflows.html",
                "book/Workflows.pdf", "Workflows"],
        "md": "book/WORKFLOWS.md",
        "html": "book/workflows.html",
        "pdf_out": "book/Workflows.pdf",
        "sources": ["data/patterns.json", "data/scenarios.json",
                    "data/cascades.json", "data/traces.json",
                    "data/coverage.json", "js/shortcuts.js", "index.html",
                    "js/app.js", "js/palette.js",
                    "tools/build_rogue_book.py",
                    "tools/build_workflows_book.py", "tools/workflows_book_prose.py",
                    "tools/workflows_book_data.py", "tools/openshell_book_data.py"],
    },
    "field": {
        "label": "Field Playbooks",
        "build": ["python3", "tools/build_field_book.py"],
        "pdf": ["node", "tools/render_pdf.mjs", "book/field-playbooks.html",
                "book/Field-Playbooks.pdf", "Field Playbooks"],
        "md": "book/FIELD-PLAYBOOKS.md",
        "html": "book/field-playbooks.html",
        "pdf_out": "book/Field-Playbooks.pdf",
        "sources": ["data/patterns.json", "data/scenarios.json",
                    "data/cascades.json", "data/traces.json",
                    "data/coverage.json", "js/shortcuts.js", "index.html",
                    "tools/build_rogue_book.py", "tools/build_workflows_book.py",
                    "tools/build_field_book.py", "tools/field_book_prose.py",
                    "tools/field_book_data.py", "tools/openshell_book_data.py",
                    "tools/workflows_book_data.py"],
    },
}

_BOOK_JOBS = {}
_BOOK_JOB_SEQ = [0]
_BOOK_LOCK = threading.Lock()


def _finfo(rel):
    try:
        st = os.stat(os.path.join(ROOT, rel))
        return {"exists": True, "mtime": st.st_mtime, "size": st.st_size}
    except OSError:
        return {"exists": False, "mtime": 0, "size": 0}


def _landscape_collect():
    """Snapshot of every landscape the books build from: the catalog (main,
    rogue) and the sibling lab's reference data (self). Read-only; the build
    scripts themselves re-validate everything they consume."""
    out = {"catalog": None, "self": None, "research": None, "sl_present": os.path.isdir(SL_DIR)}
    try:
        pats = json.load(open(os.path.join(ROOT, "data/patterns.json")))
        scen = json.load(open(os.path.join(ROOT, "data/scenarios.json")))
        casc = json.load(open(os.path.join(ROOT, "data/cascades.json")))
        out["catalog"] = {
            "patterns": len(pats.get("patterns", [])),
            "scenarios": len(scen.get("scenarios", scen if isinstance(scen, list) else [])),
            "cascades": len(casc.get("cascades", casc if isinstance(casc, list) else [])),
        }
    except Exception as e:
        out["catalog"] = {"error": type(e).__name__}
    if out["sl_present"]:
        try:
            land = json.load(open(os.path.join(SL_DIR, "reference/landscape.json")))
            bench = json.load(open(os.path.join(SL_DIR, "reference/benchmarks.json")))
            out["self"] = {
                "works": len(land.get("works", [])),
                "concepts": len(land.get("concepts", [])),
                "dimensions": len(land.get("dimensions", [])),
                "bands": len(bench.get("bands", {})),
            }
        except Exception as e:
            out["self"] = {"error": type(e).__name__}
    try:
        rl = json.load(open(os.path.join(ROOT, "data/rl_landscape.json")))
        tr = json.load(open(os.path.join(ROOT, "data/research_collectors.json")))
        out["research"] = {
            "works": len(rl.get("works", [])),
            "concepts": len(rl.get("concepts", [])),
            "dimensions": len(rl.get("dimensions", [])),
            "trails": len(tr.get("trails", [])),
        }
    except Exception as e:
        out["research"] = {"error": type(e).__name__}
    return out


def books_status():
    landscape = _landscape_collect()
    books = {}
    for tid, t in BOOK_TARGETS.items():
        srcs = list(t["sources"])
        if tid == "self":
            srcs += [os.path.join(SL_DIR, r) if not os.path.isabs(r) else r
                     for r in t.get("sl_sources", [])]
        newest, missing_src = 0.0, []
        for rel in srcs:
            full = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
            try:
                newest = max(newest, os.stat(full).st_mtime)
            except OSError:
                missing_src.append(rel)
        outs = {k: _finfo(t[k]) for k in ("md", "html", "pdf_out")}
        missing_out = [k for k, v in outs.items() if not v["exists"]]
        oldest_out = min([v["mtime"] for v in outs.values() if v["exists"]] or [0])
        stale = bool(missing_out or missing_src) or (newest > oldest_out)
        books[tid] = {
            "label": t["label"],
            "landscape": landscape["self"] if tid == "self" else landscape["catalog"],
            "outputs": outs,
            "stale": stale,
            "stale_reasons": (["missing: " + ", ".join(missing_out)] if missing_out else [])
            + (["missing sources: " + ", ".join(missing_src)] if missing_src else [])
            + (["sources newer than outputs"] if not missing_out and not missing_src and newest > oldest_out else []),
        }
    return {"books": books, "sl_dir": SL_DIR,
            "sl_present": landscape["sl_present"],
            "node": bool(shutil.which("node")),
            "time": time.time()}


def _chrome_path():
    env = os.environ.get("CHROME_PATH", "")
    if env and os.path.exists(env):
        return env
    base = os.path.expanduser("~/.cache/puppeteer/chrome")
    try:
        vers = sorted(os.listdir(base))
    except OSError:
        vers = []
    for ver in reversed(vers):
        for leaf in ("chrome-linux64", "chrome-linux-arm64"):
            cand = os.path.join(base, ver, leaf, "chrome")
            if os.path.exists(cand):
                return cand
    for name in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    return ""


def _run_book_job(job):
    started = time.time()
    job["state"] = "running"
    job["started_at"] = started
    log = job["log"]
    steps = job["steps"]

    def say(line):
        log.append(line)
        del log[:-60]

    try:
        landscape = _landscape_collect()
        say("landscape collected: catalog=%s self=%s" % (
            json.dumps(landscape.get("catalog")), json.dumps(landscape.get("self"))))
        steps.append({"step": "collect", "ok": True,
                      "secs": round(time.time() - started, 1)})
        if not shutil.which("node"):
            say("note: node not on PATH — PDF steps will fail, MD/HTML still build")
        chrome = _chrome_path()
        if job["params"].get("pdf") and not chrome:
            say("note: no Chrome found — PDF steps will fail, MD/HTML still build")
        for tid in job["params"]["targets"]:
            if job.get("cancel"):
                job["state"] = "cancelled"
                say("cancelled by operator")
                return
            t = BOOK_TARGETS[tid]
            env = dict(os.environ)
            env["SL_DIR"] = SL_DIR
            if chrome:
                env["CHROME_PATH"] = chrome
            # -- build MD + HTML --
            t0 = time.time()
            say("$ %s" % " ".join(t["build"]))
            try:
                proc = subprocess.Popen(t["build"], cwd=ROOT, env=env,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        text=True)
                job["proc"] = proc
                try:
                    stdout, stderr = proc.communicate(timeout=1500)
                finally:
                    job["proc"] = None
                say((stdout or "").strip().splitlines()[-3:] and
                    "\n".join((stdout or "").strip().splitlines()[-3:]) or "(no output)")
                if job.get("cancel") or proc.returncode != 0:
                    if job.get("cancel"):
                        say("cancelled by operator")
                        job["state"] = "cancelled"
                    else:
                        say("STDERR: " + (stderr or "")[-1500:])
                        job["state"] = "error"
                    steps.append({"target": tid, "step": "build", "ok": False,
                                  "secs": round(time.time() - t0, 1)})
                    return
                steps.append({"target": tid, "step": "build", "ok": True,
                              "secs": round(time.time() - t0, 1)})
            except Exception as e:
                job["proc"] = None
                say("build failed: %s" % type(e).__name__)
                steps.append({"target": tid, "step": "build", "ok": False, "secs": 0})
                job["state"] = "cancelled" if job.get("cancel") else "error"
                return
            # -- PDF --
            if job["params"].get("pdf"):
                t0 = time.time()
                say("$ %s" % " ".join(t["pdf"]))
                try:
                    proc = subprocess.Popen(t["pdf"], cwd=ROOT, env=env,
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                            text=True)
                    job["proc"] = proc
                    try:
                        stdout, stderr = proc.communicate(timeout=2400)
                    finally:
                        job["proc"] = None
                    tail = (stdout or "").strip().splitlines()[-4:]
                    say("\n".join(tail) or "(no output)")
                    if job.get("cancel") or proc.returncode != 0:
                        if job.get("cancel"):
                            say("cancelled by operator")
                        else:
                            say("STDERR: " + (stderr or "")[-1500:])
                        steps.append({"target": tid, "step": "pdf", "ok": False,
                                      "secs": round(time.time() - t0, 1)})
                    else:
                        steps.append({"target": tid, "step": "pdf", "ok": True,
                                      "secs": round(time.time() - t0, 1)})
                except Exception as e:
                    job["proc"] = None
                    say("pdf failed: %s" % type(e).__name__)
                    steps.append({"target": tid, "step": "pdf", "ok": False, "secs": 0})
        if job.get("cancel"):
            job["state"] = "cancelled"
        else:
            job["state"] = "done" if all(s["ok"] for s in steps if s["step"] != "collect") else "error"
    finally:
        job["finished_at"] = time.time()
        say("job %s (%s)" % (job["state"], job["id"]))


def books_launch(params):
    targets = params.get("targets") or ["main", "rogue", "self"]
    targets = [t for t in targets if t in BOOK_TARGETS]
    if not targets:
        return {"error": "no known targets"}
    with _BOOK_LOCK:
        for j in _BOOK_JOBS.values():
            if j["state"] in ("queued", "running"):
                return {"job": j["id"], "busy": True,
                        "note": "a build is already running; refusing to stack another"}
        _BOOK_JOB_SEQ[0] += 1
        jid = "%d-%d" % (int(time.time()), _BOOK_JOB_SEQ[0])
        job = {"id": jid, "state": "queued", "steps": [], "log": [],
               "params": {"targets": targets, "pdf": bool(params.get("pdf", True))},
               "started_at": 0, "finished_at": 0, "cancel": False, "proc": None}
        _BOOK_JOBS[jid] = job
        if len(_BOOK_JOBS) > 5:
            for old in sorted(_BOOK_JOBS)[:-5]:
                del _BOOK_JOBS[old]
    threading.Thread(target=_run_book_job, args=(job,), daemon=True).start()
    return {"job": jid, "state": "queued", "params": job["params"]}


def books_cancel(jid):
    with _BOOK_LOCK:
        job = _BOOK_JOBS.get((jid or "")[:64])
        if job is None:
            return {"error": "unknown job"}
        if job["state"] not in ("queued", "running"):
            return {"job": job["id"], "state": job["state"], "note": "not running"}
        job["cancel"] = True
        proc = job.get("proc")
    if proc is not None:
        try:
            proc.terminate()
        except Exception:
            pass
    return {"job": job["id"], "state": "cancelling"}


def books_job(jid):
    if jid:
        job = _BOOK_JOBS.get(jid)
        if job is None:
            return {"error": "unknown job"}
        return job
    if not _BOOK_JOBS:
        return {"job": None}
    latest = _BOOK_JOBS[sorted(_BOOK_JOBS)[-1]]
    return latest


# ------------------------------------------------- humanizer (expand)
# The Books/Humanized/*.md expansions are model-generated artifacts:
# tools/expand_humanized.py rewrites each book/*.md section-by-section
# through a local Ollama model (single-GPU box or the axiom node over
# Tailscale), resumable via Books/Humanized/.checkpoints/*.expand.json;
# tools/render_humanized_pdf.py then typesets the PDF. The Expander panel
# on the Overview tab drives this pipeline: pick a source book, a backend
# and a model, launch, and follow progress. Same-origin only, like the
# /api/books/* rebuild endpoints — a local operator tool.
EXPAND_SOURCES = {
    "field": {"label": "Field Playbooks", "src": "book/FIELD-PLAYBOOKS.md",
              "dst": "Books/Humanized/FIELD-PLAYBOOKS.md",
              "pdf": "Books/Humanized/FIELD-PLAYBOOKS.pdf"},
    "workflows": {"label": "Workflows", "src": "book/WORKFLOWS.md",
                  "dst": "Books/Humanized/WORKFLOWS.md",
                  "pdf": "Books/Humanized/WORKFLOWS.pdf"},
    "rogue": {"label": "Rogue Agents", "src": "book/ROGUE-AGENTS.md",
              "dst": "Books/Humanized/ROGUE-AGENTS.md",
              "pdf": "Books/Humanized/ROGUE-AGENTS.pdf"},
    "openshell": {"label": "OpenShell Reference Architecture",
                  "src": "book/OPENSHELL-REFERENCE-ARCHITECTURE.md",
                  "dst": "Books/Humanized/OPENSHELL-REFERENCE-ARCHITECTURE.md",
                  "pdf": "Books/Humanized/OPENSHELL-REFERENCE-ARCHITECTURE.pdf"},
    "self": {"label": "Self-Learning Agents", "src": "book/SELF-LEARNING-AGENTS.md",
             "dst": "Books/Humanized/SELF-LEARNING-AGENTS.md",
             "pdf": "Books/Humanized/SELF-LEARNING-AGENTS.pdf"},
    "agentic": {"label": "Agentic Patterns & Guardrails",
                "src": "book/AGENTIC-PATTERNS-AND-GUARDRAILS.md",
                "dst": "Books/Humanized/AGENTIC-PATTERNS-AND-GUARDRAILS.md",
                "pdf": "Books/Humanized/AGENTIC-PATTERNS-AND-GUARDRAILS.pdf"},
}

_EXPAND_JOBS = {}
_EXPAND_JOB_SEQ = [0]
_EXPAND_LOCK = threading.Lock()

EXPAND_DEFAULT_MODEL = os.environ.get("EXPAND_MODEL", "qwen3.8:latest")


def _ollama_base(backend):
    """Native Ollama URL for an expansion backend. The :8210 LLM entries
    are chat proxies; expansion talks to Ollama's /api/* directly."""
    backend = (backend or "").strip().lower()
    if backend in ("axiom", "ax"):
        return os.environ.get("AXIOM_OLLAMA_URL", "http://100.101.3.115:11434").rstrip("/")
    return os.environ.get("LOCAL_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")


def _ckpt_info(src):
    """Progress of a source's expansion checkpoint: cached chunks of total."""
    stem = os.path.splitext(os.path.basename(src))[0]
    ckpt = os.path.join(ROOT, "Books/Humanized/.checkpoints", stem + ".expand.json")
    if not os.path.exists(ckpt):
        # legacy/alternate checkpoint names (e.g. WORKFLOWS.md.ckpt.json)
        d = os.path.join(ROOT, "Books/Humanized/.checkpoints")
        try:
            cands = [f for f in os.listdir(d) if f.startswith(stem)]
        except OSError:
            cands = []
        if not cands:
            return {"exists": False, "cached": 0, "path": os.path.relpath(ckpt, ROOT)}
        ckpt = os.path.join(d, sorted(cands)[0])
    try:
        data = json.load(open(ckpt, encoding="utf-8"))
        cached = len(data) if isinstance(data, dict) else 0
    except Exception:
        return {"exists": True, "cached": 0, "path": os.path.relpath(ckpt, ROOT)}
    return {"exists": True, "cached": cached, "path": os.path.relpath(ckpt, ROOT)}


def expand_status():
    books = {}
    for sid, s in EXPAND_SOURCES.items():
        src_full = os.path.join(ROOT, s["src"])
        try:
            size = os.stat(src_full).st_size
            mtime = os.stat(src_full).st_mtime
            exists = True
        except OSError:
            size, mtime, exists = 0, 0, False
        ckpt = _ckpt_info(s["src"])
        dst = _finfo(s["dst"])
        pdf = _finfo(s["pdf"])
        stale = (not dst["exists"]) or (exists and mtime > dst["mtime"])
        books[sid] = {
            "label": s["label"], "src": s["src"], "dst": s["dst"], "pdf": s["pdf"],
            "src_exists": exists, "src_size": size,
            "ckpt": ckpt, "output": dst, "pdf_out": pdf, "stale": stale,
        }
    return {"books": books,
            "default_model": EXPAND_DEFAULT_MODEL,
            "ollama": {"axiom": _ollama_base("axiom"), "local": _ollama_base("local")},
            "time": time.time()}


def expand_models(backend):
    """Model dropdown source: Ollama /api/tags on the chosen backend."""
    base = _ollama_base(backend)
    out = {"backend": (backend or "local").strip().lower() or "local",
           "url": base, "online": False, "models": []}
    try:
        scheme, host, port, _ = _split(base)
        cls = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
        conn = cls(host, port, timeout=8.0)
        conn.request("GET", "/api/tags", headers={"Accept": "application/json"})
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        if resp.status == 200:
            data = json.loads(raw.decode("utf-8", "replace"))
            out["models"] = sorted(
                m.get("name") for m in data.get("models", [])
                if isinstance(m, dict) and m.get("name"))
            out["online"] = True
        else:
            out["error"] = "HTTP %s" % resp.status
    except Exception as e:
        out["error"] = type(e).__name__
    return out


def _run_expand_job(job):
    started = time.time()
    job["state"] = "running"
    job["started_at"] = started
    log = job["log"]
    p = job["params"]
    src = EXPAND_SOURCES[p["source"]]

    def say(line):
        log.append(line)
        del log[:-80]
        m = re.search(r"\[(\d+)/(\d+)\]", line)
        if m:
            job["done"] = int(m.group(1))
            job["total"] = int(m.group(2))

    try:
        env = dict(os.environ)
        env["EXPAND_MODEL"] = p["model"]
        env["EXPAND_URL"] = _ollama_base(p["backend"]) + "/api/generate"
        cmd = ["python3", "tools/expand_humanized.py",
               src["src"], src["dst"],
               os.path.join("Books/Humanized/.checkpoints",
                            os.path.splitext(os.path.basename(src["src"]))[0] + ".expand.json")]
        say("$ EXPAND_MODEL=%s EXPAND_URL=%s %s" % (p["model"], env["EXPAND_URL"], " ".join(cmd)))
        t0 = time.time()
        try:
            proc = subprocess.Popen(cmd, cwd=ROOT, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, bufsize=1)
            job["pid"] = proc.pid
            for line in proc.stdout:
                say(line.rstrip())
            proc.wait(timeout=14400)
            rc = proc.returncode
            if job.get("cancel"):
                job["steps"].append({"step": "expand", "ok": False, "secs": 0})
                job["state"] = "cancelled"
                return
        except Exception as e:
            say("expansion failed: %s" % type(e).__name__)
            job["steps"].append({"step": "expand", "ok": False, "secs": round(time.time() - t0, 1)})
            job["state"] = "error"
            return
        job["steps"].append({"step": "expand", "ok": rc == 0, "secs": round(time.time() - t0, 1)})
        if rc != 0:
            job["state"] = "error"
            return
        if p.get("pdf"):
            t0 = time.time()
            say("$ python3 tools/render_humanized_pdf.py %s" % src["dst"])
            try:
                r = subprocess.run(["python3", "tools/render_humanized_pdf.py", src["dst"]],
                                   cwd=ROOT, env=env, capture_output=True,
                                   text=True, timeout=2400)
                tail = (r.stdout or "").strip().splitlines()[-4:]
                say("\n".join(tail) or "(no output)")
                if r.returncode != 0:
                    say("STDERR: " + (r.stderr or "")[-1500:])
                job["steps"].append({"step": "pdf", "ok": r.returncode == 0,
                                     "secs": round(time.time() - t0, 1)})
            except Exception as e:
                say("pdf failed: %s" % type(e).__name__)
                job["steps"].append({"step": "pdf", "ok": False, "secs": 0})
        job["state"] = "done" if all(s["ok"] for s in job["steps"]) else "error"
    finally:
        job["finished_at"] = time.time()
        job["pid"] = 0
        say("job %s (%s)" % (job["state"], job["id"]))


def expand_launch(params):
    source = (params.get("source") or "").strip()
    model = (params.get("model") or EXPAND_DEFAULT_MODEL).strip()
    backend = ((params.get("backend") or "axiom").strip().lower() or "axiom")
    if source not in EXPAND_SOURCES:
        return {"error": "unknown source: %s" % source}
    if not model:
        return {"error": "model required"}
    if backend not in ("axiom", "local", "ax"):
        return {"error": "unknown backend: %s" % backend}
    backend = "axiom" if backend == "ax" else backend
    with _EXPAND_LOCK:
        for j in _EXPAND_JOBS.values():
            if j["state"] in ("queued", "running"):
                return {"job": j["id"], "busy": True,
                        "note": "an expansion is already running; refusing to stack another"}
        _EXPAND_JOB_SEQ[0] += 1
        jid = "%d-%d" % (int(time.time()), _EXPAND_JOB_SEQ[0])
        job = {"id": jid, "state": "queued", "steps": [], "log": [],
               "done": 0, "total": 0, "pid": 0,
               "params": {"source": source, "model": model, "backend": backend,
                          "pdf": bool(params.get("pdf", True))},
               "started_at": 0, "finished_at": 0, "cancel": False, "proc": None}
        _EXPAND_JOBS[jid] = job
        if len(_EXPAND_JOBS) > 5:
            for old in sorted(_EXPAND_JOBS)[:-5]:
                del _EXPAND_JOBS[old]
    threading.Thread(target=_run_expand_job, args=(job,), daemon=True).start()
    return {"job": jid, "state": "queued", "params": job["params"]}


def expand_cancel(jid):
    with _EXPAND_LOCK:
        job = _EXPAND_JOBS.get((jid or "")[:64])
        if job is None:
            return {"error": "unknown job"}
        if job["state"] not in ("queued", "running"):
            return {"job": job["id"], "state": job["state"], "note": "not running"}
        job["cancel"] = True
        pid = job.get("pid") or 0
    if pid:
        try:
            os.kill(pid, 15)
        except Exception:
            pass
    return {"job": job["id"], "state": "cancelling"}


def expand_job(jid):
    if jid:
        job = _EXPAND_JOBS.get(jid)
        if job is None:
            return {"error": "unknown job"}
        return job
    if not _EXPAND_JOBS:
        return {"job": None}
    latest = _EXPAND_JOBS[sorted(_EXPAND_JOBS)[-1]]
    return latest


def _power_backend():
    """The axiom gateway serves /api/power (continuous GPU+CPU observer)."""
    backends = [b for b in _backend_list() if b.get("url")]
    for b in backends:
        if (b.get("name") or "").lower() == "axiom":
            return b
    return backends[0] if backends else None


def power_proxy(query):
    """Same-origin relay for the axiom power observer. The browser never
    talks to the tailnet directly; unreachable backend -> ok:false, never
    a console error."""
    b = _power_backend()
    if b is None:
        return {"ok": False, "error": "no power backend configured"}
    try:
        scheme, host, port, base = _split(b["url"])
        cls = (http.client.HTTPSConnection if scheme == "https"
               else http.client.HTTPConnection)
        conn = cls(host, port, timeout=15.0)
        conn.request("GET", "/api/power" + ("?" + query if query else ""),
                     headers={"Accept": "application/json"})
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        if resp.status != 200:
            return {"ok": False, "error": "power backend HTTP %s" % resp.status}
        return json.loads(raw.decode("utf-8", "replace"))
    except Exception as e:
        return {"ok": False, "error": "%s unreachable: %s" % (b.get("name"), type(e).__name__)}


def selflearn_health(port, timeout=2.0):
    out = {"ok": False, "port": port, "checked_at": time.time()}
    if not isinstance(port, int) or port < 1 or port > 65535:
        out["error"] = "invalid port"
        return out
    t0 = time.time()
    conn = None
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
        conn.request("GET", "/api/health",
                     headers={"Accept": "application/json", "Connection": "close"})
        resp = conn.getresponse()
        raw = resp.read(4096)
        out["status"] = resp.status
        out["latency_ms"] = int((time.time() - t0) * 1000)
        if resp.status < 500:
            out["ok"] = True
            try:
                data = json.loads(raw.decode("utf-8", "replace"))
                if isinstance(data, dict):
                    out["service"] = data.get("status") or data.get("name")
            except Exception:
                pass
        else:
            out["error"] = "HTTP %s" % resp.status
    except Exception as e:
        out["error"] = type(e).__name__
        out["latency_ms"] = int((time.time() - t0) * 1000)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    return out


# ---------------------------------------------------------------- server
class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "aap"      # don't advertise the Python build in Server:
    sys_version = ""
    _gz_body = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # -- helpers -----------------------------------------------------------
    def _json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            n = 0
        if n > MAX_JSON_BODY:
            raise ValueError("body too large")
        return self.rfile.read(n) if n else b""

    def _same_origin(self):
        """True for browser traffic that provably comes from our own pages.

        An attacker page on another origin cannot forge Sec-Fetch-Site
        (browsers set it) and cannot make our Origin match without controlling
        our host. Non-browser clients (curl) carry neither header and must
        present the operator token instead."""
        sfs = (self.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if sfs == "same-origin":
            return True
        origin = (self.headers.get("Origin") or "").strip()
        if not origin:
            return False
        try:
            o = urllib.parse.urlparse(origin)
            host = (self.headers.get("Host") or "").split(":")[0].lower()
            return (o.hostname or "").lower() in (host, "localhost", "127.0.0.1", "::1") \
                and o.scheme in ("http", "https")
        except Exception:
            return False

    def _require_operator(self):
        """Gate for mutating endpoints. Returns an error dict or None."""
        if self._same_origin():
            return None
        auth = (self.headers.get("Authorization") or "").strip()
        token = ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        else:
            token = (self.headers.get("X-Operator-Token") or "").strip()
        if token and token == OPERATOR_TOKEN:
            return None
        return {"error": "operator approval required",
                "hint": "same-origin browser traffic is exempt; other clients "
                        "must send Authorization: Bearer $OPERATOR_TOKEN "
                        "(printed at server startup)"}

    def _read_json(self, cap=True):
        try:
            raw = self._read_body()
        except ValueError:
            return None, {"error": "body exceeds %d bytes" % MAX_JSON_BODY}
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype and ctype != "application/json":
            return None, {"error": "Content-Type must be application/json"}
        try:
            params = json.loads(raw.decode("utf-8") or "{}")
            if not isinstance(params, dict):
                params = {}
        except Exception:
            return None, {"error": "body must be JSON"}
        return params, None

    def end_headers(self):
        # Security headers on every response (cheap XSS backstop for the app's
        # many innerHTML sites); caching is set per response instead of a blanket
        # no-store, which previously re-sent 4.9 MB on every visit.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        super().end_headers()

    # -- static files: gzip + conditional caching --------------------------
    def _cache_control(self, path):
        rel = path[len(ROOT):] if path.startswith(ROOT) else path
        if "/vendor/" in rel:
            return "public, max-age=31536000, immutable"
        return "no-cache"       # revalidate via If-Modified-Since -> cheap 304

    def _not_modified(self, header, mtime):
        try:
            from email.utils import parsedate_to_datetime
            return int(mtime) <= int(parsedate_to_datetime(header).timestamp())
        except Exception:
            return False

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            parts = urllib.parse.urlsplit(self.path)
            if not parts.path.endswith("/"):
                self.send_response(301)
                loc = parts._replace(path=parts.path + "/", fragment="")
                self.send_header("Location", urllib.parse.urlunsplit(loc))
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            for idx in ("index.html", "index.htm"):
                candidate = os.path.join(path, idx)
                if os.path.isfile(candidate):
                    path = candidate
                    break
            else:
                self._gz_body = None
                return self.list_directory(path)   # no index -> directory listing
        try:
            f = open(path, "rb")
        except OSError:
            self._gz_body = None
            self.send_error(404, "File not found")
            return None
        try:
            st = os.fstat(f.fileno())
            ims = self.headers.get("If-Modified-Since")
            if ims and self._not_modified(ims, st.st_mtime):
                f.close()
                self.send_response(304)
                self.send_header("Last-Modified", self.date_time_string(st.st_mtime))
                self.end_headers()
                return None
            ext = os.path.splitext(path)[1].lower()
            accepts = "gzip" in (self.headers.get("Accept-Encoding") or "")
            use_gz = accepts and ext in GZIP_TYPES and st.st_size > GZIP_MIN
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            if use_gz:
                body = gzip_cached(path, st)
                self._gz_body = body
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Vary", "Accept-Encoding")
                self.send_header("Content-Length", str(len(body)))
            else:
                self._gz_body = None
                self.send_header("Content-Length", str(st.st_size))
            self.send_header("Last-Modified", self.date_time_string(st.st_mtime))
            self.send_header("Cache-Control", self._cache_control(path))
            self.end_headers()
            return f
        except Exception:
            f.close()
            raise

    def copyfile(self, source, outputfile):
        # When send_head swapped in a compressed body, write that instead.
        body = self._gz_body
        if body is not None:
            outputfile.write(body)
            self._gz_body = None
            return
        super().copyfile(source, outputfile)

    def log_message(self, fmt, *args):  # quieter console
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- routing -----------------------------------------------------------
    def do_OPTIONS(self):
        # No wildcard ACAO: only answer preflights from our own origin.
        # Cross-site pages get no CORS grant, so their reads fail closed;
        # writes are additionally gated by _require_operator.
        origin = (self.headers.get("Origin") or "").strip()
        self.send_response(204)
        if origin:
            try:
                o = urllib.parse.urlparse(origin)
                host = (self.headers.get("Host") or "").split(":")[0].lower()
                if (o.hostname or "").lower() in (host, "localhost", "127.0.0.1", "::1"):
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
            except Exception:
                pass
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization, x-operator-token")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/diag":
            # Client-side diagnostics beacon (see bootDiag in js/app.js):
            # logs browser errors + boot markers to stderr (docker logs).
            # Same-origin only, no PII beyond UA string and tab name.
            try:
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                msg = (q.get("msg") or [""])[0][:300].replace("\n", " ")
                kind = (q.get("kind") or [""])[0][:20].replace("\n", " ")
                tab = (q.get("tab") or [""])[0][:20].replace("\n", " ")
                ua = (q.get("ua") or [""])[0][:120].replace("\n", " ")
                sys.stderr.write(f"DIAG [{self.client_address[0]}] {kind} tab={tab} :: {msg} :: {ua}\n")
                sys.stderr.flush()
            except Exception:
                pass
            self.send_response(204)
            self.end_headers()
            return
        if path == "/api/llm/health":
            return self._json(health())
        if path == "/api/llm/config":
            return self._json({
                "proxy": True,
                "default_model": DEFAULT_MODEL,
                "backends": [b["name"] for b in _backend_list()],
                "connect_timeout": CONNECT_TIMEOUT,
                "read_timeout": READ_TIMEOUT,
                "first_token_timeout": FIRST_TOKEN_TIMEOUT,
                "stall_timeout": STALL_TIMEOUT,
            })
        if path == "/api/llm/models":
            return self._models()
        if path == "/api/selflearn/health":            # Always 200 (like /api/llm/models) so an offline lab shows as
            # `ok:false`, not as a console error in the browser.
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            raw_port = (q.get("port") or [str(SELFLEARN_PORT)])[0]
            try:
                port = int(raw_port)
            except (TypeError, ValueError):
                port = 0
            return self._json(selflearn_health(port))
        if path == "/api/books/status":
            return self._json(books_status())
        if path == "/api/books/job":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            jid = (q.get("id") or [""])[0][:64]
            job = books_job(jid)
            if "error" in job:
                return self._json(job, 404)
            return self._json(job)
        if path == "/api/expand/status":
            return self._json(expand_status())
        if path == "/api/expand/models":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            backend = (q.get("backend") or ["axiom"])[0][:16]
            return self._json(expand_models(backend))
        if path == "/api/expand/job":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            jid = (q.get("id") or [""])[0][:64]
            job = expand_job(jid)
            if "error" in job:
                return self._json(job, 404)
            return self._json(job)
        if path in ("/api/power", "/api/power/stats"):
            return self._power()
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/llm/chat":
            return self._chat()
        if path in ("/api/books/build", "/api/expand/launch",
                    "/api/books/cancel", "/api/expand/cancel"):
            err = self._require_operator()
            if err:
                return self._json(err, 401 if "required" in err.get("error", "") else 403)
            params, perr = self._read_json()
            if perr:
                status = 413 if "exceeds" in perr.get("error", "") else 400
                return self._json(perr, status)
            if path == "/api/books/build":
                out = books_launch(params)
            elif path == "/api/expand/launch":
                out = expand_launch(params)
            elif path == "/api/books/cancel":
                out = books_cancel(params.get("job", ""))
            else:
                out = expand_cancel(params.get("job", ""))
            if "error" in out:
                return self._json(out, 400)
            return self._json(out)
        if path == "/api/diag":
            # sendBeacon posts here; same handling as the GET beacon.
            try:
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                msg = (q.get("msg") or [""])[0][:300].replace("\n", " ")
                kind = (q.get("kind") or [""])[0][:20].replace("\n", " ")
                tab = (q.get("tab") or [""])[0][:20].replace("\n", " ")
                ua = (q.get("ua") or [""])[0][:120].replace("\n", " ")
                sys.stderr.write(f"DIAG [{self.client_address[0]}] {kind} tab={tab} :: {msg} :: {ua}\n")
                sys.stderr.flush()
            except Exception:
                pass
            self.send_response(204)
            self.end_headers()
            return
        self._json({"error": "not found"}, 404)

    # -- llm handlers ------------------------------------------------------
    def _power(self):
        query = urllib.parse.urlparse(self.path).query or ""
        # length-cap the forwarded query; the observer validates the rest
        if len(query) > 1024:
            return self._json({"ok": False, "error": "query too long"}, 400)
        return self._json(power_proxy(query))

    def _models(self):
        # Always 200 so an offline backend never shows as a console error in the
        # browser; callers inspect `online`.
        for b in _backend_list():
            try:
                conn, resp = _request(b, "GET", "/v1/models", timeout=8.0)
                raw = resp.read()
                conn.close()
                if resp.status == 200:
                    data = json.loads(raw.decode("utf-8", "replace"))
                    ids = [m.get("id") for m in data.get("data", []) if isinstance(m, dict)]
                    return self._json({"online": True, "backend": b["name"], "models": ids,
                                       "default_model": DEFAULT_MODEL})
            except Exception:
                continue
        return self._json({"online": False, "backend": None, "models": [],
                           "default_model": DEFAULT_MODEL})

    def _chat(self):
        raw = self._read_body()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            return self._json({"error": "body must be JSON"}, 400)
        if not payload.get("messages"):
            return self._json({"error": "messages required"}, 400)
        payload.setdefault("model", DEFAULT_MODEL)
        payload.setdefault("stream", True)
        body = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json",
                   "Accept": "text/event-stream, application/json",
                   "Accept-Encoding": "identity"}

        backends = _backend_list()
        # A client may pin a backend with X-Fox-Backend. The bench uses this
        # to force a specific node (e.g. fox-services) instead of taking
        # whichever answers first — a failover is right for a chat, wrong
        # for a measurement you intend to compare against a later run.
        pinned = (self.headers.get("X-Fox-Backend") or "").strip().lower()
        if pinned:
            chosen = [b for b in backends if b["name"].lower() == pinned]
            if not chosen:
                return self._json({"ok": False, "error": "unknown backend: %s" % pinned,
                                   "available": [b["name"] for b in backends]})
            backends = chosen + [b for b in backends if b["name"].lower() != pinned]
        errors = []
        for b in backends:
            try:
                conn, resp = _request(b, "POST", "/v1/chat/completions",
                                      body=body, headers=headers, timeout=READ_TIMEOUT)
            except Exception as e:
                errors.append("%s: %s" % (b["name"], type(e).__name__))
                continue
            if resp.status >= 500:
                errors.append("%s: HTTP %s" % (b["name"], resp.status))
                try:
                    conn.close()
                except Exception:
                    pass
                continue
            # Relay the upstream response verbatim (works for SSE and JSON).
            return self._relay(conn, resp, b["name"])
        # 200 with an error field: a browser-visible 5xx would log a console
        # error, and "no model" is an expected, handled state, not a failure.
        return self._json({"ok": False, "error": "no LLM backend online", "detail": errors})

    def _relay(self, conn, resp, backend_name):
        """Stream an upstream response to the client using chunked encoding."""
        ct = resp.getheader("Content-Type", "text/event-stream")
        self.send_response(resp.status)
        self.send_header("Content-Type", ct)
        self.send_header("Cache-Control", "no-store, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("X-Fox-Backend", backend_name)
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            while True:
                chunk = resp.read1(4096)
                if not chunk:
                    break
                self.wfile.write(b"%X\r\n" % len(chunk))
                self.wfile.write(chunk)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    if HOST in ("", "0.0.0.0", "::"):
        sys.stderr.write(
            "WARNING: serving on all interfaces — any host that can reach this "
            "port can use the /api/llm/* relay and the /api/selflearn/health "
            "loopback probe. Set HOST=127.0.0.1 to listen on loopback only.\n")
        sys.stderr.flush()
    with Server((HOST, PORT), Handler) as httpd:
        print(f"AI Agent Patterns & Guardrails → http://localhost:{PORT}")
        b = ", ".join("%s(%s)" % (x["name"], x["url"]) for x in _backend_list())
        print(f"LLM proxy: model={DEFAULT_MODEL} backends=[{b}]")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nbye")
