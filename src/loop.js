/* The frame loop and page controls, for whichever renderer the page was built
   with. Inlined after that renderer's render.js, which leaves this in the
   global renderer:

     render()        draw the whole scene as the simulation stands
     resize()        measure the stage, size the canvases at the device pixel
                     ratio (capped by the renderer) times quality, and lay the
                     glass out again (relayout, remesh)
     buildPalette()  work the colours out again from cfg and the theme
     chips()         optional: show the state of the renderer's own controls
     lost()          optional: true while the renderer cannot draw at all (the
                     shader's WebGL context taken away)

   With no renderer (the shader page without WebGL2) none of this runs and the
   page offers the canvas version. */
"use strict";
(() => {
const R = renderer;
if (!R) return;

const draw = () => { stale = false; R.render(); };

/* Something changed outside the frame's own updates. A paused scene is drawn
   now and any other by the next frame. */
const changed = () => { stale = true; if (!cfg.running) draw(); };

/* ================================================================== *
 * Quality
 * ================================================================== *
 * Resolution drops when frames cannot keep up with the display and rises after
 * a long run with room to spare.
 *
 * Frames are judged against the display's own interval. That is the quickest
 * pace held over the last minute, or the pace of frames that draw nothing
 * (paused, or the glass put away), which is the display's alone. The estimate
 * can rise as well as fall, so a window moved to a slower display is not read
 * as a page that has slowed down.
 *
 * Frames are gathered in half-second windows read by their median, so one long
 * frame does nothing and a run does. Quality drops when every window for three
 * seconds is slower than SLOW intervals, or than SLOW_MS on any display: no
 * display in use refreshes slower than about 48 Hz, so a steady 25 ms is a
 * page that cannot keep up, however it started.
 *
 * A drop is a trial. Frames arrive on the display's beat, so one step may not
 * be enough to reach the next beat; if the frames are no quicker the next step
 * is tried. If the lowest step is no quicker either, resolution was not the
 * cause (a slower display, or the processor), so the trial is undone, the pace
 * is taken as the display's, and no further drop is tried.
 *
 * Quality rises a step after half a minute inside GOOD intervals, at most once
 * a minute, and a rise that ends in a drop is not tried again.
 *
 * A quality change is a resize that reallocates every buffer, so changes are
 * at least MIN_GAP seconds apart. No frame counts for a second after a resize
 * or the tab returning. A frame over a quarter of a second is a gap (hidden
 * tab, debugger, machine waking) and discards its window. */
const QUALITY = [1, 0.8, 0.62];
const gov = (() => {
  const WINDOW = 500;          /* ms of frames in a window */
  const GAP = 250;             /* ms: longer than this is a gap, not a frame */
  const SETTLE = 1000;         /* ms of frames let pass after a resize */
  const SLOW = 1.75, GOOD = 1.2;          /* display intervals */
  const SLOW_MS = 22;                     /* and a floor, whatever the display */
  const SLOW_FOR = 3, GOOD_FOR = 30;      /* seconds */
  const MIN_GAP = 5, UP_EVERY = 60;       /* seconds */
  const KEEP = 120;                       /* windows of pace remembered: a minute */
  const HELPED = 0.9;                     /* a drop must cut the frame time to this */

  let step = 0;
  let refresh = 0;             /* the display's interval, ms; 0 until seen */
  let lows = [];               /* the quick end of each recent window */
  let win = [], winMs = 0, prevLow = 0;
  let idle = [];               /* frames that drew nothing */
  let settle = SETTLE;
  let slowFor = 0, goodFor = 0;
  let t = 0, changedAt = 0, upAt = -Infinity;
  let lastUp = false, noUp = false, noDown = false;
  let trial = null;            /* while a drop is on trial: the median and step before it */

  const median = a => a.sort((x, y) => x - y)[a.length >> 1];
  /* a pace the page held: remembered for a minute */
  function seen(ms){
    if (ms < 3.5) return;
    lows.push(ms);
    if (lows.length > KEEP) lows.shift();
    refresh = Math.min(...lows);
  }
  /* a pace known to be the display's: it replaces what was remembered */
  function known(ms){
    if (ms < 3.5) return;
    lows = [ms];
    refresh = ms;
  }

  function setStep(to){
    if (to > step && lastUp) noUp = true;     /* the last rise did not hold */
    lastUp = to < step;
    if (lastUp) upAt = t;
    step = to;
    changedAt = t;
    slowFor = 0; goodFor = 0;
    quality = QUALITY[step];
    resizeNow();
  }

  function judge(){
    const n = win.length, s = win.sort((x, y) => x - y);
    const secs = winMs / 1000;
    const low = s[n >> 2], med = s[n >> 1];
    win = []; winMs = 0;
    if (prevLow) seen(Math.max(low, prevLow));
    prevLow = low;
    if (!refresh) return;
    t += secs;
    const ratio = med / refresh;
    if (ratio > SLOW || med > SLOW_MS){ slowFor += secs; goodFor = 0; }
    else if (ratio < GOOD){ goodFor += secs; slowFor = 0; }
    else { slowFor = 0; goodFor = 0; }
    if (t - changedAt < MIN_GAP) return;
    if (trial){
      if (med <= trial.med * HELPED) trial = null;
      else if (step < QUALITY.length - 1){ setStep(step + 1); return; }
      else {
        noDown = true;
        known(med);
        setStep(trial.step);
        lastUp = false;           /* an undone trial is not a rise that may fail */
        trial = null;
        return;
      }
    }
    if (slowFor >= SLOW_FOR && step < QUALITY.length - 1 && !noDown){ trial = {med, step}; setStep(step + 1); }
    else if (goodFor >= GOOD_FOR && step > 0 && !noUp && t - upAt >= UP_EVERY) setStep(step - 1);
  }

  return {
    /* a frame that was stepped and drawn, with ms since the last */
    frame(ms){
      if (ms > GAP || !(ms > 0)){ win = []; winMs = 0; prevLow = 0; settle = SETTLE; return; }
      if (settle > 0){ settle -= ms; return; }
      win.push(ms);
      winMs += ms;
      if (winMs >= WINDOW && win.length >= 4) judge();
    },
    /* a frame that drew nothing: it shows the display's speed, not the scene's
       weight */
    idle(ms){
      if (ms > GAP || !(ms > 0)){ idle = []; return; }
      idle.push(ms);
      if (idle.length >= 30){ known(median(idle)); idle = []; }
    },
    /* gathered data is out of date: let a second pass first */
    settle(){ win = []; winMs = 0; prevLow = 0; slowFor = 0; goodFor = 0; settle = SETTLE; }
  };
})();

/* Lay the canvases out again and reset the governor. */
function resizeNow(){
  R.resize();
  stale = true;
  gov.settle();
}

/* ================================================================== *
 * Loop
 * ================================================================== */
let last = performance.now();
let wasIdle = false;

function frame(now){
  requestAnimationFrame(frame);
  const gap = now - last;           /* ms, as it came: the governor wants the long ones */
  last = now;
  const real = clamp(gap / 1000, 0, 0.25);

  /* Pace is a clock, not a force. Every step below gets the same scaled second,
     so waves, pour, bubbles and beading slow together and stay in step. The
     governor takes real time, as it watches the machine, not the beer. */
  const dt = real * ((cfg.pace ?? 100) / 100);

  /* real seconds, not paced: the change of beer follows the card turning, not
     the beer's speed */
  const tuning = !!tune;
  if (tuning) tuneStep(real);

  /* The glass put away behind a card is kept ready (see idleGlass) and drawn only
     when the room changes: its first absent frame, a new size or palette, or a
     beer being tuned in, whose colour is on the walls. */
  if (glassIdle()){
    idleGlass(dt);
    if (stale || tuning || !wasIdle) draw(); else gov.idle(gap);
    wasIdle = true;
    return;
  }
  if (wasIdle){ wasIdle = false; stale = true; }

  /* Paused, the scene is still drawn when it changes and the first pour still
     runs to the line. */
  if (!cfg.running){
    if (level < targetLevel() - 0.0005){
      updateLevel(Math.min(dt, 0.05));
      stale = true;
    }
    if (stale || tuning) draw(); else gov.idle(gap);
    return;
  }

  clock += real;
  trackPointer();
  updateLevel(dt);
  stepWavesFor(dt);
  tiltNow += (tiltWant - tiltNow) * Math.min(1, dt * 6);
  pointerForces(dt);
  tiltForces(dt);
  ambient(dt);
  spillOverRim(dt);
  updateBubbles(dt);
  updateFoam(dt);
  updateDrops(dt);
  updateDew(dt);
  updateLace(dt);
  draw();

  if (R.lost && R.lost()) gov.settle(); else gov.frame(gap);
}
document.addEventListener("visibilitychange", () => gov.settle());

/* ================================================================== *
 * Controls
 * ================================================================== */
document.querySelectorAll("[data-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    /* cleared first: a recipe naming a colour keeps it, one without goes back to
       the hue slider */
    cfg.beerHex = null;
    Object.assign(cfg, PRESETS[btn.dataset.preset]);
    cfg.preset = btn.dataset.preset;
    syncInputs();
    changed();
  });
});

