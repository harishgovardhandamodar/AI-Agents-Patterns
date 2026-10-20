/* js/benchui.js — the Battle Bench tab (agent-battlefield).
 *
 * The surface for js/bench.js: pick configurations, pick an adapter, run
 * the corpus, and read the result as a matrix (scenarios × configurations)
 * rather than a wall of pass/fail lines.
 *
 * The matrix is the point. A bench that says "17 of 54 failed" is a
 * number; a bench that shows *which configurations* fail *which scenarios*
 * is a result — because that is what tells you where the design is
 * fragile, and the cells are the evidence.
 */
"use strict";

const btState = {
  configs: [],          /* the selected configurations */
  adapter: "guardrail",
  context: null,
  severity: "", domain: "",
  results: [],
  run: null,
  running: false,
  cancel: null,
  selected: null,       /* the case under inspection */
  diffAgainst: null     /* a stored run id to diff against */
};

/* Build a quoted argument list for an inline handler. JSON.stringify
   means a value containing a quote can never break out of the attribute. */
function btArgs() {
  return Array.prototype.slice.call(arguments)
    .map(function (x) { return JSON.stringify(String(x)); })
    .join(",");
}

function btInit() {
  btState.context = btContext();
  /* Seed the configuration panel with the default experiment set, and
     adopt the user's saved ones if they have any. */
  const saved = btConfigs();
  btState.configs = saved.length ? saved : btDefaultConfigs();
  if (!saved.length) btConfigsSave(btState.configs);
  renderBench();
}

/* The pane's entry point, named for the tab registry in js/app.js. */
function initBench() {
  if (!el("benchMain")) return;
  try {
    btInit();
  } catch (e) {
    console.warn("bench init failed", e);
    el("benchMain").innerHTML = '<div class="empty-state"><div class="empty-ico">⚔</div>' +
      '<div class="empty-t">Battle Bench could not start</div>' +
      '<div class="empty-b">Something went wrong while loading (' + escHtml(String(e && e.message || e)).slice(0, 140) + '). The catalog is unaffected.</div>' +
      '<button class="btn sm primary" onclick="initBench()">Retry</button></div>';
  }
}

/* The tab loader: the pane is built when the tab is first visited. */
tabLoaders.bench = function () { initBench(); };

/* ---------------- configuration panel ---------------- */

function btConfigHtml(c) {
  const controls = btEffectiveControls(c);
  const stack = btConfigStack(c);
  return '<div class="bt-cfg" data-hash="' + btConfigHash(c) + '">' +
    '<div class="bt-cfg-h"><b>' + escHtml(c.name) + "</b>" +
    '<span class="mono muted small">' + btConfigHash(c) + "</span></div>" +
    '<div class="bt-cfg-axes">' +
    '<span class="chip">L' + c.autonomy + "</span>" +
    '<span class="chip ' + (c.approvalGate ? "ok" : "bad") + '">gate ' + (c.approvalGate ? "on" : "OFF") + "</span>" +
    '<span class="chip">' + escHtml(c.blast) + "</span>" +
    '<span class="chip">' + escHtml(c.criticality) + "</span>" +
    '<span class="chip">' + escHtml(c.sensitivity) + "</span>" +
    "</div>" +
    '<div class="bt-cfg-m muted small">' + stack.length + " implied controls · " +
    controls.length + " effective · " + (c.controls || []).length + " pinned</div>" +
    '<div class="bt-cfg-btns">' +
    '<button class="btn sm" onclick="btEditConfig(' + btArgs(btConfigHash(c)) + ')">Edit</button>' +
    '<button class="btn sm ghost" onclick="btRemoveConfig(' + btArgs(btConfigHash(c)) + ')">Remove</button>' +
    "</div>" +
    "</div>";
}

function btConfigByHash(h) {
  return btState.configs.find(function (c) { return btConfigHash(c) === h; }) || null;
}

