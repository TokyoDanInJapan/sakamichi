/* Groundwork for the simulation: renderer seams, saved settings, small
   arithmetic and the page size. The files in src/sim/ are inlined into one
   script in the order core, layout, surface, weep, particles, input, colour,
   tuning, controls. Each renderer's recipe.js (SPECS, HOUSE, PRESETS,
   STORE_KEY, PALETTE_KEYS, cfg, params) comes before them. splash.js,
   page.js, the renderer's render.js (which registers itself as renderer) and
   loop.js come after. */
"use strict";

/* Seams the frame loop fills in at boot: redraw the scene (at once if paused),
   rebuild the palette, refresh the chips, re-lay the canvases. */
let redraw = () => {}, paletteHook = () => {}, chipsHook = () => {}, resizeHook = () => {};
/* What the renderer's render.js hands loop.js: see the top of loop.js. */
let renderer = null;
/* Set when something changes outside the frame's own updates. A running glass
   is drawn every frame anyway, so this is for a paused scene and for a glass
   put away behind a card. */
let stale = true;
/* Scene time in real seconds, which every drifting thing is drawn from. The
   frame loop advances it only while the glass runs. */
let clock = 0;

/* Defaults for settings the page's recipe has no slider for, as the renderers
   do not share every control. A missing key reads as full strength. */
const CFG_DEFAULTS = {glassLine:100, bubbleBreak:100, weep:100, weepAlpha:100,
                      beerAlpha:100, reflect:100, dewSize:100};
for (const k in CFG_DEFAULTS) if (cfg[k] == null) cfg[k] = CFG_DEFAULTS[k];

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
if (reduceMotion.matches) cfg.running = false;
/* Hold is never saved or restored. A saved hold would freeze the card on
   every later visit, and on a phone there is no Hold button to undo it. */
cfg.hold = false;

const save = () => {
  clearTimeout(saveTimer); saveTimer = 0;
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(cfg, (k, v) => k === "hold" ? undefined : v)); }catch(e){}
};
/* A dragged slider changes many times a second and only its last value
   matters, so the write is delayed and also done on pagehide. */
let saveTimer = 0;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); };
addEventListener("pagehide", () => { if (saveTimer) save(); });

const TAU = Math.PI * 2;
const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
const rand  = (a,b) => a + Math.random() * (b - a);
const lerp  = (a,b,t) => a + (b - a) * t;
/* The tuning was done at 60 frames a second. Per-frame rates are written for
   that and rescaled to the real frame: frames(dt) counts sixtieths of a
   second. */
const frames = dt => dt * 60;
/* A factor per sixtieth taken over dt: 0.9 stays 0.9 at 60 Hz and is gentler
   at 144 Hz, with the same per-second result. */
const decay = (k, dt) => Math.pow(k, frames(dt));
/* A chance per sixtieth taken over dt. Linear in dt, so the count per second
   is frame-rate independent, except below 60 Hz where it is capped at 1. */
const chance = (p, dt) => Math.min(1, p * frames(dt));

let W = 0, H = 0, dpr = 1, quality = 1;
const isCoarse = matchMedia("(pointer: coarse)").matches;
