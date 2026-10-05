// ボーカルを取り出す検査：答えのわかる曲（真ん中の歌・左のギター・右のピアノ・真ん中のベースとドラム）を作って、取り出した歌がどれだけ本物に近いか
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyze } from '../src/cover/analyze';
import { alignToGrid, extractVocal, to22k } from '../src/cover/vocal';
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
const sep = extractVocal([L, R], SR, a.pitch);
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
const mono = extractVocal([Float32Array.from(L, (v, i) => (v + R[i]) / 2)], SR, a.pitch);
const monoSdr = sdr(mono.vocal);
monoSdr > before ? ok(`モノラルの曲でも取り出せる（${monoSdr.toFixed(1)}dB）`) : ng(`モノラル ${monoSdr}`);
// 拍にそろえる：解析の拍の時刻 → 一定のテンポの格子（長さが小節数ぶん）
const al = alignToGrid(sep.vocal, sep.sr, a.beats, Math.round(a.bpm), 0, a.bars);
const want = Math.round(a.bars * 4 * (60 / Math.round(a.bpm)) * sep.sr);
Math.abs(al.length - want) <= 1 ? ok(`カバーの拍にそろえる：${a.bars} 小節・${(al.length / sep.sr).toFixed(2)} 秒`) : ng(`そろえた長さ ${al.length} / ${want}`);
mkdirSync('out', { recursive: true });
writeFileSync('out/vocal-mix.wav', wav(mix, sep.sr));
writeFileSync('out/vocal-extracted.wav', wav(sep.vocal, sep.sr));
writeFileSync('out/vocal-inst.wav', wav(sep.inst, sep.sr));

console.log(fails ? `NG ${fails} 個` : 'すべて OK');
process.exit(fails ? 1 : 0);
