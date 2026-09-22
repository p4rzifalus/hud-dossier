// «Переводчик» рисования. Панели вызывают одни и те же команды (линия, прямоугольник, текст…),
// а переводчик либо рисует на холсте (превью, PNG), либо пишет SVG (векторный экспорт).
// Все координаты — в единицах постера (ширина 1080). S = сколько пикселей в одной единице.
HUD.FONT = 'HUDMono';
HUD.CHAR_W = 0.6;      // ширина символа моноширинного шрифта в долях размера
HUD.ASCENT = 0.78;     // от верха строки до базовой линии

HUD.loadFont = async function () {
  const bin = atob(HUD.FONT_B64), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const ff = new FontFace(HUD.FONT, buf.buffer);
  document.fonts.add(ff);
  return ff.load();
};

HUD.textWidth = (str, size) => String(str).length * size * HUD.CHAR_W;

// ---------- Холст ----------
HUD.CanvasDraw = function (ctx, S) {
  this.S = S;
  const snapOff = (w) => (Math.round(w * S) % 2) * 0.5;
  const snap = (v, w) => (Math.round(v * S - snapOff(w)) + snapOff(w)) / S;
  const stroke = (st) => {
    ctx.strokeStyle = st.c; ctx.globalAlpha = st.a == null ? 1 : st.a;
    ctx.lineWidth = st.w || 1; ctx.setLineDash(st.dash || []);
  };
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';

  this.line = (x1, y1, x2, y2, st) => {
    const w = st.w || 1;
    if (x1 === x2) x1 = x2 = snap(x1, w);
    if (y1 === y2) y1 = y2 = snap(y1, w);
    stroke(st); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  this.rect = (x, y, w, h, st) => {
    if (st.fill) { ctx.globalAlpha = st.fa == null ? 1 : st.fa; ctx.fillStyle = st.fill; ctx.fillRect(x, y, w, h); }
    if (st.c) {
      const lw = st.w || 1, x1 = snap(x, lw), y1 = snap(y, lw);
      stroke(st); ctx.strokeRect(x1, y1, snap(x + w, lw) - x1, snap(y + h, lw) - y1);
    }
  };
  this.poly = (pts, st) => {
    if (pts.length < 4) return;
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (st.close) ctx.closePath();
    if (st.fill) { ctx.globalAlpha = st.fa == null ? 1 : st.fa; ctx.fillStyle = st.fill; ctx.fill(); }
    if (st.c) { stroke(st); ctx.stroke(); }
  };
  this.circle = (cx, cy, r, st) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (st.fill) { ctx.globalAlpha = st.fa == null ? 1 : st.fa; ctx.fillStyle = st.fill; ctx.fill(); }
    if (st.c) { stroke(st); ctx.stroke(); }
  };
  this.text = (str, x, y, st) => {
    const size = st.size || 6;
    ctx.globalAlpha = st.a == null ? 1 : st.a; ctx.fillStyle = st.c;
    ctx.font = `${size}px ${HUD.FONT}`; ctx.textBaseline = 'alphabetic';
    const w = HUD.textWidth(str, size);
    const x0 = st.align === 'right' ? x - w : st.align === 'center' ? x - w / 2 : x;
    ctx.textAlign = 'left';
    ctx.fillText(String(str), x0, y + size * HUD.ASCENT);
  };
  this.image = (canvas, x, y, w, h, st) => {
    ctx.globalAlpha = st && st.a != null ? st.a : 1;
    ctx.imageSmoothingEnabled = !(st && st.pixelated);
    ctx.drawImage(canvas, x, y, w, h);
  };
  // Много отрезков одним путём: segs = [[[x1,y1],[x2,y2]], ...]
  this.segs = (segs, st) => {
    stroke(st); ctx.beginPath();
    for (const [a, b] of segs) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
  };
  // Много квадратных точек: pts = [x,y, x,y, ...]
  this.dots = (pts, size, st) => {
    ctx.globalAlpha = st.a == null ? 1 : st.a; ctx.fillStyle = st.c;
    for (let i = 0; i < pts.length; i += 2) ctx.fillRect(pts[i] - size / 2, pts[i + 1] - size / 2, size, size);
  };
  this.clip = (x, y, w, h) => { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); };
  this.unclip = () => ctx.restore();
  this.done = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.setLineDash([]); };
};

