// 何台かいっしょに作ったときの「合奏のルール」（おもちゃの作曲係が作った後に整える）。
// ・役割分担：ビートは 1 台だけが刻む（ほかのおもちゃのドラム系パートは外す）
// ・掛け合い：Aメロ・展開では、メロディを持つおもちゃが 2 小節ずつ交代で弾く（呼びかけと返し）
// ・同時に壊れる：クラッシュはどのおもちゃも同じ区間（設計図で決まっている）
// ・片方だけ残るブレイク：ブレイクでは 1 台だけ残して、ほかは音符を消す（電源・クラッシュは残す）
import { rngFor, type Plan } from './plan';
import type { Part } from './context';
import type { ComposeToy, ToyKind } from './types';

/** ビートを刻むパート（おもちゃごと）。1 台だけ残す。上から順に優先 */
const BEAT_PARTS: [ToyKind, string][] = [['tele', 'tele:beat'], ['sampler', 'sampler:drums'], ['typo', 'typo:drums'], ['piko', 'piko:rhythm'], ['dj', 'dj:rhythm']];
/** メロディのパート（掛け合いをする） */
const MELODY_PARTS = ['blippy:melody', 'piko:lead', 'dj:keys', 'typo:notes', 'sampler:melody'];

export function arrangeEnsemble(plan: Plan, toys: ComposeToy[], parts: Part[]): Part[] {
  if (toys.length < 2) return parts;
  const r = rngFor(plan.settings.seed, 'ensemble');
  // ---- ビートは 1 台 ----
  const beat = BEAT_PARTS.find(([k]) => toys.some((t) => t.kind === k));
  let out = parts.filter((p) => !BEAT_PARTS.some(([, name]) => name === p.part) || (beat && p.part === beat[1] && p.toy === toys.find((t) => t.kind === beat[0])!.toy));
  // ---- 掛け合い：Aメロ・展開では 2 小節ずつ交代 ----
  const melodic = out.filter((p) => MELODY_PARTS.includes(p.part));
  if (melodic.length >= 2) {
    for (const sec of plan.sections) {
      if (sec.kind !== 'verse' && sec.kind !== 'build' && sec.kind !== 'drift') continue;
      const first = r.int(melodic.length);
      for (let b = 0; b < sec.bars; b += 2) {
        const owner = melodic[(first + b / 2) % melodic.length];
        const a = sec.start + b * 4, z = a + 8;
        for (const p of melodic) if (p !== owner) p.notes = p.notes.filter((n) => n.start < a || n.start >= z);
      }
    }
  }
  // ---- ブレイク：1 台だけ残す ----
  for (const sec of plan.sections) {
    if (sec.kind !== 'break') continue;
    const survivor = toys[r.int(toys.length)].toy;
    const a = sec.start, z = sec.start + sec.bars * 4;
    // まねっこのテープ（元の歌）は消さない
    out = out.map((p) => (p.toy === survivor || p.part === 'manekko:tape' ? p : { ...p, notes: p.notes.filter((n) => n.key >= 2000 || n.start < a || n.start >= z) }));
  }
  // ---- 音量：台数が多いほど少し下げる（音割れしないように） ----
  const k = Math.min(1, 1.3 / Math.sqrt(toys.length));
  out = out.map((p) => ({ ...p, autos: p.autos.map((x) => (x.index === 0 && isVolumePart(p.part) ? { ...x, v: x.v * k } : x)) }));
  return out;
}

/** 音量（パラメーター 0）を持つパート＝そのおもちゃの「改造パーツ」 */
const isVolumePart = (part: string) => /:(mods|fx)$/.test(part) || part === 'tele:mods';
