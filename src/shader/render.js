(() => {
"use strict";
/* ================================================================== *
 * GL context
 * ================================================================== */
const stage = document.getElementById("stage");
const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl2", {alpha:false, antialias:false, depth:false, stencil:false, powerPreference:"high-performance"});
const cvS = document.querySelector(".splash");
const ctxS = cvS.getContext("2d");

/* Without WebGL2 the canvas page takes over, with the same query and hash. The
   notice and its link stay on show in case the browser does not follow. */
if (!gl){
  document.body.dataset.gl = "off";
  location.replace("canvas.html" + location.search + location.hash);
  return;
}

/* On context loss every program, texture and buffer is gone, and all of them
   are built once at the top. So the page reloads when the context is restored.
   Settings are saved as they change, so it comes back as it was. */
let contextLost = false;
canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); contextLost = true; });
canvas.addEventListener("webglcontextrestored", () => location.reload());

const dbg = gl.getExtension("WEBGL_debug_renderer_info");
if (dbg){
  const name = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
  if (name) document.getElementById("gpu").textContent = "WebGL2 · " + String(name).replace(/\(.*?\)/g, "").trim().slice(0, 22);
}

function compile(type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    const log = gl.getShaderInfoLog(sh);
    console.error("shader compile failed:", log);
    throw new Error("shader compile failed: " + log);
  }
  return sh;
}

function program(vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link failed: " + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++){
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace("[0]","")] = gl.getUniformLocation(p, info.name);
  }
  return {p, u};
}

/* A simulation constant written as a GLSL float. The shaders take the JS
   constants (BAR_DEPTH, HEAD_LIFT, RIM_INNER and the rest) so the two cannot drift. */
const glf = v => {
  const s = String(v);
  return /[.e]/.test(s) ? s : s + ".0";
};
/* How strongly the house mark shows on the wall and through the beer, once
   its bitmap has arrived */
const LOGO_ON = 0.075;

/* The glass, the surface and the pixel frame, shared by every pass */
const GLSL_GLASS = `
uniform sampler2D uHeight;
uniform float uCols, uRestY, uDpr, uSpanHw;
uniform vec2  uRes;
uniform vec2  uRyKs;     // ellipse openness: x at the surface, y at the base
uniform vec4  uGlassA;   // cx, top, bottom, height
uniform vec4  uGlassB;   // topHalf, botHalf, wall, baseH
uniform vec4  uGlassC;   // (unused), interiorTop, interiorBottom, rimRatio
uniform vec2  uRyLin;    // ellipse openness as a line in y: slope, intercept

#define GCX     uGlassA.x
#define GTOP    uGlassA.y
#define GBOT    uGlassA.z
#define GHT     uGlassA.w
#define GTH     uGlassB.x
#define GBH     uGlassB.y
#define GWALL   uGlassB.z
#define GBASE   uGlassB.w
#define GINTOP  uGlassC.y
#define GINBOT  uGlassC.z
#define GRYK    uGlassC.w

vec2 fragPx(){ return vec2(gl_FragCoord.x / uDpr, uRes.y - gl_FragCoord.y / uDpr); }

float halfAt(float y){
  /* Straight tapered walls; the base ellipse supplies the bottom curve */
  float t = clamp((y - GTOP) / GHT, 0.0, 1.0);
  return max(1.0, mix(GTH, GBH, t));
}
float innerHalfAt(float y){ return max(1.0, halfAt(y) - GWALL); }

/* Ellipse openness at height y: the camera's rule, a line in y. uRyKs holds it
   at the surface and the base only, so use this for anything between. */
float ryAt(float y){ return clamp(y * uRyLin.x + uRyLin.y, ${glf(RY_MIN)}, ${glf(RY_MAX)}); }

/* A point on the outside of the glass: how far round it sits, and how high.
   The near wall drops lower and faces us square, the far wall rides higher. */
vec2 conePoint(float h, float th){
  float hw = halfAt(h);
  return vec2(GCX + hw * sin(th), h + ryAt(h) * hw * cos(th));
}

float colAt(float x){ return (x - (GCX - uSpanHw)) / (2.0 * uSpanHw) * max(1.0, uCols - 1.0); }
vec2 heightTexel(float tc, int row){
  return textureLod(uHeight, vec2((tc + 0.5) / float(textureSize(uHeight, 0).x),
                                  (float(row) + 0.5) * 0.5), 0.0).rg;
}
float heightRow(float x, int row){
  float last = max(1.0, uCols - 1.0);
  float t = colAt(x);
  /* Past the ends the surface carries on at the end pair's slope, a few columns
     only. On a hard tilt the wall stands up to three columns beyond the span, and
     clamping there left a flat-topped wedge of beer against it. */
  float tc = clamp(t, 0.0, last);
  vec2 hs = heightTexel(tc, row);
  return hs.x + hs.y * clamp(t - tc, -4.0, 4.0);
}
float heightAt(float x){ return heightRow(x, 0); }
/* and the head's own raft, on row 1 */
float headHeightAt(float x){ return heightRow(x, 1); }
float surfaceAt(float x){ return uRestY + heightAt(x); }
float headSurfaceAt(float x){ return uRestY + headHeightAt(x); }
float slopeAt(float x){
  float last = max(1.0, uCols - 1.0);
  return heightTexel(clamp(colAt(x), 0.0, last), 0).y * last / (2.0 * uSpanHw);
}
float ellipseDy(float x){
  float t = (x - GCX) / uSpanHw;
  if (abs(t) >= 1.0) return 0.0;
  return uRyKs.x * uSpanHw * sqrt(1.0 - t * t);
}
`;

const GLSL_NOISE = `
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x),
             mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y);
}
/* Interleaved gradient noise: neighbouring pixels get well spread values, so
   a tap pattern turned by it reads as fine grain rather than as copies */
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
/* Tap i of n spread evenly over a unit disc, turned by phi */
vec2 vogel(int i, int n, float phi){
  float th = float(i) * 2.39996323 + phi;
  return sqrt((float(i) + 0.5) / float(n)) * vec2(cos(th), sin(th));
}
`;

const GLSL_LOGO = `
uniform sampler2D uLogo;
uniform vec4  uLogoRect;      // x, y, w, h in page px
uniform float uLogoOn;
float logoA(vec2 p){
  vec2 uv = (p - uLogoRect.xy) / max(uLogoRect.zw, vec2(1.0));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture(uLogo, uv).a;
}
`;

/* The head's cap and its top, shared by the head and the glass. The cap is
   headCapY in the simulation (surface.js), with no extra lift, and is built
   from the same HEAD_LIFT and HEAD_MOUND. Needs GLSL_GLASS before it. */
const GLSL_HEAD = `
/* The highest the head may stand at x: the rim's own ellipse for the plane of
   the lip, and over it a low mound that holds nearly its height right across
   and turns down only at the walls */
float headCap(float x, float lipCy, float rry){
  float cu    = clamp((x - GCX) / max(1.0, innerHalfAt(lipCy)), -1.0, 1.0);
  float disc  = sqrt(max(0.0, 1.0 - cu * cu));
  float mound = sqrt(max(0.0, 1.0 - pow(abs(cu), ${glf(HEAD_MOUND)})));
  return lipCy - rry * ${glf(HEAD_LIFT)} * mound - rry * disc;
}
/* The head's top at a column: the far edge of the beer less the head's band, or
   the crown over the lip, whichever is higher. Takes x so that a neighbouring
   column can be asked for (see the slope in FS_FOAM). */
float headTopAt(float x, float lipCy, float rry, float bandPx){
  return max(headSurfaceAt(x) - ellipseDy(x) - bandPx, headCap(x, lipCy, rry));
}
`;

const VS_FULL = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/* ------------------------------------------------------------------ *
 * Pass 1 — the beer (A), then the room (B)
 * ------------------------------------------------------------------ */
/* Pass A — the pour and nothing else, premultiplied over a clear ground, so
   the whole dressed glass ends up in one texture the reflection can sample */
const GLSL_CONTACT = `
/* Where the head's near edge meets the beer, as an offset from the level arc.
   The line is not ruled: it wanders by less than a bubble and climbs the glass
   a little at the wall. Fixed to the glass, in house px. The foam and the beer
   under it both read it, so the shadow follows the edge. */
float contactWander(vec2 px){
  float wallGap = max(0.0, innerHalfAt(px.y) - abs(px.x - GCX));
  return uScale * (1.6 * (vnoise(vec2((px.x - GCX) / uScale * 0.30, 7.0)) - 0.5)
                 + 0.8 * (vnoise(vec2((px.x - GCX) / uScale * 0.95, 3.0)) - 0.5)
                 - 1.6 * exp(-wallGap / (2.5 * uScale)));
}
`;

const FS_BEER = `#version 300 es
precision highp float;
${GLSL_GLASS}
${GLSL_NOISE}
${GLSL_LOGO}
uniform sampler2D uField;
uniform float uTime, uCaustics, uLevel, uHaze, uBeerA, uBeerSolid;
uniform float uScale;        // G.scale: page px per px of the house-sized glass
uniform float uLightX;       // cos of the light angle: which side the light is on
uniform vec3  uLightTint, uAbsorb;
out vec4 frag;
${GLSL_CONTACT}


/* The pour and its coverage. For its reflection it is mirrored about its
   own contact with the bar, not the wall's horizon. */
vec4 beerAt(vec2 px){
  float ih = innerHalfAt(px.y);
  float surf = surfaceAt(px.x), edy = ellipseDy(px.x);
  float top = surf - edy;
  /* The beer sits on the interior floor, whose front arc dips below GINBOT */
  float ihb = innerHalfAt(GINBOT);
  float fxn = clamp((px.x - GCX) / max(ihb, 1.0), -1.0, 1.0);
  float floorY = GINBOT + uRyKs.y * ihb * sqrt(1.0 - fxn * fxn);
  bool inWalls = abs(px.x - GCX) < ih && px.y < floorY + 1.5 && px.y > GTOP;

  if (inWalls && uLevel > 0.002 && px.y > top - 1.5){
    float d = max(px.y - top, 0.0);
    float dh = d / uScale;                       /* in house px */
    float nx = (px.x - GCX) / max(ih, 1.0);

    /* Beer-Lambert along the line of sight, through the chord of the cylinder
       here: longest in the middle, shorter at the walls and down the narrowing
       glass. Refraction keeps the chord open at the wall (the 0.82). The depth
       term is light that came down through the head. In house px, so glass size
       does not change the colour. buildPalette calibrates uAbsorb to this. */
    float chord = 2.0 * ih / uScale * sqrt(max(0.0, 1.0 - 0.82 * nx * nx));
    float path  = chord * (0.62 + 0.38 * (1.0 - exp(-dh / 70.0)));
    vec3 through = exp(-uAbsorb * path * 0.0016);     /* half the path */
    vec3 beer = uLightTint * through * through;

    /* Haze: yeast scatters light out before it is absorbed. That light has
       travelled about half as far, so it uses half the path. */
    vec3 scat = uLightTint * (0.38 + 0.50 * exp(-dh * 0.005)) * through;
    beer = mix(beer, scat, uHaze * 0.60);

    float murk = vnoise(vec2(px.x * 0.016, px.y * 0.011 - uTime * 0.04))
               + vnoise(vec2(px.x * 0.050 + 9.0, px.y * 0.034 - uTime * 0.09)) * 0.5;
    beer *= 1.0 + (murk * 0.667 - 0.5) * 0.06 * uHaze;

    /* One broad lift on the side the light comes from, so the body has a
       direction of light and is not an even fill. It is nought on the axis, so
       the palette's calibration there holds. */
    float lc = 0.6 * clamp(uLightX, -1.0, 1.0);
    float lq = (nx - lc) / 0.65, l0 = lc / 0.65;
    beer *= 1.0 + (exp(-lq * lq) - exp(-l0 * l0)) * mix(0.22, 0.09, uHaze);
    /* Light let through the core, gathering towards the base. Scaled by how
       much the beer lets through, so a pale beer glows and a stout does not. */
    float cy = clamp((px.y - surf) / max(floorY - surf, 1.0), 0.0, 1.0);
    float core = 1.0 - nx * nx;
    beer *= 1.0 + 0.14 * core * core * (0.3 + 0.7 * cy * cy)
                * dot(through * through, vec3(0.2126, 0.7152, 0.0722));

    /* Caustics only where the surface is actually disturbed — and haze kills them */
    float sl = slopeAt(px.x);
    float curv = heightAt(px.x - 5.0) - 2.0 * (surf - uRestY) + heightAt(px.x + 5.0);
    float stir = clamp(abs(sl) * 5.0 + abs(curv) * 0.45, 0.0, 1.4);
    float bend = px.x + sl * d * 2.2;
    float c = (0.5 + 0.5 * cos(bend * 0.048 + uTime * 0.7))
            * (0.55 + 0.45 * (0.5 + 0.5 * cos(bend * 0.015 - uTime * 0.35)));
    c = pow(c, 3.0) * stir + max(0.0, -curv) * 0.03;
    beer += beer * c * uCaustics * (1.0 - uHaze * 0.65) * exp(-d * 0.011);

    /* The mark seen through the pour. It is on the wall behind the bar, so waves
       must not move it (that made it float in the beer); only the cylinder's
       squeeze towards the edges stays. The cylinder is a strong lens and shows
       the wall mirrored. Across the top plane the view is down through the
       surface, so the mark turns over, fading through the turn. Above the far
       arc it is upright, as in wallStill. */
    float front = surf + edy;
    float pl = clamp((front - px.y) / max(1.0, front - top), 0.0, 1.0);
    float turn = mix(-1.0, 1.0, smoothstep(0.35, 0.65, pl));
    float squeeze = turn < 0.0 ? 0.85 + 0.45 * nx * nx : 1.0 - 0.16 * nx * nx;
    vec2 rp = vec2(GCX + turn * nx * ih * squeeze, px.y + 4.0);
    float la = logoA(rp) * step(0.001, uLogoOn) * abs(turn);
    beer *= 1.0 - la * 0.32 * (1.0 - uBeerSolid) * exp(-d * 0.005) * (1.0 - uHaze * 0.85);

    beer += uLightTint * (0.12 + uHaze * 0.12) * exp(-d * 0.022);

    float wallD = ih - abs(px.x - GCX);
    float men = (1.0 - smoothstep(0.4, 2.8, wallD));
    beer += uLightTint * men * (0.08 + 0.46 * exp(-d * 0.03));

    /* The top plane of the beer, seen slightly from above. Its far and near arcs
       meet at the wall, where smoothstep with equal edges is undefined (a lit
       strip up each wall), so the curve is written out. pl is set above. */
    beer = mix(beer, beer * 1.14 + uLightTint * 0.10, pl * pl * (3.0 - 2.0 * pl) * 0.85);

    /* Just inside the wall the ray meets the glass at a grazing angle and is
       reflected away rather than let through: a thin dark line, no more */
    float wq = (wallD - 2.6 * uScale) / (1.4 * uScale);
    beer *= 1.0 - 0.30 * exp(-wq * wq);

    /* Shadow cast by the head */
    float fd = texture(uField, vec2(px.x / uRes.x, 1.0 - (surf + 6.0) / uRes.y)).r;
    beer *= 1.0 - 0.34 * clamp(fd, 0.0, 1.0) * exp(-d * 0.024);
    /* and where the head rests on the beer: a short contact shadow under the
       head's near edge, which is the edge that shows */
    float hfront = headSurfaceAt(px.x) + edy + contactWander(px);
    beer *= 1.0 - 0.09 * clamp(fd * 2.0, 0.0, 1.0) * exp(-max(px.y - hfront, 0.0) / (3.0 * uScale));

    beer += (hash21(px * 1.7 + uTime) - 0.5) * 0.006;
    /* Softened at the floor too: its arc runs almost level, so a hard cut leaves
       a long stepped edge. */
    return vec4(beer, smoothstep(top - 1.2, top + 1.2, px.y)
                    * (1.0 - smoothstep(floorY - 1.2, floorY + 1.2, px.y)));
  }
  return vec4(0.0);
}

void main(){
  vec4 b = beerAt(fragPx());
  /* Premultiplied, so one multiply scales colour and coverage together and the
     background shows through the pour rather than the pour turning pale. */
  frag = vec4(b.rgb * b.a, b.a) * uBeerA;
}`;

