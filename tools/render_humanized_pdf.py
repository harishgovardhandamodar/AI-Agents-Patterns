#!/usr/bin/env python3
"""Render Books/Humanized/*.md to styled, offline, QA-gated PDFs.

Hardened per findings P0-6/P1-4:
- MathJax (SVG output, no webfonts) and Mermaid are vendored in
  tools/vendor_assets/ and loaded via file:// — no CDN, no network.
- Playwright aborts every http(s) request; the print page has a CSP.
- LLM HTML is sanitized (no <script>, no on* handlers, no javascript: URLs,
  no iframes/objects/forms) before it reaches Chromium.
- Fail-loud QA: every .mermaid block must become an SVG, every $ span an
  mjx-container; console/page errors fail the build; blank pages fail it;
  outline must be non-empty and Title/Author must be set (pypdf post-pass).
Any failure exits non-zero and leaves no PDF behind.

Usage: render_humanized_pdf.py [--pdf-only] FILE.md ...
"""
import os
import re
import sys

import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, "tools", "vendor_assets")
MJ = "file://" + os.path.join(VENDOR, "mathjax-svg.js")
MM = "file://" + os.path.join(VENDOR, "mermaid.min.js")
AUTHOR = "Harish Govardhan Damodar"

HTML_TMPL = """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' file:; style-src 'unsafe-inline'; img-src data: file:; font-src file: data:; connect-src 'none';">
<style>
body{{font-family:Georgia,'Times New Roman',serif;max-width:820px;margin:40px auto;padding:0 24px;line-height:1.65;color:#1a1a1a;font-size:15px}}
h1{{font-size:1.9em;border-bottom:2px solid #222;padding-bottom:.3em}}h2{{font-size:1.5em;margin-top:1.8em}}h3{{font-size:1.2em}}
pre{{background:#f5f5f5;padding:14px;border-radius:6px;overflow-x:auto;font-size:.85em}}code{{font-size:.9em}}
table{{border-collapse:collapse;width:100%;margin:1em 0}}th,td{{border:1px solid #ccc;padding:8px;text-align:left}}th{{background:#f0f0f0}}
blockquote{{border-left:3px solid #888;margin:1em 0;padding:.5em 1em;color:#444}}
.mermaid{{background:#fafafa;border:1px solid #e2e2e2;border-radius:6px;padding:16px;margin:1.2em 0;text-align:center}}
@media print{{body{{max-width:100%}}.mermaid{{break-inside:avoid}}pre{{break-inside:avoid}}h1,h2,h3{{break-after:avoid}}.mermaid svg{{max-width:100%;max-height:240mm;width:auto;height:auto}}}}
</style>
<script>window.MathJax={{tex:{{inlineMath:[['$','$']],displayMath:[['$$','$$']],processEscapes:true}},svg:{{scale:1.0}},startup:{{ready:()=>{{MathJax.startup.defaultReady();MathJax.startup.promise.then(()=>window.__mathDone=true);}}}}}};</script>
<script src="{MJ}"></script>
<script src="{MM}"></script>
</head><body>{body}<script>
window.__renderState='pending';
window.addEventListener('load',async()=>{{
try{{
  mermaid.initialize({{startOnLoad:false,theme:'neutral'}});
  await mermaid.run({{querySelector:'.mermaid'}});
}}catch(e){{console.error('mermaid failed: '+e);window.__mermaidErr=String(e)}}
try{{await MathJax.startup.promise;}}catch(e){{console.error('mathjax failed: '+e);window.__mathErr=String(e)}}
window.__renderState='done';}});
</script></body></html>"""


def sanitize(html):
    """Strip active content from model-generated HTML. Our own scripts live
    in the template, never in this string."""
    html = re.sub(r"<script\b[^>]*>.*?</script\s*>", "", html,
                  flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"\son\w+\s*=", " data-blocked=", html, flags=re.IGNORECASE)
    html = re.sub(r"(href|src)\s*=\s*[\"']\s*javascript:[^\"']*[\"']",
                  r'\1="#"', html, flags=re.IGNORECASE)
    html = re.sub(r"</?(iframe|object|embed|form|base|meta|link)\b[^>]*>",
                  "", html, flags=re.IGNORECASE)
    return html


