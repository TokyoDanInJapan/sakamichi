// Builds the site into dist/: one page per renderer from src/page.html, each
// a single file with its styles and scripts inlined, and beside them the beer
// list and the label art the card shows.
//
//   node build.mjs           build once
//   node build.mjs --watch   build, then again whenever src/ or the beers change
//   node build.mjs --no-strip  leave the comments in the inlined scripts and styles
//                              (for reading the built page in the browser's tools)
//
// No dependencies: Node 18 or later.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const out = join(root, "dist");
const strip = !process.argv.includes("--no-strip");

/* Said once at the top of each built page, as the source files' own notices
   are comments and are left out of it */
const NOTICE = "<!-- Sakamichi splash page. Code under the MIT licence (see LICENSE); the brand, logo and label art are not covered (see NOTICE). -->\n";

/* ---- Comments ----------------------------------------------------------
   The inlined scripts and styles are mostly explanation, which the reader of
   the source wants and the visitor to the page does not. These two scanners
   take the comments out and nothing else: no renaming, no squeezing of
   whitespace beyond the line a comment leaves empty.

   They are scanners, not patterns, because a comment marker means nothing
   inside a string, a template literal or a regular expression, and "//" is in
   every URL. The JS one follows strings, templates (with their nested
   ${ ... } code) and regular expressions, which it tells from division by the
   token before the slash. Inside a template literal it takes comments out
   only for shader source, in files under shader/: a literal assigned to a
   GLSL_*, VS_* or FS_* constant, or one that opens with "#version 300 es".
   Any other template is text the page may use as it stands. */

const WORD = /[A-Za-z0-9_$\u0080-￿]/;
/* a word after which a slash starts a regular expression, not a division */
const BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete",
                              "void", "throw", "case", "do", "else", "yield", "await"]);

function makeStripper(text){
  let out = "";
  let i = 0;
  const st = {
    get out(){ return out; },
    get i(){ return i; },
    set i(v){ i = v; },
    get done(){ return i >= text.length; },
    text,
    copy(n = 1){ out += text.slice(i, i + n); i += n; },
    /* Drops text[i, end), a comment. A comment alone on its lines goes with
       its newline, and a run of blank lines it leaves behind becomes one; one
       after code goes with the space before it; one in the middle of a line
       leaves a space, or a newline if it held one, which can end a statement. */
    drop(end){
      const comment = text.slice(i, end);
      const trimmed = out.replace(/[ \t]+$/, "");
      const rest = /^[ \t]*(?:\r?\n|$)/.exec(text.slice(end));
      const lineStart = trimmed === "" || trimmed.endsWith("\n");
      if (lineStart && rest){
        out = trimmed;
        i = end + rest[0].length;
        if (out === "" || out.endsWith("\n\n")){
          let b;
          while ((b = /^[ \t]*\r?\n/.exec(text.slice(i)))) i += b[0].length;
        }
        return;
      }
      i = end;
      if (rest){ out = trimmed; return; }
      out = trimmed;
      if (comment.includes("\n")) out += "\n";
      else if (out !== "" && !/\s$/.test(out) && !/^\s/.test(text.slice(end, end + 1))) out += " ";
    }
  };
  return st;
}

/* A comment at text[i], "//" or "/*", ends where? */
function commentEnd(text, i){
  if (text[i + 1] === "/"){
    const nl = text.indexOf("\n", i);
    return nl === -1 ? text.length : nl;
  }
  const close = text.indexOf("*/", i + 2);
  if (close === -1) throw new Error("unterminated /* comment");
  return close + 2;
}