// ---------- SVG ----------
HUD.SvgDraw = function (S) {
  this.S = S;           // разрешение растровых вставок (увеличенных фрагментов)
  const out = [];
  let clipN = 0;
  const f = (v) => Math.round(v * 100) / 100;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const strokeAttr = (st) => st.c
    ? ` stroke="${st.c}" stroke-width="${st.w || 1}"${st.a != null && st.a < 1 ? ` stroke-opacity="${f(st.a)}"` : ''}${st.dash ? ` stroke-dasharray="${st.dash.join(' ')}"` : ''}`
    : '';
  const fillAttr = (st) => st.fill
    ? ` fill="${st.fill}"${st.fa != null && st.fa < 1 ? ` fill-opacity="${f(st.fa)}"` : ''}`
    : ' fill="none"';

  this.line = (x1, y1, x2, y2, st) => out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"${strokeAttr(st)}/>`);
  this.rect = (x, y, w, h, st) => out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${fillAttr(st)}${strokeAttr(st)}/>`);
  this.poly = (pts, st) => {
    if (pts.length < 4) return;
    const p = []; for (let i = 0; i < pts.length; i += 2) p.push(f(pts[i]) + ',' + f(pts[i + 1]));
    out.push(`<${st.close ? 'polygon' : 'polyline'} points="${p.join(' ')}"${fillAttr(st)}${strokeAttr(st)}/>`);
  };
  this.circle = (cx, cy, r, st) => out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${fillAttr(st)}${strokeAttr(st)}/>`);
  this.text = (str, x, y, st) => {
    const size = st.size || 6;
    const anchor = st.align === 'right' ? 'end' : st.align === 'center' ? 'middle' : 'start';
    out.push(`<text x="${f(x)}" y="${f(y + size * HUD.ASCENT)}" font-size="${size}" text-anchor="${anchor}" fill="${st.c}"${st.a != null && st.a < 1 ? ` fill-opacity="${f(st.a)}"` : ''} xml:space="preserve">${esc(str)}</text>`);
  };
  this.image = (canvas, x, y, w, h, st) => out.push(`<image x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${st && st.a != null && st.a < 1 ? ` opacity="${f(st.a)}"` : ''}${st && st.pixelated ? ' style="image-rendering:pixelated"' : ''} preserveAspectRatio="none" href="${canvas.toDataURL('image/png')}"/>`);
  this.segs = (segs, st) => {
    if (!segs.length) return;
    out.push(`<path d="${segs.map(([a, b]) => `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`).join('')}" fill="none"${strokeAttr(st)}/>`);
  };
  this.dots = (pts, size, st) => {
    if (!pts.length) return;
    let p = '';
    for (let i = 0; i < pts.length; i += 2) p += `M${f(pts[i] - size / 2)} ${f(pts[i + 1] - size / 2)}h${f(size)}v${f(size)}h${f(-size)}z`;
    out.push(`<path d="${p}" fill="${st.c}"${st.a != null && st.a < 1 ? ` fill-opacity="${f(st.a)}"` : ''}/>`);
  };
  this.clip = (x, y, w, h) => {
    const id = 'c' + (++clipN);
    out.push(`<clipPath id="${id}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/></clipPath><g clip-path="url(#${id})">`);
  };
  this.unclip = () => out.push('</g>');
  this.done = () => {};

  this.toString = (W, H, bgHref) => [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<style>@font-face{font-family:'${HUD.FONT}';src:url(data:font/woff2;base64,${HUD.FONT_B64}) format('woff2');}text{font-family:'${HUD.FONT}','IBM Plex Mono',monospace;}</style>`,
    `<rect width="${W}" height="${H}" fill="#000"/>`,
    bgHref ? `<image id="photo" width="${W}" height="${H}" preserveAspectRatio="none" href="${bgHref}"/>` : '',
    `<g id="hud">`, out.join('\n'), `</g></svg>`,
  ].join('\n');
};
