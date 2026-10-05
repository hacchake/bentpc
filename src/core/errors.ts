// 思いがけないエラーが起きたとき、黙って止まらずに画面の下で知らせる（同じお知らせは 1 分に 1 回まで）。
// エラーの中身はこのブラウザの中だけ（どこにも送らない）。開発者向けにはコンソールにそのまま出る
import { tr } from '../i18n';

const shown = new Map<string, number>();
let box: HTMLDivElement | null = null;

function show(msg: string): void {
  const now = Date.now();
  if ((shown.get(msg) ?? 0) > now - 60_000) return;
  shown.set(msg, now);
  box?.remove();
  const el = document.createElement('div');
  el.className = 'err-toast';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<b></b><span></span><button type="button"></button>`;
  el.querySelector('b')!.textContent = tr('うまく動かない所がありました');
  el.querySelector('span')!.textContent = `${tr('音が止まったら、ページを読み込み直してください（作った曲はブラウザに保存されています）。')} — ${msg.slice(0, 120)}`;
  const close = el.querySelector('button')!;
  close.textContent = '×';
  close.setAttribute('aria-label', tr('閉じる'));
  close.onclick = () => el.remove();
  el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;display:flex;gap:10px;align-items:flex-start;'
    + 'max-width:min(560px,92vw);padding:12px 14px;border-radius:12px;background:#2a1220;color:#fff;font:13px/1.45 sans-serif;'
    + 'border:2px solid #ff6b6b;box-shadow:0 8px 24px rgba(0,0,0,.45)';
  (el.querySelector('b') as HTMLElement).style.cssText = 'color:#ff9b9b;white-space:nowrap';
  close.style.cssText = 'margin-left:auto;background:none;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1';
  document.body.appendChild(el);
  box = el;
  setTimeout(() => el.remove(), 12_000);
}

/** ページの最初に 1 回呼ぶ */
export function watchErrors(): void {
  addEventListener('error', (e) => {
    // 画像・スクリプトの読み込み失敗（e.error が無い）や、ブラウザの拡張機能から来たものは知らせない
    if (!e.error || (e.filename && !e.filename.startsWith(location.origin) && !e.filename.startsWith('blob:'))) return;
    show(String(e.error?.message ?? e.message));
  });
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // ユーザーが取り消した操作（ファイル選択・共有・権限）は知らせない
    if (r && typeof r === 'object' && 'name' in r && ['AbortError', 'NotAllowedError'].includes(String((r as { name: unknown }).name))) return;
    show(String((r as { message?: unknown })?.message ?? r));
  });
}
