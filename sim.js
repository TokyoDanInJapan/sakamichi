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
  /* The rim ellipse, resolved at the height its own tangent sits at */
  G.ryTop = ryAt(G.top + G.topHalf * ryAt(G.top));
  /* The lip is a circle, and it lies at the height the rim ellipse is centred
     on — not at the top of that ellipse, which is only the back of the same
     circle drawn nearer the eye's level. Measured from the top, brim full put
     the beer the better part of a rim above the brim: at a hundred per cent its
     far edge stood clear of the glass altogether, and the head, which floats on
     it, stood a seventh of the glass's height above the top of it. */
  G.inTop = G.top + G.topHalf * G.ryTop;
  G.inBottom = G.bottom - G.baseH;
  G.inH = G.inBottom - G.inTop;
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
let N = 0, hArr, uArr, fArr, maxAmp = 60;   /* surface, face velocities, face fluxes */
let bubbles = [], foam = [], drops = [], mist = [], drips = [], sites = [], dew = [], lace = [];
let capBubbles = 300, capFoam = 260, capDew = 90;

/* The fill line is the height the contents reach, and the contents are the
   beer and the head together. So the beer stops a head's depth short of it —
   which at a hundred per cent puts the head's own edges on the lip, whatever
   depth the head has been given, and sends a deeper head down into the glass
   rather than up out of it.
   Read as the beer line instead, the head stood on top of whatever was asked
   for and the glass had to be stopped short of the brim to leave it somewhere
   to go. Now the brim is the brim. */
/* and a shade proud of the lip's plane, because that plane is the middle of an
   annulus with real thickness to it: a head's edge set exactly on it sits level
   with the middle of the rim, which reads as just under the rim rather than on
   it. A hundredth of the glass is enough to put it on top. */
/* The glass may be emptied. The fill line stopped a twenty-fifth of the way up
   and the slider stopped at a quarter, so the least a glass could hold was a
   finger of beer sitting on the bottom with the wave clamped to whatever depth
   was left under it — swill that and it came up against the floor of its own
   allowance rather than the floor of the glass. Nothing below divides by the
   level; the passes that draw the pour already stand aside when there is none. */
const BRIM_LIFT = 0.01;
const targetLevel = () =>
  clamp((cfg.fill / 100) * (1 + BRIM_LIFT) - headBand() / Math.max(1, G.inH), 0, 1);
const restSurfaceY = () => G.inBottom - level * G.inH;

/* ------------------------------------------------------------------ *
 * Where the columns stand
 * ------------------------------------------------------------------ *
 * Across the bore, not across the screen. Column i keeps the same fraction of
 * the way over whatever height its own beer has reached, and the glass hands it
 * the width there. A cone is wider higher up, so a crest really does cover more
 * glass than the trough opposite it: measured once at the rest line instead,
 * the columns fell short of the wall wherever the beer stood above that line —
 * nine pixels of it under a swirl, which is the strip where the surface ran out
 * before the glass did — and reached past the wall wherever it had dropped
 * below. Now the end columns sit on the wall by construction, at whatever
 * height they have risen to.
 *
 * The mesh stays in order because the crest limiter keeps it there: a column
 * can only outrun its neighbour if the bore closes faster than the spacing
 * opens, and at the limiting slope the bore closes at a ninth of that rate. */
const colU = i => -1 + 2 * i / (N - 1);        /* -1 at the left wall, +1 at the right */
const colY = i => restSurfaceY() + hArr[i];
const colR = i => innerHalfAt(colY(i));
const colX = i => G.cx + colU(i) * colR(i);

/* The ends, which is all most callers want of the span */
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

/* And the other way about: which fraction stands at this x. The bore depends on
   the height and the height on the fraction, so it is walked in rather than
   solved — the bore shifts slowly enough that two passes land inside a pixel. */
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

/* How far the surface ellipse bulges at this x, front and back. The bore is
   read at the height the beer has actually reached here, so the bulge follows
   the surface up and down the cone with it. */
function ellipseDy(x){
  if (!N || !hArr) return 0;
  const u = colAtX(x);
  if (Math.abs(u) >= 1) return 0;
  const y = sampleU(u);
  const hw = innerHalfAt(y);
  return ryAt(y) * hw * Math.sqrt(1 - u * u);
}
const frontY = x => surfaceAt(x) + ellipseDy(x);
const backY  = x => surfaceAt(x) - ellipseDy(x);
/* The highest the head may stand at a fraction of the way across the glass.
   Below the lip the glass holds it; above the lip there is nothing but its own
   body, so it has to come back to the rim at the two walls — standing its full
   depth proud right across is a cylinder of foam on a glass that ended below it.
   But it is not a dome either. The top of a head is a surface, and a surface
   lying across a glass is flat: what curves in a photograph of one is the
   perspective, and that is the same ellipse the rim is drawn with and no
   deeper. Given an ellipse of its own, two and a quarter rims tall, it came out
   as an arch — a bubble blown over the glass rather than foam sitting in it.
   So it is the rim's own ellipse for the plane, and over it a low mound that
   holds nearly its height right across and turns down only at the walls, which
   is the little a head stands proud by and how it lets go of the glass. */
const HEAD_LIFT = 0.55;                 /* of a rim's depth, over the middle */
function headCapY(u, extra){
  const rimRy = G.topHalf * G.ryTop;
  const disc = Math.sqrt(Math.max(0, 1 - u * u));                       /* the plane, foreshortened */
  const mound = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 6)));   /* and what stands above it */
  return (G.top + rimRy) - rimRy * HEAD_LIFT * mound
                         - (rimRy + (extra || 0)) * disc;
}

/* and the head's own top, which is the beer's far edge lifted by the head's
   depth, held under that cap */
