/* The pour itself — glass geometry, camera, wave equation, particles and
   controls — shared verbatim by index.html (Canvas 2D) and webgl.html
   (WebGL2). Each page defines its recipe (SPECS, HOUSE, PRESETS,
   STORE_KEY, PALETTE_KEYS) before this file, and its renderer after it,
   handing this file a redraw() to call when a control changes a paused
   scene. */
"use strict";

/* Constants of the mark's artwork, shared by both renderers */
const LOGO_ASPECT = 1889.5428 / 1632.4294;
/* The mark's bars run the full width of its artwork, and the lowest one sits
   on the bottom edge — rasterising at exactly that size would cut its blur off
   square, so both renderers inset it by this in a padded bitmap. */
const LOGO_PAD = 0.08;

/* Seams the renderer fills in at boot: how to repaint a paused scene, rebuild
   its palette, refresh its chips, and re-lay its canvases */
let redraw = () => {}, paletteHook = () => {}, chipsHook = () => {}, resizeHook = () => {};

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
if (reduceMotion.matches) cfg.running = false;

const save = () => { try{ localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); }catch(e){} };

const TAU = Math.PI * 2;
const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
const rand  = (a,b) => a + Math.random() * (b - a);
const lerp  = (a,b,t) => a + (b - a) * t;

let W = 0, H = 0, dpr = 1, quality = 1;
const isCoarse = matchMedia("(pointer: coarse)").matches;

/* ------------------------------------------------------------------ *
 * The glass. Proportions follow a shaker pint: tapered, thick base,
 * with a shallow ellipse at the rim because we look slightly down on it.
 * ------------------------------------------------------------------ */
const G = {
  cx:0, top:0, bottom:0, h:0, topHalf:0, botHalf:0,
  wall:0, baseH:0, inTop:0, inBottom:0, inH:0,
  ryTop:0.13, scale:1
};

function layoutGlass(){
  const compact = W < 1100;
  const bottomAt = compact ? 0.68 : 0.84;      /* where the glass stands */
  const nominal  = compact ? 0.46 : 0.58;      /* its height at the house size */
  /* the camera that gives a house-sized glass the shape it should have here */
  camLens = nominal / (BASE_OPEN - RIM_OPEN);
  camEye  = BASE_OPEN * camLens - bottomAt;
  const maxH = H * nominal * (cfg.glassSize / 100);
  let gh = clamp(maxH, 140, H * 0.80);
  let topHalf = gh * 0.583 / 2;
  const widthCap = W * (compact ? 0.34 : 0.30);
  if (topHalf > widthCap){ topHalf = widthCap; gh = topHalf * 2 / 0.583; }

  G.h = gh;
  G.topHalf = topHalf;
  G.botHalf = topHalf * 0.68;
  G.cx = W / 2;
  G.bottom = H * bottomAt;
  G.top = G.bottom - gh;
  G.wall = Math.max(2.5, topHalf * 0.045);
  G.baseH = gh * 0.06;
  G.inTop = G.top + G.wall * 0.5;
  G.inBottom = G.bottom - G.baseH;
  G.inH = G.inBottom - G.inTop;
  /* The rim ellipse, resolved at the height its own tangent sits at */
  G.ryTop = ryAt(G.top + G.topHalf * ryAt(G.top));
  G.scale = (topHalf * 2) / 300;          /* everything else sizes off this */
}

/* Exterior half width at a given y: straight tapered walls — the base
   ellipse supplies the bottom curve */
function halfAt(y){
  const t = clamp((y - G.top) / G.h, 0, 1);
  return Math.max(1, lerp(G.topHalf, G.botHalf, t));
}
const innerHalfAt = y => Math.max(1, halfAt(y) - G.wall);

/* ------------------------------------------------------------------ *
 * Contents: level is the fraction of the interior that holds beer
 * ------------------------------------------------------------------ */
let level = 0;              /* 0 empty, 1 brim full */
let poured = false;         /* true once it has first reached the fill line */
let N = 0, hArr, vArr, maxAmp = 60;
let bubbles = [], foam = [], drops = [], mist = [], drips = [], sites = [], dew = [], lace = [];
let capBubbles = 300, capFoam = 260, capDew = 90;

const targetLevel = () => cfg.fill / 100;
const restSurfaceY = () => G.inBottom - level * G.inH;

/* Wave columns span the interior at the current surface height */
const spanCache = [0, 0, 0];
let spanKey = NaN;
function surfaceSpan(){
  const y = restSurfaceY();
  if (y !== spanKey){
    spanKey = y;
    const hw = innerHalfAt(y);
    spanCache[0] = G.cx - hw; spanCache[1] = G.cx + hw; spanCache[2] = hw * 2;
  }
  return spanCache;
}

