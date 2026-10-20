/* js/ressets.js — saved research sets (iteration 114).
 *
 * A security reviewer's workflow is *enumerate → triage → narrow →
 * re-enumerate*. The catalog panes supported exactly one step of that
 * (filter), and the filter state was remembered per pane but had no name,
 * no identity and no way to be shared or come back to deliberately.
 *
 * A **research set** is a named, saved filter state for one catalog pane:
 *
 *   { id, pane: "patterns"|"scenarios"|"cascades", name, q, cats/domains/…, createdAt }
 *
 * It is deliberately small: it stores *what was selected*, never the
 * results, so a set never goes stale as the catalog grows — applying it
 * re-runs the filter against the current data. Sets live in the project,
 * so a set saved while working on one system does not follow the user
 * into the next.
 */
"use strict";

const RES_STORE = "aap.ressets.v1";

/* The panes that can hold a research set, and what each one's filter
   state looks like. */
const RES_PANES = {
  patterns: {
    label: "Patterns",
    read: function () {
      return {
        q: el("patSearch") ? el("patSearch").value : "",
        cats: patState ? [...patState.cats] : [],
        domains: patState ? [...patState.domains] : [],
        dia: !!(el("patHasDiagram") && el("patHasDiagram").checked),
        fail: !!(el("patHasFailures") && el("patHasFailures").checked),
        sort: el("patSort") ? el("patSort").value : ""
      };
    },
    write: function (f) {
      if (!f) return;
      if (el("patSearch")) el("patSearch").value = f.q || "";
      if (patState) {
        patState.cats.clear();
        (f.cats || []).forEach(function (c) { patState.cats.add(c); });
        if (!patState.cats.size && typeof patCatsAll === "function") patCatsAll();
        patState.domains.clear();
        (f.domains || []).forEach(function (d) { patState.domains.add(d); });
      }
      if (el("patHasDiagram")) el("patHasDiagram").checked = !!f.dia;
      if (el("patHasFailures")) el("patHasFailures").checked = !!f.fail;
      if (el("patSort") && f.sort) el("patSort").value = f.sort;
      /* re-check the boxes so the rail matches the state */
      document.querySelectorAll("#patCats input").forEach(function (i) {
        i.checked = patState.cats.has(i.dataset.cat);
      });
      document.querySelectorAll("#patDomains input").forEach(function (i) {
        i.checked = patState.domains.has(i.dataset.dom);
      });
      if (typeof renderPatterns === "function") renderPatterns();
    }
  },
  scenarios: {
    label: "Scenarios",
    read: function () {
      return {
        q: el("scnSearch") ? el("scnSearch").value : "",
        domains: scnState ? [...scnState.domains] : [],
        sevs: scnState ? [...scnState.sevs] : [],
        vectors: scnState ? [...scnState.vectors] : [],
        sort: el("scnSort") ? el("scnSort").value : ""
      };
    },
    write: function (f) {
      if (!f) return;
      if (el("scnSearch")) el("scnSearch").value = f.q || "";
      if (scnState) {
        scnState.domains.clear();
        (f.domains || []).forEach(function (d) { scnState.domains.add(d); });
        scnState.sevs.clear();
        (f.sevs || []).forEach(function (s) { scnState.sevs.add(s); });
        scnState.vectors.clear();
        (f.vectors || []).forEach(function (v) { scnState.vectors.add(v); });
      }
      document.querySelectorAll("#scnDomains input").forEach(function (i) {
        i.checked = scnState.domains.has(i.dataset.dom);
      });
      document.querySelectorAll("#scnSevs input").forEach(function (i) {
        i.checked = scnState.sevs.has(i.dataset.sev);
      });
      document.querySelectorAll("#scnVectors input").forEach(function (i) {
        i.checked = scnState.vectors.has(i.dataset.vec);
      });
      if (el("scnSort") && f.sort) el("scnSort").value = f.sort;
      if (typeof renderScenarios === "function") renderScenarios();
    }
  }
};

/* --------------------------------------------------------- the store -- */

