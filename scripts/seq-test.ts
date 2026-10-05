// シーケンサーの自動テスト：録音 → 曲に入る → 再生で同じ音が鳴る → 編集が音に反映される → オーバーダブ
import { BTN, SYS_CRASH, SYS_POWER_ON, cloneSong, emptySong, type Song } from '../src/core/song';
import { hashSeed } from '../src/core/rng';
import { TestSignal } from '../src/core/testsignal';
import type { ToyEngine } from '../src/core/toy';
import { Sequencer } from '../src/host/sequencer';
import { MidiSync } from '../src/host/midisync';
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

// ================= スタジオ用の機能 =================
{
  const IDS = [0, 5]; // BLIPPY と TELEKEY
  const make = (seed?: number) => IDS.map((id) => TOY_ENGINES[id](SR, seed === undefined ? undefined : hashSeed(seed, id) >>> 0));
  const studio = (song: Song) => {
    const toys = make();
    let ended = 0;
    const sig = new TestSignal(SR);
    const seq = new Sequencer(SR, toys, { onTake: () => {}, onEnd: () => { ended++; }, onRebuild: () => sig.reset() }, make);
    seq.setSong(cloneSong(song));
    const out = new Float32Array(128), click = new Float32Array(128), tmp = new Float32Array(128), inp = new Float32Array(128);
    const run = (sec: number) => {
      const res = new Float32Array(Math.floor((SR * sec) / 128) * 128);
      for (let i = 0; i < res.length / 128; i++) { sig.render(inp, seq.playing ? seq.pos : null, song.bpm); seq.render(out, click, tmp, inp); res.set(out, i * 128); }
      return res;
    };
    return { seq, run, toys, ended: () => ended };
  };
  const song: Song = {
    version: 1, bpm: 120, bars: 4, metronome: false, seed: 42, ramp: true, loop: { on: false, start: 0, end: 16 },
    tracks: [
      { toy: 0, mute: false, notes: [0, 1, 2, 3].map((k, i) => ({ key: k, start: i * 0.5, len: 0.4, take: 0 })), autos: [{ index: 1, t: 0, v: 3, take: 0 }] },
      { toy: 0, mute: false, notes: [{ key: BTN + 3, start: 1, len: 1, take: 0 }], autos: [{ index: 16, t: 0, v: 0, take: 0 }, { index: 16, t: 4, v: 0.9, take: 0 }] },
      { toy: 1, mute: false, notes: [53, 54, 55, 56, 28].map((k, i) => ({ key: k, start: i * 0.5, len: 0.3, take: 0 })), autos: [] },
    ],
  };
  // 頭から再生すると毎回まったく同じ音（おもちゃを新品にする）。途中で別の音を鳴らしてあっても同じ
  const s1 = studio(song); s1.toys[0].powerOn(); s1.toys[0].keyDown(7); s1.run(0.3); s1.seq.play(0); const r1 = s1.run(4);
  const s2 = studio(song); s2.seq.play(0); const r2 = s2.run(4);
  console.log('スタジオ：2 回の再生の差', diff(r1, r2).toExponential(2), 'rms', rms(r1).toFixed(4));
  if (rms(r1) < 0.01) ng('スタジオの曲が鳴らない');
  if (diff(r1, r2) > 1e-7) ng('同じ曲・同じシードなのに音が変わる');
  const other = cloneSong(song); other.seed = 43;
  const s3 = studio(other); s3.seq.play(0); if (diff(s3.run(4), r1) < 1e-4) console.log('（シードを変えても音が同じ：この曲では乱数を使う場面が少ない）');
  // ループなし：最後まで来たら止まる
  s2.run(4.2);
  if (s2.seq.playing || s2.ended() !== 1) ng('ループなしで最後に止まらない');
  // ループ範囲：2〜3 拍目を回り続ける
  const lp = cloneSong(song); lp.loop = { on: true, start: 2, end: 3 };
  const s4 = studio(lp); s4.seq.play(0);
  let maxPos = 0; for (let i = 0; i < 20; i++) { s4.run(0.25); if (s4.seq.pos > maxPos) maxPos = s4.seq.pos; }
  if (!s4.seq.playing || maxPos > 3.01 || s4.seq.pos < 2) ng('ループ範囲で回らない');
  // ボタンの音符（GLITCH 1）が効く
  const nb = cloneSong(song); nb.tracks[1].notes = [];
  const s5 = studio(nb); s5.seq.play(0); if (diff(s5.run(4), r1) < 0.002) ng('ボタンの音符（GLITCH）が効いていない');
  // ノブの点の間がなめらか：途中の値
  const s6 = studio(song); s6.seq.play(0); s6.run(1.0); // 2 拍目
  const dist = s6.toys[0].params[16];
  console.log('DIST の途中の値（2 拍目・0→0.9 の半分なら 0.45）', dist.toFixed(3));
  if (Math.abs(dist - 0.45) > 0.03) ng('ノブの点の間がなめらかにつながらない');
  // クラッシュ：音が張り付いたあと無音 → 終わりで再起動して鳴る
  const cr = cloneSong(song);
  cr.bars = 8;
  cr.tracks[0].notes = [{ key: 0, start: 0, len: 0.4, take: 0 }, { key: SYS_CRASH, start: 1, len: 4, take: 0 }, { key: 2, start: 6, len: 0.4, take: 0 }];
  cr.tracks[2].notes = [{ key: 53, start: 0.5, len: 0.3, take: 0 }, { key: 53, start: 2, len: 0.3, take: 0 }, { key: SYS_CRASH, start: 1, len: 4, take: 0 }, { key: 53, start: 6, len: 0.3, take: 0 }];
  const s7 = studio(cr); s7.seq.play(0);
  s7.run(0.5); // 0〜1 拍
  const stuck = s7.run(0.2); // 1〜1.4 拍：張り付き
  s7.run(0.3);
  const quiet = s7.run(1.2); // 2〜4.4 拍：無音
  s7.run(0.45);
  const back = s7.run(1.2); // 5.3〜7.7 拍：再起動音・その後の音
  console.log('クラッシュ：張り付き', rms(stuck).toFixed(4), '無音', rms(quiet).toFixed(5), '再起動後', rms(back).toFixed(4));
  if (rms(quiet) > 0.001) ng('クラッシュ中に音が止まらない');
  if (rms(back) < 0.01) ng('クラッシュの後に再起動しない');
  if (s7.seq.crashed(0) || s7.seq.crashed(1)) ng('クラッシュが終わらない');
  // POWER ON の音符：それまでは鳴らない
  const pw = cloneSong(song); pw.tracks[0].notes.push({ key: SYS_POWER_ON, start: 2, len: 0.5, take: 0 }); pw.tracks[0].notes.sort((a, b) => a.start - b.start);
  pw.tracks[2].notes = [{ key: SYS_POWER_ON, start: 2, len: 0.5, take: 0 }];
  const s8 = studio(pw); s8.seq.play(0);
  const before = s8.run(0.9), after = s8.run(1.5);
  console.log('POWER ON の前', rms(before).toFixed(5), '後', rms(after).toFixed(4));
  if (rms(before) > 0.002 || rms(after) < 0.01) ng('POWER ON の音符が効いていない');
}

