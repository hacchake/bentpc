// 録音データを WAV（16bit・ステレオ）にしてダウンロードする
export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
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
  for (const c of chunks) for (let i = 0; i < c.length; i++) {
    const s = Math.round(Math.max(-1, Math.min(1, c[i])) * 32767);
    v.setInt16(o, s, true); v.setInt16(o + 2, s, true);
    o += 4;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
