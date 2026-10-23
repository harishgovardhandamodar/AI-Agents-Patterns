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
  q: "",                 /* results-matrix search text (display-only) */
  failsOnly: false,      /* results-matrix shows only failing rows */
  results: [],
  run: null,
  running: false,
  view: "setup",        /* staged sub-view: setup | results | adversary | compare */
  cancel: null,
  selected: null,       /* the case under inspection */
  diffAgainst: null,    /* a stored run id to diff against */
  adversaryConfig: null,/* the configuration the adversary points at */
  sweep: null,          /* the last mutation sweep */
  attacks: [],          /* the last red-team findings */
  compare: null,        /* the last model comparison */
  compareModels: [],    /* the two model ids */
  compareLimit: 8
};

/* Build a quoted argument list for an inline handler. Values are
   JSON-stringified and then HTML-escaped: a raw `"` would terminate the
   double-quoted onclick attribute and silently truncate the handler
   (every argument-bearing button in this tab was dead because of that).
   The HTML parser decodes &quot; before JS runs, so the handler fires
   with exactly the strings passed here. */
function btArgs() {
  return escHtml(Array.prototype.slice.call(arguments)
    .map(function (x) { return JSON.stringify(String(x)); })
    .join(","));
}

function btInit() {
  btState.context = btContext();
  /* Seed the configuration panel with the default experiment set, and
     adopt the user's saved ones if they have any. */
  const saved = btConfigs();
  btState.configs = saved.length ? saved : btDefaultConfigs();
  if (!saved.length) {
    /* The hardened baseline is the subject the mutation sweep erodes, so
       it belongs in the default panel. */
    btState.configs.push(btHardenedConfig());
    btConfigsSave(btState.configs);
  }
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
  const h = btConfigHash(c);
  /* Last-run footprint so Setup answers "how did this config do?" at a glance. */
  const recs = btState.results.filter(function (r) { return r.configHash === h; });
  const last = !recs.length ? '<div class="bt-cfg-last muted small">not in the latest run</div>'
    : (function () {
        const p = recs.filter(function (r) { return r.verdict === "pass"; }).length;
        const f = recs.filter(function (r) { return r.verdict === "fail" || r.verdict === "error"; }).length;
        return '<div class="bt-cfg-last small">last run: <b class="bt-ok">' + p + " pass</b> · " +
          '<b class="' + (f ? "bt-bad" : "") + '">' + f + " fail</b></div>";
      })();
  return '<div class="bt-cfg" data-hash="' + h + '">' +
    '<div class="bt-cfg-h"><b>' + escHtml(c.name) + "</b>" +
    '<span class="mono muted small">' + h + "</span></div>" +
    '<div class="bt-cfg-axes">' +
    '<span class="chip">L' + c.autonomy + "</span>" +
    '<span class="chip ' + (c.approvalGate ? "ok" : "bad") + '">gate ' + (c.approvalGate ? "on" : "OFF") + "</span>" +
    '<span class="chip">' + escHtml(c.blast) + "</span>" +
    '<span class="chip">' + escHtml(c.criticality) + "</span>" +
    '<span class="chip">' + escHtml(c.sensitivity) + "</span>" +
    "</div>" +
    '<div class="bt-cfg-m muted small">' + stack.length + " implied controls · " +
    controls.length + " effective · " + (c.controls || []).length + " pinned</div>" +
    last +
    '<div class="bt-cfg-btns">' +
    '<button class="btn sm" onclick="btEditConfig(' + btArgs(h) + ')">Edit</button>' +
    '<button class="btn sm ghost" onclick="btRemoveConfig(' + btArgs(h) + ')">Remove</button>' +
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
  /* Arguments go through btArgs: JSON + HTML-escaped so a quote in a
     value can never break out of the onclick attribute. */
  const A = function () { return btArgs.apply(null, arguments); };
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

/* ---------------- Results: filter + matrix ---------------- */

/* Distinct corpus domains for the domain filter. */
function btDomainOptions() {
  const seen = {};
  btCorpus().forEach(function (s) { if (s && s.domain) seen[s.domain] = 1; });
  return Object.keys(seen).sort();
}

/* One row per scenario. Runs always cover the full corpus; severity, domain
   and search slice the display only, so one run supports every cut. */
function btScenRows() {
  const cases = btCases(btState.configs, { context: btState.context });
  const seen = {};
  const q = (btState.q || "").toLowerCase();
  const out = [];
  cases.forEach(function (kase) {
    if (seen[kase.scenarioId]) return;
    seen[kase.scenarioId] = 1;
    if (btState.severity && kase.scenario.severity !== btState.severity) return;
    if (btState.domain && kase.scenario.domain !== btState.domain) return;
    if (q && (kase.scenario.title + " " + kase.scenarioId).toLowerCase().indexOf(q) < 0) return;
    out.push(kase);
  });
  return out;
}

function btFilterChips() {
  const chips = [];
  if (btState.severity) chips.push({ label: "severity " + btState.severity, fn: "btClearFilter('severity')" });
  if (btState.domain) chips.push({ label: btState.domain, fn: "btClearFilter('domain')" });
  if (btState.q) chips.push({ label: "“" + btState.q.slice(0, 24) + "”", fn: "btClearFilter('q')" });
  if (btState.failsOnly) chips.push({ label: "failures only", fn: "btClearFilter('failsOnly')" });
  return chips;
}

function btClearAllFilters() {
  btState.severity = ""; btState.domain = ""; btState.q = ""; btState.failsOnly = false;
  renderBench();
}

/* Repaint table + count + chips in place — search keeps focus. */
function btPaintMatrix() {
  const wrap = el("btMatrixWrap");
  if (wrap) wrap.innerHTML = btMatrixInnerHtml();
  const n = el("btMatrixCount");
  if (n) n.textContent = btLastCounts ? ("Showing " + btLastCounts.shown + " of " + btLastCounts.total + " scenarios") : "";
  const b = el("btFailsBtn");
  if (b) { b.classList.toggle("primary", !!btState.failsOnly); b.setAttribute("aria-pressed", String(!!btState.failsOnly)); }
  if (typeof paintActiveChips === "function") paintActiveChips("btActiveChips", btFilterChips());
}

function btKeyInspect(e, sid, hash) {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); btInspect(sid, hash); }
}

