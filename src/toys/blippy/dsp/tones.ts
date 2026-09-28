// 矩形波メロディ・効果音・ドラムなど、音声以外の音を 8kHz で作る。
// すべて Float32Array（-1..1）を返し、乱数はすべて引数の Rng から取る。

import { Rng } from '../../../core/rng';
import { CHIP_RATE, normalize } from './speech';

const ms2n = (ms: number) => Math.max(1, Math.round((ms / 1000) * CHIP_RATE));
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function silence(ms: number): Float32Array {
  return new Float32Array(ms2n(ms));
}

export function concat(...bufs: Float32Array[]): Float32Array {
  const out = new Float32Array(bufs.reduce((s, b) => s + b.length, 0));
  let o = 0;
  for (const b of bufs) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

export function gain(buf: Float32Array, g: number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

// ---- 基本波形 ----
type Wave = 'square' | 'pulse25' | 'pulse12' | 'tri' | 'saw';
function osc(wave: Wave, ph: number): number {
  switch (wave) {
    case 'square': return ph < 0.5 ? 1 : -1;
    case 'pulse25': return ph < 0.25 ? 1 : -1;
    case 'pulse12': return ph < 0.125 ? 1 : -1;
    case 'tri': return ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
    case 'saw': return ph * 2 - 1;
  }
}

export interface NoteOpts {
  wave?: Wave;
  decay?: number; // 1音の減衰時間（ms）。0 なら減衰しない
  gate?: number; // 音符長のうち鳴らす割合
  vol?: number;
}

/** 音符列 [MIDIノート番号 or null(休符), 長さms] を矩形波で鳴らす */
export function melody(seq: [number | null, number][], o: NoteOpts = {}): Float32Array {
  const wave = o.wave ?? 'square';
  const gate = o.gate ?? 0.85;
  const vol = o.vol ?? 0.7;
  const parts: Float32Array[] = [];
  for (const [m, ms] of seq) {
    const b = new Float32Array(ms2n(ms));
    if (m !== null) {
      const f = mtof(m);
      const on = Math.floor(b.length * gate);
      let ph = 0;
      for (let i = 0; i < on; i++) {
        ph = (ph + f / CHIP_RATE) % 1;
        const t = (i / CHIP_RATE) * 1000;
        const env = o.decay ? Math.exp(-t / o.decay) : 1;
        b[i] = osc(wave, ph) * env * vol;
      }
    }
    parts.push(b);
  }
  return concat(...parts);
}

/** ピッチが f0 → f1 に変化する音（指数カーブ） */
export function sweep(f0: number, f1: number, ms: number, wave: Wave = 'square', decay = 0, vol = 0.7): Float32Array {
  const n = ms2n(ms);
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const f = f0 * Math.pow(f1 / f0, x);
    ph = (ph + f / CHIP_RATE) % 1;
    const env = decay ? Math.exp(-((i / CHIP_RATE) * 1000) / decay) : 1 - x * 0.3;
    b[i] = osc(wave, ph) * env * vol;
  }
  return b;
}

/** ノイズ。lp は 0..1（1 に近いほどこもる）、hold はサンプル保持数（大きいほど荒く低い） */
export function noise(rng: Rng, ms: number, decay: number, vol = 0.7, hold = 1, lp = 0): Float32Array {
  const n = ms2n(ms);
  const b = new Float32Array(n);
  let v = 0, y = 0;
  for (let i = 0; i < n; i++) {
    if (i % hold === 0) v = rng.bi();
    y = y * lp + v * (1 - lp);
    b[i] = y * Math.exp(-((i / CHIP_RATE) * 1000) / decay) * vol;
  }
  return b;
}

/** 2つの音を足し合わせる（長い方に合わせる） */
export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  out.set(a);
  for (let i = 0; i < b.length; i++) out[i] += b[i];
  return out;
}

/** 振動（ビブラート／サイレン）つきの音 */
export function warble(base: number, depth: number, rateHz: number, ms: number, wave: Wave = 'square', vol = 0.6): Float32Array {
  const n = ms2n(ms);
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / CHIP_RATE;
    const f = base * (1 + depth * Math.sin(2 * Math.PI * rateHz * t));
    ph = (ph + f / CHIP_RATE) % 1;
    b[i] = osc(wave, ph) * vol * Math.min(1, (n - i) / 200);
  }
  return b;
}

// ---- 決まった音 ----

/** 正解音（ピンポーン） */
export function correctJingle(): Float32Array {
  return melody([[88, 140], [84, 380]], { decay: 260, gate: 1, wave: 'pulse25' });
}

/** 不正解音（ブッブー） */
export function wrongBuzz(): Float32Array {
  return concat(
    melody([[40, 170]], { wave: 'square', gate: 0.8, vol: 0.8 }),
    melody([[40, 420]], { wave: 'square', gate: 0.9, vol: 0.8 }),
  );
}

/** 起動音 */
export function bootSound(): Float32Array {
  return melody(
    [[72, 70], [76, 70], [79, 70], [84, 70], [88, 70], [91, 90], [null, 40], [96, 320]],
    { wave: 'pulse25', decay: 180, gate: 0.9, vol: 0.6 },
  );
}

