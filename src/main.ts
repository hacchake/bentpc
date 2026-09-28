import './style.css';
import { AudioHost } from './audio';
import { startMidi } from './midi';
import { download, encodeWav } from './wav';
import type { DisplayState } from './dsp/firmware';
import { WORDS } from './dsp/phonemes';
import {
  FIRST_NUMBER_KEY, FUNCTION_KEY_LABELS, LETTER_KEYS, MODE_NAMES, NUMBER_KEY_LABELS, PARAMS, PARAM_INDEX, type ParamId,
} from './params';
import { Knob, SteppedKnob, Toggle, momentary } from './ui/controls';
import { Bitmap, LCD_H, LCD_W, LcdView, drawDisplay } from './ui/lcd';
import { applyFx, misreadOverride, type LcdFx } from './ui/lcdfx';
import { spriteCanvas } from './ui/pixels';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = new AudioHost();
const setParam = (id: ParamId, v: number) => audio.setParam(PARAM_INDEX[id], v);
const def = (id: ParamId) => PARAMS[PARAM_INDEX[id]];
/** パラメーターごとの操作部品（MIDI から動かすため） */
type Ctl = { set(v: number, notify?: boolean): void } | { press(): void; release(): void };
const ctl: Partial<Record<ParamId, Ctl>> = {};

// ---- 画面サイズに合わせて拡大縮小 ----
function fit(): void {
  const s = Math.min(window.innerWidth / 900, (window.innerHeight - 8) / 1300);
  $('stage').style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

// ---- 部品を置くための小さな道具 ----
const base = $('base');
function place(cls: string, x: number, y: number, html = '', parent: HTMLElement = base): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mod';
  wrap.style.left = `${x}px`;
  wrap.style.top = `${y}px`;
  wrap.style.transform = 'translate(-50%, -50%)';
  const el = document.createElement('div');
  el.className = cls;
  el.style.position = 'relative';
  el.innerHTML = html;
  wrap.appendChild(el);
  parent.appendChild(wrap);
  return el;
}
function label(text: string, x: number, y: number): void {
  const el = document.createElement('div');
  el.className = 'mod-label';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.textContent = text;
  base.appendChild(el);
}
function tape(text: string, x: number, y: number, vertical = false, rot = 0): void {
  const el = place(`tape${vertical ? ' v' : ''}`, x, y, text);
  el.style.setProperty('--rot', `${rot}deg`);
}
const knob = (cls: string, x: number, y: number) => place(`knob ${cls}`, x, y, '<div class="cap"></div>');

