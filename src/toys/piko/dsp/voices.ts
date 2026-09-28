// 安物キーボードの音源チップ：32 ステップ・4bit の波形テーブルを、共通の「クロック」で読む。
// 補間なしで読むので、高い音ほどザラザラと折り返す。エンベロープも 16 段・1kHz 更新の段差。

import { Rng } from '../../../core/rng';

/** 32 ステップ・4bit（-8..7）の波形 */
function table(f: (i: number) => number): Int8Array {
  return Int8Array.from({ length: 32 }, (_, i) => Math.max(-8, Math.min(7, Math.round(f(i)))));
}

export const TABLES: Int8Array[] = [
  table((i) => (i < 16 ? 4 : -4) + (i % 16 < 8 ? 3 : -3)), // ORGAN：矩形＋1オクターブ上
  table((i) => 7 - (i * 15) / 31), // VIOLIN：のこぎり
  table((i) => (i < 8 ? 7 : -3)), // PIANO：25% パルス
  table((i) => (i < 4 ? 7 : 3 - (i * 6) / 31)), // HORN：細いパルス＋のこぎり
  table((i) => (i < 16 ? -8 + i : 23 - i)), // FLUTE：三角
  table((i) => (i < 11 ? 7 : i < 16 ? -2 : -6)), // GUITAR
  table((i) => 7 * Math.sin((2 * Math.PI * i) / 32)), // MUSIC BOX：サイン風
  table((i) => (i < 2 || (i >= 16 && i < 18) ? 7 : -1)), // BANJO：とても細いパルス×2
];

/** [アタック ms, ディケイ ms, サステイン 0..1, リリース ms, オクターブずらし(半音)] */
export const ENVS: [number, number, number, number, number][] = [
  [5, 0, 1, 40, 0],
  [120, 0, 0.9, 200, 0],
  [2, 700, 0, 150, 0],
  [40, 300, 0.7, 100, 0],
  [60, 0, 0.85, 120, 12],
  [2, 450, 0, 100, 0],
  [1, 500, 0, 300, 24],
  [1, 250, 0, 80, 12],
];

const POLY = 8;

class Voice {
  note = -1;
  phase = 0;
  level = 0; // 0..1
  stage: 'off' | 'a' | 'd' | 'r' = 'off';
  gate = false;
  age = 0;
  scan = 0; // INST HOLD の切り替えカウンタ
}

export interface VoiceCtl {
  inst: number;
  holdMask: number; // INST HOLD（8bit）
  envScale: number; // ENV LEN による倍率
  envHold: boolean; // HOLD：鳴らした音が伸びっぱなし
  vibrato: boolean;
  bitError: number; // CPU 電圧不足による読み出しエラー（1 サンプルあたりの確率）
}

export class Voices {
  private v: Voice[] = Array.from({ length: POLY }, () => new Voice());
  private msAcc = 0;
  private vibPh = 0;
  private counter = 0;

  constructor(private sr: number, private rng: Rng) {}

  noteOn(note: number): void {
    // 同じ音が鳴っていれば鳴らし直し、なければ空き→一番古い音を使う
    let v = this.v.find((x) => x.note === note && x.stage !== 'off');
    if (!v) v = this.v.find((x) => x.stage === 'off');
    if (!v) v = this.v.reduce((a, b) => (a.age < b.age ? a : b));
    v.note = note;
    v.stage = 'a';
    v.gate = true;
    v.age = ++this.counter;
    v.phase = 0;
  }

  noteOff(note: number): void {
    for (const v of this.v) if (v.note === note && v.gate) v.gate = false;
  }

  /** HOLD → ENV に戻したとき、伸びっぱなしの音を離す */
  releaseAll(): void {
    for (const v of this.v) v.gate = false;
  }

  allOff(): void {
    for (const v of this.v) { v.stage = 'off'; v.level = 0; v.gate = false; }
  }

  get active(): number {
    return this.v.filter((x) => x.stage !== 'off').length;
  }

  /**
   * 1 サンプル分。clk はクロック倍率（0 なら止まる＝電圧低下でチップが止まった状態）
   * 戻り値は -1..1 くらい
   */
  tick(clk: number, c: VoiceCtl): number {
    const [atk, dec, sus, rel, oct] = ENVS[c.inst];
    // エンベロープは 1ms ごと（クロックが止まればエンベロープも止まる）
    this.msAcc += (clk * 1000) / this.sr;
    let envSteps = 0;
    while (this.msAcc >= 1) { this.msAcc -= 1; envSteps++; }
    if (c.vibrato || c.inst === 1) this.vibPh = (this.vibPh + (6 * clk) / this.sr) % 1;
    const vib = c.vibrato || c.inst === 1 ? 1 + 0.006 * Math.sin(2 * Math.PI * this.vibPh) : 1;

    let out = 0;
    for (const v of this.v) {
      if (v.stage === 'off') continue;
      let alive = true;
      for (let s = 0; s < envSteps && alive; s++) alive = this.envStep(v, atk, dec * c.envScale, sus, rel * c.envScale, c.envHold);
      if (!alive) continue;
      const f = 440 * Math.pow(2, (v.note + oct - 69) / 12) * vib;
      v.phase = (v.phase + (f * clk) / this.sr) % 1;
      const idx = (v.phase * 32) | 0;
      let u = TABLES[c.inst][idx] + 8; // 0..15
      if (c.holdMask) {
        // INST HOLD：押さえっぱなしの楽器の選択線が混ざる。波形を OR で重ね、ときどき別の楽器に切り替わる
        let or = u;
        let alt = -1;
        for (let h = 0; h < 8; h++) if (c.holdMask & (1 << h)) { or |= TABLES[h][idx] + 8; if (alt < 0 || ((v.scan >> 10) & 7) === h) alt = h; }
        v.scan += clk;
        u = ((v.scan / (this.sr * 0.012)) | 0) % 2 === 0 ? or : TABLES[alt][idx] + 8;
      }
      if (c.bitError > 0 && this.rng.next() < c.bitError) u ^= 1 << this.rng.int(4);
      const lv = Math.round(v.level * 15) / 15; // 16 段の音量
      out += ((u - 7.5) / 7.5) * lv;
    }
    return out * 0.3;
  }

  /** エンベロープを 1ms 進める。鳴り終わったら false */
  private envStep(v: Voice, atk: number, dec: number, sus: number, rel: number, hold: boolean): boolean {
    switch (v.stage) {
      case 'a':
        v.level += 1 / Math.max(1, atk);
        if (v.level >= 1) { v.level = 1; v.stage = 'd'; }
        break;
      case 'd':
        if (hold) break; // HOLD：頂点のまま伸びっぱなし
        if (!v.gate) { v.stage = 'r'; break; }
        if (dec > 0 && v.level > sus) v.level = Math.max(sus, v.level - 1 / dec);
        if (v.level <= 0.001) { v.stage = 'off'; v.level = 0; }
        break;
      case 'r':
        if (hold) break;
        v.level -= 1 / Math.max(1, rel);
        if (v.level <= 0) { v.level = 0; v.stage = 'off'; }
        break;
    }
    return v.stage !== 'off';
  }
}
