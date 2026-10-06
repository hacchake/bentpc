// 曲の解析（DOM 非依存。Web Worker・テストのどこでも動く）。取り込んだ曲の波形から、カバーに必要なものを読み取る：
//   テンポと拍 → 小節の頭 → 調 → 小節ごとのコード → メロディ → ベース → ドラム（キック・スネア・ハット）→ 構成（イントロ・サビ…）
// 結果の音の高さ・コードは、曲の調を「ハ長調（短調ならイ短調）」に移した値で持つ（作曲係がハ長調の白鍵で考えるため）。
import type { SectionKind } from '../compose/styles';
import { FFT } from './fft';

/** 音符（拍は最初の小節の頭を 0 とする） */
export interface CoverNote { t: number; len: number; midi: number }
export interface CoverDrumBar { kick: string; snare: string; hat: string }
export interface CoverSection { start: number; bars: number; energy: number; kind: SectionKind; name: string }

/** コード 1 つ：根音（ハ長調に移した音名 0〜11）と種類 */
export interface ChordQ { root: number; q: 'maj' | 'min' | 'dim' }

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
  /** 半小節（2 拍）ごとのコード（度数）。小節の途中でコードが変わる曲用。chords は各小節の頭のもの */
  chordsHalf?: number[];
  /** 半小節ごとのコードの中身（ハ長調に移した根音 0〜11 と、長・短・減）。調の外のコード（III の長三和音・♭VII など）も表せる */
  chordQ?: ChordQ[];
  /** 小節ごとのコードの名前（元の調で） */
  chordNames: string[];
  melody: CoverNote[];
  bass: CoverNote[];
  drums: CoverDrumBar[];
  sections: CoverSection[];
  /** 小節ごとの大きさ 0〜1 */
  energy: number[];
  /** ハネ：8 分の裏を 8 分の何割遅らせるか（0 = まっすぐ。0.33 で 3 連のハネ）。メロディ・ドラムの枠はハネを戻した位置 */
  swing?: number;
  /** メロディの高さ（MIDI、元の調のまま。0 = 歌っていない）を 22.05kHz・512 サンプルごとに（ボーカルを取り出すのに使う） */
  pitch: number[];
}

const SR = 22050;
const N = 2048;
const HOP = 512;
const FPS = SR / HOP; // 1 秒あたりのフレーム数
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
/** 周波数の目と目の間（小数の位置 k）の大きさ：となりの目と直線でつなぐ（低い音で、半音となりと取りちがえないように） */
const lin = (a: Float32Array, k: number) => { const i = Math.floor(k), f = k - i; return a[i] * (1 - f) + (a[i + 1] ?? 0) * f; };

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
  // 12 音への割り当て（130Hz〜2kHz。低い所は下のベース用の細かい分析で）。
  // 高い所ほど軽く数える（高い所は倍音ばかりで、調に無い音（7・11 倍音など）が混ざるため）
  const pc = new Int8Array(N / 2 + 1).fill(-1), pw = new Float32Array(N / 2 + 1);
  for (let k = bin(130); k <= bin(2000); k++) {
    pc[k] = ((Math.round(12 * Math.log2((k * binHz) / 440)) + 69) % 12 + 12) % 12;
    pw[k] = Math.min(1, 500 / (k * binHz));
  }
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
    for (let k = 0; k <= N / 2; k++) if (pc[k] >= 0) ch[pc[k]] += mag[k] * pw[k];
    // メロディ：白くした大きさで、倍音を足した「目立ち度」が一番の高さ（MIDI 55〜86）
    const smooth = (k: number) => { let s = 0; for (let j = -8; j <= 8; j++) s += mag[Math.max(1, Math.min(N / 2, k + j))]; return s / 17 + 1e-9; };
    let best = 0, bestM = 0;
    for (let m = 55; m <= 86; m++) {
      let s = 0;
      for (let h = 1; h <= 5; h++) {
        const k = (midiHz(m) * h) / binHz;
        if (k >= N / 2 - 1) break;
        const k0 = Math.round(k);
        s += (lin(mag, k) / smooth(k0)) * Math.pow(0.8, h - 1);
      }
      if (s > best) { best = s; bestM = m; }
    }
    F.melody[f] = bestM; F.melSal[f] = best * (F.rms[f] > 1e-4 ? 1 : 0);
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
  const bt = bassTrack(x, count);
  F.bass = bt.bass; F.bassSal = bt.sal;
  return F;
}

/**
 * ベースの高さ（MIDI 28〜52）と目立ち度を、フレーム（窓の頭が f × HOP）ごとに。8 分の 1 に間引いた信号を細かく（2.7Hz ごと）見る。
 * 「同じ高さが続く音」だけ（キックは一瞬で高さが下がるので、ベースの音とまちがえないように。3 フレーム＝約 70ms 同じ高さ）。それ以外は目立ち度 0
 */
function bassTrack(x: Float32Array, count: number): { bass: Float32Array; sal: Float32Array } {
  const DEC = 8, NB = 1024, bassFft = new FFT(NB);
  const xb = new Float32Array(Math.floor(x.length / DEC));
  { let s = 0; for (let i = 0; i < xb.length; i++) { let a = 0; for (let j = 0; j < DEC; j++) a += x[i * DEC + j]; s += 0.5 * (a / DEC - s); xb[i] = s; } }
  const bmag = new Float32Array(NB / 2 + 1);
  const bHz = SR / DEC / NB;
  const bass = new Float32Array(count), sal = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const bo = Math.floor((f * HOP) / DEC) - NB / 2 + N / DEC / 2;
    bassFft.magnitudes(xb, bo, bmag);
    let bb = 0, bm = 0;
    for (let m = 28; m <= 52; m++) {
      // 倍音（2・3 倍）が無い低い音は、ほぼキック（正弦波の「ドン」）。倍音がそろうほど、ベースの音として数える
      const h1 = lin(bmag, midiHz(m) / bHz), h2 = lin(bmag, (midiHz(m) * 2) / bHz), h3 = lin(bmag, (midiHz(m) * 3) / bHz);
      let s = (h1 + 0.5 * h2 + 0.5 * h3) * (0.1 + 0.9 * Math.min(1, (h2 + h3) / (h1 + 1e-9)) ** 2);
      // 2 倍音が弱いのに 3 倍音だけ強いのは、本当の音（3 倍音の 2/3 の高さ）の倍音を拾った 5 度下の読みちがい
      s *= Math.min(1, (2.5 * h2) / (h2 + h3 + 1e-9));
      if (s > bb) { bb = s; bm = m; }
    }
    bass[f] = bm; sal[f] = bb;
  }
  const raw = bass.slice();
  for (let f = 0; f < count; f++) {
    const st = f >= 2 && raw[f] === raw[f - 1] && raw[f] === raw[f - 2] && raw[f] > 0;
    const ahead = f + 2 < count && raw[f] === raw[f + 1] && raw[f] === raw[f + 2];
    if (!st && !ahead) sal[f] = 0;
  }
  return { bass, sal };
}

