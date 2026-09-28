// 音の「ROM」。モードとキーから 8kHz・8bit の波形を作り、キャッシュする。
// 同じシード（＝同じ個体）なら、同じキーは必ず同じ音になる。

import { LETTER_NAMES, PHRASES, WORDS } from './phonemes';
import { Rng, hashSeed } from '../../../core/rng';
import { CHIP_RATE, speak } from './speech';
import {
  concat, correctJingle, drum, gain, melody, quantize8, randomTune, sfx, silence, wrongBuzz, bootSound, normalize,
} from './tones';

export const DRUM_NAMES = ['KICK', 'SNARE', 'HAT', 'OPEN HAT', 'TOM', 'CLAP', 'COWBELL', 'ZAP'];
export const SFX_NAMES = ['LASER', 'BOOM', 'COIN', 'JUMP', 'SIREN', 'RING', 'ROBOT', 'ARPEGGIO', 'FALL', 'CREATURE'];
const PHRASE_POOL = ['HELLO', 'LETS_PLAY', 'PRESS_A_KEY', 'GOOD_JOB', 'TRY_AGAIN', 'WOW', 'WELL_DONE', 'BYE_BYE', 'UH_OH', 'OOPS'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export class SoundBank {
  private cache = new Map<string, Float32Array>();
  readonly voicePitch: number;

  constructor(readonly seed: number) {
    this.voicePitch = 175 + new Rng(hashSeed(seed, 'voice')).int(40);
  }

  private get(key: string, make: () => Float32Array): Float32Array {
    let b = this.cache.get(key);
    if (!b) {
      b = quantize8(normalize(make(), 0.9));
      this.cache.set(key, b);
    }
    return b;
  }

  private rng(...parts: (string | number)[]): Rng {
    return new Rng(hashSeed(this.seed, ...parts));
  }

  say(phonemes: string, pitchMul = 1): Float32Array {
    const p = this.voicePitch * pitchMul;
    return speak(phonemes, { pitch: p, pitchEnd: p * 0.74, seed: hashSeed(this.seed, phonemes) });
  }

  letterName(l: string): Float32Array {
    return this.get(`letter:${l}`, () => this.say(LETTER_NAMES[l]));
  }
  word(l: string): Float32Array {
    return this.get(`word:${l}`, () => this.say(WORDS[l][1], 0.97));
  }
  phrase(name: string, pitchMul = 1.05): Float32Array {
    return this.get(`phrase:${name}:${pitchMul}`, () => this.say(PHRASES[name], pitchMul));
  }
  isFor(l: string): Float32Array {
    return this.get(`isfor:${l}`, () =>
      concat(this.say(LETTER_NAMES[l], 1.05), silence(90), gain(this.say(PHRASES.IS_FOR, 0.95), 0.8), silence(40), this.say(WORDS[l][1])),
    );
  }
  tune(tag: string): Float32Array {
    return this.get(`tune:${tag}`, () => randomTune(this.rng('tune', tag)));
  }
  pianoNote(key: number): { buf: Float32Array; name: string } {
    const midi = 48 + 12 * Math.floor(key / 7) + MAJOR[key % 7];
    const name = NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
    return { name, buf: this.get(`piano:${key}`, () => melody([[midi, 650]], { wave: 'pulse25', decay: 320, gate: 1 })) };
  }
  pianoChord(i: number): Float32Array {
    const roots = [48, 53, 55, 57];
    const r = roots[i % 4];
    const third = i === 3 ? 3 : 4;
    return this.get(`chord:${i}`, () =>
      melody([[r, 90], [r + third, 90], [r + 7, 90], [r + 12, 90], [r + 12 + third, 90], [r + 19, 300]], { wave: 'square', decay: 200, gate: 1 }),
    );
  }
  drum(key: number): Float32Array {
    return this.get(`drum:${key}`, () => drum(key % 8, this.rng('drum', key)));
  }
  drumPattern(i: number): Float32Array {
    // 1小節のパターン（16分 × 16）
    return this.get(`pattern:${i}`, () => {
      const rng = this.rng('pattern', i);
      const stepMs = [125, 110, 140, 95][i % 4];
      const kick = drum(0, this.rng('pk', i)), snare = drum(1, this.rng('ps', i)), hat = drum(2, this.rng('ph', i));
      const steps: Float32Array[] = [];
      const len = Math.round((stepMs / 1000) * CHIP_RATE);
      for (let s = 0; s < 16; s++) {
        const st = new Float32Array(len);
        const add = (b: Float32Array, g: number) => { for (let j = 0; j < Math.min(len, b.length); j++) st[j] += b[j] * g; };
        if (s % 4 === 0 || rng.chance(0.15)) add(kick, 0.9);
        if (s % 8 === 4 || (s > 12 && rng.chance(0.3))) add(snare, 0.7);
        if (s % 2 === 0 || rng.chance(0.3)) add(hat, 0.4);
        steps.push(st);
      }
      return concat(...steps);
    });
  }
  sfx(key: number): Float32Array {
    return this.get(`sfx:${key}`, () => sfx(key % 10, this.rng('sfx', key)));
  }
  correct(withWord: string | null): Float32Array {
    return this.get(`correct:${withWord}`, () => (withWord ? concat(correctJingle(), silence(60), this.say(PHRASES[withWord], 1.12)) : correctJingle()));
  }
  wrong(withWord: string | null): Float32Array {
    return this.get(`wrong:${withWord}`, () => (withWord ? concat(wrongBuzz(), silence(60), this.say(PHRASES[withWord], 0.9)) : wrongBuzz()));
  }
  quizQuestion(l: string): Float32Array {
    return this.get(`quiz:${l}`, () => concat(this.say(PHRASES.FIND, 1.1), silence(120), this.say(WORDS[l][1], 1.05)));
  }
  boot(): Float32Array {
    return this.get('boot', () => concat(gain(bootSound(), 0.8), silence(120), this.say(PHRASES.HELLO, 1.15)));
  }
  /** モードごとの機能キー用フレーズ */
  modePhrase(mode: number): string {
    return this.rng('phrase', mode).pick(PHRASE_POOL);
  }
  modeSfx(mode: number): number {
    return this.rng('fsfx', mode).int(10);
  }
  /** ドレミの数字キー（1〜10 = ド〜ミ） */
  numberNote(i: number): Float32Array {
    const midi = 72 + 12 * Math.floor(i / 7) + MAJOR[i % 7];
    return this.get(`num:${i}`, () => melody([[midi, 380]], { wave: 'square', decay: 260, gate: 1, vol: 0.6 }));
  }
  blip(): Float32Array {
    return this.get('blip', () => melody([[96, 30]], { wave: 'square', gate: 1, vol: 0.5 }));
  }
}
