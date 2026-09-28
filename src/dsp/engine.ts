// DSP エンジン本体。AudioWorklet・（将来の）VST3 のどちらからも、これだけを呼べば動く。
// 入力：パラメーター値・キー操作・電源操作  出力：モノラルのオーディオ＋液晶の表示状態
// DOM・Web Audio には一切依存しない。

import { PARAMS, PARAM_INDEX, defaultParamValues, type ParamId } from '../params';
import { Chip } from './chip';
import { Firmware, type DisplayState, type PlayRequest } from './firmware';

export const DEFAULT_SEED = 0x7a11c0de;

export class Engine {
  readonly params: Float32Array = defaultParamValues();
  readonly fw: Firmware;
  private chip = new Chip();
  private vol = 0; // 平滑化した音量
  private master = 0; // 電源による出力ゲート（0..1）
  private lp = 0;
  private dcX = 0;
  private dcY = 0;
  private lpCoef: number;

  constructor(readonly sampleRate: number, readonly seed: number = DEFAULT_SEED) {
    this.fw = new Firmware(seed);
    this.lpCoef = 1 - Math.exp((-2 * Math.PI * 6500) / sampleRate);
  }

  p(id: ParamId): number {
    return this.params[PARAM_INDEX[id]];
  }

  setParam(index: number, value: number): void {
    const def = PARAMS[index];
    if (!def) return;
    const v = Math.max(def.min, Math.min(def.max, def.kind === 'continuous' ? value : Math.round(value)));
    const old = this.params[index];
    this.params[index] = v;
    if (def.id === 'mode' && v !== old) this.play(this.fw.setMode(v));
  }

  setParamById(id: ParamId, value: number): void {
    this.setParam(PARAM_INDEX[id], value);
  }

  powerOn(): void {
    // LOOP スイッチが下（MUTE）の位置だと起動しない
    if (this.p('loopSwitch') === 2) return;
    this.fw.mode = this.p('mode');
    this.play(this.fw.powerOn());
  }

  powerOff(): void {
    this.fw.powerOff();
    this.chip.stop();
  }

  keyDown(key: number): void {
    this.play(this.fw.press(key));
  }

  keyUp(_key: number): void {
    // フェーズ1ではキーを離しても音は最後まで鳴る（おもちゃと同じ）
  }

  private play(req: PlayRequest | null): void {
    if (req) this.chip.start(req.buf, req.key);
  }

  get display(): DisplayState {
    return this.fw.display;
  }
  get displayVersion(): number {
    return this.fw.displayVersion;
  }
  get isPlaying(): boolean {
    return this.chip.playing;
  }

  /** out にモノラル音声を書き込む */
  process(out: Float32Array): void {
    const n = out.length;
    const volTarget = this.p('volume') ** 2;
    const on = this.fw.powered && this.p('loopSwitch') !== 2 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      this.vol += (volTarget - this.vol) * 0.002;
      this.master += (on - this.master) * 0.01;
      const wasPlaying = this.chip.playing;
      let x = this.chip.tick(this.sampleRate);
      if (wasPlaying && !this.chip.playing) this.play(this.fw.onSoundEnd());
      // アンプ部：軽いローパスと DC カット
      this.lp += (x - this.lp) * this.lpCoef;
      x = this.lp;
      const y = x - this.dcX + 0.995 * this.dcY;
      this.dcX = x;
      this.dcY = y;
      out[i] = y * this.vol * this.master;
    }
  }
}
