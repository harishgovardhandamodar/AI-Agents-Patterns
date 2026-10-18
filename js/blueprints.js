/*
 * blueprints.js — reference-architecture builder.
 *
 * Compose a system out of catalog patterns (a "blueprint"): start from a
 * template or the palette, order the components, get a Mermaid flow of the
 * pipeline plus its runtime controls, a deterministic guardrail-coverage
 * check against ten control families, and a saveable library with
 * Markdown/Mermaid export. Everything here is local and offline — no LLM.
 */
"use strict";

const BP_STORE = "aap.blueprint.v1";
const BP_LIB_STORE = "aap.blueprints.v1";
const BP_MAX_LIB = 12;

/* Categories whose members are runtime controls rather than pipeline stages,
   plus ids that sit in a pipeline category but are controls in practice —
   checkpoint-rollback is filed under `loop` yet guards every stage after it. */
const BP_CONTROL_CATS = { safety: 1, resilience: 1 };
const BP_CONTROL_IDS = { "checkpoint-rollback": 1 };

/* Ten control families a deployed agent needs. Coverage is measured against
   these, not against catalog size — a blueprint with 40 patterns and no
   rollback still scores 9/10 and one real gap. */
const BP_FAMILIES = [
  { k: "inject", label: "Injection defense", ids: ["input-sanitization", "content-shielding", "prompt-injection-defense"], sug: "input-sanitization" },
  { k: "gate", label: "Human gate on irreversible acts", ids: ["approval-gates", "human-in-the-loop", "human-review", "consent-gate"], sug: "approval-gates" },
  { k: "audit", label: "Audit trail", ids: ["audit-trail", "telemetry", "audit-logging-pattern"], sug: "audit-trail" },
  { k: "budget", label: "Spend / rate limits", ids: ["budget-guardrails", "quota-rate-limit", "rate-limiting"], sug: "quota-rate-limit" },
  { k: "filter", label: "Output filtering", ids: ["output-filtering-pii", "content-shielding", "egress-filter"], sug: "output-filtering-pii" },
  { k: "verify", label: "Answer / step validation", ids: ["validation-loop", "chain-of-verification", "self-critique"], sug: "validation-loop" },
  { k: "rollback", label: "Rollback & kill switch", ids: ["checkpoint-rollback", "circuit-breaker", "kill-switch", "dead-man-switch"], sug: "checkpoint-rollback" },
  { k: "scope", label: "Scoped authority", ids: ["least-privilege", "least-privilege-scoping", "separation-of-duties", "policy-engine"], sug: "policy-engine" },
  { k: "sandbox", label: "Execution sandbox", ids: ["sandbox-execution", "tool-sandbox", "dry-run-tools"], sug: "tool-sandbox" },
  { k: "eval", label: "Eval harness", ids: ["eval-harness-redteam", "red-team-pair", "llm-judge"], sug: "eval-harness-redteam" }
];

/* Templates use only ids that exist in data/patterns.json. Each one covers
   6–7 of the ten control families on purpose: the remaining gaps are the
   ones a reviewer has to decide about for their own risk profile, and the
   coverage panel offers each fix in one click. */
const BP_TEMPLATES = [
  { k: "research", name: "Grounded research assistant", blurb: "RAG + citation + verification, human-visible answer.",
    comps: ["react", "tool-retrieval", "rag-augmented", "provenance-citation", "chain-of-verification",
            "input-sanitization", "content-shielding", "human-in-the-loop", "audit-trail", "budget-guardrails"] },
  { k: "worker", name: "Autonomous worker", blurb: "Plans, acts on tools, gated writes, checkpointable.",
    comps: ["standard-agent-loop", "plan-and-execute", "tool-use", "approval-gates", "policy-engine",
            "input-sanitization", "validation-loop", "checkpoint-rollback", "audit-trail", "quota-rate-limit", "canary-shadow"] },
  { k: "pipeline", name: "Multi-agent pipeline", blurb: "Orchestrator routes to workers, each step validated.",
    comps: ["orchestrator-workers", "routing", "sequential-pipeline", "validation-loop", "least-privilege",
            "input-sanitization", "audit-trail", "budget-guardrails", "circuit-breaker", "drift-monitoring", "eval-harness-redteam"] },
  { k: "support", name: "Customer support triage", blurb: "Classify, retrieve, answer — sensitive data stays filtered.",
    comps: ["support-triage", "specialist-triage", "rag-augmented", "human-in-the-loop", "validation-loop",
            "input-sanitization", "content-shielding", "output-filtering-pii", "audit-trail", "quota-rate-limit", "llm-judge"] },
  { k: "batch", name: "Batch document pipeline", blurb: "Offline jobs: chunked prompts, structured output, checkpointed retries.",
    comps: ["batch-agents", "prompt-chaining", "structured-output", "validation-loop", "retry-backoff",
            "fallback-chain", "checkpoint-rollback", "sandbox-execution", "input-sanitization", "audit-trail",
            "budget-guardrails", "llm-judge"] }
];

/* Which control families does a candidate component list leave open? Used for
   template blurbs and anywhere a list of ids needs an honest gap summary. */
function bpGapLabels(ids) {
  const set = new Set(ids || []);
  return BP_FAMILIES.filter(f => !f.ids.some(id => set.has(id))).map(f => f.label);
}

/* Assumptions the reviewer can edit; kept next to bpState because bpState
   initialises from it at load time. */
const bpDefaultEst = () => ({
  req: 500000, tin: 1800, tout: 500, model: "local",
  toolCalls: 4, toolPrice: 0.002, share: 15, wait: 3, hourly: 65, infra: 0
});

const bpState = { name: "", comps: [], notes: "", q: "", cat: "", lib: [], est: bpDefaultEst() };

/* ---------------- persistence ---------------- */
function bpSave() {
  try { localStorage.setItem(BP_STORE, JSON.stringify({ name: bpState.name, comps: bpState.comps, notes: bpState.notes, est: bpState.est })); } catch (e) {}
  if (typeof markSaved === "function") markSaved("bp");
}
function bpSaveLib() {
  try { localStorage.setItem(BP_LIB_STORE, JSON.stringify(bpState.lib)); } catch (e) {}
}
function bpLoad() {
  try {
    const raw = localStorage.getItem(BP_STORE);
    if (raw) {
      const j = JSON.parse(raw);
      if (j && Array.isArray(j.comps)) {
        const valid = (typeof DATA !== "undefined" && DATA.patterns) ? new Set(DATA.patterns.patterns.map(p => p.id)) : null;
        bpState.comps = valid ? j.comps.filter(id => valid.has(id)) : j.comps;
        bpState.name = typeof j.name === "string" ? j.name : "";
        bpState.notes = typeof j.notes === "string" ? j.notes : "";
        if (j.est && typeof j.est === "object") bpState.est = Object.assign(bpDefaultEst(), j.est);
      }
    }
    const lraw = localStorage.getItem(BP_LIB_STORE);
    if (lraw) { const l = JSON.parse(lraw); if (Array.isArray(l)) bpState.lib = l.slice(0, BP_MAX_LIB); }
  } catch (e) { /* ignore corrupt state */ }
}

function initBlueprint() {
  if (!el("bpMain")) return;
  bpLoad();
  bpRenderSide();
  bpRender();
}

/* ---------------- model helpers ---------------- */
function bpPat(id) { return (DATA.patterns.patterns || []).find(p => p.id === id) || null; }
function bpIsControl(p) { return !!p && (BP_CONTROL_CATS[p.cat] === 1 || BP_CONTROL_IDS[p.id] === 1); }
function bpRoleOf(p) { return bpIsControl(p) ? "control" : "stage"; }
/* ids → {stages, controls} without materialising pattern objects */
function bpSplitCounts(ids) {
  let stages = 0, controls = 0;
  ids.forEach(id => { if (bpIsControl(bpPat(id))) controls++; else stages++; });
  return { stages: stages, controls: controls };
}
function bpCatLabel(cat) {
  const c = (DATA.patterns.categories || []).find(x => x.id === cat);
  return c ? c.name : cat;
}
function bpHas(id) { return bpState.comps.indexOf(id) >= 0; }

function bpAdd(id) {
  if (!bpPat(id)) return;
  if (bpHas(id)) return;
  bpState.comps.push(id); bpSave(); bpRender(); bpRenderPalette();
}
/* Bulk add (used by pattern / scenario / cascade drawers): adds every linked
   pattern that isn't already present, reports names, offers Undo + View. */
