/* The beer itself: how much is in the glass, the columns its surface is held
   in and the shallow-water solver that moves them, the head's raft and cap,
   the crests breaking, the spill over the rim, the pour and its top-ups, and
   the mesh rebuilt after a resize. */
"use strict";

/* ------------------------------------------------------------------ *
 * Contents: level is the fraction of the interior that holds beer
 * ------------------------------------------------------------------ */
let level = 0;              /* 0 empty, 1 brim full */
/* Set while a card stands in place of the glass: the renderers draw the room
   and counter and leave out the glass and its contents. */
let glassAway = false;
let poured = false;         /* true once it has first reached the fill line */
let N = 0, hArr, uArr, fArr, maxAmp = 60;   /* surface, face velocities, face fluxes */
/* The head's own surface follows the beer's instead of copying it. A head is a
   raft that rides the swell and ignores bubbles pricking it from below, which
   would otherwise judder it at the fizz rate. */
let headArr = null;
let bubbles = [], foam = [], drops = [], mist = [], drips = [], sites = [], dew = [], lace = [];
/* What a bead leaves when it has run off the glass, like a foam ribbon but
   clearer and sooner gone. */
let puddles = [];
let capBubbles = 300, capFoam = 260, capDew = 90;

/* The fill line is the height the contents reach, beer and head together. The
   beer stops a head's depth short of it, so at 100% the head's edges sit on the
   lip whatever its depth, and a deeper head goes down, not up.

   BRIM_LIFT puts the head's edge a shade proud of the lip plane, which is the
   middle of an annulus with real thickness. A hundredth of the glass reads as
   on the rim.

   The fill may reach zero: nothing below divides by the level. */
const BRIM_LIFT = 0.01;
const targetLevel = () =>
  clamp((cfg.fill / 100) * (1 + BRIM_LIFT) - headBand() / Math.max(1, G.inH), 0, 1);
const restSurfaceY = () => G.inBottom - level * G.inH;

/* ------------------------------------------------------------------ *
 * Where the columns stand
 * ------------------------------------------------------------------ *
 * Across the bore, not the screen. Column i keeps the same fraction of the way
 * over whatever height its beer has reached, so the end columns sit on the wall
 * at any height (a cone is wider higher up). Measured once at the rest line
 * they would fall short of the wall above it and pass it below.
 *
 * The mesh stays in order because the crest limiter keeps it so. A column can
 * only outrun its neighbour if the bore closes faster than the spacing opens,
 * and at the limiting slope it closes at a ninth of that rate. */
const colU = i => -1 + 2 * i / (N - 1);        /* -1 at the left wall, +1 at the right */
const colY = i => restSurfaceY() + hArr[i];
const colR = i => innerHalfAt(colY(i));
const colX = i => G.cx + colU(i) * colR(i);

const spanCache = [0, 0, 0];
function surfaceSpan(){
  if (!N || !hArr) return spanCache;
  spanCache[0] = colX(0);
  spanCache[1] = colX(N - 1);
  spanCache[2] = spanCache[1] - spanCache[0];
  return spanCache;
}

/* The surface at a fraction of the way across, between the two columns there */
function sampleU(u){
  const t = (clamp(u, -1, 1) + 1) * 0.5 * (N - 1);
  const i = clamp(Math.floor(t), 0, N - 1);
  const j = Math.min(N - 1, i + 1);
  return restSurfaceY() + hArr[i] * (1 - (t - i)) + hArr[j] * (t - i);
}

/* Which fraction stands at this x. The bore depends on the height and the
   height on the fraction, so it is iterated; two passes land inside a pixel. */
function colAtX(x){
  let u = clamp((x - G.cx) / Math.max(1, innerHalfAt(restSurfaceY())), -1, 1);
  for (let pass = 0; pass < 2; pass++){
    u = clamp((x - G.cx) / Math.max(1, innerHalfAt(sampleU(u))), -1, 1);
  }
  return u;
}

function surfaceAt(x){
  if (!N || !hArr) return restSurfaceY();
  return sampleU(colAtX(x));
}

/* How far the surface ellipse bulges at a fraction across, at the beer's
   height there. */
const dyAtU = (u, y) => Math.abs(u) >= 1 ? 0 : ryAt(y) * innerHalfAt(y) * Math.sqrt(1 - u * u);

/* The surface and its bulge at one x, from one column search. It returns the
   same refilled array each time, so read it on the spot. */
