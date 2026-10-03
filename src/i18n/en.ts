// 英語の辞書（日本語のかけら → 英語）。鍵の {0} {1} は何でもよい所。
// アプリの画面（en-app.ts）と攻略本（en-manual.ts）。足りないものは npx tsx scripts/i18n/extract.ts で探す
import { EN_APP } from './en-app';
import { EN_MANUAL } from './en-manual';

export const EN: Record<string, string> = { ...EN_MANUAL, ...EN_APP };
