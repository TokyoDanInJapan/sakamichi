"use strict";


/* ================================================================== *
 * Configuration
 * ================================================================== */
const SPECS = [
  {key:"fill",       label:"Fill line",   min:0,   max:100, step:1, unit:"%",  group:null},
  {key:"refill",     label:"Refill rate", min:0,   max:100, step:1, unit:"",   group:null},
  {key:"agitation",  label:"Agitation",   min:0,   max:200, step:5, unit:"%",  group:"Motion"},
  {key:"waveSpeed",  label:"Wave speed",  min:0,   max:100, step:1, unit:"",   group:null},
  {key:"viscosity",  label:"Viscosity",   min:0,   max:100, step:1, unit:"",   group:null},
  {key:"carbonation",label:"Carbonation", min:0,   max:200, step:5, unit:"%",  group:"Carbonation"},
  {key:"bubbleSize", label:"Bubble size", min:20,  max:220, step:5, unit:"%",  group:null},
  {key:"bubbleBreak",label:"Bubble break",min:0,   max:200, step:5, unit:"%",  group:null},
  {key:"headDepth",  label:"Head depth",  min:0,   max:200, step:5, unit:"%",  group:"Head"},
  {key:"foamChurn",  label:"Foam churn",  min:0,   max:200, step:5, unit:"%",  group:null},
  {key:"weep",       label:"Weep",        min:0,   max:200, step:5, unit:"%",  group:null},
  {key:"weepAlpha",  label:"Weep opacity",min:0,   max:100, step:1, unit:"%",  group:null},
  {key:"glassSize",  label:"Glass size",  min:60,  max:130, step:1, unit:"%",  group:"Glass"},
  {key:"glassLine",  label:"Glass lines", min:0,   max:100, step:1, unit:"",   group:null},
  {key:"reflect",    label:"Reflection",  min:0,   max:200, step:5, unit:"%",  group:null},
  {key:"relief",     label:"Foam relief", min:0,   max:200, step:5, unit:"%",  group:null},
  {key:"condensation",label:"Condensation",min:0,  max:200, step:5, unit:"%",  group:null},
  {key:"dewSize",    label:"Bead size",   min:20,  max:220, step:5, unit:"%",  group:null},
  {key:"hue",        label:"Beer hue",    min:22,  max:50,  step:1, unit:"°",  group:"Colour"},
  {key:"beerHex",    label:"Beer colour", type:"hex", unit:"", group:null},
  {key:"richness",   label:"Richness",    min:0,   max:100, step:1, unit:"",   group:null},
  {key:"beerAlpha",  label:"Beer opacity",min:0,   max:200, step:5, unit:"%",  group:null},
  {key:"bgHue",      label:"Room hue",    min:0,   max:360, step:1, unit:"°",  group:null},
  {key:"roomHex",    label:"Room colour", type:"hex", unit:"", group:null},
  {key:"auraHex",    label:"Aura colour", type:"hex", unit:"", group:null},
  {key:"clarity",    label:"Clarity",     min:0,   max:100, step:1, unit:"",   group:null},
  {key:"caustics",   label:"Caustics",    min:0,   max:200, step:5, unit:"%",  group:"Optics"},
  {key:"lightAngle", label:"Light angle", min:0,   max:180, step:1, unit:"°",  group:null},
  {key:"gloss",      label:"Gloss",       min:0,   max:100, step:1, unit:"",   group:null}
];

const HOUSE = {
  fill:100, refill:32, agitation:100, waveSpeed:46, viscosity:40,
  carbonation:100, bubbleSize:100, bubbleBreak:100, headDepth:100,
  foamChurn:100, weep:100, weepAlpha:100,
  glassSize:100, glassLine:100, reflect:100, relief:100, condensation:70, dewSize:100, hue:40, richness:46,
  beerAlpha:100, bgHue:220, beerHex:null, roomHex:null, auraHex:null, clarity:70,
  caustics:100, lightAngle:62, gloss:55
};

/* A style is the whole recipe, not a colour and a hint. Choosing one sets
   everything the beer itself decides — how dark it is and how much light it
   stops, how it carbonates and how its head stands, how thick it runs and how
   readily it weeps — and leaves alone the things you decide: how full the
   glass is, how hard you are stirring it, how big it is drawn.

   A stout stops light altogether and a sour is nearly clear; that is the same
   slider at two ends of its travel, and a style that set the colour but not
   the opacity was only half a style. */
const PRESETS = {
  pilsner: {hue:45, richness:22, beerAlpha:115, carbonation:145, bubbleSize:75, bubbleBreak:125, headDepth:135, foamChurn:130, weep:110, waveSpeed:56, viscosity:24, condensation:110, dewSize:90, clarity:92, caustics:155},
  helles:  {hue:40, richness:46, beerAlpha:140, carbonation:100, bubbleSize:100, bubbleBreak:100, headDepth:100, foamChurn:100, weep:100, waveSpeed:46, viscosity:40, condensation:70, dewSize:100, clarity:70, caustics:100},
  bock:    {hue:25, richness:92, beerAlpha:190, carbonation:60, bubbleSize:135, bubbleBreak:70, headDepth:70, foamChurn:60, weep:70, waveSpeed:34, viscosity:66, condensation:45, dewSize:115, clarity:34, caustics:55},
  stout:   {hue:24, beerHex:"#2a1409", richness:100, beerAlpha:200, carbonation:42, bubbleSize:150, bubbleBreak:55, headDepth:135, foamChurn:40, weep:90, waveSpeed:28, viscosity:82, condensation:35, dewSize:120, clarity:8, caustics:15},
  hazy:    {hue:38, beerHex:"#e9a83f", richness:58, beerAlpha:175, carbonation:85, bubbleSize:105, bubbleBreak:95, headDepth:115, foamChurn:95, weep:105, waveSpeed:42, viscosity:54, condensation:80, dewSize:100, clarity:14, caustics:45},
  red:     {hue:26, beerHex:"#9d3312", richness:74, beerAlpha:165, carbonation:78, bubbleSize:118, bubbleBreak:85, headDepth:95, foamChurn:78, weep:85, waveSpeed:39, viscosity:58, condensation:55, dewSize:105, clarity:56, caustics:80},
  sour:    {hue:44, beerHex:"#cf5566", richness:28, beerAlpha:100, carbonation:135, bubbleSize:78, bubbleBreak:130, headDepth:55, foamChurn:70, weep:60, waveSpeed:54, viscosity:26, condensation:95, dewSize:85, clarity:92, caustics:140}
};


const STORE_KEY = "sakamichi-shader-v2";
const cfg = Object.assign({}, HOUSE, {tilt:false, theme:"auto", running:true,
                                     counter:"polished", preset:"helles"});

try{
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  if (saved && typeof saved === "object") Object.assign(cfg, saved);
}catch(e){ /* storage unavailable — house recipe it is */ }

/* Deep links: ?theme=dark&fill=95&hue=28&panel=1 */
const params = new URLSearchParams(location.search);
for (const s of SPECS){
  if (params.has(s.key)){
    const v = Number(params.get(s.key));
    if (Number.isFinite(v)) cfg[s.key] = Math.min(s.max, Math.max(s.min, v));
  }
}
if (params.has("theme")) cfg.theme = params.get("theme");

/* Which sliders demand a palette rebuild in this renderer */
/* How much of the counter one tile of timber covers, in camera heights */
const WOOD_TILES = 0.34;
const PALETTE_KEYS = ["hue", "richness", "clarity", "bubbleSize", "carbonation", "bgHue"];
