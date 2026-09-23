/* ================================================================== *
 * The page around the pour
 * ================================================================== *
 * What both renderers wear around the glass and has nothing to do with how it
 * is drawn: the wordmark, the beer card beside the glass, and the phone's menu
 * and the hold that go with them. Loaded after sim.js, whose settings, save()
 * and pour() it uses. Each page fits the wordmark as it lays itself out and
 * calls startCard() once its own glass is up.
 */
"use strict";

/* The wordmark: BREWING is tracked out to stand exactly as wide as SAKAMICHI
   above it. The tracking that does it cannot be a constant — it depends on the
   two words' natural widths in whatever font actually arrives, and the fallback
   stack runs from Futura PT to whatever the machine has. Written as one, the
   second line overhung the first by most of a letter.

   So it is measured — and then checked, which is the part that was missing.
   Worked out in one pass from the two natural widths, the answer was only ever
   as good as the moment it was taken in: a font arriving late, or a media
   query that had not applied yet, left a tracking that had been correct for
   metrics nobody has any more, and nothing ever went back to look. That is how
   the second line came to sit thirteen pixels wide of the first on a phone
   while matching to the pixel on a desktop.

   So it is walked in instead. Set the tracking, measure what that actually
   produced, and close whatever gap is left; three passes is more than enough
   for a correction that gets an order of magnitude smaller each time, and it
   is right whatever changed underneath it, because it is reading the result
   rather than predicting it.

   Both lines are measured as ink — the painted width, which is the advance
   less the tracking that follows the last letter, since tracking is added
   after the final letter as well as between. That trailing space is empty and
   the eye does not line up on it. And it is the text's own width, not the
   block's: a block line fills the column it is in, and measuring that would
   only ever hand back the column. */
function fitWordmark(){
  const h1 = document.querySelector(".masthead h1");
  if (!h1) return;
  const thin = h1.querySelector(".thin");
  const mark = h1.firstChild;
  if (!thin || !mark || mark.nodeType !== 3) return;
  const n = thin.textContent.trim().length;
  if (n < 2) return;

  const inkOf = (node, whole) => {
    const r = document.createRange();
    if (whole) r.selectNodeContents(node); else r.selectNode(node);
    return r.getBoundingClientRect().width;
  };
  const own = parseFloat(getComputedStyle(h1).letterSpacing) || 0;

  let target = 0;
  for (let pass = 0; pass < 3; pass++){
    target = inkOf(mark, false) - own;
    const spacing = parseFloat(thin.style.letterSpacing) || 0;
    const err = target - (inkOf(thin, true) - spacing);
    if (Math.abs(err) < 0.25) break;
    thin.style.letterSpacing = (spacing + err / (n - 1)).toFixed(3) + "px";
  }

  /* And the line under it — EST. 2019, the town — is brought to the same width
     as the two above it, so the three make one block with a straight right
     edge instead of a stack that happens to be about as wide as itself. It
     wanders a long way from that on its own: 39 pixels over on a phone, where
     the wordmark has hit the floor of its clamp and stopped shrinking, and 33
     under on a wide screen, where the wordmark has hit the ceiling.

     Fitted by size rather than by tracking. Tracking is what does it for
     BREWING because BREWING is one word being spread to fill a measure; this
     line is already spread, and squeezing its tracking to fit a phone would
     take out the very thing that makes it match the wordmark's manner. Width
     is near enough linear in the size — the letter-spacing is in ems and only
     the rule between the two halves is not — so one step lands close and the
     passes after it close the rest. */
  const eyebrow = document.querySelector(".masthead .eyebrow");
  const parts = eyebrow ? eyebrow.querySelectorAll("span") : [];
  if (!parts.length || !target) return;
  /* The line's own extent, first mark to last — not the paragraph's box. The
     paragraph is a block and fills the column it is in, so its width is the
     column's answer and not the line's, and a size fitted against it chases a
     number that does not move: it ran to the floor of its clamp on a phone and
     to the ceiling on a desktop, both times leaving the line exactly as wide
     as it started. The same trap the second line of the wordmark was in. */
  const lineWidth = () => {
    const a = parts[0].getBoundingClientRect();
    const b = parts[parts.length - 1].getBoundingClientRect();
    if (Math.abs(a.top - b.top) > 1) return 0;      /* wrapped: leave it alone */
    return b.right - a.left;
  };
  for (let pass = 0; pass < 3; pass++){
    const size = parseFloat(getComputedStyle(eyebrow).fontSize) || 0;
    const w = lineWidth();
    if (!(size > 0) || !(w > 0) || Math.abs(target - w) < 0.5) break;
    eyebrow.style.fontSize = clamp(size * target / w, 6, 26).toFixed(2) + "px";
  }
}


