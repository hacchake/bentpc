// PAKU-PAKU 16（音を食べるサンプラー）の画面。
// 子ども用の録音おもちゃを魔改造した見た目。16 パッド × 10 バンク、録音・リサンプル・ファイル読み込み、
// パッドごとの GATE / LOOP / REV / POLY・ミュートグループ・音程・フィルター・エンベロープ。
import './sampler.css';
import { Knob } from '../core/controls';
import { factoryBank, factoryParams } from './dsp/factory';
import {
  BANKS, BANK_NAMES, PADS, PAD_COUNT, attackSec, cutoffHz, defaultPad, padLabel, releaseSec,
  type FromSampler, type PadParams, type SampleBuf,
} from './dsp/types';
import { SamplerHost } from './host';
import { loadAll, savePads, type StoredPad } from './store';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const host = new SamplerHost();

// ---------------- 中身（160 パッド） ----------------
const params: PadParams[] = Array.from({ length: PAD_COUNT }, defaultPad);
const samples: (SampleBuf | null)[] = Array.from({ length: PAD_COUNT }, () => null);
const names: string[] = Array.from({ length: PAD_COUNT }, () => '');
let bank = 0;
let cur = 0; // いまのパッド（0〜159）

// ---------------- 本体の画面を作る ----------------
const dev = document.createElement('div');
dev.className = 'paku';
dev.innerHTML = `
  <i class="screw s1"></i><i class="screw s2"></i><i class="screw s3"></i><i class="screw s4"></i>
  <div class="pk-head">
    <div class="pk-brand"><b>PAKU-PAKU</b><span>16</span></div>
    <div class="pk-sub">おとを たべる サンプラー<small>SOUND MUNCHER ・ BENT BY HAND</small></div>
    <div class="pk-mouth" title="スピーカー"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="pk-mic" title="マイク"><span class="led" id="pk-recled"></span></div>
    <div class="pk-scribble">160 VOICES!! 改</div>
  </div>
  <div class="pk-lcd">
    <div class="pk-lcd-top"><b id="pk-padname">A-01</b><span id="pk-sname"></span><span class="tags" id="pk-tags"></span></div>
    <canvas id="pk-wave" width="520" height="132"></canvas>
    <div class="pk-lcd-bot"><span id="pk-msg"></span><span class="meters"><i>IN</i><b id="pk-min"><u></u></b><i>OUT</i><b id="pk-mout"><u></u></b></span></div>
  </div>
  <div class="pk-plate pk-knobs">
    <div class="pk-pages">
      <button data-page="0" class="on">SOUND</button><button data-page="1">FILTER・ENV</button><button data-page="2">SAMPLE</button>
    </div>
    <div class="pk-krow">${[0, 1, 2, 3].map((i) => `<div class="pk-k"><span class="pk-kname" id="pk-kn${i}"></span><div class="knob big black" id="pk-k${i}"><div class="cap"></div></div><span class="pk-kval" id="pk-kv${i}"></span></div>`).join('')}</div>
  </div>
  <div class="pk-funcs">
    <div class="pk-grp rec-grp">
      <button class="pk-btn red" id="pk-rec"><i class="lamp"></i>REC</button>
      <button class="pk-btn small" id="pk-auto" title="音が来たら録音を始める"><i class="lamp"></i>AUTO</button>
      <button class="pk-btn orange" id="pk-res"><i class="lamp"></i>RESAMPLE</button>
      <button class="pk-btn small" id="pk-mon" title="入力の音をスピーカーから出す（ハウリングに注意）"><i class="lamp"></i>MON</button>
    </div>
    <div class="pk-grp mode-grp">
      <button class="pk-btn mode" id="pk-gate"><i class="lamp"></i>GATE</button>
      <button class="pk-btn mode" id="pk-loop"><i class="lamp"></i>LOOP</button>
      <button class="pk-btn mode" id="pk-rev"><i class="lamp"></i>REV</button>
      <button class="pk-btn mode" id="pk-poly"><i class="lamp"></i>POLY</button>
    </div>
    <div class="pk-grp edit-grp">
      <button class="pk-btn gray" id="pk-file-btn">📂 FILE</button>
      <button class="pk-btn gray" id="pk-copy"><i class="lamp"></i>COPY</button>
      <button class="pk-btn gray" id="pk-del"><i class="lamp"></i>DEL</button>
      <button class="pk-btn gray" id="pk-fixed" title="パッドの強さをいつも最大に"><i class="lamp"></i>FIXED VEL</button>
      <button class="pk-btn black" id="pk-stop">■ STOP</button>
    </div>
    <div class="pk-vol"><div class="knob red" id="pk-master"><div class="cap"></div></div><span>VOL</span></div>
  </div>
  <div class="pk-banks">
    <button class="pk-bnav" id="pk-bprev">◀</button>
    ${[...BANK_NAMES].map((b, i) => `<button class="pk-bank" data-bank="${i}">${b}</button>`).join('')}
    <button class="pk-bnav" id="pk-bnext">▶</button>
  </div>
  <div class="pk-pads" id="pk-pads"></div>
  <div class="pk-tape t1">MIC IN →</div>
  <div class="pk-tape t2">パッド 上ほど つよい</div>`;
