/* The tuning panel: its sliders and colour boxes, their readouts, and opening
   and closing it. */
"use strict";

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

    /* A colour gets a text box for a hex and a swatch to pick with. They are one
       setting: the swatch writes the box and the box tints the swatch. */
    if (s.type === "hex"){
      wrap.innerHTML =
        `<label for="${id}">${s.label}</label>` +
        `<output for="${id}" id="out-${s.key}"></output>` +
        `<span class="hex">` +
          `<input type="color" id="sw-${s.key}" aria-label="${s.label} swatch">` +
          `<input type="text" id="${id}" spellcheck="false" autocomplete="off" ` +
                `placeholder="#rrggbb" maxlength="7" inputmode="latin">` +
        `</span>`;
      frag.appendChild(wrap);
      const text = wrap.querySelector("input[type=text]");
      const sw = wrap.querySelector("input[type=color]");
      inputs[s.key] = text;
      const apply = v => {
        cfg[s.key] = v;
        paletteHook();
        if (cfg.preset){ cfg.preset = null; chipsHook(); }
        readout(s);
        saveSoon();
        redraw();
      };
      text.addEventListener("input", () => {
        const v = text.value.trim();
        if (!v){ apply(null); return; }      /* emptied: back to the sliders */
        const c = hexHsl(v);
        if (c) apply(c.hex);                 /* anything else is half-typed */
      });
      sw.addEventListener("input", () => { text.value = sw.value; apply(sw.value); });
      continue;
    }

    wrap.innerHTML =
      `<label for="${id}">${s.label}</label>` +
      `<output for="${id}" id="out-${s.key}"></output>` +
      `<input type="range" id="${id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${cfg[s.key]}">`;
    frag.appendChild(wrap);
    const input = wrap.querySelector("input");
    inputs[s.key] = input;
    input.addEventListener("input", () => {
      cfg[s.key] = Number(input.value);
      /* Moving a hue slider clears its hex, which would otherwise override it. */
      for (const hk in HEX_OVER) if (HEX_OVER[hk] === s.key) clearHex(hk);
      if (PALETTE_KEYS.includes(s.key)) paletteHook();
      if (s.key === "glassSize"){ resizeHook(); }
      /* A deliberate fill change moves the glass at once. The slow top-up is for
         beer that was sloshed out. */
      if (s.key === "fill"){ level = targetLevel(); poured = true; }
      /* These set how the beer is viewed, not what is in the glass, so they leave
         the pour on its recipe. */
      if (cfg.preset && s.key !== "fill" && s.key !== "agitation" && s.key !== "glassSize"
          && s.key !== "refill" && s.key !== "pace"){
        cfg.preset = null;
        chipsHook();
      }
      readout(s);
      saveSoon();
      redraw();
    });
  }
  slidersEl.appendChild(frag);
  SPECS.forEach(readout);
}

/* Called every frame while a beer is poured with the panel open, so elements
   are found once and only changed text is written. */
const readoutEls = {};
function readout(s){
  let el = readoutEls[s.key];
  if (!el) el = readoutEls[s.key] = {out: document.getElementById("out-" + s.key),
                                     sw: document.getElementById("sw-" + s.key)};
  const out = el.out;
  if (!out) return;
  const text = s.type === "hex" ? (cfg[s.key] ? "" : "auto") : cfg[s.key] + s.unit;
  if (out.textContent !== text) out.textContent = text;
  if (s.type === "hex"){
    const paint = HEX_SWATCH[s.key];
    if (el.sw && paint){ const v = paint(); if (el.sw.value !== v) el.sw.value = v; }
  }
}

/* Each colour box overrides a slider: set it and the slider is ignored, empty
   it and the slider returns. The swatch shows the colour actually in use,
   whichever of the two decides. */
const HEX_OVER = {beerHex:"hue", roomHex:"bgHue"};
const HEX_SWATCH = {beerHex: () => beerSwatch(), roomHex: () => roomSwatch(),
                    auraHex: () => auraSwatch()};

/* Give it back to the slider, clearing box and swatch. */
function clearHex(key){
  if (cfg[key] == null) return;
  cfg[key] = null;
  if (inputs[key]) inputs[key].value = "";
  const s = SPECS.find(x => x.key === key);
  if (s) readout(s);
}

/* keep: move the panel to match the settings without saving. The card turning
   is not the viewer's choice and must not replace the tuning they set. */
function syncInputs(keep){
  for (const s of SPECS){
    if (inputs[s.key]) inputs[s.key].value = cfg[s.key] == null ? "" : cfg[s.key];
    readout(s);
  }
  paletteHook();
  chipsHook();
  if (!keep) save();
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
