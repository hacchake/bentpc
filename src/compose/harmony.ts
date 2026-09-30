// 作曲係の共通の道具：コード・音階・メロディ（モチーフの繰り返し）・ベース・ドラムの型・クラッシュの区間。
// 曲は ハ長調／イ短調（plan.chords はハ長調の度数 0 = C, 1 = Dm … 5 = Am）。
import type { Rng } from '../core/rng';
import type { Plan, PlannedSection } from './plan';

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** 音階の段（0 = ド）→ MIDI ノート。base = 段 0 の高さ（60 = C4） */
export const degToMidi = (deg: number, base = 60) => base + 12 * Math.floor(deg / 7) + MAJOR[((deg % 7) + 7) % 7];
/** その小節のコードの音（音階の段 0〜6） */
export const chordDegs = (plan: Plan, bar: number) => {
  const d = plan.chords[Math.max(0, Math.min(plan.chords.length - 1, bar))];
  return [d % 7, (d + 2) % 7, (d + 4) % 7];
};
export const barOf = (beat: number) => Math.floor(beat / 4);
const nearest = (list: number[], p: number) => list.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a), list[0]);

// ================= メロディ：2 小節のモチーフを繰り返し、ときどき変える =================
export interface Motif { rhythm: number[]; steps: number[]; rests: boolean[] }
const RHYTHMS = {
  sparse: [[4, 4, 8], [8, 8], [6, 2, 8], [4, 4, 4, 4], [12, 4]],
  mid: [[2, 2, 4, 2, 2, 4], [3, 1, 2, 2, 4, 4], [2, 2, 2, 2, 4, 4], [2, 1, 1, 4, 2, 2, 4], [4, 2, 2, 4, 2, 2]],
  dense: [[1, 1, 2, 1, 1, 2, 2, 2, 2, 2], [2, 1, 1, 2, 2, 1, 1, 2, 2, 2], [1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 2]],
};
/** notesPerBar：1 小節に入る音の数のめやす */
export function makeMotif(r: Rng, notesPerBar: number): Motif {
  const pool = notesPerBar <= 2.5 ? RHYTHMS.sparse : notesPerBar <= 5 ? RHYTHMS.mid : RHYTHMS.dense;
  const rhythm = r.pick(pool);
  return { rhythm, steps: rhythm.map(() => r.pick([-2, -1, -1, 1, 1, 2, 0, 3, -3])), rests: rhythm.map(() => r.chance(0.08)) };
}

export interface MelNote { t: number; len: number; deg: number }
/**
 * モチーフでセクションを埋める。range = 使える音階の段の範囲（0 = ド）。
 * 2 回目は終わりを変え、4 回目は少し高く始める。拍の頭はコードの音にそろえる。stretch = リズムを何倍に伸ばすか
 */
export function realize(plan: Plan, sec: PlannedSection, motif: Motif, range: [number, number], opts: { stretch?: number; start?: number; gate?: number } = {}): MelNote[] {
  const out: MelNote[] = [];
  const st = opts.stretch ?? 1;
  const end = sec.start + sec.bars * 4;
  let t = sec.start + (opts.start ?? 0);
  let rep = 0;
  let pitch = Math.round((range[0] + range[1]) / 2);
  while (t < end - 1e-6) {
    const variant = rep % 2 === 1;
    pitch = nearest(chordDegsIn(plan, barOf(t), range), pitch + (rep % 4 === 3 ? 2 : 0));
    motif.rhythm.forEach((d8, j) => {
      const len = d8 * 0.5 * st;
      const at = t;
      t += len;
      if (at >= end - 1e-6) return;
      let step = motif.steps[j];
      if (variant && j >= motif.rhythm.length - 2) step = -step || 1;
      if (j > 0) pitch += step;
      if (pitch < range[0]) pitch = 2 * range[0] - pitch;
      if (pitch > range[1]) pitch = 2 * range[1] - pitch;
      if (at % 1 === 0) pitch = nearest(chordDegsIn(plan, barOf(at), range), pitch);
      pitch = Math.max(range[0], Math.min(range[1], pitch));
      if (motif.rests[j] && !variant) return;
      out.push({ t: at, len: Math.min(len, end - at) * (opts.gate ?? 0.85), deg: pitch });
    });
    rep++;
  }
  return out;
}
/** 範囲の中のコードの音（音階の段） */
export function chordDegsIn(plan: Plan, bar: number, range: [number, number]): number[] {
  const set = new Set(chordDegs(plan, bar));
  const out: number[] = [];
  for (let d = range[0]; d <= range[1]; d++) if (set.has(((d % 7) + 7) % 7)) out.push(d);
  return out.length ? out : [range[0]];
}

