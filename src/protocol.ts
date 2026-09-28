// UI ⇔ AudioWorklet のメッセージ形式
import type { DisplayState } from './dsp/firmware';
import type { ToyStatus } from './dsp/toy';

export type ToEngine =
  | { type: 'param'; index: number; value: number }
  | { type: 'key'; key: number; down: boolean }
  | { type: 'power'; on: boolean };

export type FromEngine =
  | { type: 'display'; display: DisplayState; version: number }
  | { type: 'status'; status: ToyStatus };
