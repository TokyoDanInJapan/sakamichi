/* ================================================================== *
 * The page around the pour
 * ================================================================== *
 * What both renderers wear around the glass, independent of how it is drawn:
 * the wordmark, the beer card, and the phone's menu and hold. Loaded after
 * src/sim/, whose settings, save() and pour() it uses. The frame loop
 * (loop.js) fits the wordmark when it lays the page out and calls startCard()
 * once the glass is up. */
"use strict";

/* The wordmark: BREWING is tracked out to the ink width of SAKAMICHI above it.
   The tracking cannot be a constant, as it depends on the natural widths in
   whatever font arrives.

   It is walked in, not predicted: set the tracking, measure the result and
   close the gap. Three passes are plenty as the error shrinks tenfold each
   time. A one-shot calculation goes stale when a font arrives late or a media
   query has not yet applied, and nothing would check it again.

   Both lines are measured as ink: the advance less the tracking after the last
   letter, which the eye does not align on. The width is the text's own, not
   the block's, as a block line fills its column and would only return it. */
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

  /* The line under it (EST. 2019, the town) is fitted to the same width, so the
     three make one block with a straight right edge. On its own it drifts: wider
     on a phone, where the wordmark sits at the floor of its clamp, narrower on a
     wide screen, at the ceiling.

     It is fitted by font size, not tracking, as this line is already spread and
     squeezing its tracking would remove what matches it to the wordmark. Width
     is near linear in size, so one step lands close and later passes finish. */
  const eyebrow = document.querySelector(".masthead .eyebrow");
  const parts = eyebrow ? eyebrow.querySelectorAll("span") : [];
  if (!parts.length || !target) return;
  /* The line's own extent, first mark to last, not the paragraph's box, which
     fills its column and would send the size to its clamp. */
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
 * The card turns half a revolution every few seconds and comes back as a
 * different beer. The swap happens at the halfway point, where the card is
 * edge on, so the label never changes in view. Every other turn leaves the
 * card back to front, so the artwork is mirrored back to read correctly. */
const BEERS = ["anniversary-ipa-2026", "calico-cats-meow", "dr-krush", "fruit-fool", "hunters-mark-dip-hop-ipa", "miami-weisse", "mount-crushmore", "mr-bones", "mr-bones-raspberry", "new-year-pilsner-2026", "no-rest-for-the-wicked-2026", "oast-house-ale", "passion-project", "passion-project-v02", "praxis", "razcherry-sour", "seize-the-means-red-ipa", "shibasaki-session", "shirasagi-white-ipa", "skysaw", "sommergold-weisse", "sumomo-mo-momo-mo-momo-no-hazy", "tachikawa-helles", "tachikawa-hop-city", "tama-monoale-simcoe", "tamas-chocolate-organe-porter", "tanabata-pale-ale", "telefunk", "this-is-a-hazy-ipa", "tricerahops", "watling-esb", "wolly-mammoth-dipa", "yozakura!"];
const BEER_EVERY = 5000, BEER_TURN = 1150;
/* The cards that stand in place of the glass: company information and contact.
   Each is a modal dialog, so it takes focus, keeps it and returns it, and Esc
   closes it. While one is open the renderers leave the glass out, the page is
   marked with the card's name so styles can put the beer card away, and the
   beer card stops turning. Any element with data-opens set to a card's id
   opens it, as does a link to #id. */
function startSheets(){
  for (const dlg of document.querySelectorAll("dialog.sheet")){
    if (typeof dlg.showModal !== "function") return;
    /* Focus returns to whatever opened it. If that was a row in the phone's menu,
       since closed, it goes to the menu's button. */
    let opener = null;
    const open = () => {
      if (dlg.open) return;
      for (const other of document.querySelectorAll("dialog.sheet[open]")) other.close();
      opener = document.activeElement;
      document.body.dataset.sheet = dlg.id;
      glassAway = true;
      redraw();
      dlg.showModal();
    };
    dlg.addEventListener("close", () => {
      if (document.body.dataset.sheet === dlg.id){
        delete document.body.dataset.sheet;
        glassAway = false;
        redraw();
      }
      if (opener && opener.isConnected && opener !== document.body) opener.focus();
      if (opener && document.activeElement !== opener){
        const menuBtn = document.getElementById("menuOpen");
        if (menuBtn) menuBtn.focus();
      }
      opener = null;
    });
    dlg.querySelector(".sheet-close").addEventListener("click", () => dlg.close());
    /* a click on the dialog itself, outside the card inside it, is a click on the
       page around the card */
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
    for (const a of document.querySelectorAll(`[data-opens="${dlg.id}"]`)){
      a.addEventListener("click", e => { e.preventDefault(); open(); });
    }
    if (location.hash === "#" + dlg.id) open();
  }
}

