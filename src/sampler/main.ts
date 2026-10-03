// PAKU-PAKU 16（音を食べるサンプラー）の画面。
// 子ども用の録音おもちゃを魔改造した見た目。16 パッド × 16 バンク。
// 下の機能ボタンはタブで切り替える：PAD（録音・再生のしかた）／PLAY（ロール・サブパッド・16 レベル・テンポ）／EDIT（波形・チョップ・テンポ合わせ）
import { setupLang } from '../i18n';
import './sampler.css';
import { Knob } from '../core/controls';
import { FACTORY_BANKS, factoryBank, factoryParams } from './dsp/factory';
import {
  BANKS, BANK_NAMES, PADS, PAD_COUNT, ROLL_NAMES, ROLL_RATES, attackSec, cutoffHz, defaultPad, padLabel, releaseSec,
  type FromSampler, type PadParams, type SampleBuf, type TrigMod,
} from './dsp/types';
import { SamplerHost } from './host';
import { FX_LIST, SLOT_NAMES, defaultSlots, type FxSlot } from './dsp/fx';
import { WIRES, defaultBend, type BendState } from './dsp/bend';
import { PATTERNS, QUANTS, QUANT_NAMES, emptyPattern, swingT, type Pattern, type SongStep } from './dsp/seq';
import type { Song } from '../core/song';
import { midiBytes, packProject, renderOffline, sampleWav, unpackProject, wavBytes, type RenderSetup } from './dsp/export';
import { loadAll, loadMeta, saveMeta, savePads, type StoredPad } from './store';
import { openEditor, type EditorApi } from './editor';
import { normalize as edNormalize, reverse as edReverse, trim as edTrim } from './dsp/edit';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const host = new SamplerHost();

// ---------------- 中身（256 パッド）と、パッド以外の設定 ----------------
const params: PadParams[] = Array.from({ length: PAD_COUNT }, defaultPad);
const samples: (SampleBuf | null)[] = Array.from({ length: PAD_COUNT }, () => null);
const names: string[] = Array.from({ length: PAD_COUNT }, () => '');
interface Meta {
  bpm: number; rollRate: number; lvParam: number; fx: FxSlot[]; fxSel: number; bend: BendState;
  patterns: Pattern[]; song: SongStep[]; ptn: number; quant: number; swing: number; metro: boolean;
  /** 工場出荷の音の版（2 = バンク C〜G のジャンル編あり） */
  factoryVer?: number;
}
const newMeta = (): Meta => ({
  bpm: 120, rollRate: 2, lvParam: 0, fx: defaultSlots(), fxSel: 0, bend: defaultBend(),
  patterns: Array.from({ length: PATTERNS }, emptyPattern), song: [], ptn: 0, quant: 2, swing: 0.5, metro: true, factoryVer: 2,
});
const meta: Meta = newMeta();
let bank = 0;
let cur = 0; // いまのパッド（0〜159）

// ---------------- 本体の画面を作る ----------------
const dev = document.createElement('div');
dev.className = 'paku';
const lamp = '<i class="lamp"></i>';
dev.innerHTML = `
  <i class="screw s1"></i><i class="screw s2"></i><i class="screw s3"></i><i class="screw s4"></i>
  <div class="pk-head">
    <div class="pk-brand"><b>PAKU-PAKU</b><span>16</span></div>
    <div class="pk-sub">おとを たべる サンプラー<small>SOUND MUNCHER ・ BENT BY HAND</small></div>
    <div class="pk-mouth" title="スピーカー"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="pk-mic" title="マイク"><span class="led" id="pk-recled"></span></div>
    <div class="pk-scribble">256 VOICES!! 改</div>
  </div>
  <div class="pk-lcd">
    <div class="pk-lcd-top"><b id="pk-padname">A-01</b><span id="pk-sname"></span><span class="tags" id="pk-tags"></span></div>
    <canvas id="pk-wave" width="520" height="120"></canvas>
    <div class="pk-lcd-bot"><span id="pk-msg"></span><span class="pk-bpm" id="pk-bpmlcd"></span><span class="meters"><i>IN</i><b id="pk-min"><u></u></b><i>OUT</i><b id="pk-mout"><u></u></b></span></div>
  </div>
  <div class="pk-plate pk-knobs">
    <div class="pk-pages" id="pk-pages"></div>
    <div class="pk-krow">${[0, 1, 2, 3].map((i) => `<div class="pk-k"><span class="pk-kname" id="pk-kn${i}"></span><div class="knob big black" id="pk-k${i}"><div class="cap"></div></div><span class="pk-kval" id="pk-kv${i}"></span></div>`).join('')}</div>
  </div>
  <div class="pk-funcs">
    <div class="pk-tabs" id="pk-tabs"></div>
    <div class="pk-tab" data-tab="pad">
      <div class="pk-grp">
        <button class="pk-btn red" id="pk-rec">${lamp}REC</button>
        <button class="pk-btn small" id="pk-auto" title="音が来たら録音を始める">${lamp}AUTO</button>
        <button class="pk-btn orange" id="pk-res">${lamp}RESAMPLE</button>
        <button class="pk-btn small" id="pk-mon" title="入力の音をスピーカーから出す（ハウリングに注意）">${lamp}MON</button>
      </div>
      <div class="pk-grp">
        <button class="pk-btn mode" id="pk-gate">${lamp}GATE</button>
        <button class="pk-btn mode" id="pk-loop">${lamp}LOOP</button>
        <button class="pk-btn mode" id="pk-rev">${lamp}REV</button>
        <button class="pk-btn mode" id="pk-poly">${lamp}POLY</button>
      </div>
      <div class="pk-grp">
        <button class="pk-btn gray" id="pk-file-btn">📂 FILE</button>
        <button class="pk-btn gray" id="pk-copy">${lamp}COPY</button>
        <button class="pk-btn gray" id="pk-del">${lamp}DEL</button>
        <button class="pk-btn gray" id="pk-fixed" title="パッドの強さをいつも最大に">${lamp}FIXED VEL</button>
      </div>
    </div>
    <div class="pk-tab" data-tab="play">
      <div class="pk-grp"><button class="pk-btn mode" id="pk-roll">${lamp}ROLL</button><span class="pk-seg" id="pk-rates">${ROLL_NAMES.map((n, i) => `<button data-i="${i}">${n}</button>`).join('')}</span></div>
      <div class="pk-grp"><button class="pk-btn orange" id="pk-sub" title="最後に鳴らしたパッドをもう一度">SUB PAD</button><button class="pk-btn mode" id="pk-16lv">${lamp}16 LEVELS</button><span class="pk-seg" id="pk-lvp">${['PITCH', 'VEL', 'CUTOFF', 'ATTACK', 'START'].map((n, i) => `<button data-i="${i}">${n}</button>`).join('')}</span></div>
      <div class="pk-grp"><span class="pk-lbl">TEMPO</span><button class="pk-btn gray" id="pk-bpm-">−</button><span class="pk-num" id="pk-bpm">120.0</span><button class="pk-btn gray" id="pk-bpm+">＋</button><button class="pk-btn gray" id="pk-tap">TAP</button></div>
    </div>
    <div class="pk-tab" data-tab="edit">
      <div class="pk-grp"><button class="pk-btn mode" id="pk-ed-wave">〰 WAVE EDIT</button><button class="pk-btn orange" id="pk-ed-chop">✂ CHOP</button><button class="pk-btn mode" id="pk-ed-fit">⏱ TEMPO FIT</button></div>
      <div class="pk-grp"><button class="pk-btn gray" id="pk-ed-norm">NORMALIZE</button><button class="pk-btn gray" id="pk-ed-rev">REVERSE</button><button class="pk-btn gray" id="pk-ed-trim" title="START〜END だけ残す">TRIM</button><button class="pk-btn gray" id="pk-ed-undo">↶ UNDO</button><button class="pk-btn gray" id="pk-ed-wav" title="いまのパッドの音を WAV で保存">⤓ WAV</button></div>
      <div class="pk-note">いまのパッドの音を編集します（UNDO で 1 回だけ戻せる）</div>
    </div>
    <div class="pk-tab" data-tab="fx">
      <div class="pk-grp"><span class="pk-seg" id="pk-fxslot">${SLOT_NAMES.map((n, i) => `<button data-i="${i}">${n}</button>`).join('')}</span><button class="pk-btn mode" id="pk-fxon">${lamp}FX ON</button></div>
      <div class="pk-grp"><button class="pk-btn gray" id="pk-fxprev">◀</button><span class="pk-num pk-fxname" id="pk-fxname"></span><button class="pk-btn gray" id="pk-fxnext">▶</button><span class="pk-fxno" id="pk-fxno"></span></div>
      <div class="pk-grp"><span class="pk-lbl">このパッドの送り先</span><span class="pk-seg" id="pk-bus"><button data-i="0">DRY</button><button data-i="1">BUS 1</button><button data-i="2">BUS 2</button></span></div>
    </div>
    <div class="pk-tab" data-tab="bend">
      <div class="pk-bendboard" id="pk-wires">${WIRES.map((w, i) => `<button class="pk-wire" data-i="${i}" title="${w.desc}"><i></i><b>${w.name}</b></button>`).join('')}</div>
      <div class="pk-grp"><span class="pk-lbl">熱</span><span class="pk-heat"><u id="pk-heat"></u></span><button class="pk-btn gray" id="pk-unplug">ぜんぶ外す</button></div>
      <div class="pk-note" id="pk-bendnote">線をつなぐと壊れる。熱がたまると暴発（離せば冷める）</div>
    </div>
    <div class="pk-tab" data-tab="ptn">
      <div class="pk-grp"><button class="pk-btn mode" id="pk-pplay">${lamp}▶ PLAY</button><button class="pk-btn red" id="pk-prec">${lamp}● REC</button><button class="pk-btn small" id="pk-metro">${lamp}METRO</button><button class="pk-btn gray" id="pk-erase">${lamp}ERASE</button><button class="pk-btn gray" id="pk-pundo">↶</button></div>
      <div class="pk-grp"><button class="pk-btn orange" id="pk-psel">${lamp}PATTERN</button><span class="pk-num" id="pk-ptn">P01</span><span class="pk-lbl">小節</span><button class="pk-btn gray" id="pk-bars-">−</button><span class="pk-num" id="pk-bars">2</span><button class="pk-btn gray" id="pk-bars+">＋</button><button class="pk-btn gray" id="pk-pclear">CLEAR</button></div>
      <div class="pk-grp"><button class="pk-btn mode" id="pk-step">${lamp}STEP</button><button class="pk-btn gray" id="pk-sbar-">◀</button><span class="pk-num" id="pk-sbar">1/2</span><button class="pk-btn gray" id="pk-sbar+">▶</button><span class="pk-seg" id="pk-quant">${QUANT_NAMES.map((n, i) => `<button data-i="${i}">${n}</button>`).join('')}</span></div>
    </div>
    <div class="pk-tab" data-tab="song">
      <div class="pk-chain" id="pk-chain"></div>
      <div class="pk-grp"><button class="pk-btn orange" id="pk-sadd">＋ P01</button><button class="pk-btn gray" id="pk-sdel">削除</button><button class="pk-btn gray" id="pk-srep-">×−</button><button class="pk-btn gray" id="pk-srep+">×＋</button><button class="pk-btn mode" id="pk-splay">${lamp}▶ SONG</button></div>
      <div class="pk-grp"><button class="pk-btn gray" id="pk-xwp">⤓ WAV パターン</button><button class="pk-btn gray" id="pk-xws">⤓ WAV ソング</button><button class="pk-btn gray" id="pk-xmid">⤓ MIDI</button><button class="pk-btn gray" id="pk-xsave">💾 保存</button><button class="pk-btn gray" id="pk-xload">📂 読込</button><button class="pk-btn orange" id="pk-xstudio" title="ソング（無ければいまのパターン）を、スタジオのシーケンサーに入れて開く">→ STUDIO</button></div>
    </div>
    <div class="pk-side">
      <div class="pk-vol"><div class="knob red" id="pk-master"><div class="cap"></div></div><span>VOL</span></div>
      <button class="pk-btn black" id="pk-stop">■ STOP</button>
    </div>
  </div>
  <div class="pk-banks">
    <button class="pk-bnav" id="pk-bprev">◀</button>
    ${[...BANK_NAMES].map((b, i) => `<button class="pk-bank" data-bank="${i}">${b}</button>`).join('')}
    <button class="pk-bnav" id="pk-bnext">▶</button>
  </div>
  <div class="pk-pads" id="pk-pads"></div>
  <div class="pk-modal" id="pk-modal" hidden></div>
  <div class="pk-tape t1">MIC IN →</div>
  <div class="pk-tape t2">パッド 上ほど つよい</div>`;
