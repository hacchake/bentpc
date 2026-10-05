// 8 台目：MANEKKO MK-8 の画面。インコの形のカセットレコーダーに、モニター・ツマミ・ボタンを後付けした魔改造機。
// 曲のファイル（MP3・AAC・WAV…）を入れる → Web Worker で解析とボーカル分離 → モニターに曲の情報
// → 弾くおもちゃ・スタイル・範囲を選んで「COVER!」→ カバーの曲をシーケンサーに入れて鳴らす（元の歌を重ねることも）。
// 曲のファイルはこのブラウザ（IndexedDB）にだけ保存し、どこにも送らない。
import './manekko.css';
import { Knob, momentary } from '../../core/controls';
import type { HostApi, ToyUI } from '../../core/ui';
import type { FromToy } from '../../host/protocol';
import type { ToyKind } from '../../compose/types';
import { defaultComposer } from '../../compose/rules';
import { STYLE_IDS, styleOf } from '../../compose/styles';
import type { CoverAnalysis } from '../../cover/analyze';
import { coverSource } from '../../cover/plan';
import { alignToGrid } from '../../cover/vocal';
import { MANEKKO_PARAMS, MK, MK_MAX_BARS, type ManekkoDisplay, type ManekkoTape } from './engine';
import AnalyzeWorker from './worker.ts?worker&inline';

const W = 1180;
const H = 860;
const KNOBS: [keyof typeof MK, string, string][] = [
  ['volume', 'VOL', 'black'], ['vocal', 'VOCAL', 'red'], ['karaoke', 'KARAOKE', 'blue'], ['orig', 'ORIGINAL', ''],
  ['wow', 'WOW', 'black'], ['lofi', 'LO-FI', 'black'], ['echo', 'ECHO', 'blue'],
];
const KIND_NAMES: Record<string, string> = { blippy: 'BLIPPY', piko: 'PIKO', dj: 'SPIN', vroom: 'VROOM', typo: 'TYPO', tele: 'TELE', sampler: 'PAKU' };
const STORE_KEY = 'bentpc.manekko';

const HELP = `
<h3>MANEKKO MK-8（まねっこインコ）</h3>
<table>
  <tr><td>⏏ LOAD</td><td>曲のファイル（MP3・AAC・M4A・WAV など）を入れる（ここに落としても OK）。解析とボーカル分離は、このブラウザの中だけで行う（曲はどこにも送らない）</td></tr>
  <tr><td>モニター</td><td>曲名・テンポ・調・小節数・構成（色の帯）・コード・メロディ。白い枠が使う範囲、光る線が再生位置</td></tr>
  <tr><td>おもちゃのボタン</td><td>カバーを弾くおもちゃ（いくつでも）</td></tr>
  <tr><td>STYLE ◀ ▶</td><td>カバーの雰囲気（どの楽器・どんな刻み方で弾くか）</td></tr>
  <tr><td>FROM・TO</td><td>使う範囲（小節）</td></tr>
  <tr><td>VOCAL ON</td><td>カバーに元の歌（取り出したボーカル）を重ねる</td></tr>
  <tr><td>COVER!</td><td>カバーを作ってシーケンサーに入れ、頭から鳴らす。押すたびに少し違うカバー</td></tr>
  <tr><td>▶ 原曲</td><td>押している間、元の曲を鳴らす（聞きくらべ）</td></tr>
  <tr><td>ツマミ</td><td>VOL・VOCAL（歌）・KARAOKE（伴奏）・ORIGINAL（元の曲）の大きさ、WOW（テープのよれ）・LO-FI（こもり）・ECHO・CHAOS（カバーの壊れ度）</td></tr>
  <tr><td>STUTTER</td><td>押している間、テープが同じ所をくり返す</td></tr>
</table>
<p>ボーカルの分離は AI を使わない方法なので、残響やほかの楽器が少し残る。歌のメロディの聞き取りも「似ている」くらい。</p>`;

