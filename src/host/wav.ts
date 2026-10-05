// 録音データを WAV（16bit・ステレオ）にしてダウンロードする
/** chunks = 左（右が無ければ左右同じ）、right = 右 */
export function encodeWav(chunks: Float32Array[], sampleRate: number, right?: Float32Array[]): Blob {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const ch = 2;
  const buf = new ArrayBuffer(44 + len * 2 * ch);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len * 2 * ch, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2 * ch, true); v.setUint16(32, 2 * ch, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * 2 * ch, true);
  let o = 44;
  // 16bit にするときは TPDF ディザー（1LSB の三角分布の小さなノイズ）を足す：静かな所・フェードアウトがザラつかない（市販の CD と同じ作り方）
  const q = (x: number) => Math.max(-32768, Math.min(32767, Math.round(Math.max(-1, Math.min(1, x)) * 32767 + Math.random() - Math.random())));
  chunks.forEach((c, k) => {
    const rc = right?.[k] ?? c;
    for (let i = 0; i < c.length; i++) {
      v.setInt16(o, q(c[i]), true); v.setInt16(o + 2, q(rc[i]), true);
      o += 4;
    }
  });
  return new Blob([buf], { type: 'audio/wav' });
}

/** 32bit 浮動小数の WAV（ステレオ）：割れない・音量をいじらない（楽器ごとの書き出し＝ステム用。ほかの音楽ソフトに読み込む） */
export function encodeWavFloat(L: Float32Array, R: Float32Array, sampleRate: number): Blob {
  const n = L.length, ch = 2, bytes = n * 4 * ch;
  const head = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) head.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); head.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); head.setUint32(16, 16, true); head.setUint16(20, 3, true); head.setUint16(22, ch, true);
  head.setUint32(24, sampleRate, true); head.setUint32(28, sampleRate * 4 * ch, true); head.setUint16(32, 4 * ch, true); head.setUint16(34, 32, true);
  str(36, 'data'); head.setUint32(40, bytes, true);
  const body = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { body[2 * i] = L[i]; body[2 * i + 1] = R[i]; }
  return new Blob([head.buffer, body.buffer], { type: 'audio/wav' });
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
