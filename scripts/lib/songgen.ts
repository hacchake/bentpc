// 解析・ボーカル分離の物差し用：本物の曲に近い「答えのわかる曲」を作る（ステレオ・44.1kHz）。
// 歌（フォルマントの声・ビブラート・ときどき半音）・ピアノ（右）・ギター（左・はじく）・パッド・ベース・ドラム（ハット付き）・残響。
// 調・テンポ・ハネ・小節の途中のコードチェンジ・歌の位置を変えられる。答え（テンポ・小節の頭・調・コード・メロディ・歌だけの音）も返す。
import { Rng } from '../../src/core/rng';

export interface GenOpts {
  seed: number;
  bpm: number;
  /** 主音（0 = C）と短調か */
  tonic: number;
  minor?: boolean;
  bars: number;
  /** ハネ：8 分の裏を 8 分の何割遅らせるか（0〜0.33） */
  swing?: number;
  /** 半小節ごとにコードが変わる小節を入れる */
  halfChords?: boolean;
  /** 歌の左右（0 = 真ん中） */
  vocalPan?: number;
  /** 残響の量 0〜1 */
  reverb?: number;
  /** 頭の無音（秒） */
  lead?: number;
  /** 人が弾いたような揺れ：テンポがゆっくり ±drift 揺れ、音ごとに少しずれる（0〜0.05） */
  drift?: number;
}

export interface GenTruth {
  bpm: number;
  offset: number;
  /** ハ長調（短調はイ短調）に移すときの半音 */
  shift: number;
  /** 半小節ごとの度数（ハ長調に移した値。0 = C … 5 = Am） */
  chordsHalf: number[];
  /** メロディ（拍は最初の小節の頭が 0。midi は元の調） */
  melody: { t: number; len: number; midi: number }[];
  swing: number;
}

const SR = 44100;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** はじく音（カープラス・ストロング） */
function pluck(r: Rng, hz: number, n: number, decay: number): Float32Array {
  const y = new Float32Array(n), P = SR / hz, D = P - 0.5, g = Math.exp(-1 / (decay * hz));
  for (let i = 0; i < Math.min(n, Math.ceil(P)); i++) y[i] = r.bi();
  let lp = 0;
  for (let i = Math.ceil(P); i < n; i++) {
    const t = i - D, i0 = Math.floor(t), f = t - i0;
    const a = (y[i0] ?? 0) * (1 - f) + (y[i0 + 1] ?? 0) * f, b = (y[i0 - 1] ?? 0) * (1 - f) + (y[i0] ?? 0) * f;
    lp += 0.7 * ((a + b) / 2 - lp);
    y[i] += lp * g;
  }
  return y;
}

