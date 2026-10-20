/* js/report.js — full architect report export (Markdown / JSON / print)
   One document that stitches together every work product the app produces:
   intake answers, readiness scorecard, recommended stack, rollout, risk
   register, ADR, blueprint (pipeline, coverage, cost/risk estimate,
   threat model), guardrail analyses, the cascade mitigation backlog, the
   pinned working set, discovery drafts and the copilot transcript.

   Every section degrades to a "not yet filled in" line when its tool hasn't
   been used, so the report is always printable. The report is also stamped
   with the current **project**, so the document says which system it
   describes (iteration 106). */
"use strict";

function rpWhen() { return new Date().toISOString().slice(0, 10); }

/* The project the report describes (iteration 106). Falls back to the
   blueprint/deploy name so an un-projected app still names its subject. */
function rpProjectName() {
  try {
    if (typeof projGet === "function") {
      const p = projGet();
      if (p && p.name) return p.name;
    }
  } catch (e) { /* project module unavailable */ }
  if (typeof bpState !== "undefined" && bpState.name) return bpState.name;
  if (typeof dpState !== "undefined" && dpState.a && dpState.a.system) return dpState.a.system;
  return "AI agent system";
}

/* The mitigation backlog as data (iteration 112): the same rows the
   Mitigation planner shows, flattened for the report. Each row carries the
   team's own owner/status from the aap.mitigations store. */
function rpMitigationRows() {
  if (typeof buildMitigationBacklog !== "function") return [];
  try {
    const list = buildMitigationBacklog();
    if (!Array.isArray(list)) return [];
    const saved = (typeof mitLoad === "function") ? mitLoad() : {};
    return list.map(e => {
      const s = saved[e.key] || saved[e.text] || {};
      return {
        control: e.text,
        function: e.func,
        priority: e.priority,
        score: e.score,
        freq: e.freq,
        cascades: e.cascades.length,
        owner: (s && (s.owner || s.who)) || "",
        status: (s && s.status) || ""
      };
    });
  } catch (e) { /* mitigation planner not loaded */ }
  return [];
}

