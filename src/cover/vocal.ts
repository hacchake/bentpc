// ボーカルを取り出す（AI を使わない、ブラウザの中だけの方法。DOM 非依存）。
// 曲を細かい音の高さ × 時間に分けて、次の 4 つがそろう所だけ残す：
//   1. 歌と同じ左右の位置（たいてい真ん中。メロディの倍音から位置を見つける）… モノラルの曲ではこれは使わない
//   2. 伸びる音（ドラムのような一瞬の音ではない）… 時間方向と高さ方向のなめらかさをくらべる
//   3. 歌の高さ（120Hz〜8kHz）
//   4. 解析したメロディの高さの倍音の近く（歌っていない所は小さく）
// 残りは「伴奏（カラオケ）」。どちらも 22.05kHz のモノラル。専用の AI ほどきれいには分かれない（残響・ほかの楽器が少し混ざる）。
import { FFT } from './fft';
import { stretch } from '../sampler/dsp/edit';
import { vocalPitch } from './analyze';

const SR = 22050;
const N = 2048;
const HOP = 512;

export interface Separated {
  sr: number;
  vocal: Float32Array;
  inst: Float32Array;
}

/** 1 本を 22.05kHz に（ローパスしてから間引く） */
export function to22k(x: Float32Array, sr: number): Float32Array {
  if (sr === SR) return x.slice();
  const y = x.slice();
  const fc = Math.min(SR, sr) * 0.45;
  for (let pass = 0; pass < 2; pass++) {
    const w = (2 * Math.PI * fc) / sr, al = Math.sin(w) / Math.SQRT2, c = Math.cos(w), a0 = 1 + al;
    const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; y[i] = v; }
  }
  const out = new Float32Array(Math.floor((y.length * SR) / sr));
  const k = sr / SR;
  for (let i = 0; i < out.length; i++) { const p = i * k, i0 = Math.floor(p), f = p - i0; out[i] = y[i0] * (1 - f) + (y[i0 + 1] ?? 0) * f; }
  return out;
}

/**
 * ch：左右（1 本ならモノラル）、sr：サンプルレート。
 * pitch：解析したメロディの高さ（MIDI、0 = 歌っていない）を 22.05kHz・512 サンプルごとに（analyze の pitch）。無ければ 4 は使わない
 */
