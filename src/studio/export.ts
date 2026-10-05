// スタジオの書き出し：WAV（オフラインで一気に）・MIDI・映像込み WebM 用の合成画面
import { songBeats, trackToy, usedToys, type Song } from '../core/song';
import { encodeWav, encodeWavFloat, download } from '../host/wav';
import { makeZip } from '../host/zip';
import { compressedFormat, encodeCompressed } from '../host/compress';
import { fromInt8 } from '../toys/blippy/dsp/mic';
import { songToMidi, type MidiToy } from './midi-export';
import RenderWorker from './render-worker.ts?worker&inline';
import { STUDIO_MIDI, TOY_PC } from './songs';

export const safeName = (s: Song) => (s.title || 'studio-song').replace(/[\\/:*?"<>|]/g, '_');

/** トイPC の「自分の声」（このブラウザに保存してあるもの） */
function userSamples(): { toy: number; key: number; data: Float32Array }[] {
  try {
    const st = JSON.parse(localStorage.getItem('bentpc.userSamples.v1') ?? '{}') as Record<string, string>;
    return Object.entries(st).map(([k, b64]) => {
      const bin = atob(b64);
      const d = new Int8Array(bin.length);
      for (let i = 0; i < bin.length; i++) d[i] = (bin.charCodeAt(i) << 24) >> 24;
      return { toy: TOY_PC, key: Number(k), data: fromInt8(d) };
    });
  } catch {
    return [];
  }
}

/** WAV：曲を最初から最後まで（実際の時間より速く）鳴らして書き出す。progress は 0〜1 */
/** toys：曲のおもちゃ番号 → エンジンの番号（スタジオは [0, 5]、ラックは全部） */
export async function exportWav(song: Song, progress: (f: number) => void, toys?: number[], sr = 48000, customs: { toy: number; data: unknown }[] = []): Promise<void> {
  const [L, R] = await renderMix(song, progress, toys, sr, customs);
  download(encodeWav([L], sr, [R]), `${safeName(song)}.wav`);
}

/** 圧縮した音声（M4A、使えなければ OGG）：WAV と同じ音を、約 1/8 の大きさで。曲を作る分が 8 割、圧縮が 2 割の進み具合 */
export async function exportCompressed(song: Song, progress: (f: number) => void, toys?: number[], sr = 48000, customs: { toy: number; data: unknown }[] = []): Promise<void> {
  if (!(await compressedFormat(sr))) throw new Error('このブラウザでは圧縮した書き出しができません（WAV を使ってください）');
  const [L, R] = await renderMix(song, (f) => progress(f * 0.8), toys, sr, customs);
  const c = await encodeCompressed(L, R, sr, (f) => progress(0.8 + f * 0.2));
  download(c.blob, `${safeName(song)}.${c.ext}`);
}

/** 曲を最初から最後まで、仕上げ・音量合わせまでした左右の波形（画面とは別の流れで） */
function renderMix(song: Song, progress: (f: number) => void, toys?: number[], sr = 48000, customs: { toy: number; data: unknown }[] = []): Promise<[Float32Array, Float32Array]> {
  return new Promise((resolve, reject) => {
    const w = new RenderWorker();
    w.onmessage = (e: MessageEvent<{ type: 'progress'; f: number } | { type: 'done'; data: Float32Array; dataR: Float32Array }>) => {
      if (e.data.type === 'progress') { progress(e.data.f); return; }
      w.terminate();
      resolve([e.data.data, e.data.dataR]);
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ song: JSON.parse(JSON.stringify(song)), sr, toys, userSamples: userSamples(), customs });
  });
}

/**
 * 楽器ごとの WAV（ステム）を ZIP にまとめて書き出す。曲で使っているおもちゃを 1 台ずつソロにして、仕上げを通さず 32bit 浮動小数で。
 * names：曲の中のおもちゃ番号 → 名前。ほかの音楽ソフトで並べると、どれも曲の頭から始まる（そろう）
 */
export function exportStems(song: Song, progress: (f: number) => void, names: string[], toys?: number[], sr = 48000, customs: { toy: number; data: unknown }[] = []): Promise<void> {
  const used = usedToys(song, names.length);
  return new Promise((resolve, reject) => {
    if (!used.length) { reject(new Error('音符の入ったトラックがありません')); return; }
    const w = new RenderWorker();
    const files: { name: string; data: Blob }[] = [];
    type Msg = { type: 'progress'; f: number } | { type: 'stem'; toy: number; data: Float32Array; dataR: Float32Array } | { type: 'stemsDone' };
    w.onmessage = async (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.type === 'progress') { progress(m.f); return; }
      if (m.type === 'stem') {
        const nm = names[m.toy].replace(/[\\/:*?"<>|]/g, '_');
        files.push({ name: `${String(files.length + 1).padStart(2, '0')} ${nm}.wav`, data: encodeWavFloat(m.data, m.dataR, sr) });
        return;
      }
      w.terminate();
      download(await makeZip(files), `${safeName(song)} (stems).zip`);
      resolve();
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ song: JSON.parse(JSON.stringify(song)), sr, toys, userSamples: userSamples(), customs, stems: used });
  });
}

/** MIDI：Standard MIDI File（トイPC = ch1、TELEKEY = ch6） */
export function exportMidi(song: Song, midiToys: MidiToy[] = STUDIO_MIDI): void {
  const bytes = songToMidi(song, midiToys);
  download(new Blob([bytes], { type: 'audio/midi' }), `${safeName(song)}.mid`);
}

export interface CompositorSource {
  song(): Song;
  beat(): number;
  section(): string;
  tele: HTMLCanvasElement | null; // TELEKEY のモニター（WebGL）。並べていなければ null
  lcd: HTMLCanvasElement | null; // トイPC の液晶
  /** TELEKEY・トイPC が何台目か（無ければ -1） */
  teleIndex?: number;
  lcdIndex?: number;
  /** 並べたおもちゃの名前（熱のメーターに出す） */
  names?: string[];
  heat(toy: number): number;
  crashed(toy: number): boolean;
}

/**
 * 映像込み WebM 用の画面（1280×720）：左に TELEKEY のモニター、右にトイPC の液晶・セクション名・熱、
 * 下に曲全体の縮図と再生位置。draw() を毎フレーム呼ぶ
 */
export function makeCompositor(src: CompositorSource): { canvas: HTMLCanvasElement; draw(): void } {
  const W = 1280, H = 720;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  // 曲の縮図は曲が変わったときだけ描き直す
  let overview: HTMLCanvasElement | null = null;
  let overviewOf: Song | null = null;
  const OV_Y = 640, OV_H = 64;
  const drawOverview = (song: Song) => {
    const c = document.createElement('canvas');
    c.width = W - 40;
    c.height = OV_H;
    const o = c.getContext('2d')!;
    o.fillStyle = '#16131a';
    o.fillRect(0, 0, c.width, OV_H);
    const len = songBeats(song);
    const rows = song.tracks.length || 1;
    const rh = OV_H / rows;
    song.tracks.forEach((tr, i) => {
      o.fillStyle = `hsl(${(i * 67 + 200) % 360} 70% 58%)`;
      for (const n of tr.notes) o.fillRect((n.start / len) * c.width, i * rh + 1, Math.max(1, (n.len / len) * c.width), Math.max(1, rh - 2));
    });
    (song.sections ?? []).forEach((s) => {
      const x = (s.start / len) * c.width;
      o.fillStyle = 'rgba(255,224,102,.8)';
      o.fillRect(x, 0, 2, OV_H);
    });
    return c;
  };
  const draw = () => {
    const song = src.song();
    const beat = src.beat();
    if (overviewOf !== song) { overview = drawOverview(song); overviewOf = song; }
    g.fillStyle = '#0d0b10';
    g.fillRect(0, 0, W, H);
    // ---- TELEKEY のモニター ----
    const tw = 800, th = 600;
    g.fillStyle = '#2a2823';
    g.fillRect(16, 16, tw + 16, th + 16);
    if (src.tele) g.drawImage(src.tele, 24, 24, tw, th);
    else {
      // TELEKEY を並べていないとき：曲名とセクション名を大きく
      g.fillStyle = '#16131a';
      g.fillRect(24, 24, tw, th);
      g.fillStyle = '#ff5a4f';
      g.font = '700 44px sans-serif';
      g.fillText(song.title ?? 'BENT TOY STUDIO', 60, 140);
      g.fillStyle = '#ffe066';
      g.font = '700 80px sans-serif';
      g.fillText(src.section() || ' ', 60, 330);
      g.fillStyle = '#9dff7a';
      g.font = '60px monospace';
      g.fillText(`BAR ${Math.floor(beat / 4) + 1}.${Math.floor(beat % 4) + 1}`, 60, 460);
    }
    // ---- トイPC の液晶 ----
    const lx = 860, ly = 24, lw = 396, lh = src.lcd ? Math.round((396 * src.lcd.height) / Math.max(1, src.lcd.width)) : 0;
    if (src.lcd) {
      g.fillStyle = '#e8dcc0';
      g.fillRect(lx - 8, ly - 8, lw + 16, lh + 16);
      g.imageSmoothingEnabled = false;
      g.drawImage(src.lcd, lx, ly, lw, lh);
      g.imageSmoothingEnabled = true;
    }
    // クラッシュ中
    const crashBox = (x: number, y: number, w: number, h: number) => {
      g.fillStyle = 'rgba(0, 20, 170, .6)';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#fff';
      g.font = '700 22px monospace';
      g.fillText('*** SYSTEM HALTED ***', x + w / 2 - 140, y + h / 2);
    };
    const ti = src.teleIndex ?? 1, li = src.lcdIndex ?? 0;
    if (ti >= 0 && src.crashed(ti)) crashBox(24, 24, tw, th);
    if (src.lcd && li >= 0 && src.crashed(li)) crashBox(lx, ly, lw, lh);
    // ---- 文字 ----
    let y = ly + lh + 50;
    g.fillStyle = '#ffe066';
    g.font = '700 30px sans-serif';
    g.fillText(src.section() || ' ', lx, y);
    y += 40;
    g.fillStyle = '#9dff7a';
    g.font = '24px monospace';
    const sec = (beat * 60) / song.bpm;
    g.fillText(`BAR ${Math.floor(beat / 4) + 1}.${Math.floor(beat % 4) + 1}   ${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`, lx, y);
    y += 44;
    (src.names ?? ['BLIPPY BOOK 30', 'TELEKEY TK-6']).forEach((name, toy) => {
      g.fillStyle = '#bbb';
      g.font = '14px monospace';
      g.fillText(`${name}  HEAT`, lx, y);
      g.fillStyle = '#2c2732';
      g.fillRect(lx, y + 6, lw, 9);
      g.fillStyle = '#ff5a2a';
      g.fillRect(lx, y + 6, lw * Math.min(1, src.heat(toy)), 9);
      y += 32;
    });
    // 今鳴っている音符の数（トラックごとの光）
    y += 6;
    song.tracks.forEach((tr, i) => {
      const on = !tr.mute && tr.notes.some((n) => n.start <= beat && beat < n.start + n.len);
      g.fillStyle = on ? `hsl(${(i * 67 + 200) % 360} 80% 60%)` : '#2c2732';
      g.fillRect(lx + (i % 6) * 66, y + Math.floor(i / 6) * 34, 60, 26);
      g.fillStyle = on ? '#111' : '#888';
      g.font = '12px sans-serif';
      g.fillText((tr.name ?? `T${i + 1}`).slice(0, 6), lx + (i % 6) * 66 + 4, y + Math.floor(i / 6) * 34 + 17);
      void trackToy;
    });
    // ---- 曲の縮図と再生位置 ----
    if (overview) g.drawImage(overview, 20, OV_Y);
    const px = 20 + (beat / songBeats(song)) * (W - 40);
    g.fillStyle = '#7dff6a';
    g.fillRect(px, OV_Y - 4, 3, OV_H + 8);
    g.fillStyle = '#ff5a4f';
    g.font = '700 16px monospace';
    g.fillText(`${song.title ?? ''}  —  BENT TOY STUDIO`, 20, H - 6);
  };
  return { canvas, draw };
}
