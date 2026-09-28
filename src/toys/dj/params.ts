// 3台目 SPIN-TOT DJ-28（魔改造 子供用 DJ セット）のパラメーター定義。
// UI・DSP・MIDI・（将来の）VST3 はこの表だけを見てパラメーターを扱う。

import type { ParamDef } from '../../core/params';

export const DJ_INSTRUMENTS = ['LEAD', 'BASS', 'ORGAN', 'STRINGS', 'BELL', 'PIPE', 'BRASS', 'SYNTH', 'CHOIR', 'NOISE'] as const;
export const FB_SOURCES = ['RHYTHM', 'DISC', 'MASTER'] as const;

export const DJ_PARAMS = [
  // ---- おもちゃ本体 ----
  { id: 'volume', name: 'MASTER VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.7, midiCC: 7 },
  { id: 'rhythmVol', name: 'RHYTHM VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.75, midiCC: 20 },
  { id: 'sfxVol', name: 'SOUND EFFECT VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.75, midiCC: 21 },
  { id: 'rhythm', name: 'RHYTHM', kind: 'stepped', min: 0, max: 27, default: 0, midiCC: 22 }, // 21〜27 は隠しパターン
  { id: 'discFx', name: 'DISC EFFECT', kind: 'stepped', min: 0, max: 20, default: 0, midiCC: 23 },
  { id: 'sfxBank', name: 'EFFECT SELECTION', kind: 'stepped', min: 0, max: 9, default: 0, midiCC: 24 },
  { id: 'instrument', name: 'INSTRUMENT', kind: 'stepped', min: 0, max: 9, default: 0, midiCC: 25, labels: [...DJ_INSTRUMENTS] },
  { id: 'kbPattern', name: 'KEYBOARD PATTERN', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 26, labels: ['1', '2'] },
  { id: 'discSpeed', name: 'DISC SPEED', kind: 'continuous', min: -4, max: 4, default: 0, midiCC: 27 }, // ディスクを回す速さ（1 = 普通）
  { id: 'rhythmFx', name: 'RHYTHM EFFECT', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 28 },
  // ---- 魔改造パーツ ----
  { id: 'pitchOn', name: 'PITCH ON', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 85 },
  { id: 'pitchCoarse', name: 'PITCH', kind: 'continuous', min: 0, max: 1, default: 0.5, midiCC: 86 }, // ±12 半音
  { id: 'pitchFine', name: 'FINE', kind: 'continuous', min: 0, max: 1, default: 0.5, midiCC: 87 }, // ±1 半音
  { id: 'halt', name: 'STOP', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 88 }, // 移動停止
  { id: 'lightOn', name: 'LIGHT', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 89 },
  { id: 'light', name: 'LIGHT SENSOR', kind: 'continuous', min: 0, max: 1, default: 1, midiCC: 90 }, // 1 = 明るい
  { id: 'dist1On', name: 'DIST ON', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 102 },
  { id: 'dist1', name: 'DIST', kind: 'continuous', min: 0, max: 1, default: 0.5, midiCC: 103 },
  { id: 'dist2On', name: 'DIST 2 ON', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 104 },
  { id: 'dist2', name: 'DIST 2', kind: 'continuous', min: 0, max: 1, default: 0.5, midiCC: 105 },
  { id: 'feedback', name: 'FEEDBACK', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 106 },
  { id: 'fbSource', name: 'FEEDBACK SOURCE', kind: 'stepped', min: 0, max: 2, default: 2, midiCC: 107, labels: [...FB_SOURCES] },
] as const satisfies readonly ParamDef[];

export type DjParamId = (typeof DJ_PARAMS)[number]['id'];
export const DJ_INDEX = Object.fromEntries(DJ_PARAMS.map((p, i) => [p.id, i])) as Record<DjParamId, number>;

// ---- キー ----
export const DJ_FIRST_NOTE = 60; // 鍵盤 C4〜C5（13 鍵）
export const DJ_NOTE_COUNT = 13;
export const DJ_PAD = 13; // 13..18 = SOUND EFFECT パッド 6 つ
export const DJ_PLAY = 19;
export const DJ_PAUSE = 20;
export const DJ_TEMPO_UP = 21;
export const DJ_TEMPO_DOWN = 22;
export const DJ_DISC_TOUCH = 23; // ディスクに触る（押している間）
export const DJ_KEY_COUNT = 24;
