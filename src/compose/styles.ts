// スタイルごとの作曲ルールの表。「このスタイルはもっと〇〇」と言われたら、まずここの数字を変える。
//
// sections：曲の構成（name = 表示名、kind = 中身の作り方、w = 長さの重み、energy = 盛り上がり 0〜1、
//           chaos = 壊れ度の倍率、need = 短い曲でも残す優先度（大きいほど残る））
// そのほか：テンポ、グリッチの多さ、クラッシュの入れやすさ、トイPC の使い方の傾向

import type { StyleId } from './types';

export type SectionKind = 'intro' | 'verse' | 'build' | 'chorus' | 'break' | 'outro' | 'drift' | 'swell' | 'noise' | 'collapse';

export interface SectionTpl {
  name: string;
  kind: SectionKind;
  w: number;
  energy: number;
  chaos: number;
  need: number;
}

export interface StyleDef {
  id: StyleId;
  name: string;
  /** 既定のテンポと、つまみで動かせる範囲 */
  bpm: number;
  bpmRange: [number, number];
  sections: SectionTpl[];
  /** 1 小節あたりのコードの長さ（小節） */
  chordBars: number;
  /** グリッチの多さ（壊れ度に掛ける） */
  glitch: number;
  /** クラッシュを入れる壊れ度のしきい値（これ以上ならブレイクでクラッシュ）。1 を超えると入れない */
  crashAt: number;
  /** メロディの細かさ：1 小節に入る音の数のめやす */
  notesPerBar: number;
  /** ブレイクで片方だけ残す・音数を減らす度合い */
  sparseBreak: number;
}

const S = (name: string, kind: SectionKind, w: number, energy: number, chaos: number, need: number): SectionTpl => ({ name, kind, w, energy, chaos, need });

export const STYLES: Record<StyleId, StyleDef> = {
  plain: {
    id: 'plain', name: '素朴', bpm: 108, bpmRange: [84, 132], chordBars: 1, glitch: 0.35, crashAt: 1.1, notesPerBar: 4, sparseBreak: 0.5,
    sections: [
      S('イントロ', 'intro', 4, 0.2, 0.2, 3), S('Aメロ', 'verse', 8, 0.4, 0.3, 5), S('Aメロ2', 'verse', 8, 0.45, 0.4, 1),
      S('サビ', 'chorus', 8, 0.65, 0.5, 4), S('ラスト', 'outro', 4, 0.3, 0.3, 2),
    ],
  },
  beat: {
    id: 'beat', name: 'ビート', bpm: 124, bpmRange: [100, 150], chordBars: 1, glitch: 0.8, crashAt: 0.55, notesPerBar: 6, sparseBreak: 0.8,
    sections: [
      S('イントロ', 'intro', 4, 0.3, 0.3, 3), S('Aメロ', 'verse', 8, 0.5, 0.4, 5), S('展開', 'build', 8, 0.7, 0.8, 2),
      S('サビ', 'chorus', 8, 0.95, 1, 4), S('ブレイク', 'break', 4, 0.3, 1.2, 1), S('ラスト', 'chorus', 8, 1, 1.1, 2), S('エンド', 'outro', 2, 0.4, 0.5, 1),
    ],
  },
  ambient: {
    id: 'ambient', name: 'アンビエント', bpm: 80, bpmRange: [60, 100], chordBars: 2, glitch: 0.3, crashAt: 1.1, notesPerBar: 1.5, sparseBreak: 0.4,
    sections: [
      S('はじまり', 'intro', 6, 0.15, 0.2, 3), S('ただよう', 'drift', 12, 0.3, 0.4, 5), S('ふくらむ', 'swell', 8, 0.55, 0.6, 3),
      S('ただよう2', 'drift', 8, 0.3, 0.5, 1), S('おわり', 'outro', 6, 0.15, 0.3, 2),
    ],
  },
  noise: {
    id: 'noise', name: 'ノイズ', bpm: 132, bpmRange: [100, 170], chordBars: 1, glitch: 1.3, crashAt: 0.35, notesPerBar: 8, sparseBreak: 0.7,
    sections: [
      S('イントロ', 'intro', 2, 0.4, 0.6, 3), S('ノイズ', 'noise', 8, 0.7, 1, 5), S('サビ', 'chorus', 8, 1, 1.2, 4),
      S('ブレイク', 'break', 4, 0.3, 1.4, 2), S('ノイズ2', 'noise', 8, 0.9, 1.3, 1), S('エンド', 'outro', 2, 0.5, 1, 1),
    ],
  },
  collapse: {
    id: 'collapse', name: '崩壊', bpm: 116, bpmRange: [90, 140], chordBars: 1, glitch: 1, crashAt: 0, notesPerBar: 5, sparseBreak: 0.6,
    sections: [
      S('イントロ', 'intro', 4, 0.3, 0.3, 3), S('Aメロ', 'verse', 8, 0.5, 0.6, 4), S('展開', 'build', 8, 0.75, 1, 2),
      S('サビ', 'chorus', 8, 0.95, 1.3, 3), S('崩壊', 'collapse', 6, 0.6, 1.6, 5),
    ],
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];
export const LENGTHS = [30, 60, 120, 180];