/* Edit a configuration in a drawer — the same shape the planner uses. */
function btEditConfig(hash) {
  const c = btConfigByHash(hash);
  if (!c) return;
  const dims = BT_DIMS;
  /* Arguments go through JSON.stringify so a quote in a value can never
     break out of the onclick attribute. */
  const A = function () { return Array.prototype.slice.call(arguments).map(function (x) { return JSON.stringify(String(x)); }).join(","); };
  const sel = function (k, v, label) {
    const on = String(c[k]) === String(v);
    return '<button class="seg-btn' + (on ? " active" : "") + '" onclick="btSetDim(' + A(hash, k, v) + ")'>" + escHtml(label) + "</button>";
  };
  const checks = function (k, v, label) {
    const on = (c[k] || []).indexOf(v) >= 0;
    return '<label class="filter-item"><input type="checkbox" ' + (on ? "checked" : "") +
      ' onchange="btToggleDim(' + A(hash, k, v) + ",this.checked)\"> " + escHtml(label) + "</label>";
  };
  const html =
    '<div class="dsec"><h4>Autonomy</h4><div class="seg">' +
      dims.autonomy.map(function (v) { return sel("autonomy", v, "L" + v); }).join("") + "</div></div>" +
    '<div class="dsec"><h4>Approval gate</h4><div class="seg">' +
      sel("approvalGate", "true", "ON — irreversible steps need a human") +
      sel("approvalGate", "false", "OFF — the agent may act unsupervised") + "</div></div>" +
    '<div class="dsec"><h4>Blast radius</h4><div class="seg">' +
      dims.blast.map(function (v) { return sel("blast", v, v); }).join("") + "</div></div>" +
    '<div class="dsec"><h4>Business criticality</h4><div class="seg">' +
      dims.criticality.map(function (v) { return sel("criticality", v, v); }).join("") + "</div></div>" +
    '<div class="dsec"><h4>Data sensitivity</h4><div class="seg">' +
      dims.sensitivity.map(function (v) { return sel("sensitivity", v, v); }).join("") + "</div></div>" +
    '<div class="dsec"><h4>Hosting</h4><div class="seg">' +
      dims.hosting.map(function (v) { return sel("hosting", v, v); }).join("") + "</div></div>" +
    '<div class="dsec"><h4>Rollout</h4><div class="seg">' +
      dims.rollout.map(function (v) { return sel("rollout", v, v); }).join("") + "</div></div>" +
    '<div class="dsec"><h4>Actions the agent may take</h4>' +
      dims.actions.map(function (v) { return checks("actions", v, v); }).join("") + "</div>" +
    '<div class="dsec"><h4>Data classes in scope</h4>' +
      dims.dataClasses.map(function (v) { return checks("dataClasses", v, v); }).join("") + "</div>" +
    '<div class="dsec"><h4>Pinned controls (catalog pattern ids)</h4>' +
      '<input class="search" style="width:100%" placeholder="e.g. approval-gates, policy-engine" value="' + escHtml((c.controls || []).join(", ")) + '" oninput="btSetControls(' + A(hash) + ",this.value)\">" +
      '<p class="muted small">Pinned controls join the ones the configuration implies. Leave empty to test the implied stack alone.</p>' +
    "</div>" +
    '<div class="dsec d-actions"><button class="btn sm primary" onclick="closeDetail();btSaveConfigEdit()">Apply</button></div>';
  openDetail("Edit configuration — " + c.name, "bench", html);
}

function btSetDim(hash, k, v) {
  const c = btConfigByHash(hash);
  if (!c) return;
  c[k] = (k === "autonomy") ? Number(v) : (k === "approvalGate") ? (v === "true") : v;
  btPersistConfigs();
  btEditConfig(hash);
  renderBench();
}
function btToggleDim(hash, k, v, on) {
  const c = btConfigByHash(hash);
  if (!c) return;
  c[k] = c[k] || [];
  const i = c[k].indexOf(v);
  if (on && i < 0) c[k].push(v);
  if (!on && i >= 0) c[k].splice(i, 1);
  btPersistConfigs();
  btEditConfig(hash);
  renderBench();
}
function btSetControls(hash, v) {
  const c = btConfigByHash(hash);
  if (!c) return;
  c.controls = String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  btPersistConfigs();
}
function btSaveConfigEdit() { btPersistConfigs(); renderBench(); }
function btPersistConfigs() { btConfigsSave(btState.configs); }

