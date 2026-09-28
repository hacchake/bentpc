// アプリ本体：おもちゃを並べるラック。上のタブで表示するおもちゃを切り替える（裏のおもちゃも鳴り続ける）。
import './core/parts.css';
import './host/host.css';
import type { ToyUI } from './core/ui';
import { AudioHost } from './host/audio';
import { Daw } from './host/daw';
import { startMidi } from './host/midi';
import { download, encodeWav } from './host/wav';
import { TOY_UIS } from './toys/uis';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = new AudioHost();
const stage = $('stage');

const COMMON_HELP = `
<h3>アプリ全体</h3>
<table>
  <tr><td>上のタブ / F1〜F6</td><td>おもちゃの切り替え（裏のおもちゃも鳴り続けます）。TYPOTRON・TELEKEY 表示中は F キーが楽器の機能なので、タブで切り替え</td></tr>
  <tr><td>REC</td><td>全部のおもちゃの音を録音。もう一度押すと WAV をダウンロード</td></tr>
  <tr><td>☰ SEQ</td><td>シーケンサー：演奏の操作を録音（重ね録り）して、ピアノロールで手直しできる</td></tr>
  <tr><td>MIDI</td><td>チャンネル n → n 台目（1〜6）、それ以外→表示中のおもちゃ</td></tr>
</table>
<p>ノブ：上下にドラッグ（Shift で細かく）、ホイール、ダブルクリックで初期値</p>`;

// ---- おもちゃを並べる ----
const toys: ToyUI[] = TOY_UIS.map((make, toy) =>
  make({
    post: (m) => audio.post({ ...m, toy }),
    start: () => audio.start(),
    enableMic: () => audio.enableMic(),
    connectVideo: (src) => audio.connectVideo(src),
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

let active = 0;
function show(i: number): void {
  toys[active].releaseAll();
  active = i;
  toys.forEach((t, j) => (t.root.style.display = j === i ? '' : 'none'));
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
  const dh = daw?.height ?? 0;
  const s = Math.min(window.innerWidth / t.width, (window.innerHeight - 60 - dh) / t.height);
  stage.style.top = `calc(50% + ${26 - dh / 2}px)`;
  stage.style.width = `${t.width}px`;
  stage.style.height = `${t.height}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);

// ---- エンジンからのメッセージを各おもちゃへ ----
let recChunks: Float32Array[] = [];
audio.onMessage = (m) => {
  if (m.type === 'recChunk') recChunks.push(m.data);
  else if (m.type === 'recDone') finishRecording();
  else if (m.type === 'seqPos') daw.setPos(m.beat, m.playing, m.recording);
  else if (m.type === 'seqTake') daw.addTake(m.data);
  else if (m.type === 'seqEnd') { if (bouncing) { bouncing = false; setRecording(false); } }
  else {
    toys[m.toy]?.onMessage(m);
    if (m.type === 'status') tabEls[m.toy]?.querySelector('.dot')?.classList.toggle('on', m.status.powered);
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

// ---- シーケンサー ----
let bouncing = false;
/** 音符が入っているトラックのおもちゃは、再生の前に電源を入れておく */
const powerUsedToys = () => daw.song.tracks.forEach((t, i) => { if (!t.mute && (t.notes.length || t.autos.length) && !tabEls[i].querySelector('.dot.on')) toys[i].powerOn(); });
const daw: Daw = new Daw({
  toys,
  send: (song) => audio.post({ type: 'song', song }),
  transport: async (play, from) => { await audio.start(); if (play) powerUsedToys(); audio.post({ type: 'transport', play, from }); },
  record: async (on, take) => { await audio.start(); if (on) powerUsedToys(); audio.post({ type: 'seqRec', on, take }); },
  bounce: async () => {
    await audio.start();
    powerUsedToys();
    bouncing = true;
    setRecording(true);
    audio.post({ type: 'bounce' });
  },
  activeToy: () => active,
  onOpenChange: (open) => { $('seqBtn').classList.toggle('on', open); fit(); },
});
daw.sendInitial();
$('seqBtn').addEventListener('click', () => daw.toggle());

// ---- PC キーボード（表示中のおもちゃへ） ----
window.addEventListener('keydown', (e) => {
  if (daw.keyDown(e)) { e.preventDefault(); return; }
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

$('helpBtn').addEventListener('click', () => {
  $('help').hidden = !$('help').hidden;
});

let saved = 0;
try {
  saved = Number(localStorage.getItem('bentpc.activeToy') ?? 0) || 0;
} catch {
  // 読めなくても動く
}
show(Math.min(saved, toys.length - 1));
