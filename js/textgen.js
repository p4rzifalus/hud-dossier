// Генератор псевдонаучного текста: слова из слогов + настоящие данные о картинке.
HUD.TextGen = function (rng, meta, A) {
  const SYL = ['ab', 'ex', 'ul', 'or', 'ta', 'ne', 'vi', 'lo', 'ra', 'ki', 'sy', 'tho', 'phy', 'cy', 'lu', 'mo', 'ven',
    'tri', 'qua', 'ser', 'dor', 'gen', 'lith', 'morph', 'ox', 'pha', 'cal', 'ter', 'min', 'rho', 'zel', 'nod', 'cri'];
  const END = ['ium', 'ata', 'osis', 'ide', 'ic', 'al', 'us', 'ae', 'on', 'ix', 'yne', 'ar'];
  const TERMS = ['SCAN', 'SPEC', 'FIELD', 'NODE', 'VECTOR', 'SIGNAL', 'LUMA', 'PHASE', 'CORE', 'MATRIX', 'SAMPLE',
    'INDEX', 'DELTA', 'FLUX', 'GRID', 'ARRAY', 'CHANNEL', 'OBJ', 'REF', 'SEQ', 'GAIN', 'BAND', 'AXIS', 'MASK', 'TRACE'];
  const r = rng;
  const pad = (n, k) => String(n).padStart(k, '0');

  const word = () => { let w = ''; const n = r.int(1, 3); for (let i = 0; i < n; i++) w += r.pick(SYL); return w + (r.chance(0.6) ? r.pick(END) : ''); };
  const code = () => r.pick(['A', 'B', 'C', 'D', 'H', 'K', 'M', 'R', 'S', 'X', 'Z']) + r.pick(['X', 'R', 'V', 'T', 'Q']) + '-' + pad(r.int(0, 9999), 4) + (r.chance(0.5) ? '-' + r.pick(['A', 'B', 'C', 'Ω', 'Δ']) : '');
  const num = (d) => (r() * Math.pow(10, r.int(0, 2))).toFixed(d == null ? r.int(1, 3) : d);
  const hex = (rgb) => '#' + rgb.map((v) => pad(Math.round(v).toString(16), 2)).join('').toUpperCase();

  // Настоящие факты о картинке — используются в первую очередь.
  const real = [
    ['SPECIMEN ID', meta.specimenId],
    ['SOURCE', meta.fileName.toUpperCase().slice(0, 22)],
    ['SRC RES', `${meta.srcW}×${meta.srcH}`],
    ['OUT RES', `${A.W}×${A.H}`],
    ['DATE', meta.date],
    ['SRC DOM', hex(A.srcColor)],
    ['PAL KEY', meta.colors[3].toUpperCase()],
    ['MEAN LUM', A.mean.toFixed(3)],
    ['σ LUM', A.sigma.toFixed(3)],
    ['P95 LUM', A.pct(0.95).toFixed(3)],
    ['VOID RATIO', (A.darkRatio * 100).toFixed(1) + '%'],
    ['EDGE DENS', (A.edgeDensity * 100).toFixed(2) + '%'],
    ['NODES', String(A.nodes.length)],
    ['CENTROID', `${Math.round(A.centroid.x)},${Math.round(A.centroid.y)}`],
    ['OBJ EXTENT', `${Math.round(A.bbox.w)}×${Math.round(A.bbox.h)}`],
    ['SEED', String(meta.seed)],
  ];
  let realIdx = r.int(0, real.length - 1);

  this.word = word;
  this.code = code;
  this.num = num;
  this.term = () => r.pick(TERMS);
  this.title = () => r.pick(TERMS) + (r.chance(0.5) ? ' ' + r.pick(TERMS) : '') + (r.chance(0.4) ? ' ' + pad(r.int(1, 99), 2) : '');
  this.kv = () => {
    if (r.chance(0.55)) { realIdx = (realIdx + 1) % real.length; return real[realIdx]; }
    const k = r.chance(0.5) ? r.pick(TERMS) + ' ' + r.pick(TERMS) : word().toUpperCase().slice(0, 10) + ' ' + r.pick(TERMS);
    const v = r.pick([() => num(), () => code(), () => word().toUpperCase(), () => num(2) + r.pick(['Hz', 'nm', 'µm', 'ms', '%', 'dB', 'K'])])();
    return [k.slice(0, 16), v];
  };
  this.realKV = () => { realIdx = (realIdx + 1) % real.length; return real[realIdx]; };
  this.sentence = (n) => {
    const ws = []; const k = n || r.int(5, 12);
    for (let i = 0; i < k; i++) ws.push(r.chance(0.12) ? r.pick(TERMS).toLowerCase() : r.chance(0.08) ? num() : word());
    ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1);
    return ws.join(' ') + '.';
  };
  // Разбивает текст на строки заданной ширины (в символах).
  this.wrap = (text, cols) => {
    const out = []; let line = '';
    text.split(' ').forEach((w) => {
      if ((line + ' ' + w).trim().length > cols) { if (line) out.push(line); line = w.slice(0, cols); } else line = (line + ' ' + w).trim();
    });
    if (line) out.push(line);
    return out;
  };
};

// Метаданные постера.
HUD.makeMeta = function (state, W, H) {
  const img = state.img;
  let h = 0; const key = state.fileName + state.s.seed;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  const hr = HUD.rng(h);
  const L = 'ABCDEHKMRSTXZ';
  const d = new Date();
  return {
    fileName: state.fileName, srcW: img.naturalWidth || img.width, srcH: img.naturalHeight || img.height,
    date: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`,
    specimenId: L[hr.int(0, L.length - 1)] + L[hr.int(0, L.length - 1)] + '-' + String(hr.int(1000, 9999)) + '-' + L[hr.int(0, 3)],
    seed: state.s.seed, colors: state.s.colors, W, H,
  };
};
