// ラック・スタジオに並べる PAKU-PAKU 16。おもちゃの共通の形（ToyEngine）に合わせた殻。
// キー   0〜159 = パッド（A-01〜J-16）
//      304〜399 = パッド（K-01〜P-16。あとから増やしたバンク。前に作った曲のキーがずれないよう後ろに足した）
//      160〜207 = メロディ：MELO PAD の音を、音程を変えて弾く（184 = 元の高さ、±24 半音）
//      208〜255 = ベース：BASS PAD の音を、音程を変えて弾く（232 = 元の高さ）
//      256〜303 = 和音：CHORD PAD の音を、音程を変えて重ねて弾く（280 = 元の高さ）
// 音と設定は、最初は工場出荷の音（バンク A = ドラム、B = おもちゃの音、C〜G = ジャンルの楽器）。画面がサンプラーのページの保存を読んだら custom で上書きする。
import type { ParamDef } from '../../core/params';
import type { ToyEngine, ToyStatus } from '../../core/toy';
import type { BendState } from '../dsp/bend';
import { SamplerEngine } from '../dsp/engine';
import { FACTORY_BANKS, factoryBank, factoryParams, type FactorySound } from '../dsp/factory';
import type { FxSlot } from '../dsp/fx';
import { PADS, PAD_COUNT, type PadParams, type SampleBuf } from '../dsp/types';

export const MELO_KEY = 160;
export const BASS_KEY = 208;
export const CHORD_KEY = 256;
/** あとから増やしたバンク K〜P のパッドのキー（パッド 160 → キー 304） */
export const EXTRA_KEY = 304;
/** キー 0〜159 で鳴らせるパッドの数（A〜J） */
const LOW_PADS = 160;
export const KEY_COUNT = EXTRA_KEY + PAD_COUNT - LOW_PADS;
/** パッド番号 → キー */
export const padKey = (pad: number) => (pad < LOW_PADS ? pad : EXTRA_KEY + pad - LOW_PADS);
/** キー → パッド番号（パッドのキーでなければ -1） */
export const keyPad = (key: number) => (key >= 0 && key < LOW_PADS ? key : key >= EXTRA_KEY && key < KEY_COUNT ? key - EXTRA_KEY + LOW_PADS : -1);
/** メロディ・ベースのキーの「元の高さ」（真ん中） */
export const MELO_ROOT_KEY = MELO_KEY + 24;
export const BASS_ROOT_KEY = BASS_KEY + 24;
export const CHORD_ROOT_KEY = CHORD_KEY + 24;
/** 工場出荷の音で、メロディ（B-09 TOY PNO＝C5）とベース（B-02 BASS C＝C2）の元の高さ（MIDI） */
export const MELO_ROOT_MIDI = 72;
export const BASS_ROOT_MIDI = 36;

