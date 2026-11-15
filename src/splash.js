/* paintSplash: what has left the glass towards the eye, drawn in Canvas 2D on
   the sheet that lies over the beer card. Both renderers call it at the end of
   a frame. Inlined after the simulation, whose drops, mist and puddles it
   draws. */
"use strict";

/* What has left the glass towards the eye, painted on a sheet over the card, so
   a splash passes in front of it. The sheet cannot be the whole picture
   stacked over the card, as both renderers lay the room and bar across the
   entire frame and that would hide the card. Drops thrown to the back belong
   behind the glass and are painted there. The two colours are handed in
   because the renderers hold their palettes differently (canvas colours or
   shader numbers). */
/* The sheet is page-sized and most frames put nothing on it, so it is cleared
   only when the last frame drew something. */
let splashDirty = true;
function paintSplash(ctx, foamCol, beerCol){
  const seen = p => (p.near || 0) >= 0;
  const any = puddles.length > 0 || drops.some(seen) || mist.some(seen);
  if (!any && !splashDirty) return;
  splashDirty = any;
  ctx.clearRect(0, 0, W, H);
  /* Puddles from condensation at the foot of the glass, flattened like everything
     on the bar and clipped to outside the glass's footprint, as the glass stands
     on the same bar in front of them. Painted before the spray, as a bead in the
     air is nearer than a mark on the counter. */
  if (puddles.length){
    const hw = Math.max(1, G.botHalf), ry = Math.max(1, baseBulge());
    const outside = new Path2D();
    outside.rect(0, 0, W, H);
    outside.ellipse(G.cx, G.bottom, hw, ry, 0, 0, TAU);
    ctx.save();
    ctx.clip(outside, "evenodd");
    for (const p of puddles){
      /* It holds and then fades over the last seconds, rather than thinning from
         the moment it lands. */
      const fade = clamp(p.life / 4, 0, 1);
      const squash = Math.max(0.16, ry / hw);        /* the bar's own foreshortening */
      /* Water is only the light it catches. Beer and foam have a colour. None is
         opaque, since a film lets the counter show through. */
      const col = p.kind === "beer" ? beerCol : p.kind === "foam" ? foamCol : "rgba(255,255,255,1)";
      ctx.beginPath();
      const STEP = 16;
      for (let k = 0; k <= STEP; k++){
        const a = k / STEP * TAU;
        const rr = p.r * (1 + p.a1 * Math.sin(a * 2 + p.p1) + p.a2 * Math.sin(a * 3 + p.p2));
        const px2 = p.x + rr * Math.cos(a), py2 = p.y + rr * squash * Math.sin(a);
        if (k) ctx.lineTo(px2, py2); else ctx.moveTo(px2, py2);
      }
      ctx.closePath();
      ctx.globalAlpha = fade * (p.kind === "water" ? 0.13 : 0.20);
      ctx.fillStyle = col;
      ctx.fill();
      /* Only water gets an outline, as without it there is nothing of it to see.
         Outlined beer and foam read as solid coins rather than spills. */
      if (p.kind === "water"){
        ctx.globalAlpha = fade * 0.20;
        ctx.lineWidth = Math.max(0.5, p.r * 0.07);
        ctx.strokeStyle = "rgba(255,255,255,1)";
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  for (const d of drops){
    if ((d.near || 0) < 0) continue;
    const dr = d.r * dropScale(d);
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, dr, dr * (1 + clamp(Math.abs(d.vy) / (900 * G.scale), 0, 0.6)), 0, 0, TAU);
    ctx.fillStyle = d.foamy ? foamCol : beerCol;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(d.x - dr * 0.3, d.y - dr * 0.4, dr * 0.3, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.fill();
  }
  for (const m of mist){
    if ((m.near || 0) < 0) continue;
    ctx.globalAlpha = clamp(m.life, 0, 1) * 0.5;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, TAU);
    ctx.fillStyle = foamCol;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
