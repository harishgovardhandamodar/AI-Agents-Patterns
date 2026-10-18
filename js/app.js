/* app.js — shell: tabs, theme, data load, mermaid engine, zoom viewer.
   Same architecture as the Agentic Knowledge Mapper classic GUI:
   one sequential mermaid render queue, CSS-variable theming, no build step. */

"use strict";

/* ---------------- global data ---------------- */
let DATA = { patterns: null, scenarios: null, traces: null, cascades: null };
const DESIGN_DOCS = [
  { id: "01-system-context", file: "design/01-system-context.md", title: "System Context", group: "Architecture", answers: "What the system is, its actors and trust boundaries" },
  { id: "02-uml", file: "design/02-uml.md", title: "UML — Components & Classes", group: "Architecture", answers: "Static structure: components, classes, interfaces" },
  { id: "03-control-flow", file: "design/03-control-flow.md", title: "Control Flow & Runtime", group: "Dynamics", answers: "Agent loop, sequences, state machine, trace pipeline" },
  { id: "04-guardrails", file: "design/04-guardrails.md", title: "Financial Guardrail Architecture", group: "Safety", answers: "Spend controls, dual control, prompt-injection defense" },
  { id: "05-data-model", file: "design/05-data-model.md", title: "Data Model", group: "Architecture", answers: "Entities: patterns, scenarios, traces, analyses" },
  { id: "06-threat-model", file: "design/06-threat-model.md", title: "Threat Model & Protections Map", group: "Safety", answers: "STRIDE view, attack trees, defense-in-depth map" },
  { id: "07-architect-analysis", file: "design/07-architect-analysis.md", title: "Architect Value Map & Cascade Taxonomy", group: "Architecture", answers: "Why the app advises, not just describes — and the four cascade classes" }
];

/* ---------------- theme ---------------- */
function toggleTheme() {
  const light = document.documentElement.classList.toggle("light");
  try { localStorage.setItem("aap.theme", light ? "light" : "dark"); } catch (e) {}
  // re-render every diagram with the new theme palette
  mmRenderAll();
}
(function initTheme() {
  let t = "dark";
  try { t = localStorage.getItem("aap.theme") || "dark"; } catch (e) {}
  if (t === "light") document.documentElement.classList.add("light");
})();

/* ---------------- reading preferences: density + font size ----------------
   Persisted in localStorage; applied as data attributes on <html> so every
   pane (including re-rendered ones) follows without extra render code. */
const UX_STORE = "aap.ux.v1";
const uxPrefs = (function () {
  const dflt = { density: "comfortable", fs: 13 };
  try { return Object.assign({}, dflt, JSON.parse(localStorage.getItem(UX_STORE) || "{}")); }
  catch (e) { return Object.assign({}, dflt); }
})();

function uxApply() {
  const root = document.documentElement;
  root.dataset.uxdensity = uxPrefs.density === "compact" ? "compact" : "comfortable";
  root.dataset.uxfs = [13, 14, 15, 16].indexOf(Number(uxPrefs.fs)) >= 0 ? String(uxPrefs.fs) : "13";
}
function uxSave() {
  try { localStorage.setItem(UX_STORE, JSON.stringify(uxPrefs)); } catch (e) {}
  uxApply();
  uxPaintPanel();
}
function uxSetDensity(d) { uxPrefs.density = d === "compact" ? "compact" : "comfortable"; uxSave(); }
function uxSetFs(fs) { uxPrefs.fs = Math.min(16, Math.max(13, Number(fs) || 13)); uxSave(); }
uxApply();

