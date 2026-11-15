// Do the other tests notice a fault? Each case here takes a copy of one source
// file in memory (src/ is never touched), breaks it the way a real regression
// might, runs the same measurement the test makes, and requires that the test
// would have failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  only, volumeRun, rateSpread, rateFailures, frameHelperFailures, MEAN_TOL_PX, SHIFT_TOL_PX
} from "./helpers/checks.mjs";
import { loadSim } from "./helpers/sim.mjs";

/* Replace one piece of source, and fail loudly if it is no longer there, so
   that a rewrite of the code cannot turn a mutation into a silent no-op */
const swap = (file, from, to) => only(file, text => {
  if (!text.includes(from)) throw new Error(`mutation target is gone from ${file}: ${from}`);
  return text.replace(from, to);
});

/* ---- Volume ---------------------------------------------------------------- */
test("a solver that does not level its surface fails the volume test", () => {
  const r = volumeRun(60, { transform: swap("surface.js",
    "levelWave();                    /* the clamps", "/* levelWave(); */                    /* the clamps") });
  assert.ok(r.worstMean > MEAN_TOL_PX, `mean ${r.worstMean}`);
});

test("a leaky flux fails the volume test", () => {
  const r = volumeRun(60, { transform: swap("surface.js", "(fR - fL) / cell", "(fR - 0.97 * fL) / cell") });
  assert.ok(r.maxShift > SHIFT_TOL_PX || r.worstMean > MEAN_TOL_PX, `shift ${r.maxShift}, mean ${r.worstMean}`);
});

/* ---- Finite ----------------------------------------------------------------- */
test("a solver that blows up and restarts fails the finite check", () => {
  const s = loadSim({ transform: swap("surface.js", "(fR - fL) / cell", "(fR - fL) / cell * NaN") });
  s.layout(1440, 900);
  s.splash(-0.5, 3);
  s.stepWaves(1 / 60, 30);
  assert.equal(s.state().finite, false);
});

/* ---- Frame rate ------------------------------------------------------------- */
test("a chance that ignores the frame fails the frame-rate test", () => {
  const t = swap("core.js", "Math.min(1, p * frames(dt))", "Math.min(1, p)");
  assert.notDeepEqual(rateFailures(rateSpread({ transform: t, only: ["sweep"], seeds: { sweep: 2 } })), []);
  assert.notDeepEqual(frameHelperFailures(t), []);
});

test("a frame taken as always a sixtieth fails the frame-rate test", () => {
  const t = swap("core.js", "const frames = dt => dt * 60;", "const frames = dt => 1;");
  assert.notDeepEqual(rateFailures(rateSpread({ transform: t, only: ["sweep"], seeds: { sweep: 2 } })), []);
});

test("a decay that ignores the frame fails the frame-rate helper test", () => {
  assert.notDeepEqual(frameHelperFailures(swap("core.js", "Math.pow(k, frames(dt))", "k")), []);
});

test("a solver pinned to a sixtieth of a second fails the frame-rate test", () => {
  const t = swap("surface.js", "function stepWaves(step){", "function stepWaves(step){ step = 1 / 60;");
  assert.notDeepEqual(rateFailures(rateSpread({ transform: t, only: ["ring"], seeds: { ring: 1 } })), []);
});

test("damping taken per step instead of per second fails the frame-rate test", () => {
  const t = swap("surface.js", "/ (1 + fric * dt),", "/ (1 + fric / 60),");
  assert.notDeepEqual(rateFailures(rateSpread({ transform: t, only: ["ring"], seeds: { ring: 1 } })), []);
});
