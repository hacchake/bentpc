// TELEKEY TK-6 の音のエンジン（おもちゃ1台分）。DOM・Web Audio に依存しない。
// 取り込んだ動画の音（input）を 2 秒のリングバッファに書き続け、押しているグリッチキーに応じて
// 「どこをどう読むか」（連打・逆再生・ピッチ・テープストップ・粒の保持）と「読んだ音をどう壊すか」を変える。
// 楽器キーの音（ビープ・ドラム・ドローンなど）を足す。いま効いているグリッチは status で画面（映像）に知らせる。

import { defaultsOf } from '../../../core/params';
import { Rng, hashSeed } from '../../../core/rng';
import type { ToyEngine, ToyStatus } from '../../../core/toy';
import { TELE_INDEX, TELE_KEYS, TELE_PARAMS, type TeleParamId } from '../params';

export const TELE_SEED = 0x7e1e6e7;
const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** 楽器キーの音（1 つのキーに 1 声） */
interface Inst {
  kind: number;
  note: number;
  t: number; // 経過サンプル
  held: boolean;
  ph: number;
  ph2: number;
  env: number;
  sh: number;
}

export class TeleEngine implements ToyEngine<{ text: string }> {
  readonly params = defaultsOf(TELE_PARAMS);
  readonly paramDefs = TELE_PARAMS;
  readonly wantsInput = true;
  powered = false;
  private rng: Rng;
  // 押しているグリッチ（24bit）と押した順番
  mask = 0;
  private order: number[] = [];
  private freeze = false;
  private pitchSemis = 0; // ↑↓ で変わる
  // リングバッファ
  private buf: Float32Array;
  private w = 0;
  // 読み出し
  private rd = 0; // 読み出し位置（書き込み位置からの遅れ、サンプル）
  private segStart = 0;
  private segLen = 0;
  private segPos = 0;
  private tapeRate = 1;
  // 壊す処理の状態
  private held = 0;
  private holdCnt = 0;
  private lp = 0;
  private hpLp = 0;
  private ringPh = 0;
  private wobPh = 0;
  private chopPh = 0;
  private panPh = 0;
  private echo: Float32Array;
  private echoPos = 0;
  private flangePh = 0;
  private gateEnv = 0;
  // 楽器
  private inst: Inst[] = [];
  private hits = 0;
  private lastHit = -1;
  // 出力段
  private vol = 0;
  private gate = 0;
  private level = 0;
  private dcX = 0;
  private dcY = 0;
  display = { text: '' };
  displayVersion = 0;

  constructor(readonly sampleRate: number, readonly seed = TELE_SEED) {
    this.rng = new Rng(hashSeed(seed, 'tele'));
    this.buf = new Float32Array(Math.ceil(sampleRate * 2));
    this.echo = new Float32Array(Math.ceil(sampleRate * 0.8));
  }

  p(id: TeleParamId): number {
    return this.params[TELE_INDEX[id]];
  }

  setParam(index: number, value: number): void {
    const def = TELE_PARAMS[index];
    if (!def) return;
    this.params[index] = Math.max(def.min, Math.min(def.max, def.kind === 'continuous' ? value : Math.round(value)));
  }

  powerOn(): void {
    this.powered = true;
  }

  powerOff(): void {
    this.powered = false;
    this.mask = 0;
    this.order = [];
    this.freeze = false;
    this.inst = [];
  }

  keyDown(key: number): void {
    const k = TELE_KEYS[key];
    if (!k || !this.powered) return;
    const r = k.role;
    if (r.r === 'glitch') {
      this.mask |= 1 << r.n;
      this.order = [...this.order.filter((x) => x !== r.n), r.n];
      this.startRead(r.n);
    } else if (r.r === 'inst') {
      this.inst = this.inst.filter((v) => v.kind !== r.n || v.note !== r.note);
      this.inst.push({ kind: r.n, note: 48 + r.note, t: 0, held: true, ph: 0, ph2: 0, env: 1, sh: 0 });
      if (this.inst.length > 12) this.inst.shift();
      this.hits++;
      this.lastHit = r.n;
    } else if (r.r === 'fn') {
      switch (r.f) {
        case 'freeze': this.freeze = true; this.startSeg(Math.floor(this.sampleRate * 0.12)); break;
        case 'speedUp': this.pitchSemis = Math.min(24, this.pitchSemis + 1); break;
        case 'speedDown': this.pitchSemis = Math.max(-24, this.pitchSemis - 1); break;
        case 'speedReset': this.pitchSemis = 0; break;
        case 'release': this.mask = 0; this.order = []; this.freeze = false; break;
      }
    }
  }

