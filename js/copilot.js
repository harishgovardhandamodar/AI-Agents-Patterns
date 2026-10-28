/* copilot.js — Fox-Architect tab.
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
  const trim = n => {
    try {
      localStorage.setItem(CP_STORE, JSON.stringify({ messages: cpMessages.slice(-n), scope: cpScope, model: el("cpModel") && el("cpModel").value, persona: cpPersona, audience: cpAudience }));
      return true;
    } catch (e) { return false; }
  };
  /* Cap history so one long chat can't fill browser storage (which would
     silently break every other save in the app). Trim oldest first. */
  const ok = trim(40) || trim(20);
  if (ok) { if (typeof markSaved === "function") markSaved("cp"); }
  else if (typeof markSaveFailed === "function") markSaveFailed("cp", "Fox-Architect chat");
}
function cpRestore() {
  try {
    const s = JSON.parse(localStorage.getItem(CP_STORE) || "{}");
    if (Array.isArray(s.messages)) cpMessages = s.messages;
    if (s.scope) cpScope = Object.assign(cpScope, s.scope);
    if (typeof s.persona === "string" && CP_PERSONAS.some(p => p.id === s.persona)) cpPersona = s.persona;
    if (typeof s.audience === "string" && CP_AUDIENCES.some(a => a.id === s.audience)) cpAudience = s.audience;
  } catch (e) {}
}

/* ---------------- markdown-lite ---------------- */
function cpMd(text) {
  const blocks = [];
  let s = String(text == null ? "" : text).replace(/\r/g, "");
  // Models often skip the ```mermaid fence and emit the diagram bare (a
  // keyword line followed by graph lines). Detect those runs and fence them
  // so they render instead of showing as source text.
  s = fenceBareMermaid(s);
  // pull fenced code out first so later rules cannot touch it. Mermaid
  // fences become real diagrams (rendered by mmRenderAll after insert);
  // every other language stays a plain code block.
  s = s.replace(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g, function (m, lang, code) {
    code = code.replace(/\n$/, "");
    if (String(lang).toLowerCase() === "mermaid" && typeof diagramHtml === "function" && code.trim()) blocks.push(diagramHtml(code));
    else blocks.push("<pre>" + (lang ? '<span class="cp-code-lang">' + escHtml(lang) + "</span>" : "") + escHtml(code) + "</pre>");
    return "\u0000" + (blocks.length - 1) + "\u0000";
  });
  s = escHtml(s);
  s = s.replace(/^#{1,6}\s+(.*)$/gm, "<h4>$1</h4>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  /* Links come from model output, so the scheme is whitelisted: only http(s)
     and same-app fragments become anchors. Anything else (javascript:, data:,
     file:, bare words the model meant as text) renders as inert text — the
     label survives, the navigation doesn't. */
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
    const u = String(url);
    if (/^(https?:\/\/|#)/i.test(u) && !/[\s<>]/.test(u)) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + text + "</a>";
    }
    return text + ' <span class="muted small">(' + u + ")</span>";
  });
  // pipe tables -> .tbl (same styling as the catalog drawers)
  s = s.replace(/^((?:\|[^\n]*\|\s*\n)+)/gm, function (block) {
    const rows = block.trim().split("\n");
    if (rows.length < 2) return block;
    const isDelim = r => /^\|[\s:\-|]+\|\s*$/.test(r) && r.indexOf("-") >= 0;
    if (!isDelim(rows[1])) return block;
    const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
    const aligns = cells(rows[1]).map(c => /^:.*:$/.test(c) ? "center" : /:$/.test(c) ? "right" : /^:/.test(c) ? "left" : "");
    const cell = (c, i, tag) => "<" + tag + (aligns[i] ? ' style="text-align:' + aligns[i] + '"' : "") + ">" + (c || "") + "</" + tag + ">";
    let h = '<table class="tbl cp-table"><thead><tr>' +
      cells(rows[0]).map((c, i) => cell(c, i, "th")).join("") + "</tr></thead><tbody>";
    rows.slice(2).forEach(r => {
      if (!r.trim() || isDelim(r)) return;
      h += "<tr>" + cells(r).map((c, i) => cell(c, i, "td")).join("") + "</tr>";
    });
    return h + "</tbody></table>";
  });
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
    if (/^<(h4|ul|pre|ol|blockquote|table)/.test(p) || /^\u0000\d+\u0000$/.test(p)) return p;
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
  if (m.role === "user") return `<div class="cp-actions"><button type="button" data-act="cpCopyMsg" data-args='[${i}]' title="Copy this question">⧉ copy</button></div>`;
  let h = `<div class="cp-actions"><button type="button" data-act="cpCopyMsg" data-args='[${i}]' title="Copy this answer">⧉ copy</button>`;
  if (isLast) h += `<button type="button" data-act="cpRegen" data-args='[${i}]' title="Ask the same question again"${cpBusy ? " disabled" : ""}>↻ regenerate</button>`;
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
    `<button type="button" data-act="cpFollowAsk" data-args='[${k}]' data-fq="${escHtml(f.q)}">${escHtml(f.t)}</button>`).join("") + `</div>`;
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
  wrap.innerHTML = '<div class="who">◆ Fox-Architect' +
    (m.meta ? ' <span class="chip" style="font-size:9px">' + escHtml(m.meta) + "</span>" : "") +
    (m.persona ? ' <span class="chip" style="font-size:9px" title="Answer voice and delivery audience">' +
      escHtml((CP_PERSONAS.find(p => p.id === m.persona) || {}).label || m.persona) + " → " +
      escHtml((CP_AUDIENCES.find(a => a.id === (m.audience || "peer")) || {}).label || m.audience || "") + "</span>" : "") +
    (stream ? ' <span class="cp-stream-dot">●</span>' : "") + "</div>";
  const bubble = document.createElement("div");
  bubble.className = "cp-bubble";
  bubble.innerHTML = (m.offline ? '<div class="cp-offline-note">⚠ answered locally — no model backend reachable</div>' : "") +
    (m.content ? cpMd(m.content) : '<div class="cp-thinking"><span class="spinner"></span> thinking…</div>');
  wrap.appendChild(bubble);
  if (m.cites && m.cites.length) wrap.appendChild(cpCiteEl(m.cites));
  if (m.unverified && m.unverified.length) {
    const w = document.createElement("div");
    w.className = "cp-unverified";
    w.textContent = "\u26a0 unverified in retrieved context: " + m.unverified.join(", ");
    w.title = "These look like catalog IDs but do not occur in the text the model was given. Treat the claim as ungrounded until checked.";
    wrap.appendChild(w);
  }
  wrap.insertAdjacentHTML("beforeend", cpActionsHtml(m, i, isLast));
  if (isLast && m.content && !stream) wrap.insertAdjacentHTML("beforeend", cpFollowHtml(m));
  return wrap;
}
/* Citations are the user's path from prose back into the catalog. They
   used to be <span onclick> — not focusable, not keyboard-reachable, not
   copyable as a URL. Now they are real <a href="#tab/id"> links: the
   browser can open them in a new tab, they are in the tab order, and the
   address bar shows the destination (iteration 111). */
