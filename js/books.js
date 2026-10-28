/* js/books.js — the Bookshelf panel (Overview tab): collect the landscape
 * inventory and rebuild all six books (main, rogue, self-learning, openshell, workflows, field) through
 * the server-side /api/books/* endpoints (serve.py runs the generators, so the
 * browser never shells out). Everything degrades to status text when the
 * server cannot build (e.g. a static host with no Python).
 */
"use strict";

const booksState = {
  status: null,       /* GET /api/books/status */
  job: null,          /* polled /api/books/job */
  timer: null,
  booted: false
};

function booksFmtSize(n) {
  if (!isFinite(Number(n))) return "—";
  n = Number(n);
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

function booksFmtTime(ts) {
  if (!ts) return "never";
  try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return "—"; }
}

function booksLandscapeLine(tid, land) {
  if (!land) return '<span class="muted">landscape unavailable</span>';
  if (land.error) return '<span class="chip bad">landscape: ' + escHtml(land.error) + "</span>";
  if (tid === "self") {
    return escHtml(land.works) + " works · " + escHtml(land.concepts) + " concepts · " +
      escHtml(land.dimensions) + " dims · " + escHtml(land.bands) + " bands";
  }
  return escHtml(land.patterns) + " patterns · " + escHtml(land.scenarios) +
    " scenarios · " + escHtml(land.cascades) + " cascades";
}

function booksOutCell(o) {
  if (!o || !o.exists) return '<span class="muted">missing</span>';
  return escHtml(booksFmtSize(o.size)) + ' <span class="muted small">' + escHtml(booksFmtTime(o.mtime)) + "</span>";
}

function booksJobHtml() {
  const j = booksState.job;
  if (!j) return "";
  const busy = j.state === "queued" || j.state === "running";
  const chip = busy ? '<span class="chip">● building…</span>'
    : j.state === "done" ? '<span class="chip ok">● done</span>'
    : '<span class="chip bad">● ' + escHtml(j.state) + "</span>";
  const steps = (j.steps || []).map(function (s) {
    return "<li>" + escHtml([s.target, s.step].filter(Boolean).join(" · ")) +
      " — " + (s.ok ? "ok" : "FAILED") + " (" + escHtml(s.secs) + "s)</li>";
  }).join("");
  const log = (j.log || []).slice(-14).map(escHtml).join("\n");
  return '<div class="panel" style="margin-top:10px"><h3>Build job <span class="muted small mono">' +
    escHtml(j.id) + "</span> " + chip + "</h3>" +
    (busy ? '<div style="margin:6px 0"><button class="btn sm" data-act="booksCancel" data-args="' +
      dataArgs(j.id) + '">■ Cancel job</button></div>' : "") +
    (steps ? '<ul class="muted small">' + steps + "</ul>" : "") +
    (log ? '<pre class="mono small" style="max-height:220px;overflow:auto;white-space:pre-wrap">' + log + "</pre>" : "") +
    "</div>";
}

function renderBookshelf() {
  const root = el("bookshelf");
  if (!root) return;
  const st = booksState.status;
  if (!st) {
    root.innerHTML = '<p class="muted small">Bookshelf status unavailable (this host serves static files only — run <span class="mono">python3 serve.py</span> for rebuilds).</p>';
    return;
  }
  const busy = booksState.job && (booksState.job.state === "queued" || booksState.job.state === "running");
  const order = ["main", "rogue", "self", "openshell", "workflows", "field"];
  const rows = order.filter(function (tid) { return st.books && st.books[tid]; }).map(function (tid) {
    const b = st.books[tid];
    const stale = b.stale
      ? '<span class="chip bad">● stale</span> <span class="muted small">' + escHtml((b.stale_reasons || []).join("; ")) + "</span>"
      : '<span class="chip ok">● fresh</span>';
    return "<tr><td><b>" + escHtml(b.label) + "</b><br><span class=\"muted small\">" +
      booksLandscapeLine(tid, b.landscape) + "</span></td>" +
      "<td>" + booksOutCell(b.outputs && b.outputs.md) + "</td>" +
      "<td>" + booksOutCell(b.outputs && b.outputs.html) + "</td>" +
      "<td>" + booksOutCell(b.outputs && b.outputs.pdf_out) + "</td>" +
      "<td>" + stale + "</td>" +
      '<td><button class="btn sm" data-act="booksBuildOne" data-args="' + dataArgs(tid) + '"' +
      (busy ? " disabled" : "") + ">Rebuild</button></td></tr>";
  }).join("");
  root.innerHTML =
    '<div class="bt-head"><div>' +
    '<p class="muted small" style="margin:0">Collect the landscape inventory (catalog + lab reference data), regenerate Markdown + print HTML, and re-render the PDFs — for all six books.</p></div>' +
    '<div class="bt-head-btns">' +
    '<button class="btn" data-act="booksRefresh">↻ Status</button>' +
    '<button class="btn primary" data-act="booksBuildAll"' + (busy ? " disabled" : "") + ">⬇ Collect landscape &amp; rebuild all books</button>" +
    "</div></div>" +
    (st.sl_present ? "" : '<p class="muted small">Sibling lab checkout not found at <span class="mono">' + escHtml(st.sl_dir) +
      "</span> — the self-learning book builds against its own last-collected data only.</p>") +
    (st.node ? "" : '<p class="muted small">Node.js not on the server PATH — rogue MD and all PDFs will fail; main/self Markdown still builds.</p>') +
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Book</th><th>Markdown</th><th>Print HTML</th><th>PDF</th><th>Freshness</th><th></th></tr></thead>' +
    "<tbody>" + rows + "</tbody></table></div>" +
    '<div id="booksJob">' + booksJobHtml() + "</div>";
}

