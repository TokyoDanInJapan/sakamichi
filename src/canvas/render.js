(() => {
"use strict";
const hexA  = (hex, a) => {
  const h = hex.trim().replace("#", "");
  const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/* ================================================================== *
 * Canvases
 * ================================================================== */
const stage  = document.getElementById("stage");
const cvL = document.getElementById("liquid");
const cvF = document.getElementById("foam");
const cvD = document.getElementById("detail");
const ctxL = cvL.getContext("2d");
const ctxF = cvF.getContext("2d");
const ctxD = cvD.getContext("2d");
const cvS = document.querySelector(".splash");
const ctxS = cvS.getContext("2d");

/* The head is drawn at less than full resolution: the goo filter blurs it
   into one body anyway, so the detail would be thrown away. Its edge is
   therefore soft over the better part of two of these coarser pixels once
   the browser stretches it back up, which is a thing the clip below has to
   know about. */
const FOAM_SCALE = 0.7;

/* Nor does the head's canvas cover the page. The goo filter is a blur over
   every pixel of the element it is set on, and the head only ever shows
   between the two walls — the element's clip below sees to that — so the
   canvas is cut down to that strip, from the top of the page to the floor of
   the glass, and a margin either side for the blur to draw on. Past the
   margin the blur has nothing of the head's left to carry; the threshold after
   it cannot tell the difference. Held in shares of the stage, like the clip,
   and started on a whole pixel of the canvas so the wet band's snapping lands
   on the same grid it did when the canvas started at the corner of the page. */
const FOAM_MARGIN = 30;
const foamBox = {x: 0, y: 0, w: 1, h: 1};
function sizeFoam(){
  const s = dpr * FOAM_SCALE;
  const reach = innerHalfAt(G.inTop) + FOAM_MARGIN;
  const x0 = Math.max(0, Math.floor((G.cx - reach) * s) / s);
  const x1 = Math.min(W, Math.ceil((G.cx + reach) * s) / s);
  const y1 = Math.min(H, Math.ceil((G.inBottom + innerHalfAt(G.inBottom) * ryAt(G.inBottom) + FOAM_MARGIN) * s) / s);
  foamBox.x = x0; foamBox.y = 0;
  foamBox.w = Math.max(1 / s, x1 - x0); foamBox.h = Math.max(1 / s, y1);
  cvF.width = Math.round(foamBox.w * s);
  cvF.height = Math.round(foamBox.h * s);
  ctxF.setTransform(s, 0, 0, s, -foamBox.x * s, -foamBox.y * s);
  const pc = v => (v * 100).toFixed(4) + "%";
  cvF.style.left = pc(foamBox.x / W);
  cvF.style.top = pc(foamBox.y / H);
  cvF.style.width = pc(foamBox.w / W);
  cvF.style.height = pc(foamBox.h / H);
}

function resize(){
  const r = stage.getBoundingClientRect();
  W = Math.max(1, r.width);
  H = Math.max(1, r.height);
  dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;

  for (const [cv, ctx, scale] of [[cvL,ctxL,1],[cvD,ctxD,1],[cvS,ctxS,1]]){
    const s = dpr * scale;
    cv.width  = Math.round(W * s);
    cv.height = Math.round(H * s);
    ctx.setTransform(s, 0, 0, s, 0, 0);
  }

  const moved = relayout();
  sizeFoam();
  buildPaths();
  remesh(moved);
}

/* ================================================================== *
 * The house mark (LOGO_SVG, in sim.js). Tinted copies are rebuilt
 * whenever the palette changes.
 * ================================================================== */

const logoImg = new Image();
let logoWall = null, logoBeer = null;
logoImg.onload = () => { buildLogoTints(); if (!cfg.running) renderAll(); };
logoImg.src = "data:image/svg+xml;utf8," + encodeURIComponent(LOGO_SVG);

/* Each blurred tint is a bitmap the size of the mark, so it is made once and
   again only when its colour changes — the palette is rebuilt every frame
   while a beer is being poured, and the tints do not change with the beer. */
let logoWallTint = "";
function buildLogoTints(){
  if (!logoImg.complete || !logoImg.naturalWidth) return;
  const make = tint => {
    const w = 1024, h = Math.round(1024 / LOGO_ASPECT);
    const pad = Math.round(w * LOGO_PAD);
    const c = document.createElement("canvas");
    c.width = w + pad * 2;
    c.height = h + pad * 2;
    const x = c.getContext("2d");
    x.filter = "blur(9px)";        /* depth of field: the wall is out of focus */
    x.drawImage(logoImg, pad, pad, w, h);
    x.filter = "none";
    x.globalCompositeOperation = "source-in";
    x.fillStyle = tint;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  };
  const wallTint = pal.dark ? "#b8bec4" : "#262c33";
  if (!logoWall || wallTint !== logoWallTint){
    logoWall = make(wallTint);
    logoWallTint = wallTint;
  }
  if (!logoBeer) logoBeer = make("#2b1a05");
}

let pal = {};
function buildPalette(){
  const room = applyRoom();
  const dark = isDark();
  const r = cfg.richness / 100;
  /* Hue and the two ends of the body's gradient, from the sliders or from the
     hex if one is set — see beerTone. Everything below is built off these, so
     a colour given outright carries the head, the glow and the light in the
     base with it rather than repainting the body alone. */
  const {h, sat, lTop, lBot} = beerTone();
  const au = auraTone();
  pal = {
    dark,
    ground: room.ground,
    beerTop: `hsl(${h + 4} ${sat}% ${lTop}%)`,
    beerMid: `hsl(${h + 2} ${sat}% ${(lTop + lBot) / 2}%)`,
    beerBot: `hsl(${h - 7} ${sat - 8}% ${lBot}%)`,
    beerDeep:`hsl(${h - 10} ${sat - 12}% ${Math.max(16, lBot - 10)}%)`,
    surface: `hsl(${h + 8} ${sat}% ${Math.min(88, lTop + 12)}%)`,
    /* the light it throws — see auraTone. Given no colour of its own these are
       the beer's, mixed exactly as they were before. */
    glow:    `hsla(${au.h} ${au.s}% ${au.l}% / ${dark ? 0.20 : 0.13})`,
    pool:    `hsla(${au.h + 3} ${Math.min(100, au.s + 2)}% ${Math.min(100, au.l + 2)}% / ${dark ? 0.30 : 0.18})`,
    baseBeer:`hsla(${h + 2} 82% 52% / .55)`,
    /* the thick base is lit through by the pour but is still glass, so it is
       cooled away from the beer's own colour */
    baseGlass:`hsla(${h + 12} 44% 60% / .5)`,
    /* Foam is beer held in bubble walls: a pilsner head is bright white, a
       bock head beige. The wet band at the beer line carries the most colour. */
    foam:    `hsl(${38 + (h - 40) * 0.6} ${24 + r * 30}% ${dark ? 88 - r * 7 : 97 - r * 8}%)`,
    foamWet: `hsl(${h + 4} ${55 + r * 20}% ${dark ? 72 - r * 11 : 84 - r * 13}%)`,
    foamEdge:dark ? "rgba(40,32,18,.30)" : "rgba(120,84,26,.20)",
    cell:    `rgba(120,84,26,${((dark ? 0.13 : 0.10) + r * 0.08).toFixed(3)})`,
    glassEdge: dark ? "rgba(238,241,243,.34)" : "rgba(14,19,25,.26)",
    glassLight: dark ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.85)",
    /* An arc lying in a horizontal surface has to sit back at the far side and
       take the light at the near one. On a pale ground "sitting back" is a dark
       line, so glassEdge and glassLight say it directly; on a dark ground there
       is nothing darker than the ground to draw with, and those two swap over —
       glassEdge is the brighter of the pair. So the floor gets its own pair,
       where the far arc sits back by being the fainter, either way round.
       Split into colour and alpha, since each is stroked as a gradient that
       fades along its length rather than as a flat colour. */
    floorFar:  dark ? {rgb:"238,241,243", a:0.12} : {rgb:"14,19,25", a:0.26},
    floorNear: dark ? {rgb:"255,255,255", a:0.42} : {rgb:"255,255,255", a:0.85},
    /* the same two, without an alpha, for strokes that fade along their length */
    edgeRGB: dark ? "238,241,243" : "14,19,25",
    lightRGB: "255,255,255",
    glassTint: dark ? "rgba(210,225,235,.05)" : "rgba(14,19,25,.035)",
    shadow: dark ? "rgba(0,0,0,.55)" : "rgba(14,19,25,.20)"
  };
  buildLogoTints();
}
buildPalette();

/* ================================================================== *
 * Paths
 * ================================================================== */
function wallPath(ctx, inner, fromY, toY){
  const half = inner ? innerHalfAt : halfAt;
  const steps = 22;
  ctx.beginPath();
  ctx.moveTo(G.cx - half(fromY), fromY);
  for (let i = 1; i <= steps; i++){
    const y = lerp(fromY, toY, i / steps);
    ctx.lineTo(G.cx - half(y), y);
  }
  for (let i = steps; i >= 0; i--){
    const y = lerp(fromY, toY, i / steps);
    ctx.lineTo(G.cx + half(y), y);
  }
  ctx.closePath();
}

/* The glass outline as one closed shape: the top half of the rim ellipse,
   joined to the walls at the ellipse's widest points, down to the front arc
   of the base ellipse the glass stands on. Pass fromY to start below the rim
   with a flat chord instead (useful as a clip for the base). */
/* Static per layout, so each is traced once in resize() and reused as a
   Path2D — they were being rebuilt point by point several times a frame */
const PATHS = {sil:null, base:null, interior:null};
function buildPaths(){
  PATHS.sil = glassSilhouette();
  PATHS.base = glassSilhouette(G.bottom - G.baseH * 2.1);
  PATHS.interior = interiorPath();
  clipFoamToGlass();
  REFL.ver = -1;                   /* the wall moved, so its highlights are stale */
}

/* The head is drawn clipped to the inside of the glass, but the foam canvas is
   gooed by a CSS filter — a blur wide enough to pull the bubbles into one body,
   then an alpha ramp that hardens the result back into a silhouette. That runs
   on the finished canvas, after the clip has been and gone, and it hands back a
   shape a few pixels wider than the one it was given, with the shoulders
   squared off where the blur outran the taper. So the head came out standing on
   the wall rather than inside it, and no longer agreed with either the beer
   below it or the glass around it.
   The element's clip-path is applied after its filter, so it is the one cut the
   goo cannot spill past. It follows the interior wall, and carries the wall's
   width straight up above the lip, where the head is allowed to dome but not to
   grow wider than the glass it came out of.

   It cuts on the wall itself, with nothing added.

   That was not always safe. Cut on the wall while the head was also drawn to
   the wall, the clip took the outer half of the blur's ramp rather than
   landing on it, and the head stood back from the glass by about as much — a
   hairline of bar top between the two where the beer below sat flush. The cut
   was carried out past the wall to get clear of the ramp, which fixed the
   hairline and left the head standing some four pixels wider than the bore it
   was poured into.

   Both were the same mistake, made at different ends: the ramp has to fall
   somewhere, and the only place it can fall harmlessly is outside the wall.
   So the head is drawn out past the wall instead — see the grow in headClip —
   and the cut comes back to the wall itself, where it lands on foam that is
   already solid. The blur eats material that was going to be trimmed anyway,
   the clip lands on a hard edge, and the head ends where the glass does.
   Measured against the wall with the glass off: four pixels proud before, half
   a pixel now, which is the antialiasing of the cut. */
function clipFoamToGlass(){
  const steps = 20;
  const ihTop = innerHalfAt(G.inTop);
  /* In shares of the box rather than in pixels of it. This is a CSS clip on the
     element — it has to be, because it must cut after the goo filter rather
     than before it, or the blur would carry the foam back out through the wall
     it was just cut at. But the element's box and the canvas inside it can come
     apart: the backing store is sized when the stage is measured, and if the
     stage changes size afterwards without anything re-measuring it — a web font
     arriving is enough — the browser stretches the old drawing to the new box.
     The drawing stretches; a clip written in pixels does not, and it lands
     wherever those pixels now fall. Its bottom is a chord across the floor of
     the glass, so what that showed was a flat line ruled across the head with
     everything below it cut away. Shares of the box stretch with the box. */
  const px = (x, y) => `${((x - foamBox.x) / foamBox.w * 100).toFixed(3)}% ${((y - foamBox.y) / foamBox.h * 100).toFixed(3)}%`;
  const pts = [px(G.cx - ihTop, 0)];
  for (let i = 0; i <= steps; i++){
    const y = lerp(G.inTop, G.inBottom, i / steps);
    pts.push(px(G.cx - innerHalfAt(y), y));
  }
  /* The floor is closed on the floor's own near arc, not on a chord ruled
     across it. This clip cuts after the goo filter, so whatever shape it ends
     on is the shape the head ends on: a chord here ruled a flat line across
     the bottom of the head in a nearly-empty glass, under a floor that is
     plainly an ellipse. The drawn head already comes down on this arc — see
     headClip — and the two have to agree or the shorter one wins. */
  const ihF = innerHalfAt(G.inBottom);
  const iryF = innerHalfAt(G.inBottom) * ryAt(G.inBottom);
  for (let i = 0; i <= steps; i++){
    const u = -Math.cos(Math.PI * i / steps);
    pts.push(px(G.cx + u * ihF, G.inBottom + iryF * Math.sqrt(Math.max(0, 1 - u * u))));
  }
  for (let i = steps; i >= 0; i--){
    const y = lerp(G.inTop, G.inBottom, i / steps);
    pts.push(px(G.cx + innerHalfAt(y), y));
  }
  pts.push(px(G.cx + ihTop, 0));
  cvF.style.clipPath = `polygon(${pts.join(",")})`;
}

function glassSilhouette(fromY){
  const ctx = new Path2D();
  const rimRy = G.topHalf * G.ryTop;
  const yT = fromY == null ? G.top + rimRy : fromY;
  const bry = baseBulge();
  const steps = 22;
  if (fromY == null) ctx.ellipse(G.cx, yT, halfAt(yT), rimRy, 0, Math.PI, TAU);
  else { ctx.moveTo(G.cx - halfAt(yT), yT); ctx.lineTo(G.cx + halfAt(yT), yT); }
  for (let i = 1; i <= steps; i++){
    const y = lerp(yT, G.bottom, i / steps);
    ctx.lineTo(G.cx + halfAt(y), y);
  }
  ctx.ellipse(G.cx, G.bottom, G.botHalf, bry, 0, 0, Math.PI);
  for (let i = steps; i >= 0; i--){
    const y = lerp(yT, G.bottom, i / steps);
    ctx.lineTo(G.cx - halfAt(y), y);
  }
  ctx.closePath();
  return ctx;
}

/* The inside of the glass: the walls at every height, closed by the floor's
   own front arc. The beer is bounded by this, not by its own outline. */
/* Where the head is allowed to be: the walls at every height, and above the
   lip a dome closing to nothing. Carrying the interior's full width up there
   instead — which is what clamping innerHalfAt does — lets a high pour sit
   over the glass as a slab with square shoulders, wider than the glass it
   came out of. */
/* grow: how far past the inner wall to carry the cut, in canvas pixels.

   The foam sheet is blurred and re-thresholded after it is drawn, and a blur
   rounds a corner by pulling it inward. Cut dead on the wall, the head had
   nothing outside the wall to lose, so the rounding came out of the head
   itself: down the flat of the side it still reached the glass, but at the two
   corners — where the crown turns down onto the lip, and where the head meets
   the beer — it stood some three pixels back, which is the dark hairline
   between the head and the glass beside the rim. Carried out past the wall,
   what the blur rounds off is the part that was going to be trimmed anyway,
   and the silhouette against the glass is set by the clip on the element,
   which cuts after the filter and follows the wall's own curve. */
function headClip(ctx, domeH, grow){
  grow = grow || 0;
  const steps = 20;
  const ihwTop = innerHalfAt(G.inTop) + grow;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++){
    const y = lerp(G.inTop, G.inBottom, i / steps);
    const x = G.cx - innerHalfAt(y) - grow;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  /* Across the floor on the floor's own arc, not on a chord. The bottom of a
     glass is a disc, and a head with almost no beer left under it comes to rest
     on that disc — so what closes it off down there is the near half of the
     floor's ellipse, the same curve the floor itself is drawn with. Closed on
     the chord instead, the last of the foam sat on a dead straight line ruled
     across the glass, which is the one shape a glass with elliptical walls
     cannot show. Walked by angle so the two ends, where the ellipse turns
     hardest, are not joined across by a straight line either. */
  const ihwF = innerHalfAt(G.inBottom) + grow;
  const iryF = innerHalfAt(G.inBottom) * ryAt(G.inBottom) + grow;
  const fSteps = 40;
  for (let i = 0; i <= fSteps; i++){
    const u = -Math.cos(Math.PI * i / fSteps);
    ctx.lineTo(G.cx + u * ihwF, G.inBottom + iryF * Math.sqrt(Math.max(0, 1 - u * u)));
  }
  for (let i = steps; i >= 0; i--){
    const y = lerp(G.inTop, G.inBottom, i / steps);
    ctx.lineTo(G.cx + innerHalfAt(y) + grow, y);
  }
  /* Over the lip the head is crowned rather than domed. A dome centred on the
     glass has its full height only over the middle and none at all at the
     walls — but a head shoved against one wall is exactly the head that rides
     over the rim, and there the dome had no height left to give it, so it
     sliced the raised shoulder off along a curve belonging to neither the head
     nor the glass. The crown holds nearly its full height right across and
     turns down only at the very edges, which closes the head over the lip the
     way the dome was meant to without taking the side off it. */
  /* And it is measured from the head, not from the rim. Pinned to the inner
     top it was a fixed line while the head rose with the beer — so a glass
     filled to the brim, where the head stands clear of the rim altogether, had
     its dome cut off along that line and came out as a flat slab with rounded
     corners. Its own top is already a dome, following the far edge of the beer
     it floats on; there was never a shape wanting to be supplied here, only a
     limit, and the limit was in the wrong place.
     Taken from whichever is higher — the rim, or the head's own top — the one
     allowance closes the head over the lip while it is sitting in the glass and
     leaves it its crown once it is standing above it. */
  /* and the clip follows the same cap, lifted by the allowance, so the ragged
     blobs have room to stand above the head's own top without any of them
     standing above the rim at the walls — where the cap comes back to the lip
     and takes the allowance with it. */
  const crown = Math.max(1, domeH);
  const cSteps = 20;
  for (let i = 0; i <= cSteps; i++){
    const t = 1 - 2 * i / cSteps;                    /* +1 at the right wall */
    ctx.lineTo(G.cx + t * ihwTop, headCapY(t, crown));
  }
  ctx.closePath();
}

function interiorPath(){
  const ctx = new Path2D();
  const steps = 20;
  const ihw = innerHalfAt(G.inBottom);
  /* Bounded above by the far arc of the lip, which is as far down into the
     glass as there is to see. It was flattened to a rule across the top for a
     while, because the arc was cutting the beer short of the head at the walls
     — but that was the fill line's fault and not the arc's: brim full stood a
     rim above the brim, so the beer was over-topping the glass and the arc was
     doing its job. With the brim where the lip is, a full glass reaches the arc
     and no further, and anything still above it is beer on its way over. */
  const rimRy = G.topHalf * G.ryTop;
  for (let i = 0; i <= steps; i++){
    const y = lerp(G.inTop, G.inBottom, i / steps);
    const x = G.cx - innerHalfAt(y);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.ellipse(G.cx, G.inBottom, ihw, ihw * ryAt(G.inBottom), 0, Math.PI, 0, true);
  for (let i = steps; i >= 0; i--){
    const y = lerp(G.inTop, G.inBottom, i / steps);
    ctx.lineTo(G.cx + innerHalfAt(y), y);
  }
  ctx.ellipse(G.cx, G.inTop, innerHalfAt(G.inTop), rimRy * 0.94, 0, 0, Math.PI, true);
  ctx.closePath();
  return ctx;
}

/* The far arc of the lip is the deepest the eye reaches into the glass, so
   nothing seen inside it may be painted above that line. At the two walls the
   arc comes right down to the rim's own side, and anything held to a flat top
   instead stands proud of the glass there, against the dark outside it. */
function clipUnderRim(ctx){
  const ry = G.topHalf * G.ryTop;
  const cy = G.top + ry;
  const rx = innerHalfAt(cy);
  ctx.beginPath();
  ctx.moveTo(G.cx - rx, H);
  ctx.lineTo(G.cx - rx, cy);
  ctx.ellipse(G.cx, cy, rx, ry * 0.94, 0, Math.PI, 0);
  ctx.lineTo(G.cx + rx, H);
  ctx.closePath();
  ctx.clip();
}

/* The beer: bounded above by the far edge of its surface, below by the glass */
function liquidPath(ctx){
  const [l, , w] = surfaceSpan();
  /* Each wall starts at the beer standing against it, not at the level the
     beer would stand at if it were still. They are the same thing in a quiet
     glass, which is why this held for so long; tilt the surface and they are
     not. The top edge ends on the wave and the wall began a whole amplitude
     away from it, so the outline jumped there and the shape closed across
     itself — a black wedge cut out of the beer under the low side, with the
     straight edge of the resting level along the bottom of it. Worst in a
     glass with little in it, where the wave is large against what is left.
     The reflection is drawn from this same outline, so it wore the wedge too. */
  const syR = backY(l + w), syL = backY(l);
  const over = Math.max(12, G.topHalf - w / 2 + 12);
  /* a Path2D takes the same moves and has no beginPath to start */
  if (ctx.beginPath) ctx.beginPath();
  ctx.moveTo(l - over, syL);
  for (let i = 0; i < N; i++) ctx.lineTo(colX(i), colBackY(i));
  ctx.lineTo(l + w + over, syR);
  const steps = 18;
  for (let i = 0; i <= steps; i++){
    const y = lerp(syR, G.inBottom, i / steps);
    ctx.lineTo(G.cx + innerHalfAt(y), y);
  }
  /* The beer sits on the interior floor, whose front arc dips below inBottom */
  const ihw = innerHalfAt(G.inBottom);
  ctx.ellipse(G.cx, G.inBottom, ihw, ihw * ryAt(G.inBottom), 0, 0, Math.PI);
  for (let i = steps; i >= 0; i--){
    const y = lerp(syL, G.inBottom, i / steps);
    ctx.lineTo(G.cx - innerHalfAt(y), y);
  }
  ctx.closePath();
}

/* Crown: from the far edge of the head down to the front of the beer. Carried
   as far past the ends as the beer under it is, so the head reaches the glass
   wherever the beer does rather than stopping a little short of it. Its own
   function because the bar has to draw it too — what stands in the glass is
   what the bar reflects, and a head is most of what stands in a full one. */
function headPath(ctx){
  const [l, , w] = surfaceSpan();
  const over = Math.max(12, G.topHalf - w / 2 + 12);
  /* A Path2D takes the same moves as a context and has no beginPath to start,
     so the head's outline can be built as a path in its own right and handed
     about — which is how the glass gets to ask what the head is covering. */
  if (ctx.beginPath) ctx.beginPath();
  ctx.moveTo(l - over, headTopAt(l));
  for (let i = 1; i < N; i++) ctx.lineTo(colX(i), colHeadTop(i));
  ctx.lineTo(l + w + over, headTopAt(l + w));
  /* The underside rides the head's own raft, not the beer's skin. Cut on the
     live surface it took every bubble that broke under it, so the waterline
     jiggled the whole time the glass was fizzing — the same fault the top had,
     at the other end of the head. What shows between the two, when the raft
     sits above the beer's arc, is the surface disc, which is beer: there is no
     gap to open. */
  ctx.lineTo(l + w + over, headFrontY(l + w) + 1);
  for (let i = N - 1; i >= 0; i--) ctx.lineTo(colX(i), colHeadFrontY(i) + 1);
  ctx.lineTo(l - over, headFrontY(l) + 1);
  ctx.closePath();
}

/* ================================================================== *
 * Rendering
 * ================================================================== */
/* Everything on the bar top, drawn in page coordinates. Kept as its own
   function: caching it to an offscreen strip and blitting that composites
   differently from painting it in place, and the difference tells on the
   plane, so it is drawn straight onto the canvas. */
/* How much of the counter one tile of timber covers, in camera heights */
const WOOD_TILES = 0.34;
let woodImg = null;
{
  const im = new Image();
  im.onload = () => { woodImg = im; if (!cfg.running) renderAll(); };
  im.src = BAR_WOOD;
}

/* The counter in timber, laid in the plane's own coordinates and kept.

   A ground plane has one row of screen for each distance away from the eye, so
   a row is all one depth and the whole plank can be laid a row at a time: how
   far apart the grain stands across a row, and which line of the tile that row
   is looking at, both follow from that one depth. Which is why it is drawn
   this way rather than with an image stretched over the bar — stretching gives
   grain running parallel to the frame, and a plane whose timber does not run
   away from you is a poster of a counter, not a counter.

   The plane vanishes where a horizontal circle would degenerate to a line,
   which is where ryAt reads zero — the same camera the rim and the base
   ellipses are drawn with, so the grain runs to the point they run to.

   Kept, because none of it moves: it answers to the size of the stage and the
   palette and nothing else, and rebuilding four hundred rows a frame to paint
   the same plank again would be work for nothing. */
const WOOD = {cv:null, key:"", top:0};
function barWood(){
  if (!woodImg) return null;
  const top = Math.floor(horizonY());
  /* Keyed on what the timber actually depends on. Keyed on the palette's
     version it was rebuilt whenever any colour anywhere changed — and the beer
     changing colour is a colour changing, so every frame of a pour rebuilt the
     whole counter row by row: 85 rebuilds in the 120 frames of one transition,
     for a sheet of wood that had not altered in any of them. The only thing
     here that reads the palette is which way round the light goes. */
  const key = `${W}|${H}|${top}|${dpr}|${pal.dark}`;
  if (WOOD.key === key) return WOOD;

  const h = Math.max(1, Math.ceil(H - top));
  const cv = WOOD.cv || (WOOD.cv = document.createElement("canvas"));
  cv.width = Math.max(1, Math.round(W * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  const c2 = cv.getContext("2d");
  c2.setTransform(dpr, 0, 0, dpr, 0, 0);
  c2.clearRect(0, 0, W, h);

  const pat = c2.createPattern(woodImg, "repeat");
  const tw = woodImg.width, th = woodImg.height;
  const yV = -camEye * H;                       /* the plane's vanishing line */
  const fL = camLens * H;                       /* and its focal length */
  const rows = Math.ceil(h * dpr);
  c2.fillStyle = pat;
  for (let r = 0; r < rows; r++){
    const yc = r / dpr;                         /* the row, in the sheet's own space */
    const dy = Math.max(1, top + yc - yV);
    const ax = dy / (WOOD_TILES * tw);          /* screen across, per pixel of tile */
    const tv = (fL / dy) * WOOD_TILES * th;     /* and the line of it this row reads */
    pat.setTransform(new DOMMatrix([ax, 0, 0, 1, G.cx, yc - tv]));
    c2.fillRect(0, yc, W, 1 / dpr + 0.5);
  }

  /* Lit the way the bare plane is: paler where it recedes, deeper towards the
     eye, so the glass goes on standing on it rather than in front of it. */
  const lum = c2.createLinearGradient(0, 0, 0, h);
  const near = pal.dark ? 0.34 : 0.70, far = pal.dark ? 0.72 : 1.00;
  for (let i = 0; i <= 8; i++){
    const yc = h * i / 8, tt = top + yc - horizonY();
    const persp = tt / (tt + G.botHalf * 1.2);
    const v = Math.round(255 * (far + (near - far) * persp));
    lum.addColorStop(i / 8, `rgb(${v},${v},${v})`);
  }
  c2.globalCompositeOperation = "multiply";
  c2.fillStyle = lum;
  c2.fillRect(0, 0, W, h);
  c2.globalCompositeOperation = "source-over";

  WOOD.key = key;
  WOOD.top = top;
  return WOOD;
}

/* The mark mirrored in the bar, frosted. Blurred once and kept: it moves only
   with the layout and the wall's tint, and blurring the whole mark again every
   frame was a tenth of the cost of drawing one. Painted with the transform and
   filter it was drawn with in place, onto a sheet that covers only the part of
   the bar it can reach, starting on a whole device pixel. */
const LOGO_MIRROR = {cv: null, key: "", x: 0, y: 0};
const LOGO_MIRROR_BLUR = 5;
function logoMirror(hY){
  if (!logoWall) return null;
  const [lx, ly, lw, lh] = logoRect();
  const key = `${W}|${H}|${dpr}|${hY}|${lx}|${ly}|${lw}|${lh}|${logoWallTint}`;
  if (LOGO_MIRROR.key === key) return LOGO_MIRROR.cv ? LOGO_MIRROR : null;
  LOGO_MIRROR.key = key;
  const spread = LOGO_MIRROR_BLUR * 3;
  const x0 = Math.max(0, Math.floor((lx - spread) * dpr));
  const x1 = Math.min(Math.round(W * dpr), Math.ceil((lx + lw + spread) * dpr));
  const y0 = Math.max(0, Math.floor(hY * dpr));
  const y1 = Math.min(Math.round(H * dpr), Math.ceil((2 * hY - ly + spread) * dpr));
  if (x1 <= x0 || y1 <= y0){ LOGO_MIRROR.cv = null; return null; }
  const cv = document.createElement("canvas");
  cv.width = x1 - x0; cv.height = y1 - y0;
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, -x0, -y0);
  c.translate(0, 2 * hY);
  c.scale(1, -1);
  c.filter = `blur(${LOGO_MIRROR_BLUR}px)`;       /* frosted, not polished */
  c.drawImage(logoWall, lx, ly, lw, lh);
  Object.assign(LOGO_MIRROR, {cv, x: x0, y: y0});
  return LOGO_MIRROR;
}

function drawBarTop(ctx){
  /* The bar top: the wall meets it back at the horizon, behind the glass,
     so the floor shows behind the pour and the glass stands ON the plane.
     The wall mirrors about the horizon; the pour about its own contact. */
  const bry = baseBulge();
  const hY = horizonY();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, hY, W, H - hY);
  ctx.clip();
  const lm = logoMirror(hY);
  if (lm){
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = pal.dark ? 0.07 : 0.06;
    ctx.drawImage(lm.cv, lm.x, lm.y);
    ctx.restore();
  }
  /* The wall reflection sinks into the bar — into its own tone, or into the
     timber, which is the same job done by the surface the counter is made of */
  const wood = cfg.counter === "wood" ? barWood() : null;
  if (wood){
    ctx.drawImage(wood.cv, 0, wood.top, W, H - wood.top);
    /* The shader's timber carries the wall reflected in it near the horizon,
       sinking away over a quarter of the glass's height, and a milky veil
       from the frost. Without them the canvas's timber was a good deal darker
       than the shader's in the light and paler at the back in the dark. The
       same measures as the shader's: the wall at 45% dark and 30% light, and
       a veil of 3 or 9 levels, come in over the first sixty pixels. */
    const k = pal.dark ? 0.45 : 0.30, run = G.h * 0.26;
    const wall = ctx.createLinearGradient(0, hY, 0, H);
    for (let i = 0; i <= 8; i++){
      wall.addColorStop(i / 8, hexA(pal.ground, k * Math.exp(-(H - hY) * i / 8 / run)));
    }
    ctx.fillStyle = wall;
    ctx.fillRect(0, hY, W, H - hY);
    const v = pal.dark ? "3,3,4" : "9,9,10";
    const veil = ctx.createLinearGradient(0, hY, 0, hY + 60);
    veil.addColorStop(0, `rgba(${v},0)`);
    veil.addColorStop(1, `rgba(${v},1)`);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = veil;
    ctx.fillRect(0, hY, W, H - hY);
    ctx.globalCompositeOperation = "source-over";
  } else {
    const fadeR = ctx.createLinearGradient(0, hY, 0, hY + Math.max(140, G.h * 0.4));
    fadeR.addColorStop(0, hexA(pal.ground, 0.35));
    fadeR.addColorStop(1, hexA(pal.ground, 1));
    ctx.fillStyle = fadeR;
    ctx.fillRect(0, hY, W, H - hY);
  }

  if (level > 0.001 && !glassAway){
    const syR = restSurfaceY();
    const bodyR = ctx.createLinearGradient(0, syR - maxAmp, 0, G.inBottom);
    bodyR.addColorStop(0,    pal.beerTop);
    bodyR.addColorStop(0.34, pal.beerMid);
    bodyR.addColorStop(0.86, pal.beerBot);
    bodyR.addColorStop(1,    pal.beerDeep);
    /* Painted into its own sheet first, so it can be laid down the bar in
       strips afterwards and made to wander as it goes. The bar is frosted, not
       polished: a mirror in it comes apart the further across it you look, and
       drawn straight it was a flat trapezoid of light with two ruled edges —
       a spotlight on the counter rather than the glass in it. */
    const rc = barMirror();
    rc.save();
    /* Mirrored about the footprint centre, which is where the glass touches */
    rc.translate(0, 2 * G.bottom);
    rc.scale(1, -1);
    rc.filter = "blur(6px)";
    /* The glass reflects as well as the beer it holds. Without its silhouette
       the reflection is only as wide as the pour, so it leaves the foot as a
       flat slab set in from the glass's edges instead of flowing out of them. */
    rc.globalAlpha = pal.dark ? 0.22 : 0.16;
    rc.fillStyle = pal.glassLight;
    rc.fill(PATHS.sil);
    rc.globalAlpha = pal.dark ? 0.42 : 0.30;
    rc.lineWidth = Math.max(1.5, G.wall * 0.7);
    rc.strokeStyle = pal.glassLight;
    /* the silhouette by name. Stroked bare it took whatever path was last
       built, which is the clip this is drawn inside, so the glass's outline
       came out as a line ruled across the whole bar. */
    rc.stroke(PATHS.sil);
    rc.globalAlpha = 0.34;
    /* The beer's own reflection, kept inside the glass that is holding it.
       The surface outline runs out past the walls on purpose — the fill has to
       cover the corners of the interior it is normally clipped to — and down
       here there was no such clip, so the overhang came out on the bar as a
       slab wider than the glass. Tilt the beer and the slab tilts with it,
       which is what turned the reflection into a streak leaning off to one
       side whenever the pour was swilled. Worst with little in the glass,
       where the overhang is widest and the tilt steepest. */
    rc.save();
    rc.clip(PATHS.interior);
    liquidPath(rc);
    rc.fillStyle = bodyR;
    rc.fill();
    /* and the head with it. It was left out, and a pint is mostly head to look
       at: the bar carried an amber body with nothing on top of it. Its own
       blobs go on too, so the reflected crown is as ragged as the real one —
       through six pixels of blur, which is what the bar's finish comes to, a
       plain outline reads as a bar of soap. */
    /* Crown and blobs as one outline, filled once. In the glass they are welded
       by the goo — a blur and a hard cut — which is what makes the head read as
       one solid body; down here they were being laid on one at a time at a
       third of full weight, so every place two of them lapped came out heavier
       than the foam either side of it and the reflected head was mottled where
       the real one is solid. A single path has no overlaps to double. */
    rc.fillStyle = pal.foam;
    headPath(rc);
    for (const f of foam){
      const fy = surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy;
      rc.moveTo(f.x + f.r, fy);
      rc.arc(f.x, fy, f.r, 0, TAU);
    }
    rc.fill();
    rc.restore();
    /* The beer stands a base-thickness above the floor, so its mirror image
       starts that far below the foot. The thick base between them is lit
       through by the pour, so it carries the beer's own deep colour and the
       reflection runs unbroken out of the glass. */
    rc.beginPath();
    rc.moveTo(G.cx - halfAt(G.inBottom), G.inBottom);
    rc.lineTo(G.cx + halfAt(G.inBottom), G.inBottom);
    rc.lineTo(G.cx + halfAt(G.bottom), G.bottom);
    rc.lineTo(G.cx - halfAt(G.bottom), G.bottom);
    rc.closePath();
    rc.fillStyle = pal.beerDeep;
    rc.fill();
    rc.restore();

    /* And the whole reflection sinks into the bar as it runs away from the
       foot, which is what reads as distance across the surface. It has to sink
       slowly and go a long way. A thing held high in the glass has its image
       far out across the bar — that is what a mirror does — and the head is
       the highest thing there is in a pint. Sunk over a couple of hundred
       pixels and then done with, the fade swallowed it: stir the beer and the
       head tilts, the high side's image runs out past the end of the fade, and
       that side of the head went missing from the reflection altogether while
       the low side stayed. What was left read as a reflection with holes in
       it. So the run is better than half as long again, and weighted so the
       near half still sinks as fast as it used to — the far half is where the
       head lives, and it is thin out there rather than gone. */
    /* It is faded out of its own sheet rather than painted over with the
       room's colour. Painted over, the polished bar hid it, being that colour
       already, but the timber did not: the fade washed the wood out to the
       room's colour towards the front, paler in the light and darker in the
       dark, where the shader's counter keeps its grain the whole way down. */
    rc.save();
    rc.globalCompositeOperation = "destination-out";
    const rFade = rc.createLinearGradient(0, G.bottom, 0, G.bottom + Math.max(300, G.h * 1.05));
    rFade.addColorStop(0, "rgba(0,0,0,0)");
    rFade.addColorStop(0.26, "rgba(0,0,0,.52)");
    rFade.addColorStop(0.58, "rgba(0,0,0,.82)");
    rFade.addColorStop(1, "rgba(0,0,0,1)");
    rc.fillStyle = rFade;
    rc.fillRect(0, G.bottom, W, H - G.bottom);
    rc.restore();

    /* Laid down the bar in strips, each carried sideways a little further than
       the last. The frost scatters what it returns, and the further across the
       surface the eye travels the more of it there is between: near the foot
       the image is almost true, and it comes apart into slow waves as it runs
       away. Two rates rather than one, so the edges wander rather than ripple
       on a note. Clipped to the front arc of the footprint, which does not
       wander: that is where the glass stands, and it stands still. */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W, H);
    ctx.lineTo(W, G.bottom);
    ctx.lineTo(G.cx + G.botHalf, G.bottom);
    ctx.ellipse(G.cx, G.bottom, G.botHalf, bry, 0, 0, Math.PI);
    ctx.lineTo(0, G.bottom);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.clip();
    const band = 4;
    ctx.globalAlpha = clamp(reflectAmount(), 0, 1);
    for (let y = G.bottom; y < H; y += band){
      const t = y - G.bottom;
      const amp = Math.min(15 * G.scale, t * 0.10);
      const dx = (Math.sin(t * 0.055) * 0.7 + Math.sin(t * 0.021 + 1.9) * 0.55) * amp;
      ctx.drawImage(REFL.mirror, 0, Math.round(y * dpr) - mirrorBox.y, REFL.mirror.width,
                    Math.ceil(band * dpr), mirrorBox.x / dpr + dx, y, REFL.mirror.width / dpr, band);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

  }

  /* A plane, not a band: bright at the grazing horizon, falling toward the
     viewer, with frost streaks that spread apart as they approach */
  /* Each ramp changes colour where it is clear, with a stop of either colour
     there. A canvas gradient mixes the colours as well as the opacity, so run
     straight from clear white to black it passes through a clear grey, and the
     falling half of the bar came out paler instead of darker — a grey band
     across the counter from the glass's foot down that the shader never had. */
  const tone = ctx.createLinearGradient(0, hY, 0, H);
  if (pal.dark){
    tone.addColorStop(0, "rgba(255,255,255,.01)");
    tone.addColorStop(0.35, "rgba(255,255,255,0)");
    tone.addColorStop(0.35, "rgba(0,0,0,0)");
    tone.addColorStop(1, "rgba(0,0,0,.06)");
  } else {
    tone.addColorStop(0, "rgba(255,255,255,.06)");
    tone.addColorStop(0.4, "rgba(14,19,25,.02)");
    tone.addColorStop(1, "rgba(14,19,25,.03)");
  }
  ctx.fillStyle = tone;
  ctx.fillRect(0, hY, W, H - hY);
  ctx.fillStyle = pal.dark ? "rgba(255,255,255,.016)" : "rgba(14,19,25,.02)";
  for (let i = 0, ty = 3; hY + ty < H && i < 30; i++){
    ctx.fillRect(0, hY + ty, W, 1);
    ty *= 1.33;
  }
  ctx.restore();
  /* A hairline where the wall meets the bar */
  ctx.fillStyle = pal.dark ? "rgba(238,241,243,.05)" : "rgba(14,19,25,.06)";
  ctx.fillRect(0, hY, W, 1);
}


function drawLiquid(){
  ctxL.clearRect(0, 0, W, H);

  /* The house mark on the wall behind the bar */
  if (logoWall){
    const [lx, ly, lw, lh] = logoRect();
    ctxL.globalAlpha = pal.dark ? 0.085 : 0.07;
    ctxL.drawImage(logoWall, lx, ly, lw, lh);
    ctxL.globalAlpha = 1;
  }

  drawBarTop(ctxL);
  if (glassAway) return;          /* the room and the counter, and nothing on it */
  contactShadow(ctxL);

  if (level <= 0.001) return;

  const sy = restSurfaceY();
  /* Every glow the beer casts answers to the fill line */
  const lv = clamp((level - 0.02) / 0.6, 0, 1);
  const lvl = lv * lv * (3 - 2 * lv);

  /* Light spilling out of the glass onto the wall behind. Painted over the
     square its radius fits in, which leaves nothing out — the gradient is
     transparent past its radius, so there is no edge to cut — and spares the
     rest of the stage a fill that would have added nothing to it. */
  const gy = sy + G.inH * 0.3;
  const gr = G.topHalf * 4.2;
  const g = ctxL.createRadialGradient(G.cx, gy, 0, G.cx, gy, gr);
  g.addColorStop(0, pal.glow);
  g.addColorStop(1, "transparent");
  ctxL.globalAlpha = lvl * 0.85;
  ctxL.fillStyle = g;
  const gx0 = Math.max(0, Math.floor(G.cx - gr - 1)), gy0 = Math.max(0, Math.floor(gy - gr - 1));
  ctxL.fillRect(gx0, gy0, Math.min(W, Math.ceil(G.cx + gr + 1)) - gx0, Math.min(H, Math.ceil(gy + gr + 1)) - gy0);
  ctxL.globalAlpha = 1;

  /* Light transmitted through the base, pooling on the bar around the foot */
  const bryP = Math.max(2, baseBulge());
  ctxL.save();
  ctxL.translate(G.cx, G.bottom + bryP * 0.9);
  ctxL.scale(1, (bryP * 2) / (G.botHalf * 1.25));
  const pr = G.botHalf * 1.25;
  const pool = ctxL.createRadialGradient(0, 0, 0, 0, 0, pr);
  pool.addColorStop(0, pal.pool);
  pool.addColorStop(1, "transparent");
  ctxL.globalAlpha = lvl * 0.8;
  ctxL.fillStyle = pool;
  ctxL.fillRect(-pr, -pr, pr * 2, pr * 2);
  ctxL.globalAlpha = 1;
  ctxL.restore();

  /* What runs down the back of the glass goes on before the beer does, so the
     pour stands in front of it and shows as much of it as it is clear enough
     to show */
  if (drips.length) paintRibbons(ctxL, true);

  /* Everything from here to the end of the pour is the beer, and it is all
     drawn at the one opacity: the body, the light under the head, the surface
     and its meniscus, and the bubbles standing in it. Set once here and
     carried by the saves, so the few places that set an alpha of their own
     take their share of it rather than painting back to solid. */
  ctxL.save();
  ctxL.clip(PATHS.interior);
  ctxL.globalAlpha = beerAlpha();
  liquidPath(ctxL);
  const body = ctxL.createLinearGradient(0, sy - maxAmp, 0, G.inBottom);
  body.addColorStop(0,    pal.beerTop);
  body.addColorStop(0.34, pal.beerMid);
  body.addColorStop(0.86, pal.beerBot);
  body.addColorStop(1,    pal.beerDeep);
  ctxL.fillStyle = body;
  ctxL.fill();

  ctxL.save();
  ctxL.clip();

  /* The mark seen through the pour: sliced into columns, magnified by the
     cylinder of liquid, then sunk into the colour.

     It does not move with the beer. The mark is painted on the wall behind the
     bar, and the glass stands in front of it — swilling the pour used to carry
     it about, each column of it shifted by the slope of the wave over it and
     lifted by the wave's own height, which read as a mark floating in the beer
     rather than one standing behind it. What the liquid still does is squeeze
     it towards the middle, because that is the cylinder it is seen through and
     the cylinder does not move when the beer does. */
  if (logoBeer){
    const [lx, ly, lw, lh] = logoRect();
    const hw = innerHalfAt(sy);
    const slices = 60;
    const stepW = (hw * 2) / slices;
    ctxL.globalAlpha = 0.26 * beerAlpha() * (1 - beerSolid());
    for (let i = 0; i < slices; i++){
      const xd = G.cx - hw + (i + 0.5) * stepW;
      const nx = (xd - G.cx) / hw;
      const xs = G.cx + nx * hw * (0.72 - 0.20 * nx * nx);
      const u0 = (xs - stepW / 2 - lx) / lw * logoBeer.width;
      const uw = stepW / lw * logoBeer.width;
      const dy = 4;
      if (u0 + uw < 0 || u0 > logoBeer.width) continue;
      ctxL.drawImage(logoBeer, u0, 0, uw, logoBeer.height, xd - stepW / 2, ly + dy, stepW, lh);
    }
    ctxL.globalAlpha = 0.55 * beerAlpha();
    ctxL.fillStyle = body;
    ctxL.fillRect(G.cx - G.topHalf, G.top, G.topHalf * 2, G.h + 60);
    ctxL.globalAlpha = beerAlpha();
  }

  /* Beer is deeper through the glass at the edges, and those edges lean in
     with the wall — one leaning band per side, smooth end to end */
  const eTop = G.inTop, eBot = G.inBottom;
  const eW = innerHalfAt((eTop + eBot) / 2) * 0.36;
  for (const side of [-1, 1]){
    const xT = G.cx + side * innerHalfAt(eTop), xB = G.cx + side * innerHalfAt(eBot);
    const dx = xB - xT, dy = eBot - eTop;
    ctxL.save();
    ctxL.translate(xT, eTop);
    ctxL.rotate(Math.atan2(-dx, dy));
    const edge = ctxL.createLinearGradient(side * 4, 0, -side * eW, 0);
    edge.addColorStop(0, "rgba(104,52,2,.22)");
    edge.addColorStop(1, "rgba(104,52,2,0)");
    ctxL.fillStyle = edge;
    const x0 = Math.min(side * 4, -side * eW);
    ctxL.fillRect(x0, 0, Math.abs(side * 4 + side * eW), Math.hypot(dx, dy));
    ctxL.restore();
  }

  /* The top plane of the beer, caught by the light. Carried past both ends of
     the span, the way the body under it already is. The span is measured at the
     rest line, so a pour standing higher than that has glass out beyond it —
     nine pixels of it under a good swirl — and the plane stopped there while
     the body ran on to the wall, so the beer changed colour a moment before it
     reached the glass. The overhang is trimmed by the interior. */
  const [l, , w] = surfaceSpan();
  const sOver = Math.max(12, G.topHalf - w / 2 + 12);

  /* Everything from here to the meniscus is the surface and the light on it,
     and none of it may stand above the rim: the plane is the top of the beer
     seen from above, so where the glass has run out there is no top to see —
     a swirled pour would otherwise carry it up over the lip as a pale sliver.
     The body underneath is not cut here: it goes on up to meet the head. */
  ctxL.save();
  clipUnderRim(ctxL);

  ctxL.beginPath();
  ctxL.moveTo(l - sOver, backY(l));
  for (let i = 0; i < N; i++) ctxL.lineTo(colX(i), colBackY(i));
  ctxL.lineTo(l + w + sOver, backY(l + w));
  ctxL.lineTo(l + w + sOver, frontY(l + w));
  for (let i = N - 1; i >= 0; i--) ctxL.lineTo(colX(i), colFrontY(i));
  ctxL.lineTo(l - sOver, frontY(l));
  ctxL.closePath();
  ctxL.fillStyle = pal.surface;
  ctxL.globalAlpha = 0.55 * beerAlpha();
  ctxL.fill();
  ctxL.globalAlpha = beerAlpha();

  /* Light gathers just under the head, and the head shades the beer directly
     below it. Both belong to the surface, so each hangs from it as a band: the
     clip carries the wave, and the fade is measured down from the water column
     by column, so a crest and a trough are each shaded to the same depth below
     their own surface.

     One gradient ruled from the mean of the two ends could not do that. It
     reached zero along a fixed line while the band it filled ended a fixed
     depth under a moving surface, so wherever the wave rode above that mean the
     fill was still opaque when the clip cut it — and the band finished on a
     hard edge drawn along the crests, a ridge sitting in the top third of the
     glass that agitating the beer only made plainer. Every column now fades out
     exactly where its own share of the clip ends, so the bottom of the band has
     no edge left to show. */
  const surfaceBand = (depth, stops) => {
    ctxL.save();
    ctxL.beginPath();
    ctxL.moveTo(l, backY(l));
    for (let i = 1; i < N; i++) ctxL.lineTo(colX(i), colBackY(i));
    for (let i = N - 1; i >= 0; i--) ctxL.lineTo(colX(i), colBackY(i) + depth);
    ctxL.closePath();
    ctxL.clip();
    /* Built once at the origin and carried to each column by the transform —
       a gradient is read in the user space it is painted in, so translating is
       what re-hangs it, and the columns need no gradient of their own. */
    const g = ctxL.createLinearGradient(0, 0, 0, depth);
    for (const [at, c] of stops) g.addColorStop(at, c);
    ctxL.fillStyle = g;
    /* Column edges are snapped to whole device pixels so that neighbours abut
       exactly. Left on fractional boundaries they each cover part of the pixel
       between them and composite over one another there, which lays a faint
       comb of vertical lines down the band at the column pitch. */
    const snap = v => Math.round(v * dpr) / dpr;
    for (let i = 0; i < N; i++){
      const x = colX(i);
      const y = colBackY(i);
      /* Each column reaches halfway to the neighbours it actually has, which is
         no longer the same gap on both sides: the mesh follows the beer up and
         down the cone, so it is wider where the pour stands high. */
      const xPrev = i > 0 ? colX(i - 1) : x - (colX(1) - x);
      const xNext = i < N - 1 ? colX(i + 1) : x + (x - colX(N - 2));
      const x0 = snap((xPrev + x) * 0.5), x1 = snap((x + xNext) * 0.5);
      if (x1 <= x0) continue;
      /* Reaching up to whichever neighbour stands highest: the clip's surface
         line runs straight between columns while their tops step, so without it
         a rising wave leaves slivers of that line unpainted. The gradient holds
         its first stop above the origin, so the reach is filled at the band's
         own top weight, and the clip trims whatever of it is above water. */
      const up = y - Math.min(y, colBackY(Math.max(0, i - 1)), colBackY(Math.min(N - 1, i + 1)));
      ctxL.save();
      ctxL.translate(0, y);
      ctxL.fillRect(x0, -up, x1 - x0, depth + up);
      ctxL.restore();
    }
    ctxL.restore();
  };
  surfaceBand(G.inH * 0.34, [[0, "rgba(255,255,255,.26)"], [1, "rgba(255,255,255,0)"]]);
  surfaceBand(46 * G.scale, [[0, pal.foamEdge], [1, "rgba(0,0,0,0)"]]);

  /* Meniscus: the beer climbs the walls, and the thin film catches the light.
     It hangs from the beer line at its own wall, not from the rest line. Swirl
     the glass and the two walls stand as much as a third of the glass apart —
     so hung from the rest line the film left a bare stripe of wall between
     itself and the head on the side the beer had climbed to, and on the side it
     had drained from the film ran up above the beer and the clip cut it off
     partway down. It belongs to the beer, so it goes where the beer is. */
  const menW = Math.max(2.5, G.wall * 1.2);
  ctxL.lineWidth = menW;
  /* Beer piled against a wall stands as much as a rim's height above the near
     lip, and the film would follow it up there — a bright streak climbing the
     glass above the edge you can see, which is glass that is not in front of
     anything. The film is on the near wall, so it starts at the near lip at the
     latest, however high the beer behind it goes. */
  const rimRy = G.topHalf * G.ryTop;
  const nearLip = G.top + rimRy;

  /* Started flat at that height it still overshot. The lip is an ellipse, so
     its near arc is only level with the glass's side at the very edge and
     falls away from there — and the film does not stand at the very edge: it
     is a stroke of its own width, laid a little inside the wall, where the arc
     has already dropped the better part of its own depth. So the flat top cut
     across the lip rather than along it, and left the film's first few pixels
     standing above the rim on both sides — the nick of bright wall the head
     otherwise hides, which a swirl uncovers by carrying the head off one side.
     Cutting it on the arc itself lets each side of the stroke begin where the
     glass in front of it actually begins. */
  ctxL.save();
  const lipInRx = innerHalfAt(nearLip);
  ctxL.beginPath();
  ctxL.moveTo(W, H);
  ctxL.lineTo(W, G.top);
  ctxL.lineTo(G.cx + lipInRx, nearLip);
  ctxL.ellipse(G.cx, nearLip, lipInRx, rimRy * 0.94, 0, 0, Math.PI);
  ctxL.lineTo(0, G.top);
  ctxL.lineTo(0, H);
  ctxL.closePath();
  ctxL.clip();

  for (const s of [-1, 1]){
    const menTop = Math.max(surfaceAt(s < 0 ? l : l + w), nearLip);
    const menG = ctxL.createLinearGradient(0, menTop, 0, menTop + G.inH * 0.45);
    menG.addColorStop(0, "rgba(255,255,255,.40)");
    menG.addColorStop(1, "rgba(255,255,255,0)");
    ctxL.strokeStyle = menG;
    ctxL.beginPath();
    const steps = 10;
    for (let i = 0; i <= steps; i++){
      const y = menTop + (G.inH * 0.45) * i / steps;
      const x = G.cx + s * (innerHalfAt(y) - menW * 0.25);
      if (i) ctxL.lineTo(x, y); else ctxL.moveTo(x, y);
    }
    ctxL.stroke();
  }
  ctxL.restore();
  ctxL.restore();

  for (const b of bubbles){
    const r = b.r;
    ctxL.beginPath();
    ctxL.arc(b.x, b.y, r, 0, TAU);
    ctxL.fillStyle = `rgba(255,255,255,${0.08 + Math.min(0.14, r * 0.02)})`;
    ctxL.fill();
    if (r > 1.1){
      ctxL.lineWidth = Math.min(1.3, r * 0.42);
      ctxL.strokeStyle = `rgba(255,255,255,${0.22 + Math.min(0.3, r * 0.05)})`;
      ctxL.stroke();
    }
    if (r > 2.6){
      ctxL.beginPath();
      ctxL.arc(b.x - r * 0.32, b.y - r * 0.34, r * 0.22, 0, TAU);
      ctxL.fillStyle = "rgba(255,255,255,.5)";
      ctxL.fill();
    }
  }
  ctxL.restore();
  ctxL.restore();
}

function drawFoam(){
  ctxF.clearRect(foamBox.x, foamBox.y, foamBox.w, foamBox.h);
  if (level <= 0.001 || glassAway) return;
  const band = headBand();
  if (band < 0.5 && !foam.length) return;

  /* The head is held by the glass, but may dome a little over the rim */
  ctxF.save();
  /* carried past the wall by what the element's own clip already over-reaches
     by, so the two agree on where the head ends, and the blur between them has
     material to round off that nobody was going to see */
  headClip(ctxF, band * 0.55, 2 / FOAM_SCALE);
  ctxF.clip();

  ctxF.fillStyle = pal.foam;
  headPath(ctxF);
  ctxF.fill();

  /* the same span the crown was carried across, wanted again below */
  const [l, , w] = surfaceSpan();
  const over = Math.max(12, G.topHalf - w / 2 + 12);

  for (const f of foam){
    ctxF.beginPath();
    ctxF.arc(f.x, surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy, f.r, 0, TAU);
    ctxF.fill();
  }

  /* The head is soaked through where it stands in the beer, and takes its
     colour there. Painted onto the head itself, so it can only tint foam that
     is actually there.
     But it has to follow the beer line and not hang from a single height. The
     line the head stands in is an ellipse, and a level band across it tinted
     the middle of the head at full strength and the two ends of it not at all —
     so what it drew was a grey ellipse lying across the foam, which is the
     shape of the band and not the shape of anything in the glass. It shows
     whenever the weep is not there to cover it.
     Column by column, then, each hung from its own share of the beer line, the
     way the light under the surface already is. */
  /* And it is soaked as deep as it stands in the beer, which is the depth of
     the surface's own lens at that column and not a fixed band. Eighteen pixels
     everywhere, and on a glass with little in it the wetting stopped partway
     across the lens and drew its own edge there — a second line inside the
     head, following the far arc of the surface rather than the near one the
     head actually ends on. The head then read as though it finished at the back
     of the beer with the front of the beer showing beyond it, which is a head
     floating behind its own glass of beer. */
  ctxF.globalCompositeOperation = "source-atop";
  ctxF.globalAlpha = 0.42;
  /* snapped to whole device pixels of this canvas so neighbours abut exactly
     rather than compositing twice over the seam between them */
  const fpx = dpr * FOAM_SCALE;
  const snap = v => Math.round(v * fpx) / fpx;
  for (let i = 0; i < N; i++){
    const x = colX(i);
    const xPrev = i > 0 ? colX(i - 1) : x - (colX(1) - x);
    const xNext = i < N - 1 ? colX(i + 1) : x + (x - colX(N - 2));
    const x0 = i === 0 ? l - over : snap((xPrev + x) * 0.5);
    const x1 = i === N - 1 ? l + w + over : snap((x + xNext) * 0.5);
    if (x1 <= x0) continue;
    const soak = clamp(colDy(i) * 0.55, 7, 20) * G.scale;
    const wet = ctxF.createLinearGradient(0, 0, 0, -soak);
    wet.addColorStop(0, pal.foamWet);
    wet.addColorStop(1, "transparent");
    ctxF.save();
    ctxF.translate(0, colHeadFrontY(i) + 1);   /* the wet band sits on the same arc */
    ctxF.fillStyle = wet;
    ctxF.fillRect(x0, -soak, x1 - x0, soak);
    ctxF.restore();
  }
  ctxF.globalCompositeOperation = "source-over";
  ctxF.globalAlpha = 1;
  ctxF.restore();
}

/* The bands down the wall depend on the layout and the palette and on nothing
   else, so they are painted once into a strip the size of the glass and blitted
   from there. The strip is also what makes the lengthwise fade possible: the
   band's own gradient runs across its width, a second has to run down its
   length, and one fill cannot carry both — the second is masked in with
   destination-in, which needs a surface with nothing on it but the bands.

   Along its length a band has to run out rather than end. At one weight top to
   bottom it stopped dead on a horizontal line ruled just above the base and
   read as a strip laid over the glass rather than light caught on it; and
   having no shape of its own, it showed only where the beer behind it happened
   to be dark, so from the top the reflection looked as though it gave out
   partway down. The mask runs down the page rather than down each band, so all
   four fade together at the same height, as light in a room does. */
const REFL = {cv:null, x:0, y:0, w:0, h:0, ver:-1};

/* The sheet the bar's mirror is painted on before it is laid down in strips.
   Only as big as the reflection can be: the glass and what is in it, mirrored
   about the foot — as wide as the glass and from the top of the base's front
   arc, which mirrors to just above the foot, down to the bottom of the page —
   with room past that for the blur to spread into. It is blurred with every
   shape put on it, and a blur costs by the size of the sheet it runs on, so
   a sheet the size of the page was most of the cost of drawing a frame.
   Started on a whole device pixel so the strips read it on the same grid. */
REFL.mirror = null;
const MIRROR_PAD = 30;
const mirrorBox = {x: 0, y: 0};
function barMirror(){
  const reach = G.topHalf + G.wall + MIRROR_PAD;
  const bx = Math.max(0, Math.floor((G.cx - reach) * dpr));
  const by = Math.max(0, Math.floor((G.bottom - baseBulge() - MIRROR_PAD) * dpr));
  const w = Math.max(1, Math.min(Math.round(W * dpr), Math.ceil((G.cx + reach) * dpr)) - bx);
  const h = Math.max(1, Math.round(H * dpr) - by);
  if (!REFL.mirror){
    REFL.mirror = document.createElement("canvas");
    REFL.mirrorCtx = REFL.mirror.getContext("2d");
  }
  if (REFL.mirror.width !== w || REFL.mirror.height !== h){
    REFL.mirror.width = w; REFL.mirror.height = h;
  }
  mirrorBox.x = bx; mirrorBox.y = by;
  const c = REFL.mirrorCtx;
  c.setTransform(dpr, 0, 0, dpr, -bx, -by);
  c.filter = "none";
  c.globalAlpha = 1;
  c.clearRect(bx / dpr, by / dpr, w / dpr, h / dpr);
  return c;
}
function buildReflections(){
  const reflTop = G.top, reflBot = G.bottom - G.baseH * 0.4;
  const pad = 6;
  const x0 = Math.floor(G.cx - G.topHalf - pad), y0 = Math.floor(reflTop - pad);
  const w = Math.ceil(G.topHalf * 2 + pad * 2), h = Math.ceil(reflBot - reflTop + pad * 2);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const x = c.getContext("2d");
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.translate(-x0, -y0);                     /* draw in page coordinates */

  const hwTop = halfAt(reflTop), hwBot = halfAt(reflBot);
  const hwMid = halfAt((reflTop + reflBot) / 2);
  for (const [off, wRel, a] of [[-0.66, 0.10, 0.5], [-0.48, 0.05, 0.28], [0.58, 0.08, 0.35], [0.74, 0.04, 0.22]]){
    const xT = G.cx + off * hwTop, xB = G.cx + off * hwBot;
    const dx = xB - xT, dy = reflBot - reflTop;
    const gw = Math.max(0.8, wRel * hwMid);
    x.save();
    x.translate(xT, reflTop);
    x.rotate(Math.atan2(-dx, dy));           /* local +y now runs down the band */
    const grad = x.createLinearGradient(-gw, 0, gw, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, `rgba(255,255,255,${a * (pal.dark ? 0.5 : 1)})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = grad;
    x.fillRect(-gw, 0, gw * 2, Math.hypot(dx, dy));
    x.restore();
  }

  x.globalCompositeOperation = "destination-in";
  const fade = x.createLinearGradient(0, reflTop, 0, reflBot);
  fade.addColorStop(0,    "rgba(0,0,0,0)");
  fade.addColorStop(0.30, "rgba(0,0,0,1)");
  fade.addColorStop(0.62, "rgba(0,0,0,1)");
  fade.addColorStop(1,    "rgba(0,0,0,0)");
  x.fillStyle = fade;
  x.fillRect(x0, y0, w, h);

  Object.assign(REFL, {cv:c, x:x0, y:y0, w, h, ver:pal.dark});
}

/* The mouth of a glass is a hole you look through to its far side, and a head
   standing proud of the rim fills that hole. So everything the glass draws
   above the rim's own plane and inside the head's outline — the back of the
   lip, the top of the silhouette — is the far side of the glass seen through
   foam, which is not a thing foam lets you see. Left in, the rim ran on across
   the head as a bright arc laid over it and the head read as tissue paper.

   The plane is the right place to cut. The rim ellipse divides there: above it
   is the far half of the lip, behind the foam; below it the near half, in
   front of the foam and drawn over it as it should be. No stroke straddles the
   cut except at the two points where the arcs meet, so nothing is halved. And
   nothing below the plane is subtracted — the glass we see there is the near
   wall, which stands between the eye and the foam and tints it.

   The head's cap comes down to the plane exactly at the walls, so the region is
   closed by a chord along the plane. When the head sits lower than the rim the
   cap is never above the plane and there is nothing to cut. */
function headDome(){
  const plane = G.top + G.topHalf * G.ryTop;
  const hw = Math.max(1, innerHalfAt(G.inTop));
  const steps = 48;
  const p = new Path2D();
  let any = false;
  for (let i = 0; i <= steps; i++){
    const x = G.cx + (-1 + 2 * i / steps) * hw;
    const y = Math.min(plane, headTopAt(x));
    if (y < plane - 0.5) any = true;
    if (i) p.lineTo(x, y); else p.moveTo(x, y);
  }
  p.lineTo(G.cx + hw, plane);
  p.lineTo(G.cx - hw, plane);
  p.closePath();
  return any ? p : null;
}

/* Contact shadow: ellipses lying IN the plane, concentric with the footprint
   and sharing the plane's eccentricity, so the glass reads as standing in the
   surface rather than hovering over it.

   It goes on the bar, with the bar, and not with the glass. Drawn with the
   glass it went on the topmost sheet, over the pour instead of behind it: the
   half of it that lies behind the foot projects up the screen — a plane seen
   from above puts what is further away higher — so it reached a third of the
   way up the bore and washed the head in it. With a nearly empty glass, where
   the head sits right down in the bottom, that was a dark band ruled across
   the foam along the shadow's own contour. Beer and head are in front of the
   bar, so they cover it now, and the glass's base still goes over it from the
   sheet above. */
function contactShadow(ctx){
  const bryS = Math.max(2, baseBulge());
  ctx.save();
  ctx.translate(G.cx, G.bottom);
  ctx.scale(1, bryS / G.botHalf);          /* circles now land as plane ellipses */
  for (const [r0, r1, a] of [[G.botHalf, G.botHalf * 3.2, 0.75], [G.botHalf, G.botHalf * 1.4, 1]]){
    const sh = ctx.createRadialGradient(0, 0, r0, 0, 0, r1);
    sh.addColorStop(0, pal.shadow);
    sh.addColorStop(1, "transparent");
    ctx.globalAlpha = a;
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(0, 0, r1, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawGlass(ctx){
  const rimRy = G.topHalf * G.ryTop;

  /* Body of the glass, rim ellipse and walls as one silhouette. It fades with
     the lines: it is not one of them, but it is the same glass, and left at
     full weight while they went it stood there as a grey slab with no edges. */
  ctx.save();
  ctx.globalAlpha = glassLine();
  ctx.fillStyle = pal.glassTint;
  ctx.fill(PATHS.sil);
  ctx.restore();

  /* Everything from here on is line rather than body, and the head hides the
     lines that run behind it. The tint above is left alone: it is a whole-glass
     wash a twentieth of a step deep, and cutting it at the plane would rule a
     level line across the foam to save nothing anyone can see. */
  const dome = headDome();
  ctx.save();
  if (dome){
    const seen = new Path2D();
    seen.rect(0, 0, W, H);
    seen.addPath(dome);
    ctx.clip(seen, "evenodd");
  }

  /* Walls: a bright inner line and a soft outer edge that follows the rim.
     Everything from here to the end of the rim is the glass's own drawing —
     the lines and ellipses that say a glass is there — and the slider fades
     the lot of them together. Faded one at a time they would come apart into
     a wall without a rim, or a rim floating over nothing. */
  ctx.save();
  const lineA = glassLine();
  ctx.lineJoin = "round";
  ctx.strokeStyle = pal.glassEdge;
  ctx.globalAlpha = lineA;
  ctx.lineWidth = Math.max(1, G.wall * 0.28);
  ctx.stroke(PATHS.sil);

  ctx.strokeStyle = pal.glassLight;
  ctx.lineWidth = Math.max(1, G.wall * 0.34);
  ctx.globalAlpha = 0.5 * lineA;
  for (const s of [-1, 1]){
    ctx.beginPath();
    const steps = 22;
    for (let i = 0; i <= steps; i++){
      const y = lerp(G.top + rimRy, G.inBottom, i / steps);
      const x = G.cx + s * innerHalfAt(y);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  /* Reflections running down the glass, painted once into their own strip and
     blitted. Two gradients cross here — one across each band, one down the
     whole set — and a canvas fill only carries one, so the second is masked in
     afterwards, which needs a surface holding nothing but the bands. */
  /* Same again: the glass's highlights are glass, and the only palette they
     read is the theme. buildPaths sets ver to -1 when the wall moves, which
     matches neither true nor false and so still forces the rebuild. */
  if (!REFL.cv || REFL.ver !== pal.dark) buildReflections();
  ctx.save();
  ctx.clip(PATHS.sil);
  /* Clipped to below the near lip. The bands run down the wall we see through,
     and that wall starts at the rim's front arc — so each band is cut by the
     lip's own curve and emerges from it, rather than every band starting
     together on a flat line ruled across the glass. */
  const rimRxT = halfAt(G.top + rimRy);
  ctx.beginPath();
  ctx.moveTo(W, H);
  ctx.lineTo(W, G.top);
  ctx.lineTo(G.cx + rimRxT, G.top + rimRy);
  ctx.ellipse(G.cx, G.top + rimRy, rimRxT, rimRy, 0, 0, Math.PI);
  ctx.lineTo(0, G.top);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(REFL.cv, REFL.x, REFL.y, REFL.w, REFL.h);
  ctx.restore();

  /* Rim — the outer lip and the inner one a wall's thickness inside it. The
     lip is an annular surface, so both edges run right round; drawing only
     the outer one leaves the glass with no thickness where you look into it. */
  const rimRx = halfAt(G.top + rimRy);
  const rimCy = G.top + rimRy;
  const rimInRx = Math.max(2, rimRx - G.wall);
  const rimInRy = rimRy * 0.94;
  /* The near half of the lip is closest to the eye and takes the light square
     on, while the far half is read through the whole depth of the glass — so
     the lip brightens and thickens towards the viewer. On an ellipse that
     weighting depends on y alone, so a vertical gradient carries it smoothly
     the whole way round; drawing the two halves separately would step where
     they meet. The heavier stroke is faded out at the back, so the lip gains
     its thickness towards the eye without a seam either. */
  const lipFade = (rgb, back, front, from = rimCy - rimRy) => {
    const g = ctx.createLinearGradient(0, from, 0, rimCy + rimRy);
    g.addColorStop(0, `rgba(${rgb},${back})`);
    g.addColorStop(1, `rgba(${rgb},${front})`);
    return g;
  };
  ctx.save();
  ctx.globalAlpha = glassLine();
  ctx.beginPath();
  ctx.ellipse(G.cx, rimCy, rimRx, rimRy, 0, 0, TAU);
  ctx.lineWidth = Math.max(1, G.wall * 0.32);
  ctx.strokeStyle = lipFade(pal.edgeRGB, 0.12, 0.62);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.3, G.wall * 0.62);
  ctx.strokeStyle = lipFade(pal.edgeRGB, 0, 0.40, rimCy);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(G.cx, rimCy, rimInRx, rimInRy, 0, 0, TAU);
  ctx.lineWidth = Math.max(1, G.wall * 0.30);
  ctx.strokeStyle = lipFade(pal.edgeRGB, 0.10, 0.50);
  ctx.stroke();
  /* and the light catching along the near lip */
  ctx.lineWidth = Math.max(1, G.wall * 0.50);
  ctx.strokeStyle = lipFade(pal.lightRGB, 0, pal.dark ? 0.55 : 0.95, rimCy - rimRy * 0.3);
  ctx.stroke();
  ctx.restore();

  /* Thick base, down to the front arc the glass stands on */
  const bry = baseBulge();
  ctx.save();
  ctx.clip(PATHS.base);
  const baseGrad = ctx.createLinearGradient(0, G.bottom - G.baseH * 2.1, 0, G.bottom + bry);
  baseGrad.addColorStop(0, "rgba(255,255,255,0)");
  baseGrad.addColorStop(0.55, pal.dark ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.45)");
  baseGrad.addColorStop(1, pal.dark ? "rgba(255,255,255,.20)" : "rgba(255,255,255,.75)");
  ctx.fillStyle = baseGrad;
  ctx.fillRect(G.cx - G.topHalf, G.bottom - G.baseH * 2.1, G.topHalf * 2, G.baseH * 2.1 + bry);

  /* The thick base refracts the beer above it and glows amber. The glass it
     lights is what lies under the interior floor, and that floor is an
     ellipse — so the glow is bounded by the floor's own front arc and by the
     walls, never by a rectangle ruled across the base. */
  if (level > 0.02){
    const ihw = innerHalfAt(G.inBottom);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W, H);
    ctx.lineTo(W, G.inBottom);
    ctx.lineTo(G.cx + ihw, G.inBottom);
    ctx.ellipse(G.cx, G.inBottom, ihw, ihw * ryAt(G.inBottom), 0, 0, Math.PI);
    ctx.lineTo(0, G.inBottom);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.clip();
    /* The falloff is elliptical, measured out from the floor's own rim, so
       the glow reaches zero exactly along that curve — a vertical gradient
       would cut across it and leave a straight edge over the middle. */
    const iry = Math.max(2, ihw * ryAt(G.inBottom));
    ctx.translate(G.cx, G.inBottom);
    ctx.scale(1, iry / ihw);
    const bt = ctx.createRadialGradient(0, 0, ihw * 0.98, 0, 0, ihw * 2.1);
    bt.addColorStop(0, "transparent");
    bt.addColorStop(0.26, pal.baseGlass);   /* glass, not more beer below beer */
    bt.addColorStop(1, "transparent");
    const blv = clamp((level - 0.02) / 0.6, 0, 1);
    ctx.globalAlpha = blv * blv * (3 - 2 * blv) * 0.7;
    ctx.fillStyle = bt;
    ctx.beginPath();
    ctx.arc(0, 0, ihw * 2.1, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  ctx.restore();

  /* The floor the beer stands on. Drawn faintly it left the pour, the base
     and the reflection running together as one amber mass with nothing to
     divide them, so it is given weight — and its near arc takes the light
     while its far arc sits back, which is what tells a surface from a scratch.

     Each arc is stroked right round the ellipse and faded out towards the far
     end of the other, so the two hand over gradually through the sides. As two
     half ellipses they met at the widest points with a step in colour, where a
     receding edge butted against a lit one, and a second step in width, the
     near arc being the heavier of the two — the same seam the rim avoids by
     carrying its weighting round on a vertical gradient. Fading a whole stroke
     out rather than stopping it is also what hides the width change: the
     heavier one has no width left where it would have shown. */
  /* These are the glass's lines too — the floor it stands the beer on and the
     ring it stands on itself — so they fade with the rest of it. Left out, the
     slider took the walls and the rim away and left two ellipses lying in the
     bottom of nothing. */
  ctx.save();
  ctx.globalAlpha = glassLine();

  const floorFade = (c, back, front, cy, ry, to = cy + ry) => {
    const g = ctx.createLinearGradient(0, cy - ry, 0, to);
    g.addColorStop(0, `rgba(${c.rgb},${back})`);
    g.addColorStop(1, `rgba(${c.rgb},${front})`);
    return g;
  };

  const fihw = innerHalfAt(G.inBottom);
  const firy = Math.max(2, fihw * ryAt(G.inBottom));
  const bryF = Math.max(2, bry);

  /* The head hides what is behind it down here as well as up at the lip. These
     rings are stroked right round, but each is stroked twice — once in the far
     colour, faded out towards the front, and once in the near colour faded out
     towards the back — so the two arcs can be dealt with separately without
     cutting either ellipse in half and leaving a seam through the sides where
     they meet. The far passes go on behind the head; the near passes go on in
     front of it, which is where they are.

     Without this the floor's far arc and the standing ring's ran across the
     foam of a nearly empty glass: the back of the glass seen through a body
     the light does not get through. */
  /* The three far passes together, so they can be laid down twice: once for
     what stands clear of the beer and once for what stands behind it. */
  const farRings = () => {
    ctx.beginPath();
    ctx.ellipse(G.cx, G.inBottom, fihw, firy, 0, 0, TAU);
    ctx.lineWidth = Math.max(1, G.wall * 0.3);
    ctx.strokeStyle = floorFade(pal.floorFar, pal.floorFar.a, 0, G.inBottom, firy);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(G.cx, G.bottom, G.botHalf, bryF, 0, 0, TAU);
    ctx.lineWidth = Math.max(1, G.wall * 0.26);
    ctx.strokeStyle = floorFade(pal.floorFar, pal.floorFar.a, 0, G.bottom, bryF, G.bottom);
    ctx.stroke();

    /* Inner edge of the standing ring, whose two arcs are both ours to hand over */
    ctx.beginPath();
    ctx.ellipse(G.cx, G.bottom, G.botHalf * 0.86, bryF * 0.86, 0, 0, TAU);
    ctx.strokeStyle = floorFade(pal.floorFar, pal.floorFar.a, 0, G.bottom, bryF * 0.86);
    ctx.stroke();
  };

  ctx.save();
  if (level > 0.001 && foam.length){
    const seen = new Path2D();
    seen.rect(0, 0, W, H);
    const head = new Path2D();
    headPath(head);
    seen.addPath(head);
    ctx.clip(seen, "evenodd");
  }
  /* And the beer hides them too, once it is thick enough to. At the house
     setting it does not — you look through a pint and the back of the glass is
     there, which is most of what says a glass is a glass — but wound to the
     top of the opacity slider the pour stops light, and a body that stops
     light has no back of a glass showing through it. Drawn in two passes
     rather than clipped away, so it thins as the slider climbs instead of
     going all at once at the end of it. */
  const solid = level > 0.001 ? beerSolid() : 0;
  if (solid > 0.002){
    const liq = new Path2D();
    liquidPath(liq);
    const clear = new Path2D();
    clear.rect(0, 0, W, H);
    clear.addPath(liq);
    ctx.save();
    ctx.clip(clear, "evenodd");     /* standing clear of the beer */
    farRings();
    ctx.restore();
    ctx.save();
    ctx.clip(liq);                  /* and standing behind it */
    ctx.globalAlpha *= 1 - solid;
    farRings();
    ctx.restore();
  } else {
    farRings();
  }

  /* The foot is a ring the glass stands on, and a ring is a whole ellipse. Only
     its near arc is part of the silhouette — the far arc lies behind the glass
     rather than around it, so the outline never reaches it and the base ends on
     a bare chord, a half disc. Drawn here, through the thickness of the glass
     and so fainter than the near arc, it closes back into a foot. Its fade runs
     out at the widest points rather than past them, because the near half of
     this one is the silhouette's own stroke: the two meet there, and doubling
     over it would thicken the outline through the sides. */
  ctx.restore();          /* out from behind the head and the beer */

  /* and the near arcs, which stand in front of it */
  ctx.beginPath();
  ctx.ellipse(G.cx, G.inBottom, fihw, firy, 0, 0, TAU);
  ctx.lineWidth = Math.max(1.2, G.wall * 0.38);
  ctx.strokeStyle = floorFade(pal.floorNear, 0, pal.floorNear.a, G.inBottom, firy);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(G.cx, G.bottom, G.botHalf * 0.86, bryF * 0.86, 0, 0, TAU);
  ctx.lineWidth = Math.max(1, G.wall * 0.4);
  ctx.strokeStyle = floorFade(pal.floorNear, 0, pal.floorNear.a, G.bottom, bryF * 0.86);
  ctx.stroke();
  ctx.restore();
  ctx.restore();          /* the head's clip */
}

  /* Foam over the lip, running down the outside — so it goes on after the
     glass, the way the condensation does, and after the condensation too: a run
     of foam lies on the wall and takes the beads under it with it, so it can
     hardly have them showing through.
     Drawn as one outline apiece: the tail and the bead it hangs from are the
     same body of foam, and two overlapping fills at this alpha would seam
     where they crossed. */
/* Its own function, and called twice: what runs down the back of the glass
   is painted with the room, before the beer goes in over it, and what runs
   down the front is painted with the glass. A ribbon on the far side is
   behind the pour — you are looking through the whole depth of the beer to
   see it — so the beer decides how much of it shows, which is what the
   opacity of the pour is for. Painted on the near sheet with the rest, it
   lay over the beer instead: a bright trail in front of a pint it is
   supposed to be behind. */
function paintRibbons(ctx, wantFar){
  for (const d of drips){
    if ((Math.cos(d.th) < 0) !== wantFar) continue;
    const c = Math.cos(d.th), s = Math.sin(d.th);
    /* which way round the glass it is: in front of the pour, or behind it */
    const side = c < 0 ? -1 : 1;
    const a = clamp(d.life, 0, 1) * 0.94 * (0.6 + 0.4 * (0.5 + 0.5 * c));
    if (a <= 0.01) continue;
    /* edge-on where the glass turns away, as the beads are */
    const fs = Math.max(0.3, Math.abs(c));
    const steps = 18;
    const px = [], py = [], pw = [];
    for (let i = 0; i <= steps; i++){
      const t = i / steps;
      const h = lerp(d.top, d.h, t);
      const hw = halfAt(h);
      /* it wanders as it goes, the way a trail down a wet wall does, and is
         pinned where it leaves the collar so the wander does not shift its root */
      const sway = Math.sin(t * 4.1 + d.wob) * d.wobA * t;
      px.push(G.cx + hw * s + sway * fs);
      py.push(h + ryAt(h) * hw * c);
      pw.push(Math.max(0.35, ribbonHalf(d, t) * fs));
    }
    ctx.globalAlpha = a * weepAlpha();
    ctx.fillStyle = pal.foam;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++){
      if (i) ctx.lineTo(px[i] - pw[i], py[i]); else ctx.moveTo(px[i] - pw[i], py[i]);
    }
    /* Round off under the bead, then back up the other edge — unless it has
       arrived, in which case there is no bead left to round. A run of foam that
       has reached the bottom of the glass is standing on it, its whole width
       against the edge, and the edge is the base's own arc: a rounded end there
       is a drop still hanging in the air a moment before it lands. */
    if (d.pool > 0){
      const bry = baseBulge(), bhw = Math.max(1, G.botHalf);
      /* on the arc of the base its own side of the glass stands on */
      const arcY = x => {
        const u = clamp((x - G.cx) / bhw, -1, 1);
        return G.bottom + side * bry * Math.sqrt(1 - u * u);
      };
      const bSteps = 5;
      for (let i = 0; i <= bSteps; i++){
        const x = px[steps] - pw[steps] + 2 * pw[steps] * i / bSteps;
        ctx.lineTo(x, arcY(x));
      }
    } else {
      ctx.ellipse(px[steps], py[steps], pw[steps], Math.max(0.35, d.r), 0, Math.PI, 0, true);
    }
    for (let i = steps; i >= 0; i--) ctx.lineTo(px[i] + pw[i], py[i]);
    /* and across the top on the lip's own curve rather than straight. The
       ribbon is only its own width across, but the rim is an ellipse and near
       the two sides of the glass that is where it turns hardest — over ten
       pixels of ribbon the lip drops four, so a level cut there reads as a tab
       stuck on the glass rather than foam coming over the edge of it. */
    /* on the rim's own ellipse, to its own radii, so the two meet exactly
       rather than on a curve of nearly the same shape */
    const rRy = G.topHalf * G.ryTop, rCy = G.top + rRy, rRx = Math.max(1, halfAt(rCy));
    const aSteps = 6;
    for (let i = 0; i <= aSteps; i++){
      const x = px[0] + pw[0] - 2 * pw[0] * i / aSteps;
      const u = clamp((x - G.cx) / rRx, -1, 1);
      /* and cut on the lip its own side of the glass hangs from */
      ctx.lineTo(x, rCy + side * (rRy * Math.sqrt(1 - u * u) - 0.5 * G.scale));
    }
    ctx.closePath();
    ctx.fill();

    /* The light runs down the standing edge of it — but only once there is a
       standing edge to catch it. On a ribbon drawn down to a thread the
       highlight was the whole of it, and it read as a scratch on the glass. */
    if (pw[0] > 2.2){
      ctx.globalAlpha = a * 0.32 * weepAlpha();
      ctx.strokeStyle = "rgba(255,255,255,.55)";
      ctx.lineWidth = Math.max(0.6, pw[0] * 0.34);
      ctx.beginPath();
      for (let i = 0; i <= steps; i++){
        if (pw[i] < 1.1) break;
        const hx = px[i] - pw[i] * 0.42;
        if (i) ctx.lineTo(hx, py[i]); else ctx.moveTo(hx, py[i]);
      }
      ctx.stroke();
    }

    /* and what got all the way down runs off the glass and lies on the bar.
       Only the half of it that has cleared the foot: the glass stands on the
       other half, and foam does not gather under a glass that is already there.
       So the puddle is cut to everything the silhouette is not — a rectangle
       with the glass taken out of it — and it spreads from the foot outwards. */
    if (d.pool > 0){
      const outside = new Path2D();
      outside.rect(0, 0, W, H);
      outside.addPath(PATHS.sil);
      ctx.save();
      ctx.clip(outside, "evenodd");
      ctx.globalAlpha = a * 0.8 * weepAlpha();
      ctx.fillStyle = pal.foam;
      ctx.beginPath();
      /* centred where the bead meets the bar, which is its underside now that
         it stops on the edge rather than over it */
      ctx.ellipse(px[steps], py[steps] + d.r, d.pool,
                   Math.max(0.8, d.pool * baseBulge() / Math.max(1, G.botHalf)), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

function drawDetail(){
  ctxD.clearRect(0, 0, W, H);
  if (glassAway) return;

  /* Head texture, kept inside the glass */
  if (level > 0.001 && foam.length){
    ctxD.save();
    headClip(ctxD, headBand() * 0.55);
    ctxD.clip();

    ctxD.lineWidth = 1;
    ctxD.strokeStyle = pal.cell;
    for (const f of foam){
      if (f.r < 7 * G.scale || f.cell > 0.45) continue;
      const y = surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy;
      ctxD.beginPath();
      ctxD.arc(f.x, y, f.r * f.cellR, 1.1 + f.lift, 3.6 + f.lift);
      ctxD.stroke();
    }
    /* Boulders: bubbles grown large near the dry top of the head */
    for (const f of foam){
      if (f.cell < 0.78 || f.lift < 0.6 || f.r < 5 * G.scale) continue;
      const y = surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy;
      ctxD.beginPath();
      ctxD.arc(f.x, y - f.r * 0.2, f.r * 0.32, 0, TAU);
      ctxD.stroke();
    }
    ctxD.restore();
  }

  /* Lacing: dried foam stuck to the wall above the beer line */
  if (lace.length){
    ctxD.save();
    /* Started at the top of the rim rather than at its plane. A fleck on the
       far wall is drawn a bulge higher than the height it is stuck at, so the
       wall we can see runs up to the rim's far arc — and a path flat-topped at
       the plane cut every one of those in half along a level line ruled across
       the glass. The arc itself does the bounding, just below. */
    wallPath(ctxD, true, G.top, G.inBottom);
    ctxD.clip();
    /* and nothing above the lip, which is an ellipse. The rim is stroked after
       this, so the cut lands under its own line. */
    clipUnderRim(ctxD);
    ctxD.fillStyle = pal.foam;
    for (const l of lace){
      const [lx, ly, c] = lacePos(l);
      /* edge-on at the sides, and the far wall is read through the whole glass */
      ctxD.globalAlpha = clamp(l.life / l.max, 0, 1) * 0.55 * (0.6 + 0.4 * (0.5 + 0.5 * c));
      ctxD.beginPath();
      ctxD.ellipse(lx, ly, Math.max(l.r * 0.3, l.r * Math.abs(c)), l.r, 0, 0, TAU);
      ctxD.fill();
    }
    ctxD.globalAlpha = 1;
    ctxD.restore();
  }

  /* Beads in the air. Which side of the rim one left by settles whether it is
     in front of the glass or behind it, so they are painted in two passes with
     the glass between them — otherwise the whole spill flies over the front of
     a glass it may well have gone out the back of. */
  const paintDrops = pick => {
    for (const d of drops){
      if (!pick(d)) continue;
      const dr = d.r * dropScale(d);
      ctxD.beginPath();
      ctxD.ellipse(d.x, d.y, dr, dr * (1 + clamp(Math.abs(d.vy) / (900 * G.scale), 0, 0.6)), 0, 0, TAU);
      ctxD.fillStyle = d.foamy ? pal.foam : pal.beerMid;
      ctxD.fill();
      ctxD.beginPath();
      ctxD.arc(d.x - dr * 0.3, d.y - dr * 0.4, dr * 0.3, 0, TAU);
      ctxD.fillStyle = "rgba(255,255,255,.6)";
      ctxD.fill();
    }
  };
  const paintMist = pick => {
    for (const m of mist){
      if (!pick(m)) continue;
      ctxD.globalAlpha = clamp(m.life, 0, 1) * 0.5;
      ctxD.beginPath();
      ctxD.arc(m.x, m.y, m.r, 0, TAU);
      ctxD.fillStyle = pal.foam;
      ctxD.fill();
    }
    ctxD.globalAlpha = 1;
  };
  paintDrops(d => (d.near || 0) < 0);
  paintMist(m => (m.near || 0) < 0);

  drawGlass(ctxD);

  /* Condensation beads on the outside of the glass */
  if (dew.length){
    const ring = pal.dark ? "rgba(0,0,0,.55)" : "rgba(14,19,25,.30)";
    for (const d of dew){
      const [dx, dy, c] = dewPos(d);
      const rx = Math.max(0.5, d.r * Math.max(0.3, Math.abs(c)));
      const a = clamp(d.r / (1.4 * G.scale * dewScale()), 0, 1) * 0.9;
      ctxD.globalAlpha = a * 0.5;
      ctxD.beginPath();
      ctxD.ellipse(dx, dy, rx, d.r, 0, 0, TAU);
      ctxD.lineWidth = Math.max(0.6, d.r * 0.3);
      ctxD.strokeStyle = ring;
      ctxD.stroke();
      ctxD.globalAlpha = a * 0.85;
      ctxD.beginPath();
      ctxD.ellipse(dx - rx * 0.32, dy - d.r * 0.36, rx * 0.3, d.r * 0.3, 0, 0, TAU);
      ctxD.fillStyle = "rgba(255,255,255,.9)";
      ctxD.fill();
    }
    ctxD.globalAlpha = 1;
  }

  /* The collar's geometry, wanted at two different depths in the stack: the
     shade under its hem falls on whatever is behind, so it goes on before the
     ribbons, while the collar's own body goes on after them. Hit-testing the
     ribbons and lifting the pen across each one came to the same thing in the
     middle of a ribbon but not at its edges, where the test's margin opened a
     gap of neither shade nor foam. Painter's order has no edges to get wrong. */
  const colRy = G.topHalf * G.ryTop;
  const colCy = G.top + colRy;
  const colRx = halfAt(colCy);
  const colDeep = weepDeep();
  const colSteps = 48;
  /* The hem does not move until the foam is over the ring of the lip — see
     weepRun. Both its reach and its tongues are held back together, so it
     leaves the lip as one hem rather than the lobes arriving after the level
     part of it. */
  const runOut = weepRun();
  const hemAt = th => colCy + runOut * (weepHem + weepDrape * collarDrape(th));
  const showCollar = collar > 0.012 && creep > 0.004;
  const hemWalk = ctx => {
    ctx.beginPath();
    for (let i = 0; i <= colSteps; i++){
      const th = -Math.PI / 2 + Math.PI * i / colSteps;
      const h = hemAt(th);
      const hw = halfAt(h);
      const x = G.cx + hw * Math.sin(th), y = h + ryAt(h) * hw * Math.cos(th);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
  };

  /* Its own shade along the hem, so the collar hangs on the glass instead of
     being painted flat onto it. Laid down first, so the collar's body covers
     the inner half of it and what is left is a shadow cast on what is below —
     and so a ribbon passing the hem goes over the top of it, as it should,
     being nearer the eye than the thing casting it. */
  if (showCollar){
    ctxD.save();
    ctxD.globalAlpha = 0.28 * weepAlpha() * weepAlive;
    ctxD.strokeStyle = "rgba(90,72,44,.5)";
    ctxD.lineWidth = Math.max(1, G.wall * 0.35);
    hemWalk(ctxD);
    ctxD.stroke();
    ctxD.restore();
  }

  paintRibbons(ctxD, false);

  /* The collar: the head hanging over the outside of the lip, which is where
     the ribbons are drawn from. Its lower edge is lobed rather than level —
     foam hangs in tongues.
     It goes on last of the three, over the ribbons rather than under them. It
     is the nearest foam to the eye — it lies on the lip itself, while a ribbon
     has already run down the wall behind it — and a ribbon is drawn out of the
     collar, so the collar is what its root should disappear into. */
  if (showCollar){
    const cRy = colRy, cCy = colCy, cRx = colRx, steps = colSteps;
    /* The weep does not appear, it runs. Its whole reach — down past the beer
       line and on into the tongues — is scaled by how far it has got, so the
       hem starts on the lip and creeps down the glass from there. Held at its
       full reach and faded up instead, foam arrived everywhere at once and
       merely got more opaque, which is a dissolve and not a drip.
       Its far end is the beer line and then some. The head's underside is that
       line, and stopped at the lip the hem came out above it — so what you saw
       along the bottom of the foam was the head's own straight edge with the
       tongues lost behind it. Carried past the beer, every lobe falls below the
       edge it is part of, and at the two walls, where the drape runs out, the
       two meet exactly.
       And the reach is measured against what the head wanted to be, not what
       the glass let it keep: scaled by the band, the weep ran shallowest at the
       brim, which is the one place it should be deepest, since it is exactly
       the foam the band has just had to give up. */
    ctxD.globalAlpha = 0.94 * weepAlpha() * weepAlive;
    ctxD.fillStyle = pal.foam;
    /* Its upper edge is the far arc of the rim. Foam that has come over covers
       the whole of the lip it came over — in a photograph you cannot see the rim
       at all where the head is draped across it — so the collar's top is the
       back of that ring, not the front of it.
       Lifting the front arc towards the back by a share of the rim's own depth
       does cover the lip, but a lift that has to vanish at the two sides is a
       lift proportional to the same cosine the arc is made of, so it flattens
       the arc as it raises it: at nine tenths what came out was a rule drawn
       straight across an elliptical rim. The far arc is the whole ellipse
       again, and it meets the near one at the sides on its own. */
    /* And it comes over the lip rather than landing on it. The hem creeps down
       the outside from the first frame, but the ring of the lip was covered
       whole the moment the weep came on — better than twenty pixels of foam
       arriving in one frame at full weight while the hem below it was still up
       at the lip, which reads as a flash and not a creep.

       So the ring is covered the way foam actually covers it: outward from the
       mouth. What is allowed is a growing ellipse about the lip's own centre,
       from the edge of the mouth out to the rim — and, beyond the rim, the
       outside of the glass, where the hem does the running. Measured in shares
       of the rim's own ellipse so the near side and the far side fill at the
       same rate: raised from the lip's widest points instead, the far half
       climbed and the whole near half was there from the first frame, which is
       a weep starting in the middle of the glass. */
    const rise = weepOver();
    const mRx = Math.max(2, cRx - G.wall), mRy = cRy * 0.94;
    ctxD.save();
    if (rise < 0.999){
      ctxD.beginPath();
      ctxD.ellipse(G.cx, cCy, lerp(mRx, cRx, rise), lerp(mRy, cRy, rise), 0, 0, TAU);
      /* and everything past the rim on the near side, which is the hang. The
         near arc runs from angle nought to pi: y is down the screen here, so
         that is the half that bulges towards the eye, and the other way round
         traces the far arc and lets the whole back of the ring through. */
      ctxD.moveTo(G.cx + cRx, cCy);
      ctxD.ellipse(G.cx, cCy, cRx, cRy, 0, 0, Math.PI);
      ctxD.lineTo(0, H);
      ctxD.lineTo(W, H);
      ctxD.closePath();
      ctxD.clip();
    }
    ctxD.beginPath();
    for (let i = 0; i <= steps; i++){
      const th = -Math.PI / 2 + Math.PI * i / steps;
      const x = G.cx + cRx * Math.sin(th);
      const y = cCy - cRy * Math.cos(th);
      if (i) ctxD.lineTo(x, y); else ctxD.moveTo(x, y);
    }
    /* The hem is read at the height it has reached, so it comes in with the
       wall as the glass tapers instead of hanging straight off the rim */
    for (let i = steps; i >= 0; i--){
      const th = -Math.PI / 2 + Math.PI * i / steps;
      const h = hemAt(th);
      const hw = halfAt(h);
      ctxD.lineTo(G.cx + hw * Math.sin(th), h + ryAt(h) * hw * Math.cos(th));
    }
    ctxD.closePath();
    /* The mouth is not covered. Foam over the lip lies on the ring of glass the
       lip is, and hangs down the outside from it — it is not a lid. Filled from
       the far arc straight down, the collar was painted over the head and the
       beer it is supposed to be sitting on the edge of, so the inside of the rim
       is cut back out of it and the contents show through the ring. */
    ctxD.moveTo(G.cx + mRx, cCy);
    ctxD.ellipse(G.cx, cCy, mRx, mRy, 0, 0, TAU);
    ctxD.fill("evenodd");
    ctxD.restore();
    ctxD.globalAlpha = 1;
  }

  /* What came off the far lip went over the glass and was painted above. What
     came off the near lip goes on the splash sheet instead, which lies over
     the card standing beside the glass — see paintSplash. */
  paintSplash(ctxS, pal.foam, pal.beerMid);
  ctxD.globalAlpha = 1;
}

function renderAll(){
  if (!hArr) return;
  drawLiquid();
  drawFoam();
  drawDetail();
}

/* ================================================================== *
 * Loop
 * ================================================================== */
const FIXED = 1 / 60;
let acc = 0, last = performance.now(), clock = 0, emaFrame = 16.7, downgraded = 0;
/* The quality check has its own clock. Winding the scene's back to nought to
   restart the check jumps every phase that is drawn from it. */
let qClock = 0;

function frame(now){
  requestAnimationFrame(frame);
  let real = (now - last) / 1000;
  last = now;
  if (real > 0.25) real = 0.25;      /* a tab coming back does not owe the glass a minute */

  /* Pace is a clock rather than a force. Everything below is handed the same
     scaled second, so the waves, the pour, the bubbles rising and the beading
     on the outside all slow together and the glass goes on behaving like
     itself, only later — where slowing any one of them on its own would just
     put the pour out of step with itself. The frame timer further down keeps
     real seconds: it is watching the machine, not the beer. */
  const dt = real * (cfg.pace / 100);

  /* real seconds, not paced ones: the change of beer belongs to the card
     turning beside the glass, not to how fast the beer is running */
  if (tune){ tuneStep(real); if (!cfg.running) renderAll(); }

  if (!cfg.running){
    if (level < targetLevel() - 0.0005){
      updateLevel(Math.min(dt, 0.05));
      renderAll();
    }
    return;
  }

  clock += real;
  qClock += real;

  if (ptr.lx === -999){ ptr.lx = ptr.x; ptr.ly = ptr.y; }
  ptr.vx = ptr.x - ptr.lx;
  ptr.vy = ptr.y - ptr.ly;
  ptr.lx = ptr.x; ptr.ly = ptr.y;

  updateLevel(dt);

  acc += dt;
  let steps = 0;
  while (acc >= FIXED && steps < 4){ stepWaves(FIXED); acc -= FIXED; steps++; }
  if (acc > FIXED) acc = 0;

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
  renderAll();

  emaFrame += (real * 1000 - emaFrame) * 0.05;
  if (downgraded < 2 && emaFrame > 30 && qClock > 3){
    downgraded++;
    quality = downgraded === 1 ? 0.8 : 0.62;
    resize();
    emaFrame = 16.7;
    qClock = 0;
  }
}

document.querySelectorAll("[data-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    /* cleared first, so a recipe that names its own colour keeps it and one
       that does not goes back to the hue slider */
    cfg.beerHex = null;
    Object.assign(cfg, PRESETS[btn.dataset.preset]);
    cfg.preset = btn.dataset.preset;
    syncInputs();
    if (!cfg.running) renderAll();
  });
});

function applyTheme(){
  if (cfg.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = cfg.theme;
  buildPalette();
  if (!cfg.running) renderAll();
}
document.querySelectorAll("[data-counter]").forEach(btn => {
  btn.addEventListener("click", () => {
    cfg.counter = btn.dataset.counter;
    syncChips(); save();
    if (!cfg.running) renderAll();
  });
});

document.querySelectorAll("[data-theme-set]").forEach(btn => {
  btn.addEventListener("click", () => { cfg.theme = btn.dataset.themeSet; applyTheme(); syncChips(); save(); });
});
mqDark.addEventListener("change", () => { buildPalette(); if (!cfg.running) renderAll(); });

const gooBtn = document.getElementById("gooBtn");
const tiltRow = document.getElementById("tiltRow");
const tiltBtn = document.getElementById("tiltBtn");
/* Desktop browsers carry the interface without the hardware, so the control
   is offered only where the pointer says there is a device to tilt */
if (isCoarse && typeof DeviceOrientationEvent !== "undefined") tiltRow.hidden = false;
/* Where permission has to be asked it can only be asked from a tap, so a
   remembered setting reattaches quietly and waits for one if it must. */
if (cfg.tilt && !tiltAsks) tiltListen();
tiltBtn.addEventListener("click", async () => {
  if (cfg.tilt){ cfg.tilt = false; }
  else if (await tiltEnable()){ cfg.tilt = true; }
  else { tiltBtn.textContent = "Blocked"; save(); return; }
  syncChips(); save();
});

const motionBtn = document.getElementById("motionBtn");
gooBtn.addEventListener("click", () => { cfg.goo = !cfg.goo; applyGoo(); syncChips(); save(); });
motionBtn.addEventListener("click", () => {
  cfg.running = !cfg.running;
  if (cfg.running){ last = performance.now(); acc = 0; }
  syncChips(); save();
});
function applyGoo(){ document.body.dataset.goo = cfg.goo ? "on" : "off"; }

function syncChips(){
  document.querySelectorAll("[data-preset]").forEach(b =>
    b.setAttribute("aria-pressed", String(cfg.preset === b.dataset.preset)));
  document.querySelectorAll("[data-theme-set]").forEach(b =>
    b.setAttribute("aria-pressed", String(cfg.theme === b.dataset.themeSet)));
  document.querySelectorAll("[data-counter]").forEach(b =>
    b.setAttribute("aria-pressed", String(cfg.counter === b.dataset.counter)));
  gooBtn.setAttribute("aria-pressed", String(cfg.goo));
  gooBtn.textContent = cfg.goo ? "On" : "Off";
  motionBtn.setAttribute("aria-pressed", String(cfg.running));
  motionBtn.textContent = cfg.running ? "Running" : "Paused";
  tiltBtn.setAttribute("aria-pressed", String(cfg.tilt));
  tiltBtn.textContent = cfg.tilt ? "On" : "Off";
}

document.getElementById("reset").addEventListener("click", () => {
  Object.assign(cfg, HOUSE, {preset:"helles"});
  syncInputs();
  resize();
  if (!cfg.running) renderAll();
});

/* ================================================================== *
 * Boot
 * ================================================================== */
redraw = renderAll;
paletteHook = buildPalette;
chipsHook = syncChips;
resizeHook = resize;
buildSliders();
loadTuning();
applyTheme();
applyGoo();
setPanel(params.get("panel") === "1");
syncChips();

let resizeTimer = 0;
/* The stage can change size without the window doing anything — a web font
   arriving, the panel opening, a scrollbar coming and going. The canvases are
   sized from the stage, so when that happens and nothing re-measures it, the
   backing store keeps the old size and the browser stretches it to the new box.
   Everything drawn then lands off its own coordinates, and anything laid over
   the top in the element's own space — the clip that keeps the foam inside the
   glass is a CSS clip path, because it has to cut after the goo filter rather
   than before it — no longer lines up with what it is cutting. That showed as
   a flat line ruled across the head where the clip's bottom chord had fallen
   short of the glass's floor. Watching the box itself catches every case; the
   window's own resize event catches only one of them. */
const restage = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { resize(); fitWordmark(); if (!cfg.running) renderAll(); }, 120);
};
if (typeof ResizeObserver === "function") new ResizeObserver(restage).observe(stage);
window.addEventListener("resize", restage);
resize();
fitWordmark();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitWordmark);

settleStill();

renderAll();
requestAnimationFrame(frame);

startCard();
})();
