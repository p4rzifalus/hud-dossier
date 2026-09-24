// Камера: живое превью, выбор камеры, снимок, запись.
// Камера работает только на https или localhost — так устроены браузеры.
HUD.cameraProblem = function () {
  if (!window.isSecureContext) return 'Камера работает только по https или с localhost. Откройте https://p4rzifalus.github.io/hud-dossier/ или запустите start.command.';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'Этот браузер не даёт доступ к камере.';
  return null;
};

HUD.cameraErrorText = function (e) {
  if (!e) return '';
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return 'Доступ к камере запрещён. Разрешите его в настройках браузера для этой страницы.';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return 'Камера не найдена.';
  if (e.name === 'NotReadableError') return 'Камера занята другим приложением.';
  return 'Не удалось включить камеру: ' + e.message;
};

// Формат записи: MP4, если браузер умеет, иначе WebM.
HUD.pickRecorderMime = function (withAudio) {
  const list = withAudio
    ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
};

HUD.Camera = function () {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
  this.video = v;
  this.stream = null;
  this.facing = 'environment';   // 'environment' — основная, 'user' — фронтальная
  this.deviceId = null;
  this.t0 = performance.now();
  this.rec = null;
  const self = this;

  this.start = async function () {
    self.stop();
    const video = self.deviceId ? { deviceId: { exact: self.deviceId } } : { facingMode: { ideal: self.facing } };
    Object.assign(video, { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
    self.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    v.srcObject = self.stream;
    await v.play();
    if (v.readyState < 2) await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
    const track = self.stream.getVideoTracks()[0];
    const st = track.getSettings ? track.getSettings() : {};
    if (st.deviceId) self.deviceId = st.deviceId;
    if (st.facingMode) self.facing = st.facingMode;
    self.t0 = performance.now();
  };

  this.devices = async function () {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  };

  this.stop = function () {
    if (self.stream) self.stream.getTracks().forEach((t) => t.stop());
    self.stream = null;
    v.srcObject = null;
  };

  this.time = () => (performance.now() - self.t0) / 1000;

  // Кадр с камеры в полном разрешении.
  this.grab = function () {
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  };

  // Запись: обработанный результат (то, что на экране) + исходный поток камеры.
  this.startRecording = async function (viewCanvas, withMic) {
    let mic = null;
    if (withMic) {
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { mic = null; }
    }
    const audio = mic ? mic.getAudioTracks() : [];
    const mime = HUD.pickRecorderMime(audio.length > 0);
    const processed = viewCanvas.captureStream(30);
    audio.forEach((t) => processed.addTrack(t));
    const raw = new MediaStream([...self.stream.getVideoTracks(), ...audio]);
    const mk = (stream) => {
      const r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10e6 } : { videoBitsPerSecond: 10e6 });
      const chunks = [];
      r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise((res) => { r.onstop = () => res(new Blob(chunks, { type: r.mimeType || mime || 'video/webm' })); });
      r.start(1000);
      return { r, done };
    };
    self.rec = { p: mk(processed), raw: mk(raw), mic, t0: performance.now(), audio: audio.length > 0, micDenied: withMic && !mic };
    return self.rec;
  };

  this.stopRecording = async function () {
    const rec = self.rec;
    if (!rec) return null;
    self.rec = null;
    rec.p.r.stop(); rec.raw.r.stop();
    const [processed, raw] = await Promise.all([rec.p.done, rec.raw.done]);
    if (rec.mic) rec.mic.getTracks().forEach((t) => t.stop());
    const ext = (processed.type || '').includes('mp4') ? 'mp4' : 'webm';
    return { processed, raw, ext, seconds: (performance.now() - rec.t0) / 1000, audio: rec.audio, micDenied: rec.micDenied };
  };
};
