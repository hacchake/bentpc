// SPIN-TOT DJ-28 の DSP エンジン（おもちゃ1台分）。DOM・Web Audio に依存しない。
// 音はすべて 8kHz の波形 ROM を「クロック」で読む（補間なし）。クロックは PITCH・光センサー・STOP で変わる。
// 流れ：[リズム＋ベース]×RHYTHM VOL ＋ [パッド]×SFX VOL ＋ ディスク ＋ 鍵盤 ＋ FEEDBACK → DIST → DIST2 → 音量

import { defaultsOf } from '../../../core/params';
import { Rng, hashSeed } from '../../../core/rng';
import type { ToyEngine, ToyStatus } from '../../../core/toy';
import {
  DJ_DISC_TOUCH, DJ_FIRST_NOTE, DJ_INDEX, DJ_NOTE_COUNT, DJ_PAD, DJ_PARAMS, DJ_PAUSE, DJ_PLAY, DJ_TEMPO_DOWN, DJ_TEMPO_UP, type DjParamId,
} from '../params';
import { makePattern, type DjPattern } from './rhythm';
import { CHIP_RATE, makeDiscSounds, makeKit, makePadSounds, type DrumKit } from './sounds';
import { KeySynth } from './synth';

export const DJ_SEED = 0xd15c0da;

const BUS_RHYTHM = 0;
const BUS_SFX = 1;

interface SVoice {
  buf: Float32Array;
  pos: number;
  rate: number; // 1 = 普通の速さ（負なら逆再生）
  gain: number;
  bus: number;
}

export interface DjDisplay {
  text: string;
}

export class DjEngine implements ToyEngine<DjDisplay> {
  readonly params = defaultsOf(DJ_PARAMS);
  readonly paramDefs = DJ_PARAMS;
  powered = false;
  private rng: Rng;
  private discs: Float32Array[];
  private pads: Float32Array[][];
  private kits: DrumKit[];
  private patterns: DjPattern[] = [];
  private voices: SVoice[] = [];
  private synth: KeySynth;
  // リズム
  playing = false;
  private step = 0;
  private phase = 0;
  private tempoOffset = 0;
  private arpPhase = 0;
  private beatLed = 0;
  // ディスク
  private discPos = 0;
  private discVel = 0;
  private touched = false;
  // STOP（移動停止）：クロックがテープのように止まる
  private haltMul = 1;
  // FEEDBACK
  private fbBuf: Float32Array;
  private fbPos = 0;
  private fbPh = 0;
  // 出力段
  private vol = 0;
  private gate = 0;
  private dcX = 0;
  private dcY = 0;
  private held = 0;
  private holdCnt = 0;
  display: DjDisplay = { text: '' };
  displayVersion = 0;

  constructor(readonly sampleRate: number, readonly seed = DJ_SEED) {
    this.rng = new Rng(hashSeed(seed, 'dj'));
    this.discs = makeDiscSounds(seed);
    this.pads = makePadSounds(seed);
    this.kits = [0, 1, 2, 3].map((v) => makeKit(seed, v));
    this.synth = new KeySynth(sampleRate, new Rng(hashSeed(seed, 'keys')));
    this.fbBuf = new Float32Array(Math.ceil(sampleRate * 0.05));
  }

  private pattern(id: number): DjPattern {
    return (this.patterns[id] ??= makePattern(this.seed, id));
  }

  p(id: DjParamId): number {
    return this.params[DJ_INDEX[id]];
  }

  private show(text: string): void {
    this.display = { text };
    this.displayVersion++;
  }

  setParam(index: number, value: number): void {
    const def = DJ_PARAMS[index];
    if (!def) return;
    const v = Math.max(def.min, Math.min(def.max, def.kind === 'continuous' ? value : Math.round(value)));
    const old = this.params[index];
    this.params[index] = v;
    if (v === old || !this.powered) return;
    const two = (n: number) => String(n).padStart(2, '0');
    switch (def.id) {
      case 'rhythm': this.show(`r${two(v + 1)}`); this.tempoOffset = 0; break;
      case 'discFx': this.show(`d${two(v + 1)}`); break;
      case 'sfxBank': this.show(`E${two(v + 1)}`); break;
      case 'instrument': this.show(`i${two(v + 1)}`); break;
    }
  }

  setParamById(id: DjParamId, v: number): void {
    this.setParam(DJ_INDEX[id], v);
  }

  powerOn(): void {
    if (this.powered) return;
    this.powered = true;
    this.show('HI');
    this.trigger(this.discs[3], 1, 0.8, BUS_SFX); // 「HEY」
  }

