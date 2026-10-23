/* js/selflearn.js — the Self-Learning tab: the add-on bridge to the
 * Self-Learning Agent Lab (the sibling checkout at ../self-learning-agents,
 * FastAPI on :8220, model backend fox-services on :8210).
 *
 * The app stays static and offline-first, so this tab does not execute the
 * lab — it bridges to it: reachability status, deep links, run instructions,
 * and the concept map that ties the lab's mechanisms (task-scoped learning,
 * workflow conditioning, evolvers, streams, continual-learning metrics) to
 * this catalog's own patterns and failure scenarios. Everything below works
 * with the lab stopped; only the status dot needs it running.
 *
 * The status probe uses a no-cors fetch: the lab ships no CORS headers, so
 * the response body can never be read cross-origin — but an opaque response
 * still proves the port answers, which is all a status dot needs.
 */
"use strict";

/* ---------------- storage ---------------- */
const SL_CFG_STORE = "aap.selflearn.cfg.v1";

/* ---------------- the lab ---------------- */

const SL_LAB = {
  name: "Self-Learning Agent Lab",
  port: 8220,
  model: "fox-services :8210",
  run: "./run.sh",
  compose: "docker compose up --build -d",
  paper: "arXiv:2610.25863 — “Are Self-Evolving Agents Continual Learners?”"
};

/* Concept → what it is → where the catalog already covers it. Pattern and
   scenario ids are validated against data/*.json by the test suite's bridge
   check (test/data.test.mjs), so a renamed catalog id fails loudly instead
   of silently unlinking the bridge. */
const SL_CONCEPTS = [
  { id: "task-scoped", label: "Task-scoped learning", what: "Lessons are learned per task family and fenced there — a fix for invoicing never rewrites triage.",
    patterns: ["memory-consolidation", "forgetting-decay", "episodic-memory"], scenarios: ["selfrewrite-reward-hack", "metric-gaming-triage"] },
  { id: "workflow-cond", label: "Workflow conditioning", what: "The correct workflow flips per block (two BFCL families, one API catalogue) — the agent conditions on which workflow is live.",
    patterns: ["reflexion", "evaluator-optimizer"], scenarios: ["fin-threshold-splitting", "tool-error-instruction"] },
  { id: "reasoning-bank", label: "Reasoning-bank memory", what: "A bank of scored reasonings the agent retrieves from and writes back to — memory that compounds.",
    patterns: ["long-term-vector-memory", "memory-consolidation", "scratchpad-external"], scenarios: ["rag-poison", "memory-poison"] },
  { id: "gepa", label: "GEPA-style reflection", what: "An evolver that reflects on failures in natural language and proposes policy edits — the optimizer is prose.",
    patterns: ["reflexion", "self-consistency", "chain-of-verification"], scenarios: ["prompt-selfedit-jailbreak", "selfdistill-collapse"] },
  { id: "meta-harness", label: "Meta-harness", what: "A harness that runs the evolvers themselves under the same seed + checkpoint discipline as the agents.",
    patterns: ["evaluator-optimizer", "ensemble-verify"], scenarios: ["eval-overfit", "delegation-cascade"] },
  { id: "plasticity", label: "Plasticity vs stability", what: "Gain during a family's own block (P_k) against the cross-block bill (S): learning fast versus keeping what was learned.",
    patterns: ["forgetting-decay", "memory-consolidation"], scenarios: ["drift-silent", "selfdistill-collapse"] },
  { id: "interference", label: "Interference & forgetting", what: "Pre-block drops below seed (I_k) and post-block decay (F_k): the two directions forgetting attacks from.",
    patterns: ["forgetting-decay", "working-memory-context"], scenarios: ["context-exfil-truncation", "energy-twin-drift"] },
  { id: "drift-streams", label: "Drifting streams", what: "Topic, workflow, domain and compound streams reorder the same tasks — the environment moves, not the agent.",
    patterns: ["drift-monitoring"], scenarios: ["drift-silent", "data-pipeline-schema-drift", "energy-twin-drift"] },
  { id: "checkpoints", label: "Seeds + per-boundary checkpoints", what: "Policy seed, train/eval seeds and lesson ids are all recorded per run — any cell reproduces exactly.",
    patterns: ["audit-trail"], scenarios: ["spawn-fleet-runaway", "research-fabricated-citation"] },
  { id: "holdout", label: "Disjoint hold-outs", what: "Validation tasks never overlap training: the score measures learning, not memorization of the eval set.",
    patterns: ["evaluator-optimizer", "ensemble-verify"], scenarios: ["eval-overfit", "edu-tutor-answer-leak"] },
  { id: "sweeps", label: "Sweep statistics", what: "One run is one draw: 20-iteration sweeps vary all seed axes and report mean ± std, so a table entry is a claim with error bars.",
    patterns: ["drift-monitoring", "audit-trail"], scenarios: ["fin-trading-runaway", "infinite-loop-cost"] },
  { id: "live-cal", label: "Live validation", what: "Simulated baselines are calibrated against live model runs on hold-outs — the delta, not the absolute, is the finding.",
    patterns: ["chain-of-verification"], scenarios: ["tool-error-instruction", "agent-impersonation"] }
];

