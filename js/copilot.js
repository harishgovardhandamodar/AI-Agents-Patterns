/* copilot.js — Architect Copilot tab.
   A grounded chat over the catalog, answered by the local model (Qwen 3.8-27B
   via Fox-Services) through the /api/llm proxy, with a deterministic local
   fallback when no model is reachable. Retrieval lives in js/context.js
   (AIContext); this file owns the conversation, rendering and streaming. */

"use strict";

const CP_STORE = "aap.copilot";
let cpBusy = false;
let cpAbort = null;
let cpMessages = [];          // [{role, content, meta?, cites?}]
let cpScope = { patterns: true, scenarios: true, cascades: true, traces: true };

/* ---------------- persistence ---------------- */
function cpSave() {
  try { localStorage.setItem(CP_STORE, JSON.stringify({ messages: cpMessages, scope: cpScope, model: el("cpModel") && el("cpModel").value })); } catch (e) {}
  if (typeof markSaved === "function") markSaved("cp");
}
function cpRestore() {
  try {
    const s = JSON.parse(localStorage.getItem(CP_STORE) || "{}");
    if (Array.isArray(s.messages)) cpMessages = s.messages;
    if (s.scope) cpScope = Object.assign(cpScope, s.scope);
  } catch (e) {}
}

/* ---------------- markdown-lite ---------------- */
function cpMd(text) {
  const blocks = [];
  let s = String(text == null ? "" : text).replace(/\r/g, "");
  // pull fenced code out first so later rules cannot touch it
  s = s.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, function (m, code) {
    blocks.push("<pre>" + escHtml(code.replace(/\n$/, "")) + "</pre>");
    return "\u0000" + (blocks.length - 1) + "\u0000";
  });
  s = escHtml(s);
  s = s.replace(/^#{1,6}\s+(.*)$/gm, "<h4>$1</h4>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // lists
  s = s.replace(/(?:^|\n)((?:[-*]\s+.*(?:\n|$))+)/g, function (m, block) {
    const items = block.trim().split(/\n/).map(function (l) {
      return "<li>" + l.replace(/^[-*]\s+/, "") + "</li>";
    }).join("");
    return "\n<ul>" + items + "</ul>";
  });
  // paragraphs
  s = s.split(/\n{2,}/).map(function (p) {
    p = p.trim();
    if (!p) return "";
    if (/^<(h4|ul|pre|ol|blockquote)/.test(p) || /^\u0000\d+\u0000$/.test(p)) return p;
    return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
  }).join("\n");
  s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return blocks[+i] || ""; });
  return s;
}

