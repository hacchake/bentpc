// ラック・スタジオに並べる PAKU-PAKU 16。おもちゃの共通の形（ToyEngine）に合わせた殻。
// キー   0〜159 = パッド（A-01〜J-16）
//      160〜207 = メロディ：MELO PAD の音を、音程を変えて弾く（184 = 元の高さ、±24 半音）
//      208〜255 = ベース：BASS PAD の音を、音程を変えて弾く（232 = 元の高さ）
// 音と設定は、最初は工場出荷の音（バンク A = ドラム、B = おもちゃの音）。画面がサンプラーのページの保存を読んだら custom で上書きする。
import type { ParamDef } from '../../core/params';
import type { ToyEngine, ToyStatus } from '../../core/toy';
import type { BendState } from '../dsp/bend';
import { SamplerEngine } from '../dsp/engine';
import { factoryBank, factoryParams, type FactorySound } from '../dsp/factory';
import type { FxSlot } from '../dsp/fx';
import { PADS, PAD_COUNT, type PadParams, type SampleBuf } from '../dsp/types';

export const MELO_KEY = 160;
export const BASS_KEY = 208;
export const KEY_COUNT = 256;
/** メロディ・ベースのキーの「元の高さ」（真ん中） */
export const MELO_ROOT_KEY = MELO_KEY + 24;
export const BASS_ROOT_KEY = BASS_KEY + 24;
/** 工場出荷の音で、メロディ（B-09 TOY PNO＝C5）とベース（B-02 BASS C＝C2）の元の高さ（MIDI） */
export const MELO_ROOT_MIDI = 72;
export const BASS_ROOT_MIDI = 36;

