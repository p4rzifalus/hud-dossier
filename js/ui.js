// Интерфейс инструмента: загрузка, настройки, живое превью, экспорт.
(function () {
  const $ = (id) => document.getElementById(id);

  const state = {
    img: HUD.makeDemo(), imgId: 'demo', fileName: 'specimen_demo.png',
    s: {
      aspect: '4:5', preset: 'acid', colors: HUD.PRESETS.acid.colors.slice(),
      contrast: 55, shadows: 30, bloomThreshold: 70, bloomStrength: 55, grain: 30,
      dither: false, scanlines: false, zoom: 100,
      seed: HUD.randomSeed(), density: 'mid',
      zones: { top: true, left: false, right: true, bottom: true },
      floatText: 50, lineOpacity: 60, exportScale: 2,
    },
  };
  const renderer = new HUD.Renderer();
  const view = $('view'), vctx = view.getContext('2d');
  const cur = { A: null, aKey: null, scene: null, meta: null };   // что сейчас на экране (нужно экспорту)

  // ---------- перерисовка (не чаще одного раза за кадр) ----------
  let pending = false, fontReady = false;
  function redraw() {
    if (pending || !fontReady) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const s = state.s, t0 = performance.now();
      const r = renderer.renderImageLayer(state.img, state.imgId, s, 1);
      if (cur.aKey !== r.key) { cur.A = HUD.analyze(r.image, r.fit, r.W, r.H); cur.aKey = r.key; }
      const t1 = performance.now();
      cur.meta = HUD.makeMeta(state, r.W, r.H);
      cur.scene = HUD.buildScene(cur.A, s, r.W, r.H, cur.meta);
      if (view.width !== r.pw || view.height !== r.ph) { view.width = r.pw; view.height = r.ph; }
      vctx.setTransform(1, 0, 0, 1, 0, 0); vctx.globalAlpha = 1;
      vctx.drawImage(r.image.canvas, 0, 0);
      HUD.drawUI(new HUD.CanvasDraw(vctx, 1), cur.scene, { A: cur.A, s, meta: cur.meta, proc: r.image, imgS: 1 });
      const t2 = performance.now();
      $('status').textContent = `${r.W}×${r.H} · картинка ${Math.round(t1 - t0)} мс · интерфейс ${Math.round(t2 - t1)} мс · панелей ${cur.scene.panels.length}`;
    });
  }

  // ---------- кнопки-переключатели ----------
  function segButtons(el, items, current, onPick) {
    el.innerHTML = '';
    items.forEach(([val, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.classList.toggle('on', val === current);
      b.onclick = () => { onPick(val); segButtons(el, items, val, onPick); };
      el.appendChild(b);
    });
  }
  segButtons($('aspect'), [['src', 'Исходник'], ['4:5', '4:5'], ['1:1', '1:1'], ['9:16', '9:16'], ['16:9', '16:9']],
    state.s.aspect, (v) => { state.s.aspect = v; redraw(); });
  segButtons($('density'), [['low', 'Мало'], ['mid', 'Средне'], ['high', 'Много']],
    state.s.density, (v) => { state.s.density = v; redraw(); });
  segButtons($('scale'), [[1, '1x · 1080'], [2, '2x · 2160'], [4, '4x · 4320']],
    state.s.exportScale, (v) => { state.s.exportScale = v; });

  // ---------- палитра ----------
  function buildColors() {
    const box = $('colors');
    box.innerHTML = '';
    state.s.colors.forEach((c, i) => {
      const inp = document.createElement('input');
      inp.type = 'color'; inp.value = c.toLowerCase();
      inp.title = ['Тени', 'Глубокий тон', 'Средний тон', 'Акцент (свечение)', 'Светлый (линии, текст)'][i];
      inp.oninput = () => { state.s.colors[i] = inp.value; state.s.preset = 'custom'; drawPresets(); redraw(); };
      box.appendChild(inp);
    });
  }
  function drawPresets() {
    const items = Object.entries(HUD.PRESETS).map(([k, p]) => [k, p.name]);
    segButtons($('presets'), items, state.s.preset, (k) => {
      state.s.preset = k; state.s.colors = HUD.PRESETS[k].colors.slice(); buildColors(); redraw();
    });
  }
  drawPresets(); buildColors();

  // ---------- ползунки и галочки ----------
  function slider(parent, key, label, min, max) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div class="lab"><span>${label}</span><b>${state.s[key]}</b></div><input type="range" min="${min || 0}" max="${max || 100}" value="${state.s[key]}">`;
    const inp = row.querySelector('input'), out = row.querySelector('b');
    inp.oninput = () => { state.s[key] = +inp.value; out.textContent = inp.value; redraw(); };
    parent.appendChild(row);
  }
  function check(parent, obj, key, label) {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = `<input type="checkbox" ${obj[key] ? 'checked' : ''}> ${label}`;
    l.querySelector('input').onchange = (e) => { obj[key] = e.target.checked; redraw(); };
    parent.appendChild(l);
  }
  const zc = $('zoneControls');
  check(zc, state.s.zones, 'top', 'Шапка');
  check(zc, state.s.zones, 'bottom', 'Низ');
  check(zc, state.s.zones, 'right', 'Правая колонка');
  check(zc, state.s.zones, 'left', 'Левая колонка');
  const lc = $('layoutControls');
  slider(lc, 'floatText', 'Плавающий текст (доля)');
  slider(lc, 'lineOpacity', 'Непрозрачность линий');
  slider(lc, 'zoom', 'Масштаб картинки, %', 60, 180);

  const ic = $('imgControls');
  slider(ic, 'contrast', 'Контраст');
  slider(ic, 'shadows', 'Провал теней в чёрный');
  slider(ic, 'bloomThreshold', 'Свечение: порог яркости');
  slider(ic, 'bloomStrength', 'Свечение: сила');
  slider(ic, 'grain', 'Зерно');
  check(ic, state.s, 'dither', 'Дизеринг (цифровая фактура)');
  check(ic, state.s, 'scanlines', 'Сканлайны');

  // ---------- seed ----------
  const seedInp = $('seed');
  seedInp.value = state.s.seed;
  seedInp.onchange = () => { const v = parseInt(seedInp.value, 10); if (v >= 0) { state.s.seed = v; redraw(); } };
  function regen() { state.s.seed = HUD.randomSeed(); seedInp.value = state.s.seed; redraw(); }
  $('regen').onclick = regen;
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'r' || e.key === 'к') && !e.metaKey && !e.ctrlKey && e.target.tagName !== 'INPUT') regen();
  });

  // ---------- загрузка картинки ----------
  let counter = 0;
  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const im = new Image();
    im.onload = () => {
      state.img = im; state.imgId = 'f' + (++counter); state.fileName = file.name;
      $('fileinfo').textContent = `${file.name} · ${im.naturalWidth}×${im.naturalHeight}`;
      redraw();
    };
    im.onerror = () => { $('fileinfo').textContent = 'Не удалось открыть этот файл'; };
    im.src = URL.createObjectURL(file);
  }
  $('file').onchange = (e) => loadFile(e.target.files[0]);
  const stage = $('stage');
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragging'); });
  stage.addEventListener('dragleave', (e) => { if (e.target === $('drop')) stage.classList.remove('dragging'); });
  stage.addEventListener('drop', (e) => {
    e.preventDefault(); stage.classList.remove('dragging');
    loadFile(e.dataTransfer.files[0]);
  });

  // ---------- экспорт ----------
  function runExport(btn, fn) {
    const btns = [$('savePng'), $('saveSvg')];
    btns.forEach((b) => (b.disabled = true));
    const old = btn.textContent; btn.textContent = 'Готовлю…';
    setTimeout(() => {
      fn().catch((e) => alert(e.message)).finally(() => { btns.forEach((b) => (b.disabled = false)); btn.textContent = old; });
    }, 30);
  }
  $('savePng').onclick = () => runExport($('savePng'), () => HUD.exportPNG(state, cur, state.s.exportScale));
  $('saveSvg').onclick = () => runExport($('saveSvg'), () => HUD.exportSVG(state, cur));

  $('fileinfo').textContent = 'Сейчас: демо-образец';
  HUD.state = state; HUD.cur = cur; HUD.redraw = redraw;   // для отладки
  HUD.loadFont().catch(() => {}).finally(() => { fontReady = true; redraw(); });
})();