let btLastCounts = null;

/* The matrix: one row per scenario, one column per configuration. */
function btMatrixInnerHtml() {
  const cfgs = btState.configs;
  if (!cfgs.length) return '<p class="muted small">No configurations — add one in Setup.</p>';
  const byCell = {};
  btState.results.forEach(function (r) {
    byCell[r.scenarioId + "@" + r.configHash] = r;
  });
  /* btCases yields one case per scenario × config — dedupe to one row per
     scenario, or every scenario repeats once per configuration. */
  const all = (function () {
    const cases = btCases(btState.configs, { context: btState.context });
    const seen = {};
    return cases.filter(function (kase) {
      if (seen[kase.scenarioId]) return false;
      seen[kase.scenarioId] = 1;
      return true;
    });
  })();
  let scen = btScenRows();
  const isBad = function (r) { return r && (r.verdict === "fail" || r.verdict === "error"); };
  if (btState.failsOnly) {
    scen = scen.filter(function (kase) {
      return cfgs.some(function (c) { return isBad(byCell[kase.scenarioId + "@" + btConfigHash(c)]); });
    });
  }
  btLastCounts = { shown: scen.length, total: all.length };
  if (!scen.length) {
    return '<div class="empty-state"><div class="empty-ico">∅</div>' +
      '<div class="empty-t">No scenarios match</div>' +
      '<div class="empty-b">The filters hide every row. Loosen them to see the matrix.</div>' +
      '<button class="btn sm primary" onclick="btClearAllFilters()">Clear filters</button></div>';
  }
  const colBad = cfgs.map(function (c) {
    const h = btConfigHash(c);
    let n = 0;
    scen.forEach(function (kase) { if (isBad(byCell[kase.scenarioId + "@" + h])) n++; });
    return n;
  });
  const head = '<tr><th class="bt-mh" scope="col">scenario</th>' +
    cfgs.map(function (c, i) {
      return '<th class="bt-mh bt-mh-c" scope="col" title="' + escHtml(c.name) + '">' + escHtml(c.name) +
        (colBad[i] ? ' <span class="bt-col-bad">✗' + colBad[i] + "</span>" : "") + "</th>";
    }).join("") + "</tr>";
  const rows = scen.map(function (kase) {
    let nBad = 0;
    const cells = cfgs.map(function (c) {
      const r = byCell[kase.scenarioId + "@" + btConfigHash(c)];
      if (!r) return '<td class="bt-cell bt-none">·</td>';
      if (r.verdict === "fail" || r.verdict === "error") nBad++;
      const cls = r.verdict === "pass" ? "bt-pass" : r.verdict === "fail" ? "bt-fail" :
        r.verdict === "error" ? "bt-err" : r.verdict === "skip" ? "bt-skip" : "bt-none";
      const mark = r.verdict === "pass" ? "✓" : r.verdict === "fail" ? "✗" : r.verdict === "error" ? "!" : "–";
      const al = r.scenarioTitle + ", " + c.name + ": " + r.verdict + " (" + r.passed + "/" + r.total + " checks). Activate to inspect.";
      return '<td class="bt-cell ' + cls + '" tabindex="0" role="gridcell" aria-label="' + escHtml(al) + '" ' +
        'onclick="btInspect(' + btArgs(kase.scenarioId, btConfigHash(c)) + ')" ' +
        'onkeydown="btKeyInspect(event,' + btArgs(kase.scenarioId, btConfigHash(c)) + ')" ' +
        'title="' + escHtml(r.scenarioTitle + " — " + r.verdict + " (" + r.passed + "/" + r.total + " checks)") + '">' + mark + "</td>";
    }).join("");
    /* Row label inspects the first failing cell so one click lands on evidence. */
    let target = cfgs[0];
    for (let i = 0; i < cfgs.length; i++) {
      if (isBad(byCell[kase.scenarioId + "@" + btConfigHash(cfgs[i])])) { target = cfgs[i]; break; }
    }
    return '<tr><th class="bt-mh bt-mh-l" scope="row" tabindex="0" title="' + escHtml(kase.scenario.id + " — " + kase.scenario.title) + '" ' +
      'onclick="btInspect(' + btArgs(kase.scenarioId, btConfigHash(target)) + ')" ' +
      'onkeydown="btKeyInspect(event,' + btArgs(kase.scenarioId, btConfigHash(target)) + ')" >' +
      '<span class="sev-dot sev-' + kase.scenario.severity + '"></span>' + escHtml(kase.scenario.title) +
      (nBad ? ' <span class="bt-col-bad">✗' + nBad + "</span>" : "") +
      "</th>" + cells + "</tr>";
  }).join("");
  return '<table class="bt-matrix" role="grid" aria-label="Results matrix: scenarios by configurations"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table>";
}

