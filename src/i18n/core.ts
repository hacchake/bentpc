// 英語版：画面の日本語を、辞書（en.ts）で英語に置き換える。
// ・言語は 画面の上の「EN / 日本語」で切り替え（このブラウザに覚える。?lang=en / ?lang=ja でも）。最初はブラウザの言語
// ・置き換えるのは、文字（テキスト）・title（マウスを乗せたときの説明）・placeholder・alt と、
//   confirm / alert / prompt と、canvas に書く文字（液晶など）。あとから変わった文字も見張って置き換える
// ・辞書の鍵に {0} {1} … があれば、そこは何でもよい（数字や名前）。中身も辞書にあれば訳す
// 日本語のときは何もしない（元のまま）。DOM 以外（Worklet・テスト）からは tr() だけ使える。

export type Lang = 'ja' | 'en';
const KEY = 'bentpc.lang';

let current: Lang = 'ja';
let dict: Record<string, string> = {};
let patterns: Compiled[] = [];

export interface Compiled { key: string; re: RegExp | null }

/** 辞書の鍵 → 正規表現（{0} などがある鍵だけ） */
export function compileKey(key: string): Compiled {
  if (!/\{\d+\}/.test(key)) return { key, re: null };
  const esc = key.split(/(\{\d+\})/).map((p) => (/^\{\d+\}$/.test(p) ? '([\\s\\S]*?)' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
  return { key, re: new RegExp(`^${esc}$`) };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const JPRE = /[、-〿぀-ヿ一-鿿！-｠]/;

/** 辞書と {n} の形だけで訳す（無ければ null） */
function lookup(n: string): string | null {
  const hit = dict[n];
  if (hit !== undefined) return hit;
  for (const p of patterns) {
    const m = p.re!.exec(n);
    if (!m) continue;
    const order = [...p.key.matchAll(/\{(\d+)\}/g)].map((x) => Number(x[1]));
    const vals: string[] = [];
    order.forEach((idx, i) => { vals[idx] = tr(m[i + 1]); });
    return dict[p.key].replace(/\{(\d+)\}/g, (_, d) => vals[Number(d)] ?? '');
  }
  return null;
}

/** 区切りの記号 → 英語の書き方 */
const PUNCT: Record<string, string> = { '／': ' / ', '・': ' · ', '＝': ' = ', '：': ': ', '、': ', ', '。': '. ', '（': ' (', '）': ')', '「': '"', '」': '"', '〜': '–', '＋': '+', '→': ' → ' };
/** 大きい区切りから順に切って試す（「A＝B：C／D＝E」は、まず ／ で切って「A＝B：C」ごと訳す） */
const LEVELS = [/(／)/, /(＋)/, /(。)/, /(＝)/, /([（）「」])/, /(：)/, /(、)/, /(・)/, /(〜|→)/, /(\s+)/];

/** 日本語 → いまの言語 */
export function tr(s: string): string {
  if (current === 'ja' || !s || !JPRE.test(s)) return s;
  const n = norm(s);
  const direct = lookup(n);
  if (direct !== null) return keepSpace(s, direct);
  const out = split(n, 0);
  if (JPRE.test(out)) missing.add(n);
  return keepSpace(s, out);
}

/** 最後の手：区切りで切って、かけらごとに訳す。記号は英語の書き方に */
function split(n: string, level: number): string {
  for (let L = level; L < LEVELS.length; L++) {
    const parts = n.split(LEVELS[L]).filter((p) => p !== '');
    if (parts.length < 2) continue;
    return parts.map((p) => {
      if (/^\s+$/.test(p)) return ' ';
      if (PUNCT[p] !== undefined) return PUNCT[p];
      if (!JPRE.test(p)) return p;
      const t = p.trim();
      return lookup(t) ?? split(t, L + 1);
    }).join('').replace(/ {2,}/g, ' ').replace(/\( /g, '(').replace(/ ([.,)])/g, '$1').trim();
  }
  return n;
}
const keepSpace = (orig: string, t: string) => (orig.match(/^\s*/)![0] + t + orig.match(/\s*$/)![0]);

/** 辞書に無かった文字（開発用：window.__i18nMissing で見られる） */
export const missing = new Set<string>();

export const lang = () => current;

export function setDictionary(d: Record<string, string>): void {
  dict = {};
  for (const [k, v] of Object.entries(d)) dict[norm(k)] = v;
  patterns = Object.keys(dict).map(compileKey).filter((c) => c.re).sort((a, b) => b.key.length - a.key.length);
}

/** 言語を決める：URL の ?lang= → このブラウザに覚えたもの → ブラウザの言語 */
export function detectLang(): Lang {
  // URL の ?lang= がいちばん強い（保存できないブラウザでも効くように、保存の失敗とは切り離す）
  let q: string | null = null;
  try { q = new URLSearchParams(location.search).get('lang'); } catch { /* そのまま */ }
  if (q === 'en' || q === 'ja') {
    try { localStorage.setItem(KEY, q); } catch { /* 保存できなくても、この URL では効く */ }
    return q;
  }
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'en' || s === 'ja') return s;
  } catch {
    // 読めなくても動く
  }
  return typeof navigator !== 'undefined' && !/^ja/i.test(navigator.language || 'ja') ? 'en' : 'ja';
}

export function setLang(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* そのまま */ }
  // URL にも ?lang= を付けて読み直す（保存できないブラウザでも切り替わるように）
  const u = new URL(location.href);
  u.searchParams.set('lang', l);
  location.replace(u.toString());
}

