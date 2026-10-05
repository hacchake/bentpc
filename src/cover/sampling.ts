// 取り込んだ曲から、サンプラー（PAKU-PAKU 16）の 1 バンク分＝16 音を切り出す（DOM 非依存）。
// 解析の結果（拍・ドラムの位置・コード・ベース・メロディ）を見て、いちばん「その音だけ」に近い瞬間を選んで切る。
//   ドラム：元の曲から（キック・スネア・ハットがはっきり立っている所）
//   ベース：伴奏を低い所だけにして、長く伸びる 1 音
//   和音：伴奏の、ドラムが鳴っていない拍（長調の和音と短調の和音を 1 つずつ）
//   歌：取り出した歌の、伸びる 1 音（メロディを歌声で弾く）と 1 拍の切れ端
//   ループ：伴奏 1 小節・歌 1 小節（そのまま素材として）
// 音程のある音は、切った音の高さを測って「元の高さ」（root）にする（カバーの音の高さで弾けるように）。
import type { PadParams, SampleBuf } from '../sampler/dsp/types';
import type { CoverAnalysis } from './analyze';

export interface SampledPad { name: string; buf: SampleBuf; params: Partial<PadParams> }

/** サンプラーの作曲係に渡す楽器セット（バンクの中の番号 0〜15。-1 = 無い） */
export interface CoverKit {
  kick: number; snare: number; hat: number; ohat: number; clap: number; crash: number; riser: number; vox: number;
  /** [番号, 元の高さ（MIDI）] */
  melo?: [number, number];
  bass?: [number, number];
  chordMaj?: [number, number];
  chordMin?: [number, number];
}

export interface Sources {
  hi: Float32Array; hiSr: number; // 元の曲（モノラル・元のサンプルレート）
  vocal: Float32Array; inst: Float32Array; sr: number; // 取り出した歌・伴奏（22.05kHz）
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440);

/** 1 次のフィルター（lp = ローパス、hp = ハイパス） */
function filt(x: Float32Array, sr: number, hz: number, hp: boolean): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / sr), y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) { s += a * (x[i] - s); y[i] = hp ? x[i] - s : s; }
  return y;
}
const energy = (x: Float32Array, a = 0, b = x.length) => { let e = 0; for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) e += x[i] * x[i]; return e; };

/** 切り出す：頭 2ms・終わり fade 秒をなめらかに、いちばん大きい所を 0.9 に */
function cut(x: Float32Array, sr: number, t0: number, dur: number, fade = 0.02): Float32Array {
  const a = Math.max(0, Math.round(t0 * sr)), n = Math.max(16, Math.min(x.length - a, Math.round(dur * sr)));
  const y = x.slice(a, a + n);
  const fi = Math.round(sr * 0.002), fo = Math.min(n >> 1, Math.round(sr * fade));
  for (let i = 0; i < fi && i < n; i++) y[i] *= i / fi;
  for (let i = 0; i < fo; i++) y[n - 1 - i] *= i / fo;
  let pk = 0;
  for (const v of y) pk = Math.max(pk, Math.abs(v));
  if (pk > 0) for (let i = 0; i < n; i++) y[i] *= 0.9 / pk;
  return y;
}

/** 基本の高さ（Hz）：真ん中あたりの自己相関（lo〜hi Hz）。はっきりしなければ 0 */
export function f0Of(x: Float32Array, sr: number, lo: number, hi: number): number {
  const a = Math.floor(x.length * 0.25), n = Math.min(Math.floor(x.length * 0.5), Math.round(sr * 0.25));
  if (n < sr / lo * 2) return 0;
  let best = 0, lag0 = 0;
  for (let lag = Math.floor(sr / hi); lag <= Math.ceil(sr / lo); lag++) {
    let c = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < n; i++) { const p = x[a + i], q = x[a + i + lag] ?? 0; c += p * q; e1 += p * p; e2 += q * q; }
    c /= Math.sqrt(e1 * e2) + 1e-12;
    if (c > best) { best = c; lag0 = lag; }
  }
  return best > 0.6 ? sr / lag0 : 0;
}