/* ---------------- rendering ---------------- */
function cpAnnounce(text) {
  let r = document.getElementById("cpLive");
  if (!r) {
    r = document.createElement("div");
    r.id = "cpLive";
    r.className = "sr-only";
    r.setAttribute("role", "status");
    r.setAttribute("aria-live", "polite");
    document.body.appendChild(r);
  }
  r.textContent = "";
  setTimeout(() => { r.textContent = text; }, 30);
}
function cpCopyMsg(i) {
  const m = cpMessages[i];
  if (!m || !m.content) { showNotif("Nothing to copy"); return; }
  if (navigator.clipboard) navigator.clipboard.writeText(m.content)
    .then(() => showNotif("Answer copied to clipboard"))
    .catch(() => showNotif("Clipboard blocked — select the text manually", { kind: "warn" }));
  else showNotif("Clipboard unavailable — select the text manually", { kind: "warn" });
}
function cpActionsHtml(m, i, isLast) {
  if (m.role === "user") return `<div class="cp-actions"><button type="button" onclick="cpCopyMsg(${i})" title="Copy this question">⧉ copy</button></div>`;
  let h = `<div class="cp-actions"><button type="button" onclick="cpCopyMsg(${i})" title="Copy this answer">⧉ copy</button>`;
  if (isLast) h += `<button type="button" onclick="cpRegen(${i})" title="Ask the same question again"${cpBusy ? " disabled" : ""}>↻ regenerate</button>`;
  return h + "</div>";
}
function cpFollowHtml(m) {
  const cites = (m.cites || []).slice(0, 3);
  const qs = cites.length
    ? cites.map(c => ({ q: `What controls defend against “${c.label}”?`, t: `Defend: ${c.label}` }))
    : [{ q: "What are the residual gaps in this answer?", t: "Residual gaps?" },
       { q: "What should I implement first, and why?", t: "What first?" },
       { q: "How do I test that these controls actually hold?", t: "How to test?" }];
  return `<div class="cp-follow"><span class="muted small">Follow up:</span> ` + qs.map((f, k) =>
    `<button type="button" onclick="cpFollowAsk(${k})" data-fq="${escHtml(f.q)}">${escHtml(f.t)}</button>`).join("") + `</div>`;
}
function cpFollowAsk(k) {
  const log = el("cpLog");
  const row = log && log.querySelector(".cp-follow");
  const btn = row && row.querySelectorAll("button")[k];
  const q = btn && btn.getAttribute("data-fq");
  if (!q || cpBusy) return;
  const input = el("cpInput");
  if (input) input.value = q;
  cpSend();
}
function cpMsgEl(m, stream, i, isLast) {
  const wrap = document.createElement("div");
  wrap.className = "cp-msg " + (m.role === "user" ? "user" : "assistant");
  if (m.role === "user") {
    wrap.textContent = m.content;
    wrap.insertAdjacentHTML("beforeend", cpActionsHtml(m, i, isLast));
    return wrap;
  }
  wrap.innerHTML = '<div class="who">◆ Architect Copilot' +
    (m.meta ? ' <span class="chip" style="font-size:9px">' + escHtml(m.meta) + "</span>" : "") +
    (stream ? ' <span class="cp-stream-dot">●</span>' : "") + "</div>";
  const bubble = document.createElement("div");
  bubble.className = "cp-bubble";
  bubble.innerHTML = (m.offline ? '<div class="cp-offline-note">⚠ answered locally — no model backend reachable</div>' : "") +
    (m.content ? cpMd(m.content) : '<div class="cp-thinking"><span class="spinner"></span> thinking…</div>');
  wrap.appendChild(bubble);
  if (m.cites && m.cites.length) wrap.appendChild(cpCiteEl(m.cites));
  wrap.insertAdjacentHTML("beforeend", cpActionsHtml(m, i, isLast));
  if (isLast && m.content && !stream) wrap.insertAdjacentHTML("beforeend", cpFollowHtml(m));
  return wrap;
}
function cpCiteEl(cites) {
  const d = document.createElement("div");
  d.className = "cp-cites";
  cites.forEach(function (c) {
    const b = document.createElement("span");
    b.className = "cp-cite " + (c.kind || "").charAt(0);
    b.textContent = c.label;
    b.title = "Open in catalog";
    b.onclick = function () { cpOpenCite(c); };
    d.appendChild(b);
  });
  d.insertAdjacentHTML("afterbegin", '<span class="muted small" style="align-self:center;margin-right:2px">grounded in:</span>');
  return d;
}
function cpOpenCite(c) {
  if (c.kind === "pattern" && typeof openPattern === "function") openPattern(c.id);
  else if (c.kind === "scenario" && typeof openScenario === "function") openScenario(c.id);
  else if (c.kind === "trace" && typeof loadTrace === "function") { switchTab("live"); setTimeout(function () { loadTrace(c.id); }, 90); }
  else if (c.kind === "cascade" && typeof openCascade === "function") openCascade(c.id);
  else showNotif("Open from the catalog tab");
}
function cpRenderLog() {
  const log = el("cpLog");
  if (!log) return;
  log.innerHTML = "";
  if (!cpMessages.length) {
    log.innerHTML = '<div class="cp-empty"><h3>Architect Copilot</h3>' +
      "<p>Ask about your agent deployment in plain words. Answers are grounded in the pattern catalog, threat scenarios, cascade model and traces.</p>" +
      "<p class=\"small\">Model: local Qwen 3.8-27B via Fox-Services (axiom fallback). Press <span class=\"cp-kbd\">Enter</span> to send, <span class=\"cp-kbd\">Shift</span>+<span class=\"cp-kbd\">Enter</span> for a new line.</p></div>";
    return;
  }
  const last = cpMessages[cpMessages.length - 1];
  cpMessages.forEach(function (m, i) {
    log.appendChild(cpMsgEl(m, cpBusy && m === last && m.role === "assistant", i, m === last));
  });
  cpScroll();
}
function cpScroll() { const log = el("cpLog"); if (log) log.scrollTop = log.scrollHeight; }

