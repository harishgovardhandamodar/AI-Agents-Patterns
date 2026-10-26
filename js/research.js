/* js/research.js — the Research Graphs tab: self-learning agents and
 * reinforcement learning as interlinked knowledge graphs, plus the research
 * collectors (curated trails + the scripts that keep the graphs fresh).
 *
 * Data (lazy-loaded on first visit, so the boot path never waits on it):
 *   data/sl_landscape.json        vendored snapshot of the sibling lab's
 *                                 reference/landscape.json (51 works)
 *   data/rl_landscape.json        the RL graph, curated in-repo (35 works)
 *   data/research_collectors.json reading trails + collector definitions
 *
 * Interlinks are structural, not decorative: five concept ids are shared
 * between the graphs (credit-assignment, memory-policy-learning,
 * experience-evolution, continual-learning, verifier-feedback), RL works
 * carry sl_links into the SL graph and rl_links inside their own, and the
 * trails address works as rl:<id> / sl:<id>. tools/collect_research.py
 * validates every one of those references; npm test enforces it in CI.
 */
"use strict";

/* ---------------- state ---------------- */
const researchState = {
  data: null,          /* { sl, rl, col } once fetched */
  loadError: null,
  view: "sl",          /* sl | rl | graph | trails */
  q: "",
  kind: "all",
  concept: "all",
  sel: null,           /* selected work id within the current graph */
  g: { ds: "both", internal: true, cross: true, hubs: true, x: 0, y: 0, k: 1 },
  booted: false
};

function rsGraphs() { return researchState.data; }

/* ---------------- loading ---------------- */
function rsFetchAll() {
  const get = function (p) {
    return fetch(p).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + p);
      return res.json();
    });
  };
  return Promise.all([
    get("data/sl_landscape.json"),
    get("data/rl_landscape.json"),
    get("data/research_collectors.json")
  ]).then(function (parts) {
    researchState.data = { sl: parts[0], rl: parts[1], col: parts[2] };
    return researchState.data;
  });
}

/* ---------------- helpers over the graphs ---------------- */
function rsWorks(graph) {
  const g = researchState.data ? researchState.data[graph] : null;
  return (g && g.works) || [];
}
function rsConcepts(graph) {
  const g = researchState.data ? researchState.data[graph] : null;
  return (g && g.concepts) || [];
}
function rsFind(graph, id) {
  return rsWorks(graph).filter(function (w) { return w.id === id; })[0] || null;
}
function rsKinds(graph) {
  const seen = {};
  rsWorks(graph).forEach(function (w) { seen[w.kind || "paper"] = true; });
  return ["all"].concat(Object.keys(seen).sort());
}
/* concept ids present in both graphs: the native interlinks */
function rsSharedConcepts() {
  if (!researchState.data) return [];
  const a = {};
  rsConcepts("sl").forEach(function (c) { a[c.id] = c.label || c.id; });
  return rsConcepts("rl")
    .filter(function (c) { return a[c.id]; })
    .map(function (c) { return { id: c.id, label: c.label || c.id }; });
}
function rsMatchWork(w, q) {
  if (!q) return true;
  const hay = ((w.title || "") + " " + w.id + " " + (w.summary || "") + " " +
    (w.mechanism || "") + " " + (w.authors || "") + " " +
    (w.concepts || []).join(" ")).toLowerCase();
  return q.toLowerCase().split(/\s+/).every(function (tok) { return hay.indexOf(tok) >= 0; });
}
function rsFiltered(graph) {
  const st = researchState;
  return rsWorks(graph).filter(function (w) {
    if (st.kind !== "all" && (w.kind || "paper") !== st.kind) return false;
    if (st.concept !== "all" && (w.concepts || []).indexOf(st.concept) < 0) return false;
    return rsMatchWork(w, st.q);
  });
}
/* inbound links: RL works pointing at this node (used on both graphs) */
function rsInbound(graph, id) {
  if (!researchState.data) return [];
  if (graph === "sl") {
    return researchState.data.rl.works.filter(function (w) {
      return (w.sl_links || []).indexOf(id) >= 0;
    }).map(function (w) { return { graph: "rl", id: w.id, title: w.title }; });
  }
  return researchState.data.rl.works.filter(function (w) {
    return (w.rl_links || []).indexOf(id) >= 0;
  }).map(function (w) { return { graph: "rl", id: w.id, title: w.title }; });
}