function headTopAt(x){
  const u = clamp((x - G.cx) / Math.max(1, innerHalfAt(G.inTop)), -1, 1);
  return Math.max(backY(x) - headBand(), headCapY(u, 0));
}

/* How deep the head is. It cannot be all of what it would like to be on a
   glass filled to the lip: a head needs a glass to stand in, and one poured to
   the brim has none left to offer. What will not fit does not pile up in the
   air above the rim — it goes over the side, which is the weep. So the band is
   whatever fits below the lip, plus the little a head stands proud of one, and
   at the brim that is a collar of foam on a full glass rather than a tower of
   it on a glass that is somehow deeper than itself. */
/* How deep the head is. It used to be capped by the room left under the lip,
   to stop it towering when the beer was taken to the brim — but the beer is set
   from it now rather than the other way about, so it can never stand higher
   than the lip and there is nothing left to cap. It is simply as deep as it is
   asked to be, and the glass makes room by holding less beer. */
const headBand = () => (G.topHalf * 2) * (0.05 + 0.14 * cfg.headDepth / 100);

/* ================================================================== *
 * Surface physics — shallow water across the glass
 * ================================================================== *
 * hArr holds the surface as a depression below the rest line, positive
 * downwards to match the screen; uArr holds the depth-averaged sideways
 * velocity of the beer, on the faces between the columns rather than on the
 * columns themselves. Staggering the two is what keeps a shallow-water solver
 * from ringing: pressure is read across a face, and the flux it drives is
 * carried through that same face, so neighbouring columns cannot drift into
 * the sawtooth that a collocated grid allows.
 *
 * The old model was a plucked string — one wave speed everywhere, a restoring
 * force pulling every column back to the same line, and no notion of how much
 * beer any of it stood for. It could not conserve a drop, its waves ran at the
 * same speed through a full glass as through the dregs, and it treated the
 * glass as a rectangular tank.
 */

/* A vertical slice of the pour is only as wide as the chord of the glass
   there — the full bore at the middle, nothing at all against the wall — so
   the same rise carries far more beer at the centre than at the side. Reading
   the chord as the width of each column is what makes the round glass behave
   round: the surface tips about its middle, and the ends run up and down the
   way beer climbs a wall, rather than heaving as a rectangular tank would.
   Each column takes the average chord across its own width — that slice of
   the circle's area divided by its width — so the widths sum to exactly the
   area of the circle, and the columns against the wall are left a small
   breadth to divide by instead of none. */
/* ∫2√(1−u²)du out from the middle of a unit circle: the plan area of the slice
   from the centre to u, needing only the bore squared to become a real one */
const sliceArea = u => {
  const t = clamp(u, -1, 1);
  return t * Math.sqrt(Math.max(0, 1 - t * t)) + Math.asin(t);
};
/* What each column is worth, and how far apart they stand.
   areaArr[i] is the plan area the column covers — its own slice of its own
   bore, so a column riding high in the cone carries more beer for the same
   rise than the one opposite it riding low. That is the taper doing its work
   within a single wave rather than only between one fill and another.
   dxArr[k] is the gap between column k and the next, measured where they have
   actually ended up; boreArr[k] is the chord across the glass at that face. */
let areaArr = null, dxArr = null, boreArr = null, gridN = 0;
function grid(){
  if (!areaArr || gridN !== N){
    areaArr = new Float32Array(N);
    dxArr = new Float32Array(Math.max(1, N - 1));
    boreArr = new Float32Array(Math.max(1, N - 1));
    gridN = N;
  }
  const du = 2 / (N - 1);
  for (let i = 0; i < N; i++){
    const R = Math.max(1, colR(i));
    const u = colU(i);
    const lo = Math.max(-1, u - du * 0.5), hi = Math.min(1, u + du * 0.5);
    areaArr[i] = R * R * (sliceArea(hi) - sliceArea(lo));
  }
  for (let k = 0; k < N - 1; k++){
    dxArr[k] = Math.max(0.05, colX(k + 1) - colX(k));
    const uF = colU(k) + du * 0.5;
    const RF = Math.max(1, (colR(k) + colR(k + 1)) * 0.5);
    boreArr[k] = 2 * RF * Math.sqrt(Math.max(0, 1 - uF * uF));
  }
  return areaArr;
}

/* The wave carries no beer of its own: level says how much is in the glass and
   hArr only says what shape it is in. So whatever mean the wave has picked up
   is flattened out of it and handed back here, and the caller decides what it
   was — beer pushed aside by a finger, which is nobody's loss, or beer that
   went over the lip, which comes off the level. Returned in pixels of surface. */
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

/* Something has pushed the surface down here — a finger, a rising bubble, the
   pour landing. The dimple displaces beer rather than losing it, so its mean
   is flattened straight back out: what goes down here comes up everywhere
   else, and the wave leaves as it should from a surface that still holds the
   same pint. */
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

  /* The shape of the push, taken off its own mean so that it moves beer about
     rather than adding or removing any. */
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

  /* Set the beer moving rather than moving it. Pressed straight into the
     surface, every one of the two dozen bubbles that burst each second showed
     up on it the same instant, and the pour carried a tremor at the rate they
     were arriving — the glass answering the bubbles rather than the beer. A
     push given to the flow instead has to travel before it shows, and the
     surface adds the arrivals up as a liquid does, which is what the plucked
     string was doing right by accident.
     What the flow has to be is read straight off the surface it must produce:
     each face carries away everything the columns behind it are shedding, so
     the flux is the running total of the push and the speed is that flux over
     the bore it passes through. */
  const uCap = Math.sqrt(gravity() * H) * 2.5;
  let carried = 0;
  for (let k = 0; k < N - 1; k++){
    carried += rate * (profArr[k] - mean) * A[k];
    const bore = boreArr[k] * H;
    if (bore > 1e-6) uArr[k] = clamp(uArr[k] + carried / bore, -uCap, uCap);
  }
}