// ================= 液晶 =================
const lcd = new LcdView($<HTMLCanvasElement>('lcd'));
const bm = new Bitmap();
let display: DisplayState = { screen: 'off', mode: 0 };
let displayAt = performance.now();
const leds: Record<string, HTMLElement> = {};
audio.onMessage = (m) => {
  if (m.type === 'display') {
    display = m.display;
    displayAt = performance.now();
  } else if (m.type === 'status') {
    const st = m.status;
    leds.power?.classList.toggle('lit', st.powered);
    leds.stretch?.classList.toggle('lit', st.leds.stretch > 0);
    leds.loop?.classList.toggle('lit', st.leds.loop > 0);
    leds.glitch?.classList.toggle('lit', st.leds.glitch > 0.05);
    fx = st.fx as unknown as LcdFx;
  } else if (m.type === 'recChunk') {
    recChunks.push(m.data);
  } else if (m.type === 'recDone') {
    finishRecording();
  } else if (m.type === 'userSample') {
    saveUserSample(m.key, m.data);
  }
};
let fx: LcdFx = { combos: 0, heat: 0, seed: 0, misread: -1 };
let frameNo = 0;
const prevFrame = new Uint8Array(LCD_W * LCD_H);
function frame(now: number): void {
  const d = display.screen === 'off' || display.screen === 'boot' ? display : misreadOverride(display, fx);
  drawDisplay(bm, d, now / 1000, (now - displayAt) / 1000);
  if (display.screen !== 'off') applyFx(bm, fx, frameNo++, prevFrame);
  prevFrame.set(bm.px);
  lcd.paint(bm, display.screen !== 'off');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ================= キーボード（A〜Z ＋ ♪?★OK） =================
const keyCtl: { press: () => void; release: () => void }[] = [];
let micArmed = false;
const post = (key: number, down: boolean) => {
  if (micArmed) {
    audio.post({ type: 'mic', key, on: down });
    leds.mic?.classList.toggle('lit', down);
  } else audio.post({ type: 'key', key, down });
};
const keyEls: HTMLElement[] = [];
const panel = $('keysPanel');
for (let row = 0; row < 3; row++) {
  const strip = document.createElement('div');
  strip.className = 'word-strip';
  const keys = document.createElement('div');
  keys.className = 'key-row';
  for (let c = 0; c < 10; c++) {
    const k = row * 10 + c;
    const w = document.createElement('span');
    const el = document.createElement('div');
    el.className = 'key';
    if (k < 26) {
      w.textContent = WORDS[LETTER_KEYS[k]][0].toLowerCase();
      el.appendChild(spriteCanvas(LETTER_KEYS[k]));
      el.insertAdjacentHTML('beforeend', `<b>${LETTER_KEYS[k].toLowerCase()}</b>`);
    } else {
      const f = k - 26;
      w.textContent = ['music', 'talk', 'star', 'ok'][f];
      el.classList.add('fn');
      el.appendChild(spriteCanvas(['NOTE', 'SPEAKER', 'STAR', 'BLIP'][f]));
      el.insertAdjacentHTML('beforeend', `<b>${FUNCTION_KEY_LABELS[f]}</b>`);
    }
    strip.appendChild(w);
    keys.appendChild(el);
    keyEls[k] = el;
    keyCtl[k] = momentary(el, () => post(k, true), () => post(k, false));
  }
  panel.append(strip, keys);
}

// ================= ドレミの数字キー =================
const numRow = $('numberRow');
for (let i = 0; i < 10; i++) {
  const k = FIRST_NUMBER_KEY + i;
  const el = document.createElement('div');
  el.className = 'num-key';
  el.innerHTML = `<small>${NUMBER_KEY_LABELS[i]}</small><b>${i + 1}</b>`;
  numRow.appendChild(el);
  keyEls[k] = el;
  keyCtl[k] = momentary(el, () => post(k, true), () => post(k, false));
}

// ================= MODE（緑のダイヤル＋絵のボタン） =================
const modeIcons = ['A', 'C', 'NOTE', 'SPEAKER', 'DRUM', 'STAR', 'BLIP', 'K'];
const pillColors = ['#ff9fb2', '#ffd36b', '#9fe07a', '#8fd3ff', '#c9a6ff', '#ffb36b', '#7fe3d0', '#ff8f8f'];
const modeDial = ctl.mode = new SteppedKnob($('modeDial'), 8, def('mode').default, (v) => { setParam('mode', v); syncMode(); }, 315);
const modeEls: HTMLElement[] = [];
MODE_NAMES.forEach((name, i) => {
  const pill = document.createElement('div');
  pill.className = 'mode-pill';
  pill.style.background = pillColors[i];
  pill.appendChild(spriteCanvas(modeIcons[i]));
  pill.insertAdjacentHTML('beforeend', `<span>${name}</span>`);
  pill.addEventListener('pointerdown', () => modeDial.set(i));
  $('modePills').appendChild(pill);
  modeEls.push(pill);
  // ふたの左右にも同じモード表示
  const lp = document.createElement('div');
  lp.className = 'legend-pill';
  lp.style.background = ['#3bb0e0', '#e8604c', '#48b85a', '#9a6ad8'][i % 4];
  lp.appendChild(spriteCanvas(modeIcons[i]));
  lp.insertAdjacentHTML('beforeend', `<span>${name}</span>`);
  lp.addEventListener('pointerdown', () => modeDial.set(i));
  $(i < 4 ? 'legendL' : 'legendR').appendChild(lp);
  modeEls.push(lp);
});
function syncMode(): void {
  modeEls.forEach((el, j) => el.classList.toggle('sel', Math.floor(j / 2) === modeDial.value));
}
syncMode();
['BLIP', 'R', 'C', 'D', 'O', 'W'].forEach((n) => $('lidArt').appendChild(spriteCanvas(n, '#b5121b')));

// ================= 左の列：電源・音量・RESET・STRETCH =================
leds.power = place('led green', 62, 26);
async function powerOn(): Promise<void> {
  await audio.start();
  audio.post({ type: 'power', on: true });
}
const powerOff = () => audio.post({ type: 'power', on: false });
momentary(place('dome green big', 62, 70), () => void powerOn());
label('ON', 62, 96);
momentary(place('dome big', 62, 140), powerOff);
label('OFF', 62, 166);

ctl.volume = new Knob(knob('blue', 62, 218), def('volume'), (v) => setParam('volume', v));
label('VOLUME', 62, 248);

tape('RESET', 26, 316, true);
const resetBtn = ctl.reset = momentary(place('dome chrome', 70, 316), () => setParam('reset', 1), () => setParam('reset', 0));

tape('STRETCH', 26, 470, true, -1);
const stretchSw = ctl.stretch = new Toggle(place('toggle', 70, 396), 2, def('stretch').default, (v) => setParam('stretch', v));
label('ON/OFF', 70, 428);
leds.stretch = place('led yellow', 70, 452);
ctl.stretchHold = new Knob(knob('red small', 70, 494), def('stretchHold'), (v) => setParam('stretchHold', v));
label('HOLD', 70, 516);
ctl.stretchRelease = new Knob(knob('red small', 70, 556), def('stretchRelease'), (v) => setParam('stretchRelease', v));
label('REL', 70, 578);

// ================= 右の列：GLITCH ×5 =================
tape('GLITCH', 794, 250, true, 1);
leds.glitch = place('led', 752, 36);
const glitchBtns = [0, 1, 2, 3, 4].map((i) => {
  const y = 90 + i * 76;
  label(String(i + 1), 724, y - 6);
  const id = `glitch${i + 1}` as ParamId;
  return (ctl[id] = momentary(place('dome big', 756, y), () => setParam(id, 1), () => setParam(id, 0)));
});

// ================= 左下：LOOP ＋ LFO =================
tape('LOOP', 70, 660, false, -2);
leds.loop = place('led', 126, 660);
const loopSw = ctl.loopSwitch = new Toggle(place('toggle', 48, 714), 3, def('loopSwitch').default, (v) => setParam('loopSwitch', v));
label('HOLD', 86, 690);
label('PLAY', 86, 708);
label('MUTE', 86, 726);
const holdBtn = ctl.loopHold = momentary(place('dome', 150, 704), () => setParam('loopHold', 1), () => setParam('loopHold', 0));
label('HOLD', 150, 726);
const relBtn = ctl.loopRelease = momentary(place('dome black', 206, 704), () => setParam('loopRelease', 1), () => setParam('loopRelease', 0));
label('RELEASE', 206, 726);
ctl.lfoRate = new Knob(knob('red', 146, 768), def('lfoRate'), (v) => setParam('lfoRate', v));
label('LFO RATE', 146, 794);
ctl.lfoDepth = new Knob(knob('red', 214, 768), def('lfoDepth'), (v) => setParam('lfoDepth', v));
label('LFO DEPTH', 214, 794);

// ================= 右下：BASE と DIST =================
tape('BASE', 730, 666, false, 2);
const baseKnob = ctl.base = new SteppedKnob(knob('black big', 724, 730), 5, def('base').default, (v) => setParam('base', v), 240);
const ticks = place('ticks', 724, 730);
for (let i = 0; i < 5; i++) {
  const a = ((-120 + i * 60) * Math.PI) / 180;
  const t = document.createElement('span');
  t.textContent = String(i + 1);
  t.style.left = `${Math.sin(a) * 44}px`;
  t.style.top = `${-Math.cos(a) * 44}px`;
  ticks.appendChild(t);
}
tape('DIST', 596, 672, false, -1);
ctl.dist = new Knob(knob('red', 596, 730), def('dist'), (v) => setParam('dist', v));
ctl.distType = new Toggle(place('toggle', 650, 730), 2, def('distType').default, (v) => setParam('distType', v));
label('FOLD', 650, 694);
label('CLIP', 650, 762);

// ================= 飾り：ジャック・ネジ =================
for (const [x, y] of [[296, 668], [524, 668], [300, 806], [520, 806], [22, 22], [798, 22]]) place('screw', x, y);

// ================= 中央下：REC（LINE OUT 録音）・MIDI・自分の声 =================
place('jack', 410, 700);
label('LINE OUT', 410, 722);
leds.rec = place('led', 346, 668);
const recBtn = place('dome', 346, 700);
label('REC', 346, 722);
const recTime = document.createElement('div');
recTime.className = 'rec-time';
recTime.style.left = '346px';
recTime.style.top = '738px';
recTime.textContent = '--:--';
base.appendChild(recTime);
let recChunks: Float32Array[] = [];
let recording = false;
let recStart = 0;
recBtn.addEventListener('pointerdown', async () => {
  await audio.start();
  recording = !recording;
  if (recording) {
    recChunks = [];
    recStart = performance.now();
    recTime.textContent = '00:00';
  }
  audio.post({ type: 'rec', on: recording });
  recBtn.classList.toggle('down', recording);
  leds.rec.classList.toggle('lit', recording);
});
function finishRecording(): void {
  if (!recChunks.length || !audio.ctx) return;
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const name = `bentpc-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.wav`;
  download(encodeWav(recChunks, audio.ctx.sampleRate), name);
  recChunks = [];
}
setInterval(() => {
  if (!recording) return;
  const sec = Math.floor((performance.now() - recStart) / 1000);
  recTime.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}, 250);

leds.midi = place('led green', 474, 668);
const midiBtn = place('dome chrome', 474, 700);
label('MIDI', 474, 722);
const midiName = document.createElement('div');
midiName.className = 'rec-time midi-name';
midiName.style.left = '474px';
midiName.style.top = '738px';
base.appendChild(midiName);
midiBtn.addEventListener('pointerdown', async () => {
  await audio.start();
  const ok = await startMidi({
    key: (k, down) => (down ? keyCtl[k]?.press() : keyCtl[k]?.release()),
    param: (i, v) => {
      const c = ctl[PARAMS[i].id];
      if (!c) return;
      if ('set' in c) c.set(v);
      else if (v > 0.5) c.press();
      else c.release();
    },
    mode: (m) => modeDial.set(m),
    power: (on) => (on ? void powerOn() : powerOff()),
    onDevices: (names) => {
      midiName.textContent = names.length ? names[0].slice(0, 14) : 'NO DEVICE';
      leds.midi.classList.toggle('lit', names.length > 0);
    },
  });
  if (!ok) midiName.textContent = 'NOT AVAILABLE';
});

tape('MY VOICE', 410, 770, false, 1);
leds.mic = place('led', 366, 800);
const micBtn = place('dome black', 410, 800);
micBtn.addEventListener('pointerdown', async () => {
  if (!micArmed && !(await audio.enableMic())) {
    alert('マイクが使えませんでした（ブラウザのマイク許可を確認してください）');
    return;
  }
  micArmed = !micArmed;
  micBtn.classList.toggle('down', micArmed);
  document.body.classList.toggle('mic-armed', micArmed);
});

// ---- 自分の声の保存（このブラウザの中に保存） ----
const STORE = 'bentpc.userSamples.v1';
function loadStore(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}
function saveUserSample(key: number, data: Int8Array | null): void {
  keyEls[key]?.classList.toggle('has-voice', !!data);
  const st = loadStore();
  if (data) {
    let bin = '';
    for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i] & 255);
    st[key] = btoa(bin);
  } else delete st[key];
  try {
    localStorage.setItem(STORE, JSON.stringify(st));
  } catch {
    // 保存できなくても演奏はできる
  }
}
for (const [k, b64] of Object.entries(loadStore())) {
  const bin = atob(b64);
  const data = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = (bin.charCodeAt(i) << 24) >> 24;
  const key = Number(k);
  keyEls[key]?.classList.add('has-voice');
  audio.post({ type: 'userSample', key, data });
}


