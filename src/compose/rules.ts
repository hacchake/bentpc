// ルール＋シード付き乱数の作曲（AI は使わない。オフライン・無料で動く）。
// 1. 設計図（構成・盛り上がり・壊れ度・コード・クラッシュ）を作る（plan.ts）
// 2. おもちゃごとの作曲係がパート（トラック）を作る（toys/*.ts）
// 3. 鍵の付いたトラックは残す。セクションだけ作り直すときは、その範囲だけ差し替える
import { trackToy, type SeqTrack, type Song } from '../core/song';
import { planSong, rngFor } from './plan';
import { coverPlan } from '../cover/plan';
import { swingTime } from './harmony';
import { styleOf } from './styles';
import { composeBlippy } from './toys/blippy';
import { composeDj } from './toys/dj';
import { composePiko } from './toys/piko';
import { composeTele } from './toys/tele';
import { composeTypo } from './toys/typo';
import { composeVroom } from './toys/vroom';
import { composeSampler } from './toys/sampler';
import type { Part, PartContext } from './context';
import { arrangeEnsemble } from './ensemble';
import type { ComposeInfo, ComposeRequest, Composer, ToyKind } from './types';

type PartComposer = (ctx: PartContext) => Part[];

/** おもちゃごとの作曲係（まだ無いおもちゃは空） */
export const PART_COMPOSERS: Partial<Record<ToyKind, PartComposer>> = {
  blippy: composeBlippy,
  piko: composePiko,
  dj: composeDj,
  vroom: composeVroom,
  typo: composeTypo,
  tele: composeTele,
  sampler: composeSampler,
};

export class RuleComposer implements Composer {
  readonly id = 'rules';
  readonly name = 'ルール＋シード';

  compose(req: ComposeRequest): Song {
    const base = req.base;
    // セクションだけ作り直すときは、元の曲と同じ設定で作る（構成がずれないように）
    const settings = req.section !== undefined && base?.compose ? base.compose.settings : req.settings;
    const salt: Record<number, number> = { ...(req.section !== undefined ? base?.compose?.salt : undefined) };
    if (req.section !== undefined) salt[req.section] = (salt[req.section] ?? 0) + 1;
    // カバー：取り込んだ曲の解析から設計図を作る（セクションだけ作り直すときは、元の曲のカバーを使う）
    const cover = req.cover ?? (req.section !== undefined ? base?.compose?.cover : undefined);
    const plan = cover ? coverPlan(settings, cover) : planSong(settings);
    const info: ComposeInfo = { engine: this.id, settings: plan.settings, toys: req.toys, salt, ...(cover ? { cover } : {}) };

    const generated: Part[] = [];
    for (const t of req.toys) {
      const f = PART_COMPOSERS[t.kind];
      if (!f) continue;
      generated.push(...f({
        plan,
        toy: t.toy,
        rng: (part, sec) => rngFor(settings.seed, t.kind, t.toy, part, sec ?? 'song', sec !== undefined ? salt[sec] ?? 0 : 0),
      }));
    }

    // 何台かいっしょのとき：役割分担・掛け合い・片方だけ残るブレイク
    const arranged = [...arrangeEnsemble(plan, req.toys, generated)];
    generated.length = 0;
    generated.push(...arranged);
    // スイング（ジャズ・レゲエ・ヒップホップなど）：裏の音を少し遅らせて跳ねさせる（ボタン・電源・クラッシュは動かさない）
    if (plan.style.swing) for (const g of generated) g.notes = g.notes.map((n) => (n.key < 2000 ? { ...n, start: swingTime(plan, n.start) } : n));

    // 元の曲のトラック（おもちゃ番号をはっきり書いておく。並べ替えてもずれないように）
    const baseTracks: SeqTrack[] = base ? base.tracks.map((tr, i) => ({ ...tr, toy: trackToy(base, i) })) : [];
    let tracks: SeqTrack[];
    if (req.section !== undefined && base) {
      // ---- セクションだけ作り直す：鍵の無い自動作曲トラックの、その範囲だけ差し替える ----
      const s = plan.sections[req.section];
      const a = s.start, b = s.start + s.bars * 4;
      const inR = (t: number) => t >= a && t < b;
      tracks = baseTracks.map((tr) => {
        if (tr.lock || !tr.part) return tr;
        const g = generated.find((x) => x.part === tr.part && x.toy === tr.toy);
        if (!g) return tr;
        return {
          ...tr,
          notes: [...tr.notes.filter((n) => !inR(n.start)), ...g.notes.filter((n) => inR(n.start))].sort((p, q) => p.start - q.start),
          autos: [...tr.autos.filter((x) => !inR(x.t)), ...g.autos.filter((x) => inR(x.t))].sort((p, q) => p.t - q.t),
        };
      });
    } else {
      // ---- 作り直す：鍵の付いたトラックだけ残す（ほかのおもちゃの曲と重ねたいときも、鍵を掛けておけば残る） ----
      const kept = baseTracks.filter((tr) => tr.lock);
      const fresh = generated.filter((g) => !kept.some((k) => k.part === g.part && k.toy === g.toy));
      tracks = [...kept, ...fresh].sort((p, q) => p.toy! - q.toy!);
    }
    const style = styleOf(settings.style);
    return {
      version: 1,
      title: cover ? `${cover.title}（${style.name}カバー）` : `${style.name} #${settings.seed}`,
      bpm: plan.bpm,
      bars: plan.bars,
      metronome: false,
      seed: settings.seed,
      ramp: true,
      loop: { on: false, start: 0, end: plan.bars * 4 },
      sections: plan.sections.map((x) => ({ name: x.name, start: x.start })),
      tracks,
      compose: info,
    };
  }
}

/** 使える作曲方法（将来ここに「言葉から作る」などを足す） */
export const COMPOSERS: Record<string, Composer> = { rules: new RuleComposer() };
export const defaultComposer = () => COMPOSERS.rules;