export function sampleBank(a: CoverAnalysis, src: Sources): { pads: (SampledPad | null)[]; kit: CoverKit } {
  const spb = 60 / a.bpm;
  const time = (beat: number) => {
    const i = Math.floor(beat), f = beat - i, last = a.beats.length - 1;
    if (i >= last) return a.beats[last] + (beat - last) * spb;
    return a.beats[i] + (a.beats[i + 1] - a.beats[i]) * f;
  };
  const { hi, hiSr, vocal, inst, sr } = src;
  const vocAt = (t: number, d: number) => energy(vocal, Math.round(t * sr), Math.round((t + d) * sr)) / Math.max(1, d * sr);
  // ---- ドラム：候補の 16 分の位置ごとに「その音らしさ」を点数にして、上位を選ぶ ----
  const lowHi = filt(hi, hiSr, 150, false), highHi = filt(hi, hiSr, 6000, true);
  type Cand = { t: number; score: number };
  const pick = (want: (d: { kick: string; snare: string; hat: string }, s: number) => boolean, score: (t: number) => number): Cand[] => {
    const out: Cand[] = [];
    a.drums.forEach((d, b) => { for (let s = 0; s < 16; s++) if (want(d, s)) { const t = time(b * 4 + s / 4); out.push({ t, score: score(t) }); } });
    return out.sort((p, q) => q.score - p.score);
  };
  const win = (t: number, d: number) => [Math.round(t * hiSr), Math.round((t + d) * hiSr)] as const;
  const frac = (band: Float32Array, t: number, d: number) => { const [x, y] = win(t, d); return energy(band, x, y) / (energy(hi, x, y) + 1e-12); };
  const vocalQuiet = (t: number) => 1 / (1 + vocAt(t, 0.2) * 200);
  const kicks = pick((d, s) => d.kick[s] === 'x', (t) => frac(lowHi, t, 0.12) * vocalQuiet(t));
  const snares = pick((d, s) => d.snare[s] === 'x' && d.kick[s] !== 'x', (t) => (1 - frac(lowHi, t, 0.12)) * vocalQuiet(t));
  const hats = pick((d, s) => d.hat[s] === 'x' && d.kick[s] !== 'x' && d.snare[s] !== 'x', (t) => frac(highHi, t, 0.06) * vocalQuiet(t));
  const opens = [...hats].sort((p, q) => {
    const tail = (t: number) => energy(highHi, ...win(t + 0.12, 0.2)) / (energy(highHi, ...win(t, 0.05)) + 1e-12);
    return tail(q.t) - tail(p.t);
  });
  const crashes = a.sections.map((s) => time(s.start * 4)).map((t) => ({ t, score: energy(highHi, ...win(t, 1)) })).sort((p, q) => q.score - p.score);
  const pre = 0.004; // 少し前から（頭を切らない）
  const drum = (c: Cand | undefined, name: string, dur: number, params: Partial<PadParams> = {}): SampledPad | null =>
    c ? { name, buf: { sr: hiSr, ch: [cut(hi, hiSr, c.t - pre, dur, Math.min(0.05, dur * 0.3))] }, params } : null;

  const pads: (SampledPad | null)[] = Array(16).fill(null);
  pads[0] = drum(kicks[0], '♪KICK', 0.35);
  pads[1] = drum(snares[0], '♪SNARE', 0.3);
  pads[2] = drum(hats[0], '♪HAT', 0.09, { mute: 4 });
  pads[3] = drum(opens[0], '♪OP HAT', 0.4, { mute: 4 });
  pads[4] = drum(snares[1], '♪SNARE 2', 0.3);
  pads[5] = drum(crashes[0], '♪CRASH', 1.6, {});
  if (pads[5]) { const r = pads[5]!.buf.ch[0].slice().reverse(); pads[6] = { name: '♪REV CRASH', buf: { sr: hiSr, ch: [r] }, params: {} }; }
  pads[7] = drum(kicks[1], '♪KICK 2', 0.35);
  pads[8] = drum(hats[1], '♪HAT 2', 0.09, { mute: 4 });

  // ---- ベース：伴奏の低い所だけ、長く伸びる音 ----
  const instLow = filt(filt(inst, sr, 220, false), sr, 220, false);
  // 長い音から順に（1 拍に満たない音しか無い曲でも、いちばん長いものを使う）
  const longBass = [...a.bass].filter((n) => n.len >= 0.5).sort((p, q) => q.len - p.len).slice(0, 12);
  let kit: CoverKit = { kick: pads[0] ? 0 : -1, snare: pads[1] ? 1 : -1, hat: pads[2] ? 2 : -1, ohat: pads[3] ? 3 : -1, clap: pads[4] ? 4 : -1, crash: pads[5] ? 5 : -1, riser: pads[6] ? 6 : -1, vox: -1 };
  for (const n of longBass) {
    const t = time(n.t), d = Math.min(1.6, n.len * spb);
    const x = cut(instLow, sr, t, d, 0.08);
    const f = f0Of(x, sr, 35, 220);
    if (!f) continue;
    const m = midiOf(f), root = Math.round(m);
    pads[9] = { name: '♪BASS', buf: { sr, ch: [x] }, params: { gate: true, release: 0.12, fine: Math.round((root - m) * 100) } };
    kit = { ...kit, bass: [9, root] };
    break;
  }
  // ---- 和音：ドラムが鳴っていない拍の伴奏（長調・短調を 1 つずつ） ----
  const instMid = filt(inst, sr, 150, true);
  const chordPad = (minor: boolean): { pad: SampledPad; root: number } | null => {
    let best: { t: number; e: number; deg: number } | null = null;
    a.chords.forEach((deg, b) => {
      if ([1, 2, 5].includes(deg) !== minor || deg === 6) return;
      const d = a.drums[b];
      for (let q = 0; q < 4; q++) {
        // ドラムが鳴っている拍は点数を下げる（ドラムが無い拍が無い曲でも選べるように）
        const hits = [0, 1, 2, 3].filter((k) => d.kick[q * 4 + k] === 'x' || d.snare[q * 4 + k] === 'x').length;
        const t = time(b * 4 + q), e = energy(instMid, Math.round(t * sr), Math.round((t + spb) * sr)) / (1 + vocAt(t, spb) * 400) / (1 + hits * 3);
        if (!best || e > best.e) best = { t, e, deg };
      }
    });
    if (!best) return null;
    const b2 = best as { t: number; e: number; deg: number };
    const pc = (((MAJOR[b2.deg] - a.shift) % 12) + 12) % 12; // 元の調での根音
    return { pad: { name: minor ? '♪CHORD m' : '♪CHORD', buf: { sr, ch: [cut(instMid, sr, b2.t, spb, 0.06)] }, params: { gate: true, release: 0.2 } }, root: 48 + pc };
  };
  const cMaj = chordPad(false), cMin = chordPad(true);
  if (cMaj) { pads[10] = cMaj.pad; kit = { ...kit, chordMaj: [10, cMaj.root] }; }
  if (cMin) { pads[11] = cMin.pad; kit = { ...kit, chordMin: [11, cMin.root] }; }
  // ---- 歌：伸びる 1 音（メロディを歌声で弾く）と、1 拍の切れ端 ----
  const longMel = [...a.melody].filter((n) => n.len >= 0.5).sort((p, q) => q.len - p.len).slice(0, 16);
  for (const n of longMel) {
    const t = time(n.t), d = Math.min(1.4, n.len * spb);
    const x = cut(vocal, sr, t, d, 0.08);
    const f = f0Of(x, sr, 90, 1000);
    if (!f) continue;
    const m = midiOf(f), root = Math.round(m);
    pads[12] = { name: '♪VOX NOTE', buf: { sr, ch: [x] }, params: { gate: true, release: 0.25, attack: 0.08, fine: Math.round((root - m) * 100) } };
    kit = { ...kit, melo: [12, root] };
    break;
  }
  let loudBeat = -1, lb = 0;
  for (let q = 0; q < a.bars * 4; q++) { const e = vocAt(time(q), spb); if (e > lb) { lb = e; loudBeat = q; } }
  if (loudBeat >= 0) { pads[13] = { name: '♪VOX CHOP', buf: { sr, ch: [cut(vocal, sr, time(loudBeat), spb, 0.04)] }, params: {} }; kit = { ...kit, vox: 13 }; }
  // ---- ループ：いちばん大きい小節の伴奏・歌を 1 小節 ----
  let loudBar = 0;
  a.energy.forEach((e, b) => { if (e > (a.energy[loudBar] ?? 0)) loudBar = b; });
  const barT = time(loudBar * 4), barD = time(loudBar * 4 + 4) - barT;
  pads[14] = { name: '♪BAR LOOP', buf: { sr, ch: [cut(inst, sr, barT, barD, 0.01)] }, params: { gate: true, loop: true, bpm: Math.round(a.bpm) } };
  if (loudBeat >= 0) pads[15] = { name: '♪VOX BAR', buf: { sr, ch: [cut(vocal, sr, barT, barD, 0.01)] }, params: { gate: true, loop: true, bpm: Math.round(a.bpm) } };
  return { pads, kit };
}
