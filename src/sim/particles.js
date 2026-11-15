/* What rides in and on the beer and the glass: bubbles, the blobs of the head,
   drops and mist thrown off it, condensation, puddles on the bar and lacing on
   the wall, with the dressing a still page starts with. */
"use strict";

/* Take out what a pass has marked spent, in one sweep, keeping the order. */
function sweep(list){
  let w = 0;
  for (let r = 0; r < list.length; r++){ const p = list[r]; if (!p.gone) list[w++] = p; }
  list.length = w;
}

/* How much of a breaking bubble reaches the head. Two dozen arrive a second,
   so together they keep a carbonated head trembling. Turned down it is a still
   head over a lively pour. */
const bubbleBreak = () => clamp(cfg.bubbleBreak / 100, 0, 2);

/* How much bigger a bead is drawn for coming towards you, or smaller going
   away. */
const dropScale = d => 1 + 0.45 * clamp(d.near || 0, -0.8, 2.6);

/* ================================================================== *
 * Contents: bubbles, head, spills
 * ================================================================== */
/* z is how far into the glass: -1 against the back wall, +1 against the front.
   The bore is a cylinder, so at depth z a bubble reaches only sqrt(1 - z^2) of
   the way to either side. A stream from a floor site keeps that site's
   depth. */
const reachAt = z => Math.sqrt(1 - z * z);
function addBubble(x, y, r, z){
  if (bubbles.length >= capBubbles) return;
  if (z == null) z = rand(-1, 1);
  const lim = (innerHalfAt(y) - 2) * reachAt(z);
  bubbles.push({
    x: clamp(x, G.cx - lim, G.cx + lim), y, z,
    r: r * (0.35 + cfg.bubbleSize / 100 * 0.85) * G.scale,
    vx: 0, rise: rand(0.85, 1.35), ph: Math.random() * TAU, wob: rand(3, 12) * G.scale
  });
}

function foamRadius(depth){
  /* mostly small bubbles with the odd larger cluster, as a real head is fine-grained */
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
  /* The wall that holds it is the one at the height it rides at. At the rest
     level, a swell would pen the head in and a trough let it out. */
  const p = surfaceAndDy(x);
  const lim = Math.max(4, innerHalfAt(p[0] - p[1] * 0.4 + oy) - r * 0.18);
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
      /* it leaves the floor at its site's depth, which the eye reads as the far side
         being further away */
      const back = (s.v || 0) * ryAt(G.inBottom) * innerHalfAt(G.inBottom);
      addBubble(G.cx + s.u + rand(-3, 3), G.inBottom + back - rand(1, 8),
                rand(0.7, 3.2) * s.scale, s.v);
    }
  }
  if (Math.random() < dt * 20 * fizz){
    const y = rand(restSurfaceY() + 20, G.inBottom);
    const z = rand(-1, 1);
    addBubble(G.cx + rand(-1, 1) * innerHalfAt(y) * 0.9 * reachAt(z), y, rand(0.5, 2.2), z);
  }

  /* No bubble meets the surface while lower than the front edge reaches anywhere,
     so most skip the lookup. yLo is the lowest column plus the deepest bulge
     there (the bore is widest at the highest column). */
  let yLo = -Infinity, yHi = Infinity;
  if (N && hArr){
    for (let i = 0; i < N; i++){ const y = colY(i); if (y > yLo) yLo = y; if (y < yHi) yHi = y; }
    yLo += ryAt(yLo) * innerHalfAt(yHi) + 0.01;
  }
  const bubbleDrag = decay(0.90, dt);
  for (let i = bubbles.length - 1; i >= 0; i--){
    const b = bubbles[i];
    b.ph += dt * 3.4;
    b.r += dt * 0.16 * G.scale;
    b.vx *= bubbleDrag;
    b.x += (b.vx + Math.sin(b.ph) * b.wob) * dt;
    b.y -= (48 + b.r * 26 / G.scale) * b.rise * G.scale * dt;

    /* Keep them inside the walls */
    const lim = Math.max(0, innerHalfAt(b.y) * reachAt(b.z) - b.r - 1);
    if (b.x < G.cx - lim){ b.x = G.cx - lim; b.vx *= -0.4; }
    if (b.x > G.cx + lim){ b.x = G.cx + lim; b.vx *= -0.4; }

    if (b.y - b.r * 0.6 > yLo && b.y >= G.inTop - 30) continue;
    const sy = frontY(b.x);
    if (b.y - b.r * 0.6 <= sy || b.y < G.inTop - 30){
      if (b.y - b.r <= sy){
        /* A bubble breaking is a ripple, not a heave, as two dozen reach the surface
           per second. */
        const brk = bubbleBreak();
        if (brk > 0.001){
          splash(b.x, -Math.min(0.13, b.r * 0.018) * brk, (14 + b.r * 3));
          addFoam(b.x, clamp(b.r * 2.1 + 3, 3, 24 * G.scale) * brk);
        }
        if (b.r > 3.4 * G.scale && Math.random() < 0.22){
          mist.push({x:b.x, y:sy, vx:rand(-24,24)*G.scale, vy:rand(-90,-25)*G.scale, r:rand(.6,1.4)*G.scale, life:rand(.3,.8)});
        }
      }
      b.gone = true;
    }
  }
  sweep(bubbles);
}