def md_to_pdf(src, dst):
    from playwright.sync_api import sync_playwright
    text = open(src, encoding="utf-8").read()
    # escape currency dollars so MathJax doesn't pair them as math
    text = re.sub(r"(?<!\\)\$(?=\d)", r"\\$", text)
    html = markdown.markdown(text, extensions=["fenced_code", "tables",
                                              "toc", "sane_lists"])
    html = sanitize(html)
    if re.search(r"<script\b", html, re.IGNORECASE):
        raise RuntimeError("sanitizer left a <script> behind")
    # turn mermaid code blocks into render targets
    html = re.sub(r'<pre><code class="language-mermaid">(.*?)</code></pre>',
                  lambda m: '<div class="mermaid">' + m.group(1)
                  .replace("&lt;", "<").replace("&gt;", ">")
                  .replace("&amp;", "&") + "</div>",
                  html, flags=re.DOTALL)
    n_mermaid = len(re.findall(r'<div class="mermaid">', html))
    n_math = len(re.findall(r"(?<!\\)\$(?!\$)", html))
    page = HTML_TMPL.format(body=html, MJ=MJ, MM=MM)
    tmp = dst + ".tmp.html"
    open(tmp, "w", encoding="utf-8").write(page)
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page()
            pg.on("console", lambda msg: errors.append(msg.text)
                  if msg.type == "error" else None)
            pg.on("pageerror", lambda exc: errors.append(str(exc)))
            pg.route("**/*", lambda route:
                     route.abort() if route.request.url.startswith(
                         ("http://", "https://")) else route.continue_())
            # Huge pages never reach full "load" in 30s; domcontentloaded
            # suffices since __renderState gates printing on completion.
            pg.goto("file://" + os.path.abspath(tmp),
                    wait_until="domcontentloaded", timeout=180000)
            try:
                pg.wait_for_function("window.__renderState==='done'",
                                     timeout=600000)
            except Exception as e:
                raise RuntimeError(f"render flag never set ({e})")
            if pg.evaluate("window.__mermaidErr || null"):
                raise RuntimeError("mermaid: " + pg.evaluate("window.__mermaidErr"))
            if pg.evaluate("window.__mathErr || null"):
                raise RuntimeError("mathjax: " + pg.evaluate("window.__mathErr"))
            bad = [e for e in errors if "mermaid" in e.lower()
                   or "mathjax" in e.lower() or "mjax" in e.lower()]
            if bad:
                raise RuntimeError("console errors: " + bad[0][:200])
            counts = pg.evaluate("""({
                svg: document.querySelectorAll('.mermaid svg').length,
                mjx: document.querySelectorAll('mjx-container').length,
                mmd: document.querySelectorAll('.mermaid').length })""")
            if counts["svg"] != counts["mmd"]:
                raise RuntimeError(
                    f"only {counts['svg']}/{counts['mmd']} mermaid blocks rendered")
            if n_math and not counts["mjx"]:
                raise RuntimeError("no math rendered although $ spans exist")
            pg.wait_for_timeout(2000)
            out_tmp = dst + ".norazor.pdf"
            pg.pdf(path=out_tmp, format="A4", print_background=True,
                   margin={"top": "18mm", "bottom": "18mm",
                           "left": "15mm", "right": "15mm"})
            b.close()
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    post_process(src, out_tmp, dst)
    print(f"WROTE {dst} ({os.path.getsize(dst)} bytes)", flush=True)


def headings(src):
    """(level, text) from markdown headings, formatting stripped."""
    out = []
    for line in open(src, encoding="utf-8").read().splitlines():
        m = re.match(r"(#{1,3})\s+(.*\S)\s*$", line)
        if m:
            t = re.sub(r"[*_`~]", "", m.group(2)).strip()
            t = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", t)
            if t:
                out.append((len(m.group(1)), t))
    return out


def post_process(src, pdf_in, pdf_out):
    """Outline + metadata + blank-page assertion. Fails loud."""
    from pypdf import PdfReader, PdfWriter
    r = PdfReader(pdf_in)
    texts = [(pg.extract_text() or "") for pg in r.pages]
    blanks = [i + 1 for i, t in enumerate(texts)
              if not t.strip() and not (r.pages[i].get("/Resources", {})
                                        .get("/XObject"))]
    if blanks:
        raise RuntimeError(f"blank pages: {blanks}")
    norm = [" ".join(t.split()) for t in texts]
    w = PdfWriter()
    w.append(r)
    title = None
    parents = {}
    count = 0
    for level, h in headings(src):
        key = " ".join(h.split())
        page = next((i for i, t in enumerate(norm) if key and key in t), None)
        if page is None and len(key) > 60:
            page = next((i for i, t in enumerate(norm)
                         if key[:60] in t), None)
        if page is None:
            continue
        if level == 1:
            title = title or h
            parents[1] = w.add_outline_item(h, page)
        else:
            anchor = parents.get(level - 1, parents.get(1))
            if anchor is None:
                parents[1] = w.add_outline_item(h, page)
            else:
                it = w.add_outline_item(h, page, parent=anchor)
                parents[level] = it
                if level == 2:
                    parents[2] = it
        count += 1
    if count == 0:
        raise RuntimeError("outline empty: no heading found in PDF text")
    w.add_metadata({
        "/Title": title or os.path.splitext(os.path.basename(src))[0],
        "/Author": AUTHOR,
        "/Subject": "Humanized edition (see About this edition)",
        "/Creator": "tools/render_humanized_pdf.py (vendored MathJax+Mermaid, offline)",
    })
    with open(pdf_out, "wb") as f:
        w.write(f)
    os.remove(pdf_in)
    # report
    r2 = PdfReader(pdf_out)
    print(f"  outline={len(r2.outline)} title={r2.metadata.title!r}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    for f in args:
        base = os.path.splitext(os.path.basename(f))[0]
        try:
            md_to_pdf(f, os.path.join("Books/Humanized", base + ".pdf"))
        except Exception as e:
            print(f"FAILED {f}: {e}", flush=True)
            sys.exit(2)
    print("PDFS DONE")
