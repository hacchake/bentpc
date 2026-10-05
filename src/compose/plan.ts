// 曲の設計図：まず構成（セクションと長さ）・盛り上がりと壊れ度のカーブ・コード進行・クラッシュの場所を決める。
// 中身（音符）は、この設計図を見て各おもちゃの作曲係が作る。
import { Rng, hashSeed } from '../core/rng';
import { styleOf, type SectionKind, type StyleDef } from './styles';
import type { ComposeSettings } from './types';
import type { CoverPart } from '../cover/plan';

export interface PlannedSection {
  index: number;
  name: string;
  kind: SectionKind;
  /** 始まり（拍）と長さ（小節） */
  start: number;
  bars: number;
  energy: number;
  /** このセクションの壊れ度（0〜1.5 くらい）= 設定の壊れ度 × スタイルの倍率 */
  chaos: number;
}

export interface Plan {
  settings: ComposeSettings;
  style: StyleDef;
  bpm: number;
  bars: number;
  sections: PlannedSection[];
  /** 小節ごとのコード（ハ長調の度数 0 = C, 1 = Dm, … 5 = Am） */
  chords: number[];
  /** クラッシュさせるセクション（無ければ -1） */
  crashSection: number;
  /** カバー（取り込んだ曲の解析）：あれば、メロディ・ベース・ドラムを作らずにこれを使う（cover/plan.ts） */
  cover?: CoverPart;
}

/** コード進行の候補（度数）。どれを使うかはシードで決まる */
export const PROGRESSIONS = [
  [0, 4, 5, 3], // C G Am F
  [5, 3, 0, 4], // Am F C G
  [0, 5, 3, 4], // C Am F G
  [0, 3, 0, 4], // C F C G
  [5, 4, 3, 4], // Am G F G
  [1, 4, 0, 5], // Dm G C Am
  [3, 4, 5, 5], // F G Am Am
];

/** 乱数：用途（名前）ごとに別の流れにする。同じシード・同じ名前なら必ず同じ並び */
export const rngFor = (seed: number, ...name: (string | number)[]) => new Rng(hashSeed(seed, ...name));

export function planSong(settings: ComposeSettings): Plan {
  const style = styleOf(settings.style);
  const bpm = Math.round(Math.max(40, Math.min(240, settings.bpm)));
  const total = Math.max(8, Math.round((settings.lengthSec * bpm) / 240 / 2) * 2);
  // 短い曲では、優先度の低いセクションを省く
  const minNeed = total < 16 ? 3 : total < 32 ? 2 : total < 48 ? 1 : 0;
  let tpls = style.sections.filter((s) => s.need >= minNeed);
  while (tpls.length * 2 > total && tpls.length > 1) tpls = tpls.filter((s) => s !== [...tpls].sort((a, b) => a.need - b.need)[0]);
  // 重みで長さを配る（2 小節単位、最低 2 小節）
  const wsum = tpls.reduce((s, t) => s + t.w, 0);
  const bars = tpls.map((t) => Math.max(2, Math.round(((t.w / wsum) * total) / 2) * 2));
  let diff = total - bars.reduce((s, b) => s + b, 0);
  while (diff !== 0) {
    // いちばん長い（足すときは重いもの、引くときは 2 小節より長いもの）で調整
    const order = bars.map((b, i) => i).sort((a, b) => bars[b] - bars[a]);
    const i = diff > 0 ? order[0] : order.find((j) => bars[j] > 2) ?? order[0];
    const step = diff > 0 ? 2 : -2;
    if (bars[i] + step < 2) break;
    bars[i] += step;
    diff -= step;
  }
  let start = 0;
  const sections: PlannedSection[] = tpls.map((t, index) => {
    const s = { index, name: t.name, kind: t.kind, start, bars: bars[index], energy: t.energy, chaos: Math.min(1.6, settings.chaos * t.chaos) };
    start += bars[index] * 4;
    return s;
  });
  const barsTotal = start / 4;
  // コード進行
  const r = rngFor(settings.seed, 'plan');
  const prog = r.pick(style.progs.length ? style.progs : PROGRESSIONS);
  const chords = Array.from({ length: barsTotal }, (_, b) => prog[Math.floor(b / style.chordBars) % prog.length]);
  // クラッシュ：崩壊セクション、または壊れ度がしきい値を超えたらブレイクで
  let crashSection = sections.findIndex((s) => s.kind === 'collapse');
  if (crashSection < 0 && settings.chaos >= style.crashAt) crashSection = sections.findIndex((s) => s.kind === 'break');
  return { settings, style, bpm, bars: barsTotal, sections, chords, crashSection };
}

/** 拍 → そのときのセクション */
export const sectionAt = (plan: Plan, beat: number) => plan.sections.find((s) => beat >= s.start && beat < s.start + s.bars * 4) ?? plan.sections[plan.sections.length - 1];
