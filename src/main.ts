// アプリ本体：おもちゃを並べるラック。上のタブで表示するおもちゃを切り替える（裏のおもちゃも鳴り続ける）。
import { setupLang } from './i18n';
import './core/parts.css';
import './host/host.css';
import type { ToyUI } from './core/ui';
import { AudioHost } from './host/audio';
import { PowerGuide } from './core/power';
import { Arranger } from './studio/arranger';
import { createViewSync } from './studio/sync';
import { exportMidi, exportWav } from './studio/export';
import { PANEL_H, PANEL_W, mountComposerPanel } from './compose/panel';
import { PART_COMPOSERS } from './compose/rules';
import { copyText, setPageQuery, settingsFromQuery, settingsToQuery, toast } from './compose/share';
import type { ToyKind } from './compose/types';
import { emptySong } from './core/song';
import { startMidi } from './host/midi';
import { download, encodeWav } from './host/wav';
import { TOY_UIS } from './toys/uis';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = new AudioHost();
const stage = $('stage');

const COMMON_HELP = `
<h3>アプリ全体</h3>
<table>
  <tr><td>上のタブ / F1〜F7</td><td>おもちゃの切り替え（裏のおもちゃも鳴り続けます）。TYPOTRON・TELEKEY 表示中は F キーが楽器の機能なので、タブで切り替え</td></tr>
  <tr><td>REC</td><td>全部のおもちゃの音を録音。もう一度押すと WAV をダウンロード</td></tr>
  <tr><td>☰ SEQ</td><td>シーケンサー：演奏の操作を録音（重ね録り）して、あとから手直しできる。WAV / MIDI で書き出し</td></tr>
  <tr><td>AUTO COMPOSER</td><td>おもちゃの右の緑の基板：「自動作曲」を押すと、曲を作ってシーケンサーに書き込み、鳴らす（STYLE 26 種類・参加するおもちゃ・壊れ度・LENGTH・BPM・SEED）。参加ボタンで何台かを 1 つの曲に</td></tr>
  <tr><td>MIDI</td><td>チャンネル n → n 台目（1〜7）、それ以外→表示中のおもちゃ</td></tr>
</table>
<p><button class="guide-again" type="button">電源の案内をもう一度見る</button></p>
<p>ノブ：上下にドラッグ（Shift で細かく）、ホイール、ダブルクリックで初期値</p>`;

// ---- おもちゃを並べる ----
const toys: ToyUI[] = TOY_UIS.map((make, toy) =>
  make({
    post: (m) => audio.post({ ...m, toy }),
    start: () => audio.start(),
    enableMic: () => audio.enableMic(),
    connectVideo: (src) => audio.connectVideo(src),
    outputStream: () => audio.outputStream(),
  }),
);
const tabEls = toys.map((t, i) => {
  t.root.style.width = `${t.width}px`;
  t.root.style.height = `${t.height}px`;
  stage.appendChild(t.root);
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.innerHTML = `<span class="dot"></span>${i + 1}.<span class="name"> ${t.title.split(' ')[0]}</span>`;
  tab.title = t.title;
  tab.addEventListener('click', () => show(i));
  $('tabs').appendChild(tab);
  return tab;
});