function uxPanelToggle(force) {
  let p = document.getElementById("uxPanel");
  if (!p) {
    p = document.createElement("div");
    p.id = "uxPanel";
    p.className = "ux-panel";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Display preferences");
    document.body.appendChild(p);
  }
  p.classList.toggle("open", force == null ? !p.classList.contains("open") : !!force);
  const btn = document.getElementById("uxBtn");
  if (btn) btn.setAttribute("aria-expanded", p.classList.contains("open") ? "true" : "false");
  if (p.classList.contains("open")) { uxPaintPanel(); const f = p.querySelector("input"); if (f) f.focus(); }
  else if (btn) btn.focus();
}
function uxPaintPanel() {
  const p = document.getElementById("uxPanel");
  if (!p || !p.classList.contains("open")) return;
  const dens = ["comfortable", "compact"].map(d =>
    `<label class="ux-opt"><input type="radio" name="uxdens" value="${d}" ${uxPrefs.density === d ? "checked" : ""} onchange="uxSetDensity(this.value)">` +
    `<span><b>${d === "comfortable" ? "Comfortable" : "Compact"}</b><i>${d === "comfortable" ? "roomy cards, easier scanning" : "denser lists, more on screen"}</i></span></label>`).join("");
  const fss = [13, 14, 15, 16].map(f =>
    `<label class="ux-opt"><input type="radio" name="uxfs" value="${f}" ${Number(uxPrefs.fs) === f ? "checked" : ""} onchange="uxSetFs(this.value)">` +
    `<span><b style="font-size:${f}px">${f}px</b><i>${f === 13 ? "default" : f < 15 ? "easier reading" : "large text"}</i></span></label>`).join("");
  p.innerHTML = '<div class="ux-head"><b>Display</b>' +
    '<button class="iconbtn" type="button" onclick="uxPanelToggle(false)" aria-label="Close display preferences">✕</button></div>' +
    '<div class="ux-sec">Density</div>' + dens +
    '<div class="ux-sec">Text size</div>' + fss +
    '<div class="muted small" style="margin-top:8px">Saved in this browser; applies to every tab.</div>';
}
document.addEventListener("mousedown", function (e) {
  const p = document.getElementById("uxPanel");
  if (!p || !p.classList.contains("open")) return;
  if (p.contains(e.target) || (e.target.closest && e.target.closest("#uxBtn"))) return;
  p.classList.remove("open");
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    const p = document.getElementById("uxPanel");
    if (p && p.classList.contains("open")) uxPanelToggle(false);
  }
});

