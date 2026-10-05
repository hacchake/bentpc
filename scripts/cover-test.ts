// 曲の解析（カバー用）の検査：答えのわかっている曲を作って解析し、テンポ・調・コード・ドラム・メロディが合っているか
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyze } from '../src/cover/analyze';
import { coverPlan, coverSource } from '../src/cover/plan';
import { degreeOf } from '../src/cover/analyze';
import { compHits, hitMidi } from '../src/compose/harmony';
import { defaultComposer } from '../src/compose/rules';
import { planSong } from '../src/compose/plan';
import { styleOf } from '../src/compose/styles';
import { drumBar } from '../src/compose/harmony';
import { Rng } from '../src/core/rng';
import { renderSong } from '../src/studio/render';

const SR = 44100;
let fails = 0;
const C = defaultComposer();
const ng = (m: string) => { fails++; console.log('NG', m); };
const ok = (m: string) => console.log('OK', m);
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
function wav(a: Float32Array, sr: number): Buffer {
  const b = Buffer.alloc(44 + a.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + a.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(a.length * 2, 40);
  for (let i = 0; i < a.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, a[i])) * 32767), 44 + i * 2);
  return b;
}

// ================= 1. 合成した曲（ニ長調・120 BPM・16 小節） =================
let synth: ReturnType<typeof analyze> | null = null;
let synthAudio: Float32Array | null = null;
{
  const bpm = 120, beat = 60 / bpm, bars = 16, lead = 0.37; // 頭に少し無音
  const n = Math.round((lead + bars * 4 * beat + 1) * SR);
  const x = new Float32Array(n);
  const r = new Rng(7);
  const add = (t: number, dur: number, f: (i: number, k: number) => number, g: number) => {
    const o = Math.round(t * SR);
    for (let i = 0; i < dur * SR && o + i < n; i++) x[o + i] += f(i, i / (dur * SR)) * g;
  };
  const D = 62; // D4
  const PROG = [0, 4, 5, 3]; // I V vi IV（D A Bm G）
  const MAJ = [0, 2, 4, 5, 7, 9, 11];
  const tri = (deg: number) => [0, 2, 4].map((k) => { const d = deg + k; return MAJ[d % 7] + 12 * Math.floor(d / 7); });
  const melodyTruth: { t: number; midi: number }[] = [];
  for (let b = 0; b < bars; b++) {
    const t0 = lead + b * 4 * beat, deg = PROG[b % 4];
    // 和音（やわらかいオルガン、2 拍ずつ）
    for (const half of [0, 2]) for (const iv of tri(deg)) add(t0 + half * beat, 2 * beat, (i, k) => Math.sin((2 * Math.PI * midiHz(D - 12 + iv) * i) / SR) * Math.min(1, k * 20) * Math.min(1, (1 - k) * 20), 0.07);
    // ベース（根音・8 分）
    for (let e = 0; e < 8; e++) add(t0 + e * beat * 0.5, beat * 0.45, (i, k) => Math.sin((2 * Math.PI * midiHz(D - 24 + MAJ[deg]) * i) / SR) * (1 - k), 0.25);
    // メロディ（和音の音を順に、8 分）
    for (let e = 0; e < 8; e++) {
      const tones = tri(deg), m = D + 12 + tones[e % 3] - (e % 4 === 3 ? 12 : 0);
      melodyTruth.push({ t: b * 4 + e * 0.5, midi: m });
      add(t0 + e * beat * 0.5, beat * 0.45, (i, k) => (Math.sin((2 * Math.PI * midiHz(m) * i) / SR) + 0.3 * Math.sin((4 * Math.PI * midiHz(m) * i) / SR)) * Math.min(1, k * 30) * (1 - k * 0.5), 0.16);
    }
    // ドラム：キック 1・3 拍、スネア 2・4 拍、ハット 8 分
    for (const q of [0, 2]) add(t0 + q * beat, 0.25, (i, k) => Math.sin(2 * Math.PI * (50 * i / SR + 2 * (1 - Math.exp(-i / (SR * 0.02))))) * (1 - k) ** 2, 0.8);
    for (const q of [1, 3]) add(t0 + q * beat, 0.18, (_, k) => r.bi() * (1 - k) ** 3, 0.45);
    for (let e = 0; e < 8; e++) add(t0 + e * beat * 0.5, 0.04, (i, k) => (r.bi() - (i % 2 ? 0.5 : -0.5)) * (1 - k) ** 2, 0.12);
  }
  const t = performance.now();
  const a = analyze([x], SR);
  const ms = performance.now() - t;
  synth = a; synthAudio = x;
  Math.abs(a.bpm - bpm) < 2 ? ok(`合成：テンポ ${a.bpm} BPM（答え 120）・解析 ${(ms / 1000).toFixed(1)} 秒（曲 ${(n / SR).toFixed(0)} 秒）`) : ng(`合成：テンポ ${a.bpm}`);
  Math.abs(a.offset - lead) < 0.06 ? ok(`合成：最初の小節の頭 ${a.offset.toFixed(2)} 秒（答え ${lead}）`) : ng(`合成：小節の頭 ${a.offset} 秒（答え ${lead}）`);
  a.key.tonic === 2 && !a.key.minor && a.shift === -2 ? ok(`合成：調 ${a.key.name}（答え D）・移調 ${a.shift}`) : ng(`合成：調 ${a.key.name} 移調 ${a.shift}`);
  const truth = Array.from({ length: a.bars }, (_, b) => PROG[b % 4]);
  const acc = a.chords.filter((d, i) => d === truth[i]).length / Math.max(1, a.bars);
  acc >= 0.75 ? ok(`合成：コード ${Math.round(acc * 100)}% 正解（${a.chordNames.slice(0, 4).join(' ')} …）`) : ng(`合成：コード ${Math.round(acc * 100)}%（${a.chordNames.slice(0, 8).join(' ')}）`);
  const kickHit = a.drums.reduce((s, d) => s + (d.kick[0] === 'x' ? 1 : 0) + (d.kick[8] === 'x' ? 1 : 0), 0) / (a.bars * 2);
  const snHit = a.drums.reduce((s, d) => s + (d.snare[4] === 'x' ? 1 : 0) + (d.snare[12] === 'x' ? 1 : 0), 0) / (a.bars * 2);
  kickHit >= 0.8 && snHit >= 0.7 ? ok(`合成：キック ${Math.round(kickHit * 100)}%・スネア ${Math.round(snHit * 100)}% 聞き取れた`) : ng(`合成：キック ${kickHit} スネア ${snHit}（例 ${JSON.stringify(a.drums[1])}）`);
  // メロディ：答えの音の頭で、聞き取った音の名前（12 音）が合っているか（移調ずみ → 答えも C に移す）
  let hit = 0;
  for (const m of melodyTruth) {
    const got = a.melody.find((nn) => m.t >= nn.t - 1e-6 && m.t < nn.t + nn.len - 1e-6);
    if (got && (((got.midi - (m.midi + a.shift)) % 12) + 12) % 12 === 0) hit++;
  }
  const mAcc = hit / melodyTruth.length;
  mAcc >= 0.6 ? ok(`合成：メロディ ${Math.round(mAcc * 100)}% 合っている（音符 ${a.melody.length} 個）`) : ng(`合成：メロディ ${Math.round(mAcc * 100)}%`);
  const bAcc = a.bass.filter((nn) => { const b = Math.floor(nn.t / 4); return (((nn.midi - 36) % 12) + 12) % 12 === MAJ[truth[b] ?? 0]; }).length / Math.max(1, a.bass.length);
  bAcc >= 0.7 ? ok(`合成：ベース ${Math.round(bAcc * 100)}% が根音`) : ng(`合成：ベース ${Math.round(bAcc * 100)}%`);
  a.sections.length >= 1 ? ok(`合成：構成 ${a.sections.map((s) => `${s.name}(${s.bars})`).join(' → ')}`) : ng('合成：構成が無い');
}

