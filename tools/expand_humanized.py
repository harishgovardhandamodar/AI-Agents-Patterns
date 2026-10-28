#!/usr/bin/env python3
"""Expand one book section-by-section with qwen3.6:27b. Resumable via checkpoint.
Usage: expand_book.py <SRC.md> <DST.md> <CKPT.json>
Chunking identical to pilot split; packs only when >100 atomic sections."""
import json, os, re, sys, time, urllib.request

MODEL = os.environ.get("EXPAND_MODEL", "qwen3.6:27b")
URL = os.environ.get("EXPAND_URL", "http://127.0.0.1:11434/api/generate")
PACK_AT = 100
MAX_CHARS = 4000

SYSTEM = """You are rewriting one section of a practitioner's book on agentic AI design patterns. Rewrite it in a natural human voice: vary sentence length, prefer concrete words, cut throat-clearing. But ALSO expand it substantially:
1. Detailed explanation: unpack every claim, move, and control — why it works, how it fails, worked mini-examples with concrete numbers taken from the text.
2. Formal mathematics: where a claim admits formalization (idempotency, retry budgets, quorum/dual-control rules, determinism, halt conditions, complexity, coverage), add Definition/Theorem/Proof blocks. Proofs must be real, step-by-step, and only formalize what the section actually claims.
Formatting rules (must follow exactly):
- Typeset ALL math with $...$ inline and $$...$$ display. NEVER use ```latex fences, \\textbf, \\begin/\\end, or \\[ \\].
- Mark blocks as **Definition n.**, **Theorem n.**, *Proof.* in markdown. End proofs with ∎.
- Keep markdown structure and heading levels. Keep all mermaid diagrams exactly. Keep counsel-verification bullets and their verdicts.
- Preserve every fact, number, unit, date, name and quotation from the original. Never invent empirical data, benchmarks, or citations. Output the section only, starting with its heading.
MANDATORY OUTPUT REQUIREMENTS (non-negotiable):
- Your output MUST be LONGER than the input section (expand, do not summarize or merely paraphrase).
- Your output MUST contain at least one **Definition**, one **Theorem**, and one *Proof.* block with real $...$/$$...$$ mathematics.
- If no obvious theorem exists, formalize the section's core control as a state-transition rule and prove it preserves its invariant.
A short paraphrase without mathematics is a FAILED response."""

def atomic_sections(text):
    idx = [m.start() for m in re.finditer(r'(?m)^(#{1,2} )', text)]
    return [text[i:j].strip() for i, j in zip(idx, idx[1:] + [len(text)])]

def chunks(text):
    secs = atomic_sections(text)
    if len(secs) <= PACK_AT:
        return secs
    out, buf, blen = [], [], 0
    for s in secs:
        new_part = s.startswith("# ") and not s.startswith("## ")
        if buf and (blen + len(s) > MAX_CHARS or new_part):
            out.append("\n\n".join(buf)); buf, blen = [], 0
        buf.append(s); blen += len(s)
    if buf:
        out.append("\n\n".join(buf))
    return out

def _passes_checks(sec, out):
    if len(out) < max(800, int(len(sec) * 1.2)):
        return False, "too short"
    for marker in ("**Definition", "**Theorem", "*Proof"):
        if marker not in out:
            return False, "missing " + marker.strip("*")
    return True, "ok"


def call(sec, retries=4):
    body = {"model": MODEL, "stream": False, "system": SYSTEM,
            "prompt": "Rewrite and expand this section:\n\n" + sec,
            "options": {"temperature": 0.7, "top_p": 0.95,
                        "num_ctx": 32768, "num_predict": 8192}}
    best, best_note = "", "none"
    for a in range(retries):
        try:
            req = urllib.request.Request(URL, json.dumps(body).encode(),
                                         {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=1500) as r:
                out = json.load(r)["response"].strip()
        except Exception as e:
            print(f"  [retry {a+1}] {e}", flush=True)
            time.sleep(10)
            continue
        ok, note = _passes_checks(sec, out)
        if len(out) > len(best):
            best, best_note = out, note
        if ok:
            return out
        print(f"  [check failed: {note}; {len(out)}ch] nudging and retrying", flush=True)
        body["prompt"] = ("Your previous response FAILED the requirements (%s). "
                          "Respond again with a LONGER expansion that includes "
                          "**Definition**, **Theorem** and *Proof.* blocks with $ math. "
                          "Original section:\n\n" % note) + sec
    print(f"  [NEEDS-REVIEW kept best: {best_note}]", flush=True)
    if not best:
        raise RuntimeError("model call failed")
    return best

def main(src, dst, ckpt):
    secs = chunks(open(src, encoding="utf-8").read())
    print(f"{src}: {len(secs)} chunks", flush=True)
    done = json.load(open(ckpt, encoding="utf-8")) if os.path.exists(ckpt) else {}
    print(f"resuming: {len(done)} cached", flush=True)
    for i, s in enumerate(secs):
        if str(i) in done:
            continue
        t0 = time.time()
        done[str(i)] = call(s)
        json.dump(done, open(ckpt, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"  [{i+1}/{len(secs)}] {len(s)}ch -> {len(done[str(i)])}ch in {time.time()-t0:.0f}s :: {s.splitlines()[0][:60]}", flush=True)
    out = "\n\n".join(done[str(i)] for i in range(len(secs)))
    header = ("<!-- Expanded: %s (temp 0.7). Human-voiced explanations + formal math ($/$$). "
              "Proofs formalize chapter claims only; verify before relying on them. -->\n\n" % MODEL)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, "w", encoding="utf-8").write(header + out.strip() + "\n")
    print(f"WROTE {dst} ({len(out)} chars)", flush=True)

main(*sys.argv[1:4])