function btRemoveConfig(hash) {
  const c = btConfigByHash(hash);
  if (!c) return;
  btState.configs = btState.configs.filter(function (x) { return btConfigHash(x) !== hash; });
  btPersistConfigs();
  renderBench();
}

/* Add a configuration. `over` seeds it from a dimension sweep. */
function btAddConfig(over) {
  const c = btConfig(Object.assign({ name: "cfg " + (btState.configs.length + 1) }, over || {}));
  btState.configs.push(c);
  btPersistConfigs();
  renderBench();
  btEditConfig(btConfigHash(c));
}

/* ---------------- the matrix ---------------- */

/* The matrix: one row per scenario, one column per configuration. */
function btMatrixHtml() {
  const cases = btCases(btState.configs, { context: btState.context, severity: btState.severity, domain: btState.domain });
  if (!cases.length) return '<p class="muted small">No cases match the current filters.</p>';
  const cfgs = btState.configs;
  const byCell = {};
  btState.results.forEach(function (r) {
    byCell[r.scenarioId + "@" + r.configHash] = r;
  });
  const head = '<tr><th class="bt-mh">scenario</th>' +
    cfgs.map(function (c) {
      return '<th class="bt-mh" title="' + escHtml(c.name) + '">' + escHtml(c.name.split(" · ")[0]) + "</th>";
    }).join("") + "</tr>";
  const rows = cases.map(function (kase) {
    const cells = cfgs.map(function (c) {
      const r = byCell[kase.scenarioId + "@" + btConfigHash(c)];
      if (!r) return '<td class="bt-cell bt-none">·</td>';
      const cls = r.verdict === "pass" ? "bt-pass" : r.verdict === "fail" ? "bt-fail" :
        r.verdict === "error" ? "bt-err" : r.verdict === "skip" ? "bt-skip" : "bt-none";
      const mark = r.verdict === "pass" ? "✓" : r.verdict === "fail" ? "✗" : r.verdict === "error" ? "!" : "–";
      return '<td class="bt-cell ' + cls + '" onclick="btInspect(' + btArgs(kase.scenarioId, btConfigHash(c)) + ')" ' +
        'title="' + escHtml(r.scenarioTitle + " — " + r.verdict + " (" + r.passed + "/" + r.total + " checks)") + '">' + mark + "</td>";
    }).join("");
    return '<tr><th class="bt-mh bt-mh-l" onclick="btInspect(' + btArgs(kase.scenarioId, btConfigHash(cfgs[0])) + ')" >' +
      '<span class="sev-dot sev-' + kase.scenario.severity + '"></span>' + escHtml(kase.scenario.title.slice(0, 46)) +
      "</th>" + cells + "</tr>";
  }).join("");
  return '<table class="bt-matrix"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table>";
}

/* ---------------- rendering ---------------- */

