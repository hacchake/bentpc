// MIDI 書き出しの検査：デモ曲を MIDI にして、読み戻して中身を数える（out/demo.mid に書き出す）
import { mkdirSync, writeFileSync } from 'node:fs';
import { BTN, SYS_CRASH, SYS_POWER_ON } from '../src/core/song';
import { demoSong } from '../src/studio/demo';
import { PPQ, songToMidi } from '../src/studio/midi-export';
import { STUDIO_MIDI, STUDIO_TOYS } from '../src/studio/songs';
import { renderSongStereo } from '../src/studio/render';
import { usedToys } from '../src/core/song';
import { crc32, makeZip } from '../src/host/zip';
import { muxM4a, muxOgg } from '../src/host/compress';

let fail = 0;
const ng = (m: string) => { fail++; console.log('NG', m); };

const song = demoSong();
const bytes = songToMidi(song, STUDIO_MIDI);

// ---- 読み戻す（最小限のパーサー） ----
let p = 0;
const u32 = () => ((bytes[p++] << 24) | (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++]) >>> 0;
const u16 = () => (bytes[p++] << 8) | bytes[p++];
const str = (n: number) => { const s = String.fromCharCode(...bytes.subarray(p, p + n)); p += n; return s; };
const vlq = () => { let v = 0, b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
if (str(4) !== 'MThd' || u32() !== 6) ng('ヘッダーが壊れている');
const format = u16(), ntrk = u16(), div = u16();
if (format !== 1 || div !== PPQ) ng('形式・分解能がおかしい');
if (ntrk !== song.tracks.length + 1) ng(`トラック数が合わない（${ntrk}）`);
let noteOns = 0, ccs = 0, markers: string[] = [], tempo = 0, maxTick = 0, chans = new Set<number>();
for (let t = 0; t < ntrk; t++) {
  if (str(4) !== 'MTrk') { ng('トラックの見出しが壊れている'); break; }
  const len = u32(), end = p + len;
  let tick = 0, running = 0, ended = false;
  while (p < end) {
    tick += vlq();
    let st = bytes[p];
    if (st & 0x80) p++; else st = running;
    if (st === 0xff) {
      const type = bytes[p++], n = vlq();
      if (type === 0x51) tempo = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
      if (type === 0x06) markers.push(new TextDecoder().decode(bytes.subarray(p, p + n)));
      if (type === 0x2f) ended = true;
      p += n;
    } else {
      running = st;
      const kind = st & 0xf0;
      chans.add(st & 15);
      const d1 = bytes[p++], d2 = bytes[p++];
      if (kind === 0x90 && d2 > 0) noteOns++;
      if (kind === 0xb0) ccs++;
      void d1;
    }
    maxTick = Math.max(maxTick, tick);
  }
  if (p !== end || !ended) ng(`トラック ${t} の長さが合わない`);
}
const expectNotes = song.tracks.reduce((s, tr, i) => s + tr.notes.filter((n) => n.key < BTN && STUDIO_MIDI[tr.toy ?? i].noteOf(n.key) >= 0).length, 0);
console.log(`MIDI ${bytes.length} バイト・トラック ${ntrk}・ノート ${noteOns}（曲の音符 ${expectNotes}）・CC ${ccs}・チャンネル ${[...chans].map((c) => c + 1).join(',')}`);
console.log('マーカー', markers.join(' / '));
if (noteOns !== expectNotes) ng('ノートの数が曲の音符と合わない');
if (Math.round(60_000_000 / tempo) !== song.bpm) ng('テンポが合わない');
if (!markers.includes('サビ') || !markers.includes('CRASH') || !markers.includes('REBOOT')) ng('セクション・クラッシュのマーカーが無い');
if (Math.abs(maxTick / PPQ - song.bars * 4) > 1) ng('曲の長さが合わない');
if (!chans.has(0) || !chans.has(5)) ng('チャンネル 1・6 に分かれていない');
const hasBtn = song.tracks.some((t) => t.notes.some((n) => n.key >= BTN && n.key < SYS_CRASH));
const hasPower = song.tracks.some((t) => t.notes.some((n) => n.key === SYS_POWER_ON));
if (!hasBtn || !hasPower || ccs < 50) ng('ボタン・電源・ツマミの CC が書かれていない');

mkdirSync('out', { recursive: true });
writeFileSync('out/demo.mid', bytes);

// ---- 楽器ごとの書き出し（ステム）：1 台ずつソロにした音を足すと、全部いっしょ（仕上げなし）の音とほぼ同じ ----
{
  const s2 = demoSong();
  s2.bars = Math.min(s2.bars, 8);
  const sr = 16000;
  const used = usedToys(s2, STUDIO_TOYS.length);
  const [aL, aR] = renderSongStereo(s2, sr, { raw: true, tail: 0.2 });
  const sumL = new Float32Array(aL.length), sumR = new Float32Array(aR.length);
  for (const toy of used) {
    const s3 = JSON.parse(JSON.stringify(s2));
    s3.mix = []; s3.mix[toy] = { gain: 0, pan: null, solo: true };
    const [l, r] = renderSongStereo(s3, sr, { raw: true, tail: 0.2 });
    for (let i = 0; i < l.length; i++) { sumL[i] += l[i]; sumR[i] += r[i]; }
  }
  let e = 0, d = 0;
  for (let i = 0; i < aL.length; i++) { e += aL[i] ** 2 + aR[i] ** 2; d += (aL[i] - sumL[i]) ** 2 + (aR[i] - sumR[i]) ** 2; }
  const snr = 10 * Math.log10(e / (d + 1e-20));
  // 左右の自動の並べ方は「鳴ったおもちゃ」で決まるので、ソロにすると真ん中に寄る。だから完全には一致しない
  used.length >= 2 && snr > 6 ? console.log(`OK ステム ${used.length} 本：足すと全体の音と ${snr.toFixed(1)}dB の近さ`) : ng(`ステム ${used.length} 本・近さ ${snr.toFixed(1)}dB`);
  // ZIP：中身の名前と大きさが読める
  const zip = new Uint8Array(await (await makeZip([{ name: '01 テスト.wav', data: new Blob([new Uint8Array([1, 2, 3])]) }, { name: '02 B.wav', data: new Blob([new Uint8Array(10)]) }])).arrayBuffer());
  const dv = new DataView(zip.buffer);
  const eocd = zip.length - 22;
  const okZip = dv.getUint32(0, true) === 0x04034b50 && dv.getUint32(eocd, true) === 0x06054b50 && dv.getUint16(eocd + 10, true) === 2 && dv.getUint32(14, true) === crc32(new Uint8Array([1, 2, 3]));
  okZip ? console.log(`OK ZIP（${zip.length} バイト・2 ファイル・CRC 一致）`) : ng('ZIP が壊れている');
}
console.log('out/demo.mid に書き出しました');
// ---- 圧縮の入れ物：M4A は ftyp・moov・mdat の順で、stco が最初のフレームを指す。OGG はページの CRC が合う ----
{
  const frames = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
  const m = muxM4a(frames, new Uint8Array([0x11, 0x90]), 48000, 1500);
  const dv = new DataView(m.buffer);
  const type = (o: number) => String.fromCharCode(...m.subarray(o + 4, o + 8));
  const ftypLen = dv.getUint32(0), moovLen = dv.getUint32(ftypLen);
  const mdatAt = ftypLen + moovLen;
  const stcoAt = [...Array(m.length - 8).keys()].find((i) => String.fromCharCode(...m.subarray(i, i + 4)) === 'stco')!;
  const off = dv.getUint32(stcoAt + 12);
  const okM4a = type(0) === 'ftyp' && type(ftypLen) === 'moov' && type(mdatAt) === 'mdat' && off === mdatAt + 8 && m[off] === 1 && m[off + 3] === 4;
  okM4a ? console.log(`OK M4A の入れ物（${m.length} バイト・フレームの位置が合う）`) : ng('M4A の入れ物が壊れている');
  const o = muxOgg([new Uint8Array(10), new Uint8Array(300)], null, 1500);
  let pos = 0, pages = 0, crcOk = true;
  while (pos < o.length) {
    const segs = o[pos + 26];
    let len = 27 + segs;
    for (let k = 0; k < segs; k++) len += o[pos + 27 + k];
    const pg = o.slice(pos, pos + len);
    const want = new DataView(pg.buffer).getUint32(22, true);
    new DataView(pg.buffer).setUint32(22, 0, true);
    // ページの CRC を数え直す
    let c = 0;
    for (const byte of pg) { c ^= byte << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; c >>>= 0; }
    if (c !== want) crcOk = false;
    pos += len; pages++;
  }
  pages === 3 && crcOk ? console.log('OK OGG の入れ物（3 ページ・CRC 一致）') : ng(`OGG の入れ物：${pages} ページ・CRC ${crcOk}`);
}

console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
