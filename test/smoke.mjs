// Headless smoke test — boots the real app over the real server and walks
// every tab, asserting no page/console errors and that each pane renders.
//
// Requires an installed Chrome/Chromium. If puppeteer (or a browser) is not
// available this exits 0 with a SKIP line, so it never blocks a dev without
// the browser toolchain — `npm test` (the data suite) stays dependency-free.
//
//   npm run test:e2e
//   CHROME_PATH=/usr/bin/google-chrome npm run test:e2e
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAB_IDS = ["overview", "copilot", "patterns", "scenarios", "cascades", "coverage", "deploy", "blueprint", "live", "design", "guard", "discovery"];

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

async function main() {
  let puppeteer;
  try {
    ({ default: puppeteer } = await import("puppeteer"));
  } catch {
    console.log("SKIP: puppeteer is not installed (npm i -D puppeteer), or run the data suite via `npm test`.");
    return;
  }

  const port = await freePort();
  const server = spawn("python3", ["serve.py", String(port)], { cwd: ROOT, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}/`;
  try {
    if (!(await waitForServer(base))) throw new Error(`server on ${base} did not come up`);

    const launch = { headless: "new", args: ["--no-sandbox"] };
    if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
    let browser;
    try {
      browser = await puppeteer.launch(launch);
    } catch (e) {
      console.log(`SKIP: no browser available (${e.message.split("\n")[0]}). Set CHROME_PATH to a Chrome binary.`);
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

    const results = [];
    for (const id of TAB_IDS) {
      await page.evaluate((t) => switchTab(t), id);
      await sleep(500);
      const n = await page.evaluate((t) => {
        const pane = document.getElementById(t + "Pane");
        return pane ? pane.querySelectorAll("*").length : -1;
      }, id);
      results.push([id, n]);
    }

    // Core a11y invariants from iterations 84-86.
    const a11y = await page.evaluate(() => ({
      main: document.querySelectorAll("main#maincontent").length,
      nestedMain: document.querySelectorAll("main main").length,
      tabs: document.querySelectorAll('[role="tab"]').length,
    }));
    if (a11y.main !== 1) errors.push("expected exactly one <main id=maincontent>");
    if (a11y.nestedMain !== 0) errors.push("no <main> may be nested inside <main>");
    if (a11y.tabs !== TAB_IDS.length) errors.push(`expected ${TAB_IDS.length} role=tab, got ${a11y.tabs}`);

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

    await browser.close();

    if (errors.length) {
      console.error(`FAIL: ${errors.length} problem(s)`);
      for (const e of errors) console.error("  " + e);
      process.exitCode = 1;
    } else {
      console.log(`OK: ${TAB_IDS.length} tabs rendered, single <main>, ${a11y.tabs} role=tab, ` +
        `${wf.steps.length} workflow steps, 0 errors.`);
    }
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error("FAIL: " + e.message);
  process.exitCode = 1;
});
