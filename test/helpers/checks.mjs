// The measurements the surface tests make, kept apart from the assertions so
// that test/mutation.test.mjs can run the same measurements on deliberately
// broken copies of the source and check that the tests would notice.
import { loadSim } from "./sim.mjs";

export const RATES = [60, 120, 144];

/* Tolerances, from what was measured on the unmodified source.
     mean after a step     worst 2.1e-4 px at 60 Hz, 9e-5 at 144   -> allow 1e-3
     shift levelWave undid worst 0.23 px a step at 60 Hz           -> allow 0.5
   and for the frame rate, the largest of the three rates' means over the
   smallest (1 is perfect):
     surface energy        1.01 to 1.04                            -> allow 1.10
     bubbles, foam, drops  1.02 to 1.11                            -> allow 1.25 */
export const MEAN_TOL_PX = 1e-3;
export const SHIFT_TOL_PX = 0.5;
export const ENERGY_RATIO = 1.10;
export const COUNT_RATIO = 1.25;

/* Wrap a source transform so it applies to one file only */
export const only = (name, fn) => (file, text) => file.endsWith(name) ? fn(text) : text;

/* ---- Volume ---------------------------------------------------------------
   A gentle disturbance in a glass that is not full, so nothing spills and
   nothing is clamped. levelWave() is what flattens the surface's area-weighted
   mean back to zero at the end of stepWaves; it is wrapped here to record how
   far the solver had let that mean wander before being flattened, which is the
   solver's own conservation error and is hidden by the final flattening. */
export function volumeRun(hz, { transform = null, seed = 1, seconds = 4 } = {}){
  const s = loadSim({ seed, transform });
  s.layout(1440, 900, { fill: 80 });
  s.run(`var __shift = 0, __in = false;
         const __lw = levelWave;
         levelWave = function(){ const r = __lw(); if (__in) __shift = Math.max(__shift, Math.abs(r)); return r; };`);
  s.splash(-0.5, 3);
  s.splash(0.3, -2.4, 0.3);
  const level0 = s.state().level;
  let worstMean = 0;
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++){
    s.run(`__in = true; stepWaves(${1 / hz}); __in = false;`);
    worstMean = Math.max(worstMean, Math.abs(s.state().mean));
  }
  const st = s.state();
  return {
    finite: st.finite,
    worstMean,                               /* px, after each stepWaves */
    maxShift: s.run("__shift") / st.scale,   /* px at glass scale, per stepWaves call */
    levelMoved: Math.abs(st.level - level0),
    rms: st.rms
  };
}

/* ---- Frame rate -----------------------------------------------------------
   The same scripted disturbance, run through the page's frame at each rate:
   a sweep of the pointer, then free. Averaged over the last part. */
function sweep(hz, seed, transform){
  const s = loadSim({ seed, transform });
  s.layout(1440, 900);
  s.run(`for (let i = 0; i < 40; i++) addFoam(G.cx + (i / 40 - 0.5) * G.topHalf * 1.6, foamRadius(0.7));`);
  const sum = { rms: 0, bubbles: 0, foam: 0, drops: 0, n: 0 };
  const every = 1 / 60;                            /* sampled on the clock, not per frame */
  let next = 0.6;
  s.frames(3.5, hz, t => {
    const on = t > 0.5 && t < 2.5;
    s.run(`ptr.inside = ${on};
           ptr.x = G.cx + Math.sin((${t} - 0.5) * 2 * Math.PI * 1.1) * G.topHalf * 0.8;
           ptr.y = G.inBottom - level * G.inH * 0.4 + Math.sin(${t} * 9) * 20;`);
    if (t >= next){
      next += every;
      const q = s.state();
      sum.rms += q.rms; sum.bubbles += q.bubbles; sum.foam += q.foam; sum.drops += q.drops; sum.n++;
    }
  });
  const f = k => sum[k] / sum.n;
  return { rms: f("rms"), bubbles: f("bubbles"), foam: f("foam"), drops: f("drops") };
}

/* A glass left alone, which should hold the same bubbles at any rate */
function idle(hz, seed, transform){
  const s = loadSim({ seed, transform });
  s.layout(1440, 900);
  let b = 0, n = 0, next = 2.5;
  s.frames(5, hz, t => {
    if (t >= next){ next += 0.05; b += s.state().bubbles; n++; }
  });
  return { bubbles: b / n };
}

/* An impulse and its decay: surface energy a second or two after a kick */
function ring(hz, seed, transform){
  const s = loadSim({ seed, transform });
  s.layout(1440, 900, { fill: 85 });
  let sum = 0, n = 0, next = 1.2;
  s.frames(3, hz, t => {
    if (n === 0 && t === 0){ s.splash(-0.4, 3.4); s.run("driveFlow(150)"); }
    if (t >= next){ next += 1 / 30; sum += s.state().rms; n++; }
  });
  return { rms: sum / n };
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

/* For each measure, its mean at each rate over the seeds, and the ratio of the
   largest of those to the smallest. 1 is perfect agreement. */
export function rateSpread({ transform = null, seeds = { sweep: 3, idle: 2, ring: 2 }, rates = RATES, only: want = null } = {}){
  const all = { sweep, idle, ring };
  const kinds = want ? Object.fromEntries(want.map(k => [k, all[k]])) : all;
  const out = {};
  for (const [kind, fn] of Object.entries(kinds)){
    const perRate = rates.map(hz => {
      const runs = [];
      for (let k = 1; k <= (seeds[kind] ?? 2); k++) runs.push(fn(hz, k * 7919, transform));
      return runs;
    });
    for (const key of Object.keys(perRate[0][0])){
      const means = perRate.map(runs => mean(runs.map(r => r[key])));
      const sds = perRate.map(runs => sd(runs.map(r => r[key])));
      out[kind + "." + key] = {
        means, sds,
        ratio: Math.max(...means) / Math.min(...means)
      };
    }
  }
  return out;
}

/* The names of the measures that disagree across rates by more than allowed */
export function rateFailures(spread){
  return Object.entries(spread)
    .filter(([key, v]) => !(v.ratio <= (key.endsWith(".rms") ? ENERGY_RATIO : COUNT_RATIO)))
    .map(([key, v]) => `${key}: ${v.means.map(x => x.toFixed(2)).join(" / ")} (ratio ${v.ratio.toFixed(3)})`);
}

/* The frame-rate helpers in core.js: a per-sixtieth rate, carried to any frame.
   Returns what is wrong with them. */
export function frameHelperFailures(transform = null){
  const s = loadSim({ transform });
  const bad = [];
  for (const hz of [30, 60, 120, 144, 240]){
    const decayed = s.run(`(() => { let a = 1; for (let i = 0; i < ${hz}; i++) a *= decay(0.9, ${1 / hz}); return a; })()`);
    if (!(Math.abs(decayed / 0.9 ** 60 - 1) < 1e-9)) bad.push(`decay at ${hz} Hz: ${decayed}`);
    const sum = s.run(`${hz} * chance(0.01, ${1 / hz})`);
    if (!(Math.abs(sum - 0.6) < 1e-9)) bad.push(`chance at ${hz} Hz: ${sum}`);
  }
  if (s.run("frames(1 / 60)") !== 1) bad.push("frames(1/60) is not 1");
  if (s.run("chance(0.9, 1)") !== 1) bad.push("chance passes certainty");
  return bad;
}
