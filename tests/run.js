import assert from "node:assert";
import { spotOf, lowestFree, newTop } from "../blockmap.js";
import { step, close } from "../blockrun.js";
import { render } from "../app.js";

const base = {
  budget: 1,
  state: { map: [], free: [], bad: [], pending: [], moves: 0, ledger: [], applied: [] },
  events: [{ id: 1, kind: "grow", count: 3 }],
  bad_logical_code: "E_BAD_LOGICAL", bad_phys_code: "E_BAD_PHYS",
  bad_count_code: "E_BAD_COUNT", dup_use_code: "E_DUP_USE",
  no_block_code: "E_NO_BLOCK", event_error_code: "E_BAD_EVENT"
};

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("ok " + name); } catch (e) { failed += 1; console.log("FAIL " + name + " :: " + e.message); }
}

check("spotOf returns a number", () => {
  assert.strictEqual(typeof spotOf([[5, 1]], 5), "number");
});

check("lowestFree returns a number", () => {
  assert.strictEqual(typeof lowestFree([4, 9]), "number");
});

check("newTop returns a number", () => {
  assert.strictEqual(typeof newTop([[5, 1]], [3], []), "number");
});

check("step returns a state", () => {
  assert.strictEqual(typeof step(base).state, "object");
});

check("render counts events", () => {
  assert.strictEqual(typeof render(base).count_events, "number");
});

console.log("5 cases, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
