// 作曲係が音符・ツマミの動きを書き込む道具（1 パート = 1 トラック）
import type { SeqAuto, SeqNote, SeqTrack } from '../core/song';

export class PartWriter {
  notes: SeqNote[] = [];
  autos: SeqAuto[] = [];
  private rampEnds = new WeakSet<SeqAuto>();

  /** part：パートの名前（鍵・作り直しの目印）、name：画面に出すトラック名 */
  constructor(readonly toy: number, readonly part: string, readonly name: string) {}

  note(key: number, beat: number, len = 0.25): void {
    if (len <= 0) return;
    this.notes.push({ key, start: Math.max(0, beat), len, take: 0 });
  }

  /** 16 分音符のパターン（'x' = 鳴らす）を beat から */
  steps(key: number, beat: number, pattern: string, len = 0.2): void {
    [...pattern].forEach((c, i) => { if (c === 'x') this.note(key, beat + i * 0.25, len); });
  }

  /** その位置で切り替える */
  set(param: number, beat: number, v: number): SeqAuto {
    const a = { index: param, t: Math.max(0, beat), v, take: 0 };
    this.autos.push(a);
    return a;
  }

  /** なめらかに動かす */
  ramp(param: number, b0: number, v0: number, b1: number, v1: number): void {
    this.set(param, b0, v0);
    this.rampEnds.add(this.set(param, b1, v1));
  }

  /** 区間 [b0, b1) の音符を消す（クラッシュ中・起動中など） */
  clear(b0: number, b1: number, keep: (n: SeqNote) => boolean = () => false): void {
    this.notes = this.notes.filter((n) => keep(n) || n.start < b0 || n.start >= b1);
  }

  /** 仕上げ：曲の長さに収め、「切り替え」の点の直前に前の値の点を足して、点と点の間で勝手に動かないようにする */
  finish(endBeat: number): SeqTrack & { part: string } {
    this.notes = this.notes.filter((n) => n.start < endBeat).map((n) => ({ ...n, len: Math.min(n.len, endBeat - n.start) }));
    this.notes.sort((a, b) => a.start - b.start || a.key - b.key);
    this.autos = this.autos.filter((a) => a.t < endBeat);
    this.autos.sort((a, b) => a.t - b.t);
    const add: SeqAuto[] = [];
    const last = new Map<number, SeqAuto>();
    for (const a of this.autos) {
      const prev = last.get(a.index);
      if (prev && !this.rampEnds.has(a) && prev.v !== a.v && a.t - prev.t > 0.02) add.push({ index: a.index, t: a.t - 0.01, v: prev.v, take: 0 });
      last.set(a.index, a);
    }
    this.autos.push(...add);
    this.autos.sort((a, b) => a.t - b.t);
    return { toy: this.toy, part: this.part, name: this.name, mute: false, notes: this.notes, autos: this.autos };
  }
}