$('pk-stage').appendChild(dev);
const q = <T extends HTMLElement = HTMLElement>(id: string) => dev.querySelector(`#${CSS.escape(id)}`) as T;

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
const DESIGN = { land: [1260, 780], port: [740, 1420] } as const;
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

// ---------------- 機能タブ ----------------
const TABS = [['pad', 'PAD'], ['play', 'PLAY'], ['edit', 'EDIT'], ['fx', 'FX'], ['bend', 'BEND'], ['ptn', 'PATTERN'], ['song', 'SONG']] as const;
let tab = 'pad';
q('pk-tabs').innerHTML = TABS.map(([id, n]) => `<button data-tab="${id}">${n}</button>`).join('');
function setTab(t: string): void {
  tab = t;
  // FX・BEND を開いたら、ノブもそのページに
  const want = ({ fx: 'FX', bend: 'BEND', ptn: 'SEQ', song: 'SEQ' } as Record<string, string>)[t];
  if (want) { page = PAGES.findIndex((x) => x[0] === want); showKnobs(); }
  else if (['FX', 'BEND', 'SEQ'].includes(PAGES[page][0])) { page = 0; showKnobs(); }
  if (t === 'fx') showFx();
  if (t === 'bend') showBend();
  if (t !== 'ptn' && padMode !== 'normal') setPadMode('normal');
  if (t === 'ptn' || t === 'song') showSeq();
  drawWave();
  dev.querySelectorAll<HTMLElement>('.pk-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  dev.querySelectorAll<HTMLElement>('.pk-tab').forEach((x) => (x.hidden = x.dataset.tab !== t));
}
dev.querySelectorAll<HTMLElement>('.pk-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab!)));

// ---------------- ノブ（ページで役目が変わる） ----------------
interface KDef { name: string; get: () => number; set: (k: number) => void; fmt: () => string; def: number }
const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (s: number) => (s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(2)}s`);
const sampleLen = () => { const s = samples[cur]; return s ? s.ch[0].length / s.sr : 0; };
/** パッドの設定 1 つ分のノブ（lo〜hi を 0〜1 に） */
function padK(key: keyof PadParams, name: string, lo: number, hi: number, fmt: (v: number) => string, round = false): KDef {
  const def = defaultPad()[key] as number;
  return {
    name,
    def: (def - lo) / (hi - lo),
    get: () => ((params[cur][key] as number) - lo) / (hi - lo),
    set: (k) => { const v = lo + k * (hi - lo); setParam(cur, key, (round ? Math.round(v) : v) as never); },
    fmt: () => fmt(params[cur][key] as number),
  };
}
const NONE: KDef = { name: '—', def: 0, get: () => 0, set: () => {}, fmt: () => '' };
const PAGES: [string, KDef[]][] = [
  ['SOUND', [
    padK('vol', 'VOLUME', 0, 1, pct),
    padK('pan', 'PAN', -1, 1, (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 50)}` : `R${Math.round(v * 50)}`)),
    padK('pitch', 'PITCH', -24, 24, (v) => `${v > 0 ? '+' : ''}${v}`, true),
    padK('fine', 'FINE', -50, 50, (v) => `${v > 0 ? '+' : ''}${v}¢`, true),
  ]],
  ['FILTER・ENV', [
    padK('cutoff', 'CUTOFF', 0, 1, (v) => (v >= 0.999 ? 'OPEN' : cutoffHz(v) >= 1000 ? `${(cutoffHz(v) / 1000).toFixed(1)}k` : `${Math.round(cutoffHz(v))}Hz`)),
    padK('reso', 'RESO', 0, 1, pct),
    padK('attack', 'ATTACK', 0, 1, (v) => secs(attackSec(v))),
    padK('release', 'RELEASE', 0, 1, (v) => secs(releaseSec(v))),
  ]],
  ['SAMPLE', [
    padK('start', 'START', 0, 1, (v) => secs(v * sampleLen())),
    padK('end', 'END', 0, 1, (v) => secs(v * sampleLen())),
    padK('loopStart', 'LOOP', 0, 1, (v) => secs(v * sampleLen())),
    padK('vel', 'VEL', 0, 1, (v) => (v < 0.01 ? 'FIXED' : pct(v))),
  ]],
  ['MIX', [
    padK('mute', 'MUTE GRP', 0, 8, (v) => (v ? String(v) : 'OFF'), true),
    padK('bus', 'BUS', 0, 2, (v) => ['DRY', 'BUS 1', 'BUS 2'][v] ?? 'DRY', true),
    padK('bpm', 'SMPL BPM', 0, 240, (v) => (v ? v.toFixed(1) : '?')),
    NONE,
  ]],
  ['FX', [0, 1, 2, 3].map((i): KDef => ({
    get name() { return FX_LIST[meta.fx[meta.fxSel].type].knobs[i][0]; },
    get def() { return FX_LIST[meta.fx[meta.fxSel].type].def[i]; },
    get: () => meta.fx[meta.fxSel].k[i],
    set: (k) => { const f = meta.fx[meta.fxSel]; f.k[i] = k; sendFx(meta.fxSel); },
    fmt: () => FX_LIST[meta.fx[meta.fxSel].type].knobs[i][1](meta.fx[meta.fxSel].k[i], { bpm: meta.bpm }),
  }))],
  ['SEQ', [
    { name: 'SWING', def: 0, get: () => (meta.swing - 0.5) / 0.25, set: (k) => { meta.swing = 0.5 + k * 0.25; sendSeqSet(); }, fmt: () => `${Math.round(meta.swing * 100)}%` },
    { name: 'BARS', def: 1 / 7, get: () => (curPattern().bars - 1) / 7, set: (k) => setBars(1 + Math.round(k * 7)), fmt: () => `${curPattern().bars}` },
    NONE, NONE,
  ]],
  ['BEND', [
    { name: 'AMOUNT', def: 0.5, get: () => meta.bend.amount, set: (k) => { meta.bend.amount = k; sendBend(); }, fmt: () => pct(meta.bend.amount) },
    { name: 'SPEED', def: 0.5, get: () => meta.bend.speed, set: (k) => { meta.bend.speed = k; sendBend(); }, fmt: () => pct(meta.bend.speed) },
    NONE, NONE,
  ]],
];
let page = 0;
q('pk-pages').innerHTML = PAGES.map(([n], i) => `<button data-page="${i}">${n}</button>`).join('');
const knobs = [0, 1, 2, 3].map((i) => new Knob(q(`pk-k${i}`), { default: 0 }, (k) => { PAGES[page][1][i].set(k); showKnobs(); }));
// ダブルクリックで初期値（ページで変わるので、ここで決める）
[0, 1, 2, 3].forEach((i) => q(`pk-k${i}`).addEventListener('dblclick', () => {
  const d = PAGES[page][1][i];
  d.set(d.def);
  showKnobs();
}, true));
dev.querySelectorAll<HTMLButtonElement>('.pk-pages button').forEach((b) => b.addEventListener('click', () => { page = Number(b.dataset.page); showKnobs(); }));
function showKnobs(): void {
  dev.querySelectorAll<HTMLElement>('.pk-pages button').forEach((x) => x.classList.toggle('on', Number(x.dataset.page) === page));
  PAGES[page][1].forEach((d, i) => {
    knobs[i].set(Math.max(0, Math.min(1, d.get())), false);
    q(`pk-kn${i}`).textContent = d.name;
    q(`pk-kv${i}`).textContent = d.fmt();
    q(`pk-k${i}`).classList.toggle('off', d === NONE || d.name === '—');
  });
}

