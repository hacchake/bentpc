// DSP エンジン本体（おもちゃ1台分）。AudioWorklet・（将来の）VST3 のどちらからも、これだけを呼べば動く。
// 入力：パラメーター値・キー操作・電源操作  出力：モノラルのオーディオ＋液晶の表示状態
// DOM・Web Audio には一切依存しない。

import { PARAMS, PARAM_INDEX, defaultParamValues, type ParamId } from '../params';
import { Chip } from './chip';
import { distort } from './dist';
import { Firmware, type DisplayState, type PlayRequest } from './firmware';
import { Heat } from './heat';
import { Rng, hashSeed } from '../../../core/rng';
import type { ToyEngine, ToyStatus } from '../../../core/toy';

export const DEFAULT_SEED = 0x7a11c0de;

export class Engine implements ToyEngine<DisplayState> {
  readonly params: Float32Array = defaultParamValues();
  readonly paramDefs = PARAMS;
  readonly fw: Firmware;
  readonly chip: Chip;
  private vol = 0; // 平滑化した音量
  private master = 0; // 電源と MUTE による出力ゲート（0..1）
  private lp = 0;
  private dcX = 0;
  private dcY = 0;
  private lpCoef: number;
  private distAmt = 0;
  readonly heat: Heat;
  private presses = 0;

  constructor(readonly sampleRate: number, readonly seed: number = DEFAULT_SEED) {
    this.fw = new Firmware(seed);
    this.chip = new Chip(sampleRate, new Rng(hashSeed(seed, 'chip')), {
      other: (r) => this.fw.otherSound(r),
      system: (r) => this.fw.systemSound(r),
    });
    this.heat = new Heat(new Rng(hashSeed(seed, 'heat')));
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
    if (v === old) return;
    const rising = v > old;
    switch (def.id) {
      case 'mode': this.play(this.fw.setMode(v)); break;
      case 'loopHold': if (rising) this.chip.grab(); break;
      case 'loopRelease': if (rising) this.chip.release(); break;
      case 'reset': if (rising) this.reset(); break;
      case 'loopSwitch': if (old === 0) this.chip.release(); break; // 上から外したらホールド解除
    }
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

  reset(): void {
    this.fw.reset();
    this.chip.stop();
    this.heat.reset();
  }

  /** マイクで録った自分の声をキーに割り当てる（null で消す）。8kHz の波形 */
  setUserSample(key: number, buf: Float32Array | null): void {
    this.fw.userSamples[key] = buf;
  }

  keyDown(key: number): void {
    this.presses++;
    this.play(this.fw.press(key));
  }

  keyUp(_key: number): void {
    // キーを離しても音は最後まで鳴る（おもちゃと同じ）
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

  status(): ToyStatus {
    return {
      powered: this.fw.powered,
      playing: this.chip.playing,
      leds: {
        stretch: this.chip.stretchLed ? 1 : 0,
        loop: this.chip.loopActive && this.chip.playing ? 1 : 0,
        glitch: this.chip.glitchActivity,
      },
      fx: {
        combos: this.chip.activeCombos,
        heat: Math.round(this.heat.value * 100) / 100,
        seed: this.chip.rngState,
        misread: this.fw.lastOtherKey,
      },
    };
  }

  /** パラメーターを再生回路へ反映（ブロックごと） */
  private applyParams(): void {
    const c = this.chip;
    let mask = 0;
    for (let i = 0; i < 5; i++) if (this.params[PARAM_INDEX.glitch1 + i] > 0.5) mask |= 1 << i;
    c.glitchMask = this.fw.powered ? mask : 0;
    c.base = this.p('base');
    c.autoHold = this.p('loopSwitch') === 0;
    c.lfoRate = this.p('lfoRate');
    c.lfoDepth = this.p('lfoDepth');
    c.stretchOn = this.p('stretch') > 0.5;
    c.stretchHold = this.p('stretchHold');
    c.stretchRel = this.p('stretchRelease');
  }

  /** out にモノラル音声を書き込む */
  process(out: Float32Array): void {
    this.applyParams();
    const n = out.length;
    let glitchCount = 0;
    for (let i = 0; i < 5; i++) if (this.chip.glitchMask & (1 << i)) glitchCount++;
    this.heat.update(n / this.sampleRate, {
      glitchCount,
      base: this.chip.base,
      dist: this.p('dist'),
      looping: this.chip.loopActive,
      stretching: this.chip.stretchOn,
      playing: this.chip.playing && this.fw.powered,
      presses: this.presses,
    });
    this.presses = 0;
    this.chip.forced = this.heat.forced;
    const volTarget = this.p('volume') ** 2;
    const on = this.fw.powered && this.p('loopSwitch') !== 2 ? 1 : 0;
    const distTarget = this.p('dist');
    const distType = this.p('distType');
    for (let i = 0; i < n; i++) {
      this.vol += (volTarget - this.vol) * 0.002;
      this.master += (on - this.master) * 0.01;
      this.distAmt += (distTarget - this.distAmt) * 0.002;
      const wasPlaying = this.chip.playing;
      let x = this.chip.tick();
      if (wasPlaying && !this.chip.playing) this.play(this.fw.onSoundEnd());
      x = distort(x, this.distAmt, distType);
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
