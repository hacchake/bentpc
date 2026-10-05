// 圧縮した音声ファイルの書き出し（WAV の約 1/8 の大きさ）。ブラウザの WebCodecs の AudioEncoder を使う。
// AAC が使えれば M4A（iPhone・Windows・Mac・Android でそのまま鳴る）、使えなければ Opus を OGG に入れる。
// どちらも、入れ物（コンテナ）はここで組み立てる（外の部品を使わない）

export interface Compressed { blob: Blob; ext: 'm4a' | 'ogg'; mime: string }

const enc = new TextEncoder();
const u8 = (...parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> => {
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const be16 = (v: number) => [(v >>> 8) & 255, v & 255];
const str = (s: string) => Array.from(enc.encode(s));

/** 使えるか（AudioEncoder が無いブラウザ・形式は null） */
export async function compressedFormat(sr: number): Promise<'aac' | 'opus' | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const ok = async (codec: string) => { try { return !!(await AudioEncoder.isConfigSupported({ codec, sampleRate: sr, numberOfChannels: 2, bitrate: 192000 })).supported; } catch { return false; } };
  if (await ok('mp4a.40.2')) return 'aac';
  if (sr === 48000 && (await ok('opus'))) return 'opus';
  return null;
}

/** 左右の波形 → 圧縮ファイル。progress は 0〜1 */
export async function encodeCompressed(L: Float32Array, R: Float32Array, sr: number, progress?: (f: number) => void): Promise<Compressed> {
  const fmt = await compressedFormat(sr);
  if (!fmt) throw new Error('このブラウザでは圧縮した書き出しができません（WAV を使ってください）');
  const codec = fmt === 'aac' ? 'mp4a.40.2' : 'opus';
  const chunks: { data: Uint8Array; dur: number }[] = [];
  let desc: Uint8Array | null = null;
  let failed: Error | null = null;
  const encoder = new AudioEncoder({
    output: (c, meta) => {
      const d = new Uint8Array(c.byteLength);
      c.copyTo(d);
      chunks.push({ data: d, dur: c.duration ?? 0 });
      const ds = meta?.decoderConfig?.description;
      if (ds && !desc) desc = new Uint8Array(ds instanceof ArrayBuffer ? ds : (ds as ArrayBufferView).buffer.slice((ds as ArrayBufferView).byteOffset, (ds as ArrayBufferView).byteOffset + (ds as ArrayBufferView).byteLength));
    },
    error: (e) => { failed = e as Error; },
  });
  encoder.configure({ codec, sampleRate: sr, numberOfChannels: 2, bitrate: 192000 });
  const n = L.length, BLOCK = sr; // 1 秒ずつ渡す
  for (let o = 0; o < n; o += BLOCK) {
    const len = Math.min(BLOCK, n - o), buf = new Float32Array(len * 2);
    buf.set(L.subarray(o, o + len), 0);
    buf.set(R.subarray(o, o + len), len);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((o / sr) * 1e6), data: buf });
    encoder.encode(ad);
    ad.close();
    if (failed) break;
    // たまりすぎないように待つ（長い曲でもメモリを食いすぎない）
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    progress?.(o / n);
  }
  await encoder.flush();
  encoder.close();
  if (failed) throw failed;
  progress?.(1);
  return fmt === 'aac'
    ? { blob: new Blob([muxM4a(chunks.map((c) => c.data), desc ?? defaultAsc(sr), sr, n)], { type: 'audio/mp4' }), ext: 'm4a', mime: 'audio/mp4' }
    : { blob: new Blob([muxOgg(chunks.map((c) => c.data), desc, n)], { type: 'audio/ogg' }), ext: 'ogg', mime: 'audio/ogg' };
}

// ================= M4A（MP4 の入れ物に AAC） =================
const box = (type: string, ...body: (Uint8Array | number[])[]) => { const b = u8(...body); return u8(be32(b.length + 8), str(type), b); };
const full = (type: string, version: number, flags: number, ...body: (Uint8Array | number[])[]) => box(type, [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255], ...body);

