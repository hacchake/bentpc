// 曲の解析（DOM 非依存。Web Worker・テストのどこでも動く）。取り込んだ曲の波形から、カバーに必要なものを読み取る：
//   テンポと拍 → 小節の頭 → 調 → 小節ごとのコード → メロディ → ベース → ドラム（キック・スネア・ハット）→ 構成（イントロ・サビ…）
// 結果の音の高さ・コードは、曲の調を「ハ長調（短調ならイ短調）」に移した値で持つ（作曲係がハ長調の白鍵で考えるため）。
import type { SectionKind } from '../compose/styles';
import { FFT } from './fft';

/** 音符（拍は最初の小節の頭を 0 とする） */
export interface CoverNote { t: number; len: number; midi: number }
export interface CoverDrumBar { kick: string; snare: string; hat: string }
export interface CoverSection { start: number; bars: number; energy: number; kind: SectionKind; name: string }

export interface CoverAnalysis {
  /** 曲の長さ（秒） */
  duration: number;
  bpm: number;
  /** 拍の時刻（秒）。最初の小節の頭から */
  beats: number[];
  /** 最初の小節の頭（秒） */
  offset: number;
  bars: number;
  key: { tonic: number; minor: boolean; name: string; confidence: number };
  /** 移調（半音）：曲の主音を C（短調なら A）にする */
  shift: number;
  /** 小節ごとのコード（ハ長調の度数 0 = C … 6 = B°） */
  chords: number[];
  /** 小節ごとのコードの名前（元の調で） */
  chordNames: string[];
  melody: CoverNote[];
  bass: CoverNote[];
  drums: CoverDrumBar[];
  sections: CoverSection[];
  /** 小節ごとの大きさ 0〜1 */
  energy: number[];
}

const SR = 22050;
const N = 2048;
const HOP = 512;
const FPS = SR / HOP; // 1 秒あたりのフレーム数
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 進み具合（0〜1）と、いま何をしているか */
export type Progress = (f: number, what: string) => void;

