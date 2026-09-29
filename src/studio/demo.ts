// デモ曲「POWER ON / POWER OFF」（BPM 120・76 小節・約 2 分 32 秒）。
// 曲データ（シーケンサーの形式）をこのファイルのコードで組み立てる。
// 「サビをもっと激しく」「イントロを短く」などの直しは、上の DEMO（設定）と各セクションの関数を書き換えて反映する。
//
// 構成：イントロ 8 → Aメロ 16 → 展開 16 → サビ 16 → ブレイク 8 → ラスト 12（小節）
// ・テスト信号（TELEKEY の入力の音）は Am → F → C → G を 1 小節ずつ繰り返す。メロディはこれに合わせてある
// ・トイPC は 1 音ずつしか鳴らない（新しい音が前の音を切る）ので、声とメロディは交互に置く

import { BTN, SYS_CRASH, SYS_POWER_OFF, SYS_POWER_ON, type SeqAuto, type SeqNote, type Song } from '../core/song';
import { TELE, TOY_PC } from './songs';

// ================= 設定（ここを変えると曲全体が変わる） =================
export const DEMO = {
  title: 'POWER ON / POWER OFF',
  bpm: 120,
  seed: 20260929,
  /** セクションの長さ（小節）。4 の倍数にしておくとコード進行とそろう */
  bars: { intro: 8, a: 16, dev: 16, chorus: 16, brk: 8, last: 12 },
  /** 音量（0〜1） */
  toyVolume: 0.6,
  teleVolume: 0.92,
};

// ================= おもちゃのキー・パラメーター番号 =================
// ---- トイPC（BLIPPY BOOK 30） ----
const P = { volume: 0, mode: 1, loopSwitch: 2, base: 8, lfoRate: 11, lfoDepth: 12, stretch: 13, stretchHold: 14, stretchRel: 15, dist: 16, distType: 17 };
const MODE = { ABC: 0, WORD: 1, TUNE: 2, PIANO: 3, DRUM: 4, SFX: 5, QUIZ: 6, SAY: 7 };
const GLITCH = (n: number) => BTN + 3 + (n - 1); // GLITCH 1〜5 のボタン
const LOOP_HOLD = BTN + 9, LOOP_RELEASE = BTN + 10;
/** 文字キー（'K' → 10）。WORD モードで「KING」、SAY モードで「K IS FOR KING」 */
const L = (c: string) => c.charCodeAt(0) - 65;
/** ドレミの数字キー（1 = ド(C5) … 8 = 上のド、10 = 上のミ）。どのモードでも鳴る */
const DO = (d: number) => 30 + d - 1;
/** PIANO モードの文字キー：音名（白鍵のみ）→ キー。C3 = A キー、C4 = H キー、C5 = O キー */
const PIANO = (name: string) => {
  const deg = 'CDEFGAB'.indexOf(name[0]);
  return (Number(name.slice(1)) - 3) * 7 + deg;
};
// ---- TELEKEY TK-6 ----
const T = { volume: 0, amount: 1, lfoRate: 2, lfoDepth: 3, feedback: 4, dist: 5, speed: 6, mix: 7, distType: 8, lfoTarget: 9, crosstalk: 10, base: 11 };
const KICK = 56, SNARE = 57, HAT = 58, BEEP_C = 53, ZAP = 60, BLIP_G = 61, CHIRP_C = 63, NOISE = 55;
/** 映像＋音のグリッチキー（0〜23）。名前は音のほう（映像はカッコ内）：
 *  STUTTER(RGB SHIFT) BITCRUSH(SCAN SHIFT) DATAMOSH(SMEAR) RINGMOD(PIXEL SORT) MOSAIC(DOWNSAMPLE) POSTER(QUANTIZE) REVERSE(INVERT)
 *  PITCHUP(MIRROR) PITCHDN(KALEIDO) TAPESTOP(SLIT SCAN) FEEDBACK(DELAY RUN) BLOCK(NOISE) FRAMEHOLD(GRAIN HOLD) VROLL(WOBBLE)
 *  HSYNC(FILTER LOW) GATE(THRESHOLD) EDGE(FILTER HIGH) ZOOM(COMB) TWIST(FLANGE) CHROMA(DRIVE) ECHO(ECHO TRAIL) SPLIT(PAN FLIP)
 *  STROBE(CHOP) MELT(SMEAR DOWN) */
