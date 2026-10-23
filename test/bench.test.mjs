// Guards the Battle Bench's option tables against drifting from the
// Deployment Planner. js/bench.js declares its own copy of the planner's
// dimensions (so the bench can enumerate a space without booting the
// planner); btCheckDimSync() is the assertion that the copies agree.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadPlannerAndBench() {
  const ctx = vm.createContext({
    console,
    DATA: { patterns: { patterns: [] } },
    tabLoaders: {},
    escHtml: (s) => String(s),
    showNotif: () => {},
  });
  vm.runInContext(readFileSync(join(ROOT, "js/deploy.js"), "utf8"), ctx);
  vm.runInContext(readFileSync(join(ROOT, "js/bench.js"), "utf8"), ctx);
  return ctx;
}

test("bench dimensions match the deployment planner", () => {
  const ctx = loadPlannerAndBench();
  const drift = vm.runInContext("btCheckDimSync()", ctx);
  assert.deepEqual(Array.from(drift), [], "btCheckDimSync reported drift: " + Array.from(drift).join("; "));
});

test("drift check includes the boolean approval gate", () => {
  const ctx = loadPlannerAndBench();
  assert.equal(vm.runInContext("dpDefault().approvalGate", ctx), true);
  assert.deepEqual(Array.from(vm.runInContext("BT_DIMS.approvalGate", ctx)), [true, false]);
});

test("drift check catches a removed dimension", () => {
  const ctx = loadPlannerAndBench();
  vm.runInContext("delete BT_DIMS.approvalGate", ctx);
  const drift = vm.runInContext("btCheckDimSync()", ctx);
  assert.equal(drift.length, 1);
  assert.match(drift[0], /^approvalGate:/);
});
