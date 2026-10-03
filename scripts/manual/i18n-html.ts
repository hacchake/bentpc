// 攻略本の HTML を英語にする：タグの外の文字と、alt / title の中を辞書（src/i18n）で置き換える
import { initLang, missing, tr } from '../../src/i18n/core';
import { EN } from '../../src/i18n/en';

initLang(EN, 'en');

export function translateHtml(html: string): string {
  let inStyle = false;
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith('<')) {
      if (/^<(style|script)\b/i.test(part)) inStyle = true;
      if (/^<\/(style|script)>/i.test(part)) inStyle = false;
      return part.replace(/\b(alt|title)="([^"]*)"/g, (_, a, v) => `${a}="${tr(v).replace(/"/g, '&quot;')}"`);
    }
    if (inStyle || !part.trim()) return part;
    return tr(part);
  }).join('');
}

export const untranslated = () => [...missing];