export function extractVocal(ch: Float32Array[], sr: number, pitch?: ArrayLike<number>, progress?: (f: number) => void): Separated {
  const L = to22k(ch[0], sr), R = ch[1] ? to22k(ch[1], sr) : L;
  const stereo = !!ch[1];
  const n = L.length;
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) mid[i] = (L[i] + R[i]) * 0.5;
  const fl = new FFT(N), fr = new FFT(N), out = new FFT(N);
  const B = N / 2 + 1, binHz = SR / N;
  const frames = Math.floor((n + N) / HOP);
  // 時間方向のなめらかさを見るため、前後 K フレームを覚えておく（K フレーム遅れて出す）
  const K = 6;
  const W = 2 * K + 1;
  const ring = Array.from({ length: W }, () => ({ re: new Float64Array(B), im: new Float64Array(B), mag: new Float32Array(B), c: new Float32Array(B), t: -1 }));
  const hsum = new Float64Array(B); // 窓の中の大きさの合計（時間方向）
  const vocal = new Float32Array(n);
  // 帯域（120Hz〜8kHz、端はなだらかに）
  const band = new Float32Array(B);
  for (let k = 0; k < B; k++) {
    const f = k * binHz;
    band[k] = Math.min(1, Math.max(0, (f - 110) / 90)) * Math.min(1, Math.max(0, (9000 - f) / 2000));
  }
  // 0. 歌の左右の位置：メロディの倍音の所で、左右の大きさの比がどこに集まるか（真ん中とは限らない）
  let gL = 1, gR = 1;
  if (stereo && pitch) {
    const BINS = 41, hist = new Float64Array(BINS);
    for (let t = 0; t < frames; t += 3) {
      const m = pitch[t - (N / 2) / HOP] ?? 0;
      if (m <= 0) continue;
      const off = t * HOP - N / 2;
      const a = fl.forward(L, off), b = fr.forward(R, off);
      const f0 = 440 * Math.pow(2, (m - 69) / 12);
      for (let h = 1; h <= 6; h++) {
        const k = Math.round((f0 * h) / binHz);
        if (k >= B) break;
        const ml = Math.hypot(a.re[k], a.im[k]), mr = Math.hypot(b.re[k], b.im[k]);
        hist[Math.round((Math.atan2(mr, ml) / (Math.PI / 2)) * (BINS - 1))] += ml + mr;
      }
    }
    let bj = (BINS - 1) / 2;
    for (let j = 0; j < BINS; j++) if (hist[j] > hist[bj] * 1.15) bj = j;
    const th = (bj / (BINS - 1)) * (Math.PI / 2);
    gL = Math.cos(th) * Math.SQRT2; gR = Math.sin(th) * Math.SQRT2;
  }
  const gg = gL * gL + gR * gR;
  const mask = new Float32Array(B);
  const emit = (slot: (typeof ring)[number]) => {
    const t = slot.t;
    // 2. 伸びる音か：時間方向の平均（H）と高さ方向の平均（P）
    for (let k = 0; k < B; k++) {
      let p = 0, c = 0;
      for (let j = Math.max(0, k - 8); j <= Math.min(B - 1, k + 8); j++) { p += slot.mag[j]; c++; }
      const h = hsum[k] / W, pp = p / c;
      const harm = (h * h) / (h * h + pp * pp + 1e-12);
      // 1. 真ん中か
      const cen = stereo ? Math.min(1, Math.max(0, (slot.c[k] - 0.55) / 0.35)) : 1;
      mask[k] = harm * cen * band[k];
    }
    // 4. メロディの倍音の近く
    if (pitch) {
      const m = pitch[t - (N / 2) / HOP] ?? 0; // 解析のフレームは窓の頭、こちらは窓の真ん中の時刻
      if (m > 0) {
        const f0 = 440 * Math.pow(2, (m - 69) / 12);
        for (let k = 0; k < B; k++) {
          const f = k * binHz, h = Math.max(1, Math.round(f / f0));
          const near = Math.abs(f - h * f0) < 0.035 * h * f0 + 12 ? 1 : 0;
          mask[k] *= 0.3 + 0.7 * near;
        }
      } else for (let k = 0; k < B; k++) mask[k] *= 0.15;
    }
    // 少しだけ周りとならす（ブツブツしにくく）
    let prev = mask[0];
    for (let k = 1; k < B - 1; k++) { const v = (prev + 2 * mask[k] + mask[k + 1]) / 4; prev = mask[k]; mask[k] = v; }
    const re = new Float64Array(B), im = new Float64Array(B);
    for (let k = 0; k < B; k++) { re[k] = slot.re[k] * mask[k]; im[k] = slot.im[k] * mask[k]; }
    out.inverseAdd(re, im, vocal, t * HOP - N / 2, 1 / 1.5);
  };
  for (let t = 0; t < frames + K; t++) {
    const slot = ring[t % W];
    // 古いフレームを窓の合計から外す
    if (slot.t >= 0) for (let k = 0; k < B; k++) hsum[k] -= slot.mag[k];
    if (t < frames) {
      const off = t * HOP - N / 2;
      const a = fl.forward(L, off);
      const ar = Float64Array.from(a.re.subarray(0, B)), ai = Float64Array.from(a.im.subarray(0, B));
      const b = stereo ? fr.forward(R, off) : { re: a.re, im: a.im };
      for (let k = 0; k < B; k++) {
        // 歌の位置の向きに取り出す（真ん中なら左右の平均）
        const mr = (gL * ar[k] + gR * b.re[k]) / gg, mi = (gL * ai[k] + gR * b.im[k]) / gg;
        slot.re[k] = mr; slot.im[k] = mi;
        slot.mag[k] = Math.hypot(mr, mi);
        if (stereo) {
          // 1. 歌と同じ位置か：歌の位置の音なら gR·L − gL·R が 0 になる
          const dl = Math.hypot(ar[k], ai[k]), dr = Math.hypot(b.re[k], b.im[k]);
          const diff = Math.hypot(gR * ar[k] - gL * b.re[k], gR * ai[k] - gL * b.im[k]);
          slot.c[k] = 1 - diff / (gR * dl + gL * dr + 1e-12);
        }
        hsum[k] += slot.mag[k];
      }
      slot.t = t;
    } else { slot.t = -1; slot.mag.fill(0); }
    // K フレーム前のものを出す
    const ready = t - K;
    if (ready >= 0 && ready < frames) emit(ring[ready % W]);
    if (progress && t % 300 === 0) progress(t / (frames + K));
  }
  const inst = new Float32Array(n);
  // 真ん中（左右の平均）の中の歌の分を引く
  const vm = (gL + gR) / 2;
  for (let i = 0; i < n; i++) inst[i] = mid[i] - vocal[i] * vm;
  return { sr: SR, vocal, inst };
}

