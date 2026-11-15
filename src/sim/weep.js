/* Foam over the lip: the collar the head hangs on the outside of the glass,
   the ribbons drawn out of it, and how both creep, drape and dry. */
"use strict";

/* ------------------------------------------------------------------ *
 * Foam over the lip
 * ------------------------------------------------------------------ *
 * A head that spills comes over the lip as a sheet, gathers into a bead, and
 * the bead draws a ribbon of foam down the outside, still joined to the rim.
 * A ribbon is anchored where it came over, pulled by the bead at its foot and
 * held by every inch of wall it has been drawn across, so most stop partway
 * down and only the fattest reach the bar. */
const RIBBON_MAX = 6;

/* How much weeping there is, and how deep it hangs. It is measured against the
   glass, not the head, since how far foam runs down the outside is a fact
   about the foam and the glass, not about how much stands inside. */
const weepAmount = () => clamp(cfg.weep / 100, 0, 2);
/* How plainly what has come over the lip is drawn: collar, ribbons, the shade
   under the hem and the pooling at the foot. It is separate from how much
   there is, so a glass can weep heavily as a film or barely at all in solid
   white. */
const weepAlpha = () => clamp(cfg.weepAlpha / 100, 0, 1);

const weepDeep = () => (G.topHalf * 2) * 0.18 * weepAmount();

/* The head comes over the lip as a sheet and hangs there. This collar is what
   the ribbons are drawn out of. It is a state of the pour, not a tally of
   spills: however much head stands above the lip is how much has draped over
   it, following the beer up and down. It is lobed because foam hangs in
   tongues. */
let collar = 0;
/* How far down the glass it has got, 0 at the lip and 1 at full reach. It is
   separate from the strength above: the foam that came over sets how far the
   weep will run and this sets how far along it is. */
let creep = 0;
/* and how far below the lip its hem has got, in pixels. It is eased because the
   beer it hangs past drops on a spill and climbs on top-up, and a live reading
   would run the weep up and down the outside. */
let weepReach = 0;
/* Whether the weep is still being fed. Foam on the outside does not go back in
   when the beer drops, so without feed it thins away over a couple of seconds
   from wherever it had got to. */
let weepAlive = 0;
/* The deepest the hem and its tongues have got. Foam never climbs back up the
   glass, so neither falls while the weep is alive. Read live they follow the
   pour, which is never still at the brim, and the hem judders. */
let weepHem = 0, weepDrape = 0;
/* The hem's run is held in pixels, so a resized glass must take it along. The
   ribbons, lacing and beading are dropped on a resize, as each is a thing at a
   place. This is one reach, not a list, and dropping it would strip a full
   weep off a merely resized window. Left unscaled, a desktop hem on a phone's
   glass is half the glass's height. */
function carryWeep(k){
  if (!(k > 0) || !isFinite(k) || Math.abs(k - 1) < 0.001) return;
  weepHem *= k;
  weepReach *= k;
}
/* The ratchet is kept as a fraction of the collar and turned into pixels each
   frame. In pixels it would also ratchet against the beer, and a stout poured
   after an IPA would keep the IPA's drape, as a smaller number never passes a
   Math.max. */
let weepDrapeK = 0;
/* Ribbons come out of the collar at a rate, not one per fleck, so what is owed
   is kept between frames */
let ribbonOwed = 0;
const RIBBON_RATE = 0.45;      /* at a full collar, about one every two seconds */

/* The weep runs in order: the head reaches the lip, comes over the ring of it,
   then runs down the outside. Both stages are cut from the one creep so they
   cannot drift apart. */
const WEEP_OVER = 0.45;
/* and how long it takes to dry off the glass once nothing feeds it */
const WEEP_DRY = 2.6;
/* and how long it takes to come back once fed again. It is quicker than drying
   but not instant, or a half-faded hem would return to full strength between
   two frames. */
