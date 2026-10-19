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
  document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
  try { localStorage.setItem("aap.theme", light ? "light" : "dark"); } catch (e) {}
  // re-render every diagram with the new theme palette
  mmRenderAll();
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem("aap.theme"); } catch (e) {}
  /* No explicit choice yet -> follow the OS. Once the user clicks ◐ theme the
     stored value wins, so the preference is never fought over. */
  if (!t) t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
  if (t === "light") document.documentElement.classList.add("light");
  document.documentElement.setAttribute("data-theme", t);
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

/* ---------------- per-pane UI memory ----------------
   Remembers the filters, search text and sort a user left each catalog pane
   in, so coming back to a tab (or reloading) does not mean re-applying the
   same narrowing. Kept separate from uxPrefs: it is working state, not taste. */
const UIMEM_STORE = "aap.uimem.v1";
const uiMem = (function () {
  try { return JSON.parse(localStorage.getItem(UIMEM_STORE) || "{}") || {}; }
  catch (e) { return {}; }
})();
function uiMemGet(key, dflt) { return uiMem[key] === undefined ? dflt : uiMem[key]; }
function uiMemSet(key, val) {
  uiMem[key] = val;
  try { localStorage.setItem(UIMEM_STORE, JSON.stringify(uiMem)); } catch (e) {}
}

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
function uxSetView(key, v) {
  uxPrefs[key] = v === "list" ? "list" : "cards";
  uxSave();
  uxPaintViewSegs();
}
function uxPaintViewSegs() {
  [["patView", "patViewCards", "patViewList"], ["scnView", "scnViewCards", "scnViewList"]].forEach(function (t) {
    const v = uxPrefs[t[0]] || "cards";
    const c = document.getElementById(t[1]), l = document.getElementById(t[2]);
    if (c) { c.classList.toggle("on", v === "cards"); c.setAttribute("aria-pressed", v === "cards" ? "true" : "false"); }
    if (l) { l.classList.toggle("on", v === "list"); l.setAttribute("aria-pressed", v === "list" ? "true" : "false"); }
  });
}
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
    uxDataSection() +
    '<div class="muted small" style="margin-top:8px">Saved in this browser; applies to every tab.</div>';
}

/* Storage health + whole-app backup/restore, shown in the display panel. */
function uxDataSection() {
  const u = stateUsage();
  const rows = u.rows.slice(0, 4).map(r =>
    '<div class="ux-usage-row"><span>' + escHtml(r.key.replace("aap.", "").replace(/\.v\d+$/, "")) + '</span><b>' + fmtBytes(r.bytes) + "</b></div>").join("");
  return '<div class="ux-sec">Data &amp; backup</div>' +
    '<div class="ux-usage">' +
    '<div class="ux-usage-head"><span>' + (u.count ? u.count + " item" + (u.count === 1 ? "" : "s") + " stored" : "Nothing stored yet") + '</span><b>' + fmtBytes(u.bytes) + '</b></div>' +
    rows +
    '<div class="muted small">Browser storage holds about 5 MB. Back up before clearing site data.</div>' +
    (storeOk() ? "" : '<div class="ux-warn">Storage is blocked in this browser — work will not persist after reload.</div>') +
    "</div>" +
    '<div class="ux-btns">' +
    '<button class="btn sm" type="button" onclick="backupAll()"' + (u.count ? "" : " disabled") + ">⤓ Back up all</button>" +
    '<button class="btn sm" type="button" onclick="restoreAll()">⤒ Restore…</button>' +
    '<button class="btn sm" type="button" onclick="trimState()">Trim history</button>' +
    "</div>";
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

/* ---------------- client diagnostics beacon --------------------
   Reports JS errors + boot markers to the server log (GET /api/diag),
   same origin only. This is how a blank tab with no visible error gets
   diagnosed: the browser tells us what it hit. sendBeacon never throws and
   never blocks rendering; if the endpoint is absent it 404s silently. */
(function bootDiag() {
  function send(kind, msg) {
    try {
      const u = "api/diag?kind=" + encodeURIComponent(kind) +
        "&msg=" + encodeURIComponent(String(msg == null ? "" : msg).slice(0, 300)) +
        "&tab=" + encodeURIComponent(typeof currentTab === "string" ? currentTab : "") +
        "&ua=" + encodeURIComponent((navigator.userAgent || "").slice(0, 120));
      if (navigator.sendBeacon) navigator.sendBeacon(u);
      else { const im = new Image(); im.src = u; }
    } catch (e) { /* diagnostics must never break the app */ }
  }
  window.addEventListener("error", function (e) {
    send("js", (e.message || "error") + " @ " + String(e.filename || "").split("/").pop() + ":" + (e.lineno || 0));
  });
  window.addEventListener("unhandledrejection", function (e) {
    const r = e && e.reason;
    send("promise", String((r && r.message) || r || "unknown").slice(0, 200));
  });
  window.__diag = send;
  setTimeout(function () {
    try {
      send("boot", "ok tabs=" + document.querySelectorAll(".app-tab").length +
        " panes=" + document.querySelectorAll(".pane").length +
        " disc=" + (!!document.getElementById("discMain")));
    } catch (e) { /* ignore */ }
    /* If the user landed on discovery, describe what the pane actually holds
       at this moment — distinguishes "render never ran" from "rendered but
       invisible". Reports innerHTML length + first 60 chars + visibility. */
    try {
      if (typeof currentTab === "string" && currentTab === "discovery") {
        window.__diagDisc();
        if (typeof window.__diagDiscWatch === "function") window.__diagDiscWatch(true);
      }
    }
    catch (e) { /* ignore */ }
  }, 3000);
  /* Watcher: while the discovery tab is active, report the pane's real state
     whenever it CHANGES (so a wipe seconds after first paint is caught, not
     just the initial render), name whatever sits on top of the pane, and
     self-heal an unexpectedly emptied pane by re-running the loader. */
  let discHeal = 0;
  window.__diagDisc = function () {
    try {
      const pane = document.getElementById("discoveryPane");
      const main = document.getElementById("discMain");
      const rail = document.getElementById("discControls");
      const r = main ? main.getBoundingClientRect() : null;
      const cs = main ? getComputedStyle(main) : null;
      let top = "?";
      if (r && r.width > 0 && r.height > 0) {
        const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + Math.min(r.height, 400) / 2));
        top = hit ? ((hit.id ? "#" + hit.id : hit.tagName.toLowerCase()) + (hit.className ? "." + String(hit.className).split(" ")[0] : "")) : "none";
      }
      const html = main ? main.innerHTML.length : -1;
      const cards = document.querySelectorAll("#discMain .disc-card").length;
      const railLen = rail ? rail.innerHTML.length : -1;
      const style = cs ? cs.visibility + "/" + cs.opacity : "?";
      /* what full-screen overlays are open right now, and which pane is active */
      const openOv = ["onbOverlay", "zoomOverlay", "detailOverlay", "palOverlay", "notifBox"].filter(function (id) {
        const e = document.getElementById(id);
        if (!e) return false;
        const ocs = getComputedStyle(e);
        const orr = e.getBoundingClientRect();
        return ocs.display !== "none" && ocs.visibility !== "hidden" && (+ocs.opacity || 0) > 0.05 && orr.width > 300 && orr.height > 200;
      }).join(",") || "none";
      const visPanes = Array.prototype.map.call(document.querySelectorAll(".pane.visible"), function (p) { return p.id.replace(/Pane$/, ""); }).join(",") || "NONE";
      /* theme + the chart title's actual painted colors — catches the last
         branch: content present and visible but text colored like the
         background (invisible to the eye, fine in the DOM). */
      const h3 = main ? main.querySelector(".panel h3, .dash-h") : null;
      const h3cs = h3 ? getComputedStyle(h3) : null;
      const theme = (document.documentElement.className || "dark");
      const colors = h3cs ? (h3cs.color + " on " + h3cs.backgroundColor) : "n/a";
      const pr = pane ? pane.getBoundingClientRect() : null;
      const pos = (pr ? (Math.round(pr.left) + "," + Math.round(pr.top) + " " + Math.round(pr.width) + "x" + Math.round(pr.height)) : "?") +
        " scrollY=" + Math.round(window.scrollY || window.pageYOffset || 0);
      const sig = html + "|" + cards + "|" + railLen + "|" + style + "|" + top + "|" + openOv + "|" + visPanes + "|" + theme + "|" + colors + "|" + pos;
      if (sig !== window.__diagDiscSig) {
        window.__diagDiscSig = sig;
        send("discpane",
          "main=" + (main ? "present" : "MISSING") +
          " html=" + html +
          " kids=" + (main ? main.children.length : -1) +
          " cards=" + cards +
          " rail=" + railLen +
          " vis=" + (pane ? (pane.classList.contains("visible") ? "visible" : "HIDDEN") : "noPane") +
          " visPane=" + visPanes +
          " style=" + style +
          " h=" + (r ? Math.round(r.height) : -1) +
          " top=" + top +
          " ov=" + openOv +
          " theme=" + theme +
          " colors=" + JSON.stringify(colors) +
          " pos=" + pos +
          " txt=" + JSON.stringify((main && main.innerText || "").slice(0, 60)) +
          " loader=" + (typeof tabLoaders === "object" && tabLoaders && typeof tabLoaders.discovery === "function" ? "fn" : "??") +
          " run=" + (typeof discState === "object" && discState ? (discState.run ? "set" : "null") : "??") +
          " init=" + (typeof initDiscovery === "function" ? "fn" : "??") +
          " win=" + window.innerWidth + "x" + window.innerHeight);
      }
      /* self-heal: tab active but pane empty or still on the static marker */
      const stuckMarker = !!(main && main.querySelector("[data-discboot]"));
      if ((stuckMarker || (html >= 0 && html < 40)) && discHeal < 3 &&
          typeof tabLoaders === "object" && tabLoaders && typeof tabLoaders.discovery === "function") {
        discHeal++;
        send("discpane", "HEAL#" + discHeal + " pane was empty (html=" + html + " marker=" + stuckMarker + ") — re-running discovery loader");
        tabLoaders.discovery();
      }
    } catch (e) { /* ignore */ }
  };
  let discWatch = null;
  window.__diagDiscWatch = function (on) {
    try {
      if (discWatch) { clearInterval(discWatch); discWatch = null; }
      if (on) discWatch = setInterval(function () { try { window.__diagDisc(); } catch (e) {} }, 2000);
    } catch (e) { /* ignore */ }
  };
})();

