// 自動作曲の検査：同じ設定なら同じ曲・全スタイル×長さで作れる・鍵・セクションだけ作り直し・鳴る・クラッシュ
import { mkdirSync, writeFileSync } from 'node:fs';
import { SYS_CRASH, songBeats, type Song } from '../src/core/song';
import { defaultComposer } from '../src/compose/rules';
import { LENGTHS, STYLES, STYLE_IDS } from '../src/compose/styles';
import type { ComposeSettings } from '../src/compose/types';
import { renderSong } from '../src/studio/render';

const SR = 24000;
let fail = 0;
const ng = (m: string) => { fail++; console.log('NG', m); };
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / Math.max(1, b.length));
const C = defaultComposer();
const TOYS = [{ toy: 0, kind: 'blippy' as const }];
const make = (o: Partial<ComposeSettings> = {}, base?: Song, section?: number) => {
  const st = o.style ?? 'beat';
  return C.compose({ settings: { seed: 1234, style: st, chaos: 0.5, lengthSec: 60, bpm: STYLES[st].bpm, ...o }, toys: TOYS, base, section });
};
function wav(a: Float32Array): Buffer {
  const buf = Buffer.alloc(44 + a.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + a.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(a.length * 2, 40);
  for (let i = 0; i < a.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, a[i])) * 32767), 44 + i * 2);
  return buf;
}
const count = (s: Song) => s.tracks.reduce((n, t) => n + t.notes.length, 0);

