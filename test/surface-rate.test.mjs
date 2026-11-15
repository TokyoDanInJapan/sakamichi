// Refresh-rate independence: the same scripted disturbance stepped through the
// page's frame at 60, 120 and 144 Hz should leave a glass in the same state.
// Kept apart from surface.test.mjs because it is the slow one, and node runs
// each test file in its own process, side by side. The tolerances, and what
// they were chosen from, are in helpers/checks.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rateSpread, rateFailures, frameHelperFailures } from "./helpers/checks.mjs";

test("surface energy and particle counts agree at 60, 120 and 144 Hz", () => {
  assert.deepEqual(rateFailures(rateSpread()), []);
});

/* A slow frame is taken in several wave strides, so the waves cover the same
   time as at 60 Hz. */
test("waves keep time on a 20 fps frame", () => {
  assert.deepEqual(rateFailures(rateSpread({ rates: [20, 60], only: ["ring"], seeds: { ring: 2 } })), []);
});

test("decay, chance and frames carry a per-sixtieth rate to any frame", () => {
  assert.deepEqual(frameHelperFailures(), []);
});