/* ---------------- tabs ---------------- */
let currentTab = "overview";
const tabLoaders = {}; // filled by per-tab scripts

/* ---------------- pane boot bookkeeping ----------------
   loadAll() paints the shell and the two catalog panes first, then builds the
   remaining panes one per idle slice, so a heavy pane (cascades ~780 nodes,
   coverage ~740) can never delay first paint. paneEnsure() lets a tab visit
   jump the queue and run a not-yet-built pane's init immediately, exactly
   once. */
const paneInited = Object.create(null);   // tab -> true | "starting"
const PANE_INIT = Object.create(null);    // tab -> init function
/* Resolves once the full catalog (incl. the deferred cascades dataset) is in
   DATA. On-demand pane inits wait on it so a very fast tab click can't render
   an empty Cascades/Deploy/Blueprint pane before the data lands. */
let catalogReady = Promise.resolve();
const PANE_SKEL = [                        /* panes whose body is JS-built */
  ["coverage", "#covMain"], ["deploy", "#dpRoot"], ["blueprint", "#bpPalette"],
  ["cascades", "#casGrid"], ["patterns", "#patGrid"], ["scenarios", "#scnGrid"], ["live", "#traceList"]
];
function paneSkeletonOn(tab) {
  const pane = el(tab + "Pane");
  if (!pane || pane.querySelector(".pane-skel")) return;
  const target = (PANE_SKEL.find(s => s[0] === tab) || [null, null])[1];
  const box = target ? pane.querySelector(target) : null;
  /* only stand in for content that is genuinely not there yet */
  const host = (box && !box.children.length && !(box.innerText || "").trim()) ? box
    : ((pane.innerText || "").trim().length ? null : pane);
  if (!host) return;
  const s = document.createElement("div");
  s.className = "pane-skel";
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = '<div class="skel-row w70"></div><div class="skel-row w95"></div>' +
    '<div class="skel-row w55"></div><div class="skel-row w85"></div><div class="skel-row w40"></div>';
  host.appendChild(s);
}
function paneSkeletonOff(tab) {
  const pane = el(tab + "Pane");
  if (pane) pane.querySelectorAll(".pane-skel").forEach(s => s.remove());
}
function paneRunNow(tab) {
  if (paneInited[tab] || !PANE_INIT[tab]) return;
  paneInited[tab] = "starting";
  catalogReady
    .then(() => PANE_INIT[tab]())
    .catch(e => console.warn("pane init failed: " + tab, e))
    .then(() => { paneInited[tab] = true; paneSkeletonOff(tab); });
}
function paneEnsure(tab) {
  const s = paneInited[tab];
  if (!s && PANE_INIT[tab]) { paneRunNow(tab); paneSkeletonOff(tab); return; }
  if (s === "starting") return;
  if (tabLoaders[tab]) tabLoaders[tab]();
}

