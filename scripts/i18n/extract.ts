// 英語版の辞書づくり：ソースの中の日本語の文字列を、画面に出る「かけら」に分けて書き出す。
// HTML の文字列はタグで切り、テンプレート文字列の ${…} は {0} {1} … にする（辞書でも同じ形で書く）。
// 実行：npx tsx scripts/i18n/extract.ts → scripts/i18n/ja.json（辞書に無いものは missing.json）
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../src/i18n/en';
import { initLang, tr } from '../../src/i18n/core';

const JP = /[぀-ヿ一-鿿！-｠]/;
const ROOTS = ['src', 'scripts/manual', 'index.html', 'studio.html', 'sampler.html'];
// 画面に出ないもの（シェーダーのコメント・撮影や PDF の作業の表示・辞書そのもの）は除く
const SKIP = [/src[\\/]i18n[\\/]/, /\.css$/, /scripts[\\/]manual[\\/](pdf|shots|seeds)\.ts/, /pipeline\.ts$/, /scripts[\\/]i18n/];

function files(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((f) => files(join(p, f)));
}

/** コメントを除いて、文字列リテラル（'' "" ``）を取り出す */
function literals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; } s += src[j++]; }
      out.push(s);
      i = j + 1;
      continue;
    }
    if (c === '`') {
      // テンプレート：${…} は {n} にする（中の入れ子も数える）
      let j = i + 1, s = '', n = 0;
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1, k = j + 2;
          const start = k;
          while (k < src.length && depth) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; else if (src[k] === '`') { /* 入れ子のテンプレート */ let m = k + 1; while (m < src.length && src[m] !== '`') m++; k = m; } k++; }
          const inner = src.slice(start, k - 1);
          // 中の日本語の文字列も別に拾う
          for (const l of literals(inner)) out.push(l);
          s += `{${n++}}`;
          j = k;
          continue;
        }
        s += src[j++];
      }
      out.push(s);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** 画面に出るかけら：タグで切って、前後の空白を取る */
export function fragments(s: string): string[] {
  // タグの中の title="…" などの説明も拾う
  const attrs = [...s.matchAll(/(?:title|placeholder|alt|aria-label)="([^"]*)"/g)].map((m) => m[1]);
  return [...attrs, ...s.split(/<[^>]*>/)]
    .map((x) => x.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((x) => JP.test(x));
}

const all = new Set<string>();
const where = new Map<string, string>();
for (const root of ROOTS) for (const f of files(root)) {
  if (SKIP.some((r) => r.test(f)) || !/\.(ts|html)$/.test(f)) continue;
  const src = readFileSync(f, 'utf8');
  const lits = f.endsWith('.html') ? [src] : literals(src);
  for (const l of lits) for (const fr of fragments(l)) { all.add(fr); if (!where.has(fr)) where.set(fr, f); }
}
const list = [...all].sort();
writeFileSync('scripts/i18n/ja.json', JSON.stringify(list, null, 1));
initLang(EN, 'en');
const missing = list.filter((s) => JP.test(tr(s).replace(/[・／＝：、。（）「」〜＋　]/g, '')));
writeFileSync('scripts/i18n/missing.json', JSON.stringify(missing.map((s) => [s, where.get(s)]), null, 1));
console.log(`かけら ${list.length} 個（${list.reduce((a, s) => a + s.length, 0)} 文字）・辞書に無いもの ${missing.length} 個`);
