// TYPOTRON TT-109 の DSP エンジン（おもちゃ1台分）。DOM・Web Audio に依存しない。
// キーボードの「故障」を楽器にしたもの：ゴースト（隣のキーも鳴る）、スキャン（同時押しが順番に読まれる）、
// バウンス（チャタリングで連打）、オーバーフロー（打った行があふれて暴走）。打った音は「行」にたまり、Enter でループ。

import { defaultsOf } from '../../../core/params';
import { Rng, hashSeed } from '../../../core/rng';
import type { ToyEngine, ToyStatus } from '../../../core/toy';
import { CHIP_RATE } from '../../blippy/dsp/speech';
import { drum, noise, normalize, quantize8, sweep } from '../../blippy/dsp/tones';
import { RAW_NOTE, SCALE_STEPS, TYPO_INDEX, TYPO_KEYS, TYPO_PARAMS, WAVES, SCALES, type Fn, type TypoParamId } from '../params';

export const TYPO_SEED = 0x71907109;
const POLY = 12;
const ROW_OFFSET = 3; // 1 段上がるごとに 3 音階分（ほぼ 4 度）上がる
const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface Voice {
  key: number; // どのキーの音か（-1 = ループ・ゴースト・バウンス）
  note: number;
  ph: number;
  ph2: number;
  lvl: number;
  vel: number;
  stage: 'off' | 'a' | 'd' | 'r';
  gate: boolean;
  age: number;
  sh: number; // NOISE 用の保持値
}

interface Pending {
  at: number; // 残りサンプル数
  note: number;
  vel: number;
}

export interface TypoDisplay {
  line: string; // 打った行（キーの文字）
  cursor: number; // ループで今鳴っている位置（-1 = 止まっている）
  info: string;
  /** 液晶の波形（いまの出口の音・-1〜1 を 160 点。電源 OFF なら無し） */
  scope?: number[];
  /** いま鳴っている音（MIDI ノート番号） */
  notes?: number[];
}

export class TypoEngine implements ToyEngine<TypoDisplay> {
  readonly params = defaultsOf(TYPO_PARAMS);
  readonly paramDefs = TYPO_PARAMS;
  powered = false;
  private rng: Rng;
  private v: Voice[] = Array.from({ length: POLY }, () => ({ key: -1, note: 60, ph: 0, ph2: 0, lvl: 0, vel: 1, stage: 'off', gate: false, age: 0, sh: 0 }) as Voice);
  private age = 0;
  private pending: Pending[] = [];
  private drums: Float32Array[];
  private drumVoices: { buf: Float32Array; pos: number }[] = [];
  // キーの状態
  private held = new Set<number>(); // 押している音のキー
  private latched = new Set<number>();
  private sustain = false;
  private octShift = 0;
  private transpose = 0;
  private latch = false;
  private overwrite = false;
  private bendDir = 0;
  private bend = 0;
  private stutter = false;
  private corrupt = false;
  // 行バッファとループ
  private line: { note: number; ch: string }[] = [];
  private looping = false;
  private loopStep = 0;
  private loopPh = 0;
  private loopNote: Voice | null = null;
  // スキャン
  private scanPh = 0;
  private scanIdx = 0;
  private scanVoice: Voice | null = null;
  // 打鍵音
  private clicks: { t: number; f: number; amp: number }[] = [];
  // エフェクト
  private lp = 0;
  private held8 = 0;
  private holdCnt = 0;
  private stutBuf: Float32Array;
  private stutLen = 0;
  private stutPos = 0;
  private stutWrite = 0;
  private echoBuf: Float32Array;
  private echoPos = 0;
  private vol = 0;
  private gate = 0;
  private dcX = 0;
  private dcY = 0;
  display: TypoDisplay = { line: '', cursor: -1, info: '' };
  displayVersion = 0;
  // 液晶の波形：出口の音を 2 つに 1 つ覚えておき、ときどき液晶へ送る
  private scopeBuf = new Float32Array(1024);
  private scopeW = 0;
  private scopeBlocks = 0;
  private scopeLive = false;