const G = (n: number) => (n < 12 ? 28 + n : 41 + (n - 12));
const GN = { STUTTER: 0, BITCRUSH: 1, DATAMOSH: 2, RINGMOD: 3, MOSAIC: 4, POSTER: 5, REVERSE: 6, PITCHUP: 7, PITCHDN: 8, TAPESTOP: 9, FEEDBACK: 10, BLOCK: 11, FRAMEHOLD: 12, VROLL: 13, HSYNC: 14, GATE: 15, EDGE: 16, ZOOM: 17, TWIST: 18, CHROMA: 19, ECHO: 20, SPLIT: 21, STROBE: 22, MELT: 23 };
const BANG = (n: number) => n; // F1〜F5 = GLITCH ボタン（一発グリッチ）
const CUE = (n: number) => 13 + ((n + 9) % 10); // 数字キー：CUE n×10%
const FREEZE = 64, HOLD = 40, RELEASE = 26, RESET = 0;

// ================= 書き込み道具 =================
class Writer {
  tracks: { toy: number; name: string; notes: SeqNote[]; autos: SeqAuto[]; rec?: boolean }[] = [];
  sections: { name: string; start: number }[] = [];
  track(toy: number, name: string, rec = false): number {
    this.tracks.push({ toy, name, notes: [], autos: [], rec });
    return this.tracks.length - 1;
  }
  note(tr: number, key: number, beat: number, len = 0.25): void {
    this.tracks[tr].notes.push({ key, start: beat, len, take: 0 });
  }
  /** 16 分音符のパターン（'x' = 鳴らす、'.' = 休み）を小節の頭 beat から */
  steps(tr: number, key: number, beat: number, pattern: string, len = 0.2): void {
    [...pattern.replace(/\s/g, '')].forEach((c, i) => { if (c === 'x') this.note(tr, key, beat + i * 0.25, len); });
  }
  private rampEnds = new WeakSet<SeqAuto>();
  /** ノブ・スイッチをその位置で切り替える（前の値からなめらかには動かさない） */
  set(tr: number, param: number, beat: number, v: number): SeqAuto {
    const a = { index: param, t: beat, v, take: 0 };
    this.tracks[tr].autos.push(a);
    return a;
  }
  /** ノブを beat0 から beat1 へ、なめらかに動かす */
  ramp(tr: number, param: number, beat0: number, v0: number, beat1: number, v1: number): void {
    this.set(tr, param, beat0, v0);
    this.rampEnds.add(this.set(tr, param, beat1, v1));
  }
  /**
   * 仕上げ：シーケンサーはノブの点と点の間をなめらかにつなぐので、「切り替え」の点の直前に
   * 前の値の点を足して、そこまでは値が変わらないようにする
   */
  finish(): void {
    for (const t of this.tracks) {
      t.notes.sort((a, b) => a.start - b.start);
      t.autos.sort((a, b) => a.t - b.t);
      const add: SeqAuto[] = [];
      const last = new Map<number, SeqAuto>();
      for (const a of t.autos) {
        const prev = last.get(a.index);
        if (prev && !this.rampEnds.has(a) && prev.v !== a.v && a.t - prev.t > 0.02) add.push({ index: a.index, t: a.t - 0.01, v: prev.v, take: 0 });
        last.set(a.index, a);
      }
      t.autos.push(...add);
      t.autos.sort((a, b) => a.t - b.t);
    }
  }
  /**
   * メロディ：「音:長さ(8分音符の数)」を空白区切りで。音 'r' は休み。
   * key(音) で キー番号に変える（数字キーなら DO、PIANO モードなら PIANO）
   */
  melody(tr: number, beat: number, text: string, key: (s: string) => number, gate = 0.9): number {
    let b = beat;
    for (const tok of text.replace(/\|/g, ' ').trim().split(/\s+/)) {
      const [n, l] = tok.split(':');
      const len = Number(l ?? 1) * 0.5;
      if (n !== 'r') this.note(tr, key(n), b, len * gate);
      b += len;
    }
    return b;
  }
  section(name: string, start: number): void {
    this.sections.push({ name, start });
  }
}

