// 攻略本のスクリーンショットを自動で撮る（このパソコンの Chrome を Playwright で動かす）。
// 撮ったものは public/manual/img/ に入り、番号の吹き出しの位置は public/manual/img/callouts.json に書く。
// 実行：npx tsx scripts/manual/shots.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';
import { TOYS, type PartDef } from './parts';
import { COMPOSER_PARTS, SAMPLER_PARTS, SEQ_PARTS } from './extra-parts';
import { translateHtml } from './i18n-html';
import { defaultComposer } from '../../src/compose/rules';
import { renderSongStereo } from '../../src/studio/render';

/** まねっこの写真用の曲：このアプリのおもちゃで自動作曲したもの（権利の心配が無い）を WAV に */
function makeSongWav(path: string): void {
  const song = defaultComposer().compose({ settings: { seed: 2026, style: 'beat', chaos: 0.1, lengthSec: 30, bpm: 118 }, toys: [{ toy: 0, kind: 'piko' }, { toy: 1, kind: 'sampler' }] });
  const [L, R] = renderSongStereo(song, 44100, { toys: [1, 6] });
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.round(L[i] * 32767), 44 + i * 4); b.writeInt16LE(Math.round(R[i] * 32767), 46 + i * 4); }
  mkdirSync('out', { recursive: true });
  writeFileSync(path, b);
}
const SONG_WAV = 'out/manual-song.wav';

const trEn = (t: string) => translateHtml(t);

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let OUT = 'public/manual/img';
let LANG: 'ja' | 'en' = 'ja';
const PORT = 5199;

type Pos = { x: number; y: number } | null;
let callouts: Record<string, Pos[]> = {};