function rpMarkdown() {
  const F = "```";
  const out = [];
  const proj = rpProjectName();
  out.push("# Architect report — " + proj);
  out.push("");
  out.push("_Generated " + rpWhen() + " from AI Agent Patterns & Guardrails — " +
    ((DATA.patterns.patterns || []).length) + " patterns · " +
    ((DATA.scenarios.scenarios || []).length) + " scenarios · " +
    ((DATA.cascades.cascades || []).length) + " cascades in the grounding catalog._");
  out.push("");

  /* 0 — what this document covers (iteration 106) */
  const covers = [];
  if (typeof dpState !== "undefined" && dpState.done) covers.push("deployment plan");
  if (typeof bpState !== "undefined" && bpState.comps.length) covers.push("reference architecture");
  if (typeof guardState !== "undefined" && guardState.items.length) covers.push("guardrail analyses");
  if (rpMitigationRows().length) covers.push("mitigation backlog");
  if (typeof pinState !== "undefined" && (pinState.patterns.length + pinState.scenarios.length + pinState.cascades.length)) covers.push("working set");
  if (typeof cpMessages !== "undefined" && cpMessages.length) covers.push("Fox - Architect consult");
  if (typeof discState !== "undefined" && discState.run) covers.push("discovery drafts");
  out.push("**Covers:** " + (covers.length ? covers.join(" · ") : "nothing yet — use the tools above to build the design") + ".");
  out.push("");

  /* 1 — deployment plan */
  out.push("## 1. Deployment plan");
  out.push("");
  if (dpState.done) {
    const sc = dpScore(), a = dpState.a;
    const stack = dpStack(), risks = dpRiskList().all || [];
    out.push(`**${escMd(a.system || "Untitled system")}** — ${dpLabel("domain", a.domain)} domain, ` +
      `${dpLabel("criticality", a.criticality)} criticality, autonomy L${a.autonomy}, blast radius: ${a.blast}.`);
    out.push("");
    out.push(`Readiness: **${sc.overall}/100 (${sc.band[0]})**`);
    out.push("");
    out.push("| Dimension | Score | Grade | Weight |");
    out.push("| --- | --- | --- | --- |");
    sc.dims.forEach(d => out.push(`| ${escMd(d.title)} | ${d.score} | ${dpGrade(d.score)} | ${d.weight} |`));
    out.push("");
    out.push("**Recommended stack**");
    out.push("");
    stack.forEach(s => out.push(`- _${escMd(s.layer)}:_ ${escMd(s.name)} — ${escMd(s.why)}`));
    out.push("");
    out.push(`**Risk register:** ${risks.length} entries, top exposures:`);
    out.push("");
    risks.slice(0, 5).forEach(r => out.push(`- ${escMd(r.title)} (${r.sev}/${r.lik}, ${r.exposure})`));
    out.push("");
    out.push(F + "markdown");
    out.push(dpAdrMarkdown());
    out.push(F);
  } else {
    out.push("_Intake not completed — open the Deployment Planner and answer the 4-step intake to fill this section._");
  }
  out.push("");

  /* 2 — reference architecture */
  out.push("## 2. Reference architecture");
  out.push("");
  if (bpState.comps.length) {
    out.push(F + "markdown");
    out.push(bpMarkdown());
    out.push(F);
  } else {
    out.push("_No blueprint yet — build one in the Blueprints tab to fill this section._");
  }
  out.push("");

  /* 3 — guardrail analyses (iteration 106) */
  out.push("## 3. Guardrail analyses");
  out.push("");
  const guards = (typeof guardState !== "undefined" && guardState.items) ? guardState.items : [];
  if (guards.length) {
    guards.forEach(g => {
      out.push(`### ${escMd(g.title)}`);
      out.push("");
      out.push(`_${escMd(g.meta.domain)} · risk ${g.meta.riskScore}/100 (${escMd(g.meta.tier)}) · ${g.controls.length} controls · ${(g.cascadeRules || []).length} cascade rules_`);
      out.push("");
      out.push("| Control | Layer | Mode | Why |");
      out.push("| --- | --- | --- | --- |");
      (g.controls || []).forEach(c => out.push(`| ${escMd(c.name)} | ${escMd(c.layer)} | ${escMd(c.mode)} | ${escMd(c.why)} |`));
      out.push("");
      if ((g.cascadeRules || []).length) {
        out.push("**Cascade-aware rules** — each cites the catalog cascade it breaks:");
        out.push("");
        (g.cascadeRules || []).forEach(r => {
          out.push(`- **${escMd(r.name)}** (\`${escMd(r.cas)}\`, ${escMd(r.cls)}) — ${escMd(r.impact)} impact, ${escMd(r.likelihood)} likely`);
        });
        out.push("");
      }
      if (g.mockRun && g.mockRun.data) {
        out.push("**Mock run** — " + escMd(g.mockRun.data.attackOutcome) + "; " +
          escMd(g.mockRun.data.legitimateOutcome) + "; contained in " + escMd(g.mockRun.data.timeToContain) +
          "; " + g.mockRun.data.approvals + " human approval(s).");
        out.push("");
      }
    });
  } else {
    out.push("_No guardrail analyses yet — run the Guardrail Lab to turn an agent idea into a control design._");
  }
  out.push("");

  /* 4 — cascade mitigation backlog (iteration 106) */
  out.push("## 4. Cascade mitigation backlog");
  out.push("");
  const mit = rpMitigationRows();
  if (mit.length) {
    out.push("De-duplicated controls across every catalogued cascade, ranked by leverage. Owners and status are the team's own tracking.");
    out.push("");
    out.push("| Control | Function | Priority | Cascades | Owner | Status |");
    out.push("| --- | --- | --- | --- | --- | --- |");
    mit.slice(0, 40).forEach(r => {
      out.push(`| ${escMd(String(r.control || "—"))} | ${escMd(String(r.function || "—"))} | ${escMd(String(r.priority || "—"))} | ${r.cascades} | ${escMd(String(r.owner || "—"))} | ${escMd(String(r.status || "—"))} |`);
    });
    if (mit.length > 40) { out.push(""); out.push("_" + (mit.length - 40) + " further controls omitted — export the full backlog as CSV from the Cascades tab._"); }
    out.push("");
  } else {
    out.push("_No mitigation backlog yet — open Cascades → Mitigation planner to build one._");
  }
  out.push("");

  /* 5 — working set (iteration 106) */
  out.push("## 5. Working set");
  out.push("");
  const pins = (typeof pinState !== "undefined") ? pinState : { patterns: [], scenarios: [], cascades: [] };
  const pinCount = pins.patterns.length + pins.scenarios.length + pins.cascades.length;
  if (pinCount) {
    const group = (ids, kind, label) => {
      if (!ids.length) return;
      out.push("**" + label + "**");
      out.push("");
      ids.forEach(id => {
        let name = id;
        try {
          if (kind === "patterns") {
            const p = (DATA.patterns.patterns || []).find(x => x.id === id);
            if (p) name = p.name;
          } else if (kind === "scenarios") {
            const s = (DATA.scenarios.scenarios || []).find(x => x.id === id);
            if (s) name = s.title;
          } else {
            const c = (DATA.cascades.cascades || []).find(x => x.id === id);
            if (c) name = c.name;
          }
        } catch (e) { /* catalog not loaded — keep the id */ }
        out.push(`- ${escMd(name)} \`${escMd(id)}\``);
      });
      out.push("");
    };
    group(pins.patterns, "patterns", "Patterns");
    group(pins.scenarios, "scenarios", "Scenarios");
    group(pins.cascades, "cascades", "Cascades");
  } else {
    out.push("_Nothing pinned yet — pin patterns, scenarios and cascades from any drawer to collect a working set._");
  }
  out.push("");

  /* 6 — discovery drafts (iteration 106) */
  out.push("## 6. Discovery drafts");
  out.push("");
  const run = (typeof discState !== "undefined" && discState.run) ? discState.run : null;
  const promoted = (typeof discDrafts === "function") ? discDrafts() : [];
  if (promoted.length) {
    out.push("_Drafts you promoted into catalog-shaped scenarios — review before they enter the catalog._");
    out.push("");
    out.push("| Draft | Domain | Severity | Vector | Description |");
    out.push("| --- | --- | --- | --- | --- |");
    promoted.forEach(d => {
      out.push(`| ${escMd(d.title)} | ${escMd(d.domain)} | ${escMd(d.severity)} | ${escMd(d.vector)} | ${escMd(String(d.description || "").slice(0, 180))} |`);
    });
    out.push("");
  }
  if (run && run.winners && run.winners.length) {
    out.push("_Drafts from the current Discovery Lab run — hypotheses for review, not catalog entries._");
    out.push("");
    out.push("| Draft | Domain | Class | Vector | Severity |");
    out.push("| --- | --- | --- | --- | --- |");
    run.winners.forEach(c => {
      out.push(`| ${escMd(c.title)} | ${escMd(c.domain)} | ${escMd(c.cls)} | ${escMd(c.vector)} | ${escMd(c.severity)} |`);
    });
    out.push("");
  }
  if (!promoted.length && !(run && run.winners && run.winners.length)) {
    out.push("_No discovery drafts yet — the Discovery Lab generates novel scenario candidates from the catalog's gaps._");
  }
  out.push("");

  /* 7 — copilot transcript */
  out.push("## 7. Fox - Architect consult");
  out.push("");
  const us = cpMessages.filter(m => m.role === "user");
  if (us.length) {
    cpMessages.forEach(m => {
      if (m.role === "user") { out.push("**Q —** " + escMd((m.content || "").slice(0, 400))); out.push(""); }
      else if (m.role === "assistant") { out.push("**A —** " + escMd((m.content || "").slice(0, 900))); out.push(""); }
    });
  } else {
    out.push("_No Fox - Architect conversation yet — ask Fox - Architect to stress-test the architecture._");
  }
  return out.join("\n");
}