/* Dragging the beer sideways, and the phone's own gravity, both act on the
   body of the pour rather than on its surface: an even push along the glass,
   which piles the beer against the leading wall and lets the slosh mode build
   itself. The old code raked the surface into a ramp instead, which is the
   answer rather than the cause, and made the beer lean without ever moving. */
function driveFlow(a){
  if (!uArr) return;
  for (let k = 0; k < N - 1; k++) uArr[k] += a;
}

/* Gravity in pixels. Real gravity at this scale runs the slosh at several
   hertz, which is true of a pint and reads as a jitter, so the pour is given a
   heavier, slower liquid to swing at the pace the eye expects of beer. Wave
   speed leans on it rather than on a wave speed of its own, because in shallow
   water there is no such thing: how fast a wave crosses the glass is settled
   by gravity and by how deep the beer is, and nothing else. */
const GRAV = 2600;
const gravity = () => GRAV * G.scale * (0.35 + (cfg.waveSpeed / 100) * 1.10);

function stepWaves(step){
  if (!N || !hArr || !uArr || level <= 0.015) return;
  let A = grid();
  const H = Math.max(3, level * G.inH);            /* still-water depth */
  const g = gravity();
  const fric = 0.25 + (cfg.viscosity / 100) * 5.5;
  const ax = g * tiltForce();
  /* Drag alone holds every wavelength back by the same amount, which is not how
     a liquid loses a ripple: a short wave shears itself far harder than a long
     one and dies in a fraction of the time. Without that, gravity was left to
     answer every bubble that burst at the surface, and it answered at the pitch
     a disturbance that small deserves — the pour picked up a fast, fine tremor
     it never settled out of. Viscosity proper — the flow smoothing sideways
     into itself — falls on a wave by the square of its wavenumber, so a ripple
     a few columns wide is gone within a shake while the slosh across the whole
     glass is barely touched. */
  const nu = 115 * G.scale * G.scale * (0.35 + (cfg.viscosity / 100) * 1.3);

  /* A wave crosses the tightest gap in √(gH) seconds and the solver may not step
     over that, so the frame is cut into as many pieces as the depth asks for.
     A full glass carries its waves faster than a near-empty one — which is the
     shallow-water result the plucked string could not give — so the count
     answers to the level rather than being fixed at two. */
  const cmax = Math.sqrt(g * H);
  /* the tightest gap in the mesh is the one that sets the pace */
  let dxMin = 1e9;
  for (let k = 0; k < N - 1; k++) if (dxArr[k] < dxMin) dxMin = dxArr[k];
  /* Beer that is already moving carries the disturbance along with it, so what
     the step has to keep up with is the wave's speed and the flow's together.
     Sized on the wave alone, a hard enough flick — two hundred per cent
     agitation and a finger at the wall — set the pour running faster than the
     frame was being cut for, and the momentum term, which is the flow times its
     own slope, doubled every substep until it left the numbers and took the
     whole surface to NaN with it. Nothing drew after that, because every frame
     since was reading the same ruined array. */
  let uMax = 0;
  for (let k = 0; k < N - 1; k++){ const a = Math.abs(uArr[k]); if (a > uMax) uMax = a; }
  const sub = clamp(Math.ceil(step * (cmax + uMax) / (dxMin * 0.35)), 1, 32);
  /* The ceiling is a backstop for settings that would ask for more pieces than
     a frame can pay for. Past it the step runs long, and it is the drag and the
     clamps below that hold the solver together rather than the timestep. */
  /* Nor may the flow itself run away. Past a few times the speed a wave crosses
     the glass at there is nothing left to represent — beer in a pint does not
     go that fast however it is hit — and what is left is the arithmetic. */
  const uCap = cmax * 2.5;
  const dt = step / sub;
  const maxDepress = H - 2;

  for (let s = 0; s < sub; s++){
    /* Momentum on the faces: the surface slope drives the flow, the flow
       carries itself along, and drag holds it back. */
    for (let k = 0; k < N - 1; k++){
      const u = uArr[k];
      const dx = dxArr[k];                          /* this face's own gap */
      const slope = (hArr[k + 1] - hArr[k]) / dx;
      /* Read the slope of the flow from whichever side the flow is arriving
         from — downstream of itself it has no say in where it is going. */
      const du = u > 0 ? u - (k > 0 ? uArr[k - 1] : 0)
                       : (k < N - 2 ? uArr[k + 1] : 0) - u;
      const adv = u * du / dx;
      const uL = k > 0 ? uArr[k - 1] : -u;          /* no slip through the wall */
      const uR = k < N - 2 ? uArr[k + 1] : -u;
      const shear = nu * (uL - 2 * u + uR) / (dx * dx);
      uArr[k] = clamp((u + dt * (g * slope - adv + ax + shear)) / (1 + fric * dt),
                      -uCap, uCap);
    }
    /* Continuity: what each face carries is the depth it has to move times the
       width of glass at that face, taken from whichever side the flow is
       coming from — the upwind choice is what keeps a steep crest steep
       instead of smearing it into a hump. */
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
    /* Let the face down every substep rather than once a frame. Left to the
       end of the frame the flow has already carried the front past vertical
       and the limiter is pulling it back from somewhere it should never have
       reached — which showed as a face still standing at 64 degrees against
       a limit of 58. */
    breakCrests();
    /* The columns ride on the surface, so once it has moved they stand
       somewhere new — the mesh is re-measured before the next pass rather than
       the whole substep being run against where they used to be. */
    A = grid();
  }
  /* None of the above should be able to leave the numbers now. But a surface
     of NaN draws as nothing at all and poisons every frame after it, so it is
     worth one pass to find out and start the pour over rather than hand the
     renderer a glass it cannot paint. */
  for (let i = 0; i < N; i++){
    if (Number.isFinite(hArr[i])) continue;
    hArr.fill(0); uArr.fill(0); fArr.fill(0);
    return;
  }
  levelWave();                    /* the clamps are not allowed to cost a drop */
}