  powerOff(): void {
    this.powered = false;
    this.playing = false;
    this.voices = [];
    this.synth.allOff();
    this.show('');
  }

  get bpm(): number {
    return Math.max(40, this.pattern(this.p('rhythm')).bpm + this.tempoOffset);
  }

  keyDown(key: number): void {
    if (!this.powered) return;
    if (key < DJ_NOTE_COUNT) this.synth.noteOn(DJ_FIRST_NOTE + key, this.p('kbPattern') > 0.5);
    else if (key < DJ_PAD + 6) this.trigger(this.pads[this.p('sfxBank')][key - DJ_PAD], 1, 1, BUS_SFX);
    else if (key === DJ_PLAY) { if (!this.playing) { this.playing = true; this.step = -1; this.phase = 0.999; } }
    else if (key === DJ_PAUSE) this.playing = !this.playing;
    else if (key === DJ_TEMPO_UP) { this.tempoOffset += 4; this.show(String(this.bpm)); }
    else if (key === DJ_TEMPO_DOWN) { this.tempoOffset -= 4; this.show(String(this.bpm)); }
    else if (key === DJ_DISC_TOUCH) this.touched = true;
  }

  keyUp(key: number): void {
    if (key < DJ_NOTE_COUNT) this.synth.noteOff(DJ_FIRST_NOTE + key);
    else if (key === DJ_DISC_TOUCH) this.touched = false;
  }

  private trigger(buf: Float32Array, rate: number, gain: number, bus: number): void {
    if (this.voices.length >= 24) this.voices.shift();
    this.voices.push({ buf, pos: rate < 0 ? buf.length - 1 : 0, rate, gain, bus });
  }

  status(): ToyStatus {
    const id = this.p('rhythm');
    return {
      powered: this.powered,
      playing: this.playing,
      leds: { beat: this.beatLed > 0 ? 1 : 0, run: this.playing ? 1 : 0, hidden: id >= 21 ? 1 : 0, halt: this.haltMul < 0.99 ? 1 : 0 },
      fx: { disc: Math.round(this.discPos / 40) }, // ディスクの回転表示用
    };
  }

  /** リズムを 1 ステップ進めたときの処理 */
  private onStep(pat: DjPattern): void {
    this.step = (this.step + 1) % pat.steps;
    if (pat.skip && this.rng.chance(pat.skip)) return;
    const kit = this.kits[pat.kit];
    const beat = pat.steps === 16 ? this.step % 4 === 0 : this.step === 0;
    if (beat) this.beatLed = Math.floor(this.sampleRate * 0.08);
    const vary = () => (pat.wobble ? Math.pow(2, (this.rng.bi() * pat.wobble) / 12) : 1);
    const dir = () => (pat.reverse && this.rng.chance(pat.reverse) ? -1 : 1);
    for (const ch of pat.hits[this.step]) {
      const buf = { k: kit.kick, s: kit.snare, h: kit.hat, o: kit.open, c: kit.clap, z: kit.zap }[ch];
      if (buf) this.trigger(buf, vary() * dir(), ch === 'h' ? 0.5 : 0.9, BUS_RHYTHM);
    }
    const b = pat.bass[this.step];
    if (b !== null && b !== undefined) this.trigger(kit.bass, Math.pow(2, (pat.root - 36 + b) / 12) * vary(), 0.8, BUS_RHYTHM);
  }

