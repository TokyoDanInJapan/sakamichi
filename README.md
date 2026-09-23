# Sakamichi Brewing splash page

A splash page for Sakamichi Brewing. A pint glass pours itself to the fill
line. You can stir it with the pointer, slop it over the rim and watch it top
itself back up. A beer card beside the glass turns every few seconds, and the
glass is re-poured to match each beer.

There are two versions of the same pour:

| Page         | Renderer  | Look                                  |
| ------------ | --------- | ------------------------------------- |
| `index.html` | Canvas 2D | Graphic and flat. Runs anywhere.      |
| `webgl.html` | WebGL2    | Optical and photographic.             |

## Build and run

The site is built into `dist/`. The build needs Node 18 or later and has no
dependencies.

```sh
node build.mjs            # build once
node build.mjs --watch    # rebuild when src/ or the beers change
python3 -m http.server 8731 --directory dist
```

Vercel runs the same build (see `vercel.json`) and serves `dist/`. Do not
edit `dist/`, because each build replaces it.

## Source layout

| Path                         | Contents                                                 |
| ---------------------------- | -------------------------------------------------------- |
| `src/page.html`              | The page template for both renderers                     |
| `src/page.css`, `src/page.js`| Shared styles, the wordmark, the beer card, the phone menu |
| `src/sim.js`                 | The simulation, the controls and the logo                |
| `src/bar-wood.js`            | The timber texture for the bar                           |
| `src/canvas/`, `src/shader/` | Each renderer's `recipe.js`, `render.js` and `style.css` |
| `beers/`, `beers.json`       | The label art and how each beer is poured                |

`build.mjs` makes one page per renderer from `page.html`:

- It keeps the `<!-- @if canvas -->` or `<!-- @if shader -->` sections for
  that renderer.
- It fills in `{{title}}` and `{{description}}` from the page list in
  `build.mjs`.
- It replaces each `<!-- @inline file -->` with that file, so each page is a
  single file.
- It leaves out comments that start with `<!--#`.

Both renderers run the same simulation from `sim.js`. Each renderer's
`recipe.js` defines its sliders (`SPECS`), default recipe (`HOUSE`), style
presets (`PRESETS`) and storage key. Its `render.js` draws the scene and
calls `startCard()` when the glass is ready.

## The beer card

The card turns to a new beer every 5 seconds. Click it to spin it. **Hold**
stops it turning on its own, and so does an open tuning panel.

When a beer comes round, the glass moves to that beer's settings in
`beers.json`. A beer with no entry there uses `default`. To add a beer:

1. Put its label in `beers/` as a 900 × 900 JPEG.
2. Add its file name, without `.jpg`, to `BEERS` in `src/page.js`.
3. Optionally, add an entry to `beers.json`. The keys are the slider keys.

## Controls

Press **Tune** to open the panel and **Esc** to close it. Press **C** to hide
the interface.

The panel has seven style presets (Pilsner, Helles, Bock, Stout, Hazy IPA,
Red ale and Sour) and sliders grouped as Pour, Motion, Carbonation, Head,
Glass and Colour. The shader version adds an Optics group (caustics, light
angle and gloss), plus foam relief and clarity. Under Display you can set the
theme, the counter (polished or wood), motion and, on a phone, tilt. The
canvas version can also turn off the gooey head.

Settings are saved in `localStorage`, separately for each version
(`sakamichi-splash-v2` and `sakamichi-shader-v2`). **Reset to house recipe**
restores the defaults.

### Deep links

The query string can set any slider by its key in `SPECS`, which is useful for
demos and screenshots:

```
index.html?theme=dark&fill=95&hue=28&richness=92&headDepth=170&panel=1
```

It also accepts `theme` (`light`, `dark` or `auto`), `panel=1` to open the
panel and, in the canvas version, `goo=0`.

## Rebranding

- **Copy.** The name, tagline, taproom hours and links are plain markup in
  `src/page.html`.
- **Wordmark.** It uses a geometric sans stack (Futura or Century Gothic, no
  web font) in the brand yellow `--brand`. The script stretches BREWING to
  the width of SAKAMICHI.
- **Logo on the wall.** This is `logo-no-name.svg`, stored as the `LOGO_SVG`
  string in `src/sim.js`. Replace the string and update `LOGO_ASPECT`. Keep the
  `LOGO_PAD` inset, which stops the blur being cut off at the bitmap's edge.
- **Glass and recipe.** `layoutGlass()` in `src/sim.js` sets the proportions.
  `HOUSE` and `PRESETS` in each `recipe.js` set the default recipe and the
  presets.

## How it works

**Simulation.** The beer's surface is a shallow-water model across the width
of the glass, so a slosh piles up against the wall and spills over the rim.
Spilled beer lowers the level, and the glass refills slowly. Bubbles rise
from sites on the floor and feed the head. Condensation runs down the outside
and foam left on the glass dries as lacing.

**Camera.** One camera draws the whole scene. The rim and the base keep the
openness of the reference photograph (`RIM_OPEN` and `BASE_OPEN`). The eye
level and lens follow from where the layout puts the glass, so a phone and a
desktop show the same glass. `ryAt(y)` gives each ellipse its openness from
its height.

**Canvas version.** Three stacked canvases draw the beer and the bar, the head
(fused by an SVG goo filter) and the glass.

**Shader version.** Several passes draw into one WebGL2 canvas:

1. A half-resolution density field for the head
2. The beer, with Beer–Lambert colour, haze and caustics
3. Bubbles and spray
4. The head and then the glass
5. The room, with the bar's reflections

If WebGL2 is not available, the page offers the canvas version.

## Performance

- The canvas version caps the device pixel ratio at 2 and the shader version
  at 1.75. If frames run long, each page lowers its resolution, at most
  twice.
- Parts that change only with the layout or the palette are drawn once and
  kept. These are the logo's reflection and the timber on the canvas, and the
  still part of the room in the shader (`FS_ROOM`).
- Blurs and full-screen passes are limited to the area around the glass.
- If the GPU loses the WebGL context, the shader version reloads when the
  context returns. Saved settings bring the glass back as it was.
- With `prefers-reduced-motion`, the page shows one settled frame. The Motion
  control starts it.
