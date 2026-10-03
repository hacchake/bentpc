// WAV の書き出しを画面とは別の流れ（Web Worker）で行う。画面が固まらないように
import type { Song } from '../core/song';
import { renderSongStereo } from './render';

interface Req { song: Song; sr: number; toys?: number[]; userSamples: { toy: number; key: number; data: Float32Array }[]; customs?: { toy: number; data: unknown }[] }

self.onmessage = (e: MessageEvent<Req>) => {
  const { song, sr, userSamples, toys, customs } = e.data;
  const [data, dataR] = renderSongStereo(song, sr, { toys, userSamples, customs, normalize: true, onProgress: (f) => self.postMessage({ type: 'progress', f }) });
  (self as unknown as Worker).postMessage({ type: 'done', data, dataR }, [data.buffer, dataR.buffer]);
};