function surfaceAt(x){
  const [l, , w] = surfaceSpan();
  const u = clamp((x - l) / w, 0, 1) * (N - 1);
  const i = Math.floor(u);
  const j = Math.min(N - 1, i + 1);
  const t = u - i;
  return restSurfaceY() + hArr[i] * (1 - t) + hArr[j] * t;
}

/* The camera. One eye level for the whole scene, fixed well above the frame:
   a horizontal circle at eye level projects to a line, and the further one
   sits below it the more open its ellipse. Rim, beer surface, interior floor
   and base all follow this single rule, so resizing the glass swings its rim
   the way moving a real glass would — rather than dragging the camera along
   with it, which is what an ellipse ratio tied to the glass itself does. */
/* Rather than fixing an eye level and a lens outright, the glass is given the
   shape it ought to have — these two, read off the reference photograph — and
   the camera that produces them follows from wherever the layout has stood
   the glass. A narrow screen stands it higher in the frame to leave room for
   the copy, and without this it would be photographed from somewhere else and
   come out a different shape on a phone than on a desk. */
const RIM_OPEN = 0.1397, BASE_OPEN = 0.3155;
let camEye = 0.201, camLens = 3.30;   // both in viewport heights, set by layoutGlass
/* A horizontal circle sitting a depth d below the eye opens to an ellipse of
   ry/rx = d / f. Both the rim and the base take their openness from this one
   camera, so the ratio between them is the eye level's to set and nothing
   else's: sit the eye too high and the base flattens towards the rim, which
   is what told on the glass in the reference photograph — its base opens to
   0.316 where its rim is barely a fifth of that. */
const ryAt = y => clamp((y / Math.max(H, 1) + camEye) / camLens, 0.03, 0.55);
const baseBulge = () => ryAt(G.bottom) * G.botHalf;
/* How much bar top shows behind the glass — a property of the room, so it is
   measured against the viewport, not the glass. Mirrored in the shader. */
const BAR_DEPTH = 0.095;
const horizonY = () => G.bottom + baseBulge() - H * BAR_DEPTH;

/* Foam dries onto the wall of a cylinder, so a speck is held by the angle it
   sits at round that wall and by its height — not by a point on a flat plane.
   From here that gives its place on screen, and how far round it has gone: the
   near wall drops lower and faces us square, the far wall rides higher, and
   towards the sides the wall turns edge-on and foreshortens what is stuck to
   it. Returns x, y, and the cosine that carries both of those. */
function dewPos(d){
  const hw = halfAt(d.h);
  const c = Math.cos(d.th);
  return [G.cx + hw * Math.sin(d.th), d.h + ryAt(d.h) * hw * c, c];
}

function lacePos(l){
  const hw = innerHalfAt(l.h);
  const c = Math.cos(l.th);
  return [G.cx + hw * Math.sin(l.th), l.h + ryAt(l.h) * hw * c, c];
}

/* How far the surface ellipse bulges at this x, front and back */
function ellipseDy(x){
  const [, , w] = surfaceSpan();
  const hw = w / 2;
  const t = (x - G.cx) / hw;
  if (Math.abs(t) >= 1) return 0;
  return ryAt(restSurfaceY()) * hw * Math.sqrt(1 - t * t);
}
const frontY = x => surfaceAt(x) + ellipseDy(x);
const backY  = x => surfaceAt(x) - ellipseDy(x);
const headBand = () => (G.topHalf * 2) * (0.05 + 0.14 * cfg.headDepth / 100);

/* ================================================================== *
 * Surface physics
 * ================================================================== */
function splash(x, force, radius){
  const [l, , w] = surfaceSpan();
  const c = clamp((x - l) / w, 0, 1) * (N - 1);
  const colW = w / (N - 1);
  const span = Math.max(1, radius / colW);
  const i0 = Math.max(0, Math.round(c - span * 2));
  const i1 = Math.min(N - 1, Math.round(c + span * 2));
  for (let i = i0; i <= i1; i++){
    const d = (i - c) / span;
    vArr[i] += force * Math.exp(-d * d * 1.6);
  }
}

