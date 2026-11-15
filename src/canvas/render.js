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

/* The head is drawn at reduced resolution, as the goo filter blurs the detail
   away. Stretched back up, its edge is soft over nearly two of these pixels,
   which the clip must allow for. */
const FOAM_SCALE = 0.7;

/* The head canvas covers only the strip between the walls, from the top of
   the page to the glass floor, plus FOAM_MARGIN px each side for the goo
   blur. Held in shares of the stage, like the clip. Its origin snaps to a
   whole canvas pixel so the wet band's snapping stays on one grid. */
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
 * The house mark (LOGO_SVG, in sim/layout.js). Tinted copies are rebuilt
 * whenever the palette changes.
 * ================================================================== */

const logoImg = new Image();
let logoWall = null, logoBeer = null;
logoImg.onload = () => { buildLogoTints(); redraw(); };
logoImg.src = "data:image/svg+xml;utf8," + encodeURIComponent(LOGO_SVG);

/* Each blurred tint is made once and again only when its colour changes (the
   palette is rebuilt every frame in a pour). */
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
  /* Hue and the ends of the body gradient come from the sliders or the hex
       (see beerTone). Everything below derives from them, so a chosen colour
       carries the head, glow and light with it. */
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
    /* The far arc of a horizontal ring sits back and the near arc takes the
           light. On a dark ground nothing is darker than the ground, so glassEdge
           and glassLight swap roles; the floor therefore has its own pair, where
           the far arc is the fainter either way round. Split into rgb and alpha
           because each is stroked as a gradient. */
    floorFar:  dark ? {rgb:"238,241,243", a:0.12} : {rgb:"14,19,25", a:0.26},
    floorNear: dark ? {rgb:"255,255,255", a:0.42} : {rgb:"255,255,255", a:0.85},
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

const PATHS = {sil:null, base:null, interior:null};
function buildPaths(){
  PATHS.sil = glassSilhouette();
  PATHS.base = glassSilhouette(G.bottom - G.baseH * 2.1);
  PATHS.interior = interiorPath();
  clipFoamToGlass();
  REFL.ver = -1;                   /* the wall moved, so its highlights are stale */
}

/* The head is clipped to the glass by a CSS clip-path on the foam element,
   because it must cut after the goo filter or the blur carries foam back out
   through the wall. The filter widens the head by a few pixels, so the head
   is drawn past the wall (grow in headClip) and this clip lands on the wall
   itself, on solid foam. Do not cut past the wall (the head stands about four
   pixels proud of the bore). Cutting on a wall the head also stopped at
   leaves a hairline gap. */
function clipFoamToGlass(){
  const steps = 20;
  const ihTop = innerHalfAt(G.inTop);
  /* In shares of the box, not pixels: the box and its backing store can come
       apart (a late web font resizes the stage), and the browser stretches the
       drawing but not a clip in pixels. */
  const px = (x, y) => `${((x - foamBox.x) / foamBox.w * 100).toFixed(3)}% ${((y - foamBox.y) / foamBox.h * 100).toFixed(3)}%`;
  const pts = [px(G.cx - ihTop, 0)];
  for (let i = 0; i <= steps; i++){
    const y = lerp(G.inTop, G.inBottom, i / steps);
    pts.push(px(G.cx - innerHalfAt(y), y));
  }
  /* The floor closes on its own near arc, not a chord, which would rule a
       flat line across a nearly empty glass. This clip cuts after the filter,
       so its end is the head's end. headClip uses the same arc, and the two
       must agree or the shorter wins. */
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

/* The glass outline: the top half of the rim ellipse, the walls and the base's
   front arc. With fromY it starts below the rim on a flat chord (a clip
   for the base). */
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

/* Where the head may be: the walls at every height, and a crown above the lip
   (the full interior width there would give square shoulders). */
/* grow: how far past the inner wall to carry the cut, in canvas pixels. The
   foam sheet is blurred and re-thresholded after drawing, and a blur rounds
   corners inward. Cut dead on the wall, the corners (crown to lip, head to
   beer) stood about three pixels back, leaving a dark hairline. With grow,
   the rounding eats material that is trimmed anyway. */
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
  /* Across the floor on its own arc, not a chord: a head with little beer
       under it rests on the floor's disc, and a chord rules a straight line
       that elliptical walls cannot show. Walked by angle so the tight ends of
       the ellipse are not joined by a straight line. */
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
  /* Over the lip the head is crowned, not domed: a dome has no height at the
       walls and sliced the shoulder off a head shoved against one wall. The
       crown keeps nearly full height across and turns down at the edges. Its
       height follows the head (domeH is the allowance given to headCapY), not a
       fixed line at the rim, or a brim-full head comes out as a slab. The clip
       uses the same cap, so blobs may stand above the head but not above the
       rim at the walls. */
  const crown = Math.max(1, domeH);
  const cSteps = 20;
  for (let i = 0; i <= cSteps; i++){
    const t = 1 - 2 * i / cSteps;                    /* +1 at the right wall */
    ctx.lineTo(G.cx + t * ihwTop, headCapY(t, crown));
  }
  ctx.closePath();
}