// ================= 2. おもちゃで作った曲 =================
for (const [style, kinds, ids] of [['beat', ['sampler', 'piko'], [6, 1]], ['house', ['sampler', 'dj'], [6, 2]], ['reggae', ['sampler', 'typo'], [6, 4]]] as const) {
  const settings = { seed: 11, style, chaos: 0.1, lengthSec: 60, bpm: styleOf(style).bpm };
  const song = C.compose({ settings, toys: kinds.map((kind, toy) => ({ toy, kind })) });
  const plan = planSong(settings);
  const audio = renderSong(song, SR, { toys: [...ids] });
  const a = analyze([audio], SR);
  const bpm = plan.bpm;
  const tempoOk = Math.abs(a.bpm - bpm) / bpm < 0.03;
  // 小節のずれ（解析の 1 小節目が、曲の何小節目か）を、コードの一致で合わせる
  let best = 0, shiftBars = 0;
  for (let k = -2; k <= 4; k++) {
    let m = 0, c = 0;
    a.chords.forEach((d, i) => { const j = i + k; if (j >= 0 && j < plan.chords.length) { c++; if (plan.chords[j] === d) m++; } });
    if (c && m / c > best) { best = m / c; shiftBars = k; }
  }
  // キック：曲の設計図のキックの位置と、聞き取ったキックの位置
  let tp = 0, fn = 0;
  for (let i = 0; i < a.bars; i++) {
    const j = i + shiftBars, sec = plan.sections.find((s) => j * 4 >= s.start && j * 4 < s.start + s.bars * 4);
    if (!sec) continue;
    const d = drumBar(plan, sec, j - sec.start / 4, new Rng(1));
    if (!d) continue;
    for (let s = 0; s < 16; s++) if (d.kick[s] === 'x') { if (a.drums[i].kick[s] === 'x' || a.drums[i].kick[(s + 1) % 16] === 'x' || a.drums[i].kick[(s + 15) % 16] === 'x') tp++; else fn++; }
  }
  const kRec = tp / Math.max(1, tp + fn);
  const line = `${styleOf(style).name}（${kinds.join('+')}）：テンポ ${a.bpm}（答え ${bpm}）・調 ${a.key.name}・コード ${Math.round(best * 100)}%・キック ${Math.round(kRec * 100)}%・構成 ${a.sections.map((s) => s.name).join('/')}`;
  tempoOk && a.shift === 0 && best >= 0.5 && kRec >= 0.6 ? ok(line) : ng(line);
}

