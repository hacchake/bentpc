// 作曲係の共通の道具：コード・音階・メロディ（モチーフの繰り返し）・ベース・伴奏・ドラムの型・ハネ・クラッシュの区間。
// 曲は白鍵の世界（plan.chords はハ長調の度数 0 = C, 1 = Dm … 5 = Am）。スタイルの音階（ヨナ抜きなど）で使う音をしぼる。
// ベース・伴奏・ドラムの型は、スタイルの表（styles.ts）の bass / comp / drums で決まる。
import type { Rng } from '../core/rng';
import type { Plan, PlannedSection } from './plan';
import { SCALES, type DrumKit } from './styles';

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** 音階の段（0 = ド）→ MIDI ノート。base = 段 0 の高さ（60 = C4） */
export const degToMidi = (deg: number, base = 60) => base + 12 * Math.floor(deg / 7) + MAJOR[((deg % 7) + 7) % 7];
const mod7 = (d: number) => ((d % 7) + 7) % 7;
/** その位置（小節。3.5 = 4 小節目の後半）のコード（度数）。半小節ごとのコードがあれば、それを使う */
export const chordAt = (plan: Plan, bar: number) => {
  const h = plan.chordsHalf;
  if (h?.length) return h[Math.max(0, Math.min(h.length - 1, Math.floor(bar * 2 + 1e-6)))];
  return plan.chords[Math.max(0, Math.min(plan.chords.length - 1, Math.floor(bar + 1e-6)))];
};
/** その位置のコードの音のずらし（半音。chordDegs と同じ並び。7 の音はずらさない）。調の中のコードなら undefined */
export const chordAccAt = (plan: Plan, bar: number, seventh = false): number[] | undefined => {
  const a = plan.chordAcc;
  if (!a?.length) return undefined;
  const v = a[Math.max(0, Math.min(a.length - 1, Math.floor(bar * 2 + 1e-6)))];
  return v ? (seventh ? [...v, 0] : v) : undefined;
};
/** 和音の i 番目の音の高さ（MIDI）。調の外のコードは acc の分ずらす */
export const hitMidi = (h: { degs: number[]; acc?: number[] }, i: number, base: number) => degToMidi(h.degs[i], base) + (h.acc?.[i] ?? 0);
/** その和音が短三和音（か減三和音）か：根音から 3 度の音までの半音で */
export const hitMinor = (h: { degs: number[]; acc?: number[] }) => {
  if (h.degs.length < 2) return [1, 2, 5, 6].includes(((h.degs[0] % 7) + 7) % 7);
  return (((hitMidi(h, 1, 60) - hitMidi(h, 0, 60)) % 12) + 12) % 12 === 3;
};
/** その小節（小数なら、その位置）のコードの音（音階の段 0〜6）。seventh = 7 の音も */
export const chordDegs = (plan: Plan, bar: number, seventh = false) => {
  const d = chordAt(plan, bar);
  const out = [mod7(d), mod7(d + 2), mod7(d + 4)];
  if (seventh) out.push(mod7(d + 6));
  return out;
};
export const barOf = (beat: number) => Math.floor(beat / 4);
const nearest = (list: number[], p: number) => list.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a), list[0]);

/** スタイルの音階に入っていない音を、近い音へずらす（下を優先） */
export function snapToScale(plan: Plan, deg: number): number {
  const ok = SCALES[plan.style.scale].degs;
  if (ok.includes(mod7(deg))) return deg;
  for (const d of [-1, 1, -2, 2]) if (ok.includes(mod7(deg + d))) return deg + d;
  return deg;
}

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

/** acc：半音のずれ（カバーで、白鍵に無い音を弾くため。degToMidi に足す） */
export interface MelNote { t: number; len: number; deg: number; acc?: number }
/**
 * モチーフでセクションを埋める。range = 使える音階の段の範囲（0 = ド）。
 * 2 回目は終わりを変え、4 回目は少し高く始める。拍の頭はコードの音にそろえ、スタイルの音階に入れる。
 * 演歌（ornament = kobushi）は、長い音の前に上の音から小さく回す（こぶし）。stretch = リズムを何倍に伸ばすか
 */