// ================= 曲の素材 =================
/** Aメロのメロディ（数字キー、1 = ド）。4 小節で 1 回り。2 回目は終わりを変える */
const A_MELODY = [
  '6:2 5:1 6:1 8:2 6:2 | 6:2 5:1 4:1 3:4 | 3:2 4:1 5:1 8:2 5:2 | 7:2 5:2 r:4',
  '6:2 5:1 6:1 8:2 6:2 | 6:2 5:1 4:1 3:4 | 3:2 4:1 5:1 8:2 9:2 | 8:4 r:4',
];
/** 展開のアルペジオ（PIANO モードの文字キー）：Am F C G */
const DEV_ARP = ['A3 C4 E4 A4 E4 C4 A3 C4', 'F3 A3 C4 F4 C4 A3 F3 A3', 'C4 E4 G4 C5 G4 E4 C4 E4', 'G3 B3 D4 G4 D4 B3 G3 B3'];
/** 呼びかけ（トイPC）の単語 → 返し（TELEKEY のグリッチ） */
const CALLS: [string, number][] = [['K', GN.STUTTER], ['C', GN.REVERSE], ['R', GN.PITCHDN], ['Z', GN.BITCRUSH]];
/** サビのキャラ連打（WORD モード）：1 小節 = 8 分音符 8 個 */
const CHORUS_CHARS = ['KKCCKKCC', 'RRZZRRZZ', 'KCRZKCRZ', 'ZZZZRRRR'];
/** リズムの型（16 分 × 16） */
const BEATS = {
  a: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: '..x...x...x...x.' },
  dev: { kick: 'x.....x...x.....', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.xx' },
  chorus: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
  fill: { kick: 'x.......x.......', snare: '....x...x.x.xxxx', hat: 'x.x.x.x.........' },
  roll: { kick: 'x...............', snare: 'x.x.x.x.xxxxxxxx', hat: '................' },
};

