// ボーカルを取り出す検査：答えのわかる曲（真ん中の歌・左のギター・右のピアノ・真ん中のベースとドラム）を作って、取り出した歌がどれだけ本物に近いか
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyze, bassPitch, melodyFromVocal, refineHarmony } from '../src/cover/analyze';
import { f0Of, sampleBank } from '../src/cover/sampling';
import { coverSource } from '../src/cover/plan';
import { defaultComposer } from '../src/compose/rules';
import { alignToGrid, separateVocal, pitchShift, splitInst, to22k } from '../src/cover/vocal';
import { Rng } from '../src/core/rng';

const SR = 44100;
let fails = 0;
const ng = (m: string) => { fails++; console.log('NG', m); };
const ok = (m: string) => console.log('OK', m);
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
function wav(a: Float32Array, sr: number): Buffer {
  const b = Buffer.alloc(44 + a.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + a.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(a.length * 2, 40);
  for (let i = 0; i < a.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, a[i])) * 32767), 44 + i * 2);
  return b;
}

// ---- 答えのわかる曲（110 BPM・16 小節） ----
const bpm = 110, beat = 60 / bpm, bars = 16, n = Math.round((bars * 4 * beat + 1) * SR);
const voc = new Float32Array(n), L = new Float32Array(n), R = new Float32Array(n);
const r = new Rng(5);
const MEL = [64, 67, 69, 67, 64, 62, 60, 62, 64, 64, 67, 72, 71, 69, 67, 0];
// 歌：倍音つき・ビブラート・母音っぽい山（4 分音符、ときどき休み）
for (let q = 0; q < bars * 4; q++) {
  const m = MEL[q % MEL.length];
  if (!m) continue;
  const o = Math.round(q * beat * SR), len = Math.round(beat * 0.92 * SR);
  let ph = 0;
  for (let i = 0; i < len && o + i < n; i++) {
    const t = i / SR, f = midiHz(m) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 4));
    ph += f / SR;
    let v = 0;
    for (let h = 1; h <= 14; h++) { const fh = f * h; const formant = Math.exp(-(((fh - 700) / 400) ** 2)) + 0.6 * Math.exp(-(((fh - 2400) / 600) ** 2)) + 0.15; v += (Math.sin(2 * Math.PI * ph * h) / h) * formant; }
    voc[o + i] = v * 0.12 * Math.min(1, t / 0.03) * Math.min(1, (len - i) / (SR * 0.03));
  }
}
const add = (buf: Float32Array, t: number, dur: number, f: (i: number, k: number) => number, g: number) => {
  const o = Math.round(t * SR);
  for (let i = 0; i < dur * SR && o + i < n; i++) buf[o + i] += f(i, i / (dur * SR)) * g;
};
const CH = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]];
for (let b = 0; b < bars; b++) {
  const t0 = b * 4 * beat, chord = CH[b % 4];
  for (const half of [0, 2]) for (const m of chord) {
    // ギター（左寄り・はじく音）・ピアノ（右寄り）
    const gtr = (i: number, k: number) => ((((i * midiHz(m + 12)) / SR) % 1) * 2 - 1) * Math.exp(-k * 4);
    add(L, t0 + half * beat, 2 * beat, gtr, 0.06); add(R, t0 + half * beat, 2 * beat, gtr, 0.015);
    const pno = (i: number, k: number) => Math.sin((2 * Math.PI * midiHz(m + 24) * i) / SR) * Math.exp(-k * 3);
    add(R, t0 + half * beat + beat * 0.5, beat, pno, 0.08); add(L, t0 + half * beat + beat * 0.5, beat, pno, 0.02);
  }
  for (let e = 0; e < 8; e++) { const bassF = (i: number, k: number) => Math.sin((2 * Math.PI * midiHz(chord[0] - 12) * i) / SR) * (1 - k); add(L, t0 + e * beat / 2, beat / 2, bassF, 0.2); add(R, t0 + e * beat / 2, beat / 2, bassF, 0.2); }
  for (const q of [0, 2]) { const k = (i: number, kk: number) => Math.sin(2 * Math.PI * (50 * i / SR + 2 * (1 - Math.exp(-i / (SR * 0.02))))) * (1 - kk) ** 2; add(L, t0 + q * beat, 0.25, k, 0.6); add(R, t0 + q * beat, 0.25, k, 0.6); }
  for (const q of [1, 3]) { const sn = new Float32Array(Math.round(0.18 * SR)).map(() => r.bi()); const s = (i: number, kk: number) => sn[i] * (1 - kk) ** 3; add(L, t0 + q * beat, 0.18, s, 0.3); add(R, t0 + q * beat, 0.18, s, 0.3); }
}
for (let i = 0; i < n; i++) { L[i] += voc[i]; R[i] += voc[i]; }