export function realize(plan: Plan, sec: PlannedSection, motif: Motif, range: [number, number], opts: { stretch?: number; start?: number; gate?: number } = {}): MelNote[] {
  if (plan.cover) return coverNotes(plan, plan.cover.melody, sec, range, opts.gate ?? 0.9);
  const out: MelNote[] = [];
  const st = opts.stretch ?? 1;
  const end = sec.start + sec.bars * 4;
  const kobushi = plan.style.ornament === 'kobushi';
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
      pitch = Math.max(range[0], Math.min(range[1], snapToScale(plan, pitch)));
      if (motif.rests[j] && !variant) return;
      const l = Math.min(len, end - at) * (opts.gate ?? 0.85);
      if (kobushi && l >= 1.2) {
        // こぶし：上の音 → 本当の音 → 上の音 → 本当の音、と小さく回してから伸ばす
        const up = Math.min(range[1], snapToScale(plan, pitch + 1));
        out.push({ t: at, len: 0.12, deg: up }, { t: at + 0.13, len: 0.12, deg: pitch }, { t: at + 0.26, len: 0.1, deg: up });
        out.push({ t: at + 0.38, len: l - 0.38, deg: pitch });
      } else out.push({ t: at, len: l, deg: pitch });
    });
    rep++;
  }
  return out;
}
/** 範囲の中のコードの音（音階の段）。スタイルの音階に入る音だけ（無ければコードの音全部） */
export function chordDegsIn(plan: Plan, bar: number, range: [number, number]): number[] {
  const set = new Set(chordDegs(plan, bar));
  const ok = SCALES[plan.style.scale].degs;
  const all: number[] = [], inScale: number[] = [];
  for (let d = range[0]; d <= range[1]; d++) {
    if (!set.has(mod7(d))) continue;
    all.push(d);
    if (ok.includes(mod7(d))) inScale.push(d);
  }
  return inScale.length ? inScale : all.length ? all : [range[0]];
}

// ================= ベース：スタイルの弾き方で =================
/** [拍の位置, 長さ, 根音からの段（0 = 根音、4 = 5 度、7 = オクターブ上）] */
type BassHit = [number, number, number];
const BASS: Record<string, BassHit[][]> = {
  root: [[[0, 1.5, 0], [2, 1.5, 0]], [[0, 0.75, 0], [1.5, 0.5, 4], [2, 0.75, 0], [3.5, 0.4, 0]], [[0, 0.75, 0], [0.75, 0.75, 0], [2, 0.75, 0], [3, 0.5, 4]]],
  rootSlow: [[[0, 3.5, 0]]],
  offbeat: [[[0, 1, 0], [1.5, 0.4, 0], [2.5, 0.4, 4], [3, 0.75, 0]], [[0, 0.75, 0], [1, 0.4, 2], [1.5, 0.4, 0], [3, 0.9, 4]]],
  reese: [[[0, 3.9, 0]], [[0, 2.5, 0], [2.75, 1.1, 0]], [[0, 1.4, 0], [1.5, 2.4, -1]]],
  octave: [[[0, 0.4, 0], [0.5, 0.4, 7], [1, 0.4, 0], [1.5, 0.4, 7], [2, 0.4, 0], [2.5, 0.4, 7], [3, 0.4, 0], [3.5, 0.4, 7]]],
  syncop: [[[0, 0.5, 0], [0.75, 0.25, 0], [1.5, 0.5, 4], [2.75, 0.25, 0], [3, 0.5, 7]], [[0, 0.6, 0], [1.25, 0.25, 0], [1.75, 0.5, 2], [3, 0.4, 0], [3.5, 0.25, 4]]],
  pedal: [[[0.5, 0.25, 0], [1.5, 0.25, 0], [2.5, 0.25, 0], [3.5, 0.25, 0]], [[0, 0.2, 0], [0.5, 0.2, 0], [1, 0.2, 0], [1.5, 0.2, 0], [2, 0.2, 0], [2.5, 0.2, 0], [3, 0.2, 0], [3.5, 0.2, 0]]],
};
/** セクションのベース（音階の段と、拍・長さ） */
export function bassLine(plan: Plan, sec: PlannedSection, r: Rng): MelNote[] {
  if (plan.cover) return coverNotes(plan, plan.cover.bass, sec, [0, 6], 0.9);
  const out: MelNote[] = [];
  const type = plan.style.bass;
  if (type === 'none') return out;
  for (let b = 0; b < sec.bars; b++) {
    const bar = barOf(sec.start) + b;
    const root = plan.chords[Math.min(plan.chords.length - 1, bar)];
    const t0 = sec.start + b * 4;
    if (type === 'walking') {
      // 歩くベース：根音 → 3 度 → 5 度 → 次のコードへ半音階ならぬ「段」で近づく
      const next = plan.chords[Math.min(plan.chords.length - 1, bar + 1)];
      const steps = [root, root + 2, root + 4, next + (next > root ? -1 : 1)];
      steps.forEach((d, i) => out.push({ t: t0 + i, len: 0.9, deg: d }));
      continue;
    }
    const pats = sec.energy < 0.3 && type === 'root' ? BASS.rootSlow : BASS[type] ?? BASS.root;
    const pat = pats[(Math.floor(b / 2) + (sec.energy > 0.75 ? 1 : 0) + r.int(2) * (b % 4 === 3 ? 1 : 0)) % pats.length];
    for (const [o, len, iv] of pat) out.push({ t: t0 + o, len, deg: root + iv });
  }
  return out;
}

