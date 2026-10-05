// PIKOTONE PT-32 の作曲係。4 つのパート：
//   chords … 鍵盤でコード（素朴・アンビエントは伸ばす、ビートは裏打ち）。セクションごとに ORCHESTRA の音色を変える
//   lead   … 鍵盤でメロディ（モチーフの繰り返し）
//   rhythm … 内蔵リズム（TEMPO を曲に合わせて START / STOP）＋ドラムパッド（4 小節目のフィル）
//   mods   … 電源・クラッシュ・電圧 Starve（AMP / CPU POWER）・FIZZ・DIST・HIPASS・FEEDBACK・ピッチ曲げ・GLITCH・VIBRATO
import { bassLine, compHits, degToMidi, drumBar, lerp, makeMotif, realize, steps, hitMidi } from '../harmony';
import { powerAndCrash, type Part, type PartContext } from '../context';
import { PartWriter } from '../writer';
import { PIKO_INDEX } from '../../toys/piko/params';

const P = PIKO_INDEX; // パラメーター番号は表から引く
const FIRST = 53; // F3
const key = (midi: number) => {
  let m = midi;
  while (m < FIRST) m += 12;
  while (m > FIRST + 31) m -= 12;
  return m - FIRST;
};
const PAD = 32, START = 37, STOP = 38; // パッド 32〜35 = KICK SNARE HAT TOM
/** ORCHESTRA：0 ORGAN 1 VIOLIN 2 PIANO 3 HORN 4 FLUTE 5 GUITAR 6 MUSIC BOX 7 BANJO */
const TONES: Record<string, number[]> = {
  plain: [2, 6, 4], beat: [0, 5, 3], ambient: [1, 4, 6], noise: [0, 3, 7], collapse: [2, 0, 1],
  enka: [1, 4], ondo: [4, 7], douyou: [6, 4, 2], march: [3, 4], chip: [6, 0], punk: [5, 0], lofi: [2, 6],
  reggae: [0, 5], dub: [0, 2], ska: [3, 0], bossa: [5, 4], funk: [0, 5], jazz: [2, 3],
  house: [0, 2], techno: [0, 6], dnb: [1, 0], jungle: [0, 5], trap: [6, 1], gabber: [0, 3], idm: [6, 7, 1], breakcore: [7, 0, 3],
};

