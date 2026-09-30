// スタジオの曲データの元（空の曲）。デモ曲・自動作曲もここから作る。
import type { Song } from '../core/song';
import { PARAMS as BLIPPY_PARAMS } from '../toys/blippy/params';
import { TELE_PARAMS } from '../toys/tele/params';
import type { MidiToy } from './midi-export';

/** スタジオで使うおもちゃ（src/toys/engines.ts の番号）：0 = BLIPPY BOOK 30、5 = TELEKEY TK-6 */
export const STUDIO_TOYS = [0, 5];
export const TOY_PC = 0; // 曲の中のおもちゃ番号（STUDIO_TOYS の並び）
export const TELE = 1;

/**
 * MIDI の書き出しの決まり（将来の VST でも同じにする）：
 * トイPC = チャンネル 1、ノート 36〜75 = 40 キー（ラックの MIDI 入力と同じ）
 * TELEKEY = チャンネル 6、ノート 24〜95 = 72 キー（キー番号 + 24。グリッチキー・楽器キー・機能キーすべて）
 */
export const STUDIO_MIDI: MidiToy[] = [
  { title: 'BLIPPY BOOK 30', channel: 0, noteOf: (k) => (k < 40 ? 36 + k : -1), paramDefs: BLIPPY_PARAMS },
  { title: 'TELEKEY TK-6', channel: 5, noteOf: (k) => (k < 72 ? 24 + k : -1), paramDefs: TELE_PARAMS },
];

/** 空の曲。names = 並べたおもちゃの名前（1 台 1 トラック） */
export function blankStudioSong(names: string[] = ['トイPC', 'キーボード']): Song {
  return {
    version: 1,
    title: 'NEW SONG',
    bpm: 120,
    bars: 16,
    metronome: false,
    seed: 12345,
    ramp: true,
    loop: { on: false, start: 0, end: 16 },
    sections: [{ name: 'イントロ', start: 0 }],
    tracks: names.map((name, toy) => ({ toy, name, mute: false, notes: [], autos: [], rec: true })),
  };
}
