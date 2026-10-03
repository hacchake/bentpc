// 1bit ドット液晶（128x64）。エンジンから届く DisplayState を絵にする。
// まず 1bit のビットマップに描き、それを「ドット液晶らしく」拡大してキャンバスへ出す。
// フェーズ3のグリッチ（ドットずれ・行重複・反転など）は、このビットマップに後処理で掛ける。

import type { DisplayState } from '../dsp/firmware';
import { MODE_NAMES } from '../params';
import { GLYPH_H, GLYPH_W, glyph } from './font';
import { SPRITE_SIZE, sprite } from './sprites';

export const LCD_W = 128;
export const LCD_H = 64;
const DOT = 4; // 1 ドット = 4px（3px 点灯 + 1px すき間）

export class Bitmap {
  readonly px = new Uint8Array(LCD_W * LCD_H);
  clear(v = 0): void {
    this.px.fill(v);
  }
  set(x: number, y: number, v = 1): void {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= LCD_W || y >= LCD_H) return;
    this.px[y * LCD_W + x] = v;
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= LCD_W || y >= LCD_H) return 0;
    return this.px[y * LCD_W + x];
  }
  rect(x: number, y: number, w: number, h: number, v = 1): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, v);
  }
  frame(x: number, y: number, w: number, h: number): void {
    for (let i = 0; i < w; i++) { this.set(x + i, y); this.set(x + i, y + h - 1); }
    for (let j = 0; j < h; j++) { this.set(x, y + j); this.set(x + w - 1, y + j); }
  }
  /** 文字列を描く。scale 倍に拡大。戻り値は幅 */
  text(s: string, x: number, y: number, scale = 1, v = 1): number {
    let cx = x;
    for (const ch of s) {
      const g = glyph(ch);
      for (let r = 0; r < GLYPH_H; r++)
        for (let c = 0; c < GLYPH_W; c++)
          if (g[r][c]) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.set(cx + c * scale + sx, y + r * scale + sy, v);
      cx += (GLYPH_W + 1) * scale;
    }
    return cx - x;
  }
  textWidth(s: string, scale = 1): number {
    return [...s].length * (GLYPH_W + 1) * scale - scale;
  }
  sprite(name: string, x: number, y: number, scale = 2): void {
    const sp = sprite(name);
    if (!sp) return;
    for (let r = 0; r < SPRITE_SIZE; r++)
      for (let c = 0; c < SPRITE_SIZE; c++)
        if (sp[r][c]) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.set(x + c * scale + sx, y + r * scale + sy);
  }
}

/** 液晶の中身を描く（時間 t 秒はアニメーション用、since は表示が変わってからの秒数） */
export function drawDisplay(bm: Bitmap, d: DisplayState, t: number, since: number): void {
  bm.clear();
  if (d.screen === 'off') return;
  if (d.screen === 'boot') return drawBoot(bm, since);

  // 上段：モード名と電池マーク
  const mode = MODE_NAMES[d.mode] ?? '';
  bm.text(`MODE ${d.mode + 1}`, 2, 1);
  bm.text(mode, LCD_W - bm.textWidth(mode) - 13, 1);
  bm.frame(LCD_W - 10, 1, 8, 7);
  bm.rect(LCD_W - 2, 3, 1, 3);
  bm.rect(LCD_W - 9, 2, 3, 5);
  for (let x = 0; x < LCD_W; x += 2) bm.set(x, 10);

  if (d.screen === 'idle') {
    const bob = Math.round(Math.sin(t * 4) * 1.5);
    bm.sprite('BLIP', 48, 13 + bob, 2);
    scrollText(bm, d.text ?? '', 55, since);
    return;
  }

  drawShow(bm, d, t, since);
}