/* Pass B, the room, in two programs: FS_ROOM paints what stands still into a
   kept texture, FS_COMPOSE adds the moving light and the pour. */
/* The wall behind the bar as far as it stands still: its ground and the mark
   painted on it. Read by the room pass and by the bake that keeps it. */
const GLSL_WALL = `
uniform float uDark;
uniform float uGlassOn;       // 0 while a card stands in place of the glass
uniform vec3  uGround;
vec3 wallStill(vec2 px){
  vec3 col = uGround;

  /* The house mark painted on the wall. Through the empty glass it bends a
     little, upright. Through the beer it is turned over (FS_BEER), whose mapping
     above the surface matches this one. */
  vec2 lp = px;
  float ihHere = max(innerHalfAt(px.y), 1.0);
  float nxg = (px.x - GCX) / ihHere;
  /* The bend eases in at the silhouette's edges. Switched on across a hard
     boundary it displaces the mark in a step, like a pane above the lip. */
  float bendX = 1.0 - smoothstep(0.80, 1.0, abs(nxg));
  float bendY = smoothstep(GTOP - 1.0, GTOP + GTH * GRYK * 2.2, px.y)
              * (1.0 - smoothstep(GBOT - GBASE * 1.5, GBOT, px.y));
  lp.x = GCX + nxg * ihHere * (1.0 - 0.16 * nxg * nxg * bendX * bendY * uGlassOn);
  vec3 inkT = uDark > 0.5 ? vec3(0.72, 0.75, 0.78) : vec3(0.15, 0.18, 0.22);
  return mix(col, inkT, logoA(lp) * uLogoOn);
}
`;

/* Pass B, kept: what depends only on layout, palette and counter, painted once
   while those hold. Alpha keeps what the streaks, grain and shadow multiply by,
   so FS_COMPOSE can lay the moving light under them. */
const GLSL_FLOOR = `
/* The wall meets the floor behind the glass. A room measure (BAR_DEPTH), so
   resizing the glass cannot warp it. */
float floorHorizon(){ return GBOT + uRyKs.y * GBH - uRes.y * ${glf(BAR_DEPTH)}; }
/* The floor's multiplier is kept in alpha divided by this, so it fits in a
   byte where the room cannot be a float texture */
#define FLOOR_MK 1.25
`;

const FS_ROOM = `#version 300 es
precision highp float;
${GLSL_GLASS}
${GLSL_NOISE}
${GLSL_LOGO}
${GLSL_WALL}
${GLSL_FLOOR}
uniform sampler2D uWood;
uniform vec2 uWoodK;          // tiles across a camera height, and 0 or 1 for on
uniform vec3 uGroundDeep;
out vec4 frag;

const int ROOM_TAPS = 24;

void main(){
  vec2 px = fragPx();
  float horizonY = floorHorizon();
  if (px.y <= horizonY){ frag = vec4(wallStill(px), 0.0); return; }
  float t = px.y - horizonY;
  float bw  = GBH;
  float ryB = uRyKs.y * bw;
  float baseCY = GBOT;                 // the footprint's centre lies IN the plane

  float persp = t / (t + GBH * 1.2);
  vec3 floorCol = uGroundDeep * mix(uDark > 0.5 ? 1.45 : 1.03,
                                    uDark > 0.5 ? 0.60 : 0.93, persp);

  /* Timber in the plane's own coordinates. The plane vanishes where ryAt reads
     zero, the camera the rim and base ellipses use, so the grain runs to their
     vanishing point. Depth goes as one over the distance below that line. A flat
     texture would run parallel to the frame, not away from the eye. */
  if (uWoodK.y > 0.5){
    float yV  = -uRyLin.y / max(abs(uRyLin.x), 1e-6);
    float fL  = 1.0 / max(abs(uRyLin.x), 1e-6);
    float dyP = max(px.y - yV, 1.0);
    vec2 wuv  = vec2((px.x - GCX) / dyP, fL / dyP) * uWoodK.x;
    /* Lit like the bare plane, paler where it recedes and deeper towards the eye,
       so the glass stands on it. */
    floorCol = texture(uWood, wuv).rgb
             * mix(uDark > 0.5 ? 0.72 : 1.00, uDark > 0.5 ? 0.34 : 0.70, persp);
  }

  /* The wall reflects about the wall-floor junction, wandering with the frost and
     blurring as it recedes. The taps are a disc turned per pixel, so the blur is
     fine grain, not copies of the mark, stretched down the floor as a gloss is. */
  vec3 col = floorCol;
  float fadeW = exp(-t / (GHT * 0.26)) * (uDark > 0.5 ? 0.45 : 0.30);
  if (fadeW > 0.001){
    float n = vnoise(vec2(px.x * 0.02, px.y * 0.05));
    vec2 pw = vec2(px.x + (n - 0.5) * t * 0.07, 2.0 * horizonY - px.y);
    float blur = 2.0 + t * 0.16;
    float phi = ign(gl_FragCoord.xy) * 6.2831853;
    vec3 reflW = vec3(0.0);
    for (int i = 0; i < ROOM_TAPS; i++)
      reflW += wallStill(pw + vogel(i, ROOM_TAPS, phi) * vec2(1.0, 1.2) * blur * 1.4);
    col = mix(floorCol, reflW / float(ROOM_TAPS), fadeW);
  }

  float depthT = 1.0 / (t + 18.0);
  float streak = vnoise(vec2(px.x * 0.013, depthT * 2400.0));
  float m = 1.0 + (streak - 0.5) * 0.08 * clamp(t / 40.0, 0.0, 1.0);
  col *= m;

  col += (uDark > 0.5 ? vec3(0.012, 0.013, 0.015) : vec3(0.035, 0.036, 0.038))
       * clamp(t / 60.0, 0.0, 1.0);
  float grain = 1.0 + (hash21(px * 1.31) - 0.5) * 0.02;

  /* Contact shadow and occlusion: ellipses in the plane, sharing its
     eccentricity, wrapping the footprint behind and in front. Also kept in the
     multiplier so the seam survives the light the compose pass pools there. */
  vec2 q = vec2((px.x - GCX) / bw, (px.y - baseCY) / max(ryB, 1.0));
  float rq = length(q);
  float shade = (1.0 - (1.0 - smoothstep(1.0, 3.2, rq)) * (uDark > 0.5 ? 0.55 : 0.30) * uGlassOn)
              * (1.0 - (1.0 - smoothstep(1.0, 1.34, rq)) * (uDark > 0.5 ? 0.62 : 0.42) * uGlassOn);
  col *= grain * shade;
  m *= grain * shade;

  /* dithered, for where this is kept in bytes */
  col += (ign(gl_FragCoord.xy + vec2(7.0, 3.0)) - 0.5) / 255.0;
  frag = vec4(col, m / FLOOR_MK);
}`;

const FS_COMPOSE = `#version 300 es
precision highp float;
${GLSL_GLASS}
${GLSL_NOISE}
${GLSL_FLOOR}
uniform float uDark;
uniform float uReflect;
uniform sampler2D uScene;     // premultiplied, with mips for the reflection
uniform sampler2D uRoom;      // the still part of the room, from FS_ROOM
uniform float uGlow, uLevel;
/* The light the glass throws: the beer's own colour unless set otherwise. */
uniform vec3  uAura;
out vec4 frag;

/* Light from the glass on the wall behind it. It follows the pour, so it is not baked. */
vec3 wallGlow(vec2 px){
  float gy = uRestY + (GINBOT - uRestY) * 0.35;
  float gd = length((px - vec2(GCX, gy)) / vec2(GTH * 3.4, GHT * 1.15));
  return uAura * uGlow * exp(-gd * 2.4) * (0.4 + 0.6 * uDark) * smoothstep(0.02, 0.62, uLevel) * 0.85;
}

const int REFL_TAPS = 8;

void main(){
  vec2 px = fragPx();
  ivec2 fc = ivec2(gl_FragCoord.xy);
  vec4 room = texelFetch(uRoom, fc, 0);
  float horizonY = floorHorizon();

  vec3 col = room.rgb;
  if (px.y <= horizonY){
    col += wallGlow(px);
  } else {
    float t = px.y - horizonY;
    float bw  = GBH;
    float ryB = uRyKs.y * bw;
    float baseCY = GBOT;

    /* The glow, as the floor reflects it. The glow is broad and smooth, so
       one reading does for the blur the wall's reflection is given. */
    float fadeW = exp(-t / (GHT * 0.26)) * (uDark > 0.5 ? 0.45 : 0.30);
    vec3 add = wallGlow(vec2(px.x, 2.0 * horizonY - px.y)) * fadeW;

    vec2 qp = vec2((px.x - GCX) / (bw * 1.25), (px.y - baseCY - ryB * 0.9) / max(ryB * 2.0, 1.0));
    add += uAura * uGlow * exp(-dot(qp, qp) * 2.0) * (0.5 + 0.6 * uDark) * smoothstep(0.02, 0.62, uLevel) * 0.8;

    /* The glass mirrored about its footprint centre, so the reflection starts
       where it touches. It meets the floor along the base ellipse's front arc,
       not a flat line. Read only below that arc, near the glass and while the
       fade has anything left. */
    float nxb = clamp((px.x - GCX) / bw, -1.0, 1.0);
    float footY = baseCY + ryB * sqrt(max(0.0, 1.0 - nxb * nxb));
    float tg = px.y - footY;
    float k = exp(-max(tg, 0.0) / (GHT * 0.30)) * (uDark > 0.5 ? 0.52 : 0.34) * uReflect;
    float blurG = 1.5 + max(tg, 0.0) * 0.16;
    if (tg >= 0.0 && k > 0.002 && abs(px.x - GCX) < GTH * 2.0 + 160.0 + blurG * 2.0){
      float wob = (vnoise(vec2(px.x * 0.02, px.y * 0.05)) - 0.5) * t * 0.07;
      vec2 pg = vec2(px.x + wob, 2.0 * baseCY - px.y);
      /* Taps turned per pixel, each read from a mip as wide as their spacing:
         no copies of the glass and no grain */
      float phi = ign(gl_FragCoord.xy) * 6.2831853;
      float r = blurG * 1.25;
      float lod = log2(max(1.0, r * 0.5 * uDpr));
      vec4 reflB = vec4(0.0);
      for (int i = 0; i < REFL_TAPS; i++){
        vec2 p = pg + vogel(i, REFL_TAPS, phi) * vec2(1.0, 1.2) * r;
        reflB += textureLod(uScene, vec2(p.x, uRes.y - p.y) / uRes, lod);
      }
      reflB /= float(REFL_TAPS);
      col *= 1.0 - clamp(reflB.a, 0.0, 1.0) * k;
      add += reflB.rgb * k;
    }
    col += add * room.a * FLOOR_MK;
  }

  vec4 src = texelFetch(uScene, fc, 0);
  col = col * (1.0 - src.a) + src.rgb;

  /* No horizon line is drawn. The floor there is nearly the wall's tone, so a
     line would be the edge of nothing. */
  /* Half a step of noise, so the glow's long gradients on a dark wall do not
     come out in bands */
  col += (ign(gl_FragCoord.xy + vec2(19.0, 41.0)) - 0.5) / 255.0;
  frag = vec4(col, 1.0);
}`;