// ================= ベース：小節ごとにコードの根音 =================
const BASS_RHYTHMS = [
  [[0, 1.5], [2, 1.5]],
  [[0, 0.75], [1.5, 0.5], [2, 0.75], [3.5, 0.4]],
  [[0, 3.5]],
  [[0, 0.4], [0.5, 0.4], [1, 0.4], [1.5, 0.4], [2, 0.4], [2.5, 0.4], [3, 0.4], [3.5, 0.4]],
  [[0, 0.75], [0.75, 0.75], [2, 0.75], [3, 0.5]],
];
/** セクションのベース（根音の音階の段と、拍・長さ） */
export function bassLine(plan: Plan, sec: PlannedSection, r: Rng): MelNote[] {
  const out: MelNote[] = [];
  const pat = sec.energy > 0.75 ? r.pick([BASS_RHYTHMS[1], BASS_RHYTHMS[3], BASS_RHYTHMS[4]]) : sec.energy < 0.3 ? BASS_RHYTHMS[2] : r.pick(BASS_RHYTHMS.slice(0, 2));
  for (let b = 0; b < sec.bars; b++) {
    const bar = barOf(sec.start) + b;
    const root = plan.chords[Math.min(plan.chords.length - 1, bar)];
    for (const [o, len] of pat) out.push({ t: sec.start + b * 4 + o, len, deg: o === 1.5 && sec.energy > 0.6 ? root + 4 : root });
  }
  return out;
}

// ================= ドラムの型（16 分 × 16） =================
export interface DrumBar { kick: string; snare: string; hat: string }
const DRUMS: Record<string, DrumBar[]> = {
  sparse: [{ kick: 'x...............', snare: '................', hat: '........x.......' }, { kick: 'x.......x.......', snare: '................', hat: '....x.......x...' }],
  plain: [{ kick: 'x.......x.......', snare: '....x.......x...', hat: 'x...x...x...x...' }, { kick: 'x.......x.x.....', snare: '....x.......x...', hat: '..x...x...x...x.' }],
  beat: [
    { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    { kick: 'x.....x...x.....', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.xx' },
    { kick: 'x..x..x...x..x..', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
  ],
  noise: [
    { kick: 'x.x...x.xx..x...', snare: '..x...x...x.x.xx', hat: 'x.xxx.x.xx.xx.x.' },
    { kick: 'xx..x.x.x..xx...', snare: '....x..x..x.x.x.', hat: 'x.x.xxx.x.x.xxxx' },
  ],
  fill: [
    { kick: 'x.......x.......', snare: '....x...x.x.xxxx', hat: 'x.x.x.x.........' },
    { kick: 'x...x...x.x.x.x.', snare: '....x.x.x.x.xxxx', hat: '................' },
  ],
};
/** セクションの小節 b のドラム（4 小節目はフィル） */
export function drumBar(styleId: string, sec: PlannedSection, b: number, r: Rng): DrumBar | null {
  if (sec.energy < 0.2) return null;
  const set = sec.energy < 0.35 || styleId === 'ambient' ? DRUMS.sparse : styleId === 'noise' || (styleId === 'collapse' && sec.chaos > 1) ? DRUMS.noise : styleId === 'plain' ? DRUMS.plain : DRUMS.beat;
  if (b % 4 === 3 && sec.bars >= 4 && set !== DRUMS.sparse) return r.pick(DRUMS.fill);
  return set[(Math.floor(b / 2) + (sec.energy > 0.8 ? 1 : 0)) % set.length];
}
export function steps(pattern: string, beat: number, each: (t: number) => void): void {
  [...pattern].forEach((c, i) => { if (c === 'x') each(beat + i * 0.25); });
}

// ================= クラッシュ：どこで固まり、いつ戻るか =================
/** クラッシュの区間（拍）。最後のセクションなら曲の終わりまで。どのおもちゃも同じ区間（同時に壊れる） */
export function crashSpan(plan: Plan): { start: number; end: number } | null {
  const bootBeats = 4; // 再起動の後に空けておく分
  if (plan.crashSection < 0) return null;
  const s = plan.sections[plan.crashSection];
  const sb = s.bars * 4;
  const end = plan.bars * 4;
  const isLast = plan.crashSection === plan.sections.length - 1;
  const start = s.start + (isLast ? Math.max(2, Math.floor(sb / 2)) : 1);
  const len = isLast ? end - 0.5 - start : Math.min(8, Math.max(3, sb - bootBeats - 3));
  return { start, end: start + len };
}

/** 盛り上がりに合わせたノブの値（0〜1） */
export const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));