/* ---------------- state ---------------- */

const selflearnState = {
  cfg: { port: SL_LAB.port },
  status: "unknown",          /* unknown | up | down */
  checkedAt: null,
  booted: false
};

function slArgs() {
  return escHtml(Array.prototype.slice.call(arguments)
    .map(function (x) { return JSON.stringify(String(x)); })
    .join(","));
}

function slLoadCfg() {
  try {
    const raw = localStorage.getItem(SL_CFG_STORE);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && isFinite(Number(o.port))) selflearnState.cfg.port = Math.max(1, Math.min(65535, Number(o.port) | 0));
    }
  } catch (e) {}
}
function slSaveCfg() {
  try { localStorage.setItem(SL_CFG_STORE, JSON.stringify(selflearnState.cfg)); } catch (e) {}
  if (typeof projTouch === "function") projTouch();
}

function slBase() { return "http://localhost:" + selflearnState.cfg.port; }

/* ---------------- status probe ---------------- */

function slProbe() {
  const root = el("slStatus");
  if (root) root.innerHTML = '<span class="chip">probing…</span>';
  const ctrl = ("AbortController" in window) ? new AbortController() : null;
  const timer = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) {} }, 4000);
  fetch(slBase() + "/api/health", {
    mode: "no-cors",
    signal: ctrl && ctrl.signal ? ctrl.signal : undefined
  }).then(function () {
    clearTimeout(timer);
    selflearnState.status = "up";
    selflearnState.checkedAt = new Date();
    renderSelflearn();
    showNotif("Self-Learning Lab is up on :" + selflearnState.cfg.port);
  }).catch(function () {
    clearTimeout(timer);
    selflearnState.status = "down";
    selflearnState.checkedAt = new Date();
    renderSelflearn();
  });
}

function slSetPort(val) {
  const n = Number(val);
  if (!isFinite(n)) return;
  selflearnState.cfg.port = Math.max(1, Math.min(65535, Math.round(n)));
  slSaveCfg();
  selflearnState.status = "unknown";
  renderSelflearn();
}

/* ---------------- rendering ---------------- */

function slStatusHtml() {
  const st = selflearnState.status;
  const chip = st === "up" ? '<span class="chip ok">● lab reachable</span>'
    : st === "down" ? '<span class="chip bad">● lab not answering</span>'
    : '<span class="chip">● status unknown</span>';
  const when = selflearnState.checkedAt
    ? ' <span class="muted small">checked ' + escHtml(selflearnState.checkedAt.toLocaleTimeString()) + "</span>" : "";
  return chip + when;
}

