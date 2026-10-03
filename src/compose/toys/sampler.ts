// PAKU-PAKU 16（サンプラー）の作曲係。スタイルごとに工場出荷の楽器（バンク A〜G）を選んで、それらしく弾く。
//   drums  … キット（KITS）のキック・スネア・ハット ＋ スタイルの小物（手拍子・掛け声・シェイカー・クラーベ…）
//   bass   … BASS PAD の音を、音程を変えて弾くベース
//   melody … MELO PAD の音でメロディ（セクションで持ち替えるスタイルもある：演歌のイントロは琴、サビは泣きのギター）
//   chords … CHORD PAD の音で和音（スタイルの刻み方：レゲエは 2・4 拍のスカンク、ファンクは 16 分のクラビ…）
//   mods   … 電源・クラッシュ・音量・使うパッドの切り替え・BEND（壊れ度）・後付けのツマミ・ワンショット
// パッドの中身はサンプラーのページで変えられる。工場出荷の並び（factory.ts / factory2.ts）を前提に作る。
import type { Rng } from '../../core/rng';
import { bassLine, chordDegs, compHits, degToMidi, drumBar, makeMotif, realize, steps } from '../harmony';
import { powerAndCrash, type Part, type PartContext } from '../context';
import type { PlannedSection } from '../plan';
import { PartWriter } from '../writer';
import { BASS_KEY, BASS_ROOT_KEY, CHORD_KEY, CHORD_ROOT_KEY, KEY_COUNT, MELO_KEY, MELO_ROOT_KEY, SP } from '../../sampler/toy/engine';

/** 音程のある楽器：[パッド, 元の高さ（MIDI）] */
type Inst = [number, number];
/** 刻み方：[小節の中の拍, 長さ] */
type Pat = [number, number][];

/** スタイルの楽器セット。パッド番号は工場出荷の並び（A = 0〜15 … G = 96〜111）。-1 = 使わない */
interface Kit {
  kick: number; snare: number; hat: number; ohat: number; clap: number; crash: number;
  melo: Inst; bass: Inst; chord: Inst;
  /** サビ（chorus）で持ち替えるメロディ */
  hook?: Inst;
  /** イントロで鳴らす楽器（琴のポロロンなど。メロディの代わり） */
  intro?: Inst;
  /** 和音の刻み方（無ければスタイルの comp どおり） */
  chordPat?: Pat;
  /** サビで持ち替える和音の楽器と刻み方（レゲエのオルガン・スカのピアノ） */
  chordHook?: [Inst, Pat];
  /** 音量の倍率（音の厚いスタイルは下げる） */
  gain?: number;
  /** パワーコード（根音だけ。音そのものが 5 度入り） */
  power?: boolean;
  /** 盛り上げの前・ブレイクで鳴らす音 */
  riser: number; vox: number;
}

// ---- 工場出荷のパッド番号 ----
const A = { kick: 0, snare: 1, hat: 2, ohat: 3, clap: 4, rim: 7, cowbell: 8, shaker: 9, boom: 10, lofiSn: 11, crash: 12, zap: 14, sweep: 15 };
const B = { bass: 17, vox: 19, glitch: 23, pno: 24, riser: 26, laser: 27 };
const C = { don: 32, ka: 33, shime: 34, chan: 35, tebyoshi: 36, hyoshigi: 37, kane: 38, yooi: 39, shamisen: 40, koto: 41, shaku: 42, strings: 43, naki: 44, wood: 45, fue: 46, suzu: 47 };
const D = { onedrop: 48, rimshot: 49, hat: 50, ohat: 51, skank: 52, organ: 53, dubBass: 54, siren: 55, spring: 56, horns: 57, melodica: 58, shaker: 59, dubHit: 60, akete: 61, stepper: 62, skaPno: 63 };
const E = { kick: 64, brush: 65, ride: 66, pedal: 67, xstick: 68, upright: 69, ep: 70, nylon: 71, clav: 72, slap: 73, sax: 74, vibes: 75, clave: 76, cabasa: 77, funkSn: 78, conga: 79 };
const F = { kick: 80, snare: 81, ch: 82, oh: 83, clap: 84, ride: 85, b808: 86, reese: 87, acid: 88, hpno: 89, ssaw: 90, gabber: 91, breakSn: 92, trapHat: 93, perc: 94, hey: 95 };
const G = { bd: 96, sn: 97, cymbal: 98, glock: 99, brass: 100, tuba: 101, sq: 102, nz: 103, tri: 104, power: 105, rockBd: 106, rockSn: 107, lofiBd: 108, dustySn: 109, lofiEp: 110, vinyl: 111 };