function stepWaves(){
  const c2   = 0.18 + (cfg.waveSpeed / 100) * 0.30;
  const rest = 0.0010 + (cfg.waveSpeed / 100) * 0.0040;
  const damp = 0.9998 - (cfg.viscosity / 100) * 0.0200;
  const tf = tiltForce();
  for (let sub = 0; sub < 2; sub++){
    for (let i = 0; i < N; i++){
      const l = hArr[i > 0 ? i - 1 : 0];
      const r = hArr[i < N - 1 ? i + 1 : N - 1];
      vArr[i] += c2 * (l + r - 2 * hArr[i]) - rest * hArr[i]
               + tf * ((i / (N - 1)) - 0.5) * 2;
      vArr[i] *= damp;
    }
    for (let i = 0; i < N; i++) hArr[i] = clamp(hArr[i] + vArr[i], -maxAmp, maxAmp);
  }
}

/* Beer that climbs past the rim leaves the glass */
function spillOverRim(dt){
  const ry = restSurfaceY();
  const rimY = G.inTop;
  const [l, , w] = surfaceSpan();
  const colW = w / (N - 1);
  let lost = 0;

  for (let i = 0; i < N; i++){
    const y = ry + hArr[i];
    if (y >= rimY) continue;
    const excess = rimY - y;
    hArr[i] = rimY - ry;
    if (vArr[i] < 0) vArr[i] *= -0.25;
    lost += excess * colW;

    if (excess > 1.5 && Math.random() < clamp(excess * 0.06, 0.05, 0.75)){
      const x = l + i * colW;
      const outward = Math.sign(x - G.cx) || 1;
      drops.push({
        x, y: rimY - rand(0, 6),
        vx: outward * rand(20, 120) * (0.4 + excess * 0.02),
        vy: -rand(30, 190),
        r: rand(1.4, 4.2) * G.scale, foamy: Math.random() < 0.6, out: true
      });
    }
  }

  if (lost > 0){
    /* Convert the spilled area back into a drop in level */
    const area = Math.max(1, innerHalfAt(ry) * 2 * G.inH);
    level = clamp(level - (lost / area) * 1.3, 0.04, 1);
  }

  /* The head goes over the lip before the beer does, and runs down the glass */
  let foamLost = 0;
  for (let i = foam.length - 1; i >= 0; i--){
    const f = foam[i];
    const fy = surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy;
    if (fy < rimY - f.r * 0.4 && Math.random() < 0.5){
      foamLost += f.r * f.r * Math.PI;
      const hwRim = Math.max(1, innerHalfAt(rimY));
      drips.push({
        th: Math.asin(clamp((f.x - G.cx) / hwRim, -1, 1)),
        h: rimY + rand(2, 10), vy: rand(5, 16) * G.scale,
        r: Math.min(f.r * 0.42, 5 * G.scale),
        len: f.r * rand(0.5, 1.1), life: rand(1.2, 2.8)
      });
      /* Foam that touched the wall dries on as lacing at the high-water mark */
      const specks = 1 + (Math.random() * 3 | 0);
      for (let s = 0; s < specks && lace.length < 90; s++){
        const life = rand(12, 24);
        const hw0 = Math.max(1, innerHalfAt(rimY));
        const base = Math.asin(clamp((f.x + rand(-f.r, f.r) - G.cx) / hw0, -1, 1));
        lace.push({
          th: Math.random() < 0.6 ? base : Math.PI - base,   /* near wall or far */
          h: rimY + rand(2, headBand() * 0.9),
          r: rand(1.2, 2.6) * G.scale + f.r * 0.12, life, max: life
        });
      }
      foam.splice(i, 1);
    }
  }
  /* Foam is beer too, so losing a headful costs some of the pour */
  if (foamLost > 0){
    const area = Math.max(1, innerHalfAt(ry) * 2 * G.inH);
    level = clamp(level - (foamLost / area) * 0.95, 0.04, 1);
  }
}

/* Pour on load, then top the glass back up whenever it is short */
function updateLevel(dt){
  const target = targetLevel();
  if (level >= target - 0.0005){
    level = Math.min(level, target);
    poured = true;
    return;
  }
  /* The first pour is brisk; every top-up after that is slow */
  const rate = poured
    ? 0.004 + (cfg.refill / 100) * 0.045
    : 0.34;
  level = Math.min(target, level + rate * dt);
  if (level >= target - 0.0005) poured = true;
}

/* ================================================================== *
 * Tilt — the phone's own gravity, which the beer answers to
 * ================================================================== */
let tiltWant = 0, tiltNow = 0, tiltLive = false;

/* beta and gamma are the device's own axes, so they have to be turned into
   the page's before the beer can lean the way the phone is leaning */
function onOrient(e){
  if (e.beta == null && e.gamma == null) return;
  const r = Math.PI / 180;
  const a = (((screen.orientation && screen.orientation.angle) || window.orientation || 0)) * r;
  const gx = Math.sin((e.gamma || 0) * r);
  const gy = Math.sin((e.beta  || 0) * r);
  tiltWant = clamp(gx * Math.cos(a) + gy * Math.sin(a), -1, 1);
  tiltLive = true;
}

