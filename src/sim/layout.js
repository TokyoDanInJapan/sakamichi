/* Where the glass stands and how it is seen: its proportions and layout
   against the page's type and the beer card, the camera (ryAt and the bar's
   depth behind the glass), places on the glass wall, and the house mark on
   the wall behind it. */
"use strict";

/* The house mark (logo-no-name.svg), carried here so neither page fetches it,
   with the constants of its artwork. Both renderers rasterise it themselves.
   See logoRect for where it hangs. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1889.5428 1632.4294"><g transform="matrix(1.3333333,0,0,-1.3333333,-19.650821,2202.5766)" fill="#fff"><path d="M 123.29788,752.91372 412.78651,1306.2766 734.86356,966.86574 1003.6133,1496.6917 1330.9311,752.91372 H 740.4762 Z M 1431.8953,688.54037 1007.931,1651.9325 717.91485,1080.1818 396.70559,1418.6768 14.738226,688.54037 H 740.4762 Z"/><path d="M 14.738116,556.9782 H 1431.8942 v 64.37335 H 14.738116 Z"/><path d="M 14.738116,427.61037 H 1431.8942 v 64.37335 H 14.738116 Z"/></g></svg>`;
const LOGO_ASPECT = 1889.5428 / 1632.4294;
/* The mark's bars run the full artwork width and the lowest sits on the bottom
   edge, so both renderers inset it by this in a padded bitmap, or its blur
   would be cut off square. */
const LOGO_PAD = 0.08;

/* ------------------------------------------------------------------ *
 * The glass. Proportions follow a shaker pint: tapered, thick base,
 * with a shallow ellipse at the rim because we look slightly down on it.
 * ------------------------------------------------------------------ */
const G = {
  cx:0, top:0, bottom:0, h:0, topHalf:0, botHalf:0,
  wall:0, baseH:0, inTop:0, inBottom:0, inH:0,
  ryTop:0.13, scale:1
};

/* The widest page on which the glass keeps the middle; above it the glass
   steps aside for the card. This must agree with the max-width:900px in each
   page's media queries, which includes 900 itself, or the card and the glass
   stand in the same place across the gap between the two numbers. */
const COMPACT_BELOW = 900;
/* What the page's type has already taken, read off the elements as laid out,
   since the room the taprooms need depends on how many lines they wrap to. No
   circle with the glass: the wordmark is pinned top left and the taprooms sit
   at the edge their media query gives, both placed before this runs. */
function boxOf(sel){
  const el = document.querySelector(sel);
  if (!el) return null;
  const st = getComputedStyle(el);
  if (st.display === "none" || st.visibility === "hidden") return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}
/* the band along the bottom the taprooms stand in, when they are down there
   rather than in a corner */
function barRoom(){
  const r = boxOf(".info");
  if (!r || r.top < H * 0.4) return 0;      /* up in a corner: not in the way */
  return Math.max(0, H - r.top + 14);
}
/* whether the card is on the page at this size */
function cardShown(){
  const el = document.querySelector(".beer");
  return !!el && getComputedStyle(el).display !== "none";
}
/* How wide the glass may be before it reaches the card. The card is placed by
   screen width and the type's band, settled before this runs. */
const GLASS_CARD_GAP = 16;
function capByCard(cx, fallback){
  const r = boxOf(".beer");
  if (!r || r.left <= cx) return fallback;      /* absent, or not to the right */
  return Math.min(fallback, r.left - GLASS_CARD_GAP - cx);
}
/* how far down the wordmark comes, where it stands over the glass */
function typeRoom(leftEdge){
  const r = boxOf(".masthead");
  if (!r || r.right <= leftEdge) return 0;  /* clear of it sideways */
  return r.bottom + 12;
}

