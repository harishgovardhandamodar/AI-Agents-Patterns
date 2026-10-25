// Dead-expression guard: a statement ending in `;` immediately followed by a
// line that is only a string concatenation means an abandoned expression.
// Most often it is a truncated `return `...` +` template — the Oct cascade
// regression, which rendered 60 empty nested shells and passed lint silently
// (no-unused-vars is off by design in this codebase, so nothing flags it).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function stripped(src) {
  // Same comment-stripping as actions.test.mjs so doc examples are not flagged.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{])\/\/[^\n]*/gm, "$1");
}

export function deadConcatLines(src) {
  const bad = [];
  const lines = stripped(src).split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (/[`'"];\s*$/.test(lines[i].trimEnd())) {
      const nxt = lines[i + 1].trim();
      if (/^(['"`]).*\1\s*\+/.test(nxt)) bad.push({ line: i + 2, text: nxt.slice(0, 80) });
    }
  }
  return bad;
}

test("no abandoned string-concat expressions in js/", () => {
  const bad = [];
  for (const f of readdirSync(join(ROOT, "js")).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(ROOT, "js", f), "utf8");
    for (const hit of deadConcatLines(src)) bad.push(`js/${f}:${hit.line}: ${hit.text}`);
  }
  assert.deepEqual(bad, [], `abandoned expressions (truncated return?) :\n  ${bad.join("\n  ")}`);
});

test("detector catches the truncated-return shape", () => {
  const buggy = "  return `<div>`;\n    '<span>' + x + \"</div>\";";
  assert.equal(deadConcatLines(buggy).length, 1);
  const fixed = "  return `<div>` +\n    '<span>' + x + \"</div>\";";
  assert.deepEqual(deadConcatLines(fixed), []);
});
