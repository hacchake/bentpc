// 画面の向き：縦向きのスマホでは、横長のおもちゃを 90 度回して大きく出す（スマホを横にして持つ）。
// 回しているときは、指の位置・部品の箱を「おもちゃの向き」に直してから使う（ノブ・スライダー・ハンドルが正しい向きに動く）。

/** いまの回し方（0 = そのまま、90 = 時計回りに 90 度） */
let rot = 0;
export const setViewRot = (r: number) => { rot = r; };
export const viewRot = () => rot;

/** 指・マウスの位置 → おもちゃの向きの座標 */
export function pt(e: { clientX: number; clientY: number }): { x: number; y: number } {
  return rot ? { x: e.clientY, y: -e.clientX } : { x: e.clientX, y: e.clientY };
}

/** 部品の箱 → おもちゃの向きの箱（left・top・width・height） */
export function rectOf(el: Element): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  return rot ? { left: r.top, top: -r.right, width: r.height, height: r.width } : { left: r.left, top: r.top, width: r.width, height: r.height };
}
