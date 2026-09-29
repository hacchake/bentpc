// シーケンサー本体（Worklet の中で動く。DOM に依存しない）。
// ・再生：曲の音符とツマミの動きを、サンプル単位の正確な位置でおもちゃに送る（ブロックを細かく区切って処理）
// ・録音：手で弾いた操作を拍の位置つきで集め、ループが 1 周するたびに曲へ重ねる（オーバーダブ）
// ・メトロノーム：録音の出力には入れず、スピーカーにだけ出す
// ・スタジオ用：ループ範囲、ボタン（momentary のパラメーター）を音符として扱う、電源・クラッシュ→再起動、
//   ノブの点の間をなめらかにつなぐ、シードで「頭から再生するたびにおもちゃを新品にする」（毎回同じ音）

import {
  BTN, SYS_CRASH, SYS_POWER_OFF, SYS_POWER_ON, emptySong, mergeTake, songBeats, takeFromRaw, trackToy, type RawEvent, type SeqAuto, type Song,
} from '../core/song';
import type { ToyEngine } from '../core/toy';

type Ev = { off: number; apply: () => void };

export interface SeqCallbacks {
  onTake(take: number, data: ReturnType<typeof takeFromRaw>): void;
  onEnd(): void;
  /** おもちゃを作り直した（表示の状態を捨てるため） */
  onRebuild?(): void;
}

/** クラッシュ中の状態：直前の音の断片が張り付いて鳴り、やがて無音になる */
interface Crash {
  t: number;
  seg: Float32Array;
}

const HIST = 2048;
const STUCK_SEC = 0.45;

export class Sequencer {
  song: Song;
  playing = false;
  recording = false;
  pos = 0; // 拍
  bounce = false; // BOUNCE：ループせず 1 回で止まる
  private take = 0;
  private raw: RawEvent[] = [];
  private held: Set<number>[]; // シーケンサーが押しているキー（おもちゃごと）
  private liveHeld: Set<number>[]; // 手で押しているキー（録音の区切りで続きを作るため）
  private clickT = 1e9;
  private clickAccent = false;
  private crash: (Crash | null)[];
  private hist: Float32Array[]; // 各おもちゃの直前の出力（クラッシュの張り付き用）
  private hpos: number[];
  private ramps: { toy: number; index: number; pts: SeqAuto[] }[] = [];

  /** factory：シード → 新品のおもちゃ一式（スタジオ）。無ければ作り直さない */
  constructor(private sr: number, readonly toys: ToyEngine[], private cb: SeqCallbacks, private factory?: (seed: number) => ToyEngine[]) {
    this.song = emptySong(toys.length);
    this.held = toys.map(() => new Set());
    this.liveHeld = toys.map(() => new Set());
    this.crash = toys.map(() => null);
    this.hist = toys.map(() => new Float32Array(HIST));
    this.hpos = toys.map(() => 0);
  }

  get framesPerBeat(): number {
    return (this.sr * 60) / this.song.bpm;
  }

  setSong(song: Song): void {
    this.releaseAll();
    this.song = song;
    if (!song.tracks.some((t) => t.toy !== undefined)) {
      while (this.song.tracks.length < this.toys.length) this.song.tracks.push({ mute: false, notes: [], autos: [] });
    }
    // なめらかにつなぐノブの点を、おもちゃ×パラメーターごとにまとめておく
    this.ramps = [];
    if (song.ramp) {
      const m = new Map<string, { toy: number; index: number; pts: SeqAuto[] }>();
      song.tracks.forEach((tr, i) => {
        const toy = trackToy(song, i);
        if (tr.mute || !this.toys[toy]) return;
        for (const a of tr.autos) {
          if (this.toys[toy].paramDefs[a.index]?.kind !== 'continuous') continue;
          const k = `${toy}:${a.index}`;
          if (!m.has(k)) m.set(k, { toy, index: a.index, pts: [] });
          m.get(k)!.pts.push(a);
        }
      });
      this.ramps = [...m.values()];
      this.ramps.forEach((r) => r.pts.sort((a, b) => a.t - b.t));
    }
  }

  play(from?: number): void {
    if (from !== undefined) { this.releaseAll(); this.pos = from; }
    // 頭からの再生：おもちゃを新品に作り直す（同じ曲データなら毎回同じ音・同じグリッチ）
    if (this.pos < 1e-9 && this.song.seed !== undefined && this.factory) this.rebuild();
    this.playing = true;
  }

  stop(): void {
    if (this.recording) this.flushTake(this.pos, true);
    this.playing = false;
    this.recording = false;
    this.bounce = false;
    this.releaseAll();
  }