function switchTab(tab) {
  const prev = currentTab;
  currentTab = tab;
  document.querySelectorAll(".app-tab").forEach(t => {
    const on = t.dataset.tab === tab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll(".pane").forEach(p => p.classList.remove("visible"));
  const pane = document.getElementById(tab + "Pane");
  if (!pane) {
    /* Unknown tab target (e.g. stale cached shell): fall back to overview
       instead of leaving every pane hidden behind a blank app. */
    if (tab !== "overview" && document.getElementById("overviewPane")) { switchTab("overview"); return; }
    const ov = document.getElementById("overviewPane");
    if (ov) ov.classList.add("visible");
    return;
  }
  pane.classList.add("visible");
  if (typeof paneEnsure === "function") paneEnsure(tab);
  else if (tabLoaders[tab]) tabLoaders[tab]();
  /* keep the active tab on screen in the overflowing strip */
  const active = document.querySelector(".app-tab.active");
  if (active && typeof active.scrollIntoView === "function") {
    try { active.scrollIntoView({ inline: "nearest", block: "nearest" }); } catch (e) {}
  }
  if (typeof updateTabNav === "function") setTimeout(updateTabNav, 240);
  if (tab !== prev) {
    const label = active ? active.textContent.replace(/\s+/g, " ").replace(/^[^\w(]+/, "").trim() : tab;
    announce(label + " tab");
  }
  if (typeof window.__diagDiscWatch === "function") window.__diagDiscWatch(tab === "discovery");
  if (tab === "discovery" && typeof window.__diagDisc === "function") setTimeout(window.__diagDisc, 600);
  /* keep the address bar in sync without stacking history entries; a drawer
     deep link for the tab already on screen is left untouched */
  try {
    if (tab !== prev) history.replaceState(null, "", "#" + tab);
  } catch (e) {}
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

/* ---------------- tab bar: active tab in view + overflow chevrons ----------------
   With 12 tabs the strip overflows on every common laptop width; without an
   affordance whole panes (Coverage … Discovery) are unreachable by mouse.
   The wrapper (.tabs-wrap) holds two chevrons outside the scroller so they
   stay put, and switchTab() scrolls the active tab into view. */
function tabScrollBy(dir) {
  const bar = el("appTabs");
  if (!bar) return;
  bar.scrollBy({ left: dir * Math.max(180, bar.clientWidth * 0.6), behavior: "smooth" });
  setTimeout(updateTabNav, 300);
}
function updateTabNav() {
  const bar = el("appTabs");
  const wrap = bar && bar.parentElement;
  if (!bar || !wrap) return;
  const left = wrap.querySelector(".tabnav.left");
  const right = wrap.querySelector(".tabnav.right");
  if (!left || !right) return;
  const over = bar.scrollWidth - bar.clientWidth > 4;
  left.classList.toggle("show", over && bar.scrollLeft > 4);
  right.classList.toggle("show", over && bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4);
}
function initTabBar() {
  const bar = el("appTabs");
  if (!bar || bar.dataset.nav) return;
  const wrap = bar.parentElement;
  if (!wrap) return;
  bar.dataset.nav = "1";
  const mk = (cls, label, glyph, dir) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tabnav " + cls;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.textContent = glyph;
    b.addEventListener("click", () => tabScrollBy(dir));
    return b;
  };
  wrap.appendChild(mk("left", "Scroll tabs left", "‹", -1));
  wrap.appendChild(mk("right", "Scroll tabs right", "›", 1));
  /* roving tabindex + aria-selected at rest: the active tab is the one Tab stop,
     the rest are reachable with the arrow keys (tabKeyNav) — the standard
     WAI-ARIA tabs pattern, so the strip is keyboard-reachable on first paint. */
  bar.querySelectorAll(".app-tab").forEach(t => {
    const on = t.classList.contains("active");
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
  });
  bar.addEventListener("scroll", debounce(updateTabNav, 60));
  window.addEventListener("resize", debounce(updateTabNav, 120));
  updateTabNav();
}

/* ---------------- helpers ---------------- */
function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- inline glossary (jargon) ----------------
   Wrap known terms in <abbr title="…"> so a reader can hover any piece of
   jargon for the definition without leaving the drawer. Operates on a plain
   string and escapes as it goes, so it is safe on user/data text. */
let JARGON_RE = null, JARGON_DEFS = null;
function jargon(text) {
  const raw = String(text == null ? "" : text);
  if (typeof GLOSSARY === "undefined" || !GLOSSARY.length) return escHtml(raw);
  if (!JARGON_RE) {
    JARGON_DEFS = {};
    GLOSSARY.forEach(g => { JARGON_DEFS[String(g[0]).toLowerCase()] = g[1]; });
    const terms = GLOSSARY.map(g => String(g[0])).filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    JARGON_RE = new RegExp("\\b(" + terms.join("|") + ")\\b", "gi");
  }
  let html = "", last = 0, m;
  JARGON_RE.lastIndex = 0;
  while ((m = JARGON_RE.exec(raw)) !== null) {
    if (m[0].length === 0) { JARGON_RE.lastIndex++; continue; }
    html += escHtml(raw.slice(last, m.index));
    const def = JARGON_DEFS[m[0].toLowerCase()] || "";
    html += '<abbr class="jargon" title="' + escHtml(def) + '">' + escHtml(m[0]) + "</abbr>";
    last = m.index + m[0].length;
  }
  return html + escHtml(raw.slice(last));
}
function el(id) { return document.getElementById(id); }

/* ---------------- screen-reader announcements ----------------
   One persistent live region for things that happen outside a dialog: tab
   changes, result counts, saved/restored state. Toasts keep their own
   role=log/alert box; this covers navigation and progress. */
function appStatus() {
  let s = el("appStatus");
  if (!s) {
    s = document.createElement("div");
    s.id = "appStatus";
    s.className = "sr-only";
    s.setAttribute("role", "status");
    s.setAttribute("aria-live", "polite");
    s.setAttribute("aria-atomic", "true");
    document.body.appendChild(s);
  }
  return s;
}
let announceTimer = null;
function announce(msg) {
  try {
    const s = appStatus();
    s.textContent = "";               /* clear first so repeats re-announce */
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { s.textContent = String(msg == null ? "" : msg); }, 80);
  } catch (e) { /* never break an action for an announcement */ }
}

/* ---------------- global busy indicator ----------------
   Long, non-blocking work (a copilot answer in flight, a model-backend probe)
   reports here so the shell always says "working…" even when the busy thing
   lives in a different pane than the one on screen. Ref-counted by label. */
const busySet = new Set();
function setBusy(label) {
  busySet.add(label || "working…");
  busyPaint();
}
function clearBusy(label) {
  busySet.delete(label || "working…");
  busyPaint();
}
function busyPaint() {
  const on = busySet.size > 0;
  let c = el("busyChip");
  if (!c) {
    if (!on) return;
    c = document.createElement("span");
    c.id = "busyChip";
    c.className = "busy-chip";
    c.setAttribute("role", "status");
    c.setAttribute("aria-live", "polite");
    c.innerHTML = '<span class="spin" aria-hidden="true"></span><span id="busyChipTxt"></span>';
    const bar = document.querySelector(".topbar");
    if (bar) bar.insertBefore(c, el("dataStatus") || null);
  }
  c.hidden = !on;
  const txt = el("busyChipTxt");
  if (txt) txt.textContent = on ? [...busySet][busySet.size - 1] : "";
}

/* ---------------- chart accessibility ----------------
   Every bar chart here encodes value by colour and width only. Give each row
   an image role with a spoken label built from its own text and hide the
   decorative track, so a screen reader hears "Orchestration: 14" instead of
   nothing. Applied post-render by a debounced observer, so every current and
   future chart path is covered without touching each render function. */
function a11yBars(root) {
  const scope = (root && root.querySelectorAll) ? root : document;
  scope.querySelectorAll(".bar-row:not([role])").forEach(row => {
    const track = row.querySelector(".bar-track");
    const lbl = row.querySelector(".lbl"), n = row.querySelector(".n");
    const label = ((lbl && lbl.textContent) || "").trim();
    const val = ((n && n.textContent) || "").trim();
    if (track) track.setAttribute("aria-hidden", "true");
    if (!label && !val) return;
    row.setAttribute("role", "img");
    row.setAttribute("aria-label", label + (val ? ": " + val : ""));
  });
  scope.querySelectorAll(".dp-bar:not([role])").forEach(bar => {
    const dim = bar.closest(".dp-dim");
    const head = dim && dim.querySelector(".dp-dimhead");
    const txt = head ? head.textContent.replace(/\s+/g, " ").trim() : "";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", txt ? "Dimension score — " + txt : "Dimension score");
  });
  scope.querySelectorAll(".dp-scorebar:not([role])").forEach(bar => {
    const score = bar.closest(".dp-score");
    const big = score && score.querySelector(".dp-scorebig");
    const txt = big ? big.textContent.replace(/\s+/g, " ").trim() : "";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", txt ? "Overall readiness — " + txt : "Overall readiness score");
  });
}
let a11yObs = null;
function a11yBarsInit() {
  try { a11yBars(document); } catch (e) {}
  if (a11yObs || !window.MutationObserver || !document.body) return;
  let t = null;
  a11yObs = new MutationObserver(function () {
    if (t) return;
    t = setTimeout(function () { t = null; try { a11yBars(document); } catch (e) {} }, 150);
  });
  a11yObs.observe(document.body, { childList: true, subtree: true });
}

/* ---------------- offline indicator ----------------
   This app is built to run on a LAN or air-gapped host: the catalog, filters,
   diagrams (vendored) and saved work all run locally. When the browser reports
   no network, say so plainly instead of letting a failing model call look like
   a broken app. */
function netPaint() {
  const off = (typeof navigator !== "undefined" && navigator.onLine === false);
  let c = el("netChip");
  if (!off) { if (c) c.remove(); return; }
  if (!c) {
    c = document.createElement("span");
    c.id = "netChip";
    c.className = "net-chip";
    c.setAttribute("role", "status");
    c.textContent = "⚡ Offline";
    c.title = "No network connection. The catalog, filters, diagrams and saved work all run locally; model answers fall back to the deterministic catalog voice.";
    const bar = document.querySelector(".topbar");
    if (bar) bar.insertBefore(c, el("dataStatus") || null);
  }
}
window.addEventListener("online", netPaint);
window.addEventListener("offline", netPaint);
/* Stale-shell detector: if the cached index.html predates the JS (or vice
   versa), tabs and panes disagree — e.g. a tab button with no pane, or a
   first-run tour looping over an app the user already knows. Banner offers
   a cache-busting reload instead of failing silently. */
function shellFreshCheck() {
  try {
    const tabs = (typeof SK_TABS !== "undefined" ? SK_TABS : []);
    const missing = tabs.filter(t => !document.getElementById(t + "Pane"));
    const orphan = [...document.querySelectorAll(".pane")].map(p => p.id.replace(/Pane$/, "")).filter(t => tabs.indexOf(t) < 0);
    const bad = missing.concat(orphan.map(t => t + " (unwired)"));
    if (!bad.length) return true;
    let b = document.getElementById("freshBanner");
    if (!b) {
      b = document.createElement("div");
      b.id = "freshBanner";
      b.innerHTML = `<b>Update available.</b><span>This page is a stale cached copy (mismatch: ${bad.map(escHtml).join(", ")}). </span>` +
        `<button class="btn sm primary" onclick="location.href=location.pathname+'?v='+Date.now()+location.hash">Reload fresh copy</button>`;
      document.body.appendChild(b);
    }
    return false;
  } catch (e) { return true; }
}
/* Live catalog counts for UI copy — never hardcode 107/43/180 in strings. */
function catN(kind, fallback) {
  try {
    if (kind === "patterns" && DATA.patterns) return DATA.patterns.patterns.length;
    if (kind === "scenarios" && DATA.scenarios) return DATA.scenarios.scenarios.length;
    if (kind === "cascades" && DATA.cascades) return DATA.cascades.cascades.length;
  } catch (e) {}
  return fallback;
}
function skipToContent(e) {
  if (e) e.preventDefault();
  const pane = document.querySelector(".pane.visible") || document.getElementById(currentTab + "Pane");
  if (pane) {
    if (!pane.hasAttribute("tabindex")) pane.setAttribute("tabindex", "-1");
    pane.focus({ preventScroll: true });
    pane.scrollTop = 0;
  }
}
/* Move keyboard focus into a tab's pane after a cross-tab jump that was
   triggered from a drawer, toast or dashboard button. */
function focusPane(tab) {
  const pane = document.getElementById(tab + "Pane");
  if (!pane) return;
  if (!pane.hasAttribute("tabindex")) pane.setAttribute("tabindex", "-1");
  setTimeout(() => { try { pane.focus({ preventScroll: true }); } catch (e) {} }, 60);
}
/* Keep Tab cycling inside open modal dialogs (drawer, palette, help, tour). */
document.addEventListener("keydown", function (e) {
  if (e.key !== "Tab") return;
  const box = document.querySelector(".overlay.open .drawer, .onb-overlay.open .onb-box, .pal-overlay.open .pal-box");
  if (!box) return;
  const f = [...box.querySelectorAll("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter(x => !x.disabled && x.getClientRects().length);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
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

let lastToast = null;                 /* newest toast, for "×N" collapsing */
const liveToasts = [];                /* { el, dismiss } newest last */
function dismissNewestToast() {
  for (let i = liveToasts.length - 1; i >= 0; i--) {
    const t = liveToasts[i];
    if (t && document.contains(t.el)) { t.dismiss(); return true; }
  }
  return false;
}

function showNotif(msg, opts) {
  opts = opts || {};
  const kind = opts.kind || "info";
  const acts = (opts.actions || []).filter(a => a && a.label);
  const ttl = opts.ttl != null ? opts.ttl
    : kind === "error" ? 9000
    : acts.length ? 7000 : 4200;

  const n = notifBox();

  /* Collapse an identical toast that is still on screen into a "×N" counter
     instead of stacking duplicates (repeated saves, repeated filter misses). */
  if (lastToast && lastToast.msg === msg && lastToast.kind === kind &&
      document.contains(lastToast.el) && !acts.length && !(opts.actions || []).length) {
    lastToast.n++;
    const c = lastToast.el.querySelector(".notif-count");
    if (c) { c.hidden = false; c.textContent = "×" + lastToast.n; }
    lastToast.el.classList.remove("out");
    if (lastToast.rearm) lastToast.rearm();
    return;
  }

  while (n.children.length >= 4) n.firstChild.remove(); /* cap the stack */

  const d = document.createElement("div");
  d.className = "notif notif-" + kind;
  d.setAttribute("role", kind === "error" ? "alert" : "status");

  const m = document.createElement("span");
  m.className = "notif-msg";
  m.textContent = msg;
  d.appendChild(m);

  const cnt = document.createElement("span");
  cnt.className = "notif-count";
  cnt.hidden = true;
  d.appendChild(cnt);

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
    const i = liveToasts.indexOf(entry);
    if (i >= 0) liveToasts.splice(i, 1);
    if (lastToast && lastToast.el === d) lastToast = null;
    d.classList.add("out");
    setTimeout(() => d.remove(), 160);
    if (d.contains(document.activeElement)) x.focus();
  }
  const entry = { el: d, dismiss: dismiss };
  d.addEventListener("mouseenter", pause);
  d.addEventListener("mouseleave", arm);
  d.addEventListener("focusin", pause);
  d.addEventListener("focusout", arm);

  n.appendChild(d);
  liveToasts.push(entry);
  if (liveToasts.length > 8) liveToasts.splice(0, liveToasts.length - 8);
  lastToast = { el: d, msg: msg, kind: kind, n: 1, rearm: function () {
    /* restart the countdown from a full ttl so the collapsed toast lingers */
    if (timer) { clearTimeout(timer); timer = null; }
    remain = ttl; arm();
  } };
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

/* ---------------- active-filter chips (catalog panes) --------------------
   paintActiveChips(id, chips) renders removable filter pills. Each chip is
   { label, title, fn } — fn is a global function name + JS-escaped argument. */
function emptyState(icon, title, body, actionLabel, actionFn) {
  return `<div class="empty-state"><div class="empty-ico">${icon}</div>` +
    `<div class="empty-t">${escHtml(title)}</div>` +
    (body ? `<div class="empty-b">${body}</div>` : "") +
    (actionLabel && actionFn ? `<button class="btn sm primary" onclick="${escHtml(actionFn)}">${escHtml(actionLabel)}</button>` : "") +
    `</div>`;
}
function escJs(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

function paintActiveChips(id, chips) {
  const box = document.getElementById(id);
  if (!box) return;
  box.innerHTML = (chips || []).map(c =>
    `<span class="fchip" title="${escHtml(c.title || c.label)}">${escHtml(c.label)}` +
    `<button type="button" onclick="${escHtml(c.fn)}" aria-label="Remove filter ${escHtml(c.label)}">×</button></span>`).join("");
  box.style.display = chips && chips.length ? "" : "none";
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

/* ---------------- storage: quota-aware persistence --------------------
   Browser storage (localStorage, ~5MB) can fill up — long copilot chats and
   big guardrail collections are the usual culprits. When a write fails with
   quota errors the old code failed SILENTLY (flags never stuck, so the
   welcome tour reappeared on every reload). These helpers make failure loud
   and recover by trimming regenerable history. */
function storeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function storeSet(key, val) {
  try { localStorage.setItem(key, val); return true; }
  catch (e) { return false; }
}
function storeDel(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}
/* Writability probe for support: BLOCKED means saves, flags and runs will
   not persist in this browser (private mode, disabled/blocked storage). */
let storeOkCache = null;
function storeOk() {
  if (storeOkCache !== null) return storeOkCache;
  try {
    localStorage.setItem("aap.probe", "1");
    localStorage.removeItem("aap.probe");
    storeOkCache = true;
  } catch (e) { storeOkCache = false; }
  return storeOkCache;
}

/* ---------------- backup / restore & storage health --------------------
   Everything the user creates lives in localStorage under aap.*: blueprints,
   the saved library, guardrail analyses, the deployment plan, the copilot
   chat, mitigations, discovery runs, pins, filters and display prefs. This
   block gives one place to see how much is stored, download it all as a
   single JSON file, and load it back (replacing matching keys, then reload). */
const BACKUP_PREFIX = "aap.";
const BACKUP_SKIP = { "aap.probe": 1 };
let pendingRestore = null;

function userStateKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(BACKUP_PREFIX) === 0 && !BACKUP_SKIP[k]) keys.push(k);
    }
  } catch (e) {}
  return keys.sort();
}
function stateUsage() {
  let bytes = 0;
  const rows = [];
  userStateKeys().forEach(k => {
    const v = storeGet(k) || "";
    const b = (k.length + v.length) * 2;   /* localStorage counts UTF-16 units */
    bytes += b;
    rows.push({ key: k, bytes: b });
  });
  rows.sort((a, b) => b.bytes - a.bytes);
  return { bytes: bytes, count: rows.length, rows: rows };
}
function fmtBytes(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
  if (b >= 1024) return Math.round(b / 1024) + " KB";
  return b + " B";
}
function backupAll() {
  const keys = userStateKeys();
  const data = { app: "ai-agent-patterns", kind: "aap-backup", version: 1, exportedAt: new Date().toISOString(), keys: {} };
  keys.forEach(k => { data.keys[k] = storeGet(k); });
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aap-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    showNotif("Backed up " + keys.length + " saved item" + (keys.length === 1 ? "" : "s") + " (" + fmtBytes(stateUsage().bytes) + ") to a JSON file.", { kind: "ok" });
    announce("Backup downloaded, " + keys.length + " items");
  } catch (e) {
    showNotif("Could not build a backup in this browser.", { kind: "error" });
  }
  uxPaintPanel();
}
function restoreAll() {
  let inp = el("aapRestoreFile");
  if (!inp) {
    inp = document.createElement("input");
    inp.type = "file";
    inp.id = "aapRestoreFile";
    inp.accept = "application/json,.json";
    inp.style.display = "none";
    inp.addEventListener("change", restoreApply);
    document.body.appendChild(inp);
  }
  inp.value = "";
  inp.click();
}
function restoreApply(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = function () {
    let data = null;
    try { data = JSON.parse(String(r.result)); } catch (err) { data = null; }
    const keys = data && data.keys && typeof data.keys === "object"
      ? Object.keys(data.keys).filter(k => k.indexOf(BACKUP_PREFIX) === 0 && !BACKUP_SKIP[k]) : null;
    if (!data || !keys || (!keys.length && data.kind !== "aap-backup")) {
      showNotif("That file doesn't look like an app backup.", { kind: "error" });
      return;
    }
    pendingRestore = data;
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : "an unknown date";
    showNotif("Restore " + keys.length + " saved item" + (keys.length === 1 ? "" : "s") + " from " + when + "? This replaces matching data in this browser and reloads.", {
      kind: "warn", ttl: 20000, actions: [
        { label: "Restore & reload", primary: true, fn: restoreCommit },
        { label: "Cancel", fn: function () { pendingRestore = null; showNotif("Restore cancelled."); } }
      ]
    });
  };
  r.readAsText(f);
}
function restoreCommit() {
  const data = pendingRestore;
  pendingRestore = null;
  if (!data || !data.keys) return;
  let n = 0;
  Object.keys(data.keys).forEach(function (k) {
    if (k.indexOf(BACKUP_PREFIX) === 0 && !BACKUP_SKIP[k] && data.keys[k] != null) { if (storeSet(k, data.keys[k])) n++; }
  });
  showNotif("Restored " + n + " item" + (n === 1 ? "" : "s") + " — reloading to apply.", { kind: "ok", ttl: 1400 });
  setTimeout(() => { try { location.reload(); } catch (e) {} }, 900);
}
/* Trim regenerable history first when storage is tight — chat is the usual
   culprit. Mirrors the trim into memory so a later autosave can't undo it. */
function trimState() {
  let freed = 0;
  const cp = storeGet("aap.copilot");
  if (cp) {
    try {
      const o = JSON.parse(cp);
      if (o && Array.isArray(o.messages) && o.messages.length > 12) {
        const before = cp.length;
        o.messages = o.messages.slice(-12);
        const after = JSON.stringify(o);
        if (storeSet("aap.copilot", after)) {
          freed += (before - after.length) * 2;
          if (typeof cpMessages !== "undefined" && Array.isArray(cpMessages) && cpMessages.length > 12) cpMessages = o.messages;
          if (typeof cpRenderLog === "function") { try { cpRenderLog(); } catch (e) {} }
        }
      }
    } catch (e) {}
  }
  const u = stateUsage();
  if (freed > 0) showNotif("Trimmed chat history — freed about " + fmtBytes(freed) + ". Now using " + fmtBytes(u.bytes) + ".", { kind: "ok" });
  else showNotif("Nothing to trim — no oversized history found (" + fmtBytes(u.bytes) + " in use).", { kind: "info" });
  uxPaintPanel();
}

/* ---------------- onboarding: first-run welcome tour --------------------
   Shown once (flag in localStorage, sessionStorage fallback, in-memory last
   resort — so a full/broken store can nag at most once per session). */
const ONB_STORE = "aap.onboard.v1";
let onbSeenMem = false;

function onbSeen() {
  if (onbSeenMem) return true;
  if (storeGet(ONB_STORE) === "seen") return true;
  try { if (sessionStorage.getItem(ONB_STORE) === "seen") return true; } catch (e) {}
  return false;
}
function onbMarkSeen() {
  onbSeenMem = true;
  if (storeGet(ONB_STORE) === "seen") return;
  if (storeSet(ONB_STORE, "seen")) return;
  try { sessionStorage.setItem(ONB_STORE, "seen"); } catch (e) {}
}
/* A returning user has THEIR OWN state (not boot-seeded defaults): a chat
   with a real user turn, a named deployment target, a non-seed analysis, a
   blueprint with components, library entries, or pins. Only a true
   first-run — none of the above — gets the auto tour. Manual replay via the
   shortcuts help always works. */
function onbHasHistory() {
  try {
    const cp = JSON.parse(localStorage.getItem("aap.copilot") || "null");
    if (cp && Array.isArray(cp.messages) && cp.messages.some(m => m && m.role === "user" && String(m.content || "").trim())) return true;
    const dp = JSON.parse(localStorage.getItem("aap.deploy") || "null");
    if (dp && dp.a && typeof dp.a.system === "string" && dp.a.system.trim()) return true;
    if (dp && dp.done === true) return true;
    const g = JSON.parse(localStorage.getItem("aap.guardrail.collection.v1") || "[]");
    if (Array.isArray(g) && g.some(it => it && it.origin !== "seed")) return true;
    const bp = JSON.parse(localStorage.getItem("aap.blueprint.v1") || "null");
    if (bp && Array.isArray(bp.comps) && bp.comps.length) return true;
    const bl = JSON.parse(localStorage.getItem("aap.blueprints.v1") || "[]");
    if (Array.isArray(bl) && bl.length) return true;
    const pins = JSON.parse(localStorage.getItem("aap.pins.v1") || "null");
    if (pins && ((pins.patterns || []).length + (pins.scenarios || []).length + (pins.cascades || []).length) > 0) return true;
  } catch (e) {}
  return false;
}
/* Storage probe: localStorage can be full or blocked outright. When writes
   fail, "seen" flags never stick and a first-run tour would nag on every
   reload while saves silently die — so the auto tour requires PROVEN
   writable storage (manual replay always works). */
let onbStorageOk = null;
function onbStorageWorks() {
  if (onbStorageOk !== null) return onbStorageOk;
  try {
    localStorage.setItem("aap.probe", "1");
    localStorage.removeItem("aap.probe");
    onbStorageOk = true;
  } catch (e) { onbStorageOk = false; }
  return onbStorageOk;
}
function onbShow(force) {
  if (!force && onbSeen()) return;
  if (!force && !onbStorageWorks()) return;
  if (!force && onbHasHistory()) { onbMarkSeen(); return; } /* returning user, never auto-tour */
  onbMarkSeen(); /* mark on SHOW, not on dismiss: refreshing mid-tour must not nag again */
  let o = document.getElementById("onbOverlay");
  if (!o) {
    o = document.createElement("div");
    o.id = "onbOverlay";
    o.className = "onb-overlay";
    o.setAttribute("role", "dialog");
    o.setAttribute("aria-modal", "true");
    o.setAttribute("aria-label", "Welcome — choose a starting path");
    o.innerHTML =
      `<div class="onb-box">` +
      `<button class="onb-x" onclick="onbGo(null)" aria-label="Close welcome tour">✕</button>` +
      `<div class="onb-kicker">AI AGENT PATTERNS &amp; GUARDRAILS</div>` +
      `<h2 class="onb-title">What are you designing today?</h2>` +
      `<p class="onb-sub">This is an advisory workbench, not a dashboard. Pick the job — the app lines up the catalog, the planner and the copilot behind it.</p>` +
      `<div class="onb-cards">` +
      `<div class="onb-card"><div class="onb-ico">🧭</div><b>Ship an agent safely</b>` +
      `<span>Answer 4 intake questions → readiness score, recommended stack, rollout plan, risks and ADR.</span>` +
      `<button class="btn primary" onclick="onbGo('deploy')">Start the deployment plan</button></div>` +
      `<div class="onb-card"><div class="onb-ico">🧩</div><b>Architect the system</b>` +
      `<span>Compose stages and controls → live coverage, cost, threat exposure and cascade analysis.</span>` +
      `<button class="btn primary" onclick="onbGo('blueprint')">Open the blueprint builder</button></div>` +
      `<div class="onb-card"><div class="onb-ico">⧉</div><b>Study how agents fail</b>` +
      `<span>${catN("patterns", 107)} patterns, ${catN("scenarios", 43)} scenarios, ${catN("cascades", 180)} cascades — how small faults cross boundaries and amplify.</span>` +
      `<button class="btn primary" onclick="onbGo('cascades')">Explore the cascade catalog</button></div>` +
      `</div>` +
      `<div class="onb-foot"><button class="btn sm ghost" onclick="onbGo('copilot')">Just ask Fox - Architect instead →</button>` +
      `<span style="flex:1"></span>` +
      `<button class="btn sm" onclick="onbGo(null)">Skip — I'll explore</button></div>` +
      `</div>`;
    o.addEventListener("mousedown", e => { if (e.target === o) onbGo(null); });
    document.body.appendChild(o);
  }
  o.classList.add("open");
  const f = o.querySelector(".onb-card button");
  if (f) f.focus();
}
function onbGo(tab) {
  onbMarkSeen();
  const o = document.getElementById("onbOverlay");
  if (o) o.classList.remove("open");
  if (tab) { switchTab(tab); focusPane(tab); }
}
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    const o = document.getElementById("onbOverlay");
    if (o && o.classList.contains("open")) onbGo(null);
  }
});

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
let mmLibPromise = null;