// ================= 下ごしらえ：モノラル・22.05kHz に =================
export function toMono22k(ch: Float32Array[], sr: number): Float32Array {
  const n = ch[0].length;
  const mono = new Float32Array(n);
  for (const c of ch) for (let i = 0; i < n; i++) mono[i] += c[i] / ch.length;
  if (sr === SR) return mono;
  // 折り返さないよう、先にローパス（2 次 × 2）してから間引く
  const fc = Math.min(SR * 0.45, sr * 0.45);
  for (let pass = 0; pass < 2; pass++) {
    const w = (2 * Math.PI * fc) / sr, al = Math.sin(w) / Math.SQRT2, c = Math.cos(w), a0 = 1 + al;
    const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { const y = b0 * mono[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = mono[i]; y2 = y1; y1 = y; mono[i] = y; }
  }
  const out = new Float32Array(Math.floor((n * SR) / sr));
  const k = sr / SR;
  for (let i = 0; i < out.length; i++) { const p = i * k, i0 = Math.floor(p), f = p - i0; out[i] = mono[i0] * (1 - f) + (mono[i0 + 1] ?? 0) * f; }
  return out;
}

// ================= 1. フレームごとの特徴 =================
interface Frames {
  count: number;
  flux: Float32Array; // 音の出だしの強さ
  kick: Float32Array; snare: Float32Array; hat: Float32Array; // 帯域ごとの出だし
  rms: Float32Array;
  chroma: Float32Array[]; // 12 音
  melody: Float32Array; melSal: Float32Array; // メロディの高さ（MIDI、0 = 無し）と目立ち度
  bass: Float32Array; bassSal: Float32Array;
}

function frames(x: Float32Array, progress?: Progress): Frames {
  const count = Math.max(1, Math.floor((x.length - N) / HOP) + 1);
  const fft = new FFT(N);
  const mag = new Float32Array(N / 2 + 1), prev = new Float32Array(N / 2 + 1);
  const logm = new Float32Array(N / 2 + 1);
  const F: Frames = {
    count, flux: new Float32Array(count), kick: new Float32Array(count), snare: new Float32Array(count), hat: new Float32Array(count),
    rms: new Float32Array(count), chroma: [], melody: new Float32Array(count), melSal: new Float32Array(count), bass: new Float32Array(count), bassSal: new Float32Array(count),
  };
  const binHz = SR / N;
  const bin = (hz: number) => Math.round(hz / binHz);
  // 12 音への割り当て（130Hz〜4kHz。低い所は下のベース用の細かい分析で）
  const pc = new Int8Array(N / 2 + 1).fill(-1);
  for (let k = bin(130); k <= bin(4000); k++) pc[k] = ((Math.round(12 * Math.log2((k * binHz) / 440)) + 69) % 12 + 12) % 12;
  // ベース：8 分の 1 に間引いた信号を細かく（2.7Hz ごと）見る
  const DEC = 8, NB = 1024, bassFft = new FFT(NB);
  const xb = new Float32Array(Math.floor(x.length / DEC));
  { let s = 0; for (let i = 0; i < xb.length; i++) { let a = 0; for (let j = 0; j < DEC; j++) a += x[i * DEC + j]; s += 0.5 * (a / DEC - s); xb[i] = s; } }
  const bmag = new Float32Array(NB / 2 + 1);
  const bHz = SR / DEC / NB;
  const rawK = new Float32Array(count), rawS = new Float32Array(count), rawH = new Float32Array(count);
  const bandE = (lo: number, hi: number) => { let e = 0; for (let k = bin(lo); k <= bin(hi); k++) e += mag[k] * mag[k]; return e; };
  for (let f = 0; f < count; f++) {
    const off = f * HOP;
    fft.magnitudes(x, off, mag);
    let e = 0;
    for (let i = 0; i < N; i++) e += x[off + i] * x[off + i];
    F.rms[f] = Math.sqrt(e / N);
    // 出だし：対数の大きさの増えた分（全体・帯域ごと）
    let fl = 0;
    for (let k = 1; k <= N / 2; k++) { logm[k] = Math.log(1 + 100 * mag[k]); const d = logm[k] - prev[k]; if (d > 0) fl += d; prev[k] = logm[k]; }
    F.flux[f] = fl;
    rawK[f] = bandE(40, 130); rawS[f] = bandE(180, 900) + bandE(1500, 5000); rawH[f] = bandE(7000, 10500);
    // 12 音
    const ch = new Float32Array(12);
    for (let k = 0; k <= N / 2; k++) if (pc[k] >= 0) ch[pc[k]] += mag[k];
    // メロディ：白くした大きさで、倍音を足した「目立ち度」が一番の高さ（MIDI 55〜86）
    const smooth = (k: number) => { let s = 0; for (let j = -8; j <= 8; j++) s += mag[Math.max(1, Math.min(N / 2, k + j))]; return s / 17 + 1e-9; };
    let best = 0, bestM = 0;
    for (let m = 55; m <= 86; m++) {
      let s = 0;
      for (let h = 1; h <= 5; h++) {
        const k = (midiHz(m) * h) / binHz;
        if (k >= N / 2 - 1) break;
        const k0 = Math.round(k);
        const v = Math.max(mag[k0 - 1], mag[k0], mag[k0 + 1]);
        s += (v / smooth(k0)) * Math.pow(0.8, h - 1);
      }
      if (s > best) { best = s; bestM = m; }
    }
    F.melody[f] = bestM; F.melSal[f] = best * (F.rms[f] > 1e-4 ? 1 : 0);
    // ベース（MIDI 28〜52）
    const bo = Math.floor(off / DEC) - NB / 2 + N / DEC / 2;
    bassFft.magnitudes(xb, bo, bmag);
    let bb = 0, bm = 0;
    for (let m = 28; m <= 52; m++) {
      let s = 0;
      for (let h = 1; h <= 3; h++) {
        const k = Math.round((midiHz(m) * h) / bHz);
        if (k >= NB / 2 - 1) break;
        s += Math.max(bmag[k - 1], bmag[k], bmag[k + 1]) * (h === 1 ? 1 : 0.5);
      }
      if (s > bb) { bb = s; bm = m; }
    }
    F.bass[f] = bm; F.bassSal[f] = bb;
    // ベースの音も 12 音に少し足す（コードの根音がわかりやすくなる）
    if (bm) ch[bm % 12] += bb * 0.15;
    F.chroma.push(ch);
    if (progress && f % 400 === 0) progress(0.05 + 0.6 * (f / count), '音を分けています');
  }
  // 帯域ごとの出だし：曲全体の平均の 3 割を「床」にして対数の増え方を見る（小さな雑音で反応しすぎないように）
  const onset = (raw: Float32Array, out: Float32Array) => {
    let mean = 0;
    for (const v of raw) mean += v / raw.length;
    const floor = mean * 0.3 + 1e-12;
    for (let f = 1; f < raw.length; f++) out[f] = Math.max(0, Math.log(raw[f] + floor) - Math.log(raw[f - 1] + floor));
  };
  onset(rawK, F.kick); onset(rawS, F.snare); onset(rawH, F.hat);
  return F;
}

// ================= 2. テンポと拍 =================
/** 出だしの強さから、局所の平均を引いて 0 以上に */
function novelty(flux: Float32Array): Float32Array {
  const n = flux.length, out = new Float32Array(n), W = 8;
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += flux[i] - (i - 2 * W - 1 >= 0 ? flux[i - 2 * W - 1] : 0);
    const mean = s / Math.min(i + 1, 2 * W + 1);
    out[i] = Math.max(0, flux[i] - mean);
  }
  let mx = 0;
  for (const v of out) mx = Math.max(mx, v);
  if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
  return out;
}

