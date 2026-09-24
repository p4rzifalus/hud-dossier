// Обработка картинки: кривая контраста → зерно → дизеринг → палитра → bloom → сканлайны.
// unit = сколько реальных пикселей в одной «единице постера» (постер шириной 1080 единиц).
(function () {
  // Матрица Байера 8×8 — порядок, в котором «включаются» точки при дизеринге.
  const BAYER8 = [0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,
    3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21].map(v => (v + 0.5) / 64);

  // Кривая: «Провал теней» отрезает тёмное в чистый чёрный, «Контраст» — S-образный изгиб.
  function buildCurve(s) {
    const curve = new Float32Array(256);
    const bp = (s.shadows / 100) * 0.55;
    const exp = 1 + (s.contrast / 100) * 2.2;
    for (let i = 0; i < 256; i++) {
      let v = (i / 255 - bp) / (1 - bp);
      v = v <= 0 ? 0 : v >= 1 ? 1 : v;
      v = v < 0.5 ? 0.5 * Math.pow(2 * v, exp) : 1 - 0.5 * Math.pow(2 * (1 - v), exp);
      curve[i] = v;
    }
    return curve;
  }

  // Размытие «коробкой» по одной оси (быстро, работает во всех браузерах).
  function blur1D(src, dst, w, h, r, horiz) {
    const n = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 1 : w, inv = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const base = horiz ? l * w : l;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[base + Math.min(n - 1, Math.max(0, k)) * step];
      for (let i = 0; i < n; i++) {
        dst[base + i * step] = acc * inv;
        acc += src[base + Math.min(n - 1, i + r + 1) * step] - src[base + Math.max(0, i - r) * step];
      }
    }
  }
  HUD.boxBlur = function (a, w, h, r, passes) {
    const tmp = new Float32Array(a.length);
    for (let p = 0; p < (passes || 3); p++) { blur1D(a, tmp, w, h, r, true); blur1D(tmp, a, w, h, r, false); }
    return a;
  };

  // Вписывает картинку в прямоугольник W×H с обрезкой краёв (как background-size: cover).
  // cx, cy — где на постере (в долях 0..1) должен оказаться центр картинки; zoom — дополнительное увеличение.
  HUD.fitCover = function (img, W, H, cx, cy, zoom) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const [iw, ih] = HUD.srcSize(img);
    const k = Math.max(W / iw, H / ih) * (zoom || 1);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, W * (cx == null ? 0.5 : cx) - (iw * k) / 2, H * (cy == null ? 0.5 : cy) - (ih * k) / 2, iw * k, ih * k);
    return c;
  };

  HUD.processImage = function (src, s, seed, unit) {
    const w = src.width, h = src.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    const img = src.getContext('2d').getImageData(0, 0, w, h);
    const d = img.data;
    const lut = HUD.buildLUT(s.colors);
    const curve = buildCurve(s);
    const g = Math.max(1, Math.round(unit));         // размер «зерна» и точки дизеринга
    const amp = (s.grain / 100) * 0.22;
    const levels = 6;
    const lum = new Uint8ClampedArray(w * h);         // итоговая яркость — пригодится для анализа и bloom

    for (let y = 0; y < h; y++) {
      const gy = (y / g) | 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, p = i * 4, gx = (x / g) | 0;
        let v = curve[(d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8];
        if (amp > 0) v += (HUD.hash2(gx, gy, seed) - 0.5) * amp * (0.2 + v);
        if (v < 0) v = 0; else if (v > 1) v = 1;
        if (s.dither) v = Math.floor(v * (levels - 1) + BAYER8[(gy & 7) * 8 + (gx & 7)]) / (levels - 1);
        const li = (v * 255 + 0.5) | 0;
        lum[i] = li;
        d[p] = lut[li * 3]; d[p + 1] = lut[li * 3 + 1]; d[p + 2] = lut[li * 3 + 2]; d[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Bloom: берём только самые яркие места, размываем (узко + широко) и прибавляем светом.
    if (s.bloomStrength > 0) {
      const f = 4, sw = Math.ceil(w / f), sh = Math.ceil(h / f);
      const thr = s.bloomThreshold / 100;
      const m1 = new Float32Array(sw * sh);
      for (let sy = 0; sy < sh; sy++) for (let sx = 0; sx < sw; sx++) {
        const v = lum[Math.min(h - 1, sy * f + 1) * w + Math.min(w - 1, sx * f + 1)] / 255;
        m1[sy * sw + sx] = v > thr ? (v - thr) / (1 - thr + 1e-6) : 0;
      }
      const m2 = Float32Array.from(m1);
      HUD.boxBlur(m1, sw, sh, Math.max(1, Math.round(3 * unit / f)));
      HUD.boxBlur(m2, sw, sh, Math.max(1, Math.round(16 * unit / f)));
      const glow = HUD.hexToRgb(s.colors[3]);
      const k = (s.bloomStrength / 100) * 1.8;
      const small = document.createElement('canvas');
      small.width = sw; small.height = sh;
      const sctx = small.getContext('2d');
      const bd = sctx.createImageData(sw, sh);
      for (let i = 0; i < sw * sh; i++) {
        const a = (m1[i] * 0.7 + m2[i] * 0.9) * k;
        bd.data[i * 4] = glow[0] * a; bd.data[i * 4 + 1] = glow[1] * a; bd.data[i * 4 + 2] = glow[2] * a;
        bd.data[i * 4 + 3] = 255;
      }
      sctx.putImageData(bd, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, 0, 0, w, h);
      ctx.restore();
    }

    // Сканлайны: тонкие тёмные полосы каждые 4 единицы.
    if (s.scanlines) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      const lh = Math.max(1, Math.round(unit));
      for (let y = 0; y < h; y += 4 * unit) ctx.fillRect(0, Math.round(y), w, lh);
    }

    return { canvas: out, lum, w, h };
  };
})();