/* ------------------------------------------------------------------ *
 * Pass 2 — head density field (half resolution)
 * ------------------------------------------------------------------ */
const FS_BAND = `#version 300 es
precision highp float;
${GLSL_GLASS}
uniform float uBand, uTime;
out vec4 frag;

float bandShape(float x){
  float s = 0.5 + 0.5 * (
    0.45 * sin(x * 0.0104 + uTime * 0.55) +
    0.30 * sin(x * 0.0271 - uTime * 0.85) +
    0.25 * sin(x * 0.0043 + uTime * 0.22));
  float fine = 0.5 + 0.5 * sin(x * 0.083 + uTime * 0.9) * sin(x * 0.031 - uTime * 0.4);
  return 0.80 + 0.30 * s + 0.10 * fine;
}

void main(){
  vec2 px = fragPx();
  if (abs(px.x - GCX) > innerHalfAt(px.y) + 2.0){ frag = vec4(0.0); return; }
  /* both edges of the head are the raft's, not the beer's — see headSurfaceAt */
  float back = headSurfaceAt(px.x) - ellipseDy(px.x);
  float front = headSurfaceAt(px.x) + ellipseDy(px.x);
  float b = uBand * bandShape(px.x);
  float dens = smoothstep(back - b - 2.5, back - b + 2.5, px.y)
             * (1.0 - smoothstep(front + 1.0, front + 7.0, px.y));
  frag = vec4(dens * 0.68, 0.0, 0.0, 1.0);
}`;

const VS_BLOB = `#version 300 es
in vec2 aCorner;
in vec4 aInst;
uniform vec2 uRes;
out vec2 vLocal;
out float vStrength;
void main(){
  vLocal = aCorner;
  vStrength = aInst.w;
  vec2 pos = aInst.xy + aCorner * aInst.z;
  gl_Position = vec4((pos.x / uRes.x) * 2.0 - 1.0, 1.0 - (pos.y / uRes.y) * 2.0, 0.0, 1.0);
}`;

const FS_BLOB = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vStrength;
out vec4 frag;
void main(){
  float d2 = dot(vLocal, vLocal);
  if (d2 > 1.0) discard;
  float f = 1.0 - d2;
  frag = vec4(f * f * f * vStrength, 0.0, 0.0, 1.0);
}`;

/* ------------------------------------------------------------------ *
 * Pass 3 — bubbles, droplets, spray, and beer running down the glass
 * ------------------------------------------------------------------ */
const VS_SPRITE = `#version 300 es
in vec2 aCorner;
in vec4 aInst;              // x, y, radius x, radius y
in vec3 aMeta;              // kind, alpha, how far back (0 near to 1 at the back wall)
uniform vec2 uRes;
out vec2 vLocal;
out vec2 vPx;
out vec2 vRad;
out float vKind, vAlpha, vFar;
void main(){
  vLocal = aCorner;
  vRad = aInst.zw;
  vKind = aMeta.x;
  vAlpha = aMeta.y;
  vFar = aMeta.z;
  vec2 pos = aInst.xy + aCorner * aInst.zw;
  vPx = pos;
  gl_Position = vec4((pos.x / uRes.x) * 2.0 - 1.0, 1.0 - (pos.y / uRes.y) * 2.0, 0.0, 1.0);
}`;

const FS_SPRITE = `#version 300 es
precision highp float;
${GLSL_GLASS}
in vec2 vLocal;
in vec2 vPx;
in vec2 vRad;
in float vKind, vAlpha, vFar;
uniform vec3 uFoam, uBeer;
uniform vec3 uBeerSeen;      // the body's colour through the middle of the glass
out vec4 frag;

void main(){
  float d = length(vLocal);

  if (vKind < 0.5){
    if (d > 1.0) discard;
    if (vPx.y < surfaceAt(vPx.x) + ellipseDy(vPx.x)) discard;
    if (abs(vPx.x - GCX) > innerHalfAt(vPx.y)) discard;
    /* A fine bubble is too small for a ring: a soft bright point, tinted by the
       beer in front of it */
    if (vRad.x < 1.8){
      float pa = 0.55 * (1.0 - smoothstep(0.2, 1.0, d));
      frag = vec4(mix(vec3(1.0), uBeerSeen, 0.30 + 0.55 * vFar), pa * vAlpha * (1.0 - 0.55 * vFar));
      return;
    }
    float e = clamp(2.0 / vRad.x, 0.02, 0.6);
    float outer   = (1.0 - smoothstep(1.0 - e * 1.2, 1.0, d));
    float shell   = (1.0 - smoothstep(1.0 - e * 3.0, 1.0 - e * 1.0, d));
    float inside  = (1.0 - smoothstep(1.0 - e * 5.0, 1.0 - e * 3.0, d));
    float outline = clamp(outer - shell, 0.0, 1.0);
    float rim     = clamp(shell - inside, 0.0, 1.0);
    float pip     = (1.0 - smoothstep(0.0, 0.32, length(vLocal - vec2(-0.30, -0.34))));
    float wRim = rim + pip * 0.45;
    vec3 col = (vec3(1.0) * wRim + uBeer * 0.42 * outline) / max(wRim + outline, 0.0001);
    /* A bubble at the back of the glass is seen through the beer in front of
       it: dimmer, and coloured by it */
    col = mix(col, uBeerSeen, vFar * 0.55);
    frag = vec4(col, clamp(rim * 0.7 + outline * 0.55 + pip * 0.28 + inside * 0.05, 0.0, 1.0)
                     * vAlpha * (1.0 - vFar * 0.45));
  } else if (vKind < 1.5){
    if (d > 1.0) discard;
    float e = clamp(2.0 / vRad.x, 0.02, 0.6);
    float body = (1.0 - smoothstep(1.0 - e * 2.0, 1.0, d));
    float pip  = (1.0 - smoothstep(0.02, 0.36, length(vLocal - vec2(-0.28, -0.36))));
    frag = vec4(mix(uBeer, vec3(1.0), pip * 0.7), body * vAlpha);
  } else if (vKind < 2.5){
    if (d > 1.0) discard;
    frag = vec4(uFoam, (1.0 - smoothstep(0.1, 1.0, d)) * 0.55 * vAlpha);
  } else if (vKind < 4.5){
    if (d > 1.0) discard;
    float ring = (1.0 - smoothstep(0.70, 1.0, d)) * smoothstep(0.28, 0.62, d);
    float pip  = (1.0 - smoothstep(0.05, 0.46, length(vLocal - vec2(-0.32, -0.36))));
    float sag  = smoothstep(0.2, 1.0, d) * step(0.15, vLocal.y);   /* heavier below */
    vec3 col = mix(vec3(0.03, 0.04, 0.05), vec3(1.0), clamp(pip * 1.4, 0.0, 1.0));
    frag = vec4(col, clamp(ring * 0.45 + sag * 0.20 + pip * 0.9, 0.0, 1.0) * vAlpha);
  } else {
    /* Lacing: dried foam on the wall above the beer line, never above the lip,
       where there is no inside to stick to. A sprite cannot be clipped, so the
       rim's far arc is tested here, as the canvas clips it. */
    if (d > 1.0) discard;
    float lrRy = GTH * GRYK;
    float lrCy = GTOP + lrRy;
    float lrRx = max(innerHalfAt(lrCy), 2.0);
    float lu = (vPx.x - GCX) / lrRx;
    if (abs(lu) > 1.0) discard;
    if (vPx.y < lrCy - lrRy * ${glf(RIM_INNER)} * sqrt(max(0.0, 1.0 - lu * lu))) discard;
    frag = vec4(uFoam, (1.0 - smoothstep(0.2, 1.0, d)) * 0.55 * vAlpha);
  }
}`;

/* ------------------------------------------------------------------ *
 * Pass 4 — the head, lit from the gradient of its own density
 * ------------------------------------------------------------------ */
const FS_FOAM = `#version 300 es
precision highp float;
${GLSL_GLASS}
${GLSL_NOISE}
${GLSL_HEAD}
uniform sampler2D uField;
uniform float uTime, uRelief, uGloss, uBandPx, uCoarse, uScale;
uniform float uCrest;        // how far the head stands above the lip, at its highest
uniform vec2  uLightDir;
uniform vec3  uFoam, uFoamShade, uFoamWet, uBeerTint;
out vec4 frag;
${GLSL_CONTACT}

/* Held at 1, where a byte field saturates: a float one keeps adding, and the
   thresholds and the relief below were set against a field that stops there */
float fieldAt(vec2 p){ return min(texture(uField, vec2(p.x / uRes.x, 1.0 - p.y / uRes.y)).r, 1.0); }

/* Rounded intersection: min() with the corner filleted off at radius k. Two
   bounds crossing at a sharp angle meet in a point, and a head has no points. */
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}


