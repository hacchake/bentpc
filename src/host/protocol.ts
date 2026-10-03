// UI ⇔ AudioWorklet のメッセージ形式。toy は何台目のおもちゃか（0 始まり）
import type { Song, takeFromRaw } from '../core/song';
import type { ToyStatus } from '../core/toy';

export type ToyMsg =
  | { type: 'param'; index: number; value: number }
  | { type: 'key'; key: number; down: boolean }
  | { type: 'power'; on: boolean }
  /** マイク入力をキーに録音する（on=true で開始、false で確定） */
  | { type: 'mic'; key: number; on: boolean }
  /** 保存しておいた自分の声を戻す（8kHz・8bit、null で消す） */
  | { type: 'userSample'; key: number; data: Int8Array | null }
  /** 映像入力の代わりにテスト信号（音）を使う（テスト映像のとき） */
  | { type: 'signal'; on: boolean }
  /** おもちゃ専用のデータ（サンプラーの音と設定など）。key ごとに最新のものを覚えて、作り直したときに送り直す */
  | { type: 'custom'; key: string; data: unknown };

export type ToEngine =
  | (ToyMsg & { toy: number })
  /** 出力（全おもちゃのミックス）の録音 */
  | { type: 'rec'; on: boolean }
  // ---- シーケンサー ----
  /** 曲を丸ごと差し替える（編集のたびに送る） */
  | { type: 'song'; song: Song }
  /** 再生／停止。from を付けるとその拍から */
  | { type: 'transport'; play: boolean; from?: number }
  /** 操作の録音（オーバーダブ）。take はテイク番号 */
  | { type: 'seqRec'; on: boolean; take: number }
  /** 曲を最初から 1 回だけ鳴らして止まる（WAV 書き出し用） */
  | { type: 'bounce' };

export type FromToy =
  | { type: 'display'; display: unknown; version: number }
  | { type: 'status'; status: ToyStatus }
  | { type: 'userSample'; key: number; data: Int8Array | null };

export type FromEngine =
  | (FromToy & { toy: number })
  | { type: 'recChunk'; data: Float32Array; dataR?: Float32Array }
  | { type: 'recDone' }
  | { type: 'seqPos'; beat: number; playing: boolean; recording: boolean }
  | { type: 'seqTake'; take: number; data: ReturnType<typeof takeFromRaw> }
  | { type: 'seqEnd' };
