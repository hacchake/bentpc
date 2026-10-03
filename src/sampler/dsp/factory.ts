// 工場出荷の音：すべてプログラムで合成する（録音素材は使わない）。乱数はシード付きなので、いつも同じ音。
// バンク A = ドラム、バンク B = 魔改造おもちゃの音とループ。C〜G = ジャンル編（factory2.ts）。
import { Rng } from '../../core/rng';
import { genreBank, genreNames, genreParams, genreSound } from './factory2';
import { defaultPad, type PadParams, type SampleBuf } from './types';

export const SR = 44100;

export interface FactorySound {
  name: string;
  buf: SampleBuf;
  params?: Partial<PadParams>;
}

export const mono = (x: Float32Array): SampleBuf => ({ sr: SR, ch: [x] });
export const len = (sec: number) => new Float32Array(Math.round(sec * SR));
export const TAU = Math.PI * 2;

/** 1 次のローパス・ハイパス（係数は周波数から） */
export function lp1(x: Float32Array, hz: number): Float32Array {
  const a = 1 - Math.exp((-TAU * hz) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; }
  return x;
}
export function hp1(x: Float32Array, hz: number): Float32Array {
  const a = 1 - Math.exp((-TAU * hz) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = x[i] - y; }
  return x;
}
/** バンドパス（共振） */
export function bp(x: Float32Array, hz: number, q: number): Float32Array {
  const w = (TAU * hz) / SR, al = Math.sin(w) / (2 * q);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}
export function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}
export const dec = (i: number, sec: number) => Math.exp(-i / (sec * SR));
export const noise = (r: Rng, n: Float32Array) => { for (let i = 0; i < n.length; i++) n[i] = r.bi(); return n; };
export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------- ドラム ----------------
export function kick(boom = false): Float32Array {
  const x = len(boom ? 1.4 : 0.5);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const f = (boom ? 48 : 52) + (boom ? 120 : 180) * dec(i, 0.03);
    ph += (TAU * f) / SR;
    x[i] = Math.sin(ph) * dec(i, boom ? 0.45 : 0.14) + (i < 60 ? (1 - i / 60) * 0.4 : 0);
    if (boom) x[i] = Math.tanh(x[i] * 1.6);
  }
  return normalize(x);
}
export function snare(r: Rng, lofi = false): Float32Array {
  const x = len(0.35);
  const n = hp1(noise(r, len(0.35)), lofi ? 900 : 1500);
  for (let i = 0; i < x.length; i++) {
    x[i] = n[i] * dec(i, 0.09) * 0.8 + Math.sin((TAU * 185 * i) / SR) * dec(i, 0.05) * 0.6;
  }
  if (lofi) for (let i = 0; i < x.length; i++) x[i] = Math.round(x[i] * 12) / 12; // ビットを落とす
  return normalize(lofi ? lp1(x, 5000) : x);
}
export function hat(r: Rng, open: boolean): Float32Array {
  const x = len(open ? 0.5 : 0.08);
  // 金属っぽさ：四角波 6 本 ＋ ノイズ
  const fs = [205, 304, 369, 522, 540, 800];
  for (let i = 0; i < x.length; i++) {
    let m = 0;
    for (const f of fs) m += Math.sign(Math.sin((TAU * f * 1.7 * i) / SR));
    x[i] = (m / 6) * 0.6 + r.bi() * 0.5;
  }
  hp1(hp1(x, 7000), 7000);
  for (let i = 0; i < x.length; i++) x[i] *= dec(i, open ? 0.16 : 0.018);
  return normalize(x, 0.7);
}
export function clap(r: Rng): Float32Array {
  const x = len(0.4);
  const n = bp(noise(r, len(0.4)), 1200, 1.2);
  const hits = [0, 0.011, 0.022, 0.034];
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    let e = 0;
    for (const h of hits) if (t >= h) e = Math.max(e, Math.exp(-(t - h) / (h === 0.034 ? 0.12 : 0.008)));
    x[i] = n[i] * e;
  }
  return normalize(x);
}
function tom(hz: number): Float32Array {
  const x = len(0.6);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    ph += (TAU * hz * (1 + 0.6 * dec(i, 0.04))) / SR;
    x[i] = Math.sin(ph) * dec(i, 0.22);
  }
  return normalize(x);
}
function rim(r: Rng): Float32Array {
  const x = len(0.08);
  for (let i = 0; i < x.length; i++) x[i] = (Math.sin((TAU * 1700 * i) / SR) * 0.7 + r.bi() * 0.3) * dec(i, 0.012);
  return normalize(bp(x, 1700, 3));
}
function cowbell(): Float32Array {
  const x = len(0.5);
  for (let i = 0; i < x.length; i++) {
    const a = Math.sign(Math.sin((TAU * 540 * i) / SR)), b = Math.sign(Math.sin((TAU * 800 * i) / SR));
    x[i] = (a + b) * 0.5 * (0.7 * dec(i, 0.03) + 0.3 * dec(i, 0.2));
  }
  return normalize(bp(x, 800, 2));
}
export function shaker(r: Rng): Float32Array {
  const x = hp1(noise(r, len(0.18)), 5000);
  for (let i = 0; i < x.length; i++) { const t = i / x.length; x[i] *= Math.sin(Math.PI * Math.pow(t, 0.4)) * (1 - t); }
  return normalize(x, 0.6);
}
export function crash(r: Rng): Float32Array {
  const x = len(2.2);
  noise(r, x);
  hp1(x, 4000);
  for (let i = 0; i < x.length; i++) x[i] *= dec(i, 0.6) * (0.6 + 0.4 * Math.sin((TAU * 6 * i) / SR));
  return normalize(x, 0.6);
}
function block(): Float32Array {
  const x = len(0.15);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((TAU * 1050 * i) / SR) * dec(i, 0.025) + Math.sin((TAU * 2600 * i) / SR) * dec(i, 0.008) * 0.5;
  return normalize(x);
}
function zap(): Float32Array {
  const x = len(0.35);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { ph += (TAU * (100 + 3000 * dec(i, 0.04))) / SR; x[i] = Math.sign(Math.sin(ph)) * dec(i, 0.1) * 0.5; }
  return normalize(lp1(x, 6000));
}
function sweep(r: Rng): Float32Array {
  const x = noise(r, len(1.5));
  const y = len(1.5);
  for (let i = 0; i < x.length; i++) y[i] = x[i];
  // だんだん高くなるバンドパス（係数をサンプルごとに計算）
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < y.length; i++) {
    const t = i / y.length;
    const w = (TAU * (200 + 7000 * t * t)) / SR, al = Math.sin(w) / 6;
    const a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al;
    const yy = (al * x[i] - al * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = yy;
    y[i] = yy * Math.sin(Math.PI * t);
  }
  return normalize(y, 0.7);
}

