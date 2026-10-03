// サンプラーの音の中心（DOM 非依存）。160 パッドの音と設定を持ち、32 ボイスで鳴らして、ステレオで出す。
// 録音（マイク入力・リサンプル）もここでする。
import { PAD_COUNT, REC_MAX_SEC, attackSec, cutoffHz, defaultPad, releaseSec, volGain, type PadParams, type SampleBuf, type TrigMod } from './types';

const MAX_VOICES = 32;
/** 止められた音を消す時間（プチッと鳴らないように） */
const KILL_SEC = 0.003;

class Voice {
  active = false;
  pad = -1;
  buf: SampleBuf | null = null;
  pos = 0;
  inc = 1;
  lo = 0; // 鳴らす範囲（フレーム）
  hi = 0;
  loopLo = 0; // ループの戻り先
  mod: TrigMod | undefined;
  reverse = false;
  loop = false;
  gate = false;
  /** 0 = 立ち上がり 1 = 保持 2 = 余韻 */
  stage = 0;
  env = 0;
  atkInc = 1;
  relCoef = 0;
  velGain = 1;
  gl = 1; // 左右の音量
  gr = 1;
  // フィルター
  filt = false;
  a1 = 0; a2 = 0; a3 = 0; k = 2;
  s1 = [0, 0];
  s2 = [0, 0];
  age = 0;

  release(coef: number): void {
    if (this.stage === 2 && this.relCoef <= coef) return;
    this.stage = 2;
    this.relCoef = coef;
  }
}

export interface Recorded {
  data: SampleBuf | null;
}

export class SamplerEngine {
  readonly pads: PadParams[] = Array.from({ length: PAD_COUNT }, defaultPad);
  readonly samples: (SampleBuf | null)[] = Array.from({ length: PAD_COUNT }, () => null);
  private voices = Array.from({ length: MAX_VOICES }, () => new Voice());
  private ageCounter = 0;
  master = 0.8;
  monitor = false;
  // メーター
  inPeak = 0;
  outPeak = 0;
  // 録音
  private recSrc: 'input' | 'output' | null = null;
  private recWaiting = false;
  private recChunks: [Float32Array, Float32Array][] = [];
  private recLen = 0;
  private killCoef: number;

  constructor(readonly sr: number) {
    this.killCoef = Math.exp(-1 / (KILL_SEC * sr));
  }

  setSample(pad: number, data: SampleBuf | null): void {
    this.samples[pad] = data && data.ch.length && data.ch[0].length ? data : null;
    for (const v of this.voices) if (v.active && v.pad === pad) v.active = false;
  }

  setParams(pad: number, p: PadParams): void {
    this.pads[pad] = { ...p };
    // 鳴っている音にも、音量・パン・音程・フィルターをすぐ反映
    for (const v of this.voices) if (v.active && v.pad === pad) this.applyLive(v, withMod(p, v.mod));
  }

  private applyLive(v: Voice, p: PadParams): void {
    const buf = v.buf!;
    v.inc = (buf.sr / this.sr) * Math.pow(2, (p.pitch + p.fine / 100) / 12);
    const g = volGain(p.vol) * v.velGain;
    const a = ((Math.max(-1, Math.min(1, p.pan)) + 1) * Math.PI) / 4;
    v.gl = Math.cos(a) * g;
    v.gr = Math.sin(a) * g;
    v.filt = p.cutoff < 0.999 || p.reso > 0.001;
    if (v.filt) {
      const fc = Math.min(cutoffHz(p.cutoff), this.sr * 0.45);
      const g2 = Math.tan((Math.PI * fc) / this.sr);
      v.k = 2 - 1.96 * p.reso;
      v.a1 = 1 / (1 + g2 * (g2 + v.k));
      v.a2 = g2 * v.a1;
      v.a3 = g2 * v.a2;
    }
    v.loop = p.loop;
    v.gate = p.gate;
  }

  /** パッドを鳴らす。vel は 0〜1、mod は 16 レベルの変化。ロール中は押している間くり返す */
  trigger(pad: number, vel = 1, mod?: TrigMod): void {
    if (this.roll.on) this.held.set(pad, { vel, mod, next: this.clock + this.rollFrames() });
    this.fire(pad, vel, mod);
  }

