// 工場出荷の音・ジャンル編（バンク C〜G）。自動作曲がスタイルごとに使う楽器。すべてプログラムで合成する。
//   C = 和（太鼓・三味線・琴・尺八・演歌のストリングス）
//   D = レゲエ・ダブ・スカ
//   E = ジャズ・ボサノバ・ファンク
//   F = ダンス（909・808・アシッド・リース）
//   G = マーチ・チップ・パンク・ローファイ
// 音程のある音は、ROOTS に「元の高さ（MIDI）」を書いておく（作曲係と画面が使う）。
import { Rng } from '../../core/rng';
import { SR, TAU, bp, clap, crash, dec, hp1, len, lp1, midiHz, mono, noise, normalize, shaker, snare, type FactorySound } from './factory';

/** パッド番号 → 元の高さ（MIDI）。音程を変えて弾く音だけ */
export const ROOTS: Record<number, number> = {
  17: 36, 24: 72,
  // C 和
  40: 48, 41: 60, 42: 72, 43: 60, 44: 60, 45: 36, 46: 72,
  // D レゲエ
  52: 60, 53: 60, 54: 36, 57: 60, 58: 72, 63: 60,
  // E ジャズ
  69: 36, 70: 60, 71: 60, 72: 60, 73: 36, 74: 60, 75: 72,
  // F ダンス
  86: 36, 87: 36, 88: 48, 89: 60, 90: 60,
  // G ポップ
  99: 72, 100: 60, 101: 36, 102: 60, 104: 36, 105: 48, 110: 60,
};

// ---------------- 道具 ----------------
const ad = (i: number, atk: number, d: number) => Math.min(1, i / (atk * SR + 1)) * dec(i, d);
const sine = (hz: number, i: number) => Math.sin((TAU * hz * i) / SR);
/** 帯域制限したのこぎり波（polyBLEP） */
function blep(ph: number, dt: number): number {
  let v = 2 * ph - 1;
  if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; } else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; }
  return v;
}
/** のこぎり波を何本か少しずらして重ねる（hzAt で音程を動かせる） */
function saws(sec: number, hz: number, cents: number[], hzMul: (i: number) => number = () => 1): Float32Array {
  const x = len(sec);
  for (const c of cents) {
    const f0 = hz * Math.pow(2, c / 1200);
    let ph = (((c * 0.137) % 1) + 1) % 1;
    for (let i = 0; i < x.length; i++) {
      const dt = (f0 * hzMul(i)) / SR;
      ph += dt; if (ph >= 1) ph -= 1;
      x[i] += blep(ph, dt) / cents.length;
    }
  }
  return x;
}
/** 周波数が動くローパス（hzAt はサンプルごとの周波数） */
function lpSweep(x: Float32Array, hzAt: (i: number) => number, reso = 0): Float32Array {
  let s1 = 0, s2 = 0;
  const k = 2 - 1.9 * reso;
  for (let i = 0; i < x.length; i++) {
    const g = Math.tan((Math.PI * Math.min(hzAt(i), SR * 0.45)) / SR);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x[i] - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
    x[i] = v2;
  }
  return x;
}
/** 周波数が動くバンドパス（声の口の形） */
function bpSweep(x: Float32Array, hzAt: (i: number) => number, q: number): Float32Array {
  let s1 = 0, s2 = 0;
  const k = 1 / q;
  for (let i = 0; i < x.length; i++) {
    const g = Math.tan((Math.PI * Math.min(hzAt(i), SR * 0.45)) / SR);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x[i] - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
    x[i] = v1;
  }
  return x;
}
/** ビブラート：少し遅れてかかる揺れ（遅延を揺らす） */
function vibrato(x: Float32Array, rate: number, depthSec: number, delaySec: number): Float32Array {
  const y = new Float32Array(x.length), D = depthSec * SR;
  for (let i = 0; i < x.length; i++) {
    const on = Math.min(1, Math.max(0, (i / SR - delaySec) / 0.4));
    const p = i - D * on * (1 + Math.sin((TAU * rate * i) / SR));
    const i0 = Math.floor(p), f = p - i0;
    y[i] = i0 < 0 ? 0 : (x[i0] ?? 0) * (1 - f) + (x[i0 + 1] ?? 0) * f;
  }
  return y;
}
/** 聞こえる大きさでそろえる：最初の win 秒の RMS を rms にして、はみ出す頭はやわらかく潰す */
function level(x: Float32Array, rms = 0.2, win = 0.4): Float32Array {
  const n = Math.min(x.length, Math.round(win * SR));
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i] * x[i];
  const g = rms / Math.max(1e-6, Math.sqrt(e / n));
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * g * 1.1) * 0.9;
  return x;
}
const mix = (x: Float32Array, y: Float32Array, g = 1, at = 0) => { const o = Math.round(at * SR); for (let i = 0; i < y.length && o + i < x.length; i++) x[o + i] += y[i] * g; return x; };
const shape = (x: Float32Array, drive: number) => { for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive); return x; };
const fadeOut = (x: Float32Array, sec = 0.05) => { const n = Math.round(sec * SR); for (let i = 0; i < n && i < x.length; i++) x[x.length - 1 - i] *= i / n; return x; };
/** 小さな部屋の響き（くし形フィルター 3 本） */
function room(x: Float32Array, wet: number, sec = 0.18): Float32Array {
  const y = x.slice();
  for (const [ms, g] of [[23, 0.5], [31, 0.45], [41, 0.4]]) {
    const d = Math.round((ms / 1000) * SR), fb = Math.pow(0.001, ms / 1000 / sec) ;
    const buf = new Float32Array(x.length);
    let lp = 0;
    for (let i = 0; i < x.length; i++) {
      const back = i >= d ? buf[i - d] : 0;
      lp += 0.4 * (back - lp);
      buf[i] = x[i] + lp * fb;
      y[i] += buf[i] * wet * g * 0.5;
    }
  }
  return y;
}

