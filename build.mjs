// Builds the site into dist/: one page per renderer from src/page.html, each
// a single file with its styles and scripts inlined, and beside them the beer
// list and the label art the card shows.
//
//   node build.mjs           build once
//   node build.mjs --watch   build, then again whenever src/ or the beers change
//
// No dependencies: Node 18 or later.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const out = join(root, "dist");

/* Each page, and what the template is told about it */
const PAGES = [
  {
    file: "index.html",
    renderer: "canvas",
    title: "Sakamichi Brewing",
    description: "Splash page for a small-batch lager brewery: a pint glass that pours itself, foams, and can be sloshed with the pointer."
  },
  {
    file: "webgl.html",
    renderer: "shader",
    title: "Sakamichi Brewing Shader",
    description: "The Sakamichi pint rendered with WebGL2: Beer-Lambert absorption, caustics and metaball foam."
  }
];

/* Copied across as they are */
const ASSETS = ["beers.json", "beers"];

/* The template language, which is all of four things, done in this order so
   nothing in an inlined file is ever read as a directive:
     <!--# note -->                   left out
     <!-- @if name --> ... <!-- @end -->  kept only for the renderer named
     {{key}}                          the page's own value
     <!-- @inline path -->            the file at src/path */
function renderPage(page){
  let html = readFileSync(join(src, "page.html"), "utf8");
  html = html.replace(/<!--#[\s\S]*?-->\n?/g, "");
  html = html.replace(/<!-- @if (\w+) -->\n([\s\S]*?)<!-- @end -->\n/g,
                      (_, name, body) => name === page.renderer ? body : "");
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in page)) throw new Error(`page.html asks for {{${key}}}, which ${page.file} does not give`);
    return page[key];
  });
  html = html.replace(/<!-- @inline (\S+) -->\n/g, (_, path) => {
    const text = readFileSync(join(src, path), "utf8");
    /* The browser ends a script or style at the first closing tag it meets,
       wherever that is, so a file carrying one would cut the page short */
    if (/<\/(script|style)/i.test(text)) throw new Error(`${path} contains a closing </script> or </style> tag`);
    return text.endsWith("\n") ? text : text + "\n";
  });
  const left = html.match(/<!-- @\w+[^>]*-->|\{\{\w+\}\}/);
  if (left) throw new Error(`${page.file}: nothing handled ${left[0]}`);
  return html;
}

function build(){
  const t0 = Date.now();
  const pages = PAGES.map(p => [p.file, renderPage(p)]);   /* all or nothing */
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [file, html] of pages) writeFileSync(join(out, file), html);
  for (const a of ASSETS) cpSync(join(root, a), join(out, a), { recursive: true });
  console.log(`built ${pages.map(p => p[0]).join(", ")} into dist/ in ${Date.now() - t0} ms`);
}

build();

if (process.argv.includes("--watch")){
  let timer = 0;
  const again = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 80);
  };
  for (const w of ["src", "beers", "beers.json"]) watch(join(root, w), { recursive: true }, again);
  console.log("watching src/ and the beers for changes");
}