const surfPos = [0, 0];
function surfaceAndDy(x){
  if (!N || !hArr){ surfPos[0] = restSurfaceY(); surfPos[1] = 0; return surfPos; }
  const u = colAtX(x);
  const y = sampleU(u);
  surfPos[0] = y;
  surfPos[1] = dyAtU(u, y);
  return surfPos;
}

function headAtU(u){
  const s = (clamp(u, -1, 1) + 1) * 0.5 * (N - 1);
  const i = clamp(Math.floor(s), 0, N - 1), j = Math.min(N - 1, i + 1);
  return restSurfaceY() + headArr[i] * (1 - (s - i)) + headArr[j] * (s - i);
}
function headSurfaceAt(x){
  if (!N || !headArr) return surfaceAt(x);
  return headAtU(colAtX(x));
}

/* The head's surface is the beer's smoothed sideways, over a span that
   swallows a bubble's dimple and is far narrower than the glass, so a swirl
   passes through. Smoothing in time alone cannot separate them, as a follow
   quick enough to drop the fizz takes two thirds of a hard slosh with it. The
   follow below is therefore also graded by distance. */
let headKernel = null, headKernelN = 0, headBlend = null;
let HEAD_SLOW = 2.5, HEAD_FAST = 30;
function stepHeadSurface(dt){
  if (!N || !hArr) return;
  if (!headArr || headArr.length !== N) headArr = new Float32Array(N);
  if (headKernelN !== N){
    /* about an eighth of the glass either side */
    const r = clamp(Math.round(N * 0.12), 2, 12);
    headKernel = [];
    for (let k = -r; k <= r; k++) headKernel.push(Math.exp(-2 * (k / r) * (k / r)));
    const sum = headKernel.reduce((a, b) => a + b, 0);
    headKernel = headKernel.map(w => w / sum);
    headKernel.r = r;
    headKernelN = N;
  }
  if (!headBlend || headBlend.length !== N){
    headBlend = new Float32Array(N); headBlend.set(hArr); headArr.set(hArr); return;
  }
  const r = headKernel.r;
  /* A bubble moves the surface by a fraction of a pixel and a swirl by tens.
     Ignoring what it is barely behind and following what it is plainly behind
     is a raft of foam either way round. */
  const near = HEAD_SLOW * dt, far = HEAD_FAST * dt;
  const reach = 2.5 * G.scale;
  for (let i = 0; i < N; i++){
    let v = 0;
    for (let j = -r; j <= r; j++) v += hArr[clamp(i + j, 0, N - 1)] * headKernel[j + r];
    const d = v - headBlend[i];
    const t = clamp(Math.abs(d) / reach, 0, 1);
    headBlend[i] += d * Math.min(1, near + (far - near) * t * t);
    headArr[i] = headBlend[i];
  }
}

function ellipseDy(x){
  if (!N || !hArr) return 0;
  const u = colAtX(x);
  return dyAtU(u, sampleU(u));
}
function frontY(x){ const p = surfaceAndDy(x); return p[0] + p[1]; }
/* The same readings at a column. Asked by x they must first find the column,
   which a caller holding colX(i) already knows. */
function colDy(i){
  const u = colU(i);
  if (Math.abs(u) >= 1) return 0;
  const y = colY(i);
  return ryAt(y) * innerHalfAt(y) * Math.sqrt(1 - u * u);
}
const colBackY = i => colY(i) - colDy(i);
const colFrontY = i => colY(i) + colDy(i);
const colHeadY = i => headArr ? restSurfaceY() + headArr[i] : colY(i);
const colHeadFrontY = i => colHeadY(i) + colDy(i);
/* and the same arc off the head's raft. The beer keeps its ripple and the foam
   on it need not show it. */
function headFrontY(x){
  if (!N || !headArr) return frontY(x);
  const u = colAtX(x);
  return headAtU(u) + dyAtU(u, sampleU(u));
}
function backY(x){ const p = surfaceAndDy(x); return p[0] - p[1]; }
/* The highest the head may stand at a fraction across. Below the lip the glass
   holds it. Above it there is only its own body, so it comes back to the rim
   at the two walls.

   It is not a dome. A surface across a glass is flat and what curves in a
   photograph is the perspective, the rim's own ellipse and no deeper, and a
   taller one reads as a bubble blown over the glass. So the plane is the rim's
   ellipse, with a low mound over it that holds its height across and turns
   down only at the walls. */
const HEAD_LIFT = 0.55;                 /* of a rim's depth, over the middle */
const HEAD_MOUND = 6;                   /* how square its shoulders are: the power of |u| */
/* The shader's copy (GLSL_HEAD in shader/render.js) is written from
   HEAD_LIFT and HEAD_MOUND. */