/* ---------------- actions (data-act targets) ---------------- */
function rsSetView(v) {
  researchState.view = v;
  researchState.sel = null;
  renderResearch();
}
function rsSetQ(v) { researchState.q = v || ""; researchState.sel = null; researchState._refocus = true; renderResearch(); }
function rsSetKind(v) { researchState.kind = v || "all"; researchState.sel = null; renderResearch(); }
function rsSetConcept(v) { researchState.concept = v || "all"; researchState.sel = null; renderResearch(); }
function rsReset() {
  researchState.q = ""; researchState.kind = "all"; researchState.concept = "all";
  researchState.sel = null; renderResearch();
}
function rsSelect(graph, id) {
  researchState.view = graph;
  researchState.sel = id;
  renderResearch();
  setTimeout(function () {
    const t = el("rsDetail");
    if (t && t.scrollIntoView) { try { t.scrollIntoView({ block: "nearest" }); } catch (e) {} }
  }, 60);
}
/* cross-graph jump: switch graph, select the node */
function rsJump(graph, id) {
  researchState.view = graph;
  researchState.q = ""; researchState.kind = "all"; researchState.concept = "all";
  researchState.sel = id;
  renderResearch();
  setTimeout(function () {
    const t = el("rsDetail");
    if (t && t.scrollIntoView) { try { t.scrollIntoView({ block: "nearest" }); } catch (e) {} }
  }, 60);
}
function rsBack() { researchState.sel = null; renderResearch(); }
function rsCopyCmd(cmd) {
  const done = function () { if (typeof showNotif === "function") showNotif("Copied: " + cmd); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).then(done, done);
    } else { done(); }
  } catch (e) { done(); }
}

/* ---------------- rendering ---------------- */
function rsKindChip(kind) {
  const cls = kind === "paper" ? "" : (kind === "benchmark" ? "ok" : (kind === "framework" || kind === "product" ? "warn" : "bad"));
  return '<span class="chip ' + cls + '">' + escHtml(kind || "paper") + "</span>";
}

function rsWorkCard(graph, w) {
  const links = ((w.sl_links || []).length + (w.rl_links || []).length);
  const active = researchState.sel === w.id ? ' style="border-color:var(--accent)"' : "";
  return '<div class="card"' + active + ' data-act="rsSelect" data-args="' + dataArgs(graph, w.id) +
    '" data-keys="Enter, " role="button" tabindex="0" aria-label="' + escHtml(w.title || w.id) + '">' +
    '<div class="card-t">' + escHtml(w.title || w.id) + "</div>" +
    '<div class="card-sub">' + rsKindChip(w.kind) + ' <span class="muted small">' + escHtml(w.year || "") +
    " · " + escHtml(w.venue || "") + "</span></div>" +
    '<p class="muted small" style="margin:6px 0">' + escHtml(w.summary || "") + "</p>" +
    '<div class="muted small">' + (w.concepts || []).slice(0, 4).map(function (c) {
      return '<span class="chip">' + escHtml(c) + "</span>";
    }).join(" ") + (links ? ' <span class="chip ok">⛓ ' + links + " links</span>" : "") +
    (w.needs_review ? ' <span class="chip bad">needs review</span>' : "") + "</div></div>";
}

function rsAlignTable(w) {
  const entries = Object.keys(w.align || {}).map(function (k) {
    return "<tr><td><b>" + escHtml(k) + "</b></td><td>" + escHtml(w.align[k]) + "</td></tr>";
  }).join("");
  return entries ? '<table class="tbl"><tbody>' + entries + "</tbody></table>" : '<p class="muted small">No alignment recorded (staged draft).</p>';
}

function rsLinkBtns(graph, ids) {
  return (ids || []).map(function (id) {
    const t = rsFind(graph, id);
    const label = t ? (t.title || id) : id;
    return '<button class="btn sm ghost" data-act="rsJump" data-args="' + dataArgs(graph, id) + '"' +
      (t ? "" : " disabled") + ">" + escHtml(graph === "sl" ? "sl:" : "rl:") + escHtml(id) +
      (t ? ' <span class="muted small">— ' + escHtml(String(label).slice(0, 60)) + "</span>" : " (missing)") + "</button>";
  }).join(" ");
}