/**
 * 元の曲の拍の揺れをならして、カバーの拍にそろえる（拍の時刻 beats から、一定のテンポ bpm の格子へ）。
 * from・to：使う範囲（小節）。拍と拍の間は、なめらかに伸び縮みさせて読む（音の高さはほとんど変わらない）
 */
export function alignToGrid(x: Float32Array, sr: number, beats: number[], bpm: number, from: number, to: number): Float32Array {
  const spb = 60 / bpm;
  const nb = (to - from) * 4;
  const out = new Float32Array(Math.round(nb * spb * sr));
  const last = beats.length - 1;
  const srcTime = (beat: number) => {
    const i = Math.floor(beat);
    if (i < 0) return beats[0] + beat * (beats[1] - beats[0]);
    if (i >= last) return beats[last] + (beat - last) * (beats[last] - beats[last - 1]);
    return beats[i] + (beat - i) * (beats[i + 1] - beats[i]);
  };
  for (let i = 0; i < out.length; i++) {
    const beat = from * 4 + i / sr / spb;
    const p = srcTime(beat) * sr, i0 = Math.floor(p), f = p - i0;
    out[i] = i0 >= 0 && i0 + 1 < x.length ? x[i0] * (1 - f) + x[i0 + 1] * f : 0;
  }
  return out;
}

/**
 * 音程だけを半音 semis ずらす（長さはそのまま）。カバーはハ長調で弾くので、元の歌のテープもハ長調に移して重ねる。
 * サンプラーのタイムストレッチ（WSOLA、音程そのままで伸ばす）で 2^(semis/12) 倍に伸ばしてから、元の長さに縮めて読む
 */
export function pitchShift(x: Float32Array, sr: number, semis: number): Float32Array {
  if (!semis) return x;
  const r = Math.pow(2, semis / 12);
  const long = stretch({ sr, ch: [x] }, r).ch[0];
  const out = new Float32Array(x.length);
  for (let i = 0; i < out.length; i++) {
    const p = i * r, i0 = Math.floor(p), f = p - i0;
    out[i] = i0 + 1 < long.length ? long[i0] * (1 - f) + long[i0 + 1] * f : 0;
  }
  return out;
}

/**
 * 2 回に分けて取り出す。1 回目はメロディの高さを使わずに取り出し、そこから歌の高さ（と歌っている所）を聞き取って、
 * 2 回目はその倍音の所だけを残す。曲全体から聞き取った高さより、取り出した歌から聞き取った高さの方が正しいので、よく分かれる
 */
export function separateVocal(ch: Float32Array[], sr: number, progress?: (f: number) => void): Separated {
  const first = extractVocal(ch, sr, undefined, (f) => progress?.(f * 0.5));
  const guide = vocalPitch(first.vocal, 1.5).pitch;
  return extractVocal(ch, sr, guide, (f) => progress?.(0.5 + f * 0.5));
}
