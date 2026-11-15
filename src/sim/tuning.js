/* Pouring a named beer: the tunings in beers.json and the walk from one
   beer's settings to the next. */
"use strict";

/* ================================================================== *
 * Pouring a particular beer
 * ================================================================== *
 * Each beer has an entry in beers.json, in the numbers the tuning panel uses.
 * The glass eases to them rather than snapping, so a pint does not change
 * colour between two frames. */
let BEER_TUNING = null;
let tune = null;

/* Loaded, not built in, so recipes can be edited without touching the
   renderers. The build also embeds the file in the page, because a page
   opened from disk cannot fetch a neighbouring file (another origin). The
   embedded copy is used when present and the fetch is the fallback. */
function loadTuning(){
  const carried = document.getElementById("beerTuning");
  if (carried){
    try {
      BEER_TUNING = JSON.parse(carried.textContent);
      if (pourWanted) pour(pourWanted, POUR_MS);
      return;
    } catch (e){ /* fall through to fetching it */ }
  }
  fetch("beers.json")
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(j => {
      BEER_TUNING = j;
      /* the card may have turned while the file was in flight */
      if (pourWanted) pour(pourWanted, POUR_MS);
    })
    .catch(() => {
      console.info("beers.json was not readable, so every beer is poured with " +
                   "whatever the glass is already set to. Serve the folder — " +
                   "python3 -m http.server — and each one gets its own.");
    });
}

const TUNE_HEX = ["beerHex", "roomHex", "auraHex"];
const POUR_MS = 1400;              /* a shade longer than the card's half turn */
let pourWanted = null;

/* Pour a named beer. Called each time a face comes round, and remembered
   because the first face is up before the file has arrived. */
function pour(name, ms){
  pourWanted = name;
  const s = tuningFor(name);
  if (s) tuneTo(s, ms == null ? POUR_MS : ms);
}

/* The settings for one beer: its own entry over the file's default. */
function tuningFor(name){
  if (!BEER_TUNING) return null;
  const d = BEER_TUNING.default || {};
  const b = (BEER_TUNING.beers || {})[name];
  if (!b || b.useDefault) return Object.assign({}, d);
  return Object.assign({}, d, b);
}

const mixHex = (a, b, k) => {
  const A = hexHsl(a), B = hexHsl(b);
  if (!A || !B) return B ? B.hex : (A ? A.hex : null);
  const ch = i => Math.round(clamp((A.rgb[i] + (B.rgb[i] - A.rgb[i]) * k) * 255, 0, 255));
  return "#" + [0, 1, 2].map(i => ch(i).toString(16).padStart(2, "0")).join("");
};

/* Start moving to a beer. Numbers are walked and colours mixed. The colour
   being left is read as a colour even when no hex is set, because a glass
   with no hex is still some colour and the new one must come out of it. */
function tuneTo(target, ms){
  if (!target) return;
  const from = {}, to = {}, hexFrom = {}, hexTo = {};
  for (const k in target){
    if (TUNE_HEX.indexOf(k) >= 0){
      if (!hexHsl(target[k])) continue;
      hexFrom[k] = k === "beerHex" ? beerSwatch() : k === "roomHex" ? roomSwatch() : auraSwatch();
      hexTo[k] = target[k];
    } else if (typeof target[k] === "number" && typeof cfg[k] !== "undefined"){
      from[k] = Number(cfg[k]);
      to[k] = target[k];
    }
  }
  cfg.preset = null;
  tune = {from, to, hexFrom, hexTo, t: 0, ms: Math.max(1, ms)};
}

function tuneStep(dt){
  if (!tune) return;
  tune.t = Math.min(1, tune.t + dt * 1000 / tune.ms);
  const k = tune.t * tune.t * (3 - 2 * tune.t);
  for (const key in tune.to) cfg[key] = tune.from[key] + (tune.to[key] - tune.from[key]) * k;
  for (const key in tune.hexTo) cfg[key] = mixHex(tune.hexFrom[key], tune.hexTo[key], k);
  const done = tune.t >= 1;
  if (done){
    for (const key in tune.to) cfg[key] = tune.to[key];
    for (const key in tune.hexTo) cfg[key] = tune.hexTo[key];
    tune = null;
  }
  /* Sliders travel with the glass when the panel is open, rather than jumping
     at the end. */
  if (done || document.body.dataset.panel === "open") syncInputs(true);
  else paletteHook();
}
