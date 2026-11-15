// build.mjs: the comment scanners, and a whole build in a scratch copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { root, srcDir } from "./helpers/sim.mjs";
import { stripJs, stripCss } from "../build.mjs";

/* ---- stripJs -------------------------------------------------------------- */
test("stripJs takes out both kinds of comment and leaves the code", () => {
  assert.equal(stripJs("a = 1; // note\nb = 2; /* more */ c = 3;\n"), "a = 1;\nb = 2; c = 3;\n");
  assert.equal(stripJs("// whole line\nx();\n"), "x();\n");
  assert.equal(stripJs("x();\n/* block\n   over lines */\ny();\n"), "x();\ny();\n");
});

test("stripJs leaves // and /* inside strings alone", () => {
  for (const code of [
    `u = "http://example.com/a";\n`,
    `u = 'a // b /* c */ d';\n`,
    `u = "say \\"//\\" now";\n`,
    `u = '\\'/*';\n`
  ]) assert.equal(stripJs(code + "// gone\n"), code);
});

test("stripJs leaves comment markers in ordinary template literals alone", () => {
  const t = "t = `a // not a comment /* nor this */ ${ x /* but this is */ + `inner // text ${ y } more` } end`;\n";
  const want = "t = `a // not a comment /* nor this */ ${ x + `inner // text ${ y } more` } end`;\n";
  assert.equal(stripJs(t), want);
  // after the template closes, comments are comments again
  assert.equal(stripJs("t = `${a}`; // c\nz();\n"), "t = `${a}`;\nz();\n");
  // braces in code inside ${ } do not end it early
  assert.equal(stripJs("t = `${ {a:1}.a } // keep`; // drop\n"), "t = `${ {a:1}.a } // keep`;\n");
});

test("stripJs tells a regular expression from a division", () => {
  const keep = [
    "x = /\\/\\//.test(s);\n",          // a regex made of escaped slashes
    "x = /[/]/g;\n",                    // a slash inside a class
    "return /\\/*/g;\n",
    "if (a) /re\\/x/.test(b);\n",
    "x = a / b / c;\n",
    "x = (a + b) / 2 / 3;\n",
    "x = arr[0] / 2;\n",
    "x = typeof /x/;\n"
  ];
  for (const k of keep) assert.equal(stripJs(k + "// c\n"), k, k);
  // division, then a real comment
  assert.equal(stripJs("x = a / b; // c\n"), "x = a / b;\n");
  assert.equal(stripJs("x = a / b // c\n"), "x = a / b\n");
  assert.equal(stripJs("x = a /* c */ / b;\n"), "x = a / b;\n");
});

test("stripJs takes out comments inside GLSL only when it is told the file is a shader", () => {
  const glsl = "const FS_MAIN = `#version 300 es\n// the colour\nvoid main(){ /* gone */ c = vec4(1); // x\n}`;\n";
  const plain = "const NOTE = `#not shader\n// kept\nbody`;\n";
  assert.equal(stripJs(glsl, false), glsl, "not a shader file: left as it is");
  const out = stripJs(glsl, true);
  assert.ok(!out.includes("the colour") && !out.includes("gone") && !out.includes("// x"), out);
  assert.ok(out.includes("void main(){") && out.includes("c = vec4(1);"), out);
  assert.equal(stripJs(plain, true), plain, "a template that is not shader source is text");
  // by name: GLSL_, VS_ and FS_ constants
  for (const name of ["GLSL_A", "VS_B", "FS_C"]){
    const src = `const ${name} = \`x\n// c\ny\`;\n`;
    assert.equal(stripJs(src, true), `const ${name} = \`x\ny\`;\n`, name);
  }
  // and in a hole of a shader template, the code is code
  assert.equal(stripJs("const FS_A = `a ${ f(1) /* c */ } b // d\n`;\n", true), "const FS_A = `a ${ f(1) } b\n`;\n");
});

