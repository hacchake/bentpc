// 攻略本のページ（public/manual/index.html）を作る。
// 表はプログラムの中身（キー・モード・グリッチ・スタイルの表）から作るので、実物とずれない。
// 先に shots.ts（スクリーンショット）と seeds.ts（おすすめシード）を実行しておく。
// 実行：npx tsx scripts/manual/build.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { translateHtml, untranslated } from './i18n-html';
import { FUNCTION_KEY_LABELS, LETTER_KEYS, MODE_NAMES, NUMBER_KEY_LABELS } from '../../src/toys/blippy/params';
import { WORDS } from '../../src/toys/blippy/dsp/phonemes';
import { DRUM_NAMES, SFX_NAMES } from '../../src/toys/blippy/dsp/soundbank';
import { BASE_NAMES, BURSTS, GLITCHES, TELE_LAYOUT, TELE_NAV } from '../../src/toys/tele/params';
import { styleOf, STYLE_IDS } from '../../src/compose/styles';
import { TOYS, type PartDef } from './parts';
import { COMPOSER_PARTS, SAMPLER_PARTS, SEQ_PARTS } from './extra-parts';
import { FX_LIST } from '../../src/sampler/dsp/fx';
import { WIRES } from '../../src/sampler/dsp/bend';
import { BLIPPY_GLITCH, BURST_WHAT, COMBOS, GLOSSARY, QA, TRICKS } from './content';