// ---------------- エフェクト（FX タブ）・サーキットベンド（BEND タブ） ----------------
function sendFx(slot: number): void {
  host.post({ type: 'fx', slot, fx: meta.fx[slot] });
  markMeta();
  if (tab === 'fx') showFx();
  showFxTags();
}
function showFx(): void {
  const f = meta.fx[meta.fxSel];
  q('pk-fxslot').querySelectorAll<HTMLElement>('button').forEach((b) => {
    const i = Number(b.dataset.i);
    b.classList.toggle('on', i === meta.fxSel);
    b.classList.toggle('fxon', meta.fx[i].on);
  });
  q('pk-fxon').classList.toggle('lit', f.on);
  q('pk-fxname').textContent = FX_LIST[f.type].name;
  q('pk-fxno').textContent = `${f.type + 1}/${FX_LIST.length}`;
  q('pk-bus').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === (params[cur].bus ?? 0)));
}
function showFxTags(): void {
  const on = meta.fx.map((f, i) => (f.on ? `${['B1', 'B2', 'M'][i]}:${FX_LIST[f.type].name.split(/[ +/]/)[0]}` : '')).filter(Boolean);
  q('pk-bpmlcd').textContent = `♩${meta.bpm.toFixed(1)}${on.length ? ` ${on.join(' ')}` : ''}`;
}
q('pk-fxslot').querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => { meta.fxSel = Number(b.dataset.i); markMeta(); showFx(); showKnobs(); }));
q('pk-fxon').addEventListener('click', () => { const f = meta.fx[meta.fxSel]; f.on = !f.on; sendFx(meta.fxSel); });
const stepFx = (d: number) => {
  const f = meta.fx[meta.fxSel];
  f.type = (f.type + d + FX_LIST.length) % FX_LIST.length;
  f.k = [...FX_LIST[f.type].def];
  sendFx(meta.fxSel);
  showKnobs();
};
q('pk-fxprev').addEventListener('click', () => stepFx(-1));
q('pk-fxnext').addEventListener('click', () => stepFx(1));
q('pk-bus').querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => { setParam(cur, 'bus', Number(b.dataset.i)); showFx(); }));

function sendBend(): void {
  host.post({ type: 'bend', bend: meta.bend });
  markMeta();
  showBend();
}
function showBend(): void {
  q('pk-wires').querySelectorAll<HTMLElement>('.pk-wire').forEach((w) => w.classList.toggle('on', meta.bend.wires[Number(w.dataset.i)]));
  dev.classList.toggle('bent', meta.bend.wires.some(Boolean));
}
q('pk-wires').querySelectorAll<HTMLElement>('.pk-wire').forEach((w) => w.addEventListener('click', () => {
  const i = Number(w.dataset.i);
  meta.bend.wires[i] = !meta.bend.wires[i];
  sendBend();
  q('pk-bendnote').textContent = `${WIRES[i].name}：${WIRES[i].desc}`;
}));
q('pk-unplug').addEventListener('click', () => { meta.bend.wires = meta.bend.wires.map(() => false); sendBend(); });

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
let metaDirty = false;
function markDirty(pad: number): void {
  dirty.add(pad);
  scheduleSave();
}
function markMeta(): void {
  metaDirty = true;
  scheduleSave();
}
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const items: StoredPad[] = [...dirty].map((p) => ({ pad: p, name: names[p], params: params[p], sample: samples[p] }));
    dirty.clear();
    if (items.length) void savePads(items);
    if (metaDirty) { metaDirty = false; void saveMeta(meta); }
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

const LV_NAMES = ['PITCH', 'VEL', 'CUTOFF', 'ATTACK', 'START'];
/** 16 レベル：パッド i の変化 */
function levelOf(i: number): { vel?: number; mod: TrigMod; label: string } {
  switch (meta.lvParam) {
    case 0: return { mod: { pitch: i - 8 }, label: `${i - 8 > 0 ? '+' : ''}${i - 8}` };
    case 1: return { vel: (i + 1) / 16, mod: {}, label: `${Math.round(((i + 1) / 16) * 100)}%` };
    case 2: return { mod: { cutoff: 0.25 + (0.75 * i) / 15 }, label: `F${i + 1}` };
    case 3: return { mod: { attack: (i / 15) * 0.8 }, label: `A${i + 1}` };
    default: return { mod: { start: i / 16 }, label: `S${i + 1}` };
  }
}