/* ---------------- tabs ---------------- */
let currentTab = "overview";
const tabLoaders = {}; // filled by per-tab scripts

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".app-tab").forEach(t => {
    const on = t.dataset.tab === tab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll(".pane").forEach(p => p.classList.remove("visible"));
  const pane = document.getElementById(tab + "Pane");
  if (pane) pane.classList.add("visible");
  if (tabLoaders[tab]) tabLoaders[tab]();
  try { location.hash = tab; } catch (e) {}
}

/* keyboard navigation inside the tab bar (role=tablist): arrows move,
   Enter/Space activate — same behaviour screen readers expect. */
function tabKeyNav(e) {
  const tabs = [...document.querySelectorAll(".app-tab")];
  const i = tabs.indexOf(e.target.closest(".app-tab"));
  if (i < 0) return;
  let j = -1;
  if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
  else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") j = 0;
  else if (e.key === "End") j = tabs.length - 1;
  if (j >= 0) {
    e.preventDefault();
    switchTab(tabs[j].dataset.tab);
    tabs[j].focus();
  }
}

document.addEventListener("keydown", e => { if (e.target.closest && e.target.closest(".app-tabs")) tabKeyNav(e); });

/* ---------------- helpers ---------------- */
function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function el(id) { return document.getElementById(id); }
function uniq(a) { return [...new Set(a)]; }
function fmtUsd(v) { return "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
/* ---------------- notifications (v2: announced, actionable, logged) ----------------
   showNotif(msg) still works exactly as before. Optional second argument:
   { kind: "info"|"ok"|"warn"|"error", ttl: ms,
     actions: [{ label, fn, primary }] }  — actions get extra time on screen. */
const notifHistory = [];   /* newest first: { t, msg, kind } */
let notifUnread = 0;

function notifBox() {
  let n = document.getElementById("notifBox");
  if (!n) {
    n = document.createElement("div");
    n.id = "notifBox";
    n.className = "notif-box";
    n.setAttribute("role", "log");
    n.setAttribute("aria-live", "polite");
    n.setAttribute("aria-label", "Notifications");
    document.body.appendChild(n);
  }
  return n;
}

function showNotif(msg, opts) {
  opts = opts || {};
  const kind = opts.kind || "info";
  const acts = (opts.actions || []).filter(a => a && a.label);
  const ttl = opts.ttl != null ? opts.ttl
    : kind === "error" ? 9000
    : acts.length ? 7000 : 4200;

  const n = notifBox();
  while (n.children.length >= 4) n.firstChild.remove(); /* cap the stack */

  const d = document.createElement("div");
  d.className = "notif notif-" + kind;
  d.setAttribute("role", kind === "error" ? "alert" : "status");

  const m = document.createElement("span");
  m.className = "notif-msg";
  m.textContent = msg;
  d.appendChild(m);

  acts.forEach(a => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "notif-act" + (a.primary ? " primary" : "");
    b.textContent = a.label;
    b.addEventListener("click", () => { dismiss(); try { a.fn && a.fn(); } catch (e) { console.warn(e); } });
    d.appendChild(b);
  });

  const x = document.createElement("button");
  x.type = "button";
  x.className = "notif-x";
  x.setAttribute("aria-label", "Dismiss notification");
  x.textContent = "×";
  x.addEventListener("click", () => dismiss());
  d.appendChild(x);

  /* dismiss timer — pauses while the toast is hovered or focused */
  let timer = null, remain = ttl, start = 0;
  function arm() { if (remain <= 0 || timer) return; start = Date.now(); timer = setTimeout(dismiss, remain); }
  function pause() { if (!timer) return; clearTimeout(timer); timer = null; remain -= Date.now() - start; }
  function dismiss() {
    if (timer) clearTimeout(timer);
    timer = null; remain = 0;
    d.classList.add("out");
    setTimeout(() => d.remove(), 160);
    if (d.contains(document.activeElement)) x.focus();
  }
  d.addEventListener("mouseenter", pause);
  d.addEventListener("mouseleave", arm);
  d.addEventListener("focusin", pause);
  d.addEventListener("focusout", arm);

  n.appendChild(d);
  arm();

  /* history + topbar badge */
  notifHistory.unshift({ t: Date.now(), msg: msg, kind: kind });
  if (notifHistory.length > 30) notifHistory.pop();
  notifUnread++;
  notifPaintBadge();
}

function notifPaintBadge() {
  const c = document.getElementById("notifCount");
  if (!c) return;
  c.textContent = notifUnread > 9 ? "9+" : String(notifUnread);
  c.hidden = notifUnread === 0;
  const bell = document.getElementById("notifBell");
  if (bell) bell.setAttribute("aria-label", notifUnread ? `Notifications, ${notifUnread} new` : "Notifications");
}

function notifLogToggle() { notifLogOpen(document.getElementById("notifLog") ? !document.getElementById("notifLog").classList.contains("open") : true); }

function notifLogOpen(open) {
  let p = document.getElementById("notifLog");
  if (!p) {
    p = document.createElement("div");
    p.id = "notifLog";
    p.className = "notif-log";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Notification history");
    p.innerHTML = '<div class="notif-log-head"><b>Notifications</b>' +
      '<span><button class="iconbtn" type="button" onclick="notifLogClear()">clear</button>' +
      '<button class="iconbtn" type="button" onclick="notifLogToggle()" aria-label="Close notification history">✕</button></span></div>' +
      '<div class="notif-log-body" id="notifLogBody"></div>';
    document.body.appendChild(p);
  }
  p.classList.toggle("open", !!open);
  const bell = document.getElementById("notifBell");
  if (bell) bell.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    notifUnread = 0;
    notifPaintBadge();
    notifLogPaint();
    const f = p.querySelector(".notif-log-head button");
    if (f) f.focus();
  } else if (bell) bell.focus();
}

