// スタジオ（DAW）に並べる PAKU-PAKU 16。おもちゃの共通の形（ToyEngine）に合わせた薄い殻。
// キー 0〜159 = パッド（A-01〜J-16）。音と設定は画面側がブラウザの保存から読んで custom で送ってくる。
import type { ParamDef } from '../../core/params';
import type { ToyEngine, ToyStatus } from '../../core/toy';
import type { BendState } from '../dsp/bend';
import { SamplerEngine } from '../dsp/engine';
import type { FxSlot } from '../dsp/fx';
import { PAD_COUNT, type PadParams, type SampleBuf } from '../dsp/types';

export const SAMPLER_PARAMS: readonly ParamDef[] = [
  { id: 'volume', name: 'VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.8, midiCC: 7 },
  { id: 'stop', name: 'STOP', kind: 'momentary', min: 0, max: 1, default: 0 },
];

/** 画面 → エンジンの専用データ */
export type SamplerCustom =
  | { kind: 'pad'; pad: number; data: SampleBuf | null; p: PadParams }
  | { kind: 'meta'; bpm: number; fx: FxSlot[]; bend?: BendState };

export interface SamplerDisplay {
  /** 鳴っているパッド */
  playing: number[];
}

export class SamplerToy implements ToyEngine<SamplerDisplay> {
  readonly params: Float32Array;
  readonly paramDefs = SAMPLER_PARAMS;
  readonly eng: SamplerEngine;
  display: SamplerDisplay = { playing: [] };
  displayVersion = 0;
  private l = new Float32Array(128);
  private r = new Float32Array(128);
  private count = 0;
  private lastKey = '';

  constructor(sr: number) {
    this.eng = new SamplerEngine(sr);
    this.params = Float32Array.from(SAMPLER_PARAMS.map((p) => p.default));
  }

  setParam(index: number, value: number): void {
    this.params[index] = value;
    if (SAMPLER_PARAMS[index]?.id === 'stop' && value > 0.5) this.eng.stopAll();
  }
  keyDown(key: number): void {
    if (key >= 0 && key < PAD_COUNT) this.eng.trigger(key, 1);
  }
  keyUp(key: number): void {
    if (key >= 0 && key < PAD_COUNT) this.eng.releasePad(key);
  }
  powerOn(): void {}
  powerOff(): void { this.eng.stopAll(); }
  reset(): void { this.eng.stopAll(); }

  custom(d: unknown): void {
    const m = d as SamplerCustom;
    if (m.kind === 'pad') { this.eng.setSample(m.pad, m.data); this.eng.setParams(m.pad, m.p); }
    else if (m.kind === 'meta') {
      this.eng.bpm = m.bpm;
      m.fx.forEach((f, i) => this.eng.setFx(i, f));
      if (m.bend) this.eng.bender.st = { ...m.bend, wires: [...m.bend.wires] };
    }
  }

  process(out: Float32Array): void {
    const n = out.length;
    if (this.l.length !== n) { this.l = new Float32Array(n); this.r = new Float32Array(n); }
    this.eng.master = this.params[0] * 1.25;
    this.eng.process(null, null, this.l, this.r);
    for (let i = 0; i < n; i++) out[i] = (this.l[i] + this.r[i]) * 0.5;
    // 鳴っているパッドを画面へ（変わったときだけ、ときどき）
    if (++this.count >= 8) {
      this.count = 0;
      const p = [...new Set(this.eng.playing().map((x) => x[0]))].sort((a, b) => a - b);
      const k = p.join(',');
      if (k !== this.lastKey) { this.lastKey = k; this.display = { playing: p }; this.displayVersion++; }
    }
  }

  status(): ToyStatus {
    return { powered: true, playing: this.display.playing.length > 0, leds: {}, fx: { heat: Math.round(this.eng.bender.heat * 20) / 20 } };
  }
}
