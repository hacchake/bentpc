// すべてのパラメーター（ノブ・スイッチ・ボタン）の定義。
// UI・DSP・MIDI・（将来の）VST3 はこの表だけを見てパラメーターを扱う。
// index は配列上の位置で、DSP 側は Float32Array(PARAMS.length) で値を持つ。

export type ParamKind =
  | 'continuous' // ノブ（0..1 などの連続値）
  | 'stepped' // ロータリー・スライダー（整数ステップ）
  | 'toggle' // オン/オフのスイッチ
  | 'momentary'; // 押している間だけ 1 になるボタン

export interface ParamDef {
  id: string;
  name: string; // 表示名
  kind: ParamKind;
  min: number;
  max: number;
  default: number;
  labels?: string[]; // stepped の各位置の名前
  midiCC?: number; // Web MIDI の CC 番号（任意）
  phase: 1 | 2 | 3; // どのフェーズで実装されるか（目安）
}

export const MODE_NAMES = ['ABC', 'WORD', 'TUNE', 'PIANO', 'DRUM', 'SFX', 'QUIZ', 'SAY'] as const;

export const PARAMS = [
  // ---- おもちゃ本体 ----
  { id: 'volume', name: 'VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.7, midiCC: 7, phase: 1 },
  {
    id: 'mode', name: 'MODE', kind: 'stepped', min: 0, max: 7, default: 0, midiCC: 20, phase: 1,
    labels: ['ABC', 'WORD', 'TUNE', 'PIANO', 'DRUM', 'SFX', 'QUIZ', 'SAY'],
  },
  // ---- 魔改造パーツ ----
  {
    id: 'loopSwitch', name: 'LOOP', kind: 'stepped', min: 0, max: 2, default: 1, midiCC: 21, phase: 2,
    labels: ['HOLD', 'PLAY', 'MUTE'], // 0=上 1=中 2=下
  },
  { id: 'glitch1', name: 'GLITCH 1', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 22, phase: 2 },
  { id: 'glitch2', name: 'GLITCH 2', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 23, phase: 2 },
  { id: 'glitch3', name: 'GLITCH 3', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 24, phase: 2 },
  { id: 'glitch4', name: 'GLITCH 4', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 25, phase: 2 },
  { id: 'glitch5', name: 'GLITCH 5', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 26, phase: 2 },
  { id: 'base', name: 'BASE', kind: 'stepped', min: 0, max: 4, default: 0, midiCC: 27, phase: 2, labels: ['1', '2', '3', '4', '5'] },
  { id: 'loopHold', name: 'LOOP HOLD', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 28, phase: 2 },
  { id: 'loopRelease', name: 'LOOP RELEASE', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 29, phase: 2 },
  { id: 'lfoRate', name: 'LFO RATE', kind: 'continuous', min: 0, max: 1, default: 0.3, midiCC: 30, phase: 2 },
  { id: 'lfoDepth', name: 'LFO DEPTH', kind: 'continuous', min: 0, max: 1, default: 0.25, midiCC: 31, phase: 2 },
  { id: 'stretch', name: 'STRETCH', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 85, phase: 2 },
  { id: 'stretchHold', name: 'STRETCH HOLD', kind: 'continuous', min: 0, max: 1, default: 0.4, midiCC: 86, phase: 2 },
  { id: 'stretchRelease', name: 'STRETCH REL', kind: 'continuous', min: 0, max: 1, default: 0.4, midiCC: 87, phase: 2 },
  { id: 'dist', name: 'DIST', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 88, phase: 2 },
  { id: 'distType', name: 'DIST TYPE', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 89, phase: 2 },
] as const satisfies readonly ParamDef[];

export type ParamId = (typeof PARAMS)[number]['id'];

export const PARAM_INDEX = Object.fromEntries(PARAMS.map((p, i) => [p.id, i])) as Record<ParamId, number>;

export function defaultParamValues(): Float32Array {
  return Float32Array.from(PARAMS.map((p) => p.default));
}

// ---- キー（A〜Z＋機能キー4つ） ----
export const LETTER_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const FUNCTION_KEYS = ['F1', 'F2', 'F3', 'F4'] as const; // ♪ ? ★ OK
export const FUNCTION_KEY_LABELS = ['♪', '?', '★', 'OK'];
export const KEY_COUNT = 30; // 0..25 = A..Z, 26..29 = F1..F4
