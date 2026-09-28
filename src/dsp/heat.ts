// 見えない「熱」。グリッチを押し続けたり、過激な組み合わせで上がり、放っておくと冷める。
// 熱が高いほど、押していないグリッチが勝手に暴発する（予測できない不安定さ）。
// 固まる（フリーズする）ことはない。手を離せば必ず落ち着く。

import { Rng } from './rng';

export interface HeatInput {
  glitchCount: number; // 押している GLITCH ボタンの数
  base: number;
  dist: number; // 0..1
  looping: boolean;
  stretching: boolean;
  playing: boolean;
  presses: number; // この区間に押したキーの数
}

const BASE_WEIGHT = [1, 1, 1.1, 1.2, 1.3];
const THRESHOLD = 0.4; // これを超えると暴発が始まる

export class Heat {
  value = 0;
  /** 暴発中のグリッチ（25bit） */
  forced = 0;
  private burstLeft = 0; // 秒

  constructor(private rng: Rng) {}

  /** dt 秒ぶん進める */
  update(dt: number, i: HeatInput): void {
    const n = i.playing ? i.glitchCount : 0;
    let rise = n > 0 ? 0.05 * Math.pow(n, 1.7) * BASE_WEIGHT[i.base] : 0;
    rise *= (1 + 0.9 * i.dist) * (1 + (i.looping ? 0.35 : 0) + (i.stretching ? 0.25 : 0));
    const decay = n > 0 ? 0.02 : 0.12;
    this.value += (rise - decay) * dt + i.presses * (n > 0 ? 0.015 : 0);
    this.value = Math.max(0, Math.min(1.2, this.value));

    // ---- 暴発 ----
    if (this.burstLeft > 0) {
      this.burstLeft -= dt;
      if (this.burstLeft <= 0) this.forced = 0;
    } else if (i.playing && this.value > THRESHOLD) {
      const rate = (this.value - THRESHOLD) * 8; // 1 秒あたりの回数
      if (this.rng.next() < rate * dt) {
        const pick = () => (this.rng.chance(0.6) ? i.base * 5 + this.rng.int(5) : this.rng.int(25));
        this.forced = 1 << pick();
        if (this.value > 0.9 && this.rng.chance(0.5)) this.forced |= 1 << pick();
        this.burstLeft = 0.02 + this.rng.next() * 0.13;
      }
    }
    if (!i.playing) { this.forced = 0; this.burstLeft = 0; }
  }

  reset(): void {
    this.value = 0;
    this.forced = 0;
    this.burstLeft = 0;
  }
}
