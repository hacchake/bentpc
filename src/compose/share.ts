// URL で曲を共有する：自動作曲の設定（シード・スタイル・壊れ度・長さ・BPM）と、おもちゃの並びを URL に入れる。
// 同じ URL を開けば、同じ曲がもう一度作られる（曲データそのものは送らない）。
import { LENGTHS, STYLE_IDS, styleOf } from './styles';
import { lang } from '../i18n/core';
import type { ComposeSettings, StyleId } from './types';

export function settingsToQuery(st: ComposeSettings, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...extra, seed: String(st.seed), style: st.style, chaos: String(Math.round(st.chaos * 100)), len: String(st.lengthSec), bpm: String(st.bpm) });
  return q.toString().replace(/%2C/g, ',');
}

/** URL から設定を読む（seed が無ければ null） */
export function settingsFromQuery(q: URLSearchParams): ComposeSettings | null {
  const seed = Math.floor(Number(q.get('seed')));
  if (!Number.isFinite(seed) || seed < 1) return null;
  const style = (STYLE_IDS.includes(q.get('style') as StyleId) ? q.get('style') : 'beat') as StyleId;
  const chaos = Math.max(0, Math.min(1, Number(q.get('chaos') ?? 50) / 100));
  const lenQ = Number(q.get('len'));
  const lengthSec = LENGTHS.includes(lenQ) ? lenQ : 60;
  const bpmQ = Number(q.get('bpm'));
  const [lo, hi] = styleOf(style).bpmRange;
  const bpm = Number.isFinite(bpmQ) && bpmQ > 0 ? Math.max(lo, Math.min(hi, Math.round(bpmQ))) : styleOf(style).bpm;
  return { seed, style, chaos, lengthSec, bpm };
}

/** 今のページの URL を、設定入りに書き換える（ページは読み直さない） */
export function setPageQuery(query: string): string {
  // 英語で見ているときは、送った相手も英語で開くように lang=en も付ける
  const url = `${location.origin}${location.pathname}?${query}${lang() === 'en' ? '&lang=en' : ''}`;
  try {
    history.replaceState(null, '', url);
  } catch {
    // file:// などで書き換えられなくても使える
  }
  return url;
}

/** クリップボードにコピー（できなければ、選んでコピーできる小さな窓を出す） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    prompt('この URL をコピーしてください', text);
    return false;
  }
}

/** 画面の下に短いお知らせを出す */
export function toast(text: string, ms = 3000): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;padding:10px 18px;border-radius:12px;'
    + 'background:#ffe066;color:#222;font:700 14px sans-serif;border:3px solid #222;box-shadow:4px 5px 0 rgba(0,0,0,.4);max-width:90vw;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