/** 電源オフ音 */
export function powerOffSound(): Float32Array {
  return sweep(900, 60, 260, 'square', 0, 0.5);
}

// ---- シード付きで作る音 ----
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENTA = [0, 2, 4, 7, 9];

/** 短いメロディ（TUNE モードなど） */
export function randomTune(rng: Rng): Float32Array {
  const scale = rng.chance(0.6) ? PENTA : MAJOR;
  const root = 60 + rng.int(7);
  const len = 4 + rng.int(5);
  const step = rng.pick([110, 130, 150, 180]);
  const seq: [number | null, number][] = [];
  let deg = rng.int(scale.length);
  for (let i = 0; i < len; i++) {
    deg = Math.max(0, Math.min(scale.length * 2 - 1, deg + rng.pick([-2, -1, 1, 1, 2, 0, 3])));
    const note = root + 12 * Math.floor(deg / scale.length) + scale[deg % scale.length];
    const dur = rng.chance(0.2) ? step * 2 : step;
    seq.push([rng.chance(0.08) && i > 0 ? null : note, dur]);
  }
  seq.push([root + 12, step * 3]);
  return melody(seq, { wave: rng.pick(['square', 'pulse25', 'pulse12'] as const), decay: rng.pick([0, 120, 250]), gate: 0.8 });
}

/** ドラム音。kind で種類、rng で細部を変える */
export function drum(kind: number, rng: Rng): Float32Array {
  switch (kind % 8) {
    case 0: // キック
      return sweep(rng.range(140, 200), rng.range(35, 55), rng.range(160, 260), 'tri', rng.range(80, 140), 1);
    case 1: // スネア
      return mix(noise(rng, 200, rng.range(50, 90), 0.8, 1, 0.1), sweep(rng.range(180, 240), 150, 80, 'tri', 40, 0.5));
    case 2: // クローズハット
      return noise(rng, 70, rng.range(12, 25), 0.6, 1, 0);
    case 3: // オープンハット
      return noise(rng, 300, rng.range(80, 140), 0.5, 1, 0);
    case 4: // タム
      return sweep(rng.range(120, 300), rng.range(70, 120), 260, 'tri', 110, 0.9);
    case 5: // クラップ
      return concat(noise(rng, 12, 8, 0.7), noise(rng, 12, 8, 0.7), noise(rng, 180, 60, 0.7, 1, 0.2));
    case 6: // カウベル
      return mix(melody([[rng.int(4) + 80, 180]], { wave: 'square', decay: 60, gate: 1, vol: 0.4 }), melody([[rng.int(4) + 86, 180]], { wave: 'square', decay: 60, gate: 1, vol: 0.3 }));
    default: // ザップ
      return sweep(rng.range(1500, 3000), rng.range(60, 200), rng.range(60, 160), 'square', 0, 0.6);
  }
}

/** 効果音（SFX モード） */
export function sfx(kind: number, rng: Rng): Float32Array {
  switch (kind % 10) {
    case 0: // レーザー
      return sweep(rng.range(2000, 3500), rng.range(150, 400), rng.range(150, 300), rng.pick(['square', 'pulse25'] as const));
    case 1: // 爆発
      return noise(rng, 700, rng.range(180, 320), 0.9, 2 + rng.int(4), 0.3);
    case 2: { // コイン
      const a = 80 + rng.int(6);
      return melody([[a, 70], [a + 5, 300]], { wave: 'pulse25', decay: 150, gate: 1 });
    }
    case 3: // ジャンプ
      return sweep(rng.range(200, 400), rng.range(800, 1400), rng.range(150, 250), 'square');
    case 4: // サイレン
      return warble(rng.range(600, 900), 0.25, rng.range(1.5, 3), 900, 'square');
    case 5: { // 電話のベル
      const f = rng.range(900, 1300);
      return concat(warble(f, 0.1, 18, 350, 'square', 0.5), silence(80), warble(f, 0.1, 18, 350, 'square', 0.5));
    }
    case 6: { // ロボット歩き
      const parts: Float32Array[] = [];
      for (let i = 0; i < 4; i++) parts.push(sweep(rng.range(100, 300), rng.range(60, 90), 80, 'square', 40), silence(60));
      return concat(...parts);
    }
    case 7: { // アルペジオ
      const r = 60 + rng.int(12);
      const up = rng.chance(0.5);
      const seq: [number, number][] = [0, 4, 7, 12, 16, 19, 24].map((d) => [r + (up ? d : 24 - d), 45]);
      return melody(seq, { wave: 'pulse12', gate: 1 });
    }
    case 8: // 落下
      return sweep(rng.range(1500, 2500), rng.range(80, 150), rng.range(500, 800), 'tri', 0, 0.8);
    default: // 変な鳴き声（ビブラートつき鼻歌）
      return warble(rng.range(300, 600), rng.range(0.05, 0.2), rng.range(5, 9), 500, rng.pick(['saw', 'pulse25'] as const), 0.6);
  }
}

/** 8bit 相当に量子化する（音声チップの DAC を真似る） */
export function quantize8(buf: Float32Array): Float32Array {
  for (let i = 0; i < buf.length; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    buf[i] = Math.round(v * 127) / 127;
  }
  return buf;
}

export { normalize };
