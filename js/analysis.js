// Анализ картинки: всё, что панели показывают «про эту картинку», считается здесь.
// Работаем на сетке ячеек по 4 единицы постера (270 × ~340 ячеек для 4:5) — быстро и достаточно точно.
(function () {
  const CELL = 4;

  HUD.analyze = function (proc, fit, W, H) {
    const S = proc.w / W;
    const gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL);
    const L = new Float32Array(gw * gh);

    // Средняя яркость в каждой ячейке (4×4 пробы — зерно при этом усредняется).
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let sum = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = Math.min(proc.w - 1, Math.floor((gx * CELL + (sx + 0.5)) * S));
        const py = Math.min(proc.h - 1, Math.floor((gy * CELL + (sy + 0.5)) * S));
        sum += proc.lum[py * proc.w + px];
      }
      L[gy * gw + gx] = sum / (16 * 255);
    }
    const at = (x, y) => L[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))];

    // Гистограмма яркости (256 корзин) по итоговой картинке.
    const hist = new Float64Array(256);
    const stride = Math.max(1, Math.floor(proc.lum.length / 250000));
    let n = 0, sum = 0, sum2 = 0;
    for (let i = 0; i < proc.lum.length; i += stride) { const v = proc.lum[i]; hist[v]++; n++; sum += v; sum2 += v * v; }
    const mean = sum / n / 255, sigma = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2)) / 255;
    const pct = (p) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= p * n) return i / 255; } return 1; };

    // Края (оператор Собеля): где яркость резко меняется.
    const E = new Float32Array(gw * gh);
    let emax = 0, esum = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const e = Math.sqrt(gx * gx + gy * gy);
      E[y * gw + x] = e; esum += e; if (e > emax) emax = e;
    }
    const edgeThr = Math.max(0.08, emax * 0.25);
    let edgeCount = 0;
    for (let i = 0; i < E.length; i++) if (E[i] > edgeThr) edgeCount++;

    // Интегральные суммы: мгновенно считают сумму по любому прямоугольнику.
    const integral = (arr, fn) => {
      const I = new Float64Array((gw + 1) * (gh + 1));
      for (let y = 0; y < gh; y++) {
        let row = 0;
        for (let x = 0; x < gw; x++) { row += fn(arr[y * gw + x]); I[(y + 1) * (gw + 1) + x + 1] = I[y * (gw + 1) + x + 1] + row; }
      }
      return (x0, y0, x1, y1) => I[y1 * (gw + 1) + x1] - I[y0 * (gw + 1) + x1] - I[y1 * (gw + 1) + x0] + I[y0 * (gw + 1) + x0];
    };
    const sumE = integral(E, (v) => v);
    const sumL = integral(L, (v) => v);
    const sumBright = integral(L, (v) => (v > 0.1 ? 1 : 0));

    // Узлы: локальные максимумы краёв.
    const nodes = [];
    for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
      const e = E[y * gw + x];
      if (e < edgeThr) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && E[(y + dy) * gw + x + dx] > e) { isMax = false; break; }
      if (isMax) nodes.push({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL, e: e / emax, l: L[y * gw + x] });
    }
    nodes.sort((a, b) => b.e - a.e);
    nodes.length = Math.min(nodes.length, 600);

    // Рамка объекта (где есть заметная яркость) и центр яркости.
    let bx0 = gw, by0 = gh, bx1 = 0, by1 = 0, cw = 0, cxs = 0, cys = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const v = L[y * gw + x];
      if (v > 0.12) { if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x > bx1) bx1 = x; if (y > by1) by1 = y; }
      const w2 = v * v; cw += w2; cxs += w2 * x; cys += w2 * y;
    }
    if (bx1 < bx0) { bx0 = 0; by0 = 0; bx1 = gw - 1; by1 = gh - 1; }
    const bbox = { x: bx0 * CELL, y: by0 * CELL, w: (bx1 - bx0 + 1) * CELL, h: (by1 - by0 + 1) * CELL };
    const centroid = cw > 0 ? { x: (cxs / cw + 0.5) * CELL, y: (cys / cw + 0.5) * CELL } : { x: W / 2, y: H / 2 };

    // Радиальное распределение яркости вокруг центра (36 секторов).
    const radial = new Float32Array(36);
    const ccx = centroid.x / CELL, ccy = centroid.y / CELL;
    for (let y = 0; y < gh; y += 2) for (let x = 0; x < gw; x += 2) {
      const a = Math.atan2(y - ccy, x - ccx);
      radial[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 36) % 36] += L[y * gw + x];
    }
    const rmax = Math.max(...radial) || 1;
    for (let i = 0; i < 36; i++) radial[i] /= rmax;

    // Средние по столбцам и строкам.
    const colMeans = new Float32Array(gw), rowMeans = new Float32Array(gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { colMeans[x] += L[y * gw + x] / gh; rowMeans[y] += L[y * gw + x] / gw; }

    // Доминирующий цвет исходника (по светлым местам).
    const t = document.createElement('canvas'); t.width = 48; t.height = Math.max(1, Math.round(48 * H / W));
    const tc = t.getContext('2d'); tc.drawImage(fit, 0, 0, t.width, t.height);
    const td = tc.getImageData(0, 0, t.width, t.height).data;
    let cr = 0, cg = 0, cb = 0, cn = 0;
    for (let i = 0; i < td.length; i += 4) {
      if (td[i] * 0.3 + td[i + 1] * 0.59 + td[i + 2] * 0.11 > 40) { cr += td[i]; cg += td[i + 1]; cb += td[i + 2]; cn++; }
    }
    const srcColor = cn ? [cr / cn, cg / cn, cb / cn].map(Math.round) : [0, 0, 0];

    // Грубая сглаженная сетка для изолиний (ячейка 12 единиц).
    const CC = 12, cgw = Math.ceil(W / CC), cgh = Math.ceil(H / CC);
    let C = new Float32Array(cgw * cgh);
    for (let y = 0; y < cgh; y++) for (let x = 0; x < cgw; x++) {
      const x0 = x * 3, y0 = y * 3, x1 = Math.min(gw, x0 + 3), y1 = Math.min(gh, y0 + 3);
      C[y * cgw + x] = x1 > x0 && y1 > y0 ? sumL(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0)) : 0;
    }
    HUD.boxBlur(C, cgw, cgh, 1, 2);

    const A = {
      W, H, CELL, gw, gh, L, E, hist, n, mean, sigma, pct, emax, edgeThr,
      edgeDensity: edgeCount / E.length, meanEdge: esum / E.length,
      nodes, bbox, centroid, radial, colMeans, rowMeans, srcColor,
      contourGrid: { C, cgw, cgh, cell: CC },
      darkRatio: hist[0] / n + hist[1] / n + hist[2] / n,
      lumAt: (x, y) => at(Math.floor(x / CELL), Math.floor(y / CELL)),
    };

    // Профиль яркости вдоль строки/столбца (y или x в единицах постера).
    A.rowProfile = (yU) => { const y = Math.min(gh - 1, Math.floor(yU / CELL)); return Array.from(L.subarray(y * gw, y * gw + gw)); };
    A.colProfile = (xU) => { const x = Math.min(gw - 1, Math.floor(xU / CELL)); const a = []; for (let y = 0; y < gh; y++) a.push(L[y * gw + x]); return a; };

    const toCells = (r) => [Math.max(0, Math.floor(r.x / CELL)), Math.max(0, Math.floor(r.y / CELL)),
      Math.min(gw, Math.ceil((r.x + r.w) / CELL)), Math.min(gh, Math.ceil((r.y + r.h) / CELL))];
    A.meanIn = (r) => { const [x0, y0, x1, y1] = toCells(r); return x1 > x0 && y1 > y0 ? sumL(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0)) : 0; };
    A.edgeIn = (r) => { const [x0, y0, x1, y1] = toCells(r); return x1 > x0 && y1 > y0 ? sumE(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0)) : 0; };

    // Самая «интересная» область заданного размера: больше всего краёв, внутри bounds, не пересекая taken.
    A.findROI = (wU, hU, bounds, taken) => {
      const ww = Math.max(2, Math.round(wU / CELL)), hh = Math.max(2, Math.round(hU / CELL));
      const [bx0, by0, bx1, by1] = toCells(bounds);
      const tk = taken.map((r) => toCells({ x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 }));
      let best = null, bestScore = -1;
      const step = Math.max(1, Math.round(Math.min(ww, hh) / 6));
      for (let y = by0; y + hh <= by1; y += step) for (let x = bx0; x + ww <= bx1; x += step) {
        if (tk.some(([a, b, c, d]) => x < c && x + ww > a && y < d && y + hh > b)) continue;
        const score = sumE(x, y, x + ww, y + hh) + 0.3 * sumL(x, y, x + ww, y + hh);
        if (score > bestScore) { bestScore = score; best = { x: x * CELL, y: y * CELL, w: ww * CELL, h: hh * CELL }; }
      }
      return best;
    };

    // Тёмные пустые прямоугольники (для плавающего текста). Отступ от светлого — 3 ячейки.
    A.findDarkRects = (bounds, avoid, count, minW, minH) => {
      const [bx0, by0, bx1, by1] = toCells(bounds);
      const w = bx1 - bx0, h = by1 - by0;
      if (w <= 0 || h <= 0) return [];
      const free = new Uint8Array(w * h);
      const pad = 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const X = bx0 + x, Y = by0 + y;
        const x0 = Math.max(0, X - pad), y0 = Math.max(0, Y - pad), x1 = Math.min(gw, X + pad + 1), y1 = Math.min(gh, Y + pad + 1);
        free[y * w + x] = sumBright(x0, y0, x1, y1) === 0 ? 1 : 0;
      }
      const block = (r) => { const [a, b, c, d] = toCells({ x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 });
        for (let y = Math.max(b, by0); y < Math.min(d, by1); y++) for (let x = Math.max(a, bx0); x < Math.min(c, bx1); x++) free[(y - by0) * w + x - bx0] = 0; };
      avoid.forEach(block);
      const res = [];
      const heights = new Int32Array(w);
      for (let k = 0; k < count; k++) {
        // Самый большой свободный прямоугольник (метод «гистограммы по строкам»).
        heights.fill(0);
        let best = null, bestScore = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) heights[x] = free[y * w + x] ? heights[x] + 1 : 0;
          const stack = [];
          for (let x = 0; x <= w; x++) {
            const hx = x < w ? heights[x] : 0;
            let start = x;
            while (stack.length && stack[stack.length - 1][1] >= hx) {
              const [sx, sh] = stack.pop();
              const rw = x - sx, rh = sh;
              if (rw * CELL >= minW && rh * CELL >= minH) {
                const yTop = y - rh + 1;
                const lower = 0.6 + ((by0 + yTop + rh / 2) * CELL / H);   // ниже — лучше: верх остаётся пустым
                const sc = Math.min(rw, 60) * Math.min(rh, 40) * lower;
                if (sc > bestScore) { bestScore = sc; best = { x: (bx0 + sx) * CELL, y: (by0 + yTop) * CELL, w: rw * CELL, h: rh * CELL }; }
              }
              start = sx;
            }
            stack.push([start, hx]);
          }
        }
        if (!best) break;
        res.push(best); block(best);
      }
      return res;
    };

    // Изолинии (marching squares) — отрезки в единицах постера.
    A.contours = (levels) => {
      const segs = levels.map(() => []);
      const v = (x, y) => C[y * cgw + x];
      for (let y = 0; y < cgh - 1; y++) for (let x = 0; x < cgw - 1; x++) {
        const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), d = v(x, y + 1);
        levels.forEach((lv, li) => {
          const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
          if (idx === 0 || idx === 15) return;
          const ip = (p, q) => (lv - p) / (q - p || 1e-6);
          const X = x + 0.5, Y = y + 0.5;   // значения сетки относятся к центрам ячеек
          const T = [(X + ip(a, b)) * CC, Y * CC], R = [(X + 1) * CC, (Y + ip(b, c)) * CC];
          const B = [(X + ip(d, c)) * CC, (Y + 1) * CC], Lf = [X * CC, (Y + ip(a, d)) * CC];
          const map = { 1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[T, R]], 5: [[Lf, T], [B, R]], 6: [[T, B]], 7: [[Lf, T]],
            8: [[Lf, T]], 9: [[T, B]], 10: [[T, R], [Lf, B]], 11: [[T, R]], 12: [[Lf, R]], 13: [[B, R]], 14: [[Lf, B]] };
          map[idx].forEach((sg) => segs[li].push(sg));
        });
      }
      return segs;
    };

    return A;
  };
})();