export function composePiko(ctx: PartContext): Part[] {
  const { plan } = ctx;
  const end = plan.bars * 4;
  const chords = new PartWriter(ctx.toy, 'piko:chords', 'PIKOTONE コード');
  const lead = new PartWriter(ctx.toy, 'piko:lead', 'PIKOTONE メロディ');
  const rhythm = new PartWriter(ctx.toy, 'piko:rhythm', 'PIKOTONE リズム');
  const mods = new PartWriter(ctx.toy, 'piko:mods', 'PIKOTONE 改造パーツ');
  const style = plan.style.id;
  const song = ctx.rng('song');
  const motifs = new Map<string, ReturnType<typeof makeMotif>>();

  mods.set(P.volume, 0, 0.7);
  mods.set(P.ampPower, 0, 1);
  mods.set(P.cpuPower, 0, 1);
  mods.set(P.pitchOn, 0, 0);
  // 内蔵リズムのテンポを曲に合わせる（60〜200 BPM）
  rhythm.set(P.tempo, 0, Math.max(0, Math.min(1, (plan.bpm - 60) / 140)));
  let rhythmOn = false;
  void song;
  const groove = plan.style.pikoRhythm; // -1 = 内蔵リズムを使わず、パッドで刻む

  for (const sec of plan.sections) {
    const rc = ctx.rng('chords', sec.index);
    const rl = ctx.rng('lead', sec.index);
    const rr = ctx.rng('rhythm', sec.index);
    const rx = ctx.rng('mods', sec.index);
    const s0 = sec.start, sEnd = s0 + sec.bars * 4;
    const heat = sec.chaos * plan.style.glitch;
    chords.set(P.instrument, Math.max(0, s0 - 0.05), rc.pick(TONES[style] ?? [0, 2, 5]));

    // ---- chords ----
    // スタイルの弾き方（伸ばす・裏打ち・アルペジオ・ブロック・ボサノバの刻みなど）
    for (const h of compHits(plan, sec)) for (let i = 0; i < h.degs.length; i++) {
      const m = hitMidi(h, i, 60);
      chords.note(key(m > 71 ? m - 12 : m), h.t, h.len);
    }
    // ---- lead：セクションの種類ごとのモチーフ ----
    if (sec.kind !== 'intro' || style === 'plain') {
      if (!motifs.has(sec.kind)) motifs.set(sec.kind, makeMotif(ctx.rng(`motif-${sec.kind}`), plan.style.notesPerBar * (0.5 + 0.6 * sec.energy)));
      for (const n of realize(plan, sec, motifs.get(sec.kind)!, [4, 14], { stretch: style === 'ambient' ? 2 : 1 })) lead.note(key(degToMidi(n.deg, 60) + (n.acc ?? 0)), n.t, n.len);
    } else {
      // イントロはベースの音だけ
      for (const n of bassLine(plan, sec, rl)) lead.note(key(degToMidi(n.deg, 48) + (n.acc ?? 0)), n.t, n.len);
    }

    // ---- rhythm：盛り上がるセクションでは内蔵リズムを回す ----
    const want = sec.energy >= 0.4 && plan.style.drums !== 'none' && plan.style.drums !== 'sparse';
    if (want && groove < 0) {
      // 内蔵リズムに合う型が無いスタイル（ドラムンベース・IDM など）：パッドでスタイルのドラムを刻む
      for (let b = 0; b < sec.bars; b++) {
        const d = drumBar(plan, sec, b, rr);
        if (!d) continue;
        const t0 = s0 + b * 4;
        steps(d.kick, t0, (t) => rhythm.note(PAD, t, 0.15));
        steps(d.snare, t0, (t) => rhythm.note(PAD + 1, t, 0.15));
        steps(d.hat, t0, (t) => rhythm.note(PAD + 2, t, 0.1));
      }
    } else if (want) {
      rhythm.set(P.rhythm, Math.max(0, s0 - 0.1), sec.kind === 'chorus' ? (groove + 1) % 8 : groove);
      // 区切りごとに頭から回し直す（ずれないように）
      for (let b = 0; b < sec.bars; b += 4) {
        if (rhythmOn || b > 0) rhythm.note(STOP, s0 + b * 4 - 0.02, 0.01);
        rhythm.note(START, s0 + b * 4, 0.1);
      }
      rhythmOn = true;
    } else if (rhythmOn) {
      rhythm.note(STOP, s0, 0.1);
      rhythmOn = false;
    }
    // フィル（4 小節目）はパッドで（内蔵リズムのとき）
    for (let b = 3; b < sec.bars; b += 4) {
      if (groove < 0 || (!want && sec.energy < 0.3)) continue;
      const t0 = s0 + b * 4;
      for (let i = 0; i < 4; i++) if (rr.chance(0.7)) rhythm.note(PAD + (i === 3 ? 3 : i % 2 ? 1 : 0), t0 + 2 + i * 0.5, 0.2);
    }

    // ---- mods ----
    // 電圧 Starve：壊れるほど電圧が下がる（音が遅く・低く・よれる）
    const starve = Math.min(0.6, heat * 0.35);
    mods.ramp(P.cpuPower, s0, 1 - starve * 0.3, sEnd - 0.5, 1 - starve);
    mods.set(P.ampPower, s0, 1 - Math.min(0.4, heat * 0.15));
    mods.ramp(P.fizz, s0, 0, sEnd - 0.5, Math.min(0.8, heat * sec.energy * 0.6));
    mods.ramp(P.dist, s0, 0, sEnd - 0.5, Math.min(0.8, heat * sec.energy * 0.7));
    mods.set(P.hipass, s0, sec.kind === 'break' || sec.kind === 'intro' ? 0.4 : 0);
    mods.ramp(P.feedback, s0, 0, sEnd - 0.5, style === 'ambient' ? 0.45 : Math.min(0.6, heat * 0.3));
    mods.set(P.feedbackMode, s0, style === 'ambient' ? 1 : 0);
    mods.set(P.vibrato, s0, style === 'ambient' || sec.kind === 'outro' ? 1 : 0);
    mods.set(P.glitch, s0, heat > 0.8 && rx.chance(0.6) ? 1 : 0);
    // ピッチ曲げのタッチポイント：盛り上がりの最後の 1 小節で指を当てる
    if (sec.energy > 0.6 && sec.bars >= 4) {
      mods.set(P.bendTouch1, sEnd - 4, 0);
      mods.ramp(P.bendTouch1, sEnd - 3.9, 0, sEnd - 0.5, lerp(0.3, 1, sec.chaos));
      mods.set(P.bendTouch1, sEnd - 0.1, 0);
    }
  }
  if (rhythmOn) rhythm.note(STOP, end - 0.25, 0.1);

  powerAndCrash(plan, mods, [chords, lead, rhythm], 1);
  return [chords.finish(end), lead.finish(end), rhythm.finish(end), mods.finish(end)];
}
