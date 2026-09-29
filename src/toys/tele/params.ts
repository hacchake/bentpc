// 6台目 TELEKEY TK-6（ブラウン管モニター付きの魔改造キーボード：映像＋音のグリッチ・マシン）の
// パラメーターとキー割り当て。映像（WebGL・画面側）と音（Worklet）の両方がこの表を見る。

import type { ParamDef } from '../../core/params';

export const LFO_TARGETS = ['VIDEO', 'AUDIO', 'BOTH'] as const;

export const TELE_PARAMS = [
  { id: 'volume', name: 'MASTER VOL', kind: 'continuous', min: 0, max: 1, default: 0.75, midiCC: 7 },
  { id: 'amount', name: 'GLITCH AMT', kind: 'continuous', min: 0, max: 1, default: 0.6, midiCC: 20 },
  { id: 'lfoRate', name: 'LFO RATE', kind: 'continuous', min: 0, max: 1, default: 0.3, midiCC: 21 },
  { id: 'lfoDepth', name: 'LFO DEPTH', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 22 },
  { id: 'feedback', name: 'FEEDBACK', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 23 },
  { id: 'dist', name: 'DIST', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 24 },
  { id: 'speed', name: 'SPEED / PITCH', kind: 'continuous', min: 0, max: 1, default: 0.5, midiCC: 25 },
  { id: 'mix', name: 'DRY / WET', kind: 'continuous', min: 0, max: 1, default: 1, midiCC: 26 },
  { id: 'distType', name: 'DIST TYPE', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 85, labels: ['CLIP', 'CRUSH'] },
  { id: 'lfoTarget', name: 'LFO TARGET', kind: 'stepped', min: 0, max: 2, default: 2, midiCC: 86, labels: [...LFO_TARGETS] },
  { id: 'crosstalk', name: 'CROSSTALK', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 87 },
  { id: 'base', name: 'BASE', kind: 'stepped', min: 0, max: 4, default: 0, midiCC: 88, labels: ['1', '2', '3', '4', '5'] },
  { id: 'glitch1', name: 'GLITCH 1', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 102 },
  { id: 'glitch2', name: 'GLITCH 2', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 103 },
  { id: 'glitch3', name: 'GLITCH 3', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 104 },
  { id: 'glitch4', name: 'GLITCH 4', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 105 },
  { id: 'glitch5', name: 'GLITCH 5', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 106 },
  { id: 'hold', name: 'HOLD', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 107 },
  { id: 'release', name: 'RELEASE', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 108 },
] as const satisfies readonly ParamDef[];

export type TeleParamId = (typeof TELE_PARAMS)[number]['id'];
export const TELE_INDEX = Object.fromEntries(TELE_PARAMS.map((p, i) => [p.id, i])) as Record<TeleParamId, number>;

// ---- キーの役目 ----
/** 押している間だけ効くグリッチ（映像と音がセットで壊れる）。文字キー 24 個に 1 つずつ */
export const GLITCHES = [
  { v: 'RGB SHIFT', a: 'STUTTER' },
  { v: 'SCAN SHIFT', a: 'BITCRUSH' },
  { v: 'DATAMOSH', a: 'SMEAR' },
  { v: 'PIXEL SORT', a: 'RING MOD' },
  { v: 'MOSAIC', a: 'DOWNSAMPLE' },
  { v: 'POSTERIZE', a: 'QUANTIZE' },
  { v: 'INVERT', a: 'REVERSE' },
  { v: 'MIRROR', a: 'PITCH UP' },
  { v: 'KALEIDO', a: 'PITCH DOWN' },
  { v: 'SLIT SCAN', a: 'TAPE STOP' },
  { v: 'FEEDBACK', a: 'DELAY RUN' },
  { v: 'BLOCK NOISE', a: 'NOISE' },
  { v: 'FRAME HOLD', a: 'GRAIN HOLD' },
  { v: 'V-ROLL', a: 'WOBBLE' },
  { v: 'H-SYNC', a: 'FILTER LOW' },
  { v: 'THRESHOLD', a: 'GATE' },
  { v: 'EDGE', a: 'FILTER HIGH' },
  { v: 'ZOOM', a: 'COMB' },
  { v: 'TWIST', a: 'FLANGE' },
  { v: 'CHROMA BLEED', a: 'DRIVE' },
  { v: 'ECHO TRAIL', a: 'ECHO' },
  { v: 'SPLIT', a: 'PAN FLIP' },
  { v: 'STROBE', a: 'CHOP' },
  { v: 'MELT', a: 'SMEAR DOWN' },
] as const;

export const INSTRUMENTS = ['BEEP', 'BEEP', 'NOISE', 'KICK', 'SNARE', 'HAT', 'DRONE', 'ZAP', 'BLIP', 'BUZZ', 'CHIRP'] as const;