  constructor(readonly sampleRate: number, readonly seed = TYPO_SEED) {
    this.rng = new Rng(hashSeed(seed, 'typo'));
    const r = (i: number) => new Rng(hashSeed(seed, 'drum', i));
    const fin = (b: Float32Array) => quantize8(normalize(b, 0.9));
    this.drums = [0, 1, 2, 3, 4, 4, 5, 6, 7, 0, 0, 1, 2].map((k, i) => fin(drum(k, r(i))));
    this.drums[5] = fin(sweep(300, 160, 250, 'tri', 110, 0.9)); // TOM H
    this.drums[9] = fin(noise(r(9), 1200, 400, 0.8, 1, 0)); // CRASH
    this.stutBuf = new Float32Array(Math.ceil(sampleRate * 0.25));
    this.echoBuf = new Float32Array(Math.ceil(sampleRate * 1.2));
  }

  p(id: TypoParamId): number {
    return this.params[TYPO_INDEX[id]];
  }

  setParam(index: number, value: number): void {
    const def = TYPO_PARAMS[index];
    if (!def) return;
    this.params[index] = Math.max(def.min, Math.min(def.max, def.kind === 'continuous' ? value : Math.round(value)));
    this.updateInfo();
  }

  setParamById(id: TypoParamId, v: number): void {
    this.setParam(TYPO_INDEX[id], v);
  }

  powerOn(): void {
    if (this.powered) return;
    this.powered = true;
    this.updateInfo();
    // 起動音：キーボードの LED が一瞬全部つくような「ピロッ」
    [72, 76, 79, 84].forEach((n, i) => this.pending.push({ at: Math.floor(this.sampleRate * 0.06 * i), note: n, vel: 0.5 }));
  }

  powerOff(): void {
    this.powered = false;
    this.stopLoop();
    this.held.clear();
    this.latched.clear();
    for (const v of this.v) { v.stage = 'off'; v.lvl = 0; }
    this.pending = [];
    this.updateInfo();
  }

  get bpm(): number {
    return 60 + this.p('tempo') * 180;
  }

  /** 音のキー（段・列）→ MIDI ノート */
  private noteOf(row: number, col: number, shiftOct = true): number {
    const scale = SCALE_STEPS[this.p('scale')];
    const deg = col + row * ROW_OFFSET + this.transpose;
    const oct = Math.floor(deg / scale.length);
    const idx = ((deg % scale.length) + scale.length) % scale.length;
    return 48 + oct * 12 + scale[idx] + (shiftOct ? this.octShift * 12 : 0);
  }

  private findNoteKey(row: number, col: number): number {
    return TYPO_KEYS.findIndex((k) => k.role.r === 'note' && k.role.row === row && k.role.col === col);
  }

  private voiceOn(note: number, vel: number, key: number): Voice {
    const v = this.v.find((x) => x.stage === 'off') ?? this.v.reduce((a, b) => (a.age < b.age ? a : b));
    v.key = key; v.note = note; v.vel = vel; v.stage = 'a'; v.gate = true; v.age = ++this.age; v.ph = 0;
    return v;
  }

  private voiceOff(key: number): void {
    for (const v of this.v) if (v.key === key && v.gate && !this.sustain) { v.gate = false; v.key = -1; }
  }

  private updateInfo(): void {
    const oct = this.octShift ? (this.octShift > 0 ? ' OCT+' : ' OCT-') : '';
    const tr = this.transpose ? ` TR${this.transpose > 0 ? '+' : ''}${this.transpose}` : '';
    const info = this.powered ? `${WAVES[this.p('wave')]} ${SCALES[this.p('scale')]} ${Math.round(this.bpm)}BPM${oct}${tr}${this.latch ? ' LATCH' : ''}${this.overwrite ? ' OVR' : ''}` : '';
    const line = this.line.map((x) => x.ch).join('');
    const cursor = this.looping ? this.loopStep : -1;
    if (info !== this.display.info || line !== this.display.line || cursor !== this.display.cursor) {
      this.display = { ...this.display, line, cursor, info };
      this.displayVersion++;
    }
  }

