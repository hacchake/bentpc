// VROOMBOX の音の ROM（8kHz・8bit）：ラジオ 3 局とクラッシュ音。1台目の音声合成・効果音の部品を流用。
import { Rng, hashSeed } from '../../../core/rng';
import { CHIP_RATE, speak } from '../../blippy/dsp/speech';
import { concat, drum, melody, mix, noise, normalize, quantize8, silence, sweep } from '../../blippy/dsp/tones';

export { CHIP_RATE };
const fin = (b: Float32Array) => quantize8(normalize(b, 0.9));
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12, 14];

/** 16 ステップ × bars 小節のポップス（オリジナル。シードで決まる） */
function song(seed: number, bpm: number, lead: 'pulse25' | 'tri' | 'square', bars: number): Float32Array {
  const r = new Rng(seed);
  const stepN = Math.round((60 / bpm / 4) * CHIP_RATE);
  const kick = drum(0, r), snare = drum(1, r), hat = drum(2, r);
  const prog = [0, 5, 3, 4].map((d) => [0, 5, 9, 7][d % 4]); // I - vi - IV - V 風
  const root = 48 + r.int(5);
  const out = new Float32Array(stepN * 16 * bars);
  const add = (b: Float32Array, at: number, g: number) => { for (let i = 0; i < b.length && at + i < out.length; i++) out[at + i] += b[i] * g; };
  let deg = 4;
  for (let bar = 0; bar < bars; bar++) {
    const ch = prog[bar % 4];
    for (let s = 0; s < 16; s++) {
      const at = (bar * 16 + s) * stepN;
      if (s % 4 === 0) add(kick, at, 0.8);
      if (s % 8 === 4) add(snare, at, 0.6);
      if (s % 2 === 0) add(hat, at, 0.25);
      if (s % 4 === 0 || (s % 4 === 3 && r.chance(0.4))) add(melody([[root - 12 + ch, (stepN / CHIP_RATE) * 1000 * 1.8]], { wave: 'square', decay: 120, gate: 1, vol: 0.5 }), at, 0.7);
      if (s % 2 === 0 && r.chance(0.7)) {
        deg = Math.max(0, Math.min(MAJOR.length - 1, deg + r.pick([-2, -1, 1, 1, 2, 0])));
        add(melody([[root + 12 + ch + MAJOR[deg] - (ch > 5 ? 12 : 0), (stepN / CHIP_RATE) * 1000 * 1.9]], { wave: lead, decay: 200, gate: 0.9, vol: 0.45 }), at, 0.6);
      }
    }
  }
  return out;
}

export function makeRadio(seed: number): Float32Array[] {
  const fm1 = fin(song(hashSeed(seed, 'fm1'), 124, 'pulse25', 8));
  const fm2 = fin(song(hashSeed(seed, 'fm2'), 92, 'tri', 8));
  const say = (ph: string, p: number) => speak(ph, { pitch: p, pitchEnd: p * 0.8, seed: 3, rate: 1.05 });
  const talk = concat(
    say('G UH D _ M AO R N IH NG', 130), silence(300),
    say('T R AE F IH K _ IH Z _ S L OW', 125), silence(250),
    say('AA N _ R UW T _ F AY V', 130), silence(400),
    say('N AW _ M Y UW Z IH K', 140), silence(600),
  );
  const am = fin(mix(talk, noise(new Rng(hashSeed(seed, 'am')), (talk.length / CHIP_RATE) * 1000, 1e9, 0.08, 1, 0.3)));
  return [fm1, fm2, am];
}

export function makeCrash(seed: number): Float32Array {
  const r = new Rng(hashSeed(seed, 'crash'));
  const boom = noise(r, 1400, 380, 1, 3, 0.4);
  // 金属のガシャン（倍音の揃っていない音）
  const clang = [310, 447, 689, 1033, 1587].map((f) => sweep(f, f * 0.97, 1200, 'tri', 300 + r.next() * 300, 0.25)).reduce((a, b) => mix(a, b));
  // ガラスのチリチリ
  const glass = new Float32Array(boom.length);
  for (let k = 0; k < 30; k++) {
    const at = Math.floor(r.range(0.1, 0.9) * glass.length);
    const f = r.range(2500, 3800);
    for (let i = 0; i < 300 && at + i < glass.length; i++) glass[at + i] += Math.sin((2 * Math.PI * f * i) / CHIP_RATE) * Math.exp(-i / 60) * 0.5;
  }
  return fin(mix(mix(boom, clang), glass));
}