// ================= キーを押した後の演出 =================
// 押した瞬間：画面がピカッと反転 → 背景に光が広がる（文字ごとに 4 種類）→ 大きな文字が飛び出して弾む（立体の影つき）
// → キャラが右から弾んで登場 → キラキラと紙吹雪 → 下の言葉がタイプライターのように 1 文字ずつ。その後も文字は揺れ、キャラは跳ねる。
const CX = 30, CY = 32; // 大きな文字の中心
const easeOutBack = (k: number) => { const c = 1.9; const x = Math.min(1, Math.max(0, k)) - 1; return 1 + (c + 1) * x * x * x + c * x * x; };
/** 文字ごとに決まる乱数（同じ文字なら毎回同じ演出） */
function seeded(n: number): () => number {
  let s = (n * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function drawShow(bm: Bitmap, d: DisplayState, t: number, since: number): void {
  const big = d.big ?? '';
  const code = [...big].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) + (d.sprite ?? '').length * 13;
  // 光・キラキラ・紙吹雪は別々の乱数（光が消えてもキラキラの場所が変わらないように）
  const rnd = seeded(code), spk = seeded(code + 1), cf = seeded(code + 2);
  const style = code % 4;

  // ---- 1. 背景の光（押してから 0.6 秒） ----
  if (since < 0.6) burst(bm, style, since, rnd);

  // ---- 2. 大きな文字：飛び出して弾む → ゆらゆら ----
  const full = big.length <= 1 ? 4 : big.length === 2 ? 3 : 2;
  const pop = since < 0.32 ? Math.max(0.3, easeOutBack(since / 0.32)) : 1;
  const sc = full * pop;
  const sway = since > 0.32 ? Math.round(Math.sin((since - 0.32) * 3.2) * 1.2) : 0;
  const w = big.length * (GLYPH_W + 1) * sc - sc, h = GLYPH_H * sc;
  const x0 = CX - w / 2, y0 = CY - h / 2 + sway;
  // 文字の周りは光を消して、文字をくっきり見せる
  if (since < 0.6 && big) bm.rect(Math.floor(x0) - 2, Math.floor(y0) - 2, Math.ceil(w) + 6, Math.ceil(h) + 6, 0);
  if (since > 0.12) scaledText(bm, big, x0 + 2, y0 + 2, sc, 2); // 立体の影（網かけ）
  scaledText(bm, big, x0, y0, sc, 1);
  // 文字の下の線が真ん中から伸びる
  if (since > 0.2 && big) {
    const k = Math.min(1, (since - 0.2) / 0.2), half = Math.round(((w + 6) / 2) * k);
    for (let x = CX - half; x <= CX + half; x++) bm.set(x, Math.round(CY + h / 2 + 3 + sway));
  }

  // ---- 3. キャラ：右から弾んで登場 → ときどきぴょんと跳ねる ----
  if (d.sprite) {
    const k = Math.min(1, Math.max(0, (since - 0.06) / 0.34));
    const sx = Math.round(LCD_W + 4 - (LCD_W + 4 - 74) * easeOutBack(k));
    const ph = (since - 0.5) % 1.3;
    const hop = since > 0.5 && ph < 0.36 ? Math.round(Math.sin((ph / 0.36) * Math.PI) * 5) : 0;
    // 着地したとき：キャラの周りに輪がポンと広がる
    if (since > 0.36 && since < 0.62) {
      const rr = 16 + (since - 0.36) * 60;
      for (let a = 0; a < 90; a += since > 0.5 ? 2 : 1) bm.set(sx + 16 + Math.cos((a / 90) * Math.PI * 2) * rr, 29 + Math.sin((a / 90) * Math.PI * 2) * rr * 0.7);
    }
    if (since < 0.62) bm.rect(sx - 1, 12 - hop, 34, 34, 0);
    bm.sprite(d.sprite, sx, 13 - hop, 2);
    // 着地の砂ぼこり
    if (since > 0.5 && ph >= 0.36 && ph < 0.5) {
      const r = Math.round((ph - 0.36) * 60);
      for (const side of [-1, 1]) { bm.set(sx + 16 + side * (14 + r), 45); bm.set(sx + 16 + side * (12 + r), 44); }
    }
    if (k < 1 && k > 0.2) for (let i = 1; i < 4; i++) bm.set(sx + 34 + i * 4, 20 + i * 4); // 動きの線
  }

  // ---- 4. キラキラ（ずっと、またたく）と紙吹雪（最初の 1.6 秒） ----
  for (let i = 0; i < 6; i++) {
    const px = Math.round(4 + spk() * 120), py = Math.round(14 + spk() * 36), phase = spk() * 6;
    if (Math.abs(px - CX) < w / 2 + 3 && Math.abs(py - CY) < h / 2 + 3) continue; // 文字の上には出さない
    const tw = Math.sin(t * 5 + phase);
    if (since > 0.15 && tw > 0.2) sparkle(bm, px, py, tw > 0.8 ? 2 : 1);
  }
  if (since < 1.6) for (let i = 0; i < 18; i++) {
    const vx = (cf() - 0.5) * 70, vy = -20 - cf() * 40, x00 = CX + (cf() - 0.5) * 20, y00 = CY;
    const tt = since - cf() * 0.15;
    if (tt <= 0) continue;
    const x = x00 + vx * tt + Math.sin(tt * 9 + i) * 2, y = y00 + vy * tt + 70 * tt * tt;
    if (y > 12 && y < 52) { bm.set(x, y); if (i % 3 === 0) bm.set(x + 1, y); if (i % 4 === 1) bm.set(x, y + 1); }
  }

  // ---- 5. 記号 ----
  if (d.mark === 'ok') {
    const r = 20 * easeOutBack(Math.min(1, since / 0.3));
    for (let a = 0; a < 80; a++) bm.set(CX + Math.cos((a / 80) * Math.PI * 2) * r, CY + Math.sin((a / 80) * Math.PI * 2) * r);
  } else if (d.mark === 'ng') {
    const sh = since < 0.4 ? Math.round(Math.sin(since * 60) * 3) : 0; // ぶるぶる
    for (let i = -14; i <= 14; i++) { bm.set(CX + i + sh, CY + i); bm.set(CX + i + sh, CY - i); bm.set(CX + 1 + i + sh, CY + i); bm.set(CX + 1 + i + sh, CY - i); }
  } else if (d.mark === 'q' && Math.floor(t * 2) % 2 === 0) {
    bm.text('?', 112, 13, 2);
  }

  // ---- 6. 下の言葉：タイプライター → 長ければ流れる ----
  typeText(bm, d.text ?? '', 55, since - 0.15);

  // ---- 7. 押した瞬間のピカッ（中身だけ反転） ----
  if (since < 0.05) for (let y = 11; y < LCD_H; y++) for (let x = 0; x < LCD_W; x++) bm.px[y * LCD_W + x] ^= 1;
}

/** 背景の光（4 種類）：放射・広がる輪・回るひし形・うずまき */
function burst(bm: Bitmap, style: number, s: number, rnd: () => number): void {
  const k = s / 0.6, r = 6 + k * 70;
  const thin = k > 0.5 ? 2 : 1; // 後半は点を間引いて消えていく
  if (style === 0) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.1;
      for (let q = r * 0.4; q < r; q += 1.2 * thin) { const x = CX + Math.cos(a) * q, y = CY + Math.sin(a) * q * 0.8; bm.set(x, y); if (thin === 1) bm.set(x + 1, y); }
    }
  } else if (style === 1) {
    for (const rr of [r, r - 1.5, r * 0.65, r * 0.35]) for (let a = 0; a < 160; a += thin) bm.set(CX + Math.cos((a / 160) * Math.PI * 2) * rr, CY + Math.sin((a / 160) * Math.PI * 2) * rr * 0.8);
  } else if (style === 2) {
    const rot = s * 6;
    for (const rr of [r, r - 1.5, r * 0.6, r * 0.6 - 1.5]) for (let i = 0; i < 4; i++) {
      const a1 = rot + (i * Math.PI) / 2, a2 = rot + ((i + 1) * Math.PI) / 2;
      for (let q = 0; q <= 1; q += 0.02 * thin) bm.set(CX + Math.cos(a1) * rr * (1 - q) + Math.cos(a2) * rr * q, CY + (Math.sin(a1) * rr * (1 - q) + Math.sin(a2) * rr * q) * 0.8);
    }
  } else {
    for (const arm of [0, Math.PI]) for (let a = 0; a < 5 * Math.PI; a += 0.05 * thin) { const rr = (a / (5 * Math.PI)) * r * 1.2; bm.set(CX + Math.cos(a + arm + s * 10) * rr, CY + Math.sin(a + arm + s * 10) * rr * 0.8); }
  }
}

/** 4 本の光のキラキラ */
function sparkle(bm: Bitmap, x: number, y: number, size: number): void {
  bm.set(x, y);
  for (let i = 1; i <= size; i++) { bm.set(x + i, y); bm.set(x - i, y); bm.set(x, y + i); bm.set(x, y - i); }
}

/** 文字を好きな大きさ（小数でも）で描く。mode 2 = 網かけ（影） */
function scaledText(bm: Bitmap, s: string, x: number, y: number, sc: number, mode: 1 | 2): void {
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    const W = Math.ceil(GLYPH_W * sc), H = Math.ceil(GLYPH_H * sc);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const gx = Math.floor(i / sc), gy = Math.floor(j / sc);
      if (gx < GLYPH_W && gy < GLYPH_H && g[gy][gx]) {
        const px = Math.round(cx + i), py = Math.round(y + j);
        if (mode === 1) bm.set(px, py, 1);
        else if ((px + py) % 2 === 0 && !bm.get(px, py)) bm.set(px, py, 1);
      }
    }
    cx += (GLYPH_W + 1) * sc;
  }
}

/** タイプライター：1 秒に 28 文字ずつ出す（点滅するカーソルつき）。出し終わって長ければ流れる */
function typeText(bm: Bitmap, s: string, y: number, since: number): void {
  if (since < 0) return;
  const n = Math.min([...s].length, Math.floor(since * 28));
  if (n >= [...s].length) { scrollText(bm, s, y, since - [...s].length / 28); return; }
  const part = [...s].slice(0, n).join('');
  const w = bm.textWidth(s);
  const x = w <= LCD_W - 4 ? (LCD_W - w) / 2 : 2;
  const pw = bm.text(part, x, y);
  if (Math.floor(since * 10) % 2 === 0) bm.rect(x + pw + 1, y, 4, 7);
}

function scrollText(bm: Bitmap, s: string, y: number, since: number): void {
  const w = bm.textWidth(s);
  if (w <= LCD_W - 4) {
    bm.text(s, (LCD_W - w) / 2, y);
  } else {
    const span = w - (LCD_W - 4);
    const off = Math.min(span, Math.max(0, (since - 0.6) * 30));
    bm.text(s, 2 - off, y);
  }
}

function drawBoot(bm: Bitmap, s: number): void {
  if (s < 0.35) {
    // 液晶テスト：全点灯
    bm.clear(1);
  } else if (s < 0.8) {
    // 市松模様がワイプ
    const k = (s - 0.35) / 0.45;
    for (let y = 0; y < LCD_H; y++) {
      const edge = k * LCD_W * 1.3 - y * 0.3;
      for (let x = 0; x < LCD_W; x++) bm.set(x, y, x < edge ? ((x >> 2) + (y >> 2)) % 2 : 1);
    }
  } else {
    const k = Math.min(1, (s - 0.8) / 0.4);
    const x = Math.round(-60 + k * 64);
    bm.sprite('BLIP', x, 14, 2);
    const title = 'BLIPPY';
    const tx = LCD_W - Math.round(k * 64);
    bm.text(title, tx, 16, 2);
    bm.text('BOOK 30', tx + 4, 36, 1);
    if (s > 1.3) for (let i = 0; i < Math.min(LCD_W, (s - 1.3) * 200); i += 2) bm.set(i, 50);
  }
}

// ---- キャンバスへの描画（ドット液晶の見た目） ----
export class LcdView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private buf: Uint32Array;
  private colors: { bg: number; ghost: number; on: number; shade: number; off: number };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = LCD_W * DOT;
    canvas.height = LCD_H * DOT;
    this.ctx = canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(canvas.width, canvas.height);
    this.buf = new Uint32Array(this.img.data.buffer);
    const rgba = (r: number, g: number, b: number) => (255 << 24) | (b << 16) | (g << 8) | r; // little endian
    this.colors = {
      bg: rgba(164, 178, 150),
      ghost: rgba(154, 168, 141),
      on: rgba(28, 38, 28),
      shade: rgba(128, 141, 118),
      off: rgba(118, 128, 108),
    };
  }

  /** powered=false のときは液晶全体を暗く（バックライトなしの素の色）にする */
  paint(bm: Bitmap, powered: boolean): void {
    const W = this.canvas.width;
    const { bg, ghost, on, shade, off } = this.colors;
    const b = this.buf;
    b.fill(powered ? bg : off);
    if (!powered) {
      this.ctx.putImageData(this.img, 0, 0);
      return;
    }
    for (let y = 0; y < LCD_H; y++) {
      for (let x = 0; x < LCD_W; x++) {
        const v = bm.px[y * LCD_W + x];
        const ox = x * DOT, oy = y * DOT;
        for (let j = 0; j < DOT - 1; j++) {
          const row = (oy + j) * W + ox;
          for (let i = 0; i < DOT - 1; i++) b[row + i] = v ? on : ghost;
        }
        // 点灯ドットの影（液晶の奥行き）
        if (v) {
          const sy = oy + DOT - 1;
          if (sy < this.canvas.height) for (let i = 1; i < DOT; i++) if (b[sy * W + ox + i] !== on) b[sy * W + ox + i] = shade;
        }
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
