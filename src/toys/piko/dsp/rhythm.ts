// リズムボックスとドラムパッド。音は 1 サンプルずつその場で合成（LFSR ノイズ＋サイン）。
// GLITCH スイッチ ON：スネアが鳴るたびに短いディレイの中で発振する「変なフィードバック」になる。

import { Rng } from '../../../core/rng';

// パターン：1 文字 = 1 ステップ（16 分音符。12 ステップのものは 3 連符）
// K=キック S=スネア H=ハット O=オープンハット C=クラベス T=タム
type Pattern = { steps: number; lines: Record<string, string> };
export const PATTERNS: Pattern[] = [
  { steps: 16, lines: { K: 'x...x...x...x...', S: '..x...x.x.x.xxx.', H: 'x.......x.......' } }, // MARCH
  { steps: 16, lines: { K: 'x..x..x.x..x..x.', C: 'x..x...x..x.x...', H: 'x.x.x.x.x.x.x.x.' } }, // RHUMBA
  { steps: 16, lines: { K: 'x...x...x...x...', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.', O: '..x...x...x...x.' } }, // DISCO
  { steps: 16, lines: { K: 'x.....x.x.......', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.' } }, // POP
  { steps: 16, lines: { K: 'x.......x.x.....', S: '....x.......x...', H: 'x...x...x...x...' } }, // BALLAD
  { steps: 12, lines: { K: 'x...........', S: '....x...x...', H: 'x.x.x.x.x.x.' } }, // WALTZ
  { steps: 16, lines: { K: 'x..x..x.x.......', S: '......x.....x.x.', C: 'x...x...x...x...' } }, // TANGO
  { steps: 12, lines: { K: 'x.....x.....', S: '...x.....x..', H: 'x.xx.xx.xx.x' } }, // SWING
];

const KINDS = ['K', 'S', 'H', 'O', 'C', 'T'] as const;
type Kind = (typeof KINDS)[number];

class Drum {
  t = 1e9; // 鳴り始めからのサンプル数
  pitch = 1;
}

export class Rhythm {
  running = false;
  step = 0;
  private phase = 0; // ステップ内の位置 0..1
  private drums: Record<Kind, Drum> = { K: new Drum(), S: new Drum(), H: new Drum(), O: new Drum(), C: new Drum(), T: new Drum() };
  private lfsr = 0x7fff;
  private noiseV = 0;
  // GLITCH 用のスネア発振器（短いディレイ＋フィードバック）
  private fbBuf: Float32Array;
  private fbPos = 0;
  private fbLen = 100;
  private fbAmt = 0;
  /** 拍の頭で true になる（LED 用） */
  beat = false;

  constructor(private sr: number, private rng: Rng) {
    this.fbBuf = new Float32Array(Math.ceil(sr * 0.02));
  }

  start(): void { this.running = true; this.step = 0; this.phase = 0; }
  stop(): void { this.running = false; }

  hit(k: Kind, glitch: boolean): void {
    const d = this.drums[k];
    d.t = 0;
    d.pitch = glitch && k === 'K' ? 0.6 + this.rng.next() * 1.2 : 1;
    if (k === 'S' && glitch) {
      // スネアのたびに発振器の長さが変わる
      this.fbLen = Math.max(8, Math.floor(this.sr * (0.0015 + this.rng.next() * 0.011)));
      this.fbAmt = 1;
    }
  }

  /** パッド 0..3 */
  pad(i: number, glitch: boolean): void {
    this.hit((['K', 'S', 'H', 'T'] as const)[i], glitch);
  }

  private noise(): number {
    // 15bit LFSR（チップのノイズ）
    const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
    this.lfsr = (this.lfsr >> 1) | (bit << 14);
    return (this.lfsr & 1) * 2 - 1;
  }

  /** 1 サンプル。bpm はテンポ、clk はクロック倍率（CPU 電圧で遅れる） */
  tick(pattern: number, bpm: number, clk: number, glitch: boolean): number {
    this.beat = false;
    if (this.running) {
      const p = PATTERNS[pattern];
      const stepsPerBeat = p.steps === 12 ? 3 : 4;
      this.phase += ((bpm / 60) * stepsPerBeat * clk) / this.sr;
      if (this.phase >= 1) {
        this.phase -= 1;
        let next = (this.step + 1) % p.steps;
        if (glitch && this.rng.chance(0.12)) next = this.step; // GLITCH：同じステップを繰り返す
        this.step = next;
        this.trigger(p, glitch);
      }
    }
    return this.render(clk, glitch);
  }

  private trigger(p: Pattern, glitch: boolean): void {
    const stepsPerBeat = p.steps === 12 ? 3 : 4;
    if (this.step % stepsPerBeat === 0) this.beat = true;
    for (const [k, line] of Object.entries(p.lines)) if (line[this.step] === 'x') this.hit(k as Kind, glitch);
  }

  private render(clk: number, glitch: boolean): number {
    const sr = this.sr;
    // ノイズはクロックに合わせて更新（CPU 電圧が下がるとノイズも粗くなる）
    if (this.rng.next() < Math.min(1, clk * 0.9)) this.noiseV = this.noise();
    const n = this.noiseV;
    let out = 0;
    const d = this.drums;
    const env = (dr: Drum, ms: number) => Math.exp(-dr.t / ((ms / 1000) * sr));
    if (d.K.t < sr) { const t = d.K.t / sr; const f = (45 + 110 * Math.exp(-t * 30)) * d.K.pitch; out += Math.sin(2 * Math.PI * f * t * (1 + t)) * env(d.K, 140) * 0.9; }
    let snare = 0;
    if (d.S.t < sr) snare = (n * 0.7 + Math.sin((2 * Math.PI * 185 * d.S.t) / sr) * 0.4) * env(d.S, 90) * 0.6;
    if (d.H.t < sr) out += n * env(d.H, 25) * 0.25;
    if (d.O.t < sr) out += n * env(d.O, 180) * 0.2;
    if (d.C.t < sr) out += Math.sin((2 * Math.PI * 2500 * d.C.t) / sr) * env(d.C, 18) * 0.4;
    if (d.T.t < sr) { const t = d.T.t / sr; out += Math.sin(2 * Math.PI * (90 + 60 * Math.exp(-t * 20)) * t) * env(d.T, 160) * 0.7; }
    for (const k of KINDS) d[k].t += clk;

    if (glitch && this.fbAmt > 0.001) {
      // スネアが短いディレイの中で発振する
      const y = this.fbBuf[(this.fbPos - this.fbLen + this.fbBuf.length) % this.fbBuf.length];
      const x = Math.tanh(snare + y * 1.35);
      this.fbBuf[this.fbPos] = x * this.fbAmt;
      this.fbPos = (this.fbPos + 1) % this.fbBuf.length;
      this.fbAmt *= 1 - 1.5 / sr; // 0.7 秒ほどで収まる
      out += x * 0.5 * this.fbAmt;
    } else {
      out += snare;
      this.fbAmt = 0;
    }
    return out;
  }
}
