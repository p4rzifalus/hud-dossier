// Экспорт. Картинка обрабатывается заново в нужном размере (не растягивается из превью),
// а раскладка и анализ берутся из превью — поэтому файл в точности повторяет то, что на экране.
HUD.download = function (blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

HUD.exportName = (state, ext) => {
  const base = state.fileName.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 40) || 'poster';
  return `${base}_hud_${state.s.seed}${ext}`;
};

HUD.exportPNG = function (state, view, scale) {
  const r = new HUD.Renderer().renderImageLayer(state.img, state.imgId, state.s, scale);
  const c = document.createElement('canvas');
  c.width = r.pw; c.height = r.ph;
  const ctx = c.getContext('2d');
  ctx.drawImage(r.image.canvas, 0, 0);
  HUD.drawUI(new HUD.CanvasDraw(ctx, scale), view.scene, { A: view.A, s: state.s, meta: view.meta, proc: r.image, imgS: scale });
  return new Promise((res, rej) => c.toBlob((b) => {
    if (!b) return rej(new Error('Браузер не смог создать такой большой файл'));
    HUD.download(b, HUD.exportName(state, scale > 1 ? `@${scale}x.png` : '.png')); res();
  }, 'image/png'));
};

HUD.exportSVG = function (state, view) {
  const S = 2;   // картинка и увеличенные фрагменты вставляются растром в 2x
  const r = new HUD.Renderer().renderImageLayer(state.img, state.imgId, state.s, S);
  const d = new HUD.SvgDraw(S);
  HUD.drawUI(d, view.scene, { A: view.A, s: state.s, meta: view.meta, proc: r.image, imgS: S });
  const svg = d.toString(r.W, r.H, r.image.canvas.toDataURL('image/png'));
  HUD.download(new Blob([svg], { type: 'image/svg+xml' }), HUD.exportName(state, '.svg'));
  return Promise.resolve();
};