function rsDetailHtml(graph, w) {
  const inbound = rsInbound(graph, w.id);
  const concepts = (w.concepts || []).map(function (c) {
    return '<button class="btn sm ghost" data-act="rsSetConcept" data-args="' + dataArgs(c) + '">' + escHtml(c) + "</button>";
  }).join(" ");
  const pats = (w.patterns || []).map(function (p) {
    return '<button class="btn sm ghost" data-act="openPattern" data-args="' + dataArgs(p) + '">' + escHtml(p) + "</button>";
  }).join(" ") || '<span class="muted small">none</span>';
  return '<div class="panel" id="rsDetail" style="margin-top:12px">' +
    '<div class="bt-head"><div><h3 style="margin:0">' + escHtml(w.title || w.id) + "</h3>" +
    '<p class="muted small" style="margin:4px 0">' + rsKindChip(w.kind) + " " + escHtml(w.authors || "") +
    " · " + escHtml(w.venue || "") + " · " + escHtml(w.year || "") +
    (w.url ? ' · <a href="' + escHtml(w.url) + '" target="_blank" rel="noopener">source ↗</a>' : "") + "</p></div>" +
    '<div class="bt-head-btns"><button class="btn sm" data-act="rsBack">← Back to list</button></div></div>' +
    '<p style="margin:8px 0">' + escHtml(w.summary || "") + "</p>" +
    '<p class="muted small" style="margin:8px 0"><b>Mechanism.</b> ' + escHtml(w.mechanism || "—") + "</p>" +
    '<div class="ov-grid" style="grid-template-columns:1fr 1fr"><div><h4>Alignment</h4>' + rsAlignTable(w) + "</div>" +
    "<div><h4>Concepts</h4><p>" + (concepts || '<span class="muted small">none</span>') + "</p>" +
    "<h4>Catalog patterns</h4><p>" + pats + "</p></div></div>" +
    (graph === "rl"
      ? "<h4>Outbound links</h4><p><b>Self-learning:</b> " + (rsLinkBtns("sl", w.sl_links) || '<span class="muted small">none</span>') +
        "</p><p><b>RL builds-on:</b> " + (rsLinkBtns("rl", w.rl_links) || '<span class="muted small">none</span>') + "</p>"
      : "<h4>Linked from the RL graph</h4><p>" + (inbound.map(function (l) {
        return '<button class="btn sm ghost" data-act="rsJump" data-args="' + dataArgs("rl", l.id) + '">rl:' + escHtml(l.id) + "</button>";
      }).join(" ") || '<span class="muted small">no inbound RL links</span>') + "</p>") +
    "<h4>Cited by RL works</h4><p>" + (inbound.length && graph === "rl" ? inbound.map(function (l) {
      return '<button class="btn sm ghost" data-act="rsJump" data-args="' + dataArgs("rl", l.id) + '">rl:' + escHtml(l.id) + "</button>";
    }).join(" ") : '<span class="muted small">' + (graph === "rl" ? (inbound.length ? "" : "no inbound links — a root node") : "see above") + "</span>") + "</p></div>";
}