export type Role =
  | { r: 'glitch'; n: number } // GLITCHES[n]
  | { r: 'inst'; n: number; note: number } // 音を足す楽器キー
  | { r: 'cue'; n: number } // 数字キー：動画の n×10% へ
  | { r: 'fn'; f: TeleFn }
  | { r: 'bang'; n: number } // F1〜F5：GLITCH ボタン
  | { r: 'base'; n: number } // F6〜F10：BASE
  | { r: 'none' };

export type TeleFn =
  | 'freeze' | 'hold' | 'release' | 'reset' | 'powerOn' | 'powerOff' | 'seekBack' | 'seekFwd' | 'speedUp' | 'speedDown'
  | 'speedReset' | 'slower' | 'faster' | 'crosstalk' | 'lfoTarget' | 'distType' | 'playPause';

export interface KeyDef { code: string; label: string; w: number; role: Role; fnLabel?: string }

const g = (code: string, label: string, n: number): KeyDef => ({ code, label, w: 1, role: { r: 'glitch', n }, fnLabel: GLITCHES[n].v });
const inst = (code: string, label: string, n: number, note: number): KeyDef => ({ code, label, w: 1, role: { r: 'inst', n, note }, fnLabel: INSTRUMENTS[n] });
const fn = (code: string, label: string, f: TeleFn, fnLabel: string, w = 1): KeyDef => ({ code, label, w, role: { r: 'fn', f }, fnLabel });
const gap = (w: number): KeyDef => ({ code: '', label: '', w, role: { r: 'none' } });
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

