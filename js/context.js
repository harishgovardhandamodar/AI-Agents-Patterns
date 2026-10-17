/* context.js — grounded retrieval for the Architect Copilot.
   Builds a compact, authoritative context block from the catalog for a query,
   so the local model answers from real catalog items (and can cite them).

   Exports global `AIContext` with:
     build(query, scope)  -> { text, cites, hits }
     answer(query, ctx, scope) -> { text, cites }   (deterministic fallback)
     brief()              -> one-line catalog summary

   Cascades are indexed when DATA.cascades is present (added in a later step);
   everything degrades cleanly if it is not. */

"use strict";

const AIContext = (function () {
  const STOP = new Set(("the a an and or of to for with in on at is are be can could should would will do does " +
    "how what which who when where why my our we i you your it its this that these those from as by not no if then " +
    "than so using use user users into over under about any all some more most other such only own same too very " +
    "please tell give show help need want").split(" "));

  let IDX = null;
  let IDX_LEN = -1;

  function terms(s) {
    return String(s == null ? "" : s).toLowerCase().split(/[^a-z0-9$.+-]+/)
      .filter(function (t) { return t.length > 1 && !STOP.has(t); });
  }
  function squash(s, n) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function arrStr(a, n) { return (Array.isArray(a) ? a : []).slice(0, n).join("; "); }

  function patText(p) {
    return [p.name, p.cat, p.summary, arrStr(p.how, 4), arrStr(p.components, 6),
      (p.failures || []).map(function (f) { return f.n + " " + f.d; }).join(" "),
      arrStr(p.protections, 4), arrStr(p.domains, 5), arrStr(p.related, 5)].join(" ");
  }
  function scnText(s) {
    return [s.title, s.domain, s.severity, s.vector, s.description, arrStr(s.attackChain, 8),
      arrStr(s.protections, 6), arrStr(s.detection, 4), arrStr(s.response, 4), arrStr(s.patternRefs, 8)].join(" ");
  }
  function trcText(t) {
    return [t.name, t.verdict, t.summary, (t.steps || []).map(function (x) { return x.label || x.desc || ""; }).join(" ")].join(" ");
  }
  function casText(c) {
    return [c.name, c.cls, c.domain, c.trigger, c.summary, arrStr(c.path, 10),
      arrStr(c.amplifiers, 6), arrStr(c.mitigations && c.mitigations.prevent, 6)].join(" ");
  }

  function ensureIndex() {
    const len = (DATA.patterns ? 1 : 0) + (DATA.scenarios ? 1 : 0) + (DATA.traces ? 1 : 0) + (DATA.cascades ? 1 : 0);
    if (IDX && len === IDX_LEN) return IDX;
    IDX = { patterns: [], scenarios: [], traces: [], cascades: [], base: {} };
    IDX_LEN = len;
    if (DATA.patterns) {
      IDX.base = DATA.patterns;
      IDX.patterns = DATA.patterns.patterns.map(function (p) { return { id: p.id, name: p.name, text: patText(p), raw: p }; });
    }
    if (DATA.scenarios) IDX.scenarios = DATA.scenarios.scenarios.map(function (s) { return { id: s.id, name: s.title, text: scnText(s), raw: s }; });
    if (DATA.traces) IDX.traces = DATA.traces.traces.map(function (t) { return { id: t.id, name: t.name, text: trcText(t), raw: t }; });
    if (DATA.cascades) IDX.cascades = (DATA.cascades.cascades || []).map(function (c) { return { id: c.id, name: c.name, text: casText(c), raw: c }; });
    return IDX;
  }

  /* Very small TF-IDF-ish ranker: term overlap weighted by rarity. */
  function rank(items, qtokens, n) {
    if (!qtokens.length) return [];
    const df = {};
    qtokens.forEach(function (t) { df[t] = 0; });
    const scored = items.map(function (it) {
      const toks = terms(it.text);
      const tf = {};
      toks.forEach(function (t) { if (df[t] !== undefined) tf[t] = (tf[t] || 0) + 1; });
      let score = 0;
      qtokens.forEach(function (t) {
        const dfx = df[t] != null ? df[t] : 0;
        // count document frequency lazily on first pass
      });
      return { it: it, tf: tf };
    });
    // document frequency across the candidate set (cheap, over the top items)
    qtokens.forEach(function (t) {
      let c = 0;
      scored.forEach(function (s) { if (s.tf[t]) c++; });
      df[t] = c;
    });
    scored.forEach(function (s) {
      qtokens.forEach(function (t) {
        if (!s.tf[t]) return;
        const idf = Math.log(1 + items.length / (1 + df[t]));
        s.score = (s.score || 0) + s.tf[t] * (1 + idf);
      });
      // name match bonus
      const nm = terms(s.it.name);
      qtokens.forEach(function (t) { if (nm.indexOf(t) >= 0) s.score = (s.score || 0) + 2.5; });
    });
    return scored.filter(function (s) { return s.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, n)
      .map(function (s) { return s.it; });
  }

  function brief() {
    const b = IDX && IDX.base;
    if (!b || !b.patterns) return "";
    const cats = {};
    b.patterns.forEach(function (p) { cats[p.cat] = (cats[p.cat] || 0) + 1; });
    const catStr = Object.keys(cats).sort().map(function (k) { return k + " (" + cats[k] + ")"; }).join(", ");
    return "Catalog: " + b.patterns.length + " patterns across categories [" + catStr + "]; " +
      (DATA.scenarios ? DATA.scenarios.scenarios.length + " threat scenarios; " : "") +
      (DATA.traces ? DATA.traces.traces.length + " traces; " : "") +
      (DATA.cascades ? (DATA.cascades.cascades || []).length + " cascade records; " : "");
  }

  function build(query, scope) {
    const idx = ensureIndex();
    scope = scope || { patterns: true, scenarios: true, cascades: true, traces: true };
    const qt = terms(query);
    const hits = {};
    if (scope.patterns) hits.patterns = rank(idx.patterns, qt, 7);
    if (scope.scenarios) hits.scenarios = rank(idx.scenarios, qt, 6);
    if (scope.cascades) hits.cascades = rank(idx.cascades, qt, 8);
    if (scope.traces) hits.traces = rank(idx.traces, qt, 3);

    const cites = [];
    const parts = [brief()];

    if (hits.patterns && hits.patterns.length) {
      parts.push("\nPATTERNS (most relevant):");
      hits.patterns.forEach(function (h) {
        const p = h.raw;
        parts.push("- [" + p.cat + "] " + p.name + " — " + squash(p.summary, 190) +
          " | failures: " + squash((p.failures || []).map(function (f) { return f.n + " (" + f.sev + ")"; }).join(", "), 150) +
          " | protections: " + squash(arrStr(p.protections, 4), 170));
        cites.push({ kind: "pattern", id: p.id, label: "◆ " + p.name });
      });
    }
    if (hits.scenarios && hits.scenarios.length) {
      parts.push("\nSCENARIOS (most relevant):");
      hits.scenarios.forEach(function (h) {
        const s = h.raw;
        parts.push("- [" + s.domain + "/" + s.severity + "] " + s.title + " — vector: " + s.vector +
          " | chain: " + squash(arrStr(s.attackChain, 5), 220) +
          " | protects: " + squash(arrStr(s.protections, 4), 170));
        cites.push({ kind: "scenario", id: s.id, label: "⚠ " + squash(s.title, 42) });
      });
    }
    if (hits.cascades && hits.cascades.length) {
      parts.push("\nCASCADES (most relevant):");
      hits.cascades.forEach(function (h) {
        const c = h.raw;
        parts.push("- [" + c.cls + "/" + (c.domain || "") + "] " + c.name + " — trigger: " + squash(c.trigger, 120) +
          " | path: " + squash(arrStr(c.path, 6), 200) +
          " | prevent: " + squash(arrStr(c.mitigations && c.mitigations.prevent, 3), 150));
        cites.push({ kind: "cascade", id: c.id, label: "⧉ " + squash(c.name, 40) });
      });
    }
    if (hits.traces && hits.traces.length) {
      parts.push("\nTRACES (replayable evidence):");
      hits.traces.forEach(function (h) {
        const t = h.raw;
        parts.push("- " + t.name + " — verdict " + t.verdict + "; " + squash(t.summary, 180));
        cites.push({ kind: "trace", id: t.id, label: "▶ " + squash(t.name, 38) });
      });
    }

    let text = parts.join("\n");
    if (text.length > 7000) text = text.slice(0, 7000) + "\n…(truncated)";
    return { text: text, cites: cites, hits: hits };
  }

  /* Deterministic fallback answer, composed locally from the same retrieval.
     Used when no model backend is reachable, and as the offline "cascade lens":
     inherent failures come from matched patterns, derived chains from matched
     scenario attack chains, emergent risk from interaction-heavy categories,
     cascading risk from domains that recur across matched scenarios. */
  function uniqPush(dst, src, n) {
    (src || []).forEach(function (v) { if (v && dst.indexOf(v) < 0 && dst.length < n) dst.push(v); });
  }
  function answer(query, ctx, scope) {
    ctx = ctx || build(query, scope);
    const h = ctx.hits || {};
    const pats = (h.patterns || []).map(function (x) { return x.raw; });
    const scns = (h.scenarios || []).map(function (x) { return x.raw; });
    const cites = [];
    const L = [];

    L.push("**Answered locally** — no model backend is reachable, so this is composed " +
      "deterministically from the catalog. Start Fox-Services (or bring **axiom** online) " +
      "for a tailored, conversational answer.\n");

    if (!pats.length && !scns.length) {
      L.push("_No catalog items matched your wording._ Try naming a **domain** (finance, healthcare, " +
        "devops, support, procurement), a **risk** (prompt injection, spend, memory poisoning, retry storm, " +
        "data exfiltration) or an **autonomy level**.");
      return { text: L.join("\n"), cites: cites };
    }

    L.push("### What to plan for");
    const headline = [];
    if (pats[0]) headline.push("adopt **" + pats[0].name + "** (" + pats[0].cat + ")");
    if (scns[0]) headline.push("rehearse **" + squash(scns[0].title, 70) + "**");
    L.push("For this request, the closest catalog precedent suggests you " + headline.join(" and ") + ".\n");

    if (pats.length) {
      L.push("### Patterns to adopt");
      pats.slice(0, 5).forEach(function (p) {
        L.push("- **" + p.name + "** — " + squash(p.summary, 180));
        if (p.protections && p.protections.length) L.push("  - _buys you:_ " + squash(arrStr(p.protections, 3), 160));
        cites.push({ kind: "pattern", id: p.id, label: "◆ " + p.name });
      });
    }

    // ---- four-class cascade lens ----
    L.push("\n### Cascade lens");
    const inherent = [];
    pats.slice(0, 5).forEach(function (p) { (p.failures || []).forEach(function (f) { uniqPush(inherent, [f.n + " (" + f.sev + ")"], 6); }); });
    L.push("**Inherent** — failure modes that live in a component itself: " +
      (inherent.length ? inherent.join(", ") : "none surfaced from the matched patterns") + ".");

    const derived = [];
    scns.slice(0, 3).forEach(function (s) { if (s.attackChain && s.attackChain.length) derived.push(squash(s.attackChain.join(" → "), 190)); });
    L.push("**Derived** — the necessary consequence chains to break early: " +
      (derived.length ? "\n  - " + derived.join("\n  - ") : "no multi-step chain matched — inspect the Scenarios tab."));

    const interCat = { multiagent: 1, loop: 1, workflow: 1, planning: 1 };
    const emergent = pats.filter(function (p) { return interCat[p.cat] && (p.components || []).length >= 2; })
      .map(function (p) { return p.name; });
    L.push("**Emergent** — risks that arise only from how parts interact (watch loop/iteration caps, bulkheads, contract tests): " +
      (emergent.length ? emergent.join(", ") : "no interaction-heavy pattern matched — likely a single-agent design."));

    const domCount = {};
    scns.forEach(function (s) { domCount[s.domain] = (domCount[s.domain] || 0) + 1; });
    const hot = Object.keys(domCount).filter(function (d) { return domCount[d] >= 2; });
    const cross = pats.filter(function (p) { return (p.domains || []).length >= 3; }).map(function (p) { return p.name; });
    L.push("**Cascading** — where a local failure can spread: " +
      (hot.length ? "domains with correlated exposure: **" + hot.map(function (d) { return d + " ×" + domCount[d]; }).join(", ") + "**. " : "") +
      (cross.length ? "Cross-domain patterns to isolate behind bulkheads: " + squash(cross.join(", "), 160) + "." : (hot.length ? "" : "Add per-tenant isolation and rate/queue caps as default policy.")));

    if (scns.length) {
      L.push("\n### Threat scenarios to rehearse");
      scns.slice(0, 4).forEach(function (s) {
        L.push("- **" + s.title + "** _(" + s.domain + "/" + s.severity + ", likelihood " + s.likelihood + ")_ — vector: " + s.vector);
        cites.push({ kind: "scenario", id: s.id, label: "⚠ " + squash(s.title, 40) });
      });
    }

    // ---- mitigation checklist ----
    const prev = [], det = [], con = [];
    pats.forEach(function (p) { uniqPush(prev, p.protections, 7); });
    scns.forEach(function (s) { uniqPush(prev, s.protections, 7); uniqPush(det, s.detection, 6); uniqPush(con, s.response, 6); });
    L.push("\n### Mitigation checklist (prevent · detect · contain/recover)");
    L.push("- **Prevent:** " + (prev.length ? prev.join("; ") : "least privilege, schema-locked tools, confirm-before-irreversible"));
    L.push("- **Detect:** " + (det.length ? det.join("; ") : "tracing, cost/rate alarms, egress monitoring, canary tokens"));
    L.push("- **Contain / recover:** " + (con.length ? con.join("; ") : "kill switch, per-tenant bulkheads, rollback + reconciliation"));

    const trc = (h.traces || []);
    if (trc.length) {
      L.push("\n### Replay to verify");
      trc.forEach(function (t) {
        L.push("- **" + t.raw.name + "** — verdict _" + t.raw.verdict + "_");
        cites.push({ kind: "trace", id: t.raw.id, label: "▶ " + squash(t.raw.name, 38) });
      });
    }

    L.push("\n---\n_grounded in " + pats.length + " patterns · " + scns.length + " scenarios · " + trc.length + " traces (0 model tokens)_");
    return { text: L.join("\n"), cites: cites };
  }

  return { build: build, answer: answer, brief: brief, terms: terms };
})();
