// 音声チップの再生回路＋魔改造配線。
// 8kHz の波形を「クロック」で読み出し、ホストのサンプルレートへはゼロ次ホールド（補間なし）で出す。
// ここに GLITCH（25 種のショート）、LOOP（ホールド／LFO）、STRETCH（粒の引き延ばし）が入っている。

import { Rng } from '../../../core/rng';
import { CHIP_RATE } from './speech';

export const GLITCH_BASES = ['ADDR', 'DATA', 'CLOCK', 'BEEP', 'VOICE'] as const;
export const GLITCH_NAMES = [
  ['SKIP', 'STUTTER', 'REWIND', 'STUCK ADDR', 'REVERSE'],
  ['BIT FLIP', 'LOW BITS', 'MSB HIGH', 'NIBBLE SWAP', 'DROPOUT'],
  ['SLOW', 'FAST', 'WOBBLE', 'STAIRS', 'STALL'],
  ['RUNAWAY', 'RING MOD', 'BEEP ARP', 'NOISE GATE', 'FEEDBACK'],
  ['MISREAD', 'SCRAMBLE', 'GARBAGE', 'MACHINEGUN', 'HICCUP'],
] as const;

const LOOP_LEN = 400; // LOOP のつかむ長さ（チップ 400 サンプル = 50ms）
const AUTO_GRAB = 900; // LOOP スイッチ上：鳴り始め／リリース後、この距離進んだらつかむ（約 110ms）
const GRAIN = 200; // STRETCH の粒の長さ（25ms）

/** 波形の供給元（ファームウェアが用意する） */
export interface ChipSources {
  /** 同じモードの別の音（誤読み上げ用） */
  other(rng: Rng): Float32Array;
  /** システム音（起動音・正解音など） */
  system(rng: Rng): Float32Array;
}

interface GState {
  cd: number; // 次のイベントまでのホストサンプル数
  a: number; // 汎用の状態
  b: number;
  c: number;
  src: Float32Array | null;
}

export class Chip {
  buf: Float32Array | null = null;
  pos = 0;
  playing = false;
  key = -1;

  // ---- 操作側から設定する値 ----
  glitchMask = 0; // bit0..4 = GLITCH 1..5
  base = 0; // 0..4
  autoHold = false; // LOOP スイッチ上
  lfoRate = 0.3;
  lfoDepth = 0.25;
  stretchOn = false;
  stretchHold = 0.4;
  stretchRel = 0.4;

  /** 外から強制的に入れるグリッチ（25bit）。熱による暴発で使う */
  forced = 0;

  // ---- 内部状態 ----
  loopActive = false;
  private loopStart = 0;
  private travel = 0; // 最後の開始／リリースから進んだ距離
  private lfoPh = 0;
  private sPhase: 'rel' | 'hold' = 'rel';
  private sCount = 0;
  private gStart = 0;
  private dir = 1;
  private g: GState[] = Array.from({ length: 25 }, () => ({ cd: 0, a: 0, b: 0, c: 0, src: null }));
  private prevActive = 0; // 前回有効だった組み合わせ（25bit）
  private src: Float32Array | null = null; // 実際に読み出している波形（誤読み上げで変わる）
  private held = 0; // DATA:DROPOUT 用の保持値
  private beepPh = 0;
  private lastOut = 0;
  private wob = 0;
  /** グリッチが実際に効いている強さ（液晶・ストレス用、0..1） */
  glitchActivity = 0;

  constructor(readonly hostRate: number, private rng: Rng, private sources: ChipSources) {}

  start(buf: Float32Array, key: number): void {
    this.buf = buf;
    this.src = buf;
    this.pos = 0;
    this.dir = 1;
    this.playing = buf.length > 0;
    this.key = key;
    this.loopActive = false;
    this.travel = 0;
    this.sPhase = 'rel';
    this.sCount = this.relSamples();
  }

  stop(): void {
    this.playing = false;
    this.loopActive = false;
  }

