// エフェクト 24 種（DOM 非依存・ステレオ）。どれもつまみ 4 つ（0〜1）で動く。
// 置き場所は 3 つ：BUS 1・BUS 2（パッドごとに送り先を選ぶ）・MASTER（全体の出口）。
// テンポに合わせるもの（ディレイ・ルーパー・スライサーなど）は、拍の位置（beat）とテンポ（bpm）を受け取る。
import { Rng } from '../../core/rng';

export interface FxCtx {
  sr: number;
  bpm: number;
  /** ブロックの頭の拍（再生中は曲の位置、止まっていても時計で進む） */
  beat: number;
}

export interface Effect {
  process(l: Float32Array, r: Float32Array, n: number, k: number[], c: FxCtx): void;
}

export interface FxDef {
  id: string;
  name: string;
  /** つまみの名前と、表示（k = 0〜1） */
  knobs: [string, (k: number, c: { bpm: number }) => string][];
  def: number[];
  make(sr: number): Effect;
}

// ---------------- 小さな部品 ----------------
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const pct = (k: number) => `${Math.round(k * 100)}%`;
const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${Math.round(f)}Hz`);
const db = (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(1)}dB`;
const stepOf = (k: number, n: number) => Math.min(n - 1, Math.floor(k * n));
const SYNC = [1 / 16, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2, 3 / 4, 1] as const;
/** ↑ 全音符（1 小節）に対する長さ。拍にするときは ×4 */
const SYNC_NAMES = ['1/16', '1/8', '1/8.', '1/4', '1/4.', '1/2', '1/2.', '1 小節'];
const LEN = [0.25, 0.5, 1, 2, 4] as const;
const LEN_NAMES = ['1/16', '1/8', '1/4', '1/2', '1 小節'];
const sat = (x: number) => Math.tanh(x);

/** RBJ の 2 次フィルター（係数は set で） */
class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  z1 = [0, 0]; z2 = [0, 0];
  set(type: 'lp' | 'hp' | 'bp' | 'peak' | 'low' | 'high', f: number, q: number, sr: number, gainDb = 0): void {
    const w = (TAU * clamp(f, 10, sr * 0.45)) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (type) {
      case 'lp': b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'hp': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'peak': b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; break;
      case 'low': {
        const s2 = 2 * Math.sqrt(A) * al;
        b0 = A * (A + 1 - (A - 1) * cs + s2); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - s2);
        a0 = A + 1 + (A - 1) * cs + s2; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - s2; break;
      }
      case 'high': {
        const s2 = 2 * Math.sqrt(A) * al;
        b0 = A * (A + 1 + (A - 1) * cs + s2); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - s2);
        a0 = A + 1 - (A - 1) * cs + s2; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - s2; break;
      }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(c: number, x: number): number {
    // 転置直接形 II
    const y = this.b0 * x + this.z1[c];
    this.z1[c] = this.b1 * x - this.a1 * y + this.z2[c];
    this.z2[c] = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** 1 次のローパス（左右） */
class OnePole {
  y = [0, 0];
  a = 1;
  set(f: number, sr: number): void { this.a = 1 - Math.exp((-TAU * clamp(f, 5, sr * 0.49)) / sr); }
  run(c: number, x: number): number { return (this.y[c] += this.a * (x - this.y[c])); }
}

/** 遅れ（リング・バッファ）。小数の遅れは直線補間で読む */
class Delay {
  buf: Float32Array;
  w = 0;
  constructor(len: number) { this.buf = new Float32Array(Math.max(4, len)); }
  push(x: number): void { this.buf[this.w] = x; this.w = (this.w + 1) % this.buf.length; }
  /** d サンプル前（1 以上） */
  read(d: number): number {
    const L = this.buf.length;
    d = clamp(d, 1, L - 2);
    const p = this.w - d, i = Math.floor(p), f = p - i;
    const a = this.buf[(i + L) % L], b = this.buf[(i + 1 + L) % L];
    return a + (b - a) * f;
  }
  /** 絶対位置 pos（書き込んだ数で数える）を読む */
  at(pos: number): number {
    const L = this.buf.length, i = Math.floor(pos), f = pos - i;
    const a = this.buf[((i % L) + L) % L], b = this.buf[(((i + 1) % L) + L) % L];
    return a + (b - a) * f;
  }
}

/** 過去の音を覚えておく（ルーパー・テープストップ・スキャッター用） */
class History {
  l: Delay; r: Delay;
  count = 0; // 書き込んだ数
  constructor(len: number) { this.l = new Delay(len); this.r = new Delay(len); }
  push(a: number, b: number): void { this.l.push(a); this.r.push(b); this.count++; }
  /** 書き込んだ数で数えた位置 pos の音（直線補間） */
  get(pos: number): [number, number] {
    const back = this.count - pos; // 何サンプル前か
    if (back < 1 || back > this.l.buf.length - 2) return [0, 0];
    return [this.l.read(back), this.r.read(back)];
  }
}

const wet = (dry: number, w: number, mix: number) => dry * (1 - mix) + w * mix;

// ================= エフェクト =================
class FilterDrive implements Effect {
  f = new Biquad();
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const type = stepOf(k[3], 3);
    this.f.set((['lp', 'bp', 'hp'] as const)[type], 20 * Math.pow(1000, k[0]), 0.6 + k[1] * 14, this.sr);
    const g = 1 + k[2] * 24, norm = 1 / Math.max(1, Math.sqrt(g) * 0.8);
    for (let i = 0; i < n; i++) {
      l[i] = sat(this.f.run(0, l[i]) * g) * (k[2] > 0.01 ? norm : 1 / g);
      r[i] = sat(this.f.run(1, r[i]) * g) * (k[2] > 0.01 ? norm : 1 / g);
    }
  }
}