/** パッドの見た目の位置 → ステップ番号（左上が 1、右下が 16） */
const stepOfPad = (i: number) => (3 - Math.floor(i / 4)) * 4 + (i % 4);
function renderPads(): void {
  dev.classList.toggle('pmode-psel', padMode === 'psel');
  dev.classList.toggle('pmode-step', padMode === 'step');
  dev.classList.toggle('pmode-erase', padMode === 'erase');
  for (let i = 0; i < PADS; i++) {
    const pad = bank * PADS + i;
    const el = padEls[i];
    el.classList.remove('stepon', 'ptnhas');
    if (padMode === 'psel') {
      el.classList.remove('empty');
      el.classList.toggle('sel', i === meta.ptn);
      el.classList.toggle('ptnhas', meta.patterns[i].events.length > 0);
      (el.querySelector('.nm') as HTMLElement).textContent = `P${String(i + 1).padStart(2, '0')}${meta.patterns[i].events.length ? ` (${meta.patterns[i].events.length})` : ''}`;
      continue;
    }
    if (padMode === 'step') {
      const st = stepOfPad(i), t = stepBar * 4 + st * 0.25;
      const on = curPattern().events.some((e) => e.pad === stepPad && Math.abs(e.t - t) < 0.01);
      el.classList.remove('empty');
      el.classList.toggle('sel', false);
      el.classList.toggle('stepon', on);
      (el.querySelector('.nm') as HTMLElement).textContent = `${st + 1}`;
      continue;
    }
    if (lvSrc >= 0) {
      el.classList.remove('empty');
      el.classList.toggle('sel', false);
      (el.querySelector('.nm') as HTMLElement).textContent = levelOf(i).label;
      continue;
    }
    el.classList.toggle('empty', !samples[pad]);
    el.classList.toggle('sel', pad === cur);
    (el.querySelector('.nm') as HTMLElement).textContent = names[pad] || (samples[pad] ? '—' : '');
  }
  dev.classList.toggle('levels', lvSrc >= 0);
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
  editor?.refresh();
  if (tab === 'fx') showFx();
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
  pk = computePeaks(s, wave.width, 0, 1);
  peaks.set(pad, pk);
  return pk;
}
/** a〜b（0〜1）の範囲を W 本の山に */
function computePeaks(s: SampleBuf, W: number, a: number, b: number): Float32Array {
  const d = s.ch[0], n = d.length;
  const pk = new Float32Array(W * 2);
  for (let x = 0; x < W; x++) {
    const i0 = Math.floor((a + ((b - a) * x) / W) * n), i1 = Math.max(i0 + 1, Math.floor((a + ((b - a) * (x + 1)) / W) * n));
    let lo = 0, hi = 0;
    for (let i = i0; i < Math.min(n, i1); i += Math.max(1, Math.floor((i1 - i0) / 64))) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
    pk[x * 2] = lo; pk[x * 2 + 1] = hi;
  }
  return pk;
}
function drawWave(): void {
  if (tab === 'ptn' || tab === 'song') { drawPattern(); return; }
  const W = wave.width, H = wave.height, c = wctx;
  c.fillStyle = '#a9c98a';
  c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(40,60,20,.08)';
  for (let x = 0; x < W; x += 4) c.fillRect(x, 0, 1, H);
  const src = lvSrc >= 0 ? lvSrc : cur;
  const pk = peaksOf(src);
  if (!pk) {
    c.fillStyle = '#2b3a1c';
    c.font = '700 18px "Share Tech Mono", monospace';
    c.textAlign = 'center';
    c.fillText(mode === 'recPick' || mode === 'resPick' ? 'パッドを えらんでね' : 'からっぽ：REC か FILE で音を入れる', W / 2, H / 2 + 6);
    return;
  }
  const p = params[src];
  c.fillStyle = '#20301a';
  for (let x = 0; x < W; x++) {
    const lo = pk[x * 2], hi = pk[x * 2 + 1];
    const y0 = H / 2 - hi * (H / 2 - 4), y1 = H / 2 - lo * (H / 2 - 4);
    c.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  c.fillStyle = 'rgba(30,45,15,.45)';
  const xs = Math.min(p.start, p.end) * W, xe = Math.max(p.start, p.end) * W;
  c.fillRect(0, 0, xs, H);
  c.fillRect(xe, 0, W - xe, H);
  c.fillStyle = '#c0281c';
  c.fillRect(xs, 0, 2, H);
  c.fillRect(xe - 2, 0, 2, H);
  if (p.loop && p.loopStart > p.start) { c.fillStyle = '#1a5fb4'; c.fillRect(p.loopStart * W, 0, 2, H); }
  c.fillStyle = '#fff6b0';
  for (const [pad, pos] of playPos) if (pad === src) c.fillRect(pos * W, 0, 2, H);
}

// ---------------- メッセージ・状態 ----------------
type Mode = 'play' | 'recPick' | 'recording' | 'resPick' | 'resampling' | 'copy' | 'del';
let mode: Mode = 'play';
let recPad = -1;
let auto = false;
let monitor = false;
let fixedVel = false;
let lvSrc = -1; // 16 レベルの元のパッド（-1 = オフ）
let lastPad = 0; // サブパッド用
const HINT = 'パッドを押すと鳴って、えらべる';
let msgTimer = 0;
function msg(text: string, ms = 0): void {
  q('pk-msg').textContent = text;
  clearTimeout(msgTimer);
  if (ms) msgTimer = window.setTimeout(() => showModeMsg(), ms);
}
function showModeMsg(): void {
  const t: Record<Mode, string> = {
    play: lvSrc >= 0 ? `16 LEVELS：${padLabel(lvSrc)} を ${LV_NAMES[meta.lvParam]} で 16 段に` : HINT,
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
    q('pk-heat').style.width = `${Math.min(100, m.heat * 100)}%`;
    dev.classList.toggle('hot', m.heat > 0.8);
    if (m.rec >= 0 && (mode === 'recording' || mode === 'resampling')) {
      msg(m.waiting ? '● 音が来るのを待っています…（REC で止める）' : `● ${mode === 'recording' ? '録音' : 'リサンプル'}中 ${m.rec.toFixed(1)} 秒 → ${mode === 'recording' ? 'REC' : 'RESAMPLE'} で止める`);
    }
  } else if (m.type === 'play') {
    playPos = m.pads;
    const on = new Set(m.pads.map((p) => p[0]));
    for (let i = 0; i < PADS; i++) {
      const pad = lvSrc >= 0 ? lvSrc : bank * PADS + i;
      padEls[i].classList.toggle('playing', lvSrc < 0 && on.has(pad));
      const pos = lvSrc < 0 ? m.pads.find((p) => p[0] === pad) : undefined;
      (padEls[i].querySelector('.ph') as HTMLElement).style.width = pos ? `${pos[1] * 100}%` : '0';
    }
    drawWave();
    editor?.drawPlay(playPos);
  } else if (m.type === 'seq') {
    seqState = m;
    if (m.ptn !== meta.ptn && m.playing) { meta.ptn = m.ptn; showSeq(); }
    q('pk-pplay').classList.toggle('lit', m.playing && m.mode === 'pattern');
    q('pk-splay').classList.toggle('lit', m.playing && m.mode === 'song');
    q('pk-prec').classList.toggle('lit', m.recording);
    q('pk-recled').classList.toggle('on', m.recording || mode === 'recording' || mode === 'resampling');
    if (tab === 'ptn' || tab === 'song') drawPattern();
    if (tab === 'song') showChainPos();
  } else if (m.type === 'seqAdd') {
    const p = meta.patterns[m.ptn];
    p.events.push(m.ev);
    p.events.sort((a, b) => a.t - b.t);
    markMeta();
    if (padMode === 'psel') renderPads();
  } else if (m.type === 'recorded') {
    const pad = recPad;
    recPad = -1;
    setMode('play');
    if (!m.data || m.data.ch[0].length < m.data.sr * 0.02) { msg('音が録れませんでした', 2500); return; }
    const data = trimSilence(m.data);
    setPad(pad, pendingName, data, { ...params[pad], start: 0, end: 1, loopStart: 0, bpm: 0 });
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
const held = new Map<number, number>(); // pointerId → パッド（0〜15）
/** 実際に鳴らす（16 レベル中は元のパッドを変化させて） */
function play(i: number, vel: number): number {
  if (padMode !== 'normal' && padMode !== 'erase') return -1;
  if (lvSrc >= 0) {
    const lv = levelOf(i);
    host.post({ type: 'trig', pad: lvSrc, vel: lv.vel ?? (fixedVel ? 1 : vel), mod: lv.mod });
    return lvSrc;
  }
  const pad = bank * PADS + i;
  host.post({ type: 'trig', pad, vel: fixedVel ? 1 : vel });
  lastPad = pad;
  return pad;
}
function padDown(i: number, vel: number): void {
  const pad = bank * PADS + i;
  if (padMode === 'psel') { selectPattern(i); setPadMode('normal'); return; }
  if (padMode === 'step') { toggleStep(i); return; }
  if (padMode === 'erase') { erasePad(pad); return; }
  if (lvSrc < 0) switch (mode) {
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
  const played = play(i, vel);
  padEls[i].classList.add('hit');
  setTimeout(() => padEls[i].classList.remove('hit'), 90);
  if (lvSrc < 0 && played >= 0 && played !== cur) select(played);
}
function padUp(i: number): void {
  if (padMode === 'psel' || padMode === 'step' || padMode === 'erase') return;
  host.post({ type: 'release', pad: lvSrc >= 0 ? lvSrc : bank * PADS + i });
}
const whenReady = (f: () => void) => { if (host.running) f(); else void host.start().then(f); };

padEls.forEach((el, i) => {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    held.set(e.pointerId, i);
    // 強さ：ペンや感圧画面は筆圧、それ以外はパッドの押した高さ（上ほど強い）
    const r = el.getBoundingClientRect();
    const byPos = 1 - 0.75 * Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const vel = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : byPos;
    whenReady(() => padDown(i, vel));
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

// ---------------- ボタン（PAD タブ） ----------------
const click = (id: string, f: () => void) => q(id).addEventListener('click', () => { void host.start(); f(); });
click('pk-rec', async () => {
  if (mode === 'recording') { host.post({ type: 'rec', on: false }); return; }
  if (mode === 'recPick') { setMode('play'); return; }
  if (mode === 'resampling') return;
  msg('マイクを準備しています…');
  if (!(await host.enableMic())) { msg('マイクが使えません（ブラウザの許可を確かめてね）', 4000); return; }
  setLevels(false);
  setMode('recPick');
});
click('pk-res', () => {
  if (mode === 'resampling') { host.post({ type: 'rec', on: false }); return; }
  if (mode === 'resPick') { setMode('play'); return; }
  if (mode === 'recording') return;
  setLevels(false);
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
    setPad(pad, name, data, { ...params[pad], start: 0, end: 1, loopStart: 0, bpm: 0 });
    select(pad);
    msg(`${padLabel(pad)} に「${name}」を入れました`, 2500);
  } catch {
    msg('この音のファイルは読めませんでした', 3000);
  }
}

// ---------------- PLAY タブ：ロール・サブパッド・16 レベル・テンポ ----------------
let rollOn = false;
function sendRoll(): void {
  host.post({ type: 'roll', on: rollOn, rate: ROLL_RATES[meta.rollRate] });
  q('pk-roll').classList.toggle('lit', rollOn);
  q('pk-rates').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === meta.rollRate));
}
click('pk-roll', () => { rollOn = !rollOn; sendRoll(); msg(rollOn ? `ROLL ${ROLL_NAMES[meta.rollRate]}：押している間くり返す` : HINT, 2500); });
q('pk-rates').querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => { meta.rollRate = Number(b.dataset.i); sendRoll(); markMeta(); }));
// サブパッド：押している間、最後のパッドを鳴らす（ロール中はくり返す）
const sub = q('pk-sub');
sub.style.touchAction = 'none';
sub.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sub.setPointerCapture(e.pointerId);
  sub.classList.add('down');
  whenReady(() => host.post({ type: 'trig', pad: lastPad, vel: 1 }));
});
const subUp = () => { sub.classList.remove('down'); host.post({ type: 'release', pad: lastPad }); };
sub.addEventListener('pointerup', subUp);
sub.addEventListener('pointercancel', subUp);
function setLevels(on: boolean): void {
  lvSrc = on ? cur : -1;
  q('pk-16lv').classList.toggle('lit', on);
  q('pk-lvp').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === meta.lvParam));
  renderPads();
  drawWave();
  showModeMsg();
}
click('pk-16lv', () => {
  if (lvSrc < 0 && !samples[cur]) { msg('16 LEVELS：音の入ったパッドを選んでから', 2500); return; }
  setLevels(lvSrc < 0);
});
q('pk-lvp').querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => {
  meta.lvParam = Number(b.dataset.i);
  markMeta();
  setLevels(lvSrc >= 0);
}));
function setBpm(v: number): void {
  meta.bpm = Math.round(Math.max(40, Math.min(240, v)) * 10) / 10;
  q('pk-bpm').textContent = meta.bpm.toFixed(1);
  showFxTags();
  host.post({ type: 'bpm', bpm: meta.bpm });
  markMeta();
}
click('pk-bpm-', () => setBpm(meta.bpm - 1));
click('pk-bpm+', () => setBpm(meta.bpm + 1));
let taps: number[] = [];
click('pk-tap', () => {
  const t = performance.now();
  taps = taps.filter((x) => t - x < 2500).concat(t);
  if (taps.length >= 2) {
    const d = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(60000 / d);
  }
});