// ---- 自動作曲ユニット（作曲係のあるおもちゃだけ、右側に付ける） ----
const KINDS: ToyKind[] = ['blippy', 'piko', 'dj', 'vroom', 'typo', 'tele', 'sampler'];
const PANEL_GAP = 50;
const panelScale = (h: number) => Math.max(0.9, Math.min(1.4, h / 820));
// 何台かで 1 つの曲も作れる（参加ボタン）。パネルの付いたおもちゃはいつも参加
const CHOICES = toys.map((t, i) => ({ toy: i, kind: KINDS[i], name: `${i + 1}.${t.title.split(' ')[0]}` })).filter((c) => PART_COMPOSERS[c.kind]);
const rackQuery = (i: number, with_: number[]) => ({ toy: String(i + 1), toys: with_.map((t) => t + 1).join(',') });
const panels = toys.map((t, i) => {
  if (!PART_COMPOSERS[KINDS[i]]) return null;
  const p = mountComposerPanel({
    choices: CHOICES,
    defaultToys: [i],
    fixed: i,
    storeKey: `bentpc.compose.${KINDS[i]}`,
    song: () => arr.song,
    load: (song, play) => { arr.setSong(song); openSeq(true); if (play) void transport(true, 0); },
    togglePlay: () => void transport(!arr.playing, arr.playing ? undefined : 0),
    onCompose: (st, with_) => setPageQuery(settingsToQuery(st, rackQuery(i, with_))),
    share: async (st, with_) => {
      const url = setPageQuery(settingsToQuery(st, rackQuery(i, with_)));
      if (await copyText(url)) toast('この曲の URL をコピーしました。送った相手が開くと、同じ曲が作られます');
    },
  });
  // おもちゃの高さに合わせて大きさを変える
  const k = panelScale(t.height);
  p.root.style.left = `${t.width + PANEL_GAP}px`;
  p.root.style.top = '0px';
  p.root.style.transformOrigin = '0 0';
  p.root.style.transform = `scale(${k})`;
  stage.appendChild(p.root);
  return p;
});

let active = 0;
function show(i: number): void {
  toys[active].releaseAll();
  active = i;
  toys.forEach((t, j) => (t.root.style.display = j === i ? '' : 'none'));
  panels.forEach((p, j) => { if (p) p.root.style.display = j === i ? '' : 'none'; });
  tabEls.forEach((t, j) => t.classList.toggle('sel', j === i));
  $('help').innerHTML = toys[i].help + COMMON_HELP;
  try {
    localStorage.setItem('bentpc.activeToy', String(i));
  } catch {
    // 保存できなくても動く
  }
  fit();
}

// ---- 画面サイズに合わせて拡大縮小（シーケンサーを開いているときはその分を空ける） ----
function fit(): void {
  const t = toys[active];
  const wrap = $('arr-wrap');
  const dh = wrap.hidden ? 0 : wrap.offsetHeight;
  const k = panelScale(t.height);
  const w = t.width + (panels[active] ? PANEL_GAP + PANEL_W * k : 0);
  const h = Math.max(t.height, panels[active] ? PANEL_H * k : 0);
  const s = Math.min((window.innerWidth - 16) / w, (window.innerHeight - 60 - dh) / h);
  stage.style.top = `calc(50% + ${26 - dh / 2}px)`;
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);

// ---- エンジンからのメッセージを各おもちゃへ ----
let recChunks: Float32Array[] = [];
audio.onMessage = (m) => {
  if (m.type === 'recChunk') recChunks.push(m.data);
  else if (m.type === 'recDone') finishRecording();
  else if (m.type === 'seqPos') {
    posBeat = m.beat;
    posAt = performance.now();
    if (seqPlaying && !m.playing) sync.clearViews();
    seqPlaying = m.playing;
    arr.setPos(m.beat, m.playing, m.recording);
  } else if (m.type === 'seqTake') arr.addTake(m.data);
  else if (m.type === 'seqEnd') sync.clearViews();
  else {
    toys[m.toy]?.onMessage(m);
    if (m.type === 'status') {
      tabEls[m.toy]?.querySelector('.dot')?.classList.toggle('on', m.status.powered);
      if (m.status.powered && guide.showing) guide.hide();
    }
  }
};