function notifLogPaint() {
  const body = document.getElementById("notifLogBody");
  if (!body) return;
  body.innerHTML = notifHistory.length
    ? notifHistory.map(h => `<div class="notif-log-row notif-${h.kind}"><span class="notif-log-time">${new Date(h.t).toLocaleTimeString()}</span><span>${escHtml(h.msg)}</span></div>`).join("")
    : '<p class="muted small" style="padding:10px">No notifications yet — results, saves and errors show up here.</p>';
}

function notifLogClear() { notifHistory.length = 0; notifLogPaint(); }

/* ---------------- autosave status ("✓ saved …") --------------------
   bpSave / dpSave / persistGuard / cpSave call markSaved(key). The tiny
   stamps live in each tool's header and repaint from saveTimes, so the user
   can see at a glance that work survived a reload. */
const saveTimes = (function () {
  try { return JSON.parse(localStorage.getItem("aap.saved.v1") || "{}"); }
  catch (e) { return {}; }
})();

function markSaved(key) {
  saveTimes[key] = Date.now();
  try { localStorage.setItem("aap.saved.v1", JSON.stringify(saveTimes)); } catch (e) {}
  paintSaveStamps();
}

function paintSaveStamps() {
  document.querySelectorAll("[data-save-stamp]").forEach(s => {
    const t = saveTimes[s.getAttribute("data-save-stamp")];
    s.innerHTML = t
      ? "✓ saved " + escHtml(new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))
      : "· not saved yet";
    s.title = t
      ? "Autosaved to this browser at " + new Date(t).toLocaleString()
      : "Changes autosave to this browser (localStorage)";
  });
}

/* ---------------- undo / redo (global, keyboard + topbar + toast actions) ----
   undoPush(label, undoFn, redoFn) snapshots a destructive action. Handlers for
   blueprint, library, guardrail and deploy ops call it, so every "Removed …"
   toast can offer Undo. */
const undoStack = [], redoStack = [];

function undoPush(label, undoFn, redoFn) {
  if (typeof undoFn !== "function") return;
  undoStack.push({ label: label || "change", undo: undoFn, redo: redoFn });
  if (undoStack.length > 25) undoStack.shift();
  redoStack.length = 0;
  undoPaint();
}

function undoOnce() {
  const e = undoStack.pop();
  if (!e) { showNotif("Nothing to undo"); return; }
  try { e.undo(); } catch (err) { console.warn("undo failed", err); }
  if (typeof e.redo === "function") redoStack.push(e);
  undoPaint();
  showNotif("Undid — " + e.label, e.redo
    ? { kind: "ok", actions: [{ label: "Redo", fn: redoOnce }] }
    : { kind: "ok" });
}

function redoOnce() {
  const e = redoStack.pop();
  if (!e) { showNotif("Nothing to redo"); return; }
  try { e.redo(); } catch (err) { console.warn("redo failed", err); }
  undoStack.push(e);
  undoPaint();
}

function undoPaint() {
  const u = document.getElementById("undoBtn"), r = document.getElementById("redoBtn");
  const top = undoStack[undoStack.length - 1], rtop = redoStack[redoStack.length - 1];
  if (u) { u.disabled = !top; u.title = top ? "Undo: " + top.label + " (Ctrl+Z)" : "Undo (Ctrl+Z) — nothing to undo"; }
  if (r) { r.disabled = !rtop; r.title = rtop ? "Redo: " + rtop.label + " (Ctrl+Shift+Z)" : "Redo (Ctrl+Shift+Z) — nothing to redo"; }
}