// ---------------- EDIT タブ：波形・チョップ・テンポ合わせ（editor.ts） ----------------
let editor: EditorApi | null = null;
const editHost = {
  root: q('pk-modal'),
  cur: () => cur,
  bpm: () => meta.bpm,
  sample: (p: number) => samples[p],
  params: (p: number) => params[p],
  name: (p: number) => names[p],
  setParam,
  setPad,
  trig: (p: number) => whenReady(() => host.post({ type: 'trig', pad: p, vel: 1 })),
  release: (p: number) => host.post({ type: 'release', pad: p }),
  msg,
  emptyBank: () => { for (let b = 0; b < BANKS; b++) if (!samples.slice(b * PADS, b * PADS + PADS).some(Boolean)) return b; return -1; },
  goBank: (b: number) => setBank(b),
  onClose: () => { editor = null; },
  pushUndo: (pad: number) => { undo = { pad, data: samples[pad], p: params[pad] }; },
};
const openEd = (section: 'wave' | 'chop' | 'fit') => {
  if (!samples[cur]) { msg('音の入ったパッドを選んでね', 2500); return; }
  editor?.close();
  editor = openEditor(editHost, section);
};
click('pk-ed-wave', () => openEd('wave'));
click('pk-ed-chop', () => openEd('chop'));
click('pk-ed-fit', () => openEd('fit'));
let undo: { pad: number; data: SampleBuf | null; p: PadParams } | null = null;
function destructive(label: string, f: (s: SampleBuf, p: PadParams) => [SampleBuf, Partial<PadParams>]): void {
  const s = samples[cur];
  if (!s) { msg('からっぽのパッドです', 2000); return; }
  undo = { pad: cur, data: s, p: params[cur] };
  const [ns, np] = f(s, params[cur]);
  setPad(cur, names[cur], ns, { ...params[cur], ...np });
  msg(`${label}しました（UNDO で戻せる）`, 2500);
}
click('pk-ed-norm', () => destructive('ノーマライズ', (s) => [edNormalize(s), {}]));
click('pk-ed-rev', () => destructive('逆にして保存', (s) => [edReverse(s), {}]));
click('pk-ed-trim', () => destructive('START〜END だけ残', (s, p) => [edTrim(s, p.start, p.end), { start: 0, end: 1, loopStart: 0 }]));
click('pk-ed-undo', () => {
  if (!undo) { msg('戻せるものがありません', 2000); return; }
  const u = undo;
  undo = null;
  setPad(u.pad, names[u.pad], u.data, u.p);
  select(u.pad);
  msg('ひとつ戻しました', 2000);
});

click('pk-ed-wav', () => {
  const smp = samples[cur];
  if (!smp) { msg('からっぽのパッドです', 2000); return; }
  download(sampleWav(smp), `paku16-${padLabel(cur)}-${(names[cur] || 'pad').replace(/[^\w-]+/g, '_')}.wav`, 'audio/wav');
});