function renderBench() {
  const root = el("benchMain");
  if (!root) return;
  const cov = btCoverage(btCases(btState.configs, { context: btState.context, severity: btState.severity, domain: btState.domain }));
  const sum = btState.run ? btState.run.summary : null;
  const adapters = btAdapterList();

  root.innerHTML =
    '<div class="bt-head">' +
      "<div><h2>Battle Bench</h2>" +
      '<p class="muted small">Put a configuration in a scenario and assert on the outcome. ' +
      escHtml(cov.total) + " scenarios × " + btState.configs.length + " configuration" + (btState.configs.length === 1 ? "" : "s") +
      " = <b>" + (cov.total * btState.configs.length) + "</b> cases" +
      (cov.tested < cov.total ? ' · <span style="color:var(--orange)">' + (cov.total - cov.tested) + " scenarios have no published trace</span>" : "") +
      "</p></div>" +
      '<div class="bt-head-btns">' +
        '<button class="btn" onclick="btAddConfig()">＋ Configuration</button>' +
        '<button class="btn" onclick="btSweep()">⛓ Sweep</button>' +
      "</div>" +
    "</div>" +

    '<div class="panel" style="margin-bottom:12px"><h3>Run</h3>' +
      '<div class="bt-runbar">' +
        '<label class="muted small">Executor</label>' +
        '<select class="search" id="btAdapter" aria-label="Battle adapter" onchange="btSetAdapter(this.value)">' +
          adapters.map(function (a) {
            return '<option value="' + a.id + '"' + (a.id === btState.adapter ? " selected" : "") + ">" +
              escHtml(a.label) + (a.needsModel ? " · needs a model" : "") + "</option>";
          }).join("") +
        "</select>" +
        '<label class="muted small">Mode</label>' +
        '<select class="search" id="btMode" aria-label="Run mode" onchange="btSetMode(this.value)">' +
          '<option value="advise"' + (btState.context.mode === "advise" ? " selected" : "") + ">advise the team</option>" +
          '<option value="act"' + (btState.context.mode === "act" ? " selected" : "") + ">act as the agent</option>" +
        "</select>" +
        '<label class="muted small">Backend</label>' +
        '<select class="search" id="btBackend" aria-label="Model backend" onchange="btSetBackend(this.value)">' +
          '<option value="axiom"' + (btState.context.backend === "axiom" ? " selected" : "") + ">axiom (mesh)</option>" +
          '<option value="fox-services"' + (btState.context.backend === "fox-services" ? " selected" : "") + ">fox-services (local)</option>" +
        "</select>" +
        '<label class="muted small">Severity</label>' +
        '<select class="search" id="btSev" aria-label="Severity filter" onchange="btSetSeverity(this.value)">' +
          ["", "critical", "high", "medium"].map(function (s) {
            return '<option value="' + s + '"' + (btState.severity === s ? " selected" : "") + ">" + (s || "all") + "</option>";
          }).join("") +
        "</select>" +
        '<div style="flex:1"></div>' +
        (btState.running
          ? '<button class="btn danger" onclick="btCancel()">■ Stop</button>'
          : '<button class="btn primary" onclick="btStart()">▶ Run the bench</button>') +
      "</div>" +
      (btState.running
        ? '<div class="bt-progress"><div class="bt-progress-fill" style="width:' + btProgressPct() + '%"></div></div>' +
          '<p class="muted small" id="btProgressText">' + escHtml(btProgressText()) + "</p>"
        : "") +
      (sum ? btSummaryHtml(sum) : "") +
    "</div>" +

    '<div class="panel" style="margin-bottom:12px"><h3>Configurations under test</h3>' +
      '<div class="bt-cfgs">' + (btState.configs.length
        ? btState.configs.map(btConfigHtml).join("")
        : '<p class="muted small">No configurations — add one to run the bench.</p>') + "</div>" +
    "</div>" +

    '<div class="panel" style="margin-bottom:12px"><h3>Results matrix <span class="muted small">scenarios × configurations</span></h3>' +
      (btState.results.length ? btMatrixHtml() : '<p class="muted small">Run the bench to fill the matrix.</p>') +
    "</div>" +

    '<div class="panel"><h3>Stored runs</h3>' + btRunsHtml() + "</div>";
}

function btSummaryHtml(sum) {
  return '<div class="bt-summary">' +
    '<div class="bt-sum-cell"><span>passed</span><b class="bt-ok">' + sum.pass + "</b></div>" +
    '<div class="bt-sum-cell"><span>failed</span><b class="bt-bad">' + sum.fail + "</b></div>" +
    '<div class="bt-sum-cell"><span>errored</span><b>' + sum.error + "</b></div>" +
    '<div class="bt-sum-cell"><span>skipped</span><b>' + sum.skip + "</b></div>" +
    '<div class="bt-sum-cell"><span>pass rate</span><b>' + sum.passPct + "%</b></div>" +
    "</div>" +
    (sum.failing.length
      ? '<details open><summary class="bt-fail-sum">' + sum.failing.length + " failing case" + (sum.failing.length === 1 ? "" : "s") + " — the first checks that broke</summary>" +
        '<div class="bt-fails">' + sum.failing.slice(0, 12).map(function (r) {
          const broke = r.checks.filter(function (c) { return !c.pass; });
          return '<div class="bt-fail"><b>' + escHtml(r.scenarioTitle.slice(0, 44)) + "</b> " +
            '<span class="chip">' + escHtml(r.configName.split(" · ")[0]) + "</span> " +
            '<span class="muted small">' + escHtml(broke.map(function (c) { return c.label + " (" + c.detail + ")"; }).join("; ")) + "</span></div>";
        }).join("") + "</div></details>"
      : "");
}

