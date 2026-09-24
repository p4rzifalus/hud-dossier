// Генераторы панелей и сборка всего интерфейсного слоя.
// Каждый тип панели: fit(w, h) — насколько панель такого размера ему подходит (0 = не подходит),
// draw(P, p, r, rng, tg) — рисует содержимое в прямоугольнике r (внутренняя область панели).
(function () {
  const LH = 7.5;                       // высота строки текста
  const pad = (n, k) => String(Math.round(n)).padStart(k, '0');
  const f3 = (v) => v.toFixed(3).replace(/^0/, '');
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cols = (w, size) => Math.floor(w / ((size || 6) * HUD.CHAR_W));

  // Анимация (только для видео/камеры): P.t — время в секундах, P.anim — 'off' | 'calm' | 'active'.
  // Всё движение считается из времени и seed, без случайности — поэтому экспорт повторяет превью.
  const live = (P) => P.t != null;
  const AN = (P) => (!live(P) ? 0 : P.anim === 'active' ? 2 : P.anim === 'calm' ? 1 : 0);

  // Прямоугольник-источник вписывается в r с сохранением пропорций.
  function fitMap(src, r) {
    const k = Math.min(r.w / src.w, r.h / src.h);
    const ox = r.x + (r.w - src.w * k) / 2, oy = r.y + (r.h - src.h * k) / 2;
    return { k, map: (x, y) => [ox + (x - src.x) * k, oy + (y - src.y) * k] };
  }
  function padRect(r, p, W, H) {
    const x = Math.max(0, r.x - p), y = Math.max(0, r.y - p);
    return { x, y, w: Math.min(W, r.x + r.w + p) - x, h: Math.min(H, r.y + r.h + p) - y };
  }

  // ---------- 1. Увеличенный фрагмент ----------
  function drawCrop(P, p, r) {
    const { d, col, la } = P, roi = p.roi, ih = r.h - 9, S = d.S;
    const cw = Math.max(1, Math.round(r.w * S)), ch = Math.max(1, Math.round(ih * S));
    const c = mk(cw, ch), cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    const k = P.imgS;
    cx.drawImage(P.proc.canvas, roi.x * k, roi.y * k, roi.w * k, roi.h * k, 0, 0, cw, ch);
    if (p.variant !== 'plain') {
      const id = cx.getImageData(0, 0, cw, ch), px = id.data;
      const lum = new Uint8Array(cw * ch);
      for (let i = 0; i < cw * ch; i++) lum[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
      const hi = HUD.hexToRgb(col.acc), mid = HUD.hexToRgb(col.mid);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = y * cw + x, v = lum[i];
        let out;
        if (p.variant === 'threshold') out = v > 115 ? hi : v > 60 ? mid : null;
        else {
          const g = Math.abs(v - lum[y * cw + Math.min(cw - 1, x + 1)]) + Math.abs(v - lum[Math.min(ch - 1, y + 1) * cw + x]);
          out = g > 28 ? hi : g > 12 ? mid : null;
        }
        px[i * 4] = out ? out[0] : 0; px[i * 4 + 1] = out ? out[1] : 0; px[i * 4 + 2] = out ? out[2] : 0;
      }
      cx.putImageData(id, 0, 0);
    }
    d.image(c, r.x, r.y, r.w, ih, {});
    d.rect(r.x, r.y, r.w, ih, { c: col.hi, a: la * 0.5 });
    // прицел и шкала по краям
    const mx = r.x + r.w / 2, my = r.y + ih / 2, st = { c: col.hi, a: 0.8 };
    d.line(mx - 7, my, mx - 2, my, st); d.line(mx + 2, my, mx + 7, my, st);
    d.line(mx, my - 7, mx, my - 2, st); d.line(mx, my + 2, mx, my + 7, st);
    for (let i = 1; i < 10; i++) {
      const x = r.x + (r.w * i) / 10, y = r.y + (ih * i) / 10, l = i === 5 ? 4 : 2;
      d.line(x, r.y, x, r.y + l, st); d.line(r.x, y, r.x + l, y, st);
    }
    const vl = { plain: 'RAW', threshold: 'THR .45', edges: 'EDGE Δ' }[p.variant];
    const trk = AN(P) && Math.floor(P.t * 2) % 2 === 0 ? ' ● TRK' : '';
    d.text(`ROI-${pad(p.roiN, 2)} ×${p.zoom.toFixed(1)}${trk}`, r.x, r.y + ih + 2, { size: 5.5, c: col.acc });
    d.text(`${pad(roi.x, 4)},${pad(roi.y, 4)} ${vl}`, r.x + r.w, r.y + ih + 2, { size: 5.5, c: col.hi, a: 0.7, align: 'right' });
  }

  // ---------- 2. Гистограмма ----------
  function drawHist(P, p, r, rng) {
    const { d, col, la, A } = P, bins = 64, b = new Float64Array(bins);
    for (let i = 0; i < 256; i++) b[i >> 2] += A.hist[i];
    let max = 1e-9; for (let i = 1; i < bins; i++) max = Math.max(max, b[i]);
    const ch = r.h - 8, bw = r.w / bins, base = r.y + ch;
    const bars = rng.chance(0.65);
    for (let q = 1; q < 4; q++) d.line(r.x, r.y + (ch * q) / 4, r.x + r.w, r.y + (ch * q) / 4, { c: col.hi, a: la * 0.15 });
    const pts = [];
    for (let i = 0; i < bins; i++) {
      const v = Math.min(1, Math.sqrt(b[i] / max));
      if (i === 0) { d.rect(r.x, r.y, Math.max(1, bw - 0.6), ch, { c: col.hi, a: la * 0.5, dash: [1, 1.5] }); continue; }
      if (bars) d.rect(r.x + i * bw + 0.2, base - v * ch * 0.95, Math.max(0.5, bw - 0.7), v * ch * 0.95, { fill: col.acc, fa: 0.85 });
      pts.push(r.x + (i + 0.5) * bw, base - v * ch * 0.95);
    }
    if (!bars) { d.poly([r.x + bw, base, ...pts, r.x + r.w, base], { fill: col.acc, fa: 0.15, close: true }); d.poly(pts, { c: col.acc, a: 1 }); }
    // накопленная кривая
    const cdf = []; let acc = 0;
    for (let i = 0; i < 256; i += 4) { acc += b[i >> 2]; cdf.push(r.x + (i / 255) * r.w, base - (acc / A.n) * ch); }
    d.poly(cdf, { c: col.hi, a: la * 0.5, dash: [2, 1.5] });
    d.line(r.x, base, r.x + r.w, base, { c: col.hi, a: la });
    [0, 64, 128, 192, 255].forEach((v) => {
      const x = r.x + (v / 255) * r.w;
      d.line(x, base, x, base + 2, { c: col.hi, a: la });
      d.text(String(v), Math.min(r.x + r.w, Math.max(r.x, x)), base + 2.5, { size: 5, c: col.hi, a: 0.6, align: v === 0 ? 'left' : v === 255 ? 'right' : 'center' });
    });
    const mx = r.x + A.mean * r.w;
    d.line(mx, r.y, mx, base, { c: col.hi, a: 0.9, dash: [1.5, 1.5] });
    d.text(`μ${f3(A.mean)}`, mx + 2, r.y + 1, { size: 5, c: col.hi, a: 0.9 });
    d.text(`σ${f3(A.sigma)} P95 ${f3(A.pct(0.95))} VOID ${(A.darkRatio * 100).toFixed(0)}%`, r.x + r.w, r.y + 1, { size: 5, c: col.acc, a: 0.9, align: 'right' });
  }

  // ---------- 3. Профиль яркости ----------
  function drawProfile(P, p, r) {
    const { d, col, la, A } = P, vert = p.scan.vert;
    const data = vert ? A.colProfile(p.scan.pos) : A.rowProfile(p.scan.pos);
    const n = data.length, lab = 8;
    const R = vert ? { x: r.x, y: r.y, w: r.w, h: r.h - lab } : { x: r.x, y: r.y, w: r.w, h: r.h - lab };
    const len = vert ? R.h : R.w, amp = vert ? R.w : R.h;
    const pt = (t, v) => vert ? [R.x + v * amp * 0.92, R.y + t * len] : [R.x + t * len, R.y + R.h - v * amp * 0.92];
    for (let q = 1; q < 4; q++) {
      const a = pt(0, q / 4), b = pt(1, q / 4);
      d.line(a[0], a[1], b[0], b[1], { c: col.hi, a: la * 0.15 });
    }
    for (let q = 0; q <= 10; q++) {
      const a = pt(q / 10, 0), b = vert ? [a[0] + 2, a[1]] : [a[0], a[1] - 2];
      d.line(a[0], a[1], b[0], b[1], { c: col.hi, a: la });
    }
    const pts = [], fill = [...pt(0, 0)];
    data.forEach((v, i) => { const q = pt(i / (n - 1), Math.min(1, v)); pts.push(...q); fill.push(...q); });
    fill.push(...pt(1, 0));
    d.poly(fill, { fill: col.acc, fa: 0.12, close: true });
    d.poly(pts, { c: col.acc, a: 1 });
    const a0 = pt(0, 0), a1 = pt(1, 0);
    d.line(a0[0], a0[1], a1[0], a1[1], { c: col.hi, a: la });
    // три самых высоких пика
    const peaks = [];
    for (let i = 2; i < n - 2; i++) if (data[i] >= data[i - 1] && data[i] >= data[i + 1] && data[i] > 0.05) peaks.push(i);
    peaks.sort((a, b) => data[b] - data[a]);
    const chosen = [];
    for (const i of peaks) { if (chosen.every((j) => Math.abs(j - i) > n / 8)) chosen.push(i); if (chosen.length === 3) break; }
    chosen.forEach((i, k) => {
      const q = pt(i / (n - 1), Math.min(1, data[i]));
      d.circle(q[0], q[1], 1.5, { c: col.hi, a: 1 });
      d.text(`P${k + 1} ${f3(data[i])}`, q[0] + (vert ? 3 : 2), q[1] - (vert ? 2 : 7), { size: 5, c: col.hi, a: 0.85 });
    });
    if (AN(P)) {   // бегущий курсор по кривой
      const tt = (P.t * 0.12 * AN(P)) % 1, i = Math.min(n - 1, Math.floor(tt * n));
      const a = pt(tt, 0), b = pt(tt, 1), q = pt(tt, Math.min(1, data[i]));
      d.line(a[0], a[1], b[0], b[1], { c: col.hi, a: la * 0.6, dash: [1, 1.5] });
      d.text(f3(data[i]), q[0] + 2, q[1] - 7, { size: 5, c: col.acc });
    }
    d.text(`${vert ? 'X' : 'Y'}=${pad(p.scan.pos, 4)} LUMA`, r.x, r.y + r.h - 6, { size: 5.5, c: col.acc });
    d.text(`n=${n} Δ${f3(Math.max(...data) - Math.min(...data))}`, r.x + r.w, r.y + r.h - 6, { size: 5.5, c: col.hi, a: 0.7, align: 'right' });
  }

  // ---------- 4. Контурная карта / карта краёв ----------
  function drawContour(P, p, r, rng) {
    const { d, col, la, A } = P;
    const region = padRect(A.bbox, 16, A.W, A.H);
    const { k, map } = fitMap(region, r);
    d.clip(r.x, r.y, r.w, r.h);
    if (p.variant === 'edges') {
      const pts = [];
      for (let y = 0; y < A.gh; y++) for (let x = 0; x < A.gw; x++) {
        if (A.E[y * A.gw + x] <= A.edgeThr * 0.8) continue;
        const X = (x + 0.5) * A.CELL, Y = (y + 0.5) * A.CELL;
        if (X < region.x || Y < region.y || X > region.x + region.w || Y > region.y + region.h) continue;
        pts.push(...map(X, Y));
      }
      d.dots(pts, Math.max(0.5, A.CELL * k * 0.7), { c: col.acc, a: 0.9 });
    } else {
      const nl = p.levels;
      const levels = []; for (let i = 0; i < nl; i++) levels.push(0.05 + (0.75 * i) / (nl - 1));
      const key = levels.join(',');
      A._cc = A._cc || {};
      const segs = A._cc[key] || (A._cc[key] = A.contours(levels));
      segs.forEach((ls, li) => d.segs(ls.map(([a, b]) => [map(a[0], a[1]), map(b[0], b[1])]),
        { c: li >= nl - 2 ? col.acc : col.hi, a: 0.3 + (0.7 * li) / nl }));
    }
    d.unclip();
    d.text(p.variant === 'edges' ? `SOBEL T${f3(A.edgeThr / A.emax)}` : `ISO ×${p.levels} Δ${f3(0.75 / (p.levels - 1))}`, r.x + 1, r.y + r.h - 6, { size: 5, c: col.acc });
    d.text(`${Math.round(region.w)}×${Math.round(region.h)}`, r.x + r.w - 1, r.y + r.h - 6, { size: 5, c: col.hi, a: 0.6, align: 'right' });
  }

  // ---------- 5. Узловой граф ----------
  function drawGraph(P, p, r, rng) {
    const { d, col, la, A } = P;
    const region = padRect(A.bbox, 10, A.W, A.H);
    const { map } = fitMap(region, { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 12 });
    const pool = A.nodes.slice(0, 260);
    const N = Math.min(pool.length, Math.max(12, Math.min(70, Math.round((r.w * r.h) / 320))));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const nodes = pool.slice(0, N).map((n) => ({ n, q: map(n.x, n.y) }));
    const segs = [], seen = new Set();
    nodes.forEach((a, i) => {
      nodes.map((b, j) => [j, (a.q[0] - b.q[0]) ** 2 + (a.q[1] - b.q[1]) ** 2]).filter(([j]) => j !== i)
        .sort((x, y) => x[1] - y[1]).slice(0, 2).forEach(([j]) => {
          const key = i < j ? i + '-' + j : j + '-' + i;
          if (!seen.has(key)) { seen.add(key); segs.push([a.q, nodes[j].q]); }
        });
    });
    d.segs(segs, { c: col.hi, a: la * 0.5 });
    d.dots(nodes.flatMap((x) => x.q), 2, { c: col.acc, a: 1 });
    nodes.slice(0, Math.min(5, nodes.length)).forEach((x, i) => d.text('n' + pad(i + 1, 2), x.q[0] + 2, x.q[1] - 6, { size: 5, c: col.hi, a: 0.75 }));
    if (nodes.length) { const h = nodes[0].q; d.circle(h[0], h[1], 4, { c: col.acc, a: 1 }); }
    d.text(`N=${nodes.length} E=${segs.length}`, r.x + 1, r.y + r.h - 6, { size: 5, c: col.acc });
    d.text(`k=2 NN`, r.x + r.w - 1, r.y + r.h - 6, { size: 5, c: col.hi, a: 0.6, align: 'right' });
  }

  // ---------- 6. Сетка глифов ----------
  function glyph(d, x, y, s, rng, c, a) {
    const m = s * 0.2, q = s - 2 * m, cx = x + s / 2, cy = y + s / 2, st = { c, a, w: 1 };
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      switch (rng.pick(['ring', 'dot', 'hline', 'vline', 'cross', 'plus', 'box', 'tri', 'arc', 'bars', 'corner', 'ring'])) {
        case 'ring': d.circle(cx, cy, q * rng.range(0.2, 0.5), st); break;
        case 'dot': d.circle(cx + rng.range(-q, q) * 0.3, cy + rng.range(-q, q) * 0.3, Math.max(0.8, q * 0.1), { fill: c, fa: a }); break;
        case 'hline': { const yy = y + m + q * rng.range(0.1, 0.9); d.line(x + m, yy, x + s - m, yy, st); break; }
        case 'vline': { const xx = x + m + q * rng.range(0.1, 0.9); d.line(xx, y + m, xx, y + s - m, st); break; }
        case 'cross': d.line(x + m, y + m, x + s - m, y + s - m, st); d.line(x + s - m, y + m, x + m, y + s - m, st); break;
        case 'plus': d.line(cx, y + m, cx, y + s - m, st); d.line(x + m, cy, x + s - m, cy, st); break;
        case 'box': { const k = rng.range(0.4, 1); d.rect(cx - (q * k) / 2, cy - (q * k) / 2, q * k, q * k, st); break; }
        case 'tri': d.poly([cx, y + m, x + s - m, y + s - m, x + m, y + s - m], { ...st, close: true }); break;
        case 'arc': { const pts = [], rr = q * 0.45, o = rng.int(0, 3) * Math.PI / 2;
          for (let t = 0; t <= 8; t++) { const an = o + (t / 8) * Math.PI; pts.push(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr); }
          d.poly(pts, st); break; }
        case 'bars': { const k = rng.int(2, 3); for (let j = 0; j < k; j++) { const yy = y + m + (q * (j + 0.5)) / k; d.line(x + m, yy, x + m + q * rng.range(0.4, 1), yy, st); } break; }
        case 'corner': d.poly([x + m, y + m + q * 0.6, x + m, y + s - m, x + m + q * 0.6, y + s - m], st); break;
      }
    }
  }
  function drawGlyphs(P, p, r, rng) {
    const { d, col, la } = P;
    const opts = [[4, 6], [6, 4], [6, 8], [8, 6], [3, 5], [5, 3], [2, 4], [4, 2], [4, 4]];
    let best = null, bs = 1e9;
    opts.forEach(([c, rw]) => {
      const s = Math.min(r.w / c, r.h / rw);
      const sc = Math.abs(s - 13) + (s < 8 ? 50 : 0) + (1 - (c * rw * s * s) / (r.w * r.h)) * 20;
      if (sc < bs) { bs = sc; best = [c, rw, s]; }
    });
    const [nc, nr, s] = best;
    const ox = r.x + (r.w - nc * s) / 2, oy = r.y + (r.h - nr * s) / 2;
    for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
      let inv = rng.chance(0.08);
      if (AN(P)) inv = HUD.hash2(i + j * 31, Math.floor(P.t * 0.8 * AN(P)), p.rng) < 0.08;
      const x = ox + i * s, y = oy + j * s;
      d.rect(x + 0.5, y + 0.5, s - 1, s - 1, inv ? { fill: col.acc, fa: 0.9 } : { c: col.hi, a: la * 0.18 });
      glyph(d, x, y, s, rng, inv ? '#000000' : col.hi, inv ? 1 : 0.9);
    }
  }

  // ---------- 7. Таблица ----------
  function drawTable(P, p, r, rng, tg) {
    const { d, col, la, A } = P, size = 5.5, cw = size * HUD.CHAR_W;
    const defs = [['ID', 4], ['X', 4], ['Y', 4], ['LUM', 4], ['EDGE', 4], ['σ', 4], ['CLS', 3], ['Δt', 5]];
    const avail = Math.floor(r.w / cw);
    const use = []; let used = 0;
    for (const df of defs) { if (used + df[1] + (use.length ? 1 : 0) > avail) break; used += df[1] + (use.length ? 1 : 0); use.push(df); }
    const gapC = use.length > 1 ? (avail - use.reduce((a, c) => a + c[1], 0)) / (use.length - 1) : 0;
    const xs = []; let acc = 0; use.forEach((c) => { xs.push(r.x + (acc + c[1]) * cw); acc += c[1] + gapC; });
    use.forEach((c, i) => d.text(c[0], xs[i], r.y, { size, c: col.acc, align: 'right' }));
    d.line(r.x, r.y + LH - 0.5, r.x + r.w, r.y + LH - 0.5, { c: col.hi, a: la * 0.6 });
    const rows = Math.floor((r.h - LH) / LH);
    let hl = rng.int(0, rows - 1);
    const newRow = (j, rr) => {
      const nd = A.nodes.length ? A.nodes[rr.int(0, Math.min(A.nodes.length, 200) - 1)] : { x: rr() * A.W, y: rr() * A.H, e: rr(), l: rr() };
      return { ID: String.fromCharCode(65 + rr.int(0, 25)) + pad(j + 1, 2), x: nd.x, y: nd.y, e: nd.e, sg: rr() * 0.3,
        CLS: rr.pick(['A1', 'B2', 'Ω', '--', 'K7', 'R4']), dt: rr.range(0, 99) };
    };
    // Видео: строки хранятся в панели и обновляются по одной-несколько за «тик», а не все каждый кадр.
    let rowsData;
    if (live(P)) {
      if (!p._rows) p._rows = [];
      for (let j = 0; j < rows; j++) if (!p._rows[j]) p._rows[j] = newRow(j, rng);
      const lvl = AN(P);
      if (lvl) {
        const b = Math.floor(P.t * (lvl === 2 ? 6 : 1.5));
        if (p._b !== b) {
          p._b = b;
          const rr = HUD.rng((p.rng ^ Math.imul(b + 1, 2654435761)) >>> 0);
          for (let q = 0; q < (lvl === 2 ? 3 : 1); q++) { const j = rr.int(0, rows - 1); p._rows[j] = newRow(j, rr); }
        }
        hl = Math.floor(P.t * 0.5 * lvl) % rows;
      }
      rowsData = p._rows.slice(0, rows);
    } else {
      rowsData = []; for (let j = 0; j < rows; j++) rowsData.push(newRow(j, rng));
    }
    for (let j = 0; j < rows; j++) {
      const y = r.y + LH + 1 + j * LH, R = rowsData[j], lvl = AN(P);
      const jit = lvl ? (HUD.hash2(j, Math.floor(P.t * 4 * lvl), p.rng) - 0.5) * 0.04 * lvl : 0;
      const vals = { ID: R.ID, X: pad(R.x, 4), Y: pad(R.y, 4), LUM: f3(A.lumAt(R.x, R.y)), EDGE: f3(R.e),
        'σ': f3(Math.max(0, R.sg + jit)), CLS: R.CLS, 'Δt': ((R.dt + (lvl ? P.t * lvl : 0)) % 100).toFixed(2) };
      if (j === hl) d.rect(r.x - 1, y - 1, r.w + 2, LH, { fill: col.acc, fa: 0.2 });
      use.forEach((c, i) => d.text(vals[c[0]], xs[i], y, { size, c: j === hl ? col.acc : col.hi, a: j === hl ? 1 : 0.8, align: 'right' }));
    }
  }

  // ---------- 8. Мини-графики ----------
  function resample(arr, n) { const out = []; for (let i = 0; i < n; i++) { const a = Math.floor((i / n) * arr.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * arr.length)); let s = 0; for (let j = a; j < b; j++) s += arr[j]; out.push(s / (b - a)); } return out; }
  function norm(a) { const m = Math.max(...a) || 1; return a.map((v) => v / m); }

  function drawWave(P, p, r, rng) {
    const { d, col, la, A } = P, ch = r.h - 7;
    const real = rng.chance(0.5);
    const n = Math.max(40, Math.round(r.w));
    let data;
    const lvl = AN(P);
    if (real) {
      data = norm(resample(Array.from(rng.chance(0.5) ? A.colMeans : A.rowMeans), n)).map((v) => v * 2 - 1);
      if (lvl) { const sh = Math.floor(P.t * 0.06 * lvl * n) % n; data = data.slice(sh).concat(data.slice(0, sh)); }
    } else {
      const fs = [rng.range(2, 6), rng.range(8, 20), rng.range(25, 60)], ph = fs.map((f) => rng() * 6 + (lvl ? P.t * lvl * 1.5 : 0));
      data = []; for (let i = 0; i < n; i++) { const t = i / n; data.push(0.55 * Math.sin(t * fs[0] * 6.28 + ph[0]) * Math.sin(t * 3.14) + 0.25 * Math.sin(t * fs[1] * 6.28 + ph[1]) + 0.12 * Math.sin(t * fs[2] * 6.28 + ph[2]) + (rng() - 0.5) * 0.12); }
    }
    const mid = r.y + ch / 2;
    d.line(r.x, mid, r.x + r.w, mid, { c: col.hi, a: la * 0.35, dash: [2, 2] });
    for (let q = 0; q <= 8; q++) d.line(r.x + (r.w * q) / 8, r.y, r.x + (r.w * q) / 8, r.y + ch, { c: col.hi, a: la * 0.12 });
    const pts = data.flatMap((v, i) => [r.x + (i / (n - 1)) * r.w, mid - Math.max(-1, Math.min(1, v)) * ch * 0.46]);
    d.poly(pts.map((v, i) => (i % 2 ? v + 3 : v)), { c: col.hi, a: la * 0.3 });
    d.poly(pts, { c: col.acc, a: 1 });
    d.text(real ? 'Σ LUMA / AXIS' : `OSC ${rng.range(1, 9).toFixed(2)}Hz`, r.x, r.y + r.h - 6, { size: 5, c: col.acc });
    d.text(`±${rng.range(0.1, 2).toFixed(2)}`, r.x + r.w, r.y + r.h - 6, { size: 5, c: col.hi, a: 0.6, align: 'right' });
  }

  function drawBars(P, p, r, rng) {
    const { d, col, la, A } = P, horiz = r.h > r.w * 1.3, lab = 7;
    const R = { x: r.x, y: r.y, w: r.w, h: r.h - lab };
    const N = Math.max(6, Math.min(48, Math.floor((horiz ? R.h : R.w) / 4.5)));
    const data = norm(resample(Array.from(rng.chance(0.5) ? A.rowMeans : A.colMeans), N));
    const step = (horiz ? R.h : R.w) / N;
    data.forEach((v, i) => {
      const hl = v === 1;
      if (AN(P)) v = Math.min(1, v * (1 + 0.06 * AN(P) * Math.sin(P.t * 3 + i * 0.7)));
      const st = { fill: hl ? col.acc : col.hi, fa: hl ? 1 : 0.75 };
      if (horiz) d.rect(R.x, R.y + i * step + 0.5, Math.max(0.5, v * R.w), Math.max(0.5, step - 1.5), st);
      else d.rect(R.x + i * step + 0.5, R.y + R.h - v * R.h, Math.max(0.5, step - 1.5), Math.max(0.5, v * R.h), st);
    });
    if (horiz) d.line(R.x, R.y, R.x, R.y + R.h, { c: col.hi, a: la }); else d.line(R.x, R.y + R.h, R.x + R.w, R.y + R.h, { c: col.hi, a: la });
    d.text(`BINS ${N}`, r.x, r.y + r.h - 6, { size: 5, c: col.acc });
    d.text(`MAX #${pad(data.indexOf(1) + 1, 2)}`, r.x + r.w, r.y + r.h - 6, { size: 5, c: col.hi, a: 0.6, align: 'right' });
  }

  function drawScatter(P, p, r, rng) {
    const { d, col, la, A } = P, lab = 7;
    const R = { x: r.x + 2, y: r.y, w: r.w - 2, h: r.h - lab };
    d.line(R.x, R.y, R.x, R.y + R.h, { c: col.hi, a: la }); d.line(R.x, R.y + R.h, R.x + R.w, R.y + R.h, { c: col.hi, a: la });
    for (let q = 1; q < 5; q++) { d.line(R.x + (R.w * q) / 5, R.y + R.h, R.x + (R.w * q) / 5, R.y + R.h - 2, { c: col.hi, a: la }); d.line(R.x, R.y + (R.h * q) / 5, R.x + 2, R.y + (R.h * q) / 5, { c: col.hi, a: la }); }
    const ns = A.nodes.slice(0, 180);
    const byY = rng.chance(0.5);
    const xs = ns.map((n) => (byY ? n.y / A.H : n.x / A.W)), ys = ns.map((n) => n.l);
    const pts = [];
    ns.forEach((n, i) => pts.push(R.x + 2 + xs[i] * (R.w - 4), R.y + R.h - 2 - Math.min(1, ys[i]) * (R.h - 4)));
    d.dots(pts, 1.6, { c: col.acc, a: 0.95 });
    // линия тренда и настоящий коэффициент корреляции
    const m = ns.length || 1, mx = xs.reduce((a, b) => a + b, 0) / m, my = ys.reduce((a, b) => a + b, 0) / m;
    let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    const slope = sxx ? sxy / sxx : 0, rr = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    const yA = my - slope * mx, yB = my + slope * (1 - mx);
    d.line(R.x + 2, R.y + R.h - 2 - yA * (R.h - 4), R.x + R.w - 2, R.y + R.h - 2 - yB * (R.h - 4), { c: col.hi, a: 0.8, dash: [2, 1.5] });
    d.text(`${byY ? 'Y' : 'X'} / L`, r.x, r.y + r.h - 6, { size: 5, c: col.acc });
    d.text(`r=${rr.toFixed(2)} n=${ns.length}`, r.x + r.w, r.y + r.h - 6, { size: 5, c: col.hi, a: 0.7, align: 'right' });
  }

  function drawRadial(P, p, r) {
    const { d, col, la, A } = P;
    const R = Math.min(r.w, r.h - 8) / 2 - 1, cx = r.x + r.w / 2, cy = r.y + (r.h - 8) / 2;
    [0.33, 0.66, 1].forEach((k) => d.circle(cx, cy, R * k, { c: col.hi, a: la * (k === 1 ? 0.6 : 0.25) }));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; d.line(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R, { c: col.hi, a: la * 0.18 }); }
    const pts = []; let best = 0;
    for (let i = 0; i < 36; i++) {
      const a = -Math.PI + ((i + 0.5) / 36) * Math.PI * 2, v = 0.12 + 0.88 * A.radial[i];
      if (A.radial[i] === 1) best = i;
      pts.push(cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v);
    }
    d.poly(pts, { c: col.acc, a: 1, fill: col.acc, fa: 0.15, close: true });
    d.circle(cx, cy, 1.2, { fill: col.hi });
    if (AN(P)) {   // «радар»: вращающийся луч со следом
      for (let q = 0; q < 4; q++) {
        const a = P.t * 1.2 * AN(P) - q * 0.12;
        d.line(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R, { c: col.acc, a: 0.8 - q * 0.2 });
      }
    }
    d.text(`PEAK ${pad(((best + 0.5) * 10 + 180) % 360, 3)}°`, r.x, r.y + r.h - 6, { size: 5, c: col.acc });
    d.text('36 SEC', r.x + r.w, r.y + r.h - 6, { size: 5, c: col.hi, a: 0.6, align: 'right' });
  }

  // ---------- 9. Текстовые блоки ----------
  function kvLine(d, k, v, x, y, w, col, a) {
    const n = cols(w), vs = String(v);
    const room = n - vs.length - 1;
    const kk = k.slice(0, Math.max(1, room - 2));
    const dots = Math.max(1, room - kk.length - 1);
    d.text(kk + ' ' + '.'.repeat(dots), x, y, { size: 6, c: col.hi, a: 0.7 * a });
    d.text(vs.slice(0, n - 3), x + w, y, { size: 6, c: col.acc, a, align: 'right' });
  }
  function textBlock(P, r, rng, tg, variant, lines) {
    const { d, col } = P, n = cols(r.w);
    for (let i = 0; i < lines; i++) {
      const y = r.y + i * LH;
      if (variant === 'kv' || (variant === 'mix' && i > 0)) { const [k, v] = tg.kv(); kvLine(d, k, v, r.x, y, r.w, col, 1); }
      else if (variant === 'mix') d.text(('// ' + tg.title()).slice(0, n), r.x, y, { size: 6, c: col.acc });
      else if (variant === 'list') d.text(('— ' + (rng.chance(0.3) ? tg.term() + ' ' : '') + tg.sentence(rng.int(2, 5)).replace('.', '')).slice(0, n), r.x, y, { size: 6, c: col.hi, a: 0.8 });
    }
    if (variant === 'para') {
      let text = ''; while (text.length < n * lines) text += tg.sentence() + ' ';
      tg.wrap(text, n).slice(0, lines).forEach((l, i) => d.text(l, r.x, r.y + i * LH, { size: 6, c: col.hi, a: 0.6 }));
    }
  }
  // Видео: каждая строка живёт своей жизнью — изредка «перепечатывается» посимвольно с новым содержимым.
  function textBlockLive(P, r, seed, variant, lines) {
    const { d, col } = P, n = cols(r.w), lvl = AN(P), cwid = 6 * HUD.CHAR_W;
    const period = lvl === 2 ? 3 : 7, prob = lvl === 2 ? 0.6 : 0.3;
    const mk = (sd) => { const rr = HUD.rng(sd >>> 0); return [rr, new HUD.TextGen(rr, P.meta, P.A)]; };
    // цикл, в котором строка последний раз перепечатывалась, и насколько она «допечатана» сейчас
    const state = (key, typeDur) => {
      const phase = HUD.hash2(key, 7, seed) * period;
      const cyc = lvl ? Math.floor((P.t + phase) / period) : 0;
      let c = cyc;
      while (c > 0 && HUD.hash2(key, c, seed + 3) > prob) c--;
      let reveal = Infinity;
      if (lvl && c === cyc && c > 0) { const pr = ((P.t + phase) % period) / typeDur; if (pr < 1) reveal = pr; }
      return { c, reveal };
    };
    const cursor = (x, y) => d.rect(x, y + 0.5, cwid * 0.8, 5, { fill: col.acc, fa: 0.9 });
    if (variant === 'para') {
      const st = state(0, 2);
      const [, tg] = mk(seed + st.c * 7919);
      let text = ''; while (text.length < n * lines) text += tg.sentence() + ' ';
      const ls = tg.wrap(text, n).slice(0, lines);
      const total = ls.reduce((a, l) => a + l.length, 0);
      let left = st.reveal === Infinity ? Infinity : Math.floor(st.reveal * total);
      ls.forEach((l, i) => {
        const vis = Math.max(0, Math.min(l.length, left));
        if (vis > 0) d.text(l.slice(0, vis), r.x, r.y + i * LH, { size: 6, c: col.hi, a: 0.6 });
        if (left !== Infinity && left >= 0 && left < l.length) cursor(r.x + vis * cwid, r.y + i * LH);
        left -= l.length;
      });
      return;
    }
    for (let i = 0; i < lines; i++) {
      const y = r.y + i * LH, st = state(i + 1, Math.min(1.2, n * 0.03));
      const [rr, tg] = mk(seed + i * 1013 + st.c * 7919);
      let kv = null, full;
      if (variant === 'kv' || (variant === 'mix' && i > 0)) kv = tg.kv();
      else if (variant === 'mix') full = ('// ' + tg.title()).slice(0, n);
      else full = ('— ' + (rr.chance(0.3) ? tg.term() + ' ' : '') + tg.sentence(rr.int(2, 5)).replace('.', '')).slice(0, n);
      if (st.reveal === Infinity) {
        if (kv) kvLine(d, kv[0], kv[1], r.x, y, r.w, col, 1);
        else d.text(full, r.x, y, { size: 6, c: variant === 'mix' ? col.acc : col.hi, a: variant === 'mix' ? 1 : 0.8 });
      } else {
        if (kv) { const vs = String(kv[1]), room = n - vs.length - 1, kk = kv[0].slice(0, Math.max(1, room - 2)); full = kk + ' ' + '.'.repeat(Math.max(1, room - kk.length - 1)) + ' ' + vs; }
        const vis = Math.floor(st.reveal * full.length);
        d.text(full.slice(0, vis), r.x, y, { size: 6, c: col.hi, a: 0.9 });
        cursor(r.x + vis * cwid, y);
      }
    }
  }
  function drawText(P, p, r, rng, tg) {
    const lines = Math.max(1, Math.floor((r.h + 1) / LH));
    if (live(P)) textBlockLive(P, r, p.rng + 11, p.variant, lines);
    else textBlock(P, r, rng, tg, p.variant, lines);
  }

  HUD.PANEL_TYPES = {
    crop:    { weight: 1.2, fit: (w, h) => (w >= 60 && h >= 50 ? Math.min(2, (w * h) / 8000) : 0), title: () => 'DETAIL SCAN', draw: drawCrop },
    hist:    { weight: 0.8, fit: (w, h) => (w >= 70 && h >= 30 ? (w / h > 1.1 ? 1.2 : 0.5) : 0), title: () => 'LUMA HISTOGRAM', draw: drawHist },
    profile: { weight: 0.8, fit: (w, h) => (w >= 90 && h >= 26 ? (w / h > 1.6 ? 1.3 : 0.4) : h >= 100 && w >= 30 && h / w > 1.8 ? 0.8 : 0), title: () => 'SIGNAL PROFILE', draw: drawProfile },
    contour: { weight: 1, fit: (w, h) => (w >= 55 && h >= 45 ? 1 : 0), title: (p) => (p.variant === 'edges' ? 'EDGE MAP' : 'ISO CONTOUR'), draw: drawContour,
      init: (p, rng) => { p.variant = rng.chance(0.6) ? 'iso' : 'edges'; p.levels = rng.int(5, 8); } },
    graph:   { weight: 1, fit: (w, h) => (w >= 55 && h >= 45 ? 1 : 0), title: () => 'NODE GRAPH', draw: drawGraph },
    glyphs:  { weight: 0.9, fit: (w, h) => (w >= 40 && h >= 36 ? 1 : 0), title: () => 'GLYPH INDEX', draw: drawGlyphs },
    table:   { weight: 1, fit: (w, h) => (w >= 70 && h >= 40 ? 1 : 0), title: () => 'SAMPLE TABLE', draw: drawTable },
    wave:    { weight: 0.8, fit: (w, h) => (w >= 70 && h >= 24 ? (w / h > 1.5 ? 1 : 0.4) : 0), title: () => 'WAVEFORM', draw: drawWave },
    bars:    { weight: 0.8, fit: (w, h) => (w >= 45 && h >= 24 ? 1 : 0), title: () => 'DISTRIBUTION', draw: drawBars },
    scatter: { weight: 0.7, fit: (w, h) => (w >= 50 && h >= 40 ? 0.9 : 0), title: () => 'SCATTER', draw: drawScatter },
    radial:  { weight: 0.7, fit: (w, h) => (w >= 45 && h >= 45 ? (Math.max(w / h, h / w) < 1.6 ? 1.2 : 0.3) : 0), title: () => 'RADIAL FLUX', draw: drawRadial },
    text:    { weight: 1.3, fit: (w, h) => (w >= 36 && h >= 14 ? 0.9 : 0), title: (p, tg) => tg.title(), draw: drawText,
      init: (p, rng) => { p.variant = rng.pick(['kv', 'kv', 'list', 'para', 'mix']); } },
  };

  // ---------- Шапка ----------
  function drawHeader(P, z, rng) {
    const { d, col, la, meta, A } = P;
    const items = [`SPECIMEN DOSSIER // ${meta.specimenId}`, meta.fileName.toUpperCase(), meta.date,
      `SEED ${meta.seed}`, `${A.W}×${A.H} · PLATE ${pad(rng.int(1, 48), 2)}`];
    if (live(P)) items.splice(3, 0, `T+ ${HUD.fmtTime(P.t)}${AN(P) && Math.floor(P.t * 2) % 2 === 0 ? ' ●' : '  '}`);
    const size = Math.min(7, z.h * 0.45);
    const ws = items.map((s) => HUD.textWidth(s, size) + 16);
    const extra = (z.w - ws.reduce((a, b) => a + b, 0)) / items.length;
    d.rect(z.x, z.y, z.w, z.h, { fill: '#000', fa: 0.78, c: col.hi, a: la });
    let x = z.x;
    items.forEach((s, i) => {
      const w = ws[i] + Math.max(0, extra);
      if (x + 6 + HUD.textWidth(s, size) <= z.x + z.w - 4) d.text(s, x + 6, z.y + (z.h - size) / 2, { size, c: i === 0 ? col.acc : col.hi, a: i === 0 ? 1 : 0.8 });
      x += w;
      if (i < items.length - 1 && x < z.x + z.w) d.line(x, z.y, x, z.y + z.h, { c: col.hi, a: la * 0.6 });
    });
  }

  // ---------- Метки на картинке ----------
  function drawMarkers(P, scene) {
    const { d, col, la, A } = P, Z = scene.Z;
    scene.markers.forEach((m) => {
      if (m.kind === 'roi') {
        const pn = m.panel, r = pn.roi;   // в видео рамка движется — берём актуальное положение
        d.rect(r.x, r.y, r.w, r.h, { c: col.acc, a: 0.95 });
        [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]].forEach(([x, y, sx, sy]) => {
          d.line(x - sx * 3, y, x + sx * 5, y, { c: col.acc, a: 1, w: 1.5 }); d.line(x, y - sy * 3, x, y + sy * 5, { c: col.acc, a: 1, w: 1.5 });
        });
        d.text(`ROI-${pad(m.n, 2)} ×${pn.zoom.toFixed(1)}`, r.x, r.y - 8, { size: 5.5, c: col.acc });
        // выносная линия к панели
        const ls = { c: col.acc, a: la * 0.7, dash: [2, 2] };
        if (pn.zone === 'right') {
          const x0 = r.x + r.w, y0 = r.y + r.h / 2, xm = pn.x - 8, y1 = pn.y + pn.h / 2;
          d.poly([x0, y0, xm, y0, xm, y1, pn.x, y1], ls);
        } else if (pn.zone === 'left') {
          const x0 = r.x, y0 = r.y + r.h / 2, xm = pn.x + pn.w + 8, y1 = pn.y + pn.h / 2;
          d.poly([x0, y0, xm, y0, xm, y1, pn.x + pn.w, y1], ls);
        } else {
          const x0 = r.x + r.w / 2, y0 = r.y + r.h, ym = pn.y - 8, x1 = pn.x + pn.w / 2;
          d.poly([x0, y0, x0, ym, x1, ym, x1, pn.y], ls);
        }
      } else if (m.kind === 'scan') {
        const st = { c: col.hi, a: la * 0.55, dash: [1, 2] };
        if (m.vert) {
          d.line(m.pos, Z.center.y, m.pos, Z.center.y + Z.center.h, st);
          for (let y = Z.center.y; y < Z.center.y + Z.center.h; y += 20) d.line(m.pos - 1.5, y, m.pos + 1.5, y, { c: col.hi, a: la * 0.7 });
          d.text(`SCAN-X ${pad(m.pos, 4)}`, m.pos + 3, Z.center.y + 2, { size: 5, c: col.hi, a: 0.8 });
        } else {
          d.line(Z.center.x, m.pos, Z.center.x + Z.center.w, m.pos, st);
          for (let x = Z.center.x; x < Z.center.x + Z.center.w; x += 20) d.line(x, m.pos - 1.5, x, m.pos + 1.5, { c: col.hi, a: la * 0.7 });
          d.text(`SCAN-Y ${pad(m.pos, 4)}`, Z.center.x + 2, m.pos - 8, { size: 5, c: col.hi, a: 0.8 });
        }
      } else if (m.kind === 'centroid') {
        const { x, y } = A.centroid, st = { c: col.hi, a: 0.9 };
        d.circle(x, y, 5, st);
        d.line(x - 12, y, x - 7, y, st); d.line(x + 7, y, x + 12, y, st); d.line(x, y - 12, x, y - 7, st); d.line(x, y + 7, x, y + 12, st);
        d.text(`C0 ${pad(x, 4)},${pad(y, 4)}`, x + 9, y - 13, { size: 5, c: col.hi, a: 0.85 });
      }
    });
  }

  // ---------- Рамочные мелочи: уголки и линейки ----------
  function drawDecor(P, scene) {
    const { d, col, la, s } = P, { W, H, Z } = scene, m = HUD.MARGIN / 2, st = { c: col.hi, a: la };
    [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => {
      d.line(x, y, x + sx * 10, y, st); d.line(x, y, x, y + sy * 10, st);
    });
    if (s.density === 'low') return;
    const c = Z.center, rs = { c: col.hi, a: la * 0.55 };
    for (let x = 0; x <= c.w; x += 10) {
      const big = x % 100 === 0, mid = x % 50 === 0;
      d.line(c.x + x, c.y, c.x + x, c.y + (big ? 5 : mid ? 3.5 : 2), rs);
      if (big && x > 0 && x < c.w - 20) d.text(pad(c.x + x, 4), c.x + x + 1.5, c.y + 2.5, { size: 5, c: col.hi, a: 0.5 });
    }
    for (let y = 0; y <= c.h; y += 10) {
      const big = y % 100 === 0, mid = y % 50 === 0;
      d.line(c.x, c.y + y, c.x + (big ? 5 : mid ? 3.5 : 2), c.y + y, rs);
      if (big && y > 0 && y < c.h - 10) d.text(pad(c.y + y, 4), c.x + 7, c.y + y - 2.5, { size: 5, c: col.hi, a: 0.5 });
    }
  }

  // ---------- Плавающий текст ----------
  function drawFloats(P, scene) {
    const { d, col, la, A, meta } = P;
    scene.floats.forEach((fl) => {
      const rng = HUD.rng(fl.rng), tg = new HUD.TextGen(rng, meta, A);
      const st = { c: col.hi, a: la * 0.7 }, b = 4;
      [[fl.x - 2, fl.y - 2, 1, 1], [fl.x + fl.w + 2, fl.y - 2, -1, 1], [fl.x - 2, fl.y + fl.h, 1, -1], [fl.x + fl.w + 2, fl.y + fl.h, -1, -1]]
        .forEach(([x, y, sx, sy]) => { d.line(x, y, x + sx * b, y, st); d.line(x, y, x, y + sy * b, st); });
      d.text(`> ${tg.term()} NOTE ${pad(fl.n, 2)}`.slice(0, cols(fl.w)), fl.x, fl.y, { size: 6, c: col.acc });
      const variant = rng.pick(['kv', 'kv', 'list', 'para']), box = { x: fl.x, y: fl.y + LH, w: fl.w, h: fl.h - LH };
      if (live(P)) textBlockLive(P, box, fl.rng + 11, variant, fl.lines - 1);
      else textBlock(P, box, rng, tg, variant, fl.lines - 1);
    });
  }

  // ---------- Весь интерфейсный слой ----------
  HUD.drawUI = function (d, scene, P) {
    P.d = d;
    const s = P.s;
    P.col = { hi: s.colors[4], acc: s.colors[3], mid: s.colors[2], dim: s.colors[1] };
    P.la = 0.3 + (s.lineOpacity / 100) * 0.7;
    drawDecor(P, scene);
    drawMarkers(P, scene);
    drawFloats(P, scene);
    scene.panels.forEach((p) => {
      const T = HUD.PANEL_TYPES[p.type], rng = HUD.rng(p.rng), tg = new HUD.TextGen(rng, P.meta, P.A);
      if (T.init && p.variant == null) T.init(p, HUD.rng(p.rng + 1));
      const { col, la } = P;
      d.rect(p.x, p.y, p.w, p.h, { fill: '#000000', fa: 0.78, c: col.hi, a: la });
      d.line(p.x, p.y + HUD.TITLE_H, p.x + p.w, p.y + HUD.TITLE_H, { c: col.hi, a: la * 0.5 });
      const code = rng.pick(['CH', 'LX', 'SQ', 'RF', 'ID', 'MX']) + '-' + pad(rng.int(0, 99), 2);
      const room = cols(p.w - 6, 5.5) - code.length - 1;
      d.text((pad(p.id, 2) + ' ' + T.title(p, tg)).slice(0, Math.max(0, room)), p.x + 3, p.y + 2.3, { size: 5.5, c: col.hi, a: 0.9 });
      if (room > 8) d.text(code, p.x + p.w - 3, p.y + 2.3, { size: 5.5, c: col.acc, a: 0.85, align: 'right' });
      d.clip(p.in.x - 1, p.in.y - 1, p.in.w + 2, p.in.h + 2);
      T.draw(P, p, p.in, rng, tg);
      d.unclip();
    });
    if (scene.Z.top) drawHeader(P, scene.Z.top, HUD.rng(s.seed + 5));
    d.done();
  };
})();
