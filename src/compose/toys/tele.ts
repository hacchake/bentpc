// TELEKEY TK-6 の作曲係。4 つのパート：
//   beat  … 楽器キーのビート（KICK・SNARE・HAT、ノイズ系はノイズも）。スタイルごとに型を持ち、4 小節目はフィル
//   inst  … 音程のある楽器キー（BLIP = ソ、CHIRP・BEEP = ド）とザップ。コードに合う小節だけで鳴らす
//   video … 映像＋音のグリッチキー（拍やフレーズの区切りで入れて、音と映像を同時に崩す）・キュー・FREEZE・
//           一発グリッチ（GLITCH ボタン）・HOLD / RELEASE
//   mods  … 電源・クラッシュ・ノブ（GLITCH AMT・LFO・FEEDBACK・DIST・混線・BASE）
import { chordDegs, drumBar, lerp, steps } from '../harmony';
import { powerAndCrash, type Part, type PartContext } from '../context';
import { PartWriter } from '../writer';
import { TELE_INDEX } from '../../toys/tele/params';

const T = TELE_INDEX; // パラメーター番号は表から引く
const KICK = 56, SNARE = 57, HAT = 58, NOISE = 55, BEEP_C = 53, ZAP = 60, BLIP_G = 61, CHIRP_C = 63;
/** グリッチキー（0〜23） */
const G = (n: number) => (n < 12 ? 28 + n : 41 + (n - 12));
const BANG = (n: number) => 1 + n; // F1〜F5
const CUE = (n: number) => 13 + ((n + 9) % 10); // 数字キー
const FREEZE = 64, HOLD = 40, RELEASE = 26;
/** グリッチの組（見た目の系統）：セクションごとに 1 組選んで使う → そのセクションの「顔」がそろう */
const PALETTES = [
  [0, 1, 13, 14], // RGB・スキャン・Vロール・Hシンク（テレビが乱れる）
  [2, 4, 5, 11], // データモッシュ・モザイク・ポスタライズ・ブロックノイズ（デジタルが壊れる）
  [6, 7, 8, 18], // 反転・ミラー・万華鏡・ツイスト（形が壊れる）
  [9, 10, 20, 23], // スリットスキャン・フィードバック・残像・メルト（時間が壊れる）
  [3, 15, 16, 22], // ピクセルソート・しきい値・エッジ・ストロボ（とがる）
  [12, 17, 19, 21], // フレームホールド・ズーム・色にじみ・分割
];
const BOOT_BEATS = 2;

