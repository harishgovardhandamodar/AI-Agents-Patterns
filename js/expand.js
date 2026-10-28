/* js/expand.js — the Expander panel (Overview tab, below the Bookshelf):
 * humanize any book/*.md into Books/Humanized/ through the server-side
 * /api/expand/* endpoints (serve.py runs tools/expand_humanized.py, so the
 * browser never shells out). Model dropdown is populated live from the
 * chosen Ollama backend (axiom over Tailscale, or local). Everything
 * degrades to status text when the server cannot expand (static host).
 */
"use strict";

const expandState = {
  status: null,      /* GET /api/expand/status */
  models: [],        /* GET /api/expand/models?backend= */
  modelsBackend: null,
  modelsOnline: false,
  backend: "axiom",
  source: "self",
  model: "",
  pdf: true,
  job: null,         /* polled /api/expand/job */
  timer: null,
  booted: false
};

function expandOutCell(o) {
  if (!o || !o.exists) return '<span class="muted">missing</span>';
  return escHtml(booksFmtSize(o.size)) + ' <span class="muted small">' + escHtml(booksFmtTime(o.mtime)) + "</span>";
}

function expandJobHtml() {
  const j = expandState.job;
  if (!j) return "";
  const busy = j.state === "queued" || j.state === "running";
  const chip = busy ? '<span class="chip">● expanding…</span>'
    : j.state === "done" ? '<span class="chip ok">● done</span>'
    : '<span class="chip bad">● ' + escHtml(j.state) + "</span>";
  const total = Number(j.total) || 0, done = Number(j.done) || 0;
  const bar = total > 0
    ? '<div class="meter" style="margin:6px 0"><div class="meter-fill" style="width:' +
      Math.min(100, Math.round(100 * done / total)) + '%"></div></div>' +
      '<div class="muted small">' + escHtml(done) + " / " + escHtml(total) + " chunks · " +
      escHtml((j.params && j.params.model) || "") + " on " + escHtml((j.params && j.params.backend) || "") + "</div>"
    : "";
  const steps = (j.steps || []).map(function (s) {
    return "<li>" + escHtml([s.step].filter(Boolean).join(" · ")) +
      " — " + (s.ok ? "ok" : "FAILED") + " (" + escHtml(s.secs) + "s)</li>";
  }).join("");
  const log = (j.log || []).slice(-14).map(escHtml).join("\n");
  return '<div class="panel" style="margin-top:10px"><h3>Expansion job <span class="muted small mono">' +
    escHtml(j.id) + "</span> " + chip + "</h3>" + bar +
    (steps ? '<ul class="muted small">' + steps + "</ul>" : "") +
    (log ? '<pre class="mono small" style="max-height:220px;overflow:auto;white-space:pre-wrap">' + log + "</pre>" : "") +
    "</div>";
}

function renderExpander() {
  const root = el("expander");
  if (!root) return;
  const st = expandState.status;
  if (!st) {
    root.innerHTML = '<p class="muted small">Expander status unavailable (this host serves static files only — run <span class="mono">python3 serve.py</span> for model expansion).</p>';
    return;
  }
  const busy = expandState.job && (expandState.job.state === "queued" || expandState.job.state === "running");
  const order = ["field", "workflows", "rogue", "openshell", "self", "agentic"];
  const srcOpts = order.filter(function (sid) { return st.books && st.books[sid]; }).map(function (sid) {
    const b = st.books[sid];
    const ck = b.ckpt || {};
    const prog = ck.exists ? " (" + escHtml(ck.cached) + " cached)" : "";
    return '<option value="' + escHtml(sid) + '"' + (expandState.source === sid ? " selected" : "") + ">" +
      escHtml(b.label) + prog + "</option>";
  }).join("");
  const modelOpts = expandState.models.map(function (m) {
    return '<option value="' + escHtml(m) + '"' + (expandState.model === m ? " selected" : "") + ">" + escHtml(m) + "</option>";
  }).join("");
  const modelNote = expandState.modelsOnline
    ? ""
    : '<span class="chip bad">● backend offline</span> <span class="muted small">model list unavailable — check Tailscale / Ollama</span>';
  const rows = order.filter(function (sid) { return st.books && st.books[sid]; }).map(function (sid) {
    const b = st.books[sid];
    const stale = b.stale ? '<span class="chip bad">● stale</span>' : '<span class="chip ok">● fresh</span>';
    const ck = b.ckpt || {};
    const ckCell = ck.exists
      ? '<span class="mono small">' + escHtml(ck.cached) + " chunks</span>"
      : '<span class="muted">—</span>';
    return "<tr><td><b>" + escHtml(b.label) + "</b><br><span class=\"muted small mono\">" +
      escHtml(b.src) + "</span></td>" +
      "<td>" + expandOutCell(b.output) + "</td>" +
      "<td>" + expandOutCell(b.pdf_out) + "</td>" +
      "<td>" + ckCell + "</td><td>" + stale + "</td></tr>";
  }).join("");
  root.innerHTML =
    '<div class="bt-head"><div>' +
    '<p class="muted small" style="margin:0">Rewrite a source book section-by-section through a local Ollama model (resumable — cached chunks are skipped), then re-render its PDF.</p></div></div>' +
    '<div class="form-grid" style="margin-top:8px">' +
    '<label>Source book<br><select id="expSource" class="input">' + srcOpts + "</select></label>" +
    '<label>Backend<br><select id="expBackend" class="input">' +
    '<option value="axiom"' + (expandState.backend === "axiom" ? " selected" : "") + ">axiom (Tailscale GPU)</option>" +
    '<option value="local"' + (expandState.backend === "local" ? " selected" : "") + ">local (this machine)</option>" +
    "</select></label>" +
    '<label>Model<br><select id="expModel" class="input"' + (expandState.models.length ? "" : " disabled") + ">" +
    (modelOpts || "<option>—</option>") + "</select></label>" +
    '<label style="align-self:end"><span class="muted small">PDF after expand</span><br>' +
    '<input type="checkbox" id="expPdf"' + (expandState.pdf ? " checked" : "") + (busy ? " disabled" : "") + "> render PDF</label>" +
    "</div>" +
    '<div class="bt-head-btns" style="margin-top:8px">' +
    '<button class="btn" data-act="expandRefresh"' + (busy ? " disabled" : "") + ">↻ Models &amp; status</button>" +
    '<button class="btn primary" data-act="expandLaunch"' + (busy || !expandState.models.length ? " disabled" : "") + ">⬇ Expand with selected model</button>" +
    "</div>" +
    '<div class="muted small" style="margin-top:6px">default: <span class="mono">' + escHtml(st.default_model || "") +
    "</span> · " + modelNote + "</div>" +
    '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Book</th><th>Expanded MD</th><th>PDF</th><th>Checkpoint</th><th>Freshness</th></tr></thead>' +
    "<tbody>" + rows + "</tbody></table></div>" +
    '<div id="expandJob">' + expandJobHtml() + "</div>";
  const src = document.getElementById("expSource");
  if (src) src.addEventListener("change", function () { expandState.source = src.value; });
  const be = document.getElementById("expBackend");
  if (be) be.addEventListener("change", function () {
    expandState.backend = be.value;
    expandState.model = "";
    expandFetchModels().then(renderExpander);
  });
  const mo = document.getElementById("expModel");
  if (mo) mo.addEventListener("change", function () { expandState.model = mo.value; });
  const pdf = document.getElementById("expPdf");
  if (pdf) pdf.addEventListener("change", function () { expandState.pdf = !!pdf.checked; });
}

