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
//
// Contents page numbers are the reason this script renders twice. Chrome does
// not implement CSS `target-counter` (it renders nothing) and page.pdf() can
// report no "which page did #anchor land on", so a first pass has no numbers to
// print — but Chrome does emit a /Dests name tree, one entry per in-document
// link, and that is exactly the information we need. So: render with 000
// placeholders, read the real pages back with tools/book_pdf.py, fill them in,
// render again, and re-read to prove the printed numbers and the actual link
// targets still agree. If filling the numbers reflowed the Contents, the two
// maps differ and we iterate to a fixed point (bounded, so a runaway layout
// fails the build instead of looping). Finally tools/book_pdf.py adds the
// sidebar bookmarks, which page.pdf() never emits, and the same read-back
// proves the rewrite dropped neither a link nor a destination.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(ROOT, "book", "agent-patterns-and-guardrails.html");
const MMD = join(ROOT, "js", "vendor", "mermaid.min.js");
const OUT = join(ROOT, "book", "Agentic-Design-Patterns-and-Guardrails.pdf");
const TMP = join(ROOT, "book", ".pass1.pdf"); // first pass, placeholder numbers
const SPEC = join(ROOT, "book", ".outline-spec.json");
const PDF_TOOL = join(ROOT, "tools", "book_pdf.py");
const PYTHON = process.env.PYTHON || "python3";

const TITLE = "Agentic Design Patterns & Guardrails";
const AUTHOR = "Harish Govardhan Damodar";
const MAX_PASSES = 4; // 1 placeholder pass + up to 3 settling passes

const executablePath = process.env.CHROME_PATH || undefined;

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  protocolTimeout: 600_000,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
});

async function die(message) {
  for (const f of [TMP, SPEC]) {
    try {
      rmSync(f, { force: true });
    } catch {}
  }
  await browser.close().catch(() => {});
  console.error(message);
  process.exit(1);
}

/** Read a rendered PDF: destination page per Contents link, link and outline counts. */
async function pdfInfo(pdf) {
  try {
    return JSON.parse(execFileSync(PYTHON, [PDF_TOOL, "dests", pdf], { encoding: "utf8", maxBuffer: 1 << 26 }));
  } catch (e) {
    await die(`tools/book_pdf.py could not read ${pdf}\n${(e.stdout || e.stderr || String(e)).trim()}`);
  }
}

const sameMap = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

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

if (rendered.errors.length) {
  await die(
    `${rendered.errors.length} of ${rendered.total} diagrams failed to render:\n  ` +
      rendered.errors.slice(0, 10).join("\n  ")
  );
}

const printPdf = (path) =>
  page.pdf({
    path,
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

/** Write the real page number into every <span class="pg"> of the Contents. */
const fillPageNumbers = (map) =>
  page.evaluate((pages) => {
    const missing = [];
    for (const el of document.querySelectorAll("[data-pg]")) {
      const id = el.getAttribute("data-pg");
      if (pages[id] == null) missing.push(id);
      else el.textContent = String(pages[id]);
    }
    return missing;
  }, map);

// --- pass 1: placeholders only, so nothing has a number to compare against ---
await printPdf(TMP);
const tocEntries = await page.evaluate(() => document.querySelectorAll("[data-pg]").length);
let pages = (await pdfInfo(TMP)).dests;
let missing = await fillPageNumbers(pages);
if (missing.length) {
  await die(
    `${missing.length} Contents entry/ies have no destination in Chrome's /Dests name tree ` +
      `so their page number cannot be read: ${missing.slice(0, 5).join(", ")}`
  );
}

// --- pass 2..n: render, read back, settle when printed numbers == real pages ---
let pass = 1;
let info = null;
for (; pass < MAX_PASSES; pass++) {
  await printPdf(OUT);
  info = await pdfInfo(OUT);
  if (sameMap(pages, info.dests)) break;
  pages = info.dests;
  missing = await fillPageNumbers(pages);
  if (missing.length || pass === MAX_PASSES - 1) {
    await die(
      `Contents page numbers did not settle after ${MAX_PASSES} passes — filling them keeps ` +
        `reflowing the Contents. Missing: ${missing.join(", ")}`
    );
  }
}
if (!info || !sameMap(pages, info.dests)) {
  await die(`Contents page numbers did not settle after ${MAX_PASSES} passes.`);
}

// --- sidebar bookmarks, which page.pdf() never emits -------------------------
const spec = await page.evaluate((map) => {
  const out = [];
  let part = null;
  for (const el of document.querySelectorAll("nav.toc [data-pg]")) {
    const id = el.getAttribute("data-pg");
    const node = { title: el.closest("a").querySelector(".t").textContent, page: map[id] };
    if (el.closest(".toc-part")) {
      part = { ...node, children: [] };
      out.push(part);
    } else if (part && id.startsWith("chapter-")) {
      part.children.push(node);
    } else {
      part = null; // front or back matter: a sibling of the parts, not of a chapter
      out.push(node);
    }
  }
  return out;
}, pages);

writeFileSync(SPEC, JSON.stringify(spec));
try {
  execFileSync(PYTHON, [PDF_TOOL, "outline", OUT, SPEC], { encoding: "utf8" });
} catch (e) {
  await die(`adding the PDF outline failed:\n${(e.stdout || e.stderr || String(e)).trim()}`);
}

// --- post-conditions: the rewrite must not have cost us a link, a page, a dest
const final = await pdfInfo(OUT);
const bookmarks = spec.reduce((n, x) => n + 1 + (x.children ? x.children.length : 0), 0);
const faults = [];
if (!sameMap(pages, final.dests)) faults.push("link destinations changed during the outline rewrite");
if (final.links !== tocEntries) faults.push(`${final.links} link annotations for ${tocEntries} Contents entries`);
if (final.outline !== bookmarks) faults.push(`${final.outline} bookmarks for ${bookmarks} expected`);
if (final.pages !== info.pages) faults.push(`page count changed (${info.pages} -> ${final.pages})`);
if (faults.length) await die(`post-conditions failed: ${faults.join("; ")}`);

for (const f of [TMP, SPEC]) {
  try {
    rmSync(f, { force: true });
  } catch {}
}
await browser.close();

const kb = Math.round(readFileSync(OUT).length / 1024);
console.log(`wrote ${OUT.replace(ROOT + "/", "")}  (${kb} KB)`);
console.log(`diagrams: ${rendered.total} rendered, 0 failed`);
console.log(
  `contents: ${tocEntries} entries, ${final.links} links, ${final.outline} bookmarks, ` +
    `page numbers verified in ${pass + 1} passes (${final.pages} pages)`
);