export function demoSong(): Song {
  const w = new Writer();
  const bpb = 4;
  const B = DEMO.bars;
  // トラック：トイPC 3 本（声・メロディ・改造）、TELEKEY 3 本（ビート・楽器・映像グリッチ）
  const voice = w.track(TOY_PC, '声', true);
  const mel = w.track(TOY_PC, 'メロディ');
  const mods = w.track(TOY_PC, '改造パーツ');
  const beat = w.track(TELE, 'ビート', true);
  const inst = w.track(TELE, '楽器');
  const vid = w.track(TELE, '映像グリッチ');

  const drums = (bar0: number, bars: number, kind: keyof typeof BEATS, fillEvery = 4) => {
    for (let i = 0; i < bars; i++) {
      const b = (bar0 + i) * bpb;
      const p = fillEvery && (i + 1) % fillEvery === 0 ? BEATS.fill : BEATS[kind];
      w.steps(beat, KICK, b, p.kick);
      w.steps(beat, SNARE, b, p.snare);
      w.steps(beat, HAT, b, p.hat, 0.1);
    }
  };
  const aMelody = (bar0: number, times: number, withCalls: boolean) => {
    for (let r = 0; r < times; r++) {
      const b = (bar0 + r * 4) * bpb;
      w.melody(mel, b, A_MELODY[r % 2], (s) => DO(Number(s)));
      if (withCalls && r % 2 === 0) {
        // 4 小節目の後半：トイPC が単語を呼び、TELEKEY がグリッチで返す
        const [c, g] = CALLS[r % CALLS.length];
        w.note(voice, L(c), b + 14, 0.5);
        w.note(vid, G(g), b + 15, 0.75);
        w.note(inst, ZAP, b + 15, 0.25);
      }
    }
  };

  // ---- 最初の状態 ----
  w.set(voice, P.volume, 0, DEMO.toyVolume);
  w.set(voice, P.mode, 0, MODE.SAY);
  w.set(mods, P.lfoDepth, 0, 0);
  w.set(mods, P.dist, 0, 0);
  w.set(mods, P.base, 0, 0);
  w.set(vid, T.volume, 0, 0);
  w.set(vid, T.amount, 0, 0.35);
  w.set(vid, T.lfoDepth, 0, 0);
  w.set(vid, T.feedback, 0, 0);
  w.set(vid, T.dist, 0, 0);
  w.set(vid, T.base, 0, 0);
  w.set(vid, T.crosstalk, 0, 0);

  // ================= イントロ：トイPC の起動音と読み上げだけ =================
  let bar = 0;
  w.section('イントロ', 0);
  w.note(mods, SYS_POWER_ON, 0.5, 0.5); // 起動音「HELLO」
  ['K', 'C', 'R', 'S'].forEach((c, i) => w.note(voice, L(c), 4 + i * 4, 0.5)); // K IS FOR KING …
  w.melody(mel, 20, '1:2 3:2 5:2 3:2 | 1:2 3:2 5:2 8:2 | 5:4 r:4', (s) => DO(Number(s)));
  // TELEKEY はイントロの終わりに電源 ON（ブラウン管の「ボン」）。音量をゆっくり上げる
  w.note(vid, SYS_POWER_ON, (B.intro - 1) * bpb, 0.5);
  w.ramp(vid, T.volume, (B.intro - 1) * bpb, 0, (B.intro + 2) * bpb, DEMO.teleVolume);
  w.note(vid, CUE(1), (B.intro - 1) * bpb + 1, 0.25);
  bar += B.intro;

  // ================= Aメロ：楽器キーでビート、トイPC でメロディ =================
  w.section('Aメロ', bar * bpb);
  w.set(voice, P.mode, bar * bpb - 0.5, MODE.WORD);
  drums(bar, B.a, 'a');
  aMelody(bar, B.a / 4, true);
  for (let i = 0; i < B.a; i++) {
    const b = (bar + i) * bpb;
    // 小節の頭に小さなチャイム（C の小節は ド、G の小節は ソ）
    if (i % 4 === 2) w.note(inst, CHIRP_C, b, 0.25);
    if (i % 4 === 3) w.note(inst, BLIP_G, b, 0.25);
    // 2 小節ごと、4 拍目の裏で映像が一瞬ずれる
    if (i % 2 === 1) w.note(vid, G(GN.HSYNC), b + 3.5, 0.25);
  }
  w.note(vid, CUE(2), bar * bpb, 0.25);
  bar += B.a;

  // ================= 展開：グリッチが増える・LFO でうねる・映像が崩れ始める =================
  const dev0 = bar * bpb;
  w.section('展開', dev0);
  w.set(voice, P.mode, dev0 - 0.5, MODE.PIANO);
  drums(bar, B.dev, 'dev');
  for (let i = 0; i < B.dev; i++) {
    const b = (bar + i) * bpb;
    w.melody(mel, b, DEV_ARP[i % 4].split(' ').map((n) => `${n}:1`).join(' '), PIANO, 0.8);
    // グリッチの数が 4 小節ごとに増える
    const stage = Math.floor(i / 4); // 0〜3
    const glitchSet = [[GN.PITCHUP], [GN.MOSAIC, GN.DATAMOSH], [GN.RINGMOD, GN.VROLL, GN.CHROMA], [GN.PITCHDN, GN.BLOCK, GN.TWIST, GN.ECHO]][stage];
    const every = [4, 2, 1, 0.5][stage];
    let k = 0;
    for (let t = every === 4 ? 3 : 0; t < 4; t += every) w.note(vid, G(glitchSet[k++ % glitchSet.length]), b + t, Math.min(every, 1) * 0.6);
    // トイPC の GLITCH ボタンも増える
    if (stage >= 1) w.note(mods, GLITCH(1), b + 3, 0.5);
    if (stage >= 2) w.note(mods, GLITCH(2), b + 1, 0.5);
    if (stage >= 3) w.note(mods, GLITCH(3), b + 2, 1);
  }
  // LFO がうねりだす（トイPC・TELEKEY とも）
  w.ramp(mods, P.lfoRate, dev0, 0.3, dev0 + 64, 0.65);
  w.ramp(mods, P.lfoDepth, dev0, 0.1, dev0 + 64, 0.8);
  w.ramp(vid, T.lfoRate, dev0, 0.3, dev0 + 64, 0.6);
  w.ramp(vid, T.lfoDepth, dev0, 0, dev0 + 64, 0.7);
  w.ramp(vid, T.amount, dev0, 0.35, dev0 + 64, 0.85);
  w.ramp(vid, T.feedback, dev0 + 32, 0, dev0 + 64, 0.35);
  w.set(mods, P.base, dev0 + 32, 1);
  w.set(mods, P.base, dev0 + 48, 2);
  w.set(mods, P.stretch, dev0 + 32, 1);
  // 12 小節目：LOOP HOLD で音をつかみ、LFO でうねらせ、RELEASE で放す
  w.note(mods, LOOP_HOLD, dev0 + 44, 0.5);
  w.note(mods, LOOP_RELEASE, dev0 + 47.5, 0.25);
  // 最後の小節：映像と音をつかんで止める（FREEZE）
  w.note(vid, FREEZE, dev0 + 62, 2);
  w.note(vid, CUE(5), dev0 + 32, 0.25);
  bar += B.dev;

  // ================= サビ：全部の改造パーツで最大に壊す・キャラ連打 =================
  const ch0 = bar * bpb;
  w.section('サビ', ch0);
  w.set(voice, P.mode, ch0 - 0.25, MODE.WORD);
  w.set(mods, P.stretch, ch0, 0);
  drums(bar, B.chorus, 'chorus', 8);
  for (let i = 0; i < B.chorus; i++) {
    const b = (bar + i) * bpb;
    // キャラ連打（8 分音符）。偶数の 4 小節はメロディの頭だけ数字キーで
    const chars = CHORUS_CHARS[i % 4];
    [...chars].forEach((c, j) => w.note(voice, L(c), b + j * 0.5, 0.4));
    // トイPC の GLITCH ボタンを拍ごとに回す（1→2→3→4→5）
    w.note(mods, GLITCH((i % 5) + 1), b, 2);
    w.note(mods, GLITCH(((i + 2) % 5) + 1), b + 2, 1.5);
    // TELEKEY：8 分ごとにグリッチを入れ替える（音と映像が拍で同時に壊れる）
    const seq = [GN.STUTTER, GN.RINGMOD, GN.SPLIT, GN.STROBE, GN.ZOOM, GN.POSTER, GN.PITCHUP, GN.MELT];
    for (let j = 0; j < 8; j++) w.note(vid, G(seq[(i + j) % seq.length]), b + j * 0.5, 0.4);
    // 4 小節ごとに一発グリッチ（BASE も変える）
    if (i % 4 === 0) {
      const base = [0, 1, 2, 3][i / 4];
      w.set(vid, T.base, b - 0.1, base);
      w.note(vid, BANG(1 + (i / 4) % 5), b, 0.5);
      w.note(vid, CUE(1 + (i / 4) * 2), b, 0.25);
    }
    if (i % 2 === 1) w.note(inst, NOISE, b + 3, 0.5);
  }
  w.ramp(mods, P.dist, ch0, 0.3, ch0 + 64, 0.75);
  w.set(mods, P.distType, ch0 + 32, 1);
  w.set(mods, P.base, ch0, 3);
  w.set(mods, P.base, ch0 + 32, 4);
  w.ramp(mods, P.lfoDepth, ch0, 0.8, ch0 + 64, 1);
  w.ramp(vid, T.dist, ch0, 0.2, ch0 + 64, 0.6);
  w.set(vid, T.distType, ch0 + 32, 1);
  w.set(vid, T.crosstalk, ch0 + 32, 1);
  w.ramp(vid, T.feedback, ch0, 0.35, ch0 + 64, 0.6);
  w.set(vid, T.amount, ch0, 1);
  // 13 小節目：HOLD でグリッチをつかんだまま → 15 小節目で RELEASE
  w.note(vid, HOLD, ch0 + 48, 0.25);
  w.note(vid, RELEASE, ch0 + 56, 0.25);
  w.note(mods, LOOP_HOLD, ch0 + 60, 0.5);
  bar += B.chorus;

  // ================= ブレイク：わざとクラッシュ → 無音 → RESET → 再起動 =================
  const br0 = bar * bpb;
  w.section('ブレイク', br0);
  // 2 台同時にクラッシュ（4 拍 × 2 = 4 秒止まる）。終わりで RESET・再起動（起動音）
  w.note(mods, SYS_CRASH, br0, 8);
  w.note(vid, SYS_CRASH, br0, 8);
  // 再起動のあとは静かに：ツマミを戻す
  const calm = br0 + 8;
  w.set(mods, P.dist, calm, 0);
  w.set(mods, P.lfoDepth, calm, 0.2);
  w.set(mods, P.base, calm, 0);
  w.set(vid, T.dist, calm, 0);
  w.set(vid, T.feedback, calm, 0);
  w.set(vid, T.crosstalk, calm, 0);
  w.set(vid, T.lfoDepth, calm, 0.2);
  w.set(vid, T.amount, calm, 0.4);
  w.set(voice, P.mode, calm + 3, MODE.SAY);
  // トイPC だけが残って「H IS FOR HAT」、Aメロの頭をゆっくり
  w.note(voice, L('H'), calm + 4, 0.5);
  w.melody(mel, calm + 8, '6:4 5:2 6:2 | 8:4 6:4', (s) => DO(Number(s)));
  // 最後の小節：スネアのロールで戻ってくる
  const rollBar = bar + B.brk - 1;
  w.steps(beat, SNARE, rollBar * bpb, BEATS.roll.snare);
  w.steps(beat, KICK, rollBar * bpb, BEATS.roll.kick);
  w.ramp(vid, T.amount, rollBar * bpb, 0.4, (rollBar + 1) * bpb, 0.9);
  w.note(vid, G(GN.ZOOM), rollBar * bpb + 2, 2);
  bar += B.brk;

  // ================= ラスト：もう一度盛り上がって終わる =================
  const la0 = bar * bpb;
  w.section('ラスト', la0);
  w.set(voice, P.mode, la0 - 0.5, MODE.WORD);
  w.set(vid, T.amount, la0, 0.8);
  w.ramp(vid, T.lfoDepth, la0, 0.3, la0 + 32, 0.8);
  drums(bar, 8, 'chorus', 4);
  aMelody(bar, 2, true);
  for (let i = 0; i < 8; i++) {
    const b = (bar + i) * bpb;
    w.note(vid, G([GN.STUTTER, GN.EDGE, GN.PITCHDN, GN.FEEDBACK][i % 4]), b + 3, 0.75);
    w.note(mods, GLITCH((i % 3) + 1), b + 2, 1);
  }
  // 9〜10 小節目：サビのキャラ連打をもう一度
  const burst0 = bar + 8;
  drums(burst0, 2, 'chorus', 0);
  for (let i = 0; i < 2; i++) {
    const b = (burst0 + i) * bpb;
    [...CHORUS_CHARS[i]].forEach((c, j) => w.note(voice, L(c), b + j * 0.5, 0.4));
    for (let j = 0; j < 8; j++) w.note(vid, G([GN.STROBE, GN.SPLIT][j % 2]), b + j * 0.5, 0.4);
  }
  // 11 小節目：MELTDOWN の CHAOS で全部壊す → 12 小節目：FREEZE したまま「Z IS FOR ZAP」→ 電源 OFF
  const end0 = (bar + 10) * bpb;
  w.set(vid, T.base, end0 - 0.1, 4);
  w.note(vid, BANG(5), end0, 0.5);
  w.note(mods, GLITCH(5), end0, 3);
  w.steps(beat, KICK, end0, 'x...x...x...x...');
  w.set(voice, P.mode, end0 + 3.5, MODE.SAY);
  w.note(voice, L('Z'), end0 + 4, 0.5);
  w.note(vid, FREEZE, end0 + 4, 3);
  w.note(mods, SYS_POWER_OFF, end0 + 7, 0.5);
  w.note(vid, SYS_POWER_OFF, end0 + 7.5, 0.5);
  bar += B.last;

  // ---- まとめ ----
  w.finish();
  const tracks = w.tracks.map((t) => ({ ...t, mute: false }));
  void RESET;
  void BEEP_C;
  return {
    version: 1,
    title: DEMO.title,
    bpm: DEMO.bpm,
    bars: bar,
    metronome: false,
    seed: DEMO.seed,
    ramp: true,
    loop: { on: false, start: 0, end: 16 },
    sections: w.sections,
    tracks,
  };
}