/* ---------------- rendering ---------------- */

/* Staged sub-views: one job per screen instead of six stacked panels. */
function btSetView(v) {
  btState.view = v;
  renderBench();
}

function btTabsHtml() {
  const v = btState.view || "setup";
  const tab = function (id, label, badge) {
    return '<button class="seg-btn' + (v === id ? " active" : "") + '" onclick="btSetView(' + btArgs(id) + ')">' +
      escHtml(label) + (badge ? ' <span class="bt-tab-n">' + escHtml(String(badge)) + "</span>" : "") + "</button>";
  };
  return '<div class="seg bt-tabs" role="tablist">' +
    tab("setup", "1 · Setup", btState.configs.length || "") +
    tab("results", "2 · Results", btState.results.length || "") +
    tab("adversary", "3 · Adversary", "") +
    tab("compare", "4 · Compare", "") +
    "</div>";
}

/* What each executor actually does — the run control's most-asked question. */
function btAdapterBlurb() {
  if (btState.adapter === "live") return "Live model via the same-origin proxy — slow (serialised, one case at a time), needs a backend, can surprise you. Empty completions retry, never pass.";
  if (btState.adapter === "golden") return "Replays the published traces — deterministic, checks the replay pipeline, not the controls.";
  return "Simulates the config's controls with the deterministic rule engine — instant, no model needed. Start here.";
}

/* The run controls live in Setup; filters live in Results (run once, slice many ways). */
function btRunControlsHtml(adapters) {
  return '<div class="bt-runbar">' +
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
      '<div style="flex:1"></div>' +
      (btState.running
        ? '<button class="btn danger" onclick="btCancel()">■ Stop</button>'
        : '<button class="btn primary" onclick="btStart()">▶ Run the bench</button>') +
    "</div>" +
    '<p class="muted small" id="btAdapterHelp" style="margin:6px 0 0">' + escHtml(btAdapterBlurb()) + "</p>" +
    (btState.running
      ? '<div class="bt-progress"><div class="bt-progress-fill" style="width:' + btProgressPct() + '%"></div></div>' +
        '<p class="muted small" id="btProgressText">' + escHtml(btProgressText()) + "</p>"
      : "");
}

function btSetupHtml(cov, adapters) {
  return '<div class="panel" style="margin-bottom:12px"><h3>Run <span class="muted small">executor · mode · backend — always the full corpus</span></h3>' +
      btRunControlsHtml(adapters) +
      '<p class="muted small" style="margin:8px 0 0">' + escHtml(cov.total) + " scenarios × " + btState.configs.length +
      " configuration" + (btState.configs.length === 1 ? "" : "s") +
      " = <b>" + (cov.total * btState.configs.length) + "</b> cases" +
      (cov.tested < cov.total ? ' · <span style="color:var(--orange)">' + (cov.total - cov.tested) + " scenarios have no published trace</span>" : "") +
      "</p></div>" +
    '<div class="panel" style="margin-bottom:12px"><h3>Configurations under test</h3>' +
      btTwinWarnHtml() +
      '<div class="bt-cfgs">' + (btState.configs.length
        ? btState.configs.map(btConfigHtml).join("")
        : '<p class="muted small">No configurations — add one to run the bench.</p>') + "</div>" +
    "</div>";
}

