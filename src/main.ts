import './style.css';
import { AudioHost } from './audio';
import type { DisplayState } from './dsp/firmware';
import { FUNCTION_KEY_LABELS, KEY_COUNT, LETTER_KEYS, MODE_NAMES, PARAMS, PARAM_INDEX } from './params';
import { Knob, SteppedSlider, momentary } from './ui/controls';
import { Bitmap, LcdView, drawDisplay } from './ui/lcd';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = new AudioHost();

// ---- 画面サイズに合わせて拡大縮小 ----
function fit(): void {
  const s = Math.min(window.innerWidth / 1200, (window.innerHeight - 20) / 900);
  $('stage').style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

// ---- 液晶 ----
const lcd = new LcdView($<HTMLCanvasElement>('lcd'));
const bm = new Bitmap();
let display: DisplayState = { screen: 'off', mode: 0 };
let displayAt = performance.now();
audio.onMessage = (m) => {
  if (m.type === 'display') {
    display = m.display;
    displayAt = performance.now();
  }
};
function frame(now: number): void {
  const t = now / 1000;
  drawDisplay(bm, display, t, (now - displayAt) / 1000);
  lcd.paint(bm, display.screen !== 'off');
  $('pwrLed').classList.toggle('lit', display.screen !== 'off');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- 電源 ----
async function powerOn(): Promise<void> {
  await audio.start();
  audio.post({ type: 'power', on: true });
}
function powerOff(): void {
  audio.post({ type: 'power', on: false });
}
$('btnOn').addEventListener('click', powerOn);
$('btnOff').addEventListener('click', powerOff);

// ---- MODE スライダー ----
const modeDef = PARAMS[PARAM_INDEX.mode];
const labels = $('modeLabels');
const modeSlider = new SteppedSlider($('modeSlider'), MODE_NAMES.length, modeDef.default, (v) => {
  audio.setParam(PARAM_INDEX.mode, v);
  updateModeLabels();
});
MODE_NAMES.forEach((name, i) => {
  const s = document.createElement('span');
  s.textContent = name;
  s.style.left = `${(i / (MODE_NAMES.length - 1)) * 100}%`;
  s.addEventListener('pointerdown', () => modeSlider.set(i));
  labels.appendChild(s);
});
function updateModeLabels(): void {
  [...labels.children].forEach((c, i) => c.classList.toggle('sel', i === modeSlider.value));
}
updateModeLabels();

// ---- VOLUME ----
new Knob($('volKnob'), PARAMS[PARAM_INDEX.volume], (v) => audio.setParam(PARAM_INDEX.volume, v));

// ---- キーボード ----
const keyEls: { press: () => void; release: () => void }[] = [];
const kb = $('keyboard');
const colors = ['var(--key-a)', 'var(--key-b)', 'var(--key-c)', 'var(--key-d)'];
for (let k = 0; k < KEY_COUNT; k++) {
  const el = document.createElement('div');
  el.className = 'key';
  if (k < 26) {
    el.textContent = LETTER_KEYS[k];
    el.style.setProperty('--kc', colors[(k + Math.floor(k / 10)) % 4]);
  } else {
    el.classList.add('fn', `f${k - 25}`);
    el.innerHTML = `${FUNCTION_KEY_LABELS[k - 26]}<small>${k - 25}</small>`;
  }
  kb.appendChild(el);
  keyEls.push(momentary(el, () => audio.post({ type: 'key', key: k, down: true }), () => audio.post({ type: 'key', key: k, down: false })));
}

// ---- PC キーボード ----
function keyIndex(e: KeyboardEvent): number {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.charCodeAt(3) - 65;
  const d = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  return d >= 0 ? 26 + d : -1;
}
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = keyIndex(e);
  if (k >= 0) { keyEls[k].press(); e.preventDefault(); return; }
  if (e.code === 'ArrowLeft') modeSlider.set(Math.max(0, modeSlider.value - 1));
  else if (e.code === 'ArrowRight') modeSlider.set(Math.min(MODE_NAMES.length - 1, modeSlider.value + 1));
  else if (e.code === 'Enter') powerOn();
  else if (e.code === 'Escape') powerOff();
});
window.addEventListener('keyup', (e) => {
  const k = keyIndex(e);
  if (k >= 0) keyEls[k].release();
});
