// 市販品と同じものさしで測る：ITU-R BS.1770 のラウドネス（LUFS）・トゥルーピーク（4 倍オーバーサンプル）・帯域のバランス
function biquad(x: Float32Array, b: number[], a: number[]): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
/** K 特性（48kHz 以外でも使えるよう、係数を作る） */
function kWeight(x: Float32Array, sr: number): Float32Array {
  // 高域シェルフ（+4dB @ 1.7kHz 付近）
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = biquad(x, [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]);
  // ハイパス（38Hz）
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  return biquad(s1, [1, -2, 1], [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]);
}
/** 統合ラウドネス（LUFS、ゲート付き） */
export function lufs(L: Float32Array, R: Float32Array, sr: number): number {
  const kl = kWeight(L, sr), kr = kWeight(R, sr);
  const blk = Math.round(sr * 0.4), hop = Math.round(sr * 0.1);
  const ms: number[] = [];
  for (let s = 0; s + blk <= kl.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + blk; i++) e += kl[i] * kl[i] + kr[i] * kr[i];
    ms.push(e / blk);
  }
  const lk = (m: number) => -0.691 + 10 * Math.log10(m + 1e-20);
  const abs = ms.filter((m) => lk(m) > -70);
  if (!abs.length) return -99;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const g = abs.filter((m) => lk(m) > rel);
  return lk(g.reduce((a, b) => a + b, 0) / g.length);
}
/** トゥルーピーク（dBTP）：4 倍に補間して、サンプルの間の山も測る */
export function truePeak(L: Float32Array, R: Float32Array): number {
  let pk = 0;
  for (const x of [L, R]) for (let i = 1; i < x.length - 2; i++) {
    pk = Math.max(pk, Math.abs(x[i]));
    for (const t of [0.25, 0.5, 0.75]) {
      const xm1 = x[i - 1], x0 = x[i], x1 = x[i + 1], x2 = x[i + 2];
      const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
      pk = Math.max(pk, Math.abs(((c3 * t + c2) * t + c1) * t + x0));
    }
  }
  return 20 * Math.log10(pk + 1e-12);
}
/** 帯域ごとのエネルギー（dB、全体を 0 として）：低 <150・中低 150-800・中 800-3k・高中 3k-8k・高 >8k */
export function bands(x: Float32Array, sr: number): number[] {
  const lp = (y: Float32Array, hz: number) => { const a = 1 - Math.exp((-2 * Math.PI * hz) / sr); const o = new Float32Array(y.length); let s = 0, t = 0; for (let i = 0; i < y.length; i++) { s += a * (y[i] - s); t += a * (s - t); o[i] = t; } return o; };
  const cuts = [150, 800, 3000, 8000];
  const lows = cuts.map((c) => lp(x, c));
  const e = (y: Float32Array) => y.reduce((a, v) => a + v * v, 0);
  const tot = e(x) + 1e-20;
  const parts = [e(lows[0])];
  for (let k = 1; k < cuts.length; k++) parts.push(e(Float32Array.from(lows[k], (v, i) => v - lows[k - 1][i])));
  parts.push(e(Float32Array.from(x, (v, i) => v - lows[cuts.length - 1][i])));
  return parts.map((p) => 10 * Math.log10(p / tot + 1e-20));
}
/** 左右の相関（1 = モノラル、0 = 広すぎ・逆相に注意） */
export function correlation(L: Float32Array, R: Float32Array): number {
  let lr = 0, ll = 0, rr = 0;
  for (let i = 0; i < L.length; i++) { lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; }
  return lr / Math.sqrt(ll * rr + 1e-20);
}