  keyUp(key: number): void {
    const k = TELE_KEYS[key];
    if (!k) return;
    const r = k.role;
    if (r.r === 'glitch') {
      this.mask &= ~(1 << r.n);
      this.order = this.order.filter((x) => x !== r.n);
      if (this.order.length) this.startRead(this.order[this.order.length - 1]);
    } else if (r.r === 'inst') {
      for (const v of this.inst) if (v.kind === r.n && v.note === 48 + r.note) v.held = false;
    } else if (r.r === 'fn' && r.f === 'freeze') this.freeze = false;
  }

  /** 読み出し方を変えるグリッチを押した瞬間の準備 */
  private startRead(n: number): void {
    const sr = this.sampleRate;
    switch (n) {
      case 0: this.startSeg(Math.floor(sr * (0.04 + this.rng.next() * 0.12))); break; // STUTTER
      case 6: this.rd = Math.floor(sr * 0.05); break; // REVERSE
      case 9: this.tapeRate = 1; break; // TAPE STOP
      case 12: this.startSeg(Math.floor(sr * 0.03)); break; // GRAIN HOLD
      case 2: case 23: this.rd = 0; break;
    }
  }

  private startSeg(len: number): void {
    this.segLen = Math.max(32, len);
    this.segStart = (this.w - this.segLen + this.buf.length) % this.buf.length;
    this.segPos = 0;
  }

  private read(delay: number): number {
    const L = this.buf.length;
    const pos = (this.w - 1 - delay + L * 4) % L;
    const i = Math.floor(pos), f = pos - i;
    return this.buf[i] * (1 - f) + this.buf[(i + 1) % L] * f;
  }

  status(): ToyStatus {
    return {
      powered: this.powered,
      playing: this.level > 0.001,
      leds: { level: Math.round(Math.min(1, this.level * 4) * 20) / 20 },
      fx: { mask: this.mask, freeze: this.freeze ? 1 : 0, hits: this.hits, hit: this.lastHit, seed: this.rng.getState() },
    };
  }