function escMd(s) { return String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " "); }

function rpJson() {
  const j = {
    generated: new Date().toISOString(),
    app: "AI Agent Patterns & Guardrails",
    project: rpProjectName(),
    catalog: {
      patterns: (DATA.patterns.patterns || []).length,
      scenarios: (DATA.scenarios.scenarios || []).length,
      cascades: (DATA.cascades.cascades || []).length
    }
  };
  if (dpState.done) {
    const sc = dpScore();
    j.deployment = {
      intake: dpState.a,
      readiness: { overall: sc.overall, band: sc.band[0], dims: sc.dims.map(d => ({ title: d.title, score: d.score, weight: d.weight })) },
      stack: dpStack().map(s => ({ layer: s.layer, name: s.name, pattern: s.pat })),
      risks: (dpRiskList().all || []).map(r => ({ title: r.title, sev: r.sev, lik: r.lik, exposure: r.exposure, ref: r.ref || null, src: r.src || null })),
      adr: dpAdrMarkdown()
    };
  } else j.deployment = null;
  if (bpState.comps.length) {
    const c = bpCoverage(), est = bpEstimate(), tm = bpThreatModel();
    j.blueprint = {
      name: bpState.name || "Untitled",
      components: bpState.comps.map(id => { const p = bpPat(id); return { id: id, name: p ? p.name : id, role: p ? bpRoleOf(p) : "stage" }; }),
      coverage: { ok: c.ok, total: c.total, missing: c.rows.filter(r => !r.ok).map(r => r.label) },
      estimate: { costPerMonth: Math.round(est.cost.total), p50ms: est.lat.p50, p95ms: est.lat.p95, risk: est.risk.score, riskBand: est.risk.band[0], assumptions: bpState.est },
      threatModel: { index: tm.idx, band: tm.band[0], residual: tm.exp, ceiling: tm.max,
        scenarios: tm.scns.slice(0, 10).map(x => ({ id: x.s.id, title: x.s.title, severity: x.s.severity, defensesPresent: x.present, defensesNeeded: x.need })),
        cascades: tm.cas.slice(0, 10).map(x => ({ id: x.c.id, name: x.c.name, cls: x.c.cls, impact: x.c.impact })),
        unguardedHigh: tm.unguardedHigh },
      markdown: bpMarkdown()
    };
  } else j.blueprint = null;
  /* guardrail analyses (iteration 106) */
  const gs = (typeof guardState !== "undefined" && guardState.items) ? guardState.items : [];
  j.guardrails = gs.length ? gs.map(g => ({
    id: g.id, title: g.title, request: g.request, meta: g.meta,
    controls: g.controls, cascadeRules: (g.cascadeRules || []).map(r => ({ cas: r.cas, name: r.name, cls: r.cls, impact: r.impact, likelihood: r.likelihood })),
    mockRun: g.mockRun ? { verdict: g.mockRun.verdict, data: g.mockRun.data, metrics: g.mockRun.metrics } : null
  })) : null;
  /* mitigation backlog (iteration 106) */
  const mit = rpMitigationRows();
  j.mitigationBacklog = mit.length ? mit.map(r => ({
    control: r.control, function: r.function, priority: r.priority,
    score: r.score, cascades: r.cascades, owner: r.owner || null, status: r.status || null
  })) : null;
  /* working set (iteration 106) */
  const pins = (typeof pinState !== "undefined") ? pinState : { patterns: [], scenarios: [], cascades: [] };
  j.workingSet = (pins.patterns.length + pins.scenarios.length + pins.cascades.length)
    ? { patterns: pins.patterns.slice(), scenarios: pins.scenarios.slice(), cascades: pins.cascades.slice() } : null;
  /* discovery drafts (iteration 106) */
  const run = (typeof discState !== "undefined" && discState.run) ? discState.run : null;
  j.discovery = run && run.winners ? { winners: run.winners.map(c => ({ title: c.title, domain: c.domain, cls: c.cls, vector: c.vector, severity: c.severity })) } : null;
  j.copilot = cpMessages.length ? cpMessages.map(m => ({ role: m.role, content: m.content })) : null;
  return JSON.stringify(j, null, 2);
}

