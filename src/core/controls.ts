// 汎用の操作部品：ノブ・段階スライダー・押しボタン。マウスとタッチの両方で動く。
import { rectOf, pt } from './view';

export class Knob {
  value: number;
  private el: HTMLElement;
  private cap: HTMLElement;

  constructor(
    el: HTMLElement,
    private def: { default: number },
    private onChange: (v: number) => void,
    private sweepDeg = 270,
  ) {
    this.el = el;
    this.cap = el.querySelector('.cap') ?? el;
    this.value = def.default;
    el.style.touchAction = 'none';
    let startY = 0, startV = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      startY = pt(e).y;
      startV = this.value;
      el.classList.add('grab');
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const fine = e.shiftKey ? 0.25 : 1;
      this.set(startV + ((startY - pt(e).y) / 180) * fine);
    });
    const end = (e: PointerEvent) => { el.releasePointerCapture?.(e.pointerId); el.classList.remove('grab'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.set(this.value - Math.sign(e.deltaY) * 0.04); }, { passive: false });
    el.addEventListener('dblclick', () => this.set(this.def.default));
    this.render();
  }

  set(v: number, notify = true): void {
    const nv = Math.max(0, Math.min(1, v));
    if (nv === this.value && notify) return;
    this.value = nv;
    this.render();
    if (notify) this.onChange(nv);
  }

  private render(): void {
    const deg = -this.sweepDeg / 2 + this.value * this.sweepDeg;
    this.cap.style.transform = `rotate(${deg}deg)`;
  }
}

/** 段階スライダー（MODE など）。el の中に .thumb を置く。横方向 */
export class SteppedSlider {
  value: number;
  constructor(
    private el: HTMLElement,
    private steps: number,
    initial: number,
    private onChange: (v: number) => void,
    private vertical = false,
  ) {
    this.value = initial;
    el.style.touchAction = 'none';
    const pick = (e: PointerEvent) => {
      const r = rectOf(el);
      const k = vertical ? (pt(e).y - r.top) / r.height : (pt(e).x - r.left) / r.width;
      this.set(Math.round(Math.max(0, Math.min(1, k)) * (steps - 1)));
    };
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); pick(e); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) pick(e); });
    this.render();
  }

  set(v: number, notify = true): void {
    if (v === this.value) return;
    this.value = v;
    this.render();
    if (notify) this.onChange(v);
  }

  private render(): void {
    const k = this.steps > 1 ? this.value / (this.steps - 1) : 0;
    this.el.style.setProperty('--pos', String(k));
    this.el.dataset.value = String(this.value);
  }
}

/** 押している間だけオンになるボタン */
export function momentary(el: HTMLElement, onDown: () => void, onUp: () => void = () => {}): { press: () => void; release: () => void } {
  let down = false;
  const press = () => { if (down) return; down = true; el.classList.add('down'); onDown(); };
  const release = () => { if (!down) return; down = false; el.classList.remove('down'); onUp(); };
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); press(); e.preventDefault(); });
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
  return { press, release };
}

/** 段階つきの回転つまみ（BASE・MODE ダイヤル）。上下ドラッグ・ホイール・クリックで切り替え */
export class SteppedKnob {
  value: number;
  private cap: HTMLElement;
  constructor(
    private el: HTMLElement,
    private steps: number,
    initial: number,
    private onChange: (v: number) => void,
    private sweepDeg = 270,
  ) {
    this.value = initial;
    this.cap = el.querySelector('.cap') ?? el;
    el.style.touchAction = 'none';
    let startY = 0, startV = 0, moved = false;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      startY = pt(e).y; startV = this.value; moved = false;
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const d = Math.round((startY - pt(e).y) / 24);
      if (d !== 0) moved = true;
      this.set(Math.max(0, Math.min(this.steps - 1, startV + d)));
    });
    el.addEventListener('pointerup', () => { if (!moved) this.set((this.value + 1) % this.steps); });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.set(Math.max(0, Math.min(this.steps - 1, this.value - Math.sign(e.deltaY)))); }, { passive: false });
    this.render();
  }
  set(v: number, notify = true): void {
    if (v === this.value) return;
    this.value = v;
    this.render();
    if (notify) this.onChange(v);
  }
  private render(): void {
    const deg = -this.sweepDeg / 2 + (this.steps > 1 ? this.value / (this.steps - 1) : 0) * this.sweepDeg;
    this.cap.style.transform = `rotate(${deg}deg)`;
  }
}

/** レバー式トグルスイッチ。steps=2 なら上=1（ON）、steps=3 なら上=0・中=1・下=2 */
export class Toggle {
  value: number;
  constructor(private el: HTMLElement, private steps: number, initial: number, private onChange: (v: number) => void) {
    this.value = initial;
    el.innerHTML = '<div class="bat"></div>';
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.steps === 2) return this.cycle(); // 2 段はクリックで切り替え
      const r = rectOf(el);
      const k = (pt(e).y - r.top) / r.height; // 0 = 上
      this.set(Math.round(Math.max(0, Math.min(1, k)) * (this.steps - 1)));
    });
    this.render();
  }
  /** 次の位置へ（キーボード用） */
  cycle(): void {
    this.set((this.value + 1) % this.steps);
  }
  set(v: number, notify = true): void {
    if (v === this.value) return;
    this.value = v;
    this.render();
    if (notify) this.onChange(v);
  }
  private render(): void {
    const pos = this.steps === 2 ? 1 - this.value : this.value / (this.steps - 1);
    this.el.style.setProperty('--pos', String(pos));
  }
}
