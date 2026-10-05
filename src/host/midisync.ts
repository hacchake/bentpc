// 外の MIDI 機器（ドラムマシン・DAW など）のテンポに合わせる：MIDI クロック（1 拍 24 回）・START・CONTINUE・STOP を受け取る。
// テンポは最近 2 拍分のクロックの間隔の平均。小さな揺れでは変えない（1 BPM 以上ずれて、0.5 秒続いたら変える）
export interface SyncCallbacks {
  start(): void;
  cont(): void;
  stop(): void;
  tempo(bpm: number): void;
}

export class MidiSync {
  private times: number[] = [];
  private shown = 0;
  private pendingSince = 0;
  /** 最後にクロックを受け取った時刻（ms）。外の機器に合わせている間か調べる用 */
  lastClock = -1e9;

  constructor(private cb: SyncCallbacks) {}

  /** 1 バイトのシステム・リアルタイムのメッセージ。t = 受け取った時刻（ms） */
  feed(status: number, t: number): void {
    if (status === 0xfa) { this.times = []; this.cb.start(); return; }
    if (status === 0xfb) { this.cb.cont(); return; }
    if (status === 0xfc) { this.cb.stop(); return; }
    if (status !== 0xf8) return;
    this.lastClock = t;
    const ts = this.times;
    // 前のクロックから 1 秒以上空いたら、数え直す（機器を止めた・つなぎ直した）
    if (ts.length && t - ts[ts.length - 1] > 1000) ts.length = 0;
    ts.push(t);
    if (ts.length > 49) ts.shift();
    if (ts.length < 25) return;
    const bpm = 60000 / (((ts[ts.length - 1] - ts[0]) / (ts.length - 1)) * 24);
    if (!(bpm >= 20 && bpm <= 400)) return;
    const r = Math.round(bpm * 10) / 10;
    if (Math.abs(r - this.shown) < 1) { this.pendingSince = 0; return; }
    if (!this.pendingSince) { this.pendingSince = t; return; }
    if (t - this.pendingSince < 500) return;
    this.pendingSince = 0;
    this.shown = r;
    this.cb.tempo(Math.round(r));
  }
}
