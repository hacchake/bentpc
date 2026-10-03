// 曲をオフラインで最初から最後まで鳴らして、音の波形にする（DOM・Web Audio に依存しない）。
// スタジオの Worklet とまったく同じ部品（シーケンサー・おもちゃ・テスト信号）を使うので、同じ音になる。
// テストと WAV の書き出しで使う。
import { hashSeed } from '../core/rng';
import { cloneSong, songBeats, type Song } from '../core/song';
import { TestSignal } from '../core/testsignal';
import { Sequencer } from '../host/sequencer';
import { TOY_ENGINES } from '../toys/engines';
import { STUDIO_TOYS } from './songs';

const BLOCK = 128;

/** 曲の長さ（秒）＋余韻 */
export const songSeconds = (song: Song, tail = 1) => (songBeats(song) * 60) / song.bpm + tail;

/**
 * 曲を 1 回鳴らしたモノラルの波形を返す。onBlock は進み具合（0〜1）を知らせる（重い処理を分けたいとき用）
 */
export function renderSong(
  song: Song,
  sr: number,
  opts: {
    toys?: number[]; tail?: number; onProgress?: (f: number) => void; userSamples?: { toy: number; key: number; data: Float32Array }[];
    /** おもちゃ専用のデータ（サンプラーの音など） */
    customs?: { toy: number; data: unknown }[];
  } = {},
): Float32Array {
  const ids = opts.toys ?? STUDIO_TOYS;
  const make = (seed?: number) => ids.map((id) => TOY_ENGINES[id](sr, seed === undefined ? undefined : hashSeed(seed, id) >>> 0));
  const sig = new TestSignal(sr);
  const toys = make();
  // 自分の声（トイPC の MY VOICE）も入れる
  const voices = () => {
    opts.userSamples?.forEach((u) => toys[u.toy]?.setUserSample?.(u.key, u.data));
    opts.customs?.forEach((c) => toys[c.toy]?.custom?.(c.data));
  };
  voices();
  const seq = new Sequencer(sr, toys, { onTake: () => {}, onEnd: () => {}, onRebuild: () => { sig.reset(); voices(); } }, make);
  const s = cloneSong(song);
  s.metronome = false;
  seq.setSong(s);
  seq.bounce = true;
  seq.play(0);
  const total = Math.ceil((songSeconds(s, opts.tail ?? 1) * sr) / BLOCK) * BLOCK;
  const res = new Float32Array(total);
  const out = new Float32Array(BLOCK), click = new Float32Array(BLOCK), tmp = new Float32Array(BLOCK), inp = new Float32Array(BLOCK);
  for (let i = 0; i < total; i += BLOCK) {
    sig.render(inp, seq.playing ? seq.pos : null, s.bpm);
    seq.render(out, click, tmp, inp);
    for (let j = 0; j < BLOCK; j++) res[i + j] = Math.max(-1, Math.min(1, out[j]));
    if (opts.onProgress && (i / BLOCK) % 2000 === 0) opts.onProgress(i / total);
  }
  return res;
}
