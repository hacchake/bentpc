// TELEKEY TK-6 の音のエンジン（おもちゃ1台分）。DOM・Web Audio に依存しない。
// 取り込んだ動画の音（input）を受け取って壊し、楽器キーの音を足す。
// フェーズ1：取り込んだ音をそのまま通すだけ（音の通り道の確認）。グリッチはフェーズ2で入る。

import { defaultsOf } from '../../../core/params';
import type { ToyEngine, ToyStatus } from '../../../core/toy';
import { TELE_INDEX, TELE_PARAMS, type TeleParamId } from '../params';

export class TeleEngine implements ToyEngine<{ text: string }> {
  readonly params = defaultsOf(TELE_PARAMS);
  readonly paramDefs = TELE_PARAMS;
  readonly wantsInput = true;
  powered = false;
  private vol = 0;
  private gate = 0;
  private level = 0;
  display = { text: '' };
  displayVersion = 0;

  constructor(readonly sampleRate: number) {}

  p(id: TeleParamId): number {
    return this.params[TELE_INDEX[id]];
  }

  setParam(index: number, value: number): void {
    const def = TELE_PARAMS[index];
    if (!def) return;
    this.params[index] = Math.max(def.min, Math.min(def.max, def.kind === 'continuous' ? value : Math.round(value)));
  }

  powerOn(): void {
    this.powered = true;
  }

  powerOff(): void {
    this.powered = false;
  }

  keyDown(_key: number): void {}
  keyUp(_key: number): void {}

  status(): ToyStatus {
    return { powered: this.powered, playing: this.level > 0.001, leds: { level: Math.round(Math.min(1, this.level * 4) * 20) / 20 }, fx: {} };
  }

  process(out: Float32Array, input?: Float32Array): void {
    const volTarget = this.p('volume') ** 2;
    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      this.gate += ((this.powered ? 1 : 0) - this.gate) * 0.005;
      this.vol += (volTarget - this.vol) * 0.002;
      const x = input ? input[i] : 0;
      peak = Math.max(peak, Math.abs(x));
      out[i] = x * this.vol * this.gate;
    }
    this.level += (peak - this.level) * 0.2;
  }
}
