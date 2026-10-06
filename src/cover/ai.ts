// AI で楽器ごとに分ける（Demucs v4 = htdemucs、MIT）。MANEKKO の「AI SEP」を入れたときだけ、解析の Worker の中で使う。
// 動かす土台（onnxruntime-web）は使うときだけ CDN から読み込み、モデル（約 172MB）は初回だけダウンロードしてこのブラウザに保存する。
// 曲の音はどこにも送らない（ダウンロードするのは土台とモデルだけ）。WebGPU があれば速く、無ければ WASM（遅い）
import { DemucsProcessor } from 'demucs-web';
import { to22k } from './vocal';

const ORT_VER = '1.30.0';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
export const AI_MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const CACHE = 'bent-ai-models';
const SR = 44100;

export interface AiStems { vocal: Float32Array; drums: Float32Array; bass: Float32Array; other: Float32Array }

/** モデルを、保存してあればそこから、無ければダウンロードして保存（progress は 0〜1） */
async function loadModel(progress: (f: number) => void): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { /* 保存できないブラウザ：毎回ダウンロード */ }
  const hit = await cache?.match(AI_MODEL_URL);
  if (hit) { progress(1); return hit.arrayBuffer(); }
  const res = await fetch(AI_MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`モデルをダウンロードできませんでした（${res.status}）`);
  const total = Number(res.headers.get('Content-Length')) || 180_000_000;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    progress(Math.min(1, got / total));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  try { await cache?.put(AI_MODEL_URL, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* 空きが足りない：次もダウンロード */ }
  return buf.buffer;
}

/** 44.1kHz に（こもらせてから間を補う） */
function to44k(x: Float32Array, sr: number): Float32Array {
  if (sr === SR) return x;
  const y = x.slice();
  if (sr > SR) {
    const fc = SR * 0.45, w = (2 * Math.PI * fc) / sr, al = Math.sin(w) / Math.SQRT2, c = Math.cos(w), a0 = 1 + al;
    const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
    for (let pass = 0; pass < 2; pass++) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; y[i] = v; }
    }
  }
  const out = new Float32Array(Math.floor((y.length * SR) / sr)), k = sr / SR;
  for (let i = 0; i < out.length; i++) { const p = i * k, i0 = Math.floor(p), f = p - i0; out[i] = y[i0] * (1 - f) + (y[i0 + 1] ?? 0) * f; }
  return out;
}

/** 左右の音 → 歌・ドラム・ベース・その他（どれも 22.05kHz のモノラル。今の方式と同じ形）。progress は 0〜1 と、いまやっていること */
export async function aiSeparate(ch: Float32Array[], sr: number, progress: (f: number, what: string) => void): Promise<AiStems> {
  progress(0, 'AI の準備をしています');
  const ort = await import(/* @vite-ignore */ `${ORT_BASE}ort.all.min.mjs`);
  ort.env.wasm.wasmPaths = ORT_BASE;
  const model = await loadModel((f) => progress(f * 0.3, 'AI のモデルを読み込んでいます（初回だけ・約 170MB）'));
  const useGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const proc = new DemucsProcessor({
    ort,
    sessionOptions: { executionProviders: useGpu ? ['webgpu', 'wasm'] : ['wasm'] },
    onProgress: (p: { progress?: number } | number) => progress(0.3 + 0.7 * (typeof p === 'number' ? p : p?.progress ?? 0), 'AI で楽器ごとに分けています'),
  });
  await proc.loadModel(model);
  const L = to44k(ch[0], sr), R = to44k(ch[1] ?? ch[0], sr);
  const r = await proc.separate(L, R);
  const mono = (s: { left: Float32Array; right: Float32Array }) => to22k(Float32Array.from(s.left, (v, i) => (v + s.right[i]) / 2), SR);
  progress(1, 'AI で楽器ごとに分けました');
  return { vocal: mono(r.vocals), drums: mono(r.drums), bass: mono(r.bass), other: mono(r.other) };
}
