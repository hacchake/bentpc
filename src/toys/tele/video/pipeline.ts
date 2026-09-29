// 映像の加工パイプライン（WebGL2）。
// 入力（<video> 要素 or 砂嵐）→ [取り込み：縦横比を合わせる] → [グリッチ 24 種（前のフレーム・止めたフレームも使う）]
//   → [ブラウン管：湾曲・走査線・にじみ・周辺減光] → 画面
// 前のフレームを残すバッファ（フィードバック・データモッシュ用）と、止めたフレーム（FREEZE・FRAME HOLD 用）を持つ。

const VS = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

/** 取り込み：動画を縦横比を保って 4:3 の画面に収める（余白は黒） */
const FS_SOURCE = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform vec2 scale;
uniform float hasSrc;
void main() {
  vec2 q = (uv - 0.5) / scale + 0.5;
  q.y = 1.0 - q.y;
  if (hasSrc < 0.5 || q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  o = vec4(texture(src, q).rgb, 1.0);
}`;

/** 何も映っていないときの砂嵐 */
const FS_SNOW = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform float time;
void main() { float n = fract(sin(dot(floor(uv * vec2(320.0, 240.0)) + time * 60.0, vec2(12.9898, 78.233))) * 43758.5453); o = vec4(vec3(n * 0.55), 1.0); }`;

/**
 * グリッチ（24 種を 1 つのシェーダーで）。g[n] が効き具合（0 = 効いていない）。
 * 順番：座標をゆがめる → 読み出す（今のフレーム・前のフレーム・止めたフレーム）→ 色をいじる
 */
const FS_GLITCH = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D cur;
uniform sampler2D prev;
uniform sampler2D hold;
uniform float g[24];
uniform float time;
uniform float seed;
uniform float freeze;
uniform float flash;
uniform vec2 res;
uniform float fbk;   // FEEDBACK ノブ
uniform float dist;  // DIST ノブ
uniform float dtype; // DIST TYPE（0 = CLIP：コントラスト / 1 = CRUSH：階調と画素を落とす）
uniform float mixv;  // DRY / WET
uniform float lfo;   // LFO（映像に向いているときだけ、-1..1 × 深さ）
uniform float snow;  // 一発グリッチの砂嵐
float h1(float x) { return fract(sin(x * 91.3458 + seed) * 47453.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
void main() {
  vec2 q = uv;
  vec2 px = 1.0 / res;
  float tq = floor(time * 12.0); // ガタガタ変わる時間
  // ---- LFO：画面全体がうねる ----
  if (lfo != 0.0) q += vec2(sin(uv.y * 6.2831 + time * 2.0), cos(uv.x * 6.2831)) * 0.02 * lfo;
  // DIST CRUSH：画素も粗くなる
  if (dist > 0.0 && dtype > 0.5) { float s = 1.0 + floor(dist * 6.0); q = (floor(q * res / s) + 0.5) * s / res; }
  // ---- 座標をゆがめる ----
  if (g[13] > 0.0) q.y = fract(q.y + time * 0.6 * g[13]); // V-ROLL
  if (g[14] > 0.0) q.x += sin(q.y * 40.0 + time * 9.0) * 0.03 * g[14] + (h1(floor(q.y * 60.0) + tq) > 0.93 ? 0.12 * g[14] : 0.0); // H-SYNC
  if (g[1] > 0.0) { float b = floor(q.y * (8.0 + 30.0 * h1(tq))); q.x += (h1(b + tq * 3.1) - 0.5) * 0.35 * g[1] * step(0.5, h1(b * 1.7 + tq)); } // SCAN SHIFT
  if (g[7] > 0.0) q.x = q.x > 0.5 ? 1.0 - q.x : q.x; // MIRROR
  if (g[8] > 0.0) { vec2 d = q - 0.5; float a = atan(d.y, d.x) + time * 0.3; float r = length(d); float seg = 6.2831 / 6.0; a = abs(mod(a, seg) - seg * 0.5); q = 0.5 + vec2(cos(a), sin(a)) * r; } // KALEIDO
  if (g[17] > 0.0) q = (q - 0.5) / (1.0 + g[17] * (0.6 + 0.4 * sin(time * 6.0))) + 0.5; // ZOOM
  if (g[18] > 0.0) { vec2 d = q - 0.5; float r = length(d); q = 0.5 + rot(d, g[18] * 4.0 * (0.6 - r) * sin(time * 1.3)); } // TWIST
  if (g[21] > 0.0) q = fract(q * 2.0); // SPLIT
  if (g[4] > 0.0) { float s = mix(4.0, 48.0, g[4] * (0.5 + 0.5 * h1(tq))); q = (floor(q * res / s) + 0.5) * s / res; } // MOSAIC
  // ---- 読み出す ----
  vec3 c;
  if (g[0] > 0.0) { // RGB SHIFT
    float d = 0.03 * g[0] * (0.5 + h1(tq));
    c = vec3(texture(cur, q + vec2(d, d * 0.3)).r, texture(cur, q).g, texture(cur, q - vec2(d, 0.0)).b);
  } else c = texture(cur, q).rgb;
  if (g[3] > 0.0) { // PIXEL SORT 風：明るい点を下に引き伸ばす
    float best = luma(c);
    for (int i = 1; i < 16; i++) {
      vec3 s = texture(cur, q - vec2(0.0, float(i) * px.y * 6.0 * g[3])).rgb;
      if (luma(s) > best && luma(s) > 0.45) { best = luma(s); c = s; }
    }
  }
  if (g[2] > 0.0) { // DATAMOSH：ブロックごとに前のフレームがずれて溶け残る
    vec2 b = floor(q * res / 16.0);
    if (h2(b + floor(time * 3.0)) < 0.7 * g[2]) {
      vec2 mv = (vec2(h2(b), h2(b + 7.0)) - 0.5) * px * 6.0;
      c = texture(prev, uv + mv).rgb;
    }
  }
  if (g[9] > 0.0) { // SLIT SCAN：中央の細い帯だけ今の映像、外側は前のフレームが横に流れていく
    float w = 0.01 + 0.03 * (1.0 - g[9]);
    if (abs(uv.x - 0.5) > w) c = texture(prev, uv + vec2(sign(uv.x - 0.5) * -px.x * 3.0, 0.0)).rgb;
  }
  if (g[10] > 0.0) { vec3 f = texture(prev, 0.5 + rot(uv - 0.5, 0.02) * 0.97).rgb; c = max(c, f * (0.85 + 0.12 * g[10])); } // FEEDBACK
  if (g[20] > 0.0) c = max(c, texture(prev, uv).rgb * (0.8 + 0.18 * g[20])); // ECHO TRAIL
  if (g[23] > 0.0) { vec3 m = texture(prev, uv + vec2(0.0, px.y * (2.0 + 8.0 * luma(c)) * g[23])).rgb; c = mix(c, m, 0.85); } // MELT
  if (g[12] > 0.0) c = texture(hold, q).rgb; // FRAME HOLD
  if (freeze > 0.0) c = texture(hold, uv).rgb; // FREEZE（Space）
  // ---- 色をいじる ----
  if (g[19] > 0.0) { // CHROMA BLEED：色だけ横ににじむ
    vec3 bl = vec3(0.0);
    for (int i = -4; i <= 4; i++) bl += texture(cur, q + vec2(float(i) * px.x * 5.0 * g[19], 0.0)).rgb;
    bl /= 9.0;
    c = vec3(luma(c)) + (bl - vec3(luma(bl))) * (1.0 + 2.5 * g[19]);
  }
  if (g[16] > 0.0) { // EDGE
    float a = luma(texture(cur, q + vec2(px.x, 0.0)).rgb) - luma(texture(cur, q - vec2(px.x, 0.0)).rgb);
    float b = luma(texture(cur, q + vec2(0.0, px.y)).rgb) - luma(texture(cur, q - vec2(0.0, px.y)).rgb);
    c = mix(c, vec3(length(vec2(a, b)) * 4.0) * vec3(0.4, 1.0, 0.8), g[16]);
  }
  if (g[5] > 0.0) { float lv = mix(6.0, 2.0, g[5]); c = floor(c * lv + 0.5) / lv; } // POSTERIZE
  if (g[15] > 0.0) c = vec3(step(0.45 + 0.1 * sin(time * 3.0), luma(c))); // THRESHOLD
  if (g[6] > 0.0) c = mix(c, 1.0 - c, g[6]); // INVERT
  if (g[11] > 0.0) { // BLOCK NOISE
    vec2 b = floor(uv * res / vec2(24.0, 12.0));
    float r = h2(b + tq);
    if (r < 0.25 * g[11]) c = vec3(h2(b + 1.0), h2(b + 2.0), h2(b + 3.0));
    else if (r < 0.35 * g[11]) c = texture(cur, fract(uv + vec2(h2(b) - 0.5, 0.0))).rgb;
  }
  if (g[22] > 0.0) c = mix(c, vec3(step(0.5, fract(time * 12.0))), 0.7 * g[22]); // STROBE
  // ---- 改造パーツ ----
  if (fbk > 0.0) { vec3 f = texture(prev, 0.5 + (uv - 0.5) * 0.985).rgb; c = mix(c, max(c, f * 0.97), fbk); } // FEEDBACK
  if (dist > 0.0) {
    if (dtype < 0.5) c = clamp((c - 0.5) * (1.0 + dist * 5.0) + 0.5, 0.0, 1.0); // CLIP
    else { float lv = mix(32.0, 3.0, dist); c = floor(c * lv + 0.5) / lv; } // CRUSH
  }
  if (lfo != 0.0) c = mix(c, c.gbr, abs(lfo) * 0.5);
  if (snow > 0.0) { float n = h2(floor(uv * vec2(320.0, 240.0)) + time * 60.0); c = mix(c, vec3(n), 0.75 * snow); }
  c = mix(texture(cur, uv).rgb, c, mixv); // DRY / WET
  c += flash;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/** ブラウン管の見た目 */
const FS_CRT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D img;
uniform float time;
uniform float power;
uniform vec2 res;
vec2 curve(vec2 u) {
  u = u * 2.0 - 1.0;
  u *= 1.0 + 0.08 * dot(u.yx, u.yx);
  return u * 0.5 + 0.5;
}
void main() {
  vec2 q = curve(uv);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float px = 1.0 / res.x;
  vec3 c;
  c.r = texture(img, q + vec2(px * 0.8, 0.0)).r;
  c.g = texture(img, q).g;
  c.b = texture(img, q - vec2(px * 0.8, 0.0)).b;
  float scan = 0.82 + 0.18 * sin(q.y * res.y * 3.14159);
  float roll = 0.97 + 0.03 * sin((q.y + time * 0.08) * 6.2831);
  c *= scan * roll;
  vec2 d = q - 0.5;
  c *= 1.0 - dot(d, d) * 1.4;
  float band = smoothstep(0.0, 0.02, 0.5 * power - abs(q.y - 0.5) + 0.0005);
  c *= band;
  c += vec3(0.02, 0.025, 0.02) * power;
  o = vec4(c, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture }
type Uni = Record<string, number | number[] | Float32Array>;

export class VideoPipeline {
  readonly gl: WebGL2RenderingContext;
  private srcTex: WebGLTexture;
  private pSource: WebGLProgram;
  private pSnow: WebGLProgram;
  private pGlitch: WebGLProgram;
  private pCrt: WebGLProgram;
  private a: Target; // グリッチの出力
  private b: Target; // 取り込んだ今のフレーム
  private prev: Target; // 前のフレーム（グリッチの出力）
  private hold: Target; // 止めたフレーム
  private copyNext = false;
  private power = 0;
  private zero = new Float32Array(24);
  /** 映像グリッチの効き具合（24 個、0..1） */
  readonly g = new Float32Array(24);
  freeze = false;
  flash = 0;
  seed = 0;
  /** 改造パーツの値（エンジンから届く） */
  knobs = { fbk: 0, dist: 0, dtype: 0, mixv: 1, lfo: 0, snow: 0 };

  constructor(private canvas: HTMLCanvasElement, readonly w = 640, readonly h = 480) {
    canvas.width = w;
    canvas.height = h;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 が使えません');
    this.gl = gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.srcTex = this.texture();
    this.pSource = compile(gl, FS_SOURCE);
    this.pSnow = compile(gl, FS_SNOW);
    this.pGlitch = compile(gl, FS_GLITCH);
    this.pCrt = compile(gl, FS_CRT);
    this.a = this.target();
    this.b = this.target();
    this.prev = this.target();
    this.hold = this.target();
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(): Target {
    const gl = this.gl;
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex };
  }

  /** 次のフレームを「止めたフレーム」として取っておく（FREEZE・FRAME HOLD を押した瞬間） */
  grabHold(): void {
    this.copyNext = true;
  }

  private draw(p: WebGLProgram, to: Target | null, bind: Record<string, WebGLTexture>, uni: Uni): void {
    const gl = this.gl;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fb : null);
    gl.viewport(0, 0, this.w, this.h);
    let unit = 0;
    for (const [name, tex] of Object.entries(bind)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(p, name), unit++);
    }
    for (const [name, v] of Object.entries(uni)) {
      const loc = gl.getUniformLocation(p, name);
      if (v instanceof Float32Array) gl.uniform1fv(loc, v);
      else if (Array.isArray(v)) gl.uniform2f(loc, v[0], v[1]);
      else gl.uniform1f(loc, v);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** 1 フレーム描く。video が無ければ、snow = true のとき砂嵐、そうでなければ黒 */
  render(video: HTMLVideoElement | null, time: number, powered: boolean, snow = false): void {
    const gl = this.gl;
    this.power += ((powered ? 1 : 0) - this.power) * 0.15;
    let has = 0;
    let scale = [1, 1];
    if (video && video.readyState >= 2 && video.videoWidth) {
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      has = 1;
      const va = video.videoWidth / video.videoHeight, sa = this.w / this.h;
      scale = va > sa ? [1, sa / va] : [va / sa, 1];
    }
    if (!has && snow) this.draw(this.pSnow, this.b, {}, { time });
    else this.draw(this.pSource, this.b, { src: this.srcTex }, { scale, hasSrc: has });
    const base: Uni = { time, seed: this.seed % 1000, flash: this.flash, res: [this.w, this.h] };
    if (this.copyNext) {
      // 今のフレームを、そのまま「止めたフレーム」へ写す
      this.copyNext = false;
      this.draw(this.pGlitch, this.hold, { cur: this.b.tex, prev: this.prev.tex, hold: this.b.tex }, {
        ...base, g: this.zero, freeze: 0, flash: 0, fbk: 0, dist: 0, dtype: 0, mixv: 1, lfo: 0, snow: 0,
      });
    }
    this.draw(this.pGlitch, this.a, { cur: this.b.tex, prev: this.prev.tex, hold: this.hold.tex }, {
      ...base, g: this.g, freeze: this.freeze ? 1 : 0, ...this.knobs,
    });
    this.draw(this.pCrt, null, { img: this.a.tex }, { time, power: this.power, res: [this.w, this.h] });
    // 今のフレームを「前のフレーム」として残す（フィードバック・データモッシュ用）
    [this.prev, this.a] = [this.a, this.prev];
  }
}