/** 弦をはじく（カープラス・ストロング）。decay = 音が 1/e になる秒、tone = 明るさ 0〜1、pick = はじく位置 */
function pluck(m: number, sec: number, o: { decay: number; tone: number; pick?: number; r: Rng }): Float32Array {
  const x = len(sec), f = midiHz(m);
  const P = SR / f, D = P - 0.5;
  const g = Math.exp(-1 / (o.decay * f));
  // 弾く瞬間の音：ノイズを 1 周期分（暗くして、はじく位置のくし形）
  const exc = new Float32Array(Math.ceil(P) + 2);
  let e = 0;
  for (let i = 0; i < exc.length; i++) { e += (0.15 + o.tone * 0.85) * (o.r.bi() - e); exc[i] = e; }
  const pk = Math.round((o.pick ?? 0.2) * P);
  for (let i = exc.length - 1; i >= pk; i--) exc[i] -= exc[i - pk];
  const c = 0.25 + o.tone * 0.75;
  let lp = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i - D;
    let fb = 0;
    if (t >= 2) {
      const i0 = Math.floor(t), fr = t - i0;
      const a = x[i0] * (1 - fr) + x[i0 + 1] * fr, b = x[i0 - 1] * (1 - fr) + x[i0] * fr;
      lp += c * ((a + b) * 0.5 - lp);
      fb = lp * g;
    }
    x[i] = (i < exc.length ? exc[i] : 0) + fb;
  }
  return x;
}
/** 打楽器の胴：音程が少し下がるサイン ＋ 皮のノイズ */
function drum(r: Rng, hz: number, o: { sec: number; decay: number; bend?: number; bendT?: number; noise?: number; noiseHz?: number; noiseDecay?: number; click?: number; drive?: number; modes?: [number, number, number][] }): Float32Array {
  const x = len(o.sec);
  let ph = 0;
  const n = o.noise ? bp(noise(r, len(o.sec)), o.noiseHz ?? 1000, 0.8) : null;
  for (let i = 0; i < x.length; i++) {
    ph += (TAU * hz * (1 + (o.bend ?? 0.3) * dec(i, o.bendT ?? 0.03))) / SR;
    let v = Math.sin(ph) * dec(i, o.decay);
    for (const [ratio, a, d] of o.modes ?? []) v += Math.sin(ph * ratio) * a * dec(i, d);
    if (n) v += n[i] * (o.noise ?? 0) * dec(i, o.noiseDecay ?? 0.04);
    if (o.click && i < 90) v += (1 - i / 90) * o.click * (r.bi() * 0.5 + 0.5);
    x[i] = v;
  }
  if (o.drive) shape(x, o.drive);
  return normalize(x);
}
/** 金物：倍音が整数倍でない正弦波の束 */
function metalPartials(sec: number, base: number, parts: [number, number, number][], r: Rng, noiseAmt = 0, noiseHp = 5000, noiseDecay = 0.1): Float32Array {
  const x = len(sec);
  for (const [ratio, a, d] of parts) {
    const ph0 = r.next() * TAU;
    for (let i = 0; i < x.length; i++) x[i] += Math.sin(ph0 + (TAU * base * ratio * i) / SR) * a * dec(i, d);
  }
  if (noiseAmt) { const n = hp1(hp1(noise(r, len(sec)), noiseHp), noiseHp); for (let i = 0; i < x.length; i++) x[i] += n[i] * noiseAmt * dec(i, noiseDecay); }
  return x;
}
/** ハイハット（四角波 6 本 ＋ ノイズ）：tone で明るさ、decay で長さ */
function hh(r: Rng, decay: number, hpHz: number, mul = 1.7): Float32Array {
  const x = len(Math.min(1.2, decay * 6 + 0.04));
  const fs = [205, 304, 369, 522, 540, 800];
  for (let i = 0; i < x.length; i++) {
    let m = 0;
    for (const f of fs) m += Math.sign(Math.sin((TAU * f * mul * i) / SR));
    x[i] = (m / 6) * 0.55 + r.bi() * 0.5;
  }
  hp1(hp1(x, hpHz), hpHz);
  for (let i = 0; i < x.length; i++) x[i] *= dec(i, decay);
  return normalize(x, 0.7);
}
/** 声：パルス列 ＋ 息を、動く 3 つの口の形（フォルマント）に通す */
function voice(r: Rng, sec: number, fA: number[], fB: number[], at: number, hz0: number, hz1: number, breath: number): Float32Array {
  const src = len(sec);
  let ph = 0;
  for (let i = 0; i < src.length; i++) {
    const t = i / src.length;
    const hz = (hz0 + (hz1 - hz0) * t) * (1 + 0.01 * Math.sin((TAU * 5.5 * i) / SR));
    const dt = hz / SR;
    ph += dt; if (ph >= 1) ph -= 1;
    src[i] = -blep(ph, dt) * 0.5 + r.bi() * breath;
  }
  lp1(src, 3500);
  const out = len(sec);
  const k = (i: number) => Math.min(1, Math.max(0, (i / SR - at) / 0.08));
  [0, 1, 2].forEach((j) => {
    const b = bpSweep(src.slice(), (i) => fA[j] + (fB[j] - fA[j]) * k(i), 6 + j * 2);
    for (let i = 0; i < out.length; i++) out[i] += b[i] * [1, 0.7, 0.35][j];
  });
  for (let i = 0; i < out.length; i++) { const t = i / out.length; out[i] *= Math.min(1, t * 25) * Math.min(1, (1 - t) * 5); }
  return normalize(out);
}
/** 息の楽器（尺八・篠笛・メロディカ）：正弦波 ＋ 倍音 ＋ 息のノイズ。最初は少し低く入って上がる */
function wind(r: Rng, m: number, sec: number, o: { harm: number[]; breath: number; breathHz: number; scoop: number; vib: number; pulse?: number }): Float32Array {
  const x = len(sec), f = midiHz(m);
  const n = bp(noise(r, len(sec)), o.breathHz, 1.2);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const scoop = Math.pow(2, (-o.scoop * dec(i, 0.06)) / 12);
    const vib = 1 + o.vib * Math.min(1, Math.max(0, (t - 0.35) / 0.5)) * Math.sin(TAU * 5.2 * t);
    ph += (f * scoop * vib) / SR;
    if (ph >= 1) ph -= 1;
    let v = 0;
    if (o.pulse) { v = (ph < o.pulse ? 1 : -1) * 0.5; }
    else o.harm.forEach((a, k) => { v += Math.sin(TAU * ph * (k + 1)) * a; });
    const env = Math.min(1, t / 0.07) * (0.85 + 0.15 * dec(i, 0.3));
    const chiff = 1 + 3 * dec(i, 0.04);
    x[i] = (v + n[i] * o.breath * chiff) * env;
  }
  if (o.pulse) lp1(lp1(x, 3200), 5000);
  return normalize(fadeOut(x, 0.1), 0.8);
}