function rsGraphPane(graph, title, blurb) {
  const st = researchState;
  const list = rsFiltered(graph);
  const kinds = rsKinds(graph).map(function (k) {
    return '<option value="' + escHtml(k) + '"' + (st.kind === k ? " selected" : "") + ">" + (k === "all" ? "all kinds" : escHtml(k)) + "</option>";
  }).join("");
  const concepts = ['<option value="all">all concepts</option>'].concat(rsConcepts(graph).map(function (c) {
    return '<option value="' + escHtml(c.id) + '"' + (st.concept === c.id ? " selected" : "") + ">" + escHtml(c.label || c.id) + "</option>";
  })).join("");
  const sel = st.sel ? rsFind(graph, st.sel) : null;
  return '<div class="split"><aside class="side">' +
    '<input class="search" id="rsSearch" placeholder="Search works… (e.g. ppo, memory, verifier)" aria-label="Search works" data-input="rsSetQ" data-first="value" value="' + escHtml(st.q) + '">' +
    "<h4>Kind</h4>" +
    '<select class="search" style="width:100%" aria-label="Filter by kind" data-change="rsSetKind" data-first="value">' + kinds + "</select>" +
    "<h4>Concept</h4>" +
    '<select class="search" style="width:100%" aria-label="Filter by concept" data-change="rsSetConcept" data-first="value">' + concepts + "</select>" +
    '<div style="margin-top:10px"><button class="btn" data-act="rsReset">Reset filters</button></div>' +
    '<h4>About</h4><p class="muted small" style="padding:0 6px">' + escHtml(blurb) + "</p></aside>" +
    '<div class="main"><div class="sticky-bar" style="display:flex;align-items:center;margin-bottom:10px;gap:8px">' +
    '<span class="muted small">' + list.length + " / " + rsWorks(graph).length + " works</span><div style=\"flex:1\"></div>" +
    (st.sel ? '<button class="btn sm" data-act="rsBack">← Back to list</button>' : "") + "</div>" +
    (sel ? rsDetailHtml(graph, sel)
      : '<div class="card-grid">' + list.map(function (w) { return rsWorkCard(graph, w); }).join("") + "</div>") +
    "</div></div>";
}

function rsTrailsPane() {
  const col = researchState.data.col;
  const trails = (col.trails || []).map(function (t) {
    const chips = (t.works || []).map(function (ref) {
      const slash = ref.indexOf(":");
      const g = ref.slice(0, slash), id = ref.slice(slash + 1);
      const w = g === "rl" ? rsFind("rl", id) : rsFind("sl", id);
      return '<button class="btn sm ghost" data-act="rsJump" data-args="' + dataArgs(g, id) + '"' +
        (w ? "" : " disabled") + ">" + escHtml(ref) + "</button>";
    }).join(" ");
    return '<div class="panel" style="margin-bottom:12px"><h3>' + escHtml(t.label) +
      ' <span class="muted small">' + escHtml(t.scope) + " · " + (t.works || []).length + " works</span></h3>" +
      '<p class="muted small" style="margin:4px 0 8px">' + escHtml(t.blurb || "") + "</p><p>" + chips + "</p></div>";
  }).join("");
  const collectors = (col.collectors || []).map(function (c) {
    return "<tr><td><b>" + escHtml(c.label) + "</b><br><span class=\"muted small\">" + escHtml(c.kind) +
      " · " + escHtml(c.scope) + " · " + escHtml(c.schedule || "") + "</span></td>" +
      "<td><span class=\"mono small\">" + escHtml(c.tool || "") + "</span><br><span class=\"muted small\">" +
      escHtml((c.sources || []).join("; ")) + " → " + escHtml((c.outputs || []).join("; ")) + "</span></td>" +
      '<td><span class="chip ok">' + escHtml(c.status || "") + '</span><br>' +
      '<button class="btn sm ghost" style="margin-top:4px" data-act="rsCopyCmd" data-args="' + dataArgs(c.tool || "") + '">copy cmd</button></td></tr>';
  }).join("");
  return '<div class="panel" style="margin-bottom:12px"><h3>Reading trails <span class="muted small">curated entry points — click any work to open it in its graph</span></h3></div>' +
    trails +
    '<div class="panel"><h3>Collectors <span class="muted small">scripts that keep the graphs fresh — human-gated, never silent</span></h3>' +
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Collector</th><th>Command &amp; flow</th><th>Status</th></tr></thead>' +
    "<tbody>" + collectors + "</tbody></table></div>" +
    '<p class="muted small" style="margin:8px 0 0">Every reference above is validated by <span class="mono">python3 tools/collect_research.py validate</span> and by <span class="mono">npm test</span> in CI. The arXiv watch stages candidates into <span class="mono">exports/research_inbox.json</span>; nothing enters a graph without a human edit.</p></div>';
}

/* ---------------- knowledge-graph view ----------------
   An SVG force-layout of the same data the lists show: work nodes, builds-on
   edges (rl_links, solid), cross-graph edges (sl_links, dashed) and hub nodes
   for the five shared concepts (dotted). Layout is deterministic (fixed seed
   order, fixed iteration count) so every render of the same node set lands in
   the same place. Pan/zoom only touch the <g> transform — never a re-render —
   so the viewport survives; node clicks paint only the detail div. */