// ---- 全スタイル × 長さ ----
for (const style of STYLE_IDS) for (const len of LENGTHS) {
  const s = make({ style, lengthSec: len });
  const sec = (songBeats(s) * 60) / s.bpm;
  if (Math.abs(sec - len) > Math.max(6, len * 0.15)) ng(`${style} ${len}秒 → ${sec.toFixed(0)} 秒になった`);
  if (count(s) < 8) ng(`${style} ${len}秒 の音符が少なすぎる（${count(s)}）`);
  if (s.tracks.length !== 3) ng(`${style} のトラック数が ${s.tracks.length}`);
  for (const t of s.tracks) for (const n of t.notes) if (!(n.start >= 0 && n.start < songBeats(s)) || !Number.isFinite(n.key)) ng(`${style} に変な音符`);
}
console.log('全スタイル×長さ：作成 OK');
// ---- 同じ設定 → 同じ曲、シードが違う → 違う曲 ----
if (JSON.stringify(make()) !== JSON.stringify(make())) ng('同じ設定なのに違う曲になる');
if (JSON.stringify(make().tracks) === JSON.stringify(make({ seed: 99 }).tracks)) ng('シードを変えても同じ曲');
// ---- 鍵：メロディに鍵を掛けて別のシードで作り直す → メロディはそのまま ----
{
  const a = make();
  const mel = a.tracks.find((t) => t.part === 'blippy:melody')!;
  mel.lock = true;
  const b = make({ seed: 777 }, a);
  const mel2 = b.tracks.find((t) => t.part === 'blippy:melody')!;
  if (JSON.stringify(mel2.notes) !== JSON.stringify(mel.notes)) ng('鍵を掛けたトラックが変わった');
  const keys = (s: Song) => JSON.stringify(s.tracks.find((t) => t.part === 'blippy:keys')!.notes);
  if (keys(a) === keys(b)) ng('鍵の無いトラックが作り直されていない');
  if (b.tracks.filter((t) => t.part === 'blippy:melody').length !== 1) ng('鍵のトラックが 2 本になった');
}
// ---- セクションだけ作り直す ----
{
  const a = make({ lengthSec: 120 });
  const sec = a.sections![2];
  const nx = a.sections![3];
  const b = make({}, a, 2);
  const inside = (s: Song) => JSON.stringify(s.tracks.map((t) => t.notes.filter((n) => n.start >= sec.start && n.start < nx.start)));
  const outside = (s: Song) => JSON.stringify(s.tracks.map((t) => t.notes.filter((n) => n.start < sec.start || n.start >= nx.start)));
  if (outside(a) !== outside(b)) ng('作り直したセクションの外が変わった');
  if (inside(a) === inside(b)) ng('セクションが作り直されていない');
  console.log(`セクション「${sec.name}」だけ作り直し OK`);
}
// ---- 鳴らしてみる（スタイルごと）：セクションが鳴る・クラッシュ中は無音 ----
mkdirSync('out', { recursive: true });
for (const style of STYLE_IDS) {
  const s = make({ style, lengthSec: 60, chaos: 0.9 });
  const a = renderSong(s, SR, { toys: [0] });
  const at = (beat: number) => Math.floor(((beat * 60) / s.bpm) * SR);
  const levels = (s.sections ?? []).map((x, i, arr) => rms(a.subarray(at(x.start), at(i + 1 < arr.length ? arr[i + 1].start : songBeats(s)))));
  const crash = s.tracks.flatMap((t) => t.notes).find((n) => n.key === SYS_CRASH);
  let crashRms = -1;
  if (crash) crashRms = rms(a.subarray(at(crash.start + 1.2), at(crash.start + crash.len - 0.2)));
  console.log(`${STYLES[style].name.padEnd(6, '　')} ${s.bars} 小節 BPM ${s.bpm}  セクションの音量 ${levels.map((l) => l.toFixed(2)).join(' ')}${crash ? `  クラッシュ中 ${crashRms.toFixed(4)}` : ''}`);
  if (levels.some((l) => l < 0.01)) ng(`${style} に鳴らないセクションがある`);
  if (crash && crashRms > 0.003) ng(`${style} のクラッシュ中が無音でない`);
  if ((style === 'collapse' || style === 'beat' || style === 'noise') && !crash) ng(`${style}（壊れ度 0.9）にクラッシュが無い`);
  writeFileSync(`out/compose-${style}.wav`, wav(a));
}
// ---- 6 台すべての作曲係：どのスタイルでも作れて、鳴って、同じ設定なら同じ ----
{
  const KINDS = ['blippy', 'piko', 'dj', 'vroom', 'typo', 'tele'] as const;
  const ALL = KINDS.map((_, i) => i);
  for (const [i, kind] of KINDS.entries()) {
    const levels: string[] = [];
    for (const style of STYLE_IDS) {
      const st = { seed: 4321, style, chaos: 0.7, lengthSec: 30, bpm: STYLES[style].bpm };
      const s = C.compose({ settings: st, toys: [{ toy: i, kind }] });
      if (JSON.stringify(s) !== JSON.stringify(C.compose({ settings: st, toys: [{ toy: i, kind }] }))) ng(`${kind} ${style}：同じ設定なのに違う曲`);
      if (!s.tracks.length || count(s) < 8) { ng(`${kind} ${style}：音符が少ない（${count(s)}）`); continue; }
      for (const t of s.tracks) for (const n of t.notes) if (!Number.isFinite(n.key) || n.key < 0 || !(n.len > 0)) ng(`${kind} ${style} に変な音符 ${JSON.stringify(n)}`);
      for (const t of s.tracks) for (const a of t.autos) if (!Number.isFinite(a.v)) ng(`${kind} ${style} に変な値`);
      if (style === 'beat' || style === 'ambient') {
        const a = renderSong(s, SR, { toys: ALL });
        const l = rms(a);
        levels.push(`${STYLES[style].name} ${l.toFixed(3)}`);
        if (l < 0.01 || a.some((x) => !Number.isFinite(x))) ng(`${kind} ${style} が鳴らない（${l.toFixed(4)}）`);
        writeFileSync(`out/compose-${kind}-${style}.wav`, wav(a));
      }
    }
    console.log(`${kind.padEnd(7)} 全スタイル OK  音量：${levels.join(' / ')}`);
  }
}

// 壊れ度 0 ならクラッシュしない（崩壊スタイル以外）
if (make({ style: 'beat', chaos: 0 }).tracks.some((t) => t.notes.some((n) => n.key === SYS_CRASH))) ng('壊れ度 0 でクラッシュする');
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