function slConceptRows() {
  return SL_CONCEPTS.map(function (c) {
    const pats = c.patterns.map(function (p) {
      return '<button class="btn sm ghost" onclick="openPattern(' + slArgs(p) + ')">' + escHtml(p) + "</button>";
    }).join(" ");
    const scns = c.scenarios.map(function (s) {
      return '<button class="btn sm ghost" onclick="goTo(' + slArgs("scenarios", s) + ')">' + escHtml(s) + "</button>";
    }).join(" ");
    return "<tr><td><b>" + escHtml(c.label) + "</b><br><span class=\"muted small\">" + escHtml(c.what) + "</span></td>" +
      "<td>" + pats + "</td><td>" + scns + "</td></tr>";
  }).join("");
}

function renderSelflearn() {
  const root = el("slMain");
  if (!root) return;
  const up = selflearnState.status === "up";
  root.innerHTML =
    '<div class="bt-head">' +
      "<div><h2>🧬 Self-Learning</h2>" +
      '<p class="muted small">The add-on bridge to the Self-Learning Agent Lab — continual learning, task-scoped adaptation, and the evaluation discipline that keeps them honest.</p></div>' +
      '<div class="bt-head-btns">' +
        '<button class="btn" onclick="slProbe()">↻ Check lab</button>' +
        '<button class="btn primary" onclick="window.open(' + slArgs(slBase() + "/") + ')">Open the lab ↗</button>' +
      "</div>" +
    "</div>" +
    '<div class="panel" style="margin-bottom:12px"><h3>Add-on status <span class="muted small">the lab is a separate service — this tab bridges to it</span></h3>' +
      '<div id="slStatus">' + slStatusHtml() + "</div>" +
      '<p class="muted small" style="margin:8px 0">' + escHtml(SL_LAB.paper) + "<br>" +
      "Model backend " + escHtml(SL_LAB.model) + " · lab UI <span class=\"mono\">:" + selflearnState.cfg.port + "</span> · " +
      "run locally with <span class=\"mono\">" + escHtml(SL_LAB.run) + "</span> or <span class=\"mono\">" + escHtml(SL_LAB.compose) + "</span>.</p>" +
      '<div class="rg-form-grid"><label class="rg-field"><span class="muted small">Lab port</span>' +
        '<input class="search" type="number" min="1" max="65535" value="' + selflearnState.cfg.port + '"' +
        ' onchange="slSetPort(this.value)" aria-label="Lab port"></label>' +
      '<label class="rg-field"><span class="muted small">&nbsp;</span><span>' +
        (up ? '<button class="btn sm primary" onclick="window.open(' + slArgs(slBase() + "/") + ')">Open dashboard ↗</button>'
          : '<span class="muted small">Start the lab, then check again — everything below works without it.</span>') +
      "</span></label></div></div>" +
    '<div class="panel" style="margin-bottom:12px"><h3>Concept bridge <span class="muted small">lab mechanism → what the catalog already covers — click through to the record</span></h3>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lab concept</th><th>Catalog patterns</th><th>Catalog scenarios</th></tr></thead>' +
      "<tbody>" + slConceptRows() + "</tbody></table></div></div>" +
    '<div class="panel"><h3>Reading this honestly</h3><p class="muted small" style="margin:0">The bridge is a map, not a measurement: pattern links name where the catalog already thinks about a mechanism, they do not prove the lab implements the pattern. Run the lab — the 50-iteration gate, not this table — for proof. And the catalog reads back the other way: five of its failure scenarios are self-improvement stories, which is why the lab lives alongside this catalog rather than instead of it.</p></div>';
}

/* ---------------- boot ---------------- */

function initSelflearn() {
  if (!el("slMain")) return;
  if (selflearnState.booted) { renderSelflearn(); return; }
  try {
    slLoadCfg();
    selflearnState.booted = true;
    renderSelflearn();
    slProbe();
  } catch (e) {
    console.warn("selflearn init failed", e);
    el("slMain").innerHTML = '<div class="empty-state"><div class="empty-ico">🧬</div>' +
      '<div class="empty-t">Self-Learning could not start</div>' +
      '<div class="empty-b">Something went wrong while loading (' + escHtml(String(e && e.message || e)).slice(0, 140) + '). The catalog is unaffected.</div>' +
      '<button class="btn sm primary" onclick="initSelflearn()">Retry</button></div>';
  }
}

tabLoaders.selflearn = function () { initSelflearn(); };