// ================= C：和 =================
function taikoDon(r: Rng): Float32Array {
  return drum(r, 64, { sec: 1.3, decay: 0.42, bend: 0.35, bendT: 0.05, noise: 0.6, noiseHz: 300, noiseDecay: 0.05, click: 0.3, modes: [[1.58, 0.35, 0.18], [2.13, 0.15, 0.08]], drive: 1.4 });
}
function taikoKa(r: Rng): Float32Array {
  const x = len(0.18);
  const n = bp(noise(r, len(0.18)), 2300, 4);
  for (let i = 0; i < x.length; i++) x[i] = n[i] * dec(i, 0.018) * 1.4 + sine(1250, i) * dec(i, 0.02) * 0.6 + sine(3100, i) * dec(i, 0.008) * 0.3;
  return normalize(x);
}
const shime = (r: Rng) => drum(r, 390, { sec: 0.4, decay: 0.08, bend: 0.15, noise: 0.9, noiseHz: 1800, noiseDecay: 0.03, modes: [[1.6, 0.4, 0.04]] });
function chanchiki(r: Rng): Float32Array {
  const x = metalPartials(0.6, 1180, [[1, 1, 0.16], [1.48, 0.7, 0.11], [2.07, 0.5, 0.09], [2.61, 0.4, 0.06], [3.32, 0.3, 0.04]], r, 0.5, 4000, 0.02);
  return normalize(x, 0.8);
}
function tebyoshi(r: Rng): Float32Array {
  const x = bp(noise(r, len(0.35)), 1300, 1.3);
  for (let i = 0; i < x.length; i++) x[i] *= dec(i, 0.012) + 0.12 * dec(i, 0.09);
  return normalize(room(x, 0.6, 0.25));
}
function hyoshigi(r: Rng): Float32Array {
  const x = len(0.5);
  for (const at of [0, 0.006]) {
    const o = Math.round(at * SR);
    for (let i = 0; o + i < x.length; i++) x[o + i] += (sine(2150, i) * dec(i, 0.07) + sine(3420, i) * dec(i, 0.03) * 0.6 + sine(5900, i) * dec(i, 0.012) * 0.3 + r.bi() * dec(i, 0.002)) * (at ? 0.6 : 1);
  }
  return normalize(room(x, 0.5, 0.35));
}
function kane(r: Rng): Float32Array {
  const x = metalPartials(4, 196, [[0.5, 0.5, 2.6], [0.503, 0.4, 2.4], [1, 1, 1.9], [1.19, 0.6, 1.2], [1.56, 0.5, 0.9], [2, 0.45, 0.7], [2.51, 0.3, 0.45], [2.66, 0.3, 0.4], [3.01, 0.2, 0.3], [4.1, 0.12, 0.15]], r, 0.15, 3000, 0.01);
  return normalize(x, 0.8);
}
/** 「よーいっ！」（音頭の掛け声） */
const yooi = (r: Rng) => voice(r, 0.75, [460, 820, 2700], [300, 2250, 3000], 0.38, 310, 230, 0.12);
function shamisen(r: Rng): Float32Array {
  const x = pluck(48, 1.6, { decay: 0.45, tone: 0.95, pick: 0.08, r });
  // さわり（ビーンと鳴る）：少し非対称にゆがめる ＋ ばちの音 ＋ 皮
  for (let i = 0; i < x.length; i++) { const v = x[i]; x[i] = v + 0.35 * v * Math.abs(v) * (1 + dec(i, 0.3)); }
  hp1(x, 120);
  const bachi = bp(noise(r, len(0.06)), 2600, 2);
  for (let i = 0; i < bachi.length; i++) bachi[i] *= dec(i, 0.006) * 1.5;
  const skin = bp(noise(r, len(0.12)), 420, 2);
  for (let i = 0; i < skin.length; i++) skin[i] *= dec(i, 0.025);
  mix(x, bachi, 0.5); mix(x, skin, 0.9);
  return level(fadeOut(x), 0.16);
}
function koto(r: Rng): Float32Array {
  const x = pluck(60, 2.4, { decay: 0.9, tone: 0.75, pick: 0.13, r });
  mix(x, bp(x.slice(), 520, 1.5), 0.6);
  return level(fadeOut(x, 0.2), 0.14);
}
const shakuhachi = (r: Rng) => wind(r, 72, 2.8, { harm: [1, 0.12, 0.08, 0.02], breath: 0.32, breathHz: 1400, scoop: 0.9, vib: 0.007 });
const fue = (r: Rng) => wind(r, 72, 2.4, { harm: [1, 0.05, 0.18], breath: 0.22, breathHz: 3200, scoop: 0.5, vib: 0.006 });
function strings(): Float32Array {
  const x = saws(3, midiHz(60), [-9, -4, 0, 5, 10], (i) => 1 + 0.004 * Math.min(1, i / SR / 0.6) * Math.sin((TAU * 5.4 * i) / SR));
  lpSweep(x, (i) => 1200 + 2000 * Math.min(1, i / (SR * 0.3)), 0.1);
  hp1(x, 150);
  for (let i = 0; i < x.length; i++) x[i] *= Math.min(1, i / (SR * 0.12));
  return normalize(fadeOut(x, 0.15), 0.8);
}
/** 泣きのギター：少し歪ませたエレキに、遅れてかかるビブラート */
function nakiGtr(r: Rng): Float32Array {
  let x = pluck(60, 3, { decay: 1.6, tone: 0.85, pick: 0.18, r });
  shape(x, 3.5);
  lp1(lp1(x, 3800), 6000);
  x = vibrato(x, 5.6, 0.00045, 0.35);
  return level(fadeOut(x, 0.2), 0.18);
}
function woodBass(r: Rng, decay = 0.9): Float32Array {
  const x = pluck(36, 2, { decay, tone: 0.35, pick: 0.22, r });
  const f = midiHz(36);
  for (let i = 0; i < x.length; i++) x[i] += sine(f, i) * dec(i, decay * 0.8) * 0.12 + sine(f * 2, i) * dec(i, 0.05) * 0.1;
  lp1(x, 1500);
  return level(fadeOut(x, 0.15), 0.2);
}
function suzu(r: Rng): Float32Array {
  const x = len(0.8);
  for (let k = 0; k < 14; k++) {
    const at = r.range(0, 0.22) * (k % 2 ? 1 : 0.3), f = r.range(3800, 7200);
    const o = Math.round(at * SR);
    for (let i = 0; o + i < x.length; i++) x[o + i] += (Math.sin((TAU * f * i) / SR) + 0.4 * Math.sin((TAU * f * 2.3 * i) / SR)) * dec(i, r.range(0.05, 0.14)) * r.range(0.4, 1);
  }
  return normalize(x, 0.7);
}

