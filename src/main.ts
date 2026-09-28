// アプリ本体：おもちゃを並べるラック。上のタブで表示するおもちゃを切り替える（裏のおもちゃも鳴り続ける）。
import './core/parts.css';
import './host/host.css';
import type { ToyUI } from './core/ui';
import { AudioHost } from './host/audio';
import { startMidi } from './host/midi';
import { download, encodeWav } from './host/wav';
import { TOY_UIS } from './toys/uis';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = new AudioHost();
const stage = $('stage');

const COMMON_HELP = `
<h3>アプリ全体</h3>
<table>
  <tr><td>上のタブ / F1〜F4</td><td>おもちゃの切り替え（裏のおもちゃも鳴り続けます）</td></tr>
  <tr><td>REC</td><td>全部のおもちゃの音を録音。もう一度押すと WAV をダウンロード</td></tr>
  <tr><td>MIDI</td><td>チャンネル n → n 台目（1〜4）、それ以外→表示中のおもちゃ</td></tr>
</table>
<p>ノブ：上下にドラッグ（Shift で細かく）、ホイール、ダブルクリックで初期値</p>`;

// ---- おもちゃを並べる ----
const toys: ToyUI[] = TOY_UIS.map((make, toy) =>
  make({
    post: (m) => audio.post({ ...m, toy }),
    start: () => audio.start(),
    enableMic: () => audio.enableMic(),
  }),
);
const tabEls = toys.map((t, i) => {
  t.root.style.width = `${t.width}px`;
  t.root.style.height = `${t.height}px`;
  stage.appendChild(t.root);
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.innerHTML = `<span class="dot"></span>${i + 1}. ${t.title.split(' ')[0]}`;
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

// ---- 画面サイズに合わせて拡大縮小 ----
function fit(): void {
  const t = toys[active];
  const s = Math.min(window.innerWidth / t.width, (window.innerHeight - 60) / t.height);
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
recBtn.addEventListener('click', async () => {
  await audio.start();
  recording = !recording;
  if (recording) {
    recChunks = [];
    recStart = performance.now();
    recTime.textContent = '00:00';
  }
  audio.post({ type: 'rec', on: recording });
  recBtn.classList.toggle('on', recording);
  recBtn.querySelector('.led')?.classList.toggle('lit', recording);
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

// ---- PC キーボード（表示中のおもちゃへ） ----
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const f = /^F([1-9])$/.exec(e.code);
  if (f && Number(f[1]) <= toys.length) {
    e.preventDefault();
    show(Number(f[1]) - 1);
    return;
  }
  if (toys[active].keyDown(e)) e.preventDefault();
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
