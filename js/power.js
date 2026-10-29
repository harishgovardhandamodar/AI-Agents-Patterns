/* js/power.js — the Power panel (Books tab): live GPU + CPU telemetry from
 * the axiom power observer via serve.py's /api/power relay (same origin).
 * Renders per-source watts + energy and a system-total sparkline.
 * Degrades to status text when the backend is unreachable.
 */
"use strict";

const powerState = {
  rangeH: 1,
  data: null,
  timer: null,
  booted: false,
  busy: false
};

function powerRanges() {
  return [[1, "1h"], [6, "6h"], [24, "24h"]];
}

function powerFmt(n, digits) {
  if (n == null || !isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits == null ? 1 : digits);
}

function powerSpark(samples) {
  if (!samples || !samples.length) return '<p class="muted small">no samples in range</p>';
  const W = 560, H = 120, PAD = 6;
  const step = Math.max(1, Math.floor(samples.length / 160));
  const pts = [];
  for (let i = 0; i < samples.length; i += step) pts.push(samples[i]);
  if (pts.length < 2) return '<p class="muted small">not enough samples yet</p>';
  const max = Math.max.apply(null, pts.map(function (p) { return p[1]; }).concat([1]));
  const X = function (i) { return PAD + (i / (pts.length - 1)) * (W - 2 * PAD); };
  const Y = function (v) { return H - PAD - (v / max) * (H - 2 * PAD); };
  const d = pts.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(" ");
  const t0 = new Date(pts[0][0] * 1000), t1 = new Date(pts[pts.length - 1][0] * 1000);
  const fmt = function (d) { return d.toISOString().slice(11, 16) + "Z"; };
  return '<svg viewBox="0 0 ' + W + ' ' + (H + 18) + '" class="pow-spark" role="img" aria-label="system watts over time">' +
    '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<text x="' + PAD + '" y="' + (H + 14) + '" class="mono" font-size="10">' + escHtml(fmt(t0)) + '</text>' +
    '<text x="' + (W - PAD) + '" y="' + (H + 14) + '" class="mono" font-size="10" text-anchor="end">' + escHtml(fmt(t1)) + '</text>' +
    '<text x="' + (W - PAD) + '" y="' + (PAD + 10) + '" class="mono" font-size="10" text-anchor="end">max ' + escHtml(powerFmt(max, 0)) + ' W</text>' +
    "</svg>";
}

