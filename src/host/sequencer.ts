// シーケンサー本体（Worklet の中で動く。DOM に依存しない）。
// ・再生：曲の音符とツマミの動きを、サンプル単位の正確な位置でおもちゃに送る（ブロックを細かく区切って処理）
// ・録音：手で弾いた操作を拍の位置つきで集め、ループが 1 周するたびに曲へ重ねる（オーバーダブ）
// ・メトロノーム：録音の出力には入れず、スピーカーにだけ出す

import { emptySong, mergeTake, songBeats, takeFromRaw, type RawEvent, type Song } from '../core/song';
import type { ToyEngine } from '../core/toy';

type Ev = { off: number; apply: () => void };

export interface SeqCallbacks {
  onTake(take: number, data: ReturnType<typeof takeFromRaw>): void;
  onEnd(): void;
}

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

  constructor(private sr: number, private toys: ToyEngine[], private cb: SeqCallbacks) {
    this.song = emptySong(toys.length);
    this.held = toys.map(() => new Set());
    this.liveHeld = toys.map(() => new Set());
  }

  get framesPerBeat(): number {
    return (this.sr * 60) / this.song.bpm;
  }

  setSong(song: Song): void {
    this.releaseAll();
    this.song = song;
    while (this.song.tracks.length < this.toys.length) this.song.tracks.push({ mute: false, notes: [], autos: [] });
  }

  play(from?: number): void {
    if (from !== undefined) { this.releaseAll(); this.pos = from; }
    this.playing = true;
  }

  stop(): void {
    if (this.recording) this.flushTake(this.pos, true);
    this.playing = false;
    this.recording = false;
    this.bounce = false;
    this.releaseAll();
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
    if (m.type === 'key') {
      if (m.down) this.liveHeld[toy].add(m.key);
      else this.liveHeld[toy].delete(m.key);
    }
    if (!this.recording || !this.playing) return;
    if (m.type === 'key') this.raw.push({ toy, kind: 'key', key: m.key, down: m.down, beat: this.pos });
    else this.raw.push({ toy, kind: 'param', index: m.index, value: m.value, beat: this.pos });
  }

  /** 録ったものを曲に重ね、画面に知らせる。wrap = ループの終わりで区切ったとき */
  private flushTake(end: number, final: boolean): void {
    if (!this.raw.length) return;
    const data = takeFromRaw(this.raw, this.take, end);
    mergeTake(this.song, data);
    this.cb.onTake(this.take, data);
    this.raw = [];
    // 押しっぱなしのキーは、次の周の頭から続ける
    if (!final) this.liveHeld.forEach((s, toy) => s.forEach((key) => this.raw.push({ toy, kind: 'key', key, down: true, beat: 0 })));
  }

  private releaseAll(): void {
    this.held.forEach((s, toy) => {
      s.forEach((k) => this.toys[toy].keyUp(k));
      s.clear();
    });
  }

  /**
   * n サンプル分、すべてのおもちゃを動かして out（モノラル）に混ぜる。
   * click にはメトロノームの音だけを書く（録音には入れないため別にする）。
   */
  render(out: Float32Array, click: Float32Array, tmp: Float32Array): void {
    const n = out.length;
    const evs: Ev[][] = this.toys.map(() => []);
    click.fill(0);
    if (this.playing) this.schedule(n, evs);
    out.fill(0);
    this.toys.forEach((t, toy) => {
      const list = evs[toy].sort((a, b) => a.off - b.off);
      let cur = 0;
      for (const e of list) {
        if (e.off > cur) { t.process(tmp.subarray(cur, e.off)); for (let i = cur; i < e.off; i++) out[i] += tmp[i]; cur = e.off; }
        e.apply();
      }
      if (cur < n) { t.process(tmp.subarray(cur, n)); for (let i = cur; i < n; i++) out[i] += tmp[i]; }
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

  /** このブロックの中で起きることを、サンプル位置つきで並べる */
  private schedule(n: number, evs: Ev[][]): void {
    const fpb = this.framesPerBeat;
    const len = songBeats(this.song);
    let beat = this.pos;
    let off = 0;
    let remain = n;
    while (remain > 0) {
      const toEnd = Math.max(0, (len - beat) * fpb);
      const span = Math.min(remain, toEnd);
      const b0 = beat, b1 = beat + span / fpb;
      // メトロノームの位置
      for (let k = Math.ceil(b0 - 1e-9); k < b1; k++) {
        const o = off + Math.round((k - b0) * fpb);
        evs[0].push({ off: Math.min(n - 1, Math.max(0, o)), apply: () => { this.clickT = 0; this.clickAccent = k % 4 === 0; } });
      }
      this.song.tracks.forEach((tr, toy) => {
        if (tr.mute || toy >= this.toys.length) return;
        const t = this.toys[toy];
        for (const note of tr.notes) {
          if (note.start >= b0 && note.start < b1) {
            evs[toy].push({ off: off + Math.floor((note.start - b0) * fpb), apply: () => { t.keyDown(note.key); this.held[toy].add(note.key); } });
          }
          const e = note.start + note.len;
          if (e >= b0 && e < b1) {
            evs[toy].push({ off: off + Math.floor((e - b0) * fpb), apply: () => { t.keyUp(note.key); this.held[toy].delete(note.key); } });
          }
        }
        for (const a of tr.autos) {
          if (a.t >= b0 && a.t < b1) evs[toy].push({ off: off + Math.floor((a.t - b0) * fpb), apply: () => t.setParam(a.index, a.v) });
        }
      });
      off += span;
      remain -= span;
      beat = b1;
      if (beat >= len - 1e-9) {
        // ループの終わり：押しているキーを離し、録音を区切って曲に重ねる
        const at = Math.min(n - 1, off);
        this.toys.forEach((t, toy) => evs[toy].push({ off: at, apply: () => { this.held[toy].forEach((k) => t.keyUp(k)); this.held[toy].clear(); } }));
        if (this.recording) this.flushTake(len, false);
        if (this.bounce) {
          this.playing = false;
          this.bounce = false;
          this.pos = 0;
          this.cb.onEnd();
          return;
        }
        beat = 0;
      }
    }
    this.pos = beat;
  }
}