void main(){
  vec2 px = fragPx();

  /* The head's top, as the canvas reads it (headTopAt): it rides the wave, so a
     swilled head climbs over the lip and the crown meets the body at the wall
     without a step. */
  float rry   = GTH * GRYK;
  float lipCy = GTOP + rry;
  float headTop = headTopAt(px.x, lipCy, rry, uBandPx);
  /* The side of the head: the bore below the lip, a cap of foam above. Chosen by
     side of the lip, they met at the rim's widest point in a spike (a notch at
     each side of a tall head), so a filleted min joins them. */
  float ihLip = innerHalfAt(lipCy);
  float up    = max(0.0, lipCy - px.y);
  /* Above the lip a crown of foam sits on the mouth, as wide as the mouth at the
     rim and closing to nothing at its top, sized to how far the head stands proud
     (uCrest). Its curve must be level at both ends, or the outline breaks into a
     ramp, a corner and a wall (a paper dome). */
  float crest  = max(uCrest, 1.0);
  float ct     = clamp(up / crest, 0.0, 1.0);
  float domeHw = ihLip * sqrt(max(0.0, 1.0 - ct * ct));
  /* Never inside the mouth's own ring: the rim is a circle seen at an angle, and
     a dome inside it leaves a crescent of room showing (a nick at each shoulder). */
  float mt     = clamp(up / max(1.0, rry), 0.0, 1.0);
  float ringHw = ihLip * sqrt(max(0.0, 1.0 - mt * mt));
  float capHw  = max(domeHw, ringHw);
  /* The side is the inner wall itself, nothing added: pushed outward, the head
     came out wider than the beer, with a step at the waterline. Below the lip the
     cap is not a bound, since the cone holds the head: a cap left at the mouth's
     width kept the fillet rounding against a bound that was not there, and the
     head stood off the glass. The small fillet stays for the rim, where wall and
     cap meet at a point. */
  float capB  = capHw + max(0.0, px.y - lipCy) * 4.0;
  float dWall = smin(innerHalfAt(px.y) - abs(px.x - GCX),
                     capB - abs(px.x - GCX), 3.0 * uScale);
  /* The bottom of a glass is a disc: a head with almost no beer under it rests on
     the near half of the floor's ellipse, as the beer does. A level floor plane
     gives a straight line a glass with elliptical walls cannot show. */
  float ihb  = max(innerHalfAt(GINBOT), 1.0);
  float fxn  = clamp((px.x - GCX) / ihb, -1.0, 1.0);
  float pan  = GINBOT + uRyKs.y * ihb * sqrt(max(0.0, 1.0 - fxn * fxn));
  if (dWall < -2.0 || px.y > pan) discard;
  /* and nothing below the near arc of the beer it floats on (cut again below).
     Asked here, before the taps, it spares the whole body of the pour them. */
  float front = headSurfaceAt(px.x) + ellipseDy(px.x);
  front += contactWander(px);
  if (px.y >= front + 1.2) discard;

  /* A head is a body of foam, not a heap of blobs. The outline is filled in as
     field (f below), not added as a second mask, since the shading reads the
     field and gaps in it came out flat and darker. It fills but does not cut:
     cut to it, a surging crest stopped on a straight line. */
  /* Welded as the canvas welds them: a wide blur, then a hard threshold, giving
     one body with a rounded hem. Thresholding in place gave each blob its own lump. */
  float fs = fieldAt(px);
  float r1 = 5.0 * uScale, r2 = 3.5 * uScale;
  float fb = (fieldAt(px + vec2( r1, 0.0)) + fieldAt(px + vec2(-r1, 0.0))
            + fieldAt(px + vec2(0.0,  r1)) + fieldAt(px + vec2(0.0, -r1))
            + fieldAt(px + vec2( r2,  r2)) + fieldAt(px + vec2(-r2, -r2))
            + fieldAt(px + vec2( r2, -r2)) + fieldAt(px + vec2(-r2,  r2))) * 0.125;
  /* The head's body: bounded above by its top and at the side by the wall, met
     with a filleted min. The blob field is blurred and thresholded, so it cannot
     hold a corner, and a plain step left a straight facet at each side. The top's
     distance is taken across its slope, or a steep boundary reads as far away
     when it is a pixel off. */
  /* The top's slope, from the columns either side, not a screen derivative: at
     the head's edge the quad's neighbours are off the glass, and one bad
     derivative marks every pixel above the head as inside it. */
  float gTop  = (headTopAt(px.x + 1.0, lipCy, rry, uBandPx)
               - headTopAt(px.x - 1.0, lipCy, rry, uBandPx)) * 0.5;
  float dTop  = (px.y - headTop) * inversesqrt(1.0 + gTop * gTop);
  float body  = smoothstep(0.0, 2.0, smin(dTop, dWall, 3.0 * uScale));
  float f = max(mix(fs, fb, 0.8), body);
  float grain = vnoise(px * 0.9 + vec2(uTime * 0.04, 0.0));
  float mask = smoothstep(0.185, 0.245, f + (grain - 0.5) * 0.035);

  /* Below the lip the wall cuts the head square. Above it there is no wall, and a
     cut there left a straight slab edge over the rim. The foam sits on the ring
     of the mouth, which runs away at the sides, so the edge leans in as it climbs.
     Leaned, not faded: fading made white fog off the glass, and foam has an edge.
     On a curve, not a slope, so the lean is nothing at the rim and gathers as it
     climbs. Leaned, not domed: a dome cuts away a crest that rides one wall. */
  mask *= smoothstep(0.0, 1.5, dWall);

  /* The head floats on the beer, so it ends on the near arc of the surface.
     Letting it out past that drew an underside flatter than the surface beneath. */
  mask *= 1.0 - smoothstep(front - 0.8, front + 1.2, px.y);
  if (mask <= 0.001) discard;

  /* Height within the head: 0 wet at the beer, 1 dry and old at the top.
     Drainage runs downward, so the foam coarsens as it climbs */
  float tH = clamp((front - px.y) / max(uBandPx + ellipseDy(px.x) * 1.5, 1.0), 0.0, 1.0);

  float fx = fieldAt(px + vec2(2.5, 0.0)) - fieldAt(px - vec2(2.5, 0.0));
  float fy = fieldAt(px + vec2(0.0, 2.5)) - fieldAt(px - vec2(0.0, 2.5));
  /* The face of the head is pressed flat against the glass — relief belongs
     to the outline, not to blob seams inside the solid mass */
  float edgeW = 1.0 - smoothstep(0.35, 0.75, f);
  /* The body's own shape, which the field cannot give (it is solid inside the
     head): the face turns away at each side as the glass does, and the crown
     tips up towards the light. Shading only, not geometry. */
  float nxh   = clamp((px.x - GCX) / max(ihLip, 1.0), -1.0, 1.0);
  float crown = smoothstep(0.45, 0.95, clamp((front - px.y) / max(front - headTop, 1.0), 0.0, 1.0));
  vec3 nrm = normalize(vec3(0.50 * nxh, -0.65 * crown, 1.0)
                     + vec3(-fx, -fy, 0.0) * uRelief * 30.0 * edgeW);

  vec3 L = normalize(vec3(uLightDir, 0.85));
  float dif = 0.58 + 0.34 * max(dot(nrm, L), 0.0);

  float cells = vnoise(px * 0.16 + vec2(uTime * 0.05, 0.0)) * 0.7
              + vnoise(px * 0.45 - vec2(0.0, uTime * 0.08)) * 0.3;
  dif *= 0.90 + cells * 0.20;

  /* Pores: fine where the foam is young and wet, coarser where it has drained.
     uCoarse carries the style — a pilsner stays tight, a bock opens up */
  float pf = mix(1.5, 0.6, uCoarse) * mix(1.2, 0.75, tH);
  float pores  = vnoise(px * 0.85 * pf + vec2(uTime * 0.03, 0.0));
  float pores2 = vnoise(px * 1.90 * pf + vec2(0.0, uTime * 0.02));
  dif *= 1.0 - smoothstep(0.60, 0.95, pores) * (0.12 + uCoarse * 0.10 + tH * 0.05)
             - smoothstep(0.68, 0.98, pores2) * 0.05;

  /* Visible bubbles: mostly small, a few large, as a real head sorts them */
  vec2 cp = px / uScale * (0.07 * mix(1.25, 0.75, uCoarse));
  vec2 ci = floor(cp), cf = fract(cp);
  float on = step(0.72 - tH * 0.22 - uCoarse * 0.12, hash21(ci));
  vec2 cc = 0.25 + 0.5 * vec2(hash21(ci + 3.7), hash21(ci + 9.1));
  float cr = mix(0.07, 0.34, pow(hash21(ci + 5.3), 2.8));
  float ring = (1.0 - smoothstep(0.015, 0.07, abs(distance(cf, cc) - cr))) * on;
  float pip  = (1.0 - smoothstep(0.0, cr * 0.45, distance(cf, cc + vec2(-0.09, -0.09)))) * on;
  dif -= ring * 0.10;

  vec3 base = mix(uFoamWet, uFoam, smoothstep(0.0, 0.32, tH));
  vec3 col = mix(uFoamShade, base, clamp(dif, 0.0, 1.0));

  col *= 0.88 + 0.12 * smoothstep(0.16, 0.40, f);

  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  /* The highlights roll off towards white and cannot pass it, so the crown
     keeps its tone under them */
  float spec = pow(clamp(dot(nrm, H), 0.0, 1.0), 26.0) * uGloss * mix(0.6, 0.25, tH)
             + smoothstep(0.82, 0.99, pores2) * uGloss * 0.12
             + pip * (0.04 + uGloss * 0.10);
  col = mix(col, vec3(0.98), 1.0 - exp(-spec));

  /* Soaked as deep as the head stands in the beer: the surface lens's depth at
     this column, not a fixed band, which drew its own edge part way across the
     lens. Over a short reach only, or the head grades into the beer with no edge. */
  float lens = clamp(ellipseDy(px.x) * 0.55, 7.0, 20.0);
  col = mix(col, col * uBeerTint, smoothstep(-lens, 3.0, px.y - front) * 0.20);
  /* and a narrow wet strip right at the contact, which is what reads as the
     foam standing in the beer and not painted over it */
  col = mix(col, col * uBeerTint, exp(-max(front - px.y, 0.0) / (3.0 * uScale)) * 0.32);

  frag = vec4(col, mask);
}`;

/* ------------------------------------------------------------------ *
 * Pass 5 — the glass itself, in front of everything
 * ------------------------------------------------------------------ */
const FS_GLASS = `#version 300 es
precision highp float;
${GLSL_GLASS}
${GLSL_NOISE}
${GLSL_HEAD}
uniform vec3 uEdge, uLight, uBeerGlow;
uniform float uDark, uLightX, uLevel, uBandPx, uBeerSolid;
/* How plainly the glass is drawn. The silhouette, tint, rim ellipses, lip light,
   wall lines, floor and standing ring fade together. The wall reflections and
   base light do not: they are light on the glass, not lines saying it is there. */
uniform float uLine;
out vec4 frag;