export function stripJs(text, shader = false){
  const s = makeStripper(text);
  /* "{" for a block or object, or the template's own flag for a "${" */
  const stack = [];
  let regexOk = true;       /* may a slash here start a regular expression? */

  /* From just inside a template literal, or just after a "}" that closed one
     of its ${ } holes, to the closing backtick or the next "${" */
  const template = glsl => {
    while (!s.done){
      const c = text[s.i];
      if (c === "\\"){ s.copy(2); continue; }
      if (c === "`"){ s.copy(); regexOk = false; return; }
      if (c === "$" && text[s.i + 1] === "{"){
        s.copy(2); stack.push({ glsl }); regexOk = true; return;
      }
      if (glsl && c === "/" && (text[s.i + 1] === "/" || text[s.i + 1] === "*")){
        const end = commentEnd(text, s.i);
        const body = text.slice(s.i, end);
        /* the same text with a comment in it would have been interpolated or have ended the literal */
        if (body.includes("${") || body.includes("`")) throw new Error("template literal comment holds ${ or a backtick: " + body.slice(0, 40));
        s.drop(end);
        continue;
      }
      s.copy();
    }
    throw new Error("unterminated template literal");
  };

  while (!s.done){
    const c = text[s.i];
    if (c === "/" && (text[s.i + 1] === "/" || text[s.i + 1] === "*")){
      s.drop(commentEnd(text, s.i));
    } else if (c === "/" && regexOk){
      let j = s.i + 1, inClass = false;
      for (;; j++){
        const d = text[j];
        if (d === undefined || d === "\n") throw new Error("regular expression runs off its line: " + text.slice(s.i, s.i + 40));
        if (d === "\\") j++;
        else if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
      }
      s.copy(j + 1 - s.i);
      while (WORD.test(text[s.i] || " ")) s.copy();    /* flags */
      regexOk = false;
    } else if (c === '"' || c === "'"){
      let j = s.i + 1;
      while (text[j] !== c){
        if (text[j] === undefined || text[j] === "\n") throw new Error("unterminated string: " + text.slice(s.i, s.i + 40));
        j += text[j] === "\\" ? 2 : 1;
      }
      s.copy(j + 1 - s.i);
      regexOk = false;
    } else if (c === "`"){
      const glsl = shader && (/\b(?:GLSL|VS|FS)_\w+\s*=\s*$/.test(s.out.slice(-80)) ||
                              text.startsWith("#version 300 es", s.i + 1));
      s.copy();
      template(glsl);
    } else if (c === "{"){
      s.copy(); stack.push(null); regexOk = true;
    } else if (c === "}"){
      s.copy();
      const top = stack.pop();
      if (top) template(top.glsl); else regexOk = true;
    } else if (WORD.test(c)){
      let j = s.i;
      while (WORD.test(text[j] || " ")) j++;
      const word = text.slice(s.i, j);
      s.copy(j - s.i);
      regexOk = BEFORE_REGEX.has(word);
    } else if (/\s/.test(c)){
      s.copy();
    } else {
      s.copy();
      regexOk = !(c === ")" || c === "]");
    }
  }
  if (stack.length) throw new Error("unbalanced braces");
  return s.out;
}

export function stripCss(text){
  const s = makeStripper(text);
  while (!s.done){
    const c = text[s.i];
    if (c === "/" && text[s.i + 1] === "*"){
      s.drop(commentEnd(text, s.i));
    } else if (c === '"' || c === "'"){
      let j = s.i + 1;
      while (text[j] !== c){
        if (text[j] === undefined) throw new Error("unterminated string in css");
        j += text[j] === "\\" ? 2 : 1;
      }
      s.copy(j + 1 - s.i);
    } else {
      s.copy();
    }
  }
  return s.out;
}

/* Each page, and what the template is told about it */
const PAGES = [
  {
    file: "index.html",
    renderer: "shader",
    title: "Sakamichi Brewing",
    description: "Splash page for a small-batch lager brewery: a pint glass that pours itself, foams, and can be sloshed with the pointer."
  },
  {
    file: "canvas.html",
    renderer: "canvas",
    title: "Sakamichi Brewing Canvas",
    description: "The Sakamichi pint drawn with Canvas 2D, for browsers without WebGL2."
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
  /* the page's own comments, ahead of the inlining so that nothing inlined is touched */
  if (strip) html = html.replace(/[ \t]*<!--(?! @)[\s\S]*?-->[ \t]*\n?/g, "");
  html = html.replace(/^(<!doctype html>\n)/i, "$1" + NOTICE);
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
    const body = !strip ? text
               : path.endsWith(".js")  ? stripJs(text, path.startsWith("shader/"))
               : path.endsWith(".css") ? stripCss(text)
               : text;
    return body.endsWith("\n") ? body : body + "\n";
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

function main(){
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
}

/* Run directly it builds; imported, it only offers the two scanners */
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
