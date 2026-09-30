// VROOMBOX VR-5 の作曲係。3 つのパート：
//   engine … イグニッション（START を押し続けてエンジンをかける）→ エンジンの点火の音程でベースライン（コードの根音）
//   dash   … クラクション（裏拍）・衝突音（フレーズの頭）・ラジオのプリセット・ウインカー / ワイパー / サイレン
//   mods   … 電源・クラッシュ・アクセル・ギア・REDLINE・SPARK・TURBO・気筒の間引き（FIRE 1〜8）・TURBO FB・RADIO BLEED
import { BTN } from '../../core/song';
import { V_CRASH, V_HORN, V_NOTE, V_NOTE_BASE, V_PRESET, V_START, VROOM_INDEX } from '../../toys/vroom/params';
import { bassLine, degToMidi, lerp } from '../harmony';
import { powerAndCrash, type Part, type PartContext } from '../context';
import { PartWriter } from '../writer';

const P = VROOM_INDEX;
const engineKey = (midi: number) => {
  let m = midi;
  while (m < V_NOTE_BASE) m += 12;
  while (m > V_NOTE_BASE + 35) m -= 12;
  return V_NOTE + (m - V_NOTE_BASE);
};
/** エンジンをかけるのに START を押し続ける長さ（秒） */
const CRANK_SEC = 1.3;

export function composeVroom(ctx: PartContext): Part[] {
  const { plan } = ctx;
  const end = plan.bars * 4;
  const engine = new PartWriter(ctx.toy, 'vroom:engine', 'VROOMBOX エンジン');
  const dash = new PartWriter(ctx.toy, 'vroom:dash', 'VROOMBOX ダッシュボード');
  const mods = new PartWriter(ctx.toy, 'vroom:mods', 'VROOMBOX 改造パーツ');
  const style = plan.style.id;
  const crankBeats = Math.ceil(((CRANK_SEC * plan.bpm) / 60) * 2) / 2;

  mods.set(P.volume, 0, 0.7);
  mods.set(P.gear, 0, 0);
  mods.set(P.throttle, 0, 0);
  for (let c = 1; c <= 8; c++) mods.set(P[`cyl${c}` as 'cyl1'], 0, 1);
  // 最初にエンジンをかける（セルが回る音から始まる）
  engine.note(V_START, 0.3, crankBeats);

  for (const sec of plan.sections) {
    const re = ctx.rng('engine', sec.index);
    const rd = ctx.rng('dash', sec.index);
    const rx = ctx.rng('mods', sec.index);
    const s0 = sec.start, sEnd = s0 + sec.bars * 4;
    const heat = sec.chaos * plan.style.glitch;

    // ---- engine：点火の音程でベース。静かなセクションはアイドリングのまま ----
    if (sec.energy >= 0.3) {
      for (const n of bassLine(plan, sec, re)) engine.note(engineKey(degToMidi(n.deg, 36)), n.t, n.len * (style === 'ambient' ? 1 : 0.9));
    }

    // ---- dash ----
    for (let b = 0; b < sec.bars; b++) {
      const t0 = s0 + b * 4;
      if (sec.energy > 0.5 && style !== 'ambient') for (const o of [1.5, 3.5]) if (rd.chance(0.35 + 0.3 * sec.energy)) dash.note(V_HORN, t0 + o, 0.3);
      if (b % 4 === 0 && sec.energy > 0.7) dash.note(V_CRASH, t0, 0.3);
    }
    // ラジオ：セクションの頭で選局（静かなセクションで聞こえる）
    if (sec.energy < 0.5) dash.note(V_PRESET + rd.int(8), s0 + 0.1, 0.2);
    dash.set(P.signal, s0, sec.kind === 'break' || sec.kind === 'outro' ? 1 : 0);
    dash.set(P.wipers, s0, style === 'ambient' && rd.chance(0.5) ? 1 : 0);
    dash.set(P.siren, s0, heat > 1 && sec.energy > 0.8 ? 1 : 0);

    // ---- mods：アクセル・ギア・壊れる改造 ----
    const gear = sec.energy < 0.3 ? 0 : Math.min(5, 1 + Math.floor(sec.energy * 4));
    mods.set(P.gear, s0, gear);
    mods.ramp(P.throttle, s0, lerp(0.05, 0.4, sec.energy), sEnd - 0.5, lerp(0.1, 0.9, sec.energy));
    mods.ramp(P.redline, s0, 0, sEnd - 0.5, Math.min(0.9, heat * sec.energy * 0.7));
    mods.set(P.spark, s0, Math.min(0.8, heat * 0.4));
    mods.set(P.radioBleed, s0, sec.energy < 0.5 ? 0.4 : 0.1);
    mods.set(P.turboFbOn, s0, heat > 0.8 ? 1 : 0);
    mods.set(P.chassis, s0, Math.min(0.7, heat * 0.3));
    // 気筒の間引き：壊れるほど点火が抜けてリズムがよれる
    const drop = Math.floor(Math.min(4, heat * 3));
    const off = new Set<number>();
    while (off.size < drop) off.add(1 + rx.int(8));
    for (let c = 1; c <= 8; c++) mods.set(P[`cyl${c}` as 'cyl1'], s0, off.has(c) ? 0 : 1);
    // TURBO：盛り上がりの最後の小節で踏む
    if (sec.energy > 0.6) mods.note(BTN + P.turbo, sEnd - 4, 3.5);
  }

  const crash = powerAndCrash(plan, mods, [engine, dash], 0.25);
  // クラッシュから戻ったら、エンジンをかけ直す
  if (crash && crash.end < end - 2) engine.note(V_START, crash.end + 0.5, crankBeats);
  return [engine.finish(end), dash.finish(end), mods.finish(end)];
}
