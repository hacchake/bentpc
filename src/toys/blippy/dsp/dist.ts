// 後付けのディストーション回路。
// type 0 = CLIP（ハードクリップ）、type 1 = FOLD（フォールドバック＋ビット落とし）

export function distort(x: number, amount: number, type: number): number {
  if (amount < 0.001) return x;
  if (type === 0) {
    const drive = 1 + amount * amount * 40;
    const y = Math.max(-1, Math.min(1, x * drive));
    return y * (1 - amount * 0.35);
  }
  // フォールドバック：±1 を超えたら折り返す
  let y = x * (1 + amount * 8);
  for (let i = 0; i < 8 && (y > 1 || y < -1); i++) y = y > 1 ? 2 - y : -2 - y;
  // ビット落とし：8bit → 2bit
  const bits = 8 - amount * 6;
  const q = Math.pow(2, bits - 1);
  return (Math.round(y * q) / q) * (1 - amount * 0.25);
}
