// スタジオ：BLIPPY BOOK 30（トイPC）と TELEKEY TK-6（映像グリッチ・マシン）を 1 ページに並べ、
// 下のシーケンサーで 2 台いっしょに曲を作る。再生するとキーが光り、ノブやスイッチも動いて見える。
import '../core/parts.css';
import '../host/host.css';
import './studio.css';
import { autoValueAt, trackToy, SYS_CRASH, type Song } from '../core/song';
import type { ToyUI } from '../core/ui';
import { AudioHost } from '../host/audio';
import { TOY_UIS } from '../toys/uis';
import { Arranger } from './arranger';
import { blankStudioSong, STUDIO_TOYS } from './songs';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const audio = new AudioHost({ toys: STUDIO_TOYS });

// ---- おもちゃを並べる（並び = 曲のトラックの toy 番号） ----
const toys: ToyUI[] = STUDIO_TOYS.map((id, toy) =>
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
    <div class="slot-body"></div><div class="crash"><div>*** SYSTEM HALTED ***</div><div>FATAL ERROR 0x0BADC0DE</div><div>…REBOOTING…</div></div>`;
  slot.querySelector('.slot-body')!.appendChild(t.root);
  t.root.style.width = `${t.width}px`;
  t.root.style.height = `${t.height}px`;
  slot.addEventListener('pointerdown', () => setActive(i));
  $('deck').appendChild(slot);
  return slot;
});
let active = 1;
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
  toys.forEach((t, i) => {
    const body = slots[i].querySelector('.slot-body') as HTMLElement;
    const w = body.clientWidth, h = body.clientHeight;
    const s = Math.min(w / t.width, h / t.height);
    t.root.style.transform = `translate(${(w - t.width * s) / 2}px, ${(h - t.height * s) / 2}px) scale(${s})`;
  });
}
window.addEventListener('resize', fit);

// ---- シーケンサー ----
const arr = new Arranger({
  toys,
  send: (song) => audio.post({ type: 'song', song }),
  transport: async (play, from) => {
    await audio.start();
    if (play && (from ?? 0) < 1e-9) resetViews();
    audio.post({ type: 'transport', play, from });
  },
  record: async (on, take) => { await audio.start(); audio.post({ type: 'seqRec', on, take }); },
  onSong: (s) => { $('songTitle').textContent = s.title ?? ''; },
}, blankStudioSong);
$('arr-wrap').appendChild(arr.el);
arr.sendInitial();

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
  else if (m.type === 'seqEnd') clearViews();
  else if (m.type === 'recChunk' || m.type === 'recDone') onRec?.(m);
  else if ('toy' in m) {
    toys[m.toy]?.onMessage(m);
    if (m.type === 'status') {
      const heat = m.status.fx.heat ?? 0;
      (slots[m.toy].querySelector('.stress i') as HTMLElement).style.width = `${Math.min(100, heat * 100)}%`;
      arr.setStress(m.toy, heat);
    }
  }
};
/** 書き出し（フェーズ3）が録音データを受け取る口 */
let onRec: ((m: { type: 'recChunk'; data: Float32Array } | { type: 'recDone' }) => void) | null = null;
export const setRecHandler = (f: typeof onRec) => { onRec = f; };

// ---- 再生を画面に映す：キーが光る・ノブやスイッチが動く・クラッシュ ----
const lit = toys.map(() => new Set<number>());
const shown = toys.map(() => new Map<number, number>());
const crashed = toys.map(() => false);
function resetViews(): void {
  toys.forEach((t, toy) => {
    t.paramDefs.forEach((p, i) => { if (p.kind !== 'momentary') t.showParam?.(i, p.default); });
    shown[toy].clear();
  });
}
function clearViews(): void {
  toys.forEach((t, toy) => {
    lit[toy].forEach((k) => t.showKey?.(k, false));
    lit[toy].clear();
    if (crashed[toy]) { crashed[toy] = false; slots[toy].classList.remove('crashed'); t.freezeView?.(false); }
  });
}
const clock = { beat: 0, bpm: 120, label: '' };
function frame(now: number): void {
  const song: Song = arr.song;
  const beat = playing ? posBeat + ((now - posAt) / 1000) * (song.bpm / 60) : arr.playhead;
  clock.beat = beat;
  clock.bpm = song.bpm;
  clock.label = arr.sectionAt(beat);
  if (playing) {
    toys.forEach((t, toy) => {
      const want = new Set<number>();
      let crash = false;
      song.tracks.forEach((tr, i) => {
        if (tr.mute || trackToy(song, i) !== toy) return;
        for (const n of tr.notes) {
          if (n.start > beat) break;
          if (beat < n.start + n.len) { if (n.key === SYS_CRASH) crash = true; else if (n.key < 2000) want.add(n.key); }
        }
        const params = new Set(tr.autos.map((a) => a.index));
        params.forEach((idx) => {
          const cont = t.paramDefs[idx]?.kind === 'continuous';
          const v = autoValueAt(tr.autos, idx, beat, !!song.ramp && cont);
          if (v === undefined || t.paramDefs[idx]?.kind === 'momentary') return;
          const prev = shown[toy].get(idx);
          if (prev === undefined || Math.abs(prev - v) > 0.002) { shown[toy].set(idx, v); t.showParam?.(idx, v); }
        });
      });
      lit[toy].forEach((k) => { if (!want.has(k)) t.showKey?.(k, false); });
      want.forEach((k) => { if (!lit[toy].has(k)) t.showKey?.(k, true); });
      lit[toy] = want;
      if (crash !== crashed[toy]) {
        crashed[toy] = crash;
        slots[toy].classList.toggle('crashed', crash);
        t.freezeView?.(crash);
      }
    });
  }
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
  <tr><td>おもちゃ</td><td>クリックしたおもちゃが PC キーボードで弾けます（緑の枠）。キー操作は各おもちゃのヘルプ（ラック）と同じ</td></tr>
  <tr><td>▶ / ■</td><td>再生 / 停止（シーケンサーをクリックした後は Space）。<b>曲の頭から再生すると、おもちゃを新品にしてから鳴らすので、毎回同じ音・同じグリッチ</b>になります</td></tr>
  <tr><td>● REC</td><td>弾いた操作を録音して、● の付いたトラックに書き込みます（重ね録り）</td></tr>
  <tr><td>目盛り</td><td>上段 = セクション（ダブルクリックで追加・名前変更、ドラッグで移動、右クリックで削除）<br>下段 = クリックで再生位置、ドラッグでループ範囲（右クリックでループ解除）</td></tr>
  <tr><td>行</td><td>⚡ システム（POWER ON/OFF・CRASH→再起動）/ ● ボタン / ♪ キー / ⇄ スイッチ / ◠ ノブ<br>トラック名の右の <b>+</b> で行を追加。中身の無い行は名前を右クリックで隠す</td></tr>
  <tr><td>編集</td><td>ダブルクリックで追加、ドラッグで移動、音符の右端で長さ、右クリックで削除、空いた所をドラッグでまとめて選ぶ。スイッチは点の上でホイールで値を変える</td></tr>
  <tr><td>キー</td><td>Delete 削除 ／ Ctrl+Z・Y 元に戻す・やり直し ／ Ctrl+C・V コピー・再生位置に貼り付け ／ Ctrl+D すぐ後ろに複製 ／ ← → 少しずらす</td></tr>
  <tr><td>表示</td><td>ホイールで上下、Shift＋ホイールで左右、Ctrl＋ホイールで拡大縮小</td></tr>
  <tr><td>CRASH</td><td>⚡ CRASH の音符の長さの間、音が張り付いて止まり、画面が固まる → 終わりで RESET・再起動（起動音）</td></tr>
  <tr><td>保存</td><td>曲は自動でこのブラウザに保存。「保存」「読込」で JSON ファイルにも</td></tr>
</table>`;
$('s-help').innerHTML = HELP;
$('helpBtn').addEventListener('click', () => { $('s-help').hidden = !$('s-help').hidden; });
document.querySelectorAll<HTMLButtonElement>('#s-top button').forEach((b) => { b.tabIndex = -1; b.addEventListener('mousedown', (e) => e.preventDefault()); });

requestAnimationFrame(fit);
new ResizeObserver(fit).observe($('arr-wrap'));
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
