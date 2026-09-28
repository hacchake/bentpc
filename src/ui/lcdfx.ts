// 液晶のグリッチ。音のグリッチと同じ状態（有効な組み合わせ 25bit・乱数の状態・熱）から模様を作る。
// 組み合わせ c = BASE*5 + ボタン ごとに違う崩れ方をする。

import { Rng } from '../dsp/rng';
import { LETTER_KEYS } from '../params';
import { Bitmap, LCD_H, LCD_W } from './lcd';

export interface LcdFx {
  combos: number;
  heat: number;
  seed: number;
  misread: number;
}

const tmp = new Uint8Array(LCD_W * LCD_H);

/** VOICE 系で文字とキャラを「誤読」したものに差し替える（描く前に呼ぶ） */
export function misreadOverride<T extends { big?: string; sprite?: string }>(d: T, fx: LcdFx): T {
  if (!(fx.combos & 0b111 << 20) || fx.misread < 0) return d;
  const l = LETTER_KEYS[fx.misread];
  return { ...d, big: l, sprite: l };
}

/** 描いたあとのビットマップを崩す。frame は画面の描画回数 */
export function applyFx(bm: Bitmap, fx: LcdFx, frame: number, prev: Uint8Array): void {
  const px = bm.px;
  const rng = new Rng((fx.seed ^ Math.imul(frame, 0x9e3779b1)) >>> 0);
  const W = LCD_W, H = LCD_H;
  const row = (y: number) => y * W;
  const copyRow = (from: number, to: number) => { if (from >= 0 && from < H && to >= 0 && to < H) px.copyWithin(row(to), row(from), row(from) + W); };
  const on = (c: number) => (fx.combos & (1 << c)) !== 0;

  // ---- 熱による前ぶれ：ときどき 1 行ずれる ----
  if (fx.heat > 0.3 && rng.chance((fx.heat - 0.3) * 0.5)) {
    const y = rng.int(H);
    const s = rng.int(16) - 8;
    tmp.set(px.subarray(row(y), row(y) + W));
    for (let x = 0; x < W; x++) px[row(y) + x] = tmp[(x - s + W) % W];
  }
  if (!fx.combos) return;

  // ---- ADDR：行がずれる・重なる ----
  if (on(0)) { const y0 = rng.int(H - 8), h = 4 + rng.int(10), off = rng.int(H); for (let j = 0; j < h; j++) copyRow((off + j) % H, y0 + j); }
  if (on(1)) { const y0 = rng.int(H - 6), h = 2 + rng.int(4); for (let y = 0; y < H; y++) if (y % h !== 0 || rng.chance(0.3)) copyRow(y0 + (y % h), y); }
  if (on(2)) { const s = rng.int(H); tmp.set(px); for (let y = 0; y < H; y++) px.set(tmp.subarray(row((y + s) % H), row((y + s) % H) + W), row(y)); }
  if (on(3)) { const b = 8 << rng.int(2); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x & b) !== 0) px[row(y) + x] = px[row(y) + (x & ~b)]; }
  if (on(4)) { const y0 = rng.int(H - 10), h = 6 + rng.int(20); for (let y = y0; y < Math.min(H, y0 + h); y++) { tmp.set(px.subarray(row(y), row(y) + W)); for (let x = 0; x < W; x++) px[row(y) + x] = tmp[W - 1 - x]; } }
  // ---- DATA：ドットが化ける ----
  if (on(5)) for (let i = 0; i < 300; i++) px[rng.int(W * H)] ^= 1;
  if (on(6)) for (let y = 0; y < H; y++) for (let x = (y & 1); x < W; x += 2) px[row(y) + x] = 0;
  if (on(7)) for (let k = 0; k < 3; k++) px.fill(1, row(rng.int(H)), row(rng.int(H)) + W);
  if (on(8)) for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 8) for (let i = 0; i < 4; i++) { const a = row(y) + x + i; const t = px[a]; px[a] = px[a + 4]; px[a + 4] = t; }
  if (on(9)) { const y0 = rng.int(H), h = 3 + rng.int(20); px.fill(0, row(y0), Math.min(W * H, row(y0 + h))); }
  // ---- CLOCK：横に伸びる・波打つ ----
  if (on(10)) for (let y = 0; y < H; y++) { tmp.set(px.subarray(row(y), row(y) + W)); for (let x = 0; x < W; x++) px[row(y) + x] = tmp[x >> 1]; }
  if (on(11)) for (let y = 0; y < H; y++) { tmp.set(px.subarray(row(y), row(y) + W)); for (let x = 0; x < W; x++) px[row(y) + x] = tmp[(x * 2) % W]; }
  if (on(12)) { const ph = rng.next() * 6; for (let y = 0; y < H; y++) { const s = Math.round(Math.sin(y * 0.25 + ph) * 5); tmp.set(px.subarray(row(y), row(y) + W)); for (let x = 0; x < W; x++) px[row(y) + x] = tmp[(x - s + W) % W]; } }
  if (on(13)) { for (let y = 0; y < H; y++) { const s = ((y >> 3) * (3 + rng.int(3))) % 24 - 12; tmp.set(px.subarray(row(y), row(y) + W)); for (let x = 0; x < W; x++) px[row(y) + x] = tmp[(x - s + W) % W]; } }
  if (on(14) && rng.chance(0.6)) px.set(prev);
  // ---- BEEP：反転・しま模様 ----
  if (on(15) && rng.chance(0.5)) for (let i = 0; i < px.length; i++) px[i] ^= 1;
  if (on(16)) { const w = 2 + rng.int(6); for (let y = 0; y < H; y++) if (((y / w) | 0) % 2) for (let x = 0; x < W; x++) px[row(y) + x] ^= 1; }
  if (on(17)) { const w = 1 + rng.int(4); for (let x = 0; x < W; x++) if (((x / w) | 0) % 3 === 0 && rng.chance(0.5)) for (let y = 0; y < H; y++) px[row(y) + x] |= (y + x) & 1; }
  if (on(18)) for (let i = 0; i < px.length; i++) if (rng.chance(0.18)) px[i] = 1;
  if (on(19)) for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) if (px[row(y) + x - 1] && rng.chance(0.7)) px[row(y) + x] = 1;
  // ---- VOICE：キャラが崩れる ----
  if (on(21)) { tmp.set(px); for (let t = 0; t < 12; t++) { const sx = 64 + rng.int(8) * 8, sy = 12 + rng.int(4) * 8, dx = 64 + rng.int(8) * 8, dy = 12 + rng.int(4) * 8; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) if (dx + i < W && sx + i < W) px[row(dy + j) + dx + i] = tmp[row(sy + j) + sx + i]; } }
  if (on(22)) for (let k = 0; k < 6; k++) { const x = rng.int(W - 6), y = rng.int(H - 8); for (let j = 0; j < 7; j++) for (let i = 0; i < 5; i++) px[row(y + j) + x + i] = rng.chance(0.5) ? 1 : 0; }
  if (on(23)) { const s = rng.int(7) - 3; tmp.set(px); for (let y = 0; y < H; y++) for (let x = 60; x < W; x++) px[row(y) + x] = tmp[row(y) + Math.max(60, Math.min(W - 1, x + s))]; }
  if (on(24) && rng.chance(0.3)) { px.fill(0); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[row(y) + x] = ((x >> 2) + (y >> 2)) & 1; }
}
