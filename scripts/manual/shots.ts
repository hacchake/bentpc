// 攻略本のスクリーンショットを自動で撮る（このパソコンの Chrome を Playwright で動かす）。
// 撮ったものは public/manual/img/ に入り、番号の吹き出しの位置は public/manual/img/callouts.json に書く。
// 実行：npx tsx scripts/manual/shots.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';
import { TOYS, type PartDef } from './parts';
import { COMPOSER_PARTS, SEQ_PARTS } from './extra-parts';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'public/manual/img';
const PORT = 5199;

type Pos = { x: number; y: number } | null;
const callouts: Record<string, Pos[]> = {};

/** 部品の中心を、基準の要素の中の割合（0〜1）で */
async function locate(page: Page, rootSel: string, finds: PartDef['find'][]): Promise<Pos[]> {
  return page.evaluate(([rs, fs]) => {
    const root = document.querySelector(rs as string) as HTMLElement;
    const R = root.getBoundingClientRect();
    return (fs as { text?: string; sel?: string; nth?: number }[]).map((f) => {
      let el: Element | undefined;
      if (f.sel) el = root.querySelectorAll(f.sel)[f.nth ?? 0];
      else {
        const all = [...root.querySelectorAll('*')].filter((e) => e.childElementCount === 0 && e.textContent?.trim() === f.text && (e as HTMLElement).offsetParent !== null);
        el = all[f.nth ?? 0];
      }
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - R.left) / R.width, y: (r.top + r.height / 2 - R.top) / R.height };
    });
  }, [rootSel, finds] as const);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const base = `http://localhost:${PORT}/`;
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1700, height: 1080 }, deviceScaleFactor: 1.5 });
    await ctx.addInitScript(() => {
      localStorage.setItem('bentpc.powerGuide.done', '1');
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('ページのエラー', e.message));

    // ---- 各おもちゃ（電源を入れた状態） ----
    for (const toy of TOYS) {
      await page.goto(base);
      await page.evaluate((i) => (document.querySelectorAll('#tabs button')[i] as HTMLElement).click(), toy.index);
      await sleep(600);
      await page.keyboard.press('Enter'); // 電源 ON
      await sleep(toy.id === 'blippy' ? 3200 : 1500);
      if (toy.id === 'blippy') { await page.keyboard.press('ArrowRight'); await sleep(400); await page.keyboard.press('KeyK'); await sleep(600); }
      const rootSel = `.toy-${toy.id}`;
      callouts[toy.id] = await locate(page, rootSel, toy.parts.map((p) => p.find));
      await page.locator(rootSel).screenshot({ path: `${OUT}/${toy.id}.jpg`, type: 'jpeg', quality: 86 });
      const miss = callouts[toy.id].map((c, i) => (c ? null : toy.parts[i].name)).filter(Boolean);
      console.log(`${toy.title}：撮影 OK${miss.length ? `（位置が見つからない：${miss.join('、')}）` : ''}`);
      // 自動作曲ユニット（トイPC のものを代表で）
      if (toy.id === 'blippy') {
        callouts.composer = await locate(page, `.compose-panel`, COMPOSER_PARTS.map((p) => p.find));
        await page.locator('.compose-panel').first().screenshot({ path: `${OUT}/composer.jpg`, type: 'jpeg', quality: 88 });
      }
      // TELEKEY：グリッチキーを押している瞬間のモニター
      if (toy.id === 'tele') {
        await page.keyboard.down('KeyE');
        await page.keyboard.down('KeyG');
        await sleep(450);
        await page.locator('.tk-screen').screenshot({ path: `${OUT}/tele-glitch.jpg`, type: 'jpeg', quality: 86 });
        await page.keyboard.up('KeyE');
        await page.keyboard.up('KeyG');
        await sleep(300);
        await page.locator('.tk-screen').screenshot({ path: `${OUT}/tele-clean.jpg`, type: 'jpeg', quality: 86 });
      }
    }

    // ---- 最初の電源の案内（初めて開いたとき） ----
    const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
    await ctx2.addInitScript(() => { localStorage.setItem('bentpc.activeToy', '0'); });
    const p2 = await ctx2.newPage();
    await p2.goto(base);
    await sleep(1200);
    await p2.screenshot({ path: `${OUT}/guide.jpg`, type: 'jpeg', quality: 84 });
    console.log('電源の案内：撮影 OK');

    // ---- スタジオ（デモ曲） ----
    await page.goto(`${base}studio.html?toys=0,5&demo=1`);
    await sleep(1500);
    await page.keyboard.press('Enter'); // TELEKEY に電源
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/studio.jpg`, type: 'jpeg', quality: 84 });
    callouts.seq = await locate(page, '.arr', SEQ_PARTS.map((p) => p.find));
    await page.locator('.arr').screenshot({ path: `${OUT}/sequencer.jpg`, type: 'jpeg', quality: 86 });
    // クラッシュ中の見た目
    await page.evaluate(() => document.querySelectorAll('.slot:not(.compose-slot)').forEach((s) => s.classList.add('crashed')));
    await sleep(200);
    await page.locator('#deck').screenshot({ path: `${OUT}/crash.jpg`, type: 'jpeg', quality: 84 });
    console.log('スタジオ：撮影 OK');

    // ---- スタジオ（おもちゃを 3 台並べる） ----
    await page.goto(`${base}studio.html?toys=0,1,4`);
    await sleep(1500);
    await page.locator('#deck').screenshot({ path: `${OUT}/studio3.jpg`, type: 'jpeg', quality: 84 });
    console.log('スタジオ 3 台：撮影 OK');

    writeFileSync(`${OUT}/callouts.json`, JSON.stringify(callouts, null, 1));
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