$('pk-stage').appendChild(dev);
const q = <T extends HTMLElement = HTMLElement>(id: string) => dev.querySelector(`#${id}`) as T;

// パッド：左下が 1（MIDI のパッド機と同じ並び）。画面の上の段が 13〜16
const padEls: HTMLElement[] = [];
for (let row = 3; row >= 0; row--) for (let col = 0; col < 4; col++) {
  const i = row * 4 + col;
  const el = document.createElement('div');
  el.className = `pk-pad r${row}`;
  el.innerHTML = `<span class="no">${i + 1}</span><span class="nm"></span><span class="ph"></span>`;
  padEls[i] = el;
  q('pk-pads').appendChild(el);
}

// ---------------- 大きさ合わせ（横長はパッドが右、縦長はパッドが下） ----------------
const DESIGN = { land: [1260, 760], port: [740, 1380] } as const;
function fit(): void {
  const top = $('pk-top').offsetHeight;
  const w = window.innerWidth, h = window.innerHeight - top;
  const mode = w / h > 1.05 ? 'land' : 'port';
  dev.classList.toggle('land', mode === 'land');
  dev.classList.toggle('port', mode === 'port');
  const [dw, dh] = DESIGN[mode];
  const s = Math.min((w - 12) / dw, (h - 12) / dh);
  dev.style.width = `${dw}px`;
  dev.style.height = `${dh}px`;
  dev.style.transform = `translate(-50%, -50%) scale(${s})`;
  $('pk-stage').style.top = `${top}px`;
}
window.addEventListener('resize', fit);
fit();

