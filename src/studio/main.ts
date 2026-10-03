// スタジオ：好きなおもちゃ（最初はトイPC と TELEKEY）を 1 ページに並べ、下のシーケンサーでいっしょに曲を作る。
// 自動作曲ユニットで、並べたおもちゃ全部の合同の曲を作れる（URL で共有できる）。
// 再生するとキーが光り、ノブやスイッチも動いて見える。
import '../core/parts.css';
import '../host/host.css';
import './studio.css';
import type { Song } from '../core/song';
import type { ToyUI } from '../core/ui';
import { AudioHost } from '../host/audio';
import { PowerGuide } from '../core/power';
import { TOY_UIS } from '../toys/uis';
import { Arranger } from './arranger';
import { createViewSync } from './sync';
import { demoSong } from './demo';
import { exportMidi, exportWav, makeCompositor, safeName } from './export';
import { STUDIO_TOYS, blankStudioSong } from './songs';
import { PANEL_H, PANEL_W, mountComposerPanel } from '../compose/panel';
import { PART_COMPOSERS } from '../compose/rules';
import { copyText, setPageQuery, settingsFromQuery, settingsToQuery, toast } from '../compose/share';
import type { ToyKind } from '../compose/types';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const KINDS: ToyKind[] = ['blippy', 'piko', 'dj', 'vroom', 'typo', 'tele', 'sampler'];
const TOY_NAMES = ['BLIPPY BOOK 30（トイPC）', 'PIKOTONE PT-32', 'SPIN-TOT DJ-28', 'VROOMBOX VR-5', 'TYPOTRON TT-109', 'TELEKEY TK-6（映像）', 'PAKU-PAKU 16（サンプラー）'];
const query = new URLSearchParams(location.search);

// ---- 並べるおもちゃ：URL（?toys=0,5）→ 前回の並び → トイPC と TELEKEY ----
function readLineup(): number[] {
  const parse = (v: string | null) => [...new Set((v ?? '').split(',').filter((x) => x.trim() !== '').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < KINDS.length))];
  let ids = parse(query.get('toys'));
  if (!ids.length) {
    try {
      ids = parse(localStorage.getItem('bentpc.studio.toys'));
    } catch {
      // 読めなければ最初の並び
    }
  }
  return ids.length ? ids.sort((a, b) => a - b) : STUDIO_TOYS;
}
const lineup = readLineup();
const isDefault = lineup.join(',') === STUDIO_TOYS.join(',');
try {
  localStorage.setItem('bentpc.studio.toys', lineup.join(','));
} catch {
  // 保存できなくても動く
}
const audio = new AudioHost({ toys: lineup });