// ---------------- PATTERN タブ：パターンの録音・ステップ入力 ----------------
type PadMode = 'normal' | 'psel' | 'step' | 'erase';
let padMode: PadMode = 'normal';
let stepBar = 0;
let stepPad = 0;
let seqState: { playing: boolean; recording: boolean; pos: number; ptn: number; step: number; mode: 'pattern' | 'song' } = { playing: false, recording: false, pos: 0, ptn: 0, step: 0, mode: 'pattern' };
let pundo: { i: number; p: Pattern } | null = null;
const curPattern = () => meta.patterns[meta.ptn];
const ptnName = (i: number) => `P${String(i + 1).padStart(2, '0')}`;
function setPadMode(m: PadMode): void {
  padMode = m;
  if (m === 'step') { stepPad = cur; stepBar = Math.min(stepBar, curPattern().bars - 1); }
  if (m !== 'normal' && lvSrc >= 0) setLevels(false);
  q('pk-psel').classList.toggle('lit', m === 'psel');
  q('pk-step').classList.toggle('lit', m === 'step');
  q('pk-erase').classList.toggle('lit', m === 'erase');
  renderPads();
  showSeq();
  msg(m === 'psel' ? 'パターンをパッドで選ぶ（P01〜P16）' : m === 'step' ? `STEP：${padLabel(stepPad)} ${names[stepPad]} を 16 分で置く（パッド = ステップ、左上が 1）` : m === 'erase' ? 'ERASE：消したい音のパッドを押す（そのパッドの音が全部消える）' : HINT);
}
function sendPattern(i: number): void {
  host.post({ type: 'pattern', i, p: meta.patterns[i] });
  markMeta();
  if (tab === 'ptn' || tab === 'song') drawPattern();
}
function sendSeqSet(): void {
  host.post({ type: 'seqSet', quant: QUANTS[meta.quant], swing: meta.swing, metro: meta.metro });
  markMeta();
  showSeq();
}
function editPattern(f: (p: Pattern) => void): void {
  pundo = { i: meta.ptn, p: { bars: curPattern().bars, events: curPattern().events.map((e) => ({ ...e })) } };
  f(curPattern());
  sendPattern(meta.ptn);
  renderPads();
}
function setBars(b: number): void {
  b = Math.max(1, Math.min(8, b));
  if (b === curPattern().bars) return;
  editPattern((p) => { p.bars = b; });
  stepBar = Math.min(stepBar, b - 1);
  showSeq();
  showKnobs();
}
function selectPattern(i: number): void {
  meta.ptn = i;
  host.post({ type: 'selPtn', i });
  markMeta();
  stepBar = 0;
  showSeq();
  msg(`${ptnName(i)}${seqState.playing ? '（いまのパターンの終わりで替わる）' : ''}`, 2000);
}
function toggleStep(i: number): void {
  const t = stepBar * 4 + stepOfPad(i) * 0.25;
  editPattern((p) => {
    const k = p.events.findIndex((e) => e.pad === stepPad && Math.abs(e.t - t) < 0.01);
    if (k >= 0) p.events.splice(k, 1);
    else { p.events.push({ t, pad: stepPad, vel: fixedVel ? 1 : 0.85, len: 0.25 }); p.events.sort((a, b) => a.t - b.t); }
  });
  if (!curPattern().events.some((e) => e.pad === stepPad && Math.abs(e.t - t) < 0.01)) return;
  whenReady(() => { host.post({ type: 'trig', pad: stepPad, vel: 0.85 }); setTimeout(() => host.post({ type: 'release', pad: stepPad }), 120); });
}
function erasePad(pad: number): void {
  const n = curPattern().events.filter((e) => e.pad === pad).length;
  if (!n) { msg(`${padLabel(pad)} の音はこのパターンにありません`, 2000); return; }
  editPattern((p) => { p.events = p.events.filter((e) => e.pad !== pad); });
  msg(`${padLabel(pad)} の音を ${n} 個消しました`, 2000);
}
function showSeq(): void {
  q('pk-ptn').textContent = ptnName(meta.ptn);
  q('pk-bars').textContent = String(curPattern().bars);
  q('pk-sbar').textContent = `${stepBar + 1}/${curPattern().bars}`;
  q('pk-metro').classList.toggle('lit', meta.metro);
  q('pk-quant').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === meta.quant));
  q('pk-sadd').textContent = `＋ ${ptnName(meta.ptn)}`;
  renderChain();
  if (tab === 'ptn' || tab === 'song') drawPattern();
}
/** 液晶：パターンの中身（行 = パッド、横 = 時間） */
function drawPattern(): void {
  const W = wave.width, H = wave.height, c = wctx;
  c.fillStyle = '#a9c98a';
  c.fillRect(0, 0, W, H);
  const p = meta.patterns[seqState.playing ? seqState.ptn : meta.ptn];
  const L = p.bars * 4;
  const rows = [...new Set(p.events.map((e) => e.pad))].sort((a, b) => a - b);
  const X = (t: number) => (t / L) * W;
  for (let b = 0; b <= L * 4; b++) {
    c.fillStyle = b % 16 === 0 ? 'rgba(32,48,26,.6)' : b % 4 === 0 ? 'rgba(32,48,26,.3)' : 'rgba(32,48,26,.08)';
    c.fillRect(X(b / 4), 0, 1, H);
  }
  if (padMode === 'step') { c.fillStyle = 'rgba(255,246,176,.5)'; c.fillRect(X(stepBar * 4), 0, X(4), H); }
  const rh = Math.min(16, (H - 4) / Math.max(1, rows.length));
  c.font = '700 10px "Share Tech Mono", monospace';
  rows.forEach((pad, r) => {
    const y = 2 + r * rh;
    c.fillStyle = 'rgba(32,48,26,.12)';
    c.fillRect(0, y, W, rh - 1);
    c.fillStyle = '#20301a';
    for (const e of p.events) if (e.pad === pad) c.fillRect(X(e.t), y + 1, Math.max(3, X(Math.min(e.len, L - e.t))), rh - 3);
    c.fillStyle = '#5a6a3a';
    c.fillText(padLabel(pad), W - 34, y + rh - 4);
  });
  if (!rows.length) {
    c.fillStyle = '#2b3a1c';
    c.font = '700 16px "Share Tech Mono", monospace';
    c.textAlign = 'center';
    c.fillText(`${ptnName(meta.ptn)}：からっぽ（● REC か STEP で入れる）`, W / 2, H / 2 + 6);
    c.textAlign = 'left';
  }
  if (seqState.playing) { c.fillStyle = '#c0281c'; c.fillRect(X(seqState.pos), 0, 2, H); }
}
click('pk-pplay', () => {
  if (seqState.playing) host.post({ type: 'transport', play: false });
  else host.post({ type: 'transport', play: true, mode: 'pattern', ptn: meta.ptn });
});
click('pk-prec', () => {
  if (!seqState.playing) {
    pundo = { i: meta.ptn, p: { bars: curPattern().bars, events: curPattern().events.map((e) => ({ ...e })) } };
    host.post({ type: 'transport', play: true, mode: 'pattern', ptn: meta.ptn, rec: true });
    msg('● 録音中：パッドを叩くと重なっていく（● REC でやめる・■ で止める）', 3000);
  } else {
    if (!seqState.recording) pundo = { i: meta.ptn, p: { bars: curPattern().bars, events: curPattern().events.map((e) => ({ ...e })) } };
    host.post({ type: 'seqRec', on: !seqState.recording });
  }
});
click('pk-metro', () => { meta.metro = !meta.metro; sendSeqSet(); });
click('pk-erase', () => setPadMode(padMode === 'erase' ? 'normal' : 'erase'));
click('pk-pundo', () => {
  if (!pundo) { msg('戻せるものがありません', 2000); return; }
  meta.patterns[pundo.i] = pundo.p;
  sendPattern(pundo.i);
  pundo = null;
  renderPads();
  showSeq();
  msg('パターンを 1 つ戻しました', 2000);
});
click('pk-psel', () => setPadMode(padMode === 'psel' ? 'normal' : 'psel'));
click('pk-bars-', () => setBars(curPattern().bars - 1));
click('pk-bars+', () => setBars(curPattern().bars + 1));
click('pk-pclear', () => { if (curPattern().events.length && confirm(`${ptnName(meta.ptn)} の音を全部消しますか？（↶ で戻せる）`)) editPattern((p) => { p.events = []; }); });
click('pk-step', () => setPadMode(padMode === 'step' ? 'normal' : 'step'));
click('pk-sbar-', () => { stepBar = (stepBar - 1 + curPattern().bars) % curPattern().bars; renderPads(); showSeq(); });
click('pk-sbar+', () => { stepBar = (stepBar + 1) % curPattern().bars; renderPads(); showSeq(); });
q('pk-quant').querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => { meta.quant = Number(b.dataset.i); sendSeqSet(); }));

