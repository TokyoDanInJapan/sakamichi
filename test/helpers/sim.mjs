// Loads the page's simulation into a node:vm context with browser stubs, so the
// tests can run it headless and deterministically. Standard library only.
//
// The page's scripts are classic scripts sharing one global scope. The same is
// done here: each file is run, in the order src/page.html inlines them, in one
// context, so a top-level `let` in one file is visible to the next, and to the
// code the tests run afterwards with sim.run().
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const srcDir = join(root, "src");

/* The files to load, taken from the @inline lines of src/page.html rather than
   named here, so a later split or reorder cannot leave the tests running a
   different simulation from the page. Only the renderer's recipe and src/sim/
   are wanted: the rest of the page's scripts need a real document. */
export function simFiles(renderer = "canvas"){
  const html = readFileSync(join(srcDir, "page.html"), "utf8");
  const files = [];
  for (const m of html.matchAll(/<!-- @inline (\S+) -->/g)){
    const p = m[1].replace("{{renderer}}", renderer);
    if (p === renderer + "/recipe.js" || (p.startsWith("sim/") && p.endsWith(".js"))) files.push(p);
  }
  if (files.length < 5 || files[0] !== renderer + "/recipe.js"){
    throw new Error("page.html no longer inlines the recipe and src/sim/ the way the tests expect: " + files.join(", "));
  }
  return files;
}

/* A stand-in for any element or DOM object: every property is another stand-in,
   and it may be called. Enough for scripts that build controls at load. */
function stub(){
  const f = function(){};
  const p = new Proxy(f, {
    get: (t, k) => k === Symbol.toPrimitive ? () => ""
      : k === "style" ? { setProperty(){} }
      : k === "dataset" ? {}
      : k === "classList" ? { add(){}, remove(){}, toggle(){}, contains: () => false }
      : k === "textContent" || k === "value" ? ""
      : k === "length" ? 0
      : k === "then" ? undefined
      : p,
    set: () => true,
    apply: () => p
  });
  return p;
}