// ---- おもちゃを並べる（並び = 曲のトラックの toy 番号） ----
const toys: ToyUI[] = lineup.map((id, toy) =>
  TOY_UIS[id]({
    post: (m) => audio.post({ ...m, toy }),
    start: () => audio.start(),
    enableMic: () => audio.enableMic(),
    connectVideo: (src) => audio.connectVideo(src),
    outputStream: () => audio.outputStream(),
  }),
);
const slots = toys.map((t, i) => {
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.style.flex = `${t.width / t.height} 1 0`;
  slot.innerHTML = `<div class="slot-head"><b>${i + 1}. ${t.title}</b><span class="kb">⌨ キーボードで演奏中</span><span class="stress" title="熱（ストレス）"><i></i></span></div>
    <div class="slot-body"></div><div class="crash"><div>*** SYSTEM HALTED ***</div><div>FATAL ERROR 0x0BADC0DE</div><div class="crash-steps">① RESET → ② POWER で再起動中…</div></div>`;
  slot.querySelector('.slot-body')!.appendChild(t.root);
  t.root.style.width = `${t.width}px`;
  t.root.style.height = `${t.height}px`;
  slot.addEventListener('pointerdown', () => setActive(i));
  $('deck').appendChild(slot);
  return slot;
});
// ---- 自動作曲ユニット（並べたおもちゃ全部で、合同の曲を作る） ----
const composeSlot = document.createElement('div');
composeSlot.className = 'slot compose-slot';
composeSlot.style.flex = `${PANEL_W / PANEL_H} 1 0`;
composeSlot.innerHTML = '<div class="slot-head"><b>AUTO COMPOSER</b><span>並べたおもちゃで合同の曲</span></div><div class="slot-body"></div>';
$('deck').appendChild(composeSlot);
// with = 参加するおもちゃ（並びの何番目か、1 から）。全部のときは付けない
const lineupQuery = (with_: number[]): Record<string, string> => (with_.length === lineup.length ? { toys: lineup.join(',') } : { toys: lineup.join(','), with: with_.map((t) => t + 1).join(',') });
const panel = mountComposerPanel({
  // 自動作曲の係がいるおもちゃだけ（サンプラーは自分の音で作るので入れない）
  choices: lineup.map((id, i) => ({ toy: i, kind: KINDS[id], name: `${i + 1}.${toys[i].title.split(' ')[0]}` })).filter((c) => PART_COMPOSERS[c.kind]),
  defaultToys: lineup.map((_, i) => i).filter((i) => PART_COMPOSERS[KINDS[lineup[i]]]),
  storeKey: 'bentpc.compose.studio',
  song: () => arr.song,
  load: (song, play) => { arr.setSong(song); if (play) void transport(true, 0); },
  togglePlay: () => void transport(!arr.playing, arr.playing ? undefined : 0),
  onCompose: (st, with_) => setPageQuery(settingsToQuery(st, lineupQuery(with_))),
  share: async (st, with_) => {
    const url = setPageQuery(settingsToQuery(st, lineupQuery(with_)));
    if (await copyText(url)) toast('この曲の URL をコピーしました。開くと、同じおもちゃの並びで同じ曲が作られます');
  },
});
composeSlot.querySelector('.slot-body')!.appendChild(panel.root);
panel.root.style.transformOrigin = '0 0';

let active = lineup.length - 1;
function setActive(i: number): void {
  if (i === active) return;
  toys[active].releaseAll();
  active = i;
  slots.forEach((s, j) => s.classList.toggle('active', j === i));
}
slots[active].classList.add('active');

// ---- 大きさ合わせ ----
function fit(): void {
  const arrH = $('arr-wrap').offsetHeight;
  const deck = $('deck');
  deck.style.bottom = `${arrH}px`;
  const place = (root: HTMLElement, slot: HTMLElement, tw: number, th: number) => {
    const body = slot.querySelector('.slot-body') as HTMLElement;
    const w = body.clientWidth, h = body.clientHeight;
    const s = Math.min(w / tw, h / th);
    root.style.transform = `translate(${(w - tw * s) / 2}px, ${(h - th * s) / 2}px) scale(${s})`;
  };
  toys.forEach((t, i) => place(t.root, slots[i], t.width, t.height));
  place(panel.root, composeSlot, PANEL_W, PANEL_H);
}
window.addEventListener('resize', fit);

// ---- シーケンサー ----
async function transport(play: boolean, from?: number): Promise<void> {
  await audio.start();
  if (play && (from ?? 0) < 1e-9) resetViews();
  audio.post({ type: 'transport', play, from });
}
const arr = new Arranger({
  toys,
  send: (song) => audio.post({ type: 'song', song }),
  transport: (play, from) => void transport(play, from),
  record: async (on, take) => { await audio.start(); audio.post({ type: 'seqRec', on, take }); },
  onSong: (s) => { $('songTitle').textContent = s.title ?? ''; },
  storeKey: isDefault ? 'bentpc.studio.song.v1' : `bentpc.studio.song.v1.${lineup.join('-')}`,
}, () => (isDefault ? demoSong() : blankStudioSong(toys.map((t) => t.title))));
$('arr-wrap').appendChild(arr.el);
arr.addButton('デモ曲', 'デモ曲「POWER ON / POWER OFF」を読み込む（トイPC と TELEKEY の曲。今の曲は「元に戻す」で戻せます）', () => {
  if (isDefault) arr.setSong(demoSong());
  else location.href = `studio.html?toys=${STUDIO_TOYS.join(',')}&demo=1`;
});
arr.addButton('新しい曲', '空の曲にする（「元に戻す」で戻せます）', () => { arr.setSong(blankStudioSong(toys.map((t) => t.title))); });
arr.sendInitial();
// URL で送られた曲（?toys=…&seed=…）：同じ設定で合同の曲を作る。デモ曲の URL（?demo=1）
const shared = settingsFromQuery(query);
const sharedWith = (query.get('with') ?? '').split(',').filter((x) => x.trim() !== '').map((x) => Number(x) - 1).filter((x) => Number.isInteger(x) && x >= 0);
if (shared) queueMicrotask(() => { panel.composeWith(shared, false, sharedWith.length ? sharedWith : lineup.map((_, i) => i)); toast(`送られた曲を作りました（シード ${shared.seed}）。「▶」で鳴らせます`, 6000); });
else if (query.get('demo') && isDefault) arr.setSong(demoSong(), false);