  private click(key: number): void {
    const row = TYPO_KEYS[key]?.role.r === 'note' ? (TYPO_KEYS[key].role as { row: number }).row : 4;
    this.clicks.push({ t: 0, f: 1600 + row * 450 + this.rng.next() * 300, amp: 0.6 + this.rng.next() * 0.4 });
    if (this.clicks.length > 16) this.clicks.shift();
  }

  /** 音のキーを押した（ゴースト・バウンス・行バッファ・上書きもここで） */
  private pressNote(key: number, row: number, col: number): void {
    const note = this.noteOf(row, col);
    const ch = TYPO_KEYS[key]?.label ?? '?';
    // 行バッファ：上書きモードでループ中なら、今鳴っている位置を書き換える
    if (this.overwrite && this.looping && this.line.length) this.line[this.loopStep] = { note, ch };
    else this.line.push({ note, ch }); // 行の長さは無制限（液晶は横に流れる）
    if (this.latch) {
      if (this.latched.has(key)) { this.latched.delete(key); this.voiceOff(key); this.updateInfo(); return; }
      this.latched.add(key);
    }
    this.held.add(key);
    if (this.p('scan') < 0.5) this.voiceOn(note, 1, key);
    // BOUNCE：接点がバタついて何度も鳴る
    if (this.p('bounce') > 0.5) {
      const n = 1 + Math.floor(this.p('bounceAmt') * 6);
      let at = 0;
      for (let i = 1; i <= n; i++) {
        at += Math.floor(this.sampleRate * (0.015 + this.rng.next() * 0.03));
        this.pending.push({ at, note, vel: Math.pow(0.75, i) });
      }
    }
    // GHOST：キーマトリクスの隣（同じ段の左右・上下の段）も鳴ってしまう
    if (this.p('ghost') > 0.5) {
      for (const [dr, dc] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
        if (!this.rng.chance(this.p('ghostAmt'))) continue;
        const gk = this.findNoteKey(row + dr, col + dc);
        if (gk < 0) continue;
        this.pending.push({ at: Math.floor(this.sampleRate * this.rng.next() * 0.02), note: this.noteOf(row + dr, col + dc) + 0.08, vel: 0.4 });
      }
    }
    this.updateInfo();
  }

  keyDown(key: number): void {
    if (key >= RAW_NOTE) {
      if (this.powered) { this.held.add(key); this.voiceOn(key - RAW_NOTE + this.octShift * 12, 1, key); }
      return;
    }
    const k = TYPO_KEYS[key];
    if (!k) return;
    if (k.role.r === 'fn' && k.role.f === 'powerOn') { this.powerOn(); this.click(key); return; }
    if (!this.powered) return;
    this.click(key);
    const role = k.role;
    switch (role.r) {
      case 'note': this.pressNote(key, role.row, role.col); break;
      case 'drum': this.drumVoices.push({ buf: this.drums[role.n], pos: 0 }); if (this.drumVoices.length > 8) this.drumVoices.shift(); break;
      case 'wave': this.setParamById('wave', role.n); break;
      case 'scale': this.setParamById('scale', role.n); break;
      case 'bend': this.setParamById(role.p, this.p(role.p) > 0.5 ? 0 : 1); break;
      case 'fn': this.fnDown(role.f); break;
    }
  }

  /** ループを止めて、最後に鳴らした音も離す */
  private stopLoop(): void {
    this.looping = false;
    if (this.loopNote) this.loopNote.gate = false;
    this.loopNote = null;
  }