// ---------------- SONG タブ：パターンをつなぐ・書き出し ----------------
let songSel = -1;
function sendSong(): void {
  host.post({ type: 'song', steps: meta.song });
  markMeta();
  renderChain();
}
function renderChain(): void {
  const el = q('pk-chain');
  el.innerHTML = meta.song.length
    ? meta.song.map((x, i) => `<button data-i="${i}" class="${i === songSel ? 'on' : ''}">${ptnName(x.ptn)}<small>×${x.reps}</small></button>`).join('<i>→</i>')
    : '<span>（パターンを ＋ でつないで 1 曲に）</span>';
  el.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => { songSel = Number(b.dataset.i); renderChain(); }));
  showChainPos();
}
function showChainPos(): void {
  q('pk-chain').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('now', seqState.playing && seqState.mode === 'song' && Number(b.dataset.i) === seqState.step));
}
click('pk-sadd', () => {
  const at = songSel >= 0 ? songSel + 1 : meta.song.length;
  meta.song.splice(at, 0, { ptn: meta.ptn, reps: 1 });
  songSel = at;
  sendSong();
});
click('pk-sdel', () => { if (songSel < 0 || songSel >= meta.song.length) return; meta.song.splice(songSel, 1); songSel = Math.min(songSel, meta.song.length - 1); sendSong(); });
click('pk-srep-', () => { const x = meta.song[songSel]; if (x) { x.reps = Math.max(1, x.reps - 1); sendSong(); } });
click('pk-srep+', () => { const x = meta.song[songSel]; if (x) { x.reps = Math.min(16, x.reps + 1); sendSong(); } });
click('pk-splay', () => {
  if (seqState.playing) { host.post({ type: 'transport', play: false }); return; }
  if (!meta.song.length) { msg('先にパターンを ＋ でつないでね', 2500); return; }
  host.post({ type: 'transport', play: true, mode: 'song' });
});

