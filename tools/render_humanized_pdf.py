#!/usr/bin/env python3
"""Render expanded Books/Humanized/*.md to styled HTML + print to PDF via
playwright chromium. Waits for MathJax ($/$$) and mermaid before printing."""
import re, sys, os
import markdown
from playwright.sync_api import sync_playwright

HTML_TMPL = """<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
body{{font-family:Georgia,'Times New Roman',serif;max-width:820px;margin:40px auto;padding:0 24px;line-height:1.65;color:#1a1a1a;font-size:15px}}
h1{{font-size:1.9em;border-bottom:2px solid #222;padding-bottom:.3em}}h2{{font-size:1.5em;margin-top:1.8em}}h3{{font-size:1.2em}}
pre{{background:#f5f5f5;padding:14px;border-radius:6px;overflow-x:auto;font-size:.85em}}code{{font-size:.9em}}
table{{border-collapse:collapse;width:100%;margin:1em 0}}th,td{{border:1px solid #ccc;padding:8px;text-align:left}}th{{background:#f0f0f0}}
blockquote{{border-left:3px solid #888;margin:1em 0;padding:.5em 1em;color:#444}}
.mermaid{{background:#fafafa;border:1px solid #e2e2e2;border-radius:6px;padding:16px;margin:1.2em 0;text-align:center}}
@media print{{body{{max-width:100%}}.mermaid{{break-inside:avoid}}pre{{break-inside:avoid}}h1,h2,h3{{break-after:avoid}}}}
</style>
<script>window.MathJax={{tex:{{inlineMath:[['$','$']],displayMath:[['$$','$$']],processEscapes:true}},chtml:{{scale:1.0}},startup:{{ready:()=>{{MathJax.startup.defaultReady();MathJax.startup.promise.then(()=>window.__mathDone=true);}}}}}};</script>
<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
</head><body>{body}<script>
window.__renderState='pending';
window.addEventListener('load',async()=>{{
try{{
  mermaid.initialize({{startOnLoad:false,theme:'neutral'}});
  await mermaid.run({{querySelector:'.mermaid'}});
}}catch(e){{console.log('mermaid skipped:',e)}}
try{{await MathJax.startup.promise;}}catch(e){{}}
window.__renderState='done';}});
</script></body></html>"""

def md_to_pdf(src, dst):
    text = open(src, encoding="utf-8").read()
    # escape currency dollars so MathJax doesn't pair them as math
    text = re.sub(r'(?<!\\)\$(?=\d)', r'\\$', text)
    html = markdown.markdown(text, extensions=["fenced_code", "tables", "toc", "sane_lists"])
    # turn mermaid code blocks into render targets
    html = re.sub(r'<pre><code class="language-mermaid">(.*?)</code></pre>',
                  lambda m: '<div class="mermaid">' + m.group(1).replace('&lt;','<').replace('&gt;','>').replace('&amp;','&') + '</div>',
                  html, flags=re.DOTALL)
    page = HTML_TMPL.format(body=html)
    tmp = dst + ".tmp.html"
    open(tmp, "w", encoding="utf-8").write(page)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto("file://" + os.path.abspath(tmp))
        try:
            pg.wait_for_function("window.__renderState==='done'", timeout=60000)
        except Exception as e:
            print(f"  render wait timed out ({e}), printing anyway", flush=True)
        pg.wait_for_timeout(3000)
        pg.pdf(path=dst, format="A4", print_background=True,
               margin={"top": "18mm", "bottom": "18mm", "left": "15mm", "right": "15mm"})
        b.close()
    os.remove(tmp)
    print(f"WROTE {dst} ({os.path.getsize(dst)} bytes)", flush=True)

for f in sys.argv[1:]:
    base = os.path.splitext(os.path.basename(f))[0]
    md_to_pdf(f, os.path.join("Books/Humanized", base + ".pdf"))
print("PDFS DONE")