/** 曲（22.05kHz モノラル）のベースの高さ（MIDI、0 = はっきりしない）をフレームごとに（analyze の pitch と同じ並び。歌からベースの倍音を外すのに使う） */
export function bassPitch(x: Float32Array): Float32Array {
  const count = Math.max(1, Math.floor((x.length - N) / HOP) + 1);
  const { bass, sal } = bassTrack(x, count);
  const sorted = [...sal].filter((v) => v > 0).sort((a, b) => a - b);
  const th = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  return Float32Array.from(bass, (m, f) => (sal[f] > th ? m : 0));
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
  // 70〜180 BPM の中で探す（それより遅い曲は倍、速い曲は半分の速さで数える。カバーには困らない）
  const maxLag = Math.ceil((FPS * 60) / 70);
  const ac = new Float64Array(maxLag * 2 + 2);
  for (let lag = 1; lag < ac.length; lag++) { let s = 0; for (let i = lag; i < n; i++) s += nov[i] * nov[i - lag]; ac[lag] = s / (n - lag); }
  // 拍の間隔はフレームの整数にならない（140 BPM ≒ 18.4 フレーム）ので、山がとなりに割れても拾えるよう少しぼかして、間の値も読む
  const acS = Float64Array.from(ac, (v, l) => v + 0.5 * ((ac[l - 1] ?? 0) + (ac[l + 1] ?? 0)));
  const A = (x: number) => { const i = Math.floor(x), f = x - i; return (acS[i] ?? 0) * (1 - f) + (acS[i + 1] ?? 0) * f; };
  const scoreOf = (bpm: number) => {
    const lag = (60 * FPS) / bpm;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.9, 2));
    return (A(lag) + 0.5 * A(2 * lag) + 0.25 * A(lag / 2)) * prior;
  };
  let best = -1, bestBpm = 115;
  for (let bpm = 70; bpm <= 180; bpm += 0.25) { const s = scoreOf(bpm); if (s > best) { best = s; bestBpm = bpm; } }
  // 放物線で細かく
  const a = scoreOf(bestBpm - 0.25), b = best, c = scoreOf(bestBpm + 0.25);
  const d = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return bestBpm + 0.25 * Math.max(-0.5, Math.min(0.5, d));
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

// ================= ハネ（スウィング） =================
/** 拍の中の位置（0〜1）→ ハネた時間の位置。8 分の裏（0.5）が 0.5 + swing / 2 に来る */
export function swingWarp(f: number, swing: number): number {
  if (!swing) return f;
  return f < 0.5 ? f * (1 + swing) : 0.5 * (1 + swing) + (f - 0.5) * (1 - swing);
}
/**
 * ハネの量（8 分の裏を 8 分の何割遅らせるか。0 = まっすぐ）。
 * 拍と拍の間で、出だし（全体＋ハット）がいちばん集まる位置を探す。まっすぐの裏よりはっきり強いときだけハネとみなす
 */
