// サーキットベンド（DOM 非依存）：基板のジャンパー線 6 本をつなぐと、おもちゃが壊れたような音になる。
// つないだ本数と出している音の大きさで「熱」がたまり、熱いと暴発（全部いっぺんに強く）する。離せば冷める（固まらない）。
import { Rng } from '../../core/rng';

export const WIRES = [
  { id: 'clock', name: 'CLOCK', desc: '時計が狂う：再生の速さがカクカク飛ぶ' },
  { id: 'stuck', name: 'STUCK', desc: 'バッファが引っかかる：ほんの一瞬をくり返す' },
  { id: 'runaway', name: 'RUNAWAY', desc: '音程が暴走：上がったり下がったりして戻る' },
  { id: 'bitrot', name: 'BIT ROT', desc: 'ビットが腐る：ザリザリ・プチプチ' },
  { id: 'cross', name: 'CROSSTALK', desc: '混線：鳴らすと、となりのパッドも小さく鳴る' },
  { id: 'sag', name: 'SAG', desc: '電池切れ：大きい音でへたって、こもって、低くなる' },
] as const;

export interface BendState {
  wires: boolean[];
  /** 強さ 0〜1 */
  amount: number;
  /** 起こる頻度 0〜1 */
  speed: number;
}
export const defaultBend = (): BendState => ({ wires: WIRES.map(() => false), amount: 0.5, speed: 0.5 });

export class Bender {
  st: BendState = defaultBend();
  heat = 0;
  /** 暴発中（秒） */
  private burst = 0;
  private rng: Rng;
  // CLOCK
  private clockMul = 1;
  private clockLeft = 0;
  // RUNAWAY
  private run = 0;
  private runV = 0;
  // STUCK
  private stuckBuf = [new Float32Array(1), new Float32Array(1)];
  private stuckLen = 0;
  private stuckPos = 0;
  private stuckLeft = 0;
  private recBuf = [new Float32Array(1), new Float32Array(1)];
  private recPos = 0;
  // BIT ROT
  private hold = [0, 0];
  private holdLeft = 0;
  // SAG
  private sagEnv = 0;
  private sagLp = [0, 0];

  constructor(private sr: number, seed = 1616) {
    this.rng = new Rng(seed);
    const n = Math.round(sr * 0.25);
    this.recBuf = [new Float32Array(n), new Float32Array(n)];
    this.stuckBuf = [new Float32Array(n), new Float32Array(n)];
  }

  get active(): boolean {
    return this.st.wires.some(Boolean) || this.heat > 0.01;
  }
  private on(i: number): boolean {
    return this.st.wires[i] || this.burst > 0;
  }
  /** 強さ（暴発中は強め） */
  private amt(): number {
    return Math.min(1.5, this.st.amount * (this.burst > 0 ? 1.6 : 1));
  }

  /** 再生の速さの倍率（CLOCK・RUNAWAY・SAG）。ブロックごとに 1 回 */
  rateMul(n: number): number {
    const a = this.amt();
    let m = 1;
    if (this.on(0)) {
      this.clockLeft -= n;
      if (this.clockLeft <= 0) {
        this.clockLeft = this.sr * (0.03 + 0.4 * (1 - this.st.speed) * this.rng.next());
        this.clockMul = this.rng.chance(0.4) ? 1 : Math.pow(2, (this.rng.int(25) - 12) * a / 12);
      }
      m *= this.clockMul;
    }
    if (this.on(2)) {
      // ふらふら上がり下がりして、ときどきパチンと戻る
      this.runV += (this.rng.bi() * 0.02 + (this.run > 0 ? 0.004 : -0.004) * (this.rng.chance(0.5) ? 1 : -1)) * this.st.speed;
      this.runV *= 0.98;
      this.run = Math.max(-1, Math.min(1, this.run + this.runV * (n / 128)));
      if (this.rng.chance(0.002 * (0.5 + this.st.speed))) this.run = 0;
      m *= Math.pow(2, this.run * a * 1.2);
    } else this.run *= 0.95;
    if (this.on(5)) m *= 1 - 0.35 * a * Math.min(1, this.sagEnv * 3);
    return m;
  }