class Isolator implements Effect {
  lo = new OnePole(); hi = new OnePole();
  constructor(private sr: number) { this.lo.set(250, sr); this.hi.set(3000, sr); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const g = (x: number) => (x < 0.5 ? Math.pow(x * 2, 2) : 1 + (x - 0.5) * 3);
    const gl = g(k[0]), gm = g(k[1]), gh = g(k[2]), mix = k[3];
    for (let i = 0; i < n; i++) {
      for (const [c, x] of [[0, l[i]], [1, r[i]]] as const) {
        const low = this.lo.run(c, x), lh = this.hi.run(c, x);
        const high = x - lh, mid = lh - low;
        const y = low * gl + mid * gm + high * gh;
        if (c === 0) l[i] = wet(x, y, mix); else r[i] = wet(x, y, mix);
      }
    }
  }
}

class LoFi implements Effect {
  hold = [0, 0]; cnt = 0; tone = new OnePole();
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const steps = Math.pow(2, 16 - k[0] * 14), every = 1 + Math.floor(k[1] * 31);
    this.tone.set(500 + 19500 * Math.pow(k[2], 2), this.sr);
    for (let i = 0; i < n; i++) {
      if (this.cnt++ % every === 0) { this.hold[0] = Math.round(l[i] * steps) / steps; this.hold[1] = Math.round(r[i] * steps) / steps; }
      l[i] = wet(l[i], this.tone.run(0, this.hold[0]), k[3]);
      r[i] = wet(r[i], this.tone.run(1, this.hold[1]), k[3]);
    }
  }
}

class Vinyl implements Effect {
  rng = new Rng(77); dl = new Delay(4096); dr = new Delay(4096); ph = 0; hp = new Biquad(); lp = new Biquad(); pop = 0;
  constructor(private sr: number) { this.hp.set('hp', 90, 0.7, sr); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    this.lp.set('lp', 3000 + 12000 * (1 - k[2]), 0.7, this.sr);
    const wowD = (0.0008 + 0.004 * k[1]) * this.sr;
    for (let i = 0; i < n; i++) {
      this.ph += (TAU * 0.55) / this.sr;
      const d = 10 + wowD * (1 + Math.sin(this.ph));
      this.dl.push(l[i]); this.dr.push(r[i]);
      // パチパチ（たまに大きいプツッ）とサーッ
      if (this.rng.chance(k[0] * 0.0012)) this.pop = this.rng.bi() * (this.rng.chance(0.1) ? 0.6 : 0.2);
      const cr = this.pop + this.rng.bi() * 0.006 * k[0];
      this.pop *= 0.6;
      const a = this.lp.run(0, this.hp.run(0, this.dl.read(d))) + cr, b = this.lp.run(1, this.hp.run(1, this.dr.read(d))) + cr;
      l[i] = wet(l[i], a, k[3]);
      r[i] = wet(r[i], b, k[3]);
    }
  }
}

class Cassette implements Effect {
  rng = new Rng(78); dl = new Delay(4096); dr = new Delay(4096); p1 = 0; p2 = 0; lp = new Biquad();
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    this.lp.set('lp', 2500 + 15000 * k[3], 0.6, this.sr);
    const depth = k[0] * 0.003 * this.sr, drive = 1 + k[1] * 6;
    for (let i = 0; i < n; i++) {
      this.p1 += (TAU * 0.7) / this.sr; this.p2 += (TAU * 7.3) / this.sr;
      const d = 12 + depth * (1 + 0.8 * Math.sin(this.p1) + 0.2 * Math.sin(this.p2));
      this.dl.push(l[i]); this.dr.push(r[i]);
      const hiss = this.rng.bi() * 0.02 * k[2];
      l[i] = this.lp.run(0, sat(this.dl.read(d) * drive) / Math.sqrt(drive)) + hiss;
      r[i] = this.lp.run(1, sat(this.dr.read(d) * drive) / Math.sqrt(drive)) + hiss;
    }
  }
}

