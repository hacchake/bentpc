// おもちゃPCの「ファームウェア」。電源・起動・モード・キー・クイズ・壊れたキーを管理する。
// 鳴らす音（SoundBank の波形）と、液晶に出す内容（DisplayState）を決めるだけで、
// 音の再生そのものは chip（再生回路）が行う。DOM には依存しない。

import { LETTER_KEYS, KEY_COUNT } from '../params';
import { WORDS } from './phonemes';
import { Rng, hashSeed } from './rng';
import { DRUM_NAMES, SFX_NAMES, SoundBank } from './soundbank';

export type Screen = 'off' | 'boot' | 'idle' | 'key' | 'quiz';

export interface DisplayState {
  screen: Screen;
  mode: number;
  big?: string; // 大きく出す文字（'K' や 'C4'）
  sprite?: string; // ドット絵の名前（'K'〜'Z'、'NOTE'、'DRUM'、'STAR' など）
  text?: string; // 下の行の文字
  mark?: 'ok' | 'ng' | 'q' | 'dead';
}

export interface PlayRequest {
  buf: Float32Array;
  key: number; // どのキーの音か（-1 = システム音）
}

export class Firmware {
  bank: SoundBank;
  powered = false;
  booting = false;
  mode = 0;
  display: DisplayState = { screen: 'off', mode: 0 };
  displayVersion = 0;
  /** モードごとの、音が出ないキー */
  deadKeys: Set<number>[] = [];
  private quizTarget = 0;
  private pendingAfterSound: (() => PlayRequest | null) | null = null;
  private rng: Rng;

  constructor(readonly seed: number) {
    this.bank = new SoundBank(seed);
    this.rng = new Rng(hashSeed(seed, 'firmware'));
    // 魔改造の代償：モードごとに 2〜3 個のキーが死んでいる
    for (let m = 0; m < 8; m++) {
      const r = new Rng(hashSeed(seed, 'dead', m));
      const n = 2 + r.int(2);
      const s = new Set<number>();
      while (s.size < n) s.add(r.int(KEY_COUNT));
      this.deadKeys.push(s);
    }
  }

  private show(d: Omit<DisplayState, 'mode'>): void {
    this.display = { ...d, mode: this.mode };
    this.displayVersion++;
  }

  powerOn(): PlayRequest | null {
    if (this.powered) return null;
    this.powered = true;
    this.booting = true;
    this.show({ screen: 'boot' });
    this.pendingAfterSound = () => {
      this.booting = false;
      return this.enterMode();
    };
    return { buf: this.bank.boot(), key: -1 };
  }

  powerOff(): void {
    this.powered = false;
    this.booting = false;
    this.pendingAfterSound = null;
    this.show({ screen: 'off' });
  }

  setMode(m: number): PlayRequest | null {
    if (m === this.mode) return null;
    this.mode = m;
    if (!this.powered || this.booting) {
      this.display = { ...this.display, mode: m };
      this.displayVersion++;
      return null;
    }
    this.pendingAfterSound = null;
    const r = this.enterMode();
    return r ?? { buf: this.bank.blip(), key: -1 };
  }

  private enterMode(): PlayRequest | null {
    if (this.mode === 6) return this.newQuestion();
    this.show({ screen: 'idle', text: 'PRESS A KEY' });
    return null;
  }

  private newQuestion(): PlayRequest {
    let t = this.rng.int(26);
    if (t === this.quizTarget) t = (t + 1 + this.rng.int(25)) % 26;
    this.quizTarget = t;
    return this.askQuestion();
  }

  private askQuestion(): PlayRequest {
    const l = LETTER_KEYS[this.quizTarget];
    this.show({ screen: 'quiz', sprite: l, big: '?', text: 'FIND IT!', mark: 'q' });
    return { buf: this.bank.quizQuestion(l), key: -1 };
  }

  /** 再生中の音が終わったときに chip から呼ばれる */
  onSoundEnd(): PlayRequest | null {
    const f = this.pendingAfterSound;
    this.pendingAfterSound = null;
    return f ? f() : null;
  }