// ---------------- おもちゃの音 ----------------
export function saw(hz: number, sec: number, cut: number): Float32Array {
  const x = len(sec);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { ph = (ph + hz / SR) % 1; x[i] = (ph * 2 - 1) * 0.5; }
  return lp1(lp1(x, cut), cut);
}
function bass(): Float32Array {
  const x = saw(midiHz(36), 0.9, 600);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * 3 * dec(i, 0.35)) * Math.min(1, i / 60);
  return normalize(x);
}
function chordStab(): Float32Array {
  const x = len(0.8);
  for (const m of [48, 51, 55, 58, 62]) { const s = saw(midiHz(m), 0.8, 2500); for (let i = 0; i < x.length; i++) x[i] += s[i]; }
  for (let i = 0; i < x.length; i++) x[i] *= dec(i, 0.25) * Math.min(1, i / 80);
  return normalize(x);
}
/** 声っぽい音：パルス列を 3 つの共振（フォルマント）に通す */
export function vox(f: [number, number, number], hz: number, sec: number, r: Rng): Float32Array {
  const src = len(sec);
  let ph = 0;
  for (let i = 0; i < src.length; i++) {
    const vib = 1 + 0.012 * Math.sin((TAU * 5.5 * i) / SR);
    ph += (hz * vib) / SR;
    if (ph >= 1) { ph -= 1; src[i] = 1; }
    src[i] += r.bi() * 0.02;
  }
  const out = len(sec);
  f.forEach((fh, k) => { const b = bp(src.slice(), fh, 8); for (let i = 0; i < out.length; i++) out[i] += b[i] * [1, 0.6, 0.3][k]; });
  for (let i = 0; i < out.length; i++) { const t = i / out.length; out[i] *= Math.min(1, t * 20) * Math.min(1, (1 - t) * 6); }
  return normalize(out);
}
function chipArp(): Float32Array {
  const x = len(0.8);
  const notes = [72, 75, 79, 84];
  const step = Math.round(SR * 0.05);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    ph = (ph + midiHz(notes[Math.floor(i / step) % 4]) / SR) % 1;
    x[i] = (ph < 0.25 ? 0.5 : -0.5) * dec(i, 0.35);
  }
  return normalize(x, 0.7);
}
function bleep(): Float32Array {
  const x = len(0.25);
  for (let i = 0; i < x.length; i++) x[i] = Math.sign(Math.sin((TAU * (i < SR * 0.08 ? 1320 : 1760) * i) / SR)) * 0.4 * (i < SR * 0.22 ? 1 : 0);
  return normalize(lp1(x, 7000), 0.7);
}
function glitch(r: Rng): Float32Array {
  const x = len(0.6);
  let i = 0;
  while (i < x.length) {
    const seg = Math.round(SR * r.range(0.01, 0.06));
    const kind = r.int(3), hz = r.range(80, 3000);
    for (let k = 0; k < seg && i < x.length; k++, i++) {
      x[i] = kind === 0 ? Math.sign(Math.sin((TAU * hz * k) / SR)) * 0.5 : kind === 1 ? r.bi() * 0.4 : (Math.floor(k / 40) % 2 ? 0.5 : -0.5);
    }
  }
  return normalize(x, 0.7);
}
function toyPiano(m: number): Float32Array {
  const x = len(1.2);
  const hz = midiHz(m);
  for (let i = 0; i < x.length; i++) {
    x[i] = (Math.sin((TAU * hz * i) / SR) + 0.5 * Math.sin((TAU * hz * 3.98 * i) / SR) * dec(i, 0.05) + 0.25 * Math.sin((TAU * hz * 2 * i) / SR)) * dec(i, 0.35);
  }
  return normalize(x);
}
function pad(): Float32Array {
  const x = len(3);
  for (const [m, d] of [[60, 0], [63, 0.3], [67, 0.6], [70, 0.9]]) {
    for (let i = 0; i < x.length; i++) {
      const hz = midiHz(m) * (1 + 0.003 * Math.sin((TAU * (0.3 + d) * i) / SR));
      x[i] += Math.sin((TAU * hz * i) / SR) * 0.25 + Math.sin((TAU * hz * 2.001 * i) / SR) * 0.08;
    }
  }
  return normalize(x, 0.7);
}
function riser(r: Rng): Float32Array {
  const x = len(2);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / x.length; ph += (TAU * (150 + 1800 * t * t)) / SR; x[i] = (Math.sin(ph) * 0.6 + r.bi() * 0.25 * t) * t; }
  return normalize(x, 0.7);
}
function laser(): Float32Array {
  const x = len(0.5);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { ph += (TAU * (2500 * dec(i, 0.12) + 60)) / SR; x[i] = Math.sin(ph) * dec(i, 0.2); }
  return normalize(x);
}
function radio(r: Rng): Float32Array {
  const x = len(1.2);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    ph += (TAU * (600 + 400 * Math.sin((TAU * 0.7 * i) / SR))) / SR;
    x[i] = r.bi() * 0.3 + Math.sin(ph) * 0.4 * (Math.sin((TAU * 3 * i) / SR) > 0 ? 1 : 0.2);
  }
  return normalize(bp(x, 1400, 0.8), 0.7);
}
function tapeStop(): Float32Array {
  const x = len(1.2);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / x.length, sp = Math.max(0, 1 - t);
    ph += sp * sp / SR;
    const p = (ph * 2) % 1;
    x[i] = ((p < 0.5 ? 1 : -1) * 0.3 + Math.sin(TAU * ph * 110) * 0.6) * sp;
  }
  return normalize(lp1(x, 3000));
}
function metal(): Float32Array {
  const x = len(1.2);
  for (const [f, d] of [[523, 0.5], [1187, 0.3], [1931, 0.2], [2797, 0.12]]) for (let i = 0; i < x.length; i++) x[i] += Math.sin((TAU * f * i) / SR) * dec(i, d);
  return normalize(x, 0.7);
}