  process(out: Float32Array, input?: Float32Array): void {
    const sr = this.sampleRate;
    const P = (id: TeleParamId) => this.params[TELE_INDEX[id]];
    const amt = 0.25 + 0.75 * P('amount');
    const volTarget = P('volume') ** 2;
    const on = (n: number) => (this.mask & (1 << n)) !== 0;
    const top = this.order.length ? this.order[this.order.length - 1] : -1;
    const L = this.buf.length;
    const pitch = Math.pow(2, this.pitchSemis / 12);
    let peak = 0;

    for (let i = 0; i < out.length; i++) {
      const x0 = input ? input[i] : 0;
      peak = Math.max(peak, Math.abs(x0));
      this.buf[this.w] = x0;
      this.w = (this.w + 1) % L;

      // ---- どこを読むか ----
      let x: number;
      if (this.freeze || top === 0 || top === 12) {
        // FREEZE・STUTTER・GRAIN HOLD：短い断片を繰り返す
        x = this.buf[(this.segStart + this.segPos) % L];
        this.segPos = (this.segPos + 1) % this.segLen;
      } else if (top === 6) {
        // REVERSE：遅れを増やしながら読む＝逆再生
        this.rd = Math.min(L - 2, this.rd + 2);
        x = this.read(this.rd);
        if (this.rd > sr * 0.6) this.rd = Math.floor(sr * 0.05);
      } else if (top === 7 || top === 8 || this.pitchSemis !== 0) {
        // PITCH UP / DOWN（と ↑↓）：遅れを動かしてピッチを変え、2 つの読み口をずらして重ねる
        const r = (top === 7 ? 1 + amt : top === 8 ? 1 / (1 + amt) : 1) * pitch;
        const win = sr * 0.08;
        this.rd = (this.rd + (1 - r) + win) % win;
        const a = this.read(this.rd), b = this.read((this.rd + win / 2) % win);
        const g = Math.abs((this.rd / win) * 2 - 1);
        x = a * (1 - g) + b * g;
      } else if (top === 9) {
        // TAPE STOP：だんだん遅くなって止まる
        this.tapeRate = Math.max(0, this.tapeRate - 1 / (sr * (0.3 + 0.7 * (1 - amt))));
        this.rd = Math.min(L - 2, this.rd + (1 - this.tapeRate));
        x = this.read(this.rd) * Math.min(1, this.tapeRate * 4);
      } else if (top === 2 || top === 23) {
        // SMEAR / SMEAR DOWN：ゆっくり遅れていく（ずるずる伸びる）
        this.rd = Math.min(L - 2, this.rd + (top === 23 ? 0.5 : 0.25) * amt);
        x = this.read(this.rd);
      } else {
        this.rd = 0;
        x = x0;
      }

      // ---- 読んだ音を壊す ----
      if (this.mask) {
        if (on(1)) { const q = Math.pow(2, 8 - 6 * amt); x = Math.round(x * q) / q; } // BITCRUSH
        if (on(3)) { this.ringPh = (this.ringPh + (80 + 900 * amt) / sr) % 1; x *= Math.sin(2 * Math.PI * this.ringPh); } // RING MOD
        if (on(4)) { if (++this.holdCnt >= 2 + Math.floor(amt * 20)) { this.holdCnt = 0; this.held = x; } x = this.held; } // DOWNSAMPLE
        if (on(5)) x = Math.sign(x) * Math.round(Math.abs(x) * 4) / 4; // QUANTIZE
        if (on(10)) { const e = this.echo[(this.echoPos - Math.floor(sr * 0.11) + this.echo.length) % this.echo.length]; x += e * 1.1 * amt; } // DELAY RUN（暴走）
        if (on(11)) x += this.rng.bi() * 0.4 * amt * (0.3 + Math.abs(x)); // NOISE
        if (on(13)) { this.wobPh = (this.wobPh + 6 / sr) % 1; x = this.read(sr * 0.004 * (1 + Math.sin(2 * Math.PI * this.wobPh)) * amt * 3); } // WOBBLE
        if (on(14)) { this.lp += (x - this.lp) * (0.01 + 0.05 * (1 - amt)); x = this.lp * 1.5; } // FILTER LOW
        if (on(15)) { this.gateEnv += (Math.abs(x) - this.gateEnv) * 0.004; if (this.gateEnv < 0.1 + 0.25 * amt) x = 0; } // GATE（大きいところだけ残す）
        if (on(16)) { this.hpLp += (x - this.hpLp) * (0.02 + 0.2 * amt); x = (x - this.hpLp) * 1.8; } // FILTER HIGH
        if (on(17)) x = (x + this.read(Math.floor(sr / (200 + 600 * amt))) * 0.9) * 0.6; // COMB
        if (on(18)) { this.flangePh = (this.flangePh + 0.3 / sr) % 1; x = (x + this.read(sr * (0.001 + 0.004 * (1 + Math.sin(2 * Math.PI * this.flangePh))))) * 0.6; } // FLANGE
        if (on(19)) x = Math.tanh(x * (1 + 20 * amt)); // DRIVE
        if (on(20)) { const e = this.echo[(this.echoPos - Math.floor(sr * 0.25) + this.echo.length) % this.echo.length]; x += e * 0.6; } // ECHO
        if (on(21)) { this.panPh = (this.panPh + (3 + 9 * amt) / sr) % 1; x *= this.panPh < 0.5 ? 1 : 0.15; } // PAN FLIP（モノラルなので揺れ）
        if (on(22)) { this.chopPh = (this.chopPh + (8 + 24 * amt) / sr) % 1; if (this.chopPh > 0.5) x = 0; } // CHOP
      }
      this.echo[this.echoPos] = x;
      this.echoPos = (this.echoPos + 1) % this.echo.length;

      // ---- 楽器キー ----
      let s = 0;
      for (const v of this.inst) s += this.voice(v);

      // DRY / WET：グリッチ中だけ、元の音と壊した音を混ぜる
      const wet = this.mask || this.freeze ? x0 + (x - x0) * P('mix') : x;
      const mixed = wet + s;
      this.gate += ((this.powered ? 1 : 0) - this.gate) * 0.005;
      this.vol += (volTarget - this.vol) * 0.002;
      const y = mixed - this.dcX + 0.995 * this.dcY;
      this.dcX = mixed;
      this.dcY = y;
      out[i] = Math.tanh(y) * this.vol * this.gate;
    }
    this.inst = this.inst.filter((v) => v.env > 0.0005);
    this.level += (peak - this.level) * 0.2;
  }