// ---------------- ノブ（ページで役目が変わる） ----------------
interface KDef { key: keyof PadParams; name: string; toK: (v: number) => number; fromK: (k: number) => number; fmt: (v: number) => string }
const lin = (lo: number, hi: number, round = false) => ({
  toK: (v: number) => (v - lo) / (hi - lo),
  fromK: (k: number) => { const v = lo + k * (hi - lo); return round ? Math.round(v) : v; },
});
const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (s: number) => (s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(2)}s`);
const sampleLen = () => { const s = samples[cur]; return s ? s.ch[0].length / s.sr : 0; };
const PAGES: KDef[][] = [
  [
    { key: 'vol', name: 'VOLUME', ...lin(0, 1), fmt: pct },
    { key: 'pan', name: 'PAN', ...lin(-1, 1), fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 50)}` : `R${Math.round(v * 50)}`) },
    { key: 'pitch', name: 'PITCH', ...lin(-24, 24, true), fmt: (v) => `${v > 0 ? '+' : ''}${v}` },
    { key: 'fine', name: 'FINE', ...lin(-50, 50, true), fmt: (v) => `${v > 0 ? '+' : ''}${v}¢` },
  ],
  [
    { key: 'cutoff', name: 'CUTOFF', ...lin(0, 1), fmt: (v) => (v >= 0.999 ? 'OPEN' : cutoffHz(v) >= 1000 ? `${(cutoffHz(v) / 1000).toFixed(1)}k` : `${Math.round(cutoffHz(v))}Hz`) },
    { key: 'reso', name: 'RESO', ...lin(0, 1), fmt: pct },
    { key: 'attack', name: 'ATTACK', ...lin(0, 1), fmt: (v) => secs(attackSec(v)) },
    { key: 'release', name: 'RELEASE', ...lin(0, 1), fmt: (v) => secs(releaseSec(v)) },
  ],
  [
    { key: 'start', name: 'START', ...lin(0, 1), fmt: (v) => secs(v * sampleLen()) },
    { key: 'end', name: 'END', ...lin(0, 1), fmt: (v) => secs(v * sampleLen()) },
    { key: 'mute', name: 'MUTE GRP', ...lin(0, 8, true), fmt: (v) => (v ? String(v) : 'OFF') },
    { key: 'vel', name: 'VEL', ...lin(0, 1), fmt: (v) => (v < 0.01 ? 'FIXED' : pct(v)) },
  ],
];
let page = 0;
const knobs = [0, 1, 2, 3].map((i) => new Knob(q(`pk-k${i}`), { default: 0 }, (k) => {
  const d = PAGES[page][i];
  setParam(cur, d.key, d.fromK(k));
}));
// ダブルクリックで初期値（ページで変わるので、ここで決める）
[0, 1, 2, 3].forEach((i) => q(`pk-k${i}`).addEventListener('dblclick', () => {
  const d = PAGES[page][i];
  const v = defaultPad()[d.key] as number;
  knobs[i].set(d.toK(v), false);
  setParam(cur, d.key, v);
}, true));
dev.querySelectorAll<HTMLButtonElement>('.pk-pages button').forEach((b) => b.addEventListener('click', () => {
  page = Number(b.dataset.page);
  dev.querySelectorAll('.pk-pages button').forEach((x) => x.classList.toggle('on', x === b));
  showKnobs();
}));
function showKnobs(): void {
  PAGES[page].forEach((d, i) => {
    const v = params[cur][d.key] as number;
    knobs[i].set(Math.max(0, Math.min(1, d.toK(v))), false);
    q(`pk-kn${i}`).textContent = d.name;
    q(`pk-kv${i}`).textContent = d.fmt(v);
  });
}

// マスター音量
let master = 0.8;
try { master = Number(localStorage.getItem('paku16.master') ?? 0.8); } catch { /* そのまま */ }
const masterKnob = new Knob(q('pk-master'), { default: 0.8 }, (v) => {
  master = v;
  host.post({ type: 'master', vol: v * 1.25 });
  try { localStorage.setItem('paku16.master', String(v)); } catch { /* そのまま */ }
});
masterKnob.set(master, false);
host.post({ type: 'master', vol: master * 1.25 });

// ---------------- パッドの設定を変える ----------------
function setParam<K extends keyof PadParams>(pad: number, key: K, v: PadParams[K]): void {
  params[pad] = { ...params[pad], [key]: v };
  host.post({ type: 'params', pad, p: params[pad] });
  markDirty(pad);
  if (pad === cur) { showKnobs(); showModes(); drawWave(); }
}

function setPad(pad: number, name: string, data: SampleBuf | null, p: PadParams): void {
  samples[pad] = data;
  names[pad] = name;
  params[pad] = p;
  peaks.delete(pad);
  host.post({ type: 'sample', pad, data });
  host.post({ type: 'params', pad, p });
  markDirty(pad);
  renderPads();
  if (pad === cur) select(pad);
}

// ---------------- 保存（少し待ってまとめて） ----------------
const dirty = new Set<number>();
let saveTimer = 0;
function markDirty(pad: number): void {
  dirty.add(pad);
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const items: StoredPad[] = [...dirty].map((p) => ({ pad: p, name: names[p], params: params[p], sample: samples[p] }));
    dirty.clear();
    void savePads(items);
  }, 600);
}

