// 音声チップの再生回路。8kHz の波形を「クロック」に合わせて読み出し、
// ホストのサンプルレートへはゼロ次ホールド（段差のまま）で出す。補間しないので折り返しノイズが乗る。
// フェーズ2で、ここにグリッチ（位置飛び・連打・逆再生・クロック揺れ）やループ／ストレッチが入る。

import { CHIP_RATE } from './speech';

export class Chip {
  buf: Float32Array | null = null;
  pos = 0; // 読み出し位置（チップのサンプル単位、小数あり）
  clock = CHIP_RATE; // 読み出しクロック（Hz）
  playing = false;
  /** 直前に鳴らしたキー（-1 = システム音） */
  key = -1;

  start(buf: Float32Array, key: number): void {
    this.buf = buf;
    this.pos = 0;
    this.playing = buf.length > 0;
    this.key = key;
  }

  stop(): void {
    this.playing = false;
  }

  /**
   * 1 サンプル分進めて値を返す。hostRate はホストのサンプルレート。
   * 再生が終わったら playing が false になる。
   */
  tick(hostRate: number): number {
    if (!this.playing || !this.buf) return 0;
    const i = Math.floor(this.pos);
    if (i >= this.buf.length) {
      this.playing = false;
      return 0;
    }
    const v = this.buf[i];
    this.pos += this.clock / hostRate;
    return v;
  }
}