const WEEP_WET = 0.7;
const ease = s => (s = clamp(s, 0, 1), s * s * (3 - 2 * s));
/* how far the foam has got over the ring of the lip */
const weepOver = () => ease(creep / WEEP_OVER);
/* and how far down the outside it has run, which starts once it is over */
const weepRun = () => ease((creep - WEEP_OVER) / (1 - WEEP_OVER));
function collarWant(){
  const band = headBand();
  if (band < 1 || weepAmount() <= 0.001) return 0;
  /* The weep is what the head sheds once the glass is full to the lip. None
     while the head's top is at or below the lip, all once it stands BRIM_LIFT
     (surface.js) of the glass height proud.

     The head's top is measured, not the beer's, as the beer sits a head's depth
     below the fill line. It is measured at the rest level, not the live surface,
     so waves do not lengthen and shorten the weep. */
  const over = G.inTop - (restSurfaceY() - band);
  return clamp(over / Math.max(1, G.inH * BRIM_LIFT), 0, 1);
}
/* Four or five broad tongues across the glass, as foam hangs in lobes a finger
   wide. Three waves round the rim make them, rolled once when a weep starts and
   held while it lasts. Fixed, every glass would wear the same collar, the one
   repeating part of the pour the eye learns. Rolled per frame it would crawl,
   which foam does not. */
let drapeF = [1.4, 2.6, 4.3];       /* how many tongues each wave makes */
let drapeP = [0, 2.1, 4.2];         /* and where round the glass they sit */
let drapeG = [0.400, 0.200, 0.133]; /* how deep each hangs */
let drapeB = 0.58;                  /* and how much of it is level hem */
function rollDrape(){
  drapeF = [rand(1.1, 1.9), rand(2.1, 3.2), rand(3.6, 5.2)];
  drapeP = [Math.random() * TAU, Math.random() * TAU, Math.random() * TAU];
  drapeG = [rand(0.30, 0.50), rand(0.14, 0.26), rand(0.08, 0.18)];
  drapeB = rand(0.50, 0.66);
}
/* The least a tongue hangs, and how sharply it closes off towards the sides.
   The shader's drape() is written from these. */
const DRAPE_LEAST = 0.06, DRAPE_SIDES = 3.4;
function collarDrape(th){
  let v = drapeB;
  for (let i = 0; i < 3; i++) v += drapeG[i] * Math.sin(th * drapeF[i] + drapeP[i]);
  /* Closed off at the sides, where the collar is edge on with no depth to show.
     Left open it hangs off the silhouette as square tabs. */
  const edge = Math.cos(th);
  return clamp(v, DRAPE_LEAST, 1) * Math.min(1, Math.abs(edge) * DRAPE_SIDES);
}

/* Where the ribbon lies across the glass at a fraction of the way down, and how
   wide: widest at the lip, thin down the middle, swelling into the bead. */
/* Its shape: the shoulder's share of the width at the foot and how much more
   it has at the lip, how fast it thins, and where the bead starts and how far
   it swells. The shader's ribbonHalf is written from these. */
const RIBBON_TAIL = 0.45, RIBBON_TAPER = 0.75, RIBBON_TAPER_POW = 1.5,
      RIBBON_BEAD_FROM = 0.70, RIBBON_BEAD_OVER = 0.30;
function ribbonHalf(d, t){
  /* the shoulder it comes over the lip on, drawn thin as it is pulled out */
  const tail = d.w * (RIBBON_TAIL + RIBBON_TAPER * Math.pow(1 - t, RIBBON_TAPER_POW));
  const bead = d.r * clamp((t - RIBBON_BEAD_FROM) / RIBBON_BEAD_OVER, 0, 1);
  return Math.max(tail, bead);
}

/* Foam arriving beside a running ribbon feeds it instead of starting another,
   so a glass sheds a few thick ribbons, not a fringe of identical ones. */
function spillFoam(x, r){
  if (weepAmount() <= 0.001) return;      /* turned right down, nothing runs */
  /* Nothing runs before the collar has come over the lip. A ribbon is the
     collar's tail, and one started early would hang with nothing at its top. */
  if (weepOver() < 0.999) return;
  const rimY = G.inTop;
  const hwRim = Math.max(1, innerHalfAt(rimY));
  /* Which side it runs down. A column knows only how far across the glass it
     stands, which meets the rim circle at the near and far lip. A ribbon on the
     back is seen through the pour, which makes the glass read as having a
     back. */
  const base = Math.asin(clamp((x - G.cx) / hwRim, -1, 1));
  let th = Math.random() < 0.5 ? base : Math.PI - base;
  if (th > Math.PI) th -= TAU;
  addRibbon(th, r);
}

