// アイコン（PNG）と、共有したときに出る絵（OGP 1200×630）を public/ に作る。元は public/icon.svg。
// 実行：npx tsx scripts/make-icons.ts（このパソコンの Chrome を使う）
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: `public/icon-${size}.png`, omitBackground: true });
}
// 共有用の絵
await page.setViewportSize({ width: 1200, height: 630 });
const font = (f: string) => `data:font/woff2;base64,${readFileSync(f).toString('base64')}`;
await page.setContent(`<style>
@font-face{font-family:F;src:url(${font('node_modules/@fontsource/fredoka/files/fredoka-latin-700-normal.woff2')})}
@font-face{font-family:M;src:url(${font('node_modules/@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2')})}
html,body{margin:0;width:1200px;height:630px;background:radial-gradient(circle at 30% 40%,#3a2f5c,#141220 70%);color:#fff;font-family:F,sans-serif;overflow:hidden}
.w{display:flex;align-items:center;gap:56px;padding:90px 80px}
svg{width:360px;height:360px;flex:none;filter:drop-shadow(0 18px 30px rgba(0,0,0,.5))}
h1{font-family:M;font-size:96px;line-height:1;margin:0 0 24px;color:#f4c430;letter-spacing:2px}
p{margin:0;font-size:38px;line-height:1.45;color:#e9e4ff;font-family:F,"Yu Gothic UI","Meiryo",sans-serif;font-weight:700}
small{display:block;margin-top:26px;font-size:28px;color:#9cff57}
</style><div class="w">${svg}<div><h1>BENT TOY RACK</h1><p>魔改造したおもちゃ楽器で<br>遊ぶ・曲を作る・まねっこする</p><small>Circuit-bent toy instruments in your browser</small></div></div>`);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
console.log('OK icon-180/192/512.png・og.png');
