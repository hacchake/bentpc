// 映像の加工パイプライン（WebGL2）。
// 入力（<video> 要素）→ [取り込み：縦横比を合わせてテクスチャへ] → [エフェクトの段（フェーズ2で増える）]
//   → [ブラウン管：湾曲・走査線・にじみ・周辺減光] → 画面
// 前のフレームを残すバッファ（フィードバック・データモッシュ用）も最初から用意しておく。

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
uniform vec2 scale; // 画面に対する動画の大きさ（縦横比合わせ）
uniform float hasSrc;
void main() {
  vec2 q = (uv - 0.5) / scale + 0.5;
  q.y = 1.0 - q.y;
  if (hasSrc < 0.5 || q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  o = vec4(texture(src, q).rgb, 1.0);
}`;

/** ブラウン管の見た目 */
const FS_CRT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D img;
uniform float time;
uniform float power; // 0 = 電源 OFF（真っ暗）
uniform vec2 res;
vec2 curve(vec2 u) {
  u = u * 2.0 - 1.0;
  u *= 1.0 + 0.08 * dot(u.yx, u.yx);
  return u * 0.5 + 0.5;
}
void main() {
  vec2 q = curve(uv);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // にじみ（色ごとにわずかにずらす）
  float px = 1.0 / res.x;
  vec3 c;
  c.r = texture(img, q + vec2(px * 0.8, 0.0)).r;
  c.g = texture(img, q).g;
  c.b = texture(img, q - vec2(px * 0.8, 0.0)).b;
  // 走査線と、うっすら動く明るさのむら
  float scan = 0.82 + 0.18 * sin(q.y * res.y * 3.14159);
  float roll = 0.97 + 0.03 * sin((q.y + time * 0.08) * 6.2831);
  c *= scan * roll;
  // 周辺減光
  vec2 d = q - 0.5;
  c *= 1.0 - dot(d, d) * 1.4;
  // 電源が入る／切れるとき：中央の横線に縮む
  float band = smoothstep(0.0, 0.02, 0.5 * power - abs(q.y - 0.5) + 0.0005);
  c *= band;
  c += vec3(0.02, 0.025, 0.02) * power; // ブラウン管の黒は真っ黒ではない
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

export class VideoPipeline {
  readonly gl: WebGL2RenderingContext;
  private srcTex: WebGLTexture;
  private pSource: WebGLProgram;
  private pCrt: WebGLProgram;
  private a: Target;
  private b: Target;
  /** 前のフレーム（フィードバック用） */
  prev: Target;
  private power = 0;

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
    this.pCrt = compile(gl, FS_CRT);
    this.a = this.target();
    this.b = this.target();
    this.prev = this.target();
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

  private draw(p: WebGLProgram, to: Target | null, bind: Record<string, WebGLTexture>, uni: Record<string, number | number[]>): void {
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
      if (Array.isArray(v)) gl.uniform2f(loc, v[0], v[1]);
      else gl.uniform1f(loc, v);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** 1 フレーム描く。video が null なら黒（砂嵐はフェーズ2） */
  render(video: HTMLVideoElement | null, time: number, powered: boolean): void {
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
    this.draw(this.pSource, this.a, { src: this.srcTex }, { scale, hasSrc: has });
    // ここにエフェクトの段が入る（a ⇄ b を行き来する）
    this.draw(this.pCrt, null, { img: this.a.tex }, { time, power: this.power, res: [this.w, this.h] });
    // 今のフレームを「前のフレーム」として残す
    [this.prev, this.a] = [this.a, this.prev];
    void this.b;
  }
}
