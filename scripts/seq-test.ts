// シーケンサーの自動テスト：録音 → 曲に入る → 再生で同じ音が鳴る → 編集が音に反映される → オーバーダブ
import { cloneSong, emptySong, type Song } from '../src/core/song';
import type { ToyEngine } from '../src/core/toy';
import { Sequencer } from '../src/host/sequencer';
import { TOY_ENGINES } from '../src/toys/engines';

const SR = 48000;
let fail = 0;
const ng = (m: string) => { fail++; console.log('NG', m); };
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);
const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };

function rig(song?: Song) {
  const toys: ToyEngine[] = TOY_ENGINES.map((m) => m(SR));
  const takes: number[] = [];
  let ended = false;
  const seq = new Sequencer(SR, toys, { onTake: (t) => takes.push(t), onEnd: () => { ended = true; } });
  if (song) seq.setSong(cloneSong(song));
  const out = new Float32Array(128), click = new Float32Array(128), tmp = new Float32Array(128);
  const run = (sec: number, each?: (beat: number) => void) => {
    const res = new Float32Array(Math.floor((SR * sec) / 128) * 128);
    for (let i = 0; i < res.length / 128; i++) { each?.(seq.pos); seq.render(out, click, tmp); res.set(out, i * 128); }
    return res;
  };
  return { toys, seq, run, takes, ended: () => ended };
}

// PIKOTONE（2 台目）の鍵盤で録音する。1 小節（2 秒 @120BPM）
const base = emptySong(TOY_ENGINES.length);
base.bars = 1;
base.metronome = true;
const r = rig(base);
r.toys[1].powerOn();
r.run(0.2);
r.seq.play(0);
r.seq.setRecording(true, 1);
const plan: [number, number, boolean][] = [[0.5, 5, true], [0.9, 5, false], [1.5, 9, true], [2.5, 9, false]]; // [拍, キー, 押す/離す]
let pi = 0;
r.run(2.2, (beat) => {
  while (pi < plan.length && beat >= plan[pi][0]) {
    const [, key, down] = plan[pi++];
    down ? r.toys[1].keyDown(key) : r.toys[1].keyUp(key);
    r.seq.live(1, { type: 'key', key, down });
  }
});
r.seq.setRecording(false);
const notes = r.seq.song.tracks[1].notes;
console.log('録音された音符', JSON.stringify(notes.map((n) => [n.key, +n.start.toFixed(2), +n.len.toFixed(2)])));
if (notes.length !== 2 || Math.abs(notes[0].start - 0.5) > 0.02 || Math.abs(notes[1].len - 1) > 0.03) ng('録音の位置・長さがおかしい');
if (r.takes.length !== 1) ng('テイクが画面に届いていない');

// 再生：同じ曲を別の新品のおもちゃで鳴らすと、2 回とも同じ音になる（再現性）
const song = cloneSong(r.seq.song);
const play = (s: Song) => { const p = rig(s); p.toys[1].powerOn(); p.run(0.2); p.seq.play(0); return p.run(2); };
const a = play(song), b = play(song);
console.log('再生 rms', rms(a).toFixed(4), '2 回の差', diff(a, b).toFixed(6));
if (rms(a) < 0.01) ng('再生で鳴らない');
if (diff(a, b) > 1e-6) ng('同じ曲なのに音が変わる（再現性がない）');

// 編集：音符を 1 拍ずらすと音が変わる
const edited = cloneSong(song);
edited.tracks[1].notes[0].start += 1;
if (diff(play(edited), a) < 0.005) ng('編集が音に反映されない');
// ミュート
const muted = cloneSong(song);
muted.tracks[1].mute = true;
if (rms(play(muted)) > 0.005) ng('ミュートが効かない');

// ツマミの動き（オートメーション）：DIST を途中で上げる
const auto = cloneSong(song);
auto.tracks[1].autos.push({ index: 26, t: 1.4, v: 0.9, take: 9 }); // PIKO の dist（下で確認）
if (diff(play(auto), a) < 0.005) ng('ツマミの動きが反映されない');

// オーバーダブ：ループ 2 周目で別の音を重ねる → 1 周目に録った音も消えない
const o = rig(song);
o.toys[1].powerOn();
o.run(0.2);
o.seq.play(0);
o.seq.setRecording(true, 2);
let did = false;
o.run(2.3, (beat) => {
  if (!did && beat > 0.2 && beat < 1) { did = true; o.toys[1].keyDown(20); o.seq.live(1, { type: 'key', key: 20, down: true }); }
});
o.toys[1].keyUp(20); o.seq.live(1, { type: 'key', key: 20, down: false });
o.seq.stop();
const keys = o.seq.song.tracks[1].notes.map((n) => n.key).sort((x, y) => x - y);
console.log('オーバーダブ後の音符のキー', keys.join(','));
if (!keys.includes(5) || !keys.includes(9) || !keys.includes(20)) ng('オーバーダブで音が重ならない');

// BOUNCE：1 回だけ鳴らして終わる
const bn = rig(song);
bn.toys[1].powerOn();
bn.seq.bounce = true;
bn.seq.play(0);
bn.run(2.3);
if (!bn.ended() || bn.seq.playing) ng('BOUNCE が終わらない');

console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
