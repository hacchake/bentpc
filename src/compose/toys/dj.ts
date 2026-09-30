// SPIN-TOT DJ-28 の作曲係。4 つのパート：
//   keys   … 13 鍵（ド〜上のド）でベースとメロディ（楽器を切り替える）
//   pads   … SOUND EFFECT パッド 6 つ（フレーズの区切り・サビで）
//   rhythm … 内蔵リズム：曲の BPM にいちばん近いパターンを選び、TEMPO ボタンで合わせて、4 小節ごとに頭から回し直す
//   mods   … 電源・クラッシュ・ディスク（触って回す＝スクラッチ）・DIST 2 つ・FEEDBACK・PITCH・STOP
import { hashSeed } from '../../core/rng';
import { BTN } from '../../core/song';
import { makePattern } from '../../toys/dj/dsp/rhythm';
import { bassLine, degToMidi, makeMotif, realize } from '../harmony';
import { powerAndCrash, type Part, type PartContext } from '../context';
import { PartWriter } from '../writer';
import { DJ_INDEX } from '../../toys/dj/params';

const P = DJ_INDEX; // パラメーター番号は表から引く
const PAD = 13, PLAY = 19, PAUSE = 20, TEMPO_UP = 21, TEMPO_DOWN = 22, DISC = 23;
/** 鍵盤：C4〜C5 の 13 鍵 */
const key = (midi: number) => {
  let m = midi;
  while (m < 60) m += 12;
  while (m > 72) m -= 12;
  return m - 60;
};
/** 楽器：0 LEAD 1 BASS 2 ORGAN 3 STRINGS 4 BELL 5 PIPE 6 BRASS 7 SYNTH 8 CHOIR 9 NOISE */
const LEADS: Record<string, number[]> = {
  plain: [4, 5, 2], beat: [0, 7, 6], ambient: [3, 8, 4], noise: [9, 7, 0], collapse: [6, 0, 8],
  enka: [3, 5], ondo: [5, 4], douyou: [4, 5], march: [6, 5], chip: [0, 7], punk: [7, 0], lofi: [2, 4],
  reggae: [2, 0], dub: [2, 8], ska: [6, 2], bossa: [5, 3], funk: [7, 6], jazz: [2, 6],
  house: [2, 7], techno: [7, 0], dnb: [7, 3], jungle: [7, 8], trap: [4, 7], gabber: [9, 7], idm: [4, 9, 8], breakcore: [9, 0, 6],
};
/** DJ のエンジン番号（シードの作り方をエンジンと同じにする） */
const ENGINE_ID = 2;