export function genSong(o: GenOpts): { L: Float32Array; R: Float32Array; vocal: Float32Array; sr: number; truth: GenTruth } {
  const r = new Rng(o.seed);
  const beat = 60 / o.bpm, lead = o.lead ?? 0.3, swing = o.swing ?? 0;
  const n = Math.round((lead + o.bars * 4 * beat + 2) * SR);
  const L = new Float32Array(n), R = new Float32Array(n), V = new Float32Array(n);
  /** 拍 → 秒（ハネ：8 分の裏を遅らせる） */
  const drift = o.drift ?? 0;
  const tOf = (b: number) => {
    const q = Math.floor(b), f = b - q; const sw = Math.abs(f - 0.5) < 1e-6 ? swing * 0.5 : 0;
    const x = q + f + sw;
    // テンポの揺れ（32 拍で一回り）と、音ごとの小さなずれ（±8ms くらい）
    const wob = drift ? ((drift * 32) / (2 * Math.PI)) * Math.sin((2 * Math.PI * x) / 32) : 0;
    const jit = drift ? Math.sin(x * 12.9898 + 78.233) * 0.008 : 0;
    return lead + (x + wob) * beat + jit;
  };
  const put = (buf: Float32Array, at: number, x: Float32Array, g: number) => { const o2 = Math.round(at * SR); for (let i = 0; i < x.length && o2 + i < n; i++) buf[o2 + i] += x[i] * g; };
  const pan = (at: number, x: Float32Array, g: number, p: number) => { put(L, at, x, g * Math.cos(((p + 1) * Math.PI) / 4) * Math.SQRT2); put(R, at, x, g * Math.sin(((p + 1) * Math.PI) / 4) * Math.SQRT2); };
  // ---- コード（ハ長調の度数で作って、主音へ移す） ----
  const progs = o.minor ? [[5, 3, 0, 4], [5, 1, 4, 5], [5, 0, 3, 4]] : [[0, 5, 3, 4], [0, 4, 5, 3], [3, 4, 0, 5], [1, 4, 0, 0]];
  const prog = r.pick(progs);
  const toTonic = (o.tonic - (o.minor ? 9 : 0) + 12) % 12; // ハ長調 → この調
  const chordsHalf: number[] = [];
  for (let b = 0; b < o.bars; b++) {
    const d = prog[b % 4];
    const split = o.halfChords && b % 2 === 1;
    chordsHalf.push(d, split ? prog[(b + 1) % 4] === d ? (d + 3) % 7 : prog[(b + 1) % 4] : d);
  }
  const tri = (deg: number, base: number) => [0, 2, 4].map((k) => { const d = deg + k; return base + MAJOR[d % 7] + 12 * Math.floor(d / 7) + toTonic; });
  // ---- 伴奏 ----
  for (let b = 0; b < o.bars; b++) {
    for (const half of [0, 1]) {
      const deg = chordsHalf[b * 2 + half];
      const t0 = b * 4 + half * 2;
      // ピアノ（右）：倍音つき、2 拍
      for (const m of tri(deg, 48)) {
        const x = new Float32Array(Math.round(2 * beat * SR)), f = midiHz(m);
        for (let i = 0; i < x.length; i++) { let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin((2 * Math.PI * f * h * i) / SR) * Math.pow(h, -1.4) * Math.exp((-i / SR) * (1.2 + h * 0.6)); x[i] = v * Math.min(1, i / 60); }
        pan(tOf(t0), x, 0.07, 0.45);
      }
      // ギター（左）：8 分で刻む
      for (let e = 0; e < 4; e++) for (const m of tri(deg, 52)) pan(tOf(t0 + e * 0.5) + 0.004 * m % 0.01, pluck(r, midiHz(m), Math.round(beat * 0.5 * SR), 0.35), 0.06, -0.5);
      // パッド（真ん中・小さく）
      for (const m of tri(deg, 60)) {
        const x = new Float32Array(Math.round(2 * beat * SR)), f = midiHz(m);
        for (let i = 0; i < x.length; i++) x[i] = (Math.sin((2 * Math.PI * f * i) / SR) + 0.3 * Math.sin((4 * Math.PI * f * i) / SR)) * Math.min(1, i / (SR * 0.1), (x.length - i) / (SR * 0.1));
        pan(tOf(t0), x, 0.02, 0);
      }
      // ベース：根音を 8 分
      const root = 36 + MAJOR[deg % 7] + toTonic - (MAJOR[deg % 7] + toTonic >= 8 ? 12 : 0);
      for (let e = 0; e < 4; e++) { const x = pluck(r, midiHz(root), Math.round(beat * 0.48 * SR), 0.6); pan(tOf(t0 + e * 0.5), x, 0.25, 0); }
    }
    // ドラム
    const t0 = b * 4;
    const kick = new Float32Array(Math.round(0.3 * SR)); for (let i = 0; i < kick.length; i++) kick[i] = Math.sin(2 * Math.PI * (52 * i / SR + 1.6 * (1 - Math.exp(-i / (SR * 0.02))))) * Math.pow(1 - i / kick.length, 2);
    for (const q of [0, 2, ...(b % 2 ? [2.5] : [])]) pan(tOf(t0 + q), kick, 0.75, 0);
    for (const q of [1, 3]) { const sn = new Float32Array(Math.round(0.2 * SR)); for (let i = 0; i < sn.length; i++) sn[i] = r.bi() * Math.pow(1 - i / sn.length, 3) + Math.sin((2 * Math.PI * 190 * i) / SR) * Math.exp(-i / (SR * 0.03)) * 0.5; pan(tOf(t0 + q), sn, 0.35, 0.1); }
    for (let e = 0; e < 8; e++) { const hh = new Float32Array(Math.round(0.05 * SR)); let hp = 0; for (let i = 0; i < hh.length; i++) { const w = r.bi(); hh[i] = (w - hp) * Math.pow(1 - i / hh.length, 2); hp = w; } pan(tOf(t0 + e * 0.5), hh, e % 2 ? 0.1 : 0.14, 0.3); }
  }
  // ---- 歌：コードの音を中心に、ときどき経過音・半音。4 分と 8 分、ときどき休み ----
  const melody: GenTruth['melody'] = [];
  let pitch = 64 + toTonic;
  for (let b = 0; b < o.bars; b++) {
    if (b % 8 === 7) continue; // 8 小節ごとに 1 小節休む
    let q = 0;
    while (q < 4) {
      const len = r.pick([0.5, 1, 1, 1.5, 2]);
      const deg = chordsHalf[b * 2 + (q >= 2 ? 1 : 0)];
      const tones = tri(deg, 60).flatMap((m) => [m, m + 12]);
      let m = tones.reduce((x, y) => (Math.abs(y - pitch) < Math.abs(x - pitch) ? y : x));
      if (r.chance(0.25)) m += r.pick([1, 2, -1, -2]); // 経過音（ときどき半音）
      m = Math.max(57 + toTonic % 12, Math.min(79, m));
      pitch = m;
      if (!r.chance(0.12)) melody.push({ t: b * 4 + q, len: Math.min(len, 4 - q) * 0.92, midi: m });
      q += len;
    }
  }
  // 声：のこぎり波の声帯 → 3 つの口の形（母音を音ごとに変える）
  const VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410]];
  for (const nn of melody) {
    const t = tOf(nn.t), dur = nn.len * beat, len = Math.round(dur * SR), f0 = midiHz(nn.midi);
    const src = new Float32Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) { const s = i / SR; const f = f0 * (1 + 0.015 * Math.sin(2 * Math.PI * 5.4 * s) * Math.min(1, s * 3)); ph = (ph + f / SR) % 1; src[i] = (ph * 2 - 1) + r.bi() * 0.04; }
    const vw = r.pick(VOWELS), out = new Float32Array(len);
    vw.forEach((fc, j) => {
      const w = (2 * Math.PI * fc) / SR, al = Math.sin(w) / (2 * 8), c = Math.cos(w), a0 = 1 + al;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < len; i++) { const y = (al * src[i] - al * x2 + 2 * c * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = src[i]; y2 = y1; y1 = y; out[i] += y * [1, 0.7, 0.35][j]; }
    });
    for (let i = 0; i < len; i++) out[i] *= Math.min(1, i / (SR * 0.04)) * Math.min(1, (len - i) / (SR * 0.06)) * 0.5;
    put(V, t, out, 1);
  }
  // 歌を置く（左右）＋残響（左右で違う遅れのくし形）
  const vp = o.vocalPan ?? 0, rv = o.reverb ?? 0.2;
  for (let i = 0; i < n; i++) { L[i] += V[i] * Math.cos(((vp + 1) * Math.PI) / 4) * Math.SQRT2; R[i] += V[i] * Math.sin(((vp + 1) * Math.PI) / 4) * Math.SQRT2; }
  if (rv > 0) for (const [buf, ds] of [[L, [1557, 1617, 1491]], [R, [1422, 1356, 1277]]] as const) {
    const wet = new Float32Array(n);
    for (const d of ds) { const b2 = new Float32Array(n); for (let i = 0; i < n; i++) { b2[i] = (V[i] + (L[i] + R[i]) * 0.15) + (i >= d ? b2[i - d] * 0.78 : 0); wet[i] += b2[i] * 0.33; } }
    for (let i = 0; i < n; i++) buf[i] += wet[i] * rv * 0.25;
  }
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.9 / pk;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; V[i] *= g; }
  const shiftRaw = ((o.minor ? 9 : 0) - o.tonic + 12) % 12;
  return { L, R, vocal: V, sr: SR, truth: { bpm: o.bpm, offset: lead, shift: shiftRaw > 6 ? shiftRaw - 12 : shiftRaw, chordsHalf, melody, swing } };
}
