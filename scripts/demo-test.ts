// デモ曲の検査：最後まで鳴らして、長さ・セクションごとの音量・クラッシュの無音・再現性を確かめ、out/demo.wav に書き出す
import { mkdirSync, writeFileSync } from 'node:fs';
import { songBeats } from '../src/core/song';
import { demoSong } from '../src/studio/demo';
import { renderSong } from '../src/studio/render';

const SR = 48000;
let fail = 0;
const ng = (m: string) => { fail++; console.log('NG', m); };
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / Math.max(1, b.length));

const song = demoSong();
const sec = (songBeats(song) * 60) / song.bpm;
console.log(`「${song.title}」 ${song.bars} 小節・${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒・トラック ${song.tracks.length} 本・音符 ${song.tracks.reduce((s, t) => s + t.notes.length, 0)} 個・ツマミの点 ${song.tracks.reduce((s, t) => s + t.autos.length, 0)} 個`);
if (sec < 120 || sec > 180) ng('長さが 2〜3 分ではない');
if (song.bpm < 110 || song.bpm > 130) ng('BPM が 120 前後ではない');

const t0 = performance.now();
const a = renderSong(song, SR);
console.log(`書き出し ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
if (a.some((x) => !Number.isFinite(x))) ng('異常値');
const at = (beat: number) => Math.floor(((beat * 60) / song.bpm) * SR);
const win = (b0: number, b1: number) => a.subarray(at(b0), at(b1));

// セクションごとの音量
const secs = song.sections ?? [];
const levels: number[] = [];
secs.forEach((s, i) => {
  const end = i + 1 < secs.length ? secs[i + 1].start : songBeats(song);
  const w = win(s.start, end);
  let clip = 0;
  for (const x of w) if (Math.abs(x) > 0.98) clip++;
  levels.push(rms(w));
  console.log(`  ${s.name.padEnd(5, '　')} ${String(s.start / 4 + 1).padStart(3)} 小節〜  rms ${rms(w).toFixed(3)}  音割れ ${((clip / w.length) * 100).toFixed(2)}%`);
  if (rms(w) < 0.02) ng(`${s.name} が鳴っていない`);
  if (clip / w.length > 0.02) ng(`${s.name} の音割れが多い`);
});
const idx = (n: string) => secs.findIndex((s) => s.name === n);
if (levels[idx('サビ')] <= levels[idx('イントロ')]) ng('サビがイントロより静か');
// イントロ：起動音のあと「K IS FOR KING」が鳴る（2〜3.5 秒）
if (rms(win(4, 7)) < 0.02) ng('イントロの読み上げが鳴っていない（起動中に押している？）');
// ブレイク：クラッシュの張り付きのあと無音 → 再起動の音
const br = secs[idx('ブレイク')].start;
const stuck = rms(win(br, br + 0.8)), quiet = rms(win(br + 1.5, br + 7.5)), back = rms(win(br + 8, br + 12));
console.log(`  クラッシュ：張り付き ${stuck.toFixed(3)} → 無音 ${quiet.toFixed(4)} → 再起動 ${back.toFixed(3)}`);
if (quiet > 0.003) ng('クラッシュ中が無音になっていない');
if (back < 0.02) ng('再起動の音が鳴っていない');
// 最後：電源 OFF で静かに終わる
const tail = rms(a.subarray(a.length - SR * 0.6));
console.log(`  終わりの余韻 rms ${tail.toFixed(4)}`);
if (tail > 0.01) ng('電源 OFF の後も鳴っている');
// 再現性：同じ曲をもう一度鳴らすと同じ波形
const b = renderSong(song, SR);
let d = 0;
for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
console.log('  2 回鳴らした差（最大）', d);
if (d > 1e-6) ng('同じ曲なのに毎回違う音になる');

mkdirSync('out', { recursive: true });
const buf = Buffer.alloc(44 + a.length * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + a.length * 2, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(a.length * 2, 40);
for (let i = 0; i < a.length; i++) buf.writeInt16LE(Math.round(a[i] * 32767), 44 + i * 2);
writeFileSync('out/demo.wav', buf);
console.log('out/demo.wav に書き出しました');
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
