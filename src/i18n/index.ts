// 英語版の入口：ページの最初に読み込む。言語を決めて、英語なら画面を置き換える
import './i18n.css';
import { initLang, installDomTranslation, langButton, lang } from './core';
import { EN } from './en';

initLang(EN);
export { lang, langButton, installDomTranslation };
export { tr } from './core';

/** 上のバーに切り替えボタンを置き、英語なら画面を置き換える（DOM ができてから呼ぶ） */
export function setupLang(bar: HTMLElement | null, cls = ''): void {
  // 攻略本のリンクの左に（無ければ右端）
  if (bar) bar.insertBefore(langButton(cls), bar.querySelector('a[href^="manual/"]'));
  // 攻略本のリンクは言語ごとのページへ
  if (lang() === 'en') document.querySelectorAll<HTMLAnchorElement>('a[href^="manual/"]').forEach((a) => { a.href = a.getAttribute('href')!.replace(/^manual\//, 'manual/en/'); });
  installDomTranslation();
}