/* mulberry32: small, fast, and the same on every machine */
export function seeded(seed){
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---- One step of the page's frame loop ----------------------------------
   MIRRORS src/loop.js, function frame(), for the glass that is running: the
   order of these calls is the page's, and if loop.js changes, change this.
   The parts that need a renderer or a clock (draw, the quality governor, the
   paused and tuning branches) are left out. The glass put away behind a card
   takes the loop's idle branch. `real` is the frame in seconds. */
const FRAME = `
function __frame(real){
  const dt = real * ((cfg.pace ?? 100) / 100);
  if (glassIdle()){ idleGlass(dt); return; }
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
}`;

/* Options: renderer ("canvas" or "shader"), seed, transform(file, text) to
   alter a file's text before it runs (the mutation checks use it), and
   storage, an object the page may read its saved settings from. */
export function loadSim({ renderer = "canvas", seed = 1, transform = null } = {}){
  const doc = {
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => stub(), createElement: () => stub(),
    createDocumentFragment: () => stub(), addEventListener(){},
    documentElement: { style: { setProperty(){} }, dataset: {} },
    body: { dataset: {} }
  };
  const ctx = vm.createContext({
    console,
    matchMedia: () => ({ matches: false, addEventListener(){} }),
    localStorage: { getItem: () => null, setItem(){} },
    addEventListener(){},
    screen: {},
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    document: doc,
    location: { search: "", hash: "" },
    URLSearchParams,
    performance: { now: () => 0 },
    requestAnimationFrame(){},
    setTimeout: () => 0, clearTimeout(){},
    fetch: () => new Promise(() => {})
  });
  ctx.window = ctx;
  vm.runInContext("Math", ctx).random = seeded(seed);   /* the context's own Math */
  for (const file of simFiles(renderer)){
    let text = readFileSync(join(srcDir, file), "utf8");
    if (transform) text = transform(file, text);
    vm.runInContext(text, ctx, { filename: file });
  }
  vm.runInContext(FRAME, ctx, { filename: "test/helpers/sim.mjs (frame)" });
  const run = code => vm.runInContext(code, ctx);

  return {
    ctx, run,
    /* Lay the glass out for a viewport and fill it to the line, as the page
       does after its first pour. Particles start empty. */
    layout(w = 1440, h = 900, cfgValues = null){
      if (cfgValues) run(`Object.assign(cfg, ${JSON.stringify(cfgValues)})`);
      run(`W = ${w}; H = ${h}; layoutGlass(); remesh(true); level = targetLevel(); poured = true; cfg.running = true;`);
    },
    /* A glass that starts empty, to test the pour and the refill */
    layoutEmpty(w = 1440, h = 900, cfgValues = null){
      if (cfgValues) run(`Object.assign(cfg, ${JSON.stringify(cfgValues)})`);
      run(`W = ${w}; H = ${h}; layoutGlass(); remesh(true); level = 0; poured = true; cfg.running = true;`);
    },
    set(cfgValues){ run(`Object.assign(cfg, ${JSON.stringify(cfgValues)})`); },
    /* One page frame of `real` seconds */
    frame(real){ run(`__frame(${real})`); },
    /* `seconds` of page frames at `hz`, optionally calling hook(t) before each */
    frames(seconds, hz, hook){
      const n = Math.round(seconds * hz), dt = 1 / hz;
      for (let i = 0; i < n; i++){
        if (hook) hook(i * dt, i);
        run(`__frame(${dt})`);
      }
    },
    /* Just the solver, with no frame around it */
    stepWaves(step, n = 1){ run(`for (let i = 0; i < ${n}; i++) stepWaves(${step})`); },
    /* A push to the surface, in the glass's own terms: u from -1 (left wall) to
       +1, force as splash() takes it, radius as a fraction of the half width */
    splash(u, force, radiusFrac = 0.5){
      run(`splash(G.cx + ${u} * G.topHalf, ${force}, G.topHalf * ${radiusFrac})`);
    },
    /* Numbers the tests read, taken off the live arrays */
    state(){
      return run(`(() => {
        grid();
        let m = 0, tot = 0, s2 = 0, hmax = 0, finite = true;
        for (let i = 0; i < N; i++){
          const h = hArr[i];
          if (!Number.isFinite(h)){ finite = false; continue; }
          m += h * areaArr[i]; tot += areaArr[i]; s2 += h * h; hmax = Math.max(hmax, Math.abs(h));
        }
        for (let k = 0; k < N - 1; k++) if (!Number.isFinite(uArr[k])) finite = false;
        if (!Number.isFinite(level) || waveResets > 0) finite = false;
        return { finite, level, target: targetLevel(), scale: G.scale, inH: G.inH, N,
                 mean: tot > 0 ? m / tot : 0,                  /* px, area-weighted */
                 rms: Math.sqrt(s2 / N) / G.scale,              /* surface energy */
                 hmax: hmax / G.scale,
                 bubbles: bubbles.length, foam: foam.length, drops: drops.length,
                 mist: mist.length, lace: lace.length, dew: dew.length };
      })()`);
    },
    /* The steepest face between neighbouring columns, as a slope (dy/dx) */
    maxSlope(){
      return run(`(() => { grid(); let m = 0;
        for (let i = 0; i < N - 1; i++) m = Math.max(m, Math.abs(hArr[i + 1] - hArr[i]) / dxArr[i]);
        return m; })()`);
    }
  };
}

/* A renderer's recipe on its own, for the consistency tests: its sliders
   (SPECS), house recipe (HOUSE), style presets (PRESETS), storage key and the
   keys that need the palette rebuilt */
export function loadRecipe(renderer){
  const ctx = vm.createContext({
    localStorage: { getItem: () => null }, location: { search: "" }, URLSearchParams
  });
  vm.runInContext(readFileSync(join(srcDir, renderer, "recipe.js"), "utf8"), ctx, { filename: renderer + "/recipe.js" });
  /* through JSON, so the objects are this realm's and compare equal to its own */
  return JSON.parse(vm.runInContext("JSON.stringify({ SPECS, HOUSE, PRESETS, STORE_KEY, PALETTE_KEYS })", ctx));
}
export const recipeKeys = renderer => loadRecipe(renderer).SPECS.map(s => s.key);