  process(out: Float32Array): void {
    const sr = this.sampleRate;
    const P = (id: DjParamId) => this.params[DJ_INDEX[id]];
    // ---- クロック（PITCH と光センサー）----
    let clkBase = 1;
    if (P('pitchOn') > 0.5) clkBase *= Math.pow(2, ((P('pitchCoarse') - 0.5) * 24 + (P('pitchFine') - 0.5) * 2) / 12);
    if (P('lightOn') > 0.5) clkBase *= 0.35 + 1.3 * P('light');
    const haltTarget = P('halt') > 0.5 ? 0 : 1;
    const pat = this.pattern(P('rhythm'));
    const bpm = this.bpm;
    const inst = P('instrument');
    const arp = P('kbPattern') > 0.5;
    const cut = P('rhythmFx') > 0.5;
    const rVol = P('rhythmVol') ** 2, sVol = P('sfxVol') ** 2;
    const disc = this.discs[P('discFx')];
    const discTarget = P('discSpeed');
    const moving = this.touched || Math.abs(discTarget) > 0.05;
    const fb = P('feedback'), fbSrc = P('fbSource');
    const d1 = P('dist1On') > 0.5 ? P('dist1') : -1;
    const d2 = P('dist2On') > 0.5 ? P('dist2') : -1;
    const volTarget = P('volume') ** 2;
    const toChip = CHIP_RATE / sr;
    const friction = Math.exp(-1 / (0.15 * sr));

    for (let i = 0; i < out.length; i++) {
      // STOP：テープが止まるように 0.3 秒で減速、離すと 0.2 秒で戻る
      this.haltMul += (haltTarget - this.haltMul) * (haltTarget ? 1 / (0.2 * sr) : 1 / (0.3 * sr)) * 4;
      const clk = clkBase * Math.max(0, this.haltMul);

      let rhythm = 0, sfx = 0;
      if (this.powered) {
        // ---- リズム ----
        if (this.playing) {
          this.phase += ((bpm / 60) * 4 * clk) / sr;
          if (this.phase >= 1) { this.phase -= 1; this.onStep(pat); }
        }
        // ---- アルペジオ（16 分音符）----
        if (arp) {
          this.arpPhase += ((bpm / 60) * 4 * clk) / sr;
          if (this.arpPhase >= 1) { this.arpPhase -= 1; this.synth.arpTick(); }
        }
        // ---- 波形 ROM の再生（補間なし）----
        for (let v = this.voices.length - 1; v >= 0; v--) {
          const s = this.voices[v];
          const idx = s.pos | 0;
          if (idx < 0 || idx >= s.buf.length) { this.voices.splice(v, 1); continue; }
          const x = s.buf[idx] * s.gain;
          if (s.bus === BUS_RHYTHM) rhythm += x; else sfx += x;
          s.pos += s.rate * clk * toChip;
        }
        if (cut && ((this.phase * 2) | 0) % 2 === 1) rhythm = 0; // RHYTHM EFFECT：32 分で刻む
        if (this.beatLed > 0) this.beatLed--;
      }

      // ---- ディスク（スクラッチ）----
      if (moving) this.discVel += (discTarget - this.discVel) * 0.02;
      else this.discVel *= friction;
      let discOut = 0;
      if (this.powered && Math.abs(this.discVel) > 0.01) {
        this.discPos += this.discVel * clk * toChip;
        const L = disc.length;
        this.discPos = ((this.discPos % L) + L) % L;
        discOut = disc[this.discPos | 0] * Math.min(1, Math.abs(this.discVel) * 3);
      }

      const keys = this.powered ? this.synth.tick(clk, inst) : 0;
      rhythm *= rVol;
      let x = rhythm + sfx * sVol + discOut * 0.9 + keys * 0.8;

      // ---- FEEDBACK（元を 3 段スイッチで選ぶ）----
      if (fb > 0.001) {
        this.fbPh = (this.fbPh + 0.3 / sr) % 1;
        const dly = Math.floor(sr * (0.006 + 0.002 * Math.sin(2 * Math.PI * this.fbPh)));
        const y = Math.tanh(this.fbBuf[(this.fbPos - dly + this.fbBuf.length) % this.fbBuf.length] * fb * 1.3);
        const src = fbSrc === 0 ? rhythm : fbSrc === 1 ? discOut : x;
        x += y;
        this.fbBuf[this.fbPos] = src + y + (this.rng.next() - 0.5) * 1e-4;
      } else this.fbBuf[this.fbPos] = 0;
      this.fbPos = (this.fbPos + 1) % this.fbBuf.length;

      // ---- DIST（オーバードライブ）----
      if (d1 >= 0) x = Math.tanh((x + 0.15 * d1) * (1 + 20 * d1)) - Math.tanh(0.15 * d1 * (1 + 20 * d1));
      // ---- DIST 2（ファズ：整流でオクターブ上＋ビット落とし）----
      if (d2 >= 0) {
        const f = Math.max(-1, Math.min(1, x * (1 + 40 * d2)));
        x = f * (1 - 0.5 * d2) + Math.abs(f) * 0.5 * d2;
        const q = Math.pow(2, 10 - 7 * d2);
        if (++this.holdCnt >= 1 + Math.floor(d2 * 4)) { this.holdCnt = 0; this.held = Math.round(x * q) / q; }
        x = this.held;
      }

      this.gate += ((this.powered ? 1 : 0) - this.gate) * 0.005;
      this.vol += (volTarget - this.vol) * 0.002;
      const y = x - this.dcX + 0.995 * this.dcY;
      this.dcX = x;
      this.dcY = y;
      out[i] = Math.tanh(y) * this.vol * this.gate;
    }
  }
}