function updateFoam(dt){
  stepHeadSurface(dt);
  stepCrest(dt);
  const depth = cfg.headDepth / 100;
  const churn = cfg.foamChurn / 100;
  /* malt and alcohol thin the bubble walls, so a bock head dies faster than a pilsner's */
  const malt = 0.8 + (cfg.richness / 100) * 0.6;
  /* How fast a head gives itself up: a deep head holds on longer. Both rates are
     floored, because a rate that falls through zero reverses, and at deep
     settings every fleck would grow forever into one blob the width of the bore.
     The floors do not bite at ordinary depths. */
  const dying = Math.max(0.20, 0.55 + (1 - depth) * 0.9);
  const thinning = Math.max(0.10, 0.35 + (1 - depth) * 1.1);
  const band = headBand();
  const hw = innerHalfAt(restSurfaceY());
  const target = Math.round(clamp(hw / 3.2, 14, capFoam) * (0.25 + depth * 0.95));

  /* A head asked to be smaller lets go of surplus blobs, oldest first, over about
     a second, or they would outlive the next beer. */
  for (let i = 0, excess = foam.length - target; i < foam.length && excess > 0; i++, excess--){
    const f = foam[i];
    if (!f.leaving){ f.leaving = true; f.life = Math.min(f.life, rand(0.3, 1.2)); }
  }

  /* eight a frame at sixty, fewer on a faster frame, so the rate per second is
     the same */
  let spawn = Math.min(Math.max(1, Math.round(8 * frames(dt))), target - foam.length);
  while (spawn-- > 0){
    /* placed by its share of the width where the head rides, so the crest reaches
       the wall and the trough is not overfilled */
    const u = rand(-0.98, 0.98);
    const ride = innerHalfAt(sampleU(u));
    addFoam(G.cx + u * Math.max(4, ride), foamRadius(depth));
  }

  const foamDragY = decay(0.90, dt), foamDragX = decay(0.93, dt);
  for (let i = foam.length - 1; i >= 0; i--){
    const f = foam[i];
    f.life -= dt * dying * malt;
    f.seed += dt * (1.4 + churn * 2.6);

    const rest = -(f.r * 0.45 + f.lift * band);
    f.vy += (rest - f.oy) * 26 * dt;
    f.vy *= foamDragY;
    /* The jitter amplitude is kept small, as larger reads as a boil, not a
       settling. */
    f.oy += f.vy * dt + Math.sin(f.seed * 2.1) * churn * 3.5 * G.scale * dt;

    f.vx *= foamDragX;
    f.x += (f.vx + Math.sin(f.seed * 0.8 + f.r) * churn * 1.25) * dt;

    /* The wall is the one at the height this blob rides at, which a swell and a
       trough both move */
    const p = surfaceAndDy(f.x);
    const lim = Math.max(4, innerHalfAt(p[0] - p[1] * 0.4 + f.oy) - f.r * 0.18);
    if (f.x < G.cx - lim){ f.x = G.cx - lim; f.vx *= -0.5; }
    if (f.x > G.cx + lim){ f.x = G.cx + lim; f.vx *= -0.5; }

    f.r -= dt * thinning * (churn * 0.5 + 0.7) * malt * G.scale;
    if (f.r < 2.2 * G.scale || f.life < 0) f.gone = true;
  }
  sweep(foam);
}