/* a shake throws the pour about, as knocking the bar would */
function onMotion(e){
  const a = e.acceleration;
  if (!a) return;
  const m = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
  if (m > 11 && level > 0.02){
    splash(G.cx + rand(-1, 1) * G.topHalf * 0.6, clamp(m * 0.12, 0.4, 4) * (cfg.agitation / 100),
           G.topHalf * rand(0.4, 0.9));
  }
}

const tiltAsks = typeof DeviceOrientationEvent !== "undefined" &&
                 typeof DeviceOrientationEvent.requestPermission === "function";

function tiltListen(){
  window.addEventListener("deviceorientation", onOrient, {passive:true});
  window.addEventListener("devicemotion", onMotion, {passive:true});
}

async function tiltEnable(){
  try{
    if (tiltAsks){
      const ok = await DeviceOrientationEvent.requestPermission();
      if (ok !== "granted") return false;
      if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission){
        await DeviceMotionEvent.requestPermission().catch(() => {});
      }
    }
    tiltListen();
    return true;
  }catch(e){ return false; }
}

/* How hard the beer is pulled downhill. It is a standing force, not a nudge,
   so the surface settles at a lean and sloshes on the way there. */
function tiltForce(){
  return cfg.tilt && tiltLive ? tiltNow * 0.22 * (cfg.agitation / 100) : 0;
}

/* ================================================================== *
 * Pointer
 * ================================================================== */
const ptr = {x:-999, y:-999, lx:-999, ly:-999, vx:0, vy:0, inside:false, held:false};
const overChrome = el => !!(el && el.closest && el.closest(".panel, .panel-toggle, .btn, .info"));
const inGlass = (x, y) => y > G.top && y < G.inBottom && Math.abs(x - G.cx) < innerHalfAt(y) + 40;

window.addEventListener("pointermove", e => {
  ptr.x = e.clientX; ptr.y = e.clientY;
  ptr.inside = !overChrome(e.target);
}, {passive:true});
document.addEventListener("pointerleave", () => { ptr.inside = false; }, {passive:true});
window.addEventListener("pointerdown", e => {
  if (overChrome(e.target)) return;
  ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true; ptr.held = true;
  const sy = surfaceAt(ptr.x);
  if (inGlass(ptr.x, ptr.y) && ptr.y > sy - 70){
    const power = 1 + cfg.agitation / 100;
    splash(ptr.x, 3.4 * power, G.topHalf * 0.5);
    burstDrops(ptr.x, sy, 6 + Math.round(power * 5));
    for (let i = 0; i < 16; i++){
      addBubble(ptr.x + rand(-1, 1) * G.topHalf * 0.4, sy + rand(20, 140) * G.scale, rand(1, 4.5));
    }
    for (let i = 0; i < 8; i++) addFoam(ptr.x + rand(-1, 1) * G.topHalf * 0.5, rand(6, 16) * G.scale);
  }
}, {passive:true});
window.addEventListener("pointerup", () => { ptr.held = false; }, {passive:true});

