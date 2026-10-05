// 解析した曲 → 作曲係が読む設計図（Plan）。構成・テンポ・コードは解析どおり、メロディ・ベース・ドラムも解析の音符を渡す。
// 作曲係の共通の道具（harmony.ts の drumBar・realize・bassLine）が plan.cover を見て、作る代わりに解析の音を返す。
// だから 7 台のどのおもちゃでも、いつもの作曲係のまま「カバー」になる。
import type { Plan, PlannedSection } from '../compose/plan';
import { styleOf } from '../compose/styles';
import type { ComposeSettings } from '../compose/types';
import type { CoverAnalysis, CoverDrumBar, CoverNote } from './analyze';
import type { CoverKit } from './sampling';

/** 曲データに残すカバーの元（音そのものは残さない。作り直し・セクションの作り直しに使う） */
export interface CoverSource extends Omit<CoverAnalysis, 'beats' | 'pitch'> {
  title: string;
  /** サンプラーで使う、元の曲から切り出した音（MANEKKO が作ったバンク） */
  samplerKit?: { bank: number; kit: CoverKit };
  /** 使う範囲（小節）。to は含まない */
  from: number;
  to: number;
}

/** 作曲係に渡す解析の音（範囲の頭を 0 拍とする） */
export interface CoverPart {
  melody: CoverNote[];
  bass: CoverNote[];
  drums: CoverDrumBar[];
  samplerKit?: { bank: number; kit: CoverKit };
}

/** 解析結果から、曲データに残す元を作る（拍の時刻・フレームごとの高さは大きいので捨てる） */
export function coverSource(a: CoverAnalysis, title: string, from = 0, to = a.bars): CoverSource {
  const { beats: _beats, pitch: _pitch, ...rest } = a;
  void _beats; void _pitch;
  return { ...rest, title, from, to };
}

export function coverPlan(settings: ComposeSettings, src: CoverSource): Plan {
  const base = styleOf(settings.style);
  // ハネた曲は、元の曲のハネで（解析の音符はハネを戻した位置にあるので、作曲係がハネをつけ直す）
  const style = src.swing ? { ...base, swing: [src.swing, 0.5] as [number, number] } : base;
  const from = Math.max(0, Math.min(src.bars - 1, Math.floor(src.from)));
  const to = Math.max(from + 1, Math.min(src.bars, Math.floor(src.to)));
  const bars = to - from;
  const b0 = from * 4, b1 = to * 4;
  const inRange = (n: CoverNote) => n.t >= b0 && n.t < b1;
  const move = (n: CoverNote) => ({ ...n, t: n.t - b0, len: Math.min(n.len, b1 - n.t) });
  const cover: CoverPart = {
    melody: src.melody.filter(inRange).map(move),
    bass: src.bass.filter(inRange).map(move),
    drums: src.drums.slice(from, to),
    samplerKit: src.samplerKit,
  };
  // 構成：範囲で切る。メロディのあるセクションは「イントロ（メロディを休む）」にしない
  const sections: PlannedSection[] = [];
  for (const s of src.sections) {
    const a = Math.max(s.start, from), b = Math.min(s.start + s.bars, to);
    if (b <= a) continue;
    const start = (a - from) * 4, end = (b - from) * 4;
    const hasMel = cover.melody.some((n) => n.t >= start && n.t < end);
    sections.push({
      index: sections.length,
      name: s.name,
      kind: s.kind === 'intro' && hasMel ? 'verse' : s.kind,
      start,
      bars: b - a,
      energy: hasMel ? Math.max(0.45, s.energy) : s.energy,
      chaos: Math.min(1.6, settings.chaos * 0.8),
    });
  }
  if (!sections.length) sections.push({ index: 0, name: 'Aメロ', kind: 'verse', start: 0, bars, energy: 0.7, chaos: settings.chaos });
  const half = src.chordsHalf?.slice(from * 2, to * 2);
  // クラッシュは、壊れ度をかなり上げたときだけ（ブレイクで）
  const crashSection = settings.chaos >= Math.max(0.85, style.crashAt) ? sections.findIndex((s) => s.kind === 'break') : -1;
  return {
    settings: { ...settings, bpm: Math.round(src.bpm) },
    style,
    bpm: Math.round(src.bpm),
    bars,
    sections,
    chords: src.chords.slice(from, to),
    // 小節の途中でコードが変わる所があるときだけ、半小節ごとのコードも渡す
    chordsHalf: half && half.some((d, i) => i % 2 === 1 && d !== half[i - 1]) ? half : undefined,
    crashSection,
    cover,
  };
}
