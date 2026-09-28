// 「おもちゃ1台」の共通インターフェース。
// 将来、複数の改造おもちゃを並べて演奏・録音する（KORG Gadget のような）ホストを作るとき、
// ホストはこの形だけを知っていればよい。VST3 化するときも、この単位が 1 プラグインになる。

import type { ParamDef } from './params';

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
  /** モノラルで out を埋める。input は外から入ってくる音（映像の音など。wantsInput のおもちゃだけ） */
  process(out: Float32Array, input?: Float32Array): void;
  /** 外の音（取り込んだ動画の音）を受け取るおもちゃは true */
  readonly wantsInput?: boolean;
  readonly display: Display;
  readonly displayVersion: number;
  status(): ToyStatus;
  /** マイクで録った音をキーに割り当てる（対応しているおもちゃだけ） */
  setUserSample?(key: number, buf: Float32Array | null): void;
}