class SyncDelay implements Effect {
  dl: Delay; dr: Delay; tone = new OnePole(); cur = 0;
  constructor(private sr: number) { this.dl = new Delay(sr * 3); this.dr = new Delay(sr * 3); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[], c: FxCtx): void {
    const beats = SYNC[stepOf(k[0], SYNC.length)] * 4; // 1/16 音符〜1 小節 → 拍
    const target = Math.min(this.sr * 2.9, (beats * 60 * this.sr) / c.bpm);
    this.tone.set(800 + 12000 * k[2], this.sr);
    const fb = k[1] * 0.92;
    for (let i = 0; i < n; i++) {
      this.cur += (target - this.cur) * 0.0008; // 時間を変えたときはなめらかに
      const a = this.dl.read(this.cur), b = this.dr.read(this.cur);
      // ピンポン：左の返りは右へ
      this.dl.push(l[i] + this.tone.run(1, b) * fb);
      this.dr.push(r[i] * 0.3 + this.tone.run(0, a) * fb);
      l[i] = wet(l[i], a, k[3]);
      r[i] = wet(r[i], b, k[3]);
    }
  }
}

class TapeEcho implements Effect {
  dl: Delay; dr: Delay; ph = 0; tone = new OnePole(); cur = 0;
  constructor(private sr: number) { this.dl = new Delay(sr); this.dr = new Delay(sr); this.tone.set(3500, sr); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const target = (0.05 + 0.75 * k[0]) * this.sr, fb = k[1] * 1.05;
    for (let i = 0; i < n; i++) {
      this.cur += (target - this.cur) * 0.00025; // 時間を変えるとピッチが動く（テープらしさ）
      this.ph += (TAU * 1.1) / this.sr;
      const d = this.cur * (1 + 0.006 * k[2] * Math.sin(this.ph));
      const a = this.dl.read(d), b = this.dr.read(d);
      this.dl.push(l[i] + sat(this.tone.run(0, a) * fb));
      this.dr.push(r[i] + sat(this.tone.run(1, b) * fb));
      l[i] = wet(l[i], a, k[3]);
      r[i] = wet(r[i], b, k[3]);
    }
  }
}

class Reverb implements Effect {
  combs: { d: Delay; len: number; st: number }[][] = [[], []];
  aps: { d: Delay; len: number }[][] = [[], []];
  lp = new OnePole();
  constructor(private sr: number) {
    const s = sr / 44100;
    for (let c = 0; c < 2; c++) {
      for (const L of [1116, 1188, 1277, 1356, 1422, 1491]) { const len = Math.round((L + c * 23) * s * 1.3); this.combs[c].push({ d: new Delay(len + 4), len, st: 0 }); }
      for (const L of [556, 441, 341]) { const len = Math.round((L + c * 23) * s); this.aps[c].push({ d: new Delay(len + 4), len }); }
    }
  }
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const size = 0.55 + k[0] * 0.45, fb = 0.72 + k[1] * 0.26, damp = 0.15 + 0.7 * (1 - k[2]);
    for (let i = 0; i < n; i++) {
      const x = (l[i] + r[i]) * 0.12;
      for (let c = 0; c < 2; c++) {
        let y = 0;
        for (const cb of this.combs[c]) {
          const o = cb.d.read(cb.len * size);
          cb.st = o * (1 - damp) + cb.st * damp;
          cb.d.push(x + cb.st * fb);
          y += o;
        }
        for (const ap of this.aps[c]) {
          const o = ap.d.read(ap.len);
          ap.d.push(y + o * 0.5);
          y = o - y * 0.5;
        }
        if (c === 0) l[i] = wet(l[i], y, k[3]); else r[i] = wet(r[i], y, k[3]);
      }
    }
  }
}

class Chorus implements Effect {
  dl: Delay; dr: Delay; ph = 0;
  constructor(private sr: number) { this.dl = new Delay(sr * 0.06); this.dr = new Delay(sr * 0.06); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const rate = 0.1 + k[0] * 3, depth = (0.0005 + k[1] * 0.008) * this.sr, base = 0.012 * this.sr, off = k[2] * Math.PI;
    for (let i = 0; i < n; i++) {
      this.ph += (TAU * rate) / this.sr;
      this.dl.push(l[i]); this.dr.push(r[i]);
      const a = this.dl.read(base + depth * (1 + Math.sin(this.ph))), b = this.dr.read(base + depth * (1 + Math.sin(this.ph + off + Math.PI / 2)));
      l[i] = wet(l[i], a, k[3] * 0.7);
      r[i] = wet(r[i], b, k[3] * 0.7);
    }
  }
}

