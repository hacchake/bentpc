// 自動作曲の共通の形。作曲のやり方（Composer）は差し替えられる：
// 今は「ルール＋シード付き乱数」（rules.ts）。将来、言葉から作る（Claude API など）ものを足すときも、
// 同じ ComposeRequest を受け取って Song を返せばよい。

import type { Song } from '../core/song';
import type { CoverSource } from '../cover/plan';

/** スタイルの名前（styles.ts の STYLES の鍵。'plain' 'beat' 'enka' 'dnb' など） */
export type StyleId = string;

/** 画面のつまみ・スイッチで決める設定。同じ設定なら必ず同じ曲になる */
export interface ComposeSettings {
  seed: number;
  style: StyleId;
  /** 壊れ度 0〜1（グリッチ・歪み・クラッシュの量） */
  chaos: number;
  /** 長さ（秒）：30 / 60 / 120 / 180 */
  lengthSec: number;
  bpm: number;
}

/** 曲に入れるおもちゃ（toy = 曲の中のおもちゃ番号、kind = どのおもちゃか） */
export interface ComposeToy {
  toy: number;
  kind: ToyKind;
}

export type ToyKind = 'blippy' | 'piko' | 'dj' | 'vroom' | 'typo' | 'tele' | 'sampler';

export interface ComposeRequest {
  settings: ComposeSettings;
  toys: ComposeToy[];
  /** 今の曲（鍵の付いたトラックを残す・セクションだけ作り直すときに使う） */
  base?: Song;
  /** このセクション（番号）だけ作り直す */
  section?: number;
  /** カバー：取り込んだ曲の解析（あれば、構成・コード・メロディ・ベース・ドラムをこれに合わせる） */
  cover?: CoverSource;
}

export interface Composer {
  readonly id: string;
  readonly name: string;
  compose(req: ComposeRequest): Song;
}

/** 曲データに残す「どう作ったか」（URL 共有・セクションの作り直しに使う） */
export interface ComposeInfo {
  engine: string;
  settings: ComposeSettings;
  toys: ComposeToy[];
  /** セクションごとの作り直し回数（乱数を変えるため） */
  salt?: Record<number, number>;
  /** カバーの元（解析結果。音そのものは入れない） */
  cover?: CoverSource;
}