// ================= 3. カバー：解析した曲を、おもちゃだけで作り直す =================
{
  const a = synth!;
  const src = coverSource(a, 'テスト曲');
  mkdirSync('out', { recursive: true });
  writeFileSync('out/cover-original.wav', wav(synthAudio!, SR));
  const KINDS = ['blippy', 'piko', 'dj', 'vroom', 'typo', 'tele', 'sampler'] as const;
  for (const ids of [[6], [1, 6], [0, 2, 4], [0, 1, 2, 3, 4, 5, 6]]) {
    const toys = ids.map((id, toy) => ({ toy, kind: KINDS[id] }));
    const song = C.compose({ settings: { seed: 3, style: 'beat', chaos: 0.2, lengthSec: 60, bpm: 120 }, toys, cover: src });
    const audio = renderSong(song, SR, { toys: ids });
    // カバーを解析し直して、元と同じコード・テンポになっているか
    const b = analyze([audio], SR);
    let best = 0;
    for (let k = -2; k <= 2; k++) {
      let m = 0, c = 0;
      b.chords.forEach((d, i) => { const j = i + k; if (j >= 0 && j < a.chords.length) { c++; if (a.chords[j] === d) m++; } });
      if (c) best = Math.max(best, m / c);
    }
    // メロディ：解析したメロディの音の頭に、どれかのおもちゃのメロディの音符があるか
    const melTracks = song.tracks.filter((t) => /:(melody|lead|keys|notes)$/.test(t.part ?? ''));
    const starts = melTracks.flatMap((t) => t.notes.filter((nn) => nn.key < 2000).map((nn) => nn.start));
    const covered = a.melody.filter((m) => starts.some((st) => Math.abs(st - m.t) < 0.05)).length / Math.max(1, a.melody.length);
    // コードは、和音を弾くおもちゃ（PIKOTONE・サンプラー）がいるときだけ、解析し直して確かめる
    const chordToy = ids.some((i) => i === 1 || i === 6);
    const name = ids.map((i) => KINDS[i]).join('+');
    writeFileSync(`out/cover-${name}.wav`, wav(audio, SR));
    const line = `カバー（${name}）：「${song.title}」${song.bars} 小節・テンポ ${b.bpm}・メロディ ${Math.round(covered * 100)}% 再現${chordToy ? `・コード ${Math.round(best * 100)}% 元と同じ` : ''}・トラック ${song.tracks.length} 本`;
    Math.abs(b.bpm - 120) < 3 && covered >= 0.7 && (!chordToy || best >= 0.5) /* おもちゃの音を解析し直すので目安 */ && song.bars === a.bars && song.compose?.cover ? ok(line) : ng(line);
  }
  // 調の外のコード：E（III の長三和音）・B♭（♭VII）・Fm（iv）を、伴奏がその音で弾く
  {
    const src2 = JSON.parse(JSON.stringify(src));
    const half = src2.bars * 2;
    src2.chordQ = Array.from({ length: half }, (_, i) => [{ root: 4, q: 'maj' }, { root: 10, q: 'maj' }, { root: 5, q: 'min' }, { root: 0, q: 'maj' }][Math.floor(i / 2) % 4]);
    src2.chordsHalf = src2.chordQ.map(degreeOf);
    src2.chords = src2.chordsHalf.filter((_: number, i: number) => i % 2 === 0);
    const plan = coverPlan({ seed: 3, style: 'beat', chaos: 0.2, lengthSec: 60, bpm: 120 }, src2);
    const pcs = (bar: number) => { const h = compHits(plan, { ...plan.sections[0], start: bar * 4, bars: 1 })[0]; return h.degs.map((_, i) => (((hitMidi(h, i, 60)) % 12) + 12) % 12).sort((x, y) => x - y).join(','); };
    const got = [0, 1, 2, 3].map(pcs), want = ['4,8,11', '2,5,10', '0,5,8', '0,4,7'];
    got.join('|') === want.join('|') ? ok(`調の外のコードを弾く：E・B♭・Fm・C → ${got.join(' / ')}`) : ng(`調の外のコード：${got.join(' / ')}（答え ${want.join(' / ')}）`);
  }
  // セクションだけ作り直しても、カバーのまま
  const song = C.compose({ settings: { seed: 3, style: 'beat', chaos: 0.2, lengthSec: 60, bpm: 120 }, toys: [{ toy: 0, kind: 'sampler' }], cover: src });
  const again = C.compose({ settings: song.compose!.settings, toys: [{ toy: 0, kind: 'sampler' }], base: song, section: 0 });
  again.bars === song.bars && again.compose?.cover ? ok('カバーのセクションだけ作り直しても、カバーのまま') : ng('セクションの作り直しでカバーが外れた');
}

console.log(fails ? `NG ${fails} 個` : 'すべて OK');
process.exit(fails ? 1 : 0);