function updateDrops(dt){
  for (let i = drops.length - 1; i >= 0; i--){
    const d = drops[i];
    d.vy += 1150 * G.scale * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    /* It travels in depth too, or a bead thrown at the eye would not grow and drop
       down the frame as it closes. */
    if (d.dz){
      d.near += d.dz * dt;
      d.y += d.dz * ryAt(d.y) * Math.max(1, innerHalfAt(d.y)) * dt * 1.5;
      if (d.near > 3.2){ d.gone = true; continue; }   /* past the eye */
    }

    const outsideGlass = Math.abs(d.x - G.cx) > innerHalfAt(d.y);
    if (!d.out && !outsideGlass && d.vy > 0 && d.y > frontY(d.x)){
      splash(d.x, 0.5 + d.r * 0.16 / G.scale, 18 + d.r * 4);
      if (d.foamy) addFoam(d.x, d.r * 2);
      d.gone = true;
      continue;
    }
    /* The bar is a plane, so a drop lands lower down the picture the nearer it
       comes down. One base bulge is the near lip's own distance out, so a bead
       leaving there lands at the foot. */
    const bar = G.bottom - 2 + baseBulge() * clamp(d.near == null ? 1 : d.near, -1, 3.4);
    if (d.y > bar){
      mist.push({x:d.x, y:bar, vx:rand(-30,30)*G.scale, vy:-rand(20,70)*G.scale,
                 r:d.r * dropScale(d) * 0.5, near:d.near, life:rand(.2,.5)});
      /* and it leaves a mark where it landed, depth included */
      if ((d.near || 0) >= 0)
        addPuddle(d.x, bar, d.r * dropScale(d), d.foamy ? "foam" : "beer");
      d.gone = true;
    } else if (d.x < -40 || d.x > W + 40){
      d.gone = true;
    }
  }
  sweep(drops);
  for (let i = mist.length - 1; i >= 0; i--){
    const m = mist[i];
    m.life -= dt;
    m.vy += 240 * G.scale * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.life <= 0) m.gone = true;
  }
  sweep(mist);
  updateWeep(dt);
}

/* How big a bead is, over the glass's own scale. Everything a bead is measured
   in goes through here, so the slider changes the beading's size and not how
   quickly it is shed. */
const dewScale = () => clamp(cfg.dewSize / 100, 0.2, 2.2);

/* Condensation beads on the cold outside of the glass, below the beer line */
function addDew(r){
  const k = G.scale * dewScale();
  /* Even in angle round the visible face, which crowds beads towards the sides.
     Even across the width would read as beads on a pane behind the glass. */
  dew.push({
    th: rand(-1, 1) * Math.PI * 0.5,
    h: rand(restSurfaceY() + 8, G.bottom - G.baseH * 1.5),
    r: r * k, rt: r * k, grow: rand(0.03, 0.12) * k,
    slip: rand(3.4, 4.6) * k, vy: 0
  });
}

/* A bead carries the size it formed at. Dew sits until it grows heavy, so beads
   already on the glass are rescaled when the slider moves, or it would look
   dead. */