function startCard(){
  /* The phone's menu is separate from the tuning panel, which is a workbench that
     does not belong on a phone. It does not need the beer card. */
  startSheets();

  const mBtn = document.getElementById("menuOpen");
  const mNav = document.getElementById("menu");
  const mCls = document.getElementById("menuClose");
  if (mBtn && mNav && mCls){
    /* Focus follows the menu when the user opens or closes it, but not on the
       initial close, which put a focus ring on every phone's menu button. */
    const setMenu = (open, moveFocus = true) => {
      document.body.dataset.menu = open ? "open" : "closed";
      mNav.hidden = !open;
      mBtn.setAttribute("aria-expanded", String(open));
      if (!moveFocus) return;
      if (open) mCls.focus(); else mBtn.focus();
    };
    mBtn.addEventListener("click", () => setMenu(true));
    /* a card is not a link out, so the menu makes way for it */
    for (const a of mNav.querySelectorAll("[data-opens]")){
      a.addEventListener("click", () => setMenu(false, false));
    }
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
    const url  = k => "beers/" + encodeURIComponent(BEERS[k]) + ".webp";
    const show = (el, k) => { el.src = url(k); };
    let turn = 0;
    let next = (Math.floor(Math.random() * BEERS.length) + 1) % BEERS.length;
    show(faces[0], (next - 1 + BEERS.length) % BEERS.length);
    show(faces[1], next);          /* already loaded, and facing away */
    pour(BEERS[(next - 1 + BEERS.length) % BEERS.length]);

    /* One half turn: the face coming round is already the next beer and the one
       going out of sight is given the one after, so it has loaded by its return.
       The arriving beer is poured only when the card has stopped, as pouring under
       a turning card puts two changes on screen at once. */
    const step = ms => {
      card.style.transitionDuration = ms + "ms";
      turn += 180;
      card.style.transform = "rotateY(" + turn + "deg)";
      const arriving = BEERS[next];
      next = (next + 1) % BEERS.length;
      const away = faces[((turn / 180) + 1) % 2];
      setTimeout(() => { show(away, next); pour(arriving); }, ms);
    };

    /* Left alone the card turns itself, except with the tuning panel open (someone
       working on the glass cannot have it poured out from under them) and while
       the tab is hidden. The angle only increases and a hidden tab paints nothing
       but still fires timers, so unseen turns would pile into the transform and
       animate all at once on return. Coming back restarts the clock. A push still
       turns the card in both cases. */
    const auto = () => {
      if (cfg.hold || document.hidden || document.body.dataset.panel === "open"
          || document.body.dataset.sheet) return;
      step(BEER_TURN);
    };
    /* Hold stops the card coming round on its own, like the panel and a hidden tab,
       and a push still turns it. It is not a lock against your own hand. */
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

    /* A push spins the card in one throw that runs down, as three flips would
       stutter. The angle is stepped per frame, not by transition, since the faces
       must change exactly as the card goes edge on, which depends on the slowing.
       The beers it will pass are fetched first, as the first face arrives too soon
       to load a picture and an empty face flickers. */
    let spinning = false;
    wrap.addEventListener("click", () => {
      if (spinning) return;
      spinning = true;
      clearInterval(timer);
      /* The distance is random, three to eight half turns, as a fixed stop reads as
         a mechanism. It is at least one so it lands on a different beer, and longer
         spins get longer throws so they need not run proportionally faster. */
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
          /* thrown, and running down: quick away, the last of it slow */
          const e = 1 - Math.pow(1 - p, 3);
          const a = from + (to - from) * e;
          card.style.transform = "rotateY(" + a + "deg)";
          /* each time it passes edge on, the face going out of sight takes the next
             beer, as in the idle turn */
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
        /* Where a spin ends, however it got there. It must be reachable apart from the
           animation, as requestAnimationFrame stops in a background page. A spin cut
           off there would never clear the flag, so every later push would be refused
           and the automatic turn never restart. A watchdog a second past the throw
           finishes it. */
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
          /* nothing was poured on the way past, so the beer it stopped on is poured now.
             A push is the viewer's own act, so it may move their tuning even with the
             panel open. */
          pour(BEERS[(next - 1 + BEERS.length) % BEERS.length]);
          idle();
        };
        const guard = setTimeout(land, SPIN_MS + 1000);
        requestAnimationFrame(frame);
      });
    });
  }
}