/* The surface is one height per column, so it can lean at any angle up to
   vertical and nothing past it. Beer driven hard at a wall does not stop there
   — it climbs, curls and comes apart — but the height field has no way to say
   so, and the steepening the flow does on its own carries the front over in a
   single column instead. Measured under a swipe it reached 86 degrees across
   five pixels, and the renderer joined those two columns with a straight line:
   the hard edge standing off the glass with the beer apparently cut away
   beside it.
   So the front is held to a slope beer can actually stand in, and what will
   not fit is passed down the face — the crest handing beer to the trough below
   it, which is what breaking is. The exchange is weighed by each column's own
   bore so it moves beer about without inventing or losing any, and the beer
   that comes over the top is thrown as head, since a breaking crest is where
   foam comes from in the first place. */
/* About fifty degrees. A slosh across the whole glass runs at forty at its
   steepest, so the limit only ever meets the front of a wave being driven
   into a wall — held here it keeps 95% of its swing. */
const MAX_FACE = 1.2;
function breakCrests(){
  if (!N || !hArr) return;
  const A = grid();
  /* A front steep over several columns has to be let down one column at a
     time, so the sweep is repeated until it finds nothing left to do */
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
      const crest = d > 0 ? i : i + 1;          /* the column standing higher */
      const trough = d > 0 ? i + 1 : i;
      hArr[crest] += move / (crest === i ? aL : aR);
      hArr[trough] -= move / (trough === i ? aL : aR);
      if (pass === 0 && move > 12 * G.scale && Math.random() < 0.5){
        addFoam(colX(crest), rand(3, 9) * G.scale);
      }
    }
    if (quiet) break;
  }
}

/* Beer that climbs past the rim leaves the glass. It is not cut off flat
   there: the lip is a weir, and a weir drains at a rate set by how deep the
   beer runs over its crest, so the pour rides up over the edge, pours while it
   is over, and drops back — which is the sloshing in and out of the glass that
   a hard ceiling at the rim could never show. */
/* ------------------------------------------------------------------ *
 * Foam over the lip
 * ------------------------------------------------------------------ *
 * A head that spills does not shed drops. It comes over the lip as a sheet,
 * gathers into a bead, and the bead draws a ribbon of foam down the outside
 * behind it — still joined to the rim the whole way, because foam is stiff
 * enough to hang from what it left. What it looked like before was rain: short
 * streaks that let go of the glass, fell at the speed of a stone, and were
 * gone inside three seconds.
 *
 * So a ribbon is a thing with two ends. It is anchored where it came over, it
 * is pulled by the bead at its foot, and it is held by every inch of wall it
 * has already been drawn across — which is what stops most of them partway
 * down and lets only the fattest reach the bar.
 */
const RIBBON_MAX = 6;

/* How plainly the glass is drawn: the strokes that stand for its walls and its
   rim. They are the only thing saying a glass is there at all, so they are kept
   apart from what is in it — turned down, the beer goes on exactly as it was
   and the vessel around it fades. */
const glassLine = () => clamp((cfg.glassLine == null ? 100 : cfg.glassLine) / 100, 0, 1);

/* How much of a breaking bubble reaches the head. Two dozen of them arrive at
   the surface every second, each one shoving the water a little and leaving a
   little foam behind, and the sum of that is a head that trembles the whole
   time the beer is carbonated. Turned down it is a still head over a lively
   pour, which is what most photographs of a pint look like. */
const bubbleBreak = () => clamp((cfg.bubbleBreak == null ? 100 : cfg.bubbleBreak) / 100, 0, 2);

/* How much bigger a bead is drawn for having come towards you, or smaller for
   having gone away. Nearly nothing at the far lip and better than twice over by
   the time it is about to pass the eye. */
const dropScale = d => 1 + 0.45 * clamp(d.near || 0, -0.8, 2.6);

/* How much weeping there is, and how deep it hangs. Measured against the glass
   and not against the head: the two were the same number, so a deeper head grew
   a deeper weep — but how far foam runs down the outside of a glass is a fact
   about the foam and the glass, not about how much of it is standing inside. */
const weepAmount = () => clamp((cfg.weep == null ? 100 : cfg.weep) / 100, 0, 2);
/* How plainly what has come over the lip is drawn — the collar, the ribbons
   running down the outside, the shade under the hem and what pools at the
   foot. Separate from how much of it there is: a glass can weep heavily in a
   film you can see the bar through, or barely at all in solid white. */
const weepAlpha = () => clamp((cfg.weepAlpha == null ? 100 : cfg.weepAlpha) / 100, 0, 1);
const weepDeep = () => (G.topHalf * 2) * 0.18 * weepAmount();

/* Before any of it runs, the head comes over the lip as a sheet and hangs there
   — the collar you see on a glass poured proud, which the ribbons are drawn out
   of. It is not a tally of what has spilled but a state of the pour: however
   much of the head is standing above the lip is how much has draped over it,
   and it follows the beer up and down rather than draining away between one
   spill and the next. Lobed rather than level, because foam hangs in tongues
   and not in a hem. */
let collar = 0;
/* How far down the glass it has got, nought at the lip and one at its full
   reach. Kept apart from the strength above, because the two are different
   things: how much foam came over the lip settles how far the weep will run,
   and this settles how far along it is. Folded into one, a weep that only ever
   drapes a third of its reach crept only a third of the way down. */
