/* js/shortcuts.js — global keyboard shortcuts + help overlay (?)
   App-level navigation only; typing in inputs is never hijacked (the one
   exception is "/", which opens the palette from anywhere except inside the
   palette's own input). The palette (js/palette.js) owns its own keys. */
"use strict";

const SK_TABS = ["overview", "copilot", "patterns", "scenarios", "cascades", "coverage", "deploy", "blueprint", "live", "design", "guard", "discovery", "bench", "rogue", "selflearn", "research"];

const SK_HELP = [
  ["Ctrl / ⌘ + K", "Open the command palette (search everything)"],
  ["/", "Open the command palette (same, one hand)"],
  ["[ / ]", "Previous / next tab"],
  ["Alt + ← / →", "Previous / next tab (same)"],
  ["Alt + 1…6", "Jump to section 1–6 (Overview, Catalog, Design, Labs, Agents, Architect)"],
  ["?", "This help"],
  ["Esc", "Close palette, drawer, or this help"]
];

function skTyping(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

function skHelpOpen() { const o = el("skOverlay"); if (o) o.classList.add("open"); }
function skHelpClose() { const o = el("skOverlay"); if (o) o.classList.remove("open"); }

function skKey(e) {
  const pal = el("palOverlay");
  const palOpen = pal && pal.classList.contains("open");
  const help = el("skOverlay");
  const helpOpen = help && help.classList.contains("open");

  if (e.key === "Escape") {
    if (helpOpen) { e.preventDefault(); skHelpClose(); return; }
    /* palette and drawer handle their own Escape */
    return;
  }
  if (palOpen) return; /* palette input owns everything else while open */

  if (e.key === "?" && !skTyping(e)) { e.preventDefault(); helpOpen ? skHelpClose() : skHelpOpen(); return; }
  if (e.key === "/" && !skTyping(e)) { e.preventDefault(); palOpenFn(); return; }
  /* cycle tabs: [ / ] and Alt+←/→ — the strip overflows, so reaching the
     last panes should never depend on a trackpad */
  if ((e.key === "[" || e.key === "]") && !skTyping(e) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const i = SK_TABS.indexOf(typeof currentTab === "string" ? currentTab : "overview");
    const d = e.key === "]" ? 1 : -1;
    const j = (i + d + SK_TABS.length) % SK_TABS.length;
    switchTab(SK_TABS[j]);
    const at = document.querySelector(".app-tab.active");
    if (at) at.focus();
    return;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    e.preventDefault();
    const i = SK_TABS.indexOf(typeof currentTab === "string" ? currentTab : "overview");
    const j = (i + (e.key === "ArrowRight" ? 1 : -1) + SK_TABS.length) % SK_TABS.length;
    switchTab(SK_TABS[j]);
    return;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-6]$/.test(e.key)) {
    const g = (typeof TAB_GROUPS !== "undefined" && TAB_GROUPS[Number(e.key) - 1]) || null;
    if (g) { e.preventDefault(); switchGroup(g.id); }
  }
}

/* the palette overlay may not exist yet when the key is pressed very early */
function palOpenFn() { if (typeof palOpen === "function") palOpen(); }

function initShortcuts() {
  if (el("skOverlay")) return;
  const d = document.createElement("div");
  d.id = "skOverlay";
  d.className = "pal-overlay";
  d.innerHTML = `<div class="pal-box sk-box">
    <div class="sk-head">Keyboard shortcuts</div>
    <div class="sk-rows">${SK_HELP.map(([k, t]) =>
      `<div class="sk-row"><kbd>${escHtml(k)}</kbd><span>${escHtml(t)}</span></div>`).join("")}</div>
    <div class="pal-foot">Tip: the palette searches patterns, scenarios, cascades, tabs, templates and your saved blueprints.
      <a href="#" data-act="replayTour">↺ Replay the welcome tour</a></div>
  </div>`;
  d.addEventListener("mousedown", e => { if (e.target === d) skHelpClose(); });
  document.body.appendChild(d);
  document.addEventListener("keydown", skKey);
}
