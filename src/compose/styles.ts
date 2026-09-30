// スタイルごとの作曲ルールの表。「このスタイルはもっと〇〇」と言われたら、まずここの数字を変える。
//
// 1 つのスタイル = 曲の「レシピ」：
//   構成（sections）・テンポ・音階（scale）・コード進行（progs）・ドラムの型（drums）・ハネ（swing）・
//   ベースの弾き方（bass）・伴奏の弾き方（comp）・メロディの細かさと飾り（notesPerBar・ornament）・
//   グリッチの多さ（glitch）・クラッシュの入れやすさ（crashAt）・トイPC の使い方（blippy）・PIKOTONE の内蔵リズム（pikoRhythm）
//
// sections の要素：name = 表示名、kind = 中身の作り方、w = 長さの重み、energy = 盛り上がり 0〜1、
//                  chaos = 壊れ度の倍率、need = 短い曲でも残す優先度（大きいほど残る）

export type SectionKind = 'intro' | 'verse' | 'build' | 'chorus' | 'break' | 'outro' | 'drift' | 'swell' | 'noise' | 'collapse';

export interface SectionTpl {
  name: string;
  kind: SectionKind;
  w: number;
  energy: number;
  chaos: number;
  need: number;
}

/** 音階（白鍵の中で使う音。C = 0 … B = 6 の段で持つ） */
export type ScaleId = 'major' | 'minor' | 'yonaMajor' | 'yonaMinor' | 'minorPenta' | 'dorian';
export const SCALES: Record<ScaleId, { name: string; degs: number[] }> = {
  major: { name: '長音階', degs: [0, 1, 2, 3, 4, 5, 6] },
  minor: { name: '短音階（ラが主音）', degs: [0, 1, 2, 3, 4, 5, 6] },
  dorian: { name: 'ドリア（レが主音）', degs: [0, 1, 2, 3, 4, 5, 6] },
  yonaMajor: { name: 'ヨナ抜き長音階（ド レ ミ ソ ラ）', degs: [0, 1, 2, 4, 5] },
  yonaMinor: { name: 'ヨナ抜き短音階（ラ シ ド ミ ファ）', degs: [5, 6, 0, 2, 3] },
  minorPenta: { name: 'マイナーペンタ（ラ ド レ ミ ソ）', degs: [5, 0, 1, 2, 4] },
};

export type DrumKit = 'none' | 'sparse' | 'plain' | 'beat' | 'noise' | 'house' | 'techno' | 'dnb' | 'jungle' | 'reggae' | 'dub' | 'ska' | 'hiphop'
  | 'trap' | 'lofi' | 'funk' | 'bossa' | 'jazz' | 'march' | 'punk' | 'chip' | 'enka' | 'ondo' | 'gabber' | 'idm' | 'breakcore';
export type BassType = 'root' | 'offbeat' | 'reese' | 'walking' | 'octave' | 'syncop' | 'pedal' | 'none';
export type CompType = 'pad' | 'offbeat' | 'stab' | 'arp' | 'strum' | 'block' | 'none';
/** トイPC の中身の作り方（toys/blippy.ts） */
export type Texture = 'say' | 'callmel' | 'spell' | 'drum' | 'chars' | 'sfx' | 'quiz' | 'long';