export function estimateTempo(nov: Float32Array): number {
  const n = nov.length;
  const minLag = Math.floor((FPS * 60) / 200), maxLag = Math.ceil((FPS * 60) / 55);
  const ac = new Float64Array(maxLag * 2 + 2);
  for (let lag = 1; lag < ac.length; lag++) { let s = 0; for (let i = lag; i < n; i++) s += nov[i] * nov[i - lag]; ac[lag] = s / (n - lag); }
  let best = 0, bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * FPS) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.9, 2));
    const s = (ac[lag] + 0.5 * (ac[2 * lag] ?? 0) + 0.25 * ac[Math.round(lag / 2)]) * prior;
    if (s > best) { best = s; bestLag = lag; }
  }
  // 放物線で細かく
  const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
  const d = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return (60 * FPS) / (bestLag + Math.max(-0.5, Math.min(0.5, d)));
}

/** 拍の位置（フレーム）：動的計画法（出だしの強い所を、テンポの間隔に近い間隔でつなぐ） */
export function trackBeats(nov: Float32Array, bpm: number): number[] {
  const n = nov.length, P = (60 * FPS) / bpm, tight = 120;
  const score = new Float64Array(n), from = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0, bi = -1;
    for (let tau = Math.max(0, Math.round(t - 2 * P)); tau <= t - Math.round(P / 2); tau++) {
      const pen = -tight * Math.pow(Math.log((t - tau) / P), 2);
      const v = score[tau] + pen;
      if (v > best || bi < 0) { best = v; bi = tau; }
    }
    score[t] = nov[t] + (bi >= 0 ? Math.max(0, best) : 0);
    from[t] = bi >= 0 && best > 0 ? bi : -1;
  }
  // 最後の 1 拍の中で一番いい所から戻る
  let end = n - 1, bs = -Infinity;
  for (let t = Math.max(0, n - Math.round(P)); t < n; t++) if (score[t] > bs) { bs = score[t]; end = t; }
  const beats: number[] = [];
  for (let t = end; t >= 0; t = from[t]) { beats.push(t); if (from[t] < 0) break; }
  beats.reverse();
  // 途中が抜けた所は、テンポの間隔で埋める
  const out: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    if (i > 0) { const gap = beats[i] - beats[i - 1], k = Math.round(gap / P); for (let j = 1; j < k; j++) out.push(beats[i - 1] + (gap * j) / k); }
    out.push(beats[i]);
  }
  // 前にさかのぼって、曲の頭の方も埋める
  while (out.length && out[0] - P >= 0) out.unshift(out[0] - P);
  return out;
}

