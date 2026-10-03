// マスター（全部のおもちゃを混ぜた後の仕上げ）。スピーカー・録音・WAV 書き出しのどれも同じ音になるよう、ここ 1 つで処理する。
//   1. 直流カット（20Hz）… 音の中心がずれると、割れやすく・こもる
//   2. バスコンプ（ゆるく 2:1）… バラバラのおもちゃを 1 つの曲にまとめる（のり付け）
//   2.5 低音を真ん中に（120Hz より下）
//   3. 部屋の響き（ステレオ）… 左右で少し違う響きで広げる。低い音は真ん中のまま（ぼやけないように）
//   4. 先読みリミッター（-1dBTP）… サンプルの間の山まで見て前もって下げる。絶対に割れない（ガリッとならない）
// DOM 非依存（AudioWorklet・Web Worker・テストのどこでも使う）。

/** 響きの部品：くし形（中に吸音のローパス） */
class Comb {
  private buf: Float32Array;
  private i = 0;
  private lp = 0;
  constructor(len: number, private fb: number, private damp: number) { this.buf = new Float32Array(len); }
  run(x: number): number {
    const y = this.buf[this.i];
    this.lp = y + (this.lp - y) * this.damp;
    this.buf[this.i] = x + this.lp * this.fb;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}
/** 響きの部品：オールパス（響きを細かくする） */
class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(len: number) { this.buf = new Float32Array(len); }
  run(x: number): number {
    const b = this.buf[this.i];
    const y = -x + b;
    this.buf[this.i] = x + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}

/** 小さめの部屋（Freeverb の作り。左右で長さを少しずらす） */
class Room {
  private combs: Comb[][];
  private aps: Allpass[][];
  private pre: Float32Array;
  private pi = 0;
  private hp = 0;
  constructor(sr: number, size = 0.72, damp = 0.45) {
    const k = sr / 44100;
    const C = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const A = [556, 441, 341, 225];
    const spread = 23;
    const fb = 0.7 + size * 0.28 * 0.5;
    this.combs = [0, spread].map((s) => C.map((c) => new Comb(Math.round((c + s) * k * 0.6), fb, damp)));
    this.aps = [0, spread].map((s) => A.map((a) => new Allpass(Math.round((a + s) * k * 0.6))));
    this.pre = new Float32Array(Math.round(sr * 0.012));
  }
  /** x（モノラル）→ 左右の響きだけ */
  run(x: number, hpA: number): [number, number] {
    // 響きに入れる前に低い音を抜く（低音がぼやけない）・少し遅らせる（はっきり聞こえる）
    this.hp += hpA * (x - this.hp);
    const y = this.pre[this.pi];
    this.pre[this.pi] = (x - this.hp) * 0.06;
    if (++this.pi >= this.pre.length) this.pi = 0;
    const out: [number, number] = [0, 0];
    for (let c = 0; c < 2; c++) {
      let s = 0;
      for (const cb of this.combs[c]) s += cb.run(y);
      for (const ap of this.aps[c]) s = ap.run(s);
      out[c] = s;
    }
    return out;
  }
}

/** リンクウィッツ・ライリー 4 次（バターワース 2 段）。low と high を足すと元の大きさに戻る（位相だけ回る） */
class LR4 {
  private c: number[];
  private z = new Float64Array(8);
  constructor(sr: number, hz: number, high: boolean) {
    const w = (2 * Math.PI * hz) / sr, al = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + al;
    const b0 = (high ? (1 + c) / 2 : (1 - c) / 2) / a0, b1 = (high ? -(1 + c) : 1 - c) / a0;
    this.c = [b0, b1, b0, (-2 * c) / a0, (1 - al) / a0];
  }
  run(x: number): number {
    const z = this.z, [b0, b1, b2, a1, a2] = this.c;
    for (let k = 0; k < 8; k += 4) {
      const y = b0 * x + b1 * z[k] + b2 * z[k + 1] - a1 * z[k + 2] - a2 * z[k + 3];
      z[k + 1] = z[k]; z[k] = x; z[k + 3] = z[k + 2]; z[k + 2] = y;
      x = y;
    }
    return x;
  }
}

/** トゥルーピークを見る位置（サンプルの間を 4 等分） */
const TP_T = [0.25, 0.5, 0.75];

export interface MasterOptions {
  /** 響きの量（0 = なし） */
  reverb?: number;
  /** バスコンプのかかり始め（dB） */
  threshold?: number;
  /** コンプの後に足す音量（dB） */
  makeup?: number;
}

export class MasterBus {
  private dcX = 0;
  private dcY = 0;
  private dcA: number;
  private env = 0;
  private atk: number;
  private rel: number;
  private room: Room;
  private roomHp: number;
  private wet: number;
  private thr: number;
  // 先読みリミッター
  private la: number;
  private dl: Float32Array;
  private dr: Float32Array;
  private di = 0;
  private peakBuf: Float32Array;
  private lGain = 1;
  private lRel: number;
  private lAtk: number;
  /** 天井 -1dBTP（配信サービスの決まり）。リミッターは少し下をねらう */
  private ceiling = Math.pow(10, -1 / 20);
  private target = Math.pow(10, -1.3 / 20);
  private dcXr = 0;
  private dcYr = 0;
  private tpHist = new Float32Array(8);
  private lowL: LR4;
  private lowR: LR4;
  private highL: LR4;
  private highR: LR4;
  private makeup: number;