// ================= カバー：解析した音符 → 音階の段 =================
/** MIDI → 音階の段（60 = C4 が 0。黒鍵は下の白鍵へ） */
export function midiToDeg(midi: number): number {
  const oct = Math.floor(midi / 12) - 5, pc = ((midi % 12) + 12) % 12;
  let idx = 0;
  for (let i = 0; i < 7; i++) if (MAJOR[i] <= pc) idx = i;
  return oct * 7 + idx;
}
/** セクションの中の解析の音符を、範囲（段）に入るようオクターブで動かして返す */
function coverNotes(plan: Plan, notes: { t: number; len: number; midi: number }[], sec: PlannedSection, range: [number, number], gate: number): MelNote[] {
  const a = sec.start, b = sec.start + sec.bars * 4;
  return notes.filter((n) => n.t >= a && n.t < b).map((n) => {
    // カバーはスタイルの音階に寄せない（元の曲の音のまま）。白鍵に無い音は acc（半音）で持つ
    let deg = midiToDeg(n.midi), midi = n.midi;
    while (deg > range[1]) { deg -= 7; midi -= 12; }
    while (deg < range[0]) { deg += 7; midi += 12; }
    return { t: n.t, len: Math.max(0.1, Math.min(n.len, b - n.t) * gate), deg, acc: midi - degToMidi(deg, 60) };
  });
}

// ================= 伴奏（コード）：スタイルの弾き方で =================
export interface CompHit { t: number; len: number; degs: number[]; acc?: number[] }
const COMP: Record<string, [number, number][]> = {
  pad: [[0, 3.9]],
  offbeat: [[0.5, 0.25], [1.5, 0.25], [2.5, 0.25], [3.5, 0.25]],
  stab: [[0.5, 0.2], [1.75, 0.2], [2.5, 0.2]],
  strum: [[0, 0.5], [0.75, 0.5], [1.5, 0.5], [2.5, 0.75], [3.25, 0.5]],
  block: [[0, 0.4], [1, 0.4], [2, 0.4], [3, 0.4]],
};
/**
 * 刻み方の 1 つ（小節の頭からの拍 o・長さ len）を、その位置のコードで。小節の途中でコードが変わる曲は、
 * 3 拍目をまたぐ長い音を 2 つに分ける
 */
export function hitsIn(plan: Plan, bar: number, t0: number, o: number, len: number, seventh: boolean): CompHit[] {
  const differ = chordAt(plan, bar) !== chordAt(plan, bar + 0.5) || String(chordAccAt(plan, bar)) !== String(chordAccAt(plan, bar + 0.5));
  if ((plan.chordsHalf || plan.chordAcc) && o < 2 && o + len > 2.05 && differ) {
    return [{ t: t0 + o, len: 2 - o, degs: chordDegs(plan, bar, seventh), acc: chordAccAt(plan, bar, seventh) }, { t: t0 + 2, len: o + len - 2, degs: chordDegs(plan, bar + 0.5, seventh), acc: chordAccAt(plan, bar + 0.5, seventh) }];
  }
  return [{ t: t0 + o, len, degs: chordDegs(plan, bar + o / 4, seventh), acc: chordAccAt(plan, bar + o / 4, seventh) }];
}
/** セクションの伴奏：小節ごとのコードを、スタイルの弾き方で（arp は 16 分で 1 音ずつ） */
export function compHits(plan: Plan, sec: PlannedSection): CompHit[] {
  const out: CompHit[] = [];
  const type = plan.style.comp;
  if (type === 'none') return out;
  for (let b = 0; b < sec.bars; b++) {
    const bar = barOf(sec.start) + b;
    const t0 = sec.start + b * 4;
    if (type === 'arp') {
      for (let i = 0; i < 16; i++) {
        const degs = chordDegs(plan, bar + i / 16, !!plan.style.sevenths), acc = chordAccAt(plan, bar + i / 16, !!plan.style.sevenths);
        const seq = [...degs, degs[0] + 7, ...degs.slice(1).reverse()];
        const aseq = acc ? [...acc, acc[0], ...acc.slice(1).reverse()] : undefined;
        out.push({ t: t0 + i * 0.25, len: 0.22, degs: [seq[i % seq.length]], acc: aseq ? [aseq[i % aseq.length]] : undefined });
      }
      continue;
    }
    const pat = sec.energy < 0.3 ? COMP.pad : COMP[type] ?? COMP.pad;
    for (const [o, len] of pat) out.push(...hitsIn(plan, bar, t0, o, len, !!plan.style.sevenths));
  }
  return out;
}

