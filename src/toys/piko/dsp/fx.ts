// アンプ部の改造（電圧不足・タッチポイント）と、エフェクト別ユニット（DIST / FIZZ / HIPASS / FEEDBACK）。

import { Rng } from '../../../core/rng';

/** 指の「皮膚抵抗」：ゆっくりランダムに揺れる 0.5〜1.5 の値 */
export class Skin {
  private v = 1;
  private target = 1;
  private cd = 0;
  constructor(private sr: number, private rng: Rng) {}
  tick(): number {
    if (--this.cd <= 0) { this.cd = Math.floor(this.sr * (0.02 + this.rng.next() * 0.1)); this.target = 0.5 + this.rng.next(); }
    this.v += (this.target - this.v) * (30 / this.sr);
    return this.v;
  }
}

export interface AmpCtl {
  power: number; // 1 = 正常、0 に近いほど電圧不足
  touch: [number, number, number];
}

/** おもちゃの内蔵アンプ（電圧を削られている） */
export class Amp {
  private env = 0;
  private crackle = 0;
  private sagPh = 0;
  private humPh = 0;
  private howlPh = 0;
  private skins: Skin[];

  constructor(private sr: number, private rng: Rng) {
    this.skins = [0, 1, 2].map(() => new Skin(sr, rng));
  }

  tick(x: number, c: AmpCtl): number {
    const sr = this.sr;
    const starve = 1 - c.power;
    const [t1, t2, t3] = c.touch;
    const s1 = this.skins[0].tick(), s2 = this.skins[1].tick(), s3 = this.skins[2].tick();
    this.env += (Math.abs(x) - this.env) * (Math.abs(x) > this.env ? 0.01 : 0.0005);

    // AMP TOUCH 1：ハム（電源の 50Hz が指から乗る）と、それによる揺れ
    if (t1 > 0) {
      this.humPh = (this.humPh + 50 / sr) % 1;
      const h = Math.sin(2 * Math.PI * this.humPh);
      const hum = h + 0.5 * Math.sin(6 * Math.PI * this.humPh) + 0.3 * (this.humPh < 0.5 ? 1 : -1);
      x = x * (1 - 0.5 * t1 * s1 * (0.5 + 0.5 * h)) + hum * 0.12 * t1 * s1;
    }
    // AMP TOUCH 2：増幅が暴れてバリバリになる
    if (t2 > 0) {
      x = Math.tanh(x * (1 + 8 * t2 * s2));
      if (this.rng.next() < 0.002 * t2 * s2) this.crackle = (this.rng.next() - 0.5) * t2;
    }
    // AMP TOUCH 3：ピーという発振（音の大きさにつられて鳴る）
    if (t3 > 0) {
      this.howlPh = (this.howlPh + (800 + 1700 * (s3 - 0.5)) / sr) % 1;
      x += Math.sin(2 * Math.PI * this.howlPh) * t3 * (0.15 + 0.8 * this.env) * 0.6;
    }

    // ---- 電圧不足 ----
    if (starve > 0.001) {
      x *= 1 - 0.6 * starve;
      // 電圧が足りないと、小さい音が途切れる（スパッタ）
      const th = starve * 0.06;
      const g = Math.min(1, Math.max(0, (this.env - th) / (th + 1e-4)));
      x *= g;
      // 大きい音で電源がへたり、ボコボコ揺れる（モーターボーティング）
      if (starve > 0.5) {
        this.sagPh = (this.sagPh + (4 + 6 * starve) / sr) % 1;
        x *= 1 - (starve - 0.5) * 1.2 * Math.min(1, this.env * 3) * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.sagPh));
      }
      // 電源レールが下がって、プラスとマイナスで違う所で潰れる
      const top = 1 - 0.85 * starve;
      x = Math.max(-top * 0.6, Math.min(top, x));
      if (this.rng.next() < starve * starve * 0.002) this.crackle = (this.rng.next() - 0.5) * starve;
    }
    x += this.crackle;
    this.crackle *= 0.97;
    return x;
  }
}

export interface FxCtl {
  dist: number;
  fizz: number;
  hipass: number;
  hipassReso: boolean;
  feedback: number;
  feedbackLong: boolean;
}

/** エフェクト別ユニット：[入力＋フィードバック] → DIST → FIZZ → HIPASS → 出力（→ ディレイ → フィードバック） */
export class FxUnit {
  private delay: Float32Array;
  private dPos = 0;
  private dTime = 0; // サンプル（なめらかに動かす）
  private held = 0;
  private holdCnt = 0;
  private lp = 0;
  private bp = 0;
  private modPh = 0;

  constructor(private sr: number, private rng: Rng) {
    this.delay = new Float32Array(Math.ceil(sr * 0.5));
  }

  tick(x: number, c: FxCtl): number {
    const sr = this.sr;
    // ---- FEEDBACK（入力に戻す） ----
    const target = c.feedbackLong ? sr * 0.28 : sr * (0.004 + 0.0008 * Math.sin(2 * Math.PI * this.modPh));
    this.modPh = (this.modPh + 0.4 / sr) % 1;
    this.dTime += (target - this.dTime) * 0.0005;
    if (c.feedback > 0.001) {
      const rp = (this.dPos - Math.max(1, this.dTime) + this.delay.length) % this.delay.length;
      const i = Math.floor(rp);
      const y = this.delay[i];
      x += Math.tanh(y * c.feedback * 1.25);
    }

    // ---- DIST ----
    if (c.dist > 0.001) x = Math.tanh(x * (1 + c.dist * 30)) * (1 - 0.3 * c.dist);

    // ---- FIZZ：サンプルの間引き＋ビット落とし＋音にまとわりつくジリジリ ----
    if (c.fizz > 0.001) {
      const hold = 1 + Math.floor(c.fizz * 12);
      if (++this.holdCnt >= hold) { this.holdCnt = 0; this.held = x; }
      const q = Math.pow(2, 12 - c.fizz * 9);
      x = Math.round(this.held * q) / q + (this.rng.next() - 0.5) * Math.abs(x) * c.fizz * 0.5;
    }

    // ---- HIPASS（状態変数フィルター）----
    if (c.hipass > 0.001) {
      const fc = 20 * Math.pow(2, c.hipass * 8); // 20Hz〜5kHz
      const f = 2 * Math.sin((Math.PI * Math.min(fc, sr / 6)) / sr);
      const q = c.hipassReso ? 0.15 : 1.4; // 小さいほどクセが強い
      const hp = x - this.lp - q * this.bp;
      this.bp += f * hp;
      this.lp += f * this.bp;
      if (c.hipassReso) this.bp = Math.tanh(this.bp);
      x = hp;
    }

    this.delay[this.dPos] = x;
    this.dPos = (this.dPos + 1) % this.delay.length;
    return x;
  }
}
