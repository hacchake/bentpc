// マスター（全部のおもちゃを混ぜた後の仕上げ）。スピーカー・録音・WAV 書き出しのどれも同じ音になるよう、ここ 1 つで処理する。
//   1. 直流カット（20Hz）… 音の中心がずれると、割れやすく・こもる
//   2. バスコンプ（ゆるく 2:1）… バラバラのおもちゃを 1 つの曲にまとめる（のり付け）
//   3. 部屋の響き（ステレオ）… 左右で少し違う響きで広げる。低い音は真ん中のまま（ぼやけないように）
//   4. 先読みリミッター（-0.8dB）… 大きい音を前もって下げて、絶対に割れない（ガリッとならない）
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

export interface MasterOptions {
  /** 響きの量（0 = なし） */
  reverb?: number;
  /** バスコンプのかかり始め（dB） */
  threshold?: number;
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
  private ceiling = Math.pow(10, -0.8 / 20);
  private makeup = Math.pow(10, 2 / 20);

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
    this.la = Math.max(8, Math.round(sr * 0.0025));
    this.dl = new Float32Array(this.la);
    this.dr = new Float32Array(this.la);
    this.peakBuf = new Float32Array(this.la);
    this.lRel = Math.exp(-1 / (0.09 * sr));
    this.lAtk = Math.exp(-4 / this.la);
  }

  /** mono（全部を混ぜた音）→ L・R。mono と L・R は同じ配列でもよい */
  process(mono: Float32Array, L: Float32Array, R: Float32Array): void {
    const n = mono.length;
    for (let i = 0; i < n; i++) {
      // 1. 直流カット
      const x0 = mono[i];
      const x = x0 - this.dcX + this.dcA * this.dcY;
      this.dcX = x0;
      this.dcY = x;
      // 2. バスコンプ（RMS で見て、2:1 でゆるく）
      const p = x * x;
      this.env = p > this.env ? this.atk * this.env + (1 - this.atk) * p : this.rel * this.env + (1 - this.rel) * p;
      const db = 10 * Math.log10(this.env + 1e-12);
      const over = db - this.thr;
      const g = (over > 0 ? Math.pow(10, (-over * 0.5) / 20) : 1) * this.makeup;
      const y = x * g;
      // 3. 部屋の響き（左右で違う）
      let l = y, r = y;
      if (this.wet > 0) {
        const [wl, wr] = this.room.run(y, this.roomHp);
        l += wl * this.wet;
        r += wr * this.wet;
      }
      // 4. 先読みリミッター：これから出す音の一番大きい所に合わせて、前もって下げる
      const pk = Math.max(Math.abs(l), Math.abs(r));
      this.peakBuf[this.di] = pk;
      let m = 0;
      for (let k = 0; k < this.la; k++) if (this.peakBuf[k] > m) m = this.peakBuf[k];
      const want = m > this.ceiling ? this.ceiling / m : 1;
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
    const w = this.wet, t = this.thr;
    Object.assign(this, new MasterBus(sr, { reverb: w, threshold: t }));
  }
}