  /** おもちゃを新品にする。POWER ON の音符が無いおもちゃは、すぐ電源を入れる */
  private rebuild(): void {
    const fresh = this.factory!(this.song.seed!);
    fresh.forEach((t, i) => { this.toys[i] = t; });
    this.held.forEach((s) => s.clear());
    this.crash.fill(null);
    this.hist.forEach((h) => h.fill(0));
    this.toys.forEach((t, toy) => {
      const hasPower = this.song.tracks.some((tr, i) => trackToy(this.song, i) === toy && !tr.mute && tr.notes.some((n) => n.key === SYS_POWER_ON));
      if (!hasPower) t.powerOn();
    });
    this.cb.onRebuild?.();
  }

  setRecording(on: boolean, takeId?: number): void {
    if (on && !this.recording) {
      this.take = takeId ?? this.take + 1;
      this.raw = [];
      // 録音を始めた時点で押しているキーは、ここから押したことにする
      this.liveHeld.forEach((s, toy) => s.forEach((key) => this.raw.push({ toy, kind: 'key', key, down: true, beat: this.pos })));
    } else if (!on && this.recording) this.flushTake(this.pos, false);
    this.recording = on;
  }

  /** 手で弾いた操作（Worklet がおもちゃに渡すのと同時に呼ぶ） */
  live(toy: number, m: { type: 'key'; key: number; down: boolean } | { type: 'param'; index: number; value: number }): void {
    // 押している間だけのボタン（GLITCH・RESET など）は、パラメーターではなく「音符」として録る
    if (m.type === 'param' && this.toys[toy]?.paramDefs[m.index]?.kind === 'momentary') m = { type: 'key', key: BTN + m.index, down: m.value > 0.5 };
    if (m.type === 'key') {
      if (m.down) this.liveHeld[toy].add(m.key);
      else this.liveHeld[toy].delete(m.key);
    }
    if (!this.recording || !this.playing) return;
    if (m.type === 'key') this.raw.push({ toy, kind: 'key', key: m.key, down: m.down, beat: this.pos });
    else this.raw.push({ toy, kind: 'param', index: m.index, value: m.value, beat: this.pos });
  }

  /** 録ったものを曲に重ね、画面に知らせる。final でなければ、押しっぱなしのキーを restart の位置から続ける */
  private flushTake(end: number, final: boolean, restart = 0): void {
    if (!this.raw.length) return;
    const data = takeFromRaw(this.raw, this.take, end);
    mergeTake(this.song, data);
    this.cb.onTake(this.take, data);
    this.raw = [];
    if (!final) this.liveHeld.forEach((s, toy) => s.forEach((key) => this.raw.push({ toy, kind: 'key', key, down: true, beat: restart })));
  }

  /** 音符のキーを押す／離す（ボタン・電源・クラッシュも） */
  private press(toy: number, key: number, down: boolean): void {
    const t = this.toys[toy];
    if (key >= SYS_CRASH) {
      if (key === SYS_POWER_ON && down) t.powerOn();
      else if (key === SYS_POWER_OFF && down) t.powerOff();
      else if (key === SYS_CRASH) {
        if (down) {
          // 直前 30ms ほどの音を切り出して、張り付かせる
          const n = Math.floor(this.sr * 0.03), h = this.hist[toy], seg = new Float32Array(n);
          for (let i = 0; i < n; i++) seg[i] = h[(this.hpos[toy] - n + i + HIST) % HIST];
          this.crash[toy] = { t: 0, seg };
        } else if (this.crash[toy]) {
          // 復帰：RESET → 電源を入れ直す（起動音）
          this.crash[toy] = null;
          t.reset?.();
          t.powerOff();
          t.powerOn();
        }
      }
    } else if (key >= BTN) t.setParam(key - BTN, down ? 1 : 0);
    else if (down) t.keyDown(key);
    else t.keyUp(key);
  }

  private releaseAll(): void {
    this.held.forEach((s, toy) => {
      s.forEach((k) => this.press(toy, k, false));
      s.clear();
    });
  }

  /** いまクラッシュしているおもちゃ */
  crashed(toy: number): boolean {
    return !!this.crash[toy];
  }

  /**
   * n サンプル分、すべてのおもちゃを動かして out（モノラル）に混ぜる。
   * click にはメトロノームの音だけを書く（録音には入れないため別にする）。
   */
  render(out: Float32Array, click: Float32Array, tmp: Float32Array, input?: Float32Array): void {
    const n = out.length;
    const evs: Ev[][] = this.toys.map(() => []);
    click.fill(0);
    if (this.playing) this.schedule(n, evs);
    out.fill(0);
    this.toys.forEach((_, toy) => {
      const list = evs[toy].sort((a, b) => a.off - b.off);
      let cur = 0;
      const run = (to: number) => {
        const t = this.toys[toy]; // 途中で作り直されることがあるので毎回見る
        const seg = tmp.subarray(cur, to);
        t.process(seg, t.wantsInput ? input?.subarray(cur, to) : undefined);
        this.afterProcess(toy, seg);
        for (let i = cur; i < to; i++) out[i] += tmp[i];
        cur = to;
      };
      for (const e of list) {
        if (e.off > cur) run(e.off);
        e.apply();
      }
      if (cur < n) run(n);
    });
    // メトロノーム
    if (this.song.metronome && this.playing) {
      for (let i = 0; i < n; i++) {
        if (this.clickT < this.sr * 0.03) {
          const t = this.clickT / this.sr;
          click[i] = Math.sin(2 * Math.PI * (this.clickAccent ? 1760 : 1320) * t) * Math.exp(-t / 0.006) * 0.25;
        }
        this.clickT++;
      }
    }
  }