function pointerForces(dt){
  if (!ptr.inside || cfg.agitation === 0) return;
  const agit = cfg.agitation / 100;
  const sy = surfaceAt(ptr.x);
  const depth = ptr.y - sy;
  const speed = Math.hypot(ptr.vx, ptr.vy);
  const reach = G.topHalf * 1.6;
  if (Math.abs(ptr.x - G.cx) > reach) return;
  /* Below the floor of the glass the pointer is over the bar top. The
     reflection there is a picture of the pour, not the pour itself, so
     nothing it passes over should stir, spawn or splash. */
  if (ptr.y > G.inBottom + 12) return;

  if (depth > -70 && depth < G.inH * 1.1 && speed > 0.2){
    const near = 1 - clamp(Math.abs(depth) / (G.inH * 0.9), 0, 1);
    const rate = 1 / Math.max(dt, 0.004);
    const force = clamp((ptr.vy * 0.10 + Math.sign(ptr.vy || 1) * speed * 0.022) * rate / 60, -6.5, 6.5)
                * agit * (0.35 + near * 0.65) * (dt * 60);
    splash(ptr.x, force, G.topHalf * 0.35 + speed * 0.9);
    if (ptr.held) splash(ptr.x, force * 0.4, G.topHalf);
  }
  /* Dragging sideways through the beer drives the sloshing mode: it piles up
     on the leading wall, which is how a pint actually goes over the rim. */
  if (depth > -20 && depth < G.inH * 0.8 && Math.abs(ptr.vx) > 0.5){
    const nearTop = 1 - clamp(Math.max(0, depth) / (G.inH * 0.7), 0, 1);
    /* Clamp the pointer's speed, not its per-frame step, so the glass is just
       as easy to slosh at 30fps as at 144. */
    const vps = ptr.vx / Math.max(dt, 0.004);
    const tilt = clamp(vps * 0.00167, -5.4, 5.4) * agit * (0.35 + nearTop * 0.65) * (dt * 60);
    for (let i = 0; i < N; i++){
      vArr[i] += tilt * ((i / (N - 1)) - 0.5) * 2;
    }
  }

  if (depth > -10 && depth < G.inH * 1.05){
    const R = (90 + speed * 2.2) * G.scale;
    for (const b of bubbles){
      const dx = b.x - ptr.x, dy = b.y - ptr.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < R * R){
        const w = (1 - Math.sqrt(d2) / R) * agit;
        b.vx += ptr.vx * 9 * w;
        b.vy -= ptr.vy * 4 * w;
      }
    }
    if (speed > 1.2){
      const n = Math.min(5, Math.round(speed * 0.18 * agit));
      for (let i = 0; i < n; i++){
        addBubble(ptr.x + rand(-30, 30) * G.scale, ptr.y + rand(-20, 40) * G.scale, rand(0.9, 3.4));
      }
    }
  }
  if (depth < 40 && depth > -80){
    for (const f of foam){
      const dx = f.x - ptr.x;
      const R2 = G.topHalf * 0.8;
      if (Math.abs(dx) < R2){
        const w = (1 - Math.abs(dx) / R2) * agit;
        f.vx += ptr.vx * 7 * w;
        f.oy -= Math.abs(ptr.vy) * 0.06 * w;
      }
    }
  }
}

/* ================================================================== *
 * Contents: bubbles, head, spills
 * ================================================================== */
function addBubble(x, y, r){
  if (bubbles.length >= capBubbles) return;
  const lim = innerHalfAt(y) - 2;
  bubbles.push({
    x: clamp(x, G.cx - lim, G.cx + lim), y,
    r: r * (0.35 + cfg.bubbleSize / 100 * 0.85) * G.scale,
    vx: 0, rise: rand(0.85, 1.35), ph: Math.random() * TAU, wob: rand(3, 12) * G.scale
  });
}

function foamRadius(depth){
  /* Mostly small bubbles with the odd larger cluster — a real head is fine-grained */
  const t = Math.random();
  const big = t > 0.93 ? rand(1.3, 1.7) : t > 0.6 ? rand(0.9, 1.3) : rand(0.45, 0.9);
  return clamp((3 + 6.5 * depth * big) * G.scale, 2.2, 17 * G.scale);
}

function addFoam(x, r){
  if (foam.length >= capFoam) return;
  /* Lift tops out below the band height, so the settled outline stays level */
  const lift = rand(-0.25, 0.88);
  const band = headBand();
  const oy = -(r * 0.45 + lift * band) + rand(-3, 3);
  /* The wall that holds it is the one at the height it rides at: measured at
     the rest level instead, a swell pens the head in and a trough lets it out. */
  const lim = Math.max(4, innerHalfAt(surfaceAt(x) - ellipseDy(x) * 0.4 + oy) - r * 0.18);
  foam.push({
    x: clamp(x, G.cx - lim, G.cx + lim),
    oy,
    vy: rand(-6, 2), vx: rand(-4, 4), r, lift,
    cell: Math.random(), cellR: rand(0.48, 0.78),
    seed: Math.random() * TAU, life: rand(4, 11)
  });
}

function burstDrops(x, y, n){
  for (let i = 0; i < n; i++){
    drops.push({
      x: x + rand(-20, 20) * G.scale, y: y - rand(0, 10),
      vx: rand(-120, 120) * G.scale, vy: -rand(120, 380) * G.scale,
      r: rand(1.6, 5.2) * G.scale, foamy: Math.random() < 0.45, out: false
    });
  }
  for (let i = 0; i < n * 0.9; i++){
    mist.push({
      x: x + rand(-36, 36) * G.scale, y: y - rand(0, 22),
      vx: rand(-50, 50) * G.scale, vy: rand(-150, -40) * G.scale,
      r: rand(0.5, 1.3) * G.scale, life: rand(0.4, 1.1)
    });
  }
}