// ---------------- 表示 ----------------
const toggles = { gate: q('pk-gate'), loop: q('pk-loop'), reverse: q('pk-rev'), poly: q('pk-poly') } as const;
function showModes(): void {
  for (const [k, el] of Object.entries(toggles)) el.classList.toggle('lit', !!params[cur][k as keyof typeof toggles]);
  const p = params[cur];
  const tags = [p.gate ? 'GATE' : '', p.loop ? 'LOOP' : '', p.reverse ? 'REV' : '', p.poly ? 'POLY' : '', p.mute ? `MG${p.mute}` : ''].filter(Boolean);
  q('pk-tags').textContent = tags.join(' ');
}

function renderPads(): void {
  for (let i = 0; i < PADS; i++) {
    const pad = bank * PADS + i;
    const el = padEls[i];
    el.classList.toggle('empty', !samples[pad]);
    el.classList.toggle('sel', pad === cur);
    (el.querySelector('.nm') as HTMLElement).textContent = names[pad] || (samples[pad] ? '—' : '');
  }
  dev.querySelectorAll<HTMLElement>('.pk-bank').forEach((b) => {
    const k = Number(b.dataset.bank);
    b.classList.toggle('on', k === bank);
    b.classList.toggle('has', samples.slice(k * PADS, k * PADS + PADS).some(Boolean));
  });
}

function select(pad: number): void {
  cur = pad;
  q('pk-padname').textContent = padLabel(pad);
  const s = samples[pad];
  q('pk-sname').textContent = s ? `${names[pad] || '—'}  ${(s.ch[0].length / s.sr).toFixed(2)}s ${s.ch.length > 1 ? 'ST' : 'MONO'}` : '（からっぽ）';
  showKnobs();
  showModes();
  renderPads();
  drawWave();
}

function setBank(b: number): void {
  bank = (b + BANKS) % BANKS;
  select(bank * PADS + (cur % PADS));
}