function powerRender() {
  const root = el("power");
  if (!root) return;
  const d = powerState.data;
  const btns = powerRanges().map(function (r) {
    return '<button class="btn sm' + (powerState.rangeH === r[0] ? " primary" : "") +
      '" data-act="powerRange" data-args="[' + r[0] + ']"' +
      (powerState.busy ? " disabled" : "") + ">" + r[1] + "</button>";
  }).join(" ");
  if (!d || d.error || d.ok === false) {
    root.innerHTML = '<div class="bt-head"><div><p class="muted small" style="margin:0">Continuous GPU + CPU observer on axiom (10s samples, 90-day retention).</p></div>' +
      '<div class="bt-head-btns">' + btns +
      '<button class="btn sm" data-act="powerRefresh"' + (powerState.busy ? " disabled" : "") + ">↻ Refresh</button></div></div>" +
      '<p class="muted small">Power telemetry unavailable: ' + escHtml((d && (d.error || "no backend")) || "not loaded") +
      " — the observer (fox-services on axiom) may be down. Books and expansion keep working without it.</p>";
    return;
  }
  const srcs = d.sources || [];
  const row = function (label, s) {
    const st = (s && s.stats) || {};
    return "<tr><td><b>" + escHtml(label) + "</b><br><span class=\"muted small mono\">" + escHtml(s.source) + "</span></td>" +
      "<td>" + escHtml(powerFmt(st.avg_w)) + " W</td>" +
      "<td>" + escHtml(powerFmt(st.latest_w)) + " W</td>" +
      "<td>" + escHtml(powerFmt(st.max_w, 0)) + " W</td>" +
      "<td>" + escHtml(powerFmt(st.energy_wh, 2)) + " Wh</td>" +
      "<td class=\"muted small\">" + escHtml(st.samples) + " samples</td></tr>";
  };
  const order = ["gpu:0", "gpu:1", "cpu:package:0", "system:total"];
  const bySrc = {};
  srcs.forEach(function (s) { bySrc[s.source] = s; });
  const names = { "gpu:0": "GPU 0", "gpu:1": "GPU 1", "cpu:package:0": "CPU package", "system:total": "System total" };
  const rows = order.filter(function (k) { return bySrc[k]; }).map(function (k) { return row(names[k] || k, bySrc[k]); }).join("");
  let spark = "";
  const sys = (d.samples || []).filter(function (s) { return s && s.source === "system:total"; })
    .map(function (s) { return [s.ts, s.power_w]; })
    .filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
  if (!sys.length && (d.samples || []).length) {
    // fall back: sum per-GPU + cpu rows per timestamp bucket
    const agg = {};
    (d.samples || []).forEach(function (s) {
      if (!s || !isFinite(s.ts) || !isFinite(s.power_w) || String(s.source).indexOf("system") === 0) return;
      const b = Math.round(s.ts / 60) * 60;
      agg[b] = (agg[b] || 0) + s.power_w;
    });
    Object.keys(agg).sort().forEach(function (t) { sys.push([Number(t), agg[t]]); });
  }
  spark = powerSpark(sys);
  const sum = d.summary || {};
  const totE = (sum.system && sum.system.energy_wh != null) ? powerFmt(sum.system.energy_wh, 2) + " Wh" : "—";
  root.innerHTML = '<div class="bt-head"><div>' +
    '<p class="muted small" style="margin:0">Continuous observer on axiom: per-GPU + CPU-package watts every 10s. Energy in window: <b>' + escHtml(totE) + "</b>.</p></div>" +
    '<div class="bt-head-btns">' + btns +
    '<button class="btn sm" data-act="powerRefresh"' + (powerState.busy ? " disabled" : "") + ">↻ Refresh</button></div></div>" +
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Source</th><th>Avg</th><th>Latest</th><th>Max</th><th>Energy</th><th></th></tr></thead>' +
    "<tbody>" + (rows || '<tr><td colspan="6" class="muted">no sources in range</td></tr>') + "</tbody></table></div>" +
    '<div style="margin-top:8px"><div class="muted small">System watts over the window</div>' + spark + "</div>";
}

function powerFetch() {
  const to = new Date();
  const from = new Date(to.getTime() - powerState.rangeH * 3600 * 1000);
  const q = "from=" + encodeURIComponent(from.toISOString()) +
    "&to=" + encodeURIComponent(to.toISOString()) +
    "&include_raw=1&limit=3000";
  powerState.busy = true;
  powerRender();
  return fetch("/api/power?" + q, { cache: "no-store" }).then(function (res) {
    return res.json();
  }).then(function (data) {
    powerState.data = data || { error: "empty reply" };
    powerState.busy = false;
    powerRender();
  }).catch(function () {
    powerState.data = { ok: false, error: "endpoint unreachable (static host?)" };
    powerState.busy = false;
    powerRender();
  });
}

function powerRefresh() {
  if (!el("power")) return;
  powerFetch();
}

function powerRange(h) {
  powerState.rangeH = Number(h) || 1;
  powerRefresh();
}

function powerPoll() {
  if (document.hidden) return;
  const pane = document.getElementById("booksPane");
  if (pane && !pane.classList.contains("visible")) return;
  powerFetch();
}

function initPower() {
  if (!el("power")) return;
  if (powerState.booted) { powerRender(); return; }
  powerState.booted = true;
  powerRender();
  powerFetch();
  if (powerState.timer) clearInterval(powerState.timer);
  powerState.timer = setInterval(powerPoll, 60000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPower);
} else {
  initPower();
}