  /** 混線：鳴らしたとき、ほかのパッドも鳴らすか（鳴らすなら 0〜1 の音量、鳴らさないなら 0） */
  crosstalk(): number {
    if (!this.on(4)) return 0;
    return this.rng.chance(0.35 + 0.5 * this.st.speed) ? 0.15 + 0.35 * this.amt() : 0;
  }
  pickOther(n: number): number {
    return this.rng.int(n);
  }

  /** 出口の音を壊す（STUCK・BIT ROT・SAG）と、熱の計算 */
  process(l: Float32Array, r: Float32Array, n: number): void {
    const a = this.amt();
    const wires = this.st.wires.filter(Boolean).length;
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
    // 熱：つないだ本数 × 音の大きさでたまり、ゆっくり冷める
    const dt = n / this.sr;
    this.heat = Math.max(0, this.heat + dt * (wires * (0.02 + peak * 0.12) * (0.5 + a) - 0.06 - (wires ? 0 : 0.25)));
    if (this.burst > 0) this.burst -= dt;
    else if (this.heat > 0.8 && this.rng.chance(dt * 1.5 * this.heat)) { this.burst = 0.4 + this.rng.next() * 1.2; this.heat *= 0.6; }
    this.heat = Math.min(1.2, this.heat);
    if (!wires && this.burst <= 0) return;

    const rb = this.recBuf, L = rb[0].length;
    for (let i = 0; i < n; i++) {
      let x = l[i], y = r[i];
      rb[0][this.recPos] = x; rb[1][this.recPos] = y;
      this.recPos = (this.recPos + 1) % L;
      // STUCK：一瞬を切り取って、しばらくくり返す
      if (this.on(1)) {
        if (this.stuckLeft > 0) {
          this.stuckLeft--;
          x = this.stuckBuf[0][this.stuckPos]; y = this.stuckBuf[1][this.stuckPos];
          this.stuckPos = (this.stuckPos + 1) % this.stuckLen;
        } else if (this.rng.chance((0.4 + 3 * this.st.speed) / this.sr * 4)) {
          this.stuckLen = Math.max(32, Math.round(this.sr * (0.008 + 0.09 * this.rng.next() * a)));
          for (let k = 0; k < this.stuckLen; k++) {
            const j = (this.recPos - this.stuckLen + k + L) % L;
            this.stuckBuf[0][k] = rb[0][j]; this.stuckBuf[1][k] = rb[1][j];
          }
          this.stuckPos = 0;
          this.stuckLeft = Math.round(this.stuckLen * (2 + this.rng.int(10)));
        }
      }
      // BIT ROT：ときどき値が固まる・ビットが落ちる
      if (this.on(3)) {
        if (this.holdLeft > 0) { this.holdLeft--; x = this.hold[0]; y = this.hold[1]; }
        else if (this.rng.chance(0.0004 * (1 + 4 * this.st.speed) * a)) { this.hold = [x, y]; this.holdLeft = this.rng.int(Math.round(this.sr * 0.02 * a)); }
        const q = Math.pow(2, 12 - 9 * a);
        x = Math.round(x * q) / q; y = Math.round(y * q) / q;
        if (this.rng.chance(0.0006 * a)) { x = -x * 2; }
      }
      // SAG：大きい音でへたる（小さくなって、こもる）
      if (this.on(5)) {
        this.sagEnv += (Math.abs(x) + Math.abs(y) - this.sagEnv) * 0.0005;
        const g = 1 - 0.7 * a * Math.min(1, this.sagEnv * 2.5);
        const k = 0.05 + 0.95 * g * g;
        this.sagLp[0] += k * (x * g - this.sagLp[0]);
        this.sagLp[1] += k * (y * g - this.sagLp[1]);
        x = this.sagLp[0]; y = this.sagLp[1];
      }
      l[i] = x; r[i] = y;
    }
  }
}