// ---- エンジンからのメッセージ ----
let posBeat = 0, posAt = 0, playing = false;
audio.onMessage = (m) => {
  if (m.type === 'seqPos') {
    posBeat = m.beat;
    posAt = performance.now();
    if (playing && !m.playing) clearViews();
    playing = m.playing;
    arr.setPos(m.beat, m.playing, m.recording);
  } else if (m.type === 'seqTake') arr.addTake(m.data);
  else if (m.type === 'seqEnd') { clearViews(); onSongEnd?.(); }
  else if (m.type === 'recChunk' || m.type === 'recDone') onRec?.(m);
  else if ('toy' in m) {
    toys[m.toy]?.onMessage(m);
    if (m.type === 'status') {
      const heat = m.status.fx.heat ?? 0;
      heats[m.toy] = heat;
      if (m.status.powered && guide.showing) guide.hide();
      (slots[m.toy].querySelector('.stress i') as HTMLElement).style.width = `${Math.min(100, heat * 100)}%`;
      arr.setStress(m.toy, heat);
    }
  }
};
/** 書き出し（フェーズ3）が録音データを受け取る口 */
let onRec: ((m: { type: 'recChunk'; data: Float32Array } | { type: 'recDone' }) => void) | null = null;
export const setRecHandler = (f: typeof onRec) => { onRec = f; };

