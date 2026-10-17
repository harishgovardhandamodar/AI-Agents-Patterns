/* design.js — Design & Architecture tab: markdown+mermaid document reader.
   Pattern copied from the Agentic Knowledge Mapper classic GUI:
   fetch markdown from /design/, render with a small block renderer,
   mermaid fences -> <pre class="mermaid"> -> sequential render queue. */
"use strict";

let designState = { docs: [], current: null, srcMode: false };

function initDesign() {
  designState.docs = DESIGN_DOCS;
  el("designRail").innerHTML = groupHtml(designState.docs);
  const hash = (location.hash || "").replace("#design/", "");
  const start = designState.docs.find(d => d.id === hash) || designState.docs[0];
  designShow(start.id);
}

function groupHtml(docs) {
  const groups = uniq(docs.map(d => d.group));
  return groups.map(g => {
    const items = docs.filter(d => d.group === g);
    const totalDiag = items.reduce((n, d) => n + (d.id === "01-system-context" ? 3 : d.id === "02-uml" ? 4 : d.id === "03-control-flow" ? 4 : d.id === "04-guardrails" ? 4 : d.id === "05-data-model" ? 1 : 3), 0);
    return `<div class="rail-group">${escHtml(g)}</div>` + items.map(d => `
      <div class="design-doc-item" id="dd-${d.id}" onclick="designShow('${d.id}')">
        <div class="t">${escHtml(d.title)}</div>
        <div class="a">${escHtml(d.answers)}</div>
      </div>`).join("");
  }).join("");
}

async function designShow(id) {
  const doc = designState.docs.find(d => d.id === id);
  if (!doc) return;
  designState.current = doc;
  history.replaceState(null, "", "#design/" + id);
  document.querySelectorAll(".design-doc-item").forEach(i => i.classList.remove("active"));
  const rail = el("dd-" + id); if (rail) rail.classList.add("active");
  el("designTitle").textContent = doc.title;
  const box = el("designDoc");
  box.classList.remove("show-src");
  designState.srcMode = false;
  box.innerHTML = `<p class="muted">loading ${escHtml(doc.file)}…</p>`;
  try {
    const md = await (await fetch(doc.file)).text();
    const diagCount = (md.match(/```mermaid/g) || []).length;
    el("designMeta").textContent = `${doc.file} · ${md.split("\n").length} lines · ${diagCount} diagrams`;
    box.innerHTML = `<div class="md-rendered">${mdRender(md)}</div><pre class="md-src md-code">${escHtml(md)}</pre>`;
    designRenderOutline();
    mmRenderAll(box);
  } catch (e) {
    box.innerHTML = `<p class="muted">Failed to load ${escHtml(doc.file)}. Serve the app with <code>python3 serve.py</code>.</p>`;
  }
}

/* --- minimal block markdown renderer (headings, lists, tables, fences, quotes, code, hr) --- */
function mdRender(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0, inList = null, inOl = false;
  const inline = s => escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, a, b) => `<a href="${escHtml(b)}" target="_blank" rel="noopener">${a}</a>`);
  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } if (inOl) { out.push("</ol>"); inOl = false; } };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/);
    if (fence) {
      closeList();
      const lang = fence[2];
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1][0].repeat(3))) { buf.push(lines[i]); i++; }
      i++;
      const src = buf.join("\n");
      if (lang === "mermaid") out.push(diagramHtml(src));
      else out.push(`<pre class="md-code"><code>${escHtml(src)}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const lvl = h[1].length; out.push(`<h${lvl} id="h-${slug(h[2])}">${inline(h[2])}</h${lvl}>`); i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { closeList(); out.push("<hr>"); i++; continue; }
    if (/^\s*>\s?/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`); i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeList();
      const cells = l => l.replace(/^\s*\||\|\s*$/g, "").split("|").map(c => inline(c.trim()));
      out.push(`<table class="tbl"><thead><tr>${cells(line).map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>`);
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) { out.push(`<tr>${cells(lines[i]).map(c => `<td>${c}</td>`).join("")}</tr>`); i++; }
      out.push("</tbody></table>");
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { if (inOl) { out.push("</ol>"); inOl = false; } if (inList !== "ul") { closeList(); out.push("<ul>"); inList = "ul"; } out.push(`<li>${inline(ul[1])}</li>`); i++; continue; }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { if (inList) { out.push("</ul>"); inList = null; } if (!inOl) { closeList(); out.push("<ol>"); inOl = true; } out.push(`<li>${inline(ol[1])}</li>`); i++; continue; }
    if (!line.trim()) { closeList(); i++; continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return out.join("\n");
}
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

function designRenderOutline() {
  const box = el("designDoc");
  const hs = [...box.querySelectorAll("h1, h2, h3")];
  el("designOutline").innerHTML = hs.map((h, i) => {
    if (!h.id) h.id = "h-ol-" + i;
    return `<div class="ol-item ${h.tagName === "H3" ? "h3" : ""}" data-t="${h.id}" onclick="document.getElementById('${h.id}').scrollIntoView({behavior:'smooth',block:'start'})">${escHtml(h.textContent)}</div>`;
  }).join("");
  // scroll spy
  box.onscroll = debounce(() => {
    let active = hs[0];
    for (const h of hs) { if (h.getBoundingClientRect().top - box.getBoundingClientRect().top < 80) active = h; }
    document.querySelectorAll(".design-outline .ol-item").forEach(o => o.classList.toggle("active", o.dataset.t === (active && active.id)));
  }, 120);
}

function toggleDesignSrc() {
  designState.srcMode = !designState.srcMode;
  el("designDoc").classList.toggle("show-src", designState.srcMode);
}

tabLoaders.design = () => { /* rail already built */ };
