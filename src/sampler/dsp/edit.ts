// 音の編集（DOM 非依存）：ノーマライズ・逆転・切り詰め・チョップ（等分／立ち上がりで自動）・
// タイムストレッチ（音程はそのまま長さだけ変える・WSOLA）・BPM の推定。
import type { SampleBuf } from './types';

const frames = (s: SampleBuf) => s.ch[0].length;

/** いちばん大きい所を 0.98 にそろえる */
export function normalize(s: SampleBuf): SampleBuf {
  let m = 0;
  for (const c of s.ch) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  if (m < 1e-6) return s;
  const g = 0.98 / m;
  return { sr: s.sr, ch: s.ch.map((c) => c.map((v) => v * g)) };
}

export function reverse(s: SampleBuf): SampleBuf {
  return { sr: s.sr, ch: s.ch.map((c) => c.slice().reverse()) };
}

/** a〜b（0〜1）だけ残す。端は 2ms でなめらかに */
export function trim(s: SampleBuf, a: number, b: number): SampleBuf {
  const n = frames(s);
  const i0 = Math.floor(Math.max(0, Math.min(a, b)) * n), i1 = Math.ceil(Math.min(1, Math.max(a, b)) * n);
  return fadeEdges({ sr: s.sr, ch: s.ch.map((c) => c.slice(i0, Math.max(i0 + 2, i1))) });
}

function fadeEdges(s: SampleBuf, sec = 0.002): SampleBuf {
  const f = Math.min(Math.round(sec * s.sr), Math.floor(frames(s) / 2));
  for (const c of s.ch) for (let i = 0; i < f; i++) { const g = i / f; c[i] *= g; c[c.length - 1 - i] *= g; }
  return s;
}

/** 等分の切れ目（0〜1）。両端は入れない */
export function equalMarks(n: number): number[] {
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

/** 音の立ち上がり（アタック）を見つけて切れ目にする。sens 0〜1（大きいほど細かく）、最大 max-1 か所 */
export function onsetMarks(s: SampleBuf, sens: number, max = 16): number[] {
  const x = s.ch[0], n = x.length;
  const hop = Math.max(64, Math.round(s.sr * 0.005));
  const env: number[] = [];
  for (let i = 0; i < n; i += hop) {
    let e = 0;
    for (let k = i; k < Math.min(n, i + hop); k++) for (const c of s.ch) e += c[k] * c[k];
    env.push(Math.log10(1e-6 + e / hop));
  }
  // 増え方（今 − 少し前の平均）
  const flux = env.map((v, i) => Math.max(0, v - Math.max(...env.slice(Math.max(0, i - 4), i).concat([-6]))));
  const sorted = [...flux].sort((a, b) => b - a);
  const th = Math.max(0.15, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (0.02 + 0.2 * sens)))] ?? 0.3) * (1.6 - sens);
  const minGap = Math.round((s.sr * (0.09 - 0.06 * sens)) / hop);
  const peaks: { i: number; v: number }[] = [];
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] >= th && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) {
      const last = peaks[peaks.length - 1];
      if (last && i - last.i < minGap) { if (flux[i] > last.v) peaks[peaks.length - 1] = { i, v: flux[i] }; }
      else peaks.push({ i, v: flux[i] });
    }
  }
  // 強い順に max-1 個まで、頭の近くは除く
  const marks = peaks
    .filter((p) => p.i * hop > s.sr * 0.02 && p.i * hop < n - s.sr * 0.02)
    .sort((a, b) => b.v - a.v).slice(0, max - 1)
    .map((p) => Math.max(0, p.i * hop - Math.round(hop / 2)) / n)
    .sort((a, b) => a - b);
  return marks;
}

/** 切れ目で切り分ける（それぞれ端をなめらかに） */
export function slice(s: SampleBuf, marks: number[]): SampleBuf[] {
  const n = frames(s);
  const pts = [0, ...marks.filter((m) => m > 0 && m < 1).sort((a, b) => a - b), 1];
  const out: SampleBuf[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = Math.floor(pts[i] * n), b = Math.floor(pts[i + 1] * n);
    if (b - a < 32) continue;
    out.push(fadeEdges({ sr: s.sr, ch: s.ch.map((c) => c.slice(a, b)) }, 0.0015));
  }
  return out;
}

