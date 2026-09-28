// 1台目：BLIPPY BOOK 30（魔改造トイPC）の画面
import './blippy.css';
import { Knob, SteppedKnob, Toggle, momentary } from '../../../core/controls';
import { Board, CC_POWER, applyCtl, ccMap, ccToValue, type Ctl, type HostApi, type ToyUI } from '../../../core/ui';
import type { FromToy } from '../../../host/protocol';
import type { DisplayState } from '../dsp/firmware';
import { WORDS } from '../dsp/phonemes';
import {
  FIRST_NUMBER_KEY, FUNCTION_KEY_LABELS, KEY_COUNT, LETTER_KEYS, MODE_NAMES, NUMBER_KEY_LABELS, PARAMS, PARAM_INDEX, type ParamId,
} from '../params';
import { Bitmap, LCD_H, LCD_W, LcdView, drawDisplay } from './lcd';
import { applyFx, misreadOverride, type LcdFx } from './lcdfx';
import { spriteCanvas } from './pixels';

const TEMPLATE = `
<div class="toy" >
  <div class="lid">
    <div class="lid-panel">
      <div class="brand-strip"><span class="b1">BLIPPY</span> <span class="b2">BOOK</span> <span class="b3">30</span></div>
      <div class="mode-legend left" data-id="legendL"></div>
      <div class="mode-legend right" data-id="legendR"></div>
      <div class="lcd-surround">
        <div class="lcd-wrap"><canvas data-id="lcd"></canvas><div class="lcd-glare"></div></div>
      </div>
      <div class="tape lid-tape">CIRCUIT BENT</div>
      <div class="lid-art" data-id="lidArt"></div>
    </div>
  </div>
  <div class="hinge"><div class="hinge-block left"></div><div class="hinge-roll"></div><div class="hinge-block right"></div></div>
  <div class="base" data-id="base">
    <div class="keys-panel" data-id="keysPanel"></div>
    <div class="number-row" data-id="numberRow"></div>
    <div class="mode-area">
      <div class="mode-dial" data-id="modeDial"><div class="cap"><i></i></div></div>
      <div class="mode-pills" data-id="modePills"></div>
    </div>
  </div>
</div>`;

const HELP = `
<h3>BLIPPY BOOK 30 のキー操作</h3>
<table>
  <tr><td>A〜Z</td><td>文字キー</td></tr>
  <tr><td>1〜0</td><td>ドレミの数字キー</td></tr>
  <tr><td>- ^ @ [</td><td>♪ ? ★ OK</td></tr>
  <tr><td>, . / ; :</td><td>GLITCH 1〜5（押している間）</td></tr>
  <tr><td>↑ ↓</td><td>BASE（グリッチの種類）</td></tr>
  <tr><td>← →</td><td>MODE</td></tr>
  <tr><td>Space</td><td>LOOP HOLD</td></tr>
  <tr><td>Enter</td><td>LOOP RELEASE</td></tr>
  <tr><td>Tab</td><td>LOOP スイッチ（上→中→下）</td></tr>
  <tr><td>Backspace</td><td>STRETCH スイッチ</td></tr>
  <tr><td>PageUp / PageDown</td><td>電源 ON / OFF</td></tr>
  <tr><td>Esc</td><td>RESET</td></tr>
  <tr><td>MY VOICE</td><td>押して待機 → キーを押している間マイク録音。短く押すと声を消す</td></tr>
</table>
<p>MIDI（チャンネル1）：ノート 36〜75 = 40 キー、CC でノブ、プログラムチェンジでモード、CC119 で電源</p>`;

const STORE = 'bentpc.userSamples.v1';

