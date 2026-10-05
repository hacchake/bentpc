// 画面の通しテスト（バグチェック）：本物の Chrome で全ページを開いて触り、エラーが出ないか・電源が入るか・はみ出さないかを見る。
// 実行：npx tsx scripts/smoke.ts（このパソコンの Chrome を使う）
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 5201;
const base = `http://localhost:${PORT}/`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ng = (m: string) => { fails++; console.log('NG', m); };
const ok = (m: string) => console.log('OK', m);

/** ページのエラーを集める（ブラウザの警告は除く） */
function watch(page: Page, name: string): string[] {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|ERR_INTERNET|net::/.test(m.text())) errs.push(`${name}: ${m.text()}`); });
  return errs;
}
const dots = (page: Page) => page.evaluate(() => [...document.querySelectorAll('#tabs .dot')].map((d) => (d.classList.contains('on') ? 1 : 0)));
const center = async (page: Page, sel: string) => {
  const b = await page.locator(sel).first().boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
};

async function rack(page: Page, mobile: boolean): Promise<void> {
  const tag = mobile ? 'スマホ縦' : 'PC';
  await page.goto(`${base}index.html?lang=ja`);
  await sleep(2500);
  for (let i = 0; i < 8; i++) {
    await page.locator('#tabs .tab').nth(i).click();
    await sleep(400);
    // おもちゃの真ん中あたりをさわる → 電源が入る
    const root = page.locator('.toy-root:visible').first();
    const b = await root.boundingBox();
    if (b) await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.75);
    await sleep(2200);
    const d = await dots(page);
    d[i] ? ok(`${tag}：${i + 1} 台目はさわると電源が入る`) : ng(`${tag}：${i + 1} 台目の電源が入らない`);
    // キーを弾く・ノブを回す
    for (const k of ['a', 's', 'd', 'f', '1', '2']) { await page.keyboard.down(k); await sleep(60); await page.keyboard.up(k); }
    const kn = page.locator('.toy-root:visible .knob').first();
    const kb = await kn.boundingBox().catch(() => null);
    if (kb) { await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await page.mouse.down(); await page.mouse.move(kb.x + kb.width / 2 + 30, kb.y - 30, { steps: 5 }); await page.mouse.up(); }
    // RESET（電源ボタン）→ いったん切れて入り直す（VROOMBOX はキーなので除く）
    if (i !== 3) {
      const pb = page.locator('.toy-root:visible [title*="再起動"]').first();
      if (await pb.count()) {
        await pb.click({ force: true });
        await sleep(2500);
        const d2 = await dots(page);
        d2[i] ? ok(`${tag}：${i + 1} 台目は RESET の後また入る`) : ng(`${tag}：${i + 1} 台目が RESET の後に入らない`);
      } else ng(`${tag}：${i + 1} 台目の RESET ボタンが見つからない`);
    }
    // はみ出し
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 2) ng(`${tag}：${i + 1} 台目で横にはみ出す（${over}px）`);
  }
  // 自動作曲 → 鳴らす → 止める（1 台目で。MANEKKO には自動作曲のパネルが無い）
  await page.locator('#tabs .tab').nth(0).click();
  await sleep(400);
  const dome = await center(page, '.dome.compose:visible');
  if (dome) {
    await page.mouse.click(dome.x, dome.y);
    await sleep(3000);
    await page.keyboard.press('Space');
    await sleep(500);
    ok(`${tag}：自動作曲して再生・停止`);
  } else ng(`${tag}：自動作曲のボタンが見つからない`);
}

async function main(): Promise<void> {
  const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const all: string[] = [];
  try {
    // ---- PC ----
    const pc = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const p = await pc.newPage();
    all.push(...watch(p, 'ラック PC'));
    await rack(p, false);

    // スタジオ：デモ曲を 4 秒鳴らす
    const s = await pc.newPage();
    all.push(...watch(s, 'スタジオ'));
    await s.goto(`${base}studio.html?lang=ja`);
    await sleep(2500);
    await s.locator('[title*="再生／停止"]').first().click();
    await sleep(4000);
    await s.locator('[title*="再生／停止"]').first().click();
    ok('スタジオ：デモ曲を再生・停止');

    // サンプラーのページ：はじめる → パッド → タブ → バンク
    const sm = await pc.newPage();
    all.push(...watch(sm, 'サンプラー'));
    await sm.goto(`${base}sampler.html?lang=ja`);
    await sleep(2500);
    await sm.locator('#pk-cover').click().catch(() => {});
    await sleep(800);
    const pads = sm.locator('.pk-pad');
    const n = await pads.count();
    for (let i = 0; i < Math.min(n, 16); i += 3) { await pads.nth(i).click(); await sleep(80); }
    for (const t of await sm.locator('.pk-tab, [data-tab]').all()) { await t.click().catch(() => {}); await sleep(150); }
    await sm.locator('.pk-bank').nth(15).click().catch(() => {});
    await sleep(300);
    n >= 16 ? ok(`サンプラー：パッド ${n} 個・タブ・バンク P`) : ng(`サンプラー：パッドが ${n} 個`);

    // 攻略本：画像がそろっているか
    for (const path of ['manual/index.html', 'manual/en/index.html']) {
      const m = await pc.newPage();
      all.push(...watch(m, path));
      await m.goto(base + path);
      await sleep(1500);
      // 画像は見えたときに読む（lazy）ので、ファイルがあるかを取りに行って確かめる
      const broken = await m.evaluate(async () => {
        const bad: string[] = [];
        for (const i of [...document.images]) { const r = await fetch(i.src).catch(() => null); if (!r || !r.ok) bad.push(i.getAttribute('src') ?? ''); }
        return bad;
      });
      broken.length ? ng(`${path}：画像が出ない ${broken.join(' ')}`) : ok(`${path}：画像はすべて出る`);
    }

    // ---- スマホ縦（タッチ） ----
    const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mp = await mob.newPage();
    all.push(...watch(mp, 'ラック スマホ'));
    await rack(mp, true);
    const ms = await mob.newPage();
    all.push(...watch(ms, 'サンプラー スマホ'));
    await ms.goto(`${base}sampler.html?lang=ja`);
    await sleep(2000);
    const over = await ms.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    over > 2 ? ng(`サンプラー（スマホ）：横にはみ出す ${over}px`) : ok('サンプラー（スマホ）：はみ出さない');
    const st = await mob.newPage();
    all.push(...watch(st, 'スタジオ スマホ'));
    await st.goto(`${base}studio.html?lang=ja`);
    await sleep(2500);
    const over2 = await st.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    over2 > 2 ? ng(`スタジオ（スマホ）：横にはみ出す ${over2}px`) : ok('スタジオ（スマホ）：はみ出さない');

    // ---- 英語 ----
    const en = await pc.newPage();
    all.push(...watch(en, 'ラック 英語'));
    await en.goto(`${base}index.html?lang=en`);
    await sleep(2500);
    const jp = await en.evaluate(() => {
      const out: string[] = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('[data-noi18n], script, style') || el.offsetParent === null) continue;
        if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(n.textContent ?? '')) out.push((n.textContent ?? '').trim().slice(0, 30));
      }
      return out.filter((t) => t !== '日本語');
    });
    jp.length ? ng(`英語の画面に日本語が残っている：${jp.slice(0, 6).join(' / ')}`) : ok('英語の画面に日本語は残っていない');
  } finally {
    await browser.close();
    await server.close();
  }
  all.length ? all.slice(0, 20).forEach((e) => ng(`エラー ${e}`)) : ok('どのページでもエラーは出ない');
  console.log(fails ? `NG ${fails} 個` : 'すべて OK');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