  /** 乱数の状態（液晶のグリッチ模様を音と揃えるために使う） */
  get rngState(): number {
    return this.rng.getState();
  }

  /** いま効いているグリッチの組み合わせ（25bit） */
  get activeCombos(): number {
    return this.prevActive;
  }

  /** LOOP HOLD：いま鳴っている直前の断片をつかむ */
  grab(): void {
    if (!this.playing || !this.src) return;
    this.loopActive = true;
    this.loopStart = Math.max(0, Math.floor(this.pos) - LOOP_LEN);
  }

  /** LOOP RELEASE：ホールド／ストレッチを解除して先へ進む */
  release(): void {
    if (this.loopActive) this.pos = this.loopStart + LOOP_LEN;
    this.loopActive = false;
    this.travel = 0;
    this.sPhase = 'rel';
    this.sCount = this.relSamples();
    this.dir = 1;
  }

  get stretchLed(): boolean {
    return this.stretchOn && this.playing && this.sPhase === 'hold' && !this.loopActive;
  }

  private msToHost(ms: number): number {
    return Math.max(1, Math.round((ms / 1000) * this.hostRate));
  }
  private holdSamples(): number {
    return this.msToHost(15 * Math.pow(60, this.stretchHold)); // 15ms〜900ms
  }
  private relSamples(): number {
    return this.msToHost(8 * Math.pow(50, this.stretchRel)); // 8ms〜400ms
  }
  private rnd(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng.next();
  }

  /** 組み合わせ c（base*5+button）が有効になった瞬間の初期化 */
  private initGlitch(c: number): void {
    const s = this.g[c];
    s.cd = 0; s.a = 0; s.b = 0; s.c = 0; s.src = null;
    const len = this.src?.length ?? 1;
    switch (c) {
      case 1: s.a = Math.floor(this.pos); s.b = Math.floor(this.rnd(120, 560)); break; // STUTTER
      case 3: s.a = 1 << (8 + this.rng.int(4)); break; // STUCK ADDR
      case 5: s.a = 1 << (1 + this.rng.int(6)); break; // BIT FLIP
      case 10: s.a = this.rng.pick([0.5, 0.25, 0.33, 0.66]); break;
      case 11: s.a = this.rng.pick([2, 3, 1.5, 4]); break;
      case 13: s.a = 1; break;
      case 16: s.a = this.rnd(30, 900); break; // RING MOD 周波数
      case 18: s.a = Math.floor(this.rnd(50, 1500)); break;
      case 20: s.src = this.sources.other(this.rng); break; // MISREAD
      case 23: s.a = Math.floor(this.pos); s.b = this.msToHost(this.rnd(55, 125)); break; // MACHINEGUN
      case 24: s.src = this.sources.system(this.rng); break;
    }
    if (c === 1) s.a = Math.min(s.a, Math.max(0, len - s.b));
  }

