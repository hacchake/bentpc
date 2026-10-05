// MANEKKO MK-8 の検査：テープを小節から鳴らす・ツマミで歌／伴奏／原曲を切り替える・カバーの曲にテープの音符が小節ごとに入る
import { ManekkoEngine, MK, type ManekkoTape } from '../src/toys/manekko/engine';
import { defaultComposer } from '../src/compose/rules';
import { coverSource } from '../src/cover/plan';
import { analyze } from '../src/cover/analyze';
import { renderSong } from '../src/studio/render';

const SR = 48000, B = 128;
let fails = 0;
const ng = (m: string) => { fails++; console.log('NG', m); };
const ok = (m: string) => console.log('OK', m);
const freq = (x: Float32Array) => { let z = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) z++; return (z * SR) / x.length; };
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

// テープ：小節ごとに高さの違う音（歌 = 200 + 100×小節 Hz、伴奏 = 1000Hz、原曲 = 1500Hz）。120 BPM・8 小節
const tsr = 22050, bpm = 120, barLen = 2 * tsr, n = barLen * 8;
const vocal = new Float32Array(n), inst = new Float32Array(n), orig = new Float32Array(n);
for (let i = 0; i < n; i++) { const b = Math.floor(i / barLen); vocal[i] = Math.sin((2 * Math.PI * (200 + 100 * b) * i) / tsr) * 0.5; inst[i] = Math.sin((2 * Math.PI * 1000 * i) / tsr) * 0.5; orig[i] = Math.sin((2 * Math.PI * 1500 * i) / tsr) * 0.5; }
const tape: ManekkoTape = { kind: 'tape', sr: tsr, bpm, vocal, inst, orig };
const run = (e: ManekkoEngine, sec: number) => { const out = new Float32Array(Math.round(sec * SR / B) * B), buf = new Float32Array(B); for (let o = 0; o < out.length; o += B) { e.process(buf); out.set(buf, o); } return out; };
{
  const e = new ManekkoEngine(SR);
  e.custom(tape);
  e.setParam(MK.wow, 0); e.setParam(MK.lofi, 0);
  e.powerOn();
  run(e, 0.8); // 起動音が終わるまで
  e.keyDown(3);
  const a = run(e, 0.6);
  const f3 = freq(a.subarray(Math.round(0.1 * SR)));
  Math.abs(f3 - 500) < 15 ? ok(`3 小節目から鳴る（${f3.toFixed(0)}Hz、答え 500）`) : ng(`小節 3：${f3}`);
  e.keyUp(3); e.keyDown(6);
  const b = run(e, 0.6);
  const f6 = freq(b.subarray(Math.round(0.1 * SR)));
  Math.abs(f6 - 800) < 15 ? ok(`6 小節目へ跳ぶ（${f6.toFixed(0)}Hz）`) : ng(`小節 6：${f6}`);
  e.setParam(MK.vocal, 0); e.setParam(MK.karaoke, 1);
  const c = run(e, 0.4);
  const fk = freq(c.subarray(Math.round(0.1 * SR)));
  Math.abs(fk - 1000) < 20 ? ok(`KARAOKE のツマミで伴奏に切り替わる（${fk.toFixed(0)}Hz）`) : ng(`伴奏 ${fk}`);
  e.keyUp(6);
  const d = run(e, 0.3);
  rms(d.subarray(Math.round(0.15 * SR))) < 0.01 ? ok('離すと止まる') : ng('止まらない');
}

// ---- カバーの曲に、テープの音符が小節ごと・ブレイクでも消えない ----
{
  // 答えのわかる短い曲（120 BPM のクリック＋和音）を解析
  const x = new Float32Array(44100 * 20);
  for (let q = 0; q < 40; q++) { const o = Math.round((0.2 + q * 0.5) * 44100); for (let i = 0; i < 4000 && o + i < x.length; i++) x[o + i] += Math.sin((2 * Math.PI * 60 * i) / 44100) * (1 - i / 4000) * 0.8 + Math.sin((2 * Math.PI * [262, 330, 392][q % 3] * i) / 44100) * 0.2 * (1 - i / 4000); }
  const a = analyze([x], 44100);
  const toys = [{ toy: 0, kind: 'sampler' as const }, { toy: 1, kind: 'manekko' as const }];
  const song = defaultComposer().compose({ settings: { seed: 9, style: 'beat', chaos: 0.2, lengthSec: 60, bpm: 120 }, toys, cover: coverSource(a, 'クリック') });
  const tr = song.tracks.find((t) => t.part === 'manekko:tape');
  const perBar = tr && tr.notes.filter((nn) => nn.key < 2000).length === song.bars && tr.notes.every((nn) => nn.key >= 2000 || nn.start === nn.key * 4);
  perBar ? ok(`カバーの曲：MANEKKO のテープが ${song.bars} 小節すべてに 1 つずつ`) : ng(`テープの音符 ${tr?.notes.length} / ${song.bars}`);
  // 書き出し（WAV）でもテープが鳴る：歌 = 440Hz のテープを渡して、原曲の拍で鳴っているか
  const bars = song.bars, spb = 60 / song.bpm, len = Math.round(bars * 4 * spb * tsr);
  const v2 = new Float32Array(len);
  for (let i = 0; i < len; i++) v2[i] = Math.sin((2 * Math.PI * 440 * i) / tsr) * 0.4;
  const t2: ManekkoTape = { kind: 'tape', sr: tsr, bpm: song.bpm, vocal: v2, inst: new Float32Array(len), orig: new Float32Array(len) };
  const solo = { ...song, tracks: song.tracks.filter((t) => t.toy === 1) };
  const audio = renderSong(solo, SR, { toys: [6, 7], customs: [{ toy: 1, data: t2 }] });
  const mid = audio.subarray(Math.round(SR * 2), Math.round(SR * 4));
  const f = freq(mid);
  rms(mid) > 0.05 && Math.abs(f - 440) < 20 ? ok(`書き出しでもテープが鳴る（${f.toFixed(0)}Hz・大きさ ${rms(mid).toFixed(2)}）`) : ng(`書き出し ${f} ${rms(mid)}`);
}

console.log(fails ? `NG ${fails} 個` : 'すべて OK');
process.exit(fails ? 1 : 0);
