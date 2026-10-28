#!/usr/bin/env python3
"""Convert LaTeX \\begin{cases|aligned|pmatrix} blocks to plain $/$$ math.

Project convention: typeset ALL math with $...$ / $$...$$ only. The model
sometimes emits \\begin{cases} (piecewise rules) or \\begin{pmatrix}
(column vectors). This rewrites them losslessly into flat notation:
  cases/aligned  -> "A if cond; B otherwise" (; -separated, & dropped)
  pmatrix        -> "(a, b, c, d)" tuple
Usage: clean_math.py FILE [FILE ...]  (edits in place, prints counts)
"""
import re
import sys

PAT = re.compile(r"\\begin\{(cases|aligned|pmatrix)\}(.*?)\\end\{\1\}", re.DOTALL)


def conv_cases(body):
    body = re.sub(r"\\\\\[.*?\]", r"\\\\", body)
    parts = []
    for row in body.split("\\\\"):
        row = row.strip().strip(",")
        if not row:
            continue
        cells = [c.strip() for c in row.split("&")]
        parts.append(" ".join(c for c in cells if c))
    return "; ".join(parts)


def conv_pmatrix(body):
    cells = [c.strip() for c in re.split(r"\\\\|&", body) if c.strip()]
    return "(" + ", ".join(cells) + ")"


def clean(text):
    n = [0]

    def sub(m):
        n[0] += 1
        kind, body = m.group(1), m.group(2)
        if kind == "pmatrix":
            return conv_pmatrix(body)
        return conv_cases(body)

    return PAT.sub(sub, text), n[0]


for path in sys.argv[1:]:
    src = open(path, encoding="utf-8").read()
    out, n = clean(src)
    if n:
        open(path, "w", encoding="utf-8").write(out)
    print(f"{path}: {n} blocks converted")