  /** 楽器キー 1 声を 1 サンプル */
  private voice(v: Inst): number {
    const sr = this.sampleRate;
    const t = v.t++ / sr;
    const f = mtof(v.note);
    const dec = (ms: number) => { v.env *= Math.exp(-1 / (sr * ms / 1000)); return v.env; };
    switch (v.kind) {
      case 0: case 1: { // BEEP：矩形
        v.ph = (v.ph + f / sr) % 1;
        return (v.ph < 0.5 ? 0.3 : -0.3) * (v.held ? Math.max(0.4, dec(300)) : dec(60));
      }
      case 2: // NOISE（音程つきの粗いノイズ）
        v.ph += f / sr;
        if (v.ph >= 1) { v.ph -= 1; v.sh = this.rng.bi(); }
        return v.sh * 0.3 * (v.held ? Math.max(0.3, dec(400)) : dec(80));
      case 3: { // KICK
        const fk = 45 + 120 * Math.exp(-t * 25);
        v.ph = (v.ph + fk / sr) % 1;
        return Math.sin(2 * Math.PI * v.ph) * dec(180) * 0.9;
      }
      case 4: // SNARE
        v.ph = (v.ph + 190 / sr) % 1;
        return (this.rng.bi() * 0.7 + Math.sin(2 * Math.PI * v.ph) * 0.3) * dec(110) * 0.6;
      case 5: // HAT
        return this.rng.bi() * dec(35) * 0.3;
      case 6: { // DRONE：押している間ずっと
        v.ph = (v.ph + (f / 2) / sr) % 1;
        v.ph2 = (v.ph2 + (f / 2 * 1.006) / sr) % 1;
        if (!v.held) dec(400);
        return ((v.ph * 2 - 1) + (v.ph2 * 2 - 1)) * 0.15 * v.env;
      }
      case 7: { // ZAP
        const fz = f * 8 * Math.exp(-t * 18) + 60;
        v.ph = (v.ph + fz / sr) % 1;
        return (v.ph < 0.5 ? 0.35 : -0.35) * dec(150);
      }
      case 8: // BLIP
        v.ph = (v.ph + (f * 4) / sr) % 1;
        return Math.sin(2 * Math.PI * v.ph) * dec(40) * 0.4;
      case 9: { // BUZZ：幅が揺れるパルス
        v.ph = (v.ph + f / sr) % 1;
        const w = 0.5 + 0.4 * Math.sin(2 * Math.PI * 5 * t);
        return (v.ph < w ? 0.25 : -0.25) * (v.held ? Math.max(0.5, dec(500)) : dec(80));
      }
      default: { // CHIRP：上がる
        const fc = f * (1 + t * 6);
        v.ph = (v.ph + fc / sr) % 1;
        return Math.sin(2 * Math.PI * v.ph) * dec(160) * 0.35;
      }
    }
  }
}