  /** 出力の履歴を残し、クラッシュ中なら音を差し替える */
  private afterProcess(toy: number, seg: Float32Array): void {
    const c = this.crash[toy];
    if (c) {
      const stuck = this.sr * STUCK_SEC;
      for (let i = 0; i < seg.length; i++, c.t++) {
        seg[i] = c.t < stuck ? c.seg[c.t % c.seg.length] * (1 - (c.t / stuck) * 0.4) * (c.t % 4096 < 3500 ? 1 : 0.3) : 0;
      }
      return;
    }
    const h = this.hist[toy];
    let p = this.hpos[toy];
    for (let i = 0; i < seg.length; i++) { h[p] = seg[i]; p = (p + 1) % HIST; }
    this.hpos[toy] = p;
  }

  /** このブロックの中で起きることを、サンプル位置つきで並べる */
  private schedule(n: number, evs: Ev[][]): void {
    const fpb = this.framesPerBeat;
    const len = songBeats(this.song);
    const loop = this.song.loop;
    let beat = this.pos;
    let off = 0;
    let remain = n;
    while (remain > 0) {
      // この周の終わり：ループ範囲の中ならその終わり、外なら曲の終わり
      const endB = !this.bounce && loop?.on && beat < loop.end ? Math.min(loop.end, len) : len;
      const toEnd = Math.max(0, (endB - beat) * fpb);
      const span = Math.min(remain, toEnd);
      const b0 = beat, b1 = beat + span / fpb;
      // メトロノームの位置
      for (let k = Math.ceil(b0 - 1e-9); k < b1; k++) {
        const o = off + Math.round((k - b0) * fpb);
        evs[0].push({ off: Math.min(n - 1, Math.max(0, o)), apply: () => { this.clickT = 0; this.clickAccent = k % 4 === 0; } });
      }
      this.song.tracks.forEach((tr, i) => {
        const toy = trackToy(this.song, i);
        if (tr.mute || toy >= this.toys.length) return;
        for (const note of tr.notes) {
          if (note.start >= b0 && note.start < b1) {
            evs[toy].push({ off: off + Math.floor((note.start - b0) * fpb), apply: () => { this.press(toy, note.key, true); this.held[toy].add(note.key); } });
          }
          const e = note.start + note.len;
          if (e >= b0 && e < b1) {
            evs[toy].push({ off: off + Math.floor((e - b0) * fpb), apply: () => { this.press(toy, note.key, false); this.held[toy].delete(note.key); } });
          }
        }
        for (const a of tr.autos) {
          if (a.t >= b0 && a.t < b1) evs[toy].push({ off: off + Math.floor((a.t - b0) * fpb), apply: () => this.toys[toy].setParam(a.index, a.v) });
        }
      });
      // ノブの点と点の間：このブロックの頭の位置の値にする（約 2.7ms ごとになめらかに動く）
      for (const r of this.ramps) {
        const pts = r.pts;
        for (let j = 0; j + 1 < pts.length; j++) {
          const p = pts[j], q = pts[j + 1];
          if (b0 > p.t && b0 < q.t) {
            const v = p.v + ((q.v - p.v) * (b0 - p.t)) / (q.t - p.t);
            evs[r.toy].push({ off, apply: () => this.toys[r.toy].setParam(r.index, v) });
            break;
          }
        }
      }
      off += span;
      remain -= span;
      beat = b1;
      if (beat >= endB - 1e-9) {
        // 周の終わり：押しているキーを離し、録音を区切って曲に重ねる
        const at = Math.min(n - 1, off);
        this.toys.forEach((_, toy) => evs[toy].push({ off: at, apply: () => { this.held[toy].forEach((k) => this.press(toy, k, false)); this.held[toy].clear(); } }));
        // 戻る先：ループ範囲があればその頭、ループなしの設定なら止まる（-1）、従来の曲は 0
        const wrapTo = loop ? (loop.on && endB === loop.end && !this.bounce ? loop.start : -1) : 0;
        if (this.recording) this.flushTake(endB, wrapTo < 0 || this.bounce, Math.max(0, wrapTo));
        if (this.bounce || wrapTo < 0) {
          // BOUNCE・ループなし：最後まで来たら止まる
          this.recording = false;
          this.playing = false;
          this.bounce = false;
          this.pos = loop?.on ? loop.start : 0;
          this.cb.onEnd();
          return;
        }
        beat = wrapTo;
      }
    }
    this.pos = beat;
  }
}