export const SAMPLER_PARAMS: readonly ParamDef[] = [
  { id: 'volume', name: 'VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.8, midiCC: 7 },
  { id: 'stop', name: 'STOP', kind: 'momentary', min: 0, max: 1, default: 0 },
  { id: 'meloPad', name: 'MELO PAD', kind: 'stepped', min: 0, max: PAD_COUNT - 1, default: 24 },
  { id: 'bassPad', name: 'BASS PAD', kind: 'stepped', min: 0, max: PAD_COUNT - 1, default: 17 },
  { id: 'bend', name: 'BEND', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 1 },
  // ---- 後付けの改造パーツ（全部のパッドに効く） ----
  { id: 'pitch', name: 'PITCH', kind: 'stepped', min: -12, max: 12, default: 0, midiCC: 70 },
  { id: 'start', name: 'START', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 71 },
  { id: 'cutoff', name: 'CUTOFF', kind: 'continuous', min: 0, max: 1, default: 1, midiCC: 74 },
  { id: 'reso', name: 'RESO', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 75 },
  { id: 'drive', name: 'DRIVE', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 72 },
  { id: 'crush', name: 'CRUSH', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 73 },
  { id: 'echo', name: 'ECHO', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 91 },
  { id: 'echoTime', name: 'E.TIME', kind: 'continuous', min: 0, max: 1, default: 0.45, midiCC: 92 },
  { id: 'bendSpeed', name: 'B.SPEED', kind: 'continuous', min: 0, max: 1, default: 0.5, midiCC: 93 },
  { id: 'reverse', name: 'REV', kind: 'toggle', min: 0, max: 1, default: 0, labels: ['OFF', 'ON'] },
  { id: 'fx', name: 'FX', kind: 'toggle', min: 0, max: 1, default: 1, labels: ['BYPASS', 'ON'] },
  { id: 'chordPad', name: 'CHORD PAD', kind: 'stepped', min: 0, max: PAD_COUNT - 1, default: 24 },
];
export const SP = {
  volume: 0, stop: 1, meloPad: 2, bassPad: 3, bend: 4,
  pitch: 5, start: 6, cutoff: 7, reso: 8, drive: 9, crush: 10, echo: 11, echoTime: 12, bendSpeed: 13, reverse: 14, fx: 15, chordPad: 16,
} as const;

/** 画面 → エンジンの専用データ */
export type SamplerCustom =
  | { kind: 'pad'; pad: number; data: SampleBuf | null; p: PadParams }
  | { kind: 'meta'; bpm: number; fx: FxSlot[]; bend?: BendState };

export interface SamplerDisplay {
  /** 鳴っているパッド */
  playing: number[];
  /** 鳴っている音の再生位置（パッド、音全体の 0〜1）。液晶の波形に線を引く */
  pos: [number, number][];
}

/** MIDI 書き出し：キー → ノート（パッド = 36〜51、メロディ = C5、ベース = C2、和音 = C4 が元の高さ） */
export const samplerNote = (k: number): number =>
  keyPad(k) >= 0 ? 36 + (keyPad(k) % PADS) : k < BASS_KEY ? 72 + (k - MELO_ROOT_KEY) : k < CHORD_KEY ? 36 + (k - BASS_ROOT_KEY) : 60 + (k - CHORD_ROOT_KEY);

/** 中の音の合計を下げておく量（和音・ドラム・ベースが重なっても中で歪まないように） */
const HEADROOM = 0.7;

// 工場出荷の音は重いので、1 回だけ作る（作り直すたびに使い回す）
let factory: FactorySound[][] | null = null;
const factoryOnce = () => (factory ??= Array.from({ length: FACTORY_BANKS }, (_, b) => factoryBank(b)));

/** 電源を入れたときの「パクッ、パクッ」 */
function chomp(sr: number): Float32Array {
  const x = new Float32Array(Math.round(sr * 0.42));
  for (const [t0, f] of [[0, 520], [0.2, 700]] as const) {
    const o = Math.round(t0 * sr);
    let ph = 0;
    for (let i = 0; i < sr * 0.16 && o + i < x.length; i++) {
      ph += (2 * Math.PI * f * (1 - (i / (sr * 0.16)) * 0.6)) / sr;
      x[o + i] += (Math.sign(Math.sin(ph)) * 0.25 + Math.sin(ph * 0.5) * 0.2) * Math.exp(-i / (sr * 0.04));
    }
  }
  return x;
}

export class SamplerToy implements ToyEngine<SamplerDisplay> {
  readonly params: Float32Array;
  readonly paramDefs = SAMPLER_PARAMS;
  readonly eng: SamplerEngine;
  display: SamplerDisplay = { playing: [], pos: [] };
  displayVersion = 0;
  powered = false;
  private l = new Float32Array(128);
  private r = new Float32Array(128);
  private count = 0;
  private lastKey = '';
  private boot: Float32Array;
  private bootPos = -1;
  /** サンプラーのページで決めたベンド（BEND ノブが 0 のときはこれ） */
  private pageBend: BendState | undefined;
  /** サンプラーのページで決めたエフェクト（FX スイッチで丸ごと切れる） */
  private pageFx: FxSlot[] | undefined;
  // 出口の改造パーツ：フィルター・ドライブ・クラッシュ・エコー
  private s1 = [0, 0];
  private s2 = [0, 0];
  private hold = [0, 0];
  private holdN = 0;
  private echoL: Float32Array;
  private echoR: Float32Array;
  private ml = new Float32Array(128);
  private mr = new Float32Array(128);
  private echoW = 0;
  private echoD = 0;

  constructor(private sr: number) {
    this.eng = new SamplerEngine(sr);
    this.params = Float32Array.from(SAMPLER_PARAMS.map((p) => p.default));
    factoryOnce().forEach((bank, b) => bank.forEach((s, i) => { this.eng.setSample(b * PADS + i, s.buf); this.eng.setParams(b * PADS + i, factoryParams(s)); }));
    this.boot = chomp(sr);
    this.echoL = new Float32Array(Math.round(sr * 0.8));
    this.echoR = new Float32Array(Math.round(sr * 0.8));
  }

  setParam(index: number, value: number): void {
    this.params[index] = value;
    if (index === SP.stop && value > 0.5) this.eng.stopAll();
    if (index === SP.bend || index === SP.bendSpeed) this.applyBend();
    if (index === SP.fx) this.applyFx();
  }

  private applyFx(): void {
    if (!this.pageFx) return;
    const on = this.params[SP.fx] > 0.5;
    this.pageFx.forEach((f, i) => this.eng.setFx(i, { ...f, on: f.on && on }));
  }

  /** 鳴らすときの変化（PITCH・START・REV のツマミ）。tag = 音程を変えて弾くキー（離すときにその音だけ止める） */
  private mod(extraPitch = 0, tag?: number) {
    const st = this.params[SP.start];
    return { pitch: Math.round(this.params[SP.pitch]) + extraPitch, start: st > 0.005 ? st : undefined, reverse: this.params[SP.reverse] > 0.5 || undefined, poly: tag !== undefined || undefined, tag };
  }
  /** 音程を変えて弾くキー → [パッド, 元の高さからの半音]（パッドのキーなら null） */
  private keyed(key: number): [number, number] | null {
    if (key >= MELO_KEY && key < BASS_KEY) return [this.params[SP.meloPad] | 0, key - MELO_ROOT_KEY];
    if (key >= BASS_KEY && key < CHORD_KEY) return [this.params[SP.bassPad] | 0, key - BASS_ROOT_KEY];
    if (key >= CHORD_KEY && key < EXTRA_KEY) return [this.params[SP.chordPad] | 0, key - CHORD_ROOT_KEY];
    return null;
  }

  /** BEND ノブ：上げるほどジャンパー線が増え、強くなる（0 ならサンプラーのページの設定） */
  private applyBend(): void {
    const k = this.params[SP.bend];
    if (k < 0.02) { if (this.pageBend) this.eng.bender.st = { ...this.pageBend, wires: [...this.pageBend.wires] }; else this.eng.bender.st = { ...this.eng.bender.st, wires: this.eng.bender.st.wires.map(() => false) }; return; }
    this.eng.bender.st = { wires: [k > 0.05, k > 0.35, k > 0.7, k > 0.15, k > 0.55, k > 0.85], amount: Math.min(1, 0.3 + k * 0.7), speed: this.params[SP.bendSpeed] };
  }

  keyDown(key: number): void {
    if (!this.powered) return;
    const pad = keyPad(key);
    if (pad >= 0) { this.eng.trigger(pad, 1, this.mod()); return; }
    const k = this.keyed(key);
    if (!k) return;
    this.eng.releaseTag(k[0], key); // 同じ音の押し直し
    // ベースは 1 音ずつ（前の音を止める）。メロディ・和音は重ねる。重ねる和音は 1 音ずつ少し弱く（積んでも割れないように）
    if (key >= BASS_KEY && key < CHORD_KEY) this.eng.trigger(k[0], 0.9, { ...this.mod(k[1]), poly: undefined, tag: key });
    else this.eng.trigger(k[0], key >= CHORD_KEY ? 0.55 : 0.85, this.mod(k[1], key));
  }
  keyUp(key: number): void {
    const pad = keyPad(key);
    if (pad >= 0) { this.eng.releasePad(pad); return; }
    const k = this.keyed(key);
    if (k) this.eng.releaseTag(k[0], key);
  }
  powerOn(): void {
    if (this.powered) return;
    this.powered = true;
    this.bootPos = 0;
  }
  powerOff(): void {
    this.powered = false;
    this.eng.stopAll();
  }
  reset(): void { this.eng.stopAll(); }
  /** 曲が止まった：鳴っている音を全部止める（長く伸びる音・ループが残らないように） */
  songStopped(): void { this.eng.stopAll(); }

  custom(d: unknown): void {
    const m = d as SamplerCustom;
    if (m.kind === 'pad') { this.eng.setSample(m.pad, m.data); this.eng.setParams(m.pad, m.p); }
    else if (m.kind === 'meta') {
      this.eng.bpm = m.bpm;
      this.pageFx = m.fx.map((f) => ({ ...f, k: [...f.k] }));
      this.applyFx();
      this.pageBend = m.bend;
      this.applyBend();
    }
  }

  /** モノラル（左右を混ぜる） */
  process(out: Float32Array): void {
    const n = out.length;
    if (this.ml.length !== n) { this.ml = new Float32Array(n); this.mr = new Float32Array(n); }
    this.processStereo(this.ml, this.mr);
    for (let i = 0; i < n; i++) out[i] = (this.ml[i] + this.mr[i]) * 0.5;
  }

  /** ステレオ：パッドごとの左右の位置（PAN）のまま出す */
  processStereo(L: Float32Array, R: Float32Array): void {
    const n = L.length;
    this.eng.master = HEADROOM; // 音量は改造パーツの後で（DRIVE で大きくならないように）。重なっても割れないよう少し余裕を持たせる
    this.eng.process(null, null, L, R);
    if (!this.powered) { L.fill(0); R.fill(0); }
    this.mangle(L, R);
    const vol = (this.params[SP.volume] * 1.25) / HEADROOM;
    for (const o of [L, R]) for (let i = 0; i < n; i++) {
      // 余裕を戻した分、大きすぎる所だけやわらかく抑える
      const x = o[i] * vol, a = Math.abs(x);
      o[i] = a < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
    }
    if (this.bootPos >= 0) {
      for (let i = 0; i < n && this.bootPos < this.boot.length; i++) { const v = this.boot[this.bootPos++] * this.params[SP.volume]; L[i] += v; R[i] += v; }
      if (this.bootPos >= this.boot.length) this.bootPos = -1;
    }
    // 鳴っているパッドを画面へ（変わったときだけ、ときどき）
    if (++this.count >= 8) {
      this.count = 0;
      const pos = this.eng.playing();
      const p = [...new Set(pos.map((x) => x[0]))].sort((a, b) => a - b);
      const k = pos.map((x) => `${x[0]}:${x[1].toFixed(3)}`).join(',');
      if (k !== this.lastKey) { this.lastKey = k; this.display = { playing: p, pos }; this.displayVersion++; }
    }
  }

  /** 出口の改造パーツ（左右それぞれ）：CRUSH（ビットとサンプルを落とす）→ DRIVE → CUTOFF・RESO（ローパス）→ ECHO（左右に跳ねる） */
  private mangle(Lo: Float32Array, Ro: Float32Array): void {
    const P = this.params, n = Lo.length;
    const crush = P[SP.crush], drive = P[SP.drive], cut = P[SP.cutoff], reso = P[SP.reso], echo = P[SP.echo];
    if (crush > 0.01) {
      const q = Math.pow(2, 12 - crush * 10), every = 1 + Math.floor(crush * crush * 24);
      for (let i = 0; i < n; i++) {
        if (this.holdN++ % every === 0) { this.hold[0] = Math.round(Lo[i] * q) / q; this.hold[1] = Math.round(Ro[i] * q) / q; }
        Lo[i] = this.hold[0];
        Ro[i] = this.hold[1];
      }
    }
    if (drive > 0.01) {
      const g = 1 + drive * 30, norm = 0.8 / Math.tanh(g); // いちばん大きい音はそのままの大きさ
      for (let i = 0; i < n; i++) { Lo[i] = Math.tanh(Lo[i] * g) * norm; Ro[i] = Math.tanh(Ro[i] * g) * norm; }
    }
    if (cut < 0.995 || reso > 0.01) {
      const fc = Math.min(20 * Math.pow(1000, cut), this.sr * 0.45);
      const g = Math.tan((Math.PI * fc) / this.sr), k = 2 - 1.95 * reso;
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      [Lo, Ro].forEach((o, c) => {
        let s1 = this.s1[c], s2 = this.s2[c];
        for (let i = 0; i < n; i++) {
          const v3 = o[i] - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
          s1 = 2 * v1 - s1;
          s2 = 2 * v2 - s2;
          o[i] = Math.tanh(v2);
        }
        this.s1[c] = s1; this.s2[c] = s2;
      });
    }
    // エコー：左 → 右 → 左…と跳ねる（ピンポン）。止めても余韻は残す（中身が無くなるまで回す）
    const len = this.echoL.length;
    const target = (0.03 + P[SP.echoTime] * 0.72) * this.sr;
    if (echo > 0.01 || this.echoD > 0) {
      const fb = 0.25 + echo * 0.55;
      const rd0 = (b: Float32Array, rd: number) => { const i0 = Math.floor(rd), f = rd - i0; const a = b[((i0 % len) + len) % len], c = b[(((i0 + 1) % len) + len) % len]; return a + (c - a) * f; };
      for (let i = 0; i < n; i++) {
        this.echoD += (target - this.echoD) * 0.0005;
        const rd = this.echoW - this.echoD;
        const yl = rd0(this.echoL, rd), yr = rd0(this.echoR, rd);
        const w = this.echoW % len;
        this.echoL[w] = (Lo[i] + Ro[i]) * 0.5 * echo + yr * fb;
        this.echoR[w] = yl * fb;
        this.echoW++;
        Lo[i] += yl;
        Ro[i] += yr;
      }
      if (echo <= 0.01) {
        let e = 0;
        for (let i = 0; i < len; i += 64) e = Math.max(e, Math.abs(this.echoL[i]), Math.abs(this.echoR[i]));
        if (e < 1e-4) { this.echoD = 0; this.echoL.fill(0); this.echoR.fill(0); }
      }
    }
  }

  status(): ToyStatus {
    return { powered: this.powered, playing: this.display.playing.length > 0, leds: {}, fx: { heat: Math.round(this.eng.bender.heat * 20) / 20 } };
  }
}