/* The inside of the glass: the walls at every height, closed by the floor's
   front arc. The beer is bounded by this, not by its own outline. */
function interiorPath(){
  const ctx = new Path2D();
  const steps = 20;
  const ihw = innerHalfAt(G.inBottom);
  /* Bounded above by the far arc of the lip, the deepest the eye reaches.
       Brim full is at the lip, so a full glass reaches the arc and no further. */
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
  ctx.ellipse(G.cx, G.inTop, innerHalfAt(G.inTop), rimRy * RIM_INNER, 0, 0, Math.PI, true);
  ctx.closePath();
  return ctx;
}

/* The far arc of the lip is the deepest the eye reaches, so nothing inside
   may be painted above it. A flat top would stand proud at the walls. */
function clipUnderRim(ctx){
  const ry = G.topHalf * G.ryTop;
  const cy = G.top + ry;
  const rx = innerHalfAt(cy);
  ctx.beginPath();
  ctx.moveTo(G.cx - rx, H);
  ctx.lineTo(G.cx - rx, cy);
  ctx.ellipse(G.cx, cy, rx, ry * RIM_INNER, 0, Math.PI, 0);
  ctx.lineTo(G.cx + rx, H);
  ctx.closePath();
  ctx.clip();
}

function liquidPath(ctx){
  const [l, , w] = surfaceSpan();
  /* Each wall starts at the beer standing against it (backY), not at the
       resting level, or a tilted surface cuts a black wedge out of the beer
       under the low side. The bar's reflection uses this outline too. */
  const syR = backY(l + w), syL = backY(l);
  const over = Math.max(12, G.topHalf - w / 2 + 12);
  /* a Path2D takes the same moves and has no beginPath */
  if (ctx.beginPath) ctx.beginPath();
  ctx.moveTo(l - over, syL);
  for (let i = 0; i < N; i++) ctx.lineTo(colX(i), colBackY(i));
  ctx.lineTo(l + w + over, syR);
  const steps = 18;
  for (let i = 0; i <= steps; i++){
    const y = lerp(syR, G.inBottom, i / steps);
    ctx.lineTo(G.cx + innerHalfAt(y), y);
  }
  const ihw = innerHalfAt(G.inBottom);
  ctx.ellipse(G.cx, G.inBottom, ihw, ihw * ryAt(G.inBottom), 0, 0, Math.PI);
  for (let i = steps; i >= 0; i--){
    const y = lerp(syL, G.inBottom, i / steps);
    ctx.lineTo(G.cx - innerHalfAt(y), y);
  }
  ctx.closePath();
}

/* Crown: from the far edge of the head down to the front of the beer, carried
   as far past the ends as the beer so the head reaches the glass wherever
   the beer does. Separate because the bar reflects it too. */
