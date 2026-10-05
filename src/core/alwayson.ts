// 電源はいつも ON：最初に画面をさわる（キーを押す）と電源が入る。見えているおもちゃが OFF になったら（RESET・暴走など）自動で入れ直す。
// POWER ボタンは RESET（押すと再起動）。VROOMBOX のキーはエンジンをかける役目があるので、そのまま。
import type { ToyUI } from './ui';

export class AlwaysOn {
  private started = false;
  private powered: boolean[];
  private resetAt: number[];
  private timers: number[];

  /** visible：いま見えている（電源を入れておく）おもちゃの番号 */
  /** keepKey：電源ボタンをそのままにするおもちゃ（VROOMBOX のキー）。label：ボタンの新しい名前（RESET が別にあるトイPC は REBOOT） */
  constructor(private toys: ToyUI[], private visible: () => number[], keepKey: (i: number) => boolean = () => false, label: (i: number) => string = () => 'RESET') {
    this.powered = toys.map(() => false);
    this.resetAt = toys.map(() => 0);
    this.timers = toys.map(() => 0);
    const start = () => {
      if (this.started) return;
      this.started = true;
      for (const i of this.visible()) if (!this.powered[i]) this.toys[i].powerOn();
    };
    window.addEventListener('pointerdown', start, true);
    window.addEventListener('keydown', start, true);
    toys.forEach((t, i) => {
      const b = t.powerButton;
      if (!b || keepKey(i)) return;
      // 文字を RESET に
      b.closest('.toy-root')?.querySelectorAll<HTMLElement>('.power-label, .pkt-power small').forEach((l) => { l.textContent = label(i); });
      b.title = `${label(i)}（押すと再起動）`;
      // 電源が入っているときに押す → いったん切って入れ直す（元の ON / OFF の動きは止める）
      const block = (e: Event) => {
        if (!this.powered[i] && performance.now() - this.resetAt[i] > 600) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.type === 'pointerdown' && performance.now() - this.resetAt[i] > 600) this.reset(i);
      };
      b.addEventListener('pointerdown', block, true);
      b.addEventListener('click', block, true);
      b.addEventListener('pointerup', block, true);
    });
  }

  /** 再起動 */
  reset(i: number): void {
    this.resetAt[i] = performance.now();
    this.toys[i].powerOff();
    clearTimeout(this.timers[i]);
    this.timers[i] = window.setTimeout(() => this.toys[i].powerOn(), 250);
  }

  /** おもちゃの状態が届いたとき（電源の ON / OFF）。見えているのに OFF なら入れ直す */
  status(i: number, powered: boolean): void {
    this.powered[i] = powered;
    if (powered || !this.started || !this.visible().includes(i)) return;
    clearTimeout(this.timers[i]);
    this.timers[i] = window.setTimeout(() => { if (!this.powered[i] && this.visible().includes(i)) this.toys[i].powerOn(); }, 700);
  }

  /** 表示が切り替わったとき */
  shown(): void {
    if (!this.started) return;
    for (const i of this.visible()) if (!this.powered[i]) this.toys[i].powerOn();
  }
}
