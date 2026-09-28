// 右のミニ鍵盤の音源（6 音）。INSTRUMENT 10 種。KEYBOARD PATTERN 2 は押している音のアルペジオ。

import { Rng } from '../../../core/rng';

/** [アタック秒, ディケイ秒, サステイン, リリース秒, オクターブ] */
const ENV: [number, number, number, number, number][] = [
  [0.005, 0.3, 0.6, 0.1, 0], // LEAD
  [0.003, 0.25, 0.4, 0.08, -12], // BASS
  [0.005, 0, 1, 0.05, 0], // ORGAN
  [0.25, 0, 0.9, 0.4, 0], // STRINGS
  [0.001, 1.2, 0, 0.8, 12], // BELL
  [0.05, 0, 0.8, 0.15, 12], // PIPE
  [0.06, 0.3, 0.7, 0.12, 0], // BRASS
  [0.01, 0.4, 0.6, 0.2, 0], // SYNTH
  [0.3, 0, 0.8, 0.5, 0], // CHOIR
  [0.001, 0.15, 0, 0.05, 0], // NOISE
];

class V {
  note = -1;
  ph = 0;
  ph2 = 0;
  lvl = 0;
  stage: 'off' | 'a' | 'd' | 'r' = 'off';
  gate = false;
  age = 0;
  noise = 0;
}

export class KeySynth {
  private v = Array.from({ length: 6 }, () => new V());
  private age = 0;
  private lfo = 0;
  private held: number[] = []; // 押している鍵（アルペジオ用）
  private arpStep = 0;
  private arpNote = -1;

  constructor(private sr: number, private rng: Rng) {}

  noteOn(n: number, arp: boolean): void {
    if (!this.held.includes(n)) this.held.push(n);
    if (!arp) this.start(n);
  }

  noteOff(n: number): void {
    this.held = this.held.filter((x) => x !== n);
    for (const v of this.v) if (v.note === n) v.gate = false;
  }

  allOff(): void {
    this.held = [];
    for (const v of this.v) { v.stage = 'off'; v.gate = false; v.lvl = 0; }
  }

  private start(n: number): void {
    let v = this.v.find((x) => x.stage === 'off') ?? this.v.reduce((a, b) => (a.age < b.age ? a : b));
    v.note = n; v.stage = 'a'; v.gate = true; v.age = ++this.age;
  }

  /** アルペジオを 1 ステップ進める（リズムの 16 分音符ごとに呼ぶ） */
  arpTick(): void {
    if (this.arpNote >= 0) this.noteOff2(this.arpNote);
    this.arpNote = -1;
    if (!this.held.length) return;
    const sorted = [...this.held].sort((a, b) => a - b);
    const seq = [...sorted, ...sorted.map((n) => n + 12)];
    const n = seq[this.arpStep++ % seq.length];
    this.arpNote = n;
    this.start(n);
  }

  private noteOff2(n: number): void {
    for (const v of this.v) if (v.note === n) v.gate = false;
  }

  tick(clk: number, inst: number): number {
    const [a, d, s, r, oct] = ENV[inst];
    const sr = this.sr;
    this.lfo = (this.lfo + (0.8 * clk) / sr) % 1;
    let out = 0;
    for (const v of this.v) {
      if (v.stage === 'off') continue;
      // エンベロープ（クロックに比例して進む）
      const dt = clk / sr;
      if (v.stage === 'a') { v.lvl += dt / Math.max(0.001, a); if (v.lvl >= 1) { v.lvl = 1; v.stage = 'd'; } }
      else if (v.stage === 'd') {
        if (!v.gate) v.stage = 'r';
        else if (d > 0 && v.lvl > s) v.lvl = Math.max(s, v.lvl - dt / d);
        if (v.lvl <= 0.001 && s === 0) { v.stage = 'off'; continue; }
      } else { v.lvl -= dt / Math.max(0.001, r); if (v.lvl <= 0) { v.lvl = 0; v.stage = 'off'; continue; } }

      const f = 440 * Math.pow(2, (v.note + oct - 69) / 12);
      v.ph = (v.ph + (f * clk) / sr) % 1;
      const p = v.ph;
      let x = 0;
      switch (inst) {
        case 0: x = p < 0.5 ? 1 : -1; break;
        case 1: x = 2 * p - 1; break;
        case 2: x = ((p < 0.5 ? 1 : -1) + ((p * 2) % 1 < 0.5 ? 1 : -1)) * 0.5; break;
        case 3: v.ph2 = (v.ph2 + (f * 1.007 * clk) / sr) % 1; x = (2 * p - 1 + 2 * v.ph2 - 1) * 0.5; break;
        case 4: x = Math.sin(2 * Math.PI * p + 2.5 * v.lvl * Math.sin(2 * Math.PI * p * 3.5)); break;
        case 5: x = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
        case 6: x = (2 * p - 1) * Math.min(1, v.lvl * 1.5); x = Math.tanh(x * 2); break;
        case 7: x = p < 0.5 + 0.4 * Math.sin(2 * Math.PI * this.lfo) ? 1 : -1; break;
        case 8: v.ph2 = (v.ph2 + (f * 0.995 * clk) / sr) % 1; x = (Math.sin(2 * Math.PI * p) + Math.sin(2 * Math.PI * v.ph2)) * 0.5; break;
        default: if (p < (f * clk) / sr) v.noise = this.rng.bi(); x = v.noise; break; // 音程つきノイズ
      }
      out += x * v.lvl;
    }
    return out * 0.25;
  }
}
