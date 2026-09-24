// Интерфейс инструмента (по макету HUD Generator): загрузка, настройки, живое превью, экспорт.
(function () {
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // Значения по умолчанию — к ним возвращают кнопки сброса групп.
  const DEFAULTS = {
    aspect: '4:5', preset: 'green', colors: HUD.PRESETS.green.colors.slice(),
    exposure: 50, contrast: 55, shadows: 30, bloomThreshold: 70, bloomStrength: 55,
    grain: 30, pixels: 0, vhs: 0, zoom: 100,
    density: 'mid', zones: { top: true, left: false, right: true, bottom: true },
    floatText: 50, lineOpacity: 60, exportScale: 2,
    // движение (видео и камера)
    anim: 'calm', analysisEvery: 2, smoothing: 70, trackSmooth: 50, scanCrawl: false,
    // экспорт видео и GIF
    vRes: '1080', vFps: 30, vQuality: 'mid', vAudio: true, gWidth: 800, gFps: 12,
  };
  const GROUPS = {
    zones: ['zones'],
    colors: ['preset', 'colors'],
    process: ['exposure', 'contrast', 'bloomStrength', 'shadows', 'bloomThreshold'],
    effects: ['grain', 'pixels', 'vhs'],
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const state = {
    mode: 'image', video: null, srcId: 'demo',
    img: HUD.makeDemo(), imgId: 'demo', fileName: 'specimen_demo.png',
    s: Object.assign(clone(DEFAULTS), { seed: HUD.randomSeed() }),
  };
  const renderer = new HUD.Renderer();
  const view = $('view'), vctx = view.getContext('2d');
  const cur = { A: null, aKey: null, scene: null, meta: null };   // что сейчас на экране (нужно экспорту)
  const live = new HUD.Live();
  const note = (text) => { $('fileinfo').textContent = text; };

  // ---------- перерисовка (не чаще одного раза за кадр) ----------
  let pending = false, fontReady = false;
  function redraw() {
    updateResets();
    if (pending || !fontReady) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; drawNow(); });
  }
  function drawNow() {
    if (state.mode === 'video') { drawVideoFrame(); return; }
    if (state.mode === 'camera') { drawCameraFrame(); return; }
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
  // Кадр движущегося источника (видео или камера): t — время в секундах, playing — идёт ли движение.
  function drawLiveFrame(v, t, playing) {
    if (v.readyState < 2) return null;
    const t0 = performance.now(), scale = SCALES[si];
    let r;
    if (scale === 1) r = live.frame(v, state, view, 1, t);
    else {
      r = live.frame(v, state, buf, scale, t);
      const fw = r.W, fh = r.H;   // экран всегда 1080 по ширине — уменьшенный кадр растягиваем
      if (view.width !== fw || view.height !== fh) { view.width = fw; view.height = fh; }
      vctx.setTransform(1, 0, 0, 1, 0, 0); vctx.globalAlpha = 1; vctx.imageSmoothingEnabled = true;
      vctx.drawImage(buf, 0, 0, fw, fh);
    }
    cur.A = r.A; cur.scene = r.scene; cur.meta = r.meta;
    const t1 = performance.now();
    if (playing) {
      fpsT.push(t1); while (fpsT.length && t1 - fpsT[0] > 1000) fpsT.shift();
      adaptScale(t1 - t0, t1);
    } else fpsT = [];
    $('status').textContent = `${r.W}×${r.H} · кадр ${Math.round(t1 - t0)} мс` + (fpsT.length > 1 ? ` · ${fpsT.length} fps` : '')
      + (scale < 1 ? ` · превью ${Math.round(scale * 100)}%` : '') + ` · панелей ${r.scene.panels.length}`;
    return r;
  }
  function drawVideoFrame() {
    const v = state.video.video;
    if (drawLiveFrame(v, v.currentTime, !v.paused)) updatePlayer();
  }

  const pSeek = $('pSeek');
  let seeking = false;
  function updatePlayer() {
    const vs = state.video; if (!vs) return;
    const v = vs.video, d = v.duration || 1;
    $('pPlay').firstElementChild.src = v.paused ? 'assets/icons/play.svg' : 'assets/icons/pause.svg';
    if (!seeking) { pSeek.value = Math.round((v.currentTime / d) * 1000); paintBar(pSeek); }
    $('pTime').textContent = `${HUD.fmtTime(v.currentTime)} / ${HUD.fmtTime(v.duration)}`;
    const seg = $('pSeg');
    seg.style.left = (vs.inT / d) * 100 + '%';
    seg.style.width = ((vs.outT - vs.inT) / d) * 100 + '%';
    updateVideoPlan();
    updateGifPlan();
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
  $('pPlay').onclick = togglePlay;
  pSeek.oninput = () => {
    const vs = state.video; if (!vs) return;
    seeking = true; paintBar(pSeek);
    vs.seek((pSeek.value / 1000) * vs.video.duration).then(() => { seeking = false; redraw(); });
  };
  $('pIn').onclick = () => { const vs = state.video; vs.inT = Math.min(vs.video.currentTime, vs.outT - 0.1); updatePlayer(); };
  $('pOut').onclick = () => { const vs = state.video; vs.outT = Math.max(vs.video.currentTime, vs.inT + 0.1); updatePlayer(); };
  $('pReset').onclick = () => { const vs = state.video; vs.inT = 0; vs.outT = vs.video.duration; updatePlayer(); };

  // Текущий кадр как обычная картинка — для PNG/SVG «как у картинок».
  function frameState() {
    drawNow();   // раскладка и анализ должны соответствовать именно тому, что экспортируем
    if (state.mode === 'camera') return { img: cam.grab(), imgId: 'cam@' + performance.now(), fileName: camName(), s: state.s };
    if (state.mode !== 'video') return state;
    const vs = state.video, t = vs.video.currentTime;
    const base = state.fileName.replace(/\.[^.]+$/, '');
    return { img: vs.grabFrame(), imgId: state.srcId + '@' + t, fileName: `${base}_${t.toFixed(2).replace('.', '-')}s`, s: state.s };
  }

  function setMode(mode) {
    state.mode = mode;
    updateResets();
    $('player').hidden = mode !== 'video';
    $('cambar').hidden = mode !== 'camera';
    $$('[data-show="live"]').forEach((el) => { el.hidden = mode === 'image'; });
    $$('[data-show="video"]').forEach((el) => { el.hidden = mode !== 'video'; });
    $('saveGif').disabled = $('saveVideo').disabled = mode !== 'video';
    if (mode !== 'video' && state.video) state.video.video.pause();
    if (mode !== 'camera' && cam) { if (cam.rec) stopRec(); cam.stop(); }
  }

  // ---------- камера ----------
  let cam = null, camLastT = -1, recTimer = null, camPurpose = 'photo';
  const camName = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `camera_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
  function drawCameraFrame() { drawLiveFrame(cam.video, cam.time(), true); }
  function cameraLoop() {
    if (state.mode !== 'camera' || !cam || !cam.stream) return;
    const v = cam.video;
    if (v.currentTime !== camLastT) { camLastT = v.currentTime; drawCameraFrame(); }
    requestAnimationFrame(cameraLoop);
  }
  async function fillCameraList() {
    const sel = $('camSelect');
    const list = await cam.devices();
    sel.innerHTML = '';
    list.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId; o.textContent = d.label || `Камера ${i + 1}`;
      o.selected = d.deviceId === cam.deviceId;
      sel.appendChild(o);
    });
    sel.hidden = list.length < 2;
  }
  // purpose: 'photo' — на плашке «Снять», 'video' — «Запись».
  async function startCamera(purpose) {
    camPurpose = purpose;
    $('camShot').hidden = purpose !== 'photo';
    $('camRec').hidden = $('camMic').hidden = purpose !== 'video';
    if (state.mode === 'camera') return;
    const problem = HUD.cameraProblem();
    if (problem) { note(problem); return; }
    if (!cam) cam = new HUD.Camera();
    note('Включаю камеру…');
    try { await cam.start(); } catch (e) { note(HUD.cameraErrorText(e)); return; }
    state.srcId = 'cam' + (++counter); state.fileName = 'camera';
    const v = cam.video;
    note(`Камера · ${v.videoWidth}×${v.videoHeight}`);
    setMode('camera');
    fillCameraList().catch(() => {});
    cameraLoop();
  }
  async function switchCamera(deviceId) {
    if (cam.rec) return;
    if (deviceId) cam.deviceId = deviceId;
    else { cam.deviceId = null; cam.facing = cam.facing === 'user' ? 'environment' : 'user'; }
    try { await cam.start(); } catch (e) { note(HUD.cameraErrorText(e)); return; }
    live.reset();
    const v = cam.video;
    note(`Камера · ${v.videoWidth}×${v.videoHeight}`);
    fillCameraList().catch(() => {});
    cameraLoop();
  }
  // «Снять»: кадр в полном разрешении становится обычной картинкой.
  function takePhoto() {
    const shot = cam.grab();
    state.img = shot; state.imgId = 'shot' + (++counter); state.srcId = state.imgId; state.fileName = camName() + '.png';
    note(`Снимок с камеры · ${shot.width}×${shot.height}`);
    setMode('image');
    redraw();
  }
  const camLock = (on) => ['camFlip', 'camSelect', 'camMic', 'camOff'].forEach((id) => ($(id).disabled = on));
  async function startRec() {
    await cam.startRecording(view, $('camMic').classList.contains('on'));
    $('camRec').textContent = '■ Стоп'; $('camRec').classList.add('rec');
    camLock(true);
    recTimer = setInterval(() => { $('camTime').textContent = '● ' + HUD.fmtTime((performance.now() - cam.rec.t0) / 1000); }, 200);
  }
  async function stopRec() {
    clearInterval(recTimer); $('camTime').textContent = '';
    $('camRec').textContent = '⏺ Запись'; $('camRec').classList.remove('rec');
    camLock(false);
    const r = await cam.stopRecording();
    if (!r || !r.processed.size) { note('Запись пустая.'); return; }
    const name = camName();
    HUD.download(r.processed, `${name}_hud.${r.ext}`);   // обработанная запись — сразу в загрузки
    // Исходник открываем как видео: его можно экспортировать заново в полном качестве.
    const rawFile = new File([r.raw], `${name}_raw.${(r.raw.type || '').includes('mp4') ? 'mp4' : 'webm'}`, { type: r.raw.type || 'video/webm' });
    await loadVideo(rawFile);
    note($('fileinfo').textContent + ` · запись ${r.seconds.toFixed(1)} с сохранена; исходник открыт — можно скачать видео или гифку в полном качестве`
      + (r.micDenied ? ' · микрофон не разрешён — без звука' : ''));
  }
  $('camPhoto').onclick = () => startCamera('photo');
  $('camVideo').onclick = () => startCamera('video');
  $('camFlip').onclick = () => switchCamera(null);
  $('camSelect').onchange = (e) => switchCamera(e.target.value);
  $('camShot').onclick = takePhoto;
  $('camMic').onclick = () => $('camMic').classList.toggle('on');
  $('camRec').onclick = () => (cam && cam.rec ? stopRec() : startRec().catch((e) => { note('Запись не удалась: ' + e.message); }));
  $('camOff').onclick = () => { setMode('image'); note('Камера выключена'); redraw(); };

  // ---------- элементы управления ----------
  // Ползунок-полоса: заливка до значения рисуется через CSS-переменную --p.
  function paintBar(inp) {
    const min = +inp.min || 0, max = inp.max === '' ? 100 : +inp.max;
    inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%');
  }
  const bars = $$('input.bar[data-key]');
  bars.forEach((inp) => {
    const key = inp.dataset.key;
    if (!inp.max) inp.max = 100;
    if (!inp.min) inp.min = 0;
    inp.oninput = () => { state.s[key] = +inp.value; paintBar(inp); redraw(); updateVideoPlan(); updateGifPlan(); };
  });

  // Кнопки-«чипсы» (выбор одного варианта).
  const chipSets = [];
  function chips(el, items, key, after) {
    const render = () => {
      el.innerHTML = '';
      items.forEach(([val, label]) => {
        const b = document.createElement('button');
        b.className = 'chip'; b.textContent = label;
        b.classList.toggle('on', val === state.s[key]);
        b.onclick = () => { state.s[key] = val; render(); if (after) after(val); };
        el.appendChild(b);
      });
    };
    chipSets.push(render);
    render();
  }
  chips($('aspect'), [['src', 'Исходник'], ['4:5', '4:5'], ['1:1', '1:1'], ['9:16', '9:16'], ['16:9', '16:9']], 'aspect', redraw);
  chips($('density'), [['low', 'Мало'], ['mid', 'Средне'], ['high', 'Много']], 'density', redraw);
  chips($('anim'), [['off', 'Выкл'], ['calm', 'Спокойно'], ['active', 'Активно']], 'anim', redraw);
  chips($('every'), [[1, 'каждый кадр'], [2, '÷2'], [4, '÷4'], [8, '÷8']], 'analysisEvery');
  chips($('scale'), [[1, '1x · 1080'], [2, '2x · 2160'], [4, '4x · 4320']], 'exportScale');
  chips($('vRes'), [['720', '720p'], ['1080', '1080p'], ['src', 'исходник']], 'vRes', () => updateVideoPlan());
  chips($('vFps'), [[24, '24'], [30, '30 fps']], 'vFps', () => updateVideoPlan());
  chips($('vQuality'), [['low', 'Эконом'], ['mid', 'Норма'], ['high', 'Высокое']], 'vQuality', () => updateVideoPlan());
  chips($('gWidth'), [[480, '480'], [640, '640'], [800, '800 px']], 'gWidth', () => updateGifPlan());
  chips($('gFps'), [[12, '12'], [15, '15 fps']], 'gFps', () => updateGifPlan());
  // Флажки-«чипсы» (вкл/выкл).
  $$('[data-flag]').forEach((b) => {
    b.onclick = () => { state.s[b.dataset.flag] = !state.s[b.dataset.flag]; syncControls(); redraw(); updateVideoPlan(); };
  });

  // Панели интерфейса: круглые переключатели со стрелками.
  $$('[data-zone]').forEach((b) => {
    b.onclick = () => { const z = b.dataset.zone; state.s.zones[z] = !state.s.zones[z]; syncControls(); redraw(); };
  });

  // Цвета: пресеты и 4 своих цвета.
  function buildColors() {
    const pr = $('presets');
    pr.innerHTML = '';
    Object.entries(HUD.PRESETS).forEach(([k, p]) => {
      const b = document.createElement('button');
      b.className = 'sw' + (state.s.preset === k ? ' on' : '');
      b.title = p.name;
      b.innerHTML = `<i style="background:${p.accent}"></i>`;
      b.onclick = () => { state.s.preset = k; state.s.colors = p.colors.slice(); syncControls(); redraw(); };
      pr.appendChild(b);
    });
    const cu = $('custom');
    cu.innerHTML = '';
    HUD.CUSTOM_COLORS.forEach(([i, name]) => {
      const l = document.createElement('label');
      l.innerHTML = `<span class="sw"><i style="background:${state.s.colors[i]}"></i><input type="color" value="${state.s.colors[i].toLowerCase()}"></span>${name}`;
      const inp = l.querySelector('input'), sw = l.querySelector('i');
      inp.oninput = () => {
        state.s.colors[i] = inp.value.toUpperCase(); state.s.preset = 'custom'; sw.style.background = inp.value;
        $$('#presets .sw').forEach((b) => b.classList.remove('on'));
        redraw();
      };
      cu.appendChild(l);
    });
  }

  // Привести весь интерфейс в соответствие с state.s (после сброса и т. п.).
  function syncControls() {
    bars.forEach((inp) => { inp.value = state.s[inp.dataset.key]; paintBar(inp); });
    chipSets.forEach((r) => r());
    $$('[data-flag]').forEach((b) => b.classList.toggle('on', !!state.s[b.dataset.flag]));
    $$('[data-zone]').forEach((b) => {
      const on = !!state.s.zones[b.dataset.zone];
      b.classList.toggle('on', on);
      b.firstElementChild.src = on ? 'assets/icons/arrow-active.svg' : 'assets/icons/arrow.svg';
    });
    buildColors();
    $('seed').value = state.s.seed;
  }

  // Кнопка сброса активна (красная), только когда в группе есть что сбрасывать.
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function updateResets() {
    $$('.card[data-group]').forEach((card) => {
      const g = card.dataset.group;
      const dirty = g === 'input' ? state.srcId !== 'demo' : GROUPS[g].some((k) => !same(state.s[k], DEFAULTS[k]));
      card.querySelector('.reset').disabled = !dirty;
    });
  }

  // Кнопки сброса групп.
  $$('.card[data-group]').forEach((card) => {
    const btn = card.querySelector('.reset');
    const g = card.dataset.group;
    btn.onclick = () => {
      if (g === 'input') { resetToDemo(); return; }
      GROUPS[g].forEach((k) => { state.s[k] = clone(DEFAULTS[k]); });
      syncControls(); redraw();
    };
  });

  // «Дополнительно» — сворачиваемый блок.
  $('moreToggle').onclick = () => $('more').classList.toggle('open');

  // ---------- seed ----------
  const seedInp = $('seed');
  seedInp.onchange = () => { const v = parseInt(seedInp.value, 10); if (v >= 0) { state.s.seed = v; redraw(); } };
  function regen() { state.s.seed = HUD.randomSeed(); seedInp.value = state.s.seed; redraw(); }
  $('regen').onclick = regen;
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
    if (e.key === 'r' || e.key === 'к') regen();
    if (e.key === ' ' && state.mode === 'video') {
      e.preventDefault();
      if (e.target.tagName === 'BUTTON') e.target.blur();   // иначе пробел ещё и «нажмёт» кнопку
      togglePlay();
    }
  });

  // ---------- загрузка ----------
  let counter = 0;
  const isVideo = (f) => f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(f.name);
  async function loadVideo(file) {
    note(`Открываю ${file.name}…`);
    const vs = new HUD.VideoSource(file);
    try { await vs.ready; } catch (e) { note(e.message); return; }
    if (state.video) { state.video.video.pause(); URL.revokeObjectURL(state.video.video.src); }
    state.video = vs; state.srcId = 'v' + (++counter); state.fileName = file.name;
    const v = vs.video;
    note(`${file.name} · ${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(1)} с`);
    setMode('video');
    redraw();
  }
  function loadFile(file) {
    if (!file) return;
    if (isVideo(file)) { loadVideo(file); return; }
    if (!file.type.startsWith('image/')) { note('Этот файл не картинка и не видео'); return; }
    const im = new Image();
    im.onload = () => {
      state.img = im; state.imgId = 'f' + (++counter); state.srcId = state.imgId; state.fileName = file.name;
      note(`${file.name} · ${im.naturalWidth}×${im.naturalHeight}`);
      setMode('image');
      redraw();
    };
    im.onerror = () => note('Не удалось открыть этот файл');
    im.src = URL.createObjectURL(file);
  }
  function resetToDemo() {
    state.img = HUD.makeDemo(); state.imgId = 'demo'; state.srcId = 'demo'; state.fileName = 'specimen_demo.png';
    setMode('image'); note('Сейчас: демо-образец'); redraw();
  }
  $('filePhoto').onchange = (e) => { loadFile(e.target.files[0]); e.target.value = ''; };
  $('fileVideo').onchange = (e) => { loadFile(e.target.files[0]); e.target.value = ''; };
  const stage = $('stage');
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragging'); });
  stage.addEventListener('dragleave', (e) => { if (e.target === $('drop')) stage.classList.remove('dragging'); });
  stage.addEventListener('drop', (e) => {
    e.preventDefault(); stage.classList.remove('dragging');
    loadFile(e.dataTransfer.files[0]);
  });

  // ---------- экспорт фото ----------
  function runExport(btn, fn) {
    const btns = [$('savePng'), $('saveSvg'), $('copyPng'), $('pSnap')];
    btns.forEach((b) => (b.disabled = true));
    setTimeout(() => {
      fn().catch((e) => note('Ошибка: ' + e.message)).finally(() => { btns.forEach((b) => (b.disabled = false)); });
    }, 30);
  }
  $('savePng').onclick = () => runExport($('savePng'), () => HUD.exportPNG(frameState(), cur, state.s.exportScale));
  $('saveSvg').onclick = () => runExport($('saveSvg'), () => HUD.exportSVG(frameState(), cur));
  $('pSnap').onclick = () => runExport($('pSnap'), () => HUD.exportPNG(frameState(), cur, state.s.exportScale));
  // Копировать фото в буфер обмена (PNG). Браузеры умеют класть в буфер только картинки.
  // Запрос к буферу делаем прямо в обработчике клика (без задержек) — иначе Safari его не пропустит.
  $('copyPng').onclick = () => {
    if (!navigator.clipboard || !window.ClipboardItem) { note('Этот браузер не умеет копировать картинки — используйте «Скачать фото»'); return; }
    note('Копирую…');
    const blobPromise = HUD.renderPNGBlob(frameState(), cur, state.s.exportScale);
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
      .then(() => note('Фото скопировано в буфер обмена — можно вставлять'))
      .catch(() => note('Браузер не дал доступ к буферу обмена — кликните по странице и нажмите ещё раз (или используйте «Скачать фото»)'));
  };

  // ---------- экспорт видео и GIF ----------
  const vOpts = () => ({ res: state.s.vRes, fps: state.s.vFps, quality: state.s.vQuality, audio: state.s.vAudio });
  function updateVideoPlan() {
    if (state.mode !== 'video') return;
    const p = HUD.videoExportPlan(state, vOpts());
    $('vPlan').textContent = `${p.ew}×${p.eh} · ${p.dur.toFixed(1)} с · ${p.frames} кадров · ≈ ${p.estMB < 1 ? p.estMB.toFixed(2) : p.estMB.toFixed(1)} МБ`
      + (p.capped ? ' · размер уменьшен до предела кодека' : '');
  }
  let exportCtl = null;
  async function runLong(fn, done) {
    if (exportCtl || state.mode !== 'video') return;
    state.video.video.pause();
    drawNow();
    exportCtl = new AbortController();
    const btns = [$('saveVideo'), $('saveGif')];
    btns.forEach((b) => (b.disabled = true)); $('vProgress').hidden = false;
    const t0 = performance.now();
    const prog = (k, text) => {
      $('vBar').style.width = Math.round(k * 100) + '%';
      const el = (performance.now() - t0) / 1000, left = k > 0.02 ? el / k - el : 0;
      $('vText').textContent = `${Math.round(k * 100)}% · ${text}` + (left > 1 ? ` · ~${Math.ceil(left)} с` : '');
    };
    try {
      $('vText').textContent = 'Готовлю…';
      $('vText').textContent = done(await fn(prog, exportCtl.signal));
    } catch (e) {
      $('vText').textContent = e.name === 'AbortError' ? 'Отменено' : 'Ошибка: ' + e.message;
      if (e.name !== 'AbortError') console.error(e);
    } finally {
      exportCtl = null; btns.forEach((b) => (b.disabled = state.mode !== 'video'));
      setTimeout(() => { if (!exportCtl) { $('vBar').style.width = '0'; $('vProgress').hidden = true; } }, 6000);
    }
  }
  const mb = (b) => (b / 1e6 < 1 ? (b / 1e6).toFixed(2) : (b / 1e6).toFixed(1)) + ' МБ';
  $('saveVideo').onclick = () => runLong((prog, sig) => HUD.exportVideo(state, cur, vOpts(), prog, sig),
    (r) => `Готово: ${r.fmt.toUpperCase()} ${r.ew}×${r.eh}, ${mb(r.bytes)}` + (r.audioMissing ? ` · без звука: ${r.audioMissing}` : ''));

  const gOpts = () => ({ width: state.s.gWidth, fps: state.s.gFps });
  let gifTimer = null, gifKey = null, gifPending = null;
  function updateGifPlan() {
    if (state.mode !== 'video' || !state.video) return;
    const p = HUD.gifPlan(state, gOpts());
    const head = `${p.gw}×${p.gh} · ${p.dur.toFixed(1)} с${p.clipped ? ' (обрежу до 8 с)' : ''} · ${p.frames} кадров`;
    const key = JSON.stringify([gOpts(), state.srcId, state.video.inT, state.video.outT, HUD.IMAGE_KEYS.map((k) => state.s[k]), HUD.LAYOUT_KEYS.map((k) => state.s[k]), state.s.anim]);
    if (key === gifKey || key === gifPending) return;   // уже посчитано или считается
    gifPending = key;
    $('gPlan').textContent = head + ' · считаю вес…';
    clearTimeout(gifTimer);
    gifTimer = setTimeout(async () => {
      if (exportCtl || !cur.scene) { gifPending = null; return; }   // попробуем при следующем обновлении
      try {
        const e = await HUD.estimateGIF(state, cur, gOpts());
        if (gifPending !== key) return;                           // настройки успели поменяться
        gifKey = key;
        $('gPlan').textContent = head + ` · ≈ ${mb(e.bytes)}`;
      } catch (err) { $('gPlan').textContent = head; }
      if (gifPending === key) gifPending = null;
    }, 600);
  }
  $('saveGif').onclick = () => runLong((prog, sig) => HUD.exportGIF(state, cur, gOpts(), prog, sig),
    (r) => `Готово: GIF ${r.gw}×${r.gh}, ${r.frames} кадров, ${mb(r.bytes)}` + (r.clipped ? ' · обрезано до 8 с' : ''));
  $('vCancel').onclick = () => { if (exportCtl) exportCtl.abort(); };

  // ---------- старт ----------
  syncControls();
  setMode('image');
  note('Сейчас: демо-образец');
  HUD.state = state; HUD.cur = cur; HUD.redraw = redraw; HUD.drawNow = drawNow;   // для отладки
  HUD.loadFont().catch(() => {}).finally(() => { fontReady = true; redraw(); });
})();