// ミキサー：音量・ミュート・ソロが音に効く（PIKOTONE の鍵盤を押しっぱなしで比べる）
{
  const level = (mix: Song['mix']) => {
    const s = emptySong(TOY_ENGINES.length);
    s.mix = mix;
    const m = rig(s);
    m.toys[1].powerOn();
    m.run(0.3);
    m.toys[1].keyDown(5);
    return rms(m.run(0.5));
  };
  const plain = level(undefined), quiet = level([null, { gain: -12, pan: null }]);
  const muted = level([null, { gain: 0, pan: null, mute: true }]), soloOther = level([{ gain: 0, pan: null, solo: true }]);
  const ratio = quiet / plain;
  if (plain < 0.01) ng(`ミキサー：元の音が出ていない ${plain}`);
  else if (Math.abs(20 * Math.log10(ratio) + 12) > 1) ng(`ミキサー：-12dB のはずが ${(20 * Math.log10(ratio)).toFixed(1)}dB`);
  else if (muted > plain * 0.01 || soloOther > plain * 0.01) ng(`ミキサー：ミュート ${muted}・ほかのソロ ${soloOther} で音が残る`);
  else console.log(`OK ミキサー：-12dB → ${(20 * Math.log10(ratio)).toFixed(1)}dB・ミュートとほかのおもちゃのソロで無音`);
}

// MIDI クロック：外の機器のテンポ・START / STOP に合わせる
{
  const got: string[] = [];
  let bpm = 0;
  const ms = new MidiSync({ start: () => got.push('start'), cont: () => got.push('cont'), stop: () => got.push('stop'), tempo: (b) => { bpm = b; } });
  ms.feed(0xfa, 0);
  // 128 BPM のクロック（少し揺らす）を 3 秒
  const iv = 60000 / 128 / 24;
  for (let k = 1; k < 24 * 6; k++) ms.feed(0xf8, k * iv + Math.sin(k) * 0.4);
  ms.feed(0xfc, 4000);
  got.join(',') === 'start,stop' && bpm === 128 ? console.log(`OK MIDI クロック：START・STOP・${bpm} BPM`) : ng(`MIDI クロック：${got.join(',')} ${bpm} BPM`);
}

console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
