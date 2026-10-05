// 解析とボーカル分離の物差し：答えのわかる曲（scripts/lib/songgen.ts）を何曲も作って、点数を出す。
// 実行：npx tsx scripts/cover-bench.ts   （直すたびに、平均が上がったかを見る）
import { analyze, melodyFromVocal, refineHarmony } from '../src/cover/analyze';
import { separateVocal, to22k } from '../src/cover/vocal';
import { genSong, type GenOpts } from './lib/songgen';

export const SONGS: (GenOpts & { label: string })[] = [
  { label: 'C 110', seed: 1, bpm: 110, tonic: 0, bars: 24 },
  { label: 'D 96 ハネ', seed: 2, bpm: 96, tonic: 2, bars: 24, swing: 0.25 },
  { label: 'Am 128 半小節', seed: 3, bpm: 128, tonic: 9, minor: true, bars: 24, halfChords: true },
  { label: 'F 84 残響', seed: 4, bpm: 84, tonic: 5, bars: 20, reverb: 0.6 },
  { label: 'Em 140 半小節', seed: 5, bpm: 140, tonic: 4, minor: true, bars: 28, halfChords: true },
  { label: 'Bb 76', seed: 6, bpm: 76, tonic: 10, bars: 16, lead: 0.8 },
  { label: 'G 120 歌が右', seed: 7, bpm: 120, tonic: 7, bars: 24, vocalPan: 0.35 },
  { label: 'Db 100 ハネ半小節', seed: 8, bpm: 100, tonic: 1, bars: 24, swing: 0.33, halfChords: true },
  { label: 'E 104 揺れる', seed: 9, bpm: 104, tonic: 4, bars: 24, drift: 0.04 },
  { label: 'C 116 調外コード', seed: 11, bpm: 116, tonic: 0, bars: 24, chromatic: true },
  { label: 'A 100 調外半小節', seed: 12, bpm: 100, tonic: 9, bars: 24, chromatic: true, halfChords: true },
  { label: 'Fm 88 調外', seed: 13, bpm: 88, tonic: 5, minor: true, bars: 24, chromatic: true },
  { label: 'D 112 本物の歌', seed: 14, bpm: 112, tonic: 2, bars: 24, realVoice: true },
  { label: 'Eb 96 厚い伴奏', seed: 15, bpm: 96, tonic: 3, bars: 24, realVoice: true, dense: true, vocalGain: 0.6 },
  { label: 'Bm 132 厚い調外', seed: 16, bpm: 132, tonic: 11, minor: true, bars: 24, realVoice: true, dense: true, chromatic: true, vocalGain: 0.7, drift: 0.02 },
  { label: 'G 124 インスト', seed: 17, bpm: 124, tonic: 7, bars: 24, instrumental: true },
  { label: 'Dm 100 インスト厚い', seed: 18, bpm: 100, tonic: 2, minor: true, bars: 24, instrumental: true, dense: true, vocalGain: 0.8 },
  { label: 'Cm 92 揺れハネ', seed: 10, bpm: 92, tonic: 0, minor: true, bars: 24, drift: 0.03, swing: 0.2, reverb: 0.5 },
];

export interface Score { tempo: number; bar: number; key: number; chord: number; half: number; chro: number; mel: number; onset: number; voiced: number; extra: number; sdr: number; swing: number }