function bpAddMany(ids) {
  const fresh = (ids || []).filter(id => bpPat(id) && !bpHas(id));
  if (!fresh.length) { showNotif("Already in blueprint — nothing to add"); return 0; }
  fresh.forEach(id => bpState.comps.push(id));
  bpSave(); bpRender(); bpRenderPalette();
  const names = fresh.map(id => bpPat(id).name);
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? " + " + (names.length - 3) + " more" : "");
  undoPush("add " + fresh.length + " to blueprint",
    () => { bpState.comps = bpState.comps.filter(id => fresh.indexOf(id) < 0); bpSave(); bpRender(); bpRenderPalette(); },
    () => { fresh.forEach(id => { if (!bpHas(id)) bpState.comps.push(id); }); bpSave(); bpRender(); bpRenderPalette(); });
  showNotif("Added to blueprint — " + shown, {
    kind: "ok",
    actions: [{ label: "Undo", primary: true, fn: undoOnce }, { label: "View", fn: () => switchTab("blueprint") }]
  });
  return fresh.length;
}
/* One button for drawers: state-aware, safe to call before blueprints load. */
function bpDrawerBtnHtml(id) {
  if (typeof bpHas !== "function" || typeof bpAddMany !== "function" || !bpPat(id)) return "";
  if (bpHas(id)) return `<button class="btn sm" onclick="closeDetail();switchTab('blueprint')">✓ In blueprint — open</button>`;
  return `<button class="btn sm primary" onclick='bpAddMany(["${id}"])'>＋ Add to blueprint</button>`;
}
function bpRefsBtnHtml(ids, what) {
  const list = (ids || []).filter(id => typeof bpPat === "function" && bpPat(id) && typeof bpHas === "function" && !bpHas(id));
  if (typeof bpAddMany !== "function" || !list.length) return "";
  return `<button class="btn sm primary" onclick='bpAddMany(${JSON.stringify(list)})'>＋ Add ${list.length} linked pattern${list.length === 1 ? "" : "s"}${what ? " " + escHtml(what) : ""} to blueprint</button>`;
}
function bpRemove(i) {
  const id = bpState.comps[i];
  if (id == null) return;
  bpState.comps.splice(i, 1); bpSave(); bpRender(); bpRenderPalette();
  const nm = bpPat(id) ? bpPat(id).name : id;
  const at = Math.min(i, bpState.comps.length);
  undoPush("remove “" + nm + "”",
    () => { bpState.comps.splice(at, 0, id); bpSave(); bpRender(); bpRenderPalette(); },
    () => { const j = bpState.comps.indexOf(id); if (j >= 0) { bpState.comps.splice(j, 1); bpSave(); bpRender(); bpRenderPalette(); } });
  showNotif("Removed " + nm, { actions: [{ label: "Undo", primary: true, fn: undoOnce }] });
}
function bpMove(i, d) {
  const j = i + d;
  if (j < 0 || j >= bpState.comps.length) return;
  const t = bpState.comps[i]; bpState.comps[i] = bpState.comps[j]; bpState.comps[j] = t;
  bpSave(); bpRender();
}
function bpToggle(id) { if (bpHas(id)) { const i = bpState.comps.indexOf(id); bpRemove(i); } else bpAdd(id); }
function bpSnapCanvas() { return { comps: bpState.comps.slice(), name: bpState.name, notes: bpState.notes }; }
function bpRestoreCanvas(s) {
  bpState.comps = (s.comps || []).slice(); bpState.name = s.name || ""; bpState.notes = s.notes || "";
  bpSave(); bpRender(); bpRenderPalette();
}
function bpClear() {
  if (!bpState.comps.length && !bpState.name && !bpState.notes) return;
  const snap = bpSnapCanvas();
  bpState.comps = []; bpState.name = ""; bpState.notes = ""; bpSave(); bpRender(); bpRenderPalette();
  undoPush("clear blueprint",
    () => bpRestoreCanvas(snap),
    () => { bpState.comps = []; bpState.name = ""; bpState.notes = ""; bpSave(); bpRender(); bpRenderPalette(); });
  showNotif("Blueprint cleared", { actions: [{ label: "Undo", primary: true, fn: undoOnce }] });
}
function bpSetQ(v) { bpState.q = String(v || ""); bpRenderPalette(); }
function bpSetCat(c) { bpState.cat = bpState.cat === c ? "" : c; bpRenderCats(); bpRenderPalette(); }
function bpSetField(k, v) { bpState[k] = v; bpSave(); } /* no re-render: keeps focus while typing */
function bpApplyTemplate(k) {
  const t = BP_TEMPLATES.find(x => x.k === k);
  if (!t) return;
  const snap = bpSnapCanvas(), tname = t.name, tcomps = t.comps.filter(id => bpPat(id));
  bpState.comps = tcomps.slice();
  if (!bpState.name) bpState.name = tname;
  bpSave(); bpRender(); bpRenderPalette();
  undoPush("apply template “" + tname + "”",
    () => bpRestoreCanvas(snap),
    () => { bpState.comps = tcomps.slice(); bpSave(); bpRender(); bpRenderPalette(); });
  showNotif("Template applied — " + tname, { actions: [{ label: "Undo", primary: true, fn: undoOnce }] });
}
function bpRemoveFamily(k) { /* no-op hook for future; kept for stable API */ }

/* ---------------- guardrail coverage ---------------- */
function bpCoverage() {
  const set = new Set(bpState.comps);
  const rows = BP_FAMILIES.map(f => ({ k: f.k, label: f.label, sug: f.sug, ok: f.ids.some(id => set.has(id)) }));
  return { rows, ok: rows.filter(r => r.ok).length, total: rows.length };
}
function bpWarnings() {
  const set = new Set(bpState.comps);
  const w = [];
  if (!bpState.comps.length) { w.push({ level: "info", text: "Blueprint is empty — start from a template or the palette.", add: null }); return w; }
  const toolish = ["tool-use", "browser-agent", "code-as-action", "computer-use", "tool-retrieval"];
  const gated = ["approval-gates", "human-in-the-loop", "policy-engine", "human-review"];
  if (toolish.some(id => set.has(id)) && !gated.some(id => set.has(id)))
    w.push({ level: "warn", text: "Tool-calling components with no human gate or policy engine — irreversible actions run unreviewed.", add: "approval-gates" });
  const multi = ["orchestrator-workers", "sequential-pipeline", "parallel-gangs", "hierarchical-swarm", "routing"];
  if (multi.some(id => set.has(id)) && !set.has("audit-trail"))
    w.push({ level: "warn", text: "Multi-agent flow with no audit trail — cross-agent decisions can't be reconstructed after an incident.", add: "audit-trail" });
  const stages = bpState.comps.filter(id => !bpIsControl(bpPat(id))).length;
  const controls = bpState.comps.length - stages;
  if (stages >= 3 && controls === 0)
    w.push({ level: "warn", text: "Three or more pipeline stages and zero runtime controls — add at least rollback and a spend cap.", add: "checkpoint-rollback" });
  if (controls > 0 && stages === 0)
    w.push({ level: "info", text: "Only controls are present; add the pipeline stages this system actually runs.", add: null });
  if (stages > 12)
    w.push({ level: "info", text: "More than 12 pipeline stages — long chains lose traceability; consider splitting into two blueprints.", add: null });
  const dupes = bpState.comps.filter((id, i) => bpState.comps.indexOf(id) !== i);
  if (dupes.length) w.push({ level: "warn", text: "Duplicate component(s): " + uniq(dupes).join(", "), add: null });
  if (!w.length) w.push({ level: "ok", text: "No structural problems detected in this composition.", add: null });
  return w;
}
function bpScore() { const c = bpCoverage(); return Math.round(c.ok / c.total * 100); }