class Flanger implements Effect {
  dl: Delay; dr: Delay; ph = 0; fl = 0; fr = 0;
  constructor(private sr: number) { this.dl = new Delay(sr * 0.02); this.dr = new Delay(sr * 0.02); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const rate = 0.05 + k[0] * 2, depth = (0.0003 + k[1] * 0.005) * this.sr, fb = (k[2] - 0.5) * 1.9;
    for (let i = 0; i < n; i++) {
      this.ph += (TAU * rate) / this.sr;
      const d = 8 + depth * (1 + Math.sin(this.ph)), d2 = 8 + depth * (1 + Math.sin(this.ph + 0.6));
      this.dl.push(l[i] + this.fl * fb); this.dr.push(r[i] + this.fr * fb);
      this.fl = this.dl.read(d); this.fr = this.dr.read(d2);
      l[i] = wet(l[i], (l[i] + this.fl) * 0.6, k[3]);
      r[i] = wet(r[i], (r[i] + this.fr) * 0.6, k[3]);
    }
  }
}

class Phaser implements Effect {
  st = [new Float32Array(6), new Float32Array(6)]; ph = 0; last = [0, 0];
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const rate = 0.05 + k[0] * 3, fb = k[2] * 0.85;
    for (let i = 0; i < n; i++) {
      this.ph += (TAU * rate) / this.sr;
      for (let c = 0; c < 2; c++) {
        const f = 300 + 2500 * k[1] * (0.5 + 0.5 * Math.sin(this.ph + c * 0.4));
        const t = Math.tan((Math.PI * f) / this.sr), a = (t - 1) / (t + 1);
        const x = c === 0 ? l[i] : r[i];
        let y = x + this.last[c] * fb;
        const s = this.st[c];
        for (let j = 0; j < 6; j++) { const o = a * y + s[j]; s[j] = y - a * o; y = o; }
        this.last[c] = y;
        const out = (x + y) * 0.6;
        if (c === 0) l[i] = wet(x, out, k[3]); else r[i] = wet(x, out, k[3]);
      }
    }
  }
}

class Compressor implements Effect {
  env = 0;
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const th = Math.pow(10, (-k[0] * 40) / 20), ratio = 1 + k[1] * 19;
    const att = Math.exp(-1 / (0.003 * this.sr)), rel = Math.exp(-1 / ((0.02 + k[2] * 0.5) * this.sr));
    const mk = Math.pow(10, (k[3] * 20) / 20);
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      this.env = x > this.env ? att * this.env + (1 - att) * x : rel * this.env + (1 - rel) * x;
      const g = this.env > th ? Math.pow(this.env / th, 1 / ratio - 1) : 1;
      l[i] *= g * mk;
      r[i] *= g * mk;
    }
  }
}

class Looper implements Effect {
  h: History; held = false; start = 0; len = 1; pos = 0; fade = 0;
  constructor(private sr: number) { this.h = new History(sr * 9); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[], c: FxCtx): void {
    const on = k[1] > 0.5;
    const rate = k[2] < 0.5 ? Math.pow(2, -2 + 4 * k[2]) : Math.pow(2, (k[2] - 0.5) * 2);
    const rev = k[3] > 0.5;
    if (on && !this.held) {
      // いまから LENGTH 分さかのぼって、くり返す
      this.len = Math.max(64, Math.round(((LEN[stepOf(k[0], LEN.length)] * 60) / c.bpm) * this.sr));
      this.start = this.h.count - this.len;
      this.pos = 0;
    }
    this.held = on;
    for (let i = 0; i < n; i++) {
      this.h.push(l[i], r[i]);
      this.fade = clamp(this.fade + (on ? 1 : -1) / (0.005 * this.sr), 0, 1);
      if (this.fade <= 0) continue;
      const p = rev ? this.len - 1 - this.pos : this.pos;
      const [a, b] = this.h.get(this.start + p);
      this.pos = (this.pos + rate) % this.len;
      l[i] = wet(l[i], a, this.fade);
      r[i] = wet(r[i], b, this.fade);
    }
  }
}

const SLICE_PATTERNS = [
  0b1111111111111111, 0b1010101010101010, 0b1110111011101110, 0b1001001001001001,
  0b1101101101101101, 0b1111000011110000, 0b1011010110110101, 0b1000100010101010,
];
class Slicer implements Effect {
  g = 1;
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[], c: FxCtx): void {
    const step = [0.125, 0.25, 0.5, 1][stepOf(k[0], 4)];
    const pat = SLICE_PATTERNS[stepOf(k[1], 8)];
    const sm = Math.exp(-1 / ((0.001 + k[3] * 0.02) * this.sr));
    const bps = c.bpm / 60 / this.sr;
    for (let i = 0; i < n; i++) {
      const b = c.beat + i * bps;
      const idx = Math.floor(b / step) % 16;
      const on = (pat >> (15 - idx)) & 1;
      const tgt = on ? 1 : 1 - k[2];
      this.g = tgt + (this.g - tgt) * sm;
      l[i] *= this.g;
      r[i] *= this.g;
    }
  }
}

