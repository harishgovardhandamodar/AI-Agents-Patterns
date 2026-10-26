// Research tab render gate: every data-act button js/research.js generates
// must carry a data-args payload the dispatcher can parse.
//
// Regression test for the seg-button bug: data-args="["rl"]" (raw double
// quotes inside a double-quoted attribute) is truncated by the HTML parser
// to "[", JSON.parse fails, and the click silently does nothing. Buttons
// must use the dataArgs() helper (which emits &quot; entities), and every
// data-act target must resolve to a real function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function bootResearch() {
  const stubs = `
    const __roots = {};
    globalThis.el = (id) => {
      if (!__roots[id]) __roots[id] = { innerHTML: "", value: "", scrollIntoView() {} };
      return __roots[id];
    };
    globalThis.__roots = __roots;
    globalThis.escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    globalThis.dataArgs = function () {
      return globalThis.escHtml("[" + Array.prototype.map.call(arguments, function (x) {
        return JSON.stringify(String(x));
      }).join(",") + "]");
    };
    globalThis.showNotif = () => {};
    globalThis.tabLoaders = {};
    globalThis.fetch = () => Promise.reject(new Error("offline harness"));
  `;
  const src = readFileSync(join(ROOT, "js", "research.js"), "utf8");
  const loadData = `
    researchState.data = {
      sl: JSON.parse(require("node:fs").readFileSync(${JSON.stringify(join(ROOT, "data", "sl_landscape.json"))}, "utf8")),
      rl: JSON.parse(require("node:fs").readFileSync(${JSON.stringify(join(ROOT, "data", "rl_landscape.json"))}, "utf8")),
      col: JSON.parse(require("node:fs").readFileSync(${JSON.stringify(join(ROOT, "data", "research_collectors.json"))}, "utf8"))
    };
  `;
  const fn = new Function("require", stubs + src + loadData + `
    return { researchState, renderResearch, rsSetView, rsFiltered, rsGData, rsGLayout, __roots,
      fns: { rsSetView, rsSetQ, rsSetKind, rsSetConcept, rsReset, rsSelect, rsJump, rsBack, rsCopyCmd,
        rsGSetDS, rsGToggle, rsGNode, rsGZoomBtn, rsGZoom } };
  `);
  return fn(require);
}

function dataArgsOf(html) {
  const out = [];
  for (const m of html.matchAll(/data-args="([^"]*)"/g)) out.push(m[1]);
  return out;
}

function dataActsOf(html) {
  const out = [];
  for (const m of html.matchAll(/data-act="([^"]*)"/g)) out.push(m[1]);
  return out;
}

const unescapeAttr = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("every rendered button carries a parseable data-args payload", () => {
  const app = bootResearch();
  const pages = [];
  for (const view of ["sl", "rl", "graph", "trails"]) {
    app.researchState.view = view;
    app.researchState.sel = null;
    app.renderResearch();
    pages.push(app.__roots.rsMain.innerHTML);
  }
  // plus one detail page per graph (detail adds concept/pattern/link buttons)
  app.researchState.view = "rl";
  app.researchState.sel = "deepseek-r1-2025";
  app.renderResearch();
  pages.push(app.__roots.rsMain.innerHTML);
  app.researchState.view = "sl";
  app.researchState.sel = "memrl";
  app.renderResearch();
  pages.push(app.__roots.rsMain.innerHTML);

  let buttons = 0;
  for (const html of pages) {
    assert.ok(html.length > 500, "a research view rendered almost nothing");
    for (const raw of dataArgsOf(html)) {
      buttons += 1;
      let parsed;
      try {
        parsed = JSON.parse(unescapeAttr(raw));
      } catch (e) {
        assert.fail(`unparseable data-args payload: ${raw.slice(0, 80)}`);
      }
      assert.ok(Array.isArray(parsed), `data-args must be an array: ${raw.slice(0, 80)}`);
    }
  }
  assert.ok(buttons > 50, `expected dozens of buttons across the views, got ${buttons}`);
});

test("every rendered data-act resolves to a research action", () => {
  const app = bootResearch();
  const known = new Set([...Object.keys(app.fns), "openPattern", "goTo", "initResearch"]);
  for (const view of ["sl", "rl", "graph", "trails"]) {
    app.researchState.view = view;
    app.researchState.sel = null;
    app.renderResearch();
    for (const act of dataActsOf(app.__roots.rsMain.innerHTML)) {
      assert.ok(known.has(act) && typeof app.fns[act] === "function" || act === "openPattern" || act === "goTo" || act === "initResearch",
        `unknown action target: ${act}`);
    }
  }
});

test("view switching reaches the rl and trails views", () => {
  const app = bootResearch();
  app.rsSetView("rl");
  assert.match(app.__roots.rsMain.innerHTML, /Reinforcement learning/);
  app.rsSetView("trails");
  assert.match(app.__roots.rsMain.innerHTML, /Reading trails/);
  // the seg buttons themselves address both views with parseable args
  const html = app.__roots.rsMain.innerHTML;
  const segArgs = [...html.matchAll(/data-act="rsSetView" data-args="([^"]*)"/g)].map((m) =>
    JSON.parse(unescapeAttr(m[1])));
  assert.deepEqual(segArgs.map((a) => a[0]).sort(), ["graph", "rl", "sl", "trails"]);
});

test("graph view renders nodes and edges for every dataset", () => {
  const app = bootResearch();
  for (const ds of ["rl", "sl", "both"]) {
    app.researchState.view = "graph";
    app.researchState.g.ds = ds;
    app.researchState.sel = null;
    app.renderResearch();
    const html = app.__roots.rsMain.innerHTML;
    assert.match(html, /<svg id="rsG"/, `${ds}: svg canvas renders`);
    const data = app.rsGData();
    const circles = (html.match(/<circle class="rsg-k-/g) || []).length;
    const hubs = (html.match(/<rect class="rsg-hub/g) || []).length;
    assert.equal(circles + hubs, data.nodes.length, `${ds}: every node renders a shape`);
    const lines = (html.match(/<line class="rsg-e-/g) || []).length;
    assert.equal(lines, data.edges.length, `${ds}: every edge renders a line`);
    assert.ok(data.nodes.length > 5, `${ds}: non-trivial node set`);
    assert.ok(data.edges.length > 0, `${ds}: non-empty edge set`);
  }
  // both datasets together show the cross-graph edges
  app.researchState.g.ds = "both";
  const both = app.rsGData();
  assert.ok(both.edges.some((e) => e.cls === "cross"), "both mode carries rl->sl cross edges");
  assert.ok(both.edges.some((e) => e.cls === "int"), "both mode carries builds-on edges");
});

test("graph layout is deterministic and toggles prune edges", () => {
  const app = bootResearch();
  app.researchState.g.ds = "both";
  const a = app.rsGData();
  const p1 = app.rsGLayout(a.nodes, a.edges, 1000, 560);
  const p2 = app.rsGLayout(a.nodes, a.edges, 1000, 560);
  assert.deepEqual(p1, p2, "same node set lays out identically");
  for (const k of Object.keys(p1)) {
    assert.ok(p1[k].x >= 0 && p1[k].x <= 1000 && p1[k].y >= 0 && p1[k].y <= 560, "positions stay in bounds");
  }
  app.researchState.g.cross = false;
  assert.ok(!app.rsGData().edges.some((e) => e.cls === "cross"), "cross toggle removes cross edges");
  app.researchState.g.cross = true;
  app.researchState.g.hubs = false;
  assert.ok(!app.rsGData().edges.some((e) => e.cls === "hub"), "hub toggle removes hub edges");
  app.researchState.g.hubs = true;
});