/** キーボードの並び（日本語 109 キー）。UI の描画とキー番号の両方がこれを使う */
export const TELE_LAYOUT: KeyDef[][] = [
  [
    fn('Escape', 'Esc', 'reset', 'RESET'), gap(0.6),
    ...[1, 2, 3, 4, 5].map((i): KeyDef => ({ code: `F${i}`, label: `F${i}`, w: 1, role: { r: 'bang', n: i - 1 }, fnLabel: `GLITCH ${i}` })), gap(0.4),
    ...[1, 2, 3, 4, 5].map((i): KeyDef => ({ code: `F${i + 5}`, label: `F${i + 5}`, w: 1, role: { r: 'base', n: i - 1 }, fnLabel: `BASE ${i}` })), gap(0.4),
    fn('F11', 'F11', 'lfoTarget', 'LFO →'), fn('F12', 'F12', 'crosstalk', 'CROSSTALK'),
  ],
  [
    { code: 'Backquote', label: '半/全', w: 1, role: { r: 'none' }, fnLabel: '(IME)' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((c, i): KeyDef => ({ code: `Digit${c}`, label: c, w: 1, role: { r: 'cue', n: (i + 1) % 10 }, fnLabel: `CUE ${((i + 1) % 10) * 10}%` })),
    fn('Minus', '-', 'slower', 'SLOWER'), fn('Equal', '^', 'faster', 'FASTER'), fn('IntlYen', '¥', 'speedReset', 'SPEED 1x'),
    fn('Backspace', 'BS', 'release', 'RELEASE'),
  ],
  [
    fn('Tab', 'Tab', 'distType', 'DIST TYPE', 1.5),
    ...'QWERTYUIOP'.split('').map((c, i) => g(`Key${c}`, c, i)),
    g('BracketLeft', '@', 10), g('BracketRight', '[', 11),
    fn('Enter', 'Enter', 'hold', 'HOLD', 1.5),
  ],
  [
    gap(1.75),
    ...'ASDFGHJKL'.split('').map((c, i) => g(`Key${c}`, c, 12 + i)),
    g('Semicolon', ';', 21), g('Quote', ':', 22), g('Backslash', ']', 23),
    gap(1.25),
  ],
  [
    gap(2.25),
    ...'ZXCVBNM'.split('').map((c, i) => inst(`Key${c}`, c, i, PENTA[i])),
    inst('Comma', ',', 7, PENTA[7]), inst('Period', '.', 8, PENTA[8]), inst('Slash', '/', 9, PENTA[9]), inst('IntlRo', '\\', 10, PENTA[10]),
    gap(1.75),
  ],
  [
    gap(4.5),
    fn('Space', 'Space', 'freeze', 'FREEZE', 6.5),
  ],
];

export const TELE_NAV: { code: string; label: string; x: number; y: number; role: Role; fnLabel: string }[] = [
  { code: 'Home', label: 'Home', x: 1, y: 1, role: { r: 'fn', f: 'playPause' }, fnLabel: 'PLAY/PAUSE' },
  { code: 'PageUp', label: 'PgUp', x: 2, y: 1, role: { r: 'fn', f: 'powerOn' }, fnLabel: 'POWER ON' },
  { code: 'PageDown', label: 'PgDn', x: 2, y: 2, role: { r: 'fn', f: 'powerOff' }, fnLabel: 'POWER OFF' },
  { code: 'ArrowUp', label: '↑', x: 1, y: 4, role: { r: 'fn', f: 'speedUp' }, fnLabel: 'PITCH +' },
  { code: 'ArrowLeft', label: '←', x: 0, y: 5, role: { r: 'fn', f: 'seekBack' }, fnLabel: '−5 SEC' },
  { code: 'ArrowDown', label: '↓', x: 1, y: 5, role: { r: 'fn', f: 'speedDown' }, fnLabel: 'PITCH −' },
  { code: 'ArrowRight', label: '→', x: 2, y: 5, role: { r: 'fn', f: 'seekFwd' }, fnLabel: '+5 SEC' },
];

/** すべてのキー（この順番がキー番号） */
export const TELE_KEYS: { code: string; label: string; role: Role }[] = [...TELE_LAYOUT.flat().filter((k) => k.code && k.role.r !== 'none'), ...TELE_NAV].map((k) => ({
  code: k.code, label: k.label, role: k.role,
}));
export const TELE_KEY_INDEX = new Map(TELE_KEYS.map((k, i) => [k.code, i]));

// ---- GLITCH ボタン×5 ＋ BASE 5 段 ＝ 25 種の一発グリッチ ----
export const BASE_NAMES = ['TAPE', 'DIGITAL', 'SIGNAL', 'BEEP', 'MELTDOWN'] as const;
export type BurstExtra = 'tapeStop' | 'rewind' | 'chipmunk' | 'flutter' | 'dropout' | 'repeat' | 'scatter' | 'silence'
  | 'howl' | 'sweep' | 'snow' | 'zapRoll' | 'chord' | 'drumRoll' | 'swell' | 'chirps' | 'dive' | 'chaos' | 'none';
export interface Burst { name: string; glitches: number[]; dur: number; extra: BurstExtra }
/** [BASE][ボタン]。glitches は一緒に強制的に効かせる文字キーのグリッチ（映像と音の両方） */
export const BURSTS: Burst[][] = [
  [ // TAPE：テープが壊れる
    { name: 'TAPE STOP', glitches: [13, 23], dur: 1.0, extra: 'tapeStop' },
    { name: 'REWIND', glitches: [13, 0], dur: 0.8, extra: 'rewind' },
    { name: 'CHIPMUNK', glitches: [17, 19], dur: 0.8, extra: 'chipmunk' },
    { name: 'WOW FLUTTER', glitches: [18, 14], dur: 1.2, extra: 'flutter' },
    { name: 'TAPE EATEN', glitches: [11, 1], dur: 1.0, extra: 'dropout' },
  ],
  [ // DIGITAL：データが壊れる
    { name: 'BUFFER LOOP', glitches: [21, 0], dur: 0.9, extra: 'repeat' },
    { name: '2-BIT', glitches: [5, 15, 1], dur: 0.8, extra: 'none' },
    { name: 'LO-FI', glitches: [4, 4], dur: 0.9, extra: 'none' },
    { name: 'SCRAMBLE', glitches: [2, 11], dur: 1.0, extra: 'scatter' },
    { name: 'DROPOUT', glitches: [22, 12], dur: 0.8, extra: 'silence' },
  ],
  [ // SIGNAL：電波が壊れる
    { name: 'RING SWEEP', glitches: [0, 3], dur: 1.0, extra: 'sweep' },
    { name: 'SYNC LOST', glitches: [14, 13, 11], dur: 1.0, extra: 'snow' },
    { name: 'HOWL', glitches: [10, 20], dur: 1.2, extra: 'howl' },
    { name: 'FILTER DIVE', glitches: [19, 14], dur: 1.0, extra: 'sweep' },
    { name: 'STATIC', glitches: [11], dur: 0.9, extra: 'snow' },
  ],
  [ // BEEP：内蔵ブザーが暴走
    { name: 'ZAP ROLL', glitches: [22], dur: 0.9, extra: 'zapRoll' },
    { name: 'CHORD BLAST', glitches: [6], dur: 0.7, extra: 'chord' },
    { name: 'DRUM ROLL', glitches: [17], dur: 1.0, extra: 'drumRoll' },
    { name: 'DRONE SWELL', glitches: [8], dur: 1.5, extra: 'swell' },
    { name: 'CHIRPS', glitches: [18], dur: 1.0, extra: 'chirps' },
  ],
  [ // MELTDOWN：全部まとめて
    { name: 'FREEZE DROP', glitches: [12, 16], dur: 1.2, extra: 'tapeStop' },
    { name: 'BACKFIRE', glitches: [6, 10, 20], dur: 1.2, extra: 'rewind' },
    { name: 'DIVE', glitches: [23, 9, 14], dur: 1.5, extra: 'dive' },
    { name: 'SHATTER', glitches: [9, 2, 21], dur: 1.2, extra: 'scatter' },
    { name: 'CHAOS', glitches: [], dur: 1.5, extra: 'chaos' },
  ],
];
