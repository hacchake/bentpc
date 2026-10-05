// 電源はいつも ON：最初に画面をさわる（キーを押す）と電源が入る。見えているおもちゃが OFF になったら（RESET・暴走など）自動で入れ直す。
// ただし曲を再生している間は入れ直さない（曲の POWER OFF・使わないおもちゃは曲のとおり）。止まった後は、次にさわったときに入れ直す。
// POWER ボタンは RESET（押すと再起動）。VROOMBOX のキーはエンジンをかける役目があるので、そのまま。
import type { ToyUI } from './ui';

export class AlwaysOn {
  private started = false;
  private powered: boolean[];
  private resetAt: number[];
  private timers: number[];
  private byPlay: boolean[];

  /** visible：いま見えている（電源を入れておく）おもちゃの番号 */
  /** keepKey：電源ボタンをそのままにするおもちゃ（VROOMBOX のキー）。label：ボタンの新しい名前（RESET が別にあるトイPC は REBOOT） */
  /** playing：曲を再生中か */
  constructor(private toys: ToyUI[], private visible: () => number[], private playing: () => boolean, keepKey: (i: number) => boolean = () => false, label: (i: number) => string = () => 'RESET') {
    this.powered = toys.map(() => false);
    this.resetAt = toys.map(() => 0);
    this.timers = toys.map(() => 0);
    this.byPlay = toys.map(() => false);
    // さわったとき：
    //  ・最初の 1 回（音の準備もここで）と、曲が止まっているとき → 見えていて OFF のおもちゃを全部入れる
    //  ・曲の再生中 → さわったおもちゃだけ入れる（曲がわざと切っているおもちゃは、停止ボタンなどでは起こさない）
    const touch = (e: Event) => {
      const first = !this.started;
      this.started = true;
      const vis = this.visible();
      const t = e.target as Node | null;
      for (const i of vis) {
        if (this.powered[i]) continue;
        const inside = !!t && this.toys[i].root.contains(t);
        const key = e.type === 'keydown' && vis.length === 1;
        if (first || !this.playing() || inside || key) this.toys[i].powerOn();
      }
    };
    window.addEventListener('pointerdown', touch, true);
    window.addEventListener('keydown', touch, true);
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
    this.timers[i] = window.setTimeout(() => { this.timers[i] = 0; this.toys[i].powerOn(); }, 250);
  }

  /** おもちゃの状態が届いたとき（電源の ON / OFF）。見えているのに OFF なら入れ直す */
  status(i: number, powered: boolean): void {
    this.powered[i] = powered;
    // 曲が切った（再生中に OFF になった）おもちゃは、曲が終わっても切ったまま（次にさわったら入る）
    if (powered) this.byPlay[i] = false;
    else if (this.playing()) this.byPlay[i] = true;
    if (powered || !this.started || !this.visible().includes(i) || this.playing() || this.byPlay[i] || this.timers[i]) return;
    // 状態はしょっちゅう届くので、待っている間は数え直さない
    this.timers[i] = window.setTimeout(() => {
      this.timers[i] = 0;
      if (!this.powered[i] && this.visible().includes(i) && !this.playing()) this.toys[i].powerOn();
    }, 700);
  }

  /** 表示が切り替わったとき */
  shown(): void {
    if (!this.started) return;
    for (const i of this.visible()) if (!this.powered[i]) this.toys[i].powerOn();
  }
}