function headCapY(u, extra){
  const rimRy = G.topHalf * G.ryTop;
  const disc = Math.sqrt(Math.max(0, 1 - u * u));                       /* the plane, foreshortened */
  const mound = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), HEAD_MOUND)));   /* and what stands above it */
  return (G.top + rimRy) - rimRy * HEAD_LIFT * mound
                         - (rimRy + (extra || 0)) * disc;
}

function headTopAt(x){
  const u = clamp((x - G.cx) / Math.max(1, innerHalfAt(G.inTop)), -1, 1);
  let back;
  if (!N || !headArr) back = backY(x);
  else { const v = colAtX(x); back = headAtU(v) - dyAtU(v, sampleU(v)); }
  return Math.max(back - headBand(), headCapY(u, 0));
}
function colHeadTop(i){
  const u = clamp((colX(i) - G.cx) / Math.max(1, innerHalfAt(G.inTop)), -1, 1);
  return Math.max(colHeadY(i) - colDy(i) - headBand(), headCapY(u, 0));
}

/* The head is as deep as it is asked to be and is not capped by the room under
   the lip: the beer is set from it (see targetLevel). */
const headBand = () => (G.topHalf * 2) * (0.05 + 0.14 * cfg.headDepth / 100);

/* How far the head stands above the lip at its highest, from the head's top and
   the riding blobs. The crown over the mouth is sized to it. */
function crestRaw(){
  if (!N || !hArr) return 0;
  const lip = G.top + G.topHalf * G.ryTop;
  const band = headBand();
  let crest = 0;
  for (let i = 0; i < N; i++){
    crest = Math.max(crest, lip - (colHeadY(i) - colDy(i) - band));
  }
  for (const f of foam){
    const p = surfaceAndDy(f.x);
    const y = p[0] - p[1] * 0.4 + f.oy - f.r;
    crest = Math.max(crest, lip - y);
  }
  /* a little headroom, so the crown does not shave the topmost fleck of it */
  return Math.max(0, crest + 10 * G.scale);
}

/* The crest is followed, not read. It is a max over wobbling flecks, so it
   changes hands as the highest one settles. The crown closes as
   sqrt(1 - (up/crest)^2), nearly vertical at its top, so a few tenths of a
   pixel of jitter moves its edge by pixels. That shook only brimful glasses,
   since below about nine tenths no fleck stands above the lip.

   It rises quickly, as foam thrown over a lip does, and falls slowly, as a head
   settles. */
let crestNow = 0;
function stepCrest(dt){
  const want = crestRaw();
  crestNow += (want - crestNow) * Math.min(1, dt * (want > crestNow ? 6 : 2));
}
const headCrest = () => crestNow;

/* ================================================================== *
 * Surface physics: shallow water across the glass
 * ================================================================== *
 * hArr holds the surface as a depression below the rest line, positive
 * downwards to match the screen. uArr holds the depth-averaged sideways
 * velocity on the faces between columns, not on the columns. Staggering them
 * keeps the solver from ringing: pressure is read across a face and the flux
 * it drives goes through that same face, so no sawtooth can form as it can on
 * a collocated grid. The solver conserves beer. */

/* A slice of the pour is only as wide as the chord of the glass there, so the
   same rise carries far more beer at the centre than at the wall. Using the
   chord as column width makes a round glass behave round: the surface tips
   about its middle and the ends run up the wall. Each column takes the average
   chord across its width, so the widths sum to the circle's area and wall
   columns keep a small breadth. */
/* ∫2√(1−u²)du out from the middle of a unit circle: the plan area of the slice
   from the centre to u. The bore is clamped so it stays real. */
const sliceArea = u => {
  const t = clamp(u, -1, 1);
  return t * Math.sqrt(Math.max(0, 1 - t * t)) + Math.asin(t);
};
/* areaArr[i] is the plan area column i covers, its own slice of its own bore,
   so a column high in the cone carries more beer per rise. dxArr[k] is the gap
   between column k and the next where they have ended up. boreArr[k] is the
   chord across the glass at that face. */
/* Asked several times a substep, so what depends on the column count alone is
   worked out once per count and each column's bore once a call. */
