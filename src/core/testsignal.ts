// テスト映像に付ける「テスト信号」の音（DSP・DOM 非依存）。
// 映像入力の代わりに TELEKEY へ流す素材：コード進行のパッド＋拍ごとのベース＋裏拍のハット＋小節頭の 1kHz のピッ。
// 拍の位置から計算するので、同じ位置なら毎回同じ音（シーケンサーと同期する）。

const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const frac = (x: number) => x - Math.floor(x);
/** 整数 → -1..1 の決まった値（ノイズ用） */
const hashNoise = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
};

/** 既定のコード進行（1 小節ずつ）：Am → F → C → G */
export const DEFAULT_CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];

export class TestSignal {
  chords: number[][] = DEFAULT_CHORDS;
  level = 0.5;
  private free = 0; // 自分の時計（サンプル）
  private lp = 0;

  constructor(private sr: number) {}

  reset(): void {
    this.free = 0;
    this.lp = 0;
  }

  /** beat0 = このブロック先頭の拍（null なら自分の時計・120BPM）。bpm はテンポ */
  render(out: Float32Array, beat0: number | null, bpm: number): void {
    const bps = (beat0 === null ? 120 : bpm) / 60 / this.sr; // 1 サンプルで進む拍
    const k = 1 - Math.exp((-2 * Math.PI * 1400) / this.sr);
    for (let i = 0; i < out.length; i++) {
      const beat = beat0 === null ? (this.free + i) * bps : beat0 + i * bps;
      const sec = (beat * 60) / (beat0 === null ? 120 : bpm);
      const ch = this.chords[Math.floor(beat / 4) % this.chords.length] ?? DEFAULT_CHORDS[0];
      // パッド：少しずらした鋸波 2 本ずつ → ローパス
      let pad = 0;
      for (const n of ch) { const f = mtof(n); pad += (frac(f * sec) * 2 - 1) + (frac(f * 1.004 * sec) * 2 - 1); }
      pad /= ch.length * 2;
      this.lp += (pad - this.lp) * k;
      // ベース：拍ごとに根音
      const b = frac(beat);
      const bass = Math.sin(2 * Math.PI * mtof(ch[0] - 24) * sec) * Math.exp(-b * 3.5);
      // 裏拍のハット
      const hb = frac(beat + 0.5);
      const hat = hashNoise(Math.floor(sec * this.sr)) * Math.exp(-hb * 40) * (hb < 0.25 ? 1 : 0);
      // 小節頭のピッ（テスト信号らしさ）
      const bb = beat % 4;
      const pip = bb < 0.1 ? Math.sin(2 * Math.PI * 1000 * sec) : 0;
      out[i] = (this.lp * 0.35 + bass * 0.35 + hat * 0.12 + pip * 0.1) * this.level;
    }
    if (beat0 === null) this.free += out.length;
  }
}