// ================= 3. 調とコード =================
// クルムハンスルの調のプロファイル
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i] / 12; mb += b[i] / 12; }
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < 12; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return s / Math.sqrt(sa * sb + 1e-12);
}
export function detectKey(total: Float32Array): CoverAnalysis['key'] {
  let best = -2, tonic = 0, minor = false, second = -2;
  for (let t = 0; t < 12; t++) for (const [prof, mi] of [[MAJ, false], [MIN, true]] as const) {
    const rot = Array.from({ length: 12 }, (_, i) => prof[(i - t + 12) % 12]);
    const c = corr(total, rot);
    if (c > best) { second = best; best = c; tonic = t; minor = mi; } else if (c > second) second = c;
  }
  return { tonic, minor, name: `${NOTE_NAMES[tonic]}${minor ? 'm' : ''}`, confidence: Math.max(0, best - second) };
}
/** ハ長調の 7 つの和音（度数 0〜6）の構成音 */
const DIATONIC = [[0, 4, 7], [2, 5, 9], [4, 7, 11], [5, 9, 0], [7, 11, 2], [9, 0, 4], [11, 2, 5]];
const DEG_NAMES = ['', 'm', 'm', '', '', 'm', 'dim'];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

/** 小節ごとの 12 音（移調済み）→ 度数（少し粘る：同じコードが続きやすい） */
function chordsOf(barChroma: Float32Array[]): number[] {
  const templ = DIATONIC.map((tones) => { const t = new Float32Array(12); for (const p of tones) t[p] = 1; t[tones[0]] = 1.4; return t; });
  const cos = (a: Float32Array, b: Float32Array) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < 12; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / Math.sqrt(na * nb + 1e-12); };
  const n = barChroma.length;
  if (!n) return [];
  const S = barChroma.map((c) => templ.map((t) => cos(c, t)));
  // ビタビ：変わると少し減点
  const STAY = 0.06;
  const dp = S.map(() => new Float64Array(7)), bk = S.map(() => new Int8Array(7));
  for (let d = 0; d < 7; d++) dp[0][d] = S[0][d] + (d === 0 || d === 5 ? 0.02 : 0);
  for (let i = 1; i < n; i++) for (let d = 0; d < 7; d++) {
    let best = -1e9, bi = 0;
    for (let p = 0; p < 7; p++) { const v = dp[i - 1][p] - (p === d ? 0 : STAY); if (v > best) { best = v; bi = p; } }
    dp[i][d] = best + S[i][d]; bk[i][d] = bi;
  }
  let d = 0;
  for (let k = 1; k < 7; k++) if (dp[n - 1][k] > dp[n - 1][d]) d = k;
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) { out[i] = d; d = bk[i][d]; }
  return out;
}