function cpCiteEl(cites) {
  const d = document.createElement("div");
  d.className = "cp-cites";
  cites.forEach(function (c) {
    const tab = cpCiteTab(c.kind);
    const a = document.createElement("a");
    a.className = "cp-cite " + (c.kind || "").charAt(0);
    a.textContent = c.label;
    a.href = tab ? ("#" + tab + "/" + encodeURIComponent(c.id)) : "#";
    a.title = tab ? ("Open " + (c.kind || "item") + " in the catalog — " + c.id) : "Open in catalog";
    a.setAttribute("data-cite-kind", c.kind || "");
    a.addEventListener("click", function (ev) {
      /* let the browser handle modified clicks (new tab, new window) */
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
      ev.preventDefault();
      cpOpenCite(c);
    });
    d.appendChild(a);
  });
  d.insertAdjacentHTML("afterbegin", '<span class="muted small" style="align-self:center;margin-right:2px">grounded in:</span>');
  return d;
}

/* Which tab holds a kind of citation. */
/* Claim-level citation check (P1-6). Attached citations say which catalog
   records were retrieved; this checks what the prose actually claims.
   Every slug-like token (`dual-control`) and S-###/P-###-style token in
   the answer must occur in the retrieved context text, or it is reported
   as unverified. Code spans are ignored. Returns at most 8 tokens. */