/* ---------------- status + models ---------------- */
function cpSetStatus() {
  const s = el("cpStatus");
  if (!s) return;
  if (!LLM.state.probed) { s.innerHTML = '<span class="dot wait"></span>checking model…'; return; }
  if (LLM.state.ready) s.innerHTML = '<span class="dot on"></span>' + escHtml(LLM.label());
  else s.innerHTML = '<span class="dot off"></span>model offline · deterministic fallback';
  if (typeof LLM.paintPill === "function") { try { LLM.paintPill(); } catch (e) {} }
}
async function cpLoadModels() {
  const sel = el("cpModel");
  if (!sel) return;
  // Seed immediately so the picker is never empty while the health probe runs.
  if (!sel.options.length) {
    const o = document.createElement("option");
    o.value = LLM.state.defaultModel; o.textContent = LLM.state.defaultModel;
    sel.appendChild(o);
  }
  await LLM.probe();
  cpSetStatus();
  const list = await LLM.models();
  const cur = sel.value || LLM.state.defaultModel;
  sel.innerHTML = "";
  const ids = (list && list.length) ? list : [LLM.state.defaultModel];
  ids.forEach(function (id) {
    const o = document.createElement("option");
    o.value = id; o.textContent = id;
    sel.appendChild(o);
  });
  sel.value = ids.indexOf(cur) >= 0 ? cur : (ids.indexOf(LLM.state.defaultModel) >= 0 ? LLM.state.defaultModel : ids[0]);
}

/* ---------------- prompts ---------------- */
const CP_SUGGESTIONS = [
  "A customer-support agent can refund up to $2,000 and email customers. What patterns, cascade risks and mitigations should I plan?",
  "We are launching a 4-agent research pipeline. Which emergent failures should we expect and how do we contain them?",
  "Finance: a payments agent uses a corporate card. Give me an inherent/emergent/derived/cascading risk breakdown and a mitigation plan.",
  "What does good agent observability and detection look like, and which traces in the catalog demonstrate it?",
  "Score our readiness: healthcare triage agent, read-only tools, human review of all outputs, single tenant.",
  "Which patterns cover prompt injection end-to-end, and where are the residual gaps?"
];
function cpRenderSuggestions() {
  const box = el("cpSuggest");
  if (!box) return;
  box.innerHTML = "";
  CP_SUGGESTIONS.forEach(function (q) {
    const b = document.createElement("button");
    b.textContent = q;
    b.onclick = function () { el("cpInput").value = q; cpSend(); };
    box.appendChild(b);
  });
}

/* ---------------- send / stream ---------------- */
function cpBuildMessages(query) {
  const msgs = [];
  let system = "You are the Architect Copilot for an enterprise AI-agent design catalog. " +
    "Answer as a pragmatic, senior enterprise architect. Be concrete and structured: use short headings and bullet lists, name specific patterns and scenarios from the catalog, and always cover risk and mitigation. " +
    "Prefer the four cascade classes (inherent, emergent, derived, cascading) when analysing failure propagation. " +
    "Never invent catalog items that are not in the provided context. If context is missing, say so and reason from first principles. Keep answers tight — no filler.";
  if (typeof AIContext !== "undefined") {
    const ctx = AIContext.build(query, cpScope);
    if (ctx && ctx.text) {
      system += "\n\n=== CATALOG CONTEXT (authoritative; cite by name) ===\n" + ctx.text;
      msgs._ctx = ctx;
    }
  }
  msgs.push({ role: "system", content: system });
  // keep the last few turns for continuity, cap length
  const hist = cpMessages.slice(-6);
  hist.forEach(function (m) { if (m.role === "user" || m.role === "assistant") msgs.push({ role: m.role, content: m.content }); });
  msgs.push({ role: "user", content: query });
  return msgs;
}