export interface StyleDef {
  id: string;
  name: string;
  /** パネルのグループ */
  group: 'おもちゃ' | 'ポップ' | 'ダンス' | 'ワールド' | '和' | '実験';
  /** ひとこと（パネル・攻略本に出す） */
  desc: string;
  bpm: number;
  bpmRange: [number, number];
  sections: SectionTpl[];
  /** コードの長さ（小節） */
  chordBars: number;
  scale: ScaleId;
  /** コード進行の候補（ハ長調の度数 0 = C … 5 = Am）。どれを使うかはシードで決まる */
  progs: number[][];
  /** 7 の和音（ジャズ・ボサノバなど） */
  sevenths?: boolean;
  drums: DrumKit;
  /** ハネ：[量 0〜0.34, 単位（拍）0.5 = 8 分・0.25 = 16 分] */
  swing?: [number, number];
  bass: BassType;
  comp: CompType;
  /** メロディの細かさ：1 小節に入る音の数のめやす */
  notesPerBar: number;
  /** メロディの飾り：kobushi = 長い音の前に小さく揺らす（演歌のこぶし） */
  ornament?: 'kobushi';
  /** グリッチの多さ（壊れ度に掛ける） */
  glitch: number;
  /** クラッシュを入れる壊れ度のしきい値（これ以上ならブレイクでクラッシュ）。0 = 必ず、1 を超えると入れない */
  crashAt: number;
  /** ブレイクで音数を減らす度合い */
  sparseBreak: number;
  /** トイPC の中身（セクションの種類ごと。無ければ default） */
  blippy: Partial<Record<SectionKind, Texture>> & { default: Texture };
  /** PIKOTONE の内蔵リズム（0 MARCH 1 RHUMBA 2 DISCO 3 POP 4 BALLAD 5 WALTZ 6 TANGO 7 SWING）。-1 = 内蔵リズムを使わずパッドで刻む */
  pikoRhythm: number;
}

const S = (name: string, kind: SectionKind, w: number, energy: number, chaos: number, need: number): SectionTpl => ({ name, kind, w, energy, chaos, need });

// ---- 構成のひな形 ----
const SONG = [S('イントロ', 'intro', 4, 0.25, 0.3, 3), S('Aメロ', 'verse', 8, 0.45, 0.4, 5), S('Bメロ', 'build', 4, 0.6, 0.6, 1), S('サビ', 'chorus', 8, 0.85, 0.8, 4), S('間奏', 'break', 4, 0.4, 1, 1), S('サビ', 'chorus', 8, 0.95, 1, 2), S('エンド', 'outro', 4, 0.35, 0.4, 1)];
const DANCE = [S('イントロ', 'intro', 8, 0.35, 0.3, 3), S('ビルド', 'build', 8, 0.6, 0.6, 2), S('ドロップ', 'chorus', 16, 1, 1, 5), S('ブレイク', 'break', 8, 0.3, 1.1, 1), S('ドロップ2', 'chorus', 16, 1, 1.2, 2), S('アウトロ', 'outro', 8, 0.4, 0.5, 1)];
const JAM = [S('イントロ', 'intro', 4, 0.3, 0.3, 3), S('テーマ', 'verse', 8, 0.55, 0.4, 5), S('ソロ', 'build', 8, 0.8, 0.8, 2), S('テーマ', 'chorus', 8, 0.7, 0.6, 4), S('エンド', 'outro', 4, 0.35, 0.4, 1)];
const HIPHOP = [S('イントロ', 'intro', 4, 0.3, 0.3, 3), S('ヴァース', 'verse', 8, 0.55, 0.4, 5), S('フック', 'chorus', 8, 0.8, 0.7, 4), S('ヴァース2', 'verse', 8, 0.6, 0.6, 1), S('フック', 'chorus', 8, 0.9, 0.9, 2), S('アウトロ', 'outro', 4, 0.3, 0.4, 1)];
const EXPERIMENT = [S('はじまり', 'intro', 4, 0.35, 0.6, 3), S('変形 1', 'noise', 8, 0.65, 1, 5), S('変形 2', 'build', 8, 0.8, 1.2, 2), S('崩れ', 'break', 4, 0.4, 1.5, 1), S('再構成', 'chorus', 8, 1, 1.3, 4), S('おわり', 'outro', 4, 0.4, 0.8, 1)];
const SLOW = [S('前奏', 'intro', 4, 0.2, 0.2, 3), S('一番', 'verse', 8, 0.4, 0.3, 5), S('サビ', 'chorus', 8, 0.7, 0.5, 4), S('間奏', 'break', 4, 0.35, 0.6, 1), S('二番のサビ', 'chorus', 8, 0.8, 0.6, 2), S('後奏', 'outro', 4, 0.3, 0.3, 1)];