function expandFetchModels() {
  return fetch("/api/expand/models?backend=" + encodeURIComponent(expandState.backend), { cache: "no-store" })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      expandState.models = (data && data.models) || [];
      expandState.modelsBackend = data && data.backend;
      expandState.modelsOnline = !!(data && data.online);
      if (expandState.models.length && expandState.models.indexOf(expandState.model) < 0) {
        const st = expandState.status;
        const dflt = st && st.default_model;
        expandState.model = (dflt && expandState.models.indexOf(dflt) >= 0) ? dflt : expandState.models[0];
      }
    })
    .catch(function () {
      expandState.models = [];
      expandState.modelsOnline = false;
    });
}

function expandPoll() {
  const j = expandState.job;
  if (!j || (j.state !== "queued" && j.state !== "running")) {
    if (expandState.timer) { clearInterval(expandState.timer); expandState.timer = null; }
    expandRefresh();
    return;
  }
  fetch("/api/expand/job?id=" + encodeURIComponent(j.id)).then(function (res) {
    return res.json();
  }).then(function (data) {
    if (data && !data.error) expandState.job = data;
    const holder = el("expandJob");
    if (holder) holder.innerHTML = expandJobHtml();
    if (expandState.job && expandState.job.state !== "queued" && expandState.job.state !== "running") {
      if (expandState.timer) { clearInterval(expandState.timer); expandState.timer = null; }
      showNotif("Expansion " + expandState.job.state);
      expandRefresh();
    } else {
      renderExpander();
    }
  }).catch(function () {
    if (expandState.timer) { clearInterval(expandState.timer); expandState.timer = null; }
  });
}

function expandLaunch() {
  if (!expandState.model) { showNotif("Pick a model first"); return; }
  fetch("/api/expand/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: expandState.source,
      model: expandState.model,
      backend: expandState.backend,
      pdf: expandState.pdf
    })
  }).then(function (res) {
    return res.json().then(function (data) { return { status: res.status, data: data }; });
  }).then(function (wrapped) {
    const data = wrapped.data || {};
    if (data.job && !data.error) {
      expandState.job = { id: data.job, state: "running", steps: [], log: [], params: data.params };
      if (data.busy) showNotif("An expansion is already running — following it");
      else showNotif("Expansion started");
      renderExpander();
      if (expandState.timer) clearInterval(expandState.timer);
      expandState.timer = setInterval(expandPoll, 3000);
      expandPoll();
    } else {
      showNotif("Expansion not started: " + (data.error || ("HTTP " + wrapped.status)));
    }
  }).catch(function () {
    showNotif("Expand endpoint unreachable (static host?)");
  });
}

function expandRefresh() {
  fetch("/api/expand/status").then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function (data) {
    expandState.status = data;
    renderExpander();
  }).catch(function () {
    expandState.status = null;
    renderExpander();
  });
}

function expandRefreshAll() {
  expandRefresh();
  expandFetchModels().then(renderExpander);
}

function initExpand() {
  if (!el("expander")) return;
  if (expandState.booted) { renderExpander(); return; }
  expandState.booted = true;
  renderExpander();
  expandRefresh();
  expandFetchModels().then(renderExpander);
  fetch("/api/expand/job").then(function (res) {
    return res.json();
  }).then(function (data) {
    if (data && data.id && (data.state === "queued" || data.state === "running")) {
      expandState.job = data;
      renderExpander();
      if (expandState.timer) clearInterval(expandState.timer);
      expandState.timer = setInterval(expandPoll, 3000);
    }
  }).catch(function () {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initExpand);
} else {
  initExpand();
}