void main(){
  vec2 px = fragPx();

  float bw  = GBH;
  float ryB = uRyKs.y * bw;
  if (px.y < GTOP - 2.0 || px.y > GBOT + ryB + 2.0) discard;

  float rimRy = GTH * GRYK;
  float rimTanY = GTOP + rimRy;
  float rimRx = halfAt(rimTanY);

  float dx = abs(px.x - GCX);
  float outer = dx - halfAt(px.y);            // negative inside the silhouette
  float inner = dx - (halfAt(px.y) - GWALL);
  float w = max(1.0, GWALL * 0.30);

  vec3 col = vec3(0.0);
  float a = 0.0;

  vec2 rc = vec2((px.x - GCX) / rimRx, (px.y - rimTanY) / rimRy);
  bool inTopLens = px.y < rimTanY && dot(rc, rc) < 1.0;
  vec2 bcS = vec2((px.x - GCX) / max(bw, 1.0), (px.y - GBOT) / max(ryB, 1.0));
  bool inBulge = px.y >= GBOT && dot(bcS, bcS) < 1.0;
  if ((outer < 0.0 && px.y >= rimTanY && px.y <= GBOT) || inTopLens || inBulge){
    col += uEdge; a += (uDark > 0.5 ? 0.05 : 0.035) * uLine;
  }

  /* Glass reflects more the more obliquely it is seen, so towards the silhouette
     the wall picks up the room's light and reads as a thickness. On a pale wall
     it picks up the wall, so the edge goes a little darker instead.
     Above the rim's widest line the silhouette is the rim's far arc, so the
     measure there is the ellipse's own radius. Stopped at that line, the fade
     ended on a level cut across the middle of the mouth. Round the arc the wall
     turns to face us, so it thins by how far to the side it stands and is gone
     at the back. Both measures agree on the line, so there is no join. */
  if ((outer < 0.0 && px.y >= rimTanY && px.y <= GBOT) || inTopLens){
    float fu = dx / max(halfAt(px.y), 1.0);
    float turn = 1.0;
    if (px.y < rimTanY){
      fu = length(rc);
      turn = rc.x * rc.x / max(fu * fu, 0.0001);
    }
    float fres = pow(smoothstep(0.62, 1.0, fu), 2.5) * turn;
    col = mix(col, uDark > 0.5 ? uLight : mix(uEdge, uLight, 0.45), fres);
    a = max(a, fres * (uDark > 0.5 ? 0.16 : 0.12) * uLine);
  }

  float outerLine = (1.0 - smoothstep(0.0, w, abs(outer))) * step(rimTanY, px.y) * step(px.y, GBOT);
  /* The inner wall runs from the rim's widest points to the floor's and stops.
     There a wall seen edge-on meets the ellipse it stands on, tangent, so the
     line hands over without a join. Carried past the floor it crosses the floor
     ellipse and ends in mid air under it. The outer wall stops likewise. */
  float innerLine = (1.0 - smoothstep(0.0, w, abs(inner)))
                  * smoothstep(rimTanY - 1.0, rimTanY + 3.0, px.y)
                  * (1.0 - smoothstep(GINBOT - 1.0, GINBOT + 0.5, px.y));
  col = mix(col, uEdge, clamp(outerLine, 0.0, 1.0));
  a = max(a, outerLine * 0.72 * uLine);
  col = mix(col, uLight, clamp(innerLine * 0.75, 0.0, 1.0));
  a = max(a, innerLine * 0.4 * uLine);

  /* Reflections running down the glass, brighter on the side facing the light.
     Each band sits at a fixed fraction of the local half width, so it converges
     with the tapering wall. */
  if (outer < 0.0 && px.y > rimTanY){
    float u = dx / max(halfAt(px.y), 1.0);
    float side = sign(px.x - GCX) * sign(uLightX);
    float yy = (px.y - GTOP) / max(GHT, 1.0);
    float sd = px.x < GCX ? 0.0 : 7.3;
    float along1 = 0.55 + 0.45 * vnoise(vec2(yy * 4.5 + sd, 1.3));
    float along2 = 0.40 + 0.60 * vnoise(vec2(yy * 7.0 + sd, 5.9));
    /* One reflection leads and the other is faint beside it; two alike read as
       painted stripes. The leader's width breathes down its length. */
    float d1 = (u - 0.66) / (0.036 + 0.026 * along1), d2 = (u - 0.48) / 0.020;
    float refl = exp(-d1 * d1) * 0.5 * along1 + exp(-d2 * d2) * 0.11 * along2;
    refl *= smoothstep(rimTanY, rimTanY + rimRy * 3.0, px.y) * (1.0 - smoothstep(GBOT - GBASE * 2.4, GBOT, px.y));
    refl *= 1.0 + side * 0.5 * min(abs(uLightX) * 1.6, 1.0);
    col = mix(col, uLight, clamp(refl, 0.0, 1.0));
    a = max(a, refl * (uDark > 0.5 ? 0.35 : 0.65));
  }

  /* Rim: the outer lip, and the inner lip just inside it (without it the inner
     wall lines begin in mid air). The near half takes the light square on and the
     far half is read through the whole glass: front heavier, back quiet. */
  float lipF = clamp((px.y - rimTanY) / max(rimRy, 1.0) * 0.5 + 0.5, 0.0, 1.0);

  float rim = abs(length(rc) - 1.0) * rimRx;
  float rimLine = (1.0 - smoothstep(0.0, GWALL * mix(0.34, 0.78, lipF), rim));
  col = mix(col, mix(uEdge, uLight, lipF), clamp(rimLine * mix(0.75, 1.2, lipF), 0.0, 1.0));
  a = max(a, rimLine * mix(0.38, 1.0, lipF) * uLine);

  float riRx = max(rimRx - GWALL, 1.0);
  vec2 ric = vec2((px.x - GCX) / riRx, (px.y - rimTanY) / max(rimRy * ${glf(RIM_INNER)}, 1.0));
  float rimInLine = (1.0 - smoothstep(0.0, GWALL * mix(0.28, 0.52, lipF), abs(length(ric) - 1.0) * riRx));
  col = mix(col, uLight, clamp(rimInLine * 0.85, 0.0, 1.0));
  a = max(a, rimInLine * mix(0.26, 0.66, lipF) * uLine);

  if ((px.y > GBOT - GBASE * 2.1 && px.y <= GBOT && outer < 0.0) || inBulge){
    float t = smoothstep(GBOT - GBASE * 2.1, GBOT + ryB, px.y);
    col = mix(col, uLight, t * 0.42);
    a = max(a, t * (uDark > 0.5 ? 0.18 : 0.30));
    if (uLevel > 0.02){
      /* The glow lights the base below the interior floor, an ellipse. Ramps in x
         times ramps in y would give a soft box, so the falloff is measured out
         from the floor's rim and gated by its front arc. */
      float ihb  = max(innerHalfAt(GINBOT), 1.0);
      float iryb = max(uRyKs.y * ihb, 1.0);
      float nxf  = clamp((px.x - GCX) / ihb, -1.0, 1.0);
      float floorFront = GINBOT + iryb * sqrt(max(0.0, 1.0 - nxf * nxf));
      float fr = length(vec2((px.x - GCX) / ihb, (px.y - GINBOT) / iryb));
      /* A tall pour drives far more light down into the base than a splash
         in the bottom does, so the glow answers to the fill line */
      float lvl = smoothstep(0.02, 0.62, uLevel);
      float bt = smoothstep(1.0, 1.4, fr) * (1.0 - smoothstep(1.6, 2.3, fr))
               * smoothstep(floorFront - 1.0, floorFront + 5.0, px.y) * lvl;
      /* cooled towards the glass it is, so the base does not read as more
         beer below the beer */
      vec3 lit = mix(uBeerGlow, vec3(0.62, 0.68, 0.72), 0.20);
      col = mix(col, lit, bt * 0.60);
      a = max(a, bt * 0.44);
    }
  }

  /* What the head and the beer cover. The head hides the far half of the rim at
     the lip and the back of the glass at the bottom: a nearly empty glass sits
     its head on the floor, and the far arcs of the floor and ring would run
     across the foam. The outline is the foam pass's own. Each ring is hidden by
     how far back the pixel is on it (the canvas strokes each ring twice, far and
     near). The beer covers them too once thick enough (uBeerSolid): at the house
     setting you see the back of the glass through a pint, which is most of what
     says it is a glass. */
  float beerCov = 0.0;
  if (uLevel > 0.002 && uBeerSolid > 0.002){
    float bTop = surfaceAt(px.x) - ellipseDy(px.x);
    beerCov = uBeerSolid * smoothstep(bTop - 1.0, bTop + 1.0, px.y);
  }

  float headTop = 1e9, headBot = -1e9, headCov = 0.0;
  if (uLevel > 0.001){
    headTop = headTopAt(px.x, rimTanY, rimRy, uBandPx);
    headBot = headSurfaceAt(px.x) + ellipseDy(px.x);
    if (abs(px.x - GCX) <= innerHalfAt(max(px.y, rimTanY)))
      headCov = smoothstep(headTop - 1.0, headTop + 2.0, px.y)
              * (1.0 - smoothstep(headBot - 0.8, headBot + 1.2, px.y));
  }

  float botD = abs(length(bcS) - 1.0) * bw;
  float botLine = (1.0 - smoothstep(0.0, w, botD)) * step(GBOT - 1.0, px.y);
  col = mix(col, uEdge, clamp(botLine, 0.0, 1.0));
  a = max(a, botLine * 0.72 * uLine);

  vec2 bc = vec2((px.x - GCX) / max(bw * 0.86, 1.0), (px.y - GBOT) / max(ryB * 0.86, 1.0));
  float baseArc = abs(length(bc) - 1.0) * bw * 0.86;
  float baseLine = (1.0 - smoothstep(0.0, GWALL * 0.5, baseArc));
  baseLine *= 1.0 - max(headCov, beerCov) * (1.0 - clamp(bc.y * 0.5 + 0.5, 0.0, 1.0));
  col = mix(col, uLight, clamp(baseLine, 0.0, 1.0));
  a = max(a, baseLine * 0.45 * uLine);

  /* The floor the beer stands on. Faint, it let the pour, base and reflection
     run together as one amber mass, so it has weight: near arc lit, far arc a
     dark line. */
  float fihw = max(innerHalfAt(GINBOT), 1.0);
  vec2 fc = vec2((px.x - GCX) / fihw, (px.y - GINBOT) / max(fihw * uRyKs.y, 1.0));
  float floorArc = abs(length(fc) - 1.0) * fihw;
  float floorNear = clamp((px.y - GINBOT) / max(fihw * uRyKs.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);
  float floorLine = (1.0 - smoothstep(0.0, GWALL * 0.55, floorArc));
  floorLine *= 1.0 - max(headCov, beerCov) * (1.0 - floorNear);
  col = mix(col, mix(uEdge, uLight, floorNear), clamp(floorLine, 0.0, 1.0));
  a = max(a, floorLine * mix(0.42, 0.72, floorNear) * uLine);

  /* A head standing proud of the rim fills the mouth. Above the rim's plane the
     only glass left is the back of the lip and the top of the silhouette, both
     behind the foam, so they are cut (painted over it they read as a bright arc
     across the head). Below the plane the near half of the lip is in front of the
     foam and stays. The cut uses the head's own outline, the one the foam pass
     fills: a separate dome disagrees with the field at the walls and bit a dark
     comma out of the head at either side of the lip. */
  if (px.y < rimTanY && uLevel > 0.001 && abs(px.x - GCX) <= innerHalfAt(rimTanY))
    a *= 1.0 - smoothstep(headTop - 1.0, headTop + 2.0, px.y);

  if (a <= 0.003) discard;
  frag = vec4(col, clamp(a, 0.0, 1.0));
}`;

/* ------------------------------------------------------------------ *
 * Pass 5b — the weep: foam over the lip, and what runs down from it
 *
 * Solved per pixel, as the canvas draws it, because a sprite cannot be clipped
 * to the silhouette. It goes on after the glass and inside the scene, so the
 * bar reflects it.
 * ------------------------------------------------------------------ */
const FS_WEEP = `#version 300 es
precision highp float;
${GLSL_GLASS}
${GLSL_NOISE}
uniform vec3  uFoam;
uniform vec4  uWeep;         // collar, how far over the lip, the hem's reach, its tongues
uniform float uWeepRun;      // and how far down the outside, which comes after
uniform float uWeepAlive;    // and how much of it has not dried off yet
uniform float uWeepPart;     // 0: what runs down the back of the glass, drawn
                             //    before the beer so the pour stands in front
                             //    of it; 1: everything else, drawn after
uniform float uScale, uTime, uCoarse, uWeepA;
uniform int   uRibN;
uniform vec4  uRibA[6];      // th, top, bottom h, shoulder width
uniform vec4  uRibB[6];      // bead r, wob, wobA, pool
uniform vec4  uRibC[6];      // life
/* the three waves this weep's tongues are made of: how many, where, how deep,
   and how much of the hem is level. Rolled once per weep, over in sim/weep.js. */
uniform vec3  uDrapeF;
uniform vec3  uDrapeP;
uniform vec4  uDrapeG;       // depths, and the level part in w
out vec4 frag;

/* The hem hangs in tongues, and is closed off at the two sides where the glass
   turns away and the collar is edge on. This is collarDrape in the simulation
   (weep.js), with its constants. */
float drape(float th){
  float v = uDrapeG.w;
  v += uDrapeG.x * sin(th * uDrapeF.x + uDrapeP.x);
  v += uDrapeG.y * sin(th * uDrapeF.y + uDrapeP.y);
  v += uDrapeG.z * sin(th * uDrapeF.z + uDrapeP.z);
  return clamp(v, ${glf(DRAPE_LEAST)}, 1.0) * min(1.0, abs(cos(th)) * ${glf(DRAPE_SIDES)});
}

float rimRy(){ return GTH * GRYK; }
float rimCy(){ return GTOP + rimRy(); }

float hemH(float th){
  return rimCy() + uWeepRun * (uWeep.z + uWeep.w * drape(th));
}
vec2 hemPt(float th){ return conePoint(hemH(th), th); }

/* Which height sits at this y, at this angle round the glass. The lean changes
   slowly, so it is walked in (three steps) rather than solved. */
float heightAtY(float y, float th){
  float h = y;
  for (int i = 0; i < 3; i++) h = y - ryAt(h) * halfAt(h) * cos(th);
  return h;
}

/* Widest at the lip, thin down the middle, swelling into the bead that does the
   pulling. This is ribbonHalf in the simulation (weep.js). */
float ribbonHalf(float w, float r, float t){
  float tail = w * (${glf(RIBBON_TAIL)} + ${glf(RIBBON_TAPER)} * pow(1.0 - t, ${glf(RIBBON_TAPER_POW)}));
  float bead = r * clamp((t - ${glf(RIBBON_BEAD_FROM)}) / ${glf(RIBBON_BEAD_OVER)}, 0.0, 1.0);
  return max(tail, bead);
}

/* The lip on whichever side a thing hangs from, where a ribbon is cut off at the
   top. The rim turns hardest near the sides, so a level cut reads as a tab stuck
   on; a back ribbon comes over the far arc, which is higher. */
float lipSideY(float x, float side){
  float rx = max(1.0, halfAt(rimCy()));
  float u = clamp((x - GCX) / rx, -1.0, 1.0);
  return rimCy() + side * (rimRy() * sqrt(max(0.0, 1.0 - u * u)) - 0.5 * uScale);
}

float footSideY(float x, float side){
  float u = clamp((x - GCX) / max(1.0, GBH), -1.0, 1.0);
  return GBOT + side * ryAt(GBOT) * GBH * sqrt(max(0.0, 1.0 - u * u));
}

bool inSilhouette(vec2 px){
  float rt = rimCy();
  vec2 rc = vec2((px.x - GCX) / max(1.0, halfAt(rt)), (px.y - rt) / max(1.0, rimRy()));
  float ryB = ryAt(GBOT) * GBH;
  vec2 bc = vec2((px.x - GCX) / max(1.0, GBH), (px.y - GBOT) / max(1.0, ryB));
  bool wall  = px.y >= rt && px.y <= GBOT && abs(px.x - GCX) <= halfAt(px.y);
  bool lens  = px.y < rt && dot(rc, rc) < 1.0;
  bool bulge = px.y > GBOT && dot(bc, bc) < 1.0;
  return wall || lens || bulge;
}

/* The head's cells and pores, so the collar carries the grain of the foam it
   came from. Flat, it read as a second, smooth head. */
vec3 foamGrain(vec2 px){
  float cells = vnoise(px * 0.16 + vec2(uTime * 0.05, 0.0)) * 0.7
              + vnoise(px * 0.45 - vec2(0.0, uTime * 0.08)) * 0.3;
  float pf = mix(1.5, 0.6, uCoarse);
  float pores  = vnoise(px * 0.85 * pf + vec2(uTime * 0.03, 0.0));
  float pores2 = vnoise(px * 1.90 * pf + vec2(0.0, uTime * 0.02));
  /* A touch, not a coat: foam seen through its own thickness where it has folded
     over the lip, not the open face of the head. At full strength it was grey. */
  float k = 0.995 + (cells - 0.5) * 0.022
          - smoothstep(0.76, 0.99, pores)  * 0.022
          - smoothstep(0.84, 0.99, pores2) * 0.016;
  return uFoam * clamp(k, 0.96, 1.02);
}

void over(inout vec4 acc, vec3 c, float a){
  a = clamp(a, 0.0, 1.0);
  acc.rgb = acc.rgb * (1.0 - a) + c * a;
  acc.a   = acc.a   * (1.0 - a) + a;
}

void main(){
  vec2 px = fragPx();

  /* Nothing reaches above the rim, outside the widest the glass is, or below what
     a puddle can spread to. The ribbon loop is dear, so the rest of the frame skips it. */
  float bry = ryAt(GBOT) * GBH;
  if (px.y < rimCy() - rimRy() - 2.0 || px.y > GBOT + bry + 60.0
      || abs(px.x - GCX) > max(GTH, GBH) + 60.0) discard;

  vec4 acc = vec4(0.0);

  bool showCollar = uWeep.x > 0.012 && uWeep.y > 0.002 && uWeepPart > 0.5;

  /* How far round the glass this pixel stands. The collar's top edge is on the
     rim and its hem lower on a tapering wall, so reading the angle off the bore
     at the pixel's own height drew foam outside the glass along the lip. So the
     height is found first, roughly, and the radius taken between the two edges. */
  float cRx = max(1.0, halfAt(rimCy()));
  float dx = px.x - GCX;
  float hw = max(1.0, halfAt(px.y));
  float th = asin(clamp(dx / hw, -1.0, 1.0));
  for (int i = 0; i < 2; i++){
    float yT = rimCy() - rimRy() * cos(th);
    float hh = hemH(th);
    float yH = hh + ryAt(hh) * halfAt(hh) * cos(th);
    float t  = clamp((px.y - yT) / max(1.0, yH - yT), 0.0, 1.0);
    hw = max(1.0, mix(cRx, halfAt(hh), t));
    th = asin(clamp(dx / hw, -1.0, 1.0));
  }
  bool onFace = abs(dx) <= hw;

  /* The collar's shade along its hem. Laid first, so the collar covers its inner
     half and the rest is a shadow below. A ribbon passing the hem goes over it. */
  if (showCollar && onFace){
    vec2 hp = hemPt(th);
    float e = 0.02;
    vec2 d = hemPt(th + e) - hemPt(th - e);
    float perp = abs(px.y - hp.y) * abs(d.x) / max(length(d), 1e-4);
    float lw = max(1.0, GWALL * 0.35);
    /* Closed off at the two sides, like the drape: there the hem runs straight
       down the screen, the angle has no width to divide by, and the line spread
       into a blot inside the mouth (a dark comma). Edge-on a stroke has no shade. */
    float edge = min(1.0, abs(cos(th)) * 3.4);
    over(acc, vec3(0.353, 0.282, 0.173),
         (1.0 - smoothstep(lw * 0.5 - 1.0, lw * 0.5, perp)) * 0.28 * 0.5 * edge * uWeepAlive);
  }

  /* One body apiece: the tail and its bead are the same foam, and two overlapping
     fills at this alpha would seam where they cross. */
  for (int i = 0; i < 6; i++){
    if (i >= uRibN) break;
    float rth = uRibA[i].x, rtop = uRibA[i].y, rbot = uRibA[i].z, rw = uRibA[i].w;
    float rr = uRibB[i].x, wob = uRibB[i].y, wobA = uRibB[i].z, pool = uRibB[i].w;
    float life = uRibC[i].x;
    float c = cos(rth), sr = sin(rth);
    float side = c < 0.0 ? -1.0 : 1.0;
    /* the back of the glass is painted with the room, the front with the glass */
    if ((c < 0.0) != (uWeepPart < 0.5)) continue;
    float a = clamp(life, 0.0, 1.0) * 0.94 * (0.6 + 0.4 * (0.5 + 0.5 * c));
    if (a <= 0.01) continue;
    float fs = max(0.3, abs(c));            /* edge-on where the glass turns away */

    float h = heightAtY(px.y, rth);
    float t = clamp((h - rtop) / max(1.0, rbot - rtop), 0.0, 1.0);
    float sway = sin(t * 4.1 + wob) * wobA * t;
    float cxr = GCX + halfAt(h) * sr + sway * fs;
    float phw = max(0.35, ribbonHalf(rw, rr, t) * fs);

    vec2 endP = conePoint(rbot, rth);
    float endSway = sin(4.1 + wob) * wobA;
    endP.x += endSway * fs;
    float endHw = max(0.35, ribbonHalf(rw, rr, 1.0) * fs);

    float cover = 0.0;
    float underLip = smoothstep(-0.7, 0.7, px.y - lipSideY(px.x, side));
    if (underLip > 0.001){
      if (px.y <= endP.y){
        cover = (1.0 - smoothstep(phw - 0.7, phw + 0.7, abs(px.x - cxr)));
      } else if (pool > 0.0){
        /* It has arrived. Foam standing on the bottom has its whole width against
           the base's arc, so a rounded end there would be a drop in mid air. */
        cover = (1.0 - smoothstep(endHw - 0.7, endHw + 0.7, abs(px.x - endP.x)))
              * step(px.y, footSideY(px.x, side));
      } else {
        vec2 q = vec2((px.x - endP.x) / endHw, (px.y - endP.y) / max(0.35, rr));
        cover = (1.0 - smoothstep(1.0 - 1.4 / max(endHw, 1.0), 1.0, length(q)));
      }
    }
    over(acc, foamGrain(px), cover * underLip * a);

    /* The light runs down the standing edge, once there is one to catch it. On a
       ribbon thinned to a thread it was the whole of it and read as a scratch. */
    float hw0 = max(0.35, ribbonHalf(rw, rr, 0.0) * fs);
    if (hw0 > 2.2 && cover > 0.02 && phw >= 1.1 && px.y <= endP.y){
      float lwid = max(0.6, hw0 * 0.34);
      float dl = abs(px.x - (cxr - phw * 0.42));
      over(acc, vec3(1.0), (1.0 - smoothstep(0.0, lwid * 0.5, dl)) * a * 0.32 * 0.55);
    }

    /* and what got all the way down runs off the glass and lies on the bar. Only
       the half clear of the foot: the glass stands on the other. */
    if (pool > 0.0 && !inSilhouette(px)){
      float pry = max(0.8, pool * ryAt(GBOT) * GBH / max(1.0, GBH));
      float prx = max(1.0, pool);
      vec2 q = vec2((px.x - endP.x) / prx, (px.y - endP.y - rr) / pry);
      float e = 1.0 / min(prx, pry);
      over(acc, uFoam, (1.0 - smoothstep(1.0 - e, 1.0 + e, length(q))) * a * 0.8);
    }
  }

  /* The collar: the head hanging over the lip, where the ribbons start. It goes
     last, over the ribbons, so a ribbon's root vanishes into it. Its upper edge
     is the far arc of the rim, since foam that has come over covers the whole
     lip. Its lower edge is the hem at the height it has reached, so it comes in
     with the tapering wall. */
  if (showCollar && onFace){
    float yTop = rimCy() - rimRy() * cos(th);
    vec2 hp = hemPt(th);
    float band = smoothstep(yTop - 0.7, yTop + 0.7, px.y)
               * (1.0 - smoothstep(hp.y - 0.7, hp.y + 0.7, px.y));
    /* The mouth is not covered: foam over the lip lies on the ring and hangs down
       the outside, it is not a lid. The cut is a hair inside the bore (inset), so
       the collar laps the head, but only a hair: eight pixels read as a band of
       foam inside the rim. With no lap, bare glass shows at each side of the rim
       where the head's crown reaches the rim's plane and the mouth is cut out up
       to the same line (the dark comma). */
    float inset = 2.5 * uScale;
    float mrx = max(2.0, halfAt(rimCy()) - GWALL - inset);
    vec2 m = vec2((px.x - GCX) / mrx,
                  (px.y - rimCy()) / max(1.0, rimRy() * ${glf(RIM_INNER)} - inset));
    band *= smoothstep(1.0 - 1.2 / mrx, 1.0, length(m));

    /* It comes over the lip rather than landing on it (a ring covered whole in one
       frame reads as a flash). The ring is covered outward from the mouth: a pixel
       is allowed once the weep has reached its distance from the lip's centre, in
       shares of the rim's ellipse. Past the rim the hem does the running. */
    float rise = uWeep.y;
    float rx   = max(1.0, halfAt(rimCy()));
    float q    = length(vec2((px.x - GCX) / rx, (px.y - rimCy()) / max(1.0, rimRy())));
    /* Softened by a pixel and a half, not a fixed share: the ring is under a tenth
       of the rim's radius wide, so a twentieth left it half covered. The reach
       runs a hair past the rim, so nothing cuts it afterwards. */
    float soft  = 1.5 / rx;
    float qRing = mix(mrx / rx, 1.0 + soft * 2.0, rise);
    float ring = 1.0 - smoothstep(qRing - soft, qRing, q);
    float hang = step(1.0, q) * step(rimCy(), px.y);
    band *= max(ring, hang);
    over(acc, foamGrain(px), band * 0.94 * uWeepAlive);
  }

  /* How plainly it is drawn, not how much of it there is. Premultiplied, so one
     multiply thins colour and coverage together instead of turning it grey. */
  acc *= uWeepA;
  if (acc.a <= 0.002) discard;
  frag = acc;                      /* premultiplied */
}`;

const progBeer    = program(VS_FULL, FS_BEER);
const progCompose = program(VS_FULL, FS_COMPOSE);
const progRoom    = program(VS_FULL, FS_ROOM);
const progBand   = program(VS_FULL, FS_BAND);
const progBlob   = program(VS_BLOB, FS_BLOB);
const progSprite = program(VS_SPRITE, FS_SPRITE);
const progFoam   = program(VS_FULL, FS_FOAM);
const progGlass  = program(VS_FULL, FS_GLASS);
const progWeep   = program(VS_FULL, FS_WEEP);

/* ------------------------------------------------------------------ *
 * Buffers and targets
 * ------------------------------------------------------------------ */
const vaoEmpty = gl.createVertexArray();
const cornerBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

const MAX_BLOBS = 512, MAX_SPRITES = 1400;
const blobData = new Float32Array(MAX_BLOBS * 4);
const SPRITE_FLOATS = 7;            /* x, y, rx, ry, kind, alpha, far */
const spriteData = new Float32Array(MAX_SPRITES * SPRITE_FLOATS);

function instancedVAO(prog, buf, stride, layout){
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  const corner = gl.getAttribLocation(prog.p, "aCorner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (const [name, size, offset] of layout){
    const loc = gl.getAttribLocation(prog.p, name);
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);
  return vao;
}

const blobBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, blobBuf);
gl.bufferData(gl.ARRAY_BUFFER, blobData.byteLength, gl.DYNAMIC_DRAW);
const blobVAO = instancedVAO(progBlob, blobBuf, 16, [["aInst", 4, 0]]);

const spriteBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
gl.bufferData(gl.ARRAY_BUFFER, spriteData.byteLength, gl.DYNAMIC_DRAW);
const spriteVAO = instancedVAO(progSprite, spriteBuf, SPRITE_FLOATS * 4, [["aInst", 4, 0], ["aMeta", 3, 16]]);

/* The surface's heights: row 0 the beer, row 1 the head, each texel a column's
   height and its change per column, linearly filtered so one fetch reads between
   columns. Full floats where those can be filtered, else half floats (height to
   a sixteenth of a pixel). */
const HEIGHT_TEX_W = 512;
const heightTex = gl.createTexture();
const height32 = !!gl.getExtension("OES_texture_float_linear");
gl.bindTexture(gl.TEXTURE_2D, heightTex);
gl.texImage2D(gl.TEXTURE_2D, 0, height32 ? gl.RG32F : gl.RG16F, HEIGHT_TEX_W, 2, 0, gl.RG, gl.FLOAT, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
const heightUpload = new Float32Array(HEIGHT_TEX_W * 2);

/* ------------------------------------------------------------------ *
 * The house mark (LOGO_SVG, sim/layout.js): white, tinted in the shader
 * ------------------------------------------------------------------ */


const logoTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, logoTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
let logoReady = false;
{
  const img = new Image();
  img.onload = () => {
    const w = 1024, h = Math.round(1024 / LOGO_ASPECT);
    const pad = Math.round(w * LOGO_PAD);
    const c = document.createElement("canvas");
    c.width = w + pad * 2;
    c.height = h + pad * 2;
    const c2 = c.getContext("2d");
    c2.filter = "blur(9px)";       /* depth of field: the wall is out of focus */
    c2.drawImage(img, pad, pad, w, h);
    gl.bindTexture(gl.TEXTURE_2D, logoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    logoReady = true;
    redraw();
  };
  img.src = "data:image/svg+xml;utf8," + encodeURIComponent(LOGO_SVG);
}

/* The counter's timber, repeating and mipmapped: towards the far edge a screen
   row covers more grain, and without smaller copies it comes apart into moire. */
const woodTex = gl.createTexture();
/* the bake reads it, so it says when it has arrived (see bakeRoom) */
let woodReady = false;
{
  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, woodTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    woodReady = true;
    redraw();
  };
  img.src = BAR_WOOD;
}

/* The kept part of the room (FS_ROOM). Half floats where they can be drawn into,
   else bytes, which are a hair coarser. */
let roomTex = null, roomFBO = null, roomKey = "";
const roomFloat = !!gl.getExtension("EXT_color_buffer_float");
function makeRoom(w, h){
  if (roomTex) gl.deleteTexture(roomTex);
  if (roomFBO) gl.deleteFramebuffer(roomFBO);
  roomTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, roomTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, roomFloat ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA,
                roomFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  roomFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, roomFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, roomTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  roomKey = "";
}

function bakeRoom(lr){
  const wood = cfg.counter === "wood" && woodReady;
  const key = [canvas.width, canvas.height, W, H, G.cx, G.top, G.bottom, G.topHalf, G.botHalf,
               G.wall, G.baseH, G.inTop, G.inBottom, G.ryTop, camEye, camLens,
               pal.ground.join(","), pal.groundDeep.join(","), pal.dark, logoReady, lr.join(","),
               glassAway, wood].join("|");
  if (key === roomKey) return;
  roomKey = key;
  gl.bindFramebuffer(gl.FRAMEBUFFER, roomFBO);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  gl.useProgram(progRoom.p);
  gl.bindVertexArray(vaoEmpty);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, logoTex);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, woodTex);
  setShared(progRoom, dpr);
  gl.uniform1i(progRoom.u.uLogo, 2);
  gl.uniform1i(progRoom.u.uWood, 3);
  /* the tile stands for about a metre of counter, so a pint covers a fifteenth
     of it across */
  gl.uniform2f(progRoom.u.uWoodK, WOOD_TILES, wood ? 1 : 0);
  gl.uniform3fv(progRoom.u.uGroundDeep, pal.groundDeep);
  gl.uniform4f(progRoom.u.uLogoRect, lr[0], lr[1], lr[2], lr[3]);
  gl.uniform1f(progRoom.u.uLogoOn, logoReady ? LOGO_ON : 0);
  gl.uniform3fv(progRoom.u.uGround, pal.ground);
  gl.uniform1f(progRoom.u.uDark, pal.dark ? 1 : 0);
  gl.uniform1f(progRoom.u.uGlassOn, glassAway ? 0 : 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

let sceneTex = null, sceneFBO = null, sceneW = 1, sceneH = 1;

function makeScene(w, h){
  if (sceneTex) gl.deleteTexture(sceneTex);
  if (sceneFBO) gl.deleteFramebuffer(sceneFBO);
  sceneW = Math.max(1, Math.round(w));
  sceneH = Math.max(1, Math.round(h));
  sceneTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sceneW, sceneH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  /* mipmapped for the bar's blurred reflection of it; the levels are made
     afresh each frame (see render), and here so it is never incomplete */
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  sceneFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

const FIELD_SCALE = 2;
let fieldTex = null, fieldFBO = null, fieldW = 1, fieldH = 1;
/* The head's density field. Its slope is the foam's relief, and in bytes that
   shows as terraces, so half floats are used where the target can be drawn into.
   The driver may still refuse, so it is checked, with one byte a texel as fallback. */
let fieldHalf = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));

function makeField(w, h){
  if (fieldTex) gl.deleteTexture(fieldTex);
  if (fieldFBO) gl.deleteFramebuffer(fieldFBO);
  fieldW = Math.max(1, Math.round(w));
  fieldH = Math.max(1, Math.round(h));
  fieldTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fieldTex);
  if (fieldHalf) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, fieldW, fieldH, 0, gl.RED, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, fieldW, fieldH, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  fieldFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok && fieldHalf){ fieldHalf = false; makeField(w, h); }
}

function resize(){
  const r = stage.getBoundingClientRect();
  W = Math.max(1, r.width);
  H = Math.max(1, r.height);
  dpr = Math.min(window.devicePixelRatio || 1, 1.75) * quality;

  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  cvS.width  = Math.round(W * dpr);
  cvS.height = Math.round(H * dpr);
  ctxS.setTransform(dpr, 0, 0, dpr, 0, 0);
  makeField(canvas.width / FIELD_SCALE, canvas.height / FIELD_SCALE);
  makeScene(canvas.width, canvas.height);
  makeRoom(canvas.width, canvas.height);

  remesh(relayout(), HEIGHT_TEX_W, MAX_BLOBS);
}

const hexToRgb = hex => {
  const h = hex.trim().replace("#", "");
  const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function hslToRgb(h, s, l){
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [f(h + 1/3), f(h), f(h - 1/3)];
}

/* The chord FS_BEER absorbs along, through the axis of a house-sized glass
   (topHalf 150) at half its height: twice the bore there, 0.84 * 150 less the
   wall, times the depth term at that depth (0.99). */
const PATH_REF = 2 * (150 * (1 + 0.68) / 2 - 150 * 0.045) * 0.99;
/* How far down the scatter is calibrated, in house px; FS_BEER's haze term */
const SCAT_REF = 220;

let pal = {};
function buildPalette(){
  const room = applyRoom();
  const dark = isDark();
  const r = cfg.richness / 100;
  const clarity = cfg.clarity / 100;
  const tone = beerTone();
  const h = tone.h;

  /* The beer is a depth of colour: a film's tint and how fast each channel is
     absorbed with distance (Beer-Lambert, where blue goes first, turns a deep
     pour amber). Given a hex the two are solved the other way: the film is that
     colour lifted towards white and the absorption makes the pour read as the
     hex through the middle of the glass at half height (PATH_REF), paler at the
     walls as a pint held to the light is. Clarity is left out of that solve, so
     it cannot walk the colour off the one named. */
  const D = PATH_REF * 0.0032;
  const film = tone.rgb ? hslToRgb(h, tone.sat, Math.min(95, tone.l + 26))
                        : hslToRgb(h + 8, 92 - r * 10, 74 - r * 8);
  let lightTint = film, absorb;
  const m = (1 - clarity) * 0.60;
  const scat = 0.38 + 0.50 * Math.exp(-SCAT_REF * 0.005);
  if (tone.rgb){
    /* A murky pour passes at most this share of its film, so a bright saturated
       hex (a hazy IPA's orange) was out of reach and came out olive. The film is
       raised in that channel, past white if need be, until the hex can be met. */
    const reach = (1 - m) * 0.98 + m * scat * 0.99;
    lightTint = film.map((v, i) => Math.max(v, Math.min(1.3, tone.rgb[i] / reach)));
    /* The film through the whole path, mixed with the murk's scatter through half
       of it (FS_BEER): with y the light left after half the path,
       c = (1 - m) lt y^2 + m scat lt y. Solved for y, then for the absorption. */
    absorb = tone.rgb.map((c, i) => {
      const lt = Math.max(1e-3, lightTint[i]);
      const a = (1 - m) * lt, b = m * scat * lt;
      const y = (Math.sqrt(b * b + 4 * a * c) - b) / (2 * a);
      return -2 * Math.log(clamp(y, 0.02, 0.99)) / D;
    });
  } else {
    const base = 0.22 + r * 1.55;
    const hueShift = (44 - h) / 22;
    /* Absorbed along the chord, a pale beer has no thin top layer to show its
       pallor, so the pale end is eased off to keep a pilsner straw, not gold */
    const pale = 0.75 + 0.25 * r;
    absorb = [
      base * (0.30 + hueShift * 0.10),
      base * (0.95 + hueShift * 0.25),
      base * (2.60 + hueShift * 0.70)
    ].map(v => v * (1.35 - clarity * 0.55) * pale);
  }

  pal = {
    dark,
    ground: hexToRgb(room.ground),
    groundDeep: hexToRgb(room.deep),
    lightTint,
    aura: (() => { const a = hexHsl(cfg.auraHex);
                   return a ? hslToRgb(a.h, a.s, a.l) : film; })(),
    absorb,
    /* Foam is beer held in bubble walls: a pilsner head is bright white, a
       bock head beige. The wet band at the beer line carries the most colour. */
    foam: hslToRgb(38 + (h - 40) * 0.6, 16 + r * 20, dark ? 90 - r * 7 : 97 - r * 8),
    foamShade: hslToRgb(34 + (h - 40) * 0.5, 26 + r * 22, (dark ? 54 : 68) - r * 12),
    /* less colour the darker the beer: a stout's head is tan where it is wet,
       not orange */
    foamWet: hslToRgb(h + 4, 58 - r * 26, dark ? 74 - r * 12 : 84 - r * 14),
    foamCoarse: clamp(0.15 + (cfg.bubbleSize - 100) / 100 * 0.45 + r * 0.45
                           - (cfg.carbonation - 100) / 100 * 0.15, 0, 1),
    beerMid: hslToRgb(h + 2, 78, 54),
    /* what the body reads as at PATH_REF, haze and all: the colour a bubble
       at the back of the glass is seen through */
    beerSeen: lightTint.map((lt, i) => {
      const y = Math.exp(-absorb[i] * D / 2);
      return lt * y * y * (1 - m) + lt * scat * y * m;
    }),
    beerTint: hslToRgb(h, 72 - r * 34, 62),
    glassEdge: dark ? [0.93, 0.95, 0.96] : [0.05, 0.07, 0.10],
    glassLight: [1, 1, 1],
    glow: dark ? 0.30 : 0.18
  };
}
buildPalette();

/* ================================================================== *
 * Draw
 * ================================================================== */
/* clock, the scene's time that the murk and the grain drift by, is the
   frame loop's (core.js) */

/* Row 0 is the beer's surface, row 1 the head's raft riding on it (see
   stepHeadSurface), in one texture so the shader reads both alike. Each texel is
   a height and its change per column: centred inside, the end pair's slope at
   the ends, which heightRow carries the surface on with. */
function packHeights(a){
  const u = heightUpload, last = N - 1;
  for (let i = 0; i <= last; i++){
    u[2 * i] = a[i];
    u[2 * i + 1] = i === 0 ? a[1] - a[0]
                 : i === last ? a[last] - a[last - 1]
                 : (a[i + 1] - a[i - 1]) * 0.5;
  }
}
function uploadHeight(){
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  packHeights(hArr);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, 1, gl.RG, gl.FLOAT, heightUpload);
  packHeights(headArr || hArr);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, N, 1, gl.RG, gl.FLOAT, heightUpload);
}

function setShared(prog, pixelScale){
  const [, , w] = surfaceSpan();
  gl.uniform1i(prog.u.uHeight, 0);
  gl.uniform1f(prog.u.uCols, N);
  gl.uniform1f(prog.u.uRestY, restSurfaceY());
  gl.uniform1f(prog.u.uSpanHw, w / 2);
  gl.uniform1f(prog.u.uDpr, pixelScale);
  gl.uniform2f(prog.u.uRes, W, H);
  gl.uniform4f(prog.u.uGlassA, G.cx, G.top, G.bottom, G.h);
  gl.uniform4f(prog.u.uGlassB, G.topHalf, G.botHalf, G.wall, G.baseH);
  gl.uniform4f(prog.u.uGlassC, 0, G.inTop, G.inBottom, G.ryTop);
  gl.uniform2f(prog.u.uRyKs, ryAt(restSurfaceY()), ryAt(G.bottom));
  /* the camera's openness rule itself, so a pass can read it at any height */
  gl.uniform2f(prog.u.uRyLin, 1 / (Math.max(H, 1) * camLens), camEye / camLens);
}

/* the highest any blob of the head reaches this frame, for the foam's scissor */
let blobTop = Infinity;
function drawField(){
  blobTop = Infinity;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFBO);
  gl.viewport(0, 0, fieldW, fieldH);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (level <= 0.002){ gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  gl.useProgram(progBand.p);
  gl.bindVertexArray(vaoEmpty);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  setShared(progBand, fieldW / W);
  gl.uniform1f(progBand.u.uBand, headBand());
  gl.uniform1f(progBand.u.uTime, clock);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  let n = 0;
  for (const f of foam){
    if (n >= MAX_BLOBS) break;
    const o = n * 4;
    blobData[o]     = f.x;
    blobData[o + 1] = surfaceAt(f.x) - ellipseDy(f.x) * 0.4 + f.oy;
    blobData[o + 2] = f.r * 1.9;
    blobData[o + 3] = 0.55 + 0.40 * Math.min(1, f.r / (10 * G.scale));
    blobTop = Math.min(blobTop, blobData[o + 1] - blobData[o + 2]);
    n++;
  }
  if (n){
    gl.useProgram(progBlob.p);
    gl.bindVertexArray(blobVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, blobBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, blobData, 0, n * 4);
    gl.uniform2f(progBlob.u.uRes, W, H);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function drawSprites(){
  let n = 0;
  const push = (x, y, rx, ry, kind, alpha, far = 0) => {
    if (n >= MAX_SPRITES) return;
    const o = n * SPRITE_FLOATS;
    spriteData[o] = x; spriteData[o+1] = y; spriteData[o+2] = rx; spriteData[o+3] = ry;
    spriteData[o+4] = kind; spriteData[o+5] = alpha; spriteData[o+6] = far;
    n++;
  };
  /* z runs from -1 at the back wall to 1 at the front: a bubble further off is
     smaller, dimmed and coloured by the beer in front of it (FS_SPRITE). One
     without a z is in the middle. */
  for (const b of bubbles){
    const z = clamp(b.z || 0, -1, 1);
    const r = Math.max(0.9, b.r * (1 + 0.16 * z));
    /* every bubble has some beer in front of it; only one on the near wall
       has none */
    push(b.x, b.y, r, r, 0, 1, 0.38 * (1 - z));
  }
  for (const d of drops){
    if ((d.near || 0) >= 0) continue;
    const dr = d.r * dropScale(d);           /* nearer is bigger */
    push(d.x, d.y, Math.max(1.4, dr), Math.max(1.4, dr), 1, 1);
  }
  for (const m of mist){ if ((m.near || 0) >= 0) continue;
    push(m.x, m.y, Math.max(1, m.r * 1.6), Math.max(1, m.r * 1.6), 2, clamp(m.life, 0, 1)); }
  for (const l of lace){
    const [lx, ly, c] = lacePos(l);
    /* edge-on at the sides, and the far wall is read through the whole glass */
    push(lx, ly, Math.max(1, l.r * Math.max(0.3, Math.abs(c))), Math.max(1, l.r), 5,
         clamp(l.life / l.max, 0, 1) * (0.6 + 0.4 * (0.5 + 0.5 * c)));
  }
  for (const d of dew){
    const [dx, dy, c] = dewPos(d);
    push(dx, dy, Math.max(0.8, d.r * Math.max(0.3, Math.abs(c))), Math.max(0.8, d.r), 4,
         clamp(d.r / (1.4 * G.scale * dewScale()), 0, 1) * 0.9);
  }
  /* The ribbons and the collar are not sprites. They are solved per pixel in the
     weep pass (FS_WEEP), since a sprite cannot be clipped to the silhouette. */

  if (!n) return;

  gl.useProgram(progSprite.p);
  gl.bindVertexArray(spriteVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, spriteData, 0, n * SPRITE_FLOATS);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  setShared(progSprite, dpr);
  gl.uniform3fv(progSprite.u.uFoam, pal.foam);
  gl.uniform3fv(progSprite.u.uBeer, pal.beerMid);
  gl.uniform3fv(progSprite.u.uBeerSeen, pal.beerSeen);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
}

const weepA = new Float32Array(24), weepB = new Float32Array(24), weepC = new Float32Array(24);
function drawWeep(part){
  if (!(drips.length || (collar > 0.012 && creep > 0.004))) return;
  if (part < 0.5 && !drips.some(d => Math.cos(d.th) < 0)) return;

  gl.useProgram(progWeep.p);
  gl.bindVertexArray(vaoEmpty);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  setShared(progWeep, dpr);
  gl.uniform3fv(progWeep.u.uFoam, pal.foam);
  gl.uniform4f(progWeep.u.uWeep, collar, weepOver(), weepHem, weepDrape);
  gl.uniform3f(progWeep.u.uDrapeF, drapeF[0], drapeF[1], drapeF[2]);
  gl.uniform3f(progWeep.u.uDrapeP, drapeP[0], drapeP[1], drapeP[2]);
  gl.uniform4f(progWeep.u.uDrapeG, drapeG[0], drapeG[1], drapeG[2], drapeB);
  gl.uniform1f(progWeep.u.uWeepRun, weepRun());
  gl.uniform1f(progWeep.u.uWeepAlive, weepAlive);
  gl.uniform1f(progWeep.u.uScale, G.scale);
  gl.uniform1f(progWeep.u.uWeepA, weepAlpha());
  gl.uniform1f(progWeep.u.uTime, clock);
  gl.uniform1f(progWeep.u.uCoarse, pal.foamCoarse);
  const n = Math.min(6, drips.length);
  gl.uniform1i(progWeep.u.uRibN, n);
  if (n){
    const A = weepA, B = weepB, C = weepC;
    for (let i = 0; i < n; i++){
      const d = drips[i], o = i * 4;
      A[o] = d.th; A[o+1] = d.top; A[o+2] = d.h; A[o+3] = d.w;
      B[o] = d.r;  B[o+1] = d.wob; B[o+2] = d.wobA; B[o+3] = d.pool || 0;
      C[o] = d.life;
    }
    gl.uniform4fv(progWeep.u.uRibA, A);
    gl.uniform4fv(progWeep.u.uRibB, B);
    gl.uniform4fv(progWeep.u.uRibC, C);
  }
  gl.uniform1f(progWeep.u.uWeepPart, part);
  /* the pass composites its own layers in order and hands over one
     premultiplied colour, so the blend must not multiply by alpha again */
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  /* the shader's own bounds: the rim down to a puddle's reach, and no wider
     than the glass and the same reach again */
  const reach = Math.max(G.topHalf, G.botHalf) + 60;
  scissorPx(G.cx - reach - 1, G.top - 3, G.cx + reach + 1, G.bottom + ryAt(G.bottom) * G.botHalf + 61);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.SCISSOR_TEST);
}

/* Hold a full-screen pass to the rectangle it can draw in, in page pixels. The
   shaders discard the rest themselves, but only after each pixel has run far
   enough to find out, and the glass is a fifth of the screen. Each box is the one
   its shader already rejects outside, so nothing is drawn differently. */
function scissorPx(x0, y0, x1, y1){
  const fx0 = clamp(Math.floor(x0 * dpr), 0, sceneW), fx1 = clamp(Math.ceil(x1 * dpr), 0, sceneW);
  const fy0 = clamp(Math.floor((H - y1) * dpr), 0, sceneH), fy1 = clamp(Math.ceil((H - y0) * dpr), 0, sceneH);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(fx0, fy0, fx1 - fx0, fy1 - fy0);
}
/* The floor of the glass's interior, which is as low as the beer and the head
   can reach: the near half of its ellipse dips below the interior bottom */
const floorLow = () => G.inBottom + ryAt(G.bottom) * innerHalfAt(G.inBottom);

/* The rows the head can stand in, as FS_FOAM bounds it. Top: the highest of the
   band's field (swell reaches 1.2 bands up, FS_BAND) and the blobs on it, less
   the foam blur's reach, and no higher than the crown above the lip. Bottom: the
   near arc of the raft. The margins cover small differences from colDy. */
function headRows(){
  const band = headBand();
  let top = blobTop, bot = -Infinity;
  for (let i = 0; i < N; i++){
    const hy = colHeadY(i), dy = colDy(i);
    top = Math.min(top, hy - dy - band * 1.2 - 2.5);
    bot = Math.max(bot, hy + dy);
  }
  const rimRy = G.topHalf * G.ryTop;
  const lip = G.top + rimRy;
  const pad = 10 * G.scale + 6;
  top = Math.max(top - pad, lip - Math.max(headCrest(), rimRy) - 4);
  return [top, bot + pad];
}

function render(){
  if (!hArr || !gl || contextLost) return;
  uploadHeight();
  const lr = logoRect();

  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
  gl.viewport(0, 0, sceneW, sceneH);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.BLEND);

  /* Left empty while a card stands in place of the glass: the room below is
     drawn as it is, with nothing on the counter and nothing to reflect */
  if (!glassAway){
    drawField();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.viewport(0, 0, sceneW, sceneH);

    /* What runs down the back of the glass goes on before the beer does, so the
       pour stands in front of it and shows as much of it as it is clear enough
       to show */
    drawWeep(0);

    gl.useProgram(progBeer.p);
    gl.bindVertexArray(vaoEmpty);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, logoTex);
    setShared(progBeer, dpr);
    gl.uniform1i(progBeer.u.uField, 1);
    gl.uniform1i(progBeer.u.uLogo, 2);
    gl.uniform4f(progBeer.u.uLogoRect, lr[0], lr[1], lr[2], lr[3]);
    gl.uniform1f(progBeer.u.uLogoOn, logoReady ? LOGO_ON : 0);
    gl.uniform1f(progBeer.u.uTime, clock);
    gl.uniform1f(progBeer.u.uLevel, level);
    gl.uniform1f(progBeer.u.uBeerA, beerAlpha());
    gl.uniform1f(progBeer.u.uBeerSolid, beerSolid());
    gl.uniform3fv(progBeer.u.uLightTint, pal.lightTint);
    gl.uniform3fv(progBeer.u.uAbsorb, pal.absorb);
    gl.uniform1f(progBeer.u.uCaustics, cfg.caustics / 100 * 0.55);
    gl.uniform1f(progBeer.u.uHaze, 1 - cfg.clarity / 100);
    gl.uniform1f(progBeer.u.uScale, G.scale);
    gl.uniform1f(progBeer.u.uLightX, Math.cos(cfg.lightAngle * Math.PI / 180));
    /* Composited, not written: the back-of-glass weep is already in the sheet and
       the pour goes over it. Output is premultiplied, so no second alpha multiply. */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    scissorPx(G.cx - G.topHalf - 2, G.top - 2, G.cx + G.topHalf + 2, floorLow() + 4);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);

    /* Bubbles and anything in the air */
    drawSprites();

    /* Head */
    if (level > 0.002){
      const a = cfg.lightAngle * Math.PI / 180;
      gl.useProgram(progFoam.p);
      gl.bindVertexArray(vaoEmpty);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, heightTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      setShared(progFoam, dpr);
      gl.uniform1i(progFoam.u.uField, 1);
      gl.uniform1f(progFoam.u.uTime, clock);
      gl.uniform1f(progFoam.u.uRelief, cfg.relief / 100);
      gl.uniform1f(progFoam.u.uGloss, cfg.gloss / 100);
      gl.uniform1f(progFoam.u.uBandPx, headBand());
      gl.uniform1f(progFoam.u.uCrest, headCrest());
      gl.uniform1f(progFoam.u.uScale, G.scale);
      gl.uniform2f(progFoam.u.uLightDir, Math.cos(a), -Math.sin(a));
      gl.uniform1f(progFoam.u.uCoarse, pal.foamCoarse);
      gl.uniform3fv(progFoam.u.uFoam, pal.foam);
      gl.uniform3fv(progFoam.u.uFoamShade, pal.foamShade);
      gl.uniform3fv(progFoam.u.uFoamWet, pal.foamWet);
      gl.uniform3fv(progFoam.u.uBeerTint, pal.beerTint);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      /* two pixels past the wall at most; nothing below the near arc of the raft
         or the floor, or above the head's top, the blobs and the crown (headRows) */
      const [hy0, hy1] = headRows();
      scissorPx(G.cx - G.topHalf - 3, hy0, G.cx + G.topHalf + 3, Math.min(hy1, floorLow() + 2));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
    }

    /* The glass, in front */
    gl.useProgram(progGlass.p);
    gl.bindVertexArray(vaoEmpty);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    setShared(progGlass, dpr);
    gl.uniform3fv(progGlass.u.uEdge, pal.glassEdge);
    gl.uniform3fv(progGlass.u.uLight, pal.glassLight);
    gl.uniform3fv(progGlass.u.uBeerGlow, pal.beerSeen);
    gl.uniform1f(progGlass.u.uDark, pal.dark ? 1 : 0);
    gl.uniform1f(progGlass.u.uLightX, Math.cos(cfg.lightAngle * Math.PI / 180));
    gl.uniform1f(progGlass.u.uLevel, level);
    gl.uniform1f(progGlass.u.uBandPx, headBand());
    gl.uniform1f(progGlass.u.uBeerSolid, beerSolid());
    gl.uniform1f(progGlass.u.uLine, glassLine());
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    scissorPx(G.cx - G.topHalf - 12, G.top - 2, G.cx + G.topHalf + 12,
              G.bottom + ryAt(G.bottom) * G.botHalf + 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);

    /* The weep, in front of the glass and still in the scene, so it is over the
       lines as in the canvas and the bar reflects it. What runs down the back of
       the glass went on earlier, behind the pour, which decides how much shows. */
    drawWeep(1);
  }

  /* the bar's reflection reads the scene blurred, from its mips — made with
     the scene no longer bound for drawing into */
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.generateMipmap(gl.TEXTURE_2D);

/* Pass B: the room, with the scene texture composited in front */
  bakeRoom(lr);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  gl.useProgram(progCompose.p);
  gl.bindVertexArray(vaoEmpty);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, roomTex);
  setShared(progCompose, dpr);
  gl.uniform1i(progCompose.u.uRoom, 4);
  gl.uniform1i(progCompose.u.uScene, 1);
  gl.uniform1f(progCompose.u.uLevel, glassAway ? 0 : level);   /* no pour, no light from it */
  gl.uniform3fv(progCompose.u.uAura, pal.aura);
  gl.uniform1f(progCompose.u.uReflect, reflectAmount());
  gl.uniform1f(progCompose.u.uGlow, pal.glow);
  gl.uniform1f(progCompose.u.uDark, pal.dark ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.bindVertexArray(null);

  const css = a => "rgb(" + a[0] * 255 + "," + a[1] * 255 + "," + a[2] * 255 + ")";
  paintSplash(ctxS, css(pal.foam), css(pal.beerMid));
}

/* What loop.js runs: see the top of that file */
renderer = {render, resize, buildPalette, lost: () => contextLost};
})();