/* Per-severity outcome chips: where the failures concentrate. */
function btSevPerfHtml(sum) {
  const order = ["critical", "high", "medium"];
  const chips = order
    .filter(function (s) { return sum.bySeverity && sum.bySeverity[s]; })
    .map(function (s) {
      const g = sum.bySeverity[s];
      const bad = (g.fail || 0) + (g.error || 0);
      const cls = bad ? "bad" : (g.pass ? "ok" : "");
      return '<span class="chip ' + cls + '" title="' + g.pass + " pass · " + g.fail + " fail · " +
        g.error + " error · " + g.skip + ' skipped">' + escHtml(s) + ": " + g.pass + "✓" +
        (bad ? " · " + bad + "✗" : "") + "</span>";
    }).join("");
  return chips ? '<div class="bt-sev-row">' + chips + "</div>" : "";
}

/* Per-configuration outcome table with pass-rate bars. */
function btConfigPerfHtml(sum) {
  const names = Object.keys(sum.byConfig || {});
  if (!names.length) return "";
  const rows = names.map(function (n) {
    const g = sum.byConfig[n];
    const t = (g.pass || 0) + (g.fail || 0) + (g.error || 0) + (g.skip || 0);
    const pct = t ? Math.round(((g.pass || 0) / t) * 100) : 0;
    return "<tr><td>" + escHtml(String(n).split(" · ")[0]) + "</td>" +
      '<td class="mono small"><span class="bt-ok">' + (g.pass || 0) + "</span> / " +
      '<span class="bt-bad">' + (g.fail || 0) + "</span> / " + (g.error || 0) + " / " + (g.skip || 0) + "</td>" +
      '<td><div class="bt-bar" title="' + pct + '% pass"><span class="bt-bar-fill" style="width:' + pct + '%"></span></div></td></tr>';
  }).join("");
  return '<table class="tbl bt-cfg-tbl"><thead><tr><th>Configuration</th><th>pass / fail / err / skip</th><th>pass rate</th></tr></thead>' +
    "<tbody>" + rows + "</tbody></table>";
}

