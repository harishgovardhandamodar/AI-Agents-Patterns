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

const bpState = { name: "", comps: [], notes: "", q: "", cat: "", lib: [] };

/* ---------------- persistence ---------------- */
function bpSave() {
  try { localStorage.setItem(BP_STORE, JSON.stringify({ name: bpState.name, comps: bpState.comps, notes: bpState.notes })); } catch (e) {}
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
function bpRemove(i) {
  bpState.comps.splice(i, 1); bpSave(); bpRender(); bpRenderPalette();
}
function bpMove(i, d) {
  const j = i + d;
  if (j < 0 || j >= bpState.comps.length) return;
  const t = bpState.comps[i]; bpState.comps[i] = bpState.comps[j]; bpState.comps[j] = t;
  bpSave(); bpRender();
}
function bpToggle(id) { if (bpHas(id)) { const i = bpState.comps.indexOf(id); bpRemove(i); } else bpAdd(id); }
function bpClear() {
  if (!bpState.comps.length && !bpState.name && !bpState.notes) return;
  bpState.comps = []; bpState.name = ""; bpState.notes = ""; bpSave(); bpRender(); bpRenderPalette();
  showNotif("Blueprint cleared");
}
function bpSetQ(v) { bpState.q = String(v || ""); bpRenderPalette(); }
function bpSetCat(c) { bpState.cat = bpState.cat === c ? "" : c; bpRenderCats(); bpRenderPalette(); }
function bpSetField(k, v) { bpState[k] = v; bpSave(); } /* no re-render: keeps focus while typing */
function bpApplyTemplate(k) {
  const t = BP_TEMPLATES.find(x => x.k === k);
  if (!t) return;
  bpState.comps = t.comps.filter(id => bpPat(id));
  if (!bpState.name) bpState.name = t.name;
  bpSave(); bpRender(); bpRenderPalette();
  showNotif("Template applied — " + t.name);
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
  const dia = bpDiagram();
  if (dia) { out.push("## Diagram"); out.push(""); out.push(F + "mermaid"); out.push(dia); out.push(F); out.push(""); }
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
  const q = "Stress-test this reference architecture. For each weakness, name the component in the blueprint that would have to change. Keep it short.\n\n" +
    "**Blueprint:** " + (bpState.name || "Untitled") + "\n" +
    "**Components:** " + bpState.comps.join(", ") + "\n" +
    "**Guardrail coverage:** " + c.ok + "/" + c.total + " families\n" +
    "**Missing families:** " + c.rows.filter(r => !r.ok).map(r => r.label).join("; ") + "\n" +
    (bpState.notes ? "**Notes:** " + bpState.notes + "\n" : "") +
    "\nFocus on ordering (which stage should run first/last) and on controls attached to the wrong stage.";
  copilotAsk(q);
}

/* ---------------- library ---------------- */
function bpSaveToLib() {
  if (!bpState.comps.length) { showNotif("Add components before saving"); return; }
  const name = (bpState.name || "").trim() || "Blueprint " + (bpState.lib.length + 1);
  bpState.name = name;
  bpState.lib.unshift({ name: name, comps: bpState.comps.slice(), notes: bpState.notes, at: Date.now() });
  bpState.lib = bpState.lib.slice(0, BP_MAX_LIB);
  bpSave(); bpSaveLib(); bpRender();
  showNotif("Saved to library — " + name);
}
function bpLoadLib(i) {
  const e = bpState.lib[i];
  if (!e) return;
  bpState.name = e.name; bpState.notes = e.notes || "";
  bpState.comps = (e.comps || []).filter(id => bpPat(id));
  bpSave(); bpRender(); bpRenderPalette();
  showNotif("Loaded — " + e.name);
}
function bpDeleteLib(i) {
  const e = bpState.lib[i];
  bpState.lib.splice(i, 1); bpSaveLib(); bpRender();
  if (e) showNotif("Removed from library — " + e.name);
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
    `</div>`;

  mmRenderAll(root);
}

tabLoaders.blueprint = function () { if (el("bpPalette")) bpRenderPalette(); };
