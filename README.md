# Sakamichi Brewing splash page

A splash page for Sakamichi Brewing. A pint glass pours itself to the fill
line. You can stir it with the pointer, slop it over the rim and watch it top
itself back up. A beer card beside the glass turns every few seconds, and the
glass is re-poured to match each beer.

There are two versions of the same pour:

| Page          | Renderer  | Look                                 |
| ------------- | --------- | ------------------------------------ |
| `index.html`  | WebGL2    | Optical and photographic.            |
| `canvas.html` | Canvas 2D | Graphic and flat. Runs anywhere.     |

`index.html` is the page visitors get. If the browser has no WebGL2, it sends
them on to `canvas.html` with the same query string.

## Build and run

The site is built into `dist/`. The build needs Node 18 or later and has no
dependencies.

```sh
node build.mjs            # build once
node build.mjs --watch    # rebuild when src/ or the beers change
node build.mjs --no-strip # keep the comments in the built pages
python3 -m http.server 8731 --directory dist
```

Vercel runs the same build (see `vercel.json`) and serves `dist/`. Do not
edit `dist/`, because each build replaces it.

## Tests

The tests use Node's own test runner and need no install step:

```sh
node --test "test/*.test.mjs"
```

They run the simulation without a browser and check that the surface keeps
its volume, stays finite, spills and refills, and behaves the same at 60, 120
and 144 Hz. They also check the comment stripper, a whole build, and values
that must agree between files: the 900 px breakpoint, the keys in
`beers.json`, and `BEERS` against the images in `beers/`.
`test/mutation.test.mjs` breaks the source in memory and checks that the
tests notice. CI runs the tests after the build.

If `loop.js` changes the order of its update calls, change `__frame` in
`test/helpers/sim.mjs` to match.

## Source layout

| Path                         | Contents                                                 |
| ---------------------------- | -------------------------------------------------------- |
| `src/page.html`              | The page template for both renderers                     |
| `src/page.css`, `src/page.js`| Shared styles, the wordmark, the beer card, the phone menu |
| `src/sim/`                   | The simulation, in page order: `core`, `layout`, `surface`, `weep`, `particles`, `input`, `colour`, `tuning`, `controls` |
| `src/splash.js`              | Drops and puddles in front of the glass, drawn on a 2D canvas |
| `src/loop.js`                | The frame loop, the quality control and the wiring of the panel's buttons |
| `src/bar-wood.js`            | The timber texture for the bar                           |
| `src/canvas/`, `src/shader/` | Each renderer's `recipe.js`, `render.js` and `style.css` |
| `beers/`, `beers.json`       | The label art and how each beer is poured                |
| `test/`                      | Tests for the simulation, the build and the data         |

`build.mjs` makes one page per renderer from `page.html`:

- It keeps the `<!-- @if canvas -->` or `<!-- @if shader -->` sections for
  that renderer.
- It fills in `{{title}}` and `{{description}}` from the page list in
  `build.mjs`.
- It replaces each `<!-- @inline file -->` with that file, so each page is a
  single file.
- It leaves out comments that start with `<!--#`.
- It removes the comments from the inlined scripts, styles and shaders, which
  makes each page about 40% smaller. Use `--no-strip` to read the comments in
  the browser's tools.
- It embeds `beers.json` in each page, so a page opened straight from disk
  still pours each beer with its own settings. The file is also copied
  beside the pages.

Both renderers run the same simulation from `src/sim/`. Each renderer's
`recipe.js` defines its sliders (`SPECS`), default recipe (`HOUSE`), style
presets (`PRESETS`) and storage key. Its `render.js` draws the scene and
registers itself as `renderer` (`render`, `resize` and `buildPalette`).
`loop.js` then runs the frame loop and calls `startCard()` when the glass is
ready.

Values that the simulation and the shaders must agree on, such as `BAR_DEPTH`
and `HEAD_LIFT`, are defined once in `src/sim/` and written into the shader
sources from there.

## The beer card

The card turns to a new beer every 5 seconds. Click it to spin it. **Hold**
stops it turning on its own until the page is reloaded (it is not saved), and
so does an open tuning panel or card.

When a beer comes round, the glass moves to that beer's settings in
`beers.json`: its colour, carbonation, head and how it moves. The head's foam
follows the new depth. A beer with no entry there uses `default`. To add a beer:

1. Put its label in `beers/` as a 720 × 720 WebP:
   `magick label.jpg -resize 720x720 -quality 50 -define webp:method=6 beers/name.webp`
2. Add its file name, without `.webp`, to `BEERS` in `src/page.js`.
3. Optionally, add an entry to `beers.json`. The keys are the slider keys.

## Company and contact cards

**Company** and **Contact** in the corner links, and the matching entries in
the phone menu, open a card in place of the glass. While a card is open the
renderers draw the room and the counter without the glass (the `glassAway`
flag in `src/sim/surface.js`), the beer card is hidden, and the card casts a warm glow
on the room as the pour does. `#company` or `#contact` in the URL opens
that card on load.

- **Company information** gives the details from the brewery's
  [会社概要 page](https://www.sakamichibrewing.com/%e4%bc%9a%e7%a4%be%e6%a6%82%e8%a6%81-company-information/),
  which gives them only in Japanese. Each one is in English with the Japanese
  beneath it.
- **Contact** lists what the brewery's
  [contact form](https://www.sakamichibrewing.com/contact-form/) asks for and
  opens it in a new tab. Messages have to be sent from the brewery's site,
  because its form takes a fresh anti-spam token on each visit.

Both cards are `<dialog class="sheet">` elements in `src/page.html`. Update
them if the brewery's pages change. To add a card, add another dialog with an
id and give its links `data-opens` set to that id.

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

- **Copy.** The name, tagline, taproom hours, links and company details are
  plain markup in `src/page.html`.
- **Wordmark.** It uses a geometric sans stack (Futura or Century Gothic, no
  web font) in the brand yellow `--brand`. The script stretches BREWING to
  the width of SAKAMICHI.
- **Logo on the wall.** This is `logo-no-name.svg`, stored as the `LOGO_SVG`
  string in `src/sim/layout.js`. Replace the string and update `LOGO_ASPECT`. Keep the
  `LOGO_PAD` inset, which stops the blur being cut off at the bitmap's edge.
- **Favicon.** It is an inline SVG in the `<link rel="icon">` tag in
  `src/page.html`.
- **Beers.** The labels are in `beers/`. The names are in `BEERS` in
  `src/page.js` and in `beers.json`.
- **Glass and recipe.** `layoutGlass()` in `src/sim/layout.js` sets the proportions.
  `HOUSE` and `PRESETS` in each `recipe.js` set the default recipe and the
  presets.

## How it works

**Simulation.** The beer's surface is a shallow-water model across the width
of the glass, so a slosh piles up against the wall and spills over the rim.
Spilled beer lowers the level, and the glass refills slowly. Bubbles rise
from sites on the floor and feed the head. Condensation runs down the outside
and foam left on the glass dries as lacing. Every update is scaled by the
frame time, so the pour moves the same on a 60 Hz and a 144 Hz display. While
a card hides the glass, the simulation waits.

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

The beer absorbs light along its path through the glass, so it is darkest
through the middle and lighter at the walls and towards the base. A beer's
`beerHex` is the colour seen through the middle of the glass at mid height.
Below the surface the beer shows the logo on the wall mirrored, as a full
glass does.

If WebGL2 is not available, the page opens the canvas version.

## Performance

- The canvas version caps the device pixel ratio at 2 and the shader version
  at 1.75. `loop.js` compares the frame time with the display's refresh
  interval. If frames run long for a few seconds it lowers the resolution, in
  two steps at most, and it raises it again after a long steady period.
- Parts that change only with the layout or the palette are drawn once and
  kept. These are the logo's reflection and the timber on the canvas, and the
  wall, the counter and the contact shadows in the shader (`FS_ROOM`).
- Blurs and full-screen passes are limited to the area around the glass.
- If the GPU loses the WebGL context, the shader version reloads when the
  context returns. Saved settings bring the glass back as it was.
- With `prefers-reduced-motion`, the page shows one settled frame. The Motion
  control starts it.

## Licence

The code is MIT licensed (see `LICENSE`). The Sakamichi Brewing name, logo,
wordmark, beer names and label images are the property of Sakamichi Brewing
and are not covered by that licence. `NOTICE` lists them.