let areaArr = null, dxArr = null, boreArr = null, gridN = 0;
let sliceUnit = null, chordUnit = null, boreCol = null;
function grid(){
  if (!areaArr || gridN !== N){
    areaArr = new Float32Array(N);
    dxArr = new Float32Array(Math.max(1, N - 1));
    boreArr = new Float32Array(Math.max(1, N - 1));
    sliceUnit = new Float64Array(N);
    chordUnit = new Float64Array(Math.max(1, N - 1));
    boreCol = new Float64Array(N);
    const du = 2 / (N - 1);
    for (let i = 0; i < N; i++){
      const u = colU(i);
      const lo = Math.max(-1, u - du * 0.5), hi = Math.min(1, u + du * 0.5);
      sliceUnit[i] = sliceArea(hi) - sliceArea(lo);
    }
    for (let k = 0; k < N - 1; k++){
      const uF = colU(k) + du * 0.5;
      chordUnit[k] = Math.sqrt(Math.max(0, 1 - uF * uF));
    }
    gridN = N;
  }
  for (let i = 0; i < N; i++){
    const r = colR(i);
    boreCol[i] = r;
    const R = Math.max(1, r);
    areaArr[i] = R * R * sliceUnit[i];
  }
  for (let k = 0; k < N - 1; k++){
    dxArr[k] = Math.max(0.05, (G.cx + colU(k + 1) * boreCol[k + 1]) - (G.cx + colU(k) * boreCol[k]));
    const RF = Math.max(1, (boreCol[k] + boreCol[k + 1]) * 0.5);
    boreArr[k] = 2 * RF * chordUnit[k];
  }
  return areaArr;
}

/* The wave carries no beer of its own: level is how much is in the glass and
   hArr only its shape. Any mean the wave picks up is flattened out and
   returned in pixels of surface. The caller decides what it was: beer pushed
   aside (no loss) or beer over the lip (comes off the level). */
function levelWave(){
  const A = grid();
  let m = 0, tot = 0;
  for (let i = 0; i < N; i++){
    const a = A[i];
    m += hArr[i] * a; tot += a;
  }
  if (tot <= 1e-6) return 0;
  const shift = m / tot;
  if (Math.abs(shift) < 1e-7) return 0;
  for (let i = 0; i < N; i++) hArr[i] -= shift;
  return shift;
}

/* A push (finger, bubble, pour landing) displaces beer rather than losing it,
   so its mean is flattened out and the surface still holds the same pint. */
/* How hard a push of unit force sets the surface moving, in pixels a second */
const SPLASH = 400;
let profArr = null;
function splash(x, force, radius){
  if (!N || !hArr || !uArr) return;
  const A = grid();
  const H = Math.max(3, level * G.inH);
  /* placed by the fraction of the way across it lands at, so a push keeps its
     width in glass rather than in screen pixels */
  const c = (colAtX(x) + 1) * 0.5 * (N - 1);
  const meanDx = Math.max(0.05, (colX(N - 1) - colX(0)) / (N - 1));
  const span = Math.max(1, radius / meanDx);
  if (!profArr || profArr.length !== N) profArr = new Float32Array(N);

  let m = 0, tot = 0;
  for (let i = 0; i < N; i++){
    const d = (i - c) / span;
    profArr[i] = Math.exp(-d * d * 1.6);
    const a = A[i];
    m += profArr[i] * a; tot += a;
  }
  if (tot <= 1e-6) return;
  const mean = m / tot;
  const rate = force * SPLASH * G.scale;         /* px a second, downwards */

  /* The push is given to the flow, not pressed into the surface. Pressed in, each
     of the two dozen bubbles bursting a second would show at once and the pour
     would tremble at their rate. Given to the flow it must travel first, and the
     surface sums arrivals as a liquid does. The flux is the running total of the
     push and the speed is that flux over the bore it passes through. */
  const uCap = Math.sqrt(gravity() * H) * 2.5;
  let carried = 0;
  for (let k = 0; k < N - 1; k++){
    carried += rate * (profArr[k] - mean) * A[k];
    const bore = boreArr[k] * H;
    if (bore > 1e-6) uArr[k] = clamp(uArr[k] + carried / bore, -uCap, uCap);
  }
}

/* Dragging and the phone's gravity act on the body of the pour: an even push
   along the glass piles beer against the leading wall and lets the slosh build.
   Raking the surface into a ramp would be the effect, not the cause. */
function driveFlow(a){
  if (!uArr) return;
  for (let k = 0; k < N - 1; k++) uArr[k] += a;
}

/* Gravity in pixels. Real gravity at this scale slosh at several hertz, which
   reads as jitter, so the pour gets a heavier, slower liquid. Wave speed
   follows gravity and depth alone, as in shallow water. */
const GRAV = 2600;
const gravity = () => GRAV * G.scale * (0.35 + (cfg.waveSpeed / 100) * 1.10);

