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
  const q = (x: number) => Math.round(Math.max(-1, Math.min(1, x)) * 32767);
  chunks.forEach((c, k) => {
    const rc = right?.[k] ?? c;
    for (let i = 0; i < c.length; i++) {
      v.setInt16(o, q(c[i]), true); v.setInt16(o + 2, q(rc[i]), true);
      o += 4;
    }
  });
  return new Blob([buf], { type: 'audio/wav' });
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