  private fnDown(f: Fn): void {
    switch (f) {
      case 'sustain': this.sustain = true; break;
      case 'octDown': this.octShift = -1; break;
      case 'octUp': this.octShift = 1; break;
      case 'stutter': this.stutter = true; this.stutLen = Math.floor(this.sampleRate * (60 / this.bpm / 8)); this.stutPos = 0; break;
      case 'latch':
        this.latch = !this.latch;
        if (!this.latch) { for (const k of this.latched) this.voiceOff(k); this.latched.clear(); }
        break;
      case 'enter':
        if (this.looping) this.stopLoop();
        else if (this.line.length) { this.looping = true; this.loopStep = this.line.length - 1; this.loopPh = 0.999; }
        break;
      case 'backspace':
        this.line.pop();
        if (this.loopStep >= this.line.length) this.loopStep = 0;
        if (!this.line.length) this.stopLoop();
        this.pending.push({ at: 0, note: 84, vel: -1 }); // 消す音（下がるチャープ）
        break;
      case 'escape':
        this.line = [];
        this.stopLoop();
        this.pending.push({ at: 0, note: 0, vel: -2 }); // 全部消す音（シャッ）
        break;
      case 'corrupt': this.corrupt = true; break;
      case 'overwrite': this.overwrite = !this.overwrite; break;
      case 'tempoUp': this.setParamById('tempo', Math.min(1, this.p('tempo') + 5 / 180)); break;
      case 'tempoDown': this.setParamById('tempo', Math.max(0, this.p('tempo') - 5 / 180)); break;
      case 'bendDown': this.bendDir = -1; break;
      case 'bendUp': this.bendDir = 1; break;
      case 'transUp': this.transpose++; break;
      case 'transDown': this.transpose--; break;
      case 'powerOff': this.powerOff(); break;
    }
    this.updateInfo();
  }

  keyUp(key: number): void {
    if (key >= RAW_NOTE) { this.held.delete(key); this.voiceOff(key); return; }
    const k = TYPO_KEYS[key];
    if (!k) return;
    if (k.role.r === 'note') {
      this.held.delete(key);
      if (!this.latched.has(key)) this.voiceOff(key);
    } else if (k.role.r === 'fn') {
      switch (k.role.f) {
        case 'sustain':
          this.sustain = false;
          for (const v of this.v) if (v.gate && (v.key < 0 || (!this.held.has(v.key) && !this.latched.has(v.key)))) v.gate = false;
          break;
        case 'octDown': if (this.octShift < 0) this.octShift = 0; break;
        case 'octUp': if (this.octShift > 0) this.octShift = 0; break;
        case 'stutter': this.stutter = false; break;
        case 'corrupt': this.corrupt = false; break;
        case 'bendDown': if (this.bendDir < 0) this.bendDir = 0; break;
        case 'bendUp': if (this.bendDir > 0) this.bendDir = 0; break;
      }
      this.updateInfo();
    }
  }

  status(): ToyStatus {
    return {
      powered: this.powered,
      playing: this.looping,
      leds: {
        loop: this.looping ? 1 : 0, latch: this.latch ? 1 : 0, overwrite: this.overwrite ? 1 : 0,
        ghost: this.p('ghost'), scan: this.p('scan'), bounce: this.p('bounce'), overflow: this.p('overflow'),
        corrupt: this.corrupt ? 1 : 0, stutter: this.stutter ? 1 : 0,
      },
      fx: { oct: this.octShift, transpose: this.transpose, wave: this.p('wave'), scale: this.p('scale') },
    };
  }