export function score(o: GenOpts): Score {
  const g = genSong(o);
  const a = analyze([g.L, g.R], g.sr);
  const sep = separateVocal([g.L, g.R], g.sr);
  refineHarmony(sep.inst, a);
  const mv = melodyFromVocal(sep.vocal, a);
  if (mv) a.melody = mv;
  const t = g.truth, barSec = (4 * 60) / t.bpm;
  const tempo = Math.abs(a.bpm - t.bpm) / t.bpm < 0.02 ? 1 : 0;
  // 小節の頭：解析の 1 小節目が、答えの何小節目か（ずれの小ささ）
  const k = Math.round((a.offset - t.offset) / barSec);
  const err = Math.abs(a.offset - t.offset - k * barSec) / (60 / t.bpm); // 拍
  const bar = tempo && err < 0.25 ? 1 : 0;
  const key = a.shift === t.shift ? 1 : 0;
  // コード（半小節ごと。解析が小節ごとなら同じものを 2 回）
  let ch = 0, chN = 0, hf = 0, hfN = 0;
  const halves = (a as { chordsHalf?: number[] }).chordsHalf;
  // コードは「根音（ハ長調に移した音名）＋長・短・減」で比べる。解析が度数しか返さなければ、度数のふつうの三和音として
  const MAJ = [0, 2, 4, 5, 7, 9, 11], QD = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
  const aq = (a as { chordQ?: { root: number; q: string }[] }).chordQ;
  const gotQ = (i: number, h: number) => aq?.[i * 2 + h] ?? (() => { const d = halves ? halves[i * 2 + h] : a.chords[i]; return { root: MAJ[d], q: QD[d] }; })();
  const same = (x: { root: number; q: string }, y: { root: number; q: string }) => x.root === y.root && x.q === y.q;
  let chroN = 0, chro = 0;
  for (let i = 0; i < a.bars; i++) {
    for (const h of [0, 1]) {
      const tj = (i + k) * 2 + h;
      if (tj < 0 || tj >= t.chordsHalf.length) continue;
      const got = gotQ(i, h), want = t.chordQ[tj];
      chN++; if (same(got, want)) ch++;
      if (!same(t.chordQ[tj - h], t.chordQ[tj - h + 1])) { hfN++; if (same(got, want)) hf++; }
      // 調の外のコード（ふつうの三和音と違うもの）だけの正解率
      const d = t.chordsHalf[tj];
      if (want.root !== MAJ[d] || want.q !== QD[d]) { chroN++; if (same(got, want)) chro++; }
    }
  }
  // メロディ：答えの音が鳴っている 16 分ごとに、聞き取った音の名前が合うか
  let mel = 0, melN = 0, voiced = 0;
  for (const nn of t.melody) for (let s = nn.t; s < nn.t + nn.len - 0.01; s += 0.25) {
    const at = s - k * 4 + 0.05;
    if (at < 0 || at >= a.bars * 4) continue;
    melN++;
    const got = a.melody.find((m) => at >= m.t && at < m.t + m.len);
    if (got) { voiced++; if ((((got.midi - a.shift) - nn.midi) % 12 + 12) % 12 === 0) mel++; }
  }
  // 音の頭（リズム）：答えの音の頭の ±1/8 拍に、聞き取った音の頭があるか（再現率）と、聞き取った頭が答えにあるか（適合率）→ F 値
  const tOn = t.melody.map((nn) => nn.t - k * 4).filter((x) => x >= 0 && x < a.bars * 4), gOn = a.melody.map((m) => m.t);
  const near = (x: number, arr: number[]) => arr.some((y) => Math.abs(x - y) <= 0.13);
  const rec = tOn.length ? tOn.filter((x) => near(x, gOn)).length / tOn.length : 1, prec = gOn.length ? gOn.filter((x) => near(x, tOn)).length / gOn.length : 1;
  const onsetF = rec + prec ? (2 * rec * prec) / (rec + prec) : 0;
  // 歌っていない所で音を出してしまった割合（16 分ごと）
  let extra = 0, restN = 0;
  for (let s = 0; s < a.bars * 4; s += 0.25) {
    const ts = s + k * 4 + 0.05;
    if (t.melody.some((nn) => ts >= nn.t - 0.1 && ts < nn.t + nn.len / 0.92 + 0.1)) continue;
    restN++;
    if (a.melody.some((m) => s + 0.05 >= m.t && s + 0.05 < m.t + m.len)) extra++;
  }
  // ボーカル分離：歌のはっきりさがどれだけ上がったか（dB）
  const truth = to22k(g.vocal, g.sr), mix = to22k(Float32Array.from(g.L, (v, i) => (v + g.R[i]) / 2), g.sr);
  const sdr = (est: Float32Array) => {
    let num = 0, den = 0;
    for (let i = 0; i < truth.length; i++) { num += est[i] * truth[i]; den += truth[i] * truth[i]; }
    const gg = num / den;
    let s2 = 0, e2 = 0;
    for (let i = 0; i < truth.length; i++) { s2 += (gg * truth[i]) ** 2; e2 += (est[i] - gg * truth[i]) ** 2; }
    return 10 * Math.log10(s2 / e2);
  };
  const sw = (a as { swing?: number }).swing ?? 0;
  return { tempo, bar, key, chord: chN ? ch / chN : 0, half: hfN ? hf / hfN : 1, chro: chroN ? chro / chroN : 1, mel: melN ? mel / melN : 0, onset: onsetF, voiced: melN ? voiced / melN : 0, extra: restN ? extra / restN : 0, sdr: sdr(sep.vocal) - sdr(mix), swing: Math.abs(sw - (o.swing ?? 0)) < 0.08 ? 1 : 0 };
}

if (process.argv[1]?.includes('cover-bench')) {
  const rows: Score[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);
  console.log('曲'.padEnd(16), 'テンポ 小節 調  コード 途中 調外 メロ 頭   歌った 余計 分離dB ハネ');
  // 曲名の頭を並べると、その曲だけ（例：npm run bench -- Eb Bm）
  const only = process.argv.slice(2);
  for (const s of SONGS.filter((x) => !only.length || only.some((o) => x.label.startsWith(o)))) {
    const sc = score(s);
    rows.push(sc);
    console.log(s.label.padEnd(16), ` ${sc.tempo ? 'o' : 'x'}    ${sc.bar ? 'o' : 'x'}   ${sc.key ? 'o' : 'x'}  ${pct(sc.chord)}  ${pct(sc.half)} ${pct(sc.chro)} ${pct(sc.mel)} ${pct(sc.onset)}  ${pct(sc.voiced)} ${pct(sc.extra)}  ${sc.sdr.toFixed(1).padStart(5)}   ${sc.swing ? 'o' : 'x'}`);
  }
  const avg = (f: (s: Score) => number) => rows.reduce((x, s) => x + f(s), 0) / rows.length;
  console.log('平均'.padEnd(16), ` ${pct(avg((s) => s.tempo))} ${pct(avg((s) => s.bar))} ${pct(avg((s) => s.key))} ${pct(avg((s) => s.chord))} ${pct(avg((s) => s.half))} ${pct(avg((s) => s.chro))} ${pct(avg((s) => s.mel))} ${pct(avg((s) => s.onset))} ${pct(avg((s) => s.voiced))} ${pct(avg((s) => s.extra))} ${avg((s) => s.sdr).toFixed(1).padStart(5)} ${pct(avg((s) => s.swing))}`);
}
