#!/usr/bin/env python3
"""Static server + local-LLM proxy for the AI Agent Patterns & Guardrails app.

Usage:
    python3 serve.py [port]     # default port 5175

The app is a no-build vanilla-JS SPA (same philosophy as the
"Agentic Knowledge Mapper" classic GUI). A server is needed because the
Design & Architecture tab fetches markdown documents from /design/.

Local model
-----------
The Architect Copilot talks to a local model through this server, never
directly from the browser.  This keeps a single origin (so the app works from
any LAN / Tailscale client), hides backend URLs, and lets us fail over between
backends transparently.

Endpoints (all read-only proxies, no secrets, no auth):

    GET  /api/llm/health   -> backend status + default model + readiness
    GET  /api/llm/models   -> model list from the active backend
    GET  /api/llm/config   -> non-secret configuration for the UI
    POST /api/llm/chat     -> streaming chat completion (SSE passthrough)

Backends are tried in order (Fox-Services first, then axiom).  If none are
reachable the proxy returns 503 and the UI falls back to a deterministic,
local analysis — the model is an accelerator, never a hard dependency.

Configuration (environment variables):

    FOX_LLM_URL    default http://localhost:8210   (Fox-Services gateway)
    FOX_LLM_NAME   default fox-services
    AXIOM_LLM_URL  default http://100.101.3.115:8210 (tailnet node, optional)
    AXIOM_LLM_NAME default axiom
    LLM_MODEL      default quai-qwen3.8-27b:latest
    LLM_CONNECT_TIMEOUT  default 5     (seconds, per backend)
    LLM_READ_TIMEOUT     default 600   (seconds, model may cold-load)
"""
import http.client
import http.server
import json
import os
import socketserver
import sys
import threading
import time
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5175
ROOT = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- backends
def _backend_list():
    """Return configured backends in failover order (primary first)."""
    out = []
    fox = os.environ.get("FOX_LLM_URL", "http://localhost:8210").rstrip("/")
    if fox:
        out.append({"name": os.environ.get("FOX_LLM_NAME", "fox-services"), "url": fox})
    ax = os.environ.get("AXIOM_LLM_URL", "http://100.101.3.115:8210").rstrip("/")
    if ax:
        out.append({"name": os.environ.get("AXIOM_LLM_NAME", "axiom"), "url": ax})
    return out


DEFAULT_MODEL = os.environ.get("LLM_MODEL", "quai-qwen3.8-27b:latest")
CONNECT_TIMEOUT = float(os.environ.get("LLM_CONNECT_TIMEOUT", "5"))
READ_TIMEOUT = float(os.environ.get("LLM_READ_TIMEOUT", "600"))


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


def probe(backend, timeout=2.5):
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
        results[i] = probe(b)

    threads = [threading.Thread(target=run, args=(i, b), daemon=True) for i, b in enumerate(backends)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=3.5)
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


# ---------------------------------------------------------------- server
class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

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
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter console
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- routing -----------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/llm/health":
            return self._json(health())
        if path == "/api/llm/config":
            return self._json({
                "proxy": True,
                "default_model": DEFAULT_MODEL,
                "backends": [b["name"] for b in _backend_list()],
                "connect_timeout": CONNECT_TIMEOUT,
                "read_timeout": READ_TIMEOUT,
            })
        if path == "/api/llm/models":
            return self._models()
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/llm/chat":
            return self._chat()
        self._json({"error": "not found"}, 404)

    # -- llm handlers ------------------------------------------------------
    def _models(self):
        for b in _backend_list():
            try:
                conn, resp = _request(b, "GET", "/v1/models", timeout=CONNECT_TIMEOUT)
                raw = resp.read()
                conn.close()
                if resp.status == 200:
                    data = json.loads(raw.decode("utf-8", "replace"))
                    ids = [m.get("id") for m in data.get("data", []) if isinstance(m, dict)]
                    return self._json({"backend": b["name"], "models": ids,
                                       "default_model": DEFAULT_MODEL})
            except Exception:
                continue
        return self._json({"backend": None, "models": [], "error": "no backend online"}, 503)

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
        return self._json({"error": "no LLM backend online", "detail": errors}, 503)

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
    with Server(("", PORT), Handler) as httpd:
        print(f"AI Agent Patterns & Guardrails → http://localhost:{PORT}")
        b = ", ".join("%s(%s)" % (x["name"], x["url"]) for x in _backend_list())
        print(f"LLM proxy: model={DEFAULT_MODEL} backends=[{b}]")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nbye")