function download(bytes: Uint8Array, name: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
const setup = (): RenderSetup => ({ samples, params, fx: meta.fx, bend: meta.bend, bpm: meta.bpm, swing: meta.swing, patterns: meta.patterns, song: meta.song });
let exporting = false;
function exportWav(m: 'pattern' | 'song'): void {
  if (exporting) return;
  if (m === 'song' && !meta.song.length) { msg('ソングがからっぽです', 2500); return; }
  if (m === 'pattern' && !curPattern().events.length) { msg('パターンがからっぽです', 2500); return; }
  exporting = true;
  const g = renderOffline(setup(), m, meta.ptn, 44100, m === 'pattern' ? 2 : 1);
  const tick = () => {
    const t0 = performance.now();
    let r = g.next();
    while (!r.done && performance.now() - t0 < 30) r = g.next();
    if (!r.done) { msg(`書き出し中… ${Math.round(r.value * 100)}%`); setTimeout(tick, 0); return; }
    const [L, R] = r.value;
    download(wavBytes(L, R, 44100), m === 'pattern' ? `paku16-${ptnName(meta.ptn)}.wav` : 'paku16-song.wav', 'audio/wav');
    exporting = false;
    msg(`WAV を書き出しました（${(L.length / 44100).toFixed(1)} 秒${m === 'pattern' ? '・2 回くり返し' : ''}）`, 3000);
  };
  tick();
}
click('pk-xwp', () => exportWav('pattern'));
click('pk-xws', () => exportWav('song'));
click('pk-xmid', () => {
  const m = meta.song.length ? 'song' : 'pattern';
  download(midiBytes(setup(), m, meta.ptn), m === 'song' ? 'paku16-song.mid' : `paku16-${ptnName(meta.ptn)}.mid`, 'audio/midi');
  msg(`MIDI を書き出しました（${m === 'song' ? 'ソング' : ptnName(meta.ptn)}。バンク A〜P = チャンネル 1〜10、パッド 1〜16 = ノート 36〜51）`, 4000);
});
click('pk-xsave', () => {
  const pads = Array.from({ length: PAD_COUNT }, (_, i) => ({ pad: i, name: names[i], params: params[i], sample: samples[i] }));
  const bytes = packProject(meta, pads);
  download(bytes, 'paku16-project.paku', 'application/octet-stream');
  msg(`プロジェクトを保存しました（${(bytes.length / 1048576).toFixed(1)}MB）`, 3000);
});
const projIn = document.createElement('input');
projIn.type = 'file';
projIn.accept = '.paku';
projIn.hidden = true;
document.body.appendChild(projIn);
click('pk-xload', () => projIn.click());
projIn.addEventListener('change', async () => {
  const f = projIn.files?.[0];
  projIn.value = '';
  if (!f) return;
  try {
    const { meta: m, pads } = unpackProject<Meta>(new Uint8Array(await f.arrayBuffer()));
    if (!confirm('いまの音・パターン・ソングは全部、このファイルの中身に置き換わります。よろしいですか？')) return;
    host.post({ type: 'transport', play: false });
    const got = new Map(pads.map((p) => [p.pad, p]));
    for (let i = 0; i < PAD_COUNT; i++) {
      const p = got.get(i);
      setPad(i, p?.name ?? '', p?.sample ?? null, { ...defaultPad(), ...(p?.params ?? {}) });
    }
    Object.assign(meta, newMeta(), m);
    applyMeta();
    setBank(0);
    msg(`「${f.name}」を読み込みました`, 3000);
  } catch (e) {
    msg(e instanceof Error ? e.message : 'このファイルは読めませんでした', 3500);
  }
});

// ---------------- → STUDIO：ソングをスタジオ（DAW）のシーケンサーへ ----------------
/** スタジオでサンプラーだけを並べたときの曲の置き場所（スタジオの決まりと同じ名前） */
const STUDIO_KEY = 'bentpc.studio.song.v1.6';
click('pk-xstudio', () => {
  const steps = meta.song.length ? meta.song : [{ ptn: meta.ptn, reps: 1 }];
  const notes: Song['tracks'][number]['notes'] = [];
  const sections: { name: string; start: number }[] = [];
  let base = 0;
  for (const st of steps) {
    const p = meta.patterns[st.ptn];
    sections.push({ name: ptnName(st.ptn), start: base });
    for (let r = 0; r < Math.max(1, st.reps); r++) {
      for (const e of p.events) notes.push({ key: e.pad, start: base + swingT(e.t, meta.swing), len: Math.max(0.05, e.len), take: 0 });
      base += p.bars * 4;
    }
  }
  if (!notes.length) { msg('パターンがからっぽです', 2500); return; }
  if (!confirm('スタジオ（PAKU-PAKU 16 だけを並べた画面）の曲を、このソングで置き換えて開きます。よろしいですか？')) return;
  const bars = Math.ceil(base / 4);
  const song: Song = {
    version: 1, title: `PAKU-PAKU ${meta.song.length ? 'SONG' : ptnName(meta.ptn)}`, bpm: meta.bpm, bars, metronome: false, seed: 1616, ramp: true,
    loop: { on: false, start: 0, end: bars * 4 }, sections,
    tracks: [{ toy: 0, name: 'PAKU-PAKU 16', mute: false, notes: notes.sort((a, b) => a.start - b.start), autos: [], rec: true }],
  };
  try {
    localStorage.setItem(STUDIO_KEY, JSON.stringify(song));
  } catch {
    msg('保存できませんでした', 3000);
    return;
  }
  location.href = 'studio.html?toys=6';
});

/** パッド以外の設定（テンポ・エフェクト・ベンド・パターン）をエンジンと画面に反映 */
function applyMeta(): void {
  if (!Array.isArray(meta.fx) || meta.fx.length !== 3) meta.fx = defaultSlots();
  meta.bend = { ...defaultBend(), ...meta.bend };
  if (!Array.isArray(meta.patterns) || meta.patterns.length !== PATTERNS) meta.patterns = Array.from({ length: PATTERNS }, emptyPattern);
  if (!Array.isArray(meta.song)) meta.song = [];
  setBpm(meta.bpm);
  sendRoll();
  meta.fx.forEach((_, i) => host.post({ type: 'fx', slot: i, fx: meta.fx[i] }));
  host.post({ type: 'bend', bend: meta.bend });
  meta.patterns.forEach((_, i) => host.post({ type: 'pattern', i, p: meta.patterns[i] }));
  host.post({ type: 'song', steps: meta.song });
  host.post({ type: 'selPtn', i: meta.ptn });
  sendSeqSet();
  showBend();
  markMeta();
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
    whenReady(() => padDown(i, 1));
    return;
  }
  if (e.code === 'BracketLeft') setBank(bank - 1);
  else if (e.code === 'BracketRight') setBank(bank + 1);
  else if (e.code === 'Space') { e.preventDefault(); if (seqState.playing) host.post({ type: 'transport', play: false }); else host.post({ type: 'stopAll' }); }
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
        if (cmd === 0x90 && d2 > 0) whenReady(() => padDown(i, d2 / 127));
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
  for (let b = 0; b < FACTORY_BANKS; b++) {
    factoryBank(b).forEach((s, i) => setPad(b * PADS + i, s.name, s.buf, factoryParams(s)));
  }
}
/** 前の版で保存した人：新しく増えた工場出荷の音（バンク C〜G）を、空いているパッドにだけ入れる */
function addNewFactory(): number {
  let n = 0;
  for (let b = 2; b < FACTORY_BANKS; b++) {
    if (!samples.slice(b * PADS, b * PADS + PADS).some((s) => !s)) continue;
    factoryBank(b).forEach((s, i) => { if (!samples[b * PADS + i]) { setPad(b * PADS + i, s.name, s.buf, factoryParams(s)); n++; } });
  }
  return n;
}
$('factoryBtn').addEventListener('click', () => {
  if (!confirm('バンク A〜G を最初の音に戻します（H〜J はそのまま）。よろしいですか？')) return;
  loadFactory();
  setBank(0);
  msg('バンク A〜G を最初の音に戻しました', 2500);
});
$('pk-help').innerHTML = `
  <h3>PAKU-PAKU 16 の使い方</h3>
  <table>
    <tr><td>パッド</td><td>押すと鳴って、そのパッドを選ぶ。上の方を押すほど強い音（FIXED VEL でいつも最大）</td></tr>
    <tr><td>バンク A〜P</td><td>16 パッド × 16 バンク。◀ ▶ か文字のボタン（PC は [ ]）</td></tr>
    <tr><td>ノブ 4 つ</td><td>SOUND・FILTER/ENV・SAMPLE・MIX でページを切り替え。上下ドラッグ、ダブルクリックで初期値</td></tr>
    <tr><td colspan="2"><b>PAD タブ</b></td></tr>
    <tr><td>GATE / LOOP / REV / POLY</td><td>押している間だけ鳴る／くり返す（GATE なしなら、もう一度押して止める。戻り先は SAMPLE の LOOP）／逆再生／押し直しで重ねる</td></tr>
    <tr><td>REC</td><td>REC → 録るパッドを押す → 声や音を入れる → REC で止める。AUTO が点いていると、音が来てから録音が始まる</td></tr>
    <tr><td>RESAMPLE</td><td>RESAMPLE → 録るパッドを押す → ほかのパッドを鳴らす → RESAMPLE で止める（自分の音を録る）</td></tr>
    <tr><td>📂 FILE / COPY / DEL</td><td>音のファイルを入れる（PC はパッドに落としても）／COPY → 貼り付け先／DEL → 消すパッド</td></tr>
    <tr><td colspan="2"><b>PLAY タブ</b></td></tr>
    <tr><td>ROLL</td><td>点けると、押している間 1/4〜1/32（3 連も）でくり返す（TEMPO に合わせて）</td></tr>
    <tr><td>SUB PAD</td><td>最後に鳴らしたパッドをもう一度（ロール中は連打）</td></tr>
    <tr><td>16 LEVELS</td><td>いまのパッドの音を 16 パッドに並べる：PITCH（半音ずつ、9 が元の高さ）・VEL・CUTOFF・ATTACK・START</td></tr>
    <tr><td>TEMPO・TAP</td><td>テンポ（ロール・テンポ合わせ・パターンの速さ）。TAP を何回か押すとその速さに</td></tr>
    <tr><td colspan="2"><b>EDIT タブ</b></td></tr>
    <tr><td>〰 WAVE EDIT</td><td>大きな波形で START・END・LOOP の印をドラッグ。🔍 で拡大</td></tr>
    <tr><td>✂ CHOP</td><td>音を切り分けて、からっぽのバンクのパッドに並べる：等分・音の立ち上がりで自動・手で印を付ける</td></tr>
    <tr><td>⏱ TEMPO FIT</td><td>音の BPM を推定して、TEMPO に合わせる（音程そのまま＝ストレッチ／速さだけ＝ピッチで）</td></tr>
    <tr><td>NORMALIZE ほか</td><td>音量をそろえる・逆向きにして保存・START〜END だけ残す・UNDO で 1 回戻す</td></tr>
    <tr><td colspan="2"><b>FX タブ</b></td></tr>
    <tr><td>BUS 1 / BUS 2 / MASTER</td><td>エフェクトの置き場所。パッドごとに送り先（DRY・BUS 1・BUS 2）を選ぶ。MASTER は全部の音に掛かる。◀ ▶ で 24 種類から選んで FX ON、ノブ 4 つで調整</td></tr>
    <tr><td>24 種類</td><td>${FX_LIST.map((f) => f.name).join('・')}</td></tr>
    <tr><td colspan="2"><b>BEND タブ</b></td></tr>
    <tr><td>ジャンパー線 6 本</td><td>${WIRES.map((w) => `${w.name}＝${w.desc}`).join('／')}。ノブの AMOUNT（強さ）・SPEED（頻度）。熱がたまると暴発する（外せば冷める）</td></tr>
    <tr><td colspan="2"><b>PATTERN タブ</b></td></tr>
    <tr><td>▶ PLAY / ● REC</td><td>いまのパターンをくり返し鳴らす／叩いた音を録音（重ね録り、QUANT でそろえる）。METRO はクリック、↶ で 1 つ戻す</td></tr>
    <tr><td>PATTERN</td><td>押してから、パッドで P01〜P16 を選ぶ（再生中は、いまのパターンの終わりで替わる）。小節は 1〜8、CLEAR で全部消す</td></tr>
    <tr><td>STEP</td><td>選んでいたパッドの音を、16 分のマス（パッド = ステップ、左上が 1）で置く／消す。◀ ▶ で小節</td></tr>
    <tr><td>ERASE</td><td>点けてからパッドを押すと、そのパッドの音がパターンから全部消える</td></tr>
    <tr><td>SWING</td><td>ノブ（SEQ ページ）。16 分の裏を遅らせて跳ねさせる（50〜75%）</td></tr>
    <tr><td colspan="2"><b>SONG タブ</b></td></tr>
    <tr><td>＋ / 削除 / × ± / ▶ SONG</td><td>いまのパターンを、選んだ所の後ろにつなぐ・くり返し回数・ソングを鳴らす</td></tr>
    <tr><td>→ STUDIO</td><td>ソング（無ければいまのパターン）をスタジオのシーケンサーに入れて開く。スタジオではほかのおもちゃといっしょに鳴らせる（強さは各パッドの設定どおり）</td></tr>
    <tr><td>書き出し</td><td>WAV（パターンは 2 回分・ソングは全部）・MIDI（ソングが無ければパターン）・💾 プロジェクト丸ごと（.paku）を保存／📂 読み込み。パッド 1 つの WAV は EDIT タブ</td></tr>
    <tr><td>PC のキー</td><td>Z X C V・A S D F・Q W E R・1 2 3 4 がパッド（下の段から）。スペースで STOP</td></tr>
    <tr><td>MIDI</td><td>上の MIDI を押すと、MIDI 機器のノート 36〜51 でパッド 1〜16</td></tr>
  </table>
  <p>音と設定はこのブラウザに自動で保存されます。</p>`;
$('helpBtn').addEventListener('click', () => { $('pk-help').hidden = !$('pk-help').hidden; });
$('pk-help').addEventListener('click', () => { $('pk-help').hidden = true; });
$('pk-cover').addEventListener('pointerdown', () => {
  void host.start();
  $('pk-cover').remove();
});

// ---------------- 起動：保存してあった音を戻す（無ければ工場出荷） ----------------
(async () => {
  const [stored, savedMeta] = await Promise.all([loadAll(), loadMeta<Partial<Meta>>()]);
  if (savedMeta) Object.assign(meta, { factoryVer: 1 }, savedMeta);
  applyMeta();
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
  let added = 0;
  if ((meta.factoryVer ?? 1) < 2) {
    meta.factoryVer = 2;
    markMeta();
    added = stored && stored.length ? addNewFactory() : 0;
  }
  select(0);
  setMode('play');
  setLevels(false);
  if (added) msg(`ジャンルの楽器 ${added} 音をバンク C〜G に入れました（和・レゲエ・ジャズ・ダンス・ポップ）`, 6000);
})();
setTab('pad');
select(0);

// 言語の切り替え（EN / 日本語）。英語なら画面を置き換える
setupLang(document.getElementById('pk-top'));
