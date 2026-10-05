// パターンシーケンサー（DOM 非依存）。16 パターン（1〜8 小節・4/4）と、パターンをつないだソング。
// リアルタイム録音（クオンタイズ・重ね録り）・スイング・メトロノーム。時刻は拍（4 分音符 = 1）。
import type { TrigMod } from './types';

export const PATTERNS = 16;

export interface SeqEvent {
  /** 拍（パターンの頭から） */
  t: number;
  pad: number;
  vel: number;
  /** 押していた長さ（拍）。GATE のパッドはこの長さで止まる */
  len: number;
  mod?: TrigMod;
}
export interface Pattern {
  bars: number;
  events: SeqEvent[];
  /** 拍子：1 小節の拍の数（2〜7。無ければ 4） */
  meter?: number;
}
/** 1 小節の拍の数 */
export const ptnMeter = (p: Pattern) => Math.max(2, Math.min(7, Math.round(p.meter ?? 4)));
/** パターンの長さ（拍） */
export const ptnBeats = (p: Pattern) => Math.max(1, p.bars) * ptnMeter(p);
export interface SongStep {
  ptn: number;
  reps: number;
}
export const emptyPattern = (): Pattern => ({ bars: 2, events: [] });

/** クオンタイズの細かさ（拍。0 = なし） */
export const QUANTS = [0, 0.5, 0.25, 0.125, 1 / 3, 1 / 6];
export const QUANT_NAMES = ['OFF', '1/8', '1/16', '1/32', '1/8T', '1/16T'];

/** スイング：16 分の裏（2 つめ）を遅らせる。swing = 0.5（なし）〜 0.75 */
export function swingT(t: number, swing: number): number {
  const s16 = t * 4;
  const r = Math.round(s16);
  if (Math.abs(s16 - r) < 1e-6 && r % 2 === 1) return t + (swing - 0.5) * 0.5;
  return t;
}

export interface SeqOut {
  fire(pad: number, vel: number, mod?: TrigMod): void;
  release(pad: number): void;
  click(accent: boolean): void;
  /** 録音した音を画面に知らせる */
  added(ptn: number, ev: SeqEvent): void;
}

export class PatternPlayer {
  patterns: Pattern[] = Array.from({ length: PATTERNS }, emptyPattern);
  song: SongStep[] = [];
  playing = false;
  recording = false;
  mode: 'pattern' | 'song' = 'pattern';
  cur = 0;
  /** 再生中にパターンを替えたら、いまのパターンの終わりで替わる */
  next = -1;
  step = 0;
  rep = 0;
  /** パターンの中の位置（拍） */
  pos = 0;
  /** 再生を始めてからの拍 */
  played = 0;
  quant = 0.25;
  swing = 0.5;
  metro = false;
  private sched: { t: number; ev: SeqEvent }[] = [];
  private idx = 0;
  private offs: { pad: number; at: number }[] = [];
  private skip = new Set<SeqEvent>();
  private rec = new Map<number, { t: number; vel: number; mod?: TrigMod; at: number }>();
  private beatIdx = -1;

  constructor(private out: SeqOut) {}

  len(): number {
    return ptnBeats(this.patterns[this.cur]);
  }

  private build(): void {
    this.sched = this.patterns[this.cur].events
      .map((ev) => ({ t: swingT(ev.t, this.swing), ev }))
      .filter((x) => x.t < this.len())
      .sort((a, b) => a.t - b.t);
    this.idx = 0;
    while (this.idx < this.sched.length && this.sched[this.idx].t < this.pos - 1e-9) this.idx++;
  }

  setPattern(i: number, p: Pattern): void {
    this.patterns[i] = { bars: p.bars, meter: p.meter, events: p.events.map((e) => ({ ...e })) };
    if (i === this.cur) this.build();
  }
  setSwing(s: number): void {
    this.swing = s;
    this.build();
  }

  start(mode: 'pattern' | 'song', ptn: number): void {
    this.stop();
    this.mode = mode;
    if (mode === 'song') {
      if (!this.song.length) return;
      this.step = 0;
      this.rep = 0;
      this.cur = this.song[0].ptn;
    } else this.cur = ptn;
    this.next = -1;
    this.pos = 0;
    this.played = 0;
    this.beatIdx = -1;
    this.playing = true;
    this.build();
  }