async function cpSend() {
  if (cpBusy) return;
  const input = el("cpInput");
  const q = (input.value || "").trim();
  if (!q) return;
  input.value = "";
  cpAskNew(q);
}
/* New question: push the user turn, then stream the answer. */
function cpAskNew(q) {
  cpMessages.push({ role: "user", content: q });
  cpRunAssistant(q);
}
/* Regenerate: drop the old assistant answer, re-run the same question
   without duplicating the user turn. */
function cpRegen(i) {
  if (cpBusy) return;
  const cur = cpMessages[i];
  if (!cur || cur.role !== "assistant") return;
  let q = "";
  for (let j = i - 1; j >= 0; j--) {
    if (cpMessages[j].role === "user") { q = cpMessages[j].content; break; }
  }
  if (!q) { showNotif("No question found to regenerate"); return; }
  cpMessages.splice(i, 1);
  cpRunAssistant(q);
}
async function cpRunAssistant(q) {
  const assistant = { role: "assistant", content: "", cites: [] };
  cpMessages.push(assistant);
  cpRenderLog();
  cpBusy = true;
  cpSetBusyUI(true);
  cpAnnounce("Thinking — grounding the question in the catalog.");

  const payload = cpBuildMessages(q);
  if (payload._ctx) assistant.cites = payload._ctx.cites;
  assistant._ctxText = payload._ctx ? payload._ctx.text : "";

  // Re-render with cites once we know them (they are attached to the object).
  cpRenderLog();

  cpAbort = new AbortController();
  try {
    await LLM.chat({
      model: el("cpModel").value,
      messages: payload,
      signal: cpAbort.signal,
      temperature: 0.35,
      onMeta: function (meta) {
        assistant.meta = meta.backend + (meta.model ? " · " + meta.model : "");
        cpSetStatus();
      },
      onDelta: function (chunk) { cpAppend(assistant, chunk); }
    });
    if (!assistant.content.trim()) assistant.content = "_No content returned._";
  } catch (e) {
    if (e && e.name === "AbortError") {
      assistant.content += "\n\n_(stopped)_";
    } else {
      // deterministic local fallback (unreachable *or* timed out — a backend
      // can report "online" while its model is wedged)
      const fb = (typeof AIContext !== "undefined")
        ? AIContext.answer(q, payload._ctx, cpScope)
        : { text: "The local model is unreachable and no fallback is available.", cites: [] };
      assistant.offline = true;
      assistant.content = fb.text;
      if (fb.cites) assistant.cites = fb.cites;
      showNotif(e && e.name === "TimeoutError"
        ? "Model timed out — answered from the local catalog"
        : "Model unreachable — answered from the local catalog");
    }
  } finally {
    cpBusy = false;
    cpAbort = null;
    cpSetBusyUI(false);
    cpRenderLog();
    cpSave();
    cpAnnounce(/_\(stopped\)_\s*$/.test(assistant.content)
      ? "Stopped."
      : assistant.offline
        ? "Answer complete, from the local catalog fallback."
        : "Answer complete" + (assistant.cites && assistant.cites.length ? ", grounded in " + assistant.cites.length + " catalog items." : "."));
  }
}

