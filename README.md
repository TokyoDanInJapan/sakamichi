# Brewery splash page

A splash page for a brewery. A pint glass stands in the middle of the page and
pours itself. When it reaches the fill line it stops. Stir it hard enough to
throw beer over the rim and the glass tops itself back up, slowly.

Two renderings of the same pour, with no build step, no dependencies and no
network requests:

| File          | What it is                                              |
| ------------- | ------------------------------------------------------- |
| `index.html`  | Canvas 2D renderer — graphic and flat, runs anywhere    |
| `webgl.html`  | WebGL2 renderer — optical and photographic              |
| `sim.js`      | The pour itself, loaded by both                         |

The simulation is identical in both because it is the same file: `sim.js`
carries the glass geometry, camera, wave equation, particles and controls,
and each page wraps its own renderer around it. Each page defines its recipe
(`SPECS`, `HOUSE`, `PRESETS`, storage key) before loading it, hands it a
`redraw()` and a few hooks at boot, and links to the other from the bottom of
its control panel.

Open either file, or serve the folder:

```sh
python3 -m http.server 8731
```

## The pour

The glass is a shaker pint: tapered walls, a thick base, and a shallow ellipse
at the rim because the view looks slightly down on it. The perspective is
carried through the whole glass: ellipses open up the further they sit below
the eye line, so the base is rounder than the rim, the glass stands on the
front arc of its base ellipse, and the surface ellipse widens as the level
drops. The beer is bounded by that geometry, not by the viewport.

- **Filling.** `level` is the fraction of the glass interior holding beer. On
  load it pours briskly to the fill line (about two seconds) and stops there.
- **Spilling.** Dragging sideways through the beer drives the sloshing mode, so
  it piles up against the leading wall. Anything that climbs past the rim
  leaves the glass: the wave is clipped at the lip, the level drops by the
  volume lost, and the head is thrown over the edge to run down the outside.
- **Tilting.** On a phone, turning the **Tilt** control on lets the device's
  own gravity pull the pour downhill: the surface settles at a lean and sloshes
  on the way there, and a hard shake throws a splash. It is a standing force
  rather than a nudge, so holding the phone over will empty the glass over the
  rim the same way stirring it hard does. Where the browser insists on
  permission the control asks for it on the tap, and it is offered only on a
  device that reports a coarse pointer.
- **Refilling.** Once it has been poured, the glass tops itself back up at the
  slow refill rate — a spilled tenth takes several seconds to return. Moving
  the fill line by hand is treated as a deliberate change and applies at once.

Two smaller systems dress the glass itself. Condensation beads on the cold
outside below the beer line; a bead that grows too heavy lets go and runs down
to the base. And foam lost over the rim in a spill dries on as lacing at the
high-water mark, which fades slowly in the air and quickly once the refill
submerges it. Both run in both renderers.

## The canvas version

Three stacked canvases render the pour:

| Layer    | What it draws                                              |
| -------- | ---------------------------------------------------------- |
| `liquid` | The wall mark and the frosted bar top (mark and pour mirrored and blurred, fading into the surface), then beer clipped to the glass — the mark refracted through it in wave-bent slices |
| `foam`   | The head, run through an SVG goo filter to fuse the blobs   |
| `detail` | Foam cells, runs down the glass, then the glass itself      |

The surface is a discrete wave equation solved across the width of the glass,
two substeps per frame, with reflecting ends so ripples bounce off the walls. The
pointer adds velocity to the columns it passes, drags nearby bubbles along, and
shoves the head about; a click throws a splash, droplets and a burst of fizz.
Bubbles rise from fixed nucleation sites, grow as they climb, then pop into the
head — which is why the head thickens when you stir it. The head itself is
tinted by the beer, soaked wet at the beer line, and textured with bubble cells
and the odd coarsened boulder; malty recipes tint it deeper and collapse it
faster, in both renderers.

## The shader version

`webgl.html` renders the same pour in four GPU passes and adds the optics the
canvas version cannot do per pixel:

1. **Foam field** (half resolution) — the head's band and every foam cell drawn
   additively into a density buffer, which is the metaball field.
2. **Beer** — a full-screen pass. The glass stands on a lightly frosted bar
   top whose wall–floor horizon runs behind the glass, so the floor shows
   behind the pour. The base is a circle lying in that plane, so the glass
   meets the floor along the whole front arc of its base ellipse: the
   reflection begins on that curve and the contact shadow is an ellipse
   sharing the plane's eccentricity, wrapping the footprint behind as well as
   in front. Wall and mark reflect about the horizon; the glass about its own
   footprint. Both reflections diffuse the further they run and fade into the
   surface under a milky veil with a whisper of grain. The house mark hangs large on the wall just above
   the bar: seen past the glass it bends a little, and seen through the pour
   it is magnified by the cylinder of liquid, bent by the waves, and swallowed
   by depth and haze — a clear pilsner shows it, a murky bock hides it.
   Colour comes from Beer–Lambert absorption:
   blue is absorbed fastest, so the pour deepens from straw at the surface to
   brown at the bottom on its own, rather than from a hand-picked gradient.
   Turning **Clarity** down mixes in scattering: a hazy beer glows evenly,
   drifts with slow clouds of murk, and loses its caustics, the way suspended
   yeast really behaves. Caustics are refracted through the surface slope and
   scale with how disturbed it is, so a settled beer has almost none and a
   stirred one dances. A meniscus brightens the film where the beer climbs the
   walls, and light leaving through the thick base tints it amber and pools on
   the bar.
3. **Bubbles, droplets and spray** — one instanced quad each, shaded with a
   fresnel rim and clipped against the surface in the fragment shader.
