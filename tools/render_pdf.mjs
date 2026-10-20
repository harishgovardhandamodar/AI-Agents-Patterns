// Render the generated book HTML to PDF with headless Chrome.
//
//   node tools/render_pdf.mjs            (CHROME_PATH=/usr/bin/google-chrome to override)
//
// Reads book/agent-patterns-and-guardrails.html (written by tools/build_book.py),
// renders every <pre class="mermaid"> to a real SVG with the vendored Mermaid —
// the same engine the app uses, so the book's diagrams and the app's diagrams are
// produced by one code path and the build stays air-gap safe — then prints to PDF.
//
// Two invariants, both learned the hard way (js/app.js hit them first):
//   1. The HTML shell carries NO mermaid <script>. Loading it would auto-run on
//      `load` (startOnLoad defaults to true) and replace every node's text with
//      an SVG before we ever see it.
//   2. mermaid.run() REPLACES the node's textContent with the rendered SVG —
//      whose <style> then reads back as "#mermaid-...{font-family:...}". Always
//      re-seed each node from its data-src attribute before (re)rendering.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(ROOT, "book", "agent-patterns-and-guardrails.html");
const MMD = join(ROOT, "js", "vendor", "mermaid.min.js");
const OUT = join(ROOT, "book", "Agentic-Design-Patterns-and-Guardrails.pdf");

const TITLE = "Agentic Design Patterns & Guardrails";
const AUTHOR = "Harish Govardhan Damodar";

const executablePath = process.env.CHROME_PATH || undefined;

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  protocolTimeout: 600_000,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1240, height: 1754 }); // A4-ish at ~150dpi
await page.goto("file://" + HTML, { waitUntil: "load" });

// The shell has no mermaid script (see header), so nothing has rendered yet.
// The script registers a `load` listener for auto-start, but load already
// fired during goto — and startOnLoad:false makes it moot anyway.
await page.addScriptTag({ content: readFileSync(MMD, "utf8") });

const rendered = await page.evaluate(async () => {
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    flowchart: { htmlLabels: true, curve: "basis" },
  });
  await (document.fonts ? document.fonts.ready : Promise.resolve());

  const nodes = [...document.querySelectorAll("pre.mermaid")];
  const errors = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // Re-seed from the pristine copy; textContent may already be an SVG.
    const src = node.getAttribute("data-src") || node.textContent;
    node.removeAttribute("data-processed");
    node.textContent = src;
    try {
      await window.mermaid.run({ nodes: [node], suppressErrors: true });
      const svg = node.querySelector("svg");
      if (!svg) {
        errors.push(`diagram ${i + 1}: no <svg> after render`);
      } else {
        // Mermaid stamps an inline max-width in px; let the print CSS size it.
        svg.removeAttribute("height");
        svg.setAttribute("style", "max-width:100%;height:auto");
      }
    } catch (e) {
      errors.push(`diagram ${i + 1}: ${String(e).slice(0, 200)}`);
    }
  }
  await (document.fonts ? document.fonts.ready : Promise.resolve());
  return { total: nodes.length, errors };
});

await page.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: false,
  margin: { top: "20mm", bottom: "18mm", left: "16mm", right: "16mm" },
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:7.5px;width:100%;text-align:center;color:#8a94a0;">
      ${TITLE} &middot; ${AUTHOR}</div>`,
  footerTemplate: `<div style="font-size:7.5px;width:100%;text-align:center;color:#8a94a0;">
      <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
});

await browser.close();

const kb = Math.round(readFileSync(OUT).length / 1024);
console.log(`wrote ${OUT.replace(ROOT + "/", "")}  (${kb} KB)`);
console.log(`diagrams: ${rendered.total} rendered, ${rendered.errors.length} failed`);
for (const e of rendered.errors.slice(0, 10)) console.log("  " + e);
process.exit(rendered.errors.length ? 1 : 0);
