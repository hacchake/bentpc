// PIKOTONE PT-32（2台目：魔改造ミニキーボード＋エフェクト別ユニット）のパラメーター定義。
// UI・DSP・MIDI・（将来の）VST3 はこの表だけを見てパラメーターを扱う。

import type { ParamDef } from '../../core/params';

export const INSTRUMENTS = ['ORGAN', 'VIOLIN', 'PIANO', 'HORN', 'FLUTE', 'GUITAR', 'MUSIC BOX', 'BANJO'] as const;
export const RHYTHMS = ['MARCH', 'RHUMBA', 'DISCO', 'POP', 'BALLAD', 'WALTZ', 'TANGO', 'SWING'] as const;

export const PIKO_PARAMS = [
  // ---- キーボード本体 ----
  { id: 'volume', name: 'MASTER VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.7, midiCC: 7 },
  { id: 'instrument', name: 'ORCHESTRA', kind: 'stepped', min: 0, max: 7, default: 0, midiCC: 20, labels: [...INSTRUMENTS] },
  { id: 'vibrato', name: 'VIBRATO', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 21 },
  { id: 'rhythm', name: 'RHYTHM', kind: 'stepped', min: 0, max: 7, default: 3, midiCC: 22, labels: [...RHYTHMS] },
  { id: 'tempo', name: 'TEMPO', kind: 'continuous', min: 0, max: 1, default: 0.43, midiCC: 23 }, // 60〜200 BPM
  // ---- 本体の改造 ----
  { id: 'ampPower', name: 'AMP POWER', kind: 'continuous', min: 0, max: 1, default: 1, midiCC: 24 },
  { id: 'cpuPower', name: 'CPU POWER', kind: 'continuous', min: 0, max: 1, default: 1, midiCC: 25 },
  { id: 'ampTouch1', name: 'AMP TOUCH 1', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 26 },
  { id: 'ampTouch2', name: 'AMP TOUCH 2', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 27 },
  { id: 'ampTouch3', name: 'AMP TOUCH 3', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 28 },
  { id: 'bendTouch1', name: 'PITCH BEND 1', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 29 },
  { id: 'bendTouch2', name: 'PITCH BEND 2', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 30 },
  { id: 'bendTouch3', name: 'PITCH BEND 3', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 31 },
  { id: 'glitch', name: 'GLITCH', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 85 },
  { id: 'instHold1', name: 'INST HOLD 1', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 108 },
  { id: 'instHold2', name: 'INST HOLD 2', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 109 },
  { id: 'instHold3', name: 'INST HOLD 3', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 110 },
  { id: 'instHold4', name: 'INST HOLD 4', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 111 },
  { id: 'instHold5', name: 'INST HOLD 5', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 112 },
  { id: 'instHold6', name: 'INST HOLD 6', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 113 },
  { id: 'instHold7', name: 'INST HOLD 7', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 114 },
  { id: 'instHold8', name: 'INST HOLD 8', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 115 },
  // ---- エフェクト別ユニット ----
  { id: 'pitch', name: 'PITCH', kind: 'continuous', min: 0, max: 1, default: 0.5, midiCC: 86 },
  { id: 'pitchOn', name: 'PITCH ON', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 87 },
  { id: 'envLen', name: 'ENV LEN', kind: 'continuous', min: 0, max: 1, default: 0.4, midiCC: 88 },
  { id: 'envHold', name: 'ENV / HOLD', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 89, labels: ['ENV', 'HOLD'] },
  { id: 'dist', name: 'DIST', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 90 },
  { id: 'fizz', name: 'FIZZ', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 102 },
  { id: 'hipass', name: 'HIPASS', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 103 },
  { id: 'hipassMode', name: 'HIPASS MODE', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 104, labels: ['SMOOTH', 'RESO'] },
  { id: 'feedback', name: 'FEEDBACK', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 105 },
  { id: 'feedbackMode', name: 'FEEDBACK MODE', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 106, labels: ['SHORT', 'LONG'] },
] as const satisfies readonly ParamDef[];

export type PikoParamId = (typeof PIKO_PARAMS)[number]['id'];
export const PIKO_INDEX = Object.fromEntries(PIKO_PARAMS.map((p, i) => [p.id, i])) as Record<PikoParamId, number>;

// ---- キー ----
export const PIKO_FIRST_NOTE = 53; // F3
export const PIKO_NOTE_COUNT = 32; // F3〜C6
export const PAD_KEY = 32; // 32..35 = ドラムパッド 4 つ
export const KEY_DEMO = 36;
export const KEY_START = 37;
export const KEY_STOP = 38;
export const KEY_TEMPO_UP = 39;
export const KEY_TEMPO_DOWN = 40;
export const PIKO_KEY_COUNT = 41;