  press(key: number): PlayRequest | null {
    if (!this.powered || this.booting) return null;
    this.pendingAfterSound = null;
    const isLetter = key < 26;
    const l = isLetter ? LETTER_KEYS[key] : '';
    const fk = key - 26; // 機能キー番号 0..3

    if (this.deadKeys[this.mode].has(key)) {
      // 音は出ないが、液晶だけは反応する（配線が切れている）
      this.show({ screen: 'key', big: isLetter ? l : ['♪', '?', '★', 'OK'][fk], mark: 'dead', text: '' });
      return null;
    }

    const b = this.bank;
    const play = (buf: Float32Array): PlayRequest => ({ buf, key });

    switch (this.mode) {
      case 0: // ABC：文字の読み上げ
      case 1: // WORD：単語
      case 7: // SAY：「K IS FOR KING」
        if (isLetter) {
          const w = WORDS[l][0];
          if (this.mode === 0) { this.show({ screen: 'key', big: l, sprite: l, text: w }); return play(b.letterName(l)); }
          if (this.mode === 1) { this.show({ screen: 'key', big: l, sprite: l, text: w }); return play(b.word(l)); }
          this.show({ screen: 'key', big: l, sprite: l, text: `${l} IS FOR ${w}` });
          return play(b.isFor(l));
        }
        return this.genericFunction(fk, key);

      case 2: // TUNE：メロディ
        if (isLetter) { this.show({ screen: 'key', big: l, sprite: 'NOTE', text: 'MELODY ' + l }); return play(b.tune(l)); }
        return this.genericFunction(fk, key);

      case 3: { // PIANO
        if (isLetter) {
          const n = b.pianoNote(key);
          this.show({ screen: 'key', big: n.name, sprite: 'NOTE', text: 'PIANO' });
          return play(n.buf);
        }
        this.show({ screen: 'key', big: ['C', 'F', 'G', 'Am'][fk], sprite: 'NOTE', text: 'CHORD' });
        return play(b.pianoChord(fk));
      }

      case 4: // DRUM
        if (isLetter) { this.show({ screen: 'key', big: l, sprite: 'DRUM', text: DRUM_NAMES[key % 8] }); return play(b.drum(key)); }
        this.show({ screen: 'key', big: ['♪', '?', '★', 'OK'][fk], sprite: 'DRUM', text: 'BEAT ' + (fk + 1) });
        return play(b.drumPattern(fk));

      case 5: // SFX
        if (isLetter) { this.show({ screen: 'key', big: l, sprite: 'STAR', text: SFX_NAMES[key % 10] }); return play(b.sfx(key)); }
        return this.genericFunction(fk, key);

      case 6: { // QUIZ
        if (isLetter) {
          if (key === this.quizTarget) {
            this.show({ screen: 'quiz', big: l, sprite: l, text: 'RIGHT!', mark: 'ok' });
            this.pendingAfterSound = () => this.newQuestion();
            return play(b.correct('RIGHT'));
          }
          this.show({ screen: 'quiz', big: l, sprite: LETTER_KEYS[this.quizTarget], text: 'NO!', mark: 'ng' });
          this.pendingAfterSound = () => { this.show({ screen: 'quiz', sprite: LETTER_KEYS[this.quizTarget], big: '?', text: 'FIND IT!', mark: 'q' }); return null; };
          return play(b.wrong(this.rng.chance(0.5) ? 'NO' : 'TRY_AGAIN'));
        }
        if (fk === 0) return this.askQuestion();
        if (fk === 1) return this.newQuestion();
        if (fk === 2) {
          const t = LETTER_KEYS[this.quizTarget];
          this.show({ screen: 'quiz', big: t, sprite: t, text: 'HINT', mark: 'q' });
          return play(b.letterName(t));
        }
        this.show({ screen: 'quiz', big: 'OK', sprite: 'STAR', text: 'GOOD JOB', mark: 'ok' });
        return play(b.correct('GOOD_JOB'));
      }
    }
    return null;
  }

  /** ABC/WORD/TUNE/SFX/SAY モードの機能キー */
  private genericFunction(fk: number, key: number): PlayRequest {
    const b = this.bank;
    switch (fk) {
      case 0:
        this.show({ screen: 'key', big: '♪', sprite: 'NOTE', text: 'MUSIC' });
        return { buf: b.tune('F' + this.mode), key };
      case 1: {
        const p = b.modePhrase(this.mode);
        this.show({ screen: 'key', big: '?', sprite: 'SPEAKER', text: p.replace(/_/g, ' ') });
        return { buf: b.phrase(p), key };
      }
      case 2: {
        const k = b.modeSfx(this.mode);
        this.show({ screen: 'key', big: '★', sprite: 'STAR', text: SFX_NAMES[k] });
        return { buf: b.sfx(100 + k), key };
      }
      default:
        this.show({ screen: 'key', big: 'OK', sprite: 'STAR', text: 'GOOD JOB', mark: 'ok' });
        return { buf: b.correct('GOOD_JOB'), key };
    }
  }
}
