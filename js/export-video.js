// Покадровый экспорт видео. Не в реальном времени: каждый кадр ролика точно декодируется (Mediabunny),
// полностью рендерится в итоговом разрешении и кодируется встроенным кодеком браузера (WebCodecs).
// Раскладка берётся из превью, поэтому видео совпадает с тем, что на экране.
HUD.VIDEO_BPP = { low: 0.05, mid: 0.1, high: 0.18 };   // бит на пиксель кадра — задаёт битрейт
HUD.MAX_VIDEO_PX = 8.8e6;                               // предел H.264 (уровень 5.2) — около 4K

// Размеры, число кадров и примерный вес файла — показываем до экспорта.
HUD.videoExportPlan = function (state, o) {
  const vs = state.video, v = vs.video, s = state.s;
  const { W, H } = HUD.posterSize(s.aspect, v);
  const short = o.res === 'src' ? Math.min(v.videoWidth, v.videoHeight) : +o.res;
  let scale = short / Math.min(W, H), capped = false;
  if (W * H * scale * scale > HUD.MAX_VIDEO_PX) { scale = Math.sqrt(HUD.MAX_VIDEO_PX / (W * H)); capped = true; }
  const ew = Math.round((W * scale) / 2) * 2, eh = Math.round((H * scale) / 2) * 2;   // кодекам нужны чётные размеры
  scale = ew / W;
  const dur = Math.max(0, vs.outT - vs.inT);
  const frames = Math.max(1, Math.floor(dur * o.fps + 1e-6));
  const bitrate = Math.round(ew * eh * o.fps * HUD.VIDEO_BPP[o.quality]);
  const estMB = ((bitrate + (o.audio ? 128000 : 0)) * dur) / 8 / 1e6;
  return { W, H, scale, ew, eh, dur, frames, bitrate, estMB, capped };
};

HUD.exportVideo = async function (state, cur, o, onProgress, signal) {
  const MB = window.Mediabunny;
  if (!MB) throw new Error('Не загрузилась библиотека видео (js/vendor/mediabunny.min.js).');
  if (typeof VideoEncoder === 'undefined') throw new Error('Этот браузер не умеет кодировать видео. Нужен Chrome, Edge или Safari 16.4+.');
  const vs = state.video, plan = HUD.videoExportPlan(state, o);
  const { ew, eh, scale, frames, dur, bitrate } = plan, fps = o.fps, inT = vs.inT;

  const input = new MB.Input({ source: new MB.BlobSource(vs.file), formats: MB.ALL_FORMATS });
  const vTrack = await input.getPrimaryVideoTrack();
  if (!vTrack) throw new Error('В файле не нашлось видеодорожки.');
  const aTrack = o.audio ? await input.getPrimaryAudioTrack() : null;

  // MP4 (H.264), а если браузер не умеет — WebM.
  let fmt = null, vcodec = null;
  for (const [f, c] of [['mp4', 'avc'], ['webm', 'vp9'], ['webm', 'vp8']]) {
    if (await MB.canEncodeVideo(c, { width: ew, height: eh, bitrate })) { fmt = f; vcodec = c; break; }
  }
  if (!vcodec) throw new Error(`Браузер не может закодировать видео ${ew}×${eh}. Попробуйте меньшее разрешение.`);
  let acodec = null;
  if (aTrack) {
    for (const c of fmt === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis']) {
      if (await MB.canEncodeAudio(c, { numberOfChannels: aTrack.numberOfChannels, sampleRate: aTrack.sampleRate, bitrate: 128000 })) { acodec = c; break; }
    }
  }

  const output = new MB.Output({
    format: fmt === 'mp4' ? new MB.Mp4OutputFormat({ fastStart: 'in-memory' }) : new MB.WebMOutputFormat(),
    target: new MB.BufferTarget(),
  });
  const enc = document.createElement('canvas');
  enc.width = ew; enc.height = eh;
  const ectx = enc.getContext('2d');
  const videoSource = new MB.CanvasSource(enc, { codec: vcodec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource = null;
  if (acodec) { audioSource = new MB.AudioSampleSource({ codec: acodec, bitrate: 128000 }); output.addAudioTrack(audioSource); }
  await output.start();

  const live = new HUD.Live();
  live.adoptScene(cur.scene);
  const exportState = { srcId: state.srcId, fileName: state.fileName, s: state.s };
  const out = document.createElement('canvas');
  const times = []; for (let i = 0; i < frames; i++) times.push(inT + i / fps);
  const aborted = () => signal && signal.aborted;
  const share = acodec ? 0.95 : 1;
  let i = 0, last = null;
  try {
    const sink = new MB.CanvasSink(vTrack, { poolSize: 2 });
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (aborted()) throw new DOMException('Экспорт отменён', 'AbortError');
      const src = wc ? wc.canvas : last;
      if (src) {
        last = src;
        live.frame(src, exportState, out, scale, times[i]);
        ectx.drawImage(out, 0, 0);
      }
      await videoSource.add(i / fps, 1 / fps);
      i++;
      onProgress && onProgress((i / frames) * share, `кадр ${i} / ${frames}`);
    }
    // Звук: вырезаем отрезок [начало, конец] и сдвигаем к нулю.
    if (audioSource) {
      onProgress && onProgress(share, 'звук…');
      for await (let smp of new MB.AudioSampleSink(aTrack).samples(inT, inT + dur)) {
        if (aborted()) { smp.close(); throw new DOMException('Экспорт отменён', 'AbortError'); }
        const rel = smp.timestamp - inT;
        if (rel < 0) {
          const cut = Math.ceil(-rel * smp.sampleRate);
          if (cut >= smp.numberOfFrames) { smp.close(); continue; }
          const t = smp.trim(cut); smp.close(); smp = t;
        }
        const start = Math.max(0, smp.timestamp - inT);
        const keep = Math.floor((dur - start) * smp.sampleRate);
        if (keep <= 0) { smp.close(); break; }
        if (keep < smp.numberOfFrames) { const t = smp.trim(0, keep); smp.close(); smp = t; }
        smp.setTimestamp(start);
        await audioSource.add(smp);
        smp.close();
      }
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    live.dispose();
  }
  const blob = new Blob([output.target.buffer], { type: fmt === 'mp4' ? 'video/mp4' : 'video/webm' });
  HUD.download(blob, HUD.exportName(state, '.' + fmt));
  return { fmt, vcodec, acodec, ew, eh, frames, bytes: blob.size, audioMissing: !o.audio ? null : !aTrack ? 'в ролике нет звука' : !acodec ? 'браузер не умеет кодировать звук' : null };
};