function stepWaves(step){
  if (!N || !hArr || !uArr || level <= 0.015) return;
  let A = grid();
  const H = Math.max(3, level * G.inH);            /* still-water depth */
  const g = gravity();
  const fric = 0.25 + (cfg.viscosity / 100) * 5.5;
  const ax = g * tiltForce();
  /* Drag alone damps every wavelength equally, but a liquid loses short ripples
     far faster. Without that, every bubble burst leaves a fast fine tremor.
     Viscosity proper falls by the square of the wavenumber, so ripples a few
     columns wide go within a shake and the slosh is barely touched. */
  const nu = 115 * G.scale * G.scale * (0.35 + (cfg.viscosity / 100) * 1.3);

  /* A wave crosses the tightest gap in sqrt(gH) seconds and the solver may not
     step over that, so the frame is cut into pieces by depth. */
  const cmax = Math.sqrt(g * H);
  let dxMin = 1e9;
  for (let k = 0; k < N - 1; k++) if (dxArr[k] < dxMin) dxMin = dxArr[k];
  /* The step must keep up with wave speed plus flow. Sized on the wave alone, a
     hard flick (200% agitation, finger at the wall) outruns the cut, the
     momentum term doubles every substep and the surface goes to NaN. */
  let uMax = 0;
  for (let k = 0; k < N - 1; k++){ const a = Math.abs(uArr[k]); if (a > uMax) uMax = a; }
  /* The ceiling is a backstop for settings that ask for more pieces than a frame
     can pay for. It scales with the step so a longer frame does not get coarser
     pieces. Past it the drag and clamps hold the solver together. */
  const subMax = Math.max(32, Math.ceil(32 * frames(step)));
  const sub = clamp(Math.ceil(step * (cmax + uMax) / (dxMin * 0.35)), 1, subMax);
  /* Past a few times a wave's crossing speed there is nothing left to represent,
     only arithmetic. */
  const uCap = cmax * 2.5;
  const dt = step / sub;
  const maxDepress = H - 2;

  for (let s = 0; s < sub; s++){
    for (let k = 0; k < N - 1; k++){
      const u = uArr[k];
      const dx = dxArr[k];                          /* this face's own gap */
      const slope = (hArr[k + 1] - hArr[k]) / dx;
      /* Read the gradient from the side the flow arrives from */
      const du = u > 0 ? u - (k > 0 ? uArr[k - 1] : 0)
                       : (k < N - 2 ? uArr[k + 1] : 0) - u;
      const adv = u * du / dx;
      const uL = k > 0 ? uArr[k - 1] : -u;          /* no slip through the wall */
      const uR = k < N - 2 ? uArr[k + 1] : -u;
      const shear = nu * (uL - 2 * u + uR) / (dx * dx);
      uArr[k] = clamp((u + dt * (g * slope - adv + ax + shear)) / (1 + fric * dt),
                      -uCap, uCap);
    }
    /* Continuity: depth times glass width at the face, taken upwind, which keeps a
       steep crest steep instead of smearing it. */
    for (let k = 0; k < N - 1; k++){
      const u = uArr[k];
      const depth = H - (u > 0 ? hArr[k] : hArr[k + 1]);
      fArr[k] = u * Math.max(0, depth) * boreArr[k];
    }
    for (let i = 0; i < N; i++){
      const cell = A[i];
      if (cell <= 1e-6) continue;
      const fR = i <= N - 2 ? fArr[i] : 0;
      const fL = i >= 1 ? fArr[i - 1] : 0;
      hArr[i] = clamp(hArr[i] + dt * (fR - fL) / cell, -maxAmp, Math.min(maxAmp, maxDepress));
    }
    /* The crest limiter runs every substep. At the end of a frame the flow would
       have carried the front past vertical. The mesh is re-measured only if the
       limiter moved beer, since the columns ride the surface. */
    if (breakCrests(dt)) A = grid();
  }
  /* A NaN surface draws nothing and poisons later frames, so check once and
     restart the pour. */
  for (let i = 0; i < N; i++){
    if (Number.isFinite(hArr[i])) continue;
    hArr.fill(0); uArr.fill(0); fArr.fill(0);
    waveResets++;
    return;
  }
  levelWave();                    /* the clamps are not allowed to cost a drop */
}
/* How often the check above has had to restart the surface. It should stay at
   nought; the tests read it, since the restart hides the fault it repairs. */
let waveResets = 0;

/* A whole frame of waves. The solver is tuned for strides of up to a thirtieth
   of a second, so a longer frame is taken in several: the waves must cover the
   same time as everything else in the frame. Beyond WAVE_STRIDES the rest is
   dropped, so one very long frame cannot stall the next. */
