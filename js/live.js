// Отрисовка движущегося источника (видео, камера): кадр обрабатывается на видеокарте, поверх — интерфейс.
// Раскладка строится один раз и не меняется между кадрами. Анализ пересчитывается каждые N кадров
// и сглаживается; рамки detail crop плавно следуют за деталями; зерно меняется каждый кадр.
// Всё зависит только от времени t и порядка кадров — поэтому экспорт повторяет превью.
HUD.LAYOUT_KEYS = ['seed', 'density', 'zones', 'floatText', 'aspect', 'zoom'];

HUD.Live = function () {
  let gp = null;
  const st = { lk: null, ik: null, A: null, scene: null, meta: null, lastT: null, lastAT: 0, count: 0, preset: null };
  this.gl = () => gp || (gp = new HUD.GLProcessor());
  this.reset = () => { st.lk = null; };
  this.dispose = () => { if (gp) gp.dispose(); gp = null; };
  // Экспорт: взять раскладку из превью (копию, без накопленного состояния анимации).
  this.adoptScene = (scene) => {
    if (!scene) return;
    const copy = structuredClone(scene);
    copy.panels.forEach((p) => { delete p._rows; delete p._b; delete p._target; });
    st.preset = copy;
  };

  // Рисует кадр src (время t, сек) в холст out. scale: 1 = постер 1080 px в ширину.
  this.frame = function (src, state, out, scale, t) {
    const s = state.s;
    const [iw, ih] = HUD.srcSize(src);
    const { W, H } = HUD.posterSize(s.aspect, src);
    const pw = Math.round(W * scale), ph = Math.round(H * scale), unit = pw / W;
    const c = HUD.zones(W, H, s).center;
    const cx = (c.x + c.w / 2) / W, cy = (c.y + c.h / 2) / H, zoom = s.zoom / 100;
    const g = this.gl();
    g.render(src, iw, ih, s, {
      pw, ph, W, H, cx, cy, zoom,
      seed: (1337 + Math.round(t * 30)) >>> 0,              // зерно меняется каждый кадр
      scanOffset: s.scanCrawl ? t * 3 * unit : 0,           // сканлайны медленно ползут вниз
    });

    const analyze = (prev) => HUD.analyze(g.readLum(), HUD.fitCover(src, 96, Math.round((96 * H) / W), cx, cy, zoom), W, H,
      prev, Math.max(0.05, 1 - s.smoothing / 100));
    const tau = 0.1 + (s.trackSmooth / 100) * 1.9;          // инерция рамок, сек
    const lk = [state.srcId, W, H, JSON.stringify(HUD.LAYOUT_KEYS.map((k) => s[k]))].join('|');
    const ik = JSON.stringify(HUD.IMAGE_KEYS.map((k) => s[k]));
    const jump = st.lastT == null || t < st.lastT - 1e-4 || t - st.lastT > 0.6;   // перемотка или повтор отрезка

    if (st.lk !== lk) {
      // новая раскладка: источник или настройки композиции поменялись
      st.A = analyze(null);
      st.meta = HUD.makeMeta({ img: src, fileName: state.fileName, s }, W, H);
      st.scene = st.preset && st.preset.W === W && st.preset.H === H ? st.preset : HUD.buildScene(st.A, s, W, H, st.meta);
      st.preset = null;
      HUD.trackROIs(st.scene, st.A, 0, tau, true);   // рамки сразу там, куда их поведёт слежение
      st.lk = lk; st.ik = ik; st.count = 0; st.lastAT = t;
    } else if (st.ik !== ik || jump) {
      // скачок во времени или смена обработки: данные — заново, рамки — сразу на место
      st.A = analyze(null);
      HUD.trackROIs(st.scene, st.A, 0, tau, true);
      st.ik = ik; st.count = 0; st.lastAT = t;
    } else if (t !== st.lastT) {
      st.count++;
      if (st.count % s.analysisEvery === 0) {
        st.A = analyze(st.A);
        HUD.trackROIs(st.scene, st.A, t - st.lastAT, tau, false);
        st.lastAT = t;
      }
    }
    st.lastT = t;

    if (out.width !== pw || out.height !== ph) { out.width = pw; out.height = ph; }
    const ctx = out.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.drawImage(g.canvas, 0, 0);
    HUD.drawUI(new HUD.CanvasDraw(ctx, scale), st.scene,
      { A: st.A, s, meta: st.meta, proc: { canvas: g.canvas }, imgS: scale, t, anim: s.anim });
    return { W, H, pw, ph, A: st.A, scene: st.scene, meta: st.meta };
  };
};