export function composeDj(ctx: PartContext): Part[] {
  const { plan } = ctx;
  const end = plan.bars * 4;
  const keys = new PartWriter(ctx.toy, 'dj:keys', 'SPIN-TOT 鍵盤');
  const pads = new PartWriter(ctx.toy, 'dj:pads', 'SPIN-TOT パッド');
  const rhythm = new PartWriter(ctx.toy, 'dj:rhythm', 'SPIN-TOT リズム');
  const mods = new PartWriter(ctx.toy, 'dj:mods', 'SPIN-TOT 改造パーツ');
  const style = plan.style.id;
  const song = ctx.rng('song');

  mods.set(P.volume, 0, 0.72);
  mods.set(P.pitchOn, 0, 0);
  mods.set(P.discSpeed, 0, 0);
  // ---- 内蔵リズム：曲の BPM にいちばん近いパターン（隠しパターン 21〜27 はノイズ・崩壊で） ----
  const engineSeed = hashSeed(plan.settings.seed, ENGINE_ID) >>> 0;
  const ids = style === 'noise' || style === 'collapse' ? Array.from({ length: 28 }, (_, i) => i) : Array.from({ length: 21 }, (_, i) => i);
  let best = { id: 0, off: 0, err: 1e9 };
  for (const id of ids) {
    const bpm = makePattern(engineSeed, id).bpm;
    const off = Math.max(-8, Math.min(8, Math.round((plan.bpm - bpm) / 4)));
    const err = Math.abs(bpm + off * 4 - plan.bpm) + song.next() * 0.5;
    if (err < best.err) best = { id, off, err };
  }
  rhythm.set(P.rhythm, 0, best.id);
  let rhythmOn = false;
  let tempoSet = false;

  for (const sec of plan.sections) {
    const rk = ctx.rng('keys', sec.index);
    const rp = ctx.rng('pads', sec.index);
    const rx = ctx.rng('mods', sec.index);
    const s0 = sec.start, sEnd = s0 + sec.bars * 4;
    const heat = sec.chaos * plan.style.glitch;
    keys.set(P.instrument, Math.max(0, s0 - 0.05), sec.energy < 0.45 ? 1 : rk.pick(LEADS[style] ?? [0, 7]));

    // ---- keys：静かなセクションはベース、にぎやかなセクションはメロディ ----
    if (sec.energy < 0.45 || sec.kind === 'break') {
      for (const n of bassLine(plan, sec, rk)) keys.note(key(degToMidi(n.deg, 48)), n.t, n.len);
    } else {
      const motif = makeMotif(ctx.rng(`motif-${sec.kind}`), plan.style.notesPerBar * (0.5 + 0.5 * sec.energy));
      for (const n of realize(plan, sec, motif, [0, 7], { stretch: style === 'ambient' ? 2 : 1 })) keys.note(key(degToMidi(n.deg, 60)), n.t, n.len);
    }

    // ---- rhythm：盛り上がるセクションで回す。4 小節ごとに頭から ----
    const want = sec.energy >= 0.4 && plan.style.drums !== 'none' && plan.style.drums !== 'sparse';
    if (want) {
      for (let b = 0; b < sec.bars; b += 4) {
        const t = s0 + b * 4;
        if (rhythmOn) rhythm.note(PAUSE, t - 0.03, 0.01);
        // テンポを合わせる（最初の 1 回だけ。TEMPO ボタンの調整は止めても残る）
        if (!tempoSet) {
          tempoSet = true;
          for (let i = 0; i < Math.abs(best.off); i++) rhythm.note(best.off > 0 ? TEMPO_UP : TEMPO_DOWN, Math.max(0.01, t - 0.4 + i * 0.03), 0.01);
        }
        rhythm.note(PLAY, t, 0.1);
        rhythmOn = true;
      }
    } else if (rhythmOn) {
      rhythm.note(PAUSE, s0, 0.1);
      rhythmOn = false;
    }
    mods.set(P.rhythmVol, s0, sec.kind === 'break' ? 0.5 : 0.75);

    // ---- pads：フレーズの区切りと、サビの 2・4 拍 ----
    pads.set(P.sfxBank, Math.max(0, s0 - 0.05), rp.int(10));
    for (let b = 0; b < sec.bars; b++) {
      const t0 = s0 + b * 4;
      if (b % 4 === 3) pads.note(PAD + rp.int(6), t0 + 3, 0.25);
      if (sec.kind === 'chorus' && rp.chance(0.6)) { pads.note(PAD + rp.int(6), t0 + 1, 0.2); pads.note(PAD + rp.int(6), t0 + 3.5, 0.2); }
    }

    // ---- mods：スクラッチ（ディスクに触ってから回す）・歪み・フィードバック ----
    mods.set(P.discFx, Math.max(0, s0 - 0.05), rx.int(21));
    if (sec.energy > 0.5) {
      for (let b = 1; b < sec.bars; b += sec.energy > 0.8 ? 2 : 4) {
        const t = s0 + b * 4 + 2;
        mods.note(DISC, t, 2);
        mods.set(P.discSpeed, t, 0);
        mods.ramp(P.discSpeed, t + 0.05, 0, t + 0.5, -2.5);
        mods.ramp(P.discSpeed, t + 0.55, 2.5, t + 1, 1.5);
        mods.ramp(P.discSpeed, t + 1.05, -1.5, t + 1.9, 1);
        mods.set(P.discSpeed, t + 2, 0);
      }
    }
    mods.set(P.dist1On, s0, heat * sec.energy > 0.35 ? 1 : 0);
    mods.ramp(P.dist1, s0, 0.3, sEnd - 0.5, Math.min(0.9, 0.3 + heat * 0.5));
    mods.set(P.dist2On, s0, heat > 1 ? 1 : 0);
    mods.ramp(P.feedback, s0, 0, sEnd - 0.5, Math.min(0.7, heat * sec.energy * 0.5));
    mods.set(P.fbSource, s0, rx.int(3));
    // 壊れているセクション：STOP ボタンでがくっと止める
    if (heat > 0.9) for (let b = 1; b < sec.bars; b += 2) mods.note(BTN + P.halt, s0 + b * 4 + 3, 0.5);
  }
  if (rhythmOn) rhythm.note(PAUSE, end - 0.25, 0.1);

  powerAndCrash(plan, mods, [keys, pads, rhythm], 1);
  return [keys.finish(end), pads.finish(end), rhythm.finish(end), mods.finish(end)];
}
