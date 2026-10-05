// 8 台目：MANEKKO MK-8（まねっこインコのカセットレコーダー・魔改造）。DOM 非依存。
// 取り込んだ曲の「歌」「伴奏（カラオケ）」「元の曲」を、カバーの拍にそろえたテープとして持ち、鳴らす。
// キー k = 「k 小節目から鳴らす」。シーケンサーには 1 小節ごとに音符を置くので、曲のどこから再生してもずれない。
// テープを入れるのは画面（custom の 'tape'）。解析とカバー作りは画面と Web Worker（src/toys/manekko/worker.ts）。
import type { ParamDef } from '../../core/params';
import { Rng } from '../../core/rng';
import type { ToyEngine, ToyStatus } from '../../core/toy';

export const MK_MAX_BARS = 1024;

export const MANEKKO_PARAMS: readonly ParamDef[] = [
  { id: 'volume', name: 'VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.8, midiCC: 7 },
  { id: 'vocal', name: 'VOCAL', kind: 'continuous', min: 0, max: 1, default: 1, midiCC: 70 },
  { id: 'karaoke', name: 'KARAOKE', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 71 },
  { id: 'orig', name: 'ORIGINAL', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 72 },
  { id: 'wow', name: 'WOW', kind: 'continuous', min: 0, max: 1, default: 0.15, midiCC: 73 },
  { id: 'lofi', name: 'LO-FI', kind: 'continuous', min: 0, max: 1, default: 0.25, midiCC: 74 },
  { id: 'echo', name: 'ECHO', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 91 },
  { id: 'stutter', name: 'STUTTER', kind: 'momentary', min: 0, max: 1, default: 0 },
];
export const MK = { volume: 0, vocal: 1, karaoke: 2, orig: 3, wow: 4, lofi: 5, echo: 6, stutter: 7 } as const;

/** 画面 → エンジン：テープ（どれも同じ長さ・同じサンプルレート、カバーの 0 拍から） */
export interface ManekkoTape {
  kind: 'tape';
  sr: number;
  bpm: number;
  vocal: Float32Array;
  inst: Float32Array;
  orig: Float32Array;
}

export interface ManekkoDisplay {
  /** 鳴っている位置（拍）。止まっていれば -1 */
  beat: number;
  /** テープが入っているか */
  loaded: boolean;
}

export class ManekkoEngine implements ToyEngine<ManekkoDisplay> {
  readonly params: Float32Array;
  readonly paramDefs = MANEKKO_PARAMS;
  display: ManekkoDisplay = { beat: -1, loaded: false };
  displayVersion = 0;
  powered = false;
  private tape: ManekkoTape | null = null;
  private pos = 0; // テープの位置（テープのサンプル）
  private oldPos = -1; // 位置を合わせ直すときの、なめらかにつなぐ前の位置
  private xf = 0; // つなぎの残り
  private gain = 0;
  private held = new Set<number>();
  private ph = 0; // WOW のゆれ
  private fl = 0; // フラッター
  private lp1 = 0;
  private lp2 = 0;
  private echoBuf: Float32Array;
  private echoW = 0;
  private stutterFrom = -1;
  private stutterLen = 0;
  private count = 0;
  private boot = -1;

  private rng: Rng;

  constructor(private sr: number, seed = 8) {
    this.rng = new Rng(seed);
    this.params = Float32Array.from(MANEKKO_PARAMS.map((p) => p.default));
    this.echoBuf = new Float32Array(Math.round(sr * 1.2));
  }

  setParam(index: number, value: number): void {
    this.params[index] = value;
    if (index === MK.stutter) {
      if (value > 0.5 && this.tape) { this.stutterLen = Math.max(64, Math.round(((60 / this.tape.bpm) / 8) * this.tape.sr)); this.stutterFrom = this.pos; }
      else this.stutterFrom = -1;
    }
  }

  private barLen(): number { return this.tape ? ((4 * 60) / this.tape.bpm) * this.tape.sr : 0; }

  keyDown(key: number): void {
    if (!this.powered || !this.tape || key < 0 || key >= MK_MAX_BARS) return;
    const want = key * this.barLen();
    // 鳴っている途中なら、なめらかにつないで位置を合わせる（ずれが小さくても合わせ直す）
    if (this.held.size && Math.abs(want - this.pos) > 1) { this.oldPos = this.pos; this.xf = Math.round(this.sr * 0.006); }
    this.pos = want;
    this.held.add(key);
  }
  keyUp(key: number): void { this.held.delete(key); }

  powerOn(): void { if (!this.powered) this.boot = 0; this.powered = true; }
  powerOff(): void { this.powered = false; this.held.clear(); }
  reset(): void { this.held.clear(); this.stutterFrom = -1; this.echoBuf.fill(0); }

  custom(d: unknown): void {
    const m = d as ManekkoTape;
    if (m && m.kind === 'tape') { this.tape = m; this.display = { ...this.display, loaded: true }; this.displayVersion++; }
  }

  private read(buf: Float32Array, p: number): number {
    const i = Math.floor(p), f = p - i;
    if (i < 0 || i + 1 >= buf.length) return 0;
    return buf[i] + (buf[i + 1] - buf[i]) * f;
  }
  private mixAt(p: number): number {
    const t = this.tape!, P = this.params;
    return this.read(t.vocal, p) * P[MK.vocal] + this.read(t.inst, p) * P[MK.karaoke] + this.read(t.orig, p) * P[MK.orig];
  }

  process(out: Float32Array): void {
    const n = out.length, P = this.params, t = this.tape;
    const playing = this.powered && !!t && this.held.size > 0;
    const step = t ? t.sr / this.sr : 1;
    const wow = P[MK.wow], lofi = P[MK.lofi];
    const cut = 1 - Math.exp((-2 * Math.PI * (9000 - lofi * 7000)) / this.sr);
    const drive = 1 + lofi * 3;
    const echoD = t ? Math.min(this.echoBuf.length - 1, Math.round(((60 / t.bpm) * 0.75) * this.sr)) : 1;
    const echo = P[MK.echo];
    for (let i = 0; i < n; i++) {
      // 鳴らす・止めるは、なめらかに（プチッとしないように）
      this.gain += ((playing ? 1 : 0) - this.gain) * 0.004;
      let v = 0;
      if (t && this.gain > 1e-4) {
        // テープのよれ：ゆっくりの WOW と細かいフラッター（平均の速さは変えない）
        this.ph += 0.55 / this.sr; this.fl += 7.3 / this.sr;
        const rate = 1 + wow * (0.006 * Math.sin(2 * Math.PI * this.ph) + 0.0015 * Math.sin(2 * Math.PI * this.fl));
        let p = this.pos;
        if (this.stutterFrom >= 0) p = this.stutterFrom + ((this.pos - this.stutterFrom) % this.stutterLen);
        v = this.mixAt(p);
        if (this.xf > 0) { const k = this.xf / Math.round(this.sr * 0.006); v = v * (1 - k) + this.mixAt(this.oldPos) * k; this.oldPos += step; this.xf--; }
        if (playing) this.pos += step * rate;
        v *= this.gain;
      }
      // LO-FI：こもり（2 段のローパス）＋カセットの軽い歪み＋サー
      this.lp1 += cut * (v - this.lp1); this.lp2 += cut * (this.lp1 - this.lp2);
      v = Math.tanh(this.lp2 * drive) / Math.tanh(drive) + (lofi > 0.05 && this.gain > 0.01 ? this.rng.bi() * 0.002 * lofi : 0);
      // テープエコー（付点 8 分）
      const r = this.echoBuf[(this.echoW - echoD + this.echoBuf.length) % this.echoBuf.length];
      this.echoBuf[this.echoW] = v + r * echo * 0.6;
      this.echoW = (this.echoW + 1) % this.echoBuf.length;
      v += r * echo;
      // 電源を入れたとき：テープが回り出す「カチャ・ウィーン」
      if (this.boot >= 0) {
        const b = this.boot / this.sr;
        if (b < 0.6) v += (b < 0.03 ? this.rng.bi() * 0.3 * (1 - b / 0.03) : 0) + Math.sin(2 * Math.PI * (120 + 300 * b) * b) * 0.08 * (1 - b / 0.6);
        this.boot = b < 0.6 ? this.boot + 1 : -1;
      }
      out[i] = this.powered ? v * P[MK.volume] : 0;
    }
    if (++this.count >= 6) {
      this.count = 0;
      const beat = playing && t ? (this.pos / t.sr) * (t.bpm / 60) : -1;
      if (Math.abs(beat - this.display.beat) > 0.05 || (beat < 0) !== (this.display.beat < 0)) { this.display = { beat, loaded: !!t }; this.displayVersion++; }
    }
  }

  status(): ToyStatus {
    return { powered: this.powered, playing: this.held.size > 0 && !!this.tape, leds: { tape: this.tape ? 1 : 0 }, fx: {} };
  }
}