  /** 先読みの分の遅れ（サンプル） */
  get latency(): number { return this.la; }

  constructor(private sr: number, o: MasterOptions = {}) {
    this.dcA = Math.exp((-2 * Math.PI * 20) / sr);
    this.atk = Math.exp(-1 / (0.012 * sr));
    this.rel = Math.exp(-1 / (0.18 * sr));
    this.room = new Room(sr);
    this.roomHp = 1 - Math.exp((-2 * Math.PI * 250) / sr);
    this.wet = o.reverb ?? 0.11;
    this.thr = o.threshold ?? -16;
    this.makeup = Math.pow(10, (o.makeup ?? 2) / 20);
    this.lowL = new LR4(sr, 120, false);
    this.lowR = new LR4(sr, 120, false);
    this.highL = new LR4(sr, 120, true);
    this.highR = new LR4(sr, 120, true);
    this.la = Math.max(8, Math.round(sr * 0.0025));
    this.dl = new Float32Array(this.la);
    this.dr = new Float32Array(this.la);
    this.peakBuf = new Float32Array(this.la);
    this.lRel = Math.exp(-1 / (0.09 * sr));
    this.lAtk = Math.exp(-4 / this.la);
  }

  /** 左右（おもちゃを並べて混ぜた音）→ 仕上げた左右。入力と出力は同じ配列でもよい。inR が無ければモノラル */
  process(inL: Float32Array, inR: Float32Array | null, L: Float32Array, R: Float32Array): void {
    const n = inL.length;
    const h = this.tpHist;
    for (let i = 0; i < n; i++) {
      // 1. 直流カット（左右それぞれ）
      const a0 = inL[i], b0 = inR ? inR[i] : a0;
      const xl = a0 - this.dcX + this.dcA * this.dcY, xr = b0 - this.dcXr + this.dcA * this.dcYr;
      this.dcX = a0; this.dcY = xl; this.dcXr = b0; this.dcYr = xr;
      // 2. バスコンプ（左右いっしょに RMS で見て、2:1 でゆるく）
      const p = (xl * xl + xr * xr) * 0.5;
      this.env = p > this.env ? this.atk * this.env + (1 - this.atk) * p : this.rel * this.env + (1 - this.rel) * p;
      const over = 10 * Math.log10(this.env + 1e-12) - this.thr;
      const g = (over > 0 ? Math.pow(10, (-over * 0.5) / 20) : 1) * this.makeup;
      let l = xl * g, r = xr * g;
      // 低音（120Hz より下）は真ん中にまとめる（市販の仕上げと同じ。スマホのスピーカーでも低音が消えない）
      const lowMid = (this.lowL.run(l) + this.lowR.run(r)) * 0.5;
      l = this.highL.run(l) + lowMid;
      r = this.highR.run(r) + lowMid;
      // 3. 部屋の響き（真ん中の音から、左右で違う響き）
      if (this.wet > 0) {
        const [wl, wr] = this.room.run((l + r) * 0.5, this.roomHp);
        l += wl * this.wet;
        r += wr * this.wet;
      }
      // 4. 先読みリミッター：サンプルとサンプルの間の山（トゥルーピーク）まで見て、前もって下げる
      h[0] = h[1]; h[1] = h[2]; h[2] = h[3]; h[3] = l;
      h[4] = h[5]; h[5] = h[6]; h[6] = h[7]; h[7] = r;
      let pk = Math.max(Math.abs(l), Math.abs(r));
      for (let c = 0; c < 8; c += 4) {
        const xm1 = h[c], x0 = h[c + 1], x1 = h[c + 2], x2 = h[c + 3];
        const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
        for (const t of TP_T) { const v = Math.abs(((c3 * t + c2) * t + c1) * t + x0); if (v > pk) pk = v; }
      }
      this.peakBuf[this.di] = pk;
      let m = 0;
      for (let k = 0; k < this.la; k++) if (this.peakBuf[k] > m) m = this.peakBuf[k];
      const want = m > this.target ? this.target / m : 1;
      // 下げるのは先読みの間になめらかに（急に下げるとプツッと鳴る）、戻すのはゆっくり
      this.lGain = want < this.lGain ? want + (this.lGain - want) * this.lAtk : this.lRel * this.lGain + (1 - this.lRel) * want;
      const ol = this.dl[this.di], or = this.dr[this.di];
      this.dl[this.di] = l;
      this.dr[this.di] = r;
      if (++this.di >= this.la) this.di = 0;
      // 念のため最後に天井で止める（先読みの範囲を超える急な音でも割れない）
      L[i] = Math.max(-this.ceiling, Math.min(this.ceiling, ol * this.lGain));
      R[i] = Math.max(-this.ceiling, Math.min(this.ceiling, or * this.lGain));
    }
  }

  reset(): void {
    const sr = this.sr;
    const w = this.wet, t = this.thr, mk = 20 * Math.log10(this.makeup);
    Object.assign(this, new MasterBus(sr, { reverb: w, threshold: t, makeup: mk }));
  }
}

/** 書き出しの音量合わせのめやす（LUFS）。配信サービスより少し大きめ、市販の CD よりは控えめ */
export const EXPORT_LUFS = -12;