export const SAMPLER_PARAMS: readonly ParamDef[] = [
  { id: 'volume', name: 'VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.8, midiCC: 7 },
  { id: 'stop', name: 'STOP', kind: 'momentary', min: 0, max: 1, default: 0 },
  { id: 'meloPad', name: 'MELO PAD', kind: 'stepped', min: 0, max: PAD_COUNT - 1, default: 24 },
  { id: 'bassPad', name: 'BASS PAD', kind: 'stepped', min: 0, max: PAD_COUNT - 1, default: 17 },
  { id: 'bend', name: 'BEND', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 1 },
];
export const SP = { volume: 0, stop: 1, meloPad: 2, bassPad: 3, bend: 4 } as const;

/** 画面 → エンジンの専用データ */
export type SamplerCustom =
  | { kind: 'pad'; pad: number; data: SampleBuf | null; p: PadParams }
  | { kind: 'meta'; bpm: number; fx: FxSlot[]; bend?: BendState };

export interface SamplerDisplay {
  /** 鳴っているパッド */
  playing: number[];
}

// 工場出荷の音は重いので、1 回だけ作る（作り直すたびに使い回す）
let factory: FactorySound[][] | null = null;
const factoryOnce = () => (factory ??= [factoryBank(0), factoryBank(1)]);

/** 電源を入れたときの「パクッ、パクッ」 */
function chomp(sr: number): Float32Array {
  const x = new Float32Array(Math.round(sr * 0.42));
  for (const [t0, f] of [[0, 520], [0.2, 700]] as const) {
    const o = Math.round(t0 * sr);
    let ph = 0;
    for (let i = 0; i < sr * 0.16 && o + i < x.length; i++) {
      ph += (2 * Math.PI * f * (1 - (i / (sr * 0.16)) * 0.6)) / sr;
      x[o + i] += (Math.sign(Math.sin(ph)) * 0.25 + Math.sin(ph * 0.5) * 0.2) * Math.exp(-i / (sr * 0.04));
    }
  }
  return x;
}

export class SamplerToy implements ToyEngine<SamplerDisplay> {
  readonly params: Float32Array;
  readonly paramDefs = SAMPLER_PARAMS;
  readonly eng: SamplerEngine;
  display: SamplerDisplay = { playing: [] };
  displayVersion = 0;
  powered = false;
  private l = new Float32Array(128);
  private r = new Float32Array(128);
  private count = 0;
  private lastKey = '';
  private boot: Float32Array;
  private bootPos = -1;
  /** サンプラーのページで決めたベンド（BEND ノブが 0 のときはこれ） */
  private pageBend: BendState | undefined;

  constructor(private sr: number) {
    this.eng = new SamplerEngine(sr);
    this.params = Float32Array.from(SAMPLER_PARAMS.map((p) => p.default));
    factoryOnce().forEach((bank, b) => bank.forEach((s, i) => { this.eng.setSample(b * PADS + i, s.buf); this.eng.setParams(b * PADS + i, factoryParams(s)); }));
    this.boot = chomp(sr);
  }

  setParam(index: number, value: number): void {
    this.params[index] = value;
    if (index === SP.stop && value > 0.5) this.eng.stopAll();
    if (index === SP.bend) this.applyBend();
  }

  /** BEND ノブ：上げるほどジャンパー線が増え、強くなる（0 ならサンプラーのページの設定） */
  private applyBend(): void {
    const k = this.params[SP.bend];
    if (k < 0.02) { if (this.pageBend) this.eng.bender.st = { ...this.pageBend, wires: [...this.pageBend.wires] }; else this.eng.bender.st = { ...this.eng.bender.st, wires: this.eng.bender.st.wires.map(() => false) }; return; }
    this.eng.bender.st = { wires: [k > 0.05, k > 0.35, k > 0.7, k > 0.15, k > 0.55, k > 0.85], amount: Math.min(1, 0.3 + k * 0.7), speed: 0.3 + k * 0.6 };
  }

  keyDown(key: number): void {
    if (!this.powered) return;
    if (key >= 0 && key < PAD_COUNT) this.eng.trigger(key, 1);
    else if (key >= MELO_KEY && key < BASS_KEY) this.eng.trigger(this.params[SP.meloPad] | 0, 1, { pitch: key - MELO_ROOT_KEY, poly: true });
    else if (key >= BASS_KEY && key < KEY_COUNT) this.eng.trigger(this.params[SP.bassPad] | 0, 1, { pitch: key - BASS_ROOT_KEY });
  }
  keyUp(key: number): void {
    if (key >= 0 && key < PAD_COUNT) this.eng.releasePad(key);
    else if (key >= MELO_KEY && key < BASS_KEY) this.eng.releasePad(this.params[SP.meloPad] | 0);
    else if (key >= BASS_KEY && key < KEY_COUNT) this.eng.releasePad(this.params[SP.bassPad] | 0);
  }
  powerOn(): void {
    if (this.powered) return;
    this.powered = true;
    this.bootPos = 0;
  }
  powerOff(): void {
    this.powered = false;
    this.eng.stopAll();
  }
  reset(): void { this.eng.stopAll(); }

  custom(d: unknown): void {
    const m = d as SamplerCustom;
    if (m.kind === 'pad') { this.eng.setSample(m.pad, m.data); this.eng.setParams(m.pad, m.p); }
    else if (m.kind === 'meta') {
      this.eng.bpm = m.bpm;
      m.fx.forEach((f, i) => this.eng.setFx(i, f));
      this.pageBend = m.bend;
      this.applyBend();
    }
  }

  process(out: Float32Array): void {
    const n = out.length;
    if (this.l.length !== n) { this.l = new Float32Array(n); this.r = new Float32Array(n); }
    this.eng.master = this.params[SP.volume] * 1.25;
    this.eng.process(null, null, this.l, this.r);
    for (let i = 0; i < n; i++) out[i] = this.powered ? (this.l[i] + this.r[i]) * 0.5 : 0;
    if (this.bootPos >= 0) {
      for (let i = 0; i < n && this.bootPos < this.boot.length; i++) out[i] += this.boot[this.bootPos++] * this.params[SP.volume];
      if (this.bootPos >= this.boot.length) this.bootPos = -1;
    }
    // 鳴っているパッドを画面へ（変わったときだけ、ときどき）
    if (++this.count >= 8) {
      this.count = 0;
      const p = [...new Set(this.eng.playing().map((x) => x[0]))].sort((a, b) => a - b);
      const k = p.join(',');
      if (k !== this.lastKey) { this.lastKey = k; this.display = { playing: p }; this.displayVersion++; }
    }
  }

  status(): ToyStatus {
    return { powered: this.powered, playing: this.display.playing.length > 0, leds: {}, fx: { heat: Math.round(this.eng.bender.heat * 20) / 20 } };
  }
}