  /** 1 サンプル進めて値を返す */
  tick(): number {
    if (!this.buf) return 0;
    const H = this.hostRate;
    const mask = this.playing ? this.glitchMask : 0;
    const base = this.base;

    // ---- 有効なグリッチの組み合わせを調べる ----
    let active = 0;
    for (let i = 0; i < 5; i++) if (mask & (1 << i)) active |= 1 << (base * 5 + i);
    if (this.playing) active |= this.forced;
    if (active !== this.prevActive) {
      const rising = active & ~this.prevActive;
      for (let c = 0; c < 25; c++) if (rising & (1 << c)) this.initGlitch(c);
      if (!(active & ((1 << 20) | (1 << 21) | (1 << 22) | (1 << 24)))) this.src = this.buf;
      if (!(active & (1 << 4))) this.dir = 1;
      this.prevActive = active;
    }
    if (!this.playing) return 0;
    this.glitchActivity += ((active ? 1 : 0) - this.glitchActivity) * 0.001;

    let src = this.src ?? this.buf;
    let mul = 1; // クロック倍率

    // ---- LFO（ホールド中のみ） ----
    if (this.loopActive) {
      const rate = 0.1 * Math.pow(2, this.lfoRate * 8); // 0.1〜25Hz
      this.lfoPh = (this.lfoPh + rate / H) % 1;
      mul *= Math.pow(2, this.lfoDepth * 1.2 * Math.sin(2 * Math.PI * this.lfoPh));
    }

    // ---- 位置・クロック・読み出し元を変えるグリッチ ----
    if (active) {
      for (let c = 0; c < 25; c++) {
        if (!(active & (1 << c))) continue;
        if ((c >= 5 && c < 10) || (c >= 15 && c < 19)) continue; // 値を変える系は後で処理
        const s = this.g[c];
        const len = src.length;
        const ev = --s.cd <= 0;
        switch (c) {
          // ADDR
          case 0: if (ev) { s.cd = this.msToHost(this.rnd(25, 60)); this.pos = (this.pos + len * this.rnd(0.05, 0.3)) % len; } break;
          case 1: if (ev) { s.cd = this.msToHost(this.rnd(250, 500)); s.b = Math.floor(this.rnd(120, 560)); } break;
          case 2: if (ev) { s.cd = this.msToHost(this.rnd(80, 160)); this.pos = Math.max(0, this.pos - this.rnd(400, 1600)); } break;
          case 3: if (ev) { s.cd = this.msToHost(300); if (this.rng.chance(0.4)) s.a = 1 << (8 + this.rng.int(4)); } break;
          case 4: if (ev) { s.cd = this.msToHost(this.rnd(40, 90)); this.dir = this.dir > 0 ? -1 : 1; } break;
          // CLOCK
          case 10: mul *= s.a; break;
          case 11: mul *= s.a; break;
          case 12: if (ev) { s.cd = this.msToHost(8); s.b = this.rng.bi() * 0.9; } this.wob += (s.b - this.wob) * 0.004; mul *= Math.pow(2, this.wob); break;
          case 13: if (ev) { s.cd = this.msToHost(this.rnd(40, 90)); s.a = Math.pow(2, (this.rng.int(31) - 12) / 12); } mul *= s.a; break;
          case 14: if (ev) { s.b = 1 - s.b; s.cd = this.msToHost(this.rnd(10, 60)); } mul *= s.b ? 0 : 1.6; break;
          // BEEP:FEEDBACK
          case 19: mul *= Math.max(0.05, 1 + this.lastOut * 5); break;
          // VOICE
          case 20: if (ev) { s.cd = this.msToHost(this.rnd(200, 350)); if (this.rng.chance(0.5)) s.src = this.sources.other(this.rng); } if (s.src) src = s.src; break;
          case 21: if (ev) { s.cd = this.msToHost(this.rnd(60, 120)); s.src = this.sources.other(this.rng); this.pos = this.rng.next() * s.src.length; } if (s.src) src = s.src; break;
          case 22: if (ev) { s.cd = this.msToHost(this.rnd(12, 30)); s.src = this.rng.chance(0.5) ? this.sources.other(this.rng) : this.sources.system(this.rng); this.pos = this.rng.next() * s.src.length; } if (s.src) src = s.src; break;
          case 23: if (ev) { s.cd = s.b; this.pos = s.a; } break;
          case 24: if (ev) { s.c = 1 - s.c; s.cd = this.msToHost(s.c ? this.rnd(50, 110) : this.rnd(120, 280)); if (s.c) { s.src = this.sources.system(this.rng); s.a = this.pos; this.pos = this.rng.next() * s.src.length * 0.7; } else this.pos = s.a; } if (s.c && s.src) src = s.src; break;
        }
      }
    }
    this.src = src;

    // ---- 読み出し ----
    const len = src.length;
    let idx = Math.floor(this.pos);
    if (active & (1 << 3)) idx = (idx | this.g[3].a) % len; // STUCK ADDR
    if (idx < 0) idx = 0;
    if (idx >= len) idx = len - 1;
    let v = src[idx];

    // ---- データ線のグリッチ（8bit 値をいじる） ----
    if (active & 0b11111 << 5) {
      let u = (Math.round(v * 127) + 128) & 255;
      if (active & (1 << 5)) { const s = this.g[5]; if (--s.cd <= 0) { s.cd = this.msToHost(this.rnd(20, 80)); s.a = 1 << (1 + this.rng.int(6)); } u ^= s.a; }
      if (active & (1 << 6)) { const s = this.g[6]; if (--s.cd <= 0) { s.cd = this.msToHost(this.rnd(30, 120)); s.a = this.rng.pick([0xe0, 0xc0, 0xf0]); } u &= s.a; }
      if (active & (1 << 7)) u |= this.rng.chance(0.002) ? 0xc0 : 0x80;
      if (active & (1 << 8)) u = ((u & 0x0f) << 4) | (u >> 4);
      v = (u - 128) / 127;
      if (active & (1 << 9)) {
        const s = this.g[9];
        if (--s.cd <= 0) { s.b = this.rng.int(3); s.cd = this.msToHost(this.rnd(5, 40)); this.held = v; }
        if (s.b === 1) v = this.held;
        else if (s.b === 2) v = 0;
      }
    }

    // ---- ビープ系（音声チップの横のブザー回路が暴走） ----
    if (active & 0b11111 << 15) {
      const amp = Math.abs(v);
      if (active & (1 << 15)) {
        const f = 200 + amp * 3000;
        this.beepPh = (this.beepPh + f / H) % 1;
        v = v * 0.5 + (this.beepPh < 0.5 ? 0.45 : -0.45) * Math.min(1, amp * 4 + 0.2);
      }
      if (active & (1 << 16)) {
        const s = this.g[16];
        s.a *= 1 + this.rng.bi() * 0.0005;
        s.b = (s.b + s.a / H) % 1;
        v *= s.b < 0.5 ? 1 : -1;
      }
      if (active & (1 << 17)) {
        const s = this.g[17];
        if (--s.cd <= 0) { s.cd = this.msToHost(30); s.a = 300 * Math.pow(2, this.rng.int(24) / 12); }
        s.b = (s.b + s.a / H) % 1;
        v = amp > 0.02 ? (s.b < 0.5 ? 0.6 : -0.6) : 0;
      }
      if (active & (1 << 18)) {
        const s = this.g[18];
        s.c += (amp - s.c) * 0.01;
        v = this.rng.bi() * Math.min(1, s.c * 3);
      }
    }

    // ---- 位置を進める ----
    const step = (this.dir * CHIP_RATE * mul) / H;
    this.pos += step;
    if (step > 0) this.travel += step;

    if (active & (1 << 1)) {
      // STUTTER：同じ断片の連打
      const s = this.g[1];
      if (this.pos >= s.a + s.b || this.pos < s.a) this.pos = s.a;
    } else if (this.loopActive) {
      if (this.pos >= this.loopStart + LOOP_LEN) this.pos -= LOOP_LEN;
      else if (this.pos < this.loopStart) this.pos += LOOP_LEN;
    } else if (this.stretchOn) {
      // STRETCH：「止めて粒を繰り返す」と「普通に進む」を交互に
      if (--this.sCount <= 0) {
        if (this.sPhase === 'rel') { this.sPhase = 'hold'; this.sCount = this.holdSamples(); this.gStart = Math.floor(this.pos); }
        else { this.sPhase = 'rel'; this.sCount = this.relSamples(); }
      }
      if (this.sPhase === 'hold' && this.pos >= this.gStart + GRAIN) this.pos -= GRAIN;
    }
    if (this.autoHold && !this.loopActive && this.travel > AUTO_GRAB) this.grab();

    // ---- 終わりの処理 ----
    if (this.pos >= len || this.pos < 0) {
      if (active) {
        // ショート中は止まらず、どこかから鳴り直す
        this.pos = this.rng.next() * len * 0.7;
      } else if (this.loopActive) {
        this.pos = this.loopStart;
      } else {
        this.playing = false;
        this.loopActive = false;
        return 0;
      }
    }
    this.lastOut = v;
    return v;
  }
}