class RingMod implements Effect {
  ph = 0; lph = 0; lp = new OnePole();
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const f0 = 20 * Math.pow(200, k[0]);
    this.lp.set(500 + 15000 * k[2], this.sr);
    for (let i = 0; i < n; i++) {
      this.lph += (TAU * 4 * k[1]) / this.sr;
      const f = f0 * (1 + 0.5 * k[1] * Math.sin(this.lph));
      this.ph += (TAU * f) / this.sr;
      const m = Math.sin(this.ph);
      l[i] = wet(l[i], this.lp.run(0, l[i] * m), k[3]);
      r[i] = wet(r[i], this.lp.run(1, r[i] * m), k[3]);
    }
  }
}

const TREM = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4] as const;
const TREM_NAMES = ['1/32', '1/16', '1/8', '1/4', '1/2', '1 小節'];
class Tremolo implements Effect {
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[], c: FxCtx): void {
    const per = TREM[stepOf(k[0], TREM.length)], pan = k[2] >= 0.5, sq = k[3];
    const bps = c.bpm / 60 / this.sr;
    for (let i = 0; i < n; i++) {
      const ph = ((c.beat + i * bps) / per) * TAU;
      let w = Math.sin(ph);
      w = w * (1 - sq) + Math.sign(w) * sq;
      if (pan) {
        const p = w * k[1];
        l[i] *= Math.min(1, 1 - p);
        r[i] *= Math.min(1, 1 + p);
      } else {
        const g = 1 - k[1] * (0.5 + 0.5 * w);
        l[i] *= g;
        r[i] *= g;
      }
    }
  }
}

class AutoWah implements Effect {
  f = new Biquad(); env = 0; ph = 0; cnt = 0;
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    for (let i = 0; i < n; i++) {
      const x = Math.abs(l[i]) + Math.abs(r[i]);
      this.env += (x - this.env) * (x > this.env ? 0.01 : 0.0005);
      this.ph += (TAU * 4 * k[1]) / this.sr;
      if (this.cnt++ % 16 === 0) {
        const m = clamp(this.env * 4 * k[0] + (k[1] > 0.01 ? 0.5 + 0.5 * Math.sin(this.ph) : 0) * (1 - k[0] * 0.5), 0, 1);
        this.f.set('bp', 300 + 2700 * m, 1 + k[2] * 10, this.sr);
      }
      l[i] = wet(l[i], this.f.run(0, l[i]) * 2, k[3]);
      r[i] = wet(r[i], this.f.run(1, r[i]) * 2, k[3]);
    }
  }
}

class Eq implements Effect {
  lo = new Biquad(); mid = new Biquad(); hi = new Biquad();
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    this.lo.set('low', 120, 0.7, this.sr, (k[0] - 0.5) * 30);
    this.mid.set('peak', 200 * Math.pow(25, k[3]), 1, this.sr, (k[1] - 0.5) * 30);
    this.hi.set('high', 6000, 0.7, this.sr, (k[2] - 0.5) * 30);
    for (let i = 0; i < n; i++) {
      l[i] = this.hi.run(0, this.mid.run(0, this.lo.run(0, l[i])));
      r[i] = this.hi.run(1, this.mid.run(1, this.lo.run(1, r[i])));
    }
  }
}

class Distortion implements Effect {
  tone = new OnePole();
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const g = 1 + k[0] * 60, lvl = 0.2 + k[2] * 1.2;
    this.tone.set(800 + 14000 * k[1], this.sr);
    const d = (x: number) => { const y = x * g; return y > 0 ? sat(y) : sat(y * 0.8) * 1.1; };
    for (let i = 0; i < n; i++) {
      l[i] = wet(l[i], this.tone.run(0, d(l[i])) * lvl, k[3]);
      r[i] = wet(r[i], this.tone.run(1, d(r[i])) * lvl, k[3]);
    }
  }
}

class PitchShift implements Effect {
  dl: Delay; dr: Delay; ph = 0; fbl = 0; fbr = 0;
  constructor(private sr: number) { this.dl = new Delay(sr * 0.2); this.dr = new Delay(sr * 0.2); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const semi = Math.round(-12 + k[0] * 24), ratio = Math.pow(2, semi / 12);
    const W = (0.03 + k[1] * 0.09) * this.sr; // 窓の長さ
    const fb = k[2] * 0.7;
    for (let i = 0; i < n; i++) {
      this.dl.push(l[i] + this.fbl * fb); this.dr.push(r[i] + this.fbr * fb);
      this.ph = (this.ph + (1 - ratio) / W + 1) % 1;
      const p2 = (this.ph + 0.5) % 1;
      const g1 = 1 - Math.abs(2 * this.ph - 1), g2 = 1 - Math.abs(2 * p2 - 1);
      const a = this.dl.read(2 + this.ph * W) * g1 + this.dl.read(2 + p2 * W) * g2;
      const b = this.dr.read(2 + this.ph * W) * g1 + this.dr.read(2 + p2 * W) * g2;
      this.fbl = a; this.fbr = b;
      l[i] = wet(l[i], a, k[3]);
      r[i] = wet(r[i], b, k[3]);
    }
  }
}