function addRibbon(th, r){
  const lip = G.top + G.topHalf * G.ryTop;
  /* The lip is the plane of the rim ellipse, well below where the inside of the
     glass begins. Hung from the inner top, ribbons would land a rim's depth
     above the rim. */
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
    /* Top sits on the lip, half a pixel over. That closes the join with the collar
       without reading as a tab, as starting higher does. */
    top: lip - 0.5 * G.scale,
    h: lip + rand(8, 18),
    w: clamp(3 * G.scale + r * 0.25, 3.4 * G.scale, 10 * G.scale),
    r: clamp(r * 0.7, 2.4 * G.scale, 8 * G.scale),
    /* No two run alike: some foam is stiffer, and none runs dead straight, as a
       trail wanders across what it runs on */
    slow: rand(0.55, 1.5),
    wob: Math.random() * TAU, wobA: rand(0.8, 2.4) * G.scale,
    vy: 0, pool: 0, life: rand(11, 22)
  });
}

/* The weep's own step, run at the end of updateDrops */
function updateWeep(dt){
  /* The strength follows the pour at once and the creep takes about four seconds
     from lip to target.

     Cut off, none of it runs backwards. A spill drops the level below the line
     feeding the weep and, read straight, would take the collar off between two
     frames. Reach, tongues and creep are held and the whole thins away. Only when
     nothing is left to see is anything wound back, so the next weep starts at the
     lip. */
  const want = collarWant();
  const k = Math.min(1, dt * 0.25);
  if (want > 0.01){
    if (weepAlive === 0) rollDrape();     /* a new weep hangs its own way */
    weepAlive = Math.min(1, weepAlive + dt / WEEP_WET);
    /* Gained at the pace of the pour and lost at the pace it dries. A head dipping
       under the lip briefly keeps its collar, as the beer going quiet does not take
       foam back in. */
    collar += (want - collar) * (want > collar ? Math.min(1, dt * 6)
                                               : Math.min(1, dt / WEEP_DRY));
    creep += (1 - creep) * k;
    const reachWant = Math.max(0, restSurfaceY() - (G.top + G.topHalf * G.ryTop));
    weepReach += (reachWant - weepReach) * k;
    /* and what is drawn only ever runs further down */
    weepHem = Math.max(weepHem, weepReach);
    weepDrapeK = Math.max(weepDrapeK, collar);
  } else if (weepAlive > 0){
    weepAlive = Math.max(0, weepAlive - dt / WEEP_DRY);
    if (weepAlive === 0){ collar = 0; creep = 0; weepReach = 0; weepHem = 0; weepDrapeK = 0; }
  }
  /* turned into pixels here, against the beer standing in the glass now */
  weepDrape = weepDrapeK * weepDeep();

  /* The collar sheds ribbons, fed by how much head is over the lip. Testing for a
     single fleck at the rim and wall almost never succeeds at a quiet brim, so a
     full collar would shed nothing. They start anywhere round the rim. */
  if (weepOver() > 0.999 && weepAlive > 0.5 && collar > 0.15){
    ribbonOwed += dt * collar * weepAmount() * RIBBON_RATE;
    while (ribbonOwed >= 1){
      ribbonOwed -= 1;
      addRibbon(rand(-Math.PI, Math.PI), rand(5, 11) * G.scale);
    }
  } else ribbonOwed = 0;
  /* It runs until it is on the bar. The foot is the height the glass stands at,
     where the wall runs out from under it. */
  for (let i = drips.length - 1; i >= 0; i--){
    const d = drips[i];
    if (d.pool > 0){
      /* Landed. It spreads on the bar and then soaks in. */
      d.pool = Math.min(d.pool + 22 * G.scale * dt, d.r * 3.2);
      d.life -= dt * 0.5;
      if (d.life <= 0) drips.splice(i, 1);
      continue;
    }
    /* Foam has the speed the bead's weight can drag past the wall holding it, so a
       fat bead runs and a thin one barely moves. The further it has come the more
       wall holds it, which stops ribbons at every height. */
    const pull = 21 * G.scale * (d.r / (5 * G.scale)) / d.slow;
    const held = 1 + (d.h - d.top) / (G.inH * 0.22);
    d.vy += (pull / held - d.vy) * Math.min(1, dt * 1.2);
    d.h += d.vy * dt;
    /* The bead spends itself on the trail it leaves */
    d.r = Math.max(0.5 * G.scale, d.r - d.vy * dt * 0.015);
    d.w = Math.max(0.5 * G.scale, d.w - dt * 0.03 * G.scale);
    d.life -= dt;
    /* It stops with the bead's underside on the bottom edge, not its middle, so a
       taller bead arrives sooner. */
    const foot = G.bottom - d.r;
    if (d.h >= foot){
      d.h = foot; d.vy = 0; d.pool = 0.01;
      d.life = Math.max(d.life, 8);
    } else if (d.life <= 0) drips.splice(i, 1);
  }
}