function layoutGlass(){
  const compact = W <= COMPACT_BELOW;
  /* The card is told where the taprooms end, so it sits between them and the
     corner buttons. A stylesheet places it but cannot measure text. It is 0 when
     the taprooms are not in that corner, which is every width the card is hidden
     at. */
  {
    const s = document.documentElement.style;
    const ri = boxOf(".info"), rm = boxOf(".masthead");
    s.setProperty("--info-bottom", (ri && ri.top < H * 0.4 ? Math.round(ri.bottom) : 0) + "px");
    /* The band the card stands in, upright: under the wordmark, above the
       taprooms. Both ends are measured because both are text, and set before the
       glass is worked out, as the glass asks where the card ended up. */
    s.setProperty("--mast-bottom", Math.round(rm ? rm.bottom : H * 0.22) + "px");
    s.setProperty("--info-top", Math.round(ri && ri.top > H * 0.4 ? ri.top : H) + "px");
  }
  /* On its side and short (a phone in landscape) height is scarce, so the glass
     takes more of it, stands lower and moves off centre, leaving the taprooms a
     column on the right as on a desktop. */
  const lying = compact && H < 520 && W > H;
  /* Upright with a card, the glass stands to one side and the card beside it, as
     on a desktop. Stacking read as a caption. Standing aside costs width, so the
     glass is held narrower. */
  const beside = compact && H >= W && cardShown();
  const nominal = lying ? 0.62 : compact ? 0.46 : 0.58;    /* its height */
  G.cx = W * (lying ? 0.42 : beside ? 0.30 : compact ? 0.5 : 1 / 3);

  /* Where it stands, less whatever the taprooms use below it. */
  let bottom = Math.min(H * (lying ? 0.80 : compact ? 0.68 : 0.84), H - barRoom());
  bottom = Math.max(bottom, H * 0.40);
  const bottomAt = bottom / H;
  /* the camera that gives a house-sized glass its proper shape here */
  camLens = nominal / (BASE_OPEN - RIM_OPEN);
  camEye  = BASE_OPEN * camLens - bottomAt;

  /* The glass never grows into the card, and the screen margins give way before
     the gap between them, which is what reads as two objects. Fractions alone
     overlap on a tall screen, as the glass grows from the height and the card is
     placed by the width. So the cap comes from where the card actually starts. */
  const widthCap = Math.max(24, capByCard(G.cx, W * (beside ? 0.20 : compact ? 0.34 : 0.30)));
  const maxH = H * nominal * (cfg.glassSize / 100);
  let gh = clamp(maxH, 140, H * 0.80);
  let topHalf = Math.min(gh * 0.583 / 2, widthCap);

  /* The glass does not stand under the wordmark, if it is under it at all. The
     test uses the edge the glass would actually have, not the widest possible,
     which would shorten a landscape phone's glass for a wordmark well clear of
     it. Shortening only moves that edge inward, so the second answer is
     settled. */
  for (let pass = 0; pass < 2; pass++){
    const room = typeRoom(G.cx - topHalf);
    if (!room) break;
    const fits = Math.max(140, bottom - room);
    if (gh <= fits) break;
    gh = fits;
    topHalf = Math.min(gh * 0.583 / 2, widthCap);
  }
  if (topHalf >= widthCap){ topHalf = widthCap; gh = topHalf * 2 / 0.583; }

  G.h = gh;
  G.topHalf = topHalf;
  G.botHalf = topHalf * 0.68;
  G.bottom = bottom;
  G.top = bottom - gh;
  G.wall = Math.max(2.5, topHalf * 0.045);
  G.baseH = gh * 0.06;
  /* The rim ellipse, resolved at the height its own tangent sits at */
  G.ryTop = ryAt(G.top + G.topHalf * ryAt(G.top));
  /* The lip is a circle at the height the rim ellipse is centred on, not at the
     top of that ellipse, which is only the far side of the same circle. Measured
     from the top, a brim-full beer would stand about a rim above the brim. */
  G.inTop = G.top + G.topHalf * G.ryTop;
  G.inBottom = G.bottom - G.baseH;
  G.inH = G.inBottom - G.inTop;
  G.scale = (topHalf * 2) / 300;          /* everything else sizes off this */
}

/* Exterior half width at a given y: straight tapered walls, with the base
   ellipse supplying the bottom curve */
function halfAt(y){
  const t = clamp((y - G.top) / G.h, 0, 1);
  return Math.max(1, lerp(G.topHalf, G.botHalf, t));
}
const innerHalfAt = y => Math.max(1, halfAt(y) - G.wall);