// ---------------- 画面（DOM）を置き換える ----------------
const ATTRS = ['title', 'placeholder', 'alt', 'aria-label'];

function translateNode(n: Node): void {
  if (n.nodeType === 3) {
    const t = n.nodeValue ?? '';
    if (JPRE.test(t)) { const r = tr(t); if (r !== t) n.nodeValue = r; }
    return;
  }
  if (n.nodeType !== 1) return;
  const el = n as Element;
  if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.hasAttribute('data-noi18n')) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && JPRE.test(v)) { const r = tr(v); if (r !== v) el.setAttribute(a, r); }
  }
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'button') {
    const v = (el as HTMLInputElement).value;
    if (JPRE.test(v)) (el as HTMLInputElement).value = tr(v);
  }
  for (let c = el.firstChild; c; c = c.nextSibling) translateNode(c);
}

/** 英語のとき：画面全体を置き換えて、あとから変わる所も見張る。canvas の文字・確認の窓も */
export function installDomTranslation(): void {
  if (current === 'ja') return;
  document.documentElement.lang = 'en';
  translateNode(document.body);
  if (document.title && JPRE.test(document.title)) document.title = tr(document.title);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
      else m.addedNodes.forEach((x) => translateNode(x));
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  // 確認の窓
  const c = window.confirm.bind(window), a = window.alert.bind(window), p = window.prompt.bind(window);
  window.confirm = (m?: string) => c(m === undefined ? m : tr(String(m)));
  window.alert = (m?: string) => a(m === undefined ? m : tr(String(m)));
  window.prompt = (m?: string, d?: string) => p(m === undefined ? m : tr(String(m)), d);
  // canvas に書く文字（液晶・波形の画面）
  const proto = CanvasRenderingContext2D.prototype;
  const fill = proto.fillText, stroke = proto.strokeText;
  proto.fillText = function (t: string, x: number, y: number, w?: number) { return w === undefined ? fill.call(this, tr(String(t)), x, y) : fill.call(this, tr(String(t)), x, y, w); };
  proto.strokeText = function (t: string, x: number, y: number, w?: number) { return w === undefined ? stroke.call(this, tr(String(t)), x, y) : stroke.call(this, tr(String(t)), x, y, w); };
  (window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = missing;
}

/** 言語の切り替えボタン（上のバーに置く） */
export function langButton(className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `lang-btn ${className}`;
  b.textContent = current === 'ja' ? 'EN' : '日本語';
  b.title = current === 'ja' ? 'Switch to English' : '日本語にする';
  b.setAttribute('data-noi18n', '');
  b.addEventListener('click', () => setLang(current === 'ja' ? 'en' : 'ja'));
  return b;
}

/** 起動：言語を決めて辞書を入れる（英語のときだけ辞書を使う） */
export function initLang(en: Record<string, string>, force?: Lang): Lang {
  current = force ?? detectLang();
  if (current === 'en') setDictionary(en);
  return current;
}