document.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = String(e.key || "").toLowerCase();
  if (k === "z" && !e.shiftKey && !e.altKey) {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; /* native field undo wins */
    if (undoStack.length) { e.preventDefault(); undoOnce(); }
  } else if ((k === "z" && e.shiftKey) || k === "y") {
    if (redoStack.length) { e.preventDefault(); redoOnce(); }
  }
});

/* ---------------- mermaid engine (sequential queue) ---------------- */
let mmQueue = Promise.resolve();
let mmLoaded = false;

function mmTheme() {
  const light = document.documentElement.classList.contains("light");
  return light
    ? { primaryColor: "#eaeef2", primaryTextColor: "#1f2328", primaryBorderColor: "#d0d7de",
        lineColor: "#656d76", secondaryColor: "#ddf4ff", tertiaryColor: "#ffffff",
        background: "#ffffff", mainBkg: "#eaeef2", nodeBorder: "#d0d7de", clusterBkg: "#f6f8fa",
        clusterBorder: "#d0d7de", titleColor: "#1f2328", edgeLabelBackground: "#ffffff",
        textColor: "#1f2328", fontFamily: "system-ui, sans-serif", fontSize: "12px" }
    : { primaryColor: "#21262d", primaryTextColor: "#f0f6fc", primaryBorderColor: "#58a6ff",
        lineColor: "#8b949e", secondaryColor: "#121d2f", tertiaryColor: "#161b22",
        background: "#0d1117", mainBkg: "#21262d", nodeBorder: "#58a6ff", clusterBkg: "#161b22",
        clusterBorder: "#30363d", titleColor: "#f0f6fc", edgeLabelBackground: "#161b22",
        textColor: "#f0f6fc", fontFamily: "system-ui, sans-serif", fontSize: "12px" };
}

function mmRender(nodes) {
  const list = [...nodes].filter(Boolean);
  if (!list.length) return Promise.resolve();
  if (!window.mermaid) { list.forEach(n => noteMmErr(n, "mermaid library not loaded (offline?)")); return Promise.resolve(); }
  try {
    window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: mmTheme(), flowchart: { htmlLabels: true, curve: "basis" } });
  } catch (e) { console.warn("mermaid init failed", e); }
  const job = mmQueue.then(async () => {
    for (const node of list) {
      const src = node.dataset && node.dataset.src;
      // reset any previous render state so mermaid will process the node again
      node.removeAttribute("data-processed");
      node.style.display = "";
      const wrap = node.closest(".diagram-wrap") || node.parentElement;
      if (wrap) wrap.querySelectorAll(".mm-err-note").forEach(x => x.remove());
      if (src) node.textContent = src;
      try {
        await window.mermaid.run({ nodes: [node], suppressErrors: true });
        if (!node.querySelector("svg")) noteMmErr(node, src || node.textContent);
      } catch (e) { noteMmErr(node, src || ""); }
    }
  }).catch(e => console.warn("mermaid queue error", e));
  mmQueue = job.catch(() => {});
  return job;
}
function noteMmErr(node, src) {
  if (!node.parentElement || node.parentElement.querySelector(".mm-err-note")) { node.innerHTML = ""; }
  const pre = node.closest(".diagram-wrap") || node.parentElement;
  if (!pre) return;
  if (!pre.querySelector(".mm-err-note")) {
    const d = document.createElement("div");
    d.className = "mm-err-note";
    d.textContent = "⚠ diagram render failed:\n" + String(src).split("\n").slice(0, 3).join("\n");
    pre.appendChild(d);
  }
  node.style.display = "none";
}
function mmRenderAll(root) {
  const sel = (root || document).querySelectorAll("pre.mermaid:not([data-done])");
  return mmRender(sel);
}

/* Build a <pre class="mermaid"> block with an enlarge button */
function diagramHtml(src, title) {
  return `<div class="diagram-wrap"><button class="design-expand" onclick="openZoom(this)" title="Open large with zoom">⤢ enlarge</button>` +
    `<pre class="mermaid" data-src="${escHtml(src)}">${escHtml(src)}</pre></div>`;
}