// 波形（いまのパッド）。山の形は覚えておく
const peaks = new Map<number, Float32Array>();
const wave = q<HTMLCanvasElement>('pk-wave');
const wctx = wave.getContext('2d')!;
let playPos: [number, number][] = [];
function peaksOf(pad: number): Float32Array | null {
  const s = samples[pad];
  if (!s) return null;
  let pk = peaks.get(pad);
  if (pk) return pk;
  const W = wave.width, d = s.ch[0], n = d.length;
  pk = new Float32Array(W * 2);
  for (let x = 0; x < W; x++) {
    const a = Math.floor((x / W) * n), b = Math.max(a + 1, Math.floor(((x + 1) / W) * n));
    let lo = 0, hi = 0;
    for (let i = a; i < b; i += Math.max(1, Math.floor((b - a) / 64))) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
    pk[x * 2] = lo; pk[x * 2 + 1] = hi;
  }
  peaks.set(pad, pk);
  return pk;
}
function drawWave(): void {
  const W = wave.width, H = wave.height, c = wctx;
  c.fillStyle = '#a9c98a';
  c.fillRect(0, 0, W, H);
  // 方眼
  c.fillStyle = 'rgba(40,60,20,.08)';
  for (let x = 0; x < W; x += 4) c.fillRect(x, 0, 1, H);
  const pk = peaksOf(cur);
  if (!pk) {
    c.fillStyle = '#2b3a1c';
    c.font = '700 18px "Share Tech Mono", monospace';
    c.textAlign = 'center';
    c.fillText(mode === 'recPick' || mode === 'resPick' ? 'パッドを えらんでね' : 'からっぽ：REC か FILE で音を入れる', W / 2, H / 2 + 6);
    return;
  }
  const p = params[cur];
  c.fillStyle = '#20301a';
  for (let x = 0; x < W; x++) {
    const lo = pk[x * 2], hi = pk[x * 2 + 1];
    const y0 = H / 2 - hi * (H / 2 - 4), y1 = H / 2 - lo * (H / 2 - 4);
    c.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  // 鳴らさない所は暗く
  c.fillStyle = 'rgba(30,45,15,.45)';
  const xs = Math.min(p.start, p.end) * W, xe = Math.max(p.start, p.end) * W;
  c.fillRect(0, 0, xs, H);
  c.fillRect(xe, 0, W - xe, H);
  c.fillStyle = '#c0281c';
  c.fillRect(xs, 0, 2, H);
  c.fillRect(xe - 2, 0, 2, H);
  // 再生位置
  c.fillStyle = '#fff6b0';
  for (const [pad, pos] of playPos) if (pad === cur) c.fillRect(pos * W, 0, 2, H);
}

// ---------------- メッセージ ----------------
type Mode = 'play' | 'recPick' | 'recording' | 'resPick' | 'resampling' | 'copy' | 'del';
let mode: Mode = 'play';
let recPad = -1;
let auto = false;
let monitor = false;
let fixedVel = false;
const HINT = 'パッドを押すと鳴って、えらべる';
let msgTimer = 0;
function msg(text: string, ms = 0): void {
  q('pk-msg').textContent = text;
  clearTimeout(msgTimer);
  if (ms) msgTimer = window.setTimeout(() => showModeMsg(), ms);
}
function showModeMsg(): void {
  const t: Record<Mode, string> = {
    play: HINT,
    recPick: '● 録るパッドを押してね（REC でやめる）',
    recording: auto ? '● 音が来たら録音… REC で止める' : '● 録音中… REC で止める',
    resPick: '● リサンプルするパッドを押してね',
    resampling: '● リサンプル中：パッドを鳴らして → RESAMPLE で止める',
    copy: `COPY：${padLabel(cur)} を貼り付けるパッドを押す`,
    del: 'DEL：消すパッドを押す（DEL でやめる）',
  };
  msg(t[mode]);
}
function setMode(m: Mode): void {
  mode = m;
  q('pk-rec').classList.toggle('lit', m === 'recPick' || m === 'recording');
  q('pk-rec').classList.toggle('blink', m === 'recPick');
  q('pk-res').classList.toggle('lit', m === 'resPick' || m === 'resampling');
  q('pk-res').classList.toggle('blink', m === 'resPick');
  q('pk-copy').classList.toggle('lit', m === 'copy');
  q('pk-del').classList.toggle('lit', m === 'del');
  dev.classList.toggle('picking', m === 'recPick' || m === 'resPick' || m === 'copy' || m === 'del');
  q('pk-recled').classList.toggle('on', m === 'recording' || m === 'resampling');
  showModeMsg();
  drawWave();
}

host.onMessage = (m: FromSampler) => {
  if (m.type === 'meter') {
    (q('pk-min').firstElementChild as HTMLElement).style.width = `${Math.min(100, m.inPeak * 100)}%`;
    (q('pk-mout').firstElementChild as HTMLElement).style.width = `${Math.min(100, m.outPeak * 100)}%`;
    if (m.rec >= 0 && (mode === 'recording' || mode === 'resampling')) {
      msg(m.waiting ? '● 音が来るのを待っています…（REC で止める）' : `● ${mode === 'recording' ? '録音' : 'リサンプル'}中 ${m.rec.toFixed(1)} 秒 → ${mode === 'recording' ? 'REC' : 'RESAMPLE'} で止める`);
    }
  } else if (m.type === 'play') {
    playPos = m.pads;
    const on = new Set(m.pads.map((p) => p[0]));
    for (let i = 0; i < PADS; i++) {
      const pad = bank * PADS + i;
      padEls[i].classList.toggle('playing', on.has(pad));
      const pos = m.pads.find((p) => p[0] === pad);
      (padEls[i].querySelector('.ph') as HTMLElement).style.width = pos ? `${pos[1] * 100}%` : '0';
    }
    drawWave();
  } else if (m.type === 'recorded') {
    const pad = recPad;
    recPad = -1;
    setMode('play');
    if (!m.data || m.data.ch[0].length < m.data.sr * 0.02) { msg('音が録れませんでした', 2500); return; }
    const data = trimSilence(m.data);
    setPad(pad, pendingName, data, { ...params[pad], start: 0, end: 1 });
    select(pad);
    msg(`${padLabel(pad)} に入れました（${(data.ch[0].length / data.sr).toFixed(2)} 秒）`, 2500);
  }
};
let pendingName = 'REC';

/** 頭とお尻の無音を切る（とても小さい音だけ） */
function trimSilence(s: SampleBuf): SampleBuf {
  const d = s.ch[0], th = 0.004;
  let a = 0, b = d.length;
  const loud = (i: number) => s.ch.some((c) => Math.abs(c[i]) > th);
  while (a < b && !loud(a)) a++;
  while (b > a && !loud(b - 1)) b--;
  a = Math.max(0, a - Math.round(s.sr * 0.003));
  b = Math.min(d.length, b + Math.round(s.sr * 0.02));
  if (b - a < s.sr * 0.02) return s;
  return { sr: s.sr, ch: s.ch.map((c) => c.slice(a, b)) };
}

// ---------------- パッドを押す ----------------
const held = new Map<number, number>(); // pointerId → pad
function padDown(i: number, vel: number): void {
  const pad = bank * PADS + i;
  switch (mode) {
    case 'recPick':
    case 'resPick': {
      recPad = pad;
      pendingName = mode === 'recPick' ? 'REC' : 'RESAMPLE';
      host.post({ type: 'rec', on: true, source: mode === 'recPick' ? 'input' : 'output', auto: mode === 'recPick' && auto });
      select(pad);
      setMode(mode === 'recPick' ? 'recording' : 'resampling');
      return;
    }
    case 'copy': {
      if (pad !== cur) {
        const src = cur;
        setPad(pad, names[src], samples[src], { ...params[src] });
        msg(`${padLabel(src)} → ${padLabel(pad)} にコピーしました`, 2500);
      }
      setMode('play');
      select(pad);
      return;
    }
    case 'del': {
      setPad(pad, '', null, defaultPad());
      setMode('play');
      select(pad);
      msg(`${padLabel(pad)} を消しました`, 2500);
      return;
    }
  }
  if (mode === 'recording' && pad === recPad) return;
  host.post({ type: 'trig', pad, vel: fixedVel ? 1 : vel });
  padEls[i].classList.add('hit');
  setTimeout(() => padEls[i].classList.remove('hit'), 90);
  if (pad !== cur) select(pad);
}
function padUp(i: number): void {
  host.post({ type: 'release', pad: bank * PADS + i });
}

padEls.forEach((el, i) => {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    held.set(e.pointerId, i);
    // 強さ：ペンや感圧画面は筆圧、それ以外はパッドの押した高さ（上ほど強い）
    const r = el.getBoundingClientRect();
    const byPos = 1 - 0.75 * Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const vel = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : byPos;
    const go = () => padDown(i, vel);
    if (host.running) go(); else void host.start().then(go);
  });
  const up = (e: PointerEvent) => {
    if (!held.has(e.pointerId)) return;
    held.delete(e.pointerId);
    padUp(i);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  // PC：ファイルをパッドに落とす
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop');
    const f = e.dataTransfer?.files[0];
    if (f) void importFile(f, bank * PADS + i);
  });
});

