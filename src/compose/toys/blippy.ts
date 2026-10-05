// トイPC（BLIPPY BOOK 30）の作曲係。3 つのパート（トラック）を作る：
//   keys   … 文字キーと機能キー（読み上げ・単語・つづり・ドラム・効果音・クイズ）＋モードの切り替え
//   melody … ドレミの数字キー（どのモードでも鳴るので、keys の鍵を掛けても合う）
//   mods   … 電源・クラッシュ・GLITCH ボタン・BASE・LOOP HOLD/RELEASE・STRETCH・LFO・DIST
// トイPC は 1 音ずつしか鳴らない（新しい音が前の音を切る）ので、セクションごとに「どの 16 分音符を
// keys と melody のどちらが使うか」（スロット）を先に決めてから中身を作る。
import { BTN, SYS_CRASH, SYS_POWER_ON, type SeqTrack } from '../../core/song';
import type { Rng } from '../../core/rng';
import type { Plan, PlannedSection } from '../plan';
import type { Texture } from '../styles';
import { PartWriter } from '../writer';
import { chordAt, crashSpan, drumBar, midiToDeg, snapToScale } from '../harmony';

// ================= おもちゃの番号 =================
const P = { volume: 0, mode: 1, base: 8, lfoRate: 11, lfoDepth: 12, stretch: 13, stretchHold: 14, stretchRel: 15, dist: 16, distType: 17 };
const MODE = { ABC: 0, WORD: 1, TUNE: 2, PIANO: 3, DRUM: 4, SFX: 5, QUIZ: 6, SAY: 7 };
const GLITCH = (n: number) => BTN + 3 + n; // n = 0〜4（GLITCH 1〜5）
const LOOP_HOLD = BTN + 9, LOOP_RELEASE = BTN + 10;
const L = (c: string) => c.charCodeAt(0) - 65;
/** ドレミ：1 = ド(C5) … 10 = 上のミ */
const DO = (d: number) => 30 + d - 1;
/** 起動音（「HELLO」まで）の長さ（秒）。この間はキーを押しても鳴らない */
const BOOT_SEC = 1.6;

// ================= 素材 =================
/** 単語のテーマ（文字 = そのキーの単語。C = CAT …）。どれを使うかはシードで決まる */
export const THEMES: { name: string; letters: string; words: string[] }[] = [
  { name: 'どうぶつ', letters: 'CDFOPW', words: ['CAT', 'DOG', 'PIG', 'OWL'] },
  { name: 'おしろ', letters: 'KQHGJ', words: ['KING', 'HAT', 'JAM', 'GIFT'] },
  { name: 'うちゅう', letters: 'MSRZX', words: ['MOON', 'SUN', 'ZAP', 'ROBOT'] },
  { name: 'おやつ', letters: 'AEIJN', words: ['EGG', 'JAM', 'ICE', 'NUT'] },
  { name: 'おもちゃ', letters: 'BYRVU', words: ['BALL', 'ROBOT', 'VAN', 'BOX'] },
];

/** ドラムモードの 1 本の線（1 音ずつなので、キック・スネア・ハットを交互に）。m = ドレミが入る隙間 */
const DRUM_LINES: Record<string, string[]> = {
  light: ['k...h...s...h..m', 'k.......s...h.m.', 'k...h.m.s...h...'],
  main: ['k.h.s.h.k.h.s.hm', 'k.hmk.s.hmk.s.h.', 'k..hs..hk.k.s.hm', 'k.h.s.hmk.k.s.h.'],
  dense: ['khshkhshkhshkkss', 'k.hsk.hsk.hsk.cc', 'kkh.s.hkk.h.s.hh'],
  noise: ['kzhzsztzkzhzszcz', 'k.z.s.z.kzkzs.zz', 'zzk.zzs.zzk.zzcc'],
  fill: ['k.s.k.s.k.s.ssss', 'k.k.s.s.t.t.cccc', 'kssskssskssst.t.'],
};
const DRUM_KEYS: Record<string, string> = { k: 'A', s: 'B', h: 'C', o: 'D', t: 'E', c: 'F', b: 'G', z: 'H' };
/** キャラ連打の並び（A〜D = テーマの 1〜4 文字目） */
const CHAR_PATTERNS = ['AABBAABB', 'ABABCCDD', 'AAAABBBB', 'ABCDABCD', 'AACCBBDD', 'ABACABAD'];
/** メロディのリズム（8 分音符いくつ分、合計 16 = 2 小節） */
const RHYTHMS = {
  sparse: [[4, 4, 8], [8, 8], [6, 2, 8], [4, 4, 4, 4], [12, 4]],
  mid: [[2, 2, 4, 2, 2, 4], [3, 1, 2, 2, 4, 4], [2, 2, 2, 2, 4, 4], [2, 1, 1, 4, 2, 2, 4], [4, 2, 2, 4, 2, 2]],
  dense: [[1, 1, 2, 1, 1, 2, 2, 2, 2, 2], [2, 1, 1, 2, 2, 1, 1, 2, 2, 2], [1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 2]],
};