// ================= D：レゲエ・ダブ・スカ =================
const onedrop = (r: Rng) => drum(r, 54, { sec: 0.7, decay: 0.28, bend: 0.8, bendT: 0.025, noise: 0.15, noiseHz: 200 });
const steppers = (r: Rng) => drum(r, 55, { sec: 0.5, decay: 0.18, bend: 2.6, bendT: 0.02, click: 0.5, drive: 1.6 });
function rimshot(r: Rng): Float32Array {
  const x = len(0.3);
  const n = bp(noise(r, len(0.3)), 2800, 1);
  for (let i = 0; i < x.length; i++) x[i] = n[i] * dec(i, 0.03) + sine(330, i) * dec(i, 0.04) * 0.7 + sine(1700, i) * dec(i, 0.03) * 0.5 + (i < 30 ? r.bi() : 0);
  return normalize(room(x, 0.4, 0.2));
}
/** 裏打ちのギター（スカンク）：弦を押さえて短く切る */
function skank(r: Rng): Float32Array {
  const x = pluck(60, 0.45, { decay: 0.11, tone: 0.8, pick: 0.15, r });
  const s = hp1(noise(r, len(0.03)), 2500);
  for (let i = 0; i < s.length; i++) s[i] *= dec(i, 0.006);
  mix(x, s, 0.3);
  hp1(x, 250);
  return level(fadeOut(x, 0.03), 0.14);
}
function organ(r: Rng): Float32Array {
  const x = len(2.5), f = midiHz(60);
  const bars: [number, number][] = [[0.5, 0.5], [1, 1], [1.5, 0.45], [2, 0.6], [3, 0.25], [4, 0.3], [6, 0.08]];
  for (const [ratio, a] of bars) for (let i = 0; i < x.length; i++) x[i] += Math.sin((TAU * f * ratio * i) / SR + ratio) * a;
  for (let i = 0; i < x.length; i++) x[i] *= (1 + 0.12 * Math.sin((TAU * 6.3 * i) / SR)) * Math.min(1, i / 150);
  const click = hp1(noise(r, len(0.01)), 2000);
  mix(x, click, 0.8);
  return normalize(fadeOut(x, 0.05), 0.8);
}
function dubBass(): Float32Array {
  const x = len(2.5), f = midiHz(36);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh((Math.sin((TAU * f * i) / SR) + 0.25 * Math.sin((TAU * 2 * f * i) / SR)) * 1.3) * Math.min(1, i / 200) * (0.75 + 0.25 * dec(i, 0.4));
  return normalize(fadeOut(lp1(x, 700), 0.05));
}
function siren(): Float32Array {
  const x = len(2.2);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, lfo = Math.abs(((t * 3.2) % 1) * 2 - 1);
    ph += (TAU * (420 + 700 * lfo + 120 * t)) / SR;
    x[i] = (Math.sin(ph) * 0.7 + Math.sign(Math.sin(ph)) * 0.15) * Math.min(1, t / 0.03) * Math.min(1, (2.2 - t) / 0.4);
  }
  return normalize(lp1(x, 4000), 0.75);
}
/** スプリングリバーブのスネア（ボヨーン） */
function springSnare(r: Rng): Float32Array {
  const x = len(1.6);
  mix(x, snare(r));
  const d = Math.round(0.034 * SR);
  let lp = 0;
  const y = x.slice();
  for (let i = 0; i < y.length; i++) {
    const back = i >= d ? y[i - d] : 0;
    lp += 0.25 * (back - lp);
    y[i] = x[i] + lp * 0.78;
  }
  // 分散（バネのビヨン）：オールパスを何段か
  let z = y;
  for (const g of [0.6, 0.6, 0.6]) {
    const o = new Float32Array(z.length);
    let x1 = 0, y1 = 0;
    for (let i = 0; i < z.length; i++) { o[i] = -g * z[i] + x1 + g * y1; x1 = z[i]; y1 = o[i]; }
    z = o;
  }
  for (let i = 0; i < x.length; i++) z[i] = x[i] * 0.6 + z[i] * 0.5;
  return level(fadeOut(z, 0.2), 0.15);
}
function brass(m: number, sec: number, o: { cents: number[]; bright: number; atk: number; low?: number }): Float32Array {
  const f = midiHz(m);
  const x = saws(sec, f, o.cents, (i) => (1 - 0.012 * dec(i, 0.04)) * (1 + 0.004 * Math.min(1, Math.max(0, i / SR - 0.3)) * Math.sin((TAU * 5.3 * i) / SR)));
  lpSweep(x, (i) => (o.low ?? f * 1.5) + f * o.bright * (Math.min(1, i / (o.atk * SR)) * (0.6 + 0.4 * dec(i, 0.25))), 0.15);
  for (let i = 0; i < x.length; i++) x[i] *= Math.min(1, i / (SR * 0.015));
  return normalize(fadeOut(x, 0.1), 0.8);
}
const horns = () => brass(60, 2, { cents: [-7, 0, 6, 1195], bright: 9, atk: 0.04 });
const melodica = (r: Rng) => wind(r, 72, 2.2, { harm: [], breath: 0.08, breathHz: 2500, scoop: 0.2, vib: 0.002, pulse: 0.32 });
/** ダブの一発：短い和音に、こだまを焼き込んだもの */
function dubHit(): Float32Array {
  const x = len(2.4);
  const st = len(0.16);
  for (const m of [57, 60, 64]) mix(st, saws(0.16, midiHz(m), [-5, 5]));
  for (let i = 0; i < st.length; i++) st[i] *= dec(i, 0.07);
  lp1(st, 3000);
  let g = 1, cut = 3000;
  for (let k = 0; k < 6; k++) { const c = st.slice(); lp1(c, cut); mix(x, c, g, k * 0.36); g *= 0.6; cut *= 0.7; }
  return level(x, 0.12);
}
const akete = (r: Rng) => drum(r, 230, { sec: 0.5, decay: 0.16, bend: 0.12, noise: 0.5, noiseHz: 900, noiseDecay: 0.02, modes: [[1.7, 0.3, 0.06]] });
/** ピアノ（倍音が少しずれた弦 2 本 ＋ ハンマー） */
function piano(r: Rng, m: number, sec: number, bright: number, decay: number): Float32Array {
  const x = len(sec), f = midiHz(m), B = 0.0004;
  for (let k = 1; k <= 10; k++) {
    const fk = k * f * Math.sqrt(1 + B * k * k);
    if (fk > 9000) break;
    const a = Math.pow(k, -1.1) * (k === 1 ? 1 : bright), d = decay / Math.pow(k, 0.7);
    for (const det of [0, 0.0009]) { const fd = fk * (1 + det); for (let i = 0; i < x.length; i++) x[i] += Math.sin((TAU * fd * i) / SR) * a * dec(i, d) * 0.5; }
  }
  const h = lp1(noise(r, len(0.03)), 2500);
  for (let i = 0; i < h.length; i++) h[i] *= dec(i, 0.004);
  mix(x, h, 0.6);
  for (let i = 0; i < 40; i++) x[i] *= i / 40;
  return normalize(fadeOut(x, 0.1), 0.85);
}

