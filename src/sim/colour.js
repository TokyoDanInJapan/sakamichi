/* Colour: how the glass and the pour are drawn, hex and HSL conversion, the
   beer's tone, and the room, the aura and the theme. */
"use strict";

/* How plainly the glass is drawn: its wall and rim strokes. They are the only
   thing saying a glass is there, so they are kept apart from the beer. Turned
   down, the vessel fades and the beer is unchanged. */
const glassLine = () => clamp(cfg.glassLine / 100, 0, 1);

/* How much light the pour stops, as one figure for the whole beer, as thinning
   the parts separately would take it apart. Wound down, the bar and the back of
   the glass show through. */
const beerAlpha = () => clamp(cfg.beerAlpha / 100, 0, 1);

/* Past the full setting the pour keeps closing: what still shows through is
   the house mark on the wall. At the top nothing behind the glass shows. */
const beerSolid = () => clamp(cfg.beerAlpha / 100 - 1, 0, 1);

/* How much of the glass the counter gives back, a setting rather than a
   property of the glass. */
const reflectAmount = () => clamp(cfg.reflect / 100, 0, 2);

/* The beer's colour given as hex instead of by the hue slider. It is read back
   into hue, saturation and lightness so everything the pour tints (head, wall
   light, base glow) follows it. An empty box returns the pour to the sliders. */
function hexHsl(hex){
  if (typeof hex !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const r = parseInt(s.slice(0, 2), 16) / 255,
        g = parseInt(s.slice(2, 4), 16) / 255,
        b = parseInt(s.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0, sa = 0;
  if (d > 1e-6){
    sa = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? ((g - b) / d + (g < b ? 6 : 0))
      : mx === g ? ((b - r) / d + 2)
      :            ((r - g) / d + 4);
    h *= 60;
  }
  return {h, s: sa * 100, l: l * 100, rgb: [r, g, b], hex: "#" + s.toLowerCase()};
}

const hslHex = (h, s, l) => {
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p2 = 2 * l - q;
  const f = x => {
    x = (x + 1) % 1;
    const v = x < 1 / 6 ? p2 + (q - p2) * 6 * x
            : x < 1 / 2 ? q
            : x < 2 / 3 ? p2 + (q - p2) * (2 / 3 - x) * 6
            : p2;
    return Math.round(clamp(s === 0 ? l : v, 0, 1) * 255).toString(16).padStart(2, "0");
  };
  return "#" + f(h + 1 / 3) + f(h) + f(h - 1 / 3);
};

/* Hue, saturation and the two ends of the body's gradient. Richness sets how
   far apart the ends are, so it means depth of colour for a slider hue and a
   hex alike. */
function beerTone(){
  const r = clamp(cfg.richness / 100, 0, 1);
  const spread = 20 + r * 8;
  const c = hexHsl(cfg.beerHex);
  if (!c) return {h: cfg.hue, sat: 58 + r * 32, lTop: 70 - r * 12, lBot: 50 - r * 20,
                  l: 60 - r * 16, rgb: null};
  return {h: c.h, sat: c.s, l: c.l, rgb: c.rgb,
          lTop: clamp(c.l + spread / 2, 6, 96), lBot: clamp(c.l - spread / 2, 4, 92)};
}

/* What the swatch beside the box shows: the beer's actual colour, hex or not,
   so the picker opens where the pour stands. */
const beerSwatch = () => { const t = beerTone(); return hslHex(t.h, t.sat, t.l); };

/* ================================================================== *
 * Palette
 * ================================================================== */
const mqDark = matchMedia("(prefers-color-scheme: dark)");
/* The room's colour. Both renderers read the ground and the deep ground from
   --ground and --ground-deep, and the page background is the first, so one
   write colours room, bar and wall together.

   Without a hex only the hue (bgHue) is set, as the glass is lit against the
   wall. The result is returned so renderers need not read it back from the
   page, which forces a restyle of the whole document. A variable is written
   only when it changes, as a pour asks for the palette every frame. */
let roomSet = {ground: "", deep: ""};
function applyRoom(){
  const dark = isDark();
  const c = hexHsl(cfg.roomHex);
  let ground, deep;
  if (c){
    /* Given a colour, the room is that colour and the ground is a shade of it.
       They are the lit and shadowed parts of one wall and must stay the same hue,
       or the bar stops belonging to the room. The shade is the house ratio. */
    ground = c.hex;
    deep = hslHex(c.h, c.s, clamp(c.l * (dark ? 0.54 : 0.95), 0, 100));
  } else {
    const h = cfg.bgHue == null ? 220 : cfg.bgHue;
    const s = dark ? 16 : 9;
    ground = hslHex(h, s, dark ? 3.7 : 97);
    deep = hslHex(h, s, dark ? 2 : 92);
  }
  const st = document.documentElement.style;
  if (ground !== roomSet.ground) st.setProperty("--ground", ground);
  if (deep !== roomSet.deep) st.setProperty("--ground-deep", deep);
  roomSet = {ground, deep};
  return roomSet;
}

/* The aura: the light the glass throws on the wall and pools on the bar. It
   follows the beer unless given its own colour, because a bar has lamps that
   need not match what is in the glass. */
function auraTone(){
  const c = hexHsl(cfg.auraHex);
  if (c) return {h: c.h, s: c.s, l: c.l, own: true};
  const t = beerTone();
  return {h: t.h - 3, s: 88, l: 54, own: false};
}
const auraSwatch = () => { const a = auraTone(); return hslHex(a.h, a.s, a.l); };

/* What the swatch beside the room's box shows: the room's actual colour. */
const roomSwatch = () => {
  const c = hexHsl(cfg.roomHex);
  if (c) return c.hex;
  const dark = isDark();
  return hslHex(cfg.bgHue == null ? 220 : cfg.bgHue, dark ? 16 : 9, dark ? 3.7 : 97);
};

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return mqDark.matches;
};
