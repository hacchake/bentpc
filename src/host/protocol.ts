// UI ⇔ AudioWorklet のメッセージ形式。toy は何台目のおもちゃか（0 始まり）
import type { ToyStatus } from '../core/toy';

export type ToyMsg =
  | { type: 'param'; index: number; value: number }
  | { type: 'key'; key: number; down: boolean }
  | { type: 'power'; on: boolean }
  /** マイク入力をキーに録音する（on=true で開始、false で確定） */
  | { type: 'mic'; key: number; on: boolean }
  /** 保存しておいた自分の声を戻す（8kHz・8bit、null で消す） */
  | { type: 'userSample'; key: number; data: Int8Array | null };

export type ToEngine =
  | (ToyMsg & { toy: number })
  /** 出力（全おもちゃのミックス）の録音 */
  | { type: 'rec'; on: boolean };

export type FromToy =
  | { type: 'display'; display: unknown; version: number }
  | { type: 'status'; status: ToyStatus }
  | { type: 'userSample'; key: number; data: Int8Array | null };

export type FromEngine =
  | (FromToy & { toy: number })
  | { type: 'recChunk'; data: Float32Array }
  | { type: 'recDone' };