// ================= E：ジャズ・ボサノバ・ファンク =================
const jazzKick = (r: Rng) => normalize(lp1(drum(r, 62, { sec: 0.6, decay: 0.28, bend: 0.6, bendT: 0.03, noise: 0.2, noiseHz: 150 }), 900));
function brush(r: Rng): Float32Array {
  const x = len(0.45);
  const n = lp1(noise(r, len(0.45)), 7000);
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = n[i] * Math.min(1, t / 0.008) * (0.7 * dec(i, 0.07) + 0.3 * dec(i, 0.25)) + sine(200, i) * dec(i, 0.04) * 0.25; }
  return normalize(hp1(x, 400), 0.75);
}
function ride(r: Rng, bright = 1): Float32Array {
  const parts: [number, number, number][] = [];
  for (let k = 0; k < 10; k++) parts.push([r.range(1, 14), r.range(0.2, 0.6), r.range(0.6, 2)]);
  const x = metalPartials(2.5, 420 * bright, parts, r, 0.5, 6000, 0.5);
  for (let i = 0; i < x.length; i++) x[i] += sine(3150 * bright, i) * dec(i, 0.25) * 0.5;
  hp1(x, 1500);
  return normalize(x, 0.6);
}
const pedalHat = (r: Rng) => hh(r, 0.022, 3000, 1.4);
function crossStick(r: Rng): Float32Array {
  const x = len(0.15);
  for (let i = 0; i < x.length; i++) x[i] = sine(1150, i) * dec(i, 0.02) + sine(520, i) * dec(i, 0.03) * 0.6 + (i < 25 ? r.bi() * 0.6 : 0);
  return normalize(bp(x, 1000, 1.2));
}
function epiano(m: number, sec: number, bright: number, trem: number): Float32Array {
  const x = len(sec), f = midiHz(m);
  for (let i = 0; i < x.length; i++) {
    const I = bright * 2.2 * dec(i, 0.35) + 0.25;
    const md = Math.sin((TAU * f * i) / SR) * I;
    x[i] = (Math.sin((TAU * f * i) / SR + md) + Math.sin((TAU * f * 14.1 * i) / SR) * dec(i, 0.015) * 0.25 * bright) * dec(i, 1.3) * (1 + trem * Math.sin((TAU * 4.6 * i) / SR));
  }
  for (let i = 0; i < 30; i++) x[i] *= i / 30;
  return normalize(fadeOut(x, 0.1), 0.85);
}
const nylon = (r: Rng) => { const x = pluck(60, 2.4, { decay: 0.8, tone: 0.45, pick: 0.25, r }); mix(x, bp(x.slice(), 210, 1.2), 0.8); return level(fadeOut(x, 0.15), 0.14); };
function clav(r: Rng): Float32Array {
  const x = pluck(60, 1, { decay: 0.35, tone: 1, pick: 0.07, r });
  mix(x, bp(x.slice(), 1300, 2), 1.2);
  hp1(x, 200);
  shape(x, 2);
  return level(fadeOut(x, 0.05), 0.16);
}
function slap(r: Rng): Float32Array {
  const x = pluck(36, 1.8, { decay: 0.6, tone: 0.95, pick: 0.06, r });
  for (let i = 0; i < x.length; i++) x[i] += sine(midiHz(36), i) * dec(i, 0.4) * 0.15;
  const pop = bp(noise(r, len(0.02)), 3500, 1.5);
  for (let i = 0; i < pop.length; i++) pop[i] *= dec(i, 0.003);
  mix(x, pop, 0.4);
  shape(x, 1.8);
  return level(fadeOut(x, 0.1), 0.18);
}
/** サックス風：のこぎり波を口の形（1 kHz あたり）に通して、息を足す */
function sax(r: Rng): Float32Array {
  const x = brass(60, 2.4, { cents: [0, 4], bright: 5, atk: 0.06 });
  mix(x, bp(x.slice(), 1100, 2), 0.7);
  const n = bp(noise(r, len(2.4)), 2200, 1);
  for (let i = 0; i < x.length; i++) x[i] += n[i] * 0.06 * Math.min(1, i / (SR * 0.05));
  return normalize(vibrato(x, 5, 0.0003, 0.4), 0.8);
}
function vibes(): Float32Array {
  const x = len(2.6), f = midiHz(72);
  for (let i = 0; i < x.length; i++) x[i] = (Math.sin((TAU * f * i) / SR) + 0.3 * Math.sin((TAU * f * 4 * i) / SR) * dec(i, 0.25) + 0.12 * Math.sin((TAU * f * 10 * i) / SR) * dec(i, 0.04)) * dec(i, 1.1) * (1 + 0.3 * Math.sin((TAU * 5 * i) / SR));
  for (let i = 0; i < 20; i++) x[i] *= i / 20;
  return normalize(fadeOut(x, 0.1), 0.8);
}
function clave(): Float32Array {
  const x = len(0.2);
  for (let i = 0; i < x.length; i++) x[i] = sine(2480, i) * dec(i, 0.035) + sine(5100, i) * dec(i, 0.01) * 0.3;
  return normalize(x);
}
function cabasa(r: Rng): Float32Array {
  const x = hp1(hp1(noise(r, len(0.12)), 6000), 6000);
  for (let i = 0; i < x.length; i++) x[i] *= Math.min(1, i / (SR * 0.006)) * dec(i, 0.025);
  return normalize(x, 0.6);
}
function funkSnare(r: Rng): Float32Array {
  const x = len(0.3);
  const n = hp1(noise(r, len(0.3)), 2000);
  for (let i = 0; i < x.length; i++) x[i] = n[i] * dec(i, 0.07) + sine(270, i) * dec(i, 0.035) * 0.9 + sine(480, i) * dec(i, 0.02) * 0.3;
  return normalize(shape(x, 1.6));
}
const conga = (r: Rng) => drum(r, 205, { sec: 0.6, decay: 0.2, bend: 0.1, noise: 0.35, noiseHz: 1500, noiseDecay: 0.01, modes: [[1.52, 0.2, 0.08]] });

