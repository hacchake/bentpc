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
  /** 調の外のコードを混ぜる（III・II の長三和音、iv の短三和音、♭VII・♭VI） */
  chromatic?: boolean;
  /** 本物らしい歌い方：音の頭で下からすくい上げる・音ごとに少し外れる・ビブラートがまちまち・子音と息の音 */
  realVoice?: boolean;
  /** 伴奏を厚く：真ん中で鳴るシンセのアルペジオ（歌と同じくらいの高さ）・8 小節ごとのシンバル */
  dense?: boolean;
  /** 歌の大きさ（1 = ふつう） */
  vocalGain?: number;
  /** 人が弾いたような揺れ：テンポがゆっくり ±drift 揺れ、音ごとに少しずれる（0〜0.05） */
  drift?: number;
}

export interface GenTruth {
  bpm: number;
  offset: number;
  /** ハ長調（短調はイ短調）に移すときの半音 */
  shift: number;
  /** 半小節ごとの度数（ハ長調に移した値。0 = C … 5 = Am）。調の外のコードは、根音の近い度数 */
  chordsHalf: number[];
  /** 半小節ごとのコード（ハ長調に移した根音 0〜11 と、長・短・減） */
  chordQ: { root: number; q: 'maj' | 'min' | 'dim' }[];
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

export function genSong(o: GenOpts): { L: Float32Array; R: Float32Array; vocal: Float32Array; sr: number; truth: GenTruth; stems: Record<string, Float32Array> } {
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
  /** 楽器ごとの音（左右の平均。どの楽器がボーカルに混ざったかを調べる用） */
  const stems: Record<string, Float32Array> = {};
  let cur = 'piano';
  const put = (buf: Float32Array, at: number, x: Float32Array, g: number) => { const o2 = Math.round(at * SR); for (let i = 0; i < x.length && o2 + i < n; i++) buf[o2 + i] += x[i] * g; };
  const pan = (at: number, x: Float32Array, g: number, p: number) => {
    const gl = g * Math.cos(((p + 1) * Math.PI) / 4) * Math.SQRT2, gr = g * Math.sin(((p + 1) * Math.PI) / 4) * Math.SQRT2;
    put(L, at, x, gl); put(R, at, x, gr); put((stems[cur] ??= new Float32Array(n)), at, x, (gl + gr) / 2);
  };
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
  // コードの音（ハ長調に移した音名 0〜11）。ふつうは度数の三和音、chromatic なら調の外の和音に替える（別の乱数で。ほかの音は変わらない）
  const degPcs = (d: number) => [0, 2, 4].map((k) => MAJOR[(d + k) % 7]);
  const pcsHalf = chordsHalf.map(degPcs);
  if (o.chromatic) {
    const rc = new Rng(o.seed * 7919 + 13);
    const SUBS: Record<number, number[][]> = o.minor
      ? { 4: [[4, 8, 11]], 3: [[5, 8, 0]], 1: [[2, 6, 9]] } // 短調：V（E）・iv（Dm→F の代わりに Fm…）
      : { 2: [[4, 8, 11]], 1: [[2, 6, 9]], 3: [[5, 8, 0]], 4: [[10, 2, 5]], 5: [[8, 0, 3], [9, 1, 4]] };
    for (let i = 0; i < pcsHalf.length; i += 2) {
      const d = chordsHalf[i], sub = SUBS[d];
      if (!sub || !rc.chance(0.45)) continue;
      const pick = sub[rc.int(sub.length)];
      pcsHalf[i] = pick;
      if (chordsHalf[i + 1] === d) pcsHalf[i + 1] = pick;
    }
  }
  const qOf = (p: number[]) => { const a = (p[1] - p[0] + 12) % 12, b = (p[2] - p[0] + 12) % 12; return a === 4 ? 'maj' : b === 6 ? 'dim' : 'min'; };
  const chordQ = pcsHalf.map((p) => ({ root: p[0], q: qOf(p) as 'maj' | 'min' | 'dim' }));
  const triP = (p: number[], base: number) => { const m0 = base + p[0] + toTonic; return [m0, m0 + ((p[1] - p[0] + 12) % 12), m0 + ((p[2] - p[0] + 12) % 12)]; };
  // ---- 伴奏 ----
  for (let b = 0; b < o.bars; b++) {
    for (const half of [0, 1]) {
      const pcs = pcsHalf[b * 2 + half];
      const t0 = b * 4 + half * 2;
      // ピアノ（右）：倍音つき、2 拍
      cur = 'piano';
      for (const m of triP(pcs, 48)) {
        const x = new Float32Array(Math.round(2 * beat * SR)), f = midiHz(m);
        for (let i = 0; i < x.length; i++) { let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin((2 * Math.PI * f * h * i) / SR) * Math.pow(h, -1.4) * Math.exp((-i / SR) * (1.2 + h * 0.6)); x[i] = v * Math.min(1, i / 60); }
        pan(tOf(t0), x, 0.07, 0.45);
      }
      // ギター（左）：8 分で刻む
      cur = 'guitar';
      for (let e = 0; e < 4; e++) for (const m of triP(pcs, 52)) pan(tOf(t0 + e * 0.5) + 0.004 * m % 0.01, pluck(r, midiHz(m), Math.round(beat * 0.5 * SR), 0.35), 0.06, -0.5);
      // パッド（真ん中・小さく）
      cur = 'pad';
      for (const m of triP(pcs, 60)) {
        const x = new Float32Array(Math.round(2 * beat * SR)), f = midiHz(m);
        for (let i = 0; i < x.length; i++) x[i] = (Math.sin((2 * Math.PI * f * i) / SR) + 0.3 * Math.sin((4 * Math.PI * f * i) / SR)) * Math.min(1, i / (SR * 0.1), (x.length - i) / (SR * 0.1));
        pan(tOf(t0), x, 0.02, 0);
      }
      // ベース：根音を 8 分
      cur = 'bass';
      const root = 36 + pcs[0] + toTonic - (pcs[0] + toTonic >= 8 ? 12 : 0);
      for (let e = 0; e < 4; e++) { const x = pluck(r, midiHz(root), Math.round(beat * 0.48 * SR), 0.6); pan(tOf(t0 + e * 0.5), x, 0.25, 0); }
    }
    // ドラム
    cur = 'drums';
    const t0 = b * 4;
    const kick = new Float32Array(Math.round(0.3 * SR)); for (let i = 0; i < kick.length; i++) kick[i] = Math.sin(2 * Math.PI * (52 * i / SR + 1.6 * (1 - Math.exp(-i / (SR * 0.02))))) * Math.pow(1 - i / kick.length, 2);
    for (const q of [0, 2, ...(b % 2 ? [2.5] : [])]) pan(tOf(t0 + q), kick, 0.75, 0);
    for (const q of [1, 3]) { const sn = new Float32Array(Math.round(0.2 * SR)); for (let i = 0; i < sn.length; i++) sn[i] = r.bi() * Math.pow(1 - i / sn.length, 3) + Math.sin((2 * Math.PI * 190 * i) / SR) * Math.exp(-i / (SR * 0.03)) * 0.5; pan(tOf(t0 + q), sn, 0.35, 0.1); }
    for (let e = 0; e < 8; e++) { const hh = new Float32Array(Math.round(0.05 * SR)); let hp = 0; for (let i = 0; i < hh.length; i++) { const w = r.bi(); hh[i] = (w - hp) * Math.pow(1 - i / hh.length, 2); hp = w; } pan(tOf(t0 + e * 0.5), hh, e % 2 ? 0.1 : 0.14, 0.3); }
  }
  if (o.dense) {
    // 真ん中のシンセ：コードの音を 8 分で上下（歌と同じくらいの高さ）。8 小節ごとにシンバル
    const rd = new Rng(o.seed * 17 + 3);
    cur = 'synth';
    for (let b = 0; b < o.bars; b++) for (let e = 0; e < 8; e++) {
      const p = triP(pcsHalf[b * 2 + (e >= 4 ? 1 : 0)], 72), m = p[[0, 1, 2, 1][e % 4]];
      const x = new Float32Array(Math.round(beat * 0.45 * SR)), f = midiHz(m);
      let ph = 0, lp = 0;
      for (let i = 0; i < x.length; i++) { ph = (ph + f / SR) % 1; lp += ((ph * 2 - 1) - lp) * 0.25; x[i] = lp * Math.exp(-i / (SR * 0.12)); }
      pan(tOf(b * 4 + e * 0.5), x, 0.07, 0.05);
    }
    cur = 'drums';
    for (let b = 0; b < o.bars; b += 8) {
      const x = new Float32Array(Math.round(1.5 * SR));
      let hp = 0;
      for (let i = 0; i < x.length; i++) { const w = rd.bi(); x[i] = (w - hp) * Math.exp(-i / (SR * 0.5)); hp = w; }
      pan(tOf(b * 4), x, 0.12, -0.2);
    }
  }
  // ---- 歌：コードの音を中心に、ときどき経過音・半音。4 分と 8 分、ときどき休み ----
  const melody: GenTruth['melody'] = [];
  let pitch = 64 + toTonic;
  for (let b = 0; b < o.bars; b++) {
    if (b % 8 === 7) continue; // 8 小節ごとに 1 小節休む
    let q = 0;
    while (q < 4) {
      const len = r.pick([0.5, 1, 1, 1.5, 2]);
      const tones = triP(pcsHalf[b * 2 + (q >= 2 ? 1 : 0)], 60).flatMap((m) => [m, m + 12]);
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
  const rvx = new Rng(o.seed * 31 + 7); // 本物らしい歌い方用（ほかの音の乱数は変えない）
  for (const nn of melody) {
    const t = tOf(nn.t), dur = nn.len * beat, len = Math.round(dur * SR), f0 = midiHz(nn.midi);
    const src = new Float32Array(len);
    let ph = 0;
    // すくい上げ（-30〜-80 セントから 50〜90ms で）・音ごとの外れ（±12 セント）・ビブラート（深さ 0.8〜2.5%、4.5〜6.5Hz）
    const scoop = o.realVoice ? -(30 + rvx.next() * 50) / 1200 : 0, scoopT = 0.05 + rvx.next() * 0.04;
    const detune = o.realVoice ? (rvx.next() - 0.5) * 24 / 1200 : 0;
    const vd = o.realVoice ? 0.008 + rvx.next() * 0.017 : 0.015, vr = o.realVoice ? 4.5 + rvx.next() * 2 : 5.4;
    for (let i = 0; i < len; i++) {
      const s = i / SR;
      const bend = Math.pow(2, detune + scoop * Math.max(0, 1 - s / scoopT));
      const f = f0 * bend * (1 + vd * Math.sin(2 * Math.PI * vr * s) * Math.min(1, s * 3));
      ph = (ph + f / SR) % 1;
      src[i] = (ph * 2 - 1) + r.bi() * 0.04;
    }
    const vw = r.pick(VOWELS), out = new Float32Array(len);
    vw.forEach((fc, j) => {
      const w = (2 * Math.PI * fc) / SR, al = Math.sin(w) / (2 * 8), c = Math.cos(w), a0 = 1 + al;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < len; i++) { const y = (al * src[i] - al * x2 + 2 * c * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = src[i]; y2 = y1; y1 = y; out[i] += y * [1, 0.7, 0.35][j]; }
    });
    for (let i = 0; i < len; i++) out[i] *= Math.min(1, i / (SR * 0.04)) * Math.min(1, (len - i) / (SR * 0.06)) * 0.5;
    if (o.realVoice) {
      // 子音（音の頭の 25ms のシャッという音）と、うすい息の音
      let hp = 0;
      for (let i = 0; i < len; i++) {
        const w = rvx.bi(), hiN = w - hp; hp = w;
        out[i] += hiN * (i < SR * 0.025 ? 0.18 * (1 - i / (SR * 0.025)) : 0) + hiN * 0.012;
      }
    }
    put(V, t, out, o.vocalGain ?? 1);
  }
  // 歌を置く（左右）＋残響（左右で違う遅れのくし形）
  const vp = o.vocalPan ?? 0, rv = o.reverb ?? 0.2;
  for (let i = 0; i < n; i++) { L[i] += V[i] * Math.cos(((vp + 1) * Math.PI) / 4) * Math.SQRT2; R[i] += V[i] * Math.sin(((vp + 1) * Math.PI) / 4) * Math.SQRT2; }
  if (rv > 0) for (const [buf, ds] of [[L, [1557, 1617, 1491]], [R, [1422, 1356, 1277]]] as const) {
    const wet = new Float32Array(n);
    for (const d of ds) { const b2 = new Float32Array(n); for (let i = 0; i < n; i++) { b2[i] = (V[i] + (L[i] + R[i]) * 0.15) + (i >= d ? b2[i - d] * 0.78 : 0); wet[i] += b2[i] * 0.33; } }
    for (let i = 0; i < n; i++) buf[i] += wet[i] * rv * 0.25;
    const st = (stems.reverb ??= new Float32Array(n));
    for (let i = 0; i < n; i++) st[i] += (wet[i] * rv * 0.25) / 2;
  }
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.9 / pk;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; V[i] *= g; }
  for (const k in stems) for (let i = 0; i < n; i++) stems[k][i] *= g;
  const shiftRaw = ((o.minor ? 9 : 0) - o.tonic + 12) % 12;
  return { L, R, vocal: V, sr: SR, truth: { bpm: o.bpm, offset: lead, shift: shiftRaw > 6 ? shiftRaw - 12 : shiftRaw, chordsHalf, chordQ, melody, swing }, stems };
}
