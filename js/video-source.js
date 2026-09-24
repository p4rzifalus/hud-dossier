// Видео-источник: загрузка файла, плеер, точная перемотка на кадр, отрезок «начало — конец».

HUD.VideoSource = function (file) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = false;
  v.setAttribute('playsinline', '');
  this.video = v;
  this.file = file;
  this.inT = 0; this.outT = 0;
  const self = this;

  // Готово, когда известен размер и показан первый кадр.
  this.ready = new Promise((res, rej) => {
    v.addEventListener('loadeddata', async () => {
      // У записей с камеры длительность бывает неизвестна — заставляем браузер её вычислить.
      if (!isFinite(v.duration)) {
        await new Promise((r) => { v.addEventListener('durationchange', r, { once: true }); v.currentTime = 1e7; });
      }
      self.outT = v.duration;
      await self.seek(0);
      res();
    }, { once: true });
    v.addEventListener('error', () => rej(new Error('Браузер не смог открыть это видео (возможно, неподдерживаемый кодек).')), { once: true });
  });
  v.src = URL.createObjectURL(file);

  // Перемотка с ожиданием, пока нужный кадр действительно появится.
  this.seek = function (t) {
    t = Math.max(0, Math.min(v.duration || 0, t));
    return new Promise((res) => {
      const done = () => {
        if (v.requestVideoFrameCallback) {
          let fired = false;
          v.requestVideoFrameCallback(() => { fired = true; res(); });
          setTimeout(() => { if (!fired) res(); }, 250);
        } else res();
      };
      if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) { res(); return; }
      v.addEventListener('seeked', done, { once: true });
      v.currentTime = t;
    });
  };

  // Текущий кадр в полном разрешении — для стоп-кадра.
  this.grabFrame = function () {
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  };
};

HUD.fmtTime = (t) => {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
};