4. **Head** — the density field thresholded into a mask, lit from the gradient
   of that field, so the foam has real relief and a specular sheen. The foam is
   modelled the way a real head ages: wet, beer-soaked and glossy at the beer
   line, drying matte and whiter towards the top, where drainage has coarsened
   the pores and the odd bubble has merged into a boulder. Colour and texture
   follow the recipe — a fizzy, low-malt pilsner head is bright white and
   tight; a rich bock head is beige, coarse and quicker to fall.
5. **Glass** — walls, rim, base and reflections evaluated per pixel from the
   same geometry the simulation uses, drawn in front of everything. The
   reflections sit at a fixed fraction of the wall's local half width, so they
   converge with the taper instead of running straight down a conical glass.

It adds five sliders the canvas version has no use for: **Foam relief**,
**Clarity**, **Caustics**, **Light angle** and **Gloss**.

If WebGL2 is unavailable the page says so and offers the canvas version.

## Controls

Press **Tune** (bottom right) to open the panel, **Esc** to close it, and **C**
to hide the whole interface.

- **Pour** — style presets (Pilsner, Helles, Bock), fill line and refill rate
- **Motion** — agitation, wave speed, viscosity
- **Carbonation** — bubble rate and size
- **Head** — depth and churn
- **Glass** — size and condensation (plus foam relief, shader version)
- **Colour** — beer hue and richness (plus clarity, shader version)
- **Optics** — caustics, light angle, gloss (shader version)
- **Display** — light/dark/auto, gooey head on or off, motion running or paused, tilt (phones)

Settings persist in `localStorage`. **Reset to house recipe** restores the
defaults.

## Deep links

Any slider can be set from the query string, which is useful for demos and
screenshots:

```
index.html?theme=dark&fill=95&hue=28&richness=92&headDepth=170&panel=1
```

Accepted keys: `theme` (`light`/`dark`/`auto`), `panel` (`1`), `goo` (`0`), and
every slider key — `fill`, `refill`, `agitation`, `waveSpeed`, `viscosity`,
`carbonation`, `bubbleSize`, `headDepth`, `foamChurn`, `glassSize`,
`condensation`, `hue`, `richness`, and in the shader version `relief`,
`clarity`, `caustics`, `lightAngle`, `gloss`.

## Rebranding

**Copy.** The name, tagline and buttons are plain markup in the `.masthead`
and `.lower` blocks. The eyebrow, tagline, buttons and the taprooms block (top
right, hidden under 900px) carry the real details from sakamichibrewing.com —
founded 2019 in Tachikawa, two taprooms by the station (south and north exits)
with their opening hours, and the social links.

**Wordmark.** It follows the brand lockup: geometric sans capitals
(Futura/Century Gothic stack, no webfont), BREWING letter-spaced to the width
of SAKAMICHI, in the brand yellow (`--brand`) on dark and ink on light. The
primary button and the favicon tile use the same yellow.

**The mark on the wall** is `logo-no-name.svg`, embedded in each file as the
`LOGO_SVG` string so the pages stay self-contained — swap that string (and its
`LOGO_ASPECT`) to rebrand it. `logoRect()` stands it one `pageMargin()` clear
of the plane's edge, the same `clamp(20px, 3.6vmin, 48px)` gutter the CSS
holds the copy off the page edges with. It is rasterised out of focus, inset
by `LOGO_PAD` in a larger bitmap so the blur fades out past the artwork
instead of being cut off square at the bitmap's edge — this mark's bars run
edge to edge, so keep that padding if you swap in your own.

**Glass.** Proportions live in `layoutGlass()` — width is 0.583 of height and
the base is 0.68 of the rim. Change `HOUSE` in the script to set the default
recipe, and `PRESETS` for the style chips.

**Camera.** One camera serves the whole scene. Rather than fixing it outright,
the glass is given the shape it ought to have — `RIM_OPEN` and `BASE_OPEN`,
read off the reference photograph — and the eye level and focal length that
produce them follow from wherever the layout has stood the glass, so a phone
and a desk show the same glass rather than two different ones. A
horizontal circle sitting a depth `d` below the eye projects to an ellipse of
`ry/rx = d / f`, so `ryAt(y)` gives every ellipse — rim, beer surface,
interior floor, base — its openness from its own height alone.

The eye level alone fixes how much rounder the base is than the rim, and the
lens then fixes both absolutely. Sit the eye too high and the base flattens
towards the rim, which is the giveaway of a distant, telephoto view; the
photograph's base ellipse opens to 0.316 against a rim of 0.14, and every
viewport here is held to that.

Because the rule belongs to the camera rather than to the glass, resizing the
glass swings its ellipses the way moving a real glass would: a short glass
sits lower, so both open up; a tall one carries its rim towards eye level and
closes it. `BAR_DEPTH` sets how much bar shows behind the glass and is
measured against the viewport for the same reason (its value is mirrored in
the shader's `horizonY`).

## Behaviour worth knowing

- **Agitation is frame-rate independent.** The pointer's speed is clamped per
  second rather than per frame, so the glass is as easy to slosh at 30fps as at
  144.
- **Reduced motion.** With `prefers-reduced-motion`, the page paints one settled
  frame and stays still. The Motion toggle starts it.
- **Performance.** The canvas version caps device pixel ratio at 2 and renders
  the foam layer at 0.62 scale behind the blur; the shader version caps it at
  1.75 and renders the density field at half resolution. Particle counts scale
  with viewport area. If frames run long, either page drops resolution twice
  and never raises it again mid-session.
- **Storage.** The two versions keep separate settings
  (`sakamichi-splash-v2` and `sakamichi-shader-v2`), so tuning one leaves the other
  alone.