// ---- 曲のファイルを IndexedDB に（読み込み直したとき、もう一度解析する） ----
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('manekko', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('file');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function saveFile(f: Blob, name: string): Promise<void> {
  try { const db = await idb(); db.transaction('file', 'readwrite').objectStore('file').put({ blob: f, name }, 'last'); } catch { /* 保存できなくても動く */ }
}
async function loadFile(): Promise<{ blob: Blob; name: string } | null> {
  try {
    const db = await idb();
    return await new Promise((res) => { const q = db.transaction('file').objectStore('file').get('last'); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
  } catch { return null; }
}

interface Settings { kinds: ToyKind[]; style: string; chaos: number; vocalOn: boolean; from: number; to: number }

export function mountManekko(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-mk';
  root.innerHTML = `
    <div class="mk-tail"></div>
    <div class="mk-body">
      <div class="mk-head"><i class="mk-eye"></i><i class="mk-beak"></i><i class="mk-crest"></i></div>
      <div class="mk-logo"><b>MANEKKO</b><span>MK-8</span><em>まねっこ</em></div>
      <div class="mk-power"><div class="dome red big" data-id="power"></div><small class="power-label">POWER</small><span class="led" data-id="led"></span></div>
      <div class="mk-monitor"><i class="mk-bolt a"></i><i class="mk-bolt b"></i><i class="mk-bolt c"></i><i class="mk-bolt d"></i><canvas class="mk-screen" width="620" height="340"></canvas></div>
      <div class="mk-plate">
        ${KNOBS.map(([id, label, cls]) => `<div class="mk-k"><span class="mk-tape">${label}</span><div class="knob small ${cls}" data-k="${id}"><div class="cap"></div></div></div>`).join('')}
        <div class="mk-k"><span class="mk-tape">CHAOS</span><div class="knob small red" data-k="chaos"><div class="cap"></div></div></div>
      </div>
      <div class="mk-cover">
        <div class="mk-row mk-toys"></div>
        <div class="mk-row">
          <button class="mk-sbtn" data-a="prev">◀</button><span class="mk-style"></span><button class="mk-sbtn" data-a="next">▶</button>
          <span class="mk-lbl">FROM</span><div class="knob small black" data-k="from"><div class="cap"></div></div>
          <span class="mk-lbl">TO</span><div class="knob small black" data-k="to"><div class="cap"></div></div>
          <button class="mk-sw" data-a="vocal"><i></i></button><span class="mk-lbl">VOCAL ON</span>
        </div>
      </div>
      <div class="mk-deck">
        <div class="mk-window"><i class="mk-reel l"></i><i class="mk-reel r"></i><span class="mk-label">NO TAPE</span></div>
        <div class="mk-keys">
          <button class="mk-key" data-a="load" title="曲のファイルを入れる">⏏ LOAD</button>
          <button class="mk-key" data-a="orig" title="押している間、元の曲">▶ 原曲</button>
          <button class="mk-key" data-a="stutter" title="押している間、くり返す">STUTTER</button>
          <button class="mk-key cover" data-a="cover" title="カバーを作って鳴らす">COVER!</button>
        </div>
      </div>
      <input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac" hidden>
    </div>`;
  const q = (s: string) => root.querySelector(s) as HTMLElement;
  const $ = (id: string) => q(`[data-id="${id}"]`);
  const params = Float32Array.from(MANEKKO_PARAMS.map((p) => p.default));
  let powered = false;
  let beat = -1;
  // ---- 解析の状態 ----
  let title = '';
  let analysis: CoverAnalysis | null = null;
  let sep: { sr: number; vocal: Float32Array; inst: Float32Array; orig: Float32Array } | null = null;
  let busy: { f: number; what: string } | null = null;
  let errMsg = '';
  let coverFrom = 0; // いまのテープの範囲の頭（小節）
  let tape: ManekkoTape | null = null;
  // ---- 設定（このブラウザに覚えておく） ----
  const st: Settings = { kinds: ['sampler', 'piko'], style: 'beat', chaos: 0.2, vocalOn: true, from: 0, to: 0 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')); } catch { /* 読めなくても動く */ }
  const saveSt = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch { /* 保存できなくても動く */ } };

  // ================= ツマミ =================
  const setParam = (i: number, v: number) => { params[i] = v; api.post({ type: 'param', index: i, value: v }); };
  const knobs = new Map<number, Knob>();
  for (const [id] of KNOBS) {
    const i = MK[id];
    const kn = new Knob(q(`[data-k="${id}"]`), { default: MANEKKO_PARAMS[i].default }, (k) => setParam(i, k));
    kn.set(params[i], false);
    knobs.set(i, kn);
  }
  new Knob(q('[data-k="chaos"]'), { default: 0.2 }, (k) => { st.chaos = k; saveSt(); draw(); }).set(st.chaos, false);
  const bars = () => analysis?.bars ?? 0;
  const fromKnob = new Knob(q('[data-k="from"]'), { default: 0 }, (k) => { st.from = Math.round(k * Math.max(0, bars() - 1)); if (st.to && st.to <= st.from) st.to = Math.min(bars(), st.from + 4); saveSt(); draw(); });
  const toKnob = new Knob(q('[data-k="to"]'), { default: 1 }, (k) => { st.to = Math.max(st.from + 1, Math.round(k * bars())); saveSt(); draw(); });
  const syncRange = () => {
    const n = bars();
    if (!n) return;
    if (!st.to || st.to > n) st.to = n;
    if (st.from >= st.to) st.from = 0;
    fromKnob.set(n > 1 ? st.from / (n - 1) : 0, false);
    toKnob.set(st.to / n, false);
  };

  // ================= おもちゃ・スタイル・VOCAL =================
  // 並んでいるおもちゃ（ホストの準備ができる前は空）
  const hostToys = () => { try { return api.songHost?.toys() ?? []; } catch { return []; } };
  const renderToys = () => {
    const box = q('.mk-toys');
    box.innerHTML = '<span class="mk-lbl">PLAY BY</span>' + hostToys().filter((t) => t.kind !== 'manekko').map((t) => `<button class="mk-toy${st.kinds.includes(t.kind) ? ' on' : ''}" data-kind="${t.kind}">${t.toy + 1}<small>${KIND_NAMES[t.kind] ?? t.kind}</small></button>`).join('');
    box.querySelectorAll<HTMLElement>('.mk-toy').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.kind as ToyKind;
      st.kinds = st.kinds.includes(k) ? st.kinds.filter((x) => x !== k) : [...st.kinds, k];
      saveSt(); renderToys();
    }));
  };
  const showStyle = () => { q('.mk-style').textContent = styleOf(st.style).name; };
  const stepStyle = (d: number) => { const i = STYLE_IDS.indexOf(st.style); st.style = STYLE_IDS[(i + d + STYLE_IDS.length) % STYLE_IDS.length]; saveSt(); showStyle(); };
  q('[data-a="prev"]').addEventListener('click', () => stepStyle(-1));
  q('[data-a="next"]').addEventListener('click', () => stepStyle(1));
  const vocalSw = q('[data-a="vocal"]');
  const showVocal = () => vocalSw.classList.toggle('on', st.vocalOn);
  vocalSw.addEventListener('click', () => { st.vocalOn = !st.vocalOn; saveSt(); showVocal(); });

  // ================= 電源 =================
  const pwr = $('power');
  const powerOn = () => { void api.start(); api.post({ type: 'power', on: true }); powered = true; render(); };
  const powerOff = () => { api.post({ type: 'power', on: false }); powered = false; render(); };
  pwr.addEventListener('click', () => (powered ? powerOff() : powerOn()));

  // ================= 曲を入れる → 解析 =================
  const input = q('input[type="file"]') as HTMLInputElement;
  q('[data-a="load"]').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) void loadBlob(f, f.name, true); input.value = ''; });
  root.addEventListener('dragover', (e) => { e.preventDefault(); });
  root.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) void loadBlob(f, f.name, true); });
  async function loadBlob(blob: Blob, name: string, store: boolean): Promise<void> {
    title = name.replace(/\.[^.]+$/, '');
    analysis = null; sep = null; errMsg = '';
    busy = { f: 0, what: 'ファイルを読んでいます' };
    render();
    try {
      const buf = await blob.arrayBuffer();
      const ctx = new OfflineAudioContext(2, 1, 44100);
      const audio = await ctx.decodeAudioData(buf);
      const ch = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, i) => audio.getChannelData(i).slice());
      if (store) { await saveFile(blob, name); st.from = 0; st.to = 0; saveSt(); }
      const w = new AnalyzeWorker();
      w.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === 'progress') { busy = { f: m.f, what: m.what }; draw(); }
        else if (m.type === 'done') {
          w.terminate();
          analysis = m.analysis; sep = { sr: m.sr, vocal: m.vocal, inst: m.inst, orig: m.orig }; busy = null;
          syncRange(); render();
        } else if (m.type === 'error') { w.terminate(); busy = null; errMsg = m.message; render(); }
      };
      w.postMessage({ ch, sr: audio.sampleRate }, ch.map((c) => c.buffer));
    } catch (err) {
      busy = null;
      errMsg = `このファイルは読めませんでした（${String(err).slice(0, 60)}）`;
      render();
    }
  }

  // ================= COVER! =================
  const makeTape = (from: number, to: number): ManekkoTape | null => {
    if (!analysis || !sep) return null;
    const bpm = Math.round(analysis.bpm);
    const al = (x: Float32Array) => alignToGrid(x, sep!.sr, analysis!.beats, bpm, from, to);
    return { kind: 'tape', sr: sep.sr, bpm, vocal: al(sep.vocal), inst: al(sep.inst), orig: al(sep.orig) };
  };
  const sendTape = () => { if (tape) api.post({ type: 'custom', key: 'tape', data: tape }); };
  q('[data-a="cover"]').addEventListener('click', () => {
    void api.start();
    const host = api.songHost;
    if (!analysis || !host) { errMsg = analysis ? 'ここではカバーを作れません' : '先に ⏏ LOAD で曲を入れてね'; draw(); return; }
    const all = hostToys();
    const toys = all.filter((t) => st.kinds.includes(t.kind) || (st.vocalOn && t.kind === 'manekko')).map(({ toy, kind }) => ({ toy, kind }));
    if (!toys.some((t) => t.kind !== 'manekko')) { errMsg = 'カバーを弾くおもちゃを 1 つ以上選んでね'; draw(); return; }
    const from = Math.min(st.from, bars() - 1), to = Math.max(from + 1, Math.min(st.to || bars(), bars()));
    const seed = (Date.now() % 900000) + 1;
    const song = defaultComposer().compose({ settings: { seed, style: st.style, chaos: st.chaos, lengthSec: 60, bpm: Math.round(analysis.bpm) }, toys, cover: coverSource(analysis, title, from, to) });
    coverFrom = from;
    tape = makeTape(from, to);
    sendTape();
    errMsg = '';
    host.load(song, true);
    render();
  });
  // ▶ 原曲：押している間、いまの範囲の頭から元の曲だけ
  let origHeld = false;
  momentary(q('[data-a="orig"]'), () => {
    if (!analysis) return;
    void api.start();
    if (!tape) { coverFrom = Math.min(st.from, bars() - 1); tape = makeTape(coverFrom, Math.max(coverFrom + 1, st.to || bars())); sendTape(); }
    origHeld = true;
    for (const i of [MK.vocal, MK.karaoke]) api.post({ type: 'param', index: i, value: 0 });
    api.post({ type: 'param', index: MK.orig, value: 1 });
    api.post({ type: 'key', key: 0, down: true });
  }, () => {
    if (!origHeld) return;
    origHeld = false;
    api.post({ type: 'key', key: 0, down: false });
    for (const i of [MK.vocal, MK.karaoke, MK.orig]) api.post({ type: 'param', index: i, value: params[i] });
  });
  momentary(q('[data-a="stutter"]'), () => setParam(MK.stutter, 1), () => setParam(MK.stutter, 0));

  // ================= モニター =================
  const cv = q('.mk-screen') as HTMLCanvasElement;
  const g = cv.getContext('2d')!;
  const SEC_COLORS: Record<string, string> = { intro: '#3d6b9e', verse: '#3f8f4a', chorus: '#d4762a', break: '#7a5aa8', outro: '#5a5a7a', build: '#b0a030' };
  function draw(): void {
    const w = cv.width, h = cv.height;
    g.fillStyle = powered ? '#06140c' : '#030806';
    g.fillRect(0, 0, w, h);
    if (!powered) return;
    const ink = '#7dff9a', dim = '#2f7a46';
    g.font = '700 20px "Share Tech Mono", monospace';
    g.fillStyle = ink;
    g.textBaseline = 'top';
    if (busy) {
      g.fillText(title ? `♪ ${title}`.slice(0, 44) : 'LOADING…', 16, 16);
      g.fillStyle = dim; g.fillRect(16, 150, w - 32, 22);
      g.fillStyle = ink; g.fillRect(16, 150, (w - 32) * busy.f, 22);
      g.fillText(busy.what, 16, 186);
      g.fillText(`${Math.round(busy.f * 100)}%`, w - 70, 186);
      return;
    }
    if (errMsg) { g.fillStyle = '#ff8a7a'; g.fillText(errMsg.slice(0, 44), 16, h - 34); g.fillStyle = ink; }
    if (!analysis) {
      g.fillText('MANEKKO MK-8', 16, 16);
      g.fillStyle = dim;
      g.fillText('⏏ LOAD で曲を入れてね', 16, 70);
      g.fillText('(MP3 / AAC / WAV …)', 16, 100);
      g.fillText('この中だけで解析します', 16, 150);
      return;
    }
    const a = analysis, n = a.bars;
    g.fillText(`♪ ${title}`.slice(0, 44), 16, 12);
    g.font = '700 17px "Share Tech Mono", monospace';
    g.fillText(`BPM ${a.bpm}   KEY ${a.key.name}   ${n} BARS   ${Math.floor(a.duration / 60)}:${String(Math.floor(a.duration % 60)).padStart(2, '0')}`, 16, 42);
    // 構成の帯（全体）・使う範囲・再生位置
    const x0 = 16, bw = (w - 32) / n, y0 = 72;
    for (const s of a.sections) {
      g.fillStyle = SEC_COLORS[s.kind] ?? '#3f8f4a';
      g.fillRect(x0 + s.start * bw, y0, s.bars * bw - 1, 26);
      g.fillStyle = '#e8ffe8';
      g.font = '700 13px "Share Tech Mono", monospace';
      if (s.bars * bw > 40) g.fillText(s.name.slice(0, Math.floor((s.bars * bw) / 8)), x0 + s.start * bw + 4, y0 + 6);
    }
    const from = st.from, to = st.to || n;
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.strokeRect(x0 + from * bw, y0 - 3, (to - from) * bw, 32);
    // 大きさ（小節ごと）
    for (let b = 0; b < n; b++) { const e = a.energy[b] ?? 0; g.fillStyle = b >= from && b < to ? '#3fbf6a' : '#1d4a2c'; g.fillRect(x0 + b * bw, 140 - e * 32, Math.max(1, bw - 1), e * 32); }
    // 再生中の小節（元の曲での小節）
    const cur = beat >= 0 ? coverFrom + Math.floor(beat / 4) : -1;
    if (cur >= 0) { g.fillStyle = '#fff6a0'; g.fillRect(x0 + (cur + (beat % 4) / 4) * bw, y0 - 6, 2, 76); }
    // コードの並び（今の所から 8 小節）
    const c0 = cur >= 0 ? cur : from;
    g.font = '700 22px "Share Tech Mono", monospace';
    for (let k = 0; k < 8; k++) {
      const b = c0 + k;
      if (b >= n) break;
      const cx = 16 + k * 74;
      g.strokeStyle = k === 0 && cur >= 0 ? '#fff6a0' : dim; g.lineWidth = 2;
      g.strokeRect(cx, 156, 70, 42);
      g.fillStyle = k === 0 && cur >= 0 ? '#fff6a0' : ink;
      g.fillText(a.chordNames[b] ?? '', cx + 8, 166);
    }
    // メロディ（今の所から 8 小節を点で）
    const lo = 48, hi = 84;
    g.fillStyle = '#9dffb8';
    for (const m of a.melody) {
      const rel = m.t / 4 - c0;
      if (rel < 0 || rel >= 8) continue;
      const y = 300 - ((m.midi - a.shift - lo) / (hi - lo)) * 90;
      g.fillRect(16 + rel * 74, y, Math.max(2, (m.len / 4) * 74 - 1), 3);
    }
    g.fillStyle = dim;
    g.font = '700 14px "Share Tech Mono", monospace';
    g.fillText(`RANGE ${from + 1}-${to}   STYLE ${styleOf(st.style).name}`, 16, h - 18);
  }

  function render(): void {
    $('led').classList.toggle('on', powered);
    root.classList.toggle('off', !powered);
    root.classList.toggle('spin', beat >= 0);
    q('.mk-label').textContent = busy ? 'READING…' : analysis ? title.slice(0, 22) || 'TAPE' : 'NO TAPE';
    showStyle(); showVocal();
    draw();
  }
  setTimeout(renderToys, 0); // ホストの準備ができてから
  render();
  // 前に入れた曲があれば、もう一度解析する（解析の結果は大きいので保存しない）
  void loadFile().then((f) => { if (f && !analysis && !busy) void loadBlob(f.blob, f.name, false); });

  return {
    title: 'MANEKKO MK-8',
    width: W,
    height: H,
    root,
    help: HELP,
    paramDefs: MANEKKO_PARAMS,
    keyCount: MK_MAX_BARS,
    powerButton: pwr,
    keyName: (k) => `TAPE BAR ${k + 1}`,
    keyKind: () => 'play',
    onMessage(m: FromToy) {
      if (m.type === 'display') { beat = (m.display as ManekkoDisplay).beat; root.classList.toggle('spin', beat >= 0); draw(); }
      else if (m.type === 'status' && m.status.powered !== powered) { powered = m.status.powered; render(); }
    },
    keyDown: () => false,
    keyUp: () => {},
    releaseAll: () => {},
    midi(status, d1, d2) {
      if ((status & 0xf0) !== 0xb0) return;
      const p = MANEKKO_PARAMS.findIndex((x) => x.midiCC === d1);
      if (p >= 0) knobs.get(p)?.set(d2 / 127);
    },
    powerOn,
    powerOff,
    showParam(index, v) { params[index] = v; knobs.get(index)?.set(v, false); },
    customData: () => (tape ? [{ key: 'tape', data: tape }] : []),
  };
}