const IMG = 'public/manual/img';
type Callouts = Record<string, ({ x: number; y: number } | null)[]>;
let callouts: Callouts = JSON.parse(readFileSync(`${IMG}/callouts.json`, 'utf8'));
const seeds: { where: string; style: string; name: string; seed: number; chaos: number; url: string; contrast: number; mean: number }[] =
  existsSync(`${IMG}/seeds.json`) ? JSON.parse(readFileSync(`${IMG}/seeds.json`, 'utf8')) : [];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stars = (n: number) => `<span class="stars">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;

/** 画像＋番号の吹き出し＋説明の一覧 */
function figure(img: string, key: string, parts: PartDef[], caption: string, cls = ''): string {
  const pos = callouts[key] ?? [];
  const badges = parts.map((_, i) => {
    const p = pos[i];
    return p ? `<span class="badge" style="left:${(p.x * 100).toFixed(2)}%;top:${(p.y * 100).toFixed(2)}%">${i + 1}</span>` : '';
  }).join('');
  const list = parts.map((p, i) => `<li><b class="num">${i + 1}</b><div><h4>${esc(p.name)}</h4><p>${esc(p.what)}</p>${p.tip ? `<p class="tip">💡 ${esc(p.tip)}</p>` : ''}</div></li>`).join('');
  return `<figure class="shot ${cls}"><div class="frame"><img src="img/${img}" alt="${esc(caption)}" loading="lazy">${badges}</div><figcaption>${esc(caption)}</figcaption></figure>
  <ol class="parts">${list}</ol>`;
}

const point = (title: string, body: string) => `<div class="box point"><div class="box-h">★ ${title}</div>${body}</div>`;
const warn = (title: string, body: string) => `<div class="box warn"><div class="box-h">⚠ ${title}</div>${body}</div>`;
const bubble = (who: string, text: string) => `<div class="bubble"><span class="who">${who}</span><p>${text}</p></div>`;
let chapterNo = 0;
const chapter = (title: string, sub: string, body: string, id: string) => {
  chapterNo++;
  return `<section class="chapter" id="${id}"><header class="ch-head"><span class="ch-no">${chapterNo}</span><div><h2>${title}</h2><p>${sub}</p></div></header>${body}</section>`;
};

// ================= 4 章：トイPC のモード × キー =================
function blippyTable(): string {
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const piano = (k: number) => { const m = 48 + 12 * Math.floor(k / 7) + MAJOR[k % 7]; return `${NOTE[m % 12]}${Math.floor(m / 12) - 1}`; };
  const head = `<tr><th>キー</th>${MODE_NAMES.map((m, i) => `<th>${i + 1}. ${m}</th>`).join('')}</tr>`;
  const rows = LETTER_KEYS.map((l, k) => `<tr><th>${l}</th><td>${l}</td><td>${WORDS[l][0]}</td><td>メロディ ${l}</td><td>${piano(k)}</td><td>${DRUM_NAMES[k % 8]}</td><td>${SFX_NAMES[k % 10]}</td><td>答え ${l}</td><td>${l} IS FOR ${WORDS[l][0]}</td></tr>`).join('');
  const fnWhat = ['♪ MUSIC（そのモードのメロディ）', '? 決まり文句をしゃべる', '★ 効果音', 'OK「GOOD JOB」'];
  const fnRows = FUNCTION_KEY_LABELS.map((f, i) => {
    const generic = fnWhat[i];
    const piano2 = `和音 ${['C', 'F', 'G', 'Am'][i]}`;
    const drum = `BEAT ${i + 1}（1 小節のリズム）`;
    const quiz = ['問題をもう一度', '次の問題', 'ヒント（答えの文字）', '「GOOD JOB」'][i];
    return `<tr><th>${f}</th><td>${generic}</td><td>${generic}</td><td>${generic}</td><td>${piano2}</td><td>${drum}</td><td>${generic}</td><td>${quiz}</td><td>${generic}</td></tr>`;
  }).join('');
  const nums = NUMBER_KEY_LABELS.map((n, i) => `${i + 1}=${n}`).join('・');
  return `<div class="wide"><table class="grid small"><thead>${head}</thead><tbody>${rows}${fnRows}
    <tr><th>1〜0</th><td colspan="8">どのモードでも、ドレミの音（${nums}）</td></tr></tbody></table></div>`;
}

// ================= 5 章：グリッチ大全 =================
function blippyGlitchTable(): string {
  return BLIPPY_GLITCH.map((g) => `<h4 class="base">BASE ${esc(g.base)}</h4><table class="grid"><tr><th>ボタン</th><th>名前</th><th>何が起きる？</th><th>凶暴度</th></tr>${g.items.map((it, i) => `<tr><td class="c">GLITCH ${i + 1}</td><td><b>${it.name}</b></td><td>${esc(it.what)}</td><td class="c">${stars(it.star)}</td></tr>`).join('')}</table>`).join('');
}
function teleBurstTable(): string {
  const star = (b: { extra: string; glitches: number[] }) => Math.min(5, 1 + b.glitches.length + (['chaos', 'dive', 'scatter', 'howl'].includes(b.extra) ? 1 : 0));
  return BURSTS.map((row, bi) => `<h4 class="base">BASE ${bi + 1} ${BASE_NAMES[bi]}</h4><table class="grid"><tr><th>ボタン</th><th>名前</th><th>何が起きる？</th><th>長さ</th><th>凶暴度</th></tr>${row.map((b, i) => {
    const gl = b.glitches.map((n) => `${GLITCHES[n].v}／${GLITCHES[n].a}`).join('＋');
    return `<tr><td class="c">F${i + 1}</td><td><b>${b.name}</b></td><td>${esc(BURST_WHAT[b.extra] ?? '')}${gl ? `<br><small>かかるグリッチ：${esc(gl)}</small>` : ''}</td><td class="c">${b.dur} 秒</td><td class="c">${stars(star(b))}</td></tr>`;
  }).join('')}</table>`).join('');
}

// ================= 8 章：TELEKEY のキー配置 =================
function teleKeyMap(): string {
  const rows = TELE_LAYOUT.map((row) => `<div class="kb-row">${row.map((k) => {
    if (!k.code) return `<span class="kb-gap" style="flex:${k.w}"></span>`;
    const r = k.role.r;
    const sub = r === 'glitch' ? `${GLITCHES[(k.role as { n: number }).n].v}<br>${GLITCHES[(k.role as { n: number }).n].a}` : (k.fnLabel ?? '');
    return `<span class="kb-key r-${r}" style="flex:${k.w}"><b>${esc(k.label)}</b><small>${sub}</small></span>`;
  }).join('')}</div>`).join('');
  const nav = TELE_NAV.map((k) => `<span class="kb-key r-fn"><b>${esc(k.label)}</b><small>${esc(k.fnLabel)}</small></span>`).join('');
  return `<div class="kbmap">${rows}<div class="kb-row nav">${nav}</div></div>
  <p class="legend"><span class="kb-key r-glitch">グリッチ</span><span class="kb-key r-inst">楽器</span><span class="kb-key r-bang">GLITCH ボタン</span><span class="kb-key r-base">BASE</span><span class="kb-key r-cue">キュー</span><span class="kb-key r-fn">機能</span></p>`;
}
function teleGlitchTable(): string {
  const keys = TELE_LAYOUT.flat().filter((k) => k.role.r === 'glitch');
  return `<table class="grid"><tr><th>キー</th><th>映像の壊れ方</th><th>音の壊れ方</th></tr>${keys.map((k) => {
    const g = GLITCHES[(k.role as { n: number }).n];
    return `<tr><td class="c"><b>${esc(k.label)}</b></td><td>${g.v}</td><td>${g.a}</td></tr>`;
  }).join('')}</table>`;
}

// ================= 9 章：スタイルの表 =================
function styleTable(): string {
  return `<table class="grid"><tr><th>STYLE</th><th>どんな曲</th><th>テンポ</th><th>グリッチ</th><th>クラッシュ</th></tr>${STYLE_IDS.map((id) => {
    const s = styleOf(id);
    const crash = s.crashAt <= 0 ? '必ず（最後に崩壊）' : s.crashAt > 1 ? 'なし' : `壊れ度 ${Math.round(s.crashAt * 100)}% 以上でブレイクに`;
    return `<tr><td><small>${s.group}</small><br><b>${s.name}</b></td><td>${s.desc}</td><td class="c">${s.bpm}（${s.bpmRange[0]}〜${s.bpmRange[1]}）</td><td class="c">${stars(Math.max(1, Math.min(5, Math.round(s.glitch * 3.5))))}</td><td>${crash}</td></tr>`;
  }).join('')}</table>`;
}

function seedList(): string {
  if (!seeds.length) return '<p>（準備中）</p>';
  const row = (s: (typeof seeds)[number]) => `<tr><td><b>${s.name}</b></td><td class="c">${s.seed}</td><td class="c">${Math.round(s.chaos * 100)}%</td><td class="c">${stars(Math.max(1, Math.min(5, Math.round(s.contrast * 1.3))))}</td><td><a href="${s.url}">${s.where === 'studio' ? 'スタジオで聞く ▶' : 'ラックで聞く ▶'}</a></td></tr>`;
  const studio = seeds.filter((s) => s.where === 'studio');
  const rack = seeds.filter((s) => s.where === 'rack');
  return `<h3>スタジオ編（トイPC ＋ TELEKEY の合同・1 分）</h3><table class="grid"><tr><th>STYLE</th><th>SEED</th><th>壊れ度</th><th>盛り上がり</th><th>リンク</th></tr>${studio.map(row).join('')}</table>
  <h3>トイPC ソロ編（1 分）</h3><table class="grid"><tr><th>STYLE</th><th>SEED</th><th>壊れ度</th><th>盛り上がり</th><th>リンク</th></tr>${rack.map(row).join('')}</table>`;
}

// ================= 本文 =================
const powerRows = TOYS.map((t) => `<tr><td><b>${t.index + 1}. ${t.title}</b></td><td>${esc(t.power)}</td></tr>`).join('');

function makeHtml(): string {
  const body = [
    // ---- 表紙 ----
    `<section class="cover">
      <div class="cover-band">完全攻略本</div>
      <h1>BENT TOY RACK<small>ベント・トイ・ラック</small></h1>
      <p class="cover-sub">魔改造おもちゃ 7 機種（サンプラー入り）＋ スタジオ ＋ 自動作曲 まるごと対応！</p>
      <div class="cover-grid">${TOYS.map((t) => `<img src="img/${t.id}.jpg" alt="${t.title}">`).join('')}</div>
      <div class="cover-stars">★ 全ボタン図解 ★ グリッチ 50 種データ ★ 必殺コンボ ★ クラッシュ攻略 ★ おすすめシード ★</div>
    </section>`,
    // ---- 目次 ----
    `<nav class="toc"><h2>もくじ</h2><ol>
      <li><a href="#intro">はじめに：魔改造おもちゃとは？</a></li><li><a href="#power">まずは電源を入れよう！</a></li>
      <li><a href="#parts">各パーツ完全解説</a></li><li><a href="#keys">モード・キー全データ</a></li>
      <li><a href="#glitch">グリッチ大全</a></li><li><a href="#combo">必殺コンボ集</a></li><li><a href="#crash">クラッシュ攻略</a></li>
      <li><a href="#video">映像マシン編</a></li><li><a href="#seq">シーケンサー＆自動作曲編</a></li><li><a href="#sampler">サンプラー編</a></li><li><a href="#seeds">おすすめシード値コレクション</a></li>
      <li><a href="#tricks">裏技・隠し要素</a></li><li><a href="#qa">困ったときは（Q&amp;A）</a></li><li><a href="#words">用語集</a></li><li><a href="#rights">権利に関する注意</a></li></ol></nav>`,
  
    chapter('はじめに：魔改造おもちゃとは？', 'ようこそ、壊れた音の世界へ！', `
      <p class="lead">ここは、ガラクタ市で拾ってきた子供向けのおもちゃ楽器を、とことん改造した「魔改造おもちゃ」が並ぶラックだ！</p>
      <p>おもちゃの中の回路を、わざとつなぎ変えたり、ボタンやツマミを後から付け足したりして、作った人が思ってもみなかった音を出す遊びを<b>サーキットベンディング</b>という。
      このアプリは、その魔改造おもちゃを 7 台（サンプラー入り）、パソコンの中にまるごと作ったものだ。本物と違って、どれだけいじっても壊れないし、感電もしない！</p>
      <div class="cards">${TOYS.map((t) => `<div class="card"><img src="img/${t.id}.jpg" alt=""><h4>${t.index + 1}. ${t.title}</h4><p class="catch">${esc(t.catch)}</p><p>${esc(t.desc)}</p></div>`).join('')}</div>
      ${bubble('改造おじさん', 'どれも「読み上げがまちがう」「電気が足りなくてよれる」「エンジンで音階を弾く」みたいに、ちゃんと壊れ方にクセがあるんだ。1 台ずつ、クセをつかむのがうまくなる近道だぞ！')}
      ${point('ここがポイント！', '<p>全部のおもちゃは、上のタブ（1〜7）で切り替える。裏にいるおもちゃも鳴り続けるので、重ねて演奏できる。<b>STUDIO</b> では好きなおもちゃを並べて、いっしょに曲を作れる。</p>')}`, 'intro'),
  
    chapter('まずは電源を入れよう！', '最初の 3 分でやること', `
      <figure class="shot"><div class="frame"><img src="img/guide.jpg" alt="最初の案内"></div><figcaption>初めて開くと、画面が暗くなって POWER ボタンだけが光る。「電源を入れてね」の矢印の先を押そう！</figcaption></figure>
      <table class="grid"><tr><th>おもちゃ</th><th>POWER の場所</th></tr>${powerRows}</table>
      ${point('ここがポイント！', '<ul><li>電源 OFF の間は、POWER の横の LED がゆっくり点滅して「ここを押して」と教えてくれる。</li><li><b>キーボードの Enter</b> でも電源が入る（電源 OFF のとき）。</li><li>電源 OFF のままキーやツマミを触ると、POWER ボタンがピカッと光る。</li><li>ブラウザは「最初に操作するまで音を出さない」決まりがあるけど、電源を入れる操作で音の準備も済む。</li></ul>')}
      <h3>最初の 3 分でやること</h3>
      <ol class="steps"><li><b>電源を入れる</b>：1. BLIPPY なら「HELLO」としゃべる。</li><li><b>好きなキーを弾く</b>：PC キーボードの A〜Z がそのまま鳴る。</li><li><b>グリッチを押しながら弾く</b>：トイPC なら , . / ; : キーが GLITCH 1〜5。押している間だけ壊れる！</li><li><b>自動作曲</b>：右の緑の基板の赤いボタンを押すと、そのおもちゃの曲ができて鳴り出す。</li></ol>
      ${bubble('改造おじさん', 'ヘルプ（右上の ?）の中の「電源の案内をもう一度見る」で、最初の案内をまた見られるぞ。')}`, 'power'),
  
    chapter('各パーツ完全解説', '全ボタン・ノブ・スイッチを図解！', TOYS.map((t) => `
      <article class="toy-page"><h3 class="toy-title"><span>${t.index + 1}</span>${t.title}<small>${esc(t.catch)}</small></h3>
      <p>${esc(t.desc)}</p>
      ${figure(`${t.id}.jpg`, t.id, t.parts, `${t.title}（電源を入れたところ）`, t.id === 'tele' || t.id === 'typo' ? 'wide-shot' : '')}</article>`).join(''), 'parts'),
  
    chapter('モード・キー全データ', 'トイPC の 8 モード × 全キー', `
      <p>トイPC（BLIPPY BOOK 30）は、MODE によって同じキーから出る音が変わる。全部のキーの一覧だ！</p>
      ${point('音が出ない「死にキー」は…', '<p><b>ありません！</b> このトイPC は全部のキーで必ず何か鳴るように作ってある。QUIZ モードで違う文字を押しても「NO!」「TRY AGAIN」としゃべる。</p>')}
      ${blippyTable()}
      <p class="note">QUIZ モード：液晶のキャラの文字を押すと「RIGHT!」→ 次の問題。違う文字だと「NO!」か「TRY AGAIN」。TUNE モードの「メロディ」は文字ごとに違う短い曲。</p>
      ${warn('注意！', '<p>1 音ずつしか鳴らない。新しいキーを押すと、前の音は止まる（本物のおもちゃと同じ）。長い「K IS FOR KING」の途中で別のキーを押すと切れてしまうぞ。</p>')}`, 'keys'),
  
    chapter('グリッチ大全', 'GLITCH × BASE の全 50 種を凶暴度つきで！', `
      <h3>トイPC：GLITCH 1〜5 × BASE 1〜5 ＝ 25 種</h3>
      <p>押している間だけ効く。いくつ同時に押してもいい（重ねがけ）。凶暴度は、音の壊れ方の激しさのめやすだ。</p>
      ${blippyGlitchTable()}
      <h3>TELEKEY：GLITCH ボタン（F1〜F5）× BASE（F6〜F10）＝ 25 種の一発グリッチ</h3>
      <p>押すと 1 秒前後（表の「長さ」）、映像と音がいっしょに派手に壊れる「一発技」だ。</p>
      ${teleBurstTable()}`, 'glitch'),
  
    chapter('必殺コンボ集', 'この組み合わせを覚えろ！', `<div class="combos">${COMBOS.map((c) => `<div class="combo"><div class="combo-h"><span class="toy">${esc(c.toy)}</span><h4>${esc(c.name)}</h4>${stars(c.star)}</div><ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><p class="why">👉 ${esc(c.why)}</p></div>`).join('')}</div>`, 'combo'),
  
    chapter('クラッシュ攻略', '熱をためて、ギリギリで粘れ！', `
      <p class="lead">このアプリのおもちゃは、弾いているだけで勝手に固まることは<b>ない</b>。そのかわり「熱（ストレス）」がある！</p>
      <h3>熱のしくみ（トイPC・TELEKEY）</h3>
      <table class="grid"><tr><th></th><th>トイPC</th><th>TELEKEY</th></tr>
        <tr><td>熱が上がる</td><td>GLITCH ボタンを押し続けるほど（2 個・3 個と増やすとぐんと速い）。BASE が高いほど、DIST・LOOP・STRETCH 中ほど、グリッチ中にキーを連打するほど</td><td>効いているグリッチキーが多いほど。一発グリッチ・連打・FEEDBACK / DIST / GLITCH AMT の振り切り・CROSSTALK でも上がる</td></tr>
        <tr><td>暴発</td><td>熱が 40% をこえると、押していないグリッチが 20〜150ms 勝手に入る</td><td>熱が 45% をこえると、勝手にグリッチ・砂嵐・音の張り付き・一瞬の無音が起きる。HEAT の LED が速く点滅し、画面が震える</td></tr>
        <tr><td>めやす</td><td>GLITCH 1 個押しっぱなし → 約 18 秒で暴発、2 個 → 約 4 秒、3 個 → 約 2 秒</td><td>グリッチキー 1 個ならほぼ平気、2 個で約 6 秒、3 個で約 5 秒</td></tr>
        <tr><td>冷ます</td><td>手を離すと 2〜7 秒で落ち着く。RESET（Esc）で熱は 0 に（ただし CPU も止まる）</td><td>手を離すと約 8 秒で落ち着く。Esc（RESET）ですぐ 0 に</td></tr></table>
      ${point('ギリギリで粘るコツ', '<ul><li>グリッチは「押しっぱなし」より「拍に合わせて短く」。熱がたまりにくく、リズムにも乗る。</li><li>暴発が始まったら、1 個だけ離す。熱の上がり方は押している数でぐんと変わる。</li><li>トイPC は吹き出しで「熱くなりすぎ！」と教えてくれる。TELEKEY は HEAT の LED をよく見よう。</li><li>暴発も演奏のうち！ 気に入ったら、あえて熱いまま粘るのもアリだ。</li></ul>')}
      <h3>本当のクラッシュ：シーケンサーの CRASH</h3>
      <figure class="shot"><div class="frame"><img src="img/crash.jpg" alt="クラッシュ中"></div><figcaption>CRASH の間：音が張り付いたあと無音になり、画面が固まって「SYSTEM HALTED」。終わると ① RESET → ② POWER で自動で再起動する</figcaption></figure>
      <p>シーケンサーの ⚡ システムの行に <b>CRASH→再起動</b> の音符を置くと、その長さの間、わざとクラッシュさせられる。自動作曲では、壊れ度が高いとブレイクに入り、「崩壊」スタイルでは必ず最後に入る。</p>
      <h3>復帰の手順</h3>
      <ol class="steps"><li><b>RESET</b>：トイPC なら Esc か RESET ボタン。CPU が止まって電源が切れた状態になる（吹き出しで教えてくれる）。</li><li><b>POWER</b>：もう一度 POWER（または Enter）で起動し直す。「HELLO」が聞こえたら復活！</li><li>シーケンサーの CRASH は、音符が終わると自動で RESET → 再起動する。止めたいときは ■（停止）。</li></ol>
      ${warn('注意！', '<p>トイPC の LOOP スイッチがいちばん下（MUTE）だと、RESET のあと POWER を押しても起動しない。スイッチを上か真ん中に戻そう。</p>')}`, 'crash'),
  
    chapter('映像マシン編', 'TELEKEY TK-6 で映像を壊せ！', `
      <div class="two"><figure class="shot"><div class="frame"><img src="img/tele-clean.jpg" alt=""></div><figcaption>テスト映像（ふつう）</figcaption></figure><figure class="shot"><div class="frame"><img src="img/tele-glitch.jpg" alt=""></div><figcaption>E（${GLITCHES[2].v}）と G（${GLITCHES[16].v}）を押している瞬間</figcaption></figure></div>
      <h3>入力は 3 種類（＋テスト映像）</h3>
      <table class="grid"><tr><th>ボタン</th><th>何が映る？</th><th>始め方</th></tr>
        <tr><td><b>CAM</b></td><td>Web カメラ</td><td>最初に開いたときは自動でカメラ。ブラウザに聞かれたら「許可」。許可しなければ TEST になる</td></tr>
        <tr><td><b>TAB を取り込む</b></td><td>別のタブの映像と音</td><td>下の図の手順。映像も音も全部壊せる</td></tr>
        <tr><td><b>FILE</b></td><td>手持ちの動画ファイル</td><td>ボタンを押して選ぶか、画面に動画をドラッグ＆ドロップ</td></tr>
        <tr><td><b>TEST</b></td><td>自動で作るテスト映像（カラーバー・図形・トンネル・テストカード）＋テスト信号の音</td><td>ボタンを押すだけ。自由に使ってよい素材</td></tr></table>
      <h3>タブ共有の手順（Chrome）</h3>
      <div class="flow"><div class="flow-step"><b>1</b><p>見せたい動画を<b>別のタブ</b>で再生しておく</p></div><div class="flow-step"><b>2</b><p>TELEKEY のモニターの下の<b>「TAB を取り込む」</b></p></div><div class="flow-step"><b>3</b><p>Chrome の画面で<b>「タブ」</b>を選び、そのタブを選ぶ</p></div><div class="flow-step"><b>4</b><p><b>「タブの音声も共有する」をオン</b></p></div><div class="flow-step"><b>5</b><p><b>「共有」</b>を押す。取り込んだタブの音は自動で止まり、壊した音だけ聞こえる</p></div></div>
      ${warn('注意！', '<p>モニターの下に「TAB（音声なし…）」と出たら、手順 4 を忘れている。もう一度取り込み直そう。取り込みを止めると TEST に戻る。</p>')}
      <h3>キー配置マップ</h3>${teleKeyMap()}
      <h3>映像＋音のグリッチ 24 種</h3><p>押している間だけ効く。何個でも同時に押せる（そのぶん熱もたまる）。</p>${teleGlitchTable()}
      ${point('録画しよう', '<p>モニター左上の <b>● REC VIDEO</b> で、壊した後の映像と音を WebM で保存できる。もう一度押すと止めて保存。音だけなら上のバーの REC（WAV）。</p>')}`, 'video'),
  
    chapter('シーケンサー＆自動作曲編', '録って、直して、作らせろ！', `
      ${figure('sequencer.jpg', 'seq', SEQ_PARTS, 'シーケンサー（スタジオ。ラックの ☰ SEQ も同じ画面）', 'wide-shot')}
      <h3>録音する</h3><ol class="steps"><li>● REC を押す（止まっていれば再生も始まる）</li><li>おもちゃを弾く。キーもボタンもツマミの動きも記録される</li><li>ループの終わりに来るたびに曲に重なる（オーバーダブ）。もう一度 ● REC か ■ で終わり</li></ol>
      <h3>直す</h3><table class="grid"><tr><th>やりたいこと</th><th>操作</th></tr>
        <tr><td>音符を足す</td><td>行の上をダブルクリック</td></tr><tr><td>動かす・長さを変える</td><td>ドラッグ（音符の右端をドラッグで長さ）</td></tr>
        <tr><td>消す</td><td>右クリック、または選んで Delete</td></tr><tr><td>まとめて選ぶ</td><td>空いた所をドラッグ</td></tr>
        <tr><td>ノブの動きを描く</td><td>◠ ノブの行をダブルクリックで点を足し、ドラッグで動かす（点と点の間はなめらかにつながる）</td></tr>
        <tr><td>スイッチの値を変える</td><td>⇄ の行の点の上でホイール</td></tr>
        <tr><td>行を足す</td><td>トラック名の右の ＋</td></tr><tr><td>コピー・貼り付け・複製</td><td>Ctrl+C・Ctrl+V（再生位置に）・Ctrl+D（すぐ後ろに）</td></tr>
        <tr><td>元に戻す・やり直し</td><td>Ctrl+Z・Ctrl+Y</td></tr><tr><td>セクション名</td><td>目盛りの上段をダブルクリック</td></tr><tr><td>ループ範囲</td><td>目盛りの下段をドラッグ</td></tr></table>
      <h3>保存と書き出し</h3><p>曲はこのブラウザに自動で保存される。「保存」で JSON ファイル、<b>WAV</b>（音）・<b>WebM</b>（映像込み）・<b>MIDI</b>（将来の VST・DAW 用）で書き出せる。</p>
      <h3>自動作曲ユニット</h3>
      ${figure('composer.jpg', 'composer', COMPOSER_PARTS, '自動作曲ユニット（AUTO COMPOSER）', 'narrow-shot')}
      <h3>スタイル別の特徴</h3>${styleTable()}
      ${point('鍵マークの使い方', '<p>シーケンサーのトラック名の横の 🔓 を押すと 🔒 になる。鍵を掛けたトラックは、自動作曲で作り直しても<b>そのまま残る</b>。たとえば「ビートは気に入ったから残して、メロディだけ作り直す」ができる。「このセクションだけ作り直す」は、選んだセクション（サビなど）以外を 1 音も変えずに作り直す。</p>')}
      <h3>何台かで 1 つの曲を作る</h3>
      <p>自動作曲ユニットの<b>「参加するおもちゃ」</b>を押して光らせると、そのおもちゃも同じ曲に入る（ラックでは、パネルの付いたおもちゃはいつも参加）。ラックでは表示していないおもちゃも裏で鳴るので、上のタブで切り替えながら聞ける。</p>
      <figure class="shot"><div class="frame"><img src="img/studio3.jpg" alt=""></div><figcaption>「おもちゃを選ぶ」でトイPC・PIKOTONE・TYPOTRON を並べたところ</figcaption></figure>
      <p>スタジオの右端の自動作曲ユニットは、並べたおもちゃ（最初は全部）で 1 曲を作る。<b>ビートは 1 台だけが刻み</b>、Aメロでは<b>2 小節ずつ交代で掛け合い</b>、クラッシュは<b>全員同時</b>、ブレイクでは<b>1 台だけが残る</b>。</p>
      ${bubble('改造おじさん', '「🔗 URL をコピー」で、その曲の URL を友だちに送れる。開いた人のブラウザで、同じおもちゃの並び・同じ曲がもう一度作られるんだ。')}`, 'seq'),
  
    chapter('サンプラー編', 'PAKU-PAKU 16 で音を食べて、切って、並べろ！', `
      <p>子ども用の録音おもちゃ（ワニの口のスピーカー付き）を魔改造したサンプラー。<b>スマホ・タブレット・パソコン</b>のブラウザで使える。ラック・スタジオの上のバーの <b>SAMPLER</b> から。ラックの 7 台目・スタジオに並べる小さい版（3 章）は、ほかのおもちゃと同じように叩いて録って、自動作曲もできる。</p>
      ${figure('sampler.jpg', 'sampler', SAMPLER_PARTS, 'PAKU-PAKU 16（横長の画面。縦長の画面ではパッドが下に来る）', 'wide-shot')}
      <figure class="shot narrow-shot"><div class="frame"><img src="img/sampler-phone.jpg" alt=""></div><figcaption>スマホの縦の画面</figcaption></figure>
      <h3>1 曲できるまで</h3>
      <div class="flow"><div class="flow-step"><b>1</b><p><b>音を入れる</b>：REC（マイク）・RESAMPLE（自分の音）・📂 FILE。最初からドラムとおもちゃの音が 32 個入っている</p></div><div class="flow-step"><b>2</b><p><b>切る</b>：EDIT タブの ✂ CHOP で、ループを切り分けて空いているバンクに並べる</p></div><div class="flow-step"><b>3</b><p><b>録る</b>：PATTERN タブの ● REC で叩いて録る。STEP で 16 分のマスに置いてもよい</p></div><div class="flow-step"><b>4</b><p><b>つなぐ</b>：SONG タブで、パターンを ＋ でつなぐ</p></div><div class="flow-step"><b>5</b><p><b>出す</b>：WAV・MIDI・プロジェクト保存。→ STUDIO でスタジオのシーケンサーへ</p></div></div>
      <h3>タブごとの機能</h3>
      <table class="grid"><tr><th>タブ</th><th>できること</th></tr>
        <tr><td><b>PAD</b></td><td>REC（AUTO：音が来てから録音）・RESAMPLE・MON（入力を聞く）・GATE・LOOP・REV・POLY・📂 FILE（PC はパッドにファイルを落としても）・COPY・DEL・FIXED VEL（いつも最大の強さ）</td></tr>
        <tr><td><b>PLAY</b></td><td>ROLL（押している間 1/4〜1/32・3 連でくり返す）・SUB PAD（最後のパッドをもう一度）・16 LEVELS（1 つの音を 16 パッドに：音程・強さ・こもり具合・立ち上がり・鳴らし始め）・TEMPO と TAP</td></tr>
        <tr><td><b>EDIT</b></td><td>〰 WAVE EDIT（START・END・LOOP の印をドラッグ・0 SNAP・ZOOM）・✂ CHOP（等分・立ち上がりで自動・手で）・⏱ TEMPO FIT（BPM を推定して、音程そのままで伸び縮み／速さだけ合わせる）・NORMALIZE・REVERSE・TRIM・UNDO・⤓ WAV</td></tr>
        <tr><td><b>FX</b></td><td>BUS 1・BUS 2（パッドごとに送り先）・MASTER に 24 種から 1 つずつ（下の表）</td></tr>
        <tr><td><b>BEND</b></td><td>むき出しの基板にジャンパー線 6 本。熱がたまると暴発（外せば冷める）</td></tr>
        <tr><td><b>PATTERN</b></td><td>▶ PLAY・● REC（重ね録り・QUANT でそろえる）・METRO・ERASE・↶・PATTERN（P01〜P16 をパッドで選ぶ）・小節 1〜8・CLEAR・STEP・SWING（ノブ）</td></tr>
        <tr><td><b>SONG</b></td><td>パターンをつなぐ・くり返し回数・▶ SONG・⤓ WAV（パターン／ソング）・⤓ MIDI・💾 保存／📂 読込（.paku）・→ STUDIO</td></tr></table>
      <figure class="shot wide-shot"><div class="frame"><img src="img/sampler-ptn.jpg" alt=""></div><figcaption>STEP で置いたビート（液晶の横 = 時間、行 = パッド。赤い線が再生位置）</figcaption></figure>
      <figure class="shot wide-shot"><div class="frame"><img src="img/sampler-chop.jpg" alt=""></div><figcaption>✂ CHOP：バンク B のループを、音の立ち上がりで自動で切ったところ（黄色い線が切れ目）</figcaption></figure>
      <h3>エフェクト 24 種</h3>
      <table class="grid"><tr><th>#</th><th>エフェクト</th><th>ノブ 1〜4</th></tr>${FX_LIST.map((f, i) => `<tr><td class="c">${i + 1}</td><td><b>${f.name}</b></td><td>${f.knobs.map((k) => k[0]).filter((n) => n !== '—').join('・')}</td></tr>`).join('')}</table>
      <h3>サーキットベンド（BEND タブ）</h3>
      <figure class="shot wide-shot"><div class="frame"><img src="img/sampler-bend.jpg" alt=""></div><figcaption>CLOCK・BIT ROT・SAG の線をつないだところ</figcaption></figure>
      <table class="grid"><tr><th>線</th><th>起こること</th></tr>${WIRES.map((w) => `<tr><td><b>${w.name}</b></td><td>${esc(w.desc)}</td></tr>`).join('')}</table>
      ${point('ベンドのコツ', '<p>ノブの <b>AMOUNT</b> が強さ、<b>SPEED</b> が起こる頻度。線をたくさんつないで大きい音を出すほど<b>熱</b>がたまり、本体が赤く光ると<b>暴発</b>（全部の線が一時的に強く効く）。外せば冷める。WAV に書き出しても同じ壊れ方になる。</p>')}
      <h3>スタジオ（DAW）といっしょに</h3>
      <figure class="shot"><div class="frame"><img src="img/studio-sampler.jpg" alt=""></div><figcaption>スタジオに BLIPPY BOOK 30 と PAKU-PAKU 16 を並べたところ</figcaption></figure>
      <p>ラックの 7 台目、スタジオの「おもちゃを選ぶ」の <b>PAKU-PAKU 16（サンプラー）</b>。自動作曲ユニットも付いていて、スタイルに合う工場出荷の楽器（音頭なら太鼓・篠笛・三味線、レゲエならスカンクとオルガン、ジャズならライドとサックス…）で、ドラムと ♪ MELO・BASS・CHORD のメロディ・ベース・和音を作る（ほかのおもちゃといっしょの合同の曲にも入れる）。サンプラーのページで作った音（このブラウザに保存されたもの）がそのまま鳴り、シーケンサーでは A-01〜P-16 の行になる。サンプラーの SONG タブの <b>→ STUDIO</b> を押すと、作ったソングをスタジオのシーケンサーに入れて開く。音を変えたら、スタジオのサンプラーの「↻ 読み直す」。</p>
      ${warn('マイクで録るとき', '<p>ブラウザが「マイクを使ってよいか」を聞いてくるので<b>許可</b>する。スマホは公開ページ（https）で開くこと。スピーカーから音を出しながら MON を点けると、ハウリングすることがある（イヤホン推奨）。</p>')}
      ${bubble('改造おじさん', 'PC なら Z X C V・A S D F・Q W E R・1 2 3 4 がパッドの並びと同じ形。MIDI のパッド機ならノート 36〜51 で叩けるぞ。')}`, 'sampler'),
  
    chapter('おすすめシード値コレクション', 'このシードを聞いてみろ！', `
      <p>自動作曲でできた曲の中から、盛り上がりがはっきりしていて、音割れの少ないものを選んだ。リンクを開くと同じ曲が作られる（「▶」で再生）。</p>
      ${seedList()}
      <p class="note">「盛り上がり」は、いちばん静かなセクションといちばんにぎやかなセクションの音量の差のめやす。選び方：各スタイル 4 個の候補を実際に鳴らして、音量の差・ちょうど良い大きさ・音割れの少なさで点数をつけた。</p>`, 'seeds'),
  
    chapter('裏技・隠し要素', '知ってると自慢できる！', `<div class="tricks">${TRICKS.map((t) => `<div class="trick"><h4>★ ${esc(t.name)}</h4><p>${esc(t.what)}</p></div>`).join('')}</div>`, 'tricks'),
  
    chapter('困ったときは（Q&A）', 'あわてずに読もう', `<dl class="qa">${QA.map((x) => `<dt>Q. ${esc(x.q)}</dt><dd>A. ${esc(x.a)}</dd>`).join('')}</dl>`, 'qa'),
  
    chapter('用語集', 'むずかしい言葉を 1 行で', `<dl class="words">${GLOSSARY.map(([w, d]) => `<dt>${esc(w)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`, 'words'),
  
    chapter('権利に関する注意', 'とても大事なことです', `
      <div class="rights">
      <p>TELEKEY TK-6 は、タブ共有・動画ファイル・Web カメラの映像と音を取り込んで、加工・録画できます。</p>
      <p><b>他人の著作物（動画・音楽・画像など）を加工・録画・公開する場合は、必ずその権利を持っている人（権利者）の許可を得てください。</b>
      自分で楽しむだけのつもりでも、録画したものをインターネットに公開すると、権利者の権利を侵害することがあります。</p>
      <p>人が映っている映像（カメラの映像を含む）を公開するときは、その人の許可も得てください。</p>
      <p>このアプリに付いている<b>テスト映像とテスト信号</b>は、プログラムで自動生成したもので、自由に使えます。
      おもちゃの演奏そのもの（キー・グリッチ・自動作曲）で作った音も、自由に使えます。</p>
      <p lang="en"><b>English:</b> If you process, record, or publish someone else's copyrighted work (videos, music, images, etc.), please obtain permission from the rights holder. The built-in test pattern and test signal are procedurally generated and free to use.</p>
      </div>`, 'rights'),
  ].join('\n');
  
  const html = `<!doctype html>
  <html lang="ja">
  <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BENT TOY RACK 完全攻略本</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Mochiy+Pop+One&family=M+PLUS+Rounded+1c:wght@400;700;900&display=swap">
  <link rel="stylesheet" href="manual.css">
  </head>
  <body>
  <div class="topnav"><a href="../index.html">← ラックへ</a><a href="../studio.html">スタジオへ</a><span class="sp"></span><a href="bent-toy-rack-manual.pdf" download>📄 PDF をダウンロード</a><a class="lang" href="en/index.html" data-lang>English</a><button onclick="window.print()">🖨 印刷する</button></div>
  <main>
  ${body}
  <footer>BENT TOY RACK 完全攻略本 ／ 画面はすべて実物のスクリーンショット（自動撮影）です。</footer>
  </main>
  </body>
  </html>`;
  return html;
}