/* ---------------- running ---------------- */

let btProgress = { done: 0, total: 0, last: "" };
function btProgressPct() { return btProgress.total ? Math.round((btProgress.done / btProgress.total) * 100) : 0; }
function btProgressText() { return btProgress.done + " / " + btProgress.total + " · " + btProgress.last; }

function btSetAdapter(v) { btState.adapter = v; }
function btSetMode(v) { btState.context.mode = v; }
function btSetBackend(v) { btState.context.backend = v; }
function btSetSeverity(v) { btState.severity = v; renderBench(); }

async function btStart() {
  if (btState.running) return;
  const cases = btCases(btState.configs, { context: btState.context, severity: btState.severity, domain: btState.domain });
  if (!cases.length) { showNotif("No cases to run", { kind: "warn" }); return; }
  const adapter = btAdapter(btState.adapter);
  if (adapter && adapter.needsModel) {
    showNotif("Waiting for the model backend…");
    try { await LLM.probe(true); } catch (e) { /* the adapter reports the error */ }
    if (!LLM.available()) {
      showNotif("No model backend reachable — the live adapter will report every case as errored. " +
        "Fox-Services (localhost:8210) is the default.", { kind: "warn", ttl: 7000 });
    }
  }
  btState.running = true;
  btProgress = { done: 0, total: cases.length, last: "" };
  btState.results = [];
  renderBench();

  const out = await btRun(cases, btState.adapter, {
    context: btState.context,
    onProgress: function (rec, i, n) {
      btProgress.done = i; btProgress.total = n;
      btProgress.last = rec.scenarioTitle.slice(0, 40) + " → " + rec.verdict;
      btState.results.push(rec);
      const bar = document.querySelector(".bt-progress-fill");
      if (bar) bar.style.width = btProgressPct() + "%";
      const t = document.getElementById("btProgressText");
      if (t) t.textContent = btProgressText();
    }
  });
  btState.running = false;
  btState.run = out.run;
  if (out.run) btSaveRun(out.run, out.results);
  renderBench();
  const s = out.run && out.run.summary;
  showNotif(s ? ("Bench complete — " + s.pass + " passed, " + s.fail + " failed, " + s.error + " errored") : "Bench finished", {
    kind: s && s.fail ? "warn" : "ok", ttl: 7000
  });
}

function btCancel() {
  if (btState.cancel) btState.cancel();
  btState.running = false;
  renderBench();
}

/* ---------------- inspecting a case ---------------- */