const RS_GW = 1000, RS_GH = 560;
const RS_GHUBS = ["credit-assignment", "memory-policy-learning", "experience-evolution",
  "continual-learning", "verifier-feedback"];

function rsGSetDS(ds) { researchState.g.ds = ds; researchState.sel = null; renderResearch(); }
function rsGToggle(on, key) {
  if (key === "internal" || key === "cross" || key === "hubs") researchState.g[key] = !!on;
  renderResearch();
}
function rsGShort(title, n) {
  const t = String(title || "");
  return escHtml(t.length > n ? t.slice(0, n - 1) + "…" : t);
}

/* node + edge sets for the current dataset, filters and toggles */
function rsGData() {
  const g = researchState.g;
  const want = function (graph) { return g.ds === "both" || g.ds === graph; };
  const nodes = [], index = {};
  ["sl", "rl"].forEach(function (graph) {
    if (!want(graph)) return;
    rsFiltered(graph).forEach(function (w) {
      index[graph + ":" + w.id] = nodes.length;
      nodes.push({ key: graph + ":" + w.id, graph: graph, id: w.id,
        label: w.title || w.id, kind: w.kind || "paper", hub: false });
    });
  });
  const edges = [];
  const link = function (ga, ia, gb, ib, cls) {
    if (index[ga + ":" + ia] == null || index[gb + ":" + ib] == null) return;
    edges.push({ a: ga + ":" + ia, b: gb + ":" + ib, cls: cls });
  };
  if (want("rl")) {
    rsFiltered("rl").forEach(function (w) {
      if (g.internal) (w.rl_links || []).forEach(function (t) { link("rl", w.id, "rl", t, "int"); });
      if (g.cross) (w.sl_links || []).forEach(function (t) { link("rl", w.id, "sl", t, "cross"); });
    });
  }
  if (g.hubs) {
    RS_GHUBS.forEach(function (c) {
      const members = nodes.filter(function (nd) {
        const w = rsFind(nd.graph, nd.id);
        return w && (w.concepts || []).indexOf(c) >= 0;
      });
      if (!members.length) return;
      index["hub:" + c] = nodes.length;
      nodes.push({ key: "hub:" + c, graph: "hub", id: c, label: c, kind: "hub", hub: true });
      members.forEach(function (nd) { edges.push({ a: nd.key, b: "hub:" + c, cls: "hub" }); });
    });
  }
  return { nodes: nodes, edges: edges };
}

/* deterministic force layout: circle-seeded, fixed iterations, clamped */
function rsGLayout(nodes, edges, W, H) {
  const pos = {};
  let i;
  const n = nodes.length;
  if (!n) return pos;
  nodes.forEach(function (nd, k) {
    const a = (k / n) * Math.PI * 2;
    pos[nd.key] = { x: W / 2 + Math.cos(a) * W * 0.32, y: H / 2 + Math.sin(a) * H * 0.32, dx: 0, dy: 0 };
  });
  const nbr = {};
  edges.forEach(function (e) {
    (nbr[e.a] = nbr[e.a] || {})[e.b] = true;
    (nbr[e.b] = nbr[e.b] || {})[e.a] = true;
  });
  const ITER = 140, R = Math.min(W, H);
  for (let t = 0; t < ITER; t++) {
    const temp = (1 - t / ITER) * R * 0.03 + 0.5;
    for (i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const A = pos[nodes[i].key], B = pos[nodes[j].key];
        let dx = A.x - B.x, dy = A.y - B.y, d2 = dx * dx + dy * dy + 40;
        const d = Math.sqrt(d2);
        const f = Math.min((R * R * 0.10) / d2, 12) / d;
        dx *= f; dy *= f;
        A.dx += dx; A.dy += dy; B.dx -= dx; B.dy -= dy;
      }
    }
    edges.forEach(function (e) {
      const A = pos[e.a], B = pos[e.b];
      if (!A || !B) return;
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 110) * 0.025) / d;
      A.dx += dx * f; A.dy += dy * f; B.dx -= dx * f; B.dy -= dy * f;
    });
    nodes.forEach(function (nd) {
      const P = pos[nd.key];
      P.dx += (W / 2 - P.x) * 0.012; P.dy += (H / 2 - P.y) * 0.012;
      const dl = Math.sqrt(P.dx * P.dx + P.dy * P.dy) || 1;
      const step = Math.min(dl, temp);
      P.x = Math.max(70, Math.min(W - 70, P.x + (P.dx / dl) * step));
      P.y = Math.max(26, Math.min(H - 20, P.y + (P.dy / dl) * step));
      P.dx = 0; P.dy = 0;
    });
  }
  return pos;
}