  process(out: Float32Array): void {
    const sr = this.sampleRate;
    const P = (id: TypoParamId) => this.params[TYPO_INDEX[id]];
    const wave = P('wave');
    const decay = 0.05 * Math.pow(60, P('decay')); // 50ms〜3s
    const lpCoef = 1 - Math.exp((-2 * Math.PI * (200 * Math.pow(60, P('tone')))) / sr);
    const drive = P('drive'), crush = P('crush'), echo = P('echo');
    const bendRange = P('bendRange') * 12;
    const scanOn = P('scan') > 0.5;
    const scanHz = 2 * Math.pow(40, P('scanRate')); // 2〜80Hz
    const overflow = P('overflow') > 0.5;
    const clickVol = P('click');
    const stepHz = (this.bpm / 60) * 4;
    const echoLen = Math.min(this.echoBuf.length - 1, Math.floor(sr * (60 / this.bpm) * 0.75));
    const volTarget = P('volume') ** 2;
    const toChip = CHIP_RATE / sr;
    let changed = false;

    for (let i = 0; i < out.length; i++) {
      // ---- 予約された音（ゴースト・バウンス・起動音・消す音） ----
      if (this.pending.length) {
        for (let j = this.pending.length - 1; j >= 0; j--) {
          const pe = this.pending[j];
          if (--pe.at > 0) continue;
          this.pending.splice(j, 1);
          if (pe.vel === -1) { for (let k = 0; k < 6; k++) this.pending.push({ at: Math.floor(sr * 0.025 * k) + 1, note: 84 - k * 5, vel: 0.35 }); }
          else if (pe.vel === -2) this.clicks.push({ t: 0, f: 0, amp: 2 });
          else { const v = this.voiceOn(pe.note, pe.vel, -1); v.gate = false; }
        }
      }
      // ---- 行バッファのループ ----
      if (this.looping && this.line.length) {
        this.loopPh += stepHz / sr;
        if (this.loopPh >= 1) {
          this.loopPh -= 1;
          if (this.loopNote) this.loopNote.gate = false;
          let next = (this.loopStep + 1) % this.line.length;
          let note = this.line[next]?.note ?? 60;
          if (overflow) {
            // OVERFLOW：読み出し位置が飛ぶ・行の外のゴミを読む・2 つ同時に鳴る
            if (this.rng.chance(0.25)) next = this.rng.int(this.line.length);
            note = this.line[next].note;
            if (this.rng.chance(0.12)) note += this.rng.int(25) - 12;
            if (this.rng.chance(0.1)) { const v2 = this.voiceOn(this.line[this.rng.int(this.line.length)].note, 0.6, -1); v2.gate = false; }
          }
          this.loopStep = next;
          this.loopNote = this.voiceOn(note + this.octShift * 12, 0.9, -2);
          changed = true;
        }
      }
      // ---- スキャン：押しているキーを 1 つずつ順番に読む ----
      if (scanOn && (this.held.size || this.latched.size)) {
        this.scanPh += scanHz / sr;
        if (this.scanPh >= 1) {
          this.scanPh -= 1;
          const keys = [...new Set([...this.held, ...this.latched])];
          this.scanIdx = (this.scanIdx + 1) % keys.length;
          const k = keys[this.scanIdx];
          const role = TYPO_KEYS[k]?.role;
          const note = k >= RAW_NOTE ? k - RAW_NOTE : role?.r === 'note' ? this.noteOf(role.row, role.col) : 60;
          if (this.scanVoice) this.scanVoice.gate = false;
          this.scanVoice = this.voiceOn(note, 1, -3);
        }
      } else if (this.scanVoice) { this.scanVoice.gate = false; this.scanVoice = null; }

      // ---- ピッチベンド（矢印キー）----
      this.bend += (this.bendDir * bendRange - this.bend) * (1 / (0.08 * sr));

      // ---- 音源 ----
      let x = 0;
      for (const v of this.v) {
        if (v.stage === 'off') continue;
        const dt = 1 / sr;
        if (v.stage === 'a') { v.lvl += dt / 0.003; if (v.lvl >= 1) { v.lvl = 1; v.stage = 'd'; } }
        else if (v.stage === 'd') {
          const sus = v.gate ? 0.35 : 0;
          v.lvl = sus + (v.lvl - sus) * Math.exp(-dt / decay);
          if (!v.gate && v.lvl < 0.3) v.stage = 'r';
        } else { v.lvl *= Math.exp(-dt / 0.06); if (v.lvl < 0.001) { v.stage = 'off'; continue; } }
        const n = v.note + this.bend;
        if (this.corrupt && this.rng.chance(0.0004)) v.note += this.rng.pick([-12, 12, 7, -5]);
        const f = mtof(n);
        v.ph = (v.ph + f / sr) % 1;
        let s: number;
        switch (wave) {
          case 0: s = v.ph < 0.25 ? 1 : -0.5; break;
          case 1: s = 2 * v.ph - 1; break;
          case 2: v.ph2 = (v.ph2 + (f * 3.5) / sr) % 1; s = Math.sin(2 * Math.PI * v.ph + 2 * v.lvl * Math.sin(2 * Math.PI * v.ph2)); break;
          default: if (v.ph < f / sr) v.sh = this.rng.bi(); s = v.sh; break;
        }
        x += s * v.lvl * v.vel;
      }
      x *= 0.22;
      // ---- ドラム ----
      for (let d = this.drumVoices.length - 1; d >= 0; d--) {
        const dv = this.drumVoices[d];
        x += dv.buf[dv.pos | 0] * 0.7;
        dv.pos += toChip;
        if (dv.pos >= dv.buf.length) this.drumVoices.splice(d, 1);
      }

      // ---- TONE → DRIVE → CRUSH（CORRUPT で強くかかる）----
      this.lp += (x - this.lp) * lpCoef;
      x = this.lp;
      if (drive > 0.001) x = Math.tanh(x * (1 + drive * 25)) * (1 - drive * 0.3);
      const c = this.corrupt ? Math.max(crush, 0.85) : crush;
      if (c > 0.001) {
        if (++this.holdCnt >= 1 + Math.floor(c * 8)) { this.holdCnt = 0; const q = Math.pow(2, 12 - c * 9); this.held8 = Math.round(x * q) / q; }
        x = this.held8;
      }
      // ---- STUTTER（Tab）：直前の 1/32 拍を繰り返す ----
      this.stutBuf[this.stutWrite] = x;
      if (this.stutter && this.stutLen > 8) {
        const start = (this.stutWrite - this.stutLen + this.stutPos + this.stutBuf.length) % this.stutBuf.length;
        x = this.stutBuf[start];
        this.stutPos = (this.stutPos + 1) % this.stutLen;
      } else this.stutWrite = (this.stutWrite + 1) % this.stutBuf.length;
      // ---- ECHO ----
      const e = this.echoBuf[(this.echoPos - echoLen + this.echoBuf.length) % this.echoBuf.length];
      this.echoBuf[this.echoPos] = x + e * echo * 0.8;
      this.echoPos = (this.echoPos + 1) % this.echoBuf.length;
      x += e * echo * 0.6;

      // ---- 打鍵音（カチッ）----
      let ck = 0;
      for (let j = this.clicks.length - 1; j >= 0; j--) {
        const cl = this.clicks[j];
        const t = cl.t / sr;
        if (cl.f === 0) ck += this.rng.bi() * Math.exp(-t / 0.08) * 0.5; // 全消去のシャッ
        else ck += (this.rng.bi() * Math.exp(-t / 0.0015) + Math.sin(2 * Math.PI * cl.f * t) * Math.exp(-t / 0.004) * 0.5 + Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.008) * 0.4) * cl.amp;
        if (++cl.t > sr * 0.2) this.clicks.splice(j, 1);
      }
      x += ck * clickVol * 0.5;

      this.gate += ((this.powered ? 1 : 0) - this.gate) * 0.005;
      this.vol += (volTarget - this.vol) * 0.002;
      const y = x - this.dcX + 0.995 * this.dcY;
      this.dcX = x;
      this.dcY = y;
      out[i] = Math.tanh(y) * this.vol * this.gate;
      if (i & 1) { this.scopeBuf[this.scopeW] = out[i]; this.scopeW = (this.scopeW + 1) & 1023; }
    }
    if (changed) this.updateInfo();
    this.updateScope();
  }

  /** 約 30ms ごとに、液晶の波形と鳴っている音を送る（波の頭をそろえて、止まって見えるように） */
  private updateScope(): void {
    if (++this.scopeBlocks < 12) return;
    this.scopeBlocks = 0;
    if (!this.powered) {
      if (this.scopeLive) { this.scopeLive = false; this.display = { ...this.display, scope: undefined, notes: [] }; this.displayVersion++; }
      return;
    }
    this.scopeLive = true;
    const N = 160, b = this.scopeBuf;
    let start = (this.scopeW - N - 200 + 2048) & 1023;
    for (let k = 0; k < 200; k++) {
      const a = b[(start + k) & 1023], c = b[(start + k + 1) & 1023];
      if (a < 0 && c >= 0) { start = (start + k + 1) & 1023; break; }
    }
    const scope: number[] = [];
    for (let k = 0; k < N; k++) scope.push(Math.round(b[(start + k) & 1023] * 100) / 100);
    const notes = [...new Set(this.v.filter((v) => v.stage !== 'off' && v.lvl > 0.05).map((v) => Math.round(v.note)))].sort((x, y) => x - y);
    this.display = { ...this.display, scope, notes };
    this.displayVersion++;
  }
}