// ---- トイPC の使い方のひな形 ----
const BL_SONG: StyleDef['blippy'] = { intro: 'say', verse: 'callmel', build: 'spell', chorus: 'chars', break: 'say', outro: 'say', default: 'callmel' };
const BL_DANCE: StyleDef['blippy'] = { intro: 'drum', build: 'drum', chorus: 'chars', break: 'long', outro: 'spell', default: 'drum' };
const BL_GROOVE: StyleDef['blippy'] = { intro: 'say', verse: 'drum', chorus: 'callmel', build: 'spell', break: 'say', outro: 'say', default: 'drum' };

const POP_PROGS = [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4], [0, 3, 0, 4]];
const MINOR_PROGS = [[5, 3, 4, 5], [5, 1, 4, 0], [5, 3, 0, 4], [5, 4, 3, 4]];

export const STYLES: Record<string, StyleDef> = {
  // ================= おもちゃ（最初からの 5 つ） =================
  plain: {
    id: 'plain', name: '素朴', group: 'おもちゃ', desc: 'おもちゃのまま。ゆったり読み上げて、やさしく歌う',
    bpm: 108, bpmRange: [84, 132], chordBars: 1, scale: 'major', progs: POP_PROGS, drums: 'plain', bass: 'root', comp: 'pad', notesPerBar: 4,
    glitch: 0.35, crashAt: 1.1, sparseBreak: 0.5, pikoRhythm: 3,
    sections: [S('イントロ', 'intro', 4, 0.2, 0.2, 3), S('Aメロ', 'verse', 8, 0.4, 0.3, 5), S('Aメロ2', 'verse', 8, 0.45, 0.4, 1), S('サビ', 'chorus', 8, 0.65, 0.5, 4), S('ラスト', 'outro', 4, 0.3, 0.3, 2)],
    blippy: { intro: 'say', verse: 'callmel', chorus: 'spell', outro: 'say', default: 'callmel' },
  },
  beat: {
    id: 'beat', name: 'ビート', group: 'おもちゃ', desc: 'ドラムで刻んで、サビはキャラ連打',
    bpm: 124, bpmRange: [100, 150], chordBars: 1, scale: 'major', progs: POP_PROGS, drums: 'beat', bass: 'root', comp: 'stab', notesPerBar: 6,
    glitch: 0.8, crashAt: 0.55, sparseBreak: 0.8, pikoRhythm: 2,
    sections: [S('イントロ', 'intro', 4, 0.3, 0.3, 3), S('Aメロ', 'verse', 8, 0.5, 0.4, 5), S('展開', 'build', 8, 0.7, 0.8, 2), S('サビ', 'chorus', 8, 0.95, 1, 4), S('ブレイク', 'break', 4, 0.3, 1.2, 1), S('ラスト', 'chorus', 8, 1, 1.1, 2), S('エンド', 'outro', 2, 0.4, 0.5, 1)],
    blippy: { intro: 'drum', verse: 'drum', build: 'drum', chorus: 'chars', break: 'say', outro: 'spell', default: 'drum' },
  },
  ambient: {
    id: 'ambient', name: 'アンビエント', group: 'おもちゃ', desc: '長い音がただよい、ゆっくりうねる',
    bpm: 80, bpmRange: [60, 100], chordBars: 2, scale: 'major', progs: [[0, 3, 5, 4], [3, 0, 3, 4], [5, 3, 0, 0]], drums: 'sparse', bass: 'root', comp: 'pad', notesPerBar: 1.5,
    glitch: 0.3, crashAt: 1.1, sparseBreak: 0.4, pikoRhythm: 4,
    sections: [S('はじまり', 'intro', 6, 0.15, 0.2, 3), S('ただよう', 'drift', 12, 0.3, 0.4, 5), S('ふくらむ', 'swell', 8, 0.55, 0.6, 3), S('ただよう2', 'drift', 8, 0.3, 0.5, 1), S('おわり', 'outro', 6, 0.15, 0.3, 2)],
    blippy: { intro: 'say', drift: 'long', swell: 'long', outro: 'say', default: 'long' },
  },
  noise: {
    id: 'noise', name: 'ノイズ', group: 'おもちゃ', desc: '効果音とグリッチの嵐',
    bpm: 132, bpmRange: [100, 170], chordBars: 1, scale: 'minor', progs: MINOR_PROGS, drums: 'noise', bass: 'syncop', comp: 'stab', notesPerBar: 8,
    glitch: 1.3, crashAt: 0.35, sparseBreak: 0.7, pikoRhythm: -1,
    sections: [S('イントロ', 'intro', 2, 0.4, 0.6, 3), S('ノイズ', 'noise', 8, 0.7, 1, 5), S('サビ', 'chorus', 8, 1, 1.2, 4), S('ブレイク', 'break', 4, 0.3, 1.4, 2), S('ノイズ2', 'noise', 8, 0.9, 1.3, 1), S('エンド', 'outro', 2, 0.5, 1, 1)],
    blippy: { intro: 'sfx', noise: 'sfx', chorus: 'chars', break: 'quiz', outro: 'sfx', default: 'sfx' },
  },
  collapse: {
    id: 'collapse', name: '崩壊', group: 'おもちゃ', desc: 'だんだん壊れて、最後は必ずクラッシュ',
    bpm: 116, bpmRange: [90, 140], chordBars: 1, scale: 'minor', progs: MINOR_PROGS, drums: 'beat', bass: 'root', comp: 'stab', notesPerBar: 5,
    glitch: 1, crashAt: 0, sparseBreak: 0.6, pikoRhythm: 3,
    sections: [S('イントロ', 'intro', 4, 0.3, 0.3, 3), S('Aメロ', 'verse', 8, 0.5, 0.6, 4), S('展開', 'build', 8, 0.75, 1, 2), S('サビ', 'chorus', 8, 0.95, 1.3, 3), S('崩壊', 'collapse', 6, 0.6, 1.6, 5)],
    blippy: { intro: 'say', verse: 'callmel', build: 'drum', chorus: 'chars', collapse: 'quiz', default: 'callmel' },
  },

  // ================= ポップ =================
  douyou: {
    id: 'douyou', name: '童謡', group: 'ポップ', desc: 'ヨナ抜き長音階で、ゆっくり歌う子どもの歌',
    bpm: 96, bpmRange: [80, 112], chordBars: 1, scale: 'yonaMajor', progs: [[0, 3, 4, 0], [0, 0, 4, 0], [0, 3, 0, 4]], drums: 'none', bass: 'root', comp: 'block', notesPerBar: 3,
    glitch: 0.2, crashAt: 1.1, sparseBreak: 0.5, pikoRhythm: 4, sections: SLOW,
    blippy: { intro: 'say', verse: 'callmel', chorus: 'spell', break: 'say', outro: 'say', default: 'callmel' },
  },
  march: {
    id: 'march', name: 'マーチ', group: 'ポップ', desc: '運動会の行進。ドンチャン元気よく',
    bpm: 116, bpmRange: [100, 128], chordBars: 1, scale: 'major', progs: [[0, 4, 0, 4], [0, 3, 4, 0], [0, 0, 3, 4]], drums: 'march', bass: 'root', comp: 'block', notesPerBar: 4,
    glitch: 0.4, crashAt: 1.1, sparseBreak: 0.5, pikoRhythm: 0, sections: SONG, blippy: BL_SONG,
  },
  chip: {
    id: 'chip', name: 'チップチューン', group: 'ポップ', desc: '昔のゲーム機ふう。速いアルペジオと四角い音',
    bpm: 150, bpmRange: [128, 172], chordBars: 1, scale: 'major', progs: [[0, 5, 3, 4], [0, 4, 5, 2], [5, 3, 0, 4]], drums: 'chip', bass: 'octave', comp: 'arp', notesPerBar: 7,
    glitch: 0.6, crashAt: 0.8, sparseBreak: 0.6, pikoRhythm: 2, sections: SONG, blippy: { ...BL_SONG, verse: 'drum', chorus: 'chars' },
  },
  punk: {
    id: 'punk', name: 'パンク', group: 'ポップ', desc: '速い！ うるさい！ 全部 8 分で押し切る',
    bpm: 184, bpmRange: [160, 210], chordBars: 1, scale: 'major', progs: [[0, 3, 4, 4], [0, 4, 5, 3], [0, 3, 0, 4]], drums: 'punk', bass: 'octave', comp: 'block', notesPerBar: 6,
    glitch: 0.9, crashAt: 0.5, sparseBreak: 0.7, pikoRhythm: 3, sections: SONG, blippy: { ...BL_SONG, chorus: 'chars', verse: 'chars' },
  },
  lofi: {
    id: 'lofi', name: 'ローファイ', group: 'ポップ', desc: 'ハネたゆるいビートと、くすんだ 7 の和音',
    bpm: 80, bpmRange: [68, 92], chordBars: 1, scale: 'major', progs: [[1, 4, 0, 5], [3, 2, 1, 0], [3, 4, 2, 5]], sevenths: true, drums: 'lofi', swing: [0.2, 0.25], bass: 'syncop', comp: 'pad', notesPerBar: 3,
    glitch: 0.4, crashAt: 1.1, sparseBreak: 0.5, pikoRhythm: 3, sections: HIPHOP, blippy: { ...BL_GROOVE, chorus: 'long' },
  },

  // ================= ダンス =================
  house: {
    id: 'house', name: 'ハウス', group: 'ダンス', desc: '4 つ打ちに裏のハイハット、跳ねるコード',
    bpm: 124, bpmRange: [118, 130], chordBars: 2, scale: 'minor', progs: [[5, 3, 0, 4], [1, 4, 0, 0], [5, 5, 3, 4]], sevenths: true, drums: 'house', bass: 'octave', comp: 'stab', notesPerBar: 4,
    glitch: 0.6, crashAt: 0.8, sparseBreak: 0.8, pikoRhythm: 2, sections: DANCE, blippy: BL_DANCE,
  },
  techno: {
    id: 'techno', name: 'テクノ', group: 'ダンス', desc: '4 つ打ちと 16 分のハット。同じ音をじわじわ変える',
    bpm: 132, bpmRange: [124, 142], chordBars: 4, scale: 'minor', progs: [[5, 5, 5, 5], [5, 3, 5, 3]], drums: 'techno', bass: 'pedal', comp: 'stab', notesPerBar: 2,
    glitch: 0.9, crashAt: 0.7, sparseBreak: 0.9, pikoRhythm: 2, sections: DANCE, blippy: { ...BL_DANCE, chorus: 'drum' },
  },
  dnb: {
    id: 'dnb', name: 'ドラムンベース', group: 'ダンス', desc: '174 BPM の速いブレイクビーツに、太く長いベース',
    bpm: 174, bpmRange: [160, 180], chordBars: 2, scale: 'minor', progs: [[5, 5, 3, 3], [5, 3, 4, 2], [5, 1, 3, 4]], drums: 'dnb', bass: 'reese', comp: 'pad', notesPerBar: 3,
    glitch: 0.8, crashAt: 0.6, sparseBreak: 0.9, pikoRhythm: -1, sections: DANCE, blippy: BL_DANCE,
  },
  jungle: {
    id: 'jungle', name: 'ジャングル', group: 'ダンス', desc: '細かく刻んだブレイクと、うなるベース',
    bpm: 166, bpmRange: [155, 175], chordBars: 2, scale: 'minorPenta', progs: [[5, 5, 1, 1], [5, 3, 5, 4]], drums: 'jungle', bass: 'reese', comp: 'none', notesPerBar: 4,
    glitch: 1, crashAt: 0.5, sparseBreak: 0.8, pikoRhythm: -1, sections: DANCE, blippy: { ...BL_DANCE, chorus: 'drum', build: 'chars' },
  },
  trap: {
    id: 'trap', name: 'トラップ', group: 'ダンス', desc: 'ゆったり重いキックに、細かく転がるハイハット',
    bpm: 140, bpmRange: [130, 150], chordBars: 2, scale: 'minor', progs: [[5, 3, 4, 3], [5, 5, 3, 4]], drums: 'trap', bass: 'reese', comp: 'pad', notesPerBar: 3,
    glitch: 0.7, crashAt: 0.7, sparseBreak: 0.8, pikoRhythm: -1, sections: HIPHOP, blippy: BL_DANCE,
  },
  gabber: {
    id: 'gabber', name: 'ガバ', group: 'ダンス', desc: '歪んだキックの 4 つ打ちを全速力で',
    bpm: 185, bpmRange: [170, 200], chordBars: 2, scale: 'minor', progs: [[5, 5, 3, 4], [5, 5, 5, 4]], drums: 'gabber', bass: 'pedal', comp: 'stab', notesPerBar: 4,
    glitch: 1.1, crashAt: 0.45, sparseBreak: 0.9, pikoRhythm: 2, sections: DANCE, blippy: { ...BL_DANCE, chorus: 'chars' },
  },

  // ================= ワールド =================
  reggae: {
    id: 'reggae', name: 'レゲエ', group: 'ワールド', desc: '3 拍目のワンドロップと、裏打ちのギター（スカンク）',
    bpm: 76, bpmRange: [66, 90], chordBars: 1, scale: 'major', progs: [[0, 3, 0, 3], [0, 4, 3, 4], [5, 4, 5, 4]], drums: 'reggae', swing: [0.12, 0.25], bass: 'offbeat', comp: 'offbeat', notesPerBar: 3,
    glitch: 0.4, crashAt: 1.1, sparseBreak: 0.6, pikoRhythm: -1, sections: JAM, blippy: BL_GROOVE,
  },
  dub: {
    id: 'dub', name: 'ダブ', group: 'ワールド', desc: 'レゲエを抜き差しして、こだまを深く',
    bpm: 72, bpmRange: [62, 84], chordBars: 2, scale: 'minor', progs: [[5, 4, 5, 4], [5, 1, 5, 1]], drums: 'dub', bass: 'offbeat', comp: 'offbeat', notesPerBar: 1.5,
    glitch: 0.6, crashAt: 1.1, sparseBreak: 0.9, pikoRhythm: -1, sections: JAM, blippy: { ...BL_GROOVE, chorus: 'long', build: 'long' },
  },
  ska: {
    id: 'ska', name: 'スカ', group: 'ワールド', desc: '速い裏打ちで、みんなで跳ねる',
    bpm: 164, bpmRange: [148, 180], chordBars: 1, scale: 'major', progs: [[0, 3, 4, 0], [0, 5, 3, 4]], drums: 'ska', bass: 'walking', comp: 'offbeat', notesPerBar: 5,
    glitch: 0.5, crashAt: 0.9, sparseBreak: 0.6, pikoRhythm: 0, sections: SONG, blippy: BL_SONG,
  },
  bossa: {
    id: 'bossa', name: 'ボサノバ', group: 'ワールド', desc: 'ささやくようなリズムと、7 の和音のギター',
    bpm: 128, bpmRange: [112, 144], chordBars: 2, scale: 'major', progs: [[0, 1, 4, 0], [1, 4, 0, 5], [3, 4, 2, 5]], sevenths: true, drums: 'bossa', bass: 'offbeat', comp: 'strum', notesPerBar: 3,
    glitch: 0.3, crashAt: 1.1, sparseBreak: 0.5, pikoRhythm: 1, sections: JAM, blippy: { ...BL_GROOVE, verse: 'callmel', chorus: 'spell' },
  },
  funk: {
    id: 'funk', name: 'ファンク', group: 'ワールド', desc: 'ドリアのワンコードで、ゴーストノートがはねる',
    bpm: 104, bpmRange: [92, 118], chordBars: 2, scale: 'dorian', progs: [[1, 1, 1, 4], [1, 4, 1, 4]], sevenths: true, drums: 'funk', swing: [0.08, 0.25], bass: 'syncop', comp: 'stab', notesPerBar: 5,
    glitch: 0.5, crashAt: 0.9, sparseBreak: 0.7, pikoRhythm: 2, sections: JAM, blippy: { ...BL_GROOVE, chorus: 'chars' },
  },
  jazz: {
    id: 'jazz', name: 'ジャズ', group: 'ワールド', desc: 'スウィングのハネと、歩くベース（ウォーキング）',
    bpm: 150, bpmRange: [120, 200], chordBars: 1, scale: 'major', progs: [[1, 4, 0, 0], [1, 4, 0, 5], [2, 5, 1, 4]], sevenths: true, drums: 'jazz', swing: [0.3, 0.5], bass: 'walking', comp: 'stab', notesPerBar: 5,
    glitch: 0.4, crashAt: 1.1, sparseBreak: 0.6, pikoRhythm: 7, sections: JAM, blippy: { ...BL_GROOVE, verse: 'callmel', build: 'spell', chorus: 'callmel' },
  },

  // ================= 和 =================
  enka: {
    id: 'enka', name: '演歌', group: '和', desc: 'ヨナ抜き短音階でゆったり。長い音にこぶしを回す',
    bpm: 72, bpmRange: [60, 84], chordBars: 1, scale: 'yonaMinor', progs: [[5, 1, 5, 2], [5, 3, 4, 5], [5, 5, 1, 2]], drums: 'enka', bass: 'root', comp: 'pad', notesPerBar: 2.5, ornament: 'kobushi',
    glitch: 0.3, crashAt: 1.1, sparseBreak: 0.5, pikoRhythm: 4, sections: SLOW,
    blippy: { intro: 'say', verse: 'long', chorus: 'long', break: 'say', outro: 'long', default: 'long' },
  },
  ondo: {
    id: 'ondo', name: '音頭', group: '和', desc: 'ヨナ抜き長音階と太鼓のリズム。盆踊りでぐるぐる回る',
    bpm: 120, bpmRange: [104, 132], chordBars: 1, scale: 'yonaMajor', progs: [[0, 0, 4, 0], [0, 5, 4, 0], [5, 5, 0, 0]], drums: 'ondo', swing: [0.18, 0.5], bass: 'root', comp: 'block', notesPerBar: 4,
    glitch: 0.4, crashAt: 1.1, sparseBreak: 0.5, pikoRhythm: 0, sections: SONG, blippy: { ...BL_SONG, chorus: 'callmel' },
  },

  // ================= 実験 =================
  idm: {
    id: 'idm', name: 'IDM', group: '実験', desc: '毎回違う割り算のリズム。こまかく、ずれて、組み直す',
    bpm: 120, bpmRange: [90, 160], chordBars: 2, scale: 'minor', progs: [[5, 2, 3, 1], [3, 6, 5, 2], [5, 1, 6, 3]], drums: 'idm', bass: 'syncop', comp: 'arp', notesPerBar: 6,
    glitch: 1.1, crashAt: 0.6, sparseBreak: 0.9, pikoRhythm: -1, sections: EXPERIMENT,
    blippy: { intro: 'spell', noise: 'sfx', build: 'drum', break: 'long', chorus: 'chars', outro: 'spell', default: 'drum' },
  },
  breakcore: {
    id: 'breakcore', name: 'ブレイクコア', group: '実験', desc: '刻んだブレイクをばらばらに並べ替えて、全部壊す',
    bpm: 190, bpmRange: [170, 220], chordBars: 2, scale: 'minorPenta', progs: [[5, 5, 3, 4], [5, 1, 5, 1]], drums: 'breakcore', bass: 'reese', comp: 'none', notesPerBar: 8,
    glitch: 1.4, crashAt: 0.3, sparseBreak: 0.9, pikoRhythm: -1, sections: EXPERIMENT,
    blippy: { intro: 'drum', noise: 'chars', build: 'drum', break: 'quiz', chorus: 'chars', outro: 'sfx', default: 'drum' },
  },
};

export const STYLE_IDS = Object.keys(STYLES);
export const STYLE_GROUPS = ['おもちゃ', 'ポップ', 'ダンス', 'ワールド', '和', '実験'] as const;
export const LENGTHS = [30, 60, 120, 180];
/** 知らないスタイル名が来たら「ビート」 */
export const styleOf = (id: string): StyleDef => STYLES[id] ?? STYLES.beat;
