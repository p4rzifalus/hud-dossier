// Сборка постера из слоёв. Каждый слой помнит, из каких настроек он получен,
// и пересчитывается только когда эти настройки поменялись.
HUD.BASE_W = 1080;

HUD.IMAGE_KEYS = ['colors', 'contrast', 'shadows', 'bloomThreshold', 'bloomStrength', 'grain', 'dither', 'scanlines'];

HUD.posterSize = function (aspect, img) {
  let r;
  if (aspect === 'src') { const [iw, ih] = HUD.srcSize(img); r = Math.min(2.5, Math.max(0.4, ih / iw)); }
  else { const [a, b] = aspect.split(':').map(Number); r = b / a; }
  return { W: HUD.BASE_W, H: Math.round(HUD.BASE_W * r) };
};

// scale: 1 = постер 1080 px в ширину, 2 = 2160 и т.д.
HUD.Renderer = function () {
  const cache = { fitKey: null, fit: null, procKey: null, proc: null };

  this.renderImageLayer = function (img, imgId, s, scale) {
    const { W, H } = HUD.posterSize(s.aspect, img);
    const pw = Math.round(W * scale), ph = Math.round(H * scale);
    // центр картинки ставим в центр свободной (центральной) зоны
    const c = HUD.zones(W, H, s).center;
    const cx = (c.x + c.w / 2) / W, cy = (c.y + c.h / 2) / H;
    const fitKey = [imgId, pw, ph, cx.toFixed(4), cy.toFixed(4), s.zoom].join('|');
    if (cache.fitKey !== fitKey) {
      cache.fit = HUD.fitCover(img, pw, ph, cx, cy, s.zoom / 100);
      cache.fitKey = fitKey;
      cache.procKey = null;
    }
    const procKey = fitKey + JSON.stringify(HUD.IMAGE_KEYS.map(k => s[k]));
    if (cache.procKey !== procKey) {
      cache.proc = HUD.processImage(cache.fit, s, 1337, pw / W);   // зерно не зависит от seed
      cache.procKey = procKey;
    }
    return { W, H, pw, ph, image: cache.proc, fit: cache.fit, key: procKey };
  };
};

// Демо-образец: «медуза» на тёмном фоне, чтобы было что показать до загрузки.
HUD.makeDemo = function () {
  const W = 1200, H = 1500, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d'), r = HUD.rng(7);
  x.fillStyle = '#080808'; x.fillRect(0, 0, W, H);
  // слабый шум фона — должен провалиться в чёрный
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.05})`; x.fillRect(r() * W, r() * H, 2, 2); }
  const cx = 600, cy = 560;
  // щупальца
  x.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const sx = cx + r.range(-280, 280), len = r.range(450, 850), ph = r() * 6, amp = r.range(10, 50);
    x.beginPath(); x.moveTo(sx, cy + 20);
    for (let t = 0; t <= 1; t += 0.02) x.lineTo(sx + Math.sin(t * 9 + ph) * amp * t + (sx - cx) * t * 0.4, cy + 20 + t * len);
    x.strokeStyle = `rgba(210,210,210,${r.range(0.15, 0.6)})`; x.lineWidth = r.range(1, 4); x.stroke();
  }
  // купол
  const g = x.createRadialGradient(cx, cy - 120, 20, cx, cy - 40, 360);
  g.addColorStop(0, '#fff'); g.addColorStop(0.3, '#aaa'); g.addColorStop(0.8, '#333'); g.addColorStop(1, '#111');
  x.beginPath(); x.ellipse(cx, cy, 330, 280, 0, Math.PI, 0);
  x.bezierCurveTo(cx + 300, cy + 60, cx - 300, cy + 60, cx - 330, cy);
  x.fillStyle = g; x.fill();
  // рёбра купола
  for (let i = 0; i < 24; i++) {
    const a = Math.PI + (i + 0.5) / 24 * Math.PI;
    x.beginPath(); x.moveTo(cx, cy - 260);
    x.quadraticCurveTo(cx + Math.cos(a) * 200, cy + Math.sin(a) * 150, cx + Math.cos(a) * 325, cy + Math.sin(a) * 270 + 20);
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 2; x.stroke();
  }
  // ядро
  const core = x.createRadialGradient(cx, cy - 90, 0, cx, cy - 90, 60);
  core.addColorStop(0, 'rgba(255,255,255,0.85)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = core; x.beginPath(); x.arc(cx, cy - 90, 60, 0, 7); x.fill();
  // частицы
  for (let i = 0; i < 300; i++) {
    x.fillStyle = `rgba(255,255,255,${r.range(0.2, 0.9)})`;
    x.beginPath(); x.arc(cx + r.range(-450, 450), cy + r.range(-400, 800), r.range(0.5, 3), 0, 7); x.fill();
  }
  return c;
};
