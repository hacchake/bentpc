// PAKU-PAKU 16（サンプラー）の作曲係。5 つのパート：
//   drums  … バンク A のドラム（1 KICK・2 SNARE・3 CL HAT・4 OP HAT・5 CLAP・11 BOOM・12 LOFI SN・13 CRASH）
//   bass   … BASS PAD の音を、音程を変えて弾くベース
//   melody … MELO PAD の音でメロディ
//   chords … MELO PAD の音で和音（1 オクターブ下・スタイルの弾き方）
//   mods   … 電源・クラッシュ・音量・BEND（壊れ度）・ワンショット（ZAP・SWEEP・RISER・LASER・GLITCH・VOX）
// パッドの中身はサンプラーのページで変えられる。工場出荷の並び（バンク A = ドラム、B = おもちゃの音）を前提に作る。
import { bassLine, compHits, degToMidi, drumBar, makeMotif, realize, steps } from '../harmony';
import { powerAndCrash, type Part, type PartContext } from '../context';
import { PartWriter } from '../writer';
import { BASS_KEY, BASS_ROOT_KEY, BASS_ROOT_MIDI, KEY_COUNT, MELO_KEY, MELO_ROOT_KEY, MELO_ROOT_MIDI, SP } from '../../sampler/toy/engine';

/** パッド番号（バンク A・B の工場出荷の並び） */
const PAD = { kick: 0, snare: 1, hat: 2, ohat: 3, clap: 4, boom: 10, lofiSn: 11, crash: 12, zap: 14, sweep: 15, vox: 19, glitch: 23, riser: 26, laser: 27 };
const BOOT_BEATS = 1;
const clampKey = (k: number, lo: number, hi: number) => Math.max(lo, Math.min(hi - 1, k));
const meloKey = (midi: number) => clampKey(MELO_ROOT_KEY + (midi - MELO_ROOT_MIDI), MELO_KEY, BASS_KEY);
const bassKey = (midi: number) => clampKey(BASS_ROOT_KEY + (midi - BASS_ROOT_MIDI), BASS_KEY, KEY_COUNT);

export function composeSampler(ctx: PartContext): Part[] {
  const { plan } = ctx;
  const end = plan.bars * 4;
  const drums = new PartWriter(ctx.toy, 'sampler:drums', 'PAKU-PAKU ドラム');
  const bass = new PartWriter(ctx.toy, 'sampler:bass', 'PAKU-PAKU ベース');
  const melody = new PartWriter(ctx.toy, 'sampler:melody', 'PAKU-PAKU メロディ');
  const chords = new PartWriter(ctx.toy, 'sampler:chords', 'PAKU-PAKU 和音');
  const mods = new PartWriter(ctx.toy, 'sampler:mods', 'PAKU-PAKU 改造パーツ');
  const st = plan.style;
  const motifs = new Map<string, ReturnType<typeof makeMotif>>();
  // 重いキック（808 っぽい BOOM）・ローファイのスネアを使うスタイル
  const kickPad = ['trap', 'dnb', 'jungle', 'dub', 'gabber'].includes(st.drums) ? PAD.boom : PAD.kick;
  const snarePad = ['lofi', 'hiphop', 'reggae', 'dub', 'jazz', 'bossa'].includes(st.drums) ? PAD.lofiSn : PAD.snare;

  mods.set(SP.volume, 0, 0.45); // ドラムが大きいので、ほかのおもちゃとそろうように少し下げる
  mods.set(SP.meloPad, 0, 24); // B-09 TOY PNO
  mods.set(SP.bassPad, 0, 17); // B-02 BASS C

  for (const sec of plan.sections) {
    const rd = ctx.rng('drums', sec.index);
    const rb = ctx.rng('bass', sec.index);
    const rm = ctx.rng('melody', sec.index);
    const rx = ctx.rng('mods', sec.index);
    const s0 = sec.start, sEnd = s0 + sec.bars * 4;
    const heat = sec.chaos * st.glitch;

    // ---- drums ----
    for (let b = 0; b < sec.bars; b++) {
      const d = drumBar(plan, sec, b, rd);
      if (!d) continue;
      const t0 = s0 + b * 4;
      steps(d.kick, t0, (t) => drums.note(kickPad, t, 0.25));
      steps(d.snare, t0, (t) => {
        drums.note(snarePad, t, 0.2);
        if (sec.energy > 0.75 && rd.chance(0.5)) drums.note(PAD.clap, t, 0.2);
      });
      // ハット：裏の 8 分のいくつかはオープンにする（同じミュートグループなので、次のクローズで止まる）
      steps(d.hat, t0, (t) => drums.note(sec.energy > 0.6 && (t - t0) % 1 === 0.5 && rd.chance(0.2) ? PAD.ohat : PAD.hat, t, 0.1));
      if (b % 4 === 0 && sec.energy > 0.7 && rd.chance(0.6)) drums.note(PAD.crash, t0, 0.5);
    }

    // ---- bass ----
    if (sec.energy >= 0.3 || sec.kind === 'break') {
      for (const n of bassLine(plan, sec, rb)) bass.note(bassKey(degToMidi(n.deg, 36)), n.t, Math.max(0.1, n.len * 0.9));
    }

    // ---- melody（イントロでは休む） ----
    if (!motifs.has(sec.kind)) motifs.set(sec.kind, makeMotif(ctx.rng(`motif-${sec.kind}`), st.notesPerBar * (0.5 + 0.5 * sec.energy)));
    if (sec.kind !== 'intro' && sec.energy >= 0.35) {
      for (const n of realize(plan, sec, motifs.get(sec.kind)!, [4, 13], { stretch: st.id === 'ambient' ? 2 : 1 })) {
        melody.note(meloKey(degToMidi(n.deg, 60)), n.t, n.len);
      }
    }

    // ---- chords（静かなセクションと、伴奏のあるスタイル） ----
    if (st.comp !== 'none') {
      for (const h of compHits(plan, sec)) {
        if (rm.chance(sec.energy > 0.7 ? 0.15 : 0.35)) continue; // 少し間引いて、メロディを邪魔しない
        for (const dg of h.degs) chords.note(meloKey(degToMidi(dg, 48)), h.t, h.len);
      }
    }

    // ---- mods：BEND（壊れ度）とワンショット ----
    mods.ramp(SP.bend, s0, Math.min(0.9, heat * 0.4), sEnd - 0.5, Math.min(1, heat * sec.energy * 0.8));
    if (sec.kind === 'build' || (sec.energy > 0.6 && rx.chance(0.4))) mods.note(PAD.riser, Math.max(s0, sEnd - 8), 0.5);
    for (let b = 3; b < sec.bars; b += 4) {
      const t = s0 + b * 4 + 3;
      if (rx.chance(0.3 + heat * 0.3)) mods.note(rx.pick([PAD.zap, PAD.laser, PAD.glitch, PAD.sweep]), t + rx.pick([0, 0.5]), 0.3);
    }
    if (sec.kind === 'break' && rx.chance(0.6)) mods.note(PAD.vox, s0 + 2, 1);
  }

  powerAndCrash(plan, mods, [drums, bass, melody, chords], BOOT_BEATS);
  return [drums.finish(end), bass.finish(end), melody.finish(end), chords.finish(end), mods.finish(end)];
}