function rsGSvg(data, pos) {
  const indeg = {};
  data.edges.forEach(function (e) { indeg[e.b] = (indeg[e.b] || 0) + 1; });
  const edgeSvg = data.edges.map(function (e) {
    const A = pos[e.a], B = pos[e.b];
    if (!A || !B) return "";
    return '<line class="rsg-e-' + e.cls + '" x1="' + A.x.toFixed(1) + '" y1="' + A.y.toFixed(1) +
      '" x2="' + B.x.toFixed(1) + '" y2="' + B.y.toFixed(1) + '"/>';
  }).join("");
  const nodeSvg = data.nodes.map(function (nd) {
    const P = pos[nd.key];
    if (!P) return "";
    const sel = researchState.sel === nd.id ? " rsg-sel" : "";
    if (nd.hub) {
      return '<g class="rsg-node" data-act="rsSetConcept" data-args="' + dataArgs(nd.id) +
        '" data-keys="Enter, " role="button" tabindex="0" aria-label="concept ' + escHtml(nd.id) + '">' +
        '<rect class="rsg-hub' + sel + '" x="' + (P.x - 10).toFixed(1) + '" y="' + (P.y - 10).toFixed(1) +
        '" width="20" height="20" rx="4"/>' +
        '<text class="rsg-lab" x="' + (P.x + 14).toFixed(1) + '" y="' + (P.y + 4).toFixed(1) + '">' +
        escHtml(nd.id) + "</text></g>";
    }
    const r = 5 + Math.min(6, Math.sqrt(indeg[nd.key] || 0) * 2);
    const pre = nd.graph === "sl" ? "sl:" : "rl:";
    return '<g class="rsg-node" data-act="rsGNode" data-args="' + dataArgs(nd.graph, nd.id) +
      '" data-keys="Enter, " role="button" tabindex="0" aria-label="' + escHtml(nd.label) + '">' +
      '<circle class="rsg-k-' + escHtml(nd.kind) + sel + '" cx="' + P.x.toFixed(1) + '" cy="' + P.y.toFixed(1) + '" r="' + r.toFixed(1) + '"/>' +
      '<text class="rsg-lab" x="' + (P.x + r + 3).toFixed(1) + '" y="' + (P.y + 4).toFixed(1) + '">' +
      escHtml(pre) + rsGShort(nd.label, 26) + "</text></g>";
  }).join("");
  const g = researchState.g;
  return '<svg id="rsG" viewBox="0 0 ' + RS_GW + " " + RS_GH + '" role="img" aria-label="Knowledge graph: ' +
    data.nodes.length + " nodes, " + data.edges.length + ' edges">' +
    '<g id="rsGWorld" transform="translate(' + g.x + " " + g.y + ") scale(" + g.k + ')">' +
    edgeSvg + nodeSvg + "</g></svg>";
}