// ---------------- ボタン ----------------
const click = (id: string, f: () => void) => q(id).addEventListener('click', () => { void host.start(); f(); });
click('pk-rec', async () => {
  if (mode === 'recording') { host.post({ type: 'rec', on: false }); return; }
  if (mode === 'recPick') { setMode('play'); return; }
  if (mode === 'resampling') return;
  msg('マイクを準備しています…');
  if (!(await host.enableMic())) { msg('マイクが使えません（ブラウザの許可を確かめてね）', 4000); return; }
  setMode('recPick');
});
click('pk-res', () => {
  if (mode === 'resampling') { host.post({ type: 'rec', on: false }); return; }
  if (mode === 'resPick') { setMode('play'); return; }
  if (mode === 'recording') return;
  setMode('resPick');
});
click('pk-auto', () => { auto = !auto; q('pk-auto').classList.toggle('lit', auto); });
click('pk-mon', async () => {
  monitor = !monitor;
  if (monitor && !(await host.enableMic())) { monitor = false; msg('マイクが使えません', 3000); }
  q('pk-mon').classList.toggle('lit', monitor);
  host.post({ type: 'monitor', on: monitor });
});
click('pk-fixed', () => { fixedVel = !fixedVel; q('pk-fixed').classList.toggle('lit', fixedVel); });
click('pk-stop', () => host.post({ type: 'stopAll' }));
click('pk-copy', () => setMode(mode === 'copy' ? 'play' : samples[cur] ? 'copy' : (msg('コピー元のパッドがからっぽです', 2500), 'play')));
click('pk-del', () => setMode(mode === 'del' ? 'play' : 'del'));
(Object.keys(toggles) as (keyof typeof toggles)[]).forEach((k) => click(toggles[k].id, () => setParam(cur, k, !params[cur][k])));
click('pk-bprev', () => setBank(bank - 1));
click('pk-bnext', () => setBank(bank + 1));
dev.querySelectorAll<HTMLElement>('.pk-bank').forEach((b) => b.addEventListener('click', () => setBank(Number(b.dataset.bank))));

