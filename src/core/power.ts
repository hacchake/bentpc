// 電源を分かりやすくする部品（おもちゃ共通）。
// ・電源 OFF の間、POWER の横の LED がゆっくり点滅して「ここを押して」と誘う
// ・電源 OFF のままキーやノブを触ると、POWER ボタンがピカッと光り、吹き出しで教える
// ・吹き出し（say）：RESET の後の再起動の案内、熱くなりすぎたときの案内など
// ・最初の案内（PowerGuide）：ページを開いた直後、画面を少し暗くして POWER ボタンだけを明るく見せる
import './power.css';

export class PowerHints {
  powered = false;
  private bubble: HTMLElement;
  private bubbleTimer = 0;
  private lastSay = 0;

  /** bubbleAt：吹き出しを出す位置（ボタンを置いた台の座標）と、ボタンのどちら側に出すか */
  constructor(
    private root: HTMLElement,
    readonly button: HTMLElement,
    private led: HTMLElement,
    bubbleAt: { x: number; y: number; side: 'left' | 'right' },
  ) {
    this.bubble = document.createElement('div');
    this.bubble.className = `power-bubble ${bubbleAt.side}`;
    this.bubble.style.left = `${bubbleAt.x}px`;
    this.bubble.style.top = `${bubbleAt.y}px`;
    this.bubble.hidden = true;
    // ボタンと同じ台（Board）の上に置く（座標をボタンと同じにするため）
    (button.closest('.mod')?.parentElement ?? root).appendChild(this.bubble);
    // 電源はいつも ON（さわると入る：core/alwayson.ts）なので、「まず POWER を押して」の案内は出さない
    this.update(false);
  }

  update(powered: boolean): void {
    this.powered = powered;
    this.led.classList.toggle('beckon', !powered);
    this.root.classList.toggle('is-off', !powered);
    if (powered) this.hideBubble();
  }

  /** POWER ボタンをピカッと光らせて、吹き出しで教える */
  nudge(): void {
    // 電源はいつも ON（さわると入る）なので、案内は出さない
  }

  flash(): void {
    const b = this.button;
    b.classList.remove('power-flash');
    void b.offsetWidth; // アニメーションをやり直す
    b.classList.add('power-flash');
  }

  /** 吹き出しを出す（同じ案内を何度も出しすぎないよう、間を空ける） */
  say(text: string, ms = 4000, force = false): void {
    const now = performance.now();
    if (!force && now - this.lastSay < 1500 && !this.bubble.hidden) return;
    this.lastSay = now;
    this.bubble.innerHTML = text;
    this.bubble.hidden = false;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.hideBubble(), ms);
  }

  hideBubble(): void {
    this.bubble.hidden = true;
  }
}

const GUIDE_KEY = 'bentpc.powerGuide.done';

/**
 * 最初の案内：画面を少し暗くして、POWER ボタンだけを明るく見せ、矢印で指す。
 * 1 回でも電源を入れたら、次からは出ない（ヘルプの「電源の案内をもう一度」で再表示）。
 */
export class PowerGuide {
  private el: HTMLElement;
  private svg: SVGSVGElement;
  private label: HTMLElement;
  private raf = 0;
  private lastW = 0;
  private sizes: Partial<Record<'right' | 'left' | 'below' | 'above', { lw: number; lh: number }>> = {};

  constructor(private targets: () => HTMLElement[]) {
    this.el = document.createElement('div');
    this.el.className = 'power-guide';
    this.el.hidden = true;
    this.el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"></svg><div class="pg-label"></div>`;
    this.svg = this.el.querySelector('svg')!;
    this.label = this.el.querySelector('.pg-label')!;
    document.body.appendChild(this.el);
  }

  static get done(): boolean {
    try {
      return localStorage.getItem(GUIDE_KEY) === '1';
    } catch {
      return false;
    }
  }

  get showing(): boolean {
    return !this.el.hidden;
  }

  /** 最初だけ出す */
  showIfFirst(): void {
    if (!PowerGuide.done) this.show();
  }

  show(): void {
    this.el.hidden = false;
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.el.hidden) return;
      this.layout();
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /** 電源が入った：消して、次からは出さない */
  hide(markDone = true): void {
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
    if (markDone) {
      try {
        localStorage.setItem(GUIDE_KEY, '1');
      } catch {
        // 保存できなくても動く
      }
    }
  }

  private layout(): void {
    const w = window.innerWidth, h = window.innerHeight;
    if (w !== this.lastW) { this.sizes = {}; this.lastW = w; }
    const rects = this.targets().filter((t) => t.offsetParent !== null).map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0);
    if (!rects.length) { this.label.hidden = true; this.svg.innerHTML = ''; return; }
    const pad = 14;
    const holes = rects.map((r) => {
      const s = Math.max(r.width, r.height) + pad * 2;
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: s / 2 };
    });
    this.svg.setAttribute('width', String(w));
    this.svg.setAttribute('height', String(h));
    this.svg.innerHTML = `<defs><mask id="pg-mask"><rect width="${w}" height="${h}" fill="white"/>${holes.map((o) => `<circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" fill="black"/>`).join('')}</mask></defs>
      <rect width="${w}" height="${h}" fill="rgba(8,6,12,.62)" mask="url(#pg-mask)"/>
      ${holes.map((o) => `<circle class="pg-ring" cx="${o.cx}" cy="${o.cy}" r="${o.r}"/>`).join('')}`;
    // 矢印つきの文字：横に入る場所があれば横（ボタンが左寄りなら右側に「◀」、右寄りなら左側に「▶」）、無ければ上か下
    const o = holes[0];
    const sub = '<small>ここが POWER ボタン。キーボードの Enter でも入るよ</small>';
    const place = (mode: 'right' | 'left' | 'below' | 'above') => {
      // 同じなら書き換えない（アニメーションが止まらないように）
      if (this.label.dataset.mode === mode) return { lw: this.label.offsetWidth, lh: this.label.offsetHeight };
      this.label.dataset.mode = mode;
      this.label.className = `pg-label ${mode}`;
      const arrow = { right: '◀', left: '▶', below: '▲', above: '▼' }[mode];
      this.label.innerHTML = mode === 'left' || mode === 'above' ? `電源を入れてね <b>${arrow}</b>${sub}` : `<b>${arrow}</b> 電源を入れてね${sub}`;
      return { lw: this.label.offsetWidth, lh: this.label.offsetHeight };
    };
    this.label.hidden = false;
    // 大きさは向きごとに 1 回だけ測って覚えておく
    const measure = (m: 'right' | 'left' | 'below' | 'above') => (this.sizes[m] ??= place(m));
    let mode: 'right' | 'left' | 'below' | 'above' = o.cx < w / 2 ? 'right' : 'left';
    const side = measure(mode);
    const fitsSide = mode === 'right' ? o.cx + o.r + 16 + side.lw < w - 8 : o.cx - o.r - 16 - side.lw > 8;
    if (!fitsSide) mode = o.cy + o.r + 16 + 90 < h ? 'below' : 'above';
    measure(mode);
    const { lw, lh } = place(mode);
    let x: number, y: number;
    if (mode === 'right' || mode === 'left') {
      x = mode === 'right' ? o.cx + o.r + 16 : o.cx - o.r - 16 - lw;
      y = o.cy - lh / 2;
    } else {
      x = o.cx - 30;
      y = mode === 'below' ? o.cy + o.r + 16 : o.cy - o.r - 16 - lh;
    }
    this.label.style.left = `${Math.max(8, Math.min(w - lw - 8, x))}px`;
    this.label.style.top = `${Math.max(8, Math.min(h - lh - 8, y))}px`;
  }
}