function headPath(ctx){
  const [l, , w] = surfaceSpan();
  const over = Math.max(12, G.topHalf - w / 2 + 12);
  if (ctx.beginPath) ctx.beginPath();
  ctx.moveTo(l - over, headTopAt(l));
  for (let i = 1; i < N; i++) ctx.lineTo(colX(i), colHeadTop(i));
  ctx.lineTo(l + w + over, headTopAt(l + w));
  /* The underside rides the head's own raft, not the beer's skin, or the
       waterline jiggles with every bubble that breaks. Where the raft sits above
       the beer's arc, the surface disc (beer) shows between, so no gap opens. */
  ctx.lineTo(l + w + over, headFrontY(l + w) + 1);
  for (let i = N - 1; i >= 0; i--) ctx.lineTo(colX(i), colHeadFrontY(i) + 1);
  ctx.lineTo(l - over, headFrontY(l) + 1);
  ctx.closePath();
}

/* ================================================================== *
 * Rendering
 * ================================================================== */
/* Everything on the bar top, in page coordinates. It is drawn straight onto
   the canvas: a cached strip composites differently and the difference shows. */
/* How much of the counter one tile of timber covers, in camera heights */
const WOOD_TILES = 0.34;
let woodImg = null;
{
  const im = new Image();
  im.onload = () => { woodImg = im; redraw(); };
  im.src = BAR_WOOD;
}

/* The counter in timber, laid in the plane's own coordinates and cached.
   A ground plane has one row of screen per distance from the eye, so each
   row has one depth, from which both its grain spacing and the line of the
   tile it reads follow. It is laid row by row, not as a stretched image,
   whose grain would run parallel to the frame. The plane vanishes where ryAt
   reads zero, as the rim and base ellipses do. It depends only on stage size
   and light direction, so it is rebuilt only when those change. */