/* ================================================================== *
 * The beer of the moment
 * ================================================================== *
 * It turns half a revolution every few seconds and comes back a different
 * beer. The swap happens at the halfway point, where the card is edge on and
 * there is nothing of it to see — turn it any other way and the label changes
 * in front of you. Every other turn leaves the card back to front, so the
 * artwork is mirrored back the way it was read.
 */
const BEERS = ["anniversary-ipa-2026", "calico-cats-meow", "dr-krush", "fruit-fool", "hunters-mark-dip-hop-ipa", "miami-weisse", "mount-crushmore", "mr-bones", "mr-bones-raspberry", "new-year-pilsner-2026", "no-rest-for-the-wicked-2026", "oast-house-ale", "passion-project", "passion-project-v02", "praxis", "razcherry-sour", "seize-the-means-red-ipa", "shibasaki-session", "shirasagi-white-ipa", "skysaw", "sommergold-weisse", "sumomo-mo-momo-mo-momo-no-hazy", "tachikawa-helles", "tachikawa-hop-city", "tama-monoale-simcoe", "tamas-chocolate-organe-porter", "tanabata-pale-ale", "telefunk", "this-is-a-hazy-ipa", "tricerahops", "watling-esb", "wolly-mammoth-dipa", "yozakura!"];
const BEER_EVERY = 5000, BEER_TURN = 1150;
function startCard(){
  /* The phone's menu. Its own small thing rather than part of the tuning
     panel: one is what the brewery has to say and the other is a workbench,
     and only one of them belongs on a phone. It does not need the card, so it
     is set up whether or not the card is there. */
  const mBtn = document.getElementById("menuOpen");
  const mNav = document.getElementById("menu");
  const mCls = document.getElementById("menuClose");
  if (mBtn && mNav && mCls){
    /* Focus goes with the menu when somebody opens or closes it — but not
       when the page first sets it closed, which put a focus ring round the
       menu button of every phone that loaded the page. */
    const setMenu = (open, moveFocus = true) => {
      document.body.dataset.menu = open ? "open" : "closed";
      mNav.hidden = !open;
      mBtn.setAttribute("aria-expanded", String(open));
      if (!moveFocus) return;
      if (open) mCls.focus(); else mBtn.focus();
    };
    mBtn.addEventListener("click", () => setMenu(true));
    mCls.addEventListener("click", () => setMenu(false));
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && document.body.dataset.menu === "open") setMenu(false);
    });
    setMenu(false, false);
  }

  const wrap  = document.querySelector(".beer");
  const card  = document.querySelector(".beer-turn");
  const faces = [document.querySelector(".beer-face"),
                 document.querySelector(".beer-face.back")];
  if (wrap && card && faces[0] && faces[1] && BEERS.length){
    const url  = k => "beers/" + encodeURIComponent(BEERS[k]) + ".jpg";
    const show = (el, k) => { el.src = url(k); };
    let turn = 0;
    let next = (Math.floor(Math.random() * BEERS.length) + 1) % BEERS.length;
    show(faces[0], (next - 1 + BEERS.length) % BEERS.length);
    show(faces[1], next);          /* already loaded, and facing away */
    pour(BEERS[(next - 1 + BEERS.length) % BEERS.length]);

    /* One half turn: the face coming round is already the next beer, and the
       one going out of sight is given the one after it, to have loaded by the
       time it comes back. */
    /* The beer coming round is not poured until the card has stopped moving.
       Changing the glass under a turning card puts two changes on the screen
       at once and neither is watchable; held back, the card lands, and then
       the beer beside it becomes that beer. */
    const step = ms => {
      card.style.transitionDuration = ms + "ms";
      turn += 180;
      card.style.transform = "rotateY(" + turn + "deg)";
      const arriving = BEERS[next];
      next = (next + 1) % BEERS.length;
      const away = faces[((turn / 180) + 1) % 2];
      setTimeout(() => { show(away, next); pour(arriving); }, ms);
    };

    /* Left alone the card turns itself. It stops doing that in two cases.

       While the tuning panel is open: somebody with the sliders out is working
       on the glass in front of them, and having it poured out from under them
       every five seconds makes that impossible.

       And while the tab is not being looked at. The angle it is turned to only
       ever goes up, and a turn is a transition between two angles — but a
       hidden tab paints nothing while its timers go on firing, so the turns
       pile into the transform unseen and the whole heap animates at once on
       the way back. That is the card spinning wildly for a second after a
       return, and nothing accumulates if nothing turns. Coming back restarts
       the clock rather than resuming it, so the card is never caught mid-turn
       by a tab being brought forward.

       The card still turns when pushed, in either case. */
    const auto = () => {
      if (cfg.hold || document.hidden || document.body.dataset.panel === "open") return;
      step(BEER_TURN);
    };
    /* Hold keeps the beer that is in the glass. It stops the card coming round
       on its own, the same way the tuning panel and a hidden tab do — and, the
       same way, a push still turns it. Holding is about the card not changing
       under you; it is not a lock against your own hand. */
    {
      const btn = document.getElementById("beerHold");
      const lab = document.getElementById("beerHoldLabel");
      const sync = () => {
        btn.setAttribute("aria-pressed", String(!!cfg.hold));
        lab.textContent = cfg.hold ? "Held" : "Hold";
      };
      btn.addEventListener("click", () => { cfg.hold = !cfg.hold; sync(); save(); idle(); });
      sync();
    }
    let timer = setInterval(auto, BEER_EVERY);
    const idle = () => { clearInterval(timer); timer = setInterval(auto, BEER_EVERY); };
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !spinning) idle(); });

    /* Given a push it is spun: one turn of three, thrown hard and left to run
       down — not three flips one after another, which is a stutter with three
       starts in it. The angle is carried frame by frame here rather than
       handed to a transition, because the faces have to change exactly as the
       card goes edge on, and where those moments fall depends on how the spin
       is slowing.

       The beers it will pass are fetched first. Under momentum the first face
       comes round in a fraction of a second, which is not long enough to go
       and find a picture, and a face arriving empty is the flicker that having
       two of them was meant to end. */
    let spinning = false;
    wrap.addEventListener("click", () => {
      if (spinning) return;
      spinning = true;
      clearInterval(timer);
      /* How far it goes is not decided in advance. A card that always stops
         three faces along is a mechanism; one that comes to rest somewhere
         between three and eight is a card that was thrown. It is at least one
         either way, so the beer it lands on is never the beer it left. The
         throw is given a little longer for a longer run, so a spin of eight
         does not have to travel at eight thirds the speed of a spin of three. */
      const SPIN_HALVES = 3 + Math.floor(Math.random() * 6);
      const SPIN_MS = 1100 + 200 * SPIN_HALVES;
      const ready = [];
      for (let k = 1; k <= SPIN_HALVES + 1; k++){
        const im = new Image();
        im.src = url((next + k) % BEERS.length);
        ready.push(im.decode ? im.decode().catch(() => {}) : Promise.resolve());
      }
      Promise.race([Promise.all(ready), new Promise(r => setTimeout(r, 500))]).then(() => {
        const from = turn, to = turn + 180 * SPIN_HALVES;
        const t0 = performance.now();
        let crossed = 0;
        card.style.transitionDuration = "0ms";
        const frame = now => {
          const p = Math.min(1, (now - t0) / SPIN_MS);
          /* thrown, and running down: quick away, and the last of it slow */
          const e = 1 - Math.pow(1 - p, 3);
          const a = from + (to - from) * e;
          card.style.transform = "rotateY(" + a + "deg)";
          /* each time it passes edge on, the face going out of sight takes the
             next beer — the same handover the idle turn makes */
          const done = Math.min(SPIN_HALVES, Math.floor((a - from) / 180));
          while (crossed < done){
            crossed++;
            turn += 180;
            next = (next + 1) % BEERS.length;
            show(faces[((turn / 180) + 1) % 2], next);
          }
          if (p < 1){ requestAnimationFrame(frame); return; }
          land();
        };
        /* Where a spin ends, however it got there. It has to be reachable from
           somewhere other than the animation, because the animation is driven
           by requestAnimationFrame and a browser stops handing those out the
           moment the page goes to the background — a phone locked or switched
           away from mid-spin comes back to a card that is still spinning as
           far as this code knows. Nothing then clears the flag, so every later
           push is turned away at the door and the automatic turn, which the
           push had stopped, is never started again: the card is dead until the
           page is reloaded. A watchdog a second past the end of the throw
           finishes it whatever the frames did. */
        let landed = false;
        const land = () => {
          if (landed) return;
          landed = true;
          clearTimeout(guard);
          while (crossed < SPIN_HALVES){
            crossed++;
            turn += 180;
            next = (next + 1) % BEERS.length;
            show(faces[((turn / 180) + 1) % 2], next);
          }
          turn = to;
          card.style.transform = "rotateY(" + to + "deg)";
          card.style.transitionDuration = BEER_TURN + "ms";
          spinning = false;
          /* nothing was poured on the way past. The beers it flew through are
             not what was asked for — the one it stopped on is, and it is poured
             now the card is still. A push is the viewer's own doing, so this
             one is allowed to move their tuning even with the panel open. */
          pour(BEERS[(next - 1 + BEERS.length) % BEERS.length]);
          idle();
        };
        const guard = setTimeout(land, SPIN_MS + 1000);
        requestAnimationFrame(frame);
      });
    });
  }
}