export function composeTele(ctx: PartContext): Part[] {
  const { plan } = ctx;
  const end = plan.bars * 4;
  const beat = new PartWriter(ctx.toy, 'tele:beat', 'TELEKEY ビート');
  const inst = new PartWriter(ctx.toy, 'tele:inst', 'TELEKEY 楽器');
  const video = new PartWriter(ctx.toy, 'tele:video', 'TELEKEY 映像グリッチ');
  const mods = new PartWriter(ctx.toy, 'tele:mods', 'TELEKEY 改造パーツ');
  const style = plan.style.id;

  mods.set(T.volume, 0, 0.8);
  mods.set(T.mix, 0, 1);
  mods.set(T.speed, 0, 0.5);
  mods.set(T.lfoTarget, 0, 2);
  mods.set(T.crosstalk, 0, 0);
  mods.set(T.distType, 0, 0);
  let cue = 0;

  for (const sec of plan.sections) {
    const rb = ctx.rng('beat', sec.index);
    const ri = ctx.rng('inst', sec.index);
    const rv = ctx.rng('video', sec.index);
    const rx = ctx.rng('mods', sec.index);
    const s0 = sec.start, sEnd = s0 + sec.bars * 4;
    const heat = sec.chaos * plan.style.glitch;

    // ---- beat ----
    for (let b = 0; b < sec.bars; b++) {
      const d = drumBar(plan, sec, b, rb);
      if (!d) continue;
      const t0 = s0 + b * 4;
      steps(d.kick, t0, (t) => beat.note(KICK, t, 0.2));
      steps(d.snare, t0, (t) => beat.note(SNARE, t, 0.2));
      steps(d.hat, t0, (t) => beat.note(HAT, t, 0.1));
      if (style === 'noise' && rb.chance(0.5)) beat.note(NOISE, t0 + 3.5, 0.4);
    }

    // ---- inst：コードにソかドがある小節で、チャイム。フレーズの終わりにザップ ----
    const chimeEvery = style === 'ambient' ? 2 : sec.energy > 0.7 ? 1 : 2;
    for (let b = 0; b < sec.bars; b += chimeEvery) {
      const bar = Math.floor(s0 / 4) + b;
      const degs = chordDegs(plan, bar);
      const t0 = s0 + b * 4;
      const offs = style === 'ambient' ? [0] : sec.energy > 0.6 ? [0, 1.5, 2.5] : [0, 2];
      for (const o of offs) {
        if (ri.chance(0.25)) continue;
        if (degs.includes(4)) inst.note(BLIP_G, t0 + o, style === 'ambient' ? 2 : 0.4);
        else if (degs.includes(0)) inst.note(ri.chance(0.5) ? CHIRP_C : BEEP_C, t0 + o, style === 'ambient' ? 2 : 0.4);
      }
    }
    for (let b = 3; b < sec.bars; b += 4) inst.note(ZAP, s0 + b * 4 + 3.5, 0.25);

    // ---- video：拍の頭（スネアの位置が中心）でグリッチ。多さは盛り上がり × 壊れ度 ----
    const pal = rv.pick(PALETTES);
    const perBar = heat * sec.energy * 4;
    for (let b = 0; b < sec.bars; b++) {
      const t0 = s0 + b * 4;
      const slots = perBar >= 3 ? [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] : perBar >= 1.5 ? [0, 1, 2, 3] : [1, 3];
      let n = Math.floor(perBar) + (rv.chance(perBar % 1) ? 1 : 0);
      for (const o of slots) {
        if (n <= 0) break;
        if (slots.length > n && rv.chance(0.4)) continue;
        video.note(G(rv.pick(pal)), t0 + o, slots.length >= 8 ? 0.4 : rv.pick([0.25, 0.5, 0.75]));
        n--;
      }
      // フレーズ（4 小節）の区切り：大きめのグリッチ＋ザップと同時
      if (b % 4 === 3) video.note(G(rv.pick(pal)), t0 + 3.5, 0.5);
    }
    // セクションの頭でキューを飛ぶ（映像の場面が変わる）
    video.note(CUE(1 + (cue++ % 9)), s0 + 0.01, 0.2);
    // 盛り上がるセクションの最後：FREEZE（映像と音をつかむ）
    if (sec.energy > 0.55 && sec.bars >= 4 && rv.chance(0.6)) video.note(FREEZE, sEnd - 1.5, 1.4);
    // サビ・ノイズ：頭で一発グリッチ（BASE も変える）
    if (['chorus', 'noise', 'collapse'].includes(sec.kind)) {
      const base = heat > 1 ? 4 : heat > 0.6 ? 2 + rx.int(2) : rx.int(2);
      mods.set(T.base, Math.max(0, s0 - 0.1), base);
      video.note(BANG(rv.int(5)), s0, 0.5);
      if (sec.bars >= 8) video.note(BANG(rv.int(5)), s0 + 16, 0.5);
      // HOLD でつかんで、4 小節後に RELEASE
      if (sec.bars >= 8 && rv.chance(0.3 + 0.4 * Math.min(1, sec.chaos))) {
        video.note(HOLD, s0 + 8 + 0.02, 0.2);
        video.note(RELEASE, s0 + 16 - 0.1, 0.2);
      }
    }

    // ---- mods：ノブを盛り上がりと壊れ度に合わせて ----
    mods.ramp(T.amount, s0, lerp(0.3, 0.8, sec.energy * 0.8), sEnd - 0.5, lerp(0.35, 1, sec.energy));
    const lfo = ['build', 'swell', 'drift'].includes(sec.kind) ? 0.3 + 0.5 * sec.energy : 0.15 * sec.chaos;
    mods.ramp(T.lfoDepth, s0, lfo * 0.3, sEnd - 0.5, lfo);
    mods.set(T.lfoRate, s0, style === 'ambient' ? 0.2 : 0.35 + 0.3 * sec.energy);
    mods.ramp(T.feedback, s0, 0, sEnd - 0.5, Math.min(0.7, heat * 0.4 * sec.energy + (style === 'ambient' ? 0.25 : 0)));
    mods.ramp(T.dist, s0, 0, sEnd - 0.5, Math.min(0.8, heat * sec.energy * 0.6));
    mods.set(T.distType, s0, heat > 1 ? 1 : 0);
    mods.set(T.crosstalk, s0, heat > 1.1 && rx.chance(0.6) ? 1 : 0);
  }

  powerAndCrash(plan, mods, [beat, inst, video], BOOT_BEATS);
  return [beat.finish(end), inst.finish(end), video.finish(end), mods.finish(end)];
}
