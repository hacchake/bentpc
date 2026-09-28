// 4台目 VROOMBOX VR-5（魔改造 子供用ドライブ・ダッシュボード）のパラメーター定義。
// UI・DSP・MIDI・（将来の）VST3 はこの表だけを見てパラメーターを扱う。

import type { ParamDef } from '../../core/params';

export const GEARS = ['N', '1', '2', '3', '4', '5'] as const;
export const STATIONS = ['OFF', 'FM 1', 'FM 2', 'AM'] as const;

export const VROOM_PARAMS = [
  // ---- おもちゃ本体 ----
  { id: 'volume', name: 'VOLUME', kind: 'continuous', min: 0, max: 1, default: 0.7, midiCC: 7 },
  { id: 'throttle', name: 'ACCEL', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 2 },
  { id: 'wheel', name: 'WHEEL', kind: 'continuous', min: -1, max: 1, default: 0, midiCC: 1 },
  { id: 'gear', name: 'GEAR', kind: 'stepped', min: 0, max: 5, default: 0, midiCC: 20, labels: [...GEARS] },
  { id: 'station', name: 'RADIO', kind: 'stepped', min: 0, max: 3, default: 0, midiCC: 21, labels: [...STATIONS] },
  { id: 'turbo', name: 'TURBO', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 22 },
  { id: 'siren', name: 'SIREN', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 23 },
  { id: 'signal', name: 'TURN SIGNAL', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 24 },
  { id: 'wipers', name: 'WIPERS', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 25 },
  // ---- 魔改造パーツ ----
  { id: 'cyl1', name: 'FIRE 1', kind: 'toggle', min: 0, max: 1, default: 1, midiCC: 102 },
  { id: 'cyl2', name: 'FIRE 2', kind: 'toggle', min: 0, max: 1, default: 1, midiCC: 103 },
  { id: 'cyl3', name: 'FIRE 3', kind: 'toggle', min: 0, max: 1, default: 1, midiCC: 104 },
  { id: 'cyl4', name: 'FIRE 4', kind: 'toggle', min: 0, max: 1, default: 1, midiCC: 105 },
  { id: 'cyl5', name: 'FIRE 5', kind: 'toggle', min: 0, max: 1, default: 1, midiCC: 106 },
  { id: 'cyl6', name: 'FIRE 6', kind: 'toggle', min: 0, max: 1, default: 1, midiCC: 107 },
  { id: 'cyl7', name: 'FIRE 7', kind: 'toggle', min: 0, max: 1, default: 1, midiCC: 108 },
  { id: 'cyl8', name: 'FIRE 8', kind: 'toggle', min: 0, max: 1, default: 1, midiCC: 109 },
  { id: 'cam', name: 'CAM', kind: 'stepped', min: 3, max: 8, default: 8, midiCC: 110 }, // 点火パターンの長さ
  { id: 'redline', name: 'REDLINE', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 85 },
  { id: 'spark', name: 'SPARK', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 86 },
  { id: 'starterLoop', name: 'STARTER LOOP', kind: 'momentary', min: 0, max: 1, default: 0, midiCC: 87 },
  { id: 'grind', name: 'GEAR GRIND', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 88 },
  { id: 'turboFb', name: 'TURBO FB', kind: 'continuous', min: 0, max: 1, default: 0.6, midiCC: 89 },
  { id: 'turboFbOn', name: 'TURBO FB ON', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 90 },
  { id: 'radioBleed', name: 'RADIO BLEED', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 111 },
  { id: 'tune', name: 'TUNE', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 112 },
  { id: 'hijack', name: 'PRESET HIJACK', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 113 },
  { id: 'hornBend', name: 'HORN BEND', kind: 'toggle', min: 0, max: 1, default: 0, midiCC: 114 },
  { id: 'chassis', name: 'CHASSIS', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 115 },
  { id: 'hazard', name: 'HAZARD', kind: 'continuous', min: 0, max: 1, default: 0, midiCC: 116 },
] as const satisfies readonly ParamDef[];

export type VroomParamId = (typeof VROOM_PARAMS)[number]['id'];
export const VROOM_INDEX = Object.fromEntries(VROOM_PARAMS.map((p, i) => [p.id, i])) as Record<VroomParamId, number>;

// ---- キー ----
export const V_PRESET = 0; // 0..7 = ラジオのプリセット（HIJACK 中はエンジンの音階）
export const V_HORN = 8;
export const V_CRASH = 9;
export const V_START = 10; // 押している間セルを回す
export const V_NOTE = 16; // 16.. = MIDI ノート 36〜 でエンジンを直接弾く
export const V_NOTE_BASE = 36;
export const V_NOTE_COUNT = 60;
export const V_KEY_COUNT = V_NOTE + V_NOTE_COUNT;