// ================= F：ダンス =================
const kick909 = (r: Rng) => drum(r, 50, { sec: 0.6, decay: 0.26, bend: 4.5, bendT: 0.012, click: 0.6, drive: 1.8 });
function snare909(r: Rng): Float32Array {
  const x = len(0.35);
  const n = lp1(hp1(noise(r, len(0.35)), 1200), 9000);
  for (let i = 0; i < x.length; i++) x[i] = sine(180, i) * dec(i, 0.05) * 0.8 + sine(330, i) * dec(i, 0.03) * 0.5 + n[i] * dec(i, 0.11) * 0.8;
  return normalize(x);
}
function bass808(): Float32Array {
  const x = len(2), f = midiHz(36);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { ph += (TAU * f * Math.pow(2, (6 * dec(i, 0.025)) / 12)) / SR; x[i] = Math.tanh(Math.sin(ph) * 1.6) * dec(i, 1.1) * Math.min(1, i / 30); }
  return normalize(fadeOut(x, 0.1));
}
function reese(): Float32Array {
  const f = midiHz(36);
  const x = saws(2.5, f, [-14, 13]);
  for (let i = 0; i < x.length; i++) x[i] += Math.sin((TAU * f * i) / SR) * 0.4;
  lpSweep(x, (i) => 700 + 250 * Math.sin((TAU * 0.6 * i) / SR), 0.2);
  return normalize(fadeOut(shape(x, 1.5), 0.05));
}
function acid(): Float32Array {
  const f = midiHz(48);
  const x = saws(0.6, f, [0]);
  lpSweep(x, (i) => 250 + 3200 * dec(i, 0.09), 0.88);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * 2.2) * Math.min(1, i / 40);
  return normalize(fadeOut(x, 0.05));
}
function supersaw(): Float32Array {
  const x = saws(2.2, midiHz(60), [-24, -15, -7, 0, 7, 16, 25, 1200]);
  lp1(lp1(x, 7000), 9000);
  hp1(x, 180);
  return normalize(fadeOut(x, 0.08), 0.8);
}
const gabber = (r: Rng) => normalize(lp1(drum(r, 58, { sec: 0.55, decay: 0.3, bend: 5, bendT: 0.018, click: 0.8, drive: 9 }), 6000));
const breakSnare = (r: Rng) => normalize(shape(room(snare(r), 0.9, 0.3), 1.8));
const trapHat = (r: Rng) => hh(r, 0.012, 8000, 1.9);
function perc(r: Rng): Float32Array {
  const x = len(0.25);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { ph += (TAU * (620 + 500 * dec(i, 0.01))) / SR; x[i] = Math.sin(ph + 2.5 * Math.sin(ph * 1.41) * dec(i, 0.03)) * dec(i, 0.05) + (i < 20 ? r.bi() * 0.3 : 0); }
  return normalize(x);
}
/** 「ヘイ！」 */
const hey = (r: Rng) => voice(r, 0.45, [560, 1850, 2600], [320, 2300, 3000], 0.18, 290, 250, 0.25);

