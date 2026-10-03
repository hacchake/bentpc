// 攻略本を PDF にする（このパソコンの Chrome で印刷）→ public/manual/bent-toy-rack-manual.pdf
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage();
  for (const [url, out] of [['manual/index.html', 'public/manual/bent-toy-rack-manual.pdf'], ['manual/en/index.html', 'public/manual/en/bent-toy-rack-manual.pdf']]) {
    await page.goto(`http://localhost:5198/${url}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
    console.log(`${out} を作りました`);
  }
} finally {
  await browser.close();
  await server.close();
}
