// Раскладка постера: зоны (шапка / лево / право / низ / центр) и нарезка их на панели по seed.
HUD.MARGIN = 16;
HUD.GAP = 5;
HUD.TITLE_H = 10;

HUD.DENSITY = {
  low:  { right: [5, 6], bottom: [4, 5], left: [3, 4], split: 0.1,  floats: 3, bottomH: 0.11 },
  mid:  { right: [6, 8], bottom: [5, 6], left: [3, 5], split: 0.18, floats: 5, bottomH: 0.12 },
  high: { right: [8, 9], bottom: [6, 7], left: [4, 6], split: 0.4,  floats: 8, bottomH: 0.14 },
};

// Геометрия зон не зависит от seed — поэтому картинку не нужно пересчитывать при «Перегенерировать».
HUD.zones = function (W, H, s) {
  const m = HUD.MARGIN, g = HUD.GAP, z = s.zones, dn = HUD.DENSITY[s.density];
  const topH = z.top ? Math.max(20, Math.round(H * 0.03)) : 0;
  const botH = z.bottom ? Math.max(60, Math.round(H * dn.bottomH)) : 0;
  const rightW = z.right ? Math.round(W * 0.2) : 0;
  const leftW = z.left ? Math.round(W * 0.11) : 0;
  const y0 = m + topH + (topH ? g : 0), y1 = H - m - botH - (botH ? g : 0);
  const cx0 = m + leftW + (leftW ? g : 0), cx1 = W - m - rightW - (rightW ? g : 0);
  return {
    top: topH ? { x: m, y: m, w: W - 2 * m, h: topH } : null,
    bottom: botH ? { x: m, y: H - m - botH, w: W - 2 * m, h: botH } : null,
    right: rightW ? { x: W - m - rightW, y: y0, w: rightW, h: y1 - y0 } : null,
    left: leftW ? { x: m, y: y0, w: leftW, h: y1 - y0 } : null,
    center: { x: cx0, y: y0, w: cx1 - cx0, h: y1 - y0 },
  };
};

HUD.inner = (p) => ({ x: p.x + 3, y: p.y + HUD.TITLE_H + 2, w: p.w - 6, h: p.h - HUD.TITLE_H - 5 });