const WAVE_STRIDE = 1 / 30, WAVE_STRIDES = 8;
function stepWavesFor(dt){
  for (let n = 0; dt > 1e-6 && n < WAVE_STRIDES; n++){
    const s = Math.min(dt, WAVE_STRIDE);
    stepWaves(s);
    dt -= s;
  }
}

/* The surface is one height per column, so it can lean up to vertical and no
   further. Beer driven at a wall would curl, which a height field cannot say,
   and the flow's steepening would carry the front over in one column (86
   degrees across five pixels was seen under a swipe). So the front is held to
   a slope beer can stand in and the excess passes down the face: the crest
   hands beer to the trough below, which is breaking. It is weighed by each
   column's bore so no beer is created or lost, and what comes over the top is
   thrown as head, since breaking is where foam comes from. */
/* About fifty degrees. A slosh across the glass reaches forty, so only the
   front of a wave driven into a wall meets the limit. */
const MAX_FACE = 1.2;
/* Foam rate per second while a crest breaks, not a chance per substep, so it
   does not depend on how the frame was cut. */
const CREST_FOAM_RATE = 300;
function breakCrests(dt){
  if (!N || !hArr) return false;
  const A = grid();
  let moved = false;
  /* A steep front is let down one column at a time, so repeat until quiet */
  for (let pass = 0; pass < 8; pass++){
    let quiet = true;
    for (let i = 0; i < N - 1; i++){
      const d = hArr[i + 1] - hArr[i];
      const over = Math.abs(d) - MAX_FACE * dxArr[i];   /* this face's own gap */
      if (over <= 0) continue;
      quiet = false;
      const aL = A[i], aR = A[i + 1];
      if (aL <= 1e-6 || aR <= 1e-6) continue;
      /* enough beer to bring the face back to the limit, and no more */
      const move = over / (1 / aL + 1 / aR);
      moved = true;
      const crest = d > 0 ? i : i + 1;          /* the column standing higher */
      const trough = d > 0 ? i + 1 : i;
      hArr[crest] += move / (crest === i ? aL : aR);
      hArr[trough] -= move / (trough === i ? aL : aR);
      if (pass === 0 && move > 12 * G.scale
          && Math.random() < 1 - Math.exp(-CREST_FOAM_RATE * dt)){
        addFoam(colX(crest), rand(3, 9) * G.scale);
      }
    }
    if (quiet) break;
  }
  return moved;
}

/* Beer that climbs past the rim leaves the glass but is not cut off flat. The
   lip is a weir, draining at a rate set by the depth over its crest, so the
   pour rides over, pours while over and drops back. A hard ceiling could not
   show that. */