// ================= G：マーチ・チップ・パンク・ローファイ =================
const marchBd = (r: Rng) => normalize(lp1(drum(r, 52, { sec: 1, decay: 0.38, bend: 0.25, noise: 0.5, noiseHz: 250, noiseDecay: 0.06, modes: [[1.5, 0.3, 0.15]] }), 1200));
function marchSn(r: Rng): Float32Array {
  const x = len(0.4);
  const n = bp(noise(r, len(0.4)), 4200, 0.7);
  for (let i = 0; i < x.length; i++) x[i] = n[i] * (0.8 * dec(i, 0.05) + 0.3 * dec(i, 0.16)) + sine(225, i) * dec(i, 0.04) * 0.7;
  return normalize(x);
}
function cymbal(r: Rng): Float32Array {
  const x = len(2);
  mix(x, crash(r), 1);
  mix(x, crash(r), 0.6, 0.012); // 2 枚を打ち合わせる
  const m = metalPartials(2, 600, [[1, 0.2, 0.6], [1.7, 0.2, 0.5], [2.9, 0.15, 0.4], [4.3, 0.1, 0.3]], r);
  mix(x, m, 1);
  return normalize(x, 0.6);
}
function glock(): Float32Array {
  const x = len(1.8), f = midiHz(72);
  for (const [ratio, a, d] of [[1, 1, 0.9], [2.76, 0.5, 0.3], [5.4, 0.25, 0.12], [8.93, 0.12, 0.05]]) for (let i = 0; i < x.length; i++) x[i] += Math.sin((TAU * f * ratio * i) / SR) * a * dec(i, d);
  for (let i = 0; i < 15; i++) x[i] *= i / 15;
  return normalize(x, 0.8);
}
const brassMarch = () => brass(60, 2.2, { cents: [-6, 0, 5], bright: 11, atk: 0.05 });
const tuba = () => brass(36, 2.2, { cents: [0, 3], bright: 4, atk: 0.08, low: 120 });
function chipSq(): Float32Array {
  const x = len(2), f = midiHz(60);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { ph = (ph + f / SR) % 1; x[i] = (ph < 0.25 ? 0.5 : -0.5) * (i < 40 ? i / 40 : 1); }
  return fadeOut(x, 0.01);
}
function chipNoise(r: Rng): Float32Array {
  const x = len(0.25);
  let lfsr = 0x7fff ^ r.int(0x7fff), hold = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % 6 === 0) { const b = (lfsr ^ (lfsr >> 1)) & 1; lfsr = (lfsr >> 1) | (b << 14); hold = lfsr & 1 ? 0.5 : -0.5; }
    x[i] = hold * Math.round(dec(i, 0.06) * 15) / 15;
  }
  return x;
}
function chipTri(): Float32Array {
  const x = len(2), f = midiHz(36);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { ph = (ph + f / SR) % 1; const tri = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4; x[i] = (Math.round(tri * 7.5) / 7.5) * 0.7; }
  return fadeOut(x, 0.01);
}
function powerGtr(): Float32Array {
  const f = midiHz(48);
  const x = saws(2.4, f, [-6, 5]);
  mix(x, saws(2.4, f * 1.4983, [-4, 7]), 0.8);
  mix(x, saws(2.4, f / 2, [0]), 0.25);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * 9 * (0.6 + 0.4 * dec(i, 0.8)));
  lp1(lp1(x, 3200), 4500);
  mix(x, bp(x.slice(), 1600, 1.5), 0.5);
  for (let i = 0; i < x.length; i++) x[i] *= Math.min(1, i / 60) * (0.7 + 0.3 * dec(i, 0.5));
  return normalize(fadeOut(x, 0.08), 0.8);
}
const rockKick = (r: Rng) => drum(r, 58, { sec: 0.5, decay: 0.2, bend: 2, bendT: 0.015, click: 0.9, noise: 0.2, noiseHz: 3000, noiseDecay: 0.004, drive: 2 });
const rockSnare = (r: Rng) => normalize(shape(room(funkSnare(r), 0.8, 0.35), 1.4));
const lofiKick = (r: Rng) => { const x = drum(r, 54, { sec: 0.45, decay: 0.16, bend: 1.2, drive: 2.5 }); for (let i = 0; i < x.length; i++) x[i] = Math.round(x[i] * 24) / 24; return normalize(lp1(lp1(x, 1800), 2500)); };
const dustySn = (r: Rng) => { const x = snare(r, true); for (let i = 0; i < x.length; i++) x[i] = Math.round(x[i] * 10) / 10; return normalize(lp1(room(x, 0.5, 0.2), 3500)); };
function lofiKeys(r: Rng): Float32Array {
  let x = epiano(60, 2.4, 0.5, 0.15);
  x = vibrato(x, 0.9, 0.0012, 0); // テープのゆれ
  lp1(lp1(x, 2600), 4000);
  const h = lp1(noise(r, len(2.4)), 3000);
  for (let i = 0; i < x.length; i++) x[i] += h[i] * 0.015;
  return normalize(x, 0.8);
}
/** レコードのチリチリ（ループ） */
function vinyl(r: Rng): Float32Array {
  const x = lp1(noise(r, len(2)), 2500);
  for (let i = 0; i < x.length; i++) x[i] *= 0.05;
  for (let k = 0; k < 40; k++) {
    const o = r.int(x.length - 200), a = r.range(0.2, 1) * (r.chance(0.2) ? 1 : 0.35);
    for (let i = 0; i < 120; i++) x[o + i] += r.bi() * a * dec(i, 0.0006);
  }
  return normalize(hp1(x, 300), 0.35);
}

// ================= バンクの並び =================
/** 1 つの音（作るのは必要になったときだけ。乱数は音ごとに決まる） */
interface Lazy { name: string; make: (r: Rng) => Float32Array; params?: FactorySound['params'] }
const L = (name: string, make: (r: Rng) => Float32Array, params?: FactorySound['params']): Lazy => ({ name, make, params });
const SUS = { gate: true, release: 0.25 };

