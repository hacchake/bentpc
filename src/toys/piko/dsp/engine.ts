// PIKOTONE PT-32 の DSP エンジン（おもちゃ1台分）。DOM・Web Audio に依存しない。
// 信号の流れ：[音源チップ（8音）＋リズム] → 8bit DAC → 内蔵アンプ（電圧不足・タッチ） → エフェクト別ユニット → 音量

import { defaultsOf } from '../../../core/params';
import { Rng, hashSeed } from '../../../core/rng';
import type { ToyEngine, ToyStatus } from '../../../core/toy';
import {
  KEY_DEMO, KEY_START, KEY_STOP, KEY_TEMPO_DOWN, KEY_TEMPO_UP, PAD_KEY, PIKO_FIRST_NOTE, PIKO_INDEX, PIKO_NOTE_COUNT, PIKO_PARAMS, type PikoParamId,
} from '../params';
import { Amp, FxUnit, Skin } from './fx';
import { Rhythm } from './rhythm';
import { Voices } from './voices';

export const PIKO_SEED = 0x51c0ffee;

// デモ曲（オリジナル）。[MIDI ノート or null, 16 分音符の数]
const DEMO: [number | null, number][] = [
  [64, 2], [67, 2], [72, 4], [71, 2], [69, 2], [67, 4],
  [69, 2], [71, 2], [72, 2], [74, 2], [76, 6], [74, 2],
  [72, 2], [69, 2], [65, 4], [67, 2], [69, 2], [71, 4],
  [72, 4], [67, 4], [64, 4], [null, 4],
  [65, 2], [69, 2], [72, 4], [76, 2], [74, 2], [72, 4],
  [71, 2], [67, 2], [74, 4], [72, 2], [71, 2], [69, 4],
  [67, 2], [69, 2], [71, 2], [72, 2], [74, 4], [76, 4],
  [72, 8], [null, 8],
];

export interface PikoDisplay {
  beat: number;
}

export class PikoEngine implements ToyEngine<PikoDisplay> {
  readonly params = defaultsOf(PIKO_PARAMS);
  readonly paramDefs = PIKO_PARAMS;
  readonly voices: Voices;
  readonly rhythm: Rhythm;
  private amp: Amp;
  private fx: FxUnit;
  private rng: Rng;
  private bendSkins: Skin[];
  powered = false;
  // CPU 電圧不足
  private jitter = 0;
  private jitterTarget = 0;
  private jitterCd = 0;
  private brownout = 0; // 残りサンプル
  // デモ
  private demoOn = false;
  private demoIdx = 0;
  private demoLeft = 0; // 残り（16分音符単位、小数）
  private demoNote = -1;
  // 出力段
  private vol = 0;
  private gate = 0;
  private dcX = 0;
  private dcY = 0;
  private beatLed = 0;
  private prevHold = false;
  display: PikoDisplay = { beat: 0 };
  displayVersion = 0;

  constructor(readonly sampleRate: number, readonly seed = PIKO_SEED) {
    this.rng = new Rng(hashSeed(seed, 'piko'));
    this.voices = new Voices(sampleRate, new Rng(hashSeed(seed, 'voices')));
    this.rhythm = new Rhythm(sampleRate, new Rng(hashSeed(seed, 'rhythm')));
    this.amp = new Amp(sampleRate, new Rng(hashSeed(seed, 'amp')));
    this.fx = new FxUnit(sampleRate, new Rng(hashSeed(seed, 'fx')));
    this.bendSkins = [0, 1, 2].map((i) => new Skin(sampleRate, new Rng(hashSeed(seed, 'bend', i))));
  }

  p(id: PikoParamId): number {
    return this.params[PIKO_INDEX[id]];
  }

  setParam(index: number, value: number): void {
    const def = PIKO_PARAMS[index];
    if (!def) return;
    this.params[index] = Math.max(def.min, Math.min(def.max, def.kind === 'continuous' ? value : Math.round(value)));
  }

  setParamById(id: PikoParamId, v: number): void {
    this.setParam(PIKO_INDEX[id], v);
  }

  powerOn(): void {
    if (this.powered) return;
    this.powered = true;
    this.voices.noteOn(84); // 起動の「ピッ」
    this.voices.noteOff(84);
  }

  powerOff(): void {
    this.powered = false;
    this.voices.allOff();
    this.rhythm.stop();
    this.demoOn = false;
  }

  /** 曲が止まった：リズム・デモ曲を止め、鳴っている音を止める */
  songStopped(): void {
    this.rhythm.stop();
    this.stopDemo();
    this.voices.allOff();
  }

  /** CPU 電圧が低いと、弾いた音が違う音になることがある */
  private misfire(note: number): number {
    const starve = 1 - this.p('cpuPower');
    if (starve > 0.85 && this.rng.chance((starve - 0.85) * 3)) return note + this.rng.int(13) - 6;
    return note;
  }

  keyDown(key: number): void {
    if (!this.powered) return;
    const glitch = this.p('glitch') > 0.5;
    if (key < PIKO_NOTE_COUNT) this.voices.noteOn(this.misfire(PIKO_FIRST_NOTE + key));
    else if (key < PAD_KEY + 4) this.rhythm.pad(key - PAD_KEY, glitch);
    else if (key === KEY_DEMO) this.toggleDemo();
    else if (key === KEY_START) this.rhythm.start();
    else if (key === KEY_STOP) { this.rhythm.stop(); this.stopDemo(); }
    else if (key === KEY_TEMPO_UP) this.setParamById('tempo', Math.min(1, this.p('tempo') + 1 / 28));
    else if (key === KEY_TEMPO_DOWN) this.setParamById('tempo', Math.max(0, this.p('tempo') - 1 / 28));
  }