function cpVerifyCites(content, ctxText) {
  const ctx = String(ctxText || "").toLowerCase();
  let text = String(content || "");
  text = text.replace(/`[^`\n]+`/g, " ");
  const seen = Object.create(null);
  const out = [];
  function consider(tok) {
    const t = tok.toLowerCase();
    if (!t || seen[t] || t.length > 60) return;
    seen[t] = 1;
    const spaced = t.split("-").join(" ");
    if (ctx.indexOf(t) < 0 && ctx.indexOf(spaced) < 0 && out.length < 8) out.push(tok);
  }
  let m;
  const slugRe = /[a-z0-9]+(?:-[a-z0-9]+){1,4}/g;
  while ((m = slugRe.exec(text)) !== null) consider(m[0]);
  const idRe = /\b[SP]-\d{1,4}\b/g;
  while ((m = idRe.exec(text)) !== null) consider(m[0]);
  return out;
}

function cpCiteTab(kind) {
  if (kind === "pattern") return "patterns";
  if (kind === "scenario") return "scenarios";
  if (kind === "cascade") return "cascades";
  if (kind === "trace") return "live";
  return null;
}
function cpOpenCite(c) {
  const tab = cpCiteTab(c.kind);
  if (tab) { goTo(tab, c.id); return; }
  if (c.kind === "pattern" && typeof openPattern === "function") openPattern(c.id);
  else if (c.kind === "scenario" && typeof openScenario === "function") openScenario(c.id);
  else if (c.kind === "trace" && typeof loadTrace === "function") { goTo("live", c.id); }
  else if (c.kind === "cascade" && typeof openCascade === "function") openCascade(c.id);
  else showNotif("Open from the catalog tab");
}
function cpRenderLog() {
  const log = el("cpLog");
  if (!log) return;
  log.innerHTML = "";
  if (!cpMessages.length) {
    log.innerHTML = '<div class="cp-empty"><h3>Fox-Architect</h3>' +
      "<p>Ask about your agent deployment in plain words. Answers are grounded in the pattern catalog, threat scenarios, cascade model and traces.</p>" +
      "<p class=\"small\">Model: local Qwen 3.8-27B via Fox-Services (axiom fallback). Press <span class=\"cp-kbd\">Enter</span> to send, <span class=\"cp-kbd\">Shift</span>+<span class=\"cp-kbd\">Enter</span> for a new line.</p></div>";
    return;
  }
  const last = cpMessages[cpMessages.length - 1];
  cpMessages.forEach(function (m, i) {
    log.appendChild(cpMsgEl(m, cpBusy && m === last && m.role === "assistant", i, m === last));
  });
  cpScroll();
  /* render any mermaid diagrams the answer included (message boundaries
     only — mid-stream partial fences stay plain text until completion).
     Diagrams mermaid cannot parse fall back to a readable code block. */
  if (typeof mmRenderAll === "function") {
    try { mmRenderAll(log).then(function () { cpMermaidFallback(log); }); }
    catch (e) { console.warn("chat mermaid failed", e); }
  }
}
/* Replace mermaid error notes in chat with the raw source in a <pre>, so a
   malformed diagram is still readable instead of hidden behind an error.
   Covers both failure modes: our own .mm-err-note, and mermaid's native
   error SVG ("Syntax error in text" + .error-icon), which suppressErrors
   renders inline. */
function cpMermaidFallback(log) {
  if (!log || !log.querySelectorAll) return;
  const toSource = function (pre) {
    const wrap = pre.closest(".diagram-wrap");
    const raw = pre.getAttribute("data-src") || "";
    /* Never dump rendered markup as "source": if there is no clean source,
       leave mermaid's own error render alone. */
    if (!raw.trim() || /</.test(raw)) return;
    const d = document.createElement("pre");
    d.className = "cp-mermaid-src";
    d.textContent = raw.trim();
    if (wrap) wrap.replaceWith(d); else pre.replaceWith(d);
  };
  log.querySelectorAll(".mm-err-note").forEach(function (n) {
    const wrap = n.closest(".diagram-wrap");
    const pre = wrap && wrap.querySelector("pre.mermaid");
    if (pre && (pre.getAttribute("data-src") || pre.textContent || "").trim()) {
      n.remove();
      toSource(pre);
    } else n.remove();
  });
  log.querySelectorAll("pre.mermaid").forEach(function (pre) {
    if (pre.querySelector(".error-icon") || /syntax error in text/i.test(pre.textContent || ""))
      toSource(pre);
  });
}
function cpScroll() { const log = el("cpLog"); if (log) log.scrollTop = log.scrollHeight; }

/* Wrap unfenced diagram runs in ```mermaid fences so they render.
   A run starts at a diagram-keyword line and continues over blank-free,
   non-markdown lines that are indented or carry a graph token — plain prose
   (even right after a diagram) never qualifies. */
function fenceBareMermaid(s) {
  const kw = /^(?:flowchart\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|gantt|pie(?:\s+showData|\s+title\b)?|quadrantChart|xychart-beta|mindmap|timeline|gitGraph)\b/;
  const mdish = /^[ \t]*(?:#{1,6}[ \t]|```|[-*][ \t]|\d+[.)][ \t]|>[ \t]|\|)/;
  const token = /-->|---|->>|==>|\|[^\n|]+\||\(\(|\)\)|\[|\{|\(|::/;
  const lines = String(s).split("\n"), out = [];
  let i = 0, inFence = false;
  while (i < lines.length) {
    if (/^[ \t]*```/.test(lines[i])) { inFence = !inFence; out.push(lines[i++]); continue; }
    if (!inFence && kw.test(lines[i])) {
      const run = [lines[i++]];
      while (i < lines.length && lines[i].trim() !== "" && !mdish.test(lines[i]) &&
        (/^[ \t]+\S/.test(lines[i]) || token.test(lines[i]))) run.push(lines[i++]);
      const block = run.join("\n");
      if (run.length >= 2 && token.test(block)) out.push("```mermaid", block, "```");
      else out.push(block);
    } else out.push(lines[i++]);
  }
  return out.join("\n");
}

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

/* ---------------- personas + delivery modes --------------------
   Persona = WHO answers (voice, expertise, method). Audience = who the
   answer is FOR (depth, vocabulary, what "done" looks like). Both are
   persisted and composed into the live model's system prompt; the offline
   deterministic fallback always uses the default catalog voice. */
const CP_PERSONAS = [
  { id: "agent-architect", label: "AI Agent Architect",
    blurb: "pragmatic builder's view",
    sys: "You answer as a pragmatic senior AI-agent architect. Lead with what to build and in what order. Concrete, opinionated, allergic to hand-waving." },
  { id: "security-architect", label: "Security Architect",
    blurb: "adversarial, assume-breach",
    sys: "You answer as a security architect. Assume breach: start from how this fails or gets abused, map every recommendation to STRIDE and to a protection layer (identity, context, policy, process, infrastructure, data, DLP, observability). Name the residual risk explicitly. Never accept a control at face value — say how you would test or red-team it." },
  { id: "phd-researcher", label: "Experienced Researcher (PhD)",
    blurb: "rigorous, mechanism-first",
    sys: "You answer as an experienced researcher with a PhD in AI systems. Lead with mechanisms, not slogans: define terms, separate what is measured from what is assumed, cite the catalog items that ground each claim, and close with open questions and what evidence would change your mind." },
  { id: "council", label: "Counsel of Architects",
    blurb: "several viewpoints + dissent",
    sys: "You answer as a counsel of three architects with different priors (a builder, a skeptic, an empiricist). Give each a short named viewpoint on the question, let them disagree explicitly (mark dissent!), then synthesize a joint recommendation and list what the council still disagrees on. Keep each voice to a few sentences." }
];
const CP_AUDIENCES = [
  { id: "peer", label: "Architect (peer)",
    blurb: "trade-offs, structure",
    sys: "Audience: a fellow architect. Skim context, go deep on structure, trade-offs and failure interactions. Jargon is fine." },
  { id: "engineer", label: "Engineer",
    blurb: "concrete, implementation",
    sys: "Audience: a hands-on engineer. Be concrete and implementation-oriented: name components, configs, thresholds and tests. Show commands, pseudo-config or request shapes where they clarify. Skip the strategy preamble." },
  { id: "data-scientist", label: "Data Scientist",
    blurb: "metrics, evals, measurement",
    sys: "Audience: a data scientist. Frame everything as measurable: metrics, evals, baselines, confidence and what would falsify the recommendation. Call out where numbers are estimates vs measured." },
  { id: "management", label: "Management",
    blurb: "risk, cost, timelines",
    sys: "Audience: engineering management. Lead with risk, cost, staffing and timeline implications in plain business language. Minimize jargon; every technical term gets a one-line translation. End with a resourcing recommendation." },
  { id: "executive", label: "Executive",
    blurb: "bottom line first",
    sys: "Audience: an executive. Bottom line first in at most three bullets: what is at stake, what it costs, what decision is needed. Then a short 'why' — no jargon, no implementation detail unless asked." },
  { id: "customer-team", label: "Customer Team Member",
    blurb: "empathetic, user impact",
    sys: "Audience: a customer-facing team member. Be empathetic and user-centric: what does this mean for customers, what will they see, what should the team say and do. Avoid internals; translate every risk into customer impact." },
  { id: "external-researcher", label: "External Researcher",
    blurb: "formal, precise, open problems",
    sys: "Audience: an external researcher. Be formal and precise: define terms, distinguish claims from conjectures, reference the grounding catalog items by name, and note related open problems and what evidence is missing." }
];
let cpPersona = "agent-architect";
let cpAudience = "peer";

function cpPersonaDef() { return CP_PERSONAS.find(p => p.id === cpPersona) || CP_PERSONAS[0]; }
function cpAudienceDef() { return CP_AUDIENCES.find(a => a.id === cpAudience) || CP_AUDIENCES[0]; }
function cpSetPersona(v) {
  if (CP_PERSONAS.some(p => p.id === v)) cpPersona = v;
  cpRenderPersonaLabels(); cpSave();
}
function cpSetAudience(v) {
  if (CP_AUDIENCES.some(a => a.id === v)) cpAudience = v;
  cpSave();
}
function cpRenderPersonaLabels() {
  const ps = el("cpPersona"), as = el("cpAudience");
  if (ps && !ps.options.length) CP_PERSONAS.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.label + " — " + p.blurb;
    ps.appendChild(o);
  });
  if (as && !as.options.length) CP_AUDIENCES.forEach(a => {
    const o = document.createElement("option");
    o.value = a.id; o.textContent = a.label + " — " + a.blurb;
    as.appendChild(o);
  });
  if (ps) ps.value = cpPersona;
  if (as) as.value = cpAudience;
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
  let system = "You are Fox-Architect for an enterprise AI-agent design catalog. " +
    cpPersonaDef().sys + " " + cpAudienceDef().sys + " " +
    "Answer as a pragmatic, senior enterprise architect. Be concrete and structured: use short headings and bullet lists, name specific patterns and scenarios from the catalog, and always cover risk and mitigation. " +
    "Prefer the four cascade classes (inherent, emergent, derived, cascading) when analysing failure propagation. " +
    "Format for readability: use Markdown tables when comparing options, controls or trade-offs, and include a ```mermaid diagram (flowchart, sequenceDiagram or quadrantChart, at most 10 nodes with short labels) whenever you explain a flow, an attack chain or how a failure propagates. " +
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
   without duplicating the user turn. The old answer is kept so the
   regeneration can be undone (iteration 115) — a model answer you did
   not like should not be unrecoverable. */
function cpRegen(i) {
  if (cpBusy) return;
  const cur = cpMessages[i];
  if (!cur || cur.role !== "assistant") return;
  let q = "";
  for (let j = i - 1; j >= 0; j--) {
    if (cpMessages[j].role === "user") { q = cpMessages[j].content; break; }
  }
  if (!q) { showNotif("No question found to regenerate"); return; }
  const old = cpMessages[i];
  cpMessages.splice(i, 1);
  cpRunAssistant(q).then(function () {
    if (typeof undoPush === "function") {
      undoPush("regenerate the answer",
        function () {
          const at = Math.min(i, cpMessages.length);
          cpMessages.splice(at, 0, old);
          cpSave(); cpRenderLog();
        },
        function () {
          const at = cpMessages.findIndex(function (m) { return m.role === "assistant" && m.content !== old.content; });
          if (at >= 0) { cpMessages.splice(at, 1); cpSave(); cpRenderLog(); }
        });
    }
  });
}
async function cpRunAssistant(q) {
  const assistant = { role: "assistant", content: "", cites: [], persona: cpPersona, audience: cpAudience };
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
    try { assistant.unverified = cpVerifyCites(assistant.content, assistant._ctxText || ""); }
    catch (e) { assistant.unverified = []; }
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
  /* mirror into the shell so an answer in flight is visible from any tab */
  if (busy) { if (typeof setBusy === "function") setBusy("Fox-Architect is answering…"); }
  else if (typeof clearBusy === "function") clearBusy("Fox-Architect is answering…");
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
    return (m.role === "user" ? "## You\n\n" : "## Fox-Architect" + (m.meta ? " _(" + m.meta + ")_" : "") + "\n\n") + m.content;
  }).join("\n\n---\n\n");
  cpDownload("fox-architect-chat.md", md);
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
  cpRenderPersonaLabels();
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
   switch to the Fox-Architect tab, seed the input and send the question. */
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