  private fire(pad: number, vel: number, mod?: TrigMod): void {
    const buf = this.samples[pad];
    if (!buf) return;
    const p = withMod(this.pads[pad], mod);
    // ループで GATE なし：鳴っていれば止める（押すたびに入／切）
    if (p.loop && !p.gate) {
      const playing = this.voices.filter((v) => v.active && v.pad === pad && v.stage !== 2);
      if (playing.length) { for (const v of playing) v.release(Math.exp(-1 / (releaseSec(p.release) * this.sr))); return; }
    }
    // 同じパッドの押し直し（POLY でなければ前の音を止める）・ミュートグループ
    for (const v of this.voices) {
      if (!v.active) continue;
      if ((v.pad === pad && !p.poly) || (p.mute > 0 && v.pad !== pad && this.pads[v.pad].mute === p.mute)) v.release(this.killCoef);
    }
    const len = buf.ch[0].length;
    let lo = Math.floor(Math.max(0, Math.min(1, p.start)) * len);
    let hi = Math.floor(Math.max(0, Math.min(1, p.end)) * len);
    if (hi < lo) [lo, hi] = [hi, lo];
    if (hi - lo < 2) return;
    const v = this.allocVoice();
    v.active = true;
    v.pad = pad;
    v.buf = buf;
    v.lo = lo;
    v.hi = hi;
    v.loopLo = Math.max(lo, Math.min(hi - 2, Math.floor(Math.max(0, Math.min(1, p.loopStart)) * len)));
    v.mod = mod;
    v.reverse = p.reverse;
    v.pos = p.reverse ? hi - 1 : lo;
    v.age = ++this.ageCounter;
    const atk = attackSec(p.attack);
    v.stage = atk > 0.0005 ? 0 : 1;
    v.env = v.stage === 0 ? 0 : 1;
    v.atkInc = atk > 0.0005 ? 1 / (atk * this.sr) : 1;
    v.relCoef = Math.exp(-1 / (releaseSec(p.release) * this.sr));
    v.s1 = [0, 0];
    v.s2 = [0, 0];
    const vk = Math.max(0, Math.min(1, vel));
    v.velGain = 1 - p.vel + p.vel * Math.pow(vk, 1.4);
    this.applyLive(v, p);
  }

  /** パッドを離した（GATE のパッドだけ止まる・ロールも止まる） */
  releasePad(pad: number): void {
    this.held.delete(pad);
    for (const v of this.voices) {
      if (v.active && v.pad === pad && v.gate && v.stage !== 2) v.release(Math.exp(-1 / (releaseSec(this.pads[pad].release) * this.sr)));
    }
  }

  stopAll(): void {
    this.held.clear();
    for (const v of this.voices) if (v.active) v.release(this.killCoef);
  }

  // ---------------- テンポ・ロール ----------------
  bpm = 120;
  /** 出した音の数（サンプル）。ロールやシーケンサーの時計 */
  clock = 0;
  roll = { on: false, rate: 0.25 };
  private held = new Map<number, { vel: number; mod?: TrigMod; next: number }>();
  private rollFrames(): number {
    return Math.max(16, Math.round(((this.roll.rate * 60) / this.bpm) * this.sr));
  }
  setRoll(on: boolean, rate: number): void {
    this.roll = { on, rate };
    if (!on) this.held.clear();
  }
  /** 次の予定（ロールの連打）まで何サンプルか（max まで） */
  private untilNext(max: number): number {
    let d = max;
    for (const h of this.held.values()) d = Math.min(d, Math.max(0, h.next - this.clock));
    return d;
  }
  /** いまの時刻の予定を鳴らす */
  private fireDue(): void {
    for (const [pad, h] of this.held) {
      if (h.next <= this.clock) {
        this.fire(pad, h.vel, h.mod);
        h.next += this.rollFrames();
      }
    }
  }

  private allocVoice(): Voice {
    let best = this.voices[0];
    for (const v of this.voices) {
      if (!v.active) return v;
      // 空きがなければ、余韻中のいちばん古い音、なければいちばん古い音を使う
      const score = (v.stage === 2 ? 0 : 1e9) + v.age;
      const bs = (best.stage === 2 ? 0 : 1e9) + best.age;
      if (score < bs) best = v;
    }
    return best;
  }

  /** 鳴っているパッドと位置（0〜1） */
  playing(): [number, number][] {
    const out: [number, number][] = [];
    for (const v of this.voices) if (v.active && v.buf && v.stage !== 2) out.push([v.pad, v.pos / v.buf.ch[0].length]);
    return out;
  }

  // ---------------- 録音 ----------------
  recStart(source: 'input' | 'output', auto: boolean): void {
    this.recSrc = source;
    this.recWaiting = auto;
    this.recChunks = [];
    this.recLen = 0;
  }
  get recording(): boolean { return this.recSrc !== null; }
  get recWaitingForSound(): boolean { return this.recSrc !== null && this.recWaiting; }
  get recSeconds(): number { return this.recLen / this.sr; }

  recStop(): SampleBuf | null {
    this.recSrc = null;
    if (!this.recLen) return null;
    const l = new Float32Array(this.recLen), r = new Float32Array(this.recLen);
    let o = 0;
    for (const [a, b] of this.recChunks) { l.set(a, o); r.set(b, o); o += a.length; }
    this.recChunks = [];
    this.recLen = 0;
    // 左右が同じならモノラルにする（容量半分）
    let same = true;
    for (let i = 0; i < l.length; i += 7) if (Math.abs(l[i] - r[i]) > 1e-4) { same = false; break; }
    return { sr: this.sr, ch: same ? [l] : [l, r] };
  }