function rpDownload(kind) {
  if (!bpState.comps.length && !dpState.done && !cpMessages.length &&
      !(typeof guardState !== "undefined" && guardState.items.length) &&
      !rpMitigationRows().length) {
    showNotif("Nothing to report yet — run the planner, blueprint, guardrail lab or copilot first");
    return;
  }
  const isMd = kind === "md";
  const txt = isMd ? rpMarkdown() : rpJson();
  const blob = new Blob([txt], { type: isMd ? "text/markdown" : "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "architect-report-" + rpWhen() + (isMd ? ".md" : ".json");
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  /* remember that the report went out, so the Deliver stage can show it */
  try {
    const n = parseInt(localStorage.getItem("aap.reported.v1") || "0", 10) || 0;
    localStorage.setItem("aap.reported.v1", String(n + 1));
  } catch (e) { /* storage unavailable — the stage just stays "active" */ }
  if (typeof wfPaintRail === "function") wfPaintRail();
  if (typeof dashRender === "function") dashRender();
  showNotif(isMd ? "Report downloaded (Markdown)" : "Report downloaded (JSON)");
}

/* print: a dedicated, self-contained page — no app chrome, no JS needed */
function rpPrint() {
  if (!bpState.comps.length && !dpState.done && !cpMessages.length &&
      !(typeof guardState !== "undefined" && guardState.items.length) &&
      !rpMitigationRows().length) {
    showNotif("Nothing to report yet — run the planner, blueprint, guardrail lab or copilot first");
    return;
  }
  const w = window.open("", "_blank");
  if (!w) { showNotif("Popup blocked — allow popups to print the report"); return; }
  const md = rpMarkdown();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Architect report — ${escHtml(rpProjectName())} — ${rpWhen()}</title><style>
    body{font:13.5px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328;max-width:860px;margin:36px auto;padding:0 24px}
    h1{font-size:22px;border-bottom:2px solid #d0d7de;padding-bottom:8px}
    h2{font-size:17px;margin-top:26px;border-bottom:1px solid #d0d7de;padding-bottom:4px}
    h3{font-size:14px;margin-top:18px}
    table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12px}
    th,td{border:1px solid #d0d7de;padding:5px 9px;text-align:left}
    th{background:#f6f8fa}
    code,pre{background:#f6f8fa;border-radius:4px}
    code{padding:1px 5px;font-size:12px}
    pre{padding:12px;overflow:auto;border:1px solid #d0d7de;font-size:11.5px;line-height:1.5}
    blockquote{border-left:3px solid #d0d7de;margin:0;padding:2px 14px;color:#57606a}
    em{color:#57606a}
    @media print{body{margin:0}}
  </style></head><body>${rpHtml(md)}</body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 350);
}

/* minimal markdown -> HTML for the print view (headers, tables, fences,
   bold/italic/code, lists, blockquotes — everything rpMarkdown emits) */
function rpHtml(md) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = s => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\\\|/g, "|");
  const lines = md.split("\n");
  const html = [];
  let inFence = false, fence = [], listOpen = false, tbl = null;
  const closeList = () => { if (listOpen) { html.push("</ul>"); listOpen = false; } };
  const flushTable = () => {
    if (!tbl) return;
    html.push("<table><thead><tr>" + tbl.head.map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>" +
      tbl.rows.map(r => "<tr>" + r.map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table>");
    tbl = null;
  };
  lines.forEach(l => {
    if (l.startsWith("```")) {
      if (inFence) { html.push("<pre>" + esc(fence.join("\n")) + "</pre>"); fence = []; inFence = false; }
      else { closeList(); flushTable(); inFence = true; }
      return;
    }
    if (inFence) { fence.push(l); return; }
    const cells = l.split("|");
    if (l.startsWith("|") && l.endsWith("|") && cells.length > 2) {
      const row = cells.slice(1, -1).map(c => c.trim());
      if (row.every(c => /^:?-{2,}:?$/.test(c))) return; /* separator */
      if (!tbl) tbl = { head: row, rows: [] }; else tbl.rows.push(row);
      closeList();
      return;
    }
    flushTable();
    if (/^#{1,3} /.test(l)) { closeList(); const m = l.match(/^(#{1,3}) (.+)$/); html.push("<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">"); }
    else if (/^[-*] /.test(l)) { if (!listOpen) { html.push("<ul>"); listOpen = true; } html.push("<li>" + inline(l.slice(2)) + "</li>"); }
    else if (l.startsWith("_") && l.endsWith("_") && l.length > 2) { closeList(); html.push("<blockquote>" + inline(l.slice(1, -1)) + "</blockquote>"); }
    else if (l.trim() === "") { closeList(); }
    else { closeList(); html.push("<p>" + inline(l) + "</p>"); }
  });
  if (inFence && fence.length) html.push("<pre>" + esc(fence.join("\n")) + "</pre>");
  closeList(); flushTable();
  return html.join("\n");
}
