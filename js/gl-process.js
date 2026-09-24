// Обработка кадра на видеокарте (WebGL2). Та же математика, что в image-process.js:
// кривая контраста → зерно → дизеринг → палитра → bloom (2 радиуса) → сканлайны.
// Плюс маленькая «карта яркости» для анализа (сетка 4×4 единицы постера), которую можно прочитать обратно.
(function () {
  const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

  // Основной проход: картинка → кривая → зерно → дизеринг → палитра. В альфу кладём яркость.
  const FS_MAIN = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D src;
uniform sampler2D lut;
uniform vec2 outSize;
uniform vec4 fitRect;          // x, y (от верхнего левого угла), ширина, высота картинки в пикселях холста
uniform float bp, expo, amp, g, levels;
uniform int dither;
uniform uint seed;
uniform float bayer[64];
out vec4 o;
float hash2(uint x, uint y, uint s) {
  uint h = x * 374761393u + y * 668265263u + s * 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h) / 4294967296.0;
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, outSize.y - gl_FragCoord.y);
  vec2 suv = (px - fitRect.xy) / fitRect.zw;
  vec3 c = vec3(0.0);
  if (suv.x >= 0.0 && suv.y >= 0.0 && suv.x < 1.0 && suv.y < 1.0) c = texture(src, suv).rgb;
  float L = floor(dot(floor(c * 255.0 + 0.5), vec3(77.0, 150.0, 29.0)) / 256.0) / 255.0;
  float v = clamp((L - bp) / (1.0 - bp), 0.0, 1.0);
  v = v < 0.5 ? 0.5 * pow(2.0 * v, expo) : 1.0 - 0.5 * pow(2.0 * (1.0 - v), expo);
  uint gx = uint(floor(floor(px.x) / g)), gy = uint(floor(floor(px.y) / g));
  if (amp > 0.0) v += (hash2(gx, gy, seed) - 0.5) * amp * (0.2 + v);
  v = clamp(v, 0.0, 1.0);
  if (dither == 1) v = floor(v * (levels - 1.0) + bayer[int((gy & 7u) * 8u + (gx & 7u))]) / (levels - 1.0);
  float li = floor(v * 255.0 + 0.5);
  o = vec4(texelFetch(lut, ivec2(int(li), 0), 0).rgb, li / 255.0);
}`;

  // Яркие места для свечения (на уменьшенной в 4 раза сетке).
  const FS_BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D base;
uniform vec2 baseSize;
uniform float f, thr;
out vec4 o;
void main() {
  float v = texture(base, (gl_FragCoord.xy * f) / baseSize).a;
  float m = v > thr ? (v - thr) / (1.0 - thr + 1e-6) : 0.0;
  o = vec4(m, 0.0, 0.0, 1.0);
}`;

  // Размытие по одной оси (гаусс ≈ трём проходам «коробкой» из версии для картинок).
  const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform ivec2 dir;