/* ---------------- mermaid ---------------- */
function bpMmLabel(s) { return String(s == null ? "" : s).replace(/["`\[\]\n]/g, " ").trim(); }

function bpDiagram() {
  const comps = bpState.comps.map(bpPat).filter(Boolean);
  if (!comps.length) return "";
  const stages = [], controls = [];
  comps.forEach((p, i) => { (bpIsControl(p) ? controls : stages).push({ p, i }); });
  const L = [];
  L.push("flowchart LR");

  stages.forEach((s, n) => L.push(`  s${n}["${bpMmLabel(s.p.name)}"]`));
  for (let n = 1; n < stages.length; n++) L.push(`  s${n - 1} --> s${n}`);

  if (controls.length && stages.length) {
    L.push('  subgraph ctl["Runtime controls"]');
    controls.forEach((c, n) => L.push(`    c${n}["${bpMmLabel(c.p.name)}"]`));
    L.push("  end");
    controls.forEach((c, n) => {
      let anchor = -1;
      for (let k = 0; k < stages.length; k++) if (stages[k].i < c.i) anchor = k;
      if (anchor < 0) anchor = 0;
      L.push(`  s${anchor} -.-> c${n}`);
    });
  } else if (controls.length) {
    controls.forEach((c, n) => L.push(`  c${n}["${bpMmLabel(c.p.name)}"]`));
    for (let n = 1; n < controls.length; n++) L.push(`  c${n - 1} --> c${n}`);
  }
  return L.join("\n");
}

/* ---------------- cost / latency / risk estimator ---------------- */
/* A deterministic model: every number below is derived from the component
   list plus the assumptions the reviewer edits. Prices are $/Mtok and the
   latency table is per stage — the local model charges $0 per token, which
   is exactly why it is the default and why infra is a separate line. */
const BP_MODELS = [
  { k: "local",    name: "Local Qwen 3.8-27B (Fox-Services)", in: 0,    out: 0,    call: 2600 },
  { k: "hosted",   name: "Hosted mid-size (70B-class API)",    in: 0.35, out: 0.90, call: 1400 },
  { k: "frontier", name: "Hosted frontier",                    in: 3.00, out: 15.0, call: 1900 }
];
const BP_STAGE_MS = { planning: 1, loop: 1, workflow: 1, memory: 1.15, multiagent: 1.4, tools: 1, domain: 1, safety: 0, resilience: 0 };
const BP_TOOL_MS = 700, BP_CTL_MS = 90;

function bpNum(v, d) { const n = parseFloat(v); return isFinite(n) && n >= 0 ? n : (d || 0); }
function bpSetEst(k, v) {
  if (k === "model") bpState.est.model = BP_MODELS.some(m => m.k === v) ? v : "local";
  else bpState.est[k] = bpNum(v, bpDefaultEst()[k]);
  bpSave(); bpRenderEst();
}
function bpMoney(n) {
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e4) return "$" + (n / 1e3).toFixed(1) + "k";
  if (n >= 100) return "$" + Math.round(n).toLocaleString();
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toFixed(4);
}
function bpSec(ms) {
  if (ms < 1000) return Math.round(ms) + " ms";
  if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + " s";
  return (ms / 60000).toFixed(1) + " min";
}

function bpEstimate() {
  const e = bpState.est, m = BP_MODELS.find(x => x.k === e.model) || BP_MODELS[0];
  const c = bpCoverage(), set = new Set(bpState.comps);
  const comps = bpState.comps.map(bpPat).filter(Boolean);
  const stages = comps.filter(p => !bpIsControl(p));

  /* cost */
  const inTok = e.req * e.tin / 1e6, outTok = e.req * e.tout / 1e6;
  const inference = inTok * m.in + outTok * m.out;
  const tools = e.req * e.toolCalls * e.toolPrice;
  const human = e.req * (e.share / 100) * (e.wait / 60) * e.hourly;
  const total = inference + tools + human + e.infra;

  /* latency — sum of stage times; controls are inline and cheap; a human
     gate doesn't slow the automated path, it adds a wait to the share of
     traffic that hits it (reported separately). */
  let p50 = 0;
  comps.forEach(p => {
    if (bpIsControl(p)) { p50 += BP_CTL_MS; return; }
    p50 += m.call * (BP_STAGE_MS[p.cat] != null ? BP_STAGE_MS[p.cat] : 1) + (p.cat === "tools" ? BP_TOOL_MS : 0);
  });
  const bounded = ["retry-backoff", "fallback-chain", "circuit-breaker", "validation-loop"].some(id => set.has(id));
  const p95 = p50 * (bounded ? 1.5 : 3.0);
  const gated = c.rows.some(r => r.k === "gate" && r.ok);

  /* risk — explicit weights, so the score can be argued with. */
  const missing = c.rows.filter(r => !r.ok);
  const drivers = [];
  let risk = missing.length * 6;
  missing.slice(0, 3).forEach(r => drivers.push(r.label + " open (−6)"));
  if (missing.length > 3) drivers.push("and " + (missing.length - 3) + " more open famil" + (missing.length - 3 === 1 ? "y" : "ies") + " (−6 each)");
  const toolish = ["tool-use", "browser-agent", "code-as-action", "computer-use"].some(id => set.has(id));
  if (toolish && !gated) { risk += 10; drivers.push("Tool use with no human gate (+10)"); }
  if (stages.length >= 10) { risk += 8; drivers.push("≥10 pipeline stages widen the trace surface (+8)"); }
  if (stages.length >= 3 && comps.length - stages.length === 0) { risk += 12; drivers.push("No runtime controls at all (+12)"); }
  risk = Math.max(0, Math.min(100, risk));
  const band = risk < 25 ? ["Low", "good"] : risk < 45 ? ["Moderate", "mid"] : risk < 65 ? ["Elevated", "mid"] : risk < 85 ? ["High", "bad"] : ["Critical", "bad"];

  return {
    model: m, cost: { inference: inference, tools: tools, human: human, infra: e.infra, total: total, perReq: e.req ? total / e.req : 0 },
    lat: { p50: p50, p95: p95, gated: gated, share: e.share, wait: e.wait, bounded: bounded },
    risk: { score: risk, band: band, drivers: drivers, missing: missing.length },
    cov: c
  };
}

function bpEstInputs() {
  const e = bpState.est;
  const num = (k, label, step, extra) =>
    `<label class="bp-fld"><span>${label}</span><input type="number" min="0" step="${step}" value="${e[k]}" ` +
    `oninput="bpSetEst('${k}', this.value)">${extra || ""}</label>`;
  const grp = (title, body) => `<div class="bp-estgrp"><h5>${title}</h5>${body}</div>`;
  return grp("Volume &amp; shape",
      num("req", "Requests / month", "1000") + num("tin", "Input tokens / req", "100") + num("tout", "Output tokens / req", "50")) +
    grp("Model &amp; tools",
      `<label class="bp-fld"><span>Model</span><select onchange="bpSetEst('model', this.value)">` +
      BP_MODELS.map(m => `<option value="${m.k}"${e.model === m.k ? " selected" : ""}>${m.name} — ` +
        (m.in === 0 ? "$0 / Mtok" : "$" + m.in + "/" + m.out + " per Mtok") + `</option>`).join("") + `</select></label>` +
      num("toolCalls", "Tool calls / req", "1") + num("toolPrice", "$ / tool call", "0.001")) +
    grp("People &amp; infra",
      num("share", "% of actions gated", "1") + num("wait", "Approver wait, min", "1") +
      num("hourly", "$ / hour loaded", "5") + num("infra", "Infra $ / month", "10"));
}

function bpRenderEst() {
  const out = el("bpEstOut");
  if (!out) return;
  const r = bpEstimate(), c = r.cost;
  const share = bpState.est.share;
  const bar = (w, cls, label) => w > 0.5 ? `<div class="bp-seg ${cls}" style="width:${w}%"><span>${label}</span></div>` : "";
  const sum = c.total || 1;
  out.innerHTML =
    `<div class="bp-estcards">` +
      `<div class="bp-estcard">` +
        `<div class="bp-estval">${bpMoney(c.total)}<span>/mo</span></div>` +
        `<div class="bp-estsub">${bpMoney(c.perReq)} per request · ${bpMoney(c.total * 12)}/yr</div>` +
        `<div class="bp-bar">${bar(c.inference / sum * 100, "s1", "inference")}${bar(c.tools / sum * 100, "s2", "tools")}` +
          `${bar(c.human / sum * 100, "s3", "human")}${bar(c.infra / sum * 100, "s4", "infra")}</div>` +
        `<div class="bp-estlines">` +
          `<span><i class="s1"></i>inference <b>${bpMoney(c.inference)}</b></span>` +
          `<span><i class="s2"></i>tools <b>${bpMoney(c.tools)}</b></span>` +
          `<span><i class="s3"></i>human review <b>${bpMoney(c.human)}</b></span>` +
          `<span><i class="s4"></i>infra <b>${bpMoney(c.infra)}</b></span>` +
        `</div>` +
      `</div>` +
      `<div class="bp-estcard">` +
        `<div class="bp-estval">${bpSec(r.lat.p50)}<span>p50</span></div>` +
        `<div class="bp-estsub">p95 ${bpSec(r.lat.p95)} · ${r.lat.bounded ? "retries bounded" : "no bounded retry — p95 assumes end-to-end retry"}</div>` +
        `<div class="bp-estlines">` +
          `<span>${r.cov.ok}/${r.cov.total} control families · ${r.lat.gated ? "gated" : "no human gate"}</span>` +
          (r.lat.gated ? `<span>${share}% of actions wait <b>${r.lat.wait} min</b> for an approver</span>` : "") +
        `</div>` +
      `</div>` +
      `<div class="bp-estcard">` +
        `<div class="bp-estval ${r.risk.band[1]}">${r.risk.score}<span>/100</span></div>` +
        `<div class="bp-estsub">risk band: <b>${r.risk.band[0]}</b> · ${r.risk.missing} open famil${r.risk.missing === 1 ? "y" : "ies"}</div>` +
        `<div class="bp-estlines bp-drivers">` +
          (r.risk.drivers.length ? r.risk.drivers.map(d => `<span>${escHtml(d)}</span>`).join("") : `<span>No open control families and no structural flags.</span>`) +
        `</div>` +
      `</div>` +
    `</div>` +
    `<div class="bp-estnote">Deterministic, not a benchmark: cost = tokens × price + tool calls + gated review time + infra; ` +
    `p50 = Σ stage latencies (${bpSec(r.model.call)}/model call, +${BP_TOOL_MS} ms per tool stage, +${BP_CTL_MS} ms per inline control); ` +
    `p95 = 1.5 × p50 with a bounded-retry control, 3 × without. Edit any assumption above.</div>`;
}

/* ---------------- per-blueprint threat model ----------------
   Three evidence sources, all matched against the current component list:
   1. attack scenarios whose defense patterns (`patternRefs`) touch the
      blueprint — shows which of their defences you actually have;
   2. cascades whose participants are in the blueprint — the emergent and
      cascading failures that only exist because these parts compose;
   3. each component's own catalogued failure modes, "guarded" only when a
      related control from the catalog is also in the blueprint.
   Exposure is a weighted sum of severity (and cascade class) weights — a
   score to compare two blueprints, not an absolute risk number. */
const BP_SEVW = { critical: 4, high: 3, medium: 2, low: 1 };
const BP_CLSW = { inherent: 1, derived: 1.25, emergent: 1.5, cascading: 2 };
const BP_TM_CAP = 6;
let bpTmExp = { scn: false, cas: false, fail: false }; /* transient expand flags */

function bpTmToggle(k) { bpTmExp[k] = !bpTmExp[k]; bpRender(); }

function bpThreatModel() {
  const set = new Set(bpState.comps);
  const out = { scns: [], cas: [], fails: [], exp: 0, idx: 0, max: bpTmMax(), unguardedHigh: 0, has: set.size > 0, band: ["—", "mid"] };
  if (!set.size) return out;

  /* 1 — attack scenarios applicable to what this blueprint actually runs.
     Matching on defence refs would be backwards: adding a control would
     *create* new applicable scenarios. So applicability comes from the
     stages (they define the domain and the victim), plus 'general'
     scenarios which apply to anything with a stage; the scenario's defence
     refs then only set the coverage discount. */
  const stageDom = new Set();
  bpState.comps.forEach(id => { const p = bpPat(id); if (p && !bpIsControl(p)) (p.domains || []).forEach(d => stageDom.add(d)); });
  (DATA.scenarios.scenarios || []).forEach(s => {
    const refs = s.patternRefs || [];
    const victimIn = refs.some(r => { const p = bpPat(r); return p && p.cat === "domain" && set.has(r); });
    const applicable = victimIn || (set.size > 0 && (s.domain === "general" || stageDom.has(s.domain)));
    if (!applicable) return;
    const need = refs.filter(r => { const p = bpPat(r); return p && p.cat !== "domain"; });
    const present = need.filter(r => set.has(r));
    const missing = need.filter(r => !set.has(r));
    const w = BP_SEVW[s.severity] || 2;
    /* Residual weight = severity x (1 - defences present): a fully defended
       scenario costs nothing, so adding a defence can never raise the index. */
    const covered = need.length ? present.length / need.length : 0;
    out.scns.push({ s: s, present: present.length, need: need.length, missing: missing, w: w, raw: w, eff: w * (1 - covered) });
    out.exp += w * (1 - covered);
  });
  out.scns.sort((a, b) => b.eff - a.eff || ((BP_SEVW[b.s.likelihood] || 0) - (BP_SEVW[a.s.likelihood] || 0)));

  /* 2 — composition cascades. Match on stage participants ONLY: a cascade
     becomes active because a pipeline stage of yours sits in its path, never
     because a control does — otherwise adding a recommended control would
     *create* new matches (its id appears in the cascade's inherited refs) and
     raise the index, which is backwards. Controls act through the discount:
     more covered families, less residual cascade exposure. */
  const famCov = (function () { const c = bpCoverage(); return c.total ? c.ok / c.total : 0; })();
  (DATA.cascades.cascades || []).forEach(c => {
    const stageHits = (c.patternRefs || []).filter(r => { const rp = bpPat(r); return rp && set.has(r) && !bpIsControl(rp); }).length;
    if (!stageHits) return; /* no stage of yours on the path: not active */
    const mult = BP_CLSW[c.cls] || 1;
    const w = (BP_SEVW[c.impact] || 2) * mult;
    out.cas.push({ c: c, w: w, mult: mult, eff: w * (1 - 0.6 * famCov), stageHits: stageHits });
    out.exp += w * (1 - 0.6 * famCov);
  });
  out.cas.sort((a, b) => b.eff - a.eff);

  /* 3 — component failure modes. Only pipeline stages feed the index: a
     control's own failure modes stay listed (a reviewer should see them) but
     weigh nothing, otherwise adding a guard would add exposure through its
     own failure list and the index would punish defence. With this split the
     invariant is clean — adding a control never raises the index, adding a
     stage can. */
  bpState.comps.forEach(id => {
    const p = bpPat(id); if (!p) return;
    const isCtl = bpIsControl(p);
    const guards = (p.related || []).filter(r => { const rp = bpPat(r); return rp && bpIsControl(rp); });
    (p.failures || []).forEach(f => {
      const present = guards.filter(r => set.has(r));
      const missing = guards.filter(r => !set.has(r));
      const sev = f.sev || "medium";
      const guarded = present.length > 0;
      const w = isCtl ? 0 : (BP_SEVW[sev] || 2) / 2;
      out.fails.push({ p: p, f: f, sev: sev, guarded: guarded, present: present, missing: missing, w: w });
      out.exp += w;
      if (!isCtl && !guarded && (sev === "critical" || sev === "high")) out.unguardedHigh++;
    });
  });
  out.fails.sort((a, b) => (b.guarded === a.guarded ? b.w - a.w : (a.guarded ? 1 : -1)));
  out.exp = Math.round(out.exp);
  out.max = bpTmMax();
  out.idx = Math.min(100, Math.round(out.exp / (out.max || 1) * 100));
  out.band = out.idx < 8 ? ["Low", "good"] : out.idx < 14 ? ["Elevated", "mid"] : out.idx < 20 ? ["High", "mid"] : ["Severe", "bad"];
  return out;
}

function bpTmSev(sev) { return `<span class="bp-sev"><i class="sev-dot sev-${escHtml(sev)}"></i>${escHtml(sev)}</span>`; }

/* Raw exposure grows with catalog size (175 cascades alone), so it can't be
   banded on absolute values — a 400 means nothing without a ceiling. Index it
   against the theoretical maximum: every scenario and cascade matched at full
   weight, plus every non-control catalogue failure unguarded (control failure
   modes weigh nothing in the index, mirroring the failure term above). */
let bpTmMaxCache = null;
function bpTmMax() {
  if (bpTmMaxCache != null) return bpTmMaxCache;
  let m = 0;
  (DATA.scenarios.scenarios || []).forEach(s => { m += BP_SEVW[s.severity] || 2; });
  (DATA.cascades.cascades || []).forEach(c => { m += (BP_SEVW[c.impact] || 2) * (BP_CLSW[c.cls] || 1); });
  (DATA.patterns.patterns || []).forEach(p => {
    if (bpIsControl(p)) return;
    (p.failures || []).forEach(f => { m += (BP_SEVW[f.sev] || 2) / 2; });
  });
  bpTmMaxCache = Math.round(m);
  return bpTmMaxCache;
}
function bpTmBtn(id) { return `<button class="btn sm ghost" onclick="bpAdd('${id}')">+ ${id}</button>`; }

function bpTmScnRow(x) {
  const s = x.s;
  const cov = x.need ? Math.round(x.present / x.need * 100) : 100;
  return `<div class="bp-tmrow">` +
    `<div class="bp-tmbody">` +
      `<a class="bp-tmttl" onclick="openScenario('${s.id}')">${escHtml(s.title)}</a>` +
      `<span class="bp-tmmeta">${bpTmSev(s.severity)} × ${escHtml(s.likelihood)} · ${escHtml(s.vector)} · ` +
        `<b class="${cov === 100 ? "bp-covok" : cov >= 50 ? "bp-covmid" : "bp-covlow"}">${x.present}/${x.need} defenses present</b></span>` +
    `</div>` +
    (x.missing.length ? bpTmBtn(x.missing[0]) : `<span class="bp-tmk">fully covered</span>`) +
  `</div>`;
}
function bpTmCasRow(x) {
  const c = x.c;
  return `<div class="bp-tmrow">` +
    `<div class="bp-tmbody">` +
      `<a class="bp-tmttl" onclick="openCascade('${c.id}')">${escHtml(c.name)}</a>` +
      `<span class="bp-tmmeta"><b class="bp-cls-${escHtml(c.cls)}">${escHtml(c.cls)}</b> · ${bpTmSev(c.impact)} · ` +
        `blast: ${escHtml(c.blastRadius)} · ${escHtml(c.speed)} · ${x.stageHits} stage participant${x.stageHits === 1 ? "" : "s"}</span>` +
    `</div>` +
    `<span class="bp-tmk">+${Math.round(x.eff)}</span>` +
  `</div>`;
}
function bpTmFailRow(x) {
  return `<div class="bp-tmrow">` +
    `<div class="bp-tmbody">` +
      `<span class="bp-tmttl">${escHtml(x.f.n)} <span class="muted small">— ${escHtml(x.p.name)}</span></span>` +
      `<span class="bp-tmmeta">${bpTmSev(x.sev)} · ${escHtml(x.f.d || "")}</span>` +
    `</div>` +
    (x.guarded
      ? `<span class="bp-tmk">guarded by ${escHtml(x.present.join(", "))}</span>`
      : x.missing.length ? bpTmBtn(x.missing[0]) : `<span class="bp-tmk">unguarded</span>`) +
  `</div>`;
}
function bpTmList(kind, rows, renderRow) {
  const open = bpTmExp[kind];
  const shown = open ? rows : rows.slice(0, BP_TM_CAP);
  return shown.map(renderRow).join("") +
    (rows.length > BP_TM_CAP
      ? `<button class="bp-tmmore" onclick="bpTmToggle('${kind}')">${open ? "show top " + BP_TM_CAP : "show all " + rows.length}</button>`
      : "");
}

function bpTmHtml() {
  const tm = bpThreatModel();
  if (!tm.has) return "";
  const crit = tm.scns.filter(x => x.s.severity === "critical").length;
  const hard = tm.cas.filter(x => x.c.cls === "cascading" || x.c.cls === "emergent").length;
  return `<div class="bp-tm">` +
    `<div class="bp-tmhead">` +
      `<h4>Threat model <span class="muted small">matched against ${bpState.comps.length} components · ${tm.scns.length} scenarios · ${tm.cas.length} cascades · ${tm.fails.length} failure modes</span></h4>` +
      `<span class="bp-tmexp ${tm.band[1]}">${tm.idx}<i>/100</i><b>${tm.band[0]} exposure</b></span>` +
    `</div>` +
    `<div class="bp-tmgrid">` +
      `<div class="bp-tmcol">` +
        `<h5>Attack scenarios${crit ? ` <span class="bp-tmbadge crit">${crit} critical</span>` : ""}</h5>` +
        (tm.scns.length ? bpTmList("scn", tm.scns, bpTmScnRow) : `<div class="muted small">No catalogued attack scenario names these components.</div>`) +
      `</div>` +
      `<div class="bp-tmcol">` +
        `<h5>Composition cascades${hard ? ` <span class="bp-tmbadge crit">${hard} emergent/cascading</span>` : ""}</h5>` +
        (tm.cas.length ? bpTmList("cas", tm.cas, bpTmCasRow) : `<div class="muted small">No catalogued cascade has these components as participants.</div>`) +
      `</div>` +
    `</div>` +
    `<div class="bp-tmcol wide">` +
      `<h5>Component failure modes${tm.unguardedHigh ? ` <span class="bp-tmbadge crit">${tm.unguardedHigh} high/critical unguarded</span>` : ""}</h5>` +
      (tm.fails.length ? bpTmList("fail", tm.fails, bpTmFailRow) : `<div class="muted small">Selected components catalogue no failure modes.</div>`) +
    `</div>` +
    `<div class="bp-tmnote">Exposure index = residual weighted sum ÷ the theoretical ceiling ${tm.max} (every scenario and cascade matched at full weight, every catalogue failure unguarded) × 100. ` +
      `Weights: severity critical 4 … low 1, discounted by how many of the scenario's defences you already run (a fully defended scenario costs nothing); ` +
      `cascade impact × class (inherent ×1, derived ×1.25, emergent ×1.5, cascading ×2) discounted by control-family coverage, and only counted when one of your pipeline stages is a participant; ` +
      `half weight per unguarded pipeline-stage failure — guarded failures cost nothing, and a control's own failure modes are listed for review but weigh nothing (so adding a control can never raise the index). Residual sum: <b>${tm.exp}</b>. ` +
      `The index measures matched threat <i>surface</i>: a broad-domain blueprint can out-score a narrow undefended one, so compare like-for-like blueprints — defence quality lives in the Risk card above.</div>` +
  `</div>`;
}

/* ---------------- export ---------------- */
function bpMarkdown() {
  const F = "```";
  const c = bpCoverage();
  const nm = bpState.name || "Untitled blueprint";
  const out = [];
  out.push("# Blueprint: " + nm);
  out.push("");
  const cnt = bpSplitCounts(bpState.comps);
  out.push(`- Components: **${bpState.comps.length}** (stages **${cnt.stages}**, controls **${cnt.controls}**)`);
  out.push(`- Guardrail coverage: **${c.ok}/${c.total}** control families (${bpScore()}%)`);
  if (bpState.notes) out.push("- Notes: " + bpState.notes.split("\n").join(" "));
  out.push("");
  out.push("## Pipeline");
  out.push("");
  bpState.comps.forEach((id, i) => {
    const p = bpPat(id); if (!p) return;
    out.push(`${i + 1}. **${p.name}** — ${p.summary} (\`${id}\`, ${bpRoleOf(p)})`);
  });
  out.push("");
  out.push("## Guardrail coverage");
  out.push("");
  out.push("| Control family | Status |");
  out.push("| --- | --- |");
  c.rows.forEach(r => out.push(`| ${r.label} | ${r.ok ? "covered" : "MISSING — add `" + r.sug + "`"} |`));
  out.push("");
  const w = bpWarnings().filter(x => x.level !== "ok");
  if (w.length) { out.push("## Findings"); out.push(""); w.forEach(x => out.push("- " + (x.level === "warn" ? "**" : "") + x.text + (x.level === "warn" ? "**" : ""))); out.push(""); }
  if (bpState.comps.length) {
    const r = bpEstimate(), e = bpState.est;
    out.push("## Cost · latency · risk estimate");
    out.push("");
    out.push(`- **Cost:** ${bpMoney(r.cost.total)}/mo for ${e.req.toLocaleString()} requests/mo — inference ${bpMoney(r.cost.inference)}, tools ${bpMoney(r.cost.tools)}, human review ${bpMoney(r.cost.human)}, infra ${bpMoney(r.cost.infra)} (${bpMoney(r.cost.perReq)}/request, ${bpMoney(r.cost.total * 12)}/yr).`);
    out.push(`- **Latency:** p50 ${bpSec(r.lat.p50)}, p95 ${bpSec(r.lat.p95)} — ${r.lat.bounded ? "bounded retries" : "no bounded-retry control, p95 assumes end-to-end retry"}` +
      (r.lat.gated ? `; ${e.share}% of actions wait ${e.wait} min for an approver` : "; no human gate") + ".");
    out.push(`- **Risk:** ${r.risk.score}/100 (${r.risk.band[0]}) across ${r.cov.ok}/${r.cov.total} covered families.`);
    if (r.risk.drivers.length) r.risk.drivers.forEach(d => out.push("  - " + d));
    out.push(`- **Assumptions:** ${e.tin}/${e.tout} tokens per request, ${e.toolCalls} tool calls at $${e.toolPrice}, ` +
      `${e.hourly}$/h loaded review time, ${e.model} model, ${bpMoney(e.infra)}/mo infra.`);
    out.push("");
  }
  const dia = bpDiagram();
  if (dia) { out.push("## Diagram"); out.push(""); out.push(F + "mermaid"); out.push(dia); out.push(F); out.push(""); }
  const tm = bpThreatModel();
  if (tm.has) {
    out.push("## Threat model");
    out.push("");
    out.push(`- Exposure index: **${tm.idx}/100 (${tm.band[0]})** — residual ${tm.exp} of ${tm.max} ceiling; ${tm.scns.length} matched scenarios (${tm.scns.filter(x => x.s.severity === "critical").length} critical), ` +
      `${tm.cas.length} composition cascades (${tm.cas.filter(x => x.c.cls === "cascading" || x.c.cls === "emergent").length} emergent/cascading), ` +
      `${tm.fails.length} component failure modes, ${tm.unguardedHigh} high/critical unguarded.`);
    if (tm.scns.length) {
      out.push("");
      out.push("| Scenario | Severity | Defenses present |");
      out.push("| --- | --- | --- |");
      tm.scns.slice(0, 8).forEach(x => out.push(`| ${x.s.title} | ${x.s.severity} × ${x.s.likelihood} | ${x.present}/${x.need} |`));
      const gap = uniq(tm.scns.flatMap(x => x.missing.slice(0, 1))).slice(0, 5);
      if (gap.length) out.push("\n_Scenario defense gaps: " + gap.map(g => "`" + g + "`").join(", ") + "_");
    }
    if (tm.cas.length) {
      out.push("");
      out.push("| Cascade | Class | Impact | Blast radius |");
      out.push("| --- | --- | --- | --- |");
      tm.cas.slice(0, 8).forEach(x => out.push(`| ${x.c.name} | ${x.c.cls} | ${x.c.impact} | ${x.c.blastRadius} |`));
    }
    const ung = tm.fails.filter(x => !x.guarded && x.w > 0);
    if (ung.length) {
      out.push("");
      out.push("### Unguarded failure modes");
      out.push("");
      ung.slice(0, 10).forEach(x => out.push(`- **${x.f.n}** (${x.sev}) — ${x.p.name}: ${x.f.d || ""}` +
        (x.missing.length ? ` — closest related control not in blueprint: \`${x.missing[0]}\`` : "")));
    }
    out.push("");
  }
  out.push("## Related catalog items");
  out.push("");
  out.push("- " + bpState.comps.map(id => "`" + id + "`").join(", "));
  return out.join("\n");
}
function bpCopy(what, msg) {
  const txt = what === "mermaid" ? (bpDiagram() || "") : bpMarkdown();
  if (!txt) { showNotif("Nothing to copy yet — add components first"); return; }
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => showNotif(msg)).catch(() => showNotif("Clipboard blocked"));
  else showNotif("Clipboard unavailable");
}
function bpDownload() {
  const md = bpMarkdown();
  const blob = new Blob([md], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (bpState.name || "blueprint").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() + ".md";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  showNotif("Blueprint downloaded");
}
function bpAskCopilot() {
  if (typeof copilotAsk !== "function") { showNotif("Copilot unavailable"); return; }
  if (!bpState.comps.length) { showNotif("Add components before asking the copilot"); return; }
  const c = bpCoverage();
  const r = bpEstimate(), e = bpState.est;
  const tm = bpThreatModel();
  const q = "Stress-test this reference architecture. For each weakness, name the component in the blueprint that would have to change. Keep it short.\n\n" +
    "**Blueprint:** " + (bpState.name || "Untitled") + "\n" +
    "**Components:** " + bpState.comps.join(", ") + "\n" +
    "**Guardrail coverage:** " + c.ok + "/" + c.total + " families\n" +
    "**Missing families:** " + c.rows.filter(x => !x.ok).map(x => x.label).join("; ") + "\n" +
    "**Cost / latency / risk:** " + bpMoney(r.cost.total) + "/mo, p50 " + bpSec(r.lat.p50) + ", p95 " + bpSec(r.lat.p95) +
      ", risk " + r.risk.score + "/100 (" + r.risk.band[0] + ") — assumptions: " + e.tin + "/" + e.tout +
      " tokens, " + e.toolCalls + " tool calls, " + e.model + " model\n" +
    (tm.has ? "**Threat exposure:** " + tm.idx + "/100 (" + tm.band[0] + "; residual " + tm.exp + "/" + tm.max + "); worst matched scenario: " +
      (tm.scns[0] ? tm.scns[0].s.title + " [" + tm.scns[0].s.severity + ", " + tm.scns[0].present + "/" + tm.scns[0].need + " defenses]" : "none") +
      "; worst cascade: " + (tm.cas[0] ? tm.cas[0].c.name + " [" + tm.cas[0].c.cls + "]" : "none") +
      "; unguarded high/critical failure modes: " + tm.unguardedHigh + "\n" : "") +
    (bpState.notes ? "**Notes:** " + bpState.notes + "\n" : "") +
    "\nFocus on ordering (which stage should run first/last), on controls attached to the wrong stage, on which single assumption above, if wrong by 10x, would change the recommendation, and on whether the worst matched scenario would succeed against this composition.";
  copilotAsk(q);
}

/* ---------------- compare: current canvas vs a template/library baseline ----
   The calculators read bpState.comps, so compare runs them with the baseline
   swapped in and restores the canvas in a finally — the canvas never changes. */
let bpCmpBase = ""; /* "t:<key>" | "l:<index>" | "" */

function bpCmpBaselines() {
  const out = [{ v: "", label: "Select a baseline to compare…" }];
  BP_TEMPLATES.forEach(t => out.push({ v: "t:" + t.k, label: "Template: " + t.name }));
  bpState.lib.forEach((e, i) => out.push({ v: "l:" + i, label: "Library: " + e.name }));
  return out;
}
function bpCmpBaseComps() {
  if (bpCmpBase.slice(0, 2) === "t:") {
    const t = BP_TEMPLATES.find(x => x.k === bpCmpBase.slice(2));
    return t ? { label: "Template: " + t.name, comps: t.comps.filter(id => bpPat(id)) } : null;
  }
  if (bpCmpBase.slice(0, 2) === "l:") {
    const e = bpState.lib[Number(bpCmpBase.slice(2))];
    return e ? { label: "Library: " + e.name, comps: (e.comps || []).filter(id => bpPat(id)) } : null;
  }
  return null;
}
function bpCmpStats(comps) {
  const keep = bpState.comps;
  bpState.comps = comps.slice();
  try {
    const c = bpCoverage(), e = bpEstimate(), tm = bpThreatModel();
    return { cov: c.ok + "/" + c.total, covOk: c.ok, cost: e.cost.total, lat: e.lat.p50, risk: e.risk.score, exp: tm.idx, band: tm.band[0] };
  } finally { bpState.comps = keep; }
}
function bpSetCmp(v) { bpCmpBase = v || ""; bpRender(); }
function bpCmpRestore() {
  if (bpCmpBase.slice(0, 2) === "t:") bpApplyTemplate(bpCmpBase.slice(2));
  else if (bpCmpBase.slice(0, 2) === "l:") bpLoadLib(Number(bpCmpBase.slice(2)));
}
function bpCmpDiffMd(base, cur, added, removed) {
  const f = (label, a, b, fmt, lower) => {
    const d = b - a, arrow = d === 0 ? "=" : (d > 0 ? "▲ +" : "▼ ") + (fmt ? fmt(Math.abs(d)) : Math.abs(d));
    return `| ${label} | ${fmt ? fmt(a) : a} | ${fmt ? fmt(b) : b} | ${arrow} |`;
  };
  const usd = v => "$" + Number(v).toFixed(0);
  return ["# Blueprint comparison", "",
    `Baseline: ${base.label} (${base.comps.length} components) vs current “${bpState.name || "Untitled"}” (${cur.comps.length} components).`, "",
    "## Components",
    added.length ? "Added: " + added.map(id => (bpPat(id) || {}).name || id).join(", ") : "Added: none",
    removed.length ? "Removed: " + removed.map(id => (bpPat(id) || {}).name || id).join(", ") : "Removed: none", "",
    "## Metrics",
    "| Metric | Baseline | Current | Δ |",
    "|---|---|---|---|",
    f("Guardrail coverage (families)", base.covOk, cur.covOk),
    f("Exposure index", base.exp, cur.exp),
    f("Cost / mo", base.cost, cur.cost, usd),
    f("Latency p50 (ms)", base.lat, cur.lat),
    f("Risk score", base.risk, cur.risk)
  ].join("\n");
}
function bpCmpCopy() {
  if (!bpCmpBaseComps()) return;
  bpCmpRenderInto(true);
}
function bpCmpRenderInto(toClipboard) {
  const base = bpCmpBaseComps();
  if (!base) return "";
  const cur = bpCmpStats(bpState.comps), bs = bpCmpStats(base.comps);
  const curSet = new Set(bpState.comps), baseSet = new Set(base.comps);
  const added = bpState.comps.filter(id => !baseSet.has(id));
  const removed = base.comps.filter(id => !curSet.has(id));
  const md = bpCmpDiffMd(
    { label: base.label, comps: base.comps, covOk: bs.covOk, exp: bs.exp, cost: bs.cost, lat: bs.lat, risk: bs.risk },
    { covOk: cur.covOk, exp: cur.exp, cost: cur.cost, lat: cur.lat, risk: cur.risk, comps: bpState.comps },
    added, removed);
  if (toClipboard) {
    if (navigator.clipboard) navigator.clipboard.writeText(md).then(() => showNotif("Comparison copied as Markdown")).catch(() => showNotif("Clipboard blocked", { kind: "warn" }));
    else showNotif("Clipboard unavailable", { kind: "warn" });
  }
  return md;
}
function bpCmpHtml() {
  const opts = bpCmpBaselines().map(o =>
    `<option value="${o.v}"${o.v === bpCmpBase ? " selected" : ""}>${escHtml(o.label)}</option>`).join("");
  let body = `<p class="muted small">Pick a template or saved blueprint — see exactly which components and metrics change before you restore it.</p>`;
  const base = bpCmpBaseComps();
  if (base) {
    const cur = bpCmpStats(bpState.comps), bs = bpCmpStats(base.comps);
    const curSet = new Set(bpState.comps), baseSet = new Set(base.comps);
    const added = bpState.comps.filter(id => !baseSet.has(id));
    const removed = base.comps.filter(id => !curSet.has(id));
    const nm = id => escHtml((bpPat(id) || {}).name || id);
    const drow = (label, a, b, fmt, invert) => {
      const d = b - a, good = d === 0 ? "" : ((d < 0) !== !!invert ? "good" : "bad");
      const txt = d === 0 ? "no change" : (d > 0 ? "+" : "") + (fmt ? fmt(d) : d);
      return `<tr><td>${label}</td><td>${fmt ? fmt(a) : a}</td><td><b>${fmt ? fmt(b) : b}</b></td><td class="${good}">${txt}</td></tr>`;
    };
    const usd = v => "$" + Number(v).toFixed(0);
    body =
      `<div class="bp-cmp-cols">` +
      `<div><h5>＋ Added vs baseline (${added.length})</h5>` +
      (added.length ? `<ul>${added.map(id => `<li>${nm(id)}</li>`).join("")}</ul>` : `<p class="muted small">none</p>`) + `</div>` +
      `<div><h5>－ Removed vs baseline (${removed.length})</h5>` +
      (removed.length ? `<ul>${removed.map(id => `<li>${nm(id)}</li>`).join("")}</ul>` : `<p class="muted small">none</p>`) + `</div></div>` +
      `<table class="tbl bp-cmp-tbl"><tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Δ</th></tr>` +
      drow("Guardrail coverage (families)", bs.covOk, cur.covOk) +
      drow("Exposure index", bs.exp, cur.exp, null, true) +
      drow("Cost / mo", Math.round(bs.cost), Math.round(cur.cost), usd, true) +
      drow("Latency p50 (ms)", Math.round(bs.lat), Math.round(cur.lat), null, true) +
      drow("Risk score", bs.risk, cur.risk, null, true) +
      `</table>` +
      `<div class="d-actions" style="margin-top:8px">` +
      `<button class="btn sm" onclick="bpCmpRestore()">↩ Restore baseline (undoable)</button>` +
      `<button class="btn sm ghost" onclick="bpCmpCopy()">⧉ Copy comparison</button></div>`;
  }
  return `<div class="bp-compare"><h4>Compare with baseline</h4>` +
    `<select class="search" style="max-width:340px" onchange="bpSetCmp(this.value)">${opts}</select>${body}</div>`;
}
function bpSaveToLib() {
  if (!bpState.comps.length) { showNotif("Add components before saving"); return; }
  const name = (bpState.name || "").trim() || "Blueprint " + (bpState.lib.length + 1);
  bpState.name = name;
  bpState.lib.unshift({ name: name, comps: bpState.comps.slice(), notes: bpState.notes, at: Date.now() });
  bpState.lib = bpState.lib.slice(0, BP_MAX_LIB);
  if (typeof palInvalidate === "function") palInvalidate();
  bpSave(); bpSaveLib(); bpRender();
  showNotif("Saved to library — " + name);
}
function bpLoadLib(i) {
  const e = bpState.lib[i];
  if (!e) return;
  const snap = bpSnapCanvas(), ename = e.name;
  bpState.name = e.name; bpState.notes = e.notes || "";
  bpState.comps = (e.comps || []).filter(id => bpPat(id));
  bpSave(); bpRender(); bpRenderPalette();
  undoPush("load “" + ename + "”",
    () => bpRestoreCanvas(snap),
    () => { bpState.name = ename; bpState.comps = (e.comps || []).filter(id => bpPat(id)); bpSave(); bpRender(); bpRenderPalette(); });
  showNotif("Loaded — " + ename, { actions: [{ label: "Undo", primary: true, fn: undoOnce }] });
}
function bpDeleteLib(i) {
  const e = bpState.lib[i];
  if (!e) return;
  bpState.lib.splice(i, 1); bpSaveLib(); bpRender();
  if (typeof palInvalidate === "function") palInvalidate();
  const at = Math.min(i, bpState.lib.length), ename = e.name;
  const putBack = () => { bpState.lib.splice(at, 0, e); bpSaveLib(); bpRender(); if (typeof palInvalidate === "function") palInvalidate(); };
  undoPush("delete library entry “" + ename + "”", putBack,
    () => { const j = bpState.lib.indexOf(e); if (j >= 0) { bpState.lib.splice(j, 1); bpSaveLib(); bpRender(); if (typeof palInvalidate === "function") palInvalidate(); } });
  showNotif("Removed from library — " + ename, { actions: [{ label: "Undo", primary: true, fn: undoOnce }] });
}

/* ---------------- sidebar ---------------- */
function bpRenderSide() {
  const t = el("bpTemplates");
  if (t) t.innerHTML = BP_TEMPLATES.map(x => {
    const gaps = bpGapLabels(x.comps);
    const tip = x.blurb + (gaps.length ? " — leaves open: " + gaps.join(", ") : " — covers all ten families");
    return `<button class="bp-tpl" onclick="bpApplyTemplate('${x.k}')" title="${escHtml(tip)}">` +
      `<b>${escHtml(x.name)}</b><span>${escHtml(x.blurb)}</span>` +
      `<span class="bp-tplgap">${x.comps.length} comps · ${BP_FAMILIES.length - gaps.length}/${BP_FAMILIES.length} families</span></button>`;
  }).join("");
  bpRenderCats();
  bpRenderPalette();
}
function bpRenderCats() {
  const box = el("bpCats");
  if (!box) return;
  const cats = (DATA.patterns.categories || []);
  box.innerHTML = cats.map(c => `<button class="bp-catchip${bpState.cat === c.id ? " on" : ""}" onclick="bpSetCat('${c.id}')">${escHtml(c.name)}</button>`).join("");
}
function bpRenderPalette() {
  const box = el("bpPalette"), cnt = el("bpPalCount");
  if (!box) return;
  const q = bpState.q.toLowerCase().trim();
  const list = (DATA.patterns.patterns || []).filter(p => {
    if (bpState.cat && p.cat !== bpState.cat) return false;
    if (!q) return true;
    return (p.name + " " + p.id + " " + (p.summary || "") + " " + (p.domains || []).join(" ")).toLowerCase().indexOf(q) >= 0;
  });
  if (cnt) cnt.textContent = "(" + list.length + ")";
  if (!list.length) { box.innerHTML = `<div class="muted small">No pattern matches.</div>`; return; }
  box.innerHTML = list.map(p => {
    const on = bpHas(p.id);
    return `<button class="bp-pal${on ? " on" : ""}" onclick="bpToggle('${p.id}')" title="${escHtml(p.summary || "")}">` +
      `<span class="bp-palmark">${on ? "✓" : "+"}</span>` +
      `<span class="bp-palname">${escHtml(p.name)}</span>` +
      `<span class="bp-palcat">${p.cat}</span></button>`;
  }).join("");
}

/* ---------------- main pane ---------------- */
function bpRender() {
  const root = el("bpMain");
  if (!root) return;
  const comps = bpState.comps.map(bpPat).filter(Boolean);
  const stages = comps.filter(p => !bpIsControl(p));
  const controls = comps.filter(p => bpIsControl(p));
  const c = bpCoverage();
  const w = bpWarnings();
  const dia = bpDiagram();

  root.innerHTML =
    `<div class="bp-head">` +
      `<div class="bp-titlerow">` +
        `<input class="bp-name" id="bpName" value="${escHtml(bpState.name)}" placeholder="Name this blueprint…" ` +
          `oninput="bpSetField('name', this.value)" onkeydown="if(event.key==='Enter')this.blur()">` +
        `<span class="muted small">drag-free ordering: ${stages.length} stage${stages.length === 1 ? "" : "s"} → ${controls.length} control${controls.length === 1 ? "" : "s"}</span>` +
        `<span class="save-stamp" data-save-stamp="bp"></span>` +
      `</div>` +
      `<div class="bp-actions">` +
        `<button class="btn sm" onclick="bpSaveToLib()">💾 Save to library</button>` +
        `<button class="btn sm" onclick="bpCopy('md','Blueprint copied as Markdown')">⧉ Copy Markdown</button>` +
        `<button class="btn sm" onclick="bpCopy('mermaid','Mermaid source copied')">⧉ Copy diagram</button>` +
        `<button class="btn sm" onclick="bpDownload()">⬇ Download .md</button>` +
        `<button class="btn sm accent" onclick="bpAskCopilot()">🤖 Stress-test with Copilot</button>` +
        `<button class="btn sm" onclick="bpClear()">Clear</button>` +
      `</div>` +
    `</div>` +

    `<div class="bp-stats">` +
      `<div class="bp-stat"><b>${comps.length}</b><span>components</span></div>` +
      `<div class="bp-stat"><b>${stages.length}</b><span>stages</span></div>` +
      `<div class="bp-stat"><b>${controls.length}</b><span>controls</span></div>` +
      `<div class="bp-stat ${c.ok === c.total ? "good" : c.ok >= c.total - 3 ? "mid" : "bad"}">` +
        `<b>${c.ok}/${c.total}</b><span>guardrail families</span></div>` +
      `<div class="bp-stat ${bpScore() >= 80 ? "good" : bpScore() >= 50 ? "mid" : "bad"}"><b>${bpScore()}%</b><span>coverage</span></div>` +
    `</div>` +

    (dia
      ? `<div class="bp-diagram">${diagramHtml(dia, "blueprint flow")}</div>`
      : `<div class="bp-empty">No components yet — pick a template on the left, or click patterns in the palette.</div>`) +

    `<div class="bp-est">` +
      `<div class="bp-esthead">` +
        `<h4>Cost · latency · risk estimate</h4>` +
        `<span class="muted small">live from the assumptions on the right — no LLM involved</span>` +
      `</div>` +
      `<div class="bp-estbody">` +
        `<div class="bp-estinputs">${bpEstInputs()}</div>` +
        `<div class="bp-estout" id="bpEstOut"></div>` +
      `</div>` +
    `</div>` +

    `<div class="bp-cols">` +
      `<div class="bp-col">` +
        `<h4>Component order <span class="muted small">(top runs first)</span></h4>` +
        (comps.length
          ? `<ol class="bp-list">` + bpState.comps.map((id, i) => {
              const p = bpPat(id); if (!p) return "";
              const role = bpRoleOf(p);
              return `<li class="bp-row${role === "control" ? " ctl" : ""}">` +
                `<span class="bp-idx">${i + 1}</span>` +
                `<div class="bp-rowbody">` +
                  `<a class="bp-link" onclick="openPattern('${p.id}')">${escHtml(p.name)}</a>` +
                  `<span class="bp-rowmeta">${escHtml(bpCatLabel(p.cat))} · ${(p.domains || []).slice(0, 3).join(", ")}</span>` +
                `</div>` +
                `<span class="bp-role ${role}">${role}</span>` +
                `<span class="bp-move">` +
                  `<button title="Move up" onclick="bpMove(${i},-1)" ${i === 0 ? "disabled" : ""}>↑</button>` +
                  `<button title="Move down" onclick="bpMove(${i},1)" ${i === comps.length - 1 ? "disabled" : ""}>↓</button>` +
                  `<button title="Remove" class="bp-x" onclick="bpRemove(${i})">×</button>` +
                `</span></li>`;
            }).join("") + `</ol>`
          : `<div class="muted small">Nothing added yet.</div>`) +
        `<div class="bp-notes">` +
          `<h4>Notes</h4>` +
          `<textarea class="bp-noteta" placeholder="Assumptions, data classes, known constraints…" ` +
            `oninput="bpSetField('notes', this.value)">${escHtml(bpState.notes)}</textarea>` +
        `</div>` +
      `</div>` +
      `<div class="bp-col">` +
        `<h4>Guardrail coverage <span class="muted small">${c.ok}/${c.total} families</span></h4>` +
        `<div class="bp-chk">` + c.rows.map(r =>
          `<div class="bp-chkrow ${r.ok ? "ok" : "miss"}">` +
            `<span class="bp-chkmark">${r.ok ? "✓" : "!"}</span>` +
            `<span>${escHtml(r.label)}</span>` +
            (r.ok ? "" : `<button class="btn sm ghost" onclick="bpAdd('${r.sug}')">+ ${r.sug}</button>`) +
          `</div>`).join("") + `</div>` +
        `<h4>Findings</h4>` +
        `<div class="bp-warn">` + w.map(x =>
          `<div class="bp-warnrow ${x.level}">` +
            `<span>${escHtml(x.text)}</span>` +
            (x.add ? `<button class="btn sm ghost" onclick="bpAdd('${x.add}')">+ add ${x.add}</button>` : "") +
          `</div>`).join("") + `</div>` +
      `</div>` +
    `</div>` +

    bpTmHtml() +

    `<div class="bp-lib">` +
      `<h4>Saved blueprints <span class="muted small">${bpState.lib.length}/${BP_MAX_LIB}</span></h4>` +
      (bpState.lib.length
        ? `<div class="bp-liblist">` + bpState.lib.map((e, i) =>
            `<div class="bp-librow">` +
              `<span class="bp-libname">${escHtml(e.name)}</span>` +
              `<span class="muted small">${(e.comps || []).length} comps · ${new Date(e.at || Date.now()).toLocaleDateString()}</span>` +
              `<span class="bp-libbtns">` +
                `<button class="btn sm" onclick="bpLoadLib(${i})">Load</button>` +
                `<button class="btn sm ghost" onclick="bpDeleteLib(${i})">Delete</button>` +
              `</span>` +
            `</div>`).join("") + `</div>`
        : `<div class="muted small">Nothing saved yet. Save a blueprint to compare variants later.</div>`) +
    `</div>` +

    bpCmpHtml();

  bpRenderEst();
  mmRenderAll(root);
  if (typeof paintSaveStamps === "function") paintSaveStamps();
}

tabLoaders.blueprint = function () { if (el("bpPalette")) bpRenderPalette(); };
