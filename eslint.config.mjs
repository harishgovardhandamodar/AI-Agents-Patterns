// Flat ESLint config for the no-build vanilla-JS app.
//
// The app ships as plain <script> globals (no modules/bundler). To make
// `no-undef` meaningful across files, this config reads every js/*.js and
// collects its top-level declarations, registering them as shared globals —
// so `escHtml` defined in one file and used in another is not a false
// positive, while a genuine typo (`escHtlm`) still fails.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import globals from "globals";

const ROOT = join(dirname(fileURLToPath(import.meta.url)));
const jsDir = join(ROOT, "js");

const appGlobals = {};
for (const f of readdirSync(jsDir)) {
  if (!f.endsWith(".js")) continue;
  const src = readFileSync(join(jsDir, f), "utf8");
  for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) appGlobals[m[1]] = "writable";
  for (const m of src.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) appGlobals[m[1]] = "writable";
}

export default [
  {
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, ...appGlobals },
    },
    rules: {
      // The point of this config: catch references to identifiers that exist
      // nowhere (typos like `escHtlm`). App globals are collected above.
      "no-undef": "error",
      // Top-level functions/consts are invoked from inline HTML handlers, so
      // "unused" is a false positive here — leave it off.
      "no-unused-vars": "off",
    },
  },
  {
    // Test files run in Node, but their page.evaluate() bodies run in the
    // browser and call app globals (switchTab, document, ...).
    files: ["test/**/*.mjs", "eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser, ...appGlobals },
    },
    rules: { "no-undef": "error" },
  },
  { ignores: ["js/vendor/**", "node_modules/**", "graft/**"] },
];
