// 高速フーリエ変換（2 のべき乗の長さ）。音を「どの高さの音がどれだけ入っているか」に分ける。
export class FFT {
  readonly n: number;
  private cos: Float64Array;
  private sin: Float64Array;
  private rev: Uint32Array;
  private re: Float64Array;
  private im: Float64Array;
  /** ハン窓（端をなめらかに 0 へ） */
  readonly window: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = -Math.sin((2 * Math.PI * i) / n); }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.window = new Float64Array(n);
    for (let i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }

  /** x の off から n サンプルに窓を掛けて変換し、大きさ（0〜n/2）を mag に入れる */
  magnitudes(x: Float32Array, off: number, mag: Float32Array): void {
    this.load(x, off);
    this.run(this.re, this.im, false);
    for (let k = 0; k <= this.n / 2; k++) mag[k] = Math.hypot(this.re[k], this.im[k]);
  }

  /** 窓を掛けて変換し、実部・虚部（0〜n/2）を返す（値は次に呼ぶまで有効） */
  forward(x: Float32Array, off: number): { re: Float64Array; im: Float64Array } {
    this.load(x, off);
    this.run(this.re, this.im, false);
    return { re: this.re, im: this.im };
  }

  /** 逆変換：0〜n/2 の実部・虚部 → 波形 n サンプル（out に足す。窓 w を掛けて） */
  inverseAdd(re: ArrayLike<number>, im: ArrayLike<number>, out: Float32Array, off: number, gain = 1): void {
    const { n, rev, window } = this;
    const R = new Float64Array(n), I = new Float64Array(n);
    for (let k = 0; k <= n / 2; k++) { R[rev[k]] = re[k]; I[rev[k]] = im[k]; }
    for (let k = 1; k < n / 2; k++) { R[rev[n - k]] = re[k]; I[rev[n - k]] = -im[k]; } // 対称（実数の波形）
    this.run(R, I, true);
    for (let i = 0; i < n; i++) { const j = off + i; if (j >= 0 && j < out.length) out[j] += (R[i] / n) * window[i] * gain; }
  }

  private load(x: Float32Array, off: number): void {
    const { n, re, im, rev, window } = this;
    for (let i = 0; i < n; i++) { const j = off + i; re[rev[i]] = (j >= 0 && j < x.length ? x[j] : 0) * window[i]; im[rev[i]] = 0; }
  }

  /** ビット反転済みの re・im をその場で変換（inverse = 逆向き） */
  private run(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.n, sg = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step], si = this.sin[k * step] * sg;
          const a = s + k, b = a + half;
          const tr = re[b] * c - im[b] * si, ti = re[b] * si + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}