// ---- REC：全部のおもちゃのミックスを WAV に ----
const recBtn = $('recBtn');
const recTime = $('recTime');
const p2 = (n: number) => String(n).padStart(2, '0');
let recording = false;
let recStart = 0;
function setRecording(on: boolean): void {
  if (on === recording) return;
  recording = on;
  if (recording) {
    recChunks = [];
    recStart = performance.now();
    recTime.textContent = '00:00';
  }
  audio.post({ type: 'rec', on: recording });
  recBtn.classList.toggle('on', recording);
  recBtn.querySelector('.led')?.classList.toggle('lit', recording);
}
recBtn.addEventListener('click', async () => {
  await audio.start();
  setRecording(!recording);
});
function finishRecording(): void {
  if (!recChunks.length || !audio.ctx) return;
  const d = new Date();
  const name = `bentpc-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.wav`;
  download(encodeWav(recChunks, audio.ctx.sampleRate), name);
  recChunks = [];
}
setInterval(() => {
  if (!recording) return;
  const sec = Math.floor((performance.now() - recStart) / 1000);
  recTime.textContent = `${p2(Math.floor(sec / 60))}:${p2(sec % 60)}`;
}, 250);

// ---- MIDI：チャンネル n → n 台目、おもちゃの数より大きいチャンネル → 表示中のおもちゃ ----
$('midiBtn').addEventListener('click', async () => {
  await audio.start();
  const ok = await startMidi(
    (status, d1, d2) => {
      const ch = status & 0x0f;
      toys[ch < toys.length ? ch : active].midi(status, d1, d2);
    },
    (names) => {
      $('midiName').textContent = names.length ? names[0].slice(0, 16) : 'NO DEVICE';
      $('midiBtn').querySelector('.led')?.classList.toggle('lit', names.length > 0);
    },
  );
  if (!ok) $('midiName').textContent = 'NOT AVAILABLE';
});

// ---- シーケンサー（スタジオと同じ画面） ----
let posBeat = 0, posAt = 0, seqPlaying = false;
/** 音符が入っているトラックのおもちゃは、再生の前に電源を入れておく（シードの無い曲。シード付きの曲はエンジンが新品にして入れる） */
const powerUsedToys = () => arr.song.tracks.forEach((t, i) => {
  const toy = t.toy ?? i;
  if (!t.mute && (t.notes.length || t.autos.length) && !tabEls[toy]?.querySelector('.dot.on')) toys[toy]?.powerOn();
});
async function transport(play: boolean, from?: number): Promise<void> {
  await audio.start();
  if (play && arr.song.seed === undefined) powerUsedToys();
  if (play && (from ?? posBeat) < 1e-9 && arr.song.seed !== undefined) sync.resetViews();
  audio.post({ type: 'transport', play, from });
}
const arr: Arranger = new Arranger({
  toys,
  send: (song) => { audio.post({ type: 'song', song }); panels.forEach((p) => p?.refresh()); },
  transport: (play, from) => void transport(play, from),
  record: async (on, take) => { await audio.start(); if (on) powerUsedToys(); audio.post({ type: 'seqRec', on, take }); },
  storeKey: 'bentpc.song.v1',
}, () => emptySong(toys.length));
$('arr-wrap').appendChild(arr.el);
arr.sendInitial();
const sync = createViewSync(toys, () => arr.song, (toy, on) => toys[toy].root.classList.toggle('crashed', on));
const loopFrame = (now: number) => {
  const beat = seqPlaying ? posBeat + ((now - posAt) / 1000) * (arr.song.bpm / 60) : arr.playhead;
  sync.frame(beat, seqPlaying);
  requestAnimationFrame(loopFrame);
};
requestAnimationFrame(loopFrame);
function openSeq(open: boolean = !!$('arr-wrap').hidden): void {
  $('arr-wrap').hidden = !open;
  $('seqBtn').classList.toggle('on', open);
  fit();
  arr.draw();
}
$('seqBtn').addEventListener('click', () => openSeq());
new ResizeObserver(fit).observe($('arr-wrap'));
// 書き出し：WAV（全部のおもちゃを速く鳴らして）と MIDI（チャンネル n = n 台目）
const RACK_IDS = toys.map((_, i) => i);
const wavBtn = arr.addButton('WAV', '曲を最初から最後まで WAV に書き出す（実際の時間より速く作ります）', async () => {
  if (wavBtn.disabled) return;
  wavBtn.disabled = true;
  try {
    const customs = toys.flatMap((t, i) => (t.customData?.() ?? []).map((c) => ({ toy: i, data: c.data })));
    await exportWav(arr.song, (f) => { wavBtn.textContent = `WAV ${Math.round(f * 100)}%`; }, RACK_IDS, 48000, customs);
  } catch (e) {
    alert(`WAV を書き出せませんでした：${(e as Error).message}`);
  }
  wavBtn.textContent = 'WAV';
  wavBtn.disabled = false;
});
arr.addButton('MIDI', '曲を MIDI ファイルに書き出す（チャンネル n = n 台目）', () =>
  exportMidi(arr.song, toys.map((t, i) => ({ title: t.title, channel: i, noteOf: (k: number) => (i === 6 ? (k < 160 ? 36 + (k % 16) : k < 208 ? 48 + (k - 160) : 12 + (k - 208)) : Math.min(127, (i === 5 ? 24 : 36) + k)), paramDefs: t.paramDefs }))));