  stop(): void {
    for (const o of this.offs) this.out.release(o.pad);
    this.offs = [];
    this.rec.clear();
    this.skip.clear();
    this.playing = false;
    this.recording = false;
  }

  select(i: number): void {
    if (this.playing && this.mode === 'pattern') this.next = i;
    else { this.cur = i; this.build(); }
  }

  /** 次の出来事までの拍（無ければ max） */
  untilNext(max: number): number {
    if (!this.playing) return max;
    let d = Math.min(max, this.len() - this.pos);
    if (this.idx < this.sched.length) d = Math.min(d, this.sched[this.idx].t - this.pos);
    for (const o of this.offs) d = Math.min(d, o.at - this.played);
    if (this.metro) d = Math.min(d, Math.floor(this.pos + 1e-9) + 1 - this.pos);
    return Math.max(0, d);
  }

  advance(beats: number): void {
    if (!this.playing) return;
    this.pos += beats;
    this.played += beats;
  }

  /** いまの時刻の出来事を起こす */
  fireDue(): void {
    if (!this.playing) return;
    const eps = 1e-7;
    // パターンの終わり → 頭へ（ソングなら次のパターンへ）
    if (this.pos >= this.len() - eps) {
      this.pos -= this.len();
      if (Math.abs(this.pos) < eps) this.pos = 0;
      if (this.mode === 'song') {
        if (++this.rep >= Math.max(1, this.song[this.step].reps)) {
          this.rep = 0;
          this.step++;
          if (this.step >= this.song.length) { this.stop(); return; }
        }
        this.cur = this.song[this.step].ptn;
      } else if (this.next >= 0) {
        this.cur = this.next;
        this.next = -1;
      }
      this.skip.clear();
      this.beatIdx = -1;
      this.build();
    }
    // 止める予定
    this.offs = this.offs.filter((o) => {
      if (o.at > this.played + eps) return true;
      this.out.release(o.pad);
      return false;
    });
    // メトロノーム
    if (this.metro) {
      const b = Math.floor(this.pos + eps);
      if (b !== this.beatIdx && this.pos - b < 1e-4) { this.beatIdx = b; this.out.click(b % ptnMeter(this.patterns[this.cur]) === 0); }
    }
    // 音
    while (this.idx < this.sched.length && this.sched[this.idx].t <= this.pos + eps) {
      const { ev } = this.sched[this.idx++];
      if (this.skip.delete(ev)) continue;
      this.out.fire(ev.pad, ev.vel, ev.mod);
      this.offs.push({ pad: ev.pad, at: this.played + Math.max(0.02, ev.len) });
    }
  }

  // ---------------- 録音 ----------------
  private q(t: number): number {
    if (!this.quant) return t;
    const L = this.len();
    return (Math.round(t / this.quant) * this.quant) % L;
  }
  /** 手で叩いた録音を前にずらす秒数（スピーカーの遅れ。聞こえた音に合わせて叩くと、その分おそく押すため） */
  recLatency = 0;
  bpmOf: () => number = () => 120;
  noteOn(pad: number, vel: number, mod?: TrigMod): void {
    if (!this.playing || !this.recording) return;
    const L = this.len(), back = (this.recLatency * this.bpmOf()) / 60;
    this.rec.set(pad, { t: this.q((((this.pos - back) % L) + L) % L), vel, mod, at: this.played });
  }
  noteOff(pad: number): void {
    const r = this.rec.get(pad);
    if (!r) return;
    this.rec.delete(pad);
    const ev: SeqEvent = { t: Math.round(r.t * 1e6) / 1e6, pad, vel: Math.round(r.vel * 1000) / 1000, len: Math.max(0.0625, Math.round((this.played - r.at) * 1000) / 1000) };
    if (r.mod) ev.mod = r.mod;
    const p = this.patterns[this.cur];
    p.events.push(ev);
    p.events.sort((a, b) => a.t - b.t);
    // クオンタイズで少し先に置いた音は、この周ではもう鳴らしたので飛ばす
    const st = swingT(ev.t, this.swing);
    if (st > this.pos) this.skip.add(ev);
    this.build();
    this.out.added(this.cur, ev);
  }
}