class TapeStop implements Effect {
  h: History; stopping = false; pos = 0; rate = 1; fade = 0;
  constructor(private sr: number) { this.h = new History(sr * 4); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const on = k[1] > 0.5;
    if (on && !this.stopping) { this.pos = this.h.count; this.rate = 1; }
    this.stopping = on;
    const dec = 1 / ((0.1 + k[0] * 2.9) * this.sr);
    for (let i = 0; i < n; i++) {
      this.h.push(l[i], r[i]);
      this.fade = clamp(this.fade + (on ? 1 : -1) / (0.004 * this.sr), 0, 1);
      if (this.fade <= 0) continue;
      this.rate = Math.max(0, this.rate - dec);
      this.pos += this.rate;
      const [a, b] = this.h.get(this.pos - 2);
      l[i] = wet(l[i], a * Math.min(1, this.rate * 4), this.fade * k[3]);
      r[i] = wet(r[i], b * Math.min(1, this.rate * 4), this.fade * k[3]);
    }
  }
}

class Scatter implements Effect {
  h: History; rng = new Rng(404); slice = -1; mode = 0; src = 0; len = 1; pos = 0;
  constructor(private sr: number) { this.h = new History(sr * 6); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[], c: FxCtx): void {
    const step = [0.25, 0.5, 1][stepOf(k[0], 3)];
    const bps = c.bpm / 60 / this.sr;
    for (let i = 0; i < n; i++) {
      this.h.push(l[i], r[i]);
      const s = Math.floor((c.beat + i * bps) / step);
      if (s !== this.slice) {
        // 区切りごとに、くじで「前の区切りをくり返す・逆に・半分の速さ」にする
        this.slice = s;
        this.len = Math.round((step * 60 * this.sr) / c.bpm);
        this.mode = this.rng.chance(k[1]) ? 1 + (k[2] < 0.75 ? stepOf(k[2], 3) : this.rng.int(3)) : 0;
        this.src = this.h.count - this.len;
        this.pos = 0;
      }
      if (this.mode === 0) continue;
      const p = this.mode === 2 ? this.len - 1 - this.pos : this.mode === 3 ? this.pos * 0.5 : this.pos;
      const [a, b] = this.h.get(this.src + (p % this.len));
      this.pos++;
      l[i] = wet(l[i], a, k[3]);
      r[i] = wet(r[i], b, k[3]);
    }
  }
}

class Resonator implements Effect {
  dl: Delay; dr: Delay; st = [0, 0];
  constructor(private sr: number) { this.dl = new Delay(sr * 0.05); this.dr = new Delay(sr * 0.05); }
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    const note = 36 + Math.round(k[0] * 48), f = 440 * Math.pow(2, (note - 69) / 12);
    const d = this.sr / f, fb = k[1] * 0.97, damp = 0.1 + 0.8 * (1 - k[2]);
    for (let i = 0; i < n; i++) {
      const a = this.dl.read(d), b = this.dr.read(d * 1.003);
      this.st[0] = a * (1 - damp) + this.st[0] * damp;
      this.st[1] = b * (1 - damp) + this.st[1] * damp;
      this.dl.push(l[i] * 0.4 + this.st[0] * fb);
      this.dr.push(r[i] * 0.4 + this.st[1] * fb);
      l[i] = wet(l[i], a, k[3]);
      r[i] = wet(r[i], b, k[3]);
    }
  }
}

class ToySpeaker implements Effect {
  bp = new Biquad(); env = 0; rng = new Rng(5);
  constructor(private sr: number) {}
  process(l: Float32Array, r: Float32Array, n: number, k: number[]): void {
    this.bp.set('bp', 300 * Math.pow(10, k[0]), 0.9, this.sr);
    const crunch = 1 + k[2] * 20;
    for (let i = 0; i < n; i++) {
      const x = (l[i] + r[i]) * 0.5;
      this.env += (Math.abs(x) - this.env) * 0.01;
      // 大きい音でビビる（ガサガサ）
      const buzz = this.env > 0.15 ? this.rng.bi() * k[1] * this.env * 0.8 : 0;
      let y = this.bp.run(0, x) * 2.5 + buzz;
      y = clamp(y * crunch, -1, 1) / Math.sqrt(crunch);
      l[i] = wet(l[i], y, k[3]);
      r[i] = wet(r[i], y, k[3]);
    }
  }
}

