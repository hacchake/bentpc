// UI ⇔ AudioWorklet のメッセージ形式
import type { DisplayState } from './dsp/firmware';
import type { ToyStatus } from './dsp/toy';

export type ToEngine =
  | { type: 'param'; index: number; value: number }
  | { type: 'key'; key: number; down: boolean }
  | { type: 'power'; on: boolean }
  /** 出力の録音（LINE OUT） */
  | { type: 'rec'; on: boolean }
  /** マイク入力をキーに録音する（on=true で開始、false で確定） */
  | { type: 'mic'; key: number; on: boolean }
  /** 保存しておいた自分の声を戻す（8kHz・8bit、null で消す） */
  | { type: 'userSample'; key: number; data: Int8Array | null };

export type FromEngine =
  | { type: 'display'; display: DisplayState; version: number }
  | { type: 'status'; status: ToyStatus }
  | { type: 'recChunk'; data: Float32Array }
  | { type: 'recDone' }
  | { type: 'userSample'; key: number; data: Int8Array | null };
