// Fox-Architect markdown-lite link safety: cpMd() renders model output as HTML,
// so a model-emitted [label](javascript:…) must never become a live anchor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadCopilot() {
  const ctx = vm.createContext({
    console,
    tabLoaders: {},
    escHtml: (s) => String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  });
  vm.runInContext(readFileSync(join(ROOT, "js/copilot.js"), "utf8"), ctx);
  return ctx;
}

const md = (ctx, s) => vm.runInContext("cpMd(" + JSON.stringify(s) + ")", ctx);

test("http(s) links stay clickable", () => {
  const ctx = loadCopilot();
  const out = md(ctx, "[docs](https://example.com/a?b=1)");
  assert.match(out, /<a href="https:\/\/example\.com\/a\?b=1" target="_blank" rel="noopener">docs<\/a>/);
});

test("same-app fragment links stay clickable", () => {
  const ctx = loadCopilot();
  assert.match(md(ctx, "[open it](#patterns/abc)"), /<a href="#patterns\/abc"/);
});

test("javascript: links are inert text, not anchors", () => {
  const ctx = loadCopilot();
  const out = md(ctx, "[click](javascript:alert(document.domain))");
  assert.doesNotMatch(out, /<a /);
  assert.match(out, /click/);
});

test("data: and other schemes are inert text", () => {
  const ctx = loadCopilot();
  for (const u of ["data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "vbscript:msgbox(1)"]) {
    const out = md(ctx, "[x](" + u + ")");
    assert.doesNotMatch(out, /<a /, u + " became an anchor");
  }
});

test("no unescaped markup leaks through links", () => {
  const ctx = loadCopilot();
  const out = md(ctx, '[x](https://e.com/"onmouseover="alert(1))');
  assert.doesNotMatch(out, /onmouseover="alert/);
});

const verify = (ctx, content, context) =>
  Array.from(vm.runInContext(
    "cpVerifyCites(" + JSON.stringify(content) + ", " + JSON.stringify(context) + ")",
    ctx
  ));

test("cited IDs present in context verify clean", () => {
  const ctx = loadCopilot();
  const context = "Dual control gates irreversible actions. See least-privilege scoping.";
  assert.deepEqual(verify(ctx, "Use dual-control and least-privilege here.", context), []);
});

test("IDs missing from context are reported unverified", () => {
  const ctx = loadCopilot();
  const context = "Dual control gates irreversible actions.";
  assert.deepEqual(
    verify(ctx, "Use dual-control and S-007 here.", context),
    ["S-007"]
  );
});

test("code spans are not treated as claims", () => {
  const ctx = loadCopilot();
  assert.deepEqual(verify(ctx, "Run `dual-control --dry-run` first.", "unrelated text"), []);
});