// ================= 一覧 =================
const mix: [string, (k: number) => string] = ['MIX', pct];
export const FX_LIST: FxDef[] = [
  { id: 'filter', name: 'FILTER+DRIVE', def: [0.6, 0.3, 0.2, 0], make: (sr) => new FilterDrive(sr),
    knobs: [['CUTOFF', (k) => hz(20 * Math.pow(1000, k))], ['RESO', pct], ['DRIVE', pct], ['TYPE', (k) => ['LPF', 'BPF', 'HPF'][stepOf(k, 3)]]] },
  { id: 'isolator', name: 'ISOLATOR', def: [0.5, 0.5, 0.5, 1], make: (sr) => new Isolator(sr),
    knobs: [['LOW', (k) => (k < 0.02 ? 'KILL' : pct(k * 2))], ['MID', (k) => (k < 0.02 ? 'KILL' : pct(k * 2))], ['HIGH', (k) => (k < 0.02 ? 'KILL' : pct(k * 2))], mix] },
  { id: 'lofi', name: 'LO-FI', def: [0.5, 0.3, 0.5, 1], make: (sr) => new LoFi(sr),
    knobs: [['BITS', (k) => `${Math.round(16 - k * 14)}bit`], ['RATE', (k) => `1/${1 + Math.floor(k * 31)}`], ['TONE', pct], mix] },
  { id: 'vinyl', name: 'VINYL SIM', def: [0.4, 0.3, 0.4, 1], make: (sr) => new Vinyl(sr),
    knobs: [['NOISE', pct], ['WOW', pct], ['AGE', pct], mix] },
  { id: 'cassette', name: 'CASSETTE SIM', def: [0.4, 0.4, 0.3, 0.5], make: (sr) => new Cassette(sr),
    knobs: [['WOW', pct], ['SATURATE', pct], ['HISS', pct], ['TONE', pct]] },
  { id: 'delay', name: 'SYNC DELAY', def: [0.7, 0.4, 0.6, 0.35], make: (sr) => new SyncDelay(sr),
    knobs: [['TIME', (k) => SYNC_NAMES[stepOf(k, SYNC.length)]], ['FEEDBACK', pct], ['TONE', pct], mix] },
  { id: 'tape', name: 'TAPE ECHO', def: [0.35, 0.5, 0.4, 0.35], make: (sr) => new TapeEcho(sr),
    knobs: [['TIME', (k) => `${Math.round(50 + 750 * k)}ms`], ['FEEDBACK', pct], ['WOBBLE', pct], mix] },
  { id: 'reverb', name: 'REVERB', def: [0.6, 0.6, 0.5, 0.3], make: (sr) => new Reverb(sr),
    knobs: [['SIZE', pct], ['DECAY', pct], ['TONE', pct], mix] },
  { id: 'chorus', name: 'CHORUS', def: [0.3, 0.4, 0.5, 0.6], make: (sr) => new Chorus(sr),
    knobs: [['RATE', (k) => `${(0.1 + k * 3).toFixed(2)}Hz`], ['DEPTH', pct], ['WIDTH', pct], mix] },
  { id: 'flanger', name: 'FLANGER', def: [0.2, 0.6, 0.75, 0.6], make: (sr) => new Flanger(sr),
    knobs: [['RATE', (k) => `${(0.05 + k * 2).toFixed(2)}Hz`], ['DEPTH', pct], ['FEEDBACK', (k) => `${Math.round((k - 0.5) * 190)}%`], mix] },
  { id: 'phaser', name: 'PHASER', def: [0.2, 0.7, 0.5, 0.7], make: (sr) => new Phaser(sr),
    knobs: [['RATE', (k) => `${(0.05 + k * 3).toFixed(2)}Hz`], ['DEPTH', pct], ['FEEDBACK', pct], mix] },
  { id: 'comp', name: 'COMPRESSOR', def: [0.4, 0.3, 0.3, 0.2], make: (sr) => new Compressor(sr),
    knobs: [['THRESH', (k) => db(-k * 40)], ['RATIO', (k) => `${(1 + k * 19).toFixed(1)}:1`], ['RELEASE', (k) => `${Math.round(20 + k * 500)}ms`], ['MAKEUP', (k) => db(k * 20)]] },
  { id: 'looper', name: 'DJ LOOPER', def: [0.5, 0, 0.5, 0], make: (sr) => new Looper(sr),
    knobs: [['LENGTH', (k) => LEN_NAMES[stepOf(k, LEN.length)]], ['HOLD', (k) => (k > 0.5 ? 'LOOP!' : 'OFF')], ['SPEED', (k) => `×${(k < 0.5 ? Math.pow(2, -2 + 4 * k) : Math.pow(2, (k - 0.5) * 2)).toFixed(2)}`], ['REVERSE', (k) => (k > 0.5 ? 'ON' : 'OFF')]] },
  { id: 'slicer', name: 'SLICER', def: [0.3, 0.2, 0.9, 0.2], make: (sr) => new Slicer(sr),
    knobs: [['RATE', (k) => ['1/32', '1/16', '1/8', '1/4'][stepOf(k, 4)]], ['PATTERN', (k) => `P${stepOf(k, 8) + 1}`], ['DEPTH', pct], ['SMOOTH', pct]] },
  { id: 'ring', name: 'RING MOD', def: [0.5, 0, 0.7, 0.5], make: (sr) => new RingMod(sr),
    knobs: [['FREQ', (k) => hz(20 * Math.pow(200, k))], ['WOBBLE', pct], ['TONE', pct], mix] },
  { id: 'tremolo', name: 'TREMOLO/PAN', def: [0.3, 0.7, 0, 0], make: (sr) => new Tremolo(sr),
    knobs: [['RATE', (k) => TREM_NAMES[stepOf(k, TREM.length)]], ['DEPTH', pct], ['MODE', (k) => (k >= 0.5 ? 'PAN' : 'TREM')], ['SHAPE', (k) => (k < 0.1 ? 'SINE' : k > 0.9 ? 'SQUARE' : pct(k))]] },
  { id: 'wah', name: 'AUTO WAH', def: [0.6, 0, 0.5, 0.8], make: (sr) => new AutoWah(sr),
    knobs: [['SENS', pct], ['LFO', (k) => (k < 0.01 ? 'OFF' : `${(4 * k).toFixed(1)}Hz`)], ['RESO', pct], mix] },
  { id: 'eq', name: 'EQ', def: [0.5, 0.5, 0.5, 0.5], make: (sr) => new Eq(sr),
    knobs: [['LOW', (k) => db((k - 0.5) * 30)], ['MID', (k) => db((k - 0.5) * 30)], ['HIGH', (k) => db((k - 0.5) * 30)], ['MID FREQ', (k) => hz(200 * Math.pow(25, k))]] },
  { id: 'dist', name: 'DISTORTION', def: [0.4, 0.5, 0.5, 1], make: (sr) => new Distortion(sr),
    knobs: [['DRIVE', pct], ['TONE', pct], ['LEVEL', pct], mix] },
  { id: 'pitch', name: 'PITCH SHIFT', def: [0.5 + 7 / 24, 0.3, 0, 0.5], make: (sr) => new PitchShift(sr),
    knobs: [['PITCH', (k) => { const s = Math.round(-12 + k * 24); return `${s > 0 ? '+' : ''}${s}`; }], ['WINDOW', (k) => `${Math.round(30 + k * 90)}ms`], ['FEEDBACK', pct], mix] },
  { id: 'tapestop', name: 'TAPE STOP', def: [0.3, 0, 0, 1], make: (sr) => new TapeStop(sr),
    knobs: [['TIME', (k) => `${(0.1 + k * 2.9).toFixed(1)}s`], ['STOP', (k) => (k > 0.5 ? 'STOP!' : 'PLAY')], ['—', () => ''], mix] },
  { id: 'scatter', name: 'SCATTER', def: [0.3, 0.4, 0.8, 1], make: (sr) => new Scatter(sr),
    knobs: [['RATE', (k) => ['1/16', '1/8', '1/4'][stepOf(k, 3)]], ['DEPTH', pct], ['TYPE', (k) => (k >= 0.75 ? 'RANDOM' : ['REPEAT', 'REVERSE', 'HALF'][stepOf(k, 3)])], mix] },
  { id: 'resonator', name: 'RESONATOR', def: [0.5, 0.7, 0.5, 0.5], make: (sr) => new Resonator(sr),
    knobs: [['NOTE', (k) => { const m = 36 + Math.round(k * 48); return `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12]}${Math.floor(m / 12) - 1}`; }], ['FEEDBACK', pct], ['TONE', pct], mix] },
  { id: 'toyspk', name: 'TOY SPEAKER', def: [0.4, 0.5, 0.3, 1], make: (sr) => new ToySpeaker(sr),
    knobs: [['SIZE', (k) => hz(300 * Math.pow(10, k))], ['RATTLE', pct], ['CRUNCH', pct], mix] },
];

/** エフェクトの置き場所の設定 */
export interface FxSlot {
  type: number; // FX_LIST の番号
  on: boolean;
  k: number[];
}
export const defaultSlots = (): FxSlot[] => [
  { type: 7, on: false, k: [...FX_LIST[7].def] }, // BUS 1：REVERB
  { type: 5, on: false, k: [...FX_LIST[5].def] }, // BUS 2：SYNC DELAY
  { type: 1, on: false, k: [...FX_LIST[1].def] }, // MASTER：ISOLATOR
];
export const SLOT_NAMES = ['BUS 1', 'BUS 2', 'MASTER'];
