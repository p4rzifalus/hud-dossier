// Экспорт GIF. Кадры те же, что у видео (покадрово, в полном качестве), но меньше размер и частота.
// Палитра GIF (256 цветов) строится из палитры эффекта: градиент картинки + цвета линий и текста.
HUD.GIF_MAX_SEC = 8;

HUD.gifPlan = function (state, o) {
  const vs = state.video, s = state.s;
  const { W, H } = HUD.posterSize(s.aspect, vs.video);
  const gw = Math.min(o.width, W), scale = gw / W, gh = Math.round(H * scale);
  const total = Math.max(0, vs.outT - vs.inT), dur = Math.min(total, HUD.GIF_MAX_SEC);
  return { W, H, gw, gh, scale, dur, frames: Math.max(1, Math.floor(dur * o.fps + 1e-6)), clipped: total > HUD.GIF_MAX_SEC + 1e-3 };
};

HUD.gifPalette = function (colors) {
  const lut = HUD.buildLUT(colors), pal = [], seen = new Set();
  const add = (c) => {
    const r = c.map((v) => Math.max(0, Math.min(255, Math.round(v))));
    const k = r.join();
    if (!seen.has(k) && pal.length < 256) { seen.add(k); pal.push(r); }
  };
  // 1) градиент самой картинки
  for (let i = 0; i < 176; i++) { const k = Math.round((i * 255) / 175); add([lut[k * 3], lut[k * 3 + 1], lut[k * 3 + 2]]); }
  // 2) цвета линий и текста поверх чёрного фона с разной прозрачностью
  const hi = HUD.hexToRgb(colors[4]), acc = HUD.hexToRgb(colors[3]);
  for (let i = 1; i <= 40; i++) { const a = i / 40; add(hi.map((v) => v * a)); add(acc.map((v) => v * a)); }
  // 3) смеси светлого и акцентного
  for (let i = 1; pal.length < 256 && i < 64; i++) { const a = i / 64; add(hi.map((v, j) => v * (1 - a) + acc[j] * a)); }
  while (pal.length < 256) pal.push([0, 0, 0]);
  return pal;
};

HUD.gifEncodeFrame = function (gif, canvas, w, h, pal, first, fps) {
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const idx = gifenc.applyPalette(data, pal, 'rgb565');
  gif.writeFrame(idx, w, h, first ? { palette: pal, delay: 1000 / fps } : { delay: 1000 / fps });
};

HUD.exportGIF = async function (state, cur, o, onProgress, signal) {
  if (!window.gifenc) throw new Error('Не загрузилась библиотека GIF (js/vendor/gifenc.js).');
  const p = HUD.gifPlan(state, o), pal = HUD.gifPalette(state.s.colors);
  const gif = gifenc.GIFEncoder();
  await HUD.forEachExportFrame(state, cur, { scale: p.scale, fps: o.fps, frames: p.frames, inT: state.video.inT }, (out, i) => {
    HUD.gifEncodeFrame(gif, out, p.gw, p.gh, pal, i === 0, o.fps);
    onProgress && onProgress((i + 1) / p.frames, `кадр ${i + 1} / ${p.frames}`);
  }, signal);
  gif.finish();
  const blob = new Blob([gif.bytes()], { type: 'image/gif' });
  HUD.download(blob, HUD.exportName(state, '.gif'));
  return { gw: p.gw, gh: p.gh, frames: p.frames, bytes: blob.size, clipped: p.clipped };
};

// Примерный вес: кодируем 3 пробных кадра (начало, середина, конец) и умножаем на число кадров.
HUD.estimateGIF = async function (state, cur, o) {
  const MB = window.Mediabunny, p = HUD.gifPlan(state, o), pal = HUD.gifPalette(state.s.colors);
  const input = new MB.Input({ source: new MB.BlobSource(state.video.file), formats: MB.ALL_FORMATS });
  const sink = new MB.CanvasSink(await input.getPrimaryVideoTrack(), { poolSize: 1 });
  const live = new HUD.Live();
  live.adoptScene(cur.scene);
  const out = document.createElement('canvas');
  const st = { srcId: state.srcId, fileName: state.fileName, s: state.s };
  const inT = state.video.inT, ts = [inT, inT + p.dur / 2, inT + Math.max(0, p.dur - 1 / o.fps)];
  let sum = 0, n = 0;
  try {
    let k = 0;
    for await (const wc of sink.canvasesAtTimestamps(ts)) {
      const t = ts[k++];
      if (!wc) continue;
      live.frame(wc.canvas, st, out, p.scale, t);
      const g = gifenc.GIFEncoder();
      HUD.gifEncodeFrame(g, out, p.gw, p.gh, pal, true, o.fps);
      g.finish();
      sum += Math.max(0, g.bytes().length - 800); n++;   // минус заголовок и палитра — считаем только сам кадр
    }
  } finally {
    live.dispose();
  }
  return { ...p, bytes: n ? 800 + (sum / n) * p.frames : 0 };
};