function updateBubbles(dt){
  const fizz = cfg.carbonation / 100;
  const pouring = level < targetLevel() - 0.01 ? 2.6 : 1;
  for (const s of sites){
    s.acc += dt * s.rate * fizz * pouring;
    while (s.acc >= 1){
      s.acc -= 1;
      addBubble(G.cx + s.u + rand(-3, 3), G.inBottom - rand(1, 8), rand(0.7, 3.2) * s.scale);
    }
  }
  if (Math.random() < dt * 20 * fizz){
    const y = rand(restSurfaceY() + 20, G.inBottom);
    addBubble(G.cx + rand(-1, 1) * innerHalfAt(y) * 0.9, y, rand(0.5, 2.2));
  }

  for (let i = bubbles.length - 1; i >= 0; i--){
    const b = bubbles[i];
    b.ph += dt * 3.4;
    b.r += dt * 0.16 * G.scale;
    b.vx *= 0.90;
    b.x += (b.vx + Math.sin(b.ph) * b.wob) * dt;
    b.y -= (48 + b.r * 26 / G.scale) * b.rise * G.scale * dt;

    /* Keep them inside the walls */
    const lim = innerHalfAt(b.y) - b.r - 1;
    if (b.x < G.cx - lim){ b.x = G.cx - lim; b.vx *= -0.4; }
    if (b.x > G.cx + lim){ b.x = G.cx + lim; b.vx *= -0.4; }

    const sy = frontY(b.x);
    if (b.y - b.r * 0.6 <= sy || b.y < G.inTop - 30){
      if (b.y - b.r <= sy){
        splash(b.x, -Math.min(0.5, b.r * 0.07), (14 + b.r * 3));
        addFoam(b.x, clamp(b.r * 2.1 + 3, 3, 24 * G.scale));
        if (b.r > 3.4 * G.scale && Math.random() < 0.22){
          mist.push({x:b.x, y:sy, vx:rand(-24,24)*G.scale, vy:rand(-90,-25)*G.scale, r:rand(.6,1.4)*G.scale, life:rand(.3,.8)});
        }
      }
      bubbles.splice(i, 1);
    }
  }
}

function updateFoam(dt){
  const depth = cfg.headDepth / 100;
  const churn = cfg.foamChurn / 100;
  /* Malt and alcohol thin the bubble walls: a bock head dies faster than a pilsner's */
  const malt = 0.8 + (cfg.richness / 100) * 0.6;
  const band = headBand();
  const hw = innerHalfAt(restSurfaceY());
  const target = Math.round(clamp(hw / 3.2, 14, capFoam) * (0.25 + depth * 0.95));

  let spawn = Math.min(8, target - foam.length);
  while (spawn-- > 0){
    /* placed by its share of the width the glass has where the head is riding,
       so the crest reaches the wall and the trough is not overfilled */
    const u = rand(-0.98, 0.98);
    const ride = innerHalfAt(surfaceAt(G.cx + u * hw));
    addFoam(G.cx + u * Math.max(4, ride), foamRadius(depth));
  }

  for (let i = foam.length - 1; i >= 0; i--){
    const f = foam[i];
    f.life -= dt * (0.55 + (1 - depth) * 0.9) * malt;
    f.seed += dt * (1.4 + churn * 2.6);

    const rest = -(f.r * 0.45 + f.lift * band);
    f.vy += (rest - f.oy) * 26 * dt;
    f.vy *= 0.90;
    f.oy += f.vy * dt + Math.sin(f.seed * 2.1) * churn * 14 * G.scale * dt;

    f.vx *= 0.93;
    f.x += (f.vx + Math.sin(f.seed * 0.8 + f.r) * churn * 5) * dt;

    /* The head is held by the walls, not wrapped around them — by the wall at
       the height this blob rides at, which a swell and a trough both move */
    const lim = Math.max(4, innerHalfAt(surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy) - f.r * 0.18);
    if (f.x < G.cx - lim){ f.x = G.cx - lim; f.vx *= -0.5; }
    if (f.x > G.cx + lim){ f.x = G.cx + lim; f.vx *= -0.5; }

    f.r -= dt * (0.35 + (1 - depth) * 1.1) * (churn * 0.5 + 0.7) * malt * G.scale;
    if (f.r < 2.2 * G.scale || f.life < 0) foam.splice(i, 1);
  }
}

