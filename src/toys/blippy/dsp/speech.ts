// 簡易フォルマント音声合成（8kHz）。安い音声チップの読み上げを真似る。
// 声帯パルス → F1/F2/F3 の共振器（直列）＋ 摩擦ノイズ（並列バンドパス）。
// パラメーターは 10ms ごとの「フレーム」単位で段差状に更新する（LPC チップ風のザラつき）。

import { PHONEMES, VOWELS, type SegDef } from './phonemes';
import { Rng } from '../../../core/rng';

export const CHIP_RATE = 8000;
const FRAME = 80; // 10ms

interface Seg {
  f: [number, number, number];
  av: number;
  af: number;
  fn: number;
  fbw: number;
  asp: number;
  dur: number; // ms
}

export interface SpeakOptions {
  pitch?: number; // 開始時のピッチ Hz
  pitchEnd?: number; // 終了時のピッチ Hz
  rate?: number; // 1 = 標準。大きいほど速い
  seed?: number;
}

/** "K AE T" のような音素列を区間の列に展開する */
function expand(phonemes: string, rate: number): Seg[] {
  const names = phonemes.trim().split(/\s+/).filter(Boolean);
  const defs: SegDef[] = [];
  let lastVowelIdx = -1;
  for (const n of names) {
    const d = PHONEMES[n];
    if (!d) continue;
    if (VOWELS.has(n)) lastVowelIdx = defs.length + d.length - 1;
    for (const s of d) defs.push({ ...s });
  }
  // 最後の母音は少し伸ばす（文末の引き延ばし）
  if (lastVowelIdx >= 0) defs[lastVowelIdx].dur *= 1.45;

  const segs: Seg[] = [];
  let prevF: [number, number, number] = [500, 1500, 2500];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    let f = d.f ?? prevF;
    if (d.next) {
      const nx = defs.slice(i + 1).find((x) => x.f && (x.av ?? 0) > 0.3);
      if (nx?.f) f = nx.f;
    }
    segs.push({
      f: [...f] as [number, number, number],
      av: d.av ?? 0,
      af: d.af ?? 0,
      fn: d.fn ?? 2500,
      fbw: d.fbw ?? 1000,
      asp: d.asp ?? 0,
      dur: d.dur / rate,
    });
    prevF = f;
  }
  return segs;
}

/** Klatt 型の2次共振器（DC ゲイン 1） */
class Resonator {
  a = 1; b = 0; c = 0; y1 = 0; y2 = 0;
  set(freq: number, bw: number): void {
    const r = Math.exp((-Math.PI * bw) / CHIP_RATE);
    this.c = -r * r;
    this.b = 2 * r * Math.cos((2 * Math.PI * freq) / CHIP_RATE);
    this.a = 1 - this.b - this.c;
  }
  tick(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** ピークゲイン 0dB のバンドパス（摩擦ノイズ用） */
class BandPass {
  b0 = 0; b2 = 0; a1 = 0; a2 = 0; x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  set(freq: number, bw: number): void {
    const f = Math.min(freq, CHIP_RATE * 0.47);
    const w = (2 * Math.PI * f) / CHIP_RATE;
    const q = Math.max(0.3, f / bw);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  tick(x: number): number {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// 摩擦ノイズと有声音の音量バランス（scripts/calib.ts で測って決めたした値）
const VOICE_GAIN = 6;
const FRIC_GAIN = 2.0;

/** 音素列を読み上げて 8kHz の波形を返す（ピーク正規化済み、量子化はしない） */
export function speak(phonemes: string, opt: SpeakOptions = {}): Float32Array {
  return normalize(speakRaw(phonemes, opt), 0.92);
}

/** 正規化しない版（レベル調整用） */
export function speakRaw(phonemes: string, opt: SpeakOptions = {}): Float32Array {
  const rate = opt.rate ?? 1;
  const p0 = opt.pitch ?? 190;
  const p1 = opt.pitchEnd ?? p0 * 0.72;
  const rng = new Rng(opt.seed ?? 1);
  const segs = expand(phonemes, rate);
  if (segs.length === 0) return new Float32Array(0);

  const starts: number[] = [];
  let total = 0;
  for (const s of segs) {
    starts.push(total);
    total += s.dur;
  }
  const n = Math.ceil((total / 1000) * CHIP_RATE) + FRAME;
  const out = new Float32Array(n);

  const r1 = new Resonator(), r2 = new Resonator(), r3 = new Resonator();
  const bp = new BandPass();
  let phase = 0, gPrev = 0;
  let av = 0, af = 0, asp = 0; // 平滑化した振幅
  let tAv = 0, tAf = 0, tAsp = 0;
  const smooth = 1 - Math.exp(-1 / (0.003 * CHIP_RATE));
  const oq = 0.6; // 声門開放率
  let seg = 0;
  let f0 = p0;

  for (let i = 0; i < n; i++) {
    if (i % FRAME === 0) {
      // ---- フレーム更新 ----
      const tms = (i / CHIP_RATE) * 1000;
      while (seg < segs.length - 1 && tms >= starts[seg + 1]) seg++;
      const cur = segs[seg];
      const prev = segs[Math.max(0, seg - 1)];
      const u = tms - starts[seg];
      const kf = seg === 0 ? 1 : Math.min(1, u / Math.min(40, cur.dur * 0.5));
      const ka = seg === 0 ? 1 : Math.min(1, u / 12);
      const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
      const done = tms >= total;
      r1.set(lerp(prev.f[0], cur.f[0], kf), 70);
      r2.set(lerp(prev.f[1], cur.f[1], kf), 100);
      r3.set(lerp(prev.f[2], cur.f[2], kf), 150);
      bp.set(cur.fn, cur.fbw);
      tAv = done ? 0 : lerp(prev.av, cur.av, ka);
      tAf = done ? 0 : cur.af;
      tAsp = done ? 0 : cur.asp;
      // ピッチ：開始で少し上がり、あとは下がっていく
      const x = Math.min(1, tms / total);
      const rise = Math.sin(Math.min(1, x * 4) * Math.PI) * 0.06;
      f0 = (p0 + (p1 - p0) * x) * (1 + rise) * (1 + rng.bi() * 0.012);
    }
    av += (tAv - av) * smooth;
    af += (tAf - af) * smooth * 2;
    asp += (tAsp - asp) * smooth;

    // 声帯パルス（二乗余弦）を微分したもの
    phase += f0 / CHIP_RATE;
    if (phase >= 1) phase -= 1;
    const g = phase < oq ? 0.5 * (1 - Math.cos((2 * Math.PI * phase) / oq)) : 0;
    const src = (g - gPrev) * VOICE_GAIN;
    gPrev = g;

    const noise = rng.bi();
    const voiced = r3.tick(r2.tick(r1.tick(src * av + noise * asp * 0.35)));
    const fric = bp.tick(noise) * af * FRIC_GAIN;
    out[i] = voiced + fric;
  }
  return out;
}

export function normalize(buf: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 1e-9) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}