const TOY: Kit = { kick: A.kick, snare: A.snare, hat: A.hat, ohat: A.ohat, clap: A.clap, crash: A.crash, melo: [B.pno, 72], bass: [B.bass, 36], chord: [B.pno, 72], riser: B.riser, vox: B.vox };
const DANCE: Partial<Kit> = { kick: F.kick, snare: F.snare, hat: F.ch, ohat: F.oh, clap: F.clap, melo: [F.ssaw, 60], chord: [F.hpno, 60], vox: F.hey };
const off8: Pat = [[0.5, 0.2], [1.5, 0.2], [2.5, 0.2], [3.5, 0.2]];
/** レゲエのオルガン「バブル」：裏の 8 分と 16 分で転がす */
const bubble: Pat = [[0.5, 0.18], [0.75, 0.15], [1.5, 0.18], [2.5, 0.18], [2.75, 0.15], [3.5, 0.18]];
const skank24: Pat = [[1, 0.2], [3, 0.2]];

const KITS: Record<string, Partial<Kit>> = {
  ambient: { snare: A.rim, hat: A.shaker, melo: [E.vibes, 72], chord: [C.strings, 60], bass: [D.dubBass, 36] },
  idm: { ...DANCE, melo: [E.vibes, 72], chord: [E.ep, 60], bass: [F.b808, 36] },
  breakcore: { ...DANCE, kick: F.gabber, snare: F.breakSn, melo: [G.sq, 60], chord: [F.ssaw, 60], bass: [F.reese, 36] },
  douyou: { kick: -1, snare: C.tebyoshi, hat: -1, melo: [G.glock, 72], chord: [B.pno, 72], bass: [C.wood, 36], riser: C.suzu },
  march: { kick: G.bd, snare: G.sn, hat: -1, ohat: -1, crash: G.cymbal, melo: [G.brass, 60], hook: [G.glock, 72], chord: [G.brass, 60], bass: [G.tuba, 36], chordPat: [[1, 0.35], [3, 0.35]] },
  chip: { kick: A.kick, snare: G.nz, hat: G.nz, ohat: -1, clap: G.nz, melo: [G.sq, 60], chord: [G.sq, 60], bass: [G.tri, 36], riser: A.sweep, vox: A.zap },
  punk: { gain: 0.72, kick: G.rockBd, snare: G.rockSn, melo: [C.naki, 60], chord: [G.power, 48], bass: [B.bass, 36], power: true, chordPat: [[0, 0.22], [0.5, 0.22], [1, 0.22], [1.5, 0.22], [2, 0.22], [2.5, 0.22], [3, 0.22], [3.5, 0.22]] },
  lofi: { kick: G.lofiBd, snare: G.dustySn, melo: [E.vibes, 72], chord: [G.lofiEp, 60], bass: [E.upright, 36], riser: -1 },
  house: { ...DANCE, melo: [F.hpno, 60], chord: [F.hpno, 60], bass: [B.bass, 36] },
  techno: { ...DANCE, snare: F.clap, melo: [F.acid, 48], chord: [F.ssaw, 60], bass: [F.acid, 48], chordPat: [[0.75, 0.2], [2.25, 0.2]] },
  dnb: { ...DANCE, snare: F.breakSn, melo: [E.vibes, 72], chord: [C.strings, 60], bass: [F.reese, 36] },
  jungle: { ...DANCE, snare: F.breakSn, melo: [F.ssaw, 60], chord: [C.strings, 60], bass: [F.b808, 36], vox: D.siren },
  trap: { ...DANCE, kick: A.boom, snare: F.clap, hat: F.trapHat, melo: [G.glock, 72], chord: [C.strings, 60], bass: [F.b808, 36] },
  gabber: { ...DANCE, kick: F.gabber, melo: [F.ssaw, 60], chord: [F.ssaw, 60], bass: [F.reese, 36] },
  reggae: { kick: D.onedrop, snare: D.rimshot, hat: D.hat, ohat: D.ohat, clap: D.rimshot, melo: [D.melodica, 72], chord: [D.skank, 60], chordPat: skank24, chordHook: [[D.organ, 60], bubble], bass: [D.dubBass, 36], riser: D.siren, vox: D.siren },
  dub: { gain: 0.72, kick: D.onedrop, snare: D.spring, hat: D.hat, ohat: D.ohat, clap: D.rimshot, melo: [D.melodica, 72], chord: [D.skank, 60], chordPat: skank24, chordHook: [[D.organ, 60], bubble], bass: [D.dubBass, 36], riser: D.siren, vox: D.dubHit },
  ska: { kick: D.stepper, snare: D.rimshot, hat: D.hat, ohat: D.ohat, clap: D.rimshot, melo: [D.horns, 60], chord: [D.skank, 60], chordPat: off8, chordHook: [[D.skaPno, 60], off8], bass: [E.upright, 36], riser: D.siren, vox: F.hey },
  bossa: { kick: E.kick, snare: E.xstick, hat: E.cabasa, ohat: -1, clap: E.xstick, crash: E.ride, melo: [E.vibes, 72], chord: [E.nylon, 60], bass: [E.upright, 36], chordPat: [[0, 0.45], [0.75, 0.45], [1.5, 0.45], [2.5, 0.45], [3.25, 0.45]], riser: -1, vox: -1 },
  funk: { kick: G.rockBd, snare: E.funkSn, hat: D.hat, ohat: D.ohat, clap: E.funkSn, melo: [E.sax, 60], chord: [E.clav, 60], bass: [E.slap, 36], chordPat: [[0, 0.12], [0.75, 0.12], [1.5, 0.12], [2.25, 0.12], [2.75, 0.12], [3.5, 0.12]], vox: F.hey },
  jazz: { kick: E.kick, snare: E.brush, hat: E.ride, ohat: E.ride, clap: E.brush, crash: E.ride, melo: [E.sax, 60], chord: [E.ep, 60], bass: [E.upright, 36], chordPat: [[0, 0.6], [1.5, 0.4]], riser: -1, vox: -1 },
  enka: { kick: E.kick, snare: E.xstick, hat: E.pedal, ohat: -1, clap: E.xstick, crash: G.cymbal, melo: [C.shaku, 72], hook: [C.naki, 60], intro: [C.koto, 60], chord: [C.strings, 60], bass: [C.wood, 36], riser: -1, vox: -1 },
  ondo: { kick: C.don, snare: C.ka, hat: C.chan, ohat: C.shime, clap: C.tebyoshi, crash: C.kane, melo: [C.fue, 72], chord: [C.shamisen, 48], bass: [C.wood, 36], chordPat: [[0, 0.3], [1, 0.3], [1.5, 0.3], [2, 0.3], [3, 0.3], [3.5, 0.3]], riser: C.suzu, vox: C.yooi },
};
/** スタイルの楽器セット（表に無いスタイルは、おもちゃの音 = バンク A・B） */
export const samplerKit = (style: string): Kit => ({ ...TOY, ...KITS[style] });

