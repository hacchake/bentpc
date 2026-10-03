// 書き出し（DOM 非依存）：パターン・ソングを音にする（オフライン）、WAV、MIDI、プロジェクト丸ごとのファイル。
import type { BendState } from './bend';
import { SamplerEngine } from './engine';
import type { FxSlot } from './fx';
import type { Pattern, SongStep } from './seq';
import { PADS, PAD_COUNT, type PadParams, type SampleBuf } from './types';

export interface RenderSetup {
  samples: (SampleBuf | null)[];
  params: PadParams[];
  fx: FxSlot[];
  bend?: BendState;
  bpm: number;
  swing: number;
  patterns: Pattern[];
  song: SongStep[];
}

/** 曲の長さ（拍） */
export function lengthBeats(st: RenderSetup, mode: 'pattern' | 'song', ptn: number, loops = 1): number {
  if (mode === 'pattern') return st.patterns[ptn].bars * 4 * loops;
  return st.song.reduce((s, x) => s + st.patterns[x.ptn].bars * 4 * Math.max(1, x.reps), 0);
}

/**
 * パターン（loops 回）かソングを音にする。少しずつ進める（yield で進み具合 0〜1）。最後に余韻 tail 秒。
 * 同じ設定なら同じ音（ベンドの乱数もシード付き）。
 */
export function* renderOffline(st: RenderSetup, mode: 'pattern' | 'song', ptn: number, sr = 44100, loops = 1, tail = 2): Generator<number, [Float32Array, Float32Array]> {
  const e = new SamplerEngine(sr);
  e.bpm = st.bpm;
  for (let i = 0; i < PAD_COUNT; i++) { if (st.samples[i]) e.setSample(i, st.samples[i]); e.setParams(i, st.params[i]); }
  st.fx.forEach((f, i) => e.setFx(i, f));
  if (st.bend) e.bender.st = { ...st.bend, wires: [...st.bend.wires] };
  st.patterns.forEach((p, i) => e.seq.setPattern(i, p));
  e.seq.song = st.song.map((x) => ({ ...x }));
  e.seq.setSwing(st.swing);
  e.seq.metro = false;
  const beats = lengthBeats(st, mode, ptn, loops);
  const total = Math.ceil(((beats * 60) / st.bpm + tail) * sr);
  const L = new Float32Array(total), R = new Float32Array(total);
  const B = 128, l = new Float32Array(B), r = new Float32Array(B);
  e.transport(true, mode, ptn);
  const stopAt = Math.round(((beats * 60) / st.bpm) * sr);
  for (let o = 0; o < total; o += B) {
    if (o >= stopAt && e.seq.playing) { e.seq.stop(); e.stopLoops(); } // 回数が来たら止める（余韻は残す）
    e.process(null, null, l, r);
    const n = Math.min(B, total - o);
    L.set(l.subarray(0, n), o);
    R.set(r.subarray(0, n), o);
    if ((o / B) % 400 === 0) yield o / total;
  }
  return [L, R];
}

/** WAV（16bit・ステレオ） */
export function wavBytes(L: Float32Array, R: Float32Array, sr: number): Uint8Array {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    v.setInt16(o, Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), true);
    v.setInt16(o + 2, Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), true);
  }
  return new Uint8Array(buf);
}

/** パッドの音 1 つを WAV に */
export function sampleWav(s: SampleBuf): Uint8Array {
  return wavBytes(s.ch[0], s.ch[1] ?? s.ch[0], s.sr);
}

/**
 * MIDI（SMF タイプ 0）。バンク A〜J = チャンネル 1〜10、パッド 1〜16 = ノート 36〜51（パッド型の MIDI 機器と同じ）。
 * 480 分解能。パターンなら 1 回、ソングならつないだ全部。
 */
export function midiBytes(st: RenderSetup, mode: 'pattern' | 'song', ptn: number): Uint8Array {
  const PPQ = 480;
  const evs: { tick: number; data: number[] }[] = [];
  const steps = mode === 'pattern' ? [{ ptn, reps: 1 }] : st.song;
  let base = 0;
  for (const s of steps) {
    const p = st.patterns[s.ptn];
    for (let r = 0; r < Math.max(1, s.reps); r++) {
      for (const e of p.events) {
        const ch = Math.floor(e.pad / PADS) % 16, note = 36 + (e.pad % PADS);
        const on = Math.round((base + e.t) * PPQ), off = Math.round((base + e.t + Math.max(0.05, e.len)) * PPQ);
        const vel = Math.max(1, Math.min(127, Math.round(e.vel * 127)));
        evs.push({ tick: on, data: [0x90 | ch, note, vel] }, { tick: off, data: [0x80 | ch, note, 0] });
      }
      base += p.bars * 4;
    }
  }
  evs.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
  const tr: number[] = [];
  const vlq = (x: number) => { const b = [x & 0x7f]; while ((x >>= 7)) b.unshift((x & 0x7f) | 0x80); tr.push(...b); };
  const tempo = Math.round(60000000 / st.bpm);
  vlq(0); tr.push(0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
  vlq(0); tr.push(0xff, 0x58, 4, 4, 2, 24, 8);
  let last = 0;
  for (const e of evs) { vlq(e.tick - last); last = e.tick; tr.push(...e.data); }
  vlq(Math.max(0, Math.round(base * PPQ) - last)); tr.push(0xff, 0x2f, 0);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, PPQ >> 8, PPQ & 255];
  const len = tr.length;
  return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...tr]);
}

// ---------------- プロジェクト丸ごと（.paku） ----------------
// 先頭 "PAKU16" ＋ 4 バイトの長さ ＋ JSON（設定・パターン・パッドの名前など）＋ 音（16bit）を順に
export interface ProjectPad { pad: number; name: string; params: PadParams; sr: number; chs: number; len: number }
export interface ProjectFile<M> { version: 1; meta: M; pads: ProjectPad[] }

export function packProject<M>(meta: M, pads: { pad: number; name: string; params: PadParams; sample: SampleBuf | null }[]): Uint8Array {
  const list: ProjectPad[] = [];
  const pcm: Int16Array[] = [];
  for (const p of pads) {
    if (!p.sample && !p.name) continue;
    const s = p.sample;
    list.push({ pad: p.pad, name: p.name, params: p.params, sr: s?.sr ?? 0, chs: s?.ch.length ?? 0, len: s?.ch[0].length ?? 0 });
    if (s) for (const c of s.ch) pcm.push(Int16Array.from(c, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767)));
  }
  const json = new TextEncoder().encode(JSON.stringify({ version: 1, meta, pads: list } satisfies ProjectFile<M>));
  const total = 6 + 4 + json.length + pcm.reduce((s, x) => s + x.byteLength, 0);
  const out = new Uint8Array(total);
  out.set([0x50, 0x41, 0x4b, 0x55, 0x31, 0x36], 0); // PAKU16
  new DataView(out.buffer).setUint32(6, json.length, true);
  out.set(json, 10);
  let o = 10 + json.length;
  for (const a of pcm) { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o); o += a.byteLength; }
  return out;
}

export function unpackProject<M>(bytes: Uint8Array): { meta: M; pads: { pad: number; name: string; params: PadParams; sample: SampleBuf | null }[] } {
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== 'PAKU16') throw new Error('PAKU-PAKU 16 のファイルではありません');
  const jl = new DataView(bytes.buffer, bytes.byteOffset).getUint32(6, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(10, 10 + jl))) as ProjectFile<M>;
  let o = 10 + jl;
  const pads = head.pads.map((p) => {
    let sample: SampleBuf | null = null;
    if (p.len && p.chs) {
      const ch: Float32Array[] = [];
      for (let c = 0; c < p.chs; c++) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + o, p.len * 2);
        const f = new Float32Array(p.len);
        for (let i = 0; i < p.len; i++) f[i] = view.getInt16(i * 2, true) / 32767;
        ch.push(f);
        o += p.len * 2;
      }
      sample = { sr: p.sr, ch };
    }
    return { pad: p.pad, name: p.name, params: p.params, sample };
  });
  return { meta: head.meta, pads };
}
