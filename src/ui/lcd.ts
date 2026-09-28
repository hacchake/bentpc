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

  // 左：大きな文字
  const big = d.big ?? '';
  const bigScale = big.length <= 1 ? 4 : big.length === 2 ? 3 : 2;
  const bw = bm.textWidth(big, bigScale);
  const bx = 30 - bw / 2;
  const by = 32 - (GLYPH_H * bigScale) / 2;
  if (d.mark === 'dead') {
    // 死んだキー：文字が点滅してかすれる
    if (Math.floor(since * 6) % 2 === 0) bm.text(big, bx, by, bigScale);
    for (let i = 0; i < 40; i++) bm.set(bx + ((i * 37) % Math.max(1, bw)), by + ((i * 11) % 28), 0);
  } else {
    bm.text(big, bx, by, bigScale);
  }

  // 右：キャラ
  if (d.sprite) {
    const pop = since < 0.12 ? 2 : 0;
    bm.sprite(d.sprite, 74 + pop, 13 - pop, 2);
  }

  // 記号
  if (d.mark === 'ok') {
    // ○
    for (let a = 0; a < 64; a++) bm.set(30 + Math.cos((a / 64) * Math.PI * 2) * 20, 32 + Math.sin((a / 64) * Math.PI * 2) * 20);
  } else if (d.mark === 'ng') {
    for (let i = -14; i <= 14; i++) { bm.set(30 + i, 32 + i); bm.set(30 + i, 32 - i); bm.set(31 + i, 32 + i); bm.set(31 + i, 32 - i); }
  } else if (d.mark === 'q' && Math.floor(t * 2) % 2 === 0) {
    bm.text('?', 112, 13, 2);
  }

  scrollText(bm, d.text ?? '', 55, since);
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