const BOOT_BEATS = 1;
const clamp = (k: number, lo: number, hi: number) => Math.max(lo, Math.min(hi - 1, k));
/** 弾きたい高さ → キー（元の高さとの差。[down, up] 半音に収まらなければオクターブで折り返す。録った音は元の高さの近くがいちばん自然） */
function keyFor(midi: number, inst: Inst, rootKey: number, lo: number, hi: number, down = -24, up = 24): number {
  let d = midi - inst[1];
  while (d > up) d -= 12;
  while (d < down) d += 12;
  return clamp(rootKey + d, lo, hi);
}
const meloKey = (midi: number, i: Inst) => keyFor(midi, i, MELO_ROOT_KEY, MELO_KEY, BASS_KEY);
const bassKey = (midi: number, i: Inst) => keyFor(midi, i, BASS_ROOT_KEY, BASS_KEY, CHORD_KEY, -7, 14);
const chordKey = (midi: number, i: Inst) => keyFor(midi, i, CHORD_ROOT_KEY, CHORD_KEY, KEY_COUNT);
/** メロディ（ソ〜ラの 1 オクターブ半）を、楽器の元の高さの近くへオクターブで動かす量 */
const meloShift = (i: Inst) => Math.round((i[1] + 5 - 74) / 12) * 12;

