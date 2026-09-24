// Отрисовка движущегося источника (видео, камера): кадр обрабатывается на видеокарте,
// поверх рисуется интерфейс. Раскладка строится один раз и дальше не меняется между кадрами.
HUD.LAYOUT_KEYS = ['seed', 'density', 'zones', 'floatText', 'aspect', 'zoom'];

HUD.Live = function () {
  let gp = null;
  const cache = { key: null, A: null, scene: null, meta: null };
  this.gl = () => gp || (gp = new HUD.GLProcessor());
  this.reset = () => { cache.key = null; };

  // Рисует кадр src в холст out. scale: 1 = постер 1080 px в ширину.
  this.frame = function (src, state, out, scale) {
    const s = state.s;
    const [iw, ih] = HUD.srcSize(src);
    const { W, H } = HUD.posterSize(s.aspect, src);
    const pw = Math.round(W * scale), ph = Math.round(H * scale);
    const c = HUD.zones(W, H, s).center;
    const cx = (c.x + c.w / 2) / W, cy = (c.y + c.h / 2) / H, zoom = s.zoom / 100;
    const g = this.gl();
    g.render(src, iw, ih, s, { pw, ph, W, H, cx, cy, zoom, seed: 1337, scanOffset: 0 });

    // Анализ и раскладка — только когда поменялся источник или настройки, влияющие на них.
    const key = [state.srcId, W, H, JSON.stringify(HUD.LAYOUT_KEYS.concat(HUD.IMAGE_KEYS).map((k) => s[k]))].join('|');
    if (cache.key !== key) {
      const small = HUD.fitCover(src, 96, Math.round((96 * H) / W), cx, cy, zoom);
      cache.A = HUD.analyze(g.readLum(), small, W, H);
      cache.meta = HUD.makeMeta({ img: src, fileName: state.fileName, s }, W, H);
      cache.scene = HUD.buildScene(cache.A, s, W, H, cache.meta);
      cache.key = key;
    }

    if (out.width !== pw || out.height !== ph) { out.width = pw; out.height = ph; }
    const ctx = out.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.drawImage(g.canvas, 0, 0);
    HUD.drawUI(new HUD.CanvasDraw(ctx, scale), cache.scene, { A: cache.A, s, meta: cache.meta, proc: { canvas: g.canvas }, imgS: scale });
    return { W, H, pw, ph, A: cache.A, scene: cache.scene, meta: cache.meta };
  };
};
