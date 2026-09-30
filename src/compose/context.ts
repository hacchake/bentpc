// 作曲係に渡す共通の材料
import type { Rng } from '../core/rng';
import { SYS_CRASH, SYS_POWER_ON, type SeqTrack } from '../core/song';
import { crashSpan } from './harmony';
import type { Plan } from './plan';
import type { PartWriter } from './writer';

export interface PartContext {
  plan: Plan;
  /** 曲の中のおもちゃ番号 */
  toy: number;
  /** 乱数：パート名＋セクション番号ごと（セクションだけ作り直すとき、そのセクションの乱数だけ変わる） */
  rng(part: string, section?: number): Rng;
}

export type Part = SeqTrack & { part: string };

/**
 * 電源とクラッシュを入れて、起動中・クラッシュ中の音符を消す（押しても鳴らない・無音の演出を守る）。
 * system = 電源・クラッシュを書くパート、bootBeats = 電源を入れてから音が出るまでの拍
 */
export function powerAndCrash(plan: Plan, system: PartWriter, parts: PartWriter[], bootBeats: number): { start: number; end: number } | null {
  system.note(SYS_POWER_ON, 0, 0.5);
  const crash = crashSpan(plan);
  if (crash) system.note(SYS_CRASH, crash.start, crash.end - crash.start);
  for (const p of parts) {
    p.clear(0, bootBeats, (n) => n.key >= 2000);
    if (crash) p.clear(crash.start, crash.end + bootBeats, (n) => n.key === SYS_CRASH);
  }
  return crash;
}