// ---- 再生を画面に映す：キーが光る・ノブやスイッチが動く・クラッシュ ----
const sync = createViewSync(toys, () => arr.song, (toy, on) => slots[toy].classList.toggle('crashed', on));
function resetViews(): void {
  toys.forEach((t) => t.setTestClock?.(clock));
  sync.resetViews();
}
const clearViews = () => sync.clearViews();
const clock = { beat: 0, bpm: 120, label: '' };
const heats = toys.map(() => 0);
let onSongEnd: (() => void) | null = null;
function frame(now: number): void {
  const song: Song = arr.song;
  const beat = playing ? posBeat + ((now - posAt) / 1000) * (song.bpm / 60) : arr.playhead;
  clock.beat = beat;
  clock.bpm = song.bpm;
  clock.label = arr.sectionAt(beat);
  sync.frame(beat, playing);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// TELEKEY はテスト映像を曲の拍に合わせて映す
toys.forEach((t) => t.setTestClock?.(clock));

// ---- PC キーボード：シーケンサーに注目していればそちら、そうでなければ選んだおもちゃ ----
window.addEventListener('keydown', (e) => {
  if (arr.keyDown(e)) { e.preventDefault(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (toys[active].keyDown(e)) e.preventDefault();
});
window.addEventListener('keyup', (e) => toys[active].keyUp(e));
window.addEventListener('blur', () => toys.forEach((t) => t.releaseAll()));

const HELP = `
<h3>BENT TOY STUDIO の使い方</h3>
<table>
  <tr><td>おもちゃ</td><td>クリックしたおもちゃが PC キーボードで弾けます（緑の枠）。キー操作は各おもちゃのヘルプ（ラック）と同じ。<b>右上の「おもちゃを選ぶ」</b>で並べるおもちゃを変えられます</td></tr>
  <tr><td>AUTO COMPOSER</td><td>右端の緑の基板：「自動作曲」で並べた全部のおもちゃの合同の曲を作る（役割分担・掛け合い・同時にクラッシュ・1 台だけ残るブレイク）。「URL をコピー」で同じ曲を人に送れる</td></tr>
  <tr><td>▶ / ■</td><td>再生 / 停止（シーケンサーをクリックした後は Space）。<b>曲の頭から再生すると、おもちゃを新品にしてから鳴らすので、毎回同じ音・同じグリッチ</b>になります</td></tr>
  <tr><td>● REC</td><td>弾いた操作を録音して、● の付いたトラックに書き込みます（重ね録り）</td></tr>
  <tr><td>目盛り</td><td>上段 = セクション（ダブルクリックで追加・名前変更、ドラッグで移動、右クリックで削除）<br>下段 = クリックで再生位置、ドラッグでループ範囲（右クリックでループ解除）</td></tr>
  <tr><td>行</td><td>⚡ システム（POWER ON/OFF・CRASH→再起動）/ ● ボタン / ♪ キー / ⇄ スイッチ / ◠ ノブ<br>トラック名の右の <b>+</b> で行を追加。中身の無い行は名前を右クリックで隠す</td></tr>
  <tr><td>編集</td><td>ダブルクリックで追加、ドラッグで移動、音符の右端で長さ、右クリックで削除、空いた所をドラッグでまとめて選ぶ。スイッチは点の上でホイールで値を変える</td></tr>
  <tr><td>キー</td><td>Delete 削除 ／ Ctrl+Z・Y 元に戻す・やり直し ／ Ctrl+C・V コピー・再生位置に貼り付け ／ Ctrl+D すぐ後ろに複製 ／ ← → 少しずらす</td></tr>
  <tr><td>表示</td><td>ホイールで上下、Shift＋ホイールで左右、Ctrl＋ホイールで拡大縮小</td></tr>
  <tr><td>CRASH</td><td>⚡ CRASH の音符の長さの間、音が張り付いて止まり、画面が固まる → 終わりで RESET・再起動（起動音）</td></tr>
  <tr><td>電源</td><td>各おもちゃの大きな <b>POWER</b> ボタン（またはおもちゃを選んで Enter）。▶ で曲を頭から再生しても電源が入ります</td></tr>
  <tr><td>保存</td><td>曲は自動でこのブラウザに保存。「保存」「読込」で JSON ファイルにも</td></tr>
</table>`;
$('s-help').innerHTML = HELP + '<p><button class="guide-again" type="button">電源の案内をもう一度見る</button></p>';
// ---- 最初の案内：画面を少し暗くして、2 台の POWER ボタンだけを明るく見せる（▶ で再生しても電源が入る） ----
const guide = new PowerGuide(() => toys.map((t) => t.powerButton).filter((b): b is HTMLElement => !!b));
$('s-help').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).classList.contains('guide-again')) { $('s-help').hidden = true; guide.show(); }
});
setTimeout(() => guide.showIfFirst(), 300);
$('helpBtn').addEventListener('click', () => { $('s-help').hidden = !$('s-help').hidden; });
document.querySelectorAll<HTMLButtonElement>('#s-top button').forEach((b) => { b.tabIndex = -1; b.addEventListener('mousedown', (e) => e.preventDefault()); });