  private recPush(l: Float32Array, r: Float32Array): void {
    if (this.recWaiting) {
      let peak = 0;
      for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      if (peak < 0.03) return;
      this.recWaiting = false;
    }
    if (this.recLen >= REC_MAX_SEC * this.sr) return;
    this.recChunks.push([l.slice(), r.slice()]);
    this.recLen += l.length;
  }

  // ---------------- 音を作る ----------------
  /** inL/inR = 入力（マイク。無ければ null）。outL/outR を埋める */
  process(inL: Float32Array | null, inR: Float32Array | null, outL: Float32Array, outR: Float32Array): void {
    const n = outL.length;
    outL.fill(0);
    outR.fill(0);
    // 予定（ロールなど）の時刻で区切って鳴らす（ブロックの途中でも、ぴったりの時刻に）
    let off = 0;
    while (off < n) {
      this.fireDue();
      const len = Math.max(1, this.untilNext(n - off));
      const l = outL.subarray(off, off + len), r = outR.subarray(off, off + len);
      for (const v of this.voices) if (v.active) this.renderVoice(v, l, r, len);
      off += len;
      this.clock += len;
    }
    // 入力のモニター
    let ip = 0;
    if (inL) {
      const r = inR ?? inL;
      for (let i = 0; i < n; i++) {
        ip = Math.max(ip, Math.abs(inL[i]), Math.abs(r[i]));
        if (this.monitor) { outL[i] += inL[i]; outR[i] += r[i]; }
      }
    }
    // マスター音量 → やわらかいクリップ
    let op = 0;
    for (let i = 0; i < n; i++) {
      const a = softClip(outL[i] * this.master), b = softClip(outR[i] * this.master);
      outL[i] = a;
      outR[i] = b;
      op = Math.max(op, Math.abs(a), Math.abs(b));
    }
    this.inPeak = Math.max(ip, this.inPeak * 0.9);
    this.outPeak = Math.max(op, this.outPeak * 0.9);
    if (this.recSrc === 'input' && inL) this.recPush(inL, inR ?? inL);
    else if (this.recSrc === 'output') this.recPush(outL, outR);
  }

  private renderVoice(v: Voice, outL: Float32Array, outR: Float32Array, n: number): void {
    const buf = v.buf!;
    const L = buf.ch[0], R = buf.ch[1] ?? buf.ch[0];
    const stereo = buf.ch.length > 1;
    for (let i = 0; i < n; i++) {
      // エンベロープ
      if (v.stage === 0) { v.env += v.atkInc; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
      else if (v.stage === 2) { v.env *= v.relCoef; if (v.env < 1e-4) { v.active = false; return; } }
      // 範囲の外に出たら：ループなら戻る、そうでなければ終わり
      if (v.reverse ? v.pos < v.lo : v.pos >= v.hi - 1) {
        if (!v.loop) { v.active = false; return; }
        const lo = v.reverse ? v.lo : v.loopLo;
        const span = v.hi - 1 - lo;
        if (span <= 0) { v.active = false; return; }
        v.pos = v.reverse ? v.pos + span : v.pos - span;
      }
      const i0 = Math.floor(v.pos), f = v.pos - i0;
      const i1 = Math.min(i0 + 1, L.length - 1);
      let a = L[i0] + (L[i1] - L[i0]) * f;
      let b = stereo ? R[i0] + (R[i1] - R[i0]) * f : a;
      if (v.filt) { a = this.svf(v, 0, a); b = stereo ? this.svf(v, 1, b) : a; }
      outL[i] += a * v.gl * v.env;
      outR[i] += b * v.gr * v.env;
      v.pos += v.reverse ? -v.inc : v.inc;
    }
  }

  private svf(v: Voice, c: number, x: number): number {
    const v3 = x - v.s2[c];
    const v1 = v.a1 * v.s1[c] + v.a2 * v3;
    const v2 = v.s2[c] + v.a2 * v.s1[c] + v.a3 * v3;
    v.s1[c] = 2 * v1 - v.s1[c];
    v.s2[c] = 2 * v2 - v.s2[c];
    return v2;
  }
}

/** 16 レベルの変化を足した設定 */
function withMod(p: PadParams, m?: TrigMod): PadParams {
  if (!m) return p;
  return {
    ...p,
    pitch: p.pitch + (m.pitch ?? 0),
    cutoff: m.cutoff ?? p.cutoff,
    attack: m.attack ?? p.attack,
    start: m.start !== undefined ? p.start + (p.end - p.start) * m.start : p.start,
  };
}

/** 小さい音はそのまま、大きい音はなめらかに ±1 に収める */
function softClip(x: number): number {
  if (x > 1.5) return 1;
  if (x < -1.5) return -1;
  return x - (x * x * x) / 6.75;
}
