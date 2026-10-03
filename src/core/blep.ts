// 帯域制限した波形（polyBLEP）。角のある波（のこぎり・矩形）をそのまま作ると、高い音で
// 「折り返し」の濁ったノイズが出る。角の前後 1 サンプルだけ丸めて、それを消す（音の性格はそのまま）。
// ph = 位相 0〜1、dt = 1 サンプルで進む位相（周波数 / サンプルレート）

/** 角の補正 */
export function blep(t: number, dt: number): number {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}
/** のこぎり波 -1〜1 */
export const sawBL = (ph: number, dt: number) => 2 * ph - 1 - blep(ph, dt);
/** 矩形波（duty = 上の割合）±1 */
export function pulseBL(ph: number, dt: number, duty = 0.5): number {
  let v = ph < duty ? 1 : -1;
  v += blep(ph, dt);
  let t = ph - duty;
  if (t < 0) t += 1;
  v -= blep(t, dt);
  return v;
}