/* Lazy-load Mermaid the first time a diagram is needed. The vendored copy is
   authoritative (works LAN-only / air-gapped); the CDN is a last-resort
   fallback only if the local file is unavailable. Keeps 3.3 MB off first paint. */
function mmEnsure() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (mmLibPromise) return mmLibPromise;
  mmLibPromise = new Promise((resolve, reject) => {
    const load = (src, onFail) => {
      const s = document.createElement("script");
      s.async = true;
      s.src = src;
      s.onload = () => (window.mermaid ? resolve(window.mermaid) : onFail());
      s.onerror = onFail;
      document.head.appendChild(s);
    };
    const cdn = () => load("https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js",
      () => reject(new Error("mermaid unavailable (offline?)")));
    load("js/vendor/mermaid.min.js", cdn);
  });
  return mmLibPromise;
}

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
  /* Everything — including mermaid.initialize, which resets shared global
     state — runs inside the queue. Two back-to-back mmRenderAll calls (e.g.
     the Guardrail Lab rendering its architecture diagram and then the mock
     replay) used to interleave initialize + run and corrupt each other into
     spurious "Syntax error in text" diagrams. */
  const job = mmQueue.then(async () => {
    try { await mmEnsure(); }
    catch (e) { list.forEach(n => noteMmErr(n, "mermaid library not loaded (offline?)")); return; }
    try {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: mmTheme(), flowchart: { htmlLabels: true, curve: "basis" } });
    } catch (e) { console.warn("mermaid init failed", e); }
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
    mmScheduleHeal(list);
  }).catch(e => console.warn("mermaid queue error", e));
  mmQueue = job.catch(() => {});
  return job;
}