  keyUp(key: number): void {
    if (key < PIKO_NOTE_COUNT) {
      // 違う音に化けていても離せるよう、近くの音もまとめて離す
      for (let d = -6; d <= 6; d++) this.voices.noteOff(PIKO_FIRST_NOTE + key + d);
    }
  }

  private toggleDemo(): void {
    if (this.demoOn) { this.stopDemo(); this.rhythm.stop(); return; }
    this.demoOn = true;
    this.demoIdx = 0;
    this.demoLeft = 0;
    if (!this.rhythm.running) this.rhythm.start();
  }

  private stopDemo(): void {
    this.demoOn = false;
    if (this.demoNote >= 0) this.voices.noteOff(this.demoNote);
    this.demoNote = -1;
  }

  get bpm(): number {
    return 60 + this.p('tempo') * 140;
  }

  status(): ToyStatus {
    return {
      powered: this.powered,
      playing: this.voices.active > 0 || this.rhythm.running,
      leds: { beat: this.beatLed > 0 ? 1 : 0, run: this.rhythm.running ? 1 : 0, demo: this.demoOn ? 1 : 0 },
      fx: { tempo: Math.round(this.bpm) },
    };
  }

  process(out: Float32Array): void {
    const sr = this.sampleRate;
    const P = (id: PikoParamId) => this.params[PIKO_INDEX[id]];
    const cpuStarve = 1 - P('cpuPower');
    const glitch = P('glitch') > 0.5;
    let holdMask = 0;
    for (let i = 0; i < 8; i++) if (this.params[PIKO_INDEX.instHold1 + i] > 0.5) holdMask |= 1 << i;
    const envHold = P('envHold') > 0.5;
    if (this.prevHold && !envHold) this.voices.releaseAll();
    this.prevHold = envHold;
    const vctl = {
      inst: P('instrument'),
      holdMask,
      envScale: Math.pow(2, (P('envLen') - 0.4) * 6),
      envHold,
      vibrato: P('vibrato') > 0.5,
      bitError: cpuStarve > 0.4 ? (cpuStarve - 0.4) * 0.02 : 0,
    };
    const actl = { power: P('ampPower'), touch: [P('ampTouch1'), P('ampTouch2'), P('ampTouch3')] as [number, number, number] };
    const fctl = {
      dist: P('dist'), fizz: P('fizz'), hipass: P('hipass'), hipassReso: P('hipassMode') > 0.5,
      feedback: P('feedback'), feedbackLong: P('feedbackMode') > 0.5,
    };
    const pitchMul = P('pitchOn') > 0.5 ? Math.pow(2, (P('pitch') - 0.5) * 2) : 1;
    const bends = [P('bendTouch1'), P('bendTouch2'), P('bendTouch3')];
    const volTarget = P('volume') ** 2;
    const bpm = this.bpm;
    const pattern = P('rhythm');

    for (let i = 0; i < out.length; i++) {
      // ---- クロック（CPU の速さ）----
      let clk = pitchMul;
      if (cpuStarve > 0.001) {
        clk *= 1 - 0.45 * Math.pow(cpuStarve, 1.3);
        if (--this.jitterCd <= 0) { this.jitterCd = Math.floor(sr * 0.001); this.jitterTarget = this.rng.bi() * cpuStarve * 0.3; }
        this.jitter += (this.jitterTarget - this.jitter) * 0.01;
        clk *= Math.pow(2, this.jitter);
        // 電圧がかなり低いと、チップがときどき止まる（ブラウンアウト）
        if (this.brownout > 0) { this.brownout--; clk = 0; }
        else if (cpuStarve > 0.6 && this.rng.next() < ((cpuStarve - 0.6) * 6) / sr) this.brownout = Math.floor(sr * (0.01 + this.rng.next() * 0.05));
      }
      // ---- PITCH BEND タッチ（指の抵抗でクロックが下がる）----
      if (bends[0] + bends[1] + bends[2] > 0) {
        let semis = 0;
        for (let b = 0; b < 3; b++) if (bends[b] > 0) semis += bends[b] * [2, 7, 12][b] * this.bendSkins[b].tick();
        clk *= Math.pow(2, -semis / 12);
      }

      // ---- デモ曲 ----
      if (this.demoOn && this.powered) {
        this.demoLeft -= ((bpm / 60) * 4 * clk) / sr;
        if (this.demoLeft <= 0) {
          if (this.demoNote >= 0) this.voices.noteOff(this.demoNote);
          const [n, len] = DEMO[this.demoIdx];
          this.demoIdx = (this.demoIdx + 1) % DEMO.length;
          this.demoLeft += len;
          this.demoNote = n ?? -1;
          if (n !== null) this.voices.noteOn(n);
        }
      }

      let x = 0;
      if (this.powered) {
        x = this.voices.tick(clk, vctl) + this.rhythm.tick(pattern, bpm, clk, glitch) * 0.8;
        if (this.rhythm.beat) this.beatLed = Math.floor(sr * 0.08);
        x = Math.round(Math.max(-1, Math.min(1, x)) * 127) / 127; // 8bit DAC
      }
      if (this.beatLed > 0) this.beatLed--;
      x = this.amp.tick(x, actl);
      x = this.fx.tick(x, fctl);

      this.gate += ((this.powered ? 1 : 0) - this.gate) * 0.005;
      this.vol += (volTarget - this.vol) * 0.002;
      const y = x - this.dcX + 0.995 * this.dcY;
      this.dcX = x;
      this.dcY = y;
      out[i] = Math.tanh(y * 1.2) * this.vol * this.gate;
    }
  }
}
