// Палитры: 5 цветов от самого тёмного к самому светлому.
// Яркость пикселя переводится в цвет по этой шкале (gradient map).
HUD.PRESETS = {
  acid:  { name: 'Кислота', colors: ['#000000', '#06140A', '#1F5C2A', '#7CFF6B', '#E8FFE0'] },
  amber: { name: 'Янтарь',  colors: ['#000000', '#140B02', '#5C3A0F', '#FFB23D', '#FFF1D6'] },
  cyan:  { name: 'Циан',    colors: ['#000000', '#031214', '#0F4F5C', '#4FF3FF', '#E0FDFF'] },
  red:   { name: 'Красный', colors: ['#000000', '#160404', '#5C1414', '#FF4A3D', '#FFE3E0'] },
};

// Где на шкале яркости стоит каждый из 5 цветов (0 = чёрный, 1 = белый).
HUD.STOP_POS = [0, 0.16, 0.42, 0.78, 1];

HUD.hexToRgb = function (hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

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
