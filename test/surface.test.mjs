// The wave surface: it keeps its beer, stays finite, spills and refills, and
// holds its crests to a slope beer can stand in. See test/helpers/sim.mjs for
// how the simulation is loaded; the volume measurement is in checks.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSim } from "./helpers/sim.mjs";
import { RATES, MEAN_TOL_PX, SHIFT_TOL_PX, volumeRun } from "./helpers/checks.mjs";

for (const hz of RATES){
  test(`volume is conserved at ${hz} Hz when nothing spills`, () => {
    const r = volumeRun(hz);
    assert.ok(r.finite);
    assert.ok(r.worstMean < MEAN_TOL_PX, `surface mean wandered ${r.worstMean} px`);
    assert.ok(r.maxShift < SHIFT_TOL_PX, `solver lost ${r.maxShift} px of mean in one step`);
    assert.equal(r.levelMoved, 0, "level must not change when nothing spills");
  });
}

test("level is unchanged by a stirred glass that does not spill (page frames)", () => {
  const s = loadSim({ seed: 11 });
  s.layout(1440, 900, { fill: 70 });
  const before = s.state().level;
  s.frames(6, 60, (t, i) => {
    if (i % 30 === 0) s.splash(Math.sin(i), 2.5 * (i % 60 ? 1 : -1));
  });
  const after = s.state();
  assert.equal(after.level, before);
  assert.ok(Math.abs(after.mean) < MEAN_TOL_PX);
});

/* ---- Finite under violent input ------------------------------------------ */
for (const [name, cfg] of [
  ["agitation 200", { agitation: 200, waveSpeed: 46, viscosity: 40 }],
  ["agitation 200, wave speed 100, viscosity 0", { agitation: 200, waveSpeed: 100, viscosity: 0 }]
]){
  for (const denom of [30, 60, 144, 240]){
    test(`stays finite: ${name}, steps of 1/${denom}`, () => {
      const step = 1 / denom;
      const s = loadSim({ seed: 5 });
      s.layout(1440, 900, cfg);
      s.splash(-0.5, 6.5);
      const every = Math.round(0.35 / step);
      const n = Math.round(4 / step);
      let k = 0;
      for (let i = 0; i < n; i++){
        if (i % every === 0){
          // hard kicks at random places, and a shove along the whole glass
          s.run(`splash(G.cx + (Math.random() - 0.5) * G.topHalf, 6.5 * (Math.random() < 0.5 ? 1 : -1), G.topHalf * 0.4);
                 driveFlow(1500 * (Math.random() - 0.5));`);
          k++;
        }
        s.run(`stepWaves(${step}); spillOverRim(${step});`);
        if (i % 4 === 0) assert.ok(s.state().finite, `non-finite surface at step ${i}, kick ${k}`);
      }
      const end = s.state();
      assert.ok(end.finite);
      assert.ok(end.level >= 0 && end.level <= 1, `level ${end.level}`);
    });
  }
}

/* ---- Spill and refill ------------------------------------------------------ */
test("a spill lowers the level and the glass refills to targetLevel()", () => {
  for (const hz of [60, 144]){
    const s = loadSim({ seed: 2 });
    s.layout(1440, 900, { fill: 100, refill: 100 });
    const start = s.state().level;
    let min = start;
    const gap = Math.round(hz * 0.4);
    s.frames(4, hz, (t, i) => {
      if (i % gap === 0){
        s.run(`driveFlow(${700 * ((i / gap) % 2 ? -1 : 1)}); splash(G.cx, 5, G.topHalf * 0.6);`);
      }
      min = Math.min(min, s.state().level);
    });
    // measured: 0.887 falls to 0.70
    assert.ok(min < start - 0.05, `${hz} Hz: level only fell from ${start} to ${min}`);
    assert.ok(s.state().drops > 0 || s.state().level < start);
    const target = s.state().target;
    let seconds = 0;
    while (s.state().level < target - 0.0005 && seconds < 90){ s.frames(1, hz); seconds++; }
    const end = s.state();
    assert.ok(seconds < 90, `${hz} Hz: not refilled after 90 s`);
    assert.ok(Math.abs(end.level - target) <= 0.0005 + 1e-9, `${hz} Hz: level ${end.level} against target ${target}`);
  }
});

test("an empty glass pours to the fill line and stays there", () => {
  const s = loadSim({ seed: 4 });
  s.layoutEmpty();
  s.run("poured = false");
  s.frames(8, 60);
  const a = s.state();
  assert.ok(Math.abs(a.level - a.target) <= 0.0005 + 1e-9, `level ${a.level}, target ${a.target}`);
  s.frames(5, 60);
  assert.ok(s.state().level <= s.state().target + 1e-12, "level must never pass the target");
});

/* ---- The crest limiter ------------------------------------------------------ */
function steepest(step, drive, transform){
  const s = loadSim({ seed: 5, transform });
  s.layout(1440, 900, { fill: 85 });
  const gap = Math.round(0.4 / step);
  let worst = 0;
  const n = Math.round(5 / step);
  for (let i = 0; i < n; i++){
    if (i % gap === 0) s.run(`driveFlow(${drive * ((i / gap) % 2 ? -1 : 1)})`);
    s.stepWaves(step);
    worst = Math.max(worst, s.maxSlope());
  }
  return { worst, maxFace: s.run("MAX_FACE") };
}

/* Measured with the limiter in place: 1.20 to 1.33 for drives of 50 to 800 at
   1/60 and 1/144. With it taken out: 2.5 to 40. A hard drive is left a little
   over, since the limiter stops at CREST_PASSES sweeps. */
for (const step of [1 / 60, 1 / 144]){
  for (const drive of [200, 400]){
    test(`crest limiter keeps the face slope near MAX_FACE (drive ${drive}, 1/${Math.round(1 / step)})`, () => {
      const { worst, maxFace } = steepest(step, drive);
      assert.ok(worst < maxFace * 1.15, `steepest face ${worst}, limit ${maxFace}`);
    });
  }
}

/* What the comment on MAX_FACE promises is a slope at or under the limit, and
   a gentle drive gets exactly that. It did not while the limiter measured the
   column spacing once and then moved the columns: 1.59 against 1.2. */
for (const step of [1 / 60, 1 / 144]){
  test(`crest limiter holds the face slope at or under MAX_FACE (1/${Math.round(1 / step)})`, () => {
    const { worst, maxFace } = steepest(step, 100);
    assert.ok(worst <= maxFace + 0.01, `steepest face ${worst}, limit ${maxFace}`);
  });
}
