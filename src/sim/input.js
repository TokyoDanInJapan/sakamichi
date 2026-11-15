/* What moves the beer from outside: the phone's tilt and shake, and the
   pointer stirring, splashing and dragging through the pour. */
"use strict";

/* ================================================================== *
 * Tilt: the phone's own gravity, which the beer answers to
 * ================================================================== */
let tiltWant = 0, tiltNow = 0, tiltLive = false;
/* The rate of change of the lean, which does a different job from the lean.
   A held angle only tips the beer downhill and it settles into the slope.
   What swirls it is the phone being moved, as when a hand rocks a glass, so
   the change between readings is gathered here and spent as a sideways drive,
   like a cursor dragged across the glass. */
let tiltSwing = 0, tiltLast = 0, tiltSeen = false;
const TILT_SWIRL = 200;

/* beta and gamma are the device's axes and are rotated into the page's before
   the beer leans. */
function onOrient(e){
  if (e.beta == null && e.gamma == null) return;
  const r = Math.PI / 180;
  const a = (((screen.orientation && screen.orientation.angle) || window.orientation || 0)) * r;
  const gx = Math.sin((e.gamma || 0) * r);
  const gy = Math.sin((e.beta  || 0) * r);
  tiltWant = clamp(gx * Math.cos(a) + gy * Math.sin(a), -1, 1);
  if (tiltSeen) tiltSwing += tiltWant - tiltLast;
  tiltLast = tiltWant;
  tiltSeen = true;
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

/* A tilted glass does not rake its surface into a ramp. Gravity gains a
   sideways share and the beer settles into the ramp in answer. This is a
   standing force, so the surface leans and sloshes on the way. Returned as
   that share, for stepWaves to weigh against its own gravity. */
function tiltForce(){
  return cfg.tilt && tiltLive ? tiltNow * 0.5 * (cfg.agitation / 100) : 0;
}

/* The swirl from the phone's movement, which the lean cannot give. It is spent
   as used, so a phone left alone stops driving. It is clamped to what a hard
   mouse drag gives, since a device swings far faster than a hand and the
   solver should not see such a shove. */
function tiltForces(dt){
  if (!cfg.tilt || !tiltLive || cfg.agitation === 0) return;
  const s = Math.min(1, frames(dt));
  const drive = tiltSwing * TILT_SWIRL * (cfg.agitation / 100) * s;
  /* the floor and ceiling are per sixtieth, so they follow s */
  if (Math.abs(drive) > 0.5 * s) driveFlow(clamp(drive, -1600 * s, 1600 * s));
  tiltSwing *= Math.max(0, 1 - dt * 14);
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
  if (overChrome(e.target) || glassAway) return;
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

/* The pointer's step since the last frame, taken once a frame before anything
   is stirred. ptr.vx and ptr.vy are pixels a frame, which pointerForces
   converts to pixels per sixtieth of a second. */
function trackPointer(){
  if (ptr.lx === -999){ ptr.lx = ptr.x; ptr.ly = ptr.y; }
  ptr.vx = ptr.x - ptr.lx;
  ptr.vy = ptr.y - ptr.ly;
  ptr.lx = ptr.x; ptr.ly = ptr.y;
}

function pointerForces(dt){
  if (!ptr.inside || cfg.agitation === 0) return;
  const agit = cfg.agitation / 100;
  const sy = surfaceAt(ptr.x);
  const depth = ptr.y - sy;
  /* The hand's speed in pixels per sixtieth of a second, the unit every
     threshold, radius and clamp below was set in. A raw step halves at 120 Hz
     for the same sweep, so the thresholds would read it differently. What is
     added in a frame is a sixtieth's worth times s, so the push per second is
     the same. Floored because a very slow pace makes dt tiny and implies a
     speed no hand has. */
  const s = Math.max(frames(dt), 0.24);
  const vx = ptr.vx / s, vy = ptr.vy / s;
  const speed = Math.hypot(vx, vy);
  const reach = G.topHalf * 1.6;
  if (Math.abs(ptr.x - G.cx) > reach) return;
  /* Below the glass floor the pointer is over the bar top. The reflection there
     is a picture of the pour, so nothing it passes over should stir or splash. */
  if (ptr.y > G.inBottom + 12) return;

  if (depth > -70 && depth < G.inH * 1.1 && speed > 0.2){
    const near = 1 - clamp(Math.abs(depth) / (G.inH * 0.9), 0, 1);
    const force = clamp(vy * 0.10 + Math.sign(vy || 1) * speed * 0.022, -6.5, 6.5)
                * agit * (0.35 + near * 0.65) * s;
    splash(ptr.x, force, G.topHalf * 0.35 + speed * 0.9);
    if (ptr.held) splash(ptr.x, force * 0.4, G.topHalf);
  }
  /* Dragging sideways drives the sloshing mode. The beer piles on the leading
     wall, which is how a pint goes over the rim. */
  if (depth > -20 && depth < G.inH * 0.8 && Math.abs(vx) > 0.5){
    const nearTop = 1 - clamp(Math.max(0, depth) / (G.inH * 0.7), 0, 1);
    /* Clamp the pointer's speed, not its step, so sloshing is as easy at 30 fps
       as at 144. */
    const vps = ptr.vx / Math.max(dt, 0.004);
    const drag = clamp(vps, -2600, 2600) * 0.10 * agit * (0.35 + nearTop * 0.65)
               * Math.min(1, dt * 12);
    driveFlow(drag);
  }

  if (depth > -10 && depth < G.inH * 1.05){
    const R = (90 + speed * 2.2) * G.scale;
    for (const b of bubbles){
      const dx = b.x - ptr.x, dy = b.y - ptr.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < R * R){
        const w = (1 - Math.sqrt(d2) / R) * agit * s;
        b.vx += vx * 9 * w;
        b.vy -= vy * 4 * w;
      }
    }
    if (speed > 1.2){
      /* counted at sixty a second and shared over the real frames, a fraction being
         a chance of one */
      const want = Math.min(5, Math.round(speed * 0.18 * agit)) * s;
      const n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
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
        const w = (1 - Math.abs(dx) / R2) * agit * s;
        f.vx += vx * 7 * w;
        f.oy -= Math.abs(vy) * 0.06 * w;
      }
    }
  }
}