let creep = 0;
/* and how far below the lip its hem has got, in pixels. Eased for the same
   reason: the beer it is hanging past drops when the glass spills and climbs
   again as the glass tops itself up, and a weep that took that reading live
   ran up and down the outside of the glass with it. What is on the outside
   stays where it was put and the rest of it catches up slowly. */
let weepReach = 0;
function collarWant(){
  const band = headBand();
  if (band < 1 || weepAmount() <= 0.001) return 0;
  /* The weep is what the head sheds once the glass is filled to the lip: there
     is no room left for it to stand in, so it goes over the side. So it is the
     beer coming up to the brim that brings it on, and nothing else — a rim and
     a half short of the lip there is none of it, and at the lip there is all.
     It is the head's own top that is measured, not the beer's: the head is what
     goes over, and the beer now sits a head's depth below whatever the fill
     line says, so the beer's distance from the lip is only ever the head's own
     depth and says nothing about how full the glass is.
     And it runs once the head is over the lip, not on its way to it. Ramped in
     over a rim and a half of approach it had the glass weeping from about nine
     tenths full, which is a glass with its head still well inside it and
     nothing to shed. There is none of it until the head's edge is level with
     the lip, and all of it once the head stands as proud as a full glass leaves
     it — which is the same hundredth of the glass the brim is lifted by.
     Measured at the level the beer rests at rather than the surface it happens
     to be showing: read live, every wave that crossed the glass lengthened and
     shortened the weep under it, and foam already hanging on the outside of a
     glass does not run back up it because the beer sloshed. */
  const over = G.inTop - (restSurfaceY() - band);
  return clamp(over / Math.max(1, G.inH * BRIM_LIFT), 0, 1);
}
/* Four or five broad tongues across the face of the glass, not a dozen little
   scallops — foam hangs in lobes the width of a finger */
const COLLAR_LOBES = [1.4, 2.6, 4.3];
function collarDrape(th){
  let v = 0.58;
  for (let i = 0; i < COLLAR_LOBES.length; i++){
    v += 0.40 / (i + 1) * Math.sin(th * COLLAR_LOBES[i] + i * 2.1);
  }
  /* Closed off at the two sides. There the glass has turned away and the
     collar is edge on, so it has no depth to show — left open it hung off the
     silhouette as a pair of square tabs. */
  const edge = Math.cos(th);
  return clamp(v, 0.06, 1) * Math.min(1, Math.abs(edge) * 3.4);
}

/* Where the ribbon lies across the glass at a fraction of the way down it, and
   how wide it is there. Widest as it comes over the lip, drawn thin down the
   middle, and swelling into the bead that is doing the pulling. */
function ribbonHalf(d, t){
  /* the shoulder it comes over the lip on, drawn thin as it is pulled out */
  const tail = d.w * (0.45 + 0.75 * Math.pow(1 - t, 1.5));
  const bead = d.r * clamp((t - 0.70) / 0.30, 0, 1);
  return Math.max(tail, bead);
}

/* Foam arriving beside a ribbon that is already running feeds it instead of
   starting another, which is why a glass sheds a few thick ribbons rather than
   a fringe of identical ones. */