// ================= PC キーボード =================
const FN_CODES = ['Minus', 'Equal', 'BracketLeft', 'BracketRight'];
const GLITCH_CODES = ['Comma', 'Period', 'Slash', 'Semicolon', 'Quote'];
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
function momentaryFor(code: string): { press: () => void; release: () => void } | null {
  if (/^Key[A-Z]$/.test(code)) return keyCtl[code.charCodeAt(3) - 65];
  let i = DIGITS.indexOf(code);
  if (i >= 0) return keyCtl[FIRST_NUMBER_KEY + i];
  i = FN_CODES.indexOf(code);
  if (i >= 0) return keyCtl[26 + i];
  i = GLITCH_CODES.indexOf(code);
  if (i >= 0) return glitchBtns[i];
  if (code === 'Space') return holdBtn;
  if (code === 'Enter') return relBtn;
  if (code === 'Escape') return resetBtn;
  return null;
}
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const m = momentaryFor(e.code);
  if (m) { e.preventDefault(); if (!e.repeat) m.press(); return; }
  const actions: Record<string, () => void> = {
    ArrowLeft: () => modeDial.set(Math.max(0, modeDial.value - 1)),
    ArrowRight: () => modeDial.set(Math.min(7, modeDial.value + 1)),
    ArrowUp: () => baseKnob.set(Math.min(4, baseKnob.value + 1)),
    ArrowDown: () => baseKnob.set(Math.max(0, baseKnob.value - 1)),
    Tab: () => loopSw.cycle(),
    Backspace: () => stretchSw.cycle(),
    PageUp: () => void powerOn(),
    PageDown: powerOff,
  };
  const a = actions[e.code];
  if (a) { e.preventDefault(); if (!e.repeat) a(); }
});
window.addEventListener('keyup', (e) => momentaryFor(e.code)?.release());
// ウィンドウから離れたら押しっぱなしを解除
window.addEventListener('blur', () => [...keyCtl, ...glitchBtns, holdBtn, relBtn, resetBtn].forEach((m) => m.release()));

// ================= ヘルプ =================
$('helpBtn').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });
