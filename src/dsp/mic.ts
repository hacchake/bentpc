// マイクで録った音を、おもちゃの ROM と同じ 8kHz・8bit の波形にする
import { CHIP_RATE, normalize } from './speech';
import { quantize8 } from './tones';

/** hostRate の生音声を 8kHz に間引き、前後の無音を切り、正規化・量子化する。短すぎたら null */
export function toChipSample(raw: Float32Array, hostRate: number): Float32Array | null {
  const ratio = hostRate / CHIP_RATE;
  const n = Math.floor(raw.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // 区間平均（簡易ローパス）
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += raw[j];
    out[i] = s / (b - a);
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak < 0.005) return null;
  const th = peak * 0.08;
  let st = 0, en = n - 1;
  while (st < n && Math.abs(out[st]) < th) st++;
  while (en > st && Math.abs(out[en]) < th) en--;
  st = Math.max(0, st - 80);
  en = Math.min(n - 1, en + 400);
  if (en - st < CHIP_RATE * 0.1) return null;
  return quantize8(normalize(out.slice(st, en + 1), 0.9));
}

export const toInt8 = (b: Float32Array) => Int8Array.from(b, (v) => Math.round(v * 127));
export const fromInt8 = (b: Int8Array) => Float32Array.from(b, (v) => v / 127);