/** バンク B のパッド 1：2 小節のビート（90 BPM）。ループで鳴らす */
function beatLoop(r: Rng): Float32Array {
  const bpm = 90, beat = (60 / bpm) * SR;
  const x = new Float32Array(Math.round(beat * 8));
  const k = kick(), s = snare(r, true), h = hat(r, false);
  const put = (src: Float32Array, at: number, g: number) => { const o = Math.round(at * beat); for (let i = 0; i < src.length && o + i < x.length; i++) x[o + i] += src[i] * g; };
  for (const b of [0, 1.75, 2.5, 4, 5.5, 6.75]) put(k, b, 0.9);
  for (const b of [1, 3, 5, 7, 7.75]) put(s, b, 0.7);
  for (let b = 0; b < 8; b += 0.5) put(h, b + (b % 1 ? 0.04 : 0), b % 1 ? 0.35 : 0.5);
  return normalize(lp1(x, 9000), 0.85);
}

/** 工場出荷の音が入っているバンクの数（A〜G） */
export const FACTORY_BANKS = 7;

/** 仕上げ：頭 1ms・終わり 8ms だけなめらかに（いきなり始まる・切れる所の「プチッ」を消す。アタックの鋭さはそのまま） */
export function declick(s: FactorySound): FactorySound {
  for (const x of s.buf.ch) {
    const a = Math.min(x.length >> 2, Math.round(SR * 0.001)), b = Math.min(x.length >> 2, Math.round(SR * 0.008));
    for (let i = 0; i < a; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
    for (let i = 0; i < b; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / b);
  }
  return s;
}

export function factoryBank(bank: number): FactorySound[] {
  if (bank >= 2) return genreBank(bank);
  return factoryAB(bank).map(declick);
}

function factoryAB(bank: number): FactorySound[] {
  const r = new Rng(bank === 0 ? 404016 : 909016);
  if (bank === 0) {
    return [
      { name: 'KICK', buf: mono(kick()) },
      { name: 'SNARE', buf: mono(snare(r)) },
      { name: 'CL HAT', buf: mono(hat(r, false)), params: { mute: 1, pan: 0.25 } },
      { name: 'OP HAT', buf: mono(hat(r, true)), params: { mute: 1, pan: 0.25 } },
      { name: 'CLAP', buf: mono(clap(r)) },
      { name: 'LO TOM', buf: mono(tom(90)), params: { pan: -0.3 } },
      { name: 'HI TOM', buf: mono(tom(150)), params: { pan: 0.3 } },
      { name: 'RIM', buf: mono(rim(r)), params: { pan: 0.2 } },
      { name: 'COWBELL', buf: mono(cowbell()), params: { pan: -0.3 } },
      { name: 'SHAKER', buf: mono(shaker(r)), params: { pan: -0.35 } },
      { name: 'BOOM', buf: mono(kick(true)) },
      { name: 'LOFI SN', buf: mono(snare(r, true)) },
      { name: 'CRASH', buf: mono(crash(r)), params: { pan: -0.2 } },
      { name: 'BLOCK', buf: mono(block()), params: { pan: 0.35 } },
      { name: 'ZAP', buf: mono(zap()) },
      { name: 'SWEEP', buf: mono(sweep(r)) },
    ];
  }
  return [
    { name: 'LOOP 90', buf: mono(beatLoop(r)), params: { loop: true } },
    { name: 'BASS C', buf: mono(bass()), params: { gate: true, release: 0.2 } },
    { name: 'STAB Cm7', buf: mono(chordStab()) },
    { name: 'VOX AH', buf: mono(vox([800, 1150, 2900], 140, 0.9, r)), params: { gate: true } },
    { name: 'VOX OH', buf: mono(vox([450, 800, 2830], 120, 0.9, r)), params: { gate: true } },
    { name: 'CHIP ARP', buf: mono(chipArp()) },
    { name: 'BLEEP', buf: mono(bleep()) },
    { name: 'GLITCH', buf: mono(glitch(r)) },
    { name: 'TOY PNO', buf: mono(toyPiano(72)) },
    { name: 'PAD Cm7', buf: mono(pad()), params: { gate: true, loop: true, attack: 0.35, release: 0.45 } },
    { name: 'RISER', buf: mono(riser(r)) },
    { name: 'LASER', buf: mono(laser()) },
    { name: 'RADIO', buf: mono(radio(r)), params: { gate: true } },
    { name: 'TAPESTOP', buf: mono(tapeStop()) },
    { name: 'METAL', buf: mono(metal()) },
    { name: 'BOOM -12', buf: mono(kick(true)), params: { pitch: -12 } },
  ];
}

// ---- 1 音ずつ（画面の液晶用。バンク C〜G は必要になったときだけ作る） ----
const abCache: FactorySound[][] = [];
const ab = (b: number) => (abCache[b] ??= factoryBank(b));
/** 工場出荷の音の名前（音は作らない。A・B は作る） */
export const factoryNames = (bank: number): string[] => (bank >= 2 ? genreNames(bank) : ab(bank).map((s) => s.name));
/** 工場出荷の音を 1 つ（パッド番号で） */
export function factorySound(pad: number): FactorySound | null {
  const b = Math.floor(pad / 16), i = pad % 16;
  if (b >= FACTORY_BANKS) return null;
  return b >= 2 ? genreSound(b, i) : ab(b)[i];
}
/** 工場出荷の設定だけ（音は作らない） */
export const factoryPadParams = (pad: number): PadParams => {
  const b = Math.floor(pad / 16), i = pad % 16;
  return { ...defaultPad(), ...(b >= 2 ? genreParams(b, i) : ab(b)[i]?.params) };
};

export const factoryParams = (s: FactorySound): PadParams => ({ ...defaultPad(), ...s.params });
