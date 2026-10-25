// Delegated-actions guard: the CSP ships without script-src 'unsafe-inline',
// so no inline on* handler may exist, and every data-act/change/input/key
// name must resolve to a real top-level function. A typo here is a dead
// button that fails silently at click time — this test fails loudly at
// build time instead. (The e2e suite additionally validates every
// *rendered* action resolves and its data-args parses as JSON.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Dynamic action names (template placeholders) with their closed value sets,
// pinned to the sites that produce them so a new one cannot slip in silently.
const DYNAMIC = {
  "${it.open}": { values: ["openPattern", "openScenario", "openCascade"], where: "js/dashboard.js pinItem()" },
  "${fn}": { values: ["dpPick", "dpToggle"], where: "js/deploy.js dpChipBtn()" },
};

function sources() {
  const files = ["index.html", ...readdirSync(join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f)];
  return files.map((f) => {
    let src = readFileSync(join(ROOT, f), "utf8");
    // Strip comments so doc examples (e.g. data-act="fn") are not validated.
    // (The // pattern requires whitespace/{/; before it, so http:// URLs survive.)
    src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{])\/\/[^\n]*/gm, "$1");
    return [f, src];
  });
}

test("no inline event-handler attributes remain", () => {
  const bad = [];
  for (const [f, src] of sources()) {
    for (const m of src.matchAll(/\son(click|change|input|keydown|keyup|keypress|mousedown|mouseup|mouseover|mouseout|focus|blur|submit|load|error)\s*=/g)) {
      bad.push(`${f}: inline ${m[1]}= attribute`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `inline handlers remain:\n  ${bad.slice(0, 10).join("\n  ")}${bad.length > 10 ? `\n  ... and ${bad.length - 10} more` : ""}`);
});

test("no inline <script> blocks in index.html", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
  assert.equal(inline.length, 0, "index.html must not contain inline <script> (extract to a file instead)");
});

test("every delegated action resolves to a top-level function", () => {
  const defined = new Set();
  for (const [, src] of sources()) {
    for (const m of src.matchAll(/^(?:async\s+)?function ([A-Za-z_$][\w$]*)/gm)) defined.add(m[1]);
    for (const m of src.matchAll(/^(?:const|let|var) ([A-Za-z_$][\w$]*)\s*=\s*(?:function|\()/gm)) defined.add(m[1]);
  }
  const used = new Map(); // name -> first file
  for (const [f, src] of sources()) {
    for (const m of src.matchAll(/data-(?:act|change|input|key)="([A-Za-z_$][\w$]*|\$\{[^{}]+\})"/g)) {
      if (!used.has(m[1])) used.set(m[1], f);
    }
  }
  const missing = [];
  for (const [name, f] of used) {
    if (name.startsWith("${")) {
      assert.ok(DYNAMIC[name], `${f}: new dynamic action name ${name} needs a pinned value set in test/actions.test.mjs`);
      for (const v of DYNAMIC[name].values) {
        if (!defined.has(v)) missing.push(`${name}→${v} (allowed via ${DYNAMIC[name].where}, but not defined)`);
      }
      continue;
    }
    // data-args values are JSON, never names — but data-key fns take (event, el, ...args),
    // so only the attribute names are checked here.
    if (!defined.has(name)) missing.push(`${name} (used in ${f}, never defined)`);
  }
  assert.deepEqual(missing, [], `unknown actions:\n  ${missing.join("\n  ")}`);
});