/* Heal pass for diagrams mermaid laid out before fonts arrived: a NaN
   translate means measurement failed, not that the source is bad. Re-run
   ONLY the affected nodes once fonts are ready (capped retries, so a truly
   broken diagram can never loop). */
function mmScheduleHeal(list) {
  const bad = (list || []).filter(n => {
    if (!n || !document.contains(n)) return false;
    const svg = n.querySelector("svg");
    if (!svg) return false;
    if (!svg.querySelector('[transform*="NaN"], [transform*="undefined"]')) return false;
    const tries = parseInt(n.getAttribute("data-mmheal") || "0", 10);
    if (tries >= 2) return false;
    n.setAttribute("data-mmheal", String(tries + 1));
    return true;
  });
  if (!bad.length) return;
  const heal = () => mmRender(bad);
  try {
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setTimeout(heal, 60)).catch(() => setTimeout(heal, 1200));
    else setTimeout(heal, 1200);
  } catch (e) { setTimeout(heal, 1200); }
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
/* ---------------- deep links & share row: #tab/itemId ----------------
   The hash addresses a tab and, once a drawer is open, the item in it — so a
   view can be shared, bookmarked, and the browser Back button closes the
   drawer instead of leaving the app. */
let dlApplying = false;   /* true while applying a hash change */
let dlBooted = false;     /* after first paint, opens push instead of replace */
let dlShare = null;       /* { tab, id, title } for the open drawer */