function swingOf(nov: Float32Array, hat: Float32Array, beatsF: number[]): number {
  let hm = 0;
  for (const v of hat) hm = Math.max(hm, v);
  const val = (t: number) => { const i = Math.floor(t), f = t - i; const g = (k: number) => (nov[k] ?? 0) + (hm > 0 ? (hat[k] ?? 0) / hm : 0); return Math.max(g(i) * (1 - f) + g(i + 1) * f, g(Math.round(t))); };
  /** 拍の中の位置 fr（0〜1）での出だしの合計 */
  const sumAt = (fr: number) => {
    let s = 0;
    for (let i = 0; i + 1 < beatsF.length; i++) s += val(beatsF[i] + (beatsF[i + 1] - beatsF[i]) * fr);
    return s;
  };
  // 拍の出だしそのものが、拍の位置から少しずれていることがある（その分を差し引く）
  let phi = 0, pv = -1;
  for (let fr = -0.1; fr <= 0.1001; fr += 0.01) { const v = sumAt((fr + 1) % 1); if (v > pv) { pv = v; phi = fr; } }
  const straight = sumAt(0.5 + phi);
  let best = 0, bestSw = 0;
  for (let sw = 0.08; sw <= 0.5; sw += 0.01) { const v = sumAt(0.5 + phi + sw / 2); if (v > best) { best = v; bestSw = sw; } }
  return best > straight * 1.3 && bestSw <= 0.42 ? Math.round(bestSw * 100) / 100 : 0;
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

/** 小節ごとの 12 音（移調済み）が、ハ長調の 7 つの和音のどれかにどれだけなじむか（合計） */
function chordFit(barChroma: Float32Array[]): number {
  let sum = 0;
  for (const c of barChroma) {
    let best = 0;
    for (const tones of DIATONIC) {
      let s = 0, n = 0;
      for (let i = 0; i < 12; i++) { const t = tones.includes(i) ? (i === tones[0] ? 1.4 : 1) : 0; s += c[i] * t; n += c[i] * c[i]; }
      best = Math.max(best, s / Math.sqrt(n * (1.4 * 1.4 + 2) + 1e-12));
    }
    sum += best;
  }
  return sum;
}
// ---------------- 調の外のコードも読む（12 の根音 × 長・短、と減三和音） ----------------
const QUALS = [['maj', [0, 4, 7]], ['min', [0, 3, 7]], ['dim', [0, 3, 6]]] as const;
/** 状態 = 根音 × 3 + 種類（0 = 長、1 = 短、2 = 減） */
const CHORD_STATES = Array.from({ length: 36 }, (_, i) => ({ root: Math.floor(i / 3), q: QUALS[i % 3][0] as ChordQ['q'], tones: QUALS[i % 3][1].map((x) => (x + Math.floor(i / 3)) % 12) }));
/** 調（ハ長調に移した後）の 7 つの和音か */
const diatonicDeg = (c: ChordQ): number => {
  for (let d = 0; d < 7; d++) if (MAJOR_SCALE[d] === c.root && ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'][d] === c.q) return d;
  return -1;
};
/**
 * 12 音（移調済み）の並び → コードの並び（ビタビ）。inKey = 調の 7 つの和音を少しひいきする量（0 なら調を気にしない）。
 * 減三和音は調の中（B°）だけ使う（調の外の減三和音は、たいてい別のコードの聞きまちがい）
 */
function chords24(chroma: Float32Array[], changeCost: (i: number) => number, inKey: number): ChordQ[] {
  const n = chroma.length;
  if (!n) return [];
  const S = CHORD_STATES.length;
  const score = chroma.map((c) => {
    let nn = 0;
    for (let i = 0; i < 12; i++) nn += c[i] * c[i];
    return CHORD_STATES.map((st) => {
      const dia = diatonicDeg(st) >= 0;
      if (st.q === 'dim' && (!dia || inKey === 0)) return -9;
      let sc = 0;
      for (let k = 0; k < 3; k++) sc += c[st.tones[k]] * (k === 0 ? 1.4 : 1);
      return sc / Math.sqrt(nn * (1.4 * 1.4 + 2) + 1e-12) + (dia ? inKey : 0);
    });
  });
  const dp = score.map(() => new Float64Array(S)), bk = score.map(() => new Int16Array(S));
  for (let j = 0; j < S; j++) dp[0][j] = score[0][j];
  for (let i = 1; i < n; i++) {
    const cost = changeCost(i);
    let bestPrev = 0;
    for (let j = 1; j < S; j++) if (dp[i - 1][j] > dp[i - 1][bestPrev]) bestPrev = j;
    for (let j = 0; j < S; j++) {
      const stay = dp[i - 1][j], move = dp[i - 1][bestPrev] - cost;
      if (stay >= move) { dp[i][j] = stay + score[i][j]; bk[i][j] = j; } else { dp[i][j] = move + score[i][j]; bk[i][j] = bestPrev; }
    }
  }
  let j = 0;
  for (let k = 1; k < S; k++) if (dp[n - 1][k] > dp[n - 1][j]) j = k;
  const out: ChordQ[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) { out[i] = { root: CHORD_STATES[j].root, q: CHORD_STATES[j].q }; j = bk[i][j]; }
  return out;
}
/** コード → いちばん近い度数（調の外のものは、根音が同じか半音上の白鍵の度数） */
export function degreeOf(c: ChordQ): number {
  const d = diatonicDeg(c);
  if (d >= 0) return d;
  const at = MAJOR_SCALE.indexOf(c.root);
  return at >= 0 ? at : MAJOR_SCALE.indexOf((c.root + 1) % 12);
}
const chordName = (c: ChordQ, toC: number) => `${NOTE_NAMES[((c.root - toC) % 12 + 12) % 12]}${c.q === 'min' ? 'm' : c.q === 'dim' ? 'dim' : ''}`;

/** 半小節ごとのコード → 小節ごとのコード（小節の頭のもの） */
const chords4 = (half: number[]) => half.filter((_, i) => i % 2 === 0);
/** 小節ごとの 12 音（移調済み）→ 度数（少し粘る：同じコードが続きやすい） */
function chordsOf(barChroma: Float32Array[], changeCost: (i: number) => number = () => 0.06): number[] {
  const templ = DIATONIC.map((tones) => { const t = new Float32Array(12); for (const p of tones) t[p] = 1; t[tones[0]] = 1.4; return t; });
  const cos = (a: Float32Array, b: Float32Array) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < 12; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / Math.sqrt(na * nb + 1e-12); };
  const n = barChroma.length;
  if (!n) return [];
  const S = barChroma.map((c) => templ.map((t) => cos(c, t)));
  // ビタビ：変わると少し減点
  const dp = S.map(() => new Float64Array(7)), bk = S.map(() => new Int8Array(7));
  for (let d = 0; d < 7; d++) dp[0][d] = S[0][d] + (d === 0 || d === 5 ? 0.02 : 0);
  for (let i = 1; i < n; i++) for (let d = 0; d < 7; d++) {
    let best = -1e9, bi = 0;
    const cost = changeCost(i);
    for (let p = 0; p < 7; p++) { const v = dp[i - 1][p] - (p === d ? 0 : cost); if (v > best) { best = v; bi = p; } }
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
  let bpm = estimateTempo(nov);
  let beatsF = trackBeats(nov, bpm);
  const at = (arr: Float32Array, t: number) => { let m = 0; for (let k = -2; k <= 2; k++) m = Math.max(m, arr[Math.round(t) + k] ?? 0); return m; };
  if (beatsF.length < 8) beatsF = Array.from({ length: Math.floor((F.count * bpm) / (60 * FPS)) }, (_, i) => (i * 60 * FPS) / bpm);
  // 拍が裏拍などにずれていないか：キック（低い音の出だし）が拍の中のどこに集まるかを見て、いちばん集まる所を拍にする
  // （レゲエのスカンク、ハネた曲の裏拍に引っぱられたときなど）
  const alignPhase = () => {
    const BINS = 20, hist = new Float64Array(BINS);
    for (let i = 0; i + 1 < beatsF.length; i++) for (let j = 0; j < BINS; j++) hist[j] += at(F.kick, beatsF[i] + ((beatsF[i + 1] - beatsF[i]) * j) / BINS);
    let bj = 0;
    for (let j = 1; j < BINS; j++) if (hist[j] > hist[bj]) bj = j;
    // となりの枠は同じ出だしのにじみなので、拍の位置のまわりで一番のものとくらべる
    const near = Math.max(hist[0], hist[1], hist[BINS - 1]);
    if (bj > 1 && bj < BINS - 1 && hist[bj] > near * 1.25) {
      const fr = bj / BINS;
      beatsF = beatsF.slice(0, -1).map((b, i) => b + (beatsF[i + 1] - b) * fr);
    }
  };
  alignPhase();
  // 半分の速さで数えていないか：拍をそろえた後で、スネア（2・4 拍目）が拍と拍のちょうど間ばかりで鳴っていれば、本当は倍の速さ
  if (bpm * 2 <= 180 && beatsF.length >= 8) {
    const half = (60 * FPS) / bpm / 2;
    let on = 0, off = 0;
    for (const b of beatsF) { on += at(F.snare, b); off += at(F.snare, b + half); }
    if (off > on * 1.5) { bpm *= 2; beatsF = trackBeats(nov, bpm); if (beatsF.length >= 8) alignPhase(); }
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
  // 区切り方ごとに「1 小節 = 1 つの和音」でどれだけうまく説明できるか（区切りがずれると、2 つの和音が混ざって合わなくなる）
  for (let p = 0; p < 4; p++) {
    const barC: Float32Array[] = [];
    for (let i = p; i + 4 <= beatChroma.length; i += 4) {
      const c = new Float32Array(12);
      for (let k = 0; k < 4; k++) for (let j = 0; j < 12; j++) c[j] += beatChroma[i + k][j];
      barC.push(c);
    }
    let fit = 0;
    for (let t = 0; t < 12; t++) fit = Math.max(fit, chordFit(barC.map((c) => Float32Array.from({ length: 12 }, (_, j) => c[(j + t) % 12]))));
    scores[p] += barC.length ? (fit / barC.length) * 4 : 0;
    // ベースの根音が、小節の中でどれだけ同じか（区切りがずれると 2 つの根音が混ざる）
    let same = 0, nb = 0;
    for (let i = p; i + 4 <= beatsF.length; i += 4) {
      const h = new Float32Array(12);
      let tot = 0;
      for (let f = Math.round(beatsF[i]); f < Math.min(F.count, Math.round(beatsF[i + 3] + (60 * FPS) / bpm)); f++) if (F.bass[f]) { h[F.bass[f] % 12] += F.bassSal[f]; tot += F.bassSal[f]; }
      if (tot > 0) { same += Math.max(...h) / tot; nb++; }
    }
    scores[p] += nb ? (same / nb) * 3 : 0;
  }
  let phase = 0;
  for (let p = 1; p < 4; p++) if (scores[p] > scores[phase]) phase = p;
  beatsF = beatsF.slice(phase);
  // 小節の数（最後の小節は 4 拍そろうものまで）
  const bars = Math.max(1, Math.floor((beatsF.length - 1) / 4));
  // 1 拍より細かい位置（16 分）→ フレーム
  const P = (60 * FPS) / bpm;
  const swing = swingOf(nov, F.hat, beatsF);
  const beatFrame = (beat: number) => {
    const i = Math.floor(beat), f = swingWarp(beat - i, swing);
    const a = beatsF[i] ?? beatsF[beatsF.length - 1] + (i - beatsF.length + 1) * P;
    const b = beatsF[i + 1] ?? a + P;
    return a + (b - a) * f;
  };

  progress?.(0.75, '調とコードを調べています');
  const { barRms, feat } = barFeatures(F, beatFrame, bars);
  const { key, toC, shift, chords, chordNames, chordsHalf, chordQ } = harmonyOf(F, beatFrame, bars);
  const rMax = Math.max(...barRms, 1e-9), rMin = Math.min(...barRms);
  const energy = barRms.map((r) => (r - rMin) / (rMax - rMin + 1e-9));

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
  const bass = bassOf(F, beatFrame, bars, shift);

  progress?.(0.93, 'ドラムを聞き取っています');
  // ---- ドラム：16 分ごとに、帯域ごとの出だしが強い所 ----
  const drums = drumsOf(F, beatFrame, bars);

  progress?.(0.97, '曲の構成を調べています');
  const sections = sectionsOf(feat, energy);
  const beats = beatsF.slice(0, bars * 4 + 1).map((f) => (f * HOP + N / 2) / SR); // フレームの真ん中の時刻
  progress?.(1, 'できました');
  const pitch = Array.from(F.melody, (m, f) => (F.melSal[f] > voiceTh ? m : 0));
  return { duration, bpm: Math.round(bpm * 10) / 10, beats, offset: beats[0] ?? 0, bars, key, shift, chords, chordNames, melody, bass, drums, sections, energy, pitch, swing, chordsHalf, chordQ };
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

// ================= 2 回目：取り出したボーカルから、メロディを聞き取り直す =================
/**
 * 伴奏が混ざらないので、高さを正しく取りやすい。vocal = extractVocal の歌（22.05kHz）。
 * 拍・移調は 1 回目の解析（a）を使う。歌っている所がほとんど無ければ null（1 回目のままにする）
 */
/** 取り出した歌の、フレームごとの高さ（MIDI、0 = 歌っていない）と大きさ。analyze の pitch と同じ並び（もう一度歌を取り出すのに使える） */
export function vocalPitch(vocal: Float32Array, ratio = 2): { pitch: Float32Array; sal: Float32Array; rms: Float32Array; loud: number; hr: Float32Array } {
  const count = Math.max(1, Math.floor((vocal.length - N) / HOP) + 1);
  const fft = new FFT(N), mag = new Float32Array(N / 2 + 1), binHz = SR / N;
  const pitch = new Float32Array(count), sal = new Float32Array(count), rms = new Float32Array(count), hr = new Float32Array(count);
  const NM = 39, obs = new Float32Array(count * NM); // 高さの候補（MIDI 48〜86）ごとの目立ち度（フレームの一番を 1 に）
  for (let f = 0; f < count; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) e += vocal[off + i] * vocal[off + i];
    rms[f] = Math.sqrt(e / N);
    if (rms[f] < 1e-5) continue;
    fft.magnitudes(vocal, off, mag);
    let best = 0, bm = 0, top = 0;
    const row = new Float32Array(NM);
    for (let m = 48; m <= 86; m++) {
      let s = 0;
      for (let h = 1; h <= 6; h++) {
        const k = (midiHz(m) * h) / binHz;
        if (k >= N / 2 - 1) break;
        // 倍音の山は、ビブラート・すくい上げ・音の外れでずれる：まわり ±2%（±35 セント）でいちばん大きい所を使う
        const w = Math.max(1, k * 0.02);
        let v = 0;
        for (let j = Math.max(1, Math.floor(k - w)); j <= Math.min(N / 2, Math.ceil(k + w)); j++) if (mag[j] > v) v = mag[j];
        s += v * Math.pow(0.85, h - 1);
      }
      row[m - 48] = s; top = Math.max(top, s);
      // 低い方を少しひいきする（倍音を基音と取りちがえない）
      if (s > best * 1.08) { best = s; bm = m; }
    }
    for (let j = 0; j < NM; j++) obs[f * NM + j] = row[j] / (top + 1e-12);
    pitch[f] = bm; sal[f] = best;
    // 倍音らしさ：その高さの倍音の所に、全体の何割が集まっているか（歌なら高い。伴奏の残りは低い）。
    // 歌の高さは半音の間にもある（すくい上げ・ビブラート）ので、±60 セントの中で倍音がいちばんそろう細かい高さで数える
    let fine = midiHz(bm), fs = -1;
    for (let c = -60; c <= 60; c += 10) {
      const f = midiHz(bm) * Math.pow(2, c / 1200);
      let sc = 0;
      for (let h = 1; h <= 8; h++) { const k = (f * h) / binHz; if (k >= N / 2 - 1) break; sc += lin(mag, k); }
      if (sc > fs) { fs = sc; fine = f; }
    }
    let he = 0, te = 0;
    for (let k = Math.round(80 / binHz); k <= Math.round(5000 / binHz); k++) te += mag[k] * mag[k];
    for (let h = 1; h <= 10; h++) {
      const k = Math.round((fine * h) / binHz);
      if (k >= N / 2 - 1 || k * binHz > 5000) break;
      for (let j = k - 1; j <= k + 1; j++) he += mag[j] * mag[j];
    }
    hr[f] = he / (te + 1e-12);
  }
  // 高さのつながり（ビタビ）：歌の高さはなめらかにつながる。伴奏の残りが一瞬目立っても飛び移らない
  {
    const LAM = 0.3;
    const pen = new Float32Array(NM);
    for (let d = 0; d < NM; d++) pen[d] = d === 0 ? 0 : LAM * (0.3 + Math.min(d, 12) / 12);
    let dp = new Float32Array(NM), nd = new Float32Array(NM);
    const bk = new Uint8Array(count * NM);
    for (let f = 0; f < count; f++) {
      for (let j = 0; j < NM; j++) {
        let bv = -1e9, bi = j;
        for (let i = 0; i < NM; i++) { const v = dp[i] - pen[Math.abs(i - j)]; if (v > bv) { bv = v; bi = i; } }
        nd[j] = bv + obs[f * NM + j]; bk[f * NM + j] = bi;
      }
      let mx = -1e9; for (let j = 0; j < NM; j++) mx = Math.max(mx, nd[j]);
      for (let j = 0; j < NM; j++) nd[j] -= mx;
      [dp, nd] = [nd, dp];
    }
    let j = 0; for (let i = 1; i < NM; i++) if (dp[i] > dp[j]) j = i;
    for (let f = count - 1; f >= 0; f--) { if (pitch[f]) pitch[f] = 48 + j; j = bk[f * NM + j]; }
  }
  // 歌っているか：歌の大きさが、大きい所の 15% 以上
  const sorted = [...rms].sort((x, y) => x - y);
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  // 歌っているか：大きさ × 倍音らしさ（z）が、まわり数秒のいちばん小さい所（伴奏の残りの量）よりはっきり大きい所
  const z = Float32Array.from(rms, (r, f) => (r / (loud + 1e-12)) * hr[f]);
  const BL = Math.round(FPS), nb = Math.ceil(count / BL), blk = new Float32Array(nb);
  for (let b = 0; b < nb; b++) { const w = Array.from(z.subarray(b * BL, Math.min(count, (b + 1) * BL))).sort((x, y) => x - y); blk[b] = w[Math.floor(w.length * 0.2)] ?? 0; }
  const floorAt = (f: number) => { const b = Math.floor(f / BL); let m = Infinity; for (let j = Math.max(0, b - 3); j <= Math.min(nb - 1, b + 3); j++) m = Math.min(m, blk[j]); return m; };
  const voiced = (f: number) => z[f] > 0.08 && z[f] > floorAt(f) * ratio && pitch[f] > 0;
  // 高さのぶれをならす（前後 2 フレームの中央値）
  const smooth = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const w: number[] = [];
    for (let k = -2; k <= 2; k++) if (f + k >= 0 && f + k < count && voiced(f + k)) w.push(pitch[f + k]);
    w.sort((x, y) => x - y);
    smooth[f] = voiced(f) && w.length ? w[w.length >> 1] : 0;
  }
  return { pitch: smooth, sal, rms, loud, hr };
}

export function melodyFromVocal(vocal: Float32Array, a: CoverAnalysis): CoverNote[] | null {
  const { pitch: smooth, sal, rms, loud } = vocalPitch(vocal);
  if (loud <= 0) return null;
  const count = smooth.length;
  const beatFrame = gridOf(a);
  const slots: number[] = [];
  let voicedSlots = 0;
  for (let s = 0; s < a.bars * 16; s++) {
    const f0 = Math.round(beatFrame(s / 4)), f1 = Math.max(f0 + 1, Math.round(beatFrame((s + 1) / 4)));
    const votes = new Map<number, number>();
    let v = 0;
    for (let f = Math.max(0, f0); f < f1 && f < count; f++) if (smooth[f]) { v++; votes.set(smooth[f], (votes.get(smooth[f]) ?? 0) + sal[f]); }
    let m = 0, mv = 0;
    votes.forEach((x, k) => { if (x > mv) { mv = x; m = k; } });
    const on = v * 2 >= f1 - f0 ? m : 0;
    if (on) voicedSlots++;
    slots.push(on);
  }
  if (voicedSlots < a.bars) return null; // 歌がほとんど無い（インストの曲など）
  // 音の頭：枠の頭のすぐ前で歌の大きさがいったん下がり（息つぎ・音の切れ目）、そこからまた上がった所。
  // 同じ高さの音が続くときも、切れ目があれば別の音にする。切れ目は数十ミリ秒しかないので、約 6ms ごとの細かい大きさで見る
  const EH = 128, env = new Float32Array(Math.ceil(vocal.length / EH));
  for (let e = 0; e < env.length; e++) { let q = 0; const o0 = e * EH, o1 = Math.min(vocal.length, o0 + EH); for (let i = o0; i < o1; i++) q += vocal[i] * vocal[i]; env[e] = Math.sqrt(q / Math.max(1, o1 - o0)); }
  const DIP = 2.2, BACK = 0.045, FWD = 0.05;
  const onset = (s: number) => {
    const c = (beatFrame(s / 4) * HOP + N / 2) / EH; // 枠の頭の時刻（細かい大きさの番号）
    const b0 = Math.floor(c - (BACK * SR) / EH), b1 = Math.ceil(c + (0.01 * SR) / EH), f1 = Math.ceil(c + (FWD * SR) / EH);
    let lo = Infinity, hi = 0;
    for (let e = Math.max(0, b0); e <= Math.min(env.length - 1, b1); e++) lo = Math.min(lo, env[e]);
    for (let e = Math.max(0, Math.floor(c)); e <= Math.min(env.length - 1, f1); e++) hi = Math.max(hi, env[e]);
    return hi > lo * DIP && hi > loud * 0.2;
  };
  return notesFrom(slots, 0.25, onset, a.shift);
}

// ================= 小節ごとの特徴・調とコード（1 回目は曲から、2 回目は伴奏から） =================
type BeatFrame = (beat: number) => number;
function barFeatures(F: Frames, beatFrame: BeatFrame, bars: number): { barRms: number[]; feat: Float32Array[] } {
  const barRms: number[] = [], feat: Float32Array[] = [];
  for (let b = 0; b < bars; b++) {
    const f0 = Math.round(beatFrame(b * 4)), f1 = Math.round(beatFrame(b * 4 + 4));
    const c = new Float32Array(12);
    let r = 0, kk = 0, sn = 0, hh = 0;
    for (let f = Math.max(0, f0); f < Math.min(F.count, f1); f++) {
      for (let i = 0; i < 12; i++) c[i] += F.chroma[f][i];
      r += F.rms[f]; kk += F.kick[f]; sn += F.snare[f]; hh += F.hat[f];
    }
    const len = Math.max(1, f1 - f0);
    barRms.push(r / len);
    let cs = 0; for (const v of c) cs += v;
    feat.push(Float32Array.from([...c].map((v) => v / (cs + 1e-9)).concat([kk / len, sn / len, hh / len, (r / len) * 10])));
  }
  return { barRms, feat };
}

function harmonyOf(F: Frames, beatFrame: BeatFrame, bars: number) {
  // 小節ごとの 12 音・ベースの音（まだ移調しない）
  // 半小節（2 拍）ごとに集めて、小節はその合計
  const halfC: Float32Array[] = [], halfB: Float32Array[] = [];
  for (let h = 0; h < bars * 2; h++) {
    const f0 = Math.round(beatFrame(h * 2)), f1 = Math.round(beatFrame(h * 2 + 2));
    const c = new Float32Array(12), bc = new Float32Array(12);
    for (let f = Math.max(0, f0); f < Math.min(F.count, f1); f++) {
      for (let i = 0; i < 12; i++) c[i] += F.chroma[f][i];
      if (F.bass[f]) bc[F.bass[f] % 12] += F.bassSal[f];
    }
    halfC.push(c); halfB.push(bc);
  }
  const pairSum = (a: Float32Array[]) => Array.from({ length: bars }, (_, b) => Float32Array.from(a[b * 2], (v, i) => v + a[b * 2 + 1][i]));
  const rawC = pairSum(halfC), rawB = pairSum(halfB);
  /** 移調（toC 半音）した、コードを決めるための 12 音（ベースの音＝根音のことが多い、を少し重く） */
  const chordInput = (toC: number, C: ArrayLike<number>[] = rawC, B: ArrayLike<number>[] = rawB) => C.map((c, b) => {
    const bc = B[b];
    let cs = 0, bs = 0;
    for (let i = 0; i < 12; i++) { cs += c[i]; bs += bc[i]; }
    const out = new Float32Array(12);
    for (let i = 0; i < 12; i++) out[(i + toC) % 12] = c[i] / (cs + 1e-9) + (bc[i] / (bs + 1e-9)) * 0.35;
    return out;
  });
  // 調：どの調の 7 つの和音で小節ごとの響きをいちばんうまく説明できるか（12 通り）。
  // 長調と、同じ和音を使う短調（ハ長調とイ短調など）のどちらかは、曲全体の 12 音のプロファイルで決める
  const total = new Float32Array(12);
  for (let f = 0; f < F.count; f++) for (let i = 0; i < 12; i++) total[i] += F.chroma[f][i];
  let bestT = 0, bestFit = -1;
  for (let t = 0; t < 12; t++) {
    // 和音へのなじみ ＋ 調の 7 音に入っている割合（ハ長調とト長調のように、1 音だけちがう調を見分ける）
    const inp = chordInput((12 - t) % 12);
    let pure = 0;
    for (const c of inp) { let inK = 0, all = 0; for (let i = 0; i < 12; i++) { all += c[i]; if (MAJOR_SCALE.includes(i)) inK += c[i]; } pure += all > 0 ? inK / all : 0; }
    const fit = chordFit(inp) + pure;
    if (fit > bestFit) { bestFit = fit; bestT = t; }
  }
  // 調の外のコードがある曲：まず調を決めずにコードを読み、その並びがいちばん多く「調の 7 つの和音」に入る調にする。
  // （上の 12 音のなじみ方は、♭VII・III などで別の調に引っぱられることがある。それも少し足して、引き分けを決める）
  {
    const raw = chords24(chordInput(0, halfC, halfB), (i) => (i % 2 ? 0.16 : 0.06), 0);
    let best = -1;
    for (let t = 0; t < 12; t++) {
      // 調の 7 つの和音に入る割合 ＋ 主和音（I か vi）がどれだけ長く鳴っているか（曲はたいてい主和音のまわりを回る）
      let inK = 0, home = 0;
      for (const c of raw) {
        const d = diatonicDeg({ root: (c.root - t + 12) % 12, q: c.q });
        if (d >= 0) inK++;
        if (d === 0 || d === 5) home++;
      }
      inK += 0.6 * home;
      const inp = chordInput((12 - t) % 12);
      let pure = 0;
      for (const c of inp) { let a2 = 0, all = 0; for (let i = 0; i < 12; i++) { all += c[i]; if (MAJOR_SCALE.includes(i)) a2 += c[i]; } pure += all > 0 ? a2 / all : 0; }
      const sc = inK / Math.max(1, raw.length) + 0.6 * (chordFit(inp) + pure) / Math.max(1, inp.length);
      if (sc > best) { best = sc; bestT = t; }
    }
  }
  const prof = detectKey(total);
  const majC = corr(total, Array.from({ length: 12 }, (_, i) => MAJ[(i - bestT + 12) % 12]));
  const minT = (bestT + 9) % 12;
  const minC = corr(total, Array.from({ length: 12 }, (_, i) => MIN[(i - minT + 12) % 12]));
  const minor = minC > majC;
  const tonic = minor ? minT : bestT;
  const key = { tonic, minor, name: `${NOTE_NAMES[tonic]}${minor ? 'm' : ''}`, confidence: prof.confidence };
  const toC = (12 - bestT) % 12;
  const shift = toC > 6 ? toC - 12 : toC;
  // 半小節ごとに決める。小節の途中で変えるのは、小節の頭で変えるより粘る（はっきり別の和音に聞こえるときだけ）
  // 調の 7 つの和音を少しひいきして読み直す（調の外のコードは、はっきりそう聞こえるときだけ）
  const chordQ = chords24(chordInput(toC, halfC, halfB), (i) => (i % 2 ? 0.16 : 0.06), 0.03);
  const chordsHalf = chordQ.map(degreeOf);
  const chords = chords4(chordsHalf);
  const chordNames = chordQ.filter((_, i) => i % 2 === 0).map((c) => chordName(c, toC));
  return { key, toC, shift, chords, chordNames, chordsHalf, chordQ };
}

/** その時刻（フレーム）の前後 2 フレームの中でいちばん大きい値 */
const peakNear = (arr: Float32Array, t: number) => { let m = 0; for (let k = -2; k <= 2; k++) m = Math.max(m, arr[Math.round(t) + k] ?? 0); return m; };

/** ベース：8 分ごとに、目立つ低い音の名前の多数決（音の頭は低い音の出だし）。高さは 36（C2）〜47 にそろえる */
function bassOf(F: Frames, beatFrame: BeatFrame, bars: number, shift: number): CoverNote[] {
  const bsSorted = [...F.bassSal].sort((a, b) => a - b);
  const bassTh = bsSorted[Math.floor(bsSorted.length * 0.35)] ?? 0;
  const bassSlots: number[] = [];
  for (let s = 0; s < bars * 8; s++) {
    const f0 = Math.round(beatFrame(s / 2)), f1 = Math.max(f0 + 1, Math.round(beatFrame((s + 1) / 2)));
    const votes = new Map<number, number>();
    for (let f = f0; f < f1 && f < F.count; f++) if (F.bassSal[f] > bassTh) votes.set(F.bass[f] % 12, (votes.get(F.bass[f] % 12) ?? 0) + F.bassSal[f]);
    let m = -1, mv = 0;
    votes.forEach((v, k) => { if (v > mv) { mv = v; m = k; } });
    bassSlots.push(m < 0 ? 0 : 36 + m);
  }
  return notesFrom(bassSlots, 0.5, (s) => peakNear(F.kick, beatFrame(s / 2)) > 0.3, shift).map((n) => ({ ...n, midi: 36 + (((n.midi - 36) % 12) + 12) % 12 }));
}

/** ドラム：16 分ごとに、帯域ごとの出だし（キック 40〜130Hz・スネア・ハット）が強い所 */
function drumsOf(F: Frames, beatFrame: BeatFrame, bars: number): CoverDrumBar[] {
  const thOf = (arr: Float32Array) => { const s = [...arr].sort((a, b) => a - b); return Math.max(s[Math.floor(s.length * 0.9)] * 0.6, 1e-6); };
  const kTh = thOf(F.kick), sTh = thOf(F.snare), hTh = thOf(F.hat);
  const drums: CoverDrumBar[] = [];
  for (let b = 0; b < bars; b++) {
    let k = '', sn = '', h = '';
    for (let s = 0; s < 16; s++) {
      const fr = beatFrame(b * 4 + s / 4);
      k += peakNear(F.kick, fr) > kTh ? 'x' : '.';
      sn += peakNear(F.snare, fr) > sTh ? 'x' : '.';
      h += peakNear(F.hat, fr) > hTh ? 'x' : '.';
    }
    drums.push({ kick: k, snare: sn, hat: h });
  }
  return drums;
}

/**
 * ドラムだけの音 → キック・スネア・ハット（NMF）。音を 48 の帯域の大きさの並びにして、
 * 「キック（低い）・スネア（真ん中に広い）・ハット（高い）の 3 つの音色 × いつどれだけ鳴ったか」に分ける。
 * 音色は最初に形を決めておき、曲に合わせて少し直す。鳴った量が急に増えた所が打音
 */
function drumsNmf(x: Float32Array, beatFrame: BeatFrame, bars: number): CoverDrumBar[] {
  const NF = 1024, HP = 256, NB = 48, R = 3;
  const fft = new FFT(NF), mag = new Float32Array(NF / 2 + 1), binHz = SR / NF;
  const T = Math.max(1, Math.floor((x.length - NF) / HP) + 1);
  // 帯域の境目：30Hz〜11kHz を対数で 48 に
  const edges = Array.from({ length: NB + 1 }, (_, b) => 30 * Math.pow(11000 / 30, b / NB));
  const bandOf = new Int16Array(NF / 2 + 1).fill(-1);
  for (let k = 0; k <= NF / 2; k++) { const f = k * binHz; for (let b = 0; b < NB; b++) if (f >= edges[b] && f < edges[b + 1]) { bandOf[k] = b; break; } }
  const V = new Float32Array(T * NB);
  for (let t = 0; t < T; t++) {
    fft.magnitudes(x, t * HP, mag);
    for (let k = 0; k <= NF / 2; k++) { const b = bandOf[k]; if (b >= 0) V[t * NB + b] += mag[k] * mag[k]; }
    for (let b = 0; b < NB; b++) V[t * NB + b] = Math.sqrt(V[t * NB + b]);
  }
  // 音色の最初の形（帯域の中心の Hz で）
  const W = new Float32Array(NB * R);
  for (let b = 0; b < NB; b++) {
    const f = Math.sqrt(edges[b] * edges[b + 1]), lf = Math.log2(f);
    W[b * R + 0] = Math.exp(-0.5 * ((lf - Math.log2(65)) / 0.7) ** 2);
    W[b * R + 1] = Math.exp(-0.5 * ((lf - Math.log2(1500)) / 1.6) ** 2) + 0.6 * Math.exp(-0.5 * ((lf - Math.log2(200)) / 0.4) ** 2);
    W[b * R + 2] = Math.exp(-0.5 * ((lf - Math.log2(9000)) / 0.6) ** 2);
  }
  const H = new Float32Array(T * R).fill(0.1);
  const WH = new Float32Array(T * NB);
  const recon = () => { for (let t = 0; t < T; t++) for (let b = 0; b < NB; b++) { let v = 1e-9; for (let r = 0; r < R; r++) v += W[b * R + r] * H[t * R + r]; WH[t * NB + b] = v; } };
  // KL の掛け算の更新（H は 40 回、W は後半の 15 回だけ少し）
  for (let it = 0; it < 40; it++) {
    recon();
    for (let r = 0; r < R; r++) {
      let ws = 1e-9; for (let b = 0; b < NB; b++) ws += W[b * R + r];
      for (let t = 0; t < T; t++) { let a = 0; for (let b = 0; b < NB; b++) a += W[b * R + r] * V[t * NB + b] / WH[t * NB + b]; H[t * R + r] *= a / ws; }
    }
    if (it >= 25) {
      recon();
      for (let r = 0; r < R; r++) {
        let hs = 1e-9; for (let t = 0; t < T; t++) hs += H[t * R + r];
        for (let b = 0; b < NB; b++) { let a = 0; for (let t = 0; t < T; t++) a += H[t * R + r] * V[t * NB + b] / WH[t * NB + b]; W[b * R + r] *= a / hs; }
      }
    }
  }
  // 鳴った量の増え方 → 16 分の枠ごとの強さ → しきい値（その音色の強い所の何割か）
  const slotFrame = (s: number) => ((beatFrame(s / 4) * HOP + N / 2) - NF / 2) / HP;
  const parts = [0, 1, 2].map((r) => {
    const on = new Float32Array(T);
    for (let t = 1; t < T; t++) on[t] = Math.max(0, H[t * R + r] - H[(t - 1) * R + r]);
    const val = (s: number) => { const c = Math.round(slotFrame(s)); let m = 0; for (let d = -3; d <= 3; d++) m = Math.max(m, on[c + d] ?? 0); return m; };
    const vs: number[] = [];
    for (let s = 0; s < bars * 16; s++) vs.push(val(s));
    const sorted = [...vs].sort((p, q) => p - q);
    const top = sorted[Math.floor(sorted.length * 0.97)] ?? 0;
    // キックは強い所の 3 割、スネアは 5 割（ほかの楽器のにじみが乗りやすい）
    let th = Math.max(top * (r === 1 ? 0.5 : 0.3), 1e-9);
    if (r === 2) {
      // ハット：鳴っていない所はほぼ 0 なので、対数で「鳴った・鳴っていない」の切れ目を探す（強い所の 4〜30% の間で）
      const lv = sorted.map((v) => Math.log(v + top * 1e-3)), n = lv.length, tot = lv.reduce((x, y) => x + y, 0);
      let best = -1, cut = th, sum = 0;
      for (let i = 1; i < n; i++) { sum += lv[i - 1]; const w0 = i / n, m0 = sum / i, m1 = (tot - sum) / (n - i), bv = w0 * (1 - w0) * (m0 - m1) ** 2; if (bv > best) { best = bv; cut = Math.exp((lv[i - 1] + lv[i]) / 2) - top * 1e-3; } }
      th = Math.min(top * 0.3, Math.max(top * 0.04, cut));
    }
    return { vs, th };
  });
  // キックの頭にはスネアの帯域の音も少し出るので、キックと同じ枠のスネアは、はっきり強いときだけ
  const SC = 2;
  const marks = parts.map(({ vs, th }, r) => vs.map((v, s) => (v > th * (r === 1 && parts[0].vs[s] > parts[0].th ? SC : 1) ? 'x' : '.')));
  const out: CoverDrumBar[] = [];
  for (let b = 0; b < bars; b++) out.push({ kick: marks[0].slice(b * 16, b * 16 + 16).join(''), snare: marks[1].slice(b * 16, b * 16 + 16).join(''), hat: marks[2].slice(b * 16, b * 16 + 16).join('') });
  return out;
}

/**
 * 楽器ごとに分けた音（ドラムだけ・ベースだけ）から、ドラムとベースを聞き取り直す。
 * ほかの楽器・歌に邪魔されないので正しく取りやすい（refineHarmony の後で呼ぶ：ベースの移調をそろえるため）
 */
export function refineStems(st: { drums?: Float32Array; bass?: Float32Array }, a: CoverAnalysis): void {
  const grid = gridOf(a);
  const loud = (x: Float32Array) => { let e = 0; for (let i = 0; i < x.length; i += 7) e += x[i] * x[i]; return e / (x.length / 7) > 1e-8; };
  if (st.drums && loud(st.drums)) a.drums = drumsNmf(st.drums, grid, a.bars);
  if (st.bass && loud(st.bass)) a.bass = bassOf(frames(st.bass), grid, a.bars, a.shift);
}

/** 拍（秒）→ フレーム（窓の真ん中の時刻にそろえる）の格子 */
function gridOf(a: CoverAnalysis): BeatFrame {
  const bf = a.beats.map((t) => (t * SR - N / 2) / HOP);
  const P = bf.length > 1 ? bf[1] - bf[0] : FPS / 2;
  return (beat: number) => {
    const i = Math.floor(beat), fr = swingWarp(beat - i, a.swing ?? 0);
    const x = bf[i] ?? bf[bf.length - 1] + (i - bf.length + 1) * P;
    const y = bf[i + 1] ?? x + P;
    return x + (y - x) * fr;
  };
}

/**
 * 2 回目：取り出した伴奏（歌を抜いたもの）から、調とコードを決め直す。
 * 歌の倍音（とくに 5 度上）に引っぱられないので、コードが正しく取りやすい。調が変われば、メロディ・ベースの移調も直す
 */
export function refineHarmony(inst: Float32Array, a: CoverAnalysis): void {
  let e = 0;
  for (let i = 0; i < inst.length; i += 7) e += inst[i] * inst[i];
  if (e / (inst.length / 7) < 1e-7) return; // 伴奏がほとんど無い（アカペラなど）
  const F = frames(inst);
  const h = harmonyOf(F, gridOf(a), a.bars);
  const d = h.shift - a.shift;
  a.key = h.key; a.shift = h.shift; a.chords = h.chords; a.chordNames = h.chordNames; a.chordsHalf = h.chordsHalf; a.chordQ = h.chordQ;
  if (d) { for (const n of a.melody) n.midi += d; for (const n of a.bass) n.midi = 36 + (((n.midi + d - 36) % 12) + 12) % 12; }
}
