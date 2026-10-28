#!/usr/bin/env python3
"""Measured expansion: identical generation logic to expand_humanized.py,
plus per-chunk token ingress/egress and timing telemetry.

Ollama /api/generate with stream:false returns prompt_eval_count (input
tokens), eval_count (output tokens), and load/prompt-eval/eval durations.
One JSONL record is appended per finished chunk (accepted or best-effort),
so token ingress/egress is attributable per chapter and summable per book.

Usage: expand_measured.py <SRC.md> <DST.md> <CKPT.json> <METRICS.jsonl>
Env: EXPAND_MODEL, EXPAND_URL (same as expand_humanized.py).
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.request

MODEL = os.environ.get("EXPAND_MODEL", "qwen3.8:latest")
URL = os.environ.get("EXPAND_URL", "http://127.0.0.1:11434/api/generate")
PACK_AT = 100
MAX_CHARS = 4000
METRICS_FP = None

SYSTEM = """You are rewriting one section of a practitioner's book on agentic AI design patterns. Rewrite it in a natural human voice: vary sentence length, prefer concrete words, cut throat-clearing. But ALSO expand it substantially:
1. Detailed explanation: unpack every claim, move, and control — why it works, how it fails, worked mini-examples with concrete numbers taken from the text.
2. Formal mathematics: where a claim admits formalization (idempotency, retry budgets, quorum/dual-control rules, determinism, halt conditions, complexity, coverage), add Definition/Theorem/Proof blocks. Proofs must be real, step-by-step, and only formalize what the section actually claims.
Formatting rules (must follow exactly):
- Typeset ALL math with $...$ inline and $$...$$ display. NEVER use ```latex fences, \\textbf, \\begin/\\end, or \\[ \\].
- Mark blocks as **Definition n.**, **Theorem n.**, *Proof.* in markdown. End proofs with ∎.
- Keep markdown structure and heading levels. Keep all mermaid diagrams exactly. Keep counsel-verification bullets and their verdicts.
- Preserve every fact, number, unit, date, name and quotation from the original. Never invent empirical data, benchmarks, or citations. Output the section only, starting with its heading.
EVIDENCE RULES (non-negotiable):
- Annotate before you formalize. Every new claim must trace to the input
  section or be explicitly labelled illustrative ("for example", "say,",
  "illustrative"). Never present an invented ID, number, or schema field
  as if it came from the repository.
- Formalize only where a real invariant exists (a bound, a rule with a
  checkable condition, a defined protocol). If no theorem exists, write an
  *Argument.* or *Sketch.* block instead of a *Proof.* — a forced proof of
  nothing is worse than an honest argument.
MANDATORY OUTPUT REQUIREMENTS (non-negotiable):
- Your output MUST be LONGER than the input section (expand, do not summarize or merely paraphrase).
- Your output MUST contain at least one **Definition**, one **Theorem**, and one *Proof.* block with real $...$/$$...$$ mathematics.
- If no obvious theorem exists, formalize the section's core control as a state-transition rule and prove it preserves its invariant.
A short paraphrase without mathematics is a FAILED response."""


def atomic_sections(text):
    idx = [m.start() for m in re.finditer(r"(?m)^(#{1,2} )", text)]
    return [text[i:j].strip() for i, j in zip(idx, idx[1:] + [len(text)])]


def chunks(text):
    secs = atomic_sections(text)
    if len(secs) <= PACK_AT:
        return secs
    out, buf, blen = [], [], 0
    for s in secs:
        new_part = s.startswith("# ") and not s.startswith("## ")
        if buf and (blen + len(s) > MAX_CHARS or new_part):
            out.append("\n\n".join(buf))
            buf, blen = [], 0
        buf.append(s)
        blen += len(s)
    if buf:
        out.append("\n\n".join(buf))
    return out


PROMPT_VERSION = "2026-10-28.2-annotate-first"


def _passes_checks(sec, out):
    if len(out) < max(800, int(len(sec) * 1.2)):
        return False, "too short"
    for marker in ("**Definition", "**Theorem"):
        if marker not in out:
            return False, "missing " + marker.strip("*")
    if "*Proof" not in out and "*Argument" not in out and "*Sketch" not in out:
        return False, "missing reasoning block (*Proof*/*Argument*/*Sketch*)"
    return True, "ok"


def log_metric(rec):
    if METRICS_FP:
        METRICS_FP.write(json.dumps(rec, ensure_ascii=False) + "\n")
        METRICS_FP.flush()


def call(sec, idx, total):
    body = {"model": MODEL, "stream": False, "system": SYSTEM,
            "prompt": "Rewrite and expand this section:\n\n" + sec,
            "options": {"temperature": 0.7, "top_p": 0.95,
                        "num_ctx": 32768, "num_predict": 8192}}
    best, best_note = "", "none"
    attempts = []
    t_start = time.time()
    for a in range(4):
        t0 = time.time()
        try:
            req = urllib.request.Request(URL, json.dumps(body).encode(),
                                         {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=1500) as r:
                raw = json.load(r)
            out = raw["response"].strip()
            attempts.append({
                "n": a + 1,
                "wall_s": round(time.time() - t0, 1),
                "prompt_tokens": raw.get("prompt_eval_count", 0),
                "gen_tokens": raw.get("eval_count", 0),
                "load_ms": round(raw.get("load_duration", 0) / 1e6, 1),
                "prompt_ms": round(raw.get("prompt_eval_duration", 0) / 1e6, 1),
                "gen_ms": round(raw.get("eval_duration", 0) / 1e6, 1),
                "out_chars": len(out),
            })
        except Exception as e:
            print(f"  [retry {a + 1}] {e}", flush=True)
            attempts.append({"n": a + 1, "error": type(e).__name__})
            time.sleep(10)
            continue
        ok, note = _passes_checks(sec, out)
        if len(out) > len(best):
            best, best_note = out, note
        if ok:
            log_metric({"chunk": idx, "of": total,
                        "heading": sec.splitlines()[0][:80] if sec.splitlines() else "",
                        "in_chars": len(sec), "out_chars": len(out),
                        "accepted": True, "attempts": attempts,
                        "wall_s": round(time.time() - t_start, 1),
                        "t_end": time.time()})
            return out
        print(f"  [check failed: {note}; {len(out)}ch] nudging and retrying", flush=True)
        body["prompt"] = ("Your previous response FAILED the requirements (%s). "
                          "Respond again with a LONGER expansion that includes "
                          "**Definition**, **Theorem** and *Proof.* blocks with $ math. "
                          "Original section:\n\n" % note) + sec
    print(f"  [NEEDS-REVIEW kept best: {best_note}]", flush=True)
    if not best:
        raise RuntimeError("model call failed")
    log_metric({"chunk": idx, "of": total,
                "heading": sec.splitlines()[0][:80] if sec.splitlines() else "",
                "in_chars": len(sec), "out_chars": len(best),
                "accepted": False, "note": best_note, "attempts": attempts,
                "wall_s": round(time.time() - t_start, 1),
                "t_end": time.time()})
    return best


def main(src, dst, ckpt, metrics):
    global METRICS_FP
    secs = chunks(open(src, encoding="utf-8").read())
    print(f"{src}: {len(secs)} chunks", flush=True)
    raw = open(src, encoding="utf-8").read()
    sha = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    done = json.load(open(ckpt, encoding="utf-8")) if os.path.exists(ckpt) else {}
    meta = done.get("_meta")
    if meta and (meta.get("source_sha256") != sha or meta.get("model") != MODEL):
        print(f"REFUSING resume: checkpoint is for a different source or model "
              f"({meta.get('source_sha256', '?')[:12]} / {meta.get('model', '?')})", flush=True)
        sys.exit("re-run with a fresh checkpoint path")
    done["_meta"] = {"source_sha256": sha, "model": MODEL,
                      "prompt_version": PROMPT_VERSION}
    print(f"resuming: {len(done)} cached", flush=True)
    METRICS_FP = open(metrics, "a", encoding="utf-8")
    t_all = time.time()
    for i, s in enumerate(secs):
        if str(i) in done:
            continue
        t0 = time.time()
        done[str(i)] = call(s, i + 1, len(secs))
        json.dump(done, open(ckpt, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"  [{i + 1}/{len(secs)}] {len(s)}ch -> {len(done[str(i)])}ch in {time.time() - t0:.0f}s :: {s.splitlines()[0][:60]}", flush=True)
    METRICS_FP.close()
    out = "\n\n".join(done[str(i)] for i in range(len(secs)))
    header = ("<!-- Expanded: %s (temp 0.7). Human-voiced explanations + formal math ($/$$). "
              "Proofs formalize chapter claims only; verify before relying on them. -->\n\n" % MODEL)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, "w", encoding="utf-8").write(header + out.strip() + "\n")
    print(f"WROTE {dst} ({len(out)} chars) in {time.time() - t_all:.0f}s wall", flush=True)


main(*sys.argv[1:5])