const WEIR = 0.55;
function spillOverRim(dt){
  if (!N || !hArr) return;
  const ry = restSurfaceY();
  const rimY = G.inTop;
  const A = grid();
  const g = gravity();
  const rimD = rimY - ry;               /* the depression at which beer is level with the lip */
  let over = false;

  for (let i = 0; i < N; i++){
    const excess = rimD - hArr[i];
    if (excess <= 0) continue;
    over = true;
    /* the crest is the chord across the glass here, costed by the column's area */
    const bore = i < N - 1 ? boreArr[i] : boreArr[N - 2];
    const drain = Math.min(excess,
      WEIR * Math.sqrt(2 * g) * Math.pow(excess, 1.5) * bore * dt / Math.max(1e-6, A[i]));
    hArr[i] += drain;

    if (excess > 1.2 && Math.random() < chance(clamp(excess * 0.07, 0.05, 0.8), dt)){
      const x = colX(i);
      /* The drop leaves with the beer's sideways speed at the lip and the upward
         speed needed to get that far above it. */
      const uHere = ((i > 0 ? uArr[i - 1] : 0) + (i < N - 1 ? uArr[i] : 0)) * 0.5;
      /* Where round the rim it leaves. A column knows only how far across the glass
         it stands, which meets the rim circle twice (near lip and far), so a spill
         thrown outward in x alone is one flat plane with nothing at the eye. The
         angle also gets a wide spread: at a wall the near and far lip meet and there
         is no depth to leave by, so leaving only at the column's two points would
         come off the two sides alone. */
      const uCol = clamp(colU(i), -1, 1);
      const base = Math.asin(uCol);
      const th = (Math.random() < 0.5 ? base : Math.PI - base) + rand(-0.9, 0.9);
      const deep = Math.cos(th), across = Math.sin(th);
      const hwR = Math.max(1, innerHalfAt(rimY));
      const ry = ryAt(rimY) * hwR;
      const outward = rand(4, 26);
      drops.push({
        x: G.cx + hwR * across, y: rimY + ry * deep - rand(0, 6),
        vx: uHere * 0.55 + across * outward,
        vy: -Math.sqrt(2 * g * excess) * rand(0.45, 0.85) + deep * ry * outward * 0.10,
        r: rand(1.4, 4.2) * G.scale,
        near: deep, dz: deep * rand(0.9, 2.6),
        foamy: Math.random() < 0.6, out: true
      });
    }
  }

  /* Draining only the columns above the lip leaves a step, so let the face down
     again before it is seen */
  if (over) breakCrests(dt / 10);   /* a tenth of a frame: about what a solver substep is */

  if (over){
    const shift = levelWave();
    if (shift > 0) level = clamp(level - shift / G.inH, 0, 1);
  }

  let foamLost = 0;
  const hwRim = Math.max(1, innerHalfAt(rimY));
  for (let i = foam.length - 1; i >= 0; i--){
    const f = foam[i];
    if (Math.abs(f.x - G.cx) <= hwRim * 0.62) continue;   /* the middle cannot fall */
    const sp = surfaceAndDy(f.x);
    const beer = sp[0] - sp[1] * 0.4;
    const fy = beer + f.oy;
    /* Standing over the lip is not enough: the middle of a proud head has nowhere
       to fall, so it must be out at the wall too. At the brim the whole head is
       above the rim, and without this it would all go at once, stripping the head
       and hanging identical ribbons. It is a rate per second so machine speed
       does not change it. */
    if (fy < rimY - f.r * 0.4 && Math.abs(f.x - G.cx) > hwRim * 0.62
        && Math.random() < dt * 2.4){
      foamLost += f.r * f.r * Math.PI;
      spillFoam(f.x, f.r);
      /* Some is thrown instead of hanging on, leaving by the same two sides. This
         needs the beer itself coming up to the lip, since foam proud of a brimful
         glass creeps down and is not flung. On a flat chance an untouched glass
         would drop beads on the counter with its beer far down the bore. */
      const lipReach = 30 * G.scale;
      const surge = clamp((rimY - beer + lipReach) / lipReach, 0, 1);
      if (surge > 0 && Math.random() < 0.55 * surge){
        const base = Math.asin(clamp((f.x - G.cx) / hwRim, -1, 1));
        const th = (Math.random() < 0.5 ? base : Math.PI - base) + rand(-0.9, 0.9);
        const deep = Math.cos(th), across = Math.sin(th);
        const ry = ryAt(rimY) * hwRim;
        const outward = rand(3, 16);
        drops.push({
          x: G.cx + hwRim * across, y: rimY + ry * deep - rand(0, 5),
          vx: across * outward,
          vy: -rand(6, 34) * G.scale + deep * ry * outward * 0.10,
          r: clamp(f.r * 0.3, 1.1, 4) * G.scale,
          near: deep, dz: deep * rand(0.9, 2.6),
          foamy: true, out: true
        });
      }
      /* Lacing is laid where the head stands against the wall (see layLacing), not
         here, or only brimful glasses would be marked, in one band. */
      foam.splice(i, 1);
    }
  }
  /* foam is beer too, so losing a headful costs some of the pour */
  if (foamLost > 0){
    const area = Math.max(1, innerHalfAt(ry) * 2 * G.inH);
    level = clamp(level - (foamLost / area) * 0.95, 0, 1);
  }
}

function updateLevel(dt){
  const target = targetLevel();
  if (level >= target - 0.0005){
    level = Math.min(level, target);
    poured = true;
    return;
  }
  const rate = poured
    ? 0.004 + (cfg.refill / 100) * 0.045
    : 0.34;
  level = Math.min(target, level + rate * dt);
  if (level >= target - 0.0005) poured = true;
}

/* While a card stands in place of the glass nothing is drawn or worked out.
   This keeps the glass ready to return, not running. Particles and their
   timers stop and every quantity read as a change since the last frame is
   re-based, so none sees the interval as one long step.
     - The card keeps turning, so the settings and fill line keep moving. Once
       poured, the level goes straight to them, not topping up in view.
     - What was in the air is let go.
     - The pointer's last position is kept current, or the first frame back
       reads the whole distance as one flick.
   The loop must also drop its own accumulators and not call stepWaves. */