// ---- 解析 → ボーカルを取り出す ----
const t0 = performance.now();
const a = analyze([L, R], SR);
const sep = separateVocal([L, R], SR);
// 2 回目：伴奏から調とコード（答え：ハ長調で C G Am F）
{
  const before = `${a.key.name} ${a.chordNames.slice(0, 4).join(' ')}`;
  refineHarmony(sep.inst, a);
  const PROG = [0, 4, 5, 3];
  let best = 0;
  for (let k = 0; k < 4; k++) best = Math.max(best, a.chords.filter((d, i) => d === PROG[(i + k) % 4]).length / a.bars);
  a.shift === 0 && best >= 0.75 ? ok(`調とコード（伴奏から決め直す）：${before} → ${a.key.name} ${a.chordNames.slice(0, 4).join(' ')}（${Math.round(best * 100)}%）`) : ng(`調とコード ${before} → ${a.key.name} ${a.chordNames.join(' ')}`);
}
const sec = (performance.now() - t0) / 1000;
// 本物の歌と比べる（22.05kHz）：いちばん合う大きさに合わせた残りの大きさ
const truth = to22k(voc, SR), mix = to22k(Float32Array.from(L, (v, i) => (v + R[i]) / 2), SR);
const sdr = (est: Float32Array) => {
  let num = 0, den = 0;
  for (let i = 0; i < truth.length; i++) { num += est[i] * truth[i]; den += truth[i] * truth[i]; }
  const g = num / den;
  let s = 0, e = 0;
  for (let i = 0; i < truth.length; i++) { s += (g * truth[i]) ** 2; e += (est[i] - g * truth[i]) ** 2; }
  return 10 * Math.log10(s / e);
};
const before = sdr(mix), after = sdr(sep.vocal);
after - before >= 6 ? ok(`ボーカル：歌のはっきりさ ${before.toFixed(1)}dB → ${after.toFixed(1)}dB（+${(after - before).toFixed(1)}dB）・解析と分離 ${sec.toFixed(1)} 秒（曲 ${(n / SR).toFixed(0)} 秒）`) : ng(`ボーカル：${before.toFixed(1)} → ${after.toFixed(1)}dB`);
// 伴奏（カラオケ）から歌が減っているか
let vInMix = 0, vInInst = 0;
for (let i = 0; i < truth.length; i++) { vInMix += mix[i] * truth[i]; vInInst += sep.inst[i] * truth[i]; }
vInInst / vInMix < 0.5 ? ok(`伴奏（カラオケ）：歌が ${Math.round((1 - vInInst / vInMix) * 100)}% 減った`) : ng(`伴奏の歌 ${vInInst / vInMix}`);
// モノラルの曲でも動く
const mono = separateVocal([Float32Array.from(L, (v, i) => (v + R[i]) / 2)], SR);
const monoSdr = sdr(mono.vocal);
monoSdr > before ? ok(`モノラルの曲でも取り出せる（${monoSdr.toFixed(1)}dB）`) : ng(`モノラル ${monoSdr}`);
// 伴奏を楽器ごとに：ドラム・ベース・その他を足すと伴奏に戻る。ドラムにはキック・スネア、ベースには低い音が多く入る
{
  const t1 = performance.now();
  const st = splitInst(sep.inst, bassPitch(to22k(Float32Array.from(L, (v, i) => (v + R[i]) / 2), SR)));
  const ms = performance.now() - t1;
  let e = 0, d = 0;
  for (let i = 0; i < sep.inst.length; i++) { const sum = st.drums[i] + st.bass[i] + st.other[i]; e += sep.inst[i] ** 2; d += (sep.inst[i] - sum) ** 2; }
  const back = 10 * Math.log10(e / (d + 1e-20));
  // 低い音（150Hz より下）の割合：ベースとドラムに多く、その他には少ない
  const lowShare = (x: Float32Array) => { let lo = 0, all = 0, lp = 0; const k = 1 - Math.exp((-2 * Math.PI * 150) / 22050); for (const v of x) { lp += (v - lp) * k; lo += lp * lp; all += v * v; } return lo / (all + 1e-20); };
  const okSplit = back > 40 && lowShare(st.bass) > lowShare(st.other) && lowShare(st.drums) > lowShare(st.other);
  okSplit ? ok(`楽器ごとに分ける：足すと伴奏に戻る（${back.toFixed(0)}dB）・低い音の割合 ベース ${Math.round(lowShare(st.bass) * 100)}%・ドラム ${Math.round(lowShare(st.drums) * 100)}%・その他 ${Math.round(lowShare(st.other) * 100)}%・${(ms / 1000).toFixed(1)} 秒（曲 ${(L.length / SR).toFixed(0)} 秒）`) : ng(`楽器ごと：戻り ${back}`);
}
// 拍にそろえる：解析の拍の時刻 → 一定のテンポの格子（長さが小節数ぶん）
const al = alignToGrid(sep.vocal, sep.sr, a.beats, Math.round(a.bpm), 0, a.bars);
const want = Math.round(a.bars * 4 * (60 / Math.round(a.bpm)) * sep.sr);
Math.abs(al.length - want) <= 1 ? ok(`カバーの拍にそろえる：${a.bars} 小節・${(al.length / sep.sr).toFixed(2)} 秒`) : ng(`そろえた長さ ${al.length} / ${want}`);
// メロディ：1 回目（混ざった曲から）と 2 回目（取り出した歌から）の正しさ。答え = MEL の 4 分音符
{
  const acc = (notes: { t: number; len: number; midi: number }[]) => {
    let hit = 0, all = 0;
    for (let q = 0; q < a.bars * 4; q++) {
      const m = MEL[q % MEL.length];
      if (!m) continue;
      all++;
      const t = (q * beat - a.offset) / (60 / a.bpm) + 0.25; // 答えの時刻 → 解析の拍（最初の小節の頭が 0）。音の頭から少し後
      const got = notes.find((nn) => t >= nn.t && t < nn.t + nn.len);
      if (got && (((got.midi - (m + a.shift)) % 12) + 12) % 12 === 0) hit++;
    }
    return hit / Math.max(1, all);
  };
  const first = acc(a.melody), v = melodyFromVocal(sep.vocal, a), second = v ? acc(v) : 0;
  second >= Math.min(first, 0.85) && second >= 0.7 ? ok(`メロディ：混ざった曲から ${Math.round(first * 100)}% → 取り出した歌から ${Math.round(second * 100)}%`) : ng(`メロディ ${first} → ${second}`);
}
// 音程だけずらす（カバーの調に合わせる）：440Hz を +3 半音 → 523Hz、長さそのまま
{
  const x = Float32Array.from({ length: 22050 * 2 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 22050) * 0.5);
  const y = pitchShift(x, 22050, 3);
  let z = 0;
  for (let i = 4000; i < 40000; i++) if (y[i - 1] < 0 && y[i] >= 0) z++;
  const f = (z * 22050) / 36000;
  Math.abs(f - 523.3) < 8 && y.length === x.length ? ok(`テープの調をそろえる：440Hz → +3 半音 ${f.toFixed(0)}Hz（長さそのまま）`) : ng(`音程ずらし ${f}`);
}
// サンプリング：元の曲から 16 音（ドラムは帯域、音程のある音は高さを測る）
{
  const mono = Float32Array.from(L, (v, i) => (v + R[i]) / 2);
  const t = performance.now();
  const { pads, kit } = sampleBank(a, { hi: mono, hiSr: SR, vocal: sep.vocal, inst: sep.inst, sr: sep.sr });
  const ms = performance.now() - t;
  const lowFrac = (x: Float32Array, sr: number) => { let lo = 0, all = 0, s = 0; const k = 1 - Math.exp((-2 * Math.PI * 150) / sr); for (const v of x) { s += k * (v - s); lo += s * s; all += v * v; } return lo / (all + 1e-12); };
  const kick = pads[kit.kick], snare = pads[kit.snare], hat = pads[kit.hat];
  const kOk = kick && lowFrac(kick.buf.ch[0], kick.buf.sr) > 0.5, sOk = snare && lowFrac(snare.buf.ch[0], snare.buf.sr) < 0.5, hOk = kit.hat < 0 || (hat && lowFrac(hat.buf.ch[0], hat.buf.sr) < 0.2); // この曲にハットは無い
  const n = pads.filter(Boolean).length;
  kOk && sOk && hOk ? ok(`サンプリング：${n} 音（${pads.filter(Boolean).map((p) => p!.name.slice(1)).join(' ')}）・${Math.round(ms)}ms`) : ng(`サンプリングのドラム kick ${kOk} snare ${sOk} hat ${hOk}`);
  // ベース・歌：測った高さ（root）で鳴らすと、その音が出る
  const pcOk = (slot: [number, number] | undefined, lo: number, hi: number) => {
    if (!slot) return false;
    const p = pads[slot[0]]!, f = f0Of(p.buf.ch[0], p.buf.sr, lo, hi);
    const m = 69 + 12 * Math.log2(f / 440) + (p.params.fine ?? 0) / 100;
    return Math.abs(m - slot[1]) < 0.3;
  };
  pcOk(kit.bass, 35, 220) && pcOk(kit.melo, 90, 1000) && kit.chordMaj && kit.chordMin ? ok(`サンプリング：ベースは ${kit.bass![1]}、歌は ${kit.melo![1]} の高さ（測った値どおり）・長調と短調の和音`) : ng(`サンプリングの高さ ${JSON.stringify(kit)}`);
  // カバー：サンプラーのドラム・メロディが、切り出した音のバンク（P）を使う
  const song = defaultComposer().compose({ settings: { seed: 1, style: 'beat', chaos: 0.1, lengthSec: 30, bpm: 110 }, toys: [{ toy: 0, kind: 'sampler' }], cover: { ...coverSource(a, 't'), samplerKit: { bank: 15, kit } } });
  // キック・スネアは切り出した音（バンク P）だけ、工場出荷のキック（0）・スネア（1）は使わない
  const drums = song.tracks.find((tr) => tr.part === 'sampler:drums')!;
  const ks = drums.notes.filter((nn) => [0, 1, 240 + kit.kick, 240 + kit.snare].includes(nn.key));
  const inBank = ks.filter((nn) => nn.key >= 240).length / Math.max(1, ks.length);
  const autos = song.tracks.find((tr) => tr.part === 'sampler:mods')!.autos.filter((x) => x.index === 2 || x.index === 3 || x.index === 16).map((x) => x.v);
  inBank > 0.9 && autos.every((v) => v >= 240) ? ok(`カバー：サンプラーのキック・スネアの ${Math.round(inBank * 100)}%・メロディ／ベース／和音が切り出した音を使う`) : ng(`カバーの楽器 ${inBank} ${autos}`);
}
mkdirSync('out', { recursive: true });
writeFileSync('out/vocal-mix.wav', wav(mix, sep.sr));
writeFileSync('out/vocal-extracted.wav', wav(sep.vocal, sep.sr));
writeFileSync('out/vocal-inst.wav', wav(sep.inst, sep.sr));

console.log(fails ? `NG ${fails} 個` : 'すべて OK');
process.exit(fails ? 1 : 0);