function genreList(bank: number): Lazy[] {
  switch (bank) {
    case 2: return [
      L('TAIKO', (r) => taikoDon(r)), L('TAIKO KA', (r) => taikoKa(r)), L('SHIME', (r) => shime(r)), L('CHANCHKI', (r) => chanchiki(r)),
      L('TEBYOSHI', (r) => tebyoshi(r)), L('HYOSHIGI', (r) => hyoshigi(r)), L('KANE', (r) => kane(r)), L('YOOI!', (r) => yooi(r)),
      L('SHAMISEN', (r) => shamisen(r)), L('KOTO', (r) => koto(r)), L('SHAKU', (r) => shakuhachi(r), { ...SUS, release: 0.3 }), L('STRINGS', () => strings(), { gate: true, attack: 0.25, release: 0.4 }),
      L('NAKI GTR', (r) => nakiGtr(r), SUS), L('WOODBASS', (r) => woodBass(r), { gate: true, release: 0.12 }), L('FUE', (r) => fue(r), SUS), L('SUZU', (r) => suzu(r)),
    ];
    case 3: return [
      L('ONEDROP', (r) => onedrop(r)), L('RIMSHOT', (r) => rimshot(r)), L('HAT', (r) => hh(r, 0.025, 5500, 1.6), { mute: 2 }), L('OP HAT', (r) => hh(r, 0.14, 5500, 1.6), { mute: 2 }),
      L('SKANK', (r) => skank(r)), L('ORGAN', (r) => organ(r), { gate: true, release: 0.08 }), L('DUB BASS', () => dubBass(), { gate: true, release: 0.12 }), L('SIREN', () => siren()),
      L('SPRING', (r) => springSnare(r)), L('HORNS', () => horns(), { gate: true, release: 0.15 }), L('MELODICA', (r) => melodica(r), SUS), L('SHAKER', (r) => shaker(r)),
      L('DUB HIT', () => dubHit()), L('AKETE', (r) => akete(r)), L('STEPPER', (r) => steppers(r)), L('SKA PNO', (r) => piano(r, 60, 1.2, 0.5, 0.5)),
    ];
    case 4: return [
      L('JAZZ BD', (r) => jazzKick(r)), L('BRUSH', (r) => brush(r)), L('RIDE', (r) => ride(r)), L('PEDAL HH', (r) => pedalHat(r)),
      L('X-STICK', (r) => crossStick(r)), L('UPRIGHT', (r) => woodBass(r, 0.7), { gate: true, release: 0.1 }), L('E.PIANO', () => epiano(60, 2.6, 0.8, 0.12), SUS), L('NYLON', (r) => nylon(r)),
      L('CLAV', (r) => clav(r), { gate: true, release: 0.05 }), L('SLAP', (r) => slap(r), { gate: true, release: 0.08 }), L('SAX', (r) => sax(r), SUS), L('VIBES', () => vibes()),
      L('CLAVE', () => clave()), L('CABASA', (r) => cabasa(r)), L('FUNK SN', (r) => funkSnare(r)), L('CONGA', (r) => conga(r)),
    ];
    case 5: return [
      L('909 BD', (r) => kick909(r)), L('909 SN', (r) => snare909(r)), L('909 CH', (r) => hh(r, 0.03, 7000, 1.9), { mute: 3 }), L('909 OH', (r) => hh(r, 0.22, 7000, 1.9), { mute: 3 }),
      L('909 CLAP', (r) => normalize(room(clap(r), 0.4, 0.15))), L('909 RIDE', (r) => ride(r, 1.3)), L('808', () => bass808(), { gate: true, release: 0.3 }), L('REESE', () => reese(), { gate: true, release: 0.1 }),
      L('ACID', () => acid(), { gate: true, release: 0.06 }), L('HOUSE PN', (r) => piano(r, 60, 1.4, 0.9, 0.7)), L('SUPERSAW', () => supersaw(), { gate: true, release: 0.3 }), L('GABBER', (r) => gabber(r)),
      L('BREAK SN', (r) => breakSnare(r)), L('TRAP HH', (r) => trapHat(r), { mute: 3 }), L('PERC', (r) => perc(r)), L('HEY!', (r) => hey(r)),
    ];
    default: return [
      L('MARCH BD', (r) => marchBd(r)), L('MARCH SN', (r) => marchSn(r)), L('CYMBAL', (r) => cymbal(r)), L('GLOCK', () => glock()),
      L('BRASS', () => brassMarch(), SUS), L('TUBA', () => tuba(), { gate: true, release: 0.12 }), L('CHIP SQ', () => chipSq(), { gate: true, release: 0.02 }), L('CHIP NZ', (r) => chipNoise(r)),
      L('CHIP TRI', () => chipTri(), { gate: true, release: 0.02 }), L('POWER GT', () => powerGtr(), { gate: true, release: 0.1 }), L('ROCK BD', (r) => rockKick(r)), L('ROCK SN', (r) => rockSnare(r)),
      L('LOFI BD', (r) => lofiKick(r)), L('DUSTY SN', (r) => dustySn(r)), L('LOFI EP', (r) => lofiKeys(r), SUS), L('VINYL', (r) => vinyl(r), { gate: true, loop: true, release: 0.3 }),
    ];
  }
}

/** バンク C〜G の音の名前だけ（音は作らない） */
export const genreNames = (bank: number): string[] => genreList(bank).map((s) => s.name);
/** バンク C〜G の 1 音の設定 */
export const genreParams = (bank: number, i: number): FactorySound['params'] => genreList(bank)[i]?.params;
/** バンク C〜G の 1 音を作る */
export function genreSound(bank: number, i: number): FactorySound {
  const s = genreList(bank)[i];
  return { name: s.name, buf: mono(s.make(new Rng(31337 + bank * 1013 + i * 7919))), params: s.params };
}
export const genreBank = (bank: number): FactorySound[] => genreList(bank).map((_, i) => genreSound(bank, i));