/* The camera. One eye level serves the whole scene: a circle at eye level
   projects to a line and the further below it, the more open its ellipse. Rim,
   beer surface, floor and base follow this one rule, so resizing swings the rim
   as moving a real glass would.

   The glass is given the shape it ought to have (RIM_OPEN and BASE_OPEN, read
   off the reference photograph) and layoutGlass derives the eye and lens from
   wherever it stood the glass. Otherwise a phone, which stands the glass higher
   to leave room for copy, would photograph it from elsewhere and change its
   shape. */
const RIM_OPEN = 0.1397, BASE_OPEN = 0.3155;
let camEye = 0.201, camLens = 3.30;   // both in viewport heights, set by layoutGlass
/* A circle a depth d below the eye opens to ry/rx = d / f. Rim and base share
   this camera, so the eye level alone sets the ratio between them. An eye too
   high flattens the base towards the rim. */
/* the least and most open an ellipse is drawn. The shader's ryAt is handed
   these two. */
const RY_MIN = 0.03, RY_MAX = 0.55;
const ryAt = y => clamp((y / Math.max(H, 1) + camEye) / camLens, RY_MIN, RY_MAX);
const baseBulge = () => ryAt(G.bottom) * G.botHalf;
/* How much bar top shows behind the glass, a property of the room and so
   measured against the viewport. The shader's floorHorizon is handed this
   number. */
const BAR_DEPTH = 0.095;
const horizonY = () => G.bottom + baseBulge() - H * BAR_DEPTH;
/* The inner lip's ellipse against the rim's: the mouth sits a wall's thickness
   inside the rim and is drawn this much shallower. Both renderers use it to
   draw the mouth and cut what stands in it. */
const RIM_INNER = 0.94;

/* Foam dries onto the wall of a cylinder, so a speck is held by its angle
   round the wall and its height. This gives its screen place and the cosine of
   its angle: the near wall drops lower and faces us square, the far wall rides
   higher, and the sides foreshorten what is stuck to them. */
/* Both hand back the same array, refilled: they are read a few hundred times a
   frame and destructured on the spot, so it must never be held. */
const wallPos = [0, 0, 0];
function onWall(hw, h, th){
  const c = Math.cos(th);
  wallPos[0] = G.cx + hw * Math.sin(th);
  wallPos[1] = h + ryAt(h) * hw * c;
  wallPos[2] = c;
  return wallPos;
}
const dewPos = d => onWall(halfAt(d.h), d.h, d.th);
const lacePos = l => onWall(innerHalfAt(l.h), l.h, l.th);

/* The page's gutter, the same clamp(20px, 3.6vmin, 48px) the CSS uses. */
const pageMargin = () => clamp(Math.min(W, H) * 0.036, 20, 48);

function logoRect(){
  /* The mark stands on the wall behind the bar, one page margin clear of the
     plane's edge. The rect covers the padded bitmap, so the blur's bleed lands
     outside the artwork. */
  const gap = pageMargin();
  const hY = horizonY();
  const lh = Math.min(H * 0.8, (W * 0.92) / LOGO_ASPECT, hY - gap - 8);
  const lw = lh * LOGO_ASPECT;
  const p = lw * LOGO_PAD;
  /* Centred on the page, not the glass. The mark is on the wall, so the glass
     slides across it and the pour refracts what stands behind. It does not move
     with the pointer either, as a painted wall does not shift when someone puts a
     finger in a pint. */
  return [W / 2 - lw / 2 - p, hY - gap - lh - p, lw + 2 * p, lh + 2 * p];
}

/* Lay the glass out again and carry the weep with it, as its reach is a length
   down the glass. Returns whether the glass changed size or place. */
function relayout(){
  const wasTop = G.top, wasHalf = G.topHalf, wasBot = G.bottom;
  layoutGlass();
  const moved = Math.abs(G.top - wasTop) > 0.01
             || Math.abs(G.topHalf - wasHalf) > 0.01
             || Math.abs(G.bottom - wasBot) > 0.01;
  if (moved) carryWeep((G.bottom - G.top) / Math.max(1, wasBot - wasTop));
  return moved;
}
