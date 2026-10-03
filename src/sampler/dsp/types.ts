// サンプラーの共通の形（DOM 非依存。画面・AudioWorklet・テストのどこからでも使う）

export const PADS = 16;
export const BANKS = 10;
export const PAD_COUNT = PADS * BANKS;
export const BANK_NAMES = 'ABCDEFGHIJ';
/** 録音の上限（秒） */
export const REC_MAX_SEC = 120;

/** 音のデータ。ch は 1 本（モノラル）か 2 本（ステレオ） */
export interface SampleBuf {
  sr: number;
  ch: Float32Array[];
}

/** パッド 1 つの設定 */
export interface PadParams {
  /** 音量 0〜1（実際の倍率は 2 乗 × 2。0.7 でほぼ等倍） */
  vol: number;
  /** パン -1（左）〜 1（右） */
  pan: number;
  /** 音程（半音）-24〜24 */
  pitch: number;
  /** 微調整（セント）-50〜50 */
  fine: number;
  /** 鳴らす範囲（サンプル全体を 0〜1 として） */
  start: number;
  end: number;
  /** ループの戻り先（0〜1。START より前なら START から） */
  loopStart: number;
  /** 押している間だけ鳴る */
  gate: boolean;
  /** くり返す（GATE なしなら、もう一度押すと止まる） */
  loop: boolean;
  /** 逆再生 */
  reverse: boolean;
  /** 同じパッドを押し直したとき重ねる（オフなら頭から鳴らし直す） */
  poly: boolean;
  /** 立ち上がり 0〜1（0〜2 秒） */
  attack: number;
  /** 余韻 0〜1（5ms〜4 秒） */
  release: number;
  /** ローパスの周波数 0〜1（1 = 全開） */
  cutoff: number;
  /** レゾナンス 0〜1 */
  reso: number;
  /** ミュートグループ 0（なし）〜 8 */
  mute: number;
  /** ベロシティの効き 0（いつも最大）〜 1 */
  vel: number;
  /** この音の BPM（0 = わからない）。タイムストレッチの元 */
  bpm: number;
  /** 送り先：0 = そのまま、1 = BUS 1、2 = BUS 2（エフェクト） */
  bus: number;
}

export const defaultPad = (): PadParams => ({
  vol: 0.7, pan: 0, pitch: 0, fine: 0, start: 0, end: 1, loopStart: 0,
  gate: false, loop: false, reverse: false, poly: false,
  attack: 0, release: 0.15, cutoff: 1, reso: 0, mute: 0, vel: 0.7, bpm: 0, bus: 0,
});

/** 音量の倍率 */
export const volGain = (v: number) => v * v * 2;
export const attackSec = (k: number) => k * k * 2;
export const releaseSec = (k: number) => 0.005 + k * k * 4;
export const cutoffHz = (k: number) => 20 * Math.pow(1000, k);

/** パッド番号（0〜159）→ "A-01" */
export const padLabel = (pad: number) => `${BANK_NAMES[Math.floor(pad / PADS)]}-${String((pad % PADS) + 1).padStart(2, '0')}`;

/** 16 レベル：鳴らすときだけ設定を変える（無い項目はパッドの設定のまま） */
export interface TrigMod {
  /** 音程に足す（半音） */
  pitch?: number;
  cutoff?: number;
  attack?: number;
  start?: number;
}

/** ロール（連打）の速さ（拍）：1/4・1/8・1/16・1/32・1/8 3 連・1/16 3 連 */
export const ROLL_RATES = [1, 0.5, 0.25, 0.125, 1 / 3, 1 / 6];
export const ROLL_NAMES = ['1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T'];

import type { FxSlot } from './fx';
import type { BendState } from './bend';

/** 画面 ⇔ AudioWorklet のメッセージ */
export type ToSampler =
  | { type: 'sample'; pad: number; data: SampleBuf | null }
  | { type: 'params'; pad: number; p: PadParams }
  | { type: 'trig'; pad: number; vel: number; mod?: TrigMod }
  | { type: 'release'; pad: number }
  | { type: 'stopAll' }
  | { type: 'master'; vol: number }
  /** 録音：source = 'input'（マイク）か 'output'（リサンプル）。auto なら音が来るまで待つ */
  | { type: 'rec'; on: true; source: 'input' | 'output'; auto: boolean }
  | { type: 'rec'; on: false }
  | { type: 'monitor'; on: boolean }
  /** ロール：on の間、押しているパッドを rate 拍ごとにくり返す */
  | { type: 'roll'; on: boolean; rate: number }
  | { type: 'bpm'; bpm: number }
  /** エフェクト：slot 0 = BUS 1、1 = BUS 2、2 = MASTER */
  | { type: 'fx'; slot: number; fx: FxSlot }
  | { type: 'bend'; bend: BendState };

export type FromSampler =
  | { type: 'meter'; inPeak: number; outPeak: number; rec: number; waiting: boolean; heat: number }
  /** 鳴っているパッドと、その再生位置（サンプル全体の 0〜1） */
  | { type: 'play'; pads: [number, number][] }
  | { type: 'recorded'; data: SampleBuf | null };
