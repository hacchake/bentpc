// 曲をオフラインで最初から最後まで鳴らして、音の波形にする（DOM・Web Audio に依存しない）。
// スタジオの Worklet とまったく同じ部品（シーケンサー・おもちゃ・テスト信号）を使うので、同じ音になる。
// テストと WAV の書き出しで使う。
import { MasterBus } from '../host/master';
import { hashSeed } from '../core/rng';
import { cloneSong, songBeats, type Song } from '../core/song';
import { TestSignal } from '../core/testsignal';
import { Sequencer } from '../host/sequencer';
import { TOY_ENGINES } from '../toys/engines';
import { STUDIO_TOYS } from './songs';

const BLOCK = 128;

/** 曲の長さ（秒）＋余韻 */
export const songSeconds = (song: Song, tail = 1) => (songBeats(song) * 60) / song.bpm + tail;

/** renderSong の設定 */
export interface RenderOpts {
  toys?: number[]; tail?: number; onProgress?: (f: number) => void; userSamples?: { toy: number; key: number; data: Float32Array }[];
  /** おもちゃ専用のデータ（サンプラーの音など） */
  customs?: { toy: number; data: unknown }[];
}

/**
 * 曲を 1 回鳴らした波形（左・右）を返す。スピーカーと同じ仕上げ（MasterBus）を通す。onProgress は進み具合（0〜1）
 */
export function renderSongStereo(song: Song, sr: number, opts: RenderOpts = {}): [Float32Array, Float32Array] {
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
  const master = new MasterBus(sr);
  const total = Math.ceil((songSeconds(s, opts.tail ?? 1) * sr) / BLOCK) * BLOCK;
  // 先読みリミッターの遅れの分だけ多めに作って、頭を捨てる（音の位置がずれないように）
  const lat = master.latency;
  const L = new Float32Array(total + lat + BLOCK), R = new Float32Array(total + lat + BLOCK);
  const out = new Float32Array(BLOCK), click = new Float32Array(BLOCK), tmp = new Float32Array(BLOCK), inp = new Float32Array(BLOCK);
  for (let i = 0; i < total + lat; i += BLOCK) {
    sig.render(inp, seq.playing ? seq.pos : null, s.bpm);
    seq.render(out, click, tmp, inp);
    master.process(out, L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK));
    if (opts.onProgress && (i / BLOCK) % 2000 === 0) opts.onProgress(i / total);
  }
  return [L.slice(lat, lat + total), R.slice(lat, lat + total)];
}

/** 左右を混ぜたモノラル（テスト・解析用） */
export function renderSong(song: Song, sr: number, opts: RenderOpts = {}): Float32Array {
  const [L, R] = renderSongStereo(song, sr, opts);
  for (let i = 0; i < L.length; i++) L[i] = (L[i] + R[i]) * 0.5;
  return L;
}