// ================= ドラムの型（16 分 × 16） =================
export interface DrumBar { kick: string; snare: string; hat: string }
const D = (kick: string, snare: string, hat: string): DrumBar => ({ kick, snare, hat });
const E = '................';
const DRUMS: Record<string, DrumBar[]> = {
  sparse: [D('x...............', E, '........x.......'), D('x.......x.......', E, '....x.......x...')],
  plain: [D('x.......x.......', '....x.......x...', 'x...x...x...x...'), D('x.......x.x.....', '....x.......x...', '..x...x...x...x.')],
  beat: [D('x...x...x...x...', '....x.......x...', 'x.x.x.x.x.x.x.x.'), D('x.....x...x.....', '....x.......x..x', 'x.x.x.x.x.x.x.xx'), D('x..x..x...x..x..', '....x.......x...', 'xxxxxxxxxxxxxxxx')],
  noise: [D('x.x...x.xx..x...', '..x...x...x.x.xx', 'x.xxx.x.xx.xx.x.'), D('xx..x.x.x..xx...', '....x..x..x.x.x.', 'x.x.xxx.x.x.xxxx')],
  house: [D('x...x...x...x...', '....x.......x...', '..x...x...x...x.'), D('x...x...x...x...', '....x.......x...', '..x.x.x...x.x.xx')],
  techno: [D('x...x...x...x...', E, 'xxxxxxxxxxxxxxxx'), D('x...x...x...x..x', '....x.......x...', 'x.xxx.xxx.xxx.xx')],
  dnb: [D('x.........x.....', '....x.......x...', 'x.x.x.x.x.x.x.x.'), D('x.........x.x...', '....x..x....x...', 'xxxxxxxxxxxxxxxx'), D('x.x.......x.....', '....x.......x.x.', 'x.x.x.x.x.x.x.x.')],
  jungle: [D('x.........x.....', '....x..x.x..x..x', 'x.xxx.x.x.xxx.x.'), D('x.x.......xx....', '....x.x..x..x.xx', 'xxxxx.xxx.xxxxx.')],
  reggae: [D('........x.......', '........x.......', 'x.x.x.x.x.x.x.x.'), D('........x.......', '........x......x', 'x.x.x.x.x.xxx.x.')],
  dub: [D('........x.......', '........x.......', E), D('x.......x.......', '........x.......', '....x.......x...')],
  ska: [D('x.......x.......', '....x.......x...', '..x...x...x...x.'), D('x...x...x...x...', '....x.......x...', '..x...x...x...x.')],
  hiphop: [D('x.......x.x.....', '....x.......x...', 'x.x.x.x.x.x.x.x.'), D('x..x....x.x.....', '....x.......x...', 'x.x.x.x.x.x.x.x.')],
  trap: [D('x......x..x.....', '........x.......', 'x.x.x.x.xxxxx.x.'), D('x.....x...x..x..', '........x.......', 'xxxxx.x.x.x.xxxx')],
  lofi: [D('x.......x.x.....', '....x.......x...', 'x.x.x.x.x.x.x.x.'), D('x......xx.......', '....x.......x...', 'x.x.x.x.x.x.x.x.')],
  funk: [D('x..x..x...x.x...', '....x..x.x..x..x', 'xxxxxxxxxxxxxxxx'), D('x.x...x..x..x...', '....x.x....xx...', 'x.xxx.xxx.xxx.xx')],
  bossa: [D('x..x....x..x....', '..x..x....x..x..', 'x.x.x.x.x.x.x.x.'), D('x..x....x..x....', '...x..x...x..x..', 'x.x.x.x.x.x.x.x.')],
  jazz: [D('x.......x.......', '......x.......x.', 'x...x.x.x...x.x.'), D('x...........x...', '..x.......x.....', 'x...x.x.x...x.x.')],
  march: [D('x.......x.......', '....x.x.....x.xx', 'x...x...x...x...'), D('x...x...x...x...', 'x.x.x.xxx.x.x.xx', E)],
  punk: [D('x.x.x.x.x.x.x.x.', '....x.......x...', 'x.x.x.x.x.x.x.x.'), D('x.x...x.x.x...x.', '....x.......x...', 'xxxxxxxxxxxxxxxx')],
  chip: [D('x.......x.......', '....x.......x...', 'x.x.x.x.x.x.x.x.'), D('x.....x.x.......', '....x.......x.x.', 'x.x.x.x.x.x.x.x.')],
  enka: [D('x.......x.......', E, '....x.......x...'), D('x.......x.....x.', '........x.......', '....x.......x...')],
  ondo: [D('x..x..x.x..x..x.', '....x.......x...', E), D('x..x..x.x.xx..x.', '....x..x....x...', '..x...x...x...x.')],
  gabber: [D('x...x...x...x...', E, '..x...x...x...x.'), D('x...x...x...x.x.', '....x.......x...', '..x...x...x...x.')],
  fill: [D('x.......x.......', '....x...x.x.xxxx', 'x.x.x.x.........'), D('x...x...x.x.x.x.', '....x.x.x.x.xxxx', E)],
};
/** ユークリッドのリズム（n 個の中に k 個をなるべく均等に）を rot だけずらす */
function euclid(k: number, n: number, rot: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(((i + rot) * k) / n) !== Math.floor(((i + rot - 1) * k) / n) ? 'x' : '.';
  return s;
}
/** ブレイクコア：アーメン風のブレイクを 4 拍に切って、並べ替える */
const AMEN = D('x.x.......xx....', '....x..x.x..x..x', 'x.x.x.x.x.x.x.x.');
const reorder = (p: string, order: number[]) => order.map((i) => p.slice(i * 4, i * 4 + 4)).join('');