let dewK = 1;
const PUDDLE_MAX = 64;      /* a hard swirl throws a good many at once */
/* addPuddle takes a point on the foot's rim, not G.bottom. The foot is a disc
   seen at an angle, so beads reach the bar all round the base. Marks on the
   G.bottom line fall inside the foot's ellipse and are clipped away. */
function addPuddle(x, y, r, kind){
  if (puddles.length >= PUDDLE_MAX) puddles.shift();
  /* Beer stays longer than water and foam longer again: water dries, the others
     need wiping. */
  const life = kind === "water" ? rand(9, 15) : kind === "beer" ? rand(14, 22) : rand(18, 26);
  /* No two marks alike: two waves round the edge, as with the collar, or
     identical circles read as stickers. */
  puddles.push({x, y, kind, r: r * 0.6, rt: r * rand(2.6, 4.0), life, max: life,
                p1: Math.random() * TAU, p2: Math.random() * TAU,
                a1: rand(0.10, 0.22), a2: rand(0.05, 0.13)});
}
/* It spreads quickly then holds, as water on a bar does. */
function updatePuddles(dt){
  for (let i = puddles.length - 1; i >= 0; i--){
    const p = puddles[i];
    p.r += (p.rt - p.r) * Math.min(1, dt * 2.2);
    p.life -= dt;
    if (p.life <= 0) puddles.splice(i, 1);
  }
}