// ファイル
const fileIn = $<HTMLInputElement>('pk-file');
click('pk-file-btn', () => fileIn.click());
fileIn.addEventListener('change', () => {
  const f = fileIn.files?.[0];
  fileIn.value = '';
  if (f) void importFile(f, cur);
});
async function importFile(f: File, pad: number): Promise<void> {
  msg('読み込み中…');
  try {
    const data = await host.decodeFile(f);
    const name = f.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 10);
    setPad(pad, name, data, { ...params[pad], start: 0, end: 1 });
    select(pad);
    msg(`${padLabel(pad)} に「${name}」を入れました`, 2500);
  } catch {
    msg('この音のファイルは読めませんでした', 3000);
  }
}

// ---------------- PC のキー ----------------
// Z X C V = 1〜4、A S D F = 5〜8、Q W E R = 9〜12、1 2 3 4 = 13〜16（パッドの並びと同じ形）
const KEYMAP: Record<string, number> = {
  KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3, KeyA: 4, KeyS: 5, KeyD: 6, KeyF: 7,
  KeyQ: 8, KeyW: 9, KeyE: 10, KeyR: 11, Digit1: 12, Digit2: 13, Digit3: 14, Digit4: 15,
};
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  const i = KEYMAP[e.code];
  if (i !== undefined) {
    e.preventDefault();
    const go = () => padDown(i, 1);
    if (host.running) go(); else void host.start().then(go);
    return;
  }
  if (e.code === 'BracketLeft') setBank(bank - 1);
  else if (e.code === 'BracketRight') setBank(bank + 1);
  else if (e.code === 'Space') { e.preventDefault(); host.post({ type: 'stopAll' }); }
});
window.addEventListener('keyup', (e) => {
  const i = KEYMAP[e.code];
  if (i !== undefined) padUp(i);
});

// ---------------- MIDI：ノート 36〜51 → いまのバンクのパッド 1〜16 ----------------
$('midiBtn').addEventListener('click', async () => {
  try {
    const acc = await navigator.requestMIDIAccess();
    const bind = () => acc.inputs.forEach((inp) => {
      inp.onmidimessage = (ev) => {
        const [st, d1, d2] = ev.data ?? [];
        const cmd = st & 0xf0, i = d1 - 36;
        if (i < 0 || i >= PADS) return;
        if (cmd === 0x90 && d2 > 0) { void host.start(); padDown(i, d2 / 127); }
        else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) padUp(i);
      };
    });
    bind();
    acc.onstatechange = bind;
    $('midiBtn').classList.add('on');
    msg(`MIDI：${acc.inputs.size} 台（ノート 36〜51 = パッド 1〜16）`, 3000);
  } catch {
    msg('MIDI が使えません（このブラウザでは使えないかも）', 3000);
  }
});