let cpFlushTimer = null;
function cpAppend(assistant, chunk) {
  assistant.content += chunk;
  if (cpFlushTimer) return;
  cpFlushTimer = setTimeout(function () {
    cpFlushTimer = null;
    const log = el("cpLog");
    const lastEl = log && log.lastElementChild;
    if (lastEl && lastEl.classList.contains("assistant")) {
      const b = lastEl.querySelector(".cp-bubble");
      if (b) b.innerHTML = cpMd(assistant.content);
    } else {
      cpRenderLog();
    }
    cpScroll();
  }, 70);
}

function cpSetBusyUI(busy) {
  const send = el("cpSend"), stop = el("cpStop");
  if (send) send.disabled = busy;
  if (stop) stop.style.display = busy ? "" : "none";
}
function copilotStop() { if (cpAbort) cpAbort.abort(); }

/* ---------------- public actions ---------------- */
function copilotNew() {
  if (cpBusy) copilotStop();
  cpMessages = [];
  cpRenderLog();
  cpSave();
  if (el("cpInput")) el("cpInput").focus();
}
/* Show the exact catalog context that would be sent to the model — grounding
   transparency so an architect can audit (and correct) what the model sees. */
function copilotPreview() {
  if (typeof AIContext === "undefined") { showNotif("Context module not loaded"); return; }
  let q = (el("cpInput") && el("cpInput").value || "").trim();
  if (!q) {
    for (let i = cpMessages.length - 1; i >= 0; i--) { if (cpMessages[i].role === "user") { q = cpMessages[i].content; break; } }
  }
  if (!q) { showNotif("Type a question first"); return; }
  const ctx = AIContext.build(q, cpScope);
  const html = '<p class="muted small">Deterministic retrieval from the catalog for: <b>' + escHtml(q) + "</b></p>" +
    "<p class=\"muted small\">" + ctx.cites.length + " items retrieved · " + ctx.text.length + " chars. This is the ground truth handed to the model — no model tokens were spent.</p>" +
    '<pre style="white-space:pre-wrap;font-family:var(--mono);font-size:11px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;max-height:60vh;overflow:auto">' +
    escHtml(ctx.text) + "</pre>";
  openDetail("Grounding preview", "AIContext.build", html);
}
function copilotExport() {
  const md = cpMessages.map(function (m) {
    return (m.role === "user" ? "## You\n\n" : "## Architect Copilot" + (m.meta ? " _(" + m.meta + ")_" : "") + "\n\n") + m.content;
  }).join("\n\n---\n\n");
  cpDownload("architect-copilot-chat.md", md);
}
function cpDownload(name, text) {
  const blob = new Blob([text], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
}

/* ---------------- scope ---------------- */
function cpRenderScope() {
  const box = el("cpScope");
  if (!box) return;
  const defs = [["patterns", "Patterns"], ["scenarios", "Scenarios"], ["cascades", "Cascades"], ["traces", "Traces"]];
  box.innerHTML = "";
  defs.forEach(function (d) {
    const l = document.createElement("label");
    l.innerHTML = '<input type="checkbox" ' + (cpScope[d[0]] ? "checked" : "") + "> " + d[1];
    l.querySelector("input").onchange = function (e) { cpScope[d[0]] = e.target.checked; cpSave(); };
    box.appendChild(l);
  });
}

/* ---------------- init ---------------- */
function initCopilot() {
  if (!el("cpLog")) return;
  cpRestore();
  cpRenderScope();
  cpRenderSuggestions();
  cpRenderLog();
  cpSetStatus();
  const input = el("cpInput");
  if (input && !input._wired) {
    input._wired = true;
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); cpSend(); }
    });
  }
  cpLoadModels().then(cpSetStatus);
}
/* Deep-link entry used by other views (Coverage, Cascades, Deployment…):
   switch to the Copilot tab, seed the input and send the question. */
function copilotAsk(q) {
  if (!q) return;
  switchTab("copilot");
  setTimeout(function () {
    if (!el("cpLog")) return;
    const input = el("cpInput");
    if (!input) return;
    input.value = q;
    cpSend();
  }, 60);
}

tabLoaders.copilot = function () { initCopilot(); };
