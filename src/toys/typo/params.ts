// 5台目 TYPOTRON TT-109（PC キーボードそのものを魔改造した楽器）のパラメーターとキー割り当て。
// すべてのキーに役目がある。キーの並びは日本語 109 キーボード（e.code で物理位置を見る）。

import type { ParamDef } from '../../core/params';

export const WAVES = ['PULSE', 'SAW', 'BELL', 'NOISE'] as const;
export const SCALES = ['MAJOR', 'MINOR', 'PENTA', 'BENT'] as const;
export const SCALE_STEPS: number[][] = [
  [0, 2, 4, 5, 7, 9, 11],
  [0, 2, 3, 5, 7, 8, 10],
  [0, 2, 4, 7, 9],
  [0, 1, 4, 5, 8, 11, 12.5], // わざと少し狂った音階
];

export const TYPO_PARAMS = [
  { id: 'volume', name: 'VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.7, midiCC: 7 },
  { id: 'decay', name: 'DECAY', kind: 'continuous', min: 0, max: 1, default: 0.4, midiCC: 20 },
  { id: 'tone', name: 'TONE', kind: 'continuous', min: 0, max: 1, default: 0.7, midiCC: 21 },
  { id: 'drive', name: 'DRIVE', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 22 },
  { id: 'crush', name: 'CRUSH', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 23 },
  { id: 'echo', name: 'ECHO', kind: 'continuous', min: 0, max: 1, default: 0.2, midiCC: 24 },
  { id: 'tempo', name: 'TEMPO', kind: 'continuous', min: 0, max: 1, default: 0.4, midiCC: 25 }, // 60〜240 BPM
  { id: 'bendRange', name: 'BEND RANGE', kind: 'continuous', min: 0, max: 1, default: 0.17, midiCC: 26 }, // 0〜12 半音
  { id: 'ghostAmt', name: 'GHOST', kind: 'continuous', min: 0, max: 1, default: 0.5, midiCC: 27 },
  { id: 'scanRate', name: 'SCAN RATE', kind: 'continuous', min: 0, max: 1, default: 0.4, midiCC: 28 },
  { id: 'bounceAmt', name: 'BOUNCE', kind: 'continuous', min: 0, max: 1, default: 0.5, midiCC: 29 },
  { id: 'click', name: 'CLICK', kind: 'continuous', min: 0, max: 1, default: 0.35, midiCC: 30 },
  { id: 'wave', name: 'WAVE', kind: 'stepped', min: 0, max: 3, default: 0, midiCC: 85, labels: [...WAVES] },
  { id: 'scale', name: 'SCALE', kind: 'stepped', min: 0, max: 3, default: 0, midiCC: 86, labels: [...SCALES] },
  { id: 'ghost', name: 'GHOST ON', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 87 },
  { id: 'scan', name: 'SCAN ON', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 88 },
  { id: 'bounce', name: 'BOUNCE ON', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 89 },
  { id: 'overflow', name: 'OVERFLOW', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 90 },
] as const satisfies readonly ParamDef[];

export type TypoParamId = (typeof TYPO_PARAMS)[number]['id'];
export const TYPO_INDEX = Object.fromEntries(TYPO_PARAMS.map((p, i) => [p.id, i])) as Record<TypoParamId, number>;

// ---- キーの役目 ----
export type Role =
  | { r: 'note'; row: number; col: number } // row 0 = Z 段（低い）… 3 = 数字段（高い）
  | { r: 'drum'; n: number }
  | { r: 'fn'; f: Fn }
  | { r: 'wave'; n: number }
  | { r: 'scale'; n: number }
  | { r: 'bend'; p: 'ghost' | 'scan' | 'bounce' | 'overflow' }
  | { r: 'none' };

export type Fn =
  | 'sustain' | 'octDown' | 'octUp' | 'stutter' | 'latch' | 'enter' | 'backspace' | 'escape'
  | 'corrupt' | 'overwrite' | 'tempoUp' | 'tempoDown' | 'bendDown' | 'bendUp' | 'transUp' | 'transDown' | 'powerOn' | 'powerOff';

export interface KeyDef {
  code: string; // KeyboardEvent.code
  label: string; // キートップの文字（JIS）
  w: number; // 幅（キー 1 個 = 1）
  role: Role;
  fnLabel?: string; // キートップ下の小さい機能名
}

const note = (code: string, label: string, row: number, col: number, w = 1): KeyDef => ({ code, label, w, role: { r: 'note', row, col } });
const fn = (code: string, label: string, f: Fn, fnLabel: string, w = 1): KeyDef => ({ code, label, w, role: { r: 'fn', f }, fnLabel });
const gap = (w: number): KeyDef => ({ code: '', label: '', w, role: { r: 'none' } });

/** キーボードの並び（行ごと）。UI の描画とエンジンのキー番号の両方がこれを使う */
export const LAYOUT: KeyDef[][] = [
  [
    fn('Escape', 'Esc', 'escape', 'CLEAR'), gap(0.6),
    ...WAVES.map((w, i): KeyDef => ({ code: `F${i + 1}`, label: `F${i + 1}`, w: 1, role: { r: 'wave', n: i }, fnLabel: w })), gap(0.4),
    ...SCALES.map((s, i): KeyDef => ({ code: `F${i + 5}`, label: `F${i + 5}`, w: 1, role: { r: 'scale', n: i }, fnLabel: s })), gap(0.4),
    ...(['ghost', 'scan', 'bounce', 'overflow'] as const).map((p, i): KeyDef => ({ code: `F${i + 9}`, label: `F${i + 9}`, w: 1, role: { r: 'bend', p }, fnLabel: p.toUpperCase() })),
  ],
  [
    { code: 'Backquote', label: '半/全', w: 1, role: { r: 'none' }, fnLabel: '(IME)' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((c, i) => note(`Digit${c}`, c, 3, i)),
    note('Minus', '-', 3, 10), note('Equal', '^', 3, 11), note('IntlYen', '¥', 3, 12),
    fn('Backspace', 'BS', 'backspace', 'DELETE 1'),
  ],
  [
    fn('Tab', 'Tab', 'stutter', 'STUTTER', 1.5),
    ...'QWERTYUIOP'.split('').map((c, i) => note(`Key${c}`, c, 2, i)),
    note('BracketLeft', '@', 2, 10), note('BracketRight', '[', 2, 11),
    fn('Enter', 'Enter', 'enter', 'SEND▶LOOP', 1.5),
  ],
  [
    fn('CapsLock', 'Caps', 'latch', 'LATCH', 1.75),
    ...'ASDFGHJKL'.split('').map((c, i) => note(`Key${c}`, c, 1, i)),
    note('Semicolon', ';', 1, 9), note('Quote', ':', 1, 10), note('Backslash', ']', 1, 11),
    gap(1.25),
  ],
  [
    fn('ShiftLeft', 'Shift', 'octDown', 'OCT −', 2.25),
    ...'ZXCVBNM'.split('').map((c, i) => note(`Key${c}`, c, 0, i)),
    note('Comma', ',', 0, 7), note('Period', '.', 0, 8), note('Slash', '/', 0, 9), note('IntlRo', '\\', 0, 10),
    fn('ShiftRight', 'Shift', 'octUp', 'OCT +', 1.75),
  ],
  [
    gap(3.25),
    { code: 'NonConvert', label: '無変換', w: 1.25, role: { r: 'drum', n: 10 }, fnLabel: 'KICK' },
    fn('Space', 'Space', 'sustain', 'SUSTAIN', 4.5),
    { code: 'Convert', label: '変換', w: 1.25, role: { r: 'drum', n: 11 }, fnLabel: 'SNARE' },
    { code: 'KanaMode', label: 'かな', w: 1.25, role: { r: 'drum', n: 12 }, fnLabel: 'HAT' },
  ],
];

/** 右側：編集キーと矢印 */
export const NAV: { code: string; label: string; x: number; y: number; role: Role; fnLabel: string }[] = [
  { code: 'Insert', label: 'Ins', x: 0, y: 1, role: { r: 'fn', f: 'overwrite' }, fnLabel: 'OVERWRITE' },
  { code: 'Home', label: 'Home', x: 1, y: 1, role: { r: 'fn', f: 'tempoUp' }, fnLabel: 'TEMPO +' },
  { code: 'PageUp', label: 'PgUp', x: 2, y: 1, role: { r: 'fn', f: 'powerOn' }, fnLabel: 'POWER ON' },
  { code: 'Delete', label: 'Del', x: 0, y: 2, role: { r: 'fn', f: 'corrupt' }, fnLabel: 'CORRUPT' },
  { code: 'End', label: 'End', x: 1, y: 2, role: { r: 'fn', f: 'tempoDown' }, fnLabel: 'TEMPO −' },
  { code: 'PageDown', label: 'PgDn', x: 2, y: 2, role: { r: 'fn', f: 'powerOff' }, fnLabel: 'POWER OFF' },
  { code: 'ArrowUp', label: '↑', x: 1, y: 4, role: { r: 'fn', f: 'transUp' }, fnLabel: 'TRANS +' },
  { code: 'ArrowLeft', label: '←', x: 0, y: 5, role: { r: 'fn', f: 'bendDown' }, fnLabel: 'BEND −' },
  { code: 'ArrowDown', label: '↓', x: 1, y: 5, role: { r: 'fn', f: 'transDown' }, fnLabel: 'TRANS −' },
  { code: 'ArrowRight', label: '→', x: 2, y: 5, role: { r: 'fn', f: 'bendUp' }, fnLabel: 'BEND +' },
];

/** テンキー：ドラム 0〜9 ＋ 記号 */
export const DRUM_NAMES = ['KICK', 'SNARE', 'HAT', 'OPEN', 'TOM L', 'TOM H', 'CLAP', 'COW', 'ZAP', 'CRASH', 'KICK', 'SNARE', 'HAT'];
export const NUMPAD: { code: string; label: string; x: number; y: number; h?: number; w?: number; role: Role; fnLabel: string }[] = [
  ...[7, 8, 9, 4, 5, 6, 1, 2, 3].map((n, i) => ({ code: `Numpad${n}`, label: String(n), x: i % 3, y: 1 + Math.floor(i / 3), role: { r: 'drum', n } as Role, fnLabel: DRUM_NAMES[n] })),
  { code: 'Numpad0', label: '0', x: 0, y: 4, w: 2, role: { r: 'drum', n: 0 }, fnLabel: DRUM_NAMES[0] },
];

/** すべてのキー（この順番がキー番号になる） */
export const TYPO_KEYS: { code: string; label: string; role: Role }[] = [
  ...LAYOUT.flat().filter((k) => k.code),
  ...NAV,
  ...NUMPAD,
].map((k) => ({ code: k.code, label: k.label, role: k.role }));

export const TYPO_KEY_INDEX = new Map(TYPO_KEYS.map((k, i) => [k.code, i]));
/** MIDI ノートで直接弾くためのキー番号（RAW_NOTE + ノート番号） */
export const RAW_NOTE = 1000;