/** セクションの小節 b のドラム（4 小節目はフィル。IDM・ブレイクコアは毎回組み直す） */
export function drumBar(plan: Plan, sec: PlannedSection, b: number, r: Rng): DrumBar | null {
  if (plan.cover) {
    // カバー：解析したドラムをそのまま（空の小節は鳴らさない）
    const d = plan.cover.drums[barOf(sec.start) + b];
    return d && /x/.test(d.kick + d.snare + d.hat) ? d : null;
  }
  const kit: DrumKit = plan.style.drums;
  if (kit === 'none' || sec.energy < 0.2) return null;
  if (kit === 'idm') {
    // 2 小節ごとに、割り算の違うリズムを組み直す（こまかさは盛り上がりで）
    const k = 3 + ((b >> 1) * 7 + sec.index * 3) % 4, s = 2 + r.int(3), h = 5 + r.int(7);
    return D(euclid(k, 16, r.int(4)), euclid(s, 16, 4 + r.int(4)), sec.energy > 0.7 ? euclid(h + 4, 16, r.int(3)) : euclid(h, 16, 1));
  }
  if (kit === 'breakcore') {
    const order = [0, 1, 2, 3].map(() => r.int(4));
    return D(reorder(AMEN.kick, order), reorder(AMEN.snare, order), sec.energy > 0.7 ? 'xxxxxxxxxxxxxxxx' : AMEN.hat);
  }
  const set = sec.energy < 0.35 && kit !== 'enka' && kit !== 'dub' && kit !== 'reggae' ? DRUMS.sparse : DRUMS[kit] ?? DRUMS.beat;
  if (b % 4 === 3 && sec.bars >= 4 && set !== DRUMS.sparse && !['enka', 'dub', 'reggae', 'jazz'].includes(kit)) return r.pick(DRUMS.fill);
  return set[(Math.floor(b / 2) + (sec.energy > 0.8 ? 1 : 0)) % set.length];
}
export function steps(pattern: string, beat: number, each: (t: number) => void): void {
  [...pattern].forEach((c, i) => { if (c === 'x') each(beat + i * 0.25); });
}

// ================= ハネ（スウィング） =================
/** 拍の位置 t を、スタイルのハネに合わせてずらす（2 つずつ組にして、後ろの方を遅らせる） */
export function swingTime(plan: Plan, t: number): number {
  const sw = plan.style.swing;
  if (!sw || sw[0] <= 0) return t;
  const [amt, unit] = sw;
  const pair = unit * 2;
  const p = ((t % pair) + pair) % pair;
  if (Math.abs(p - unit) < 1e-6) return t + amt * unit;
  return t;
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