/* ---------------- zoom viewer (clones existing SVG, never re-renders) ---------------- */
let zoomState = { scale: 1, x: 0, y: 0, svgs: [], idx: 0, restoreFocus: null };

function openZoom(btn) {
  const wrap = btn.closest(".diagram-wrap");
  const svg = wrap && wrap.querySelector("svg");
  if (!svg) { showNotif("Diagram not rendered yet"); return; }
  const doc = document.getElementById("designDoc");
  const inDesign = doc && doc.contains(wrap);
  zoomState.svgs = [...(inDesign ? doc : wrap.closest("main, .drawer-body, .pane") || document).querySelectorAll(".diagram-wrap svg")];
  zoomState.idx = Math.max(0, zoomState.svgs.indexOf(svg));
  zoomState.restoreFocus = btn;
  el("zoomTitle").textContent = (inDesign ? el("designTitle").textContent + " — " : "") + "diagram " + (zoomState.idx + 1) + "/" + zoomState.svgs.length;
  el("zoomOverlay").classList.add("open");
  showZoomSvg();
  zoomFit();
  document.addEventListener("keydown", zoomKeys);
}
function showZoomSvg() {
  const holder = el("zoomInner");
  holder.innerHTML = "";
  const cur = zoomState.svgs[zoomState.idx];
  if (!cur) return;
  const c = cur.cloneNode(true);
  c.style.maxWidth = "none";
  holder.appendChild(c);
  el("zoomTitle").textContent = el("zoomTitle").textContent.replace(/diagram \d+\/\d+/, `diagram ${zoomState.idx + 1}/${zoomState.svgs.length}`);
}
function zoomClose() {
  el("zoomOverlay").classList.remove("open");
  document.removeEventListener("keydown", zoomKeys);
  if (zoomState.restoreFocus && zoomState.restoreFocus.focus) zoomState.restoreFocus.focus();
}
function zoomApply() {
  el("zoomInner").style.transform = `translate(${zoomState.x}px, ${zoomState.y}px) scale(${zoomState.scale})`;
}
function zoomBy(f) { zoomState.scale = Math.min(8, Math.max(0.1, zoomState.scale * f)); zoomApply(); }
function zoomFit() {
  const stage = el("zoomStage"), svg = el("zoomInner").querySelector("svg");
  if (!svg || !stage.clientWidth) return;
  const bb = svg.getBoundingClientRect();
  const pad = 40;
  const f = Math.min((stage.clientWidth - pad) / bb.width, (stage.clientHeight - pad) / bb.height, 2);
  zoomState.scale = Math.max(0.1, f);
  zoomState.x = (stage.clientWidth - bb.width * zoomState.scale) / 2;
  zoomState.y = 20;
  zoomApply();
}
function zoomNatural() {
  const stage = el("zoomStage");
  zoomState.scale = 1; zoomState.x = 20; zoomState.y = 20;
  zoomApply();
  if (stage.clientWidth < el("zoomInner").querySelector("svg").getBoundingClientRect().width) zoomFit();
}
function zoomStep(d) {
  zoomState.idx = (zoomState.idx + d + zoomState.svgs.length) % zoomState.svgs.length;
  showZoomSvg(); zoomFit();
}
function zoomKeys(e) {
  if (e.key === "Escape") zoomClose();
  else if (e.key === "ArrowRight") zoomStep(1);
  else if (e.key === "ArrowLeft") zoomStep(-1);
  else if (e.key === "+" || e.key === "=") zoomBy(1.2);
  else if (e.key === "-") zoomBy(1 / 1.2);
}
(function zoomPan() {
  const stage = el("zoomStage");
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  stage.addEventListener("mousedown", e => { dragging = true; sx = e.clientX; sy = e.clientY; ox = zoomState.x; oy = zoomState.y; stage.classList.add("dragging"); });
  window.addEventListener("mouseup", () => { dragging = false; stage.classList.remove("dragging"); });
  window.addEventListener("mousemove", e => { if (!dragging) return; zoomState.x = ox + e.clientX - sx; zoomState.y = oy + e.clientY - sy; zoomApply(); });
  stage.addEventListener("wheel", e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  stage.addEventListener("dblclick", () => { if (Math.abs(zoomState.scale - 1) < 0.01) zoomFit(); else { zoomState.scale = 1; zoomApply(); } });
})();

/* ---------------- detail drawer (patterns & scenarios) ---------------- */
let detailOpener = null; /* element to restore focus to on close */
function openDetail(title, catLabel, html) {
  el("detailTitle").textContent = title;
  el("detailCat").textContent = catLabel;
  el("detailBody").innerHTML = html;
  detailOpener = document.activeElement;
  el("detailOverlay").classList.add("open");
  mmRenderAll(el("detailBody"));
  const btn = el("detailOverlay").querySelector(".drawer-head .btn");
  if (btn) btn.focus();
}
function closeDetail() {
  const ov = el("detailOverlay");
  if (!ov.classList.contains("open")) return;
  ov.classList.remove("open");
  if (detailOpener && document.contains(detailOpener)) { try { detailOpener.focus(); } catch (e) {} }
  detailOpener = null;
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    const log = document.getElementById("notifLog");
    if (log && log.classList.contains("open")) { notifLogToggle(); return; }
    const pal = document.getElementById("palOverlay");
    if (pal && pal.classList.contains("open")) return; /* palette handles its own Esc */
    closeDetail();
  }
});
/* click outside closes the notification log */
document.addEventListener("mousedown", e => {
  const p = document.getElementById("notifLog");
  if (!p || !p.classList.contains("open")) return;
  if (p.contains(e.target) || (e.target.closest && e.target.closest("#notifBell"))) return;
  notifLogToggle();
});