/** 4 本のドラムの型 → 1 音ずつの線（キック > スネア > ハット。休みの半分はドレミの隙間） */
function monoLine(d: { kick: string; snare: string; hat: string }): string {
  let out = '';
  for (let i = 0; i < 16; i++) out += d.kick[i] === 'x' ? 'k' : d.snare[i] === 'x' ? 's' : d.hat[i] === 'x' ? 'h' : i % 4 === 2 ? 'm' : '.';
  return out;
}

export interface BlippyContext {
  plan: Plan;
  toy: number;
  /** 乱数：パート名＋セクション番号ごと（セクションだけ作り直すとき、そのセクションの乱数だけ変わる） */
  rng(part: string, section?: number): Rng;
}

export function composeBlippy(ctx: BlippyContext): (SeqTrack & { part: string })[] {
  const { plan } = ctx;
  const end = plan.bars * 4;
  const bpb = 4;
  const keys = new PartWriter(ctx.toy, 'blippy:keys', 'トイPC 声・リズム');
  const mel = new PartWriter(ctx.toy, 'blippy:melody', 'トイPC ドレミ');
  const mods = new PartWriter(ctx.toy, 'blippy:mods', 'トイPC 改造パーツ');
  const song = ctx.rng('song');
  const theme = song.pick(THEMES);
  const bootBeats = Math.ceil(((BOOT_SEC * plan.bpm) / 60) * 2) / 2;

  // ---- 電源・最初の状態 ----
  mods.note(SYS_POWER_ON, 0, 0.5);
  mods.set(P.volume, 0, 0.72);
  mods.set(P.dist, 0, 0);
  mods.set(P.distType, 0, 0);
  mods.set(P.lfoDepth, 0, 0);
  mods.set(P.lfoRate, 0, plan.style.id === 'ambient' ? 0.18 : 0.35);
  mods.set(P.stretch, 0, 0);
  mods.set(P.base, 0, 0);

  // ---- クラッシュの区間（キーを置かない） ----
  const crash = crashSpan(plan);
  if (crash) mods.note(SYS_CRASH, crash.start, crash.end - crash.start);

  // ---- メロディのモチーフ（セクションの種類ごとに 1 つ。同じ種類のセクションは同じモチーフ＝繰り返し） ----
  const motifs = new Map<string, { rhythm: number[]; steps: number[]; startTone: number }>();
  const motifFor = (kind: string, sec: PlannedSection) => {
    if (!motifs.has(kind)) {
      const r = ctx.rng(`motif-${kind}`);
      const per = plan.style.notesPerBar * (0.6 + 0.6 * sec.energy);
      const pool = per <= 2.5 ? RHYTHMS.sparse : per <= 5 ? RHYTHMS.mid : RHYTHMS.dense;
      const rhythm = r.pick(pool);
      const steps = rhythm.map(() => r.pick([-2, -1, -1, 1, 1, 2, 0, 3, -3]));
      motifs.set(kind, { rhythm, steps, startTone: r.int(3) });
    }
    return motifs.get(kind)!;
  };
  /** コードの構成音（ドレミの 1〜10 で）。度数 d のコード = 音階の d, d+2, d+4 */
  const chordTones = (bar: number) => {
    const d = chordAt(plan, Math.max(0, bar));
    const set = new Set([d % 7, (d + 2) % 7, (d + 4) % 7]);
    return Array.from({ length: 10 }, (_, i) => i + 1).filter((n) => set.has((n - 1) % 7));
  };
  const nearest = (list: number[], p: number) => list.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a), list[0]);
  let lastPitch = 5;

  for (const sec of plan.sections) {
    const r = ctx.rng('keys', sec.index);
    const rm = ctx.rng('melody', sec.index);
    const rx = ctx.rng('mods', sec.index);
    const rs = ctx.rng('slots', sec.index); // keys と melody の分担（両方のパートで同じ）
    const tex: Texture = plan.style.blippy[sec.kind] ?? plan.style.blippy.default;
    const s0 = sec.start, steps = sec.bars * 16;
    const at = (i: number) => s0 + i * 0.25;
    // ---- スロット：16 分音符ごとに k（keys）/ m（melody）/ 空き ----
    const slot: string[] = Array(steps).fill('');
    const drumLine: string[] = Array(steps).fill('.');
    switch (tex) {
      case 'say':
        for (let b = 0; b < sec.bars; b += 2) { slot[b * 16] = 'k'; for (let i = (b + 1) * 16; i < Math.min(steps, (b + 2) * 16); i++) slot[i] = 'm'; }
        break;
      case 'callmel':
        for (let i = 0; i < steps; i++) slot[i] = i % 64 >= 56 ? 'k' : 'm';
        break;
      case 'spell':
        for (let i = 0; i < steps; i++) slot[i] = Math.floor(i / 16) % 2 === 0 ? 'k' : 'm';
        break;
      case 'drum': {
        const lines = sec.energy < 0.4 ? DRUM_LINES.light : sec.energy > 0.8 ? DRUM_LINES.dense : DRUM_LINES.main;
        const base = rs.pick(lines);
        const fromKit = !['plain', 'beat', 'noise'].includes(plan.style.drums);
        for (let b = 0; b < sec.bars; b++) {
          const kit = fromKit ? drumBar(plan, sec, b, rs) : null;
          const line = kit ? monoLine(kit) : b % 4 === 3 && sec.bars >= 4 ? rs.pick(DRUM_LINES.fill) : b % 2 === 1 && rs.chance(0.4) ? rs.pick(lines) : base;
          for (let i = 0; i < 16; i++) {
            const c = line[i];
            drumLine[b * 16 + i] = c;
            slot[b * 16 + i] = c === 'm' ? 'm' : c === '.' ? '' : 'k';
          }
        }
        break;
      }
      case 'chars':
        for (let i = 0; i < steps; i += 2) slot[i] = 'k';
        break;
      case 'sfx': case 'quiz': {
        const dens = 0.25 + 0.5 * sec.energy;
        for (let i = 0; i < steps; i += tex === 'sfx' ? 1 : 2) {
          if (i % 4 === 0 && rs.chance(dens)) slot[i] = 'k';
          else if (tex === 'sfx' && rs.chance(dens * 0.35)) slot[i] = 'k';
          else if (i % 8 === 4 && rs.chance(0.3)) slot[i] = 'm';
        }
        break;
      }
      case 'long':
        for (let i = 0; i < steps; i++) slot[i] = 'm';
        break;
    }

    // ---- カバー：解析したメロディが鳴っている所は melody に（1 音ずつなので、声・ドラムより優先） ----
    const coverMel = plan.cover ? plan.cover.melody.filter((n) => n.t >= s0 && n.t < s0 + sec.bars * 4) : null;
    if (coverMel) for (const n of coverMel) {
      const i0 = Math.round((n.t - s0) * 4), i1 = Math.min(steps, i0 + Math.max(1, Math.round(n.len * 4)));
      for (let i = i0; i < i1; i++) slot[i] = 'm';
    }
    // ---- keys：モードと文字 ----
    const mode = { say: MODE.SAY, callmel: MODE.WORD, spell: MODE.ABC, drum: MODE.DRUM, chars: MODE.WORD, sfx: MODE.SFX, quiz: MODE.QUIZ, long: MODE.SAY }[tex];
    keys.set(P.mode, Math.max(0, s0 - 0.25), mode);
    const themeL = [...theme.letters];
    let wordIdx = r.int(theme.words.length);
    const charPat = r.pick(CHAR_PATTERNS);
    let callN = r.int(themeL.length);
    for (let i = 0; i < steps; i++) {
      if (slot[i] !== 'k') continue;
      const t = at(i);
      switch (tex) {
        case 'say': case 'long':
          keys.note(L(themeL[callN++ % themeL.length]), t, 0.5);
          break;
        case 'callmel': {
          if (i % 64 !== 56 && i % 64 !== 60) break;
          keys.note(L(themeL[callN++ % themeL.length]), t, 0.5);
          break;
        }
        case 'spell': {
          if (i % 2) break;
          const w = theme.words[wordIdx % theme.words.length];
          const k = (i % 16) / 2;
          if (k < w.length) keys.note(L(w[k]), t, 0.4);
          else if (k === w.length + 1) wordIdx++;
          break;
        }
        case 'drum':
          keys.note(L(DRUM_KEYS[drumLine[i]] ?? 'A'), t, 0.2);
          break;
        case 'chars': {
          const bar = Math.floor(i / 16);
          // 4 小節目の後半は 16 分で連打
          if (bar % 4 === 3 && i % 16 >= 8 && sec.energy > 0.7) { for (let j = 0; j < 2; j++) keys.note(L(themeL[(callN + j) % themeL.length]), t + j * 0.25, 0.2); break; }
          const c = charPat[(i / 2) % 8];
          keys.note(L(themeL[('ABCD'.indexOf(c) + Math.floor(bar / 2)) % themeL.length]), t, 0.4);
          break;
        }
        case 'sfx':
          keys.note(r.int(26), t, 0.25);
          break;
        case 'quiz':
          keys.note(r.int(26), t, 0.4);
          break;
      }
    }
    // 呼びかけの後、ときどき機能キー（♪ ? ★ OK）で返す（読み上げ系のセクション）
    if ((tex === 'callmel' || tex === 'say') && sec.bars >= 4 && r.chance(0.5)) keys.note(26 + r.int(4), s0 + sec.bars * 4 - 1, 0.25);

    // ---- melody（カバー）：解析したメロディをドレミの 1〜10 で ----
    if (coverMel) for (const n of coverMel) {
      let d = snapToScale(plan, midiToDeg(n.midi));
      while (d > 9) d -= 7;
      while (d < 0) d += 7;
      mel.note(DO(d + 1), n.t, Math.max(0.15, n.len * 0.9));
    }
    // ---- melody：モチーフを繰り返し、ときどき変える ----
    const motif = motifFor(sec.kind, sec);
    const long = tex === 'long';
    let pos = coverMel ? steps : 0, rep = 0; // カバーのときはモチーフを作らない
    while (pos < steps) {
      const variant = rep % 2 === 1;
      let pitch = nearest(chordTones(Math.floor((s0 + pos / 4) / 4)), lastPitch + (rep % 4 === 3 ? 2 : 0));
      motif.rhythm.forEach((dur8, j) => {
        const i = pos;
        const len16 = (long ? dur8 * 2 : dur8) * 2;
        pos += len16;
        if (i >= steps) return;
        const bar = Math.floor((s0 + i / 4) / 4);
        let step = motif.steps[j];
        if (variant && j >= motif.rhythm.length - 2) step = -step || 1; // 2 回目は終わりを変える
        if (j > 0) pitch += step;
        if (pitch < 1) pitch = 2 - pitch;
        if (pitch > 10) pitch = 20 - pitch;
        if ((i / 4) % 1 === 0) pitch = nearest(chordTones(bar), pitch); // 拍の頭はコードの音
        pitch = Math.max(1, Math.min(10, snapToScale(plan, pitch - 1) + 1)); // スタイルの音階へ（ドレミの 1 = 段 0）
        if (slot[i] !== 'm') return;
        if (!long && rm.chance(0.12 * (1 - sec.energy))) return; // ときどき休む
        const nlen = Math.max(0.2, (len16 / 4) * 0.8);
        if (plan.style.ornament === 'kobushi' && nlen >= 1.2 && pitch < 10) {
          // こぶし：上の音をちょんちょんと回してから伸ばす
          const up = Math.min(10, snapToScale(plan, pitch) + 1);
          mel.note(DO(up), at(i), 0.12);
          mel.note(DO(pitch), at(i) + 0.13, 0.12);
          mel.note(DO(up), at(i) + 0.26, 0.1);
          mel.note(DO(pitch), at(i) + 0.38, nlen - 0.38);
        } else mel.note(DO(pitch), at(i), nlen);
        lastPitch = pitch;
        // アンビエント：鳴らした音を LOOP HOLD でつかんで、長くうねらせる
        if (long && len16 >= 16) {
          mods.note(LOOP_HOLD, at(i) + 0.15, 0.25);
          mods.note(LOOP_RELEASE, at(i) + len16 / 4 - 0.3, 0.2);
        }
      });
      rep++;
    }

    // ---- mods：グリッチ・LFO・歪み（盛り上がりと壊れ度に合わせて） ----
    const heat = sec.chaos * plan.style.glitch;
    const base = heat < 0.3 ? rx.int(2) : heat < 0.8 ? 1 + rx.int(3) : 2 + rx.int(3);
    mods.set(P.base, Math.max(0, s0 - 0.1), base);
    const perBar = heat * sec.energy * 3;
    for (let b = 0; b < sec.bars; b++) {
      let n = Math.floor(perBar) + (rx.chance(perBar % 1) ? 1 : 0);
      if (b === 0 && sec.index === 0) n = 0; // 起動の小節は触らない
      const used = new Set<number>();
      for (let k = 0; k < n; k++) {
        const beat = rx.int(4);
        if (used.has(beat)) continue;
        used.add(beat);
        const len = rx.pick([0.5, 0.5, 1, 1, 2]) * (sec.energy > 0.8 ? 1 : 0.75);
        mods.note(GLITCH(rx.int(5)), s0 + b * 4 + beat, Math.min(len, 4 - beat));
      }
    }
    // 歪み：セクションの中でじわっと
    const distTo = Math.min(0.9, heat * sec.energy * 0.9);
    mods.ramp(P.dist, s0, Math.min(0.9, distTo * 0.6), s0 + sec.bars * 4 - 0.5, distTo);
    if (heat > 0.8 && rx.chance(0.5)) mods.set(P.distType, s0, 1);
    else mods.set(P.distType, s0, 0);
    // LFO：展開・ふくらみでうねる
    const lfoTo = ['build', 'swell', 'drift', 'noise'].includes(sec.kind) ? 0.35 + 0.5 * sec.energy : sec.energy * 0.35 * Math.min(1, sec.chaos);
    mods.ramp(P.lfoDepth, s0, lfoTo * 0.4, s0 + sec.bars * 4 - 0.5, lfoTo);
    // STRETCH：アンビエント・崩壊で
    mods.set(P.stretch, s0, tex === 'long' || sec.kind === 'collapse' || (sec.kind === 'break' && rx.chance(0.5)) ? 1 : 0);
    if (tex === 'long') { mods.set(P.stretchHold, s0, 0.3 + 0.5 * rx.next()); mods.set(P.stretchRel, s0, 0.3 + 0.5 * rx.next()); }
    // LOOP HOLD → LFO 全開 → RELEASE（盛り上がる区間の最後の 2 小節）
    if (!long && sec.bars >= 4 && ['build', 'chorus', 'noise', 'swell'].includes(sec.kind) && rx.chance(0.35 + 0.4 * Math.min(1, sec.chaos))) {
      const h = s0 + (sec.bars - 2) * 4;
      mods.note(LOOP_HOLD, h + 0.1, 0.25);
      mods.ramp(P.lfoDepth, h + 0.2, lfoTo, h + 6, 1);
      mods.note(LOOP_RELEASE, h + 7.5, 0.25);
      mods.set(P.lfoDepth, h + 7.8, lfoTo * 0.4);
      keys.clear(h + 0.3, h + 7.5);
      mel.clear(h + 0.3, h + 7.5);
    }
  }

  // ---- 起動中・クラッシュ中はキーを置かない（押しても鳴らない・無音の演出を守る） ----
  keys.clear(0, bootBeats);
  mel.clear(0, bootBeats);
  if (crash) {
    keys.clear(crash.start, crash.end + bootBeats);
    mel.clear(crash.start, crash.end + bootBeats);
    mods.clear(crash.start + 0.01, crash.end + bootBeats, (n) => n.key === SYS_CRASH);
  }
  return [keys.finish(end), mel.finish(end), mods.finish(end)];
}
