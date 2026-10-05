// MANEKKO MK-8（まねっこインコ）の作曲係。カバーのときだけ働く：テープ（元の歌・伴奏・元の曲）を 1 小節ごとの音符で鳴らす。
// キー k = 「k 小節目から鳴らす」なので、シーケンサーのどこから再生しても、カバーの拍とずれない。
// どの音を出すか（歌・伴奏・元の曲）はおもちゃのツマミ（VOCAL・KARAOKE・ORIGINAL）で決める。
import { powerAndCrash, type Part, type PartContext } from '../context';
import { PartWriter } from '../writer';

export function composeManekko(ctx: PartContext): Part[] {
  const { plan } = ctx;
  const tape = new PartWriter(ctx.toy, 'manekko:tape', 'MANEKKO テープ');
  const mods = new PartWriter(ctx.toy, 'manekko:mods', 'MANEKKO 電源');
  if (plan.cover) for (let b = 0; b < plan.bars; b++) tape.note(b, b * 4, 4);
  powerAndCrash(plan, mods, [tape], 0);
  return [tape.finish(plan.bars * 4), mods.finish(plan.bars * 4)];
}
