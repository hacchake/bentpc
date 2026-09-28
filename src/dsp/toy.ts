// 「おもちゃ1台」の共通インターフェース。
// 将来、複数の改造おもちゃを並べて演奏・録音する（KORG Gadget のような）ホストを作るとき、
// ホストはこの形だけを知っていればよい。VST3 化するときも、この単位が 1 プラグインになる。

import type { ParamDef } from '../params';

export interface ToyStatus {
  powered: boolean;
  playing: boolean;
  /** LED などの表示用の値（名前→0..1） */
  leds: Record<string, number>;
  /** 画面側の演出用の値（おもちゃごとに中身が違う） */
  fx: Record<string, number>;
}

export interface ToyEngine<Display = unknown> {
  readonly params: Float32Array;
  readonly paramDefs: readonly ParamDef[];
  setParam(index: number, value: number): void;
  keyDown(key: number): void;
  keyUp(key: number): void;
  powerOn(): void;
  powerOff(): void;
  /** モノラルで out を埋める */
  process(out: Float32Array): void;
  readonly display: Display;
  readonly displayVersion: number;
  status(): ToyStatus;
}
