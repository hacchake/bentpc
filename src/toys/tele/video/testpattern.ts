// デモ用のテスト映像（手続き的に描く。外部の素材は使わない）。
// 4 つの場面（カラーバー／回る図形／市松模様のトンネル／テストカード）を順に映し、
// 拍に合わせて脈打つ。スタジオでは曲の拍位置とセクション名を渡すと、それに同期する。

const W = 640;
const H = 480;
const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
const SCENE_SEC = 8;

export class TestPattern {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  time = 0; // 秒（自分の時計）
  rate = 1;
  paused = false;
  /** 外から与える時計（スタジオの再生位置）。null なら自分の時計で動く */
  external: { beat: number; bpm: number; label: string } | null = null;
  private last = 0;
  /** キューで飛んだ分（拍）。外の時計に足す */
  private offset = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
  }

  /** 0〜1 の位置へ（キューポイント）：60 秒の番組の中を飛ぶ */
  jump(f: number): void {
    this.time = f * SCENE_SEC * 4 * 2;
    this.offset = f * 64;
  }

  /** 1 フレーム描く（now はミリ秒） */
  draw(now: number): void {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.paused) this.time += dt * this.rate;
    const ex = this.external;
    // 拍：外の時計があればそれ、なければ 120BPM 相当
    const beat = ex ? ex.beat + this.offset : this.time * 2;
    const sec = ex ? (ex.beat * 60) / ex.bpm : this.time;
    const scene = Math.floor(beat / 16) % 4; // 4 小節ごとに場面が変わる
    const pulse = Math.exp(-(beat % 1) * 5); // 拍の頭で 1 → すぐ減る
    const g = this.g;
    g.save();
    switch (scene) {
      case 0: this.bars(sec, pulse); break;
      case 1: this.shapes(sec, beat, pulse); break;
      case 2: this.tunnel(sec, pulse); break;
      default: this.card(sec, beat, pulse);
    }
    g.restore();
    // ---- 共通の文字 ----
    g.font = '700 22px monospace';
    g.fillStyle = 'rgba(0,0,0,.6)';
    g.fillRect(14, 14, 170, 34);
    g.fillStyle = '#fff';
    g.fillText('TK-6  TEST', 24, 39);
    const bar = Math.floor(beat / 4) + 1, bt = Math.floor(beat % 4) + 1;
    const f = Math.floor((sec % 1) * 30);
    const tc = ex ? `BAR ${String(bar).padStart(3, '0')}.${bt}` : `${p2(Math.floor(sec / 3600))}:${p2(Math.floor(sec / 60) % 60)}:${p2(Math.floor(sec) % 60)}:${p2(f)}`;
    g.fillStyle = 'rgba(0,0,0,.7)';
    g.fillRect(W - 214, H - 50, 200, 36);
    g.fillStyle = '#7dff6a';
    g.fillText(tc, W - 204, H - 24);
    if (ex?.label) {
      g.font = '700 26px sans-serif';
      const w = g.measureText(ex.label).width + 28;
      g.fillStyle = `rgba(255, 220, 60, ${0.75 + 0.25 * pulse})`;
      g.fillRect(14, H - 54, w, 40);
      g.fillStyle = '#111';
      g.fillText(ex.label, 28, H - 24);
    }
  }

  /** カラーバー＋横切る白い帯 */
  private bars(t: number, pulse: number): void {
    const g = this.g;
    const bw = W / 7;
    BARS.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * bw, 0, bw + 1, H * 0.66); });
    const rev = ['#0000c0', '#111', '#c000c0', '#111', '#00c0c0', '#111', '#c0c0c0'];
    rev.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * bw, H * 0.66, bw + 1, H * 0.09); });
    for (let i = 0; i < 16; i++) { const v = Math.round((i / 15) * 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect((i * W) / 16, H * 0.75, W / 16 + 1, H * 0.25); }
    const y = ((t * 90) % (H + 40)) - 20;
    g.fillStyle = `rgba(255,255,255,${0.35 + 0.5 * pulse})`;
    g.fillRect(0, y, W, 14);
  }

  /** 回る図形（三角・四角・丸）と色の帯 */
  private shapes(t: number, beat: number, pulse: number): void {
    const g = this.g;
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, `hsl(${(t * 30) % 360} 70% 35%)`);
    grd.addColorStop(1, `hsl(${(t * 30 + 160) % 360} 70% 20%)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `hsla(${i * 30} 90% 60% / .35)`;
      g.fillRect(0, ((i * 40 + t * 60) % (H + 40)) - 40, W, 12);
    }
    const shapes = 3;
    for (let i = 0; i < shapes; i++) {
      const a = t * (0.6 + i * 0.3) + i * 2.1;
      const cx = W / 2 + Math.cos(a) * 170, cy = H / 2 + Math.sin(a * 1.3) * 120;
      const r = 50 + 25 * pulse + i * 8;
      g.save();
      g.translate(cx, cy);
      g.rotate(t * (i + 1) * 0.8);
      g.fillStyle = ['#ff4a3d', '#ffe066', '#6fd3ff'][i];
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.beginPath();
      if (i === 0) { g.moveTo(0, -r); g.lineTo(r * 0.87, r * 0.5); g.lineTo(-r * 0.87, r * 0.5); g.closePath(); }
      else if (i === 1) g.rect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
      else g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
    }
    // 拍ごとに跳ねる玉
    const bx = ((Math.floor(beat) % 8) + 0.5) * (W / 8);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(bx, H - 80 - 60 * pulse, 16, 0, Math.PI * 2);
    g.fill();
  }

  /** 市松模様のトンネル */
  private tunnel(t: number, pulse: number): void {
    const g = this.g;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    for (let k = 14; k >= 1; k--) {
      const z = ((k - ((t * 1.5) % 1)) / 14) ** 2;
      const s = z * W * 1.2 * (1 + 0.08 * pulse);
      g.fillStyle = k % 2 ? `hsl(${(k * 25 + t * 50) % 360} 80% 55%)` : '#111';
      g.save();
      g.translate(W / 2, H / 2);
      g.rotate(Math.sin(t * 0.7) * 0.4 + k * 0.05);
      g.fillRect(-s / 2, -s * 0.375, s, s * 0.75);
      g.restore();
    }
    const n = 8;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if ((x + y + Math.floor(t * 2)) % 2) continue;
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.fillRect((x * W) / n, (y * H) / n, W / n, H / n);
    }
  }

  /** 丸いテストカード＋回る針 */
  private card(t: number, beat: number, pulse: number): void {
    const g = this.g;
    g.fillStyle = '#6c6c6c';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#ddd';
    g.lineWidth = 2;
    for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const r = 190;
    g.fillStyle = '#1a1a1a';
    g.beginPath();
    g.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    g.fill();
    BARS.forEach((c, i) => { g.fillStyle = c; g.fillRect(W / 2 - r * 0.8 + (i * r * 1.6) / 7, H / 2 - 70, (r * 1.6) / 7 + 1, 60); });
    for (let i = 0; i < 10; i++) {
      const v = i % 2 ? 255 : 0;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(W / 2 - r * 0.8 + (i * r * 1.6) / 10, H / 2 + 10, (r * 1.6) / 10 + 1, 40);
    }
    const a = (beat / 4) * Math.PI * 2 - Math.PI / 2;
    g.strokeStyle = `rgba(255, 80, 60, ${0.6 + 0.4 * pulse})`;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(W / 2, H / 2);
    g.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
    g.stroke();
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#fff';
    g.font = '700 28px monospace';
    g.fillText(String(Math.floor(t) % 100).padStart(2, '0'), W / 2 - 17, H / 2 + 100);
  }
}

const p2 = (n: number) => String(n).padStart(2, '0');
