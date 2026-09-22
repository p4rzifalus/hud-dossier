// Генератор случайных чисел от seed: одинаковый seed → одинаковая последовательность.
window.HUD = window.HUD || {};

HUD.rng = function (seed) {
  let a = seed >>> 0;
  const r = function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (min, max) => min + r() * (max - min);
  r.int = (min, max) => Math.floor(min + r() * (max - min + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
};

// Быстрый «шум по координатам»: одно и то же (x, y, seed) → одно и то же число 0..1.
HUD.hash2 = function (x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

HUD.randomSeed = () => Math.floor(Math.random() * 900000) + 100000;
