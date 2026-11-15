// Values that are decided in one place and have to agree with another, checked
// where they can be checked by machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { loadSim, loadRecipe, root, srcDir } from "./helpers/sim.mjs";

const RENDERERS = ["canvas", "shader"];
const recipes = Object.fromEntries(RENDERERS.map(r => [r, loadRecipe(r)]));
const text = p => readFileSync(join(root, p), "utf8");

/* ---- The glass goes compact where the stylesheet does ----------------------- */
function maxWidths(css){
  return [...css.matchAll(/@media[^{]*?\(\s*max-width\s*:\s*(\d+)px\s*\)/g)].map(m => Number(m[1]));
}

test("COMPACT_BELOW is the breakpoint the stylesheets use", () => {
  const sim = loadSim();
  const below = sim.run("COMPACT_BELOW");
  const widths = [];
  for (const f of ["page.css", "canvas/style.css", "shader/style.css"]) widths.push(...maxWidths(readFileSync(join(srcDir, f), "utf8")));
  assert.ok(widths.includes(below), `no max-width:${below}px in the stylesheets (they use ${[...new Set(widths)]})`);
  // no other breakpoint stands near it, which would be the same decision made a second time
  for (const w of widths) assert.ok(w === below || Math.abs(w - below) > 100, `max-width:${w}px stands near COMPACT_BELOW (${below})`);
});

test("the glass is laid out compact at the widths the stylesheet calls compact", () => {
  const below = loadSim().run("COMPACT_BELOW");
  const centre = w => { const s = loadSim(); s.layout(w, 700); return s.run("G.cx") / w; };
  assert.ok(Math.abs(centre(below - 1) - 0.5) < 1e-9, "just under: centred, as on a phone");
  assert.ok(Math.abs(centre(below + 1) - 1 / 3) < 1e-9, "just over: a third of the way across, beside the card");
});

/* The stylesheet's (max-width:900px) holds at a width of 900 itself, so the
   layout must be compact there too. */
test("the glass and the stylesheet agree at the breakpoint itself", () => {
  const s = loadSim();
  const below = s.run("COMPACT_BELOW");
  s.layout(below, 700);
  assert.ok(Math.abs(s.run("G.cx") / below - 0.5) < 1e-9);
});

/* ---- Recipes ---------------------------------------------------------------- */
const HEX = ["beerHex", "roomHex", "auraHex"];
const allKeys = new Set(RENDERERS.flatMap(r => recipes[r].SPECS.map(s => s.key)));

for (const r of RENDERERS){
  test(`${r} recipe: every slider has a house value and every house value a slider`, () => {
    const { SPECS, HOUSE } = recipes[r];
    const keys = SPECS.map(s => s.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate slider key");
    assert.deepEqual(keys.filter(k => !(k in HOUSE)), [], "sliders with no house value");
    assert.deepEqual(Object.keys(HOUSE).filter(k => !keys.includes(k)), [], "house values with no slider");
    for (const s of SPECS.filter(s => s.type !== "hex")){
      assert.ok(s.min < s.max, s.key);
      const v = HOUSE[s.key];
      assert.ok(v >= s.min && v <= s.max, `${s.key}: house ${v} outside ${s.min}..${s.max}`);
    }
  });

  test(`${r} recipe: presets and palette keys name real sliders`, () => {
    const { SPECS, PRESETS, PALETTE_KEYS } = recipes[r];
    const keys = new Set(SPECS.map(s => s.key));
    for (const [name, p] of Object.entries(PRESETS)){
      for (const [k, v] of Object.entries(p)){
        assert.ok(keys.has(k), `preset ${name} sets ${k}, which is not a slider`);
        const s = SPECS.find(s => s.key === k);
        if (s.type !== "hex") assert.ok(v >= s.min && v <= s.max, `preset ${name}: ${k} = ${v} outside ${s.min}..${s.max}`);
      }
    }
    for (const k of PALETTE_KEYS) assert.ok(keys.has(k), `PALETTE_KEYS has ${k}`);
  });
}

test("the two renderers keep their settings under different storage keys", () => {
  assert.notEqual(recipes.canvas.STORE_KEY, recipes.shader.STORE_KEY);
});

/* ---- beers.json ------------------------------------------------------------- */
const tuning = JSON.parse(text("beers.json"));
const pageJs = text("src/page.js");
const BEERS = JSON.parse(/const BEERS = (\[[^\]]*\]);/.exec(pageJs)[1]);
/* the file type the card asks for, read from the code that builds the address */
const IMAGE_EXT = /"beers\/"\s*\+\s*encodeURIComponent\(BEERS\[\w+\]\)\s*\+\s*"(\.\w+)"/.exec(pageJs)?.[1];

test("every key in beers.json is a setting the page knows", () => {
  assert.ok(allKeys.size > 20);
  const known = k => k.startsWith("_") || allKeys.has(k) || HEX.includes(k);
  const entries = { default: tuning.default, ...Object.fromEntries(Object.entries(tuning.beers).map(([n, b]) => ["beers." + n, b])) };
  const unknown = [];
  for (const [where, e] of Object.entries(entries)) for (const k of Object.keys(e)) if (!known(k)) unknown.push(`${where}.${k}`);
  assert.deepEqual(unknown, []);
});

test("every number in beers.json is inside its slider's range", () => {
  const range = {};
  for (const r of RENDERERS) for (const s of recipes[r].SPECS) if (s.type !== "hex"){
    range[s.key] = { min: Math.min(s.min, range[s.key]?.min ?? Infinity), max: Math.max(s.max, range[s.key]?.max ?? -Infinity) };
  }
  const bad = [];
  const check = (where, e) => { for (const [k, v] of Object.entries(e)){
    if (k.startsWith("_") || typeof v !== "number" || k === "photo") continue;
    if (!range[k]) continue;
    if (v < range[k].min || v > range[k].max) bad.push(`${where}.${k} = ${v} (${range[k].min}..${range[k].max})`);
  }};
  check("default", tuning.default);
  for (const [n, b] of Object.entries(tuning.beers)) check(n, b);
  assert.deepEqual(bad, []);
});

test("the hex settings in beers.json are colours", () => {
  const bad = [];
  for (const [where, e] of [["default", tuning.default], ...Object.entries(tuning.beers)])
    for (const k of HEX) if (k in e && !/^#[0-9a-f]{6}$/i.test(e[k])) bad.push(`${where}.${k} = ${e[k]}`);
  assert.deepEqual(bad, []);
});

test("every beer in beers.json is on the card", () => {
  const onCard = new Set(BEERS);
  assert.deepEqual(Object.keys(tuning.beers).filter(n => !onCard.has(n)), []);
});

test("BEERS and the label images in beers/ are the same list", () => {
  assert.ok(IMAGE_EXT, "could not read the label file type from page.js");
  assert.equal(new Set(BEERS).size, BEERS.length, "a beer is listed twice");
  const files = readdirSync(join(root, "beers"));
  const stems = files.filter(f => extname(f) === IMAGE_EXT).map(f => basename(f, IMAGE_EXT));
  assert.deepEqual(BEERS.filter(b => !stems.includes(b)), [], `listed, with no ${IMAGE_EXT} file`);
  assert.deepEqual(stems.filter(s => !BEERS.includes(s)), [], `a ${IMAGE_EXT} file, not listed`);
  assert.deepEqual(files.filter(f => extname(f) !== IMAGE_EXT), [], "files in beers/ that are not label images");
});
