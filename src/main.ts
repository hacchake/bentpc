import './style.css';
import { AudioHost } from './audio';
import type { DisplayState } from './dsp/firmware';
import { WORDS } from './dsp/phonemes';
import {
  FIRST_NUMBER_KEY, FUNCTION_KEY_LABELS, LETTER_KEYS, MODE_NAMES, NUMBER_KEY_LABELS, PARAMS, PARAM_INDEX, type ParamId,
} from './params';
import { Knob, SteppedKnob, Toggle, momentary } from './ui/controls';
import { Bitmap, LcdView, drawDisplay } from './ui/lcd';
import { spriteCanvas } from './ui/pixels';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = new AudioHost();
const setParam = (id: ParamId, v: number) => audio.setParam(PARAM_INDEX[id], v);
const def = (id: ParamId) => PARAMS[PARAM_INDEX[id]];

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
  }
};
function frame(now: number): void {
  drawDisplay(bm, display, now / 1000, (now - displayAt) / 1000);
  lcd.paint(bm, display.screen !== 'off');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ================= キーボード（A〜Z ＋ ♪?★OK） =================
const keyCtl: { press: () => void; release: () => void }[] = [];
const post = (key: number, down: boolean) => audio.post({ type: 'key', key, down });
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
  keyCtl[k] = momentary(el, () => post(k, true), () => post(k, false));
}

// ================= MODE（緑のダイヤル＋絵のボタン） =================
const modeIcons = ['A', 'C', 'NOTE', 'SPEAKER', 'DRUM', 'STAR', 'BLIP', 'K'];
const pillColors = ['#ff9fb2', '#ffd36b', '#9fe07a', '#8fd3ff', '#c9a6ff', '#ffb36b', '#7fe3d0', '#ff8f8f'];
const modeDial = new SteppedKnob($('modeDial'), 8, def('mode').default, (v) => { setParam('mode', v); syncMode(); }, 315);
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

new Knob(knob('blue', 62, 218), def('volume'), (v) => setParam('volume', v));
label('VOLUME', 62, 248);

tape('RESET', 26, 316, true);
const resetBtn = momentary(place('dome chrome', 70, 316), () => setParam('reset', 1), () => setParam('reset', 0));

tape('STRETCH', 26, 470, true, -1);
const stretchSw = new Toggle(place('toggle', 70, 396), 2, def('stretch').default, (v) => setParam('stretch', v));
label('ON/OFF', 70, 428);
leds.stretch = place('led yellow', 70, 452);
new Knob(knob('red small', 70, 494), def('stretchHold'), (v) => setParam('stretchHold', v));
label('HOLD', 70, 516);
new Knob(knob('red small', 70, 556), def('stretchRelease'), (v) => setParam('stretchRelease', v));
label('REL', 70, 578);

// ================= 右の列：GLITCH ×5 =================
tape('GLITCH', 794, 250, true, 1);
leds.glitch = place('led', 752, 36);
const glitchBtns = [0, 1, 2, 3, 4].map((i) => {
  const y = 90 + i * 76;
  label(String(i + 1), 724, y - 6);
  const id = `glitch${i + 1}` as ParamId;
  return momentary(place('dome big', 756, y), () => setParam(id, 1), () => setParam(id, 0));
});

// ================= 左下：LOOP ＋ LFO =================
tape('LOOP', 70, 660, false, -2);
leds.loop = place('led', 126, 660);
const loopSw = new Toggle(place('toggle', 48, 714), 3, def('loopSwitch').default, (v) => setParam('loopSwitch', v));
label('HOLD', 86, 690);
label('PLAY', 86, 708);
label('MUTE', 86, 726);
const holdBtn = momentary(place('dome', 150, 704), () => setParam('loopHold', 1), () => setParam('loopHold', 0));
label('HOLD', 150, 726);
const relBtn = momentary(place('dome black', 206, 704), () => setParam('loopRelease', 1), () => setParam('loopRelease', 0));
label('RELEASE', 206, 726);
new Knob(knob('red', 146, 768), def('lfoRate'), (v) => setParam('lfoRate', v));
label('LFO RATE', 146, 794);
new Knob(knob('red', 214, 768), def('lfoDepth'), (v) => setParam('lfoDepth', v));
label('LFO DEPTH', 214, 794);

// ================= 右下：BASE と DIST =================
tape('BASE', 730, 666, false, 2);
const baseKnob = new SteppedKnob(knob('black big', 724, 730), 5, def('base').default, (v) => setParam('base', v), 240);
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
new Knob(knob('red', 596, 730), def('dist'), (v) => setParam('dist', v));
const distSw = new Toggle(place('toggle', 650, 730), 2, def('distType').default, (v) => setParam('distType', v));
label('FOLD', 650, 694);
label('CLIP', 650, 762);

// ================= 飾り：ジャック・ネジ =================
place('jack', 410, 712);
label('LINE OUT', 410, 736);
for (const [x, y] of [[300, 680], [520, 680], [340, 790], [480, 790], [22, 22], [798, 22]]) place('screw', x, y);
for (const [x, y] of [[372, 700], [448, 700]]) place('hole', x, y);

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
void distSw;

// ================= ヘルプ =================
$('helpBtn').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });
