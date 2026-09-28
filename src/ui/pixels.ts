// ドット絵を小さなキャンバスにする（キーの絵・モード表示用）
import { SPRITE_SIZE, sprite } from './sprites';

export function spriteCanvas(name: string, ink = '#1b2340'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SPRITE_SIZE;
  c.height = SPRITE_SIZE;
  const ctx = c.getContext('2d')!;
  const sp = sprite(name);
  ctx.fillStyle = ink;
  if (sp) for (let y = 0; y < SPRITE_SIZE; y++) for (let x = 0; x < SPRITE_SIZE; x++) if (sp[y][x]) ctx.fillRect(x, y, 1, 1);
  return c;
}