/* ---------------- boot ---------------- */
async function loadAll() {
  const get = async p => (await fetch(p)).json();
  try {
    const [pats, scns, trcs, cass, cova] = await Promise.all([
      get("data/patterns.json"), get("data/scenarios.json"), get("data/traces.json"), get("data/cascades.json"), get("data/coverage.json").catch(()=>null)
    ]);
    DATA = { patterns: pats, scenarios: scns, traces: trcs, cascades: cass, coverage: cova };
    el("dataStatus").textContent = `${pats.patterns.length} patterns · ${scns.scenarios.length} scenarios · ${trcs.traces.length} traces · ${cass.cascades.length} cascades`;
    el("patBadge").textContent = pats.patterns.length;
    el("scnBadge").textContent = scns.scenarios.length;
    el("traceBadge").textContent = trcs.traces.length;
    if (el("casBadge")) el("casBadge").textContent = cass.cascades.length;
    initOverview(); initPatterns(); initScenarios(); initLive(); initDesign(); initGuardrail(); initCopilot(); initCascades();
    if (typeof initCoverage === "function") initCoverage();
    if (typeof initDeploy === "function") initDeploy();
    if (typeof initBlueprint === "function") initBlueprint();
    if (typeof initPalette === "function") initPalette();
    if (typeof initShortcuts === "function") initShortcuts();
    if (typeof dashRender === "function") dashRender();
    if (typeof LLM !== "undefined" && typeof LLM.bootPill === "function") LLM.bootPill();
    if (typeof paintSaveStamps === "function") paintSaveStamps();
    const hash = (location.hash || "").replace("#", "");
    if (hash && document.getElementById(hash + "Pane")) switchTab(hash);
  } catch (e) {
    el("dataStatus").textContent = "failed to load data — serve via `python3 serve.py`";
    console.error(e);
  }
}
window.addEventListener("hashchange", () => {
  const h = (location.hash || "").replace("#", "");
  if (h && h !== currentTab && document.getElementById(h + "Pane")) switchTab(h);
});
loadAll();