/** 部品の中心を、基準の要素の中の割合（0〜1）で */
async function locate(page: Page, rootSel: string, finds: PartDef['find'][]): Promise<Pos[]> {
  // 英語の画面では、文字で探す部品は英語の文字で探す
  if (LANG === 'en') finds = finds.map((f) => (f.text ? { ...f, text: trEn(f.text) } : f));
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

async function main(lang: 'ja' | 'en'): Promise<void> {
  LANG = lang;
  OUT = lang === 'en' ? 'public/manual/img/en' : 'public/manual/img';
  callouts = {};
  mkdirSync(OUT, { recursive: true });
  console.log(lang === 'en' ? '---- 英語の画面 ----' : '---- 日本語の画面 ----');
  const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const base = `http://localhost:${PORT}/`;
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1700, height: 1080 }, deviceScaleFactor: 1.5 });
    await ctx.addInitScript((l) => { localStorage.setItem('bentpc.lang', l); }, lang);
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
      // まねっこ：曲を入れて、解析が終わるまで待つ
      if (toy.id === 'mk') {
        await page.locator('.toy-mk input[type="file"]').setInputFiles(SONG_WAV);
        for (let i = 0; i < 60; i++) { await sleep(500); const t = await page.locator('.mk-label').textContent(); if (t && t !== 'READING…' && t !== 'NO TAPE') break; }
        await sleep(600);
      }
      const rootSel = `.toy-${toy.id}`;
      callouts[toy.id] = await locate(page, rootSel, toy.parts.map((p) => p.find));
      await page.locator(rootSel).screenshot({ path: `${OUT}/${toy.id}.jpg`, type: 'jpeg', quality: 86 });
      const miss = callouts[toy.id].map((c, i) => (c ? null : toy.parts[i].name)).filter(Boolean);
      console.log(`${toy.title}：撮影 OK${miss.length ? `（位置が見つからない：${miss.join('、')}）` : ''}`);
      // まねっこ：COVER! を押して、シーケンサーに入ったところ
      if (toy.id === 'mk') {
        await page.locator('[data-a="cover"]').click();
        await sleep(3500);
        await page.screenshot({ path: `${OUT}/mk-cover.jpg`, type: 'jpeg', quality: 84 });
        await page.keyboard.press('Space');
      }
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

    // ---- サンプラー PAKU-PAKU 16 ----
    const ctx3 = await browser.newContext({ viewport: { width: 1500, height: 920 }, deviceScaleFactor: 1.3 });
    await ctx3.addInitScript((l) => { localStorage.setItem('bentpc.lang', l); }, lang);
    const sp = await ctx3.newPage();
    sp.on('pageerror', (e) => console.log('ページのエラー', e.message));
    await sp.goto(`${base}sampler.html`);
    await sleep(1500);
    await sp.locator('#pk-cover').click();
    await sleep(500);
    await sp.locator('.pk-pad').nth(12).click(); // KICK
    await sleep(300);
    callouts.sampler = await locate(sp, '.paku', SAMPLER_PARTS.map((p) => p.find));
    await sp.locator('.paku').screenshot({ path: `${OUT}/sampler.jpg`, type: 'jpeg', quality: 86 });
    // パターン：ステップでビートを置いたところ
    await sp.locator('.pk-tabs [data-tab="ptn"]').click();
    const steps = async (padDom: number, list: number[]) => {
      await sp.locator('#pk-step').click(); // いまのパッドで STEP
      for (const s of list) await sp.locator('.pk-pad').nth(s).click();
      await sp.locator('#pk-step').click();
      void padDom;
    };
    await steps(12, [0, 4, 8, 12, 10]);
    await sp.locator('.pk-pad').nth(13).click(); // SNARE を選ぶ
    await steps(13, [4, 12]);
    await sp.locator('.pk-pad').nth(14).click(); // CL HAT
    await steps(14, [0, 2, 4, 6, 8, 10, 12, 14]);
    await sp.locator('#pk-pplay').click();
    await sleep(1300);
    await sp.locator('.paku').screenshot({ path: `${OUT}/sampler-ptn.jpg`, type: 'jpeg', quality: 86 });
    await sp.locator('#pk-pplay').click();
    // チョップ（バンク B のループ）
    await sp.locator('.pk-tabs [data-tab="edit"]').click();
    await sp.locator('.pk-bank[data-bank="1"]').click();
    await sp.locator('.pk-pad').nth(12).click();
    await sp.locator('#pk-stop').click();
    await sp.locator('#pk-ed-chop').click();
    await sleep(400);
    await sp.locator('.pk-ed-body button[data-c="auto"]').click();
    await sleep(300);
    await sp.locator('.paku').screenshot({ path: `${OUT}/sampler-chop.jpg`, type: 'jpeg', quality: 86 });
    await sp.locator('.pk-ed-x').click();
    // ベンド
    await sp.locator('.pk-tabs [data-tab="bend"]').click();
    for (const i of [0, 3, 5]) await sp.locator('.pk-wire').nth(i).click();
    await sleep(300);
    await sp.locator('.pk-funcs').screenshot({ path: `${OUT}/sampler-bend.jpg`, type: 'jpeg', quality: 88 });
    await sp.locator('#pk-unplug').click();
    console.log('サンプラー：撮影 OK');
    // スマホ（縦）
    const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx4.addInitScript((l) => { localStorage.setItem('bentpc.lang', l); }, lang);
    const ph = await ctx4.newPage();
    await ph.goto(`${base}sampler.html`);
    await sleep(1500);
    await ph.locator('#pk-cover').tap();
    await sleep(500);
    await ph.screenshot({ path: `${OUT}/sampler-phone.jpg`, type: 'jpeg', quality: 84 });
    console.log('サンプラー（スマホ）：撮影 OK');
    // スタジオにトイPC とサンプラーを並べる
    await page.goto(`${base}studio.html?toys=0,6`);
    await sleep(2000);
    await page.locator('#deck').screenshot({ path: `${OUT}/studio-sampler.jpg`, type: 'jpeg', quality: 84 });
    console.log('スタジオ＋サンプラー：撮影 OK');

    writeFileSync(`${OUT}/callouts.json`, JSON.stringify(callouts, null, 1));
  } finally {
    await browser.close();
    await server.close();
  }
}

(async () => { makeSongWav(SONG_WAV); await main('ja'); await main('en'); })().catch((e) => { console.error(e); process.exit(1); });