function spillFoam(x, r){
  if (weepAmount() <= 0.001) return;      /* turned right down, nothing runs */
  const rimY = G.inTop;
  const hwRim = Math.max(1, innerHalfAt(rimY));
  const th = Math.asin(clamp((x - G.cx) / hwRim, -1, 1));
  /* A ribbon is hung from a height, and the height is turned into a point on
     the glass by leaning it round the cone — so it lands on whatever circle it
     was hung from. Hung from the inner top it landed on a circle a rim's depth
     above the rim itself, and every ribbon on the glass sat some fifteen pixels
     high of the lip and cut across it. The lip is the plane of the rim ellipse,
     which is a good way below the point where the inside of the glass begins. */
  const lip = G.top + G.topHalf * G.ryTop;
  for (const d of drips){
    if (d.pool <= 0 && Math.abs(d.th - th) < 0.40){
      d.w = Math.min(d.w + r * 0.13, 10 * G.scale);
      d.r = Math.min(d.r + r * 0.20, 9 * G.scale);
      d.life = Math.max(d.life, rand(10, 17));
      return;
    }
  }
  if (drips.length >= RIBBON_MAX) return;
  drips.push({
    th,
    /* Started well above the lip they stood out over the rim as little tabs,
       so they were dropped below it — but a shade below it is a hairline of
       bare glass between the ribbon and the rim wherever the collar is not
       there to cover the join. Now that the top is cut on the lip's own curve
       rather than straight across, it can sit on the lip itself: half a pixel
       over, which closes the join and is too little to read as a tab. */
    top: lip - 0.5 * G.scale,
    h: lip + rand(8, 18),
    w: clamp(3 * G.scale + r * 0.25, 3.4 * G.scale, 10 * G.scale),
    r: clamp(r * 0.7, 2.4 * G.scale, 8 * G.scale),
    /* No two run alike: some foam is stiffer than the rest of it, and none of
       it runs dead straight — a trail wanders across whatever it is running on */
    slow: rand(0.55, 1.5),
    wob: Math.random() * TAU, wobA: rand(0.8, 2.4) * G.scale,
    vy: 0, pool: 0, life: rand(11, 22)
  });
}

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
    /* the crest it pours over is as long as the chord across the glass here,
       and what that costs the column is set by the plan area it covers */
    const bore = i < N - 1 ? boreArr[i] : boreArr[N - 2];
    const drain = Math.min(excess,
      WEIR * Math.sqrt(2 * g) * Math.pow(excess, 1.5) * bore * dt / Math.max(1e-6, A[i]));
    hArr[i] += drain;

    if (excess > 1.2 && Math.random() < clamp(excess * 0.07, 0.05, 0.8)){
      const x = colX(i);
      /* The drop leaves with the beer's own motion: the sideways speed it had
         at the lip, and the upward speed it must have had to get that far
         above it. Thrown out at random instead, beer came off the lip the
         pour was never running towards. */
      const uHere = ((i > 0 ? uArr[i - 1] : 0) + (i < N - 1 ? uArr[i] : 0)) * 0.5;
      /* Where round the rim it leaves by. The wave knows only how far across
         the glass a column stands, not where round it — but the rim is a
         circle, and a column that far across meets it at two places, one on
         the near lip and one on the far. Thrown outward in x alone, the whole
         spill left along a single flat plane: every bead of it going sideways
         and none of it at the eye.
         Picked with a wide spread besides, and not only at the two points the
         column strictly answers to. A crest arrives at a wall and runs along
         it, and in this model a wall is the extreme left or right of the
         screen, where the near lip and the far one meet and there is no depth
         left to leave by — so a spill that only ever left at its own column
         came off the two sides of the glass and nowhere else. */
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
        /* where it is in depth, and how fast it is closing on the eye */
        near: deep, dz: deep * rand(0.9, 2.6),
        foamy: Math.random() < 0.6, out: true
      });
    }
  }

  /* Draining only the columns that stand above the lip leaves a step beside
     the ones that do not, so the face is let down again before it is seen */
  if (over) breakCrests();

  /* What went over the lip is beer the glass no longer holds */
  if (over){
    const shift = levelWave();
    if (shift > 0) level = clamp(level - shift / G.inH, 0, 1);
  }

  /* The head goes over the lip before the beer does, and runs down the glass */
  let foamLost = 0;
  const hwRim = Math.max(1, innerHalfAt(rimY));
  for (let i = foam.length - 1; i >= 0; i--){
    const f = foam[i];
    const fy = surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy;
    /* Standing over the lip is not enough to go over it — the middle of a proud
       head has nowhere to fall to. It has to be out at the wall as well, which
       is the difference between a glass wearing its head and a glass weeping
       down its side. Filled to the brim the whole head is above the rim, and
       without this every fleck of it left at once: a torrent that stripped the
       head as fast as it formed and hung the glass with identical ribbons.
       At a rate a second, too, rather than a chance a frame — the old test
       spilled faster on a faster machine. */
    if (fy < rimY - f.r * 0.4 && Math.abs(f.x - G.cx) > hwRim * 0.62
        && Math.random() < dt * 2.4){
      foamLost += f.r * f.r * Math.PI;
      spillFoam(f.x, f.r);
      /* Some of it does not hang on at all. A head coming over a lip sheds
         beads as well as ribbons, and they leave by the same two sides.
         But only when it is thrown, and what throws it is the beer itself
         coming up to the lip — foam standing proud of a brimful glass creeps
         down the outside, it does not fling itself at the bar. Shed on a flat
         chance instead, a glass left alone put a drop on the counter every
         half minute while its beer sat forty pixels down the bore, and the
         only cure was to stop filling it. */
      const beer = surfaceAt(f.x) - ellipseDy(f.x) * 0.4;
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
      /* Lacing is laid where the head stands against the wall, not here — see
         layLacing. Marking it at the moment foam went over the lip meant only
         a glass filled to the brim was ever marked at all, and always in the
         same band under the rim. */
      foam.splice(i, 1);
    }
  }
  /* Foam is beer too, so losing a headful costs some of the pour */
  if (foamLost > 0){
    const area = Math.max(1, innerHalfAt(ry) * 2 * G.inH);
    level = clamp(level - (foamLost / area) * 0.95, 0, 1);
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
/* A tilted glass does not rake its surface into a ramp — gravity simply
   gains a sideways share, and the ramp is what the beer settles into in
   answer. Returned as that share, for stepWaves to weigh against its own
   gravity. */
function tiltForce(){
  return cfg.tilt && tiltLive ? tiltNow * 0.5 * (cfg.agitation / 100) : 0;
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
      /* and it leaves the floor at the depth its site lies at, which the eye
         reads as the far side of the glass being further away */
      const back = (s.v || 0) * ryAt(G.inBottom) * innerHalfAt(G.inBottom);
      addBubble(G.cx + s.u + rand(-3, 3), G.inBottom + back - rand(1, 8),
                rand(0.7, 3.2) * s.scale);
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
        /* A bubble breaking is a ripple, not a heave. Two dozen of them reach
           the surface every second, so whatever each one is worth is what the
           pour will be doing the whole time it is carbonated — and the figure
           here was set when a push moved the surface directly rather than
           setting it going, which flattered it. */
        const brk = bubbleBreak();
        if (brk > 0.001){
          splash(b.x, -Math.min(0.13, b.r * 0.018) * brk, (14 + b.r * 3));
          addFoam(b.x, clamp(b.r * 2.1 + 3, 3, 24 * G.scale) * brk);
        }
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
    const ride = innerHalfAt(sampleU(u));
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
    /* It travels in depth too. Held at the depth it left by, a bead thrown at
       the eye only ever sidled across the frame — the throw reads as being
       towards you because the thing gets bigger and drops down the frame as it
       closes, and neither happens if it never comes any nearer. */
    if (d.dz){
      d.near += d.dz * dt;
      d.y += d.dz * ryAt(d.y) * Math.max(1, innerHalfAt(d.y)) * dt * 1.5;
      if (d.near > 3.2){ drops.splice(i, 1); continue; }   /* past the eye */
    }

    const outsideGlass = Math.abs(d.x - G.cx) > innerHalfAt(d.y);
    if (!d.out && !outsideGlass && d.vy > 0 && d.y > frontY(d.x)){
      splash(d.x, 0.5 + d.r * 0.16 / G.scale, 18 + d.r * 4);
      if (d.foamy) addFoam(d.x, d.r * 2);
      drops.splice(i, 1);
      continue;
    }
    /* The bar is a plane, so a drop lands lower down the picture the nearer to
       the eye it comes down. Brought to rest at one height for all of them, the
       whole spray settled along a line ruled across the frame however far in
       front of the glass or behind it each bead had gone. One base bulge is the
       near lip's own distance out, so a bead that left there lands where it
       always did and the rest of them fall into place around it. */
    const bar = G.bottom - 2 + baseBulge() * clamp(d.near == null ? 1 : d.near, -1, 3.4);
    if (d.y > bar){
      mist.push({x:d.x, y:bar, vx:rand(-30,30)*G.scale, vy:-rand(20,70)*G.scale,
                 r:d.r * dropScale(d) * 0.5, near:d.near, life:rand(.2,.5)});
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
  /* The strength follows the pour at once — it is a fact about how full the
     glass is — and the creep takes its time, four seconds or so from the lip
     to wherever the strength says it is going. */
  collar = collarWant();
  const k = Math.min(1, dt * 0.25);
  creep += ((collar > 0.01 ? 1 : 0) - creep) * k;
  const reachWant = collar > 0.01
    ? Math.max(0, restSurfaceY() - (G.top + G.topHalf * G.ryTop)) : 0;
  weepReach += (reachWant - weepReach) * k;
  /* It runs until it is off the glass and onto the bar: the foot is the height
     the glass stands at, which is where the wall runs out from under it. */
  for (let i = drips.length - 1; i >= 0; i--){
    const d = drips[i];
    if (d.pool > 0){
      /* Landed. It spreads on the bar and then soaks in. */
      d.pool = Math.min(d.pool + 22 * G.scale * dt, d.r * 3.2);
      d.life -= dt * 0.5;
      if (d.life <= 0) drips.splice(i, 1);
      continue;
    }
    /* Foam has no terminal velocity worth the name. It has whatever speed the
       bead's own weight can drag past the wall that is holding it, so a fat
       bead runs and a thin one barely moves — and the further it has come the
       more wall there is behind it to hold it, which is what leaves a glass
       with ribbons stopped at every height rather than all of them on the bar. */
    const pull = 21 * G.scale * (d.r / (5 * G.scale)) / d.slow;
    const held = 1 + (d.h - d.top) / (G.inH * 0.22);
    d.vy += (pull / held - d.vy) * Math.min(1, dt * 1.2);
    d.h += d.vy * dt;
    /* The bead is spending itself on the trail it leaves behind */
    d.r = Math.max(0.5 * G.scale, d.r - d.vy * dt * 0.015);
    d.w = Math.max(0.5 * G.scale, d.w - dt * 0.03 * G.scale);
    d.life -= dt;
    /* and it stops with the bead standing on the bottom edge rather than
       hanging over it: the height the glass stands at is where the bead's
       underside belongs, not its middle, so the taller the bead the sooner it
       has arrived. */
    const foot = G.bottom - d.r;
    if (d.h >= foot){
      d.h = foot; d.vy = 0; d.pool = 0.01;
      d.life = Math.max(d.life, 8);
    } else if (d.life <= 0) drips.splice(i, 1);
  }
}

/* How big a bead is, over and above the glass's own scale. Everything a bead
   is measured in goes through here — the size it forms at, how fast it swells,
   the size at which it lets go — so the slider changes how big the beading is
   and not how quickly the glass sheds it. */
const dewScale = () => clamp((cfg.dewSize == null ? 100 : cfg.dewSize) / 100, 0.2, 2.2);

/* Condensation beads on the cold outside of the glass, below the beer line */
function addDew(r){
  const k = G.scale * dewScale();
  /* Even in angle round the face we can see, which is what crowds the beads
     towards the sides where the glass turns away — spread evenly across the
     width instead, they read as beads on a pane standing behind the glass. */
  dew.push({
    th: rand(-1, 1) * Math.PI * 0.5,
    h: rand(restSurfaceY() + 8, G.bottom - G.baseH * 1.5),
    r: r * k, rt: r * k, grow: rand(0.03, 0.12) * k,
    slip: rand(3.4, 4.6) * k, vy: 0
  });
}

/* A bead carries the size it formed at, the way a bubble does. But dew is not
   a bubble: it sits on the glass for as long as it takes to grow heavy, so a
   pour left alone would hold its old beading for a good while after the slider
   moved, and the slider would look dead. What is already on the glass is
   therefore taken up to the new size with it. */
let dewK = 1;
function updateDew(dt){
  const amount = clamp(cfg.condensation / 100, 0, 2);
  if (!amount){ dew.length = 0; return; }
  const k = dewScale();
  if (k !== dewK){
    const f = k / dewK;
    for (const d of dew){ d.r *= f; d.rt *= f; d.grow *= f; d.slip *= f; }
    dewK = k;
  }
  /* And there is as much of it as there is beer to chill the glass. A finger of
     beer beads the glass round the finger of beer, not from end to end: the
     beads already only take the wall below the pour, but the count they were
     working towards took no notice of the level, so a nearly empty glass
     crowded its whole allowance into the little wall it had. */
  const wet = clamp(level / 0.8, 0, 1);
  const want = Math.min(Math.round(capDew * amount * wet), 180);
  if (poured && dew.length < want && Math.random() < dt * 30 * amount) addDew(rand(0.7, 1.6));

  for (let i = dew.length - 1; i >= 0; i--){
    const d = dew[i];
    d.rt += d.grow * dt;
    d.r += (d.rt - d.r) * Math.min(1, dt * 9);     /* eases towards its target */
    if (d.r > d.slip || d.vy > 0){
      /* Grown too heavy: the bead lets go and runs. A big bead runs faster —
         big for its own beading, that is, so a glass beaded coarsely does not
         simply sheet off. */
      const px = G.scale * k;
      const top = (55 + 45 * Math.min(2, d.r / (2.5 * px))) * G.scale;
      d.vy = Math.min(d.vy + 70 * G.scale * dt, top);
      d.h += d.vy * dt;
      d.rt = Math.max(d.rt - dt * 0.8 * G.scale, 1.4 * px);
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

/* Lacing is not thrown at the glass, it is left behind. The head is against
   the wall the whole time it is there, and where the wall dries out from under
   it what was touching it stays. So specks are laid at the head's own contact
   with the wall, right round it, and they are only ever seen once the beer has
   gone down past them — which is why a glass drunk halfway wears a ring for
   every level it stood at, and why a slosh marks the wall as high as it threw
   the head.

   Laid at the head, never at a height picked somewhere between the rim and the
   beer. Pinned to the rim they sat in a band under the lip and stayed there
   whatever the pour did; and being laid only when foam went over the lip, a
   half-full glass sloshed hard was never marked at all.

   A falling line writes, because the wall it leaves behind is the wall that
   shows. So does a slosh, which is the same wall passing the same head faster.
   A glass standing still writes too, but only under its own head, where none
   of it can be seen until the beer goes down. */
const LACE_MAX = 320;
let laceAcc = 0, laceLast = null;
function layLacing(dt){
  if (level <= 0.03 || !foam.length || !N || !hArr){ laceLast = null; return; }
  const rest = restSurfaceY();
  const drain = laceLast == null ? 0
              : clamp((rest - laceLast) / Math.max(dt, 1e-4), 0, 400);
  laceLast = rest;
  const swing = (Math.abs(hArr[0]) + Math.abs(hArr[N - 1])) * 0.5;
  /* A glass standing still writes slowly. It has to write something — that is
     the ring waiting under the head for the beer to go down past it — but at
     the old rate the whole allowance sat there hidden and a slosh had nowhere
     left to put its own marks. */
  laceAcc = Math.min(10, laceAcc + dt * (1.8 + drain * 0.6 + swing * 4));

  const band = Math.max(2, headBand());
  /* The lip, as an ellipse. Nothing sticks to the inside of a glass above it. */
  const rimRy = G.topHalf * G.ryTop;
  const rimCy = G.top + rimRy;
  const rimInRx = Math.max(2, innerHalfAt(rimCy));
  const rimInRy = rimRy * 0.94;

  while (laceAcc >= 1 && lace.length < LACE_MAX){
    laceAcc -= 1;
    /* every x meets the wall at two places and foam clings to both, so where a
       speck sits round the glass is its own to choose — a blob's x cannot say */
    const th = rand(-Math.PI, Math.PI);
    const x = G.cx + innerHalfAt(rest) * Math.sin(th);
    /* Weighted to the top of the head rather than spread evenly down its
       flank. The mark a head leaves is its own high-water line: foam lower
       down is still against wall the beer will hold for a while yet, while the
       rim of it is the part that is about to be left in the air. Spread evenly,
       a slosh put most of what it laid back inside the head it came from and
       the wall above the beer stayed almost bare. */
    const r = Math.max(1, rand(1.2, 2.8) * G.scale);
    let h = surfaceAt(x) - band * Math.pow(Math.random(), 0.4);

    /* Brought back under the lip. A head standing proud of the rim is not
       against any wall up there, so a speck laid at its top belongs to nothing
       — and the far wall carries what is stuck to it a whole rim's depth up
       the screen besides, so specks that looked well inside the glass were
       drawn clear over the back of it.

       Measured on the projection, not on the height. The same height front and
       back is drawn two rim depths apart, so a ceiling ruled across heights
       cuts one side of the glass and lets the other through. The ceiling here
       is the lip's own ellipse, read at the angle the speck sits at, with the
       speck's width kept under it. */
    const c = Math.cos(th);
    const lx = G.cx + innerHalfAt(h) * Math.sin(th);
    const u = clamp((lx - G.cx) / rimInRx, -1, 1);
    const lid = rimCy - rimInRy * Math.sqrt(1 - u * u) + r;
    const ly = h + ryAt(h) * innerHalfAt(h) * c;
    if (ly < lid) h += lid - ly;

    const life = rand(26, 64);
    lace.push({ th, h, r, life, max: life });
  }
}

/* and fades slowly in the air, quickly once the beer comes back over it.
   Which of the two is settled by the height it is stuck at against the beer
   standing at that wall — both plane measures. Read off the speck's projected
   y instead, everything on the near wall was a bulge lower than the height it
   was stuck at and washed off as though it were under. */
function updateLace(dt){
  layLacing(dt);
  for (let i = lace.length - 1; i >= 0; i--){
    const l = lace[i];
    const [lx] = lacePos(l);
    l.life -= dt * (l.h > surfaceAt(lx) + 1 ? 6 : 1);
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
   It used to counter-parallax against the pointer, a step further back. But the
   pointer is also how the beer is stirred, so every swirl slid the mark about
   behind the glass — and a mark painted on the wall behind a bar does not move
   because somebody put a finger in a pint. It stays where it is put. */
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
  return [G.cx - lw / 2 - p, hY - gap - lh - p, lw + 2 * p, lh + 2 * p];
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
      if (s.key === "fill"){ level = targetLevel(); poured = true; }
      /* These are how you are looking at the beer, not what is in the glass, so
         moving them does not take the pour off its recipe */
      if (cfg.preset && s.key !== "fill" && s.key !== "agitation" && s.key !== "glassSize"
          && s.key !== "refill" && s.key !== "pace"){
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
