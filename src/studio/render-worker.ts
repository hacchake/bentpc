// WAV の書き出しを画面とは別の流れ（Web Worker）で行う。画面が固まらないように
import type { Song } from '../core/song';
import { renderSongStereo } from './render';

interface Req {
  song: Song; sr: number; toys?: number[]; userSamples: { toy: number; key: number; data: Float32Array }[]; customs?: { toy: number; data: unknown }[];
  /** 楽器ごとの書き出し：このおもちゃ（曲の中の番号）だけを 1 本ずつ */
  stems?: number[];
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { song, sr, userSamples, toys, customs, stems } = e.data;
  const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);
  if (stems) {
    // 1 本ずつ：そのおもちゃだけソロにして（音量・左右はミキサーのまま）、仕上げを通さずに
    stems.forEach((toy, k) => {
      const s: Song = JSON.parse(JSON.stringify(song));
      const mix: NonNullable<Song['mix']> = (s.mix ?? []).map((c) => (c ? { ...c, solo: false, mute: false } : c));
      while (mix.length <= toy) mix.push(null);
      mix[toy] = { gain: mix[toy]?.gain ?? 0, pan: mix[toy]?.pan ?? null, solo: true };
      s.mix = mix;
      const [data, dataR] = renderSongStereo(s, sr, { toys, userSamples, customs, raw: true, onProgress: (f) => post({ type: 'progress', f: (k + f) / stems.length }) });
      post({ type: 'stem', toy, data, dataR }, [data.buffer, dataR.buffer]);
    });
    post({ type: 'stemsDone' });
    return;
  }
  const [data, dataR] = renderSongStereo(song, sr, { toys, userSamples, customs, normalize: true, onProgress: (f) => post({ type: 'progress', f }) });
  post({ type: 'done', data, dataR }, [data.buffer, dataR.buffer]);
};