function btInspect(scenarioId, configHash) {
  const r = btState.results.find(function (x) { return x.scenarioId === scenarioId && x.configHash === configHash; });
  const s = btCorpus().find(function (x) { return x.id === scenarioId; });
  if (!s) return;
  if (!r) {
    openDetail(s.title, s.severity + " · not run", '<p class="muted">This case has not been run yet.</p>');
    return;
  }
  const checks = r.checks.map(function (c) {
    return '<tr><td>' + (c.pass ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">✗</span>') + "</td>" +
      "<td>" + escHtml(c.label) + '</td><td class="muted small">' + escHtml(c.detail) + "</td></tr>";
  }).join("");
  const oc = r.outcome || {};
  const outcomeRows = Object.keys(oc).filter(function (k) { return k !== "refsUncovered"; }).map(function (k) {
    return "<tr><td>" + escHtml(k) + "</td><td>" + escHtml(String(oc[k]).slice(0, 160)) + "</td></tr>";
  }).join("");
  const html =
    '<div class="dsec d-actions">' +
      '<span class="chip ' + (r.verdict === "pass" ? "ok" : r.verdict === "fail" ? "bad" : "") + '">' + escHtml(r.verdict) + " · " + r.passed + "/" + r.total + "</span>" +
      '<span class="chip">' + escHtml(r.configName) + "</span>" +
      '<span class="chip">' + escHtml(r.adapter) + "</span>" +
    "</div>" +
    (r.error ? '<div class="dsec"><p style="color:var(--orange)">' + escHtml(r.error) + "</p></div>" : "") +
    '<div class="dsec"><h4>Checks</h4><table class="tbl"><tr><th></th><th>Assertion</th><th>Detail</th></tr>' + checks + "</table></div>" +
    (outcomeRows ? '<div class="dsec"><h4>Outcome</h4><table class="tbl">' + outcomeRows + "</table></div>" : "") +
    (oc.refsUncovered && oc.refsUncovered.length
      ? '<div class="dsec"><h4>Uncovered defending patterns</h4><p class="muted small">' + escHtml(oc.refsUncovered.join(", ")) + "</p></div>"
      : "") +
    (r.output ? '<div class="dsec"><h4>Output</h4><pre class="bt-out">' + escHtml(r.output) + "</pre></div>" : "");
  openDetail(s.title, s.severity + " · " + s.domain + " · " + r.verdict, html);
}

/* ---------------- stored runs + diffing ---------------- */

function btRunsHtml() {
  const runs = btLoadRuns();
  if (!runs.length) return '<p class="muted small">No stored runs yet. Runs are kept so two can be compared.</p>';
  return '<div class="bt-runs">' + runs.map(function (r, i) {
    const s = r.run.summary;
    return '<div class="bt-run">' +
      '<div><b>' + escHtml(r.run.id) + "</b> " +
      '<span class="muted small">' + escHtml(r.run.adapter) + " · " + r.run.run + " cases · " + Math.round(r.run.durationMs / 1000) + "s</span></div>" +
      '<div class="bt-run-sum"><span class="bt-ok">' + s.pass + "</span> / <span class=\"bt-bad\">" + s.fail + "</span> pass / fail</div>" +
      '<div style="flex:1"></div>' +
      '<button class="btn sm" onclick="btDiffWith(' + btArgs(r.run.id) + ')">⇄ Compare with latest</button>' +
      '<button class="btn sm ghost" onclick="btLoadRun(' + btArgs(r.run.id) + ')">Load</button>' +
      "</div>";
  }).join("") + "</div>";
}

/* Diff the newest run against a stored one — what changed. */
function btDiffWith(runId) {
  const runs = btLoadRuns();
  if (runs.length < 2) { showNotif("Need at least two runs to compare", { kind: "warn" }); return; }
  const latest = runs[0], other = runs.find(function (r) { return r.run.id === runId; }) || runs[1];
  const d = btDiffRuns(other, latest);
  const html =
    '<div class="dsec"><p>Comparing <b>' + escHtml(other.run.id) + "</b> (" + other.run.adapter + ") against <b>" +
    escHtml(latest.run.id) + "</b> (" + latest.run.adapter + ").</p></div>" +
    '<div class="dsec"><h4>Changed</h4>' +
      (d.changed.length
        ? d.changed.map(function (c) {
            return '<div class="bt-fail"><b>' + escHtml(c.after.scenarioTitle.slice(0, 40)) + "</b> " +
              '<span class="chip">' + escHtml(c.after.configName.split(" · ")[0]) + "</span> " +
              '<span style="color:var(--orange)">' + escHtml(c.before.verdict) + " → </span>" +
              '<span style="color:' + (c.after.verdict === "pass" ? "var(--green)" : "var(--red)") + '">' + escHtml(c.after.verdict) + "</span></div>";
          }).join("")
        : '<p class="muted small">No verdict changed.</p>') +
    "</div>" +
    '<div class="dsec"><h4>Unchanged</h4><p class="muted small">' + d.same + " cases kept their verdict.</p></div>" +
    (d.added.length ? '<div class="dsec"><h4>New</h4><p class="muted small">' + d.added.length + " cases only in the newer run.</p></div>" : "");
  openDetail("Run comparison", "diff", html);
}

function btLoadRun(runId) {
  const r = btLoadRuns().find(function (x) { return x.run.id === runId; });
  if (!r) return;
  btState.results = r.results || [];
  btState.run = r.run;
  renderBench();
  showNotif("Loaded run " + runId);
}

/* ---------------- the dimension sweep ---------------- */

/* Sweep one dimension across its values, holding the rest — the cheapest
   way to find where a design breaks. */
function btSweep() {
  const dims = ["autonomy", "blast", "criticality", "approvalGate", "sensitivity", "hosting", "rollout"];
  const base = btState.configs[0] || btDefaultConfigs()[0];
  const out = [];
  dims.forEach(function (d) {
    (BT_DIMS[d] || []).forEach(function (v) {
      const o = {};
      o[d] = v;
      out.push(btConfig(Object.assign({}, base, o, { name: d + " = " + v })));
    });
  });
  btState.configs = out;
  btPersistConfigs();
  renderBench();
  showNotif("Swept " + dims.length + " dimensions — " + out.length + " configurations");
}

/* ---------------- export ---------------- */

function btExport(kind) {
  if (!btState.run) { showNotif("Run the bench first"); return; }
  const j = {
    generated: new Date().toISOString(),
    app: "AI Agent Patterns & Guardrails — Battle Bench",
    run: btState.run,
    configs: btState.configs,
    context: btState.context,
    results: btState.results
  };
  const txt = kind === "json" ? JSON.stringify(j, null, 2) : btReportMarkdown(j);
  const blob = new Blob([txt], { type: kind === "json" ? "application/json" : "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "battle-bench-" + (kind === "json" ? "" : "") + btState.run.id + (kind === "json" ? ".json" : ".md");
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showNotif("Battle bench exported");
}

/* The Markdown report: the matrix, the failures, the configuration
   sensitivity. */
function btReportMarkdown(j) {
  const out = [];
  const s = j.run.summary;
  out.push("# Battle bench report — " + j.run.id);
  out.push("");
  out.push("_" + j.run.at + " · adapter `" + j.run.adapter + "` · " + j.run.run + " cases in " + Math.round(j.run.durationMs / 1000) + "s_");
  out.push("");
  out.push("**Result:** " + s.pass + " passed · " + s.fail + " failed · " + s.error + " errored · " + s.skip + " skipped (" + s.passPct + "% pass rate)");
  out.push("");
  out.push("## Configurations under test");
  out.push("");
  out.push("| Configuration | hash | autonomy | gate | blast | criticality |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  j.configs.forEach(function (c) {
    out.push("| " + c.name + " | `" + btConfigHash(c) + "` | L" + c.autonomy + " | " + (c.approvalGate ? "on" : "OFF") + " | " + c.blast + " | " + c.criticality + " |");
  });
  out.push("");
  out.push("## Per configuration");
  out.push("");
  out.push("| Configuration | pass | fail | error | skip |");
  out.push("| --- | --- | --- | --- | --- |");
  Object.keys(s.byConfig).forEach(function (k) {
    const c = s.byConfig[k];
    out.push("| " + k + " | " + (c.pass || 0) + " | " + (c.fail || 0) + " | " + (c.error || 0) + " | " + (c.skip || 0) + " |");
  });
  out.push("");
  if (s.failing.length) {
    out.push("## Failures");
    out.push("");
    out.push("| Scenario | Configuration | Severity | Broken checks |");
    out.push("| --- | --- | --- | --- |");
    s.failing.forEach(function (r) {
      const broke = r.checks.filter(function (c) { return !c.pass; }).map(function (c) { return c.label + " (" + c.detail + ")"; });
      out.push("| " + r.scenarioTitle + " | " + r.configName + " | " + r.severity + " | " + broke.join("; ") + " |");
    });
    out.push("");
  }
  out.push("## Corpus coverage");
  out.push("");
  out.push(j.run.coverage.tested + " of " + j.run.coverage.total + " scenarios exercised (" + j.run.coverage.pct + "%).");
  if (j.run.coverage.missing.length) {
    out.push("");
    out.push("Scenarios with no published trace (not replayable): " + j.run.coverage.missing.join(", ") + ".");
  }
  out.push("");
  out.push("## Caveats");
  out.push("");
  out.push("- A passing case means the catalog-named controls were present and the recorded attack path was blocked. It is **not** evidence that the agent is safe.");
  out.push("- Figures are from synthetic traces and a deterministic rule engine, plus whatever the live adapter actually returned. Nothing here is a measured production incident.");
  out.push("- The bench never modifies the shipped catalog; `data/*.json` is read-only.");
  return out.join("\n");
}
