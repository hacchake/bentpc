// おもちゃの画面（UI）の共通の形と、部品を置くための道具。
import type { ParamDef } from './params';
import type { FromToy, ToyMsg } from '../host/protocol';

/** ホスト（アプリ本体）が各おもちゃの画面に渡す窓口 */
export interface HostApi {
  /** このおもちゃのエンジンへ送る */
  post(m: ToyMsg): void;
  /** 音を出す準備（最初のユーザー操作で呼ぶ） */
  start(): Promise<void>;
  enableMic(): Promise<boolean>;
}

export interface ToyUI {
  readonly title: string;
  readonly width: number; // 画面の設計サイズ（px）
  readonly height: number;
  readonly root: HTMLElement;
  readonly help: string; // ヘルプ欄の HTML
  onMessage(m: FromToy): void;
  /** PC キーボード。処理したら true */
  keyDown(e: KeyboardEvent): boolean;
  keyUp(e: KeyboardEvent): void;
  releaseAll(): void;
  /** MIDI メッセージ（チャンネルは振り分け済み） */
  midi(status: number, d1: number, d2: number): void;
  powerOn(): void;
  powerOff(): void;
}

export type ToyUIFactory = (api: HostApi) => ToyUI;

/** 部品を座標指定で置く道具（x, y は部品の中心） */
export class Board {
  constructor(private base: HTMLElement) {}
  place(cls: string, x: number, y: number, html = ''): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'mod';
    wrap.style.left = `${x}px`;
    wrap.style.top = `${y}px`;
    wrap.style.transform = 'translate(-50%, -50%)';
    const el = document.createElement('div');
    el.className = cls;
    el.style.position = 'relative';
    el.innerHTML = html;
    wrap.appendChild(el);
    this.base.appendChild(wrap);
    return el;
  }
  label(text: string, x: number, y: number, cls = ''): HTMLElement {
    const el = document.createElement('div');
    el.className = `mod-label ${cls}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.textContent = text;
    this.base.appendChild(el);
    return el;
  }
  tape(text: string, x: number, y: number, vertical = false, rot = 0): HTMLElement {
    const el = this.place(`tape${vertical ? ' v' : ''}`, x, y, text);
    el.style.setProperty('--rot', `${rot}deg`);
    return el;
  }
  knob(cls: string, x: number, y: number): HTMLElement {
    return this.place(`knob ${cls}`, x, y, '<div class="cap"></div>');
  }
}

/** MIDI の CC 値（0..127）をパラメーター値にする */
export function ccToValue(p: ParamDef, v: number): number {
  if (p.kind === 'continuous') return p.min + (p.max - p.min) * (v / 127);
  if (p.kind === 'stepped') return Math.round((v / 127) * (p.max - p.min)) + p.min;
  return v >= 64 ? 1 : 0;
}

/** CC 番号 → パラメーター番号 の表 */
export function ccMap(defs: readonly ParamDef[]): Map<number, number> {
  const m = new Map<number, number>();
  defs.forEach((p, i) => { if (p.midiCC !== undefined) m.set(p.midiCC, i); });
  return m;
}

/** 操作部品の共通の形（MIDI から動かすため） */
export type Ctl = { set(v: number, notify?: boolean): void } | { press(): void; release(): void };

export function applyCtl(c: Ctl | undefined, v: number): void {
  if (!c) return;
  if ('set' in c) c.set(v);
  else if (v > 0.5) c.press();
  else c.release();
}

/** MIDI で電源を入れる CC（64 以上で ON） */
export const CC_POWER = 119;
