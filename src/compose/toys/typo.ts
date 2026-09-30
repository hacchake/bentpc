// TYPOTRON TT-109 の作曲係。3 つのパート：
//   notes … 文字キーの段で弾く（1 段上がると 3 音上がる）。メロディ＋コードの和音（音階は MAJOR のまま）
//   drums … テンキーのドラム（KICK・SNARE・HAT・CLAP・COW・ZAP・CRASH など）
//   fx    … 電源・クラッシュ・キーボードの故障（GHOST・SCAN・BOUNCE・OVERFLOW）・STUTTER / CORRUPT キー・WAVE・
//           DRIVE / CRUSH / ECHO / DECAY / TONE のノブ
import { TYPO_INDEX, TYPO_KEYS } from '../../toys/typo/params';
import { compHits, drumBar, lerp, makeMotif, realize, steps } from '../harmony';
import { powerAndCrash, type Part, type PartContext } from '../context';
import { PartWriter } from '../writer';

const P = TYPO_INDEX;
const ROW_OFFSET = 3; // 1 段上がるごとに 3 音階分
/** 音階の段（0 = C3）→ そのキー（段・列）。無ければ近い段で */
const noteKey = (deg: number): number => {
  for (let row = Math.min(3, Math.floor(deg / ROW_OFFSET)); row >= 0; row--) {
    const col = deg - row * ROW_OFFSET;
    const i = TYPO_KEYS.findIndex((k) => k.role.r === 'note' && k.role.row === row && k.role.col === col);
    if (i >= 0) return i;
  }
  return TYPO_KEYS.findIndex((k) => k.role.r === 'note');
};
const drumKey = (n: number) => TYPO_KEYS.findIndex((k) => k.role.r === 'drum' && k.role.n === n);
const fnKey = (f: string) => TYPO_KEYS.findIndex((k) => k.role.r === 'fn' && k.role.f === f);
const D = { kick: 0, snare: 1, hat: 2, open: 3, tomL: 4, tomH: 5, clap: 6, cow: 7, zap: 8, crash: 9 };

export function composeTypo(ctx: PartContext): Part[] {
  const { plan } = ctx;
  const end = plan.bars * 4;
  const notes = new PartWriter(ctx.toy, 'typo:notes', 'TYPOTRON 音');
  const drums = new PartWriter(ctx.toy, 'typo:drums', 'TYPOTRON ドラム');
  const fx = new PartWriter(ctx.toy, 'typo:fx', 'TYPOTRON 故障・ノブ');
  const style = plan.style.id;
  const motifs = new Map<string, ReturnType<typeof makeMotif>>();

  // 音階は MAJOR（曲がハ長調なので）。音色とノブの初期値
  fx.set(P.scale, 0, 0);
  fx.set(P.volume, 0, 0.7);
  for (const id of ['ghost', 'scan', 'bounce', 'overflow'] as const) fx.set(P[id], 0, 0);
  const stutter = fnKey('stutter'), corrupt = fnKey('corrupt');

  for (const sec of plan.sections) {
    const rn = ctx.rng('notes', sec.index);
    const rd = ctx.rng('drums', sec.index);
    const rx = ctx.rng('fx', sec.index);
    const s0 = sec.start, sEnd = s0 + sec.bars * 4;
    const heat = sec.chaos * plan.style.glitch;
    fx.set(P.wave, Math.max(0, s0 - 0.05), style === 'noise' ? rx.pick([1, 3]) : style === 'ambient' ? 2 : rx.int(3));

    // ---- notes：メロディ（上の段）と、小節の頭の和音（下の段） ----
    if (!motifs.has(sec.kind)) motifs.set(sec.kind, makeMotif(ctx.rng(`motif-${sec.kind}`), plan.style.notesPerBar * (0.5 + 0.6 * sec.energy)));
    if (sec.kind !== 'intro' || style === 'plain') {
      for (const n of realize(plan, sec, motifs.get(sec.kind)!, [7, 16], { stretch: style === 'ambient' ? 2 : 1 })) notes.note(noteKey(n.deg), n.t, n.len);
    }
    // 伴奏：スタイルの弾き方（裏打ち・アルペジオ・ブロックなど）で、下の段の和音
    for (const h of compHits(plan, sec)) for (const d of h.degs) notes.note(noteKey(d), h.t, h.len);

    // ---- drums ----
    for (let b = 0; b < sec.bars; b++) {
      const d = drumBar(plan, sec, b, rd);
      if (!d) continue;
      const t0 = s0 + b * 4;
      steps(d.kick, t0, (t) => drums.note(drumKey(D.kick), t, 0.15));
      steps(d.snare, t0, (t) => drums.note(drumKey(sec.energy > 0.8 && rd.chance(0.3) ? D.clap : D.snare), t, 0.15));
      steps(d.hat, t0, (t) => drums.note(drumKey(D.hat), t, 0.1));
      if (b % 4 === 0 && sec.energy > 0.7) drums.note(drumKey(D.crash), t0, 0.3);
      if (style === 'noise' && rd.chance(0.5)) drums.note(drumKey(D.zap), t0 + 3.75, 0.1);
      if (style === 'plain' && b % 2 === 1 && rd.chance(0.4)) drums.note(drumKey(D.cow), t0 + 3.5, 0.1);
    }

    // ---- fx：故障とノブ ----
    fx.ramp(P.drive, s0, 0, sEnd - 0.5, Math.min(0.8, heat * sec.energy * 0.6));
    fx.ramp(P.crush, s0, 0, sEnd - 0.5, Math.min(0.7, heat * sec.energy * 0.45));
    fx.set(P.echo, s0, style === 'ambient' ? 0.55 : lerp(0.1, 0.35, sec.energy));
    fx.set(P.decay, s0, style === 'ambient' ? 0.8 : lerp(0.5, 0.25, sec.energy));
    fx.set(P.tone, s0, lerp(0.5, 0.85, sec.energy));
    fx.set(P.ghost, s0, heat > 0.5 && rx.chance(0.5) ? 1 : 0);
    fx.set(P.scan, s0, heat > 0.8 && rx.chance(0.4) ? 1 : 0);
    fx.set(P.bounce, s0, heat > 0.6 && sec.energy > 0.6 && rx.chance(0.5) ? 1 : 0);
    fx.set(P.overflow, s0, heat > 1.1 ? 1 : 0);
    // STUTTER はフレーズの終わりの 1 拍、CORRUPT は壊れているセクションでときどき
    for (let b = 3; b < sec.bars; b += 4) if (stutter >= 0 && sec.energy > 0.5) fx.note(stutter, s0 + b * 4 + 3, 0.9);
    if (corrupt >= 0 && heat > 0.9) for (let b = 1; b < sec.bars; b += 2) if (rx.chance(0.5)) fx.note(corrupt, s0 + b * 4 + 2, 0.3);
  }

  powerAndCrash(plan, fx, [notes, drums], 0.5);
  return [notes.finish(end), drums.finish(end), fx.finish(end)];
}
