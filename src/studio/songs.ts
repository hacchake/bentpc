// スタジオの曲データの元（空の曲）。デモ曲・自動作曲もここから作る。
import type { Song } from '../core/song';

/** スタジオで使うおもちゃ（src/toys/engines.ts の番号）：0 = BLIPPY BOOK 30、5 = TELEKEY TK-6 */
export const STUDIO_TOYS = [0, 5];
export const TOY_PC = 0; // 曲の中のおもちゃ番号（STUDIO_TOYS の並び）
export const TELE = 1;

export function blankStudioSong(): Song {
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
    tracks: [
      { toy: TOY_PC, name: 'トイPC', mute: false, notes: [], autos: [], rec: true },
      { toy: TELE, name: 'キーボード', mute: false, notes: [], autos: [], rec: true },
    ],
  };
}
