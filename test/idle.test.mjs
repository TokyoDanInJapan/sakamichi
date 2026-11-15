// The glass put away behind a company or contact card (glassAway): it is kept
// ready rather than kept going, and coming back is not a surprise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSim, root } from "./helpers/sim.mjs";

/* A poured, busy glass: stirred for two seconds so there is foam, bubbles and
   a moving surface to put away, with the pointer left over the glass. */
function busyGlass(seed, transform){
  const s = loadSim({ seed, transform });
  s.layout(1440, 900);
  s.frames(2, 60, t => {
    s.run(`ptr.inside = true;
           ptr.x = G.cx + Math.sin(${t} * 7) * G.topHalf * 0.7;
           ptr.y = G.inBottom - level * G.inH * 0.4;`);
  });
  s.run(`ptr.x = G.cx + 10; ptr.y = G.inBottom - level * G.inH * 0.4; trackPointer();`);
  return s;
}

test("away, the level follows the fill line and nothing is stirred", () => {
  const s = busyGlass(7);
  s.run("glassAway = true");
  const was = s.state();
  assert.ok(was.drops + was.bubbles > 0, "the glass should be busy to start with");
  for (let i = 0; i < 600; i++){
    // the card keeps turning, so the fill line keeps moving; the pointer roams
    if (i === 100) s.set({ fill: 70 });
    if (i === 300) s.set({ fill: 95, headDepth: 40 });
    s.run(`ptr.x = ${300 + (i * 37) % 900}; ptr.y = ${200 + (i * 53) % 500};`);
    s.frame(1 / 60);
    const q = s.state();
    assert.equal(q.level, q.target, `level off the fill line at frame ${i}`);
    assert.equal(q.drops + q.mist, 0, "what was in the air is let go");
  }
  const end = s.state();
  assert.equal(end.bubbles, was.bubbles, "bubbles are held, not run");
  assert.equal(s.run("ptr.vx") + s.run("ptr.vy"), 0, "pointer speed is kept at nothing");
});

test("coming back gives no flick and no burst of particles", () => {
  const away = busyGlass(7);
  const control = busyGlass(7);          // the same glass, never put away
  away.run("glassAway = true");
  for (let i = 0; i < 600; i++){
    away.run(`ptr.x = ${300 + (i * 37) % 900}; ptr.y = ${200 + (i * 53) % 500};`);
    away.frame(1 / 60);
  }
  // the pointer comes to rest far from where it was when the glass went away
  const px = control.run("ptr.x") + 25, py = control.run("ptr.y") + 5;
  away.run(`ptr.x = ${px}; ptr.y = ${py}; ptr.inside = true;`);
  control.run(`ptr.x = ${px}; ptr.y = ${py}; ptr.inside = true;`);
  away.frame(1 / 60);                       // the last frame away sees it there
  away.run("glassAway = false");
  away.frame(1 / 60);                       // the first frame back
  // The whole distance the pointer travelled while away must not be read as
  // one step: the step is from where it was last seen, which is where it is.
  assert.ok(Math.abs(away.run("ptr.vx")) < 1e-9 && Math.abs(away.run("ptr.vy")) < 1e-9,
            `pointer flick on return: ${away.run("ptr.vx")}, ${away.run("ptr.vy")}`);

  let peak = { rms: 0, drops: 0, bubbles: 0, foam: 0 };
  let ctl  = { rms: 0, drops: 0, bubbles: 0, foam: 0 };
  for (let i = 0; i < 90; i++){
    away.frame(1 / 60); control.frame(1 / 60);
    for (const [who, tgt] of [[away, peak], [control, ctl]]){
      const q = who.state();
      tgt.rms = Math.max(tgt.rms, q.rms); tgt.drops = Math.max(tgt.drops, q.drops);
      tgt.bubbles = Math.max(tgt.bubbles, q.bubbles); tgt.foam = Math.max(tgt.foam, q.foam);
    }
  }
  // The coming-back glass is calmer than one that was never away (it was
  // still), and spawns no more. Measured: see the report in the commit; the
  // bounds below are a flick's worth of difference, not noise.
  assert.ok(peak.rms <= ctl.rms * 1.25 + 0.5, `surface energy ${peak.rms} against ${ctl.rms}`);
  assert.ok(peak.drops <= ctl.drops + 10, `drops ${peak.drops} against ${ctl.drops}`);
  assert.ok(peak.bubbles <= ctl.bubbles * 1.25 + 10, `bubbles ${peak.bubbles} against ${ctl.bubbles}`);
});

test("a glass not yet poured goes on pouring while away", () => {
  const s = loadSim({ seed: 3 });
  s.layoutEmpty();
  s.run("poured = false; glassAway = true");
  const target = s.state().target;
  s.frames(1, 60);
  const mid = s.state().level;
  assert.ok(mid > 0 && mid < target, `level ${mid} should be part way to ${target}`);
  s.frames(5, 60);
  assert.equal(s.state().level, target);
});