/** AAC-LC・ステレオの AudioSpecificConfig（エンコーダーが教えてくれなかったとき用） */
function defaultAsc(sr: number): Uint8Array {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
  const fi = Math.max(0, rates.indexOf(sr));
  return new Uint8Array([(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (2 << 3)]);
}

/** AAC の 1 フレーム = 1024 サンプル。frames を 1 本のトラックにして M4A に */
export function muxM4a(frames: Uint8Array[], asc: Uint8Array, sr: number, totalSamples: number): Uint8Array<ArrayBuffer> {
  const dur = frames.length * 1024;
  const desc = (tag: number, body: Uint8Array | number[]) => u8([tag, body.length], body);
  const esds = full('esds', 0, 0, desc(3, u8(be16(1), [0], desc(4, u8([0x40, 0x15], [0, 0x18, 0], be32(256000), be32(192000), desc(5, asc))), desc(6, [2]))));
  const mp4a = box('mp4a', [0, 0, 0, 0, 0, 0], be16(1), [0, 0, 0, 0, 0, 0, 0, 0], be16(2), be16(16), be16(0), be16(0), be32(sr << 16 >>> 0), esds);
  const stsd = full('stsd', 0, 0, be32(1), mp4a);
  const stts = full('stts', 0, 0, be32(1), be32(frames.length), be32(1024));
  const stsc = full('stsc', 0, 0, be32(1), be32(1), be32(frames.length), be32(1));
  const stsz = full('stsz', 0, 0, be32(0), be32(frames.length), ...frames.map((f) => be32(f.length)));
  // 頭の「ならし」分（エンコーダーが前に足す 2112 サンプル）を飛ばして、曲の長さちょうどに（edts/elst）
  const prime = Math.min(2112, Math.max(0, dur - totalSamples));
  const build = (dataOff: number) => {
    const stco = full('stco', 0, 0, be32(1), be32(dataOff));
    const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
    const minf = box('minf', full('smhd', 0, 0, be16(0), be16(0)), box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1))), stbl);
    const mdia = box('mdia', full('mdhd', 0, 0, be32(0), be32(0), be32(sr), be32(dur), be16(0x55c4), be16(0)), full('hdlr', 0, 0, be32(0), str('soun'), be32(0), be32(0), be32(0), str('SoundHandler'), [0]), minf);
    const matrix = [...be32(0x10000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x10000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x40000000)];
    const elst = box('edts', full('elst', 0, 0, be32(1), be32(totalSamples), be32(prime), be16(1), be16(0)));
    const tkhd = full('tkhd', 0, 3, be32(0), be32(0), be32(1), be32(0), be32(totalSamples), be32(0), be32(0), be16(0), be16(0), be16(0x0100), be16(0), matrix, be32(0), be32(0));
    const trak = box('trak', tkhd, elst, mdia);
    const mvhd = full('mvhd', 0, 0, be32(0), be32(0), be32(sr), be32(totalSamples), be32(0x10000), be16(0x0100), be16(0), be32(0), be32(0), matrix, be32(0), be32(0), be32(0), be32(0), be32(0), be32(0), be32(2));
    return box('moov', mvhd, trak);
  };
  const ftyp = box('ftyp', str('M4A '), be32(0), str('M4A '), str('isom'), str('mp42'));
  const dataLen = frames.reduce((s, f) => s + f.length, 0);
  const moov = build(ftyp.length + build(0).length + 8);
  return u8(ftyp, moov, be32(dataLen + 8), str('mdat'), ...frames);
}

// ================= OGG（Opus） =================
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; }
  return t;
})();
function oggCrc(d: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < d.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ d[i]) & 255]) >>> 0;
  return c;
}

/** Opus のパケット（20ms = 960 サンプルずつ）を OGG に。head = エンコーダーの OpusHead（無ければ作る） */
export function muxOgg(packets: Uint8Array[], head: Uint8Array | null, totalSamples: number): Uint8Array<ArrayBuffer> {
  const serial = 0x42454e54;
  let seq = 0;
  const pages: Uint8Array[] = [];
  const page = (segs: Uint8Array[], granule: number, type: number) => {
    const lacing: number[] = [];
    for (const s of segs) { let n = s.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
    const h = new Uint8Array(27 + lacing.length);
    const dv = new DataView(h.buffer);
    h.set(str('OggS')); h[4] = 0; h[5] = type;
    dv.setUint32(6, granule >>> 0, true); dv.setUint32(10, Math.floor(granule / 2 ** 32), true);
    dv.setUint32(14, serial, true); dv.setUint32(18, seq++, true);
    h[26] = lacing.length; h.set(lacing, 27);
    const p = u8(h, ...segs);
    new DataView(p.buffer).setUint32(22, oggCrc(p), true);
    pages.push(p);
  };
  const preSkip = head && head.length >= 12 ? head[10] | (head[11] << 8) : 312;
  const opusHead = head && head.length >= 19 && String.fromCharCode(...head.subarray(0, 8)) === 'OpusHead' ? head
    : u8(str('OpusHead'), [1, 2], [preSkip & 255, preSkip >> 8], [0x80, 0xbb, 0, 0], [0, 0], [0]);
  page([opusHead], 0, 2);
  const vendor = str('BENT TOY RACK');
  page([u8(str('OpusTags'), [vendor.length, 0, 0, 0], vendor, [0, 0, 0, 0])], 0, 0);
  // 1 ページに 50 パケット（約 1 秒）
  let granule = 0;
  for (let i = 0; i < packets.length; i += 50) {
    const segs = packets.slice(i, i + 50);
    granule += segs.length * 960;
    const last = i + 50 >= packets.length;
    page(segs, last ? totalSamples + preSkip : granule, last ? 4 : 0);
  }
  return u8(...pages);
}