export function mountBlippy(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-blippy';
  root.innerHTML = TEMPLATE;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`[data-id="${id}"]`) as T;
  const setParam = (id: ParamId, v: number) => api.post({ type: 'param', index: PARAM_INDEX[id], value: v });
  const def = (id: ParamId) => PARAMS[PARAM_INDEX[id]];
  const ctl: Partial<Record<ParamId, Ctl>> = {};
  const base = $('base');
  const b = new Board(base);
  const leds: Record<string, HTMLElement> = {};

  // ================= 液晶 =================
  const lcd = new LcdView($<HTMLCanvasElement>('lcd'));
  const bm = new Bitmap();
  let display: DisplayState = { screen: 'off', mode: 0 };
  let displayAt = performance.now();
  let fx: LcdFx = { combos: 0, heat: 0, seed: 0, misread: -1 };
  let frameNo = 0;
  const prevFrame = new Uint8Array(LCD_W * LCD_H);
  const frame = (now: number) => {
    if (root.isConnected && root.offsetParent !== null) {
      const d = display.screen === 'off' || display.screen === 'boot' ? display : misreadOverride(display, fx);
      drawDisplay(bm, d, now / 1000, (now - displayAt) / 1000);
      if (display.screen !== 'off') applyFx(bm, fx, frameNo++, prevFrame);
      prevFrame.set(bm.px);
      lcd.paint(bm, display.screen !== 'off');
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ================= キーボード（A〜Z ＋ ♪?★OK） =================
  const keyCtl: { press: () => void; release: () => void }[] = [];
  let micArmed = false;
  const post = (key: number, down: boolean) => {
    if (micArmed) {
      api.post({ type: 'mic', key, on: down });
      leds.mic?.classList.toggle('lit', down);
    } else api.post({ type: 'key', key, down });
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
  const modeEls: HTMLElement[] = [];
  const modeDial = new SteppedKnob($('modeDial'), 8, def('mode').default, (v) => { setParam('mode', v); syncMode(); }, 315);
  ctl.mode = modeDial;
  function syncMode(): void {
    modeEls.forEach((el, j) => el.classList.toggle('sel', Math.floor(j / 2) === modeDial.value));
  }
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
  syncMode();
  ['BLIP', 'R', 'C', 'D', 'O', 'W'].forEach((n) => $('lidArt').appendChild(spriteCanvas(n, '#b5121b')));

  // ================= 左の列：電源・音量・RESET・STRETCH =================
  leds.power = b.place('led green', 62, 26);
  const powerOn = async () => {
    await api.start();
    api.post({ type: 'power', on: true });
  };
  const powerOff = () => api.post({ type: 'power', on: false });
  momentary(b.place('dome green big', 62, 70), () => void powerOn());
  b.label('ON', 62, 96);
  momentary(b.place('dome big', 62, 140), powerOff);
  b.label('OFF', 62, 166);

  ctl.volume = new Knob(b.knob('blue', 62, 218), def('volume'), (v) => setParam('volume', v));
  b.label('VOLUME', 62, 248);

  b.tape('RESET', 26, 316, true);
  const resetBtn = momentary(b.place('dome chrome', 70, 316), () => setParam('reset', 1), () => setParam('reset', 0));
  ctl.reset = resetBtn;

  b.tape('STRETCH', 26, 470, true, -1);
  const stretchSw = new Toggle(b.place('toggle', 70, 396), 2, def('stretch').default, (v) => setParam('stretch', v));
  ctl.stretch = stretchSw;
  b.label('ON/OFF', 70, 428);
  leds.stretch = b.place('led yellow', 70, 452);
  ctl.stretchHold = new Knob(b.knob('red small', 70, 494), def('stretchHold'), (v) => setParam('stretchHold', v));
  b.label('HOLD', 70, 516);
  ctl.stretchRelease = new Knob(b.knob('red small', 70, 556), def('stretchRelease'), (v) => setParam('stretchRelease', v));
  b.label('REL', 70, 578);

  // ================= 右の列：GLITCH ×5 =================
  b.tape('GLITCH', 794, 250, true, 1);
  leds.glitch = b.place('led', 752, 36);
  const glitchBtns = [0, 1, 2, 3, 4].map((i) => {
    const y = 90 + i * 76;
    b.label(String(i + 1), 724, y - 6);
    const id = `glitch${i + 1}` as ParamId;
    const m = momentary(b.place('dome big', 756, y), () => setParam(id, 1), () => setParam(id, 0));
    ctl[id] = m;
    return m;
  });

  // ================= 左下：LOOP ＋ LFO =================
  b.tape('LOOP', 70, 660, false, -2);
  leds.loop = b.place('led', 126, 660);
  const loopSw = new Toggle(b.place('toggle', 48, 714), 3, def('loopSwitch').default, (v) => setParam('loopSwitch', v));
  ctl.loopSwitch = loopSw;
  b.label('HOLD', 86, 690);
  b.label('PLAY', 86, 708);
  b.label('MUTE', 86, 726);
  const holdBtn = momentary(b.place('dome', 150, 704), () => setParam('loopHold', 1), () => setParam('loopHold', 0));
  ctl.loopHold = holdBtn;
  b.label('HOLD', 150, 726);
  const relBtn = momentary(b.place('dome black', 206, 704), () => setParam('loopRelease', 1), () => setParam('loopRelease', 0));
  ctl.loopRelease = relBtn;
  b.label('RELEASE', 206, 726);
  ctl.lfoRate = new Knob(b.knob('red', 146, 768), def('lfoRate'), (v) => setParam('lfoRate', v));
  b.label('LFO RATE', 146, 794);
  ctl.lfoDepth = new Knob(b.knob('red', 214, 768), def('lfoDepth'), (v) => setParam('lfoDepth', v));
  b.label('LFO DEPTH', 214, 794);

  // ================= 右下：BASE と DIST =================
  b.tape('BASE', 730, 666, false, 2);
  const baseKnob = new SteppedKnob(b.knob('black big', 724, 730), 5, def('base').default, (v) => setParam('base', v), 240);
  ctl.base = baseKnob;
  const ticks = b.place('ticks', 724, 730);
  for (let i = 0; i < 5; i++) {
    const a = ((-120 + i * 60) * Math.PI) / 180;
    const t = document.createElement('span');
    t.textContent = String(i + 1);
    t.style.left = `${Math.sin(a) * 44}px`;
    t.style.top = `${-Math.cos(a) * 44}px`;
    ticks.appendChild(t);
  }
  b.tape('DIST', 596, 672, false, -1);
  ctl.dist = new Knob(b.knob('red', 596, 730), def('dist'), (v) => setParam('dist', v));
  ctl.distType = new Toggle(b.place('toggle', 650, 730), 2, def('distType').default, (v) => setParam('distType', v));
  b.label('FOLD', 650, 694);
  b.label('CLIP', 650, 762);

  // ================= 飾り・LINE OUT・自分の声 =================
  for (const [x, y] of [[296, 668], [524, 668], [300, 806], [520, 806], [22, 22], [798, 22]]) b.place('screw', x, y);
  b.place('jack', 410, 700);
  b.label('LINE OUT', 410, 722);
  b.tape('MY VOICE', 410, 770, false, 1);
  leds.mic = b.place('led', 366, 800);
  const micBtn = b.place('dome black', 410, 800);
  micBtn.addEventListener('pointerdown', async () => {
    if (!micArmed && !(await api.enableMic())) {
      alert('マイクが使えませんでした（ブラウザのマイク許可を確認してください）');
      return;
    }
    micArmed = !micArmed;
    micBtn.classList.toggle('down', micArmed);
    root.classList.toggle('mic-armed', micArmed);
  });

  // ---- 自分の声の保存（このブラウザの中に保存） ----
  const loadStore = (): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? '{}');
    } catch {
      return {};
    }
  };
  const saveUserSample = (key: number, data: Int8Array | null) => {
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
  };
  for (const [k, b64] of Object.entries(loadStore())) {
    const bin = atob(b64);
    const data = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = (bin.charCodeAt(i) << 24) >> 24;
    const key = Number(k);
    keyEls[key]?.classList.add('has-voice');
    api.post({ type: 'userSample', key, data });
  }

  // ================= PC キーボード =================
  const FN_CODES = ['Minus', 'Equal', 'BracketLeft', 'BracketRight'];
  const GLITCH_CODES = ['Comma', 'Period', 'Slash', 'Semicolon', 'Quote'];
  const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
  const momentaryFor = (code: string): { press: () => void; release: () => void } | null => {
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
  };
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

  const cc = ccMap(PARAMS);

  return {
    title: 'BLIPPY BOOK 30',
    paramDefs: PARAMS,
    keyCount: KEY_COUNT,
    keyName: (k) => (k < 26 ? LETTER_KEYS[k] : k < FIRST_NUMBER_KEY ? FUNCTION_KEY_LABELS[k - 26] : `${NUMBER_KEY_LABELS[k - FIRST_NUMBER_KEY]} ${k - FIRST_NUMBER_KEY + 1}`),
    width: 900,
    height: 1300,
    root,
    help: HELP,
    onMessage(m: FromToy) {
      if (m.type === 'display') {
        display = m.display as DisplayState;
        displayAt = performance.now();
      } else if (m.type === 'status') {
        const st = m.status;
        leds.power.classList.toggle('lit', st.powered);
        leds.stretch.classList.toggle('lit', st.leds.stretch > 0);
        leds.loop.classList.toggle('lit', st.leds.loop > 0);
        leds.glitch.classList.toggle('lit', st.leds.glitch > 0.05);
        fx = st.fx as unknown as LcdFx;
      } else if (m.type === 'userSample') {
        saveUserSample(m.key, m.data);
      }
    },
    keyDown(e) {
      const m = momentaryFor(e.code);
      if (m) { if (!e.repeat) m.press(); return true; }
      const a = actions[e.code];
      if (a) { if (!e.repeat) a(); return true; }
      return false;
    },
    keyUp(e) {
      momentaryFor(e.code)?.release();
    },
    releaseAll() {
      [...keyCtl, ...glitchBtns, holdBtn, relBtn, resetBtn].forEach((m) => m.release());
    },
    midi(status, d1, d2) {
      const st = status & 0xf0;
      const k = d1 - 36;
      if (st === 0x90 && d2 > 0) { if (k >= 0 && k < KEY_COUNT) keyCtl[k].press(); }
      else if (st === 0x80 || st === 0x90) { if (k >= 0 && k < KEY_COUNT) keyCtl[k].release(); }
      else if (st === 0xb0) {
        if (d1 === CC_POWER) (d2 >= 64 ? powerOn() : powerOff());
        const i = cc.get(d1);
        if (i !== undefined) applyCtl(ctl[PARAMS[i].id], ccToValue(PARAMS[i], d2));
      } else if (st === 0xc0) modeDial.set(d1 % 8);
    },
    powerOn: () => void powerOn(),
    powerOff,
  };
}