const WOOD = {cv:null, key:"", top:0};
function barWood(){
  if (!woodImg) return null;
  const top = Math.floor(horizonY());
  /* Keyed on what the timber depends on. Only the light direction reads the
       palette; keying on its version rebuilt every row every frame of a pour. */
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

  /* Lit as the bare plane is (paler receding, deeper near) so the glass stands
       on it. */
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

/* The mark mirrored in the bar, frosted. Blurred once and kept; it moves
   only with the layout and the wall's tint. The sheet covers only the part
   of the bar the mirror reaches and starts on a whole device pixel. */
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
  /* The wall meets the bar at the horizon, behind the glass, so the glass
       stands on the plane. The wall mirrors about the horizon, the pour about
       its own contact. */
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
  const wood = cfg.counter === "wood" ? barWood() : null;
  if (wood){
    ctx.drawImage(wood.cv, 0, wood.top, W, H - wood.top);
    /* Matches the shader's timber: the wall reflected near the horizon, sinking
           over a quarter of the glass height (45% dark, 30% light), and a milky
           frost veil (3 or 9 levels) over the first 60 pixels. */
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
    /* Painted into its own sheet so it can be laid down in strips and made to
           wander: the bar is frosted, and straight it was a flat trapezoid. */
    const rc = barMirror();
    rc.save();
    rc.translate(0, 2 * G.bottom);
    rc.scale(1, -1);
    rc.filter = "blur(6px)";
    /* The glass reflects too, or the image is only as wide as the pour. */
    rc.globalAlpha = pal.dark ? 0.22 : 0.16;
    rc.fillStyle = pal.glassLight;
    rc.fill(PATHS.sil);
    rc.globalAlpha = pal.dark ? 0.42 : 0.30;
    rc.lineWidth = Math.max(1.5, G.wall * 0.7);
    rc.strokeStyle = pal.glassLight;
    /* The silhouette is passed by name: bare, stroke takes the last path built,
           which is the clip this is drawn inside. */
    rc.stroke(PATHS.sil);
    rc.globalAlpha = 0.34;
    /* The beer's own reflection, clipped to the interior. The surface outline
           overhangs the walls on purpose, and unclipped here the overhang shows
           on the bar as a slab wider than the glass, leaning when the beer tilts. */
    rc.save();
    rc.clip(PATHS.interior);
    liquidPath(rc);
    rc.fillStyle = bodyR;
    rc.fill();
    /* Crown and blobs as one outline filled once: laid on separately, overlaps
           came out heavier and the reflected head was mottled. */
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
           starts that far below the foot. The base between is lit through by the
           pour, so it carries the deep colour and the reflection runs on unbroken. */
    rc.beginPath();
    rc.moveTo(G.cx - halfAt(G.inBottom), G.inBottom);
    rc.lineTo(G.cx + halfAt(G.inBottom), G.inBottom);
    rc.lineTo(G.cx + halfAt(G.bottom), G.bottom);
    rc.lineTo(G.cx - halfAt(G.bottom), G.bottom);
    rc.closePath();
    rc.fillStyle = pal.beerDeep;
    rc.fill();
    rc.restore();

    /* The reflection sinks into the bar with distance from the foot. It must go
           a long way and sink slowly: the head is the highest thing in a pint, so
           its image runs far out across the bar, and a short fade dropped the
           high side of a tilted head. Weighted so the near half sinks quickly and
           the far half is thin rather than gone. */
    /* Faded out of its own sheet (destination-out), not painted over with the
           room colour, which washed the timber out. */
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

    /* Laid down in strips, each carried sideways a little further than the
           last: the frost scatters more with distance, so the image is nearly true
           at the foot and comes apart into slow waves. Two rates, so the edges do
           not ripple on one note. Clipped to the footprint's front arc, which
           does not wander. */
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
       viewer, with frost streaks that spread as they approach. */
  /* Each ramp changes colour where it is clear, with a stop of either colour
       there. A canvas gradient mixes colour as well as opacity, so clear white
       to black passes through grey and paled the near bar. */
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

  /* Light spilling onto the wall, painted over the square its radius fits in
       (the gradient is transparent beyond). */
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

  /* What runs down the back of the glass goes on before the beer, so the pour
       stands in front of it. */
  if (drips.length) paintRibbons(ctxL, true);

  /* Everything to the end of the pour is the beer, drawn at one opacity. It is
       set here and carried by the saves, so places that set an alpha of their
       own take their share of it instead of painting back to solid. */
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
       cylinder of liquid, sunk into the colour. It does not move with the beer,
       since the mark is on the wall behind. The liquid only squeezes it towards
       the middle, as the cylinder does not move. */
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

  /* Beer is deeper through the glass at the edges, which lean in with the
       wall: one leaning band per side. */
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

  /* The top plane of the beer, caught by the light, carried past both ends of
       the span like the body. The span is measured at the rest line, so a
       higher pour has glass beyond it, and a plane that stopped there changed
       colour before reaching the glass. The interior trims the overhang. */
  const [l, , w] = surfaceSpan();
  const sOver = Math.max(12, G.topHalf - w / 2 + 12);

  /* Everything to the meniscus is the surface and its light, and none of it
       may stand above the rim: where the glass has run out there is no top to
       see. The body is not cut here; it goes up to meet the head. */
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

  /* Light gathers just under the head and the head shades the beer below it.
       Each hangs from the surface as a band, faded column by column from the
       water line, so a crest and a trough shade to the same depth. One gradient
       ruled from the mean would still be opaque where the wave rides above it
       and leave a hard ridge along the crests. */
  const surfaceBand = (depth, stops) => {
    ctxL.save();
    ctxL.beginPath();
    ctxL.moveTo(l, backY(l));
    for (let i = 1; i < N; i++) ctxL.lineTo(colX(i), colBackY(i));
    for (let i = N - 1; i >= 0; i--) ctxL.lineTo(colX(i), colBackY(i) + depth);
    ctxL.closePath();
    ctxL.clip();
    /* Built once at the origin and moved to each column by the transform (a
           gradient is read in the space it is painted in). */
    const g = ctxL.createLinearGradient(0, 0, 0, depth);
    for (const [at, c] of stops) g.addColorStop(at, c);
    ctxL.fillStyle = g;
    /* Column edges snap to whole device pixels so neighbours abut, or they
           composite twice and lay a comb of lines at the column pitch. */
    const snap = v => Math.round(v * dpr) / dpr;
    for (let i = 0; i < N; i++){
      const x = colX(i);
      const y = colBackY(i);
      /* Each column reaches halfway to its actual neighbours; the gap differs per
               side because the mesh follows the beer up and down the cone. */
      const xPrev = i > 0 ? colX(i - 1) : x - (colX(1) - x);
      const xNext = i < N - 1 ? colX(i + 1) : x + (x - colX(N - 2));
      const x0 = snap((xPrev + x) * 0.5), x1 = snap((x + xNext) * 0.5);
      if (x1 <= x0) continue;
      /* Reach up to the highest neighbour: the clip's surface line runs straight
               between columns while their tops step, and without this a rising wave
               leaves slivers unpainted. The clip trims whatever is above water. */
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

  /* Meniscus: the beer climbs the walls and the film catches the light. It
       hangs from the beer line at its own wall, not the rest line: swirled, the
       walls stand up to a third of the glass apart, and hung from the rest line
       the film left bare wall on one side and ran above the beer on the other. */
  const menW = Math.max(2.5, G.wall * 1.2);
  ctxL.lineWidth = menW;
  /* Beer piled against a wall can stand a rim's height above the near lip. The
       film is on the near wall, so it starts at the near lip at the latest. */
  const rimRy = G.topHalf * G.ryTop;
  const nearLip = G.top + rimRy;

  /* The cut is on the lip's own arc, not flat. The arc is level with the
       glass's side only at the edge, and the film is laid a little inside it
       where the arc has dropped, so a flat top left its first pixels above the
       rim. */
  ctxL.save();
  const lipInRx = innerHalfAt(nearLip);
  ctxL.beginPath();
  ctxL.moveTo(W, H);
  ctxL.lineTo(W, G.top);
  ctxL.lineTo(G.cx + lipInRx, nearLip);
  ctxL.ellipse(G.cx, nearLip, lipInRx, rimRy * RIM_INNER, 0, 0, Math.PI);
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

  ctxF.save();
  /* Drawn 2 CSS px past the wall (grow, in this canvas's pixels) while the
       element's clip cuts on the wall, so the blur rounds off foam that is
       trimmed anyway. */
  headClip(ctxF, band * 0.55, 2 / FOAM_SCALE);
  ctxF.clip();

  ctxF.fillStyle = pal.foam;
  headPath(ctxF);
  ctxF.fill();

  /* the same span the crown was carried across */
  const [l, , w] = surfaceSpan();
  const over = Math.max(12, G.topHalf - w / 2 + 12);

  for (const f of foam){
    ctxF.beginPath();
    ctxF.arc(f.x, surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy, f.r, 0, TAU);
    ctxF.fill();
  }

  /* The head is soaked where it stands in the beer and takes its colour there,
       painted onto the head so it only tints existing foam. It follows the beer
       line column by column: a level band across the elliptical line tinted the
       middle fully and the ends not at all. Its depth is the surface lens's own
       (colDy), or on a low glass it stops partway across and draws a second line. */
  ctxF.globalCompositeOperation = "source-atop";
  ctxF.globalAlpha = 0.42;
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

/* The bands down the wall depend only on layout and palette, so they are
   painted once into a strip and blitted. The lengthwise fade is a second
   gradient masked in with destination-in, which needs a surface holding
   nothing but the bands. The bands run out rather than end, or they stop
   on a ruled line above the base. The mask runs down the page, so all four
   fade at one height. */
const REFL = {cv:null, x:0, y:0, w:0, h:0, ver:-1};

/* The sheet the bar's mirror is painted on before it is laid down in strips.
   It covers only what the reflection reaches (the glass's width, from the
   base's front arc to the page bottom, plus MIRROR_PAD for the blur), since
   a blur costs by sheet size. Starts on a whole device pixel. */
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

/* The region above the rim's plane and inside the head's outline is the far
   side of the glass seen through foam, which foam does not let you see.
   Clipping it out stops the rim running across the head as a bright arc.
   The plane is the right cut because the rim ellipse divides there: above
   is the far half of the lip, behind the foam; below is the near half, drawn
   over it. Nothing below the plane is subtracted, since the near wall tints
   the foam. The head's cap meets the plane exactly at the walls, so the
   region closes on a chord. A head below the rim leaves nothing to cut. */
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

/* Contact shadow: ellipses lying in the plane, concentric with the footprint
   and sharing its eccentricity, so the glass stands in the surface. It is
   drawn with the bar, not the glass: on the top sheet its far half reached a
   third of the way up the bore and ruled a dark band across the head of a
   nearly empty glass. Beer and head cover it; the base still goes over it. */
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

  /* Body of the glass as one silhouette. It fades with the lines, or it would
       stand as a grey slab. */
  ctx.save();
  ctx.globalAlpha = glassLine();
  ctx.fillStyle = pal.glassTint;
  ctx.fill(PATHS.sil);
  ctx.restore();

  /* Everything from here on is line, and the head hides the lines behind it.
       The tint above is not cut: it is a faint whole-glass wash, and cutting it
       at the plane would rule a level line across the foam. */
  const dome = headDome();
  ctx.save();
  if (dome){
    const seen = new Path2D();
    seen.rect(0, 0, W, H);
    seen.addPath(dome);
    ctx.clip(seen, "evenodd");
  }

  /* Walls: a bright inner line and a soft outer edge following the rim. To the
       end of the rim these are one drawing and the slider fades them together. */
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

  /* Reflections running down the glass, blitted from a cached strip (REFL).
       The only palette input is the theme. buildPaths sets ver to -1 when the
       wall moves, which matches neither true nor false and forces a rebuild. */
  if (!REFL.cv || REFL.ver !== pal.dark) buildReflections();
  ctx.save();
  ctx.clip(PATHS.sil);
  /* Clipped to below the near lip, so each band emerges from the lip's curve
       instead of starting on a flat line. */
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

  /* Rim: the outer lip and the inner one a wall's thickness inside it, both
       run right round. */
  const rimRx = halfAt(G.top + rimRy);
  const rimCy = G.top + rimRy;
  const rimInRx = Math.max(2, rimRx - G.wall);
  const rimInRy = rimRy * RIM_INNER;
  /* The near half of the lip takes the light square on and the far half is
       read through the glass, so the lip brightens and thickens towards the
       viewer. That depends on y alone, so a vertical gradient carries it round
       without a step where two halves would meet. */
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
  /* the light catching along the near lip */
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

  /* The thick base refracts the beer above it and glows amber. The glow is
       bounded by the floor's front arc and the walls, not a rectangle. */
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
    /* The falloff is elliptical, measured out from the floor's rim, so the glow
           reaches zero along that curve. */
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

  /* The floor the beer stands on. It needs weight, or the pour, base and
       reflection run together as one amber mass. Each arc is stroked right
       round the ellipse and faded out towards the far end of the other, so they
       hand over through the sides. Two half ellipses would step in colour and
       width where they meet. */
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

  /* The head hides what is behind it down here as well as at the lip. Each
       ring is stroked twice, the far colour fading out towards the front and
       the near colour towards the back, so the arcs can be handled separately
       with no seam at the sides. Far passes go behind the head, near passes in
       front. */
  /* The three far passes, laid down twice: for what stands clear of the beer
       and for what stands behind it. Only the foot ring's near arc is in the
       silhouette, so its far arc is drawn here, fainter, to close the base
       into a foot. Its fade ends at the widest points, because the near half is
       the silhouette's own stroke and doubling it would thicken the outline. */
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

    /* inner edge of the standing ring */
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
  /* The beer hides them too once thick enough. At the house setting you look
       through a pint and see the back of the glass; at the top of the opacity
       slider nothing shows through. Two passes rather than a clip, so it thins
       gradually. */
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

  ctx.restore();          /* out from behind the head and the beer */

  /* the near arcs, which stand in front of it */
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

  /* Foam over the lip, running down the outside. It goes on after the glass
     and the condensation, whose beads a run of foam covers. One outline per
     ribbon, as two overlapping fills at this alpha would seam. */
/* Called twice: ribbons on the back of the glass are painted with the room,
   before the beer, and those on the front with the glass. A far ribbon is
   seen through the beer, which decides how much shows. On the near sheet it
   would lie over the beer. */
function paintRibbons(ctx, wantFar){
  for (const d of drips){
    if ((Math.cos(d.th) < 0) !== wantFar) continue;
    const c = Math.cos(d.th), s = Math.sin(d.th);
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
      /* it wanders as it goes, pinned where it leaves the collar so its root does
               not shift */
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
    /* Round off under the bead unless it has arrived: a run at the bottom of
           the glass stands on the base's arc, and a rounded end would read as a
           drop still in the air. */
    if (d.pool > 0){
      const bry = baseBulge(), bhw = Math.max(1, G.botHalf);
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
    /* and across the top on the rim's own ellipse, to its own radii, on the lip
           its own side hangs from. The rim turns hardest near the sides (four
           pixels over ten of ribbon), so a level cut reads as a stuck-on tab. */
    const rRy = G.topHalf * G.ryTop, rCy = G.top + rRy, rRx = Math.max(1, halfAt(rCy));
    const aSteps = 6;
    for (let i = 0; i <= aSteps; i++){
      const x = px[0] + pw[0] - 2 * pw[0] * i / aSteps;
      const u = clamp((x - G.cx) / rRx, -1, 1);
      ctx.lineTo(x, rCy + side * (rRy * Math.sqrt(1 - u * u) - 0.5 * G.scale));
    }
    ctx.closePath();
    ctx.fill();

    /* The light runs down the standing edge only once there is one, or on a
           thread it is the whole ribbon and reads as a scratch. */
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

    /* What got all the way down runs off the glass and lies on the bar. Only the
           half that has cleared the foot shows, so the puddle is clipped to
           everything the silhouette is not and spreads from the foot outwards. */
    if (d.pool > 0){
      const outside = new Path2D();
      outside.rect(0, 0, W, H);
      outside.addPath(PATHS.sil);
      ctx.save();
      ctx.clip(outside, "evenodd");
      ctx.globalAlpha = a * 0.8 * weepAlpha();
      ctx.fillStyle = pal.foam;
      ctx.beginPath();
      /* centred where the bead meets the bar */
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
    for (const f of foam){
      if (f.cell < 0.78 || f.lift < 0.6 || f.r < 5 * G.scale) continue;
      const y = surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy;
      ctxD.beginPath();
      ctxD.arc(f.x, y - f.r * 0.2, f.r * 0.32, 0, TAU);
      ctxD.stroke();
    }
    ctxD.restore();
  }

  if (lace.length){
    ctxD.save();
    /* Started at the top of the rim, not its plane: a fleck on the far wall is
           drawn a bulge higher than where it is stuck, so the visible wall runs up
           to the rim's far arc, and a flat top would halve each one. The arc does
           the bounding below. */
    wallPath(ctxD, true, G.top, G.inBottom);
    ctxD.clip();
    /* and nothing above the lip, which is an ellipse. The rim is stroked after
           this, so the cut lands under its own line. */
    clipUnderRim(ctxD);
    ctxD.fillStyle = pal.foam;
    for (const l of lace){
      const [lx, ly, c] = lacePos(l);
      ctxD.globalAlpha = clamp(l.life / l.max, 0, 1) * 0.55 * (0.6 + 0.4 * (0.5 + 0.5 * c));
      ctxD.beginPath();
      ctxD.ellipse(lx, ly, Math.max(l.r * 0.3, l.r * Math.abs(c)), l.r, 0, 0, TAU);
      ctxD.fill();
    }
    ctxD.globalAlpha = 1;
    ctxD.restore();
  }

  /* Beads in the air, painted in two passes with the glass between: which side
       of the rim one left by decides whether it is in front or behind. */
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

  /* The collar's geometry is needed at two depths: the shade under its hem
       goes on before the ribbons and the body after them. Painter's order has
       no edges to get wrong, where hit-testing left a gap at ribbon edges. */
  const colRy = G.topHalf * G.ryTop;
  const colCy = G.top + colRy;
  const colRx = halfAt(colCy);
  const colDeep = weepDeep();
  const colSteps = 48;
  /* The hem holds until the foam is over the lip's ring (see weepRun); reach
       and tongues are held back together so it leaves as one hem. */
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

  /* Its own shade along the hem. Laid first, so the body covers its inner half
       and a ribbon passing the hem goes over it. */
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

  /* The collar: the head hanging over the outside of the lip, which the ribbons
       are drawn from. Its lower edge is lobed, as foam hangs in tongues. It goes
       on last, over the ribbons, as the nearest foam; their roots disappear
       into it. */
  if (showCollar){
    const cRy = colRy, cCy = colCy, cRx = colRx, steps = colSteps;
    /* The weep runs rather than appears: its whole reach scales with how far it
           has got, so the hem starts on the lip and creeps down. Faded up at full
           reach it was a dissolve. The reach extends past the beer line (the
           head's underside) so every lobe falls below the edge it is part of. It
           is measured against what the head wanted to be, not what the glass let
           it keep, or the weep ran shallowest at the brim where it should be
           deepest. */
    ctxD.globalAlpha = 0.94 * weepAlpha() * weepAlive;
    ctxD.fillStyle = pal.foam;
    /* Its upper edge is the far arc of the rim: foam that has come over covers
           the whole lip. Lifting the near arc instead flattens it, since the lift
           must vanish at the sides and so shares the arc's own cosine. */
    /* It comes over the lip rather than landing on it: an ellipse about the
           lip's centre grows from the mouth's edge to the rim, plus everything
           past the rim on the near side, where the hem runs. Measured in shares of
           the rim's own ellipse so near and far fill at one rate; raised from the
           widest points, the near half was there from the first frame. */
    const rise = weepOver();
    const mRx = Math.max(2, cRx - G.wall), mRy = cRy * RIM_INNER;
    ctxD.save();
    if (rise < 0.999){
      ctxD.beginPath();
      ctxD.ellipse(G.cx, cCy, lerp(mRx, cRx, rise), lerp(mRy, cRy, rise), 0, 0, TAU);
      /* and everything past the rim on the near side. The near arc runs from
               angle nought to pi (y is down, so that half bulges towards the eye).
               The other way round traces the far arc and lets the back through. */
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
    /* The hem is read at the height it has reached, so it follows the taper. */
    for (let i = steps; i >= 0; i--){
      const th = -Math.PI / 2 + Math.PI * i / steps;
      const h = hemAt(th);
      const hw = halfAt(h);
      ctxD.lineTo(G.cx + hw * Math.sin(th), h + ryAt(h) * hw * Math.cos(th));
    }
    ctxD.closePath();
    /* The mouth is not covered: foam over the lip hangs down the outside and is
           not a lid, so the inside of the rim is cut back out. */
    ctxD.moveTo(G.cx + mRx, cCy);
    ctxD.ellipse(G.cx, cCy, mRx, mRy, 0, 0, TAU);
    ctxD.fill("evenodd");
    ctxD.restore();
    ctxD.globalAlpha = 1;
  }

  /* What came off the far lip is painted above. What came off the near lip goes
       on the splash sheet, which lies over the card (see paintSplash). */
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
 * The gooey head, a control of this renderer's own
 * ================================================================== */
const gooBtn = document.getElementById("gooBtn");
function applyGoo(){ document.body.dataset.goo = cfg.goo ? "on" : "off"; }
gooBtn.addEventListener("click", () => { cfg.goo = !cfg.goo; applyGoo(); chipsHook(); save(); });
applyGoo();

/* What loop.js runs: see the top of that file */
renderer = {
  render: renderAll,
  resize,
  buildPalette,
  chips(){
    gooBtn.setAttribute("aria-pressed", String(cfg.goo));
    gooBtn.textContent = cfg.goo ? "On" : "Off";
  }
};
})();
