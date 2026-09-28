// SPIN-TOT の音の ROM（8kHz・8bit）。ディスクの音 21 種、パッドの音 10 セット×6、ドラムキット、ベース。
// 1台目の音声合成・効果音の部品を流用している。

import { Rng, hashSeed } from '../../../core/rng';
import { CHIP_RATE, speak } from '../../blippy/dsp/speech';
import { concat, drum, gain, melody, mix, noise, normalize, quantize8, randomTune, sfx, silence, sweep, warble } from '../../blippy/dsp/tones';

export { CHIP_RATE };

const fin = (b: Float32Array) => quantize8(normalize(b, 0.9));
const say = (ph: string, pitch = 150, seed = 1) => speak(ph, { pitch, pitchEnd: pitch * 0.8, seed, rate: 0.95 });

export const DISC_NAMES = [
  'AAH', 'FRESH', 'YEAH', 'HEY', 'GO', 'ONE TWO', 'D J', 'HORNS', 'HIT', 'SIREN', 'LASER', 'DROP', 'BREAK', 'RIFF',
  'WICKY', 'BOOM', 'OH YEAH', 'PARTY', 'CRACKLE', 'AIR HORN', 'CHECK IT',
] as const;

/** ディスク（スクラッチ）用の音 21 種 */
export function makeDiscSounds(seed: number): Float32Array[] {
  const r = (i: number) => new Rng(hashSeed(seed, 'disc', i));
  const saws = (notes: number[], ms: number, decay: number) =>
    notes.map((n) => melody([[n, ms]], { wave: 'saw', decay, gate: 1, vol: 0.5 })).reduce((a, b) => mix(a, b));
  const list: (() => Float32Array)[] = [
    () => say('AA AA AA', 170),
    () => say('F R EH SH', 150),
    () => say('Y EH AX', 160),
    () => say('H EY', 170),
    () => say('G OW', 150),
    () => concat(say('W AH N', 160), silence(80), say('T UW', 170)),
    () => concat(say('D IY', 150), silence(60), say('JH EY', 160)),
    () => saws([60, 64, 67], 450, 250),
    () => mix(noise(r(8), 500, 90, 0.9, 1, 0.2), saws([48, 55, 60, 64], 500, 180)),
    () => warble(700, 0.3, 2.5, 900, 'square'),
    () => sweep(3000, 200, 300, 'square'),
    () => sweep(260, 30, 900, 'tri', 0, 1),
    () => {
      // 1 小節のブレイクビーツ（125ms × 8）
      const k = drum(0, r(12)), sn = drum(1, r(12));
      const step = (x: Float32Array | null) => { const o = new Float32Array(1000); if (x) o.set(x.subarray(0, 1000)); return o; };
      return concat(...[k, null, sn, null, k, k, sn, null].map(step));
    },
    () => randomTune(r(13)),
    () => say('W IH K IY', 170),
    () => say('B UW M', 120),
    () => concat(say('OW', 150), silence(40), say('Y EH', 170)),
    () => say('P AA R T IY', 160),
    () => { const n = noise(r(18), 900, 5000, 0.1, 1, 0); const rr = r(18); for (let i = 0; i < 40; i++) { const p = rr.int(n.length - 20); for (let j = 0; j < 12; j++) n[p + j] += (rr.next() - 0.5) * 1.5 * (1 - j / 12); } return n; },
    () => saws([70, 70.3, 69.7], 700, 0),
    () => concat(say('CH EH K', 160), silence(50), say('IH T', 170)),
  ];
  return list.map((f) => fin(f()));
}

/** SOUND EFFECT パッドの音：10 セット × 6 */
export function makePadSounds(seed: number): Float32Array[][] {
  const r = (b: number, p: number) => new Rng(hashSeed(seed, 'pad', b, p));
  const banks: ((p: number) => Float32Array)[] = [
    (p) => drum([0, 1, 2, 5, 4, 6][p], r(0, p)),
    (p) => sfx(p, r(1, p)),
    (p) => sfx(p + 4, r(2, p)),
    (p) => say(['H EY', 'Y OW', 'H UW', 'OW', 'AH', 'W AW'][p], 170, p),
    (p) => melody([[[36, 38, 41, 43, 46, 48][p], 400]], { wave: 'square', decay: 220, gate: 1 }),
    (p) => { const root = [60, 62, 65, 67, 69, 72][p]; return [0, 4, 7].map((d) => melody([[root + d, 300]], { wave: 'pulse25', decay: 150, gate: 1, vol: 0.4 })).reduce((a, b) => mix(a, b)); },
    (p) => drum([0, 1, 3, 5, 7, 4][p], r(6, p)),
    (p) => sweep([200, 3000, 80, 1500, 600, 4000][p], [3000, 100, 1200, 90, 2400, 50][p], 400 + p * 60, p % 2 ? 'square' : 'tri'),
    (p) => say(['W AH N', 'T UW', 'TH R IY', 'F AO R', 'F AY V', 'S IH K S'][p], 160, p),
    (p) => { const b = sfx((p * 3) % 10, r(9, p)).reverse(); return b; },
  ];
  return banks.map((make) => [0, 1, 2, 3, 4, 5].map((p) => fin(make(p))));
}

export interface DrumKit {
  kick: Float32Array;
  snare: Float32Array;
  hat: Float32Array;
  open: Float32Array;
  clap: Float32Array;
  bass: Float32Array; // MIDI 36（C2）の 1 音。速さを変えて音程を作る
  zap: Float32Array;
}

export function makeKit(seed: number, variant: number): DrumKit {
  const r = (k: string) => new Rng(hashSeed(seed, 'kit', variant, k));
  return {
    kick: fin(drum(0, r('k'))),
    snare: fin(drum(1, r('s'))),
    hat: fin(drum(2, r('h'))),
    open: fin(drum(3, r('o'))),
    clap: fin(drum(5, r('c'))),
    bass: fin(melody([[36, 420]], { wave: variant % 2 ? 'saw' : 'square', decay: 260, gate: 1 })),
    zap: fin(drum(7, r('z'))),
  };
}

export { gain };