function dlParse(h) {
  const raw = String(h || "").replace(/^#/, "");
  const i = raw.indexOf("/");
  const tab = (i < 0 ? raw : raw.slice(0, i)).trim();
  const id = i < 0 ? "" : raw.slice(i + 1);
  return { tab: tab, id: decodeURIComponent(id) };
}
function dlSet(tab, id) {
  if (dlApplying || !tab || !id) return;
  const target = "#" + tab + "/" + encodeURIComponent(id);
  try {
    if (location.hash === target) return;
    if (!dlBooted) history.replaceState(null, "", target);
    else history.pushState({ dl: id }, "", target);
  } catch (e) {}
}
/* Close = leave the item. If this entry was pushed by us, step back so the
   browser Back button and the app stay in agreement; otherwise just rewrite
   the hash (never navigate away from the app). */
function dlClear() {
  const tab = currentTab || "overview";
  try {
    if (!dlApplying && history.state && history.state.dl != null) { history.back(); return; }
    if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  } catch (e) {}
}
function dlWhenReady(tab, fn) {
  let tries = 0;
  (function poll() {
    if (paneInited[tab] === true || tries++ > 40) { setTimeout(fn, 60); return; }
    setTimeout(poll, 80);
  })();
}
function dlOpen(tab, id, fromHash) {
  if (!tab || !id || !document.getElementById(tab + "Pane")) return false;
  const target = "#" + tab + "/" + encodeURIComponent(id);
  switchTab(tab);
  /* switchTab may have rewritten the hash to the bare tab — restore the item */
  if (fromHash && location.hash !== target) {
    try { history.replaceState(null, "", target); } catch (e) {}
  }
  dlWhenReady(tab, function () {
    try {
      if (fromHash) dlApplying = true;
      if (tab === "patterns" && typeof openPattern === "function") openPattern(id);
      else if (tab === "scenarios" && typeof openScenario === "function") openScenario(id);
      else if (tab === "cascades" && typeof openCascade === "function") openCascade(id);
      else if (tab === "design" && typeof designShow === "function") designShow(id);
      else if (tab === "guard" && typeof guardOpenItem === "function") guardOpenItem(id);
    } catch (e) { console.warn("deep link failed", e); }
    finally { dlApplying = false; }
  });
  return true;
}

/* Robust copy: the clipboard API needs a secure context, and a LAN host on
   plain http:// does not have one — fall back to a hidden textarea. */
function copyText(text, label) {
  const ok = () => showNotif((label || "Copied") + " to clipboard", { kind: "ok" });
  const bad = () => showNotif("Clipboard blocked — select the text and copy manually", { kind: "warn" });
  const fallback = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = String(text == null ? "" : text);
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const done = document.execCommand("copy");
      ta.remove();
      done ? ok() : bad();
    } catch (e) { bad(); }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(String(text == null ? "" : text)).then(ok).catch(fallback);
      return;
    }
  } catch (e) {}
  fallback();
}
function dlShareRow() {
  if (!dlShare) return "";
  return '<button class="btn sm ghost" type="button" onclick="dlCopyLink()" title="Copy a link that opens this item directly">🔗 Copy link</button>' +
    '<button class="btn sm ghost" type="button" onclick="dlCopyId()" title="Copy the catalog id">⧉ Copy id</button>' +
    '<button class="btn sm ghost" type="button" onclick="dlCopySummary()" title="Copy this drawer as Markdown">⧉ Copy as Markdown</button>';
}
function dlCopyLink() {
  if (!dlShare) return;
  copyText(location.origin + location.pathname + "#" + dlShare.tab + "/" + encodeURIComponent(dlShare.id), "Link");
}
function dlCopyId() { if (dlShare) copyText(dlShare.id, "Id"); }
function dlCopySummary() {
  if (!dlShare) return;
  const body = el("detailBody");
  const cat = el("detailCat");
  const txt = "# " + dlShare.title + "\n\n" +
    (cat && cat.textContent ? "_" + cat.textContent + "_\n\n" : "") +
    (body ? body.innerText.replace(/\n{3,}/g, "\n\n").trim() : "");
  copyText(txt, "Summary");
}