requestAnimationFrame(fit);
new ResizeObserver(fit).observe($('arr-wrap'));
// ================= 書き出し =================
const wavBtn = arr.addButton('WAV', '曲を最初から最後まで WAV（音声）に書き出す（実際の時間より速く作ります）', async () => {
  if (wavBtn.disabled) return;
  wavBtn.disabled = true;
  try {
    // サンプラーの音など、おもちゃ専用のデータも渡す（書き出しでも同じ音に）
    const customs = toys.flatMap((t, i) => (t.customData?.() ?? []).map((c) => ({ toy: i, data: c.data })));
    await exportWav(arr.song, (f) => { wavBtn.textContent = `WAV ${Math.round(f * 100)}%`; }, lineup, 48000, customs);
  } catch (e) {
    alert(`WAV を書き出せませんでした：${(e as Error).message}`);
  }
  wavBtn.textContent = 'WAV';
  wavBtn.disabled = false;
});
let vrec: MediaRecorder | null = null;
const webmBtn = arr.addButton('WebM', '曲を最初から最後まで再生して、映像（TELEKEY のモニター＋トイPC の液晶）と音を WebM に録画する（曲の長さだけ時間がかかります）', async () => {
  if (vrec) { audio.post({ type: 'transport', play: false }); vrec.stop(); return; }
  await audio.start();
  const comp = makeCompositor({
    song: () => arr.song,
    beat: () => clock.beat,
    section: () => clock.label,
    tele: (toys[lineup.indexOf(5)]?.root.querySelector('canvas[data-id="gl"]') as HTMLCanvasElement) ?? null,
    lcd: (toys[lineup.indexOf(0)]?.root.querySelector('canvas[data-id="lcd"]') as HTMLCanvasElement) ?? null,
    teleIndex: lineup.indexOf(5),
    lcdIndex: lineup.indexOf(0),
    names: toys.map((t) => t.title),
    heat: (t) => heats[t],
    crashed: (t) => sync.crashed(t),
  });
  comp.draw();
  const stream = new MediaStream([...comp.canvas.captureStream(30).getVideoTracks(), ...(await audio.outputStream()).getAudioTracks()]);
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    vrec = null;
    onSongEnd = null;
    webmBtn.textContent = 'WebM';
    webmBtn.classList.remove('on');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    a.download = `${safeName(arr.song)}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  };
  const loop = () => { if (!vrec) return; comp.draw(); requestAnimationFrame(loop); };
  vrec = rec;
  rec.start(1000);
  webmBtn.textContent = '■ 録画中（押すと止める）';
  webmBtn.classList.add('on');
  requestAnimationFrame(loop);
  // 曲を頭から 1 回だけ鳴らす（ループしない）。終わったら少し余韻を録って止める
  resetViews();
  audio.post({ type: 'bounce' });
  onSongEnd = () => setTimeout(() => vrec?.state === 'recording' && vrec.stop(), 1200);
});
arr.addButton('MIDI', '曲を MIDI ファイルに書き出す（チャンネル = ラックの番号：トイPC = 1 … TELEKEY = 6。将来の VST 用）', () =>
  exportMidi(arr.song, lineup.map((id, i) => ({ title: toys[i].title, channel: id, noteOf: (k: number) => (id === 6 ? 36 + (k % 16) : Math.min(127, (id === 5 ? 24 : 36) + k)), paramDefs: toys[i].paramDefs }))));

// ---- おもちゃを選ぶ（並べ直すとページを開き直す） ----
{
  const box = $('lineup');
  box.innerHTML = `<b>スタジオに並べるおもちゃ</b>${TOY_NAMES.map((n, id) => `<label><input type="checkbox" value="${id}" ${lineup.includes(id) ? 'checked' : ''}> ${id + 1}. ${n}</label>`).join('')}
    <p>2〜3 台がおすすめ（たくさん並べると 1 台ずつが小さくなります）。並べ直すと、その並び用の曲に切り替わります。</p>
    <button type="button" data-id="go">この並びで開く</button> <button type="button" data-id="cancel">やめる</button>`;
  $('lineupBtn').addEventListener('click', () => { box.hidden = !box.hidden; });
  box.querySelector('[data-id=cancel]')!.addEventListener('click', () => { box.hidden = true; });
  box.querySelector('[data-id=go]')!.addEventListener('click', () => {
    const ids = [...box.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => Number(i.value));
    if (!ids.length) { alert('1 台以上選んでください'); return; }
    location.href = `studio.html?toys=${ids.join(',')}`;
  });
}

// シーケンサーの高さ：上の縁をドラッグで変える
{
  const wrap = $('arr-wrap');
  const grip = document.createElement('div');
  grip.className = 'arr-grip';
  grip.title = 'ドラッグでシーケンサーの高さを変える';
  wrap.appendChild(grip);
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => { wrap.style.height = `${Math.max(160, Math.min(window.innerHeight - 160, window.innerHeight - ev.clientY))}px`; };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', () => grip.removeEventListener('pointermove', move), { once: true });
  });
}
// 調べもの用（ブラウザの開発ツールから触れる）
(window as unknown as { studio: unknown }).studio = { arr, audio, toys };