// ================= 4. 構成（イントロ・Aメロ・サビ…） =================
function sectionsOf(feat: Float32Array[], energy: number[]): CoverSection[] {
  const n = feat.length;
  if (n < 8) return [{ start: 0, bars: n, energy: 0.7, kind: 'verse', name: 'Aメロ' }];
  const sim = (a: Float32Array, b: Float32Array) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / Math.sqrt(na * nb + 1e-12); };
  // 区切りらしさ：前の 4 小節と後ろの 4 小節がどれだけ違うか（チェッカーボード）
  const K = 4, nov = new Float32Array(n);
  for (let i = K; i <= n - K; i++) {
    let same = 0, cross = 0;
    for (let a = -K; a < K; a++) for (let b = -K; b < K; b++) {
      const v = sim(feat[i + a], feat[i + b]);
      if ((a < 0) === (b < 0)) same += v; else cross += v;
    }
    nov[i] = (same - cross) / (K * K * 2) + Math.abs((energy[i] ?? 0) - (energy[i - 1] ?? 0)) * 0.5;
  }
  // 4 小節以上あけて、強い所から区切る（4 小節の倍数を少しひいき）
  const cand = [...nov.keys()].filter((i) => i >= 4 && i <= n - 4).sort((a, b) => nov[b] * (b % 4 === 0 ? 1.3 : 1) - nov[a] * (a % 4 === 0 ? 1.3 : 1));
  const cuts: number[] = [];
  const maxCuts = Math.max(1, Math.round(n / 8));
  for (const c of cand) {
    if (cuts.length >= maxCuts || nov[c] <= 0.02) break;
    if (cuts.every((x) => Math.abs(x - c) >= 4)) cuts.push(c);
  }
  cuts.sort((a, b) => a - b);
  const bounds = [0, ...cuts, n];
  const secs: CoverSection[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1];
    const e = energy.slice(a, b).reduce((s, v) => s + v, 0) / Math.max(1, b - a);
    secs.push({ start: a, bars: b - a, energy: e, kind: 'verse', name: '' });
  }
  // 大きさで名前を付ける
  const es = secs.map((s) => s.energy).sort((x, y) => x - y);
  const hi = es[Math.floor(es.length * 0.7)] ?? 1;
  secs.forEach((s, i) => {
    const first = i === 0, last = i === secs.length - 1;
    if (first && s.energy < 0.55 && secs.length > 1) Object.assign(s, { kind: 'intro', name: 'イントロ' });
    else if (last && s.energy < 0.6 && secs.length > 2) Object.assign(s, { kind: 'outro', name: 'アウトロ' });
    else if (s.energy >= hi && s.energy > 0.6) Object.assign(s, { kind: 'chorus', name: 'サビ' });
    else if (s.energy < 0.35) Object.assign(s, { kind: 'break', name: 'ブレイク' });
    else Object.assign(s, { kind: 'verse', name: 'Aメロ' });
    // 盛り上がり（作曲係が使う 0〜1）
    s.energy = Math.max(0.2, Math.min(1, s.energy));
  });
  // 同じ名前が続くときは 2・3…と番号を
  const count: Record<string, number> = {};
  for (const s of secs) { count[s.name] = (count[s.name] ?? 0) + 1; if (count[s.name] > 1) s.name = `${s.name} ${count[s.name]}`; }
  return secs;
}