function resAll() {
  try {
    const v = JSON.parse(localStorage.getItem(RES_STORE) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function resSaveAll(list) {
  try { localStorage.setItem(RES_STORE, JSON.stringify(list)); } catch (e) {}
  if (typeof projTouch === "function") projTouch();
}
function resFor(pane) {
  return resAll().filter(function (s) { return s.pane === pane; });
}

/* Save the current filter state of a pane under a name. */
function resSave(pane, name) {
  const def = RES_PANES[pane];
  if (!def) { showNotif("That pane has no research sets", { kind: "warn" }); return null; }
  const nm = String(name || "").trim();
  if (!nm) { showNotif("Give the research set a name", { kind: "warn" }); return null; }
  const list = resAll();
  const f = def.read();
  const existing = list.findIndex(function (s) { return s.pane === pane && s.name === nm; });
  const rec = { id: existing >= 0 ? list[existing].id : "rs" + Date.now().toString(36), pane: pane, name: nm, filter: f, createdAt: new Date().toISOString() };
  if (existing >= 0) list[existing] = rec; else list.push(rec);
  resSaveAll(list);
  resPaint();
  showNotif(existing >= 0 ? "Research set “" + nm + "” updated" : "Research set “" + nm + "” saved");
  return rec;
}

/* Apply a saved set to its pane. */
function resApply(id) {
  const s = resAll().find(function (x) { return x.id === id; });
  if (!s) return;
  const def = RES_PANES[s.pane];
  if (!def) return;
  switchTab(s.pane);
  dlWhenReady(s.pane, function () {
    def.write(s.filter);
    if (typeof wfPaintRail === "function") wfPaintRail();
  });
  showNotif("Research set “" + s.name + "” applied");
}

/* Delete a saved set. */
function resDelete(id) {
  const list = resAll().filter(function (x) { return x.id !== id; });
  resSaveAll(list);
  resPaint();
}

/* A one-line summary of what a set selects. */
function resSummary(s) {
  const f = s.filter || {};
  const bits = [];
  if (f.q) bits.push('"' + f.q + '"');
  if (f.domains && f.domains.length) bits.push(f.domains.length + (f.domains.length === 1 ? " domain" : " domains"));
  if (f.cats && f.cats.length) bits.push(f.cats.length + (f.cats.length === 1 ? " category" : " categories"));
  if (f.sevs && f.sevs.length) bits.push(f.sevs.join("/"));
  if (f.vectors && f.vectors.length) bits.push(f.vectors.length + " vectors");
  if (f.dia) bits.push("has diagram");
  if (f.fail) bits.push("has failures");
  return bits.length ? bits.join(" · ") : "no filters";
}

/* --------------------------------------------------------- the UI ---- */

/* The saved-sets control, mounted in each catalog pane's sticky bar. */
function resBarHtml(pane) {
  const sets = resFor(pane);
  return '<span class="res-bar">' +
    '<button class="btn sm ghost" onclick="resSavePrompt(\'' + pane + '\')" title="Save the current filters as a named research set">💾 Save set</button>' +
    (sets.length
      ? '<span class="res-sets">' + sets.map(function (s) {
          return '<span class="chip res-set" title="' + escHtml(resSummary(s)) + '">' +
            '<button class="res-set-btn" onclick="resApply(\'' + s.id + '\')" title="' + escHtml(resSummary(s)) + '">' + escHtml(s.name) + "</button>" +
            '<button class="res-set-x" onclick="resDelete(\'' + s.id + '\')" title="Delete this research set" aria-label="Delete research set ' + escHtml(s.name) + '">×</button>' +
            "</span>";
        }).join("") + "</span>"
      : "") +
    "</span>";
}

/* Repaint every saved-sets control in the DOM. */
function resPaint() {
  [["patterns", "patResSets"], ["scenarios", "scnResSets"]].forEach(function (t) {
    const host = document.getElementById(t[1]);
    if (!host) return;
    host.innerHTML = resBarHtml(t[0]);
  });
}

/* Ask for a name, then save. Uses prompt() because a modal would be
   heavier than the interaction deserves — but falls back to a default
   name if prompt is unavailable or dismissed. */
function resSavePrompt(pane) {
  const def = RES_PANES[pane];
  if (!def) return;
  const suggested = def.read().q || (def.label + " set");
  let name = "";
  try {
    name = window.prompt("Name this research set — it will remember the current filters of the " + def.label + " pane:", suggested);
  } catch (e) { name = ""; }
  if (name === null) return;                       /* cancelled */
  if (!String(name).trim()) name = suggested;      /* empty -> the suggestion */
  resSave(pane, name);
}