// ---- 日本語版 ----
const ja = makeHtml();
writeFileSync('public/manual/index.html', ja);
console.log(`public/manual/index.html を作りました（${Math.round(ja.length / 1024)} KB）`);

// ---- 英語版（英語の画面で撮った写真・同じ辞書で訳す）→ public/manual/en/ ----
const EN_IMG = `${IMG}/en`;
if (existsSync(`${EN_IMG}/callouts.json`)) callouts = JSON.parse(readFileSync(`${EN_IMG}/callouts.json`, 'utf8'));
const en = translateHtml(makeHtml())
  .replace('<html lang="ja">', '<html lang="en">')
  .replace(/src="img\//g, existsSync(`${EN_IMG}/callouts.json`) ? 'src="../img/en/' : 'src="../img/')
  .replace('href="manual.css"', 'href="../manual.css"')
  .replace('href="../index.html"', 'href="../../index.html?lang=en"')
  .replace('href="../studio.html"', 'href="../../studio.html?lang=en"')
  .replace('<a class="lang" href="en/index.html" data-lang>English</a>', '<a class="lang" href="../index.html" data-lang>日本語</a>')
  .replace(/href="(https:\/\/hacchake\.github\.io\/bentpc\/[^"]*)"/g, (_, u: string) => `href="${u}${u.includes('?') ? '&amp;' : '?'}lang=en"`);
mkdirSync('public/manual/en', { recursive: true });
writeFileSync('public/manual/en/index.html', en);
const left = untranslated();
console.log(`public/manual/en/index.html を作りました（${Math.round(en.length / 1024)} KB）${left.length ? `・訳が無いもの ${left.length} 個：\n${left.join('\n')}` : ''}`);