test("stripJs refuses a ${ or a backtick in a GLSL comment", () => {
  assert.throws(() => stripJs("const FS_A = `x // uses ${n} here\ny`;\n", true), /holds \$\{ or a backtick/);
  assert.throws(() => stripJs("const FS_A = `x // a ` b\ny`;\n", true), /holds \$\{ or a backtick/);
  // in a file that is not a shader the same text is only text
  assert.doesNotThrow(() => stripJs("const FS_A = `x // uses ${n} here\ny`;\n", false));
});

test("stripJs reports what it cannot read", () => {
  assert.throws(() => stripJs("x = 1; /* never closed"), /unterminated \/\* comment/);
  assert.throws(() => stripJs("x = 'open\n"), /unterminated string/);
  assert.throws(() => stripJs("t = `open"), /unterminated template/);
  assert.throws(() => stripJs("if (a) {"), /unbalanced braces/);
});

test("stripJs does not join the lines either side of a comment", () => {
  assert.equal(stripJs("a\n/* c */\nb\n"), "a\nb\n");
  assert.equal(stripJs("return /* c\n */ x;\n"), "return\n x;\n", "a comment holding a newline keeps one");
  assert.equal(stripJs("x = a/* c */b;\n"), "x = a b;\n");
});

test("stripJs on every script in src/ gives a script that still parses", () => {
  for (const file of walk(srcDir).filter(f => f.endsWith(".js"))){
    const rel = file.slice(srcDir.length + 1);
    const text = readFileSync(file, "utf8");
    const out = stripJs(text, rel.startsWith("shader/"));
    assert.doesNotThrow(() => new vm.Script(out, { filename: rel }), rel);
    assert.ok(out.length <= text.length, rel);
  }
});

/* ---- stripCss ------------------------------------------------------------- */
test("stripCss takes out comments and keeps strings that look like them", () => {
  assert.equal(stripCss("a{color:red} /* note */\nb{x:1}\n"), "a{color:red}\nb{x:1}\n");
  assert.equal(stripCss("/* top */\na{}\n"), "a{}\n");
  assert.equal(stripCss('a{content:"/* kept */"}\n'), 'a{content:"/* kept */"}\n');
  assert.equal(stripCss("a{background:url('//cdn/x.png')} /* c */\n"), "a{background:url('//cdn/x.png')}\n");
  assert.equal(stripCss("a{b:c}\n// not a css comment\n"), "a{b:c}\n// not a css comment\n");
  assert.throws(() => stripCss("a{} /* open"), /unterminated/);
});

test("stripCss on every stylesheet in src/ leaves balanced braces", () => {
  for (const file of walk(srcDir).filter(f => f.endsWith(".css"))){
    const out = stripCss(readFileSync(file, "utf8"));
    const open = (out.match(/\{/g) || []).length, close = (out.match(/\}/g) || []).length;
    assert.equal(open, close, file);
    assert.ok(!/\/\*/.test(out.replace(/(["'])(?:\\.|(?!\1).)*\1/g, "")), file + " still holds a comment");
  }
});

function walk(dir){
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/* ---- A whole build -------------------------------------------------------- */
/* build.mjs writes into dist/ beside itself, so it is built from a copy in a
   scratch directory and the real dist/ is never touched. */
function scratchBuild(...args){
  const dir = mkdtempSync(join(tmpdir(), "sakamichi-build-"));
  for (const f of ["build.mjs", "beers.json"]) cpSync(join(root, f), join(dir, f));
  cpSync(srcDir, join(dir, "src"), { recursive: true });
  cpSync(join(root, "beers"), join(dir, "beers"), { recursive: true });
  const log = execFileSync(process.execPath, ["build.mjs", ...args], { cwd: dir, encoding: "utf8" });
  return { dir, log };
}

/* The inline scripts of a built page, as the browser would run them */
function scripts(html){
  const out = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) out.push({ attrs: m[1], body: m[2] });
  return out;
}

for (const args of [[], ["--no-strip"]]){
  test(`a build${args.length ? " " + args[0] : ""} succeeds and each page is whole`, () => {
    const { dir, log } = scratchBuild(...args);
    try {
      assert.match(log, /built index\.html, canvas\.html/);
      for (const page of ["index.html", "canvas.html"]){
        const html = readFileSync(join(dir, "dist", page), "utf8");
        assert.ok(/^<!doctype html>/i.test(html), page + " should open with a doctype");
        assert.doesNotMatch(html, /<!-- @\w+/, page + " has an unhandled directive");
        assert.doesNotMatch(html, /<!--#/, page + " has a build-only note");
        assert.doesNotMatch(html, /\{\{\w+\}\}/, page + " has an unfilled {{key}}");
        // @if sections: each page keeps only its own renderer's, which the
        // shader's GLSL tells apart
        assert.equal(html.includes("#version 300 es"), page === "index.html", page);
        const found = scripts(html);
        assert.ok(found.length >= 5, page + " should carry its scripts");
        for (const [i, sc] of found.entries()){
          if (/type="application\/json"/.test(sc.attrs)) JSON.parse(sc.body);
          else assert.doesNotThrow(() => new vm.Script(sc.body, { filename: `${page} script ${i}` }), `${page} script ${i}`);
        }
        if (!args.length){
          // the comments are gone from the built scripts
          const code = found.filter(s => !/json/.test(s.attrs)).map(s => s.body).join("\n");
          assert.doesNotMatch(code, /^\s*\/\*\s/m, page + " still has a block comment at a line start");
        }
      }
      // the beers are carried beside the pages and inside them
      assert.ok(existsSync(join(dir, "dist", "beers.json")));
      assert.ok(existsSync(join(dir, "dist", "beers")));
      const embedded = scripts(readFileSync(join(dir, "dist", "index.html"), "utf8")).find(s => /id="beerTuning"/.test(s.attrs));
      assert.deepEqual(JSON.parse(embedded.body), JSON.parse(readFileSync(join(root, "beers.json"), "utf8")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("a build stops, and writes nothing, when a source file holds a closing script tag", () => {
  const dir = mkdtempSync(join(tmpdir(), "sakamichi-build-"));
  try {
    for (const f of ["build.mjs", "beers.json"]) cpSync(join(root, f), join(dir, f));
    cpSync(srcDir, join(dir, "src"), { recursive: true });
    cpSync(join(root, "beers"), join(dir, "beers"), { recursive: true });
    const js = join(dir, "src", "splash.js");
    cpSync(js, js + ".orig");
    execFileSync(process.execPath, ["-e", `require("fs").appendFileSync(${JSON.stringify(js)}, "\\nconst x = '</script>';\\n")`]);
    assert.throws(() => execFileSync(process.execPath, ["build.mjs"], { cwd: dir, stdio: "pipe" }), /closing <\/script>/);
    assert.ok(!existsSync(join(dir, "dist")), "a failed build must not leave a dist/");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