function updateDrops(dt){
  for (let i = drops.length - 1; i >= 0; i--){
    const d = drops[i];
    d.vy += 1150 * G.scale * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;

    const outsideGlass = Math.abs(d.x - G.cx) > innerHalfAt(d.y);
    if (!d.out && !outsideGlass && d.vy > 0 && d.y > frontY(d.x)){
      splash(d.x, 0.5 + d.r * 0.16 / G.scale, 18 + d.r * 4);
      if (d.foamy) addFoam(d.x, d.r * 2);
      drops.splice(i, 1);
    } else if (d.y > G.bottom + baseBulge() - 2){
      /* Landed on the bar */
      mist.push({x:d.x, y:G.bottom + baseBulge() - 2, vx:rand(-30,30)*G.scale, vy:-rand(20,70)*G.scale, r:d.r*0.5, life:rand(.2,.5)});
      drops.splice(i, 1);
    } else if (d.x < -40 || d.x > W + 40){
      drops.splice(i, 1);
    }
  }
  for (let i = mist.length - 1; i >= 0; i--){
    const m = mist[i];
    m.life -= dt;
    m.vy += 240 * G.scale * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.life <= 0) mist.splice(i, 1);
  }
  for (let i = drips.length - 1; i >= 0; i--){
    const d = drips[i];
    d.life -= dt;
    d.vy += 34 * G.scale * dt;
    d.h += d.vy * dt;
    d.len = Math.min(d.len + d.vy * dt * 0.3, 26 * G.scale);
    if (d.life <= 0 || d.h > G.bottom - G.baseH * 0.3) drips.splice(i, 1);
  }
}

/* Condensation beads on the cold outside of the glass, below the beer line */
function addDew(r){
  /* Even in angle round the face we can see, which is what crowds the beads
     towards the sides where the glass turns away — spread evenly across the
     width instead, they read as beads on a pane standing behind the glass. */
  dew.push({
    th: rand(-1, 1) * Math.PI * 0.5,
    h: rand(restSurfaceY() + 8, G.bottom - G.baseH * 1.5),
    r: r * G.scale, rt: r * G.scale, grow: rand(0.03, 0.12) * G.scale,
    slip: rand(3.4, 4.6) * G.scale, vy: 0
  });
}

function updateDew(dt){
  const amount = clamp(cfg.condensation / 100, 0, 2);
  if (!amount){ dew.length = 0; return; }
  const want = Math.min(Math.round(capDew * amount), 180);
  if (poured && dew.length < want && Math.random() < dt * 30 * amount) addDew(rand(0.7, 1.6));

  for (let i = dew.length - 1; i >= 0; i--){
    const d = dew[i];
    d.rt += d.grow * dt;
    d.r += (d.rt - d.r) * Math.min(1, dt * 9);     /* eases towards its target */
    if (d.r > d.slip || d.vy > 0){
      /* Grown too heavy: the bead lets go and runs. A big bead runs faster. */
      const top = (55 + 45 * Math.min(2, d.r / (2.5 * G.scale))) * G.scale;
      d.vy = Math.min(d.vy + 70 * G.scale * dt, top);
      d.h += d.vy * dt;
      d.rt = Math.max(d.rt - dt * 0.8 * G.scale, 1.4 * G.scale);
      if (d.h > G.bottom - G.baseH * 0.8) dew.splice(i, 1);
    }
  }

  /* A running bead sweeps up whatever it touches. The two volumes add, so the
     radius grows as their cube root, and the heavier bead runs on faster —
     which is how one trail down cold glass gathers the beads in its path. */
  let merged = null;
  for (let i = 0; i < dew.length; i++){
    const d = dew[i];
    if (d.vy <= 0 || (merged && merged.has(i))) continue;
    for (let j = 0; j < dew.length; j++){
      if (j === i || (merged && merged.has(j))) continue;
      const o = dew[j];
      const dx = (o.th - d.th) * halfAt(d.h), dy = o.h - d.h, rr = d.r + o.r;
      if (dx * dx + dy * dy > rr * rr) continue;
      const v1 = d.rt * d.rt * d.rt, v2 = o.rt * o.rt * o.rt, vs = v1 + v2;
      /* the volume arrives at once, but the bead only swells into it, and
         drifts towards the joint centre instead of jumping to it */
      d.rt = Math.cbrt(vs);
      const pull = 0.35 * v2 / vs;
      d.th += (o.th - d.th) * pull;
      d.h += (o.h - d.h) * pull;
      d.slip = Math.min(d.slip, d.rt);         /* stays running once gathered */
      (merged || (merged = new Set())).add(j);
    }
  }
  if (merged) dew = dew.filter((_, k) => !merged.has(k));
}

/* Lacing fades slowly in the air, quickly once the refill submerges it */
function updateLace(dt){
  for (let i = lace.length - 1; i >= 0; i--){
    const l = lace[i];
    const [lx, ly] = lacePos(l);
    l.life -= dt * (ly > surfaceAt(lx) ? 6 : 1);
    if (l.life <= 0) lace.splice(i, 1);
  }
}