function applyTheme(){
  if (cfg.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = cfg.theme;
  paletteHook();
  changed();
}
document.querySelectorAll("[data-counter]").forEach(btn => {
  btn.addEventListener("click", () => {
    cfg.counter = btn.dataset.counter;
    syncChips(); save();
    changed();
  });
});

document.querySelectorAll("[data-theme-set]").forEach(btn => {
  btn.addEventListener("click", () => { cfg.theme = btn.dataset.themeSet; applyTheme(); syncChips(); save(); });
});
mqDark.addEventListener("change", () => { paletteHook(); changed(); });

const tiltRow = document.getElementById("tiltRow");
const tiltBtn = document.getElementById("tiltBtn");
/* Desktop browsers have the interface without the hardware, so the control is
   shown only where the pointer says there is a device to tilt. */
if (isCoarse && typeof DeviceOrientationEvent !== "undefined") tiltRow.hidden = false;
/* Permission can only be asked from a tap, so a remembered setting reattaches
   quietly where it can and otherwise waits for one. */
if (cfg.tilt && !tiltAsks) tiltListen();
tiltBtn.addEventListener("click", async () => {
  if (cfg.tilt){ cfg.tilt = false; }
  else if (await tiltEnable()){ cfg.tilt = true; }
  else { tiltBtn.textContent = "Blocked"; save(); return; }
  syncChips(); save();
});

const motionBtn = document.getElementById("motionBtn");
motionBtn.addEventListener("click", () => {
  cfg.running = !cfg.running;
  if (cfg.running){ last = performance.now(); gov.settle(); }
  syncChips(); save();
});

function syncChips(){
  document.querySelectorAll("[data-preset]").forEach(b =>
    b.setAttribute("aria-pressed", String(cfg.preset === b.dataset.preset)));
  document.querySelectorAll("[data-theme-set]").forEach(b =>
    b.setAttribute("aria-pressed", String(cfg.theme === b.dataset.themeSet)));
  document.querySelectorAll("[data-counter]").forEach(b =>
    b.setAttribute("aria-pressed", String(cfg.counter === b.dataset.counter)));
  motionBtn.setAttribute("aria-pressed", String(cfg.running));
  motionBtn.textContent = cfg.running ? "Running" : "Paused";
  tiltBtn.setAttribute("aria-pressed", String(cfg.tilt));
  tiltBtn.textContent = cfg.tilt ? "On" : "Off";
  if (R.chips) R.chips();
}

document.getElementById("reset").addEventListener("click", () => {
  Object.assign(cfg, HOUSE, {preset:"helles"});
  syncInputs();
  resizeNow();
  changed();
});

/* ================================================================== *
 * Boot
 * ================================================================== */
redraw = changed;
paletteHook = () => { R.buildPalette(); stale = true; };
chipsHook = syncChips;
resizeHook = resizeNow;
buildSliders();
loadTuning();
applyTheme();
setPanel(params.get("panel") === "1");
syncChips();

let resizeTimer = 0;
/* The stage can change size with no window event (font arriving, panel
   opening, scrollbar). The canvases are sized from it, so unless it is
   re-measured the backing store is stretched and anything in the element's own
   space falls out of line, including the foam's CSS clip path, which must cut
   after the goo filter. Observing the box catches every case, the window
   resize event only one. */
const restage = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { resizeNow(); fitWordmark(); changed(); }, 120);
};
if (typeof ResizeObserver === "function") new ResizeObserver(restage).observe(document.getElementById("stage"));
window.addEventListener("resize", restage);
resizeNow();
fitWordmark();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitWordmark);

settleStill();

draw();
requestAnimationFrame(frame);

startCard();
})();
