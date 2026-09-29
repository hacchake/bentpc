// MIDI 書き出しの検査：デモ曲を MIDI にして、読み戻して中身を数える（out/demo.mid に書き出す）
import { mkdirSync, writeFileSync } from 'node:fs';
import { BTN, SYS_CRASH, SYS_POWER_ON } from '../src/core/song';
import { demoSong } from '../src/studio/demo';
import { PPQ, songToMidi } from '../src/studio/midi-export';
import { STUDIO_MIDI } from '../src/studio/songs';

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
console.log('out/demo.mid に書き出しました');
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
