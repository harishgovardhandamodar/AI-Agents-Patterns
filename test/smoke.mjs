// Headless smoke test — boots the real app over the real server and walks
// every tab, asserting no page/console errors and that each pane renders.
//
// Requires an installed Chrome/Chromium. If puppeteer (or a browser) is not
// available this exits 0 with a SKIP line locally, so it never blocks a dev
// without the browser toolchain — but under CI=1 a missing browser FAILS the
// run, so the e2e job cannot go green while skipping its whole purpose.
//
//   npm run test:e2e
//   CHROME_PATH=/usr/bin/google-chrome npm run test:e2e
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The tab list is not duplicated here: TAB_GROUPS on the page owns it, so a
// new tab or section is walked automatically and a removed one cannot linger
// as a stale expectation. Roles are still asserted below.
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  return false;
}

function skip(msg) {
  if (process.env.CI) {
    console.error(`FAIL: ${msg} (CI must run the real browser suite — install puppeteer with its Chrome download)`);
    process.exitCode = 1;
  } else {
    console.log(`SKIP: ${msg}`);
  }
}

async function main() {
  let puppeteer;
  try {
    ({ default: puppeteer } = await import("puppeteer"));
  } catch {
    skip("puppeteer is not installed (npm i -D puppeteer), or run the data suite via `npm test`.");
    return;
  }

  const port = await freePort();
  const server = spawn("python3", ["serve.py", String(port)], { cwd: ROOT, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}/`;
  let browser = null;
  try {
    if (!(await waitForServer(base))) throw new Error(`server on ${base} did not come up`);

    const launch = { headless: "new", args: ["--no-sandbox"] };
    if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
    try {
      browser = await puppeteer.launch(launch);
    } catch (e) {
      skip(`no browser available (${e.message.split("\n")[0]}). Set CHROME_PATH to a Chrome binary.`);
      return;
    }

    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`);
    });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(base, { waitUntil: "load" });
    await sleep(2500);

    // Two-level tabs: walk every section, then every subtab inside it, with
    // real clicks (not direct switchTab() calls) to exercise the delegated
    // data-act path end to end for group buttons and subtab buttons alike.
    const GROUPS = await page.evaluate(() =>
      (typeof TAB_GROUPS !== "undefined" ? TAB_GROUPS : []).map(g => ({ id: g.id, tabs: g.tabs.slice() })));
    if (!GROUPS.length) throw new Error("TAB_GROUPS not found on the page");
    const results = [];
    for (const g of GROUPS) {
      await page.click(`.app-tab[data-group="${g.id}"]`);
      await sleep(400);
      for (const id of g.tabs) {
        await page.click(`#subTabs .app-tab[data-tab="${id}"]`);
        await sleep(500);
        const n = await page.evaluate((t) => {
          const pane = document.getElementById(t + "Pane");
          return pane ? pane.querySelectorAll("*").length : -1;
        }, id);
        results.push([id, n]);
      }
    }

    // Every rendered data-* action must resolve: the name is a function and
    // data-args parses as JSON (placeholders resolved at render time). A
    // typo or a malformed payload would otherwise die silently on click.
    const actCheck = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll("[data-act],[data-change],[data-input],[data-key]").forEach((el) => {
        ["data-act", "data-change", "data-input", "data-key"].forEach((a) => {
          const name = el.getAttribute(a);
          if (name && typeof window[name] !== "function") {
            bad.push(`${a}="${name}" is not a function ` +
              `(in #${(el.closest(".pane") || {}).id || "?"})`);
          }
        });
        const raw = el.getAttribute("data-args");
        if (raw != null) {
          try {
            const v = JSON.parse(raw);
            if (!Array.isArray(v)) bad.push(`data-args not an array: ${raw.slice(0, 80)}`);
          } catch {
            bad.push(`data-args not JSON: ${raw.slice(0, 120)}`);
          }
        }
      });
      return bad;
    });
    for (const b of actCheck.slice(0, 12)) errors.push("dead action: " + b);
    if (actCheck.length > 12) errors.push(`... and ${actCheck.length - 12} more dead actions`);

    // Core a11y invariants from iterations 84-86.
    const a11y = await page.evaluate(() => ({
      main: document.querySelectorAll("main#maincontent").length,
      nestedMain: document.querySelectorAll("main main").length,
      tabs: document.querySelectorAll('[role="tab"]').length,
    }));
    if (a11y.main !== 1) errors.push("expected exactly one <main id=maincontent>");
    if (a11y.nestedMain !== 0) errors.push("no <main> may be nested inside <main>");
    const groupCount = await page.evaluate(() => document.querySelectorAll('#appTabs [role="tab"]').length);
    if (groupCount !== GROUPS.length) errors.push(`expected ${GROUPS.length} section buttons, got ${groupCount}`);
    if (a11y.tabs < GROUPS.length) errors.push(`expected at least ${GROUPS.length} role=tab, got ${a11y.tabs}`);

    // The Self-Learning status probe must reach the lab through this app's
    // same-origin proxy (a direct localhost fetch is blocked by connect-src).
    const sl = await page.evaluate(async () => {
      try {
        const r = await fetch("/api/selflearn/health?port=8220");
        const j = await r.json();
        return { status: r.status, ok: typeof j.ok === "boolean" };
      } catch (e) {
        return { status: 0, ok: false, error: e.message };
      }
    });
    if (sl.status !== 200 || !sl.ok) {
      errors.push(`self-learning health proxy broken (status=${sl.status}, ok=${sl.ok}${sl.error ? ", " + sl.error : ""})`);
    }

    // ---- the workflow (iterations 101-120) --------------------------
    // A single journey that crosses the authoring tools: the planner's
    // stack becomes a blueprint, the guardrail analysis becomes a
    // blueprint, the mock run becomes a trace, and the report carries
    // every work product. If any seam is broken, the user is stuck.
    const wf = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = { steps: [] };
      const step = (name, ok, detail) => out.steps.push({ name, ok, detail });

      // the project spine exists and is unique
      step("project store", typeof projGet === "function" && !!projGet(),
        "active=" + (typeof projActiveId === "function" ? projActiveId() : "n/a"));

      // deploy -> blueprint
      dpState.done = true;
      dpState.a.system = "Smoke refunds agent";
      dpSave();
      const ids = typeof dpStackPatternIds === "function" ? dpStackPatternIds() : [];
      dpMaterialise("add");
      await wait(300);
      step("deploy -> blueprint", bpState.comps.length >= ids.length && ids.length > 0,
        "stack=" + ids.length + " comps=" + bpState.comps.length);

      // guard -> blueprint
      const g = guardState.items[0];
      const mapped = typeof guardAnalysisPatternIds === "function" ? guardAnalysisPatternIds(g) : [];
      step("guard -> blueprint", mapped.length > 0, "mapped=" + mapped.length);

      // guard -> live
      if (typeof guardPromoteToTrace === "function") {
        guardPromoteToTrace(g);
        await wait(200);
        const local = typeof liveLocal === "function" ? liveLocal() : [];
        step("guard -> live", local.length > 0, "localTraces=" + local.length);
      }

      // the report carries all seven work products
      const md = typeof rpMarkdown === "function" ? rpMarkdown() : "";
      const want = ["## 1. Deployment plan", "## 2. Reference architecture", "## 3. Guardrail analyses",
        "## 4. Cascade mitigation backlog", "## 5. Working set", "## 6. Discovery drafts",
        "## 7. Fox - Architect consult"];
      const missing = want.filter((w) => md.indexOf(w) < 0);
      step("report sections", missing.length === 0, missing.length ? "missing " + missing.join(",") : "all 7");

      // the workflow rail and the next-step engine
      const stages = typeof wfStatus === "function" ? wfStatus().stages : [];
      step("workflow rail", stages.length === 5, "stages=" + stages.length);
      const nx = typeof wfNext === "function" ? wfNext() : null;
      step("next engine", !!nx && !!nx.tab && !!nx.cta, nx ? nx.cta : "none");

      // the navigation primitive opens items and keeps the deep link
      goTo("scenarios", "fin-card-injection");
      await wait(600);
      const drawer = document.getElementById("detailOverlay");
      step("goTo opens item", drawer.classList.contains("open") && location.hash.indexOf("#scenarios/") === 0,
        "hash=" + location.hash);

      return out;
    });
    for (const s of wf.steps) {
      if (!s.ok) errors.push(`workflow: ${s.name} failed (${s.detail})`);
    }

    const empty = results.filter(([, n]) => n <= 0).map(([id]) => id);
    if (empty.length) errors.push(`panes rendered empty: ${empty.join(", ")}`);

    if (errors.length) {
      console.error(`FAIL: ${errors.length} problem(s)`);
      for (const e of errors) console.error("  " + e);
      process.exitCode = 1;
    } else {
      console.log(`OK: ${results.length} tabs across ${GROUPS.length} sections rendered, single <main>, ${a11y.tabs} role=tab, ` +
        `${wf.steps.length} workflow steps, 0 errors.`);
    }
  } finally {
    // Close the browser even when an assertion throws midway — a leaked
    // Chrome keeps the event loop alive and CI hangs until the timeout.
    if (browser) {
      try { await browser.close(); } catch { /* already gone */ }
    }
    server.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error("FAIL: " + e.message);
  process.exitCode = 1;
});