function booksPoll() {
  const j = booksState.job;
  if (!j || (j.state !== "queued" && j.state !== "running")) {
    if (booksState.timer) { clearInterval(booksState.timer); booksState.timer = null; }
    booksRefresh();
    return;
  }
  fetch("/api/books/job?id=" + encodeURIComponent(j.id)).then(function (res) {
    return res.json();
  }).then(function (data) {
    if (data && !data.error) booksState.job = data;
    const holder = el("booksJob");
    if (holder) holder.innerHTML = booksJobHtml();
    if (booksState.job && booksState.job.state !== "queued" && booksState.job.state !== "running") {
      if (booksState.timer) { clearInterval(booksState.timer); booksState.timer = null; }
      showNotif("Book build " + booksState.job.state);
      booksRefresh();
    } else {
      renderBookshelf();
    }
  }).catch(function () {
    if (booksState.timer) { clearInterval(booksState.timer); booksState.timer = null; }
  });
}

function booksLaunch(targets) {
  fetch("/api/books/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targets: targets, pdf: true })
  }).then(function (res) {
    return res.json().then(function (data) { return { status: res.status, data: data }; });
  }).then(function (wrapped) {
    const data = wrapped.data || {};
    if (data.job && !data.error) {
      booksState.job = { id: data.job, state: data.busy ? "running" : (data.state || "queued"), steps: [], log: [] };
      if (data.busy) showNotif("A build is already running — following it");
      else showNotif("Book build started");
      renderBookshelf();
      if (booksState.timer) clearInterval(booksState.timer);
      booksState.timer = setInterval(booksPoll, 2000);
      booksPoll();
    } else {
      showNotif("Build not started: " + (data.error || ("HTTP " + wrapped.status)));
    }
  }).catch(function () {
    showNotif("Build endpoint unreachable (static host?)");
  });
}

function booksBuildAll() { booksLaunch(["main", "rogue", "self", "openshell", "workflows", "field"]); }
function booksBuildOne(tid) { booksLaunch([tid]); }
function booksCancel(jid) {
  if (!jid) return;
  fetch("/api/books/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job: jid })
  }).then(function (res) { return res.json(); }).then(function (data) {
    showNotif(data && data.state ? ("Cancel: " + data.state) : ("Cancel failed: " + ((data && data.error) || "unknown")));
    booksPoll();
  }).catch(function () { showNotif("Cancel endpoint unreachable"); });
}

function booksRefresh() {
  fetch("/api/books/status").then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function (data) {
    booksState.status = data;
    renderBookshelf();
  }).catch(function () {
    booksState.status = null;
    renderBookshelf();
  });
}

function initBooks() {
  if (!el("bookshelf")) return;
  if (booksState.booted) { renderBookshelf(); return; }
  booksState.booted = true;
  renderBookshelf();
  booksRefresh();
  booksPollLatest();
}

function booksPollLatest() {
  fetch("/api/books/job").then(function (res) {
    return res.json();
  }).then(function (data) {
    if (data && data.id && (data.state === "queued" || data.state === "running")) {
      booksState.job = data;
      renderBookshelf();
      if (booksState.timer) clearInterval(booksState.timer);
      booksState.timer = setInterval(booksPoll, 2000);
    }
  }).catch(function () {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBooks);
} else {
  initBooks();
}