function btToolbarHtml() {
  const doms = btDomainOptions();
  return '<div class="sticky-bar bt-toolbar">' +
    '<input class="search" id="btQ" type="search" placeholder="Filter scenarios…" aria-label="Filter scenarios" ' +
      'value="' + escHtml(btState.q || "") + '" oninput="btSetQuery(this.value)">' +
    '<select class="search" id="btSevF" aria-label="Severity filter" onchange="btSetSeverity(this.value)">' +
      [["", "all severities"], ["critical", "critical"], ["high", "high"], ["medium", "medium"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (btState.severity === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("") +
    "</select>" +
    '<select class="search" id="btDomF" aria-label="Domain filter" onchange="btSetDomain(this.value)">' +
      '<option value="">all domains</option>' +
      doms.map(function (d) {
        return '<option value="' + escHtml(d) + '"' + (btState.domain === d ? " selected" : "") + ">" + escHtml(d) + "</option>";
      }).join("") +
    "</select>" +
    '<button class="btn sm' + (btState.failsOnly ? " primary" : "") + '" id="btFailsBtn" ' +
      'aria-pressed="' + String(!!btState.failsOnly) + '" onclick="btToggleFails()">✗ Failures only</button>' +
    '<span class="muted small" id="btMatrixCount"></span>' +
    '<div class="fchip-row" id="btActiveChips"></div>' +
    "</div>";
}

function btResultsHtml() {
  const sum = btState.run ? btState.run.summary : null;
  if (!btState.results.length) {
    return '<div class="panel" style="margin-bottom:12px"><h3>Results matrix <span class="muted small">scenarios × configurations</span></h3>' +
      (typeof emptyState === "function"
        ? emptyState("▦", "No results yet", "Set up configurations, run the bench, and the pass / fail matrix lands here.", "Go to Setup", "btSetView('setup')")
        : '<p class="muted small">Run the bench to fill the matrix.</p>') +
      "</div>";
  }
  const bad = sum ? ((sum.fail || 0) + (sum.error || 0)) : 0;
  return '<div class="panel" style="margin-bottom:12px"><h3>Outcome</h3>' +
      (sum ? btSummaryHtml(sum) + btSevPerfHtml(sum) + btConfigPerfHtml(sum) : "") +
      (bad ? '<div class="bt-cta-row"><button class="btn sm primary" onclick="btSetView(' + btArgs("adversary") + ')">' +
        "Probe these failures in Adversary →</button></div>" : "") +
      "</div>" +
    '<div class="panel" style="margin-bottom:12px"><h3>Results matrix <span class="muted small">scenarios × configurations — click or Enter on a cell to inspect</span></h3>' +
      btToolbarHtml() +
      '<div class="bt-matrix-wrap" id="btMatrixWrap">' + btMatrixInnerHtml() + "</div></div>";
}

function renderBench() {
  const root = el("benchMain");
  if (!root) return;
  const cov = btCoverage(btCases(btState.configs, { context: btState.context }));
  const adapters = btAdapterList();
  const view = btState.view || "setup";

  let body = "";
  if (view === "results") body = btResultsHtml();
  else if (view === "adversary") body =
    '<div class="panel" style="margin-bottom:12px"><h3>Adversary <span class="muted small">probe · mutate · attack</span></h3>' +
      btAdversaryHtml() + "</div>";
  else if (view === "compare") body =
    '<div class="panel" style="margin-bottom:12px"><h3>Model comparison <span class="muted small">same cases, two models</span></h3>' +
      btCompareHtml() + "</div>" +
    '<div class="panel"><h3>Stored runs</h3>' + btRunsHtml() + "</div>";
  else body = btSetupHtml(cov, adapters);

  root.innerHTML =
    '<div class="bt-head">' +
      "<div><h2>Battle Bench</h2>" +
      '<p class="muted small">Put a configuration in a scenario and assert on the outcome: ' +
      "setup → results → adversary → compare.</p></div>" +
      '<div class="bt-head-btns">' +
        '<button class="btn" onclick="btAddConfig()">＋ Configuration</button>' +
        '<button class="btn" onclick="btSweepConfigs()">⛓ Sweep configs</button>' +
        '<button class="btn" onclick="btExport(\'md\')" ' + (btState.run ? "" : "disabled") + ">⬇ Report</button>" +
        '<button class="btn" onclick="btExport(\'json\')" ' + (btState.run ? "" : "disabled") + ">⬇ JSON</button>" +
      "</div>" +
    "</div>" +
    btTabsHtml() + body;
  if (view === "results" && btState.results.length) btPaintMatrix();
}

/* ---------------- the model comparison panel ---------------- */

function btCompareHtml() {
  const cmp = btState.compare;
  const opts = btState.compareModels || [];
  const body = cmp
    ? (function () {
        const d = cmp.diff;
        const rows = d.changed.map(function (c) {
          return '<tr><td>' + escHtml(c.after.scenarioTitle.slice(0, 40)) + "</td>" +
            '<td class="mono small">' + escHtml(c.before.configName.split(" · ")[0]) + "</td>" +
            '<td class="' + (c.before.verdict === "pass" ? "bt-ok" : "bt-bad") + '">' + escHtml(c.before.verdict) + "</td>" +
            '<td class="' + (c.after.verdict === "pass" ? "bt-ok" : "bt-bad") + '">' + escHtml(c.after.verdict) + "</td></tr>";
        }).join("");
        return '<div class="bt-adv-btns">' +
          '<span class="muted small">' + escHtml(cmp.a.model) + " → " + escHtml(cmp.b.model) + "</span>" +
          '<span class="chip ' + (cmp.regressions.length ? "bad" : "ok") + '">' + cmp.regressions.length + " regression" + (cmp.regressions.length === 1 ? "" : "s") + "</span>" +
          '<span class="chip ok">' + cmp.improvements.length + " improvement" + (cmp.improvements.length === 1 ? "" : "s") + "</span>" +
          '<span class="muted small">' + d.same + " unchanged</span></div>" +
          (rows ? '<table class="tbl"><tr><th>Scenario</th><th>Config</th><th>' + escHtml(cmp.a.model) + "</th><th>" + escHtml(cmp.b.model) + "</th></tr>" + rows + "</table>"
            : '<p class="muted small">No verdict changed between the two models.</p>');
      })()
    : '<p class="muted small">Run the same cases against two models and diff the verdicts. A model swap is the most common change a team makes — this is how you see whether anything regressed.</p>';

  return '<div class="bt-runbar">' +
    '<label class="muted small">Model A</label>' +
    '<input class="search" id="btModelA" style="width:auto" placeholder="e.g. quai-qwen3.8-27b:latest" value="' + escHtml(opts[0] || "") + '">' +
    '<label class="muted small">Model B</label>' +
    '<input class="search" id="btModelB" style="width:auto" placeholder="e.g. qwen3.8:27b" value="' + escHtml(opts[1] || "") + '">' +
    '<label class="muted small">cases</label>' +
    '<input class="search" id="btCompareN" style="width:70px" type="number" min="1" max="54" value="' + (btState.compareLimit || 8) + '">' +
    '<button class="btn primary" onclick="btRunCompare()">⇄ Compare</button>' +
    '<button class="btn ghost" onclick="btListModels()">list models</button>' +
    "</div>" +
    '<p class="muted small" style="margin:6px 0 0">Compares the <b>first</b> configuration only — put the subject you care about first in Setup.</p>' +
    body;
}

/* Ask the backend which models it serves. */
async function btListModels() {
  const list = await btAvailableModels();
  if (!list.length) { showNotif("No model list available", { kind: "warn" }); return; }
  const html = '<div class="dsec"><h4>Available models</h4><ul>' +
    list.map(function (m) { return "<li><code>" + escHtml(m) + "</code></li>"; }).join("") + "</ul></div>";
  openDetail("Models", String(list.length), html);
}

/* Run the comparison. */
async function btRunCompare() {
  const a = el("btModelA") ? el("btModelA").value.trim() : "";
  const b = el("btModelB") ? el("btModelB").value.trim() : "";
  if (!a || !b) { showNotif("Name two models to compare", { kind: "warn" }); return; }
  const n = Math.max(1, Math.min(54, parseInt(el("btCompareN").value, 10) || 8));
  btState.compareModels = [a, b];
  btState.compareLimit = n;
  const cases = btCases(btState.configs.slice(0, 1), { context: btState.context }).slice(0, n);
  showNotif("Comparing " + a + " against " + b + " over " + cases.length + " cases…", { ttl: 8000 });
  try { await LLM.probe(true); } catch (e) { /* the adapter reports the error */ }
  btState.compare = await btCompareModels(cases, a, b, { context: btState.context, adapter: "live" });
  renderBench();
  const d = btState.compare;
  showNotif("Compared — " + d.regressions.length + " regression" + (d.regressions.length === 1 ? "" : "s") +
    ", " + d.improvements.length + " improvement" + (d.improvements.length === 1 ? "" : "s"), {
    kind: d.regressions.length ? "warn" : "ok", ttl: 8000
  });
}

/* ---------------- the adversary panel ---------------- */

/* Which configuration the adversary is pointed at. */
function btAdversaryConfig() {
  return btState.adversaryConfig
    ? btConfigByHash(btState.adversaryConfig)
    : (btState.configs[0] || null);
}

function btAdversaryHtml() {
  const cfg = btAdversaryConfig();
  if (!cfg) return '<p class="muted small">Add a configuration to run the adversary against it.</p>';
  const probe = btProbe(cfg, 6);
  const rows = probe.map(function (e) {
    return '<tr><td><span class="sev-dot sev-' + e.severity + '"></span>' + escHtml(e.title.slice(0, 46)) + "</td>" +
      '<td class="mono small">' + Math.round(e.exposure * 100) / 100 + "</td>" +
      '<td class="mono small">' + e.coverage + "%</td>" +
      '<td class="muted small">' + escHtml(e.missing.slice(0, 3).join(", ") || "—") + "</td>" +
      '<td><button class="btn sm" onclick="btAdversaryAttack(' + btArgs(e.scenarioId) + ')">⚔ attack</button></td></tr>';
  }).join("");
  const sweep = btState.sweep ? btSweepHtml(btState.sweep) : "";
  const attacks = btState.attacks ? btAttackHtml(btState.attacks) : "";
  return '<p class="muted small">The probe ranks every scenario by how exposed <b>' + escHtml(cfg.name) +
    "</b> is to it — severity × likelihood × blast reach × autonomy, discounted by the defense set the subject actually carries. " +
    "The mutation sweep changes one setting at a time and re-runs; the attack asks a model to break the subject outright.</p>" +
    '<div class="bt-adv-btns">' +
      '<label class="muted small">Subject</label>' +
      '<select class="search" id="btAdvCfg" aria-label="Adversary subject" onchange="btSetAdversaryConfig(this.value)">' +
        btState.configs.map(function (c) {
          return '<option value="' + btConfigHash(c) + '"' + (btConfigHash(c) === btConfigHash(cfg) ? " selected" : "") + ">" + escHtml(c.name) + "</option>";
        }).join("") +
      "</select>" +
      '<button class="btn sm" onclick="btRunSweep()">⛓ Mutation sweep</button>' +
      '<button class="btn sm" onclick="btRunRedTeam()">⚔ Red-team (needs a model)</button>' +
    "</div>" +
    '<div class="bt-adv-tables">' +
      '<div><h4 style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin:10px 0 5px">Probe — most exposed scenarios</h4>' +
      '<table class="tbl"><tr><th>Scenario</th><th>exposure</th><th>covered</th><th>missing controls</th><th></th></tr>' + rows + "</table></div>" +
    "</div>" +
    sweep + attacks;
}

function btSetAdversaryConfig(h) { btState.adversaryConfig = h; renderBench(); }

/* The mutation sweep result: which setting costs the most. */
function btSweepHtml(sweep) {
  if (!sweep || !sweep.rows.length) {
    if (sweep && sweep.note) return '<div><p class="muted small">' + escHtml(sweep.note) + "</p></div>";
    return "";
  }
  const rows = sweep.rows.map(function (r) {
    const cls = r.delta < 0 ? "bt-bad" : r.delta === 0 ? "" : "bt-ok";
    return '<tr><td><b>' + escHtml(r.label) + "</b><br><span class=\"muted small\">" + escHtml(r.why) + "</span></td>" +
      '<td class="' + cls + '">' + (r.delta > 0 ? "+" : "") + r.delta + "</td>" +
      '<td class="mono small">' + r.pass + " pass / " + r.fail + " fail</td></tr>";
  }).join("");
  return '<div><h4 style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin:12px 0 5px">' +
    "Mutation sweep — " + sweep.cases + " passing baseline cases</h4>" +
    '<table class="tbl"><tr><th>Mutation</th><th>Δ pass</th><th>result</th></tr>' + rows + "</table></div>";
}

/* The red-team findings. */
function btAttackHtml(attacks) {
  if (!attacks.length) return "";
  const rows = attacks.map(function (a) {
    return '<tr><td><span class="sev-dot sev-' + (a.severity === "high" ? "critical" : a.severity === "medium" ? "high" : "medium") + '"></span>' +
      escHtml(a.title.slice(0, 40)) + "</td>" +
      '<td class="muted small">' + escHtml(a.finding) + "</td>" +
      '<td class="muted small">' + (a.error ? escHtml(a.error) : (a.ms / 1000).toFixed(1) + "s") + "</td>" +
      '<td><button class="btn sm" onclick="btShowAttack(' + btArgs(a.scenarioId) + ')">view</button></td></tr>';
  }).join("");
  return '<div><h4 style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin:12px 0 5px">' +
    "Red-team findings</h4>" +
    '<table class="tbl"><tr><th>Scenario</th><th>finding</th><th>time</th><th></th></tr>' + rows + "</table></div>";
}

/* Attack one scenario against the adversary's subject. */
async function btAdversaryAttack(scenarioId) {
  const cfg = btAdversaryConfig();
  if (!cfg) return;
  const scn = btCorpus().find(function (x) { return x.id === scenarioId; });
  if (!scn) return;
  showNotif("Attacking " + cfg.name + " with " + scn.title.slice(0, 30) + "…", { ttl: 6000 });
  const r = await btAttack(cfg, scn, btState.context);
  btState.attacks = [r].concat(btState.attacks || []).slice(0, 12);
  renderBench();
  showNotif(r.error ? ("Attack failed: " + r.error) : ("Attack written — " + r.finding), {
    kind: r.severity === "high" ? "warn" : r.error ? "error" : "ok", ttl: 8000
  });
}

/* Show one attack in the drawer. */
function btShowAttack(scenarioId) {
  const a = (btState.attacks || []).find(function (x) { return x.scenarioId === scenarioId; });
  if (!a) return;
  const html =
    '<div class="dsec"><p class="muted small">Exposure <b>' + a.exposure + "</b> · defense coverage " + a.coverage +
    "% · missing " + escHtml(a.missing.join(", ") || "—") + "</p></div>" +
    '<div class="dsec"><h4>Finding</h4><p>' + escHtml(a.finding) + "</p></div>" +
    (a.error ? '<div class="dsec"><p style="color:var(--orange)">' + escHtml(a.error) + "</p></div>" : "") +
    (a.attack ? '<div class="dsec"><h4>The attack</h4><pre class="bt-out">' + escHtml(a.attack) + "</pre></div>" : "");
  openDetail("Attack — " + a.title, "red team", html);
}

/* Run the mutation sweep. */
async function btRunSweep() {
  const cfg = btAdversaryConfig();
  if (!cfg) return;
  showNotif("Sweeping " + BT_MUTATIONS.length + " mutations of " + cfg.name + "…", { ttl: 5000 });
  const sweep = await btSweep(cfg, {
    adapter: btState.adapter,
    context: btState.context,
    probeLimit: 10
  });
  btState.sweep = sweep;
  renderBench();
  const worst = sweep.rows[0];
  showNotif(worst
    ? "Sweep done — the worst mutation is “" + worst.label + "” (" + (worst.delta > 0 ? "+" : "") + worst.delta + " passing)"
    : "Sweep done", { kind: worst && worst.delta < 0 ? "warn" : "ok", ttl: 7000 });
}

/* Run the full red-team loop. */
async function btRunRedTeam() {
  const cfg = btAdversaryConfig();
  if (!cfg) return;
  showNotif("Red-teaming " + cfg.name + " — this needs a model and takes a while…", { ttl: 6000 });
  try { await LLM.probe(true); } catch (e) { /* the adapter reports the error */ }
  const out = await btRedTeam(cfg, { context: btState.context, probeLimit: 3 });
  btState.attacks = out.findings;
  renderBench();
  const high = out.findings.filter(function (f) { return f.severity === "high"; }).length;
  showNotif("Red team done — " + out.findings.length + " attacks, " + high + " naming a missing control", {
    kind: high ? "warn" : "ok", ttl: 8000
  });
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
        '<table class="tbl bt-fail-tbl"><thead><tr><th>Scenario</th><th>Config</th><th>What broke</th></tr></thead><tbody>' +
        sum.failing.slice(0, 12).map(function (r) {
          const broke = r.checks.filter(function (c) { return !c.pass; });
          return '<tr class="bt-fail-row" onclick="btInspect(' + btArgs(r.scenarioId, r.configHash) + ')" title="Inspect this case">' +
            "<td>" + escHtml(r.scenarioTitle.slice(0, 44)) + "</td>" +
            '<td><span class="chip">' + escHtml(r.configName.split(" · ")[0]) + "</span></td>" +
            '<td class="muted small">' + escHtml(broke.map(function (c) { return c.label + " (" + c.detail + ")"; }).join("; ")) + "</td></tr>";
        }).join("") + "</tbody></table>" +
        (sum.failing.length > 12 ? '<p class="muted small">Showing 12 of ' + sum.failing.length + " — inspect the matrix for the rest.</p>" : "") +
        "</details>"
      : "");
}

/* ---------------- running ---------------- */

let btProgress = { done: 0, total: 0, last: "" };
function btProgressPct() { return btProgress.total ? Math.round((btProgress.done / btProgress.total) * 100) : 0; }
function btProgressText() { return btProgress.done + " / " + btProgress.total + " · " + btProgress.last; }

function btSetAdapter(v) { btState.adapter = v; const h = el("btAdapterHelp"); if (h) h.textContent = btAdapterBlurb(); }
function btSetMode(v) { btState.context.mode = v; }
function btSetBackend(v) { btState.context.backend = v; }
/* Display filters — repaint the matrix in place so search keeps focus. */
function btSetSeverity(v) { btState.severity = v; btPaintMatrix(); }
function btSetDomain(v) { btState.domain = v; btPaintMatrix(); }
function btSetQuery(v) { btState.q = v; btPaintMatrix(); }
function btToggleFails() { btState.failsOnly = !btState.failsOnly; btPaintMatrix(); }
function btClearFilter(k) {
  if (k === "severity") btState.severity = "";
  else if (k === "domain") btState.domain = "";
  else if (k === "q") btState.q = "";
  else if (k === "failsOnly") btState.failsOnly = false;
  renderBench();
}

async function btStart() {
  if (btState.running) return;
  /* Runs always cover the full corpus — severity / domain / search slice the
     display in Results, never the run, so one run supports every cut. */
  const cases = btCases(btState.configs, { context: btState.context });
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
  btState.view = "results";
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
      '<button class="btn sm ghost danger" onclick="btDeleteRun(' + btArgs(r.run.id) + ')" title="Delete this stored run">✕</button>' +
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
  btState.view = "results";
  renderBench();
  showNotif("Loaded run " + runId);
}

function btDeleteRun(runId) {
  btRunsSave(btLoadRuns().filter(function (x) { return x.run.id !== runId; }));
  if (btState.run && btState.run.id === runId) { btState.run = null; btState.results = []; }
  renderBench();
  showNotif("Deleted run " + runId);
}

/* ---------------- the dimension sweep ---------------- */

/* Sweep one dimension across its values, holding the rest — the cheapest
   way to find where a design breaks. */
/* Sweep the *configuration space*: one configuration per value of each
   dimension. (The adversary's mutation sweep — change one setting of one
   configuration and re-run — is btSweep in js/adversary.js.) */
function btSweepConfigs() {
  const dims = ["autonomy", "blast", "criticality", "approvalGate", "sensitivity", "hosting", "rollout"];
  const base = btState.configs[0] || btDefaultConfigs()[0];
  const out = [];
  const seen = {};
  dims.forEach(function (d) {
    (BT_DIMS[d] || []).forEach(function (v) {
      /* Skip the base's own value and any twin already emitted: identical
         settings share one hash, so twins render the same results under
         two different names — fails appearing under the wrong column. */
      if (String(base[d]) === String(v)) return;
      const c = btConfig(Object.assign({}, base, (function () { const o = {}; o[d] = v; return o; })(), { name: d + " = " + v }));
      const h = btConfigHash(c);
      if (seen[h]) return;
      seen[h] = 1;
      out.push(c);
    });
  });
  btState.configs = out;
  btPersistConfigs();
  renderBench();
  showNotif("Swept " + dims.length + " dimensions — " + out.length + " configurations");
}

/* Twin configurations (same hash, different names) render the same results
   under each name. Surface them in Setup so a misplaced fail is explainable. */
function btTwinWarnHtml() {
  const byHash = {};
  btState.configs.forEach(function (c) {
    const h = btConfigHash(c);
    (byHash[h] = byHash[h] || []).push(c.name);
  });
  const twins = Object.keys(byHash).filter(function (h) { return byHash[h].length > 1; });
  if (!twins.length) return "";
  return '<p class="muted small" style="color:var(--orange)">⚠ ' +
    twins.map(function (h) { return escHtml(byHash[h].join("  ≡  ")); }).join(" · ") +
    " — identical settings under different names; results show under each.</p>";
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