uniform float sigma;
out vec4 o;
void main() {
  ivec2 size = textureSize(tex, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  int R = min(64, int(ceil(sigma * 3.0)));
  float sum = 0.0, wsum = 0.0;
  for (int i = -R; i <= R; i++) {
    ivec2 q = clamp(p + dir * i, ivec2(0), size - 1);
    float w = exp(-float(i * i) / (2.0 * sigma * sigma));
    sum += texelFetch(tex, q, 0).r * w; wsum += w;
  }
  o = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`;

  // Сборка: основа + свечение + сканлайны.
  const FS_COMP = `#version 300 es
precision highp float;
uniform sampler2D base, bn, bw;
uniform vec2 outSize;
uniform vec3 glow;
uniform float k, unit, scanOffset;
uniform int scan;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / outSize;
  vec3 c = texelFetch(base, ivec2(gl_FragCoord.xy), 0).rgb;
  float m = texture(bn, uv).r * 0.7 + texture(bw, uv).r * 0.9;
  c = min(c + min(glow * m * k, vec3(1.0)), vec3(1.0));
  if (scan == 1) {
    float row = floor(outSize.y - gl_FragCoord.y);
    float period = 4.0 * unit, lh = max(1.0, floor(unit + 0.5));
    if (mod(row - scanOffset, period) < lh) c *= 0.7;
  }
  o = vec4(c, 1.0);
}`;

  // Карта яркости для анализа: среднее 4×4 проб в каждой ячейке. Строка 0 = верх постера.
  const FS_ANALYSIS = `#version 300 es
precision highp float;
uniform sampler2D base;
uniform float unit;
out vec4 o;
void main() {
  ivec2 size = textureSize(base, 0);
  vec2 cell = floor(gl_FragCoord.xy);            // x — слева, y — сверху
  float sum = 0.0;
  for (int sy = 0; sy < 4; sy++) for (int sx = 0; sx < 4; sx++) {
    int x = min(size.x - 1, int((cell.x * 4.0 + float(sx) + 0.5) * unit));
    int yTop = min(size.y - 1, int((cell.y * 4.0 + float(sy) + 0.5) * unit));
    sum += texelFetch(base, ivec2(x, size.y - 1 - yTop), 0).a;
  }
  o = vec4(sum / 16.0, 0.0, 0.0, 1.0);
}`;

  const BAYER8 = [0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,
    3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21].map(v => (v + 0.5) / 64);

  HUD.GLProcessor = function () {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 недоступен');
    this.canvas = canvas;

    function compile(fs) {
      const mk = (type, src) => {
        const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const pr = gl.createProgram();
      gl.attachShader(pr, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      const u = {};
      const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(pr, i).name.replace('[0]', ''); u[name] = gl.getUniformLocation(pr, name); }
      return { pr, u };
    }
    const P = { main: compile(FS_MAIN), bright: compile(FS_BRIGHT), blur: compile(FS_BLUR), comp: compile(FS_COMP), an: compile(FS_ANALYSIS) };

    // Один большой треугольник на весь экран.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    function tex(w, h, filter) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    }
    function target(w, h, filter) {
      const t = tex(w, h, filter), fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t, fb, w, h };
    }
    function draw(prog, tgt, w, h) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fb : null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog.pr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }

    const srcTex = tex(0, 0, gl.LINEAR);
    const lutTex = tex(0, 0, gl.NEAREST);
    let lutKey = null, sizeKey = null, T = null, anT = null, anW = 0, anH = 0, last = null;

    this.render = function (source, iw, ih, s, o) {
      const { pw, ph, W, H } = o;
      const unit = pw / W;
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      const sk = pw + 'x' + ph;
      if (sizeKey !== sk) {
        const f = 4, sw = Math.ceil(pw / f), sh = Math.ceil(ph / f);
        T = { base: target(pw, ph, gl.LINEAR), m: target(sw, sh, gl.LINEAR), tmp: target(sw, sh, gl.LINEAR),
          n: target(sw, sh, gl.LINEAR), w: target(sw, sh, gl.LINEAR), sw, sh };
        sizeKey = sk;
      }
      const lk = s.colors.join();
      if (lutKey !== lk) {
        const rgb = HUD.buildLUT(s.colors), rgba = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        lutKey = lk;
      }
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

      // где лежит картинка (как fitCover в версии для картинок)
      const k = Math.max(pw / iw, ph / ih) * (o.zoom || 1);
      const fw = iw * k, fh = ih * k;
      const fx = pw * o.cx - fw / 2, fy = ph * o.cy - fh / 2;

      // 1. основа
      let u = P.main.u;
      gl.useProgram(P.main.pr);
      bindTex(0, srcTex); gl.uniform1i(u.src, 0);
      bindTex(1, lutTex); gl.uniform1i(u.lut, 1);
      gl.uniform2f(u.outSize, pw, ph);
      gl.uniform4f(u.fitRect, fx, fy, fw, fh);
      gl.uniform1f(u.bp, (s.shadows / 100) * 0.55);
      gl.uniform1f(u.expo, 1 + (s.contrast / 100) * 2.2);
      gl.uniform1f(u.amp, (s.grain / 100) * 0.22);
      gl.uniform1f(u.g, Math.max(1, Math.round(unit)));
      gl.uniform1f(u.levels, 6);
      gl.uniform1i(u.dither, s.dither ? 1 : 0);
      gl.uniform1ui(u.seed, (o.seed >>> 0));
      gl.uniform1fv(u.bayer, BAYER8);
      draw(P.main, T.base, pw, ph);

      // 2. свечение
      const bloom = s.bloomStrength > 0;
      if (bloom) {
        u = P.bright.u; gl.useProgram(P.bright.pr);
        bindTex(0, T.base.t); gl.uniform1i(u.base, 0);
        gl.uniform2f(u.baseSize, pw, ph); gl.uniform1f(u.f, 4); gl.uniform1f(u.thr, s.bloomThreshold / 100);
        draw(P.bright, T.m, T.sw, T.sh);
        const blur = (out, r) => {
          const sigma = Math.sqrt(r * (r + 1));
          u = P.blur.u; gl.useProgram(P.blur.pr);
          gl.uniform1f(u.sigma, sigma); gl.uniform1i(u.tex, 0);
          bindTex(0, T.m.t); gl.uniform2i(u.dir, 1, 0); draw(P.blur, T.tmp, T.sw, T.sh);
          bindTex(0, T.tmp.t); gl.uniform2i(u.dir, 0, 1); draw(P.blur, out, T.sw, T.sh);
        };
        blur(T.n, Math.max(1, Math.round((3 * unit) / 4)));
        blur(T.w, Math.max(1, Math.round((16 * unit) / 4)));
      }

      // 3. сборка на холст
      u = P.comp.u; gl.useProgram(P.comp.pr);
      bindTex(0, T.base.t); gl.uniform1i(u.base, 0);
      bindTex(1, T.n.t); gl.uniform1i(u.bn, 1);
      bindTex(2, T.w.t); gl.uniform1i(u.bw, 2);
      gl.uniform2f(u.outSize, pw, ph);
      gl.uniform3fv(u.glow, HUD.hexToRgb(s.colors[3]).map((v) => v / 255));
      gl.uniform1f(u.k, bloom ? (s.bloomStrength / 100) * 1.8 : 0);
      gl.uniform1f(u.unit, unit);
      gl.uniform1f(u.scanOffset, o.scanOffset || 0);
      gl.uniform1i(u.scan, s.scanlines ? 1 : 0);
      draw(P.comp, null, pw, ph);
      last = { W, H, unit };
      return canvas;
    };

    // Освободить видеокарту (браузер держит ограниченное число таких холстов).
    this.dispose = function () {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    };

    // Карта яркости последнего кадра: { lum, w, h } — сетка ячеек 4×4 единицы постера.
    this.readLum = function () {
      const gw = Math.ceil(last.W / 4), gh = Math.ceil(last.H / 4);
      if (!anT || anW !== gw || anH !== gh) { anT = target(gw, gh, gl.NEAREST); anW = gw; anH = gh; }
      const u = P.an.u; gl.useProgram(P.an.pr);
      bindTex(0, T.base.t); gl.uniform1i(u.base, 0); gl.uniform1f(u.unit, last.unit);
      draw(P.an, anT, gw, gh);
      const px = new Uint8Array(gw * gh * 4);
      gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const lum = new Uint8Array(gw * gh);
      for (let i = 0; i < lum.length; i++) lum[i] = px[i * 4];
      return { lum, w: gw, h: gh };
    };
  };

  HUD.glSupported = (function () {
    let ok = null;
    return () => {
      if (ok === null) { try { ok = !!document.createElement('canvas').getContext('webgl2'); } catch (e) { ok = false; } }
      return ok;
    };
  })();
})();
