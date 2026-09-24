// Интерфейс инструмента: загрузка, настройки, живое превью, экспорт.
(function () {
  const $ = (id) => document.getElementById(id);

  const state = {
    mode: 'image', video: null, srcId: 'demo',
    img: HUD.makeDemo(), imgId: 'demo', fileName: 'specimen_demo.png',
    s: {
      aspect: '4:5', preset: 'acid', colors: HUD.PRESETS.acid.colors.slice(),
      contrast: 55, shadows: 30, bloomThreshold: 70, bloomStrength: 55, grain: 30,
      dither: false, scanlines: false, zoom: 100,
      seed: HUD.randomSeed(), density: 'mid',
      zones: { top: true, left: false, right: true, bottom: true },
      floatText: 50, lineOpacity: 60, exportScale: 2,
      // движение (видео и камера)
      anim: 'calm', analysisEvery: 2, smoothing: 70, trackSmooth: 50, scanCrawl: false,
      // экспорт видео
      vRes: '1080', vFps: 30, vQuality: 'mid', vAudio: true,
    },
  };
  const renderer = new HUD.Renderer();
  const view = $('view'), vctx = view.getContext('2d');
  const cur = { A: null, aKey: null, scene: null, meta: null };   // что сейчас на экране (нужно экспорту)
  const live = new HUD.Live();

  // ---------- перерисовка (не чаще одного раза за кадр) ----------
  let pending = false, fontReady = false;
  function redraw() {
    if (pending || !fontReady) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; drawNow(); });
  }
  function drawNow() {
    if (state.mode === 'video') { drawVideoFrame(); return; }
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
  }

  // ---------- видео ----------
  // Автокачество превью: если кадр рисуется долго — уменьшаем разрешение превью (экспорт не затрагивается).
  const SCALES = [1, 0.75, 0.5];
  let fpsT = [], si = 0, frameMs = 0, calmSince = 0, lastSwitch = 0;
  const buf = document.createElement('canvas');
  function adaptScale(ms, now) {
    frameMs = frameMs ? frameMs * 0.85 + ms * 0.15 : ms;
    if (now - lastSwitch < 1000) return;
    if (frameMs > 40 && si < SCALES.length - 1) { si++; lastSwitch = now; frameMs = 0; calmSince = 0; }
    else if (frameMs < 16 && si > 0) {
      if (!calmSince) calmSince = now;
      else if (now - calmSince > 2000) { si--; lastSwitch = now; frameMs = 0; calmSince = 0; }
    } else calmSince = 0;
  }
  function drawVideoFrame() {
    const v = state.video.video;
    if (v.readyState < 2) return;
    const t0 = performance.now(), scale = SCALES[si];
    let r;
    if (scale === 1) r = live.frame(v, state, view, 1, v.currentTime);
    else {
      r = live.frame(v, state, buf, scale, v.currentTime);
      const fw = r.W, fh = r.H;   // экран всегда 1080 по ширине — уменьшенный кадр растягиваем
      if (view.width !== fw || view.height !== fh) { view.width = fw; view.height = fh; }
      vctx.setTransform(1, 0, 0, 1, 0, 0); vctx.globalAlpha = 1; vctx.imageSmoothingEnabled = true;
      vctx.drawImage(buf, 0, 0, fw, fh);
    }
    cur.A = r.A; cur.scene = r.scene; cur.meta = r.meta;
    const t1 = performance.now();
    if (!v.paused) {
      fpsT.push(t1); while (fpsT.length && t1 - fpsT[0] > 1000) fpsT.shift();
      adaptScale(t1 - t0, t1);
    } else fpsT = [];
    $('status').textContent = `${r.W}×${r.H} · кадр ${Math.round(t1 - t0)} мс` + (fpsT.length > 1 ? ` · ${fpsT.length} fps` : '')
      + (scale < 1 ? ` · превью ${Math.round(scale * 100)}%` : '') + ` · панелей ${r.scene.panels.length}`;
    updatePlayer();
  }

  const player = $('player'), pSeek = $('pSeek');
  function updatePlayer() {
    const vs = state.video; if (!vs) return;
    const v = vs.video, d = v.duration || 1;
    $('pPlay').textContent = v.paused ? '▶' : '❚❚';
    if (!seeking) pSeek.value = Math.round((v.currentTime / d) * 1000);
    $('pTime').textContent = `${HUD.fmtTime(v.currentTime)} / ${HUD.fmtTime(v.duration)}`;
    const seg = $('pSeg');
    seg.style.left = (vs.inT / d) * 100 + '%';
    seg.style.width = ((vs.outT - vs.inT) / d) * 100 + '%';
    updateVideoPlan();
  }
  // Проигрывание: на каждом обновлении экрана смотрим, сменился ли кадр видео; крутим по кругу внутри отрезка.
  let lastVT = -1;
  function onVideoFrame() {
    const vs = state.video; if (!vs) return;
    const v = vs.video;
    if (v.paused) return;
    if (v.currentTime >= vs.outT - 0.001 || v.currentTime < vs.inT - 0.05) v.currentTime = vs.inT;
    if (v.currentTime !== lastVT) { lastVT = v.currentTime; redraw(); }
    requestAnimationFrame(onVideoFrame);
  }
  function togglePlay() {
    const vs = state.video; if (!vs) return;
    const v = vs.video;
    if (v.paused) {
      if (v.currentTime >= vs.outT - 0.01) v.currentTime = vs.inT;
      v.play().then(onVideoFrame).catch(() => {});
    } else v.pause();
    setTimeout(updatePlayer, 0);
  }
  let seeking = false;
  $('pPlay').onclick = togglePlay;
  pSeek.oninput = () => {
    const vs = state.video; if (!vs) return;
    seeking = true;
    vs.seek((pSeek.value / 1000) * vs.video.duration).then(() => { seeking = false; redraw(); });
  };
  $('pIn').onclick = () => { const vs = state.video; vs.inT = Math.min(vs.video.currentTime, vs.outT - 0.1); updatePlayer(); };
  $('pOut').onclick = () => { const vs = state.video; vs.outT = Math.max(vs.video.currentTime, vs.inT + 0.1); updatePlayer(); };
  $('pReset').onclick = () => { const vs = state.video; vs.inT = 0; vs.outT = vs.video.duration; updatePlayer(); };

  // Текущий кадр как обычная картинка — для PNG/SVG «как у картинок».
  function frameState() {
    drawNow();   // раскладка и анализ должны соответствовать именно тому, что экспортируем
    if (state.mode !== 'video') return state;
    const vs = state.video, t = vs.video.currentTime;
    const base = state.fileName.replace(/\.[^.]+$/, '');
    return { img: vs.grabFrame(), imgId: state.srcId + '@' + t, fileName: `${base}_${t.toFixed(2).replace(".", "-")}s`, s: state.s };
  }

  function setMode(mode) {
    state.mode = mode;
    player.hidden = mode !== 'video';
    $('motionSection').hidden = mode !== 'video';
    $('videoExport').hidden = mode !== 'video';
    $('stage').classList.toggle('has-player', mode === 'video');
    if (mode !== 'video' && state.video) state.video.video.pause();
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

  segButtons($('anim'), [['off', 'Выкл'], ['calm', 'Спокойно'], ['active', 'Активно']],
    state.s.anim, (v) => { state.s.anim = v; redraw(); });
  segButtons($('every'), [[1, 'каждый кадр'], [2, '÷2'], [4, '÷4'], [8, '÷8']],
    state.s.analysisEvery, (v) => { state.s.analysisEvery = v; });
  const mc = $('motionControls');
  slider(mc, 'smoothing', 'Сглаживание данных', 0, 95);
  slider(mc, 'trackSmooth', 'Инерция рамок увеличения');
  check(mc, state.s, 'scanCrawl', 'Сканлайны ползут');

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
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
    if (e.key === 'r' || e.key === 'к') regen();
    if (e.key === ' ' && state.mode === 'video') {
      e.preventDefault();
      if (e.target.tagName === 'BUTTON') e.target.blur();   // иначе пробел ещё и «нажмёт» кнопку
      togglePlay();
    }
  });

  // ---------- загрузка картинки ----------
  let counter = 0;
  const isVideo = (f) => f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(f.name);
  async function loadVideo(file) {
    $('fileinfo').textContent = `Открываю ${file.name}…`;
    const vs = new HUD.VideoSource(file);
    try { await vs.ready; } catch (e) { $('fileinfo').textContent = e.message; return; }
    if (state.video) { state.video.video.pause(); URL.revokeObjectURL(state.video.video.src); }
    state.video = vs; state.srcId = 'v' + (++counter); state.fileName = file.name;
    const v = vs.video;
    $('fileinfo').textContent = `${file.name} · ${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(1)} с`;
    setMode('video');
    redraw();
  }
  function loadFile(file) {
    if (!file) return;
    if (isVideo(file)) { loadVideo(file); return; }
    if (!file.type.startsWith('image/')) return;
    const im = new Image();
    im.onload = () => {
      state.img = im; state.imgId = 'f' + (++counter); state.srcId = state.imgId; state.fileName = file.name;
      $('fileinfo').textContent = `${file.name} · ${im.naturalWidth}×${im.naturalHeight}`;
      setMode('image');
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
  $('savePng').onclick = () => runExport($('savePng'), () => HUD.exportPNG(frameState(), cur, state.s.exportScale));
  $('saveSvg').onclick = () => runExport($('saveSvg'), () => HUD.exportSVG(frameState(), cur));
  $('pSnap').onclick = () => runExport($('savePng'), () => HUD.exportPNG(frameState(), cur, state.s.exportScale));

  // ---------- экспорт видео ----------
  const vOpts = () => ({ res: state.s.vRes, fps: state.s.vFps, quality: state.s.vQuality, audio: state.s.vAudio });
  function updateVideoPlan() {
    if (state.mode !== 'video') return;
    const p = HUD.videoExportPlan(state, vOpts());
    $('vPlan').textContent = `${p.ew}×${p.eh} · ${p.dur.toFixed(1)} с · ${p.frames} кадров · ≈ ${p.estMB < 1 ? p.estMB.toFixed(2) : p.estMB.toFixed(1)} МБ`
      + (p.capped ? ' · размер уменьшен до предела кодека' : '');
  }
  segButtons($('vRes'), [['720', '720p'], ['1080', '1080p'], ['src', 'как исходник']], state.s.vRes, (v) => { state.s.vRes = v; updateVideoPlan(); });
  segButtons($('vFps'), [[24, '24 fps'], [30, '30 fps']], state.s.vFps, (v) => { state.s.vFps = v; updateVideoPlan(); });
  segButtons($('vQuality'), [['low', 'Эконом'], ['mid', 'Норма'], ['high', 'Высокое']], state.s.vQuality, (v) => { state.s.vQuality = v; updateVideoPlan(); });
  $('vAudio').checked = state.s.vAudio;
  $('vAudio').onchange = (e) => { state.s.vAudio = e.target.checked; updateVideoPlan(); };
  let exportCtl = null;
  $('saveVideo').onclick = async () => {
    if (exportCtl || state.mode !== 'video') return;
    const v = state.video.video;
    v.pause();
    drawNow();
    exportCtl = new AbortController();
    $('saveVideo').disabled = true; $('vProgress').hidden = false;
    const t0 = performance.now();
    const prog = (k, text) => {
      $('vBar').style.width = Math.round(k * 100) + '%';
      const el = (performance.now() - t0) / 1000, left = k > 0.02 ? el / k - el : 0;
      $('vText').textContent = `${Math.round(k * 100)}% · ${text}` + (left > 1 ? ` · осталось ~${Math.ceil(left)} с` : '');
    };
    try {
      const r = await HUD.exportVideo(state, cur, vOpts(), prog, exportCtl.signal);
      $('vText').textContent = `Готово: ${r.fmt.toUpperCase()} ${r.ew}×${r.eh}, ${(r.bytes / 1e6).toFixed(1)} МБ` + (r.audioMissing ? ` · без звука: ${r.audioMissing}` : '');
    } catch (e) {
      $('vText').textContent = e.name === 'AbortError' ? 'Отменено' : 'Ошибка: ' + e.message;
      if (e.name !== 'AbortError') console.error(e);
    } finally {
      exportCtl = null; $('saveVideo').disabled = false;
      setTimeout(() => { if (!exportCtl) $('vBar').style.width = '0'; }, 4000);
    }
  };
  $('vCancel').onclick = () => { if (exportCtl) exportCtl.abort(); };

  $('fileinfo').textContent = 'Сейчас: демо-образец';
  HUD.state = state; HUD.cur = cur; HUD.redraw = redraw;   // для отладки
  HUD.loadFont().catch(() => {}).finally(() => { fontReady = true; redraw(); });
})();