(function () {
  // Делит длину на n частей случайной ширины с зазорами.
  function split(total, n, gap, rng) {
    const ws = []; for (let i = 0; i < n; i++) ws.push(rng.range(0.55, 1.8));
    const sum = ws.reduce((a, b) => a + b, 0), free = total - gap * (n - 1);
    let acc = 0;
    return ws.map((w) => { const len = (w / sum) * free; const o = [acc, len]; acc += len + gap; return o; });
  }

  function slice(zone, vertical, count, rng, splitProb, name) {
    const out = [];
    const len = vertical ? zone.h : zone.w;
    const minLen = vertical ? 44 : 90;
    const n = Math.max(1, Math.min(count, Math.floor((len + HUD.GAP) / (minLen + HUD.GAP))));
    split(len, n, HUD.GAP, rng).forEach(([o, l]) => {
      const p = vertical ? { x: zone.x, y: zone.y + o, w: zone.w, h: l } : { x: zone.x + o, y: zone.y, w: l, h: zone.h };
      // Иногда панель делится ещё на две — поперёк основного направления.
      const canSplit = vertical ? p.w > 150 : p.h > 70;
      if (canSplit && rng.chance(splitProb)) {
        const k = rng.range(0.35, 0.65);
        if (vertical) {
          const w1 = (p.w - HUD.GAP) * k;
          out.push({ ...p, w: w1, zone: name }, { ...p, x: p.x + w1 + HUD.GAP, w: p.w - w1 - HUD.GAP, zone: name });
        } else {
          const h1 = (p.h - HUD.GAP) * k;
          out.push({ ...p, h: h1, zone: name }, { ...p, y: p.y + h1 + HUD.GAP, h: p.h - h1 - HUD.GAP, zone: name });
        }
      } else out.push({ ...p, zone: name });
    });
    return out;
  }

  HUD.buildScene = function (A, s, W, H, meta) {
    const rng = HUD.rng(s.seed);
    const Z = HUD.zones(W, H, s), dn = HUD.DENSITY[s.density];
    let panels = [];
    if (Z.right) panels.push(...slice(Z.right, true, rng.int(...dn.right), rng, dn.split, 'right'));
    if (Z.bottom) panels.push(...slice(Z.bottom, false, rng.int(...dn.bottom), rng, dn.split * 0.8, 'bottom'));
    if (Z.left) panels.push(...slice(Z.left, true, rng.int(...dn.left), rng, 0, 'left'));
    panels = panels.filter((p) => p.w > 30 && p.h > 26);
    panels.forEach((p, i) => { p.id = i + 1; p.in = HUD.inner(p); p.rng = s.seed * 31 + i * 7919; });

    // ----- Выбор типа для каждой панели -----
    const T = HUD.PANEL_TYPES;
    const fit = (type, p) => T[type].fit(p.in.w, p.in.h);
    const used = {};
    const assign = (p, type) => { p.type = type; used[type] = (used[type] || 0) + 1; };
    const free = () => panels.filter((p) => !p.type);
    const required = ['crop', 'hist', 'profile'];
    if (s.density !== 'low') required.splice(1, 0, 'crop');
    if (s.density === 'high') required.push('contour', 'glyphs');
    required.forEach((type) => {
      const cands = free().filter((p) => fit(type, p) > 0);
      if (!cands.length) return;
      // для кропов: сначала правая колонка, потом низ — чтобы они были в разных местах
      const score = (p) => fit(type, p) * (type === 'crop' && used.crop && p.zone === 'right' ? 0.3 : 1) * rng.range(0.7, 1.3);
      const best = cands.map((p) => [p, score(p)]).sort((a, b) => b[1] - a[1])[0][0];
      assign(best, type);
    });
    free().forEach((p) => {
      // графики одного типа — не больше двух на постер, текст — сколько угодно
      const opts = Object.keys(T).filter((t) => t === 'text' || (used[t] || 0) < (t === 'crop' ? 3 : 2))
        .map((t) => [t, fit(t, p) * T[t].weight / (1 + (used[t] || 0) * 3)]).filter(([, w]) => w > 0);
      const tot = opts.reduce((a, [, w]) => a + w, 0);
      let x = rng() * tot;
      for (const [t, w] of opts) { x -= w; if (x <= 0) { assign(p, t); return; } }
      assign(p, 'text');
    });

    // ----- Данные, которые должны быть согласованы с метками на картинке -----
    const markers = [];
    const rois = [];
    const bounds = pad(A.bbox, 30, W, H);
    let roiN = 0;
    panels.forEach((p) => {
      if (p.type === 'crop') {
        const zoom = rng.range(2.2, 4.5);
        const roi = A.findROI(p.in.w / zoom, (p.in.h - 9) / zoom, bounds, rois);
        if (!roi) { p.type = 'text'; return; }
        // точные пропорции области = пропорции окна панели
        const sh = (roi.w * (p.in.h - 9)) / p.in.w;
        p.roi = { x: roi.x, y: roi.y + roi.h / 2 - sh / 2, w: roi.w, h: sh };
        rois.push(p.roi);
        p.zoom = p.in.w / roi.w; p.roiN = ++roiN;
        p.variant = rng.pick(['plain', 'plain', 'threshold', 'edges']);
        markers.push({ kind: 'roi', rect: p.roi, n: roiN, panel: p });
      }
      if (p.type === 'profile') {
        const vert = p.in.h > p.in.w * 1.2;
        const pos = vert ? A.bbox.x + A.bbox.w * rng.range(0.25, 0.75) : A.bbox.y + A.bbox.h * rng.range(0.2, 0.8);
        p.scan = { vert, pos: Math.round(pos) };
        markers.push({ kind: 'scan', vert, pos: p.scan.pos, panel: p });
      }
    });
    if (s.density !== 'low') markers.push({ kind: 'centroid' });

    // ----- Плавающий текст в тёмных зонах -----
    const floats = [];
    const nFloat = Math.round((s.floatText / 100) * dn.floats);
    if (nFloat > 0) {
      // верхние 15% центральной зоны не трогаем — верх постера должен оставаться почти пустым
      const top = Z.center.y + Math.max(14, Z.center.h * 0.15);
      const area = { x: Z.center.x + 8, y: top, w: Z.center.w - 16, h: Z.center.y + Z.center.h - 8 - top };
      const avoid = rois.map((r) => ({ x: r.x, y: r.y - 10, w: r.w, h: r.h + 10 }));
      avoid.push({ x: A.centroid.x - 60, y: A.centroid.y - 20, w: 120, h: 40 });
      A.findDarkRects(area, avoid, nFloat, 80, 34).forEach((r, i) => {
        const w = Math.min(r.w - 6, rng.range(100, 190));
        const lines = Math.max(3, Math.min(Math.floor((r.h - 6) / 7.5), rng.int(3, 9)));
        const h = lines * 7.5 + 4;
        const x = rng.chance(0.5) ? r.x + 3 : r.x + r.w - w - 3;
        const y = rng.chance(0.6) ? r.y + 3 : r.y + r.h - h - 3;
        floats.push({ x, y, w, h, lines, rng: s.seed * 17 + i * 104729, n: i + 1 });
      });
    }

    return { W, H, Z, panels, markers, floats, meta };
  };

  // Видео: рамки detail crop плавно следуют за самой детальной областью.
  // dt — сколько секунд прошло с прошлого шага, tau — «инерция» (сек), snap — прыгнуть сразу (после перемотки).
  HUD.trackROIs = function (scene, A, dt, tau, snap) {
    const crops = scene.panels.filter((p) => p.type === 'crop' && p.roi);
    const bounds = pad(A.bbox, 30, A.W, A.H);
    const k = snap ? 1 : 1 - Math.exp(-dt / Math.max(0.05, tau));
    crops.forEach((p) => {
      const cur = p.roi;
      const others = crops.filter((q) => q !== p).map((q) => q.roi);
      let tgt = snap ? null : p._target;
      const cand = A.findROI(cur.w, cur.h, bounds, others, !snap);
      if (cand) {
        const c = { x: cand.x + cand.w / 2 - cur.w / 2, y: cand.y + cand.h / 2 - cur.h / 2, w: cur.w, h: cur.h };
        // новая цель должна быть заметно интереснее старой — иначе рамка металась бы между двумя местами
        if (!tgt || A.edgeIn(c) > A.edgeIn(tgt) * 1.2) tgt = c;
      }
      if (!tgt) return;
      p._target = tgt;
      // плавно, но не быстрее ~300 единиц в секунду — дальние переезды идут спокойно
      let dx = (tgt.x - cur.x) * k, dy = (tgt.y - cur.y) * k;
      const lim = snap ? Infinity : 300 * dt, len = Math.hypot(dx, dy);
      if (len > lim) { dx *= lim / len; dy *= lim / len; }
      const x = cur.x + dx, y = cur.y + dy;
      p.roi = { x: Math.max(0, Math.min(A.W - cur.w, x)), y: Math.max(0, Math.min(A.H - cur.h, y)), w: cur.w, h: cur.h };
    });
  };

  function pad(r, p, W, H) {
    const x = Math.max(0, r.x - p), y = Math.max(0, r.y - p);
    return { x, y, w: Math.min(W, r.x + r.w + p) - x, h: Math.min(H, r.y + r.h + p) - y };
  }
})();