function openDetail(title, catLabel, html, share) {
  dlShare = share || null;
  el("detailTitle").textContent = title;
  el("detailCat").textContent = catLabel;
  el("detailBody").innerHTML = html;
  const shareBox = el("detailShare");
  if (shareBox) shareBox.innerHTML = dlShareRow();
  if (dlShare) dlSet(dlShare.tab, dlShare.id);
  /* a drawer with no catalog target (tab guide, grounding preview) should not
     leave a stale #tab/itemId in the address bar */
  else { try { if (location.hash.indexOf("/") >= 0) history.replaceState(null, "", "#" + (currentTab || "overview")); } catch (e) {} }
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
  const shareBox = el("detailShare");
  if (shareBox) shareBox.innerHTML = "";
  dlShare = null;
  if (detailOpener && document.contains(detailOpener)) { try { detailOpener.focus(); } catch (e) {} }
  detailOpener = null;
  if (typeof dlClear === "function") dlClear();
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    const log = document.getElementById("notifLog");
    if (log && log.classList.contains("open")) { notifLogToggle(); return; }
    const pal = document.getElementById("palOverlay");
    if (pal && pal.classList.contains("open")) return; /* palette handles its own Esc */
    const ov = document.getElementById("detailOverlay");
    if (ov && ov.classList.contains("open")) { closeDetail(); return; }
    dismissNewestToast();   /* last resort: clear the newest toast */
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
  /* One failing module must never kill the whole boot: run each init in
     isolation and announce the culprit instead of failing silently. */
  async function safeInit(name, fn) {
    try { await fn(); }
    catch (e) {
      console.warn("init " + name + " failed", e);
      if (typeof showNotif === "function") showNotif("Could not start " + name + " — other tabs are unaffected", { kind: "warn" });
    }
  }
  try {
    /* Phase 1 — only what the first paint and the first panes read. The two
       remaining datasets load in parallel; cascades (the largest, ~423 KB) is
       awaited only by the panes that need it, keeping it off the first-pane
       path. Traces stay eager because the Overview stat cards read its count. */
    const [pats, scns, trcs, cova] = await Promise.all([
      get("data/patterns.json"), get("data/scenarios.json"),
      get("data/traces.json"), get("data/coverage.json").catch(() => null)
    ]);
    DATA = { patterns: pats, scenarios: scns, traces: trcs, cascades: null, coverage: cova };
    const paintCounts = () => {
      el("dataStatus").textContent = `${pats.patterns.length} patterns · ${scns.scenarios.length} scenarios · ${trcs.traces.length} traces · ${DATA.cascades ? DATA.cascades.cascades.length : "…"} cascades`;
      el("patBadge").textContent = pats.patterns.length;
      el("scnBadge").textContent = scns.scenarios.length;
      el("traceBadge").textContent = trcs.traces.length;
      if (el("casBadge")) el("casBadge").textContent = DATA.cascades ? DATA.cascades.cascades.length : "…";
    };
    paintCounts();
    /* Phase 2 — kick off cascades now so it downloads while the first panes
       render; the boot awaits it before the panes/dashboard/landing that read
       it, so ordering stays correct. */
    const cascadesP = get("data/cascades.json").then(c => {
      DATA.cascades = c; paintCounts(); return c;
    }).catch(e => { console.warn("cascades failed to load", e); return null; });
    catalogReady = cascadesP.then(() => {}, () => {});
    /* ---- boot order ---------------------------------------------------
       Registry first: PANE_INIT lets switchTab() run a pane's init on demand,
       so a tab visit never waits for the idle queue. */
    const has = n => typeof window[n] === "function";
    const PANES = [
      has("initOverview") && ["overview", "Overview", () => initOverview()],
      has("initPatterns") && ["patterns", "Patterns", () => initPatterns()],
      has("initScenarios") && ["scenarios", "Scenarios", () => initScenarios()],
      has("initLive") && ["live", "Live View", () => initLive()],
      has("initDesign") && ["design", "Design docs", () => initDesign()],
      has("initGuardrail") && ["guard", "Guardrail Lab", () => initGuardrail()],
      has("initCopilot") && ["copilot", "Fox - Architect", () => initCopilot()],
      has("initCascades") && ["cascades", "Cascades", () => initCascades()],
      has("initCoverage") && ["coverage", "Coverage", () => initCoverage()],
      has("initDeploy") && ["deploy", "Deployment Plan", () => initDeploy()],
      has("initBlueprint") && ["blueprint", "Blueprints", () => initBlueprint()],
      has("initDiscovery") && ["discovery", "Discovery Lab", () => initDiscovery()]
    ].filter(Boolean);
    PANES.forEach(p => { PANE_INIT[p[0]] = p[2]; });
    const paneRun = async p => {
      if (paneInited[p[0]]) return;
      paneInited[p[0]] = "starting";
      await safeInit(p[1], p[2]);
      paneInited[p[0]] = true;
      paneSkeletonOff(p[0]);
    };

    /* First paint path: overview, the pane you asked for, and the catalog
       panes the dashboard and palette link into. */
    const bootTab = (function () {
      const h = (location.hash || "").replace("#", "");
      return document.getElementById(h + "Pane") ? h : "overview";
    })();
    const EARLY = ["overview", "patterns", "scenarios"];
    const first = PANES.filter(p => EARLY.indexOf(p[0]) >= 0 || p[0] === bootTab);
    const rest = PANES.filter(p => first.indexOf(p) < 0);

    PANES.forEach(p => paneSkeletonOn(p[0]));
    for (const p of first) await paneRun(p);

    /* First panes are on screen; the catalog-wide pieces below (palette index,
       dashboard, landing) read cascades, so make sure phase 2 has landed. */
    await cascadesP;

    if (typeof initPalette === "function") await safeInit("palette", async () => initPalette());
    if (typeof initShortcuts === "function") await safeInit("shortcuts", async () => initShortcuts());
    if (typeof initTabBar === "function") await safeInit("tab bar", async () => initTabBar());
    if (typeof dashRender === "function") await safeInit("dashboard", async () => dashRender());
    if (typeof initLanding === "function") await safeInit("landing", async () => initLanding());
    if (typeof LLM !== "undefined" && typeof LLM.bootPill === "function") LLM.bootPill();
    if (typeof paintSaveStamps === "function") paintSaveStamps();
    if (typeof uxPaintViewSegs === "function") uxPaintViewSegs();
    if (typeof shellFreshCheck === "function") shellFreshCheck();
    if (typeof a11yBarsInit === "function") a11yBarsInit();
    if (typeof netPaint === "function") netPaint();
    if (typeof onbShow === "function") setTimeout(() => onbShow(false), 350);
    const hash = (location.hash || "").replace("#", "");
    const dl = dlParse(location.hash);
    if (dl.id) dlOpen(dl.tab, dl.id, false);
    else if (hash && document.getElementById(hash + "Pane")) switchTab(hash);
    dlBooted = true;

    /* the rest, one pane per idle slice — never on the first-paint path */
    const queue = rest.slice();
    const idle = window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: 900 })
      : (fn) => setTimeout(fn, 40);
    const pump = () => {
      const p = queue.shift();
      if (!p) return;
      Promise.resolve(paneRun(p)).catch(() => {}).then(() => { if (queue.length) idle(pump); });
    };
    idle(pump);
  } catch (e) {
    el("dataStatus").textContent = "failed to load data — serve via `python3 serve.py`";
    console.error(e);
  }
}
window.addEventListener("hashchange", () => {
  const dl = dlParse(location.hash);
  if (dl.id) { dlOpen(dl.tab, dl.id, true); return; }
  /* bare tab hash: closing an open drawer (browser Back) lands here */
  dlApplying = true;
  try { closeDetail(); } catch (e) {}
  dlApplying = false;
  if (dl.tab && dl.tab !== currentTab && document.getElementById(dl.tab + "Pane")) switchTab(dl.tab);
});
loadAll();
