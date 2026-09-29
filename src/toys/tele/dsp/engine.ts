// TELEKEY TK-6 の音のエンジン（おもちゃ1台分）。DOM・Web Audio に依存しない。
// 取り込んだ動画の音（input）を 2 秒のリングバッファに書き続け、効いているグリッチに応じて
// 「どこをどう読むか」（連打・逆再生・ピッチ・テープストップ・粒の保持）と「読んだ音をどう壊すか」を変える。
// 楽器キーの音を足し、改造パーツ（ノブ・トグル・GLITCH×BASE・HOLD/RELEASE・LFO・キー混線）で揺さぶる。
// 映像側（画面）には、いま効いているグリッチ・ノブの値・一発グリッチを status で知らせる（音と映像が同じ状態で壊れる）。

import { defaultsOf } from '../../../core/params';
import { Rng, hashSeed } from '../../../core/rng';
import type { ToyEngine, ToyStatus } from '../../../core/toy';
import { BURSTS, TELE_INDEX, TELE_KEYS, TELE_PARAMS, type Burst, type TeleParamId } from '../params';

export const TELE_SEED = 0x7e1e6e7;
const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** 楽器キーの音（1 つのキーに 1 声） */
interface Inst {
  kind: number;
  note: number;
  t: number;
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
  // ---- グリッチの状態 ----
  private pressed = new Map<number, number[]>(); // 押しているキー → 実際に効くグリッチ（混線で変わる）
  private order: number[] = []; // 押した順（最後のものが「読み方」を決める）
  private latched = 0; // HOLD でつかんだグリッチ
  private freeze = false;
  private burst: (Burst & { left: number; t: number }) | null = null;
  private burstCount = 0;
  private chaosMask = 0;
  mask = 0; // いま効いているグリッチ（24bit）
  private pitchSemis = 0; // ↑↓
  // ---- リングバッファと読み出し ----
  private buf: Float32Array;
  private w = 0;
  private rd = 0;
  private segStart = 0;
  private segLen = 0;
  private segPos = 0;
  private tapeRate = 1;
  private lastTop = -1;
  // ---- 壊す処理の状態 ----
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
  private fbBuf: Float32Array;
  private pbuf = new Float32Array(4096); // 読み出した後の音の短い履歴（WOBBLE・COMB・FLANGE 用）
  private pw = 0;
  private fbPos = 0;
  private crushHeld = 0;
  private crushCnt = 0;
  private lfoPh = 0;
  private burstCd = 0;
  // ---- 熱（ストレス）：やりすぎると勝手に暴れる。固まらず、手を離せば冷める ----
  heat = 0;
  private presses = 0; // この区間に押したグリッチキー・一発グリッチの数
  private spon: { mask: number; snow: boolean; stick: boolean; mute: boolean; left: number } | null = null;
  // ---- 楽器 ----
  private inst: Inst[] = [];
  private hits = 0;
  private lastHit = -1;
  // ---- 出力段 ----
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
    this.fbBuf = new Float32Array(Math.ceil(sampleRate * 0.4));
  }

  p(id: TeleParamId): number {
    return this.params[TELE_INDEX[id]];
  }

  setParam(index: number, value: number): void {
    const def = TELE_PARAMS[index];
    if (!def) return;
    const old = this.params[index];
    const v = Math.max(def.min, Math.min(def.max, def.kind === 'continuous' ? value : Math.round(value)));
    this.params[index] = v;
    if (v <= old || !this.powered) return;
    // ボタン類（MIDI やツマミの動きから）：押した瞬間だけ
    if (def.id.startsWith('glitch')) this.fire(Number(def.id.slice(6)) - 1);
    else if (def.id === 'hold') this.hold();
    else if (def.id === 'release') this.releaseAll();
  }

  setParamById(id: TeleParamId, v: number): void {
    this.setParam(TELE_INDEX[id], v);
  }

  powerOn(): void {
    this.powered = true;
  }

  powerOff(): void {
    this.powered = false;
    this.pressed.clear();
    this.order = [];
    this.latched = 0;
    this.freeze = false;
    this.burst = null;
    this.inst = [];
    this.updateMask();
  }

  // ================= 改造パーツ =================
  /** GLITCH ボタン n（今の BASE で決まる一発グリッチ） */
  fire(n: number): void {
    const b = BURSTS[this.p('base')][n];
    this.burst = { ...b, left: b.dur * this.sampleRate, t: 0 };
    this.burstCount++;
    this.presses += 5;
    this.chaosMask = 0;
    if (b.extra === 'chaos') for (let i = 0; i < 5; i++) this.chaosMask |= 1 << this.rng.int(24);
    if (b.extra === 'chord') [0, 4, 7].forEach((d) => this.hit(0, 48 + d));
    if (b.extra === 'swell') this.hit(6, 36);
    this.tapeRate = 1;
    this.rd = b.extra === 'rewind' ? Math.floor(this.sampleRate * 0.05) : 0;
    if (b.extra === 'repeat') this.startSeg(Math.floor(this.sampleRate * 0.06));
    this.updateMask();
  }

  /** HOLD：いま効いているグリッチをつかんで、離しても効かせ続ける */
  private hold(): void {
    this.latched |= this.mask;
    this.updateMask();
  }

  /** RELEASE：つかんだもの・フリーズ・一発グリッチを全部解除 */
  private releaseAll(): void {
    this.latched = 0;
    this.freeze = false;
    this.burst = null;
    this.updateMask();
  }

  /** いま効いているグリッチ = 押しているもの ∪ HOLD ∪ 一発グリッチ */
  private updateMask(): void {
    let m = this.latched;
    this.pressed.forEach((list) => list.forEach((n) => { m |= 1 << n; }));
    if (this.burst) {
      for (const n of this.burst.glitches) m |= 1 << n;
      m |= this.chaosMask;
    }
    if (this.spon) m |= this.spon.mask;
    this.mask = m;
    // 読み方を決める「一番上」のグリッチが変わったら、読み出しの準備
    const top = this.topGlitch();
    if (top !== this.lastTop) {
      this.lastTop = top;
      if (top >= 0) this.startRead(top);
    }
  }

  private topGlitch(): number {
    if (this.burst && this.burst.glitches.length) return this.burst.glitches[0];
    for (let i = this.order.length - 1; i >= 0; i--) {
      const list = this.pressed.get(this.order[i]);
      if (list?.length) return list[0];
    }
    for (let n = 0; n < 24; n++) if (this.latched & (1 << n)) return n;
    return -1;
  }

  private hit(kind: number, note: number): void {
    this.inst = this.inst.filter((v) => v.kind !== kind || v.note !== note);
    this.inst.push({ kind, note, t: 0, held: false, ph: 0, ph2: 0, env: 1, sh: 0 });
    if (this.inst.length > 16) this.inst.shift();
    this.hits++;
    this.lastHit = kind;
  }

  // ================= キー =================
  keyDown(key: number): void {
    const k = TELE_KEYS[key];
    if (!k || !this.powered) return;
    const r = k.role;
    switch (r.r) {
      case 'glitch': {
        // キー混線：隣のキーも一緒に効いたり、押すたびに別の効果になったりする
        let list = [r.n];
        if (this.p('crosstalk') > 0.5) {
          if (this.rng.chance(0.3)) list = [this.rng.int(24)];
          if (this.rng.chance(0.45)) list.push((list[0] + (this.rng.chance(0.5) ? 1 : 23)) % 24);
        }
        this.pressed.set(key, list);
        this.presses++;
        this.order = [...this.order.filter((x) => x !== key), key];
        this.updateMask();
        break;
      }
      case 'inst':
        this.hit(r.n, 48 + r.note);
        this.inst[this.inst.length - 1].held = true;
        break;
      case 'bang': this.fire(r.n); break;
      case 'base': this.setParamById('base', r.n); break;
      case 'fn':
        switch (r.f) {
          case 'freeze': this.freeze = true; this.startSeg(Math.floor(this.sampleRate * 0.12)); break;
          case 'speedUp': this.pitchSemis = Math.min(24, this.pitchSemis + 1); break;
          case 'speedDown': this.pitchSemis = Math.max(-24, this.pitchSemis - 1); break;
          case 'speedReset': this.pitchSemis = 0; break;
          case 'hold': this.hold(); break;
          case 'release': this.releaseAll(); break;
          case 'reset':
            this.heat = 0;
            this.spon = null;
            this.releaseAll();
            this.pressed.clear();
            this.order = [];
            this.pitchSemis = 0;
            this.inst = [];
            this.updateMask();
            break;
          case 'crosstalk': this.setParamById('crosstalk', this.p('crosstalk') > 0.5 ? 0 : 1); break;
          case 'lfoTarget': this.setParamById('lfoTarget', (this.p('lfoTarget') + 1) % 3); break;
          case 'distType': this.setParamById('distType', this.p('distType') > 0.5 ? 0 : 1); break;
        }
        break;
    }
  }

  keyUp(key: number): void {
    const k = TELE_KEYS[key];
    if (!k) return;
    const r = k.role;
    if (r.r === 'glitch') {
      this.pressed.delete(key);
      this.order = this.order.filter((x) => x !== key);
      this.updateMask();
    } else if (r.r === 'inst') {
      for (const v of this.inst) if (v.kind === r.n && v.note === 48 + r.note) v.held = false;
    } else if (r.r === 'fn' && r.f === 'freeze') this.freeze = false;
  }

  /**
   * 熱を dt 秒ぶん進める。上がる：同時に効いているグリッチの数・連打・一発グリッチ・過激なノブ・混線。
   * 0.45 を超えると、勝手にグリッチ／砂嵐／音の張り付き／無音が起きる（20〜200ms、すぐ戻る）。
   */
  private updateHeat(dt: number): void {
    let n = 0;
    this.pressed.forEach((l) => { n += l.length; });
    for (let b = 0; b < 24; b++) if (this.latched & (1 << b)) n += 0.5;
    const active = n > 0 || !!this.burst || this.freeze;
    let rise = active ? 0.035 * Math.pow(Math.max(1, n), 1.5) : 0;
    if (active) {
      if (this.p('feedback') > 0.8) rise += 0.05;
      if (this.p('dist') > 0.8) rise += 0.04;
      if (this.p('amount') > 0.9) rise += 0.03;
      if (this.p('crosstalk') > 0.5) rise *= 1.3;
    }
    const decay = active ? 0.02 : 0.1;
    this.heat = Math.max(0, Math.min(1.2, this.heat + (rise - decay) * dt + this.presses * 0.012));
    this.presses = 0;
    if (!this.powered) this.heat = 0;

    // ---- 暴発 ----
    if (this.spon) {
      this.spon.left -= dt;
      if (this.spon.left <= 0) { this.spon = null; this.updateMask(); }
    } else if (this.powered && this.heat > 0.45 && this.rng.next() < (this.heat - 0.45) * 6 * dt) {
      const kind = this.rng.next();
      let mask = 0;
      const k = 1 + (this.heat > 0.9 ? this.rng.int(3) : 0);
      for (let i = 0; i < k; i++) mask |= 1 << this.rng.int(24);
      this.spon = {
        mask: kind < 0.6 ? mask : 0,
        snow: kind >= 0.6 && kind < 0.75,
        stick: kind >= 0.75 && kind < 0.9,
        mute: kind >= 0.9,
        left: 0.02 + this.rng.next() * 0.18,
      };
      if (this.spon.stick) this.startSeg(Math.floor(this.sampleRate * 0.005));
      this.updateMask();
    }
  }

  /** 読み出し方を変えるグリッチの準備 */
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

  /** 読み出した後の音を delay サンプル前から読む */
  private pread(delay: number): number {
    const L = this.pbuf.length;
    const pos = (this.pw - 1 - Math.min(L - 2, delay) + L * 2) % L;
    const i = Math.floor(pos), f = pos - i;
    return this.pbuf[i] * (1 - f) + this.pbuf[(i + 1) % L] * f;
  }

  private read(delay: number): number {
    const L = this.buf.length;
    const pos = (this.w - 1 - delay + L * 4) % L;
    const i = Math.floor(pos), f = pos - i;
    return this.buf[i] * (1 - f) + this.buf[(i + 1) % L] * f;
  }

  status(): ToyStatus {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      powered: this.powered,
      playing: this.level > 0.001,
      leds: {
        level: Math.round(Math.min(1, this.level * 4) * 20) / 20,
        burst: this.burst ? 1 : 0,
        hold: this.latched ? 1 : 0,
        xt: this.p('crosstalk'),
      },
      fx: {
        mask: this.mask, freeze: this.freeze ? 1 : 0, hits: this.hits, hit: this.lastHit, seed: this.rng.getState(),
        burst: this.burstCount, snow: this.burst?.extra === 'snow' || this.spon?.snow ? 1 : 0,
        heat: Math.round(this.heat * 100) / 100, spon: this.spon ? 1 : 0,
        // 映像側も同じノブの値で壊す（シーケンサーのツマミの動きにも付いていく）
        amount: r2(this.p('amount')), fb: r2(this.p('feedback')), dist: r2(this.p('dist')), dtype: this.p('distType'),
        mix: r2(this.p('mix')), speed: r2(this.p('speed')), lfoR: r2(this.p('lfoRate')), lfoD: r2(this.p('lfoDepth')), lfoT: this.p('lfoTarget'),
        base: this.p('base'), pitch: this.pitchSemis,
      },
    };
  }

  process(out: Float32Array, input?: Float32Array): void {
    const sr = this.sampleRate;
    const P = (id: TeleParamId) => this.params[TELE_INDEX[id]];
    const burst = this.burst;
    const amt = burst ? 1 : 0.25 + 0.75 * P('amount');
    const volTarget = P('volume') ** 2;
    const L = this.buf.length;
    const fb = P('feedback'), dist = P('dist'), dtype = P('distType'), mixK = P('mix');
    const lfoRate = 0.05 * Math.pow(400, P('lfoRate')); // 0.05〜20Hz
    const lfoAudio = P('lfoTarget') !== 0 ? P('lfoDepth') : 0;
    const speedSemis = (P('speed') - 0.5) * 24;
    let peak = 0;
    this.updateHeat(out.length / sr);
    const spon = this.spon;

    for (let i = 0; i < out.length; i++) {
      const x0 = input ? input[i] : 0;
      peak = Math.max(peak, Math.abs(x0));
      this.buf[this.w] = x0;
      this.w = (this.w + 1) % L;
      this.lfoPh = (this.lfoPh + lfoRate / sr) % 1;
      const lfo = Math.sin(2 * Math.PI * this.lfoPh);

      // ---- 一発グリッチの進行 ----
      let extraPitch = 0;
      let top = this.lastTop;
      if (burst) {
        burst.left--;
        burst.t++;
        const k = burst.t / (burst.dur * sr); // 0 → 1
        switch (burst.extra) {
          case 'tapeStop': top = 9; break;
          case 'rewind': top = 6; break;
          case 'chipmunk': extraPitch = 12 * Math.min(1, k * 3); break;
          case 'flutter': extraPitch = Math.sin(k * 60) * 3; break;
          case 'dive': extraPitch = -30 * k; break;
          case 'repeat': top = 0; break;
          case 'scatter':
            if (--this.burstCd <= 0) { this.burstCd = Math.floor(sr * (0.02 + this.rng.next() * 0.05)); this.segLen = Math.floor(sr * 0.03); this.segStart = this.rng.int(L); this.segPos = 0; }
            top = 0;
            break;
          case 'zapRoll': if (--this.burstCd <= 0) { this.burstCd = Math.floor(sr * 0.045); this.hit(7, 60 + this.rng.int(24)); } break;
          case 'drumRoll': if (--this.burstCd <= 0) { this.burstCd = Math.floor(sr * (0.1 - 0.07 * k)); this.hit(this.rng.chance(0.5) ? 3 : 4, 48); } break;
          case 'chirps': if (--this.burstCd <= 0) { this.burstCd = Math.floor(sr * 0.09); this.hit(10, 60 + this.rng.int(12)); } break;
        }
        if (burst.left <= 0) { this.burst = null; this.updateMask(); top = this.lastTop; }
      }
      const on = (n: number) => (this.mask & (1 << n)) !== 0;

      // ---- どこを読むか ----
      const pitchAll = this.pitchSemis + speedSemis + extraPitch + lfo * lfoAudio * 2;
      let x: number;
      if (spon?.stick && this.segLen) {
        // 暴発：音が一音で張り付く（ごく短い断片）
        x = this.buf[(this.segStart + this.segPos) % L];
        this.segPos = (this.segPos + 1) % Math.min(this.segLen, 240);
      } else if (this.freeze || top === 0 || top === 12) {
        // FREEZE・STUTTER・GRAIN HOLD：短い断片を繰り返す
        x = this.buf[(this.segStart + this.segPos) % L];
        this.segPos = (this.segPos + 1) % this.segLen;
      } else if (top === 6) {
        // REVERSE：遅れを増やしながら読む＝逆再生
        this.rd = Math.min(L - 2, this.rd + (burst ? 3 : 2));
        x = this.read(this.rd);
        if (this.rd > sr * 0.6) this.rd = Math.floor(sr * 0.05);
      } else if (top === 9) {
        // TAPE STOP：だんだん遅くなって止まる
        this.tapeRate = Math.max(0, this.tapeRate - 1 / (sr * (0.3 + 0.7 * (1 - amt))));
        this.rd = Math.min(L - 2, this.rd + (1 - this.tapeRate));
        x = this.read(this.rd) * Math.min(1, this.tapeRate * 4);
      } else if (top === 2 || top === 23) {
        // SMEAR：ゆっくり遅れていく
        this.rd = Math.min(L - 2, this.rd + (top === 23 ? 0.5 : 0.25) * amt);
        x = this.read(this.rd);
      } else if (top === 7 || top === 8 || Math.abs(pitchAll) > 0.01) {
        // ピッチ（PITCH UP/DOWN・↑↓・SPEED ノブ・LFO・一発グリッチ）：遅れを動かして 2 つの読み口を重ねる
        const r = (top === 7 ? 1 + amt : top === 8 ? 1 / (1 + amt) : 1) * Math.pow(2, pitchAll / 12);
        const win = sr * 0.08;
        this.rd = (((this.rd + (1 - r)) % win) + win) % win;
        const a = this.read(this.rd), b = this.read((this.rd + win / 2) % win);
        const g = Math.abs((this.rd / win) * 2 - 1);
        x = a * (1 - g) + b * g;
      } else {
        this.rd = 0;
        x = x0;
      }

      // ---- 読んだ音を壊す ----
      this.pbuf[this.pw] = x;
      this.pw = (this.pw + 1) % this.pbuf.length;
      if (this.mask) {
        if (on(1)) { const q = Math.pow(2, 8 - 6 * amt); x = Math.round(x * q) / q; } // BITCRUSH
        if (on(3)) { this.ringPh = (this.ringPh + (80 + 900 * amt * (burst?.extra === 'sweep' ? 3 * (burst.t / (burst.dur * sr)) : 1)) / sr) % 1; x *= Math.sin(2 * Math.PI * this.ringPh); } // RING MOD
        if (on(4)) { if (++this.holdCnt >= 2 + Math.floor(amt * 20)) { this.holdCnt = 0; this.held = x; } x = this.held; } // DOWNSAMPLE
        if (on(5)) x = Math.sign(x) * Math.round(Math.abs(x) * 4) / 4; // QUANTIZE
        if (on(10)) { const e = this.echo[(this.echoPos - Math.floor(sr * 0.11) + this.echo.length) % this.echo.length]; x += e * 1.1 * amt; } // DELAY RUN
        if (on(11)) x += this.rng.bi() * 0.4 * amt * (0.3 + Math.abs(x)); // NOISE
        if (on(13)) { this.wobPh = (this.wobPh + 6 / sr) % 1; x = this.pread(sr * 0.004 * (1 + Math.sin(2 * Math.PI * this.wobPh)) * amt * 3); } // WOBBLE
        if (on(14)) { this.lp += (x - this.lp) * (0.01 + 0.05 * (1 - amt)); x = this.lp * 1.5; } // FILTER LOW
        if (on(15)) { this.gateEnv += (Math.abs(x) - this.gateEnv) * 0.004; if (this.gateEnv < 0.1 + 0.25 * amt) x = 0; } // GATE
        if (on(16)) { this.hpLp += (x - this.hpLp) * (0.02 + 0.2 * amt); x = (x - this.hpLp) * 1.8; } // FILTER HIGH
        if (on(17)) x = (x + this.pread(Math.floor(sr / (200 + 600 * amt))) * 0.9) * 0.6; // COMB
        if (on(18)) { this.flangePh = (this.flangePh + 0.3 / sr) % 1; x = (x + this.pread(sr * (0.001 + 0.004 * (1 + Math.sin(2 * Math.PI * this.flangePh))))) * 0.6; } // FLANGE
        if (on(19)) x = Math.tanh(x * (1 + 20 * amt)); // DRIVE
        if (on(20)) { const e = this.echo[(this.echoPos - Math.floor(sr * 0.25) + this.echo.length) % this.echo.length]; x += e * 0.6; } // ECHO
        if (on(21)) { this.panPh = (this.panPh + (3 + 9 * amt) / sr) % 1; x *= this.panPh < 0.5 ? 1 : 0.15; } // PAN FLIP
        if (on(22)) { this.chopPh = (this.chopPh + (8 + 24 * amt) / sr) % 1; if (this.chopPh > 0.5) x = 0; } // CHOP
      }
      // 一発グリッチの音だけの味付け
      if (burst) {
        if (burst.extra === 'dropout' && this.rng.chance(0.002)) this.burstCd = Math.floor(sr * 0.05);
        if (burst.extra === 'dropout' && this.burstCd-- > 0) x = 0;
        if (burst.extra === 'silence' && Math.floor(burst.t / (sr * 0.07)) % 2) x = 0;
        if (burst.extra === 'snow') x = x * 0.3 + this.rng.bi() * 0.35;
        if (burst.extra === 'howl') x += Math.sin(2 * Math.PI * 1200 * burst.t / sr * (1 + 0.1 * Math.sin(burst.t / 2000))) * 0.3;
      }
      this.echo[this.echoPos] = x;
      this.echoPos = (this.echoPos + 1) % this.echo.length;

      // ---- 楽器キー ----
      let s = 0;
      for (const v of this.inst) s += this.voice(v);

      // ---- DRY/WET・FEEDBACK・DIST ----
      if (spon?.mute) x = 0;
      if (spon?.snow) x = x * 0.4 + this.rng.bi() * 0.3;
      let y = this.mask || this.freeze || Math.abs(pitchAll) > 0.01 ? x0 + (x - x0) * mixK : x;
      y += s;
      if (fb > 0.001) {
        const d = this.fbBuf[(this.fbPos - Math.floor(sr * 0.18) + this.fbBuf.length) % this.fbBuf.length];
        y += Math.tanh(d * fb * 1.15);
        this.fbBuf[this.fbPos] = y;
      } else this.fbBuf[this.fbPos] = 0;
      this.fbPos = (this.fbPos + 1) % this.fbBuf.length;
      if (dist > 0.001) {
        if (dtype < 0.5) y = Math.tanh(y * (1 + dist * 25)) * (1 - dist * 0.3); // CLIP
        else { // CRUSH：ビットとサンプルレートを落とす
          if (++this.crushCnt >= 1 + Math.floor(dist * 16)) { this.crushCnt = 0; const q = Math.pow(2, 10 - 8 * dist); this.crushHeld = Math.round(y * q) / q; }
          y = this.crushHeld;
        }
      }
      this.gate += ((this.powered ? 1 : 0) - this.gate) * 0.005;
      this.vol += (volTarget - this.vol) * 0.002;
      const z = y - this.dcX + 0.995 * this.dcY;
      this.dcX = y;
      this.dcY = z;
      out[i] = Math.tanh(z) * this.vol * this.gate;
    }
    this.inst = this.inst.filter((v) => v.env > 0.0005);
    this.level += (peak - this.level) * 0.2;
  }

  /** 楽器キー 1 声を 1 サンプル */
  private voice(v: Inst): number {
    const sr = this.sampleRate;
    const t = v.t++ / sr;
    const f = mtof(v.note);
    const dec = (ms: number) => { v.env *= Math.exp(-1 / ((sr * ms) / 1000)); return v.env; };
    switch (v.kind) {
      case 0: case 1:
        v.ph = (v.ph + f / sr) % 1;
        return (v.ph < 0.5 ? 0.3 : -0.3) * (v.held ? Math.max(0.4, dec(300)) : dec(60));
      case 2:
        v.ph += f / sr;
        if (v.ph >= 1) { v.ph -= 1; v.sh = this.rng.bi(); }
        return v.sh * 0.3 * (v.held ? Math.max(0.3, dec(400)) : dec(80));
      case 3: {
        const fk = 45 + 120 * Math.exp(-t * 25);
        v.ph = (v.ph + fk / sr) % 1;
        return Math.sin(2 * Math.PI * v.ph) * dec(180) * 0.9;
      }
      case 4:
        v.ph = (v.ph + 190 / sr) % 1;
        return (this.rng.bi() * 0.7 + Math.sin(2 * Math.PI * v.ph) * 0.3) * dec(110) * 0.6;
      case 5:
        return this.rng.bi() * dec(35) * 0.3;
      case 6: {
        v.ph = (v.ph + f / 2 / sr) % 1;
        v.ph2 = (v.ph2 + (f / 2) * 1.006 / sr) % 1;
        if (!v.held) dec(this.burst?.extra === 'swell' ? 1500 : 400);
        return (v.ph * 2 - 1 + (v.ph2 * 2 - 1)) * 0.15 * v.env;
      }
      case 7: {
        const fz = f * 8 * Math.exp(-t * 18) + 60;
        v.ph = (v.ph + fz / sr) % 1;
        return (v.ph < 0.5 ? 0.35 : -0.35) * dec(150);
      }
      case 8:
        v.ph = (v.ph + (f * 4) / sr) % 1;
        return Math.sin(2 * Math.PI * v.ph) * dec(40) * 0.4;
      case 9: {
        v.ph = (v.ph + f / sr) % 1;
        const w = 0.5 + 0.4 * Math.sin(2 * Math.PI * 5 * t);
        return (v.ph < w ? 0.25 : -0.25) * (v.held ? Math.max(0.5, dec(500)) : dec(80));
      }
      default: {
        const fc = f * (1 + t * 6);
        v.ph = (v.ph + fc / sr) % 1;
        return Math.sin(2 * Math.PI * v.ph) * dec(160) * 0.35;
      }
    }
  }
}