// ---- PC キーボード（表示中のおもちゃへ） ----
window.addEventListener('keydown', (e) => {
  if (!$('arr-wrap').hidden && arr.keyDown(e)) { e.preventDefault(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // まず表示中のおもちゃに渡す（F キーを楽器として使うおもちゃもある）。使わなければ F キーで切り替え
  if (toys[active].keyDown(e)) {
    e.preventDefault();
    return;
  }
  const f = /^F([1-9])$/.exec(e.code);
  if (f && Number(f[1]) <= toys.length) {
    e.preventDefault();
    show(Number(f[1]) - 1);
  }
});
window.addEventListener('keyup', (e) => toys[active].keyUp(e));
window.addEventListener('blur', () => toys.forEach((t) => t.releaseAll()));

// 上のボタンにキーボードの注目（フォーカス）が残ると、Space や Enter で押されてしまうので残さない
document.querySelectorAll<HTMLButtonElement>('#topbar button').forEach((btn) => {
  btn.tabIndex = -1;
  btn.addEventListener('mousedown', (e) => e.preventDefault());
});

// ---- 最初の案内：画面を少し暗くして、表示中のおもちゃの POWER ボタンだけを明るく見せる ----
const guide = new PowerGuide(() => { const b = toys[active].powerButton; return b ? [b] : []; });
$('help').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).classList.contains('guide-again')) { $('help').hidden = true; guide.show(); }
});

$('helpBtn').addEventListener('click', () => {
  $('help').hidden = !$('help').hidden;
});

let saved = 0;
try {
  saved = Number(localStorage.getItem('bentpc.activeToy') ?? 0) || 0;
} catch {
  // 読めなくても動く
}
// URL で送られた曲（?toy=1&toys=1,6&seed=…）：そのおもちゃを出して、同じ設定・同じ顔ぶれで作る（鳴らすのは ▶ を押してから）
const query = new URLSearchParams(location.search);
const shared = settingsFromQuery(query);
const sharedToy = Number(query.get('toy')) - 1;
const sharedWith = (query.get('toys') ?? '').split(',').filter((x) => x.trim() !== '').map((x) => Number(x) - 1).filter((x) => Number.isInteger(x) && x >= 0);
if (shared && panels[sharedToy]) {
  saved = sharedToy;
  queueMicrotask(() => {
    panels[sharedToy]!.composeWith(shared, false, sharedWith.length ? sharedWith : [sharedToy]);
    toast(`送られた曲を作りました（シード ${shared.seed}）。「▶ 再生」で鳴らせます`, 6000);
  });
}
show(Math.min(saved, toys.length - 1));
guide.showIfFirst();

// 言語の切り替え（EN / 日本語）。英語なら画面を置き換える
setupLang(document.getElementById('topbar'));