function updateDew(dt){
  /* before the early return: what ran off a glass whose condensation was just
     turned off still lies on the bar */
  updatePuddles(dt);
  const amount = clamp(cfg.condensation / 100, 0, 2);
  if (!amount){ dew.length = 0; return; }
  const k = dewScale();
  if (k !== dewK){
    const f = k / dewK;
    for (const d of dew){ d.r *= f; d.rt *= f; d.grow *= f; d.slip *= f; }
    dewK = k;
  }
  /* The dew count follows the level, as beads take only the wall below the pour
     and a nearly empty glass would crowd its allowance onto little wall. */
  const wet = clamp(level / 0.8, 0, 1);
  const want = Math.min(Math.round(capDew * amount * wet), 180);
  if (poured && dew.length < want && Math.random() < dt * 30 * amount) addDew(rand(0.7, 1.6));

  for (let i = dew.length - 1; i >= 0; i--){
    const d = dew[i];
    d.rt += d.grow * dt;
    d.r += (d.rt - d.r) * Math.min(1, dt * 9);     /* eases towards its target */
    if (d.r > d.slip || d.vy > 0){
      /* Grown too heavy, the bead runs. Big is relative to its own beading, so a
         coarsely beaded glass does not sheet off. */
      const px = G.scale * k;
      const top = (55 + 45 * Math.min(2, d.r / (2.5 * px))) * G.scale;
      d.vy = Math.min(d.vy + 70 * G.scale * dt, top);
      d.h += d.vy * dt;
      d.rt = Math.max(d.rt - dt * 0.8 * G.scale, 1.4 * px);
      if (d.h > G.bottom - G.baseH * 0.8){
        /* Off the bottom and onto the bar. Only the near side leaves a mark, as the
           far side is hidden behind the glass. */
        /* Placed on the foot's rim at the angle it ran down. It is released a little
           above the bar, where the base moulding starts, so its own position would put
           the mark above the front of the foot. */
        const c = Math.cos(d.th);
        if (c > -0.25){
          addPuddle(G.cx + G.botHalf * Math.sin(d.th),
                    G.bottom + baseBulge() * c, d.r, "water");
        }
        dew.splice(i, 1);
      }
    }
  }

  /* A running bead sweeps up what it touches. Volumes add, so the radius grows as
     the cube root and the heavier bead runs faster. */
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
      /* the volume arrives at once but the bead swells into it and drifts to the
         joint centre */
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

/* Lacing is left behind, not thrown. The head is against the wall the whole
   time and where the wall dries from under it what touched it stays. Specks are
   laid at the head's own contact with the wall, right round it, and seen once
   the beer has gone down. So a glass drunk halfway wears a ring for every
   level it stood at, and a slosh marks the wall as high as it threw the head.
   They are never laid at a height between rim and beer, or they would sit in
   one band and a half-full glass sloshed hard would go unmarked.

   A falling line writes, as does a slosh. A glass standing still writes too,
   but only under its own head, where none of it shows until the beer goes
   down. */
const LACE_MAX = 320;
let laceAcc = 0, laceLast = null;
function layLacing(dt){
  if (level <= 0.03 || !foam.length || !N || !hArr){ laceLast = null; return; }
  const rest = restSurfaceY();
  const drain = laceLast == null ? 0
              : clamp((rest - laceLast) / Math.max(dt, 1e-4), 0, 400);
  laceLast = rest;
  const swing = (Math.abs(hArr[0]) + Math.abs(hArr[N - 1])) * 0.5;
  /* A glass standing still writes slowly. It must write something, the ring
     waiting under the head, but a high rate would use up the allowance hidden
     and leave a slosh nowhere to put its marks. */
  laceAcc = Math.min(10, laceAcc + dt * (1.8 + drain * 0.6 + swing * 4));

  const band = Math.max(2, headBand());
  /* The lip, as an ellipse. Nothing sticks to the inside of a glass above it. */
  const rimRy = G.topHalf * G.ryTop;
  const rimCy = G.top + rimRy;
  const rimInRx = Math.max(2, innerHalfAt(rimCy));
  const rimInRy = rimRy * RIM_INNER;

  while (laceAcc >= 1 && lace.length < LACE_MAX){
    laceAcc -= 1;
    /* every x meets the wall at two places and foam clings to both, so the angle
       round the glass is free */
    const th = rand(-Math.PI, Math.PI);
    const x = G.cx + innerHalfAt(rest) * Math.sin(th);
    /* Weighted to the top of the head, its high-water line. Spread evenly, a slosh
       would lay most marks back inside the head and leave the wall above bare. */
    const r = Math.max(1, rand(1.2, 2.8) * G.scale);
    let h = surfaceAt(x) - band * Math.pow(Math.random(), 0.4);

    /* Brought back under the lip. A head proud of the rim is against no wall up
       there, and far-wall marks sit a rim's depth up the screen, so specks would
       draw over the glass's back. The limit is on the projection, not the height,
       since one height is drawn two rim depths apart front and back. The ceiling
       is the lip's own ellipse at the speck's angle, its width kept under it. */
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

/* and fades slowly in the air, quickly once the beer comes back over it. That
   compares the height it is stuck at with the beer at that wall, both plane
   measures. The projected y would wash off near-wall marks, which the bulge
   puts lower than their height. */
function updateLace(dt){
  layLacing(dt);
  for (let i = lace.length - 1; i >= 0; i--){
    const l = lace[i];
    const [lx] = lacePos(l);
    l.life -= dt * (l.h > surfaceAt(lx) + 1 ? 6 : 1);
    if (l.life <= 0) l.gone = true;
  }
  sweep(lace);
}

/* A still page still shows a poured pint: with reduced motion asked for, the
   glass is filled and dressed at once rather than poured */
function settleStill(){
  if (!reduceMotion.matches) return;
  level = targetLevel();
  poured = true;
  const depth = cfg.headDepth / 100;
  for (let i = 0; i < 140; i++) addFoam(G.cx + rand(-1, 1) * innerHalfAt(restSurfaceY()) * 0.95, foamRadius(depth));
  for (let i = 0; i < 70; i++){
    const y = rand(restSurfaceY() + 20, G.inBottom);
    const z = rand(-1, 1);
    addBubble(G.cx + rand(-1, 1) * innerHalfAt(y) * 0.9 * reachAt(z), y, rand(0.6, 3.4), z);
  }
  const beads = Math.round(capDew * clamp(cfg.condensation / 100, 0, 2) * 0.7
                          * clamp(level / 0.8, 0, 1));
  for (let i = 0; i < beads; i++) addDew(rand(1.0, 3.2));
}