// ---------------- 工場出荷・ヘルプ・はじめる ----------------
function loadFactory(): void {
  for (const b of [0, 1] as const) {
    factoryBank(b).forEach((s, i) => setPad(b * PADS + i, s.name, s.buf, factoryParams(s)));
  }
}
$('factoryBtn').addEventListener('click', () => {
  if (!confirm('バンク A・B を最初の音に戻します（ほかのバンクはそのまま）。よろしいですか？')) return;
  loadFactory();
  setBank(0);
  msg('バンク A・B を最初の音に戻しました', 2500);
});
$('pk-help').innerHTML = `
  <h3>PAKU-PAKU 16 の使い方</h3>
  <table>
    <tr><td>パッド</td><td>押すと鳴って、そのパッドを選ぶ。上の方を押すほど強い音（FIXED VEL でいつも最大）</td></tr>
    <tr><td>バンク A〜J</td><td>16 パッド × 10 バンク。◀ ▶ か文字のボタン（PC は [ ]）</td></tr>
    <tr><td>ノブ 4 つ</td><td>SOUND・FILTER/ENV・SAMPLE でページを切り替え。上下ドラッグ、ダブルクリックで初期値</td></tr>
    <tr><td>GATE / LOOP / REV / POLY</td><td>押している間だけ鳴る／くり返す（GATE なしなら、もう一度押して止める）／逆再生／押し直しで重ねる</td></tr>
    <tr><td>MUTE GRP</td><td>同じ番号のパッドは、後から鳴った方が前を止める（ハイハットの開け閉めなど）</td></tr>
    <tr><td>REC</td><td>REC → 録るパッドを押す → 声や音を入れる → REC で止める。AUTO が点いていると、音が来てから録音が始まる</td></tr>
    <tr><td>RESAMPLE</td><td>RESAMPLE → 録るパッドを押す → ほかのパッドを鳴らす → RESAMPLE で止める（自分の音を録る）</td></tr>
    <tr><td>📂 FILE</td><td>音のファイルを選んだパッドに入れる。PC はパッドにファイルを落としてもよい</td></tr>
    <tr><td>COPY / DEL</td><td>COPY → 貼り付け先のパッド ／ DEL → 消すパッド</td></tr>
    <tr><td>PC のキー</td><td>Z X C V・A S D F・Q W E R・1 2 3 4 がパッド（下の段から）。スペースで STOP</td></tr>
    <tr><td>MIDI</td><td>上の MIDI を押すと、MIDI 機器のノート 36〜51 でパッド 1〜16</td></tr>
  </table>
  <p>音と設定はこのブラウザに自動で保存されます。次のフェーズで、波形の編集・チョップ・エフェクト・パターンの録音を足します。</p>`;
$('helpBtn').addEventListener('click', () => { $('pk-help').hidden = !$('pk-help').hidden; });
$('pk-help').addEventListener('click', () => { $('pk-help').hidden = true; });
$('pk-cover').addEventListener('pointerdown', () => {
  void host.start();
  $('pk-cover').remove();
});

// ---------------- 起動：保存してあった音を戻す（無ければ工場出荷） ----------------
(async () => {
  const stored = await loadAll();
  if (stored && stored.length) {
    for (const s of stored) {
      if (s.pad < 0 || s.pad >= PAD_COUNT) continue;
      samples[s.pad] = s.sample;
      names[s.pad] = s.name;
      params[s.pad] = { ...defaultPad(), ...s.params };
      host.post({ type: 'sample', pad: s.pad, data: s.sample });
      host.post({ type: 'params', pad: s.pad, p: params[s.pad] });
    }
  } else loadFactory();
  select(0);
  setMode('play');
})();
select(0);