// ================= まとめ =================
export function analyze(ch: Float32Array[], sr: number, progress?: Progress): CoverAnalysis {
  progress?.(0, '準備しています');
  const x = toMono22k(ch, sr);
  const duration = x.length / SR;
  const F = frames(x, progress);
  progress?.(0.7, 'テンポを探しています');
  const nov = novelty(F.flux);
  const bpm = estimateTempo(nov);
  let beatsF = trackBeats(nov, bpm);
  if (beatsF.length < 8) beatsF = Array.from({ length: Math.floor((F.count * bpm) / (60 * FPS)) }, (_, i) => (i * 60 * FPS) / bpm);
  const at = (arr: Float32Array, t: number) => { let m = 0; for (let k = -2; k <= 2; k++) m = Math.max(m, arr[Math.round(t) + k] ?? 0); return m; };
  // 裏拍に引っぱられていないか：キック（低い音の出だし）が拍より拍の間に多ければ、半拍ずらす（レゲエのスカンクなど）
  {
    const half = (60 * FPS) / bpm / 2;
    let on = 0, off = 0;
    for (const b of beatsF) { on += at(F.kick, b); off += at(F.kick, b + half); }
    if (off > on * 1.25) beatsF = beatsF.map((b) => b + half).filter((b) => b < F.count);
  }
  // 小節の頭：拍の 4 つおきで、和音の変わり目（主）とキック・ベースの変わり目が一番そろう位置
  const beatChroma = beatsF.map((b, i) => {
    const c = new Float32Array(12), e = beatsF[i + 1] ?? b + (60 * FPS) / bpm;
    for (let f = Math.round(b); f < Math.min(F.count, Math.round(e)); f++) for (let k = 0; k < 12; k++) c[k] += F.chroma[f][k];
    return c;
  });
  const change = (i: number) => {
    if (i <= 0 || i >= beatChroma.length) return 0;
    const a = beatChroma[i - 1], b = beatChroma[i];
    let s = 0, na = 0, nb = 0;
    for (let k = 0; k < 12; k++) { s += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; }
    return 1 - s / Math.sqrt(na * nb + 1e-12);
  };
  const scores = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) {
    let h = 0, k = 0, c = 0;
    for (let i = p; i < beatsF.length; i += 4) { h += change(i); k += at(F.kick, beatsF[i]); c++; }
    scores[p] = (c ? h / c : 0) * 3 + (c ? k / c : 0) * 0.15;
  }
  let phase = 0;
  for (let p = 1; p < 4; p++) if (scores[p] > scores[phase]) phase = p;
  beatsF = beatsF.slice(phase);
  // 小節の数（最後の小節は 4 拍そろうものまで）
  const bars = Math.max(1, Math.floor((beatsF.length - 1) / 4));
  // 1 拍より細かい位置（16 分）→ フレーム
  const P = (60 * FPS) / bpm;
  const beatFrame = (beat: number) => {
    const i = Math.floor(beat), f = beat - i;
    const a = beatsF[i] ?? beatsF[beatsF.length - 1] + (i - beatsF.length + 1) * P;
    const b = beatsF[i + 1] ?? a + P;
    return a + (b - a) * f;
  };

  progress?.(0.75, '調とコードを調べています');
  // 調（曲全体の 12 音）
  const total = new Float32Array(12);
  for (let f = 0; f < F.count; f++) for (let i = 0; i < 12; i++) total[i] += F.chroma[f][i];
  const key = detectKey(total);
  const toC = (((key.minor ? 9 : 0) - key.tonic) % 12 + 12) % 12;
  const shift = toC > 6 ? toC - 12 : toC;
  // 小節ごとの 12 音（移調済み）と大きさ
  const barChroma: Float32Array[] = [], chordIn: Float32Array[] = [], barRms: number[] = [], feat: Float32Array[] = [];
  for (let b = 0; b < bars; b++) {
    const f0 = Math.round(beatFrame(b * 4)), f1 = Math.round(beatFrame(b * 4 + 4));
    const c = new Float32Array(12);
    let r = 0, kk = 0, sn = 0, hh = 0;
    for (let f = Math.max(0, f0); f < Math.min(F.count, f1); f++) {
      for (let i = 0; i < 12; i++) c[(i + toC) % 12] += F.chroma[f][i];
      r += F.rms[f]; kk += F.kick[f]; sn += F.snare[f]; hh += F.hat[f];
    }
    const len = Math.max(1, f1 - f0);
    // コードを決めるときは、ベースの音（根音のことが多い）をもう少し重く
    const bc = new Float32Array(12);
    for (let f = Math.max(0, f0); f < Math.min(F.count, f1); f++) if (F.bass[f]) bc[(F.bass[f] + toC) % 12] += F.bassSal[f];
    let cs0 = 0, bs0 = 0;
    for (let i = 0; i < 12; i++) { cs0 += c[i]; bs0 += bc[i]; }
    const forChord = new Float32Array(12);
    for (let i = 0; i < 12; i++) forChord[i] = c[i] / (cs0 + 1e-9) + (bc[i] / (bs0 + 1e-9)) * 0.35;
    chordIn.push(forChord);
    barChroma.push(c);
    barRms.push(r / len);
    let cs = 0; for (const v of c) cs += v;
    feat.push(Float32Array.from([...c].map((v) => v / (cs + 1e-9)).concat([kk / len, sn / len, hh / len, (r / len) * 10])));
  }
  const rMax = Math.max(...barRms, 1e-9), rMin = Math.min(...barRms);
  const energy = barRms.map((r) => (r - rMin) / (rMax - rMin + 1e-9));
  const chords = chordsOf(chordIn);
  const chordNames = chords.map((d) => `${NOTE_NAMES[((MAJOR_SCALE[d] - toC) % 12 + 12) % 12]}${DEG_NAMES[d]}`);

  progress?.(0.85, 'メロディとベースを聞き取っています');
  // ---- メロディ：16 分ごとに、目立つ高さの多数決 ----
  const salSorted = [...F.melSal].sort((a, b) => a - b);
  const voiceTh = salSorted[Math.floor(salSorted.length * 0.4)] ?? 0;
  const melSlots: number[] = [];
  for (let s = 0; s < bars * 16; s++) {
    const f0 = Math.round(beatFrame(s / 4)), f1 = Math.max(f0 + 1, Math.round(beatFrame((s + 1) / 4)));
    const votes = new Map<number, number>();
    let voiced = 0;
    for (let f = f0; f < f1 && f < F.count; f++) if (F.melSal[f] > voiceTh) { voiced++; votes.set(F.melody[f], (votes.get(F.melody[f]) ?? 0) + F.melSal[f]); }
    let m = 0, mv = 0;
    votes.forEach((v, k) => { if (v > mv) { mv = v; m = k; } });
    melSlots.push(voiced * 2 >= f1 - f0 ? m : 0);
  }
  const onsetAt = (s: number) => at(nov, beatFrame(s / 4)) > 0.25;
  const melody = notesFrom(melSlots, 0.25, onsetAt, shift);
  // ---- ベース：8 分ごと ----
  const bsSorted = [...F.bassSal].sort((a, b) => a - b);
  const bassTh = bsSorted[Math.floor(bsSorted.length * 0.35)] ?? 0;
  const bassSlots: number[] = [];
  for (let s = 0; s < bars * 8; s++) {
    const f0 = Math.round(beatFrame(s / 2)), f1 = Math.max(f0 + 1, Math.round(beatFrame((s + 1) / 2)));
    const votes = new Map<number, number>();
    for (let f = f0; f < f1 && f < F.count; f++) if (F.bassSal[f] > bassTh) votes.set(F.bass[f] % 12, (votes.get(F.bass[f] % 12) ?? 0) + F.bassSal[f]);
    let m = -1, mv = 0;
    votes.forEach((v, k) => { if (v > mv) { mv = v; m = k; } });
    // ベースは音の名前（12 音）だけ使い、高さは 36（C2）〜47 にそろえる
    bassSlots.push(m < 0 ? 0 : 36 + m);
  }
  const bass = notesFrom(bassSlots, 0.5, (s) => at(F.kick, beatFrame(s / 2)) > 0.3, shift).map((n) => ({ ...n, midi: 36 + (((n.midi - 36) % 12) + 12) % 12 }));

  progress?.(0.93, 'ドラムを聞き取っています');
  // ---- ドラム：16 分ごとに、帯域ごとの出だしが強い所 ----
  const thOf = (arr: Float32Array) => { const s = [...arr].sort((a, b) => a - b); return Math.max(s[Math.floor(s.length * 0.9)] * 0.6, 1e-6); };
  const kTh = thOf(F.kick), sTh = thOf(F.snare), hTh = thOf(F.hat);
  const drums: CoverDrumBar[] = [];
  for (let b = 0; b < bars; b++) {
    let k = '', sn = '', h = '';
    for (let s = 0; s < 16; s++) {
      const fr = beatFrame(b * 4 + s / 4);
      k += at(F.kick, fr) > kTh ? 'x' : '.';
      sn += at(F.snare, fr) > sTh ? 'x' : '.';
      h += at(F.hat, fr) > hTh ? 'x' : '.';
    }
    drums.push({ kick: k, snare: sn, hat: h });
  }

  progress?.(0.97, '曲の構成を調べています');
  const sections = sectionsOf(feat, energy);
  const beats = beatsF.slice(0, bars * 4 + 1).map((f) => (f * HOP + N / 2) / SR); // フレームの真ん中の時刻
  progress?.(1, 'できました');
  return { duration, bpm: Math.round(bpm * 10) / 10, beats, offset: beats[0] ?? 0, bars, key, shift, chords, chordNames, melody, bass, drums, sections, energy };
}

/** 枠ごとの高さ（0 = 無し）→ 音符。同じ高さが続けばのばす（出だしがあれば切る）。step = 1 枠の拍 */
function notesFrom(slots: number[], step: number, onset: (s: number) => boolean, shift: number): CoverNote[] {
  const out: CoverNote[] = [];
  let cur: CoverNote | null = null;
  slots.forEach((m, s) => {
    if (!m) { cur = null; return; }
    const midi = m + shift;
    if (cur && cur.midi === midi && !onset(s)) { cur.len += step; return; }
    cur = { t: s * step, len: step, midi };
    out.push(cur);
  });
  return out;
}