let idleAcc = 0;
function ambient(dt){
  idleAcc += dt;
  if (idleAcc > 1.1){
    idleAcc = 0;
    splash(G.cx + rand(-1, 1) * G.topHalf, rand(-0.16, 0.16), G.topHalf * rand(0.4, 1.2));
  }
}

/* Large behind the glass, standing just above the bar so it reflects in it.
   A slow counter-parallax against the pointer sets it a step further back. */
let parX = 0, parY = 0;
/* The page's own gutter — the same clamp(20px, 3.6vmin, 48px) the CSS uses */
const pageMargin = () => clamp(Math.min(W, H) * 0.036, 20, 48);

function logoRect(){
  /* The mark stands on the wall behind the bar, held one page margin clear
     of the plane's edge, exactly as the copy is held off the page edges.
     The rect returned covers the padded bitmap, so the blur's bleed lands
     outside the artwork rather than being squeezed into it. */
  const gap = pageMargin();
  const hY = horizonY();
  const lh = Math.min(H * 0.8, (W * 0.92) / LOGO_ASPECT, hY - gap - 8);
  const lw = lh * LOGO_ASPECT;
  const p = lw * LOGO_PAD;
  return [G.cx - lw / 2 - p + parX, hY - gap - lh - p + parY, lw + 2 * p, lh + 2 * p];
}

function updateParallax(dt){
  const ptx = ptr.x === -999 ? W / 2 : ptr.x;
  const pty = ptr.y === -999 ? H / 2 : ptr.y;
  const k = Math.min(1, dt * 3);
  parX += ((W / 2 - ptx) * 0.022 - parX) * k;
  parY += ((H / 2 - pty) * 0.010 - parY) * k;
}

/* ================================================================== *
 * Palette
 * ================================================================== */
const mqDark = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return mqDark.matches;
};

/* ================================================================== *
 * Controls
 * ================================================================== */
const slidersEl = document.getElementById("sliders");
const inputs = {};

function buildSliders(){
  const frag = document.createDocumentFragment();
  for (const s of SPECS){
    if (s.group){
      const g = document.createElement("p");
      g.className = "group";
      g.textContent = s.group;
      frag.appendChild(g);
    }
    const wrap = document.createElement("div");
    wrap.className = "ctl";
    const id = "ctl-" + s.key;
    wrap.innerHTML =
      `<label for="${id}">${s.label}</label>` +
      `<output for="${id}" id="out-${s.key}"></output>` +
      `<input type="range" id="${id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${cfg[s.key]}">`;
    frag.appendChild(wrap);
    const input = wrap.querySelector("input");
    inputs[s.key] = input;
    input.addEventListener("input", () => {
      cfg[s.key] = Number(input.value);
      if (PALETTE_KEYS.includes(s.key)) paletteHook();
      if (s.key === "glassSize"){ resizeHook(); }
      /* Moving the fill line is a deliberate adjustment, so the glass follows
         at once. The slow top-up is reserved for beer that was sloshed out. */
      if (s.key === "fill"){ level = cfg.fill / 100; poured = true; }
      if (cfg.preset && s.key !== "fill" && s.key !== "agitation" && s.key !== "glassSize" && s.key !== "refill"){
        cfg.preset = null;
        chipsHook();
      }
      readout(s);
      save();
      if (!cfg.running) redraw();
    });
  }
  slidersEl.appendChild(frag);
  SPECS.forEach(readout);
}

function readout(s){ document.getElementById("out-" + s.key).textContent = cfg[s.key] + s.unit; }

function syncInputs(){
  for (const s of SPECS){
    if (inputs[s.key]) inputs[s.key].value = cfg[s.key];
    readout(s);
  }
  paletteHook();
  chipsHook();
  save();
}

const panelOpen = document.getElementById("panelOpen");
const panelClose = document.getElementById("panelClose");
function setPanel(open, moveFocus){
  document.body.dataset.panel = open ? "open" : "closed";
  panelOpen.setAttribute("aria-expanded", String(open));
  if (!moveFocus) return;
  if (open) panelClose.focus(); else panelOpen.focus();
}
panelOpen.addEventListener("click", () => setPanel(true, true));
panelClose.addEventListener("click", () => setPanel(false, true));
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.body.dataset.panel === "open") setPanel(false, true);
  if ((e.key === "c" || e.key === "C") && !/^(input|textarea)$/i.test(e.target.tagName)){
    document.body.dataset.chrome = document.body.dataset.chrome === "off" ? "on" : "off";
  }
});