function rsGPaint() {
  const w = el("rsGWorld");
  if (!w) return;
  const g = researchState.g;
  w.setAttribute("transform", "translate(" + g.x + " " + g.y + ") scale(" + g.k + ")");
}
function rsGZoom(mult) {
  const g = researchState.g;
  if (!mult) { g.x = 0; g.y = 0; g.k = 1; }
  else g.k = Math.max(0.35, Math.min(4, g.k * mult));
  rsGPaint();
}
/* click a node: paint only the detail div, never re-render (keeps viewport) */
function rsGNode(graph, id) {
  if (graph === "hub") return;
  researchState.sel = id;
  const w = rsFind(graph, id);
  const holder = el("rsGDetail");
  if (holder && w) {
    holder.innerHTML = rsDetailHtml(graph, w);
    try { holder.scrollIntoView({ block: "nearest" }); } catch (e) {}
  }
  rsGPaintSel(graph, id);
}
function rsGPaintSel(graph, id) {
  const svg = el("rsG");
  if (!svg || !svg.querySelectorAll) return;
  const want = '["' + graph + '","' + id + '"]';
  svg.querySelectorAll("g.rsg-node").forEach(function (gn) {
    const shape = gn.querySelector("circle, rect");
    if (shape) shape.classList.toggle("rsg-sel", gn.getAttribute("data-args") === want);
  });
}
/* drag-pan + wheel-zoom, bound after each render (property handlers, no inline on*) */
function rsGBind() {
  const svg = el("rsG");
  if (!svg || svg.__rsBound) return;
  svg.__rsBound = true;
  svg.onwheel = function (e) {
    try { e.preventDefault(); } catch (err) {}
    rsGZoom(e.deltaY > 0 ? 0.87 : 1.15);
  };
  svg.onmousedown = function (e) {
    if (e.button !== 0) return;
    const g = researchState.g;
    const rect = svg.getBoundingClientRect();
    const sx = RS_GW / Math.max(1, rect.width);
    let lx = e.clientX, ly = e.clientY;
    const move = function (ev) {
      g.x += (ev.clientX - lx) * sx; g.y += (ev.clientY - ly) * sx;
      lx = ev.clientX; ly = ev.clientY;
      rsGPaint();
    };
    const up = function () {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
}

function rsGGraphPane() {
  const st = researchState;
  const data = rsGData();
  const pos = rsGLayout(data.nodes, data.edges, RS_GW, RS_GH);
  const kinds = [];
  rsKinds("rl").concat(rsKinds("sl")).forEach(function (k) {
    if (kinds.indexOf(k) < 0) kinds.push(k);
  });
  const dsBtns = [["rl", "⚙ RL"], ["sl", "🧬 Self-learning"], ["both", "⛓ Both"]].map(function (d) {
    return '<button class="seg-btn' + (st.g.ds === d[0] ? " active" : "") + '" data-act="rsGSetDS" data-args="' +
      dataArgs(d[0]) + '">' + escHtml(d[1]) + "</button>";
  }).join("");
  const toggles = [["internal", "builds-on"], ["cross", "cross-graph"], ["hubs", "concept hubs"]].map(function (t) {
    return '<label class="filter-item"><input type="checkbox"' + (st.g[t[0]] ? " checked" : "") +
      ' data-change="rsGToggle" data-first="checked" data-args="' + dataArgs(t[0]) + '"> ' + escHtml(t[1]) + "</label>";
  }).join(" ");
  const legend = '<span class="chip">— builds-on</span> <span class="chip">┄ cross-graph</span> ' +
    '<span class="chip">┄ concept hub</span> <span class="muted small">node size ∝ inbound links · drag to pan · wheel to zoom</span>';
  const sel = st.sel ? (rsFind("rl", st.sel) ? rsDetailHtml("rl", rsFind("rl", st.sel)) : null) : null;
  const selSl = st.sel ? rsFind("sl", st.sel) : null;
  const detail = sel || (selSl ? rsDetailHtml("sl", selSl) : '<p class="muted small">Click any node to open its record — alignment, catalog patterns and cross-graph links.</p>');
  setTimeout(rsGBind, 0);
  return '<div class="seg" style="margin-bottom:10px">' + dsBtns + "</div>" +
    '<div class="sticky-bar" style="display:flex;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap">' +
    '<input class="search" style="max-width:260px" placeholder="Filter nodes…" aria-label="Filter graph nodes" data-input="rsSetQ" data-first="value" value="' + escHtml(st.q) + '">' +
    '<select class="search" style="width:auto" aria-label="Filter by kind" data-change="rsSetKind" data-first="value">' +
    kinds.map(function (k) {
      return '<option value="' + escHtml(k) + '"' + (st.kind === k ? " selected" : "") + ">" +
        (k === "all" ? "all kinds" : escHtml(k)) + "</option>";
    }).join("") + "</select>" +
    toggles +
    '<button class="btn sm" data-act="rsReset">Reset</button>' +
    '<div style="flex:1"></div><span class="muted small">' + data.nodes.length + " nodes · " + data.edges.length + " edges</span>" +
    '<button class="btn sm" data-act="rsGZoomBtn" data-args="' + dataArgs("in") + '">＋</button>' +
    '<button class="btn sm" data-act="rsGZoomBtn" data-args="' + dataArgs("out") + '">－</button>' +
    '<button class="btn sm" data-act="rsGZoomBtn" data-args="' + dataArgs("reset") + '">Fit</button></div>' +
    '<div class="rs-g-wrap">' + rsGSvg(data, pos) + "</div>" +
    '<p class="muted small" style="margin:8px 0">' + legend + "</p>" +
    '<div id="rsGDetail">' + detail + "</div>";
}

/* zoom buttons: in / out / reset — transform-only, no re-render */
function rsGZoomBtn(which) {
  if (which === "reset") rsGZoom(0);
  else if (which === "out") rsGZoom(0.8);
  else rsGZoom(1.25);
}

function renderResearch() {
  const root = el("rsMain");
  if (!root) return;
  const st = researchState;
  if (st.loadError) {
    root.innerHTML = '<div class="empty-state"><div class="empty-ico">📚</div>' +
      '<div class="empty-t">Research graphs could not load</div>' +
      '<div class="empty-b">' + escHtml(st.loadError) + ' — serve via <span class="mono">python3 serve.py</span>.</div>' +
      '<button class="btn sm primary" data-act="initResearch">Retry</button></div>';
    return;
  }
  if (!st.data) {
    root.innerHTML = '<p class="muted small">Loading research graphs…</p>';
    return;
  }
  const rlN = rsWorks("rl").length, slN = rsWorks("sl").length;
  const shared = rsSharedConcepts();
  const seg = [["sl", "🧬 Self-learning (" + slN + ")"], ["rl", "⚙ Reinforcement learning (" + rlN + ")"],
    ["graph", "🕸 Graph"], ["trails", "📚 Trails & collectors"]].map(function (v) {
      return '<button class="seg-btn' + (st.view === v[0] ? " active" : "") + '" data-v="' + v[0] +
        '" data-act="rsSetView" data-args="' + dataArgs(v[0]) + '">' + escHtml(v[1]) + "</button>";
    }).join("");
  let body = "";
  if (st.view === "sl") {
    body = rsGraphPane("sl", 0, "Vendored snapshot of the sibling lab's landscape (51 works, 9 dimensions, 21 concepts). RL works link here via sl_links — see “Linked from the RL graph” in any detail.");
  } else if (st.view === "rl") {
    body = rsGraphPane("rl", 0, "Curated in-repo RL graph (35 works, 8 dimensions, 18 concepts): tabular foundations → deep RL → offline → preference/RLHF → RLVR → verbal and memory-policy RL for agents.");
  } else if (st.view === "graph") {
    body = rsGGraphPane();
  } else {
    body = rsTrailsPane();
  }
  root.innerHTML =
    '<div class="bt-head"><div><h2>📚 Research Graphs</h2>' +
    '<p class="muted small">Self-learning agents and reinforcement learning as interlinked knowledge graphs — ' +
    slN + " + " + rlN + " works, " + shared.length + " shared concepts (" +
    shared.map(function (c) { return escHtml(c.id); }).join(", ") + ").</p></div></div>" +
    '<div class="seg" style="margin-bottom:12px">' + seg + "</div>" + body;
  /* search-as-you-type re-renders the pane, which would drop the caret:
     put it back at the end when the keystroke asked for it. */
  if (st._refocus) {
    st._refocus = false;
    const s = el("rsSearch");
    if (s) { try { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } catch (e) {} }
  }
}

/* ---------------- boot ---------------- */
function initResearch() {
  if (!el("rsMain")) return;
  if (researchState.booted) { renderResearch(); return; }
  researchState.booted = true;
  renderResearch();
  rsFetchAll().then(function () {
    renderResearch();
    /* restore focus to the search box without stealing it on re-renders */
    const s = el("rsSearch");
    if (s && researchState.q) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }).catch(function (e) {
    researchState.loadError = String((e && e.message) || e);
    renderResearch();
  });
}

tabLoaders.research = function () { initResearch(); };