/**
 * タイムストレッチ（WSOLA）：音程はそのまま、長さを ratio 倍にする（2 = 2 倍の長さ = ゆっくり）。
 * 窓をずらしながら、いちばん形の合う場所を探してつなぐ。左右は同じずれで動かす。
 */
export function stretch(s: SampleBuf, ratio: number): SampleBuf {
  ratio = Math.max(0.25, Math.min(4, ratio));
  const n = frames(s);
  const W = Math.round(s.sr * 0.04) & ~1; // 窓 40ms
  const H = W / 2;
  const tol = Math.round(s.sr * 0.008);
  const outLen = Math.round(n * ratio);
  const mono = s.ch.length > 1 ? s.ch[0].map((v, i) => (v + s.ch[1][i]) / 2) : s.ch[0];
  const out = s.ch.map(() => new Float32Array(outLen + W));
  const norm = new Float32Array(outLen + W);
  const win = new Float32Array(W);
  for (let i = 0; i < W; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W);
  let prevIn = 0; // 前の窓の読み始め
  for (let o = 0; o < outLen; o += H) {
    const target = Math.round(o / ratio);
    let best = Math.max(0, Math.min(n - W, target));
    if (o > 0) {
      // 前の窓の続き（prevIn + H）と形がいちばん合う場所を target のまわりで探す
      const nat = prevIn + H;
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const c = target + d;
        if (c < 0 || c + W > n || nat + H > n) continue;
        let sc = 0;
        for (let k = 0; k < H; k += 4) sc += mono[nat + k] * mono[c + k];
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
    }
    prevIn = best;
    for (let k = 0; k < W && best + k < n; k++) {
      const w = win[k];
      for (let c = 0; c < s.ch.length; c++) out[c][o + k] += s.ch[c][best + k] * w;
      norm[o + k] += w;
    }
  }
  for (let c = 0; c < out.length; c++) for (let i = 0; i < outLen; i++) out[c][i] /= Math.max(1e-3, norm[i]);
  return fadeEdges({ sr: s.sr, ch: out.map((c) => c.slice(0, outLen)) });
}

/** BPM を推定：立ち上がりのくり返し（自己相関）と、長さが小節のきりのいい数になることから */
export function estimateBpm(s: SampleBuf): number {
  const len = frames(s) / s.sr;
  const hop = Math.round(s.sr * 0.01);
  const x = s.ch[0];
  const env: number[] = [];
  let prev = 0;
  for (let i = 0; i < x.length; i += hop) {
    let e = 0;
    for (let k = i; k < Math.min(x.length, i + hop); k++) e += x[k] * x[k];
    const v = Math.log10(1e-6 + e);
    env.push(Math.max(0, v - prev));
    prev = v;
  }
  // 70〜180 BPM の範囲で自己相関がいちばん大きい周期
  let best = 0, bestBpm = 120;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = Math.round(60 / bpm / 0.01);
    let sc = 0;
    for (let i = lag; i < env.length; i++) sc += env[i] * env[i - lag];
    sc /= Math.max(1, env.length - lag);
    if (sc > best) { best = sc; bestBpm = bpm; }
  }
  // 長さが 1・2・4・8・16 小節になる BPM のうち、推定に近いもの（ループならこちらが正確）
  const cands = [1, 2, 4, 8, 16].map((bars) => (bars * 4 * 60) / len).filter((b) => b >= 60 && b <= 200);
  const near = cands.sort((a, b) => Math.abs(a - bestBpm) - Math.abs(b - bestBpm))[0];
  if (near !== undefined && Math.abs(near - bestBpm) / bestBpm < 0.08) return Math.round(near * 10) / 10;
  return best > 0 ? bestBpm : near ?? 120;
}
