// Палитры: 5 цветов от самого тёмного к самому светлому.
// Яркость пикселя переводится в цвет по этой шкале (gradient map).
// Первый цвет всегда чёрный; остальные 4 — Тени, Полутона, Свечение (акцент), Блики.

HUD.hexToRgb = function (hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
HUD.rgbToHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

// Вся шкала из одного цвета: чёрный → тень → полутон → цвет → почти белый.
HUD.paletteFromAccent = function (hex) {
  const c = HUD.hexToRgb(hex);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const black = [0, 0, 0], white = [255, 255, 255];
  return [black, mix(black, c, 0.07), mix(black, c, 0.32), c, mix(c, white, 0.86)].map(HUD.rgbToHex);
};

// Пресеты из макета: в квадрате показывается сам цвет, шкала строится из него.
HUD.PRESETS = {
  green:   { name: 'Зелёный',   accent: '#1DFF00' },
  blue:    { name: 'Синий',     accent: '#005EFF' },
  magenta: { name: 'Пурпурный', accent: '#FF00E5' },
  white:   { name: 'Белый',     accent: '#FFFFFF' },
};
Object.values(HUD.PRESETS).forEach((p) => { p.colors = HUD.paletteFromAccent(p.accent); });

// Подписи редактируемых цветов (индексы 1–4 палитры).
HUD.CUSTOM_COLORS = [[1, 'Тени'], [2, 'Полутона'], [3, 'Свечение'], [4, 'Блики']];

// Где на шкале яркости стоит каждый из 5 цветов (0 = чёрный, 1 = белый).
HUD.STOP_POS = [0, 0.16, 0.42, 0.78, 1];

// Таблица на 256 значений яркости → r,g,b.
HUD.buildLUT = function (colors) {
  const rgb = colors.map(HUD.hexToRgb);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < HUD.STOP_POS.length - 2 && v > HUD.STOP_POS[k + 1]) k++;
    const t = (v - HUD.STOP_POS[k]) / (HUD.STOP_POS[k + 1] - HUD.STOP_POS[k]);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * t;
  }
  return lut;
};