export function composeSampler(ctx: PartContext): Part[] {
  const { plan } = ctx;
  const end = plan.bars * 4;
  const drums = new PartWriter(ctx.toy, 'sampler:drums', 'PAKU-PAKU ドラム');
  const bass = new PartWriter(ctx.toy, 'sampler:bass', 'PAKU-PAKU ベース');
  const melody = new PartWriter(ctx.toy, 'sampler:melody', 'PAKU-PAKU メロディ');
  const chords = new PartWriter(ctx.toy, 'sampler:chords', 'PAKU-PAKU 和音');
  const mods = new PartWriter(ctx.toy, 'sampler:mods', 'PAKU-PAKU 改造パーツ');
  const st = plan.style;
  const kit = samplerKit(st.id);
  const motifs = new Map<string, ReturnType<typeof makeMotif>>();
  const hit = (w: PartWriter, pad: number, t: number, len = 0.2) => { if (pad >= 0) w.note(pad, t, len); };

  mods.set(SP.volume, 0, 0.45 * (kit.gain ?? 1)); // ドラムが大きいので、ほかのおもちゃとそろうように少し下げる
  mods.set(SP.bassPad, 0, kit.bass[0]);
  // メロディ・和音の楽器（セクションで持ち替える。前の音が終わる少し前に切り替える）
  let melo: Inst = kit.melo, chord: Inst = kit.chord;
  mods.set(SP.meloPad, 0, melo[0]);
  mods.set(SP.chordPad, 0, chord[0]);
  const useMelo = (inst: Inst, t: number) => { if (inst[0] !== melo[0]) { melo = inst; mods.set(SP.meloPad, Math.max(0, t - 0.05), inst[0]); } };
  const useChord = (inst: Inst, t: number) => { if (inst[0] !== chord[0]) { chord = inst; mods.set(SP.chordPad, Math.max(0, t - 0.05), inst[0]); } };

  // ローファイ：レコードのチリチリを曲のあいだずっと
  if (st.id === 'lofi') hit(drums, G.vinyl, BOOT_BEATS, end - BOOT_BEATS - 0.5);

  for (const sec of plan.sections) {
    const rd = ctx.rng('drums', sec.index);
    const rb = ctx.rng('bass', sec.index);
    const rm = ctx.rng('melody', sec.index);
    const rx = ctx.rng('mods', sec.index);
    const s0 = sec.start, sEnd = s0 + sec.bars * 4;
    const heat = sec.chaos * st.glitch;
    const bar0 = Math.floor(s0 / 4);

    // ---- drums（ダブは小節ごとにドラムを抜く＝抜き差し） ----
    for (let b = 0; b < sec.bars; b++) {
      const t0 = s0 + b * 4;
      const d = drumBar(plan, sec, b, rd);
      const dropped = st.id === 'dub' && sec.kind !== 'intro' && rd.chance(0.18);
      if (d && !dropped) {
        steps(d.kick, t0, (t) => hit(drums, kit.kick, t, 0.25));
        steps(d.snare, t0, (t) => {
          hit(drums, kit.snare, t, 0.2);
          if (sec.energy > 0.75 && kit.clap !== kit.snare && rd.chance(0.5)) hit(drums, kit.clap, t, 0.2);
        });
        // ハット：裏の 8 分のいくつかはオープンにする（同じミュートグループなので、次のクローズで止まる）
        steps(d.hat, t0, (t) => hit(drums, kit.ohat >= 0 && sec.energy > 0.6 && (t - t0) % 1 === 0.5 && rd.chance(0.2) ? kit.ohat : kit.hat, t, 0.1));
        if (b % 4 === 0 && sec.energy > 0.7 && rd.chance(0.6)) hit(drums, kit.crash, t0, 0.5);
      }
      extras(sec, b, t0, rd);
    }

    // ---- bass ----
    if (sec.energy >= 0.3 || sec.kind === 'break') {
      for (const n of bassLine(plan, sec, rb)) {
        if (st.id === 'dub' && rb.chance(0.08)) continue;
        bass.note(bassKey(degToMidi(n.deg, 36), kit.bass), n.t, Math.max(0.1, n.len * 0.9));
      }
    }

    // ---- melody（イントロでは休む。演歌のイントロは琴、サビで持ち替え） ----
    if (!motifs.has(sec.kind)) motifs.set(sec.kind, makeMotif(ctx.rng(`motif-${sec.kind}`), st.notesPerBar * (0.5 + 0.5 * sec.energy)));
    if (sec.kind === 'intro' && kit.intro) {
      const koto = kit.intro;
      useMelo(koto, s0);
      // 琴：和音の音を下から上へ（ポロロン）を 2 小節ごとに
      for (let b = 0; b < sec.bars; b += 2) {
        const degs = chordDegs(plan, bar0 + b);
        for (let k = 0; k < 5; k++) melody.note(meloKey(degToMidi(degs[k % 3] + 7 * Math.floor(k / 3), 60), koto), s0 + b * 4 + k * 0.25, 1.5);
      }
    } else if (sec.kind !== 'intro' && sec.energy >= 0.35) {
      const hook = sec.kind === 'chorus' && kit.hook;
      useMelo(hook ? kit.hook! : kit.melo, s0);
      const sh = meloShift(melo);
      for (const n of realize(plan, sec, motifs.get(sec.kind)!, [4, 13], { stretch: st.id === 'ambient' ? 2 : 1 })) {
        melody.note(meloKey(degToMidi(n.deg, 60) + sh, melo), n.t, n.len);
      }
    }

    // ---- chords（スタイルの刻み方で。サビで楽器を持ち替えるスタイルも） ----
    if (st.comp !== 'none' || kit.chordPat) {
      const ch = sec.kind === 'chorus' && kit.chordHook;
      useChord(ch ? kit.chordHook![0] : kit.chord, s0);
      const pat = ch ? kit.chordHook![1] : kit.chordPat;
      // 和音は楽器の元の高さの 5 度下から上に積む（音程を大きく変えない）
      const low = chord[1] - 7;
      const lift = (m: number) => { while (m < low) m += 12; while (m >= low + 12) m -= 12; return m; };
      let hits: { t: number; len: number; degs: number[] }[];
      if (pat && sec.energy >= 0.3) {
        hits = [];
        for (let b = 0; b < sec.bars; b++) {
          const degs = chordDegs(plan, bar0 + b, !!st.sevenths);
          for (const [o, l] of pat) hits.push({ t: s0 + b * 4 + o, len: l, degs });
        }
      } else hits = compHits(plan, sec).filter(() => !rm.chance(sec.energy > 0.7 ? 0.15 : 0.35)); // 少し間引いて、メロディを邪魔しない
      for (const h of hits) {
        if (st.id === 'dub' && rm.chance(0.15)) continue;
        if (kit.power) { chords.note(chordKey(lift(degToMidi(h.degs[0], 48)), chord), h.t, h.len); continue; }
        // 和音の音を低い方から積む（まとまった響きに）
        let prev = -1;
        for (const dg of h.degs) {
          let m = lift(degToMidi(dg, 48));
          while (m <= prev) m += 12;
          prev = m;
          chords.note(chordKey(m, chord), h.t, h.len);
        }
      }
    }

    // ---- mods：後付けのツマミ ----
    // 盛り上げ（展開）はフィルターを閉じたところから開く。ほかは開けたまま
    if (sec.kind === 'build') mods.ramp(SP.cutoff, s0, 0.35, sEnd - 0.25, 1);
    else mods.set(SP.cutoff, s0, sec.energy < 0.3 ? 0.75 : 1);
    mods.set(SP.reso, s0, sec.kind === 'build' ? 0.45 : 0);
    // ブレイク・アウトロ・ただようは付点 8 分のエコー（ダブはずっと深く）
    const echo = st.id === 'dub' ? 0.55 : sec.kind === 'break' || sec.kind === 'outro' ? 0.45 : sec.kind === 'drift' ? 0.3 : 0;
    mods.set(SP.echo, s0, echo);
    mods.set(SP.echoTime, s0, Math.max(0, Math.min(1, ((0.75 * 60) / plan.bpm - 0.03) / 0.72)));
    // 壊れ度でクラッシュ（ビット落とし）と歪み
    mods.set(SP.crush, s0, Math.min(0.7, heat * 0.35));
    mods.set(SP.drive, s0, Math.min(0.3, heat * sec.energy * 0.2));
    mods.set(SP.pitch, s0, 0);
    mods.set(SP.reverse, s0, sec.kind === 'break' && rx.chance(heat * 0.5) ? 1 : 0);
    // ---- mods：BEND（壊れ度）とワンショット ----
    mods.ramp(SP.bend, s0, Math.min(0.9, heat * 0.4), sEnd - 0.5, Math.min(1, heat * sec.energy * 0.8));
    if (kit.riser >= 0 && (sec.kind === 'build' || (sec.energy > 0.6 && rx.chance(0.4)))) mods.note(kit.riser, Math.max(s0, sEnd - (kit.riser === B.riser ? 8 : 4)), 0.5);
    for (let b = 3; b < sec.bars; b += 4) {
      const t = s0 + b * 4 + 3;
      // 電子音のワンショット（生楽器のスタイルでは控えめに）
      if (rx.chance((0.3 + heat * 0.3) * (!KITS[st.id] || st.glitch > 0.3 ? 1 : 0.35))) mods.note(rx.pick([A.zap, B.laser, B.glitch, A.sweep]), t + rx.pick([0, 0.5]), 0.3);
    }
    if (kit.vox >= 0 && sec.kind === 'break' && rx.chance(0.6)) mods.note(kit.vox, s0 + 2, 1);
  }

  /** スタイルの小物：その小節（t0 から）に足す */
  function extras(sec: PlannedSection, b: number, t0: number, r: Rng): void {
    const e = sec.energy;
    if (e < 0.2) return;
    switch (st.id) {
      case 'ondo':
        // 手拍子・セクションの頭の前に「よーいっ」・最初に拍子木・4 小節目は締太鼓
        if (e > 0.5) for (const o of [0, 1.5, 2, 3]) hit(drums, C.tebyoshi, t0 + o, 0.1);
        if (b === 0 && sec.index > 0 && sec.kind !== 'outro') hit(drums, C.yooi, t0 - 1.5, 0.6);
        if (sec.index === 0 && b === 0) { hit(drums, C.hyoshigi, t0 + 1, 0.1); hit(drums, C.hyoshigi, t0 + 2, 0.1); }
        if (b % 4 === 3 && e > 0.6) steps('..........x.x.xx', t0, (t) => hit(drums, C.shime, t, 0.1));
        break;
      case 'enka':
        if (b === 0 && sec.kind === 'chorus') hit(drums, G.cymbal, t0, 0.5);
        break;
      case 'douyou':
        if (sec.kind === 'chorus') for (const o of [1, 3]) hit(drums, C.tebyoshi, t0 + o, 0.1);
        if (b === 0 && sec.kind === 'chorus') hit(drums, C.suzu, t0, 0.5);
        break;
      case 'march':
        // ドン・チャン：シンバルは 2・4 拍
        if (e > 0.4) for (const o of [1, 3]) hit(drums, G.cymbal, t0 + o, 0.3);
        break;
      case 'reggae': case 'dub':
        if (e > 0.5) steps('x.x.x.x.x.x.x.x.', t0, (t) => hit(drums, D.shaker, t + 0.02, 0.1));
        if (st.id === 'dub' && b % 4 === 3 && r.chance(0.5)) hit(drums, D.dubHit, t0 + 3, 0.3);
        if (st.id === 'dub' && b % 8 === 7 && r.chance(0.4)) hit(drums, D.siren, t0 + 2, 1);
        if (sec.kind === 'break') steps('x..x..x...x.....', t0, (t) => hit(drums, D.akete, t, 0.1));
        break;
      case 'ska':
        if (b === 0 && sec.kind === 'chorus') hit(drums, F.hey, t0, 0.3);
        break;
      case 'bossa':
        // ボサノバのクラーベ（2 小節で 1 回り）
        steps(b % 2 === 0 ? 'x..x..x.........' : '....x..x........', t0, (t) => hit(drums, E.clave, t, 0.1));
        break;
      case 'funk':
        if (e > 0.6) steps('...x..x....x.x..', t0, (t) => hit(drums, E.conga, t, 0.1));
        break;
      case 'jazz':
        // ハイハットはペダルで 2・4 拍
        for (const o of [1, 3]) hit(drums, E.pedal, t0 + o, 0.1);
        break;
      case 'house': case 'techno':
        if (e > 0.7) steps('..x...x...x...x.', t0, (t) => hit(drums, F.oh, t, 0.15));
        if (st.id === 'techno' && e > 0.5) steps(b % 2 ? '..x..x....x..x..' : 'x..x..x.x..x..x.', t0, (t) => hit(drums, F.perc, t, 0.1));
        if (st.id === 'house' && b % 8 === 7 && r.chance(0.5)) hit(drums, F.hey, t0 + 3.5, 0.3);
        break;
      case 'dnb': case 'jungle':
        if (e > 0.7) steps('x.x.x.x.x.x.x.x.', t0, (t) => hit(drums, F.ride, t, 0.1));
        break;
      case 'trap':
        // ハットの 3 連ロール
        if (r.chance(0.5)) for (let k = 0; k < 6; k++) hit(drums, F.trapHat, t0 + 3 + k / 6, 0.05);
        break;
      case 'chip':
        if (b % 4 === 3) steps('............xxxx', t0, (t) => hit(drums, G.nz, t, 0.05));
        break;
    }
  }

  powerAndCrash(plan, mods, [drums, bass, melody, chords], BOOT_BEATS);
  return [drums.finish(end), bass.finish(end), melody.finish(end), chords.finish(end), mods.finish(end)];
}