const glassIdle = () => glassAway;
function idleGlass(dt){
  if (poured) level = targetLevel(); else updateLevel(dt);
  drops.length = 0; mist.length = 0;
  laceLast = null; laceAcc = 0; ribbonOwed = 0; tiltSwing = 0;
  ptr.lx = ptr.x; ptr.ly = ptr.y; ptr.vx = ptr.vy = 0;
}

let idleAcc = 0;
function ambient(dt){
  idleAcc += dt;
  if (idleAcc > 1.1){
    idleAcc = 0;
    splash(G.cx + rand(-1, 1) * G.topHalf, rand(-0.16, 0.16), G.topHalf * rand(0.4, 1.2));
  }
}

/* ------------------------------------------------------------------ *
 * After a resize: the mesh and everything sized from the glass
 * ------------------------------------------------------------------ *
 * Both renderers call this after laying the glass out again. moved says
 * whether the glass changed size or place. maxCols and maxFoam are the
 * renderer's ceilings on columns and blobs, for one fitting them into a
 * texture or buffer. */
function remesh(moved, maxCols = Infinity, maxFoam = Infinity){
  const span = innerHalfAt(G.inTop) * 2;
  const nWas = N, hWas = hArr, uWas = uArr, headWas = headArr;
  N = clamp(Math.round(span / 5), 32, Math.min(220, maxCols));
  hArr = new Float32Array(N);
  /* Velocity and flux live on the faces between the columns, not on the
     columns, so there is one fewer of each */
  uArr = new Float32Array(Math.max(1, N - 1));
  fArr = new Float32Array(Math.max(1, N - 1));
  /* The pour is carried across, not restarted: the frame timer calls this when
     it drops quality, at any moment, and a fresh mesh would flatten the beer in
     view. Surface and flow are resampled. Flux is recomputed each step. */
  const carry = (src, m, dst, n) => {
    if (!src || m < 2) return;
    for (let i = 0; i < n; i++){
      const t = n > 1 ? i / (n - 1) * (m - 1) : 0;
      const a = clamp(Math.floor(t), 0, m - 1), b = Math.min(m - 1, a + 1);
      dst[i] = src[a] + (src[b] - src[a]) * (t - a);
    }
  };
  carry(hWas, nWas, hArr, N);
  carry(uWas, Math.max(1, nWas - 1), uArr, Math.max(1, N - 1));
  /* the head's raft is resampled too, or it would return level under a tilted
     surface */
  headArr = new Float32Array(N);
  if (headWas) carry(headWas, nWas, headArr, N); else headArr.set(hArr);
  maxAmp = Math.min(G.inH * 0.30, G.topHalf * 1.1);

  capBubbles = clamp(Math.round(G.topHalf * G.inH / 260), 60, isCoarse ? 220 : 380);
  capFoam    = clamp(Math.round(G.topHalf / 1.6), 40, Math.min(240, maxFoam));
  capDew     = clamp(Math.round(G.topHalf * G.inH / 900), 30, 140);

  /* Nucleation sites sit on the floor disc, so each has a place across and into
     the glass. The square root of a random radius stops them crowding the
     middle. */
  const n = clamp(Math.round(G.topHalf / 26), 3, 12);
  const STREAM_SITES = 5;
  const floorHalf = innerHalfAt(G.inBottom - 4);
  /* The sites are kept across a resize so bubble streams do not jump when the
     frame timer drops quality, and are scattered afresh only when the count
     changes. */
  if (sites.length === n){
    for (const s of sites){
      s.u *= floorHalf / Math.max(1, s.half || floorHalf);
      s.half = floorHalf;
    }
  } else {
    sites = [];
    for (let i = 0; i < n; i++){
      const rr = Math.sqrt(Math.random()) * 0.86, th = Math.random() * TAU;
      sites.push({
        u: Math.cos(th) * rr * floorHalf,
        v: Math.sin(th) * rr,              /* -1 at the back of the floor, +1 at the front */
        half: floorHalf,
        acc: Math.random(), rate: rand(1.4, 3.2), scale: rand(0.6, 1.5),
        /* the first few also send up a stream of fine bubbles, this many a second */
        stream: i < STREAM_SITES ? rand(5, 8) : 0, fine: Math.random(), gas: 0
      });
    }
  }

  /* The glass is emptied only when it moved. Everything the pour wears (bubbles,
     head, beads, lacing, ribbons) is held in pixels. A quality change moves
     nothing and clearing would strip the head and condensation mid-frame. */
  if (moved){
    bubbles.length = 0; foam.length = 0; drops.length = 0; mist.length = 0; drips.length = 0;
    dew.length = 0; lace.length = 0; puddles.length = 0;
  }
}
