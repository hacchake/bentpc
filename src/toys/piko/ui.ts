// 2台目：PIKOTONE PT-32（魔改造ミニキーボード＋エフェクト別ユニット）の画面
import { rectOf, pt } from '../../core/view';
import './piko.css';
import { Knob, Toggle, momentary } from '../../core/controls';
import { PowerHints } from '../../core/power';
import { Board, CC_POWER, noteName, applyCtl, ccMap, ccToValue, type Ctl, type HostApi, type ToyUI } from '../../core/ui';
import type { FromToy } from '../../host/protocol';
import {
  INSTRUMENTS, KEY_DEMO, PIKO_KEY_COUNT, KEY_START, KEY_STOP, KEY_TEMPO_DOWN, KEY_TEMPO_UP, PAD_KEY, PIKO_FIRST_NOTE, PIKO_INDEX, PIKO_NOTE_COUNT,
  PIKO_PARAMS, RHYTHMS, type PikoParamId,
} from './params';

const W = 1500;
const H = 820;

const HELP = `
<h3>PIKOTONE PT-32 のキー操作</h3>
<table>
  <tr><td>Z X C … /</td><td>白鍵（F3 から）。上の段 A S D … が黒鍵</td></tr>
  <tr><td>Q W E … P</td><td>高い方の白鍵。上の段 2 4 5 7 8 9 が黒鍵</td></tr>
  <tr><td>- ^ @ [</td><td>赤いパッド（キック・スネア・ハット・タム）</td></tr>
  <tr><td>← →</td><td>ORCHESTRA（音色）</td></tr>
  <tr><td>↑ ↓</td><td>RHYTHM（リズムの種類）</td></tr>
  <tr><td>Space</td><td>リズム START / STOP</td></tr>
  <tr><td>Enter</td><td>DEMO</td></tr>
  <tr><td>Backspace</td><td>GLITCH スイッチ</td></tr>
  <tr><td>Tab</td><td>ENV / HOLD スイッチ</td></tr>
  <tr><td>POWER</td><td>操作パネル左の大きな緑の POWER ボタン（押すたびに ON / OFF）。電源 OFF のときは Enter キーでも入る</td></tr>
  <tr><td>PageUp / PageDown</td><td>電源 ON / OFF</td></tr>
</table>
<p>AMP TOUCH・PITCH BEND の銀の丸は、押している間だけ効きます。押したまま上下に動かすと強さが変わります。</p>
<p>MIDI（チャンネル2）：ノートはそのままの音の高さ（F3〜C6）、36/38/42/45 = パッド、CC でノブ、プログラムチェンジで音色、CC119 で電源</p>`;

/** 白鍵・黒鍵の並び（F3 から 32 鍵） */
function keyLayout(): { key: number; black: boolean; x: number }[] {
  const out: { key: number; black: boolean; x: number }[] = [];
  let white = 0;
  for (let k = 0; k < PIKO_NOTE_COUNT; k++) {
    const pc = (PIKO_FIRST_NOTE + k) % 12;
    const black = [1, 3, 6, 8, 10].includes(pc);
    if (black) out.push({ key: k, black, x: white });
    else out.push({ key: k, black, x: white++ });
  }
  return out;
}

export function mountPiko(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-piko';
  root.innerHTML = `
    <svg class="pk-necks" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <path d="M 530 190 C 420 190, 330 230, 330 345" />
      <path d="M 990 190 C 1100 190, 1190 230, 1190 345" />
    </svg>
    <div class="pk-fxbox"></div>
    <div class="pk-body"><div class="pk-sink"></div><div class="pk-strip">PIKOTONE <b>PT-32</b> ELECTRONIC KEYBOARD</div></div>
    <div class="pk-keys" data-id="keys"></div>`;
  const $ = (id: string) => root.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const b = new Board(root);
  const setParam = (id: PikoParamId, v: number) => api.post({ type: 'param', index: PIKO_INDEX[id], value: v });
  const def = (id: PikoParamId) => PIKO_PARAMS[PIKO_INDEX[id]];
  const ctl: Partial<Record<PikoParamId, Ctl>> = {};
  const leds: Record<string, HTMLElement> = {};
  const key = (k: number, down: boolean) => api.post({ type: 'key', key: k, down });
  const label = (t: string, x: number, y: number) => b.label(t, x, y, 'pk-lbl');
  const box = (t: string, x: number, y: number) => b.place('pk-box', x, y, t);

  // ================= エフェクト別ユニット =================
  for (const x of [620, 900]) b.place('jack', x, 26);
  label('ENV LEN', 590, 52);
  ctl.envLen = new Knob(b.knob('red', 590, 98), def('envLen'), (v) => setParam('envLen', v));
  label('ENV', 672, 52);
  const envSw = new Toggle(b.place('toggle', 672, 98), 2, def('envHold').default, (v) => setParam('envHold', v));
  ctl.envHold = envSw;
  label('HOLD', 672, 136);
  label('DIST', 790, 52);
  ctl.dist = new Knob(b.knob('red', 790, 98), def('dist'), (v) => setParam('dist', v));
  label('HIPASS', 900, 52);
  ctl.hipass = new Knob(b.knob('red', 900, 98), def('hipass'), (v) => setParam('hipass', v));
  ctl.hipassMode = new Toggle(b.place('toggle small', 962, 98), 2, def('hipassMode').default, (v) => setParam('hipassMode', v));
  label('RESO', 962, 64);
  ctl.pitch = new Knob(b.knob('chrome big', 590, 228), def('pitch'), (v) => setParam('pitch', v));
  label('PITCH', 672, 176);
  ctl.pitchOn = new Toggle(b.place('toggle', 672, 226), 2, def('pitchOn').default, (v) => setParam('pitchOn', v));
  label('FIZZ', 790, 176);
  ctl.fizz = new Knob(b.knob('red', 790, 226), def('fizz'), (v) => setParam('fizz', v));
  label('FEEDBACK', 900, 176);
  ctl.feedback = new Knob(b.knob('red', 900, 226), def('feedback'), (v) => setParam('feedback', v));
  ctl.feedbackMode = new Toggle(b.place('toggle small', 962, 226), 2, def('feedbackMode').default, (v) => setParam('feedbackMode', v));
  label('LONG', 962, 192);

  // ================= 左：電圧 Starve とタッチポイント =================
  box('AMP POWER', 110, 360);
  ctl.ampPower = new Knob(b.knob('red', 110, 410), def('ampPower'), (v) => setParam('ampPower', v));
  box('CPU POWER', 240, 360);
  ctl.cpuPower = new Knob(b.knob('red', 240, 410), def('cpuPower'), (v) => setParam('cpuPower', v));
  const touch = (id: PikoParamId, x: number, y: number) => {
    const el = b.place('stud', x, y);
    let startY = 0;
    const set = (v: number) => { setParam(id, v); el.style.setProperty('--glow', String(v)); };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      startY = pt(e).y;
      el.classList.add('down');
      set(0.7);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (el.hasPointerCapture(e.pointerId)) set(Math.max(0.15, Math.min(1, 0.7 + (startY - pt(e).y) / 150)));
    });
    const up = () => { el.classList.remove('down'); set(0); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    ctl[id] = { set: (v: number) => { el.classList.toggle('down', v > 0); set(v); } };
  };
  for (let i = 0; i < 3; i++) {
    touch(`ampTouch${i + 1}` as PikoParamId, 90, 560 + i * 70);
    touch(`bendTouch${i + 1}` as PikoParamId, 260, 560 + i * 70);
  }
  box('AMP TOUCH', 110, 780);
  box('PITCH BEND', 240, 780);

  // ================= 操作パネル =================
  leds.power = b.place('led green', 386, 400);
  const powerOn = async () => {
    await api.start();
    api.post({ type: 'power', on: true });
  };
  const powerOff = () => api.post({ type: 'power', on: false });
  // 大きな POWER ボタン（押すたびに ON / OFF）
  const powerBtn = b.place('dome green big power', 340, 404);
  let poweredNow = false;
  const powerSw = { set: (v: number) => (v ? void powerOn() : powerOff()) };
  momentary(powerBtn, () => powerSw.set(poweredNow ? 0 : 1));
  b.label('POWER', 340, 450, 'power-label');
  const hints = new PowerHints(root, powerBtn, leds.power, { x: 400, y: 404, side: 'right' });
  label('MASTER VOL', 430, 368);
  ctl.volume = new Knob(b.knob('black small', 430, 420), def('volume'), (v) => setParam('volume', v));

  // リズム
  label('RHYTHM', 630, 356);
  label('TEMPO', 500, 372);
  leds.beat = b.place('led', 500, 390);
  momentary(b.place('pk-btn small', 500, 420, 'UP'), () => key(KEY_TEMPO_UP, true), () => key(KEY_TEMPO_UP, false));
  momentary(b.place('pk-btn small', 500, 452, 'DN'), () => key(KEY_TEMPO_DOWN, true), () => key(KEY_TEMPO_DOWN, false));
  const tempoView = label('', 500, 470);
  const rhythmBtns: HTMLElement[] = [];
  let rhythm = def('rhythm').default as number;
  const setRhythm = (v: number) => {
    rhythm = v;
    rhythmBtns.forEach((el, i) => el.classList.toggle('sel', i === v));
    setParam('rhythm', v);
  };
  RHYTHMS.forEach((name, i) => {
    const x = 560 + (i % 4) * 60, y = i < 4 ? 400 : 440;
    label(name, x, y - 22);
    const el = b.place('pk-btn green', x, y);
    el.addEventListener('pointerdown', () => setRhythm(i));
    rhythmBtns.push(el);
  });
  ctl.rhythm = { set: (v: number) => setRhythm(v) };
  setRhythm(rhythm);
  const startEl = b.place('pk-bar', 590, 468, 'START');
  const startBtn = momentary(startEl, () => key(KEY_START, true), () => key(KEY_START, false));
  const stopBtn = momentary(b.place('pk-bar', 700, 468, 'STOP'), () => key(KEY_STOP, true), () => key(KEY_STOP, false));
  let running = false;

  // オーケストラ（音色）
  label('ORCHESTRA', 905, 356);
  const instBtns: HTMLElement[] = [];
  let inst = 0;
  const setInst = (v: number) => {
    inst = v;
    instBtns.forEach((el, i) => el.classList.toggle('sel', i === v));
    setParam('instrument', v);
  };
  INSTRUMENTS.forEach((name, i) => {
    const x = 815 + (i % 4) * 60, y = i < 4 ? 400 : 440;
    label(name, x, y - 22);
    const el = b.place('pk-btn green', x, y);
    el.addEventListener('pointerdown', () => setInst(i));
    instBtns.push(el);
  });
  ctl.instrument = { set: (v: number) => setInst(v) };
  setInst(0);
  let vib = 0;
  const vibBtn = b.place('pk-bar', 850, 468, 'VIBRATO');
  const setVib = (v: number) => { vib = v; vibBtn.classList.toggle('sel', !!v); setParam('vibrato', v); };
  vibBtn.addEventListener('pointerdown', () => setVib(vib ? 0 : 1));
  ctl.vibrato = { set: setVib };
  const demoEl = b.place('pk-bar', 960, 468, 'DEMO');
  const demoBtn = momentary(demoEl, () => key(KEY_DEMO, true), () => key(KEY_DEMO, false));

  // GLITCH スイッチ
  label('MIC', 1085, 368);
  b.place('jack small', 1085, 395);
  box('GLITCH', 1085, 432);
  const glitchSw = new Toggle(b.place('toggle small', 1085, 462), 2, 0, (v) => setParam('glitch', v));
  ctl.glitch = glitchSw;

  // 赤いパッド
  b.tape('CIRCUIT BENT', 1250, 364, false, -1);
  const padCtl = ['KICK', 'SNARE', 'HAT', 'TOM'].map((name, i) => {
    const x = 1160 + i * 66;
    label(name, x, 454);
    return momentary(b.place('pk-pad', x, 414), () => key(PAD_KEY + i, true), () => key(PAD_KEY + i, false));
  });

  // INST HOLD ×8
  label('INST HOLD', 1438, 354);
  for (let i = 0; i < 8; i++) {
    const id = `instHold${i + 1}` as PikoParamId;
    ctl[id] = new Toggle(b.place('toggle small', 1438, 392 + i * 50), 2, 0, (v) => setParam(id, v));
    b.label(String(i + 1), 1412, 386 + i * 50, 'pk-lbl');
  }

  // ================= 鍵盤 =================
  const keysEl = $('keys');
  const lay = keyLayout();
  const whiteW = 1080 / 19;
  const keyCtl: { press: () => void; release: () => void }[] = [];
  for (const k of [...lay.filter((l) => !l.black), ...lay.filter((l) => l.black)]) {
    const el = document.createElement('div');
    el.className = k.black ? 'pk-key black' : 'pk-key';
    el.style.left = `${k.black ? k.x * whiteW - 16 : k.x * whiteW}px`;
    el.style.width = `${k.black ? 32 : whiteW - 2}px`;
    keysEl.appendChild(el);
    keyCtl[k.key] = momentary(el, () => key(k.key, true), () => key(k.key, false));
  }

  // ================= PC キーボード =================
  // 白鍵の番号 → キー番号
  const whites = lay.filter((l) => !l.black).map((l) => l.key);
  const blackAfter = (w: number) => lay.find((l) => l.black && l.key === whites[w] + 1)?.key; // 白鍵 w の右の黒鍵
  const map = new Map<string, number>();
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'].forEach((c, i) => map.set(c, whites[i]));
  ['KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'].forEach((c, i) => { const bk = blackAfter(i); if (bk !== undefined) map.set(c, bk); });
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'].forEach((c, i) => map.set(c, whites[9 + i]));
  ['Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].forEach((c, i) => { const bk = blackAfter(9 + i); if (bk !== undefined) map.set(c, bk); });
  const PAD_CODES = ['Minus', 'Equal', 'BracketLeft', 'BracketRight'];
  const momentaryFor = (code: string) => {
    const k = map.get(code);
    if (k !== undefined) return keyCtl[k];
    const p = PAD_CODES.indexOf(code);
    if (p >= 0) return padCtl[p];
    if (code === 'Enter') return demoBtn;
    return null;
  };
  const actions: Record<string, () => void> = {
    ArrowLeft: () => setInst((inst + 7) % 8),
    ArrowRight: () => setInst((inst + 1) % 8),
    ArrowUp: () => setRhythm((rhythm + 1) % 8),
    ArrowDown: () => setRhythm((rhythm + 7) % 8),
    Space: () => { const b2 = running ? stopBtn : startBtn; b2.press(); b2.release(); },
    Backspace: () => glitchSw.cycle(),
    Tab: () => envSw.cycle(),
    PageUp: () => powerSw.set(1),
    PageDown: () => powerSw.set(0),
  };
  const cc = ccMap(PIKO_PARAMS);
  const allMomentary = () => [...keyCtl, ...padCtl, startBtn, stopBtn, demoBtn];

  return {
    title: 'PIKOTONE PT-32',
    powerButton: powerBtn,
    paramDefs: PIKO_PARAMS,
    keyCount: PIKO_KEY_COUNT,
    keyName: (k) => (k < PIKO_NOTE_COUNT ? noteName(PIKO_FIRST_NOTE + k) : ['KICK', 'SNARE', 'HAT', 'TOM', 'DEMO', 'START', 'STOP', 'TEMPO+', 'TEMPO−'][k - PAD_KEY] ?? `KEY ${k}`),
    width: W,
    height: H,
    root,
    help: HELP,
    onMessage(m: FromToy) {
      if (m.type !== 'status') return;
      const st = m.status;
      leds.power.classList.toggle('lit', st.powered);
      poweredNow = st.powered;
      hints.update(st.powered);
      leds.beat.classList.toggle('lit', st.leds.beat > 0);
      running = st.leds.run > 0;
      startEl.classList.toggle('sel', running);
      demoEl.classList.toggle('sel', st.leds.demo > 0);
      tempoView.textContent = st.fx.tempo ? `${st.fx.tempo} BPM` : '';
    },
    keyDown(e) {
      // 電源 OFF のとき：Enter で電源 ON。ほかのキーは POWER を光らせて教える
      if (!hints.powered && e.code === 'Enter') { if (!e.repeat) void powerOn(); return true; }
      if (!hints.powered && e.code !== 'PageUp' && e.code !== 'PageDown' && !e.repeat && (momentaryFor(e.code) || actions[e.code])) hints.nudge();
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
      allMomentary().forEach((m) => m.release());
    },
    midi(status, d1, d2) {
      const st = status & 0xf0;
      const noteOn = st === 0x90 && d2 > 0;
      if (st === 0x90 || st === 0x80) {
        const k = d1 - PIKO_FIRST_NOTE;
        const pad = [36, 38, 42, 45].indexOf(d1);
        const target = k >= 0 && k < PIKO_NOTE_COUNT ? keyCtl[k] : pad >= 0 ? padCtl[pad] : null;
        if (target) (noteOn ? target.press() : target.release());
      } else if (st === 0xb0) {
        if (d1 === CC_POWER) powerSw.set(d2 >= 64 ? 1 : 0);
        const i = cc.get(d1);
        if (i !== undefined) applyCtl(ctl[PIKO_PARAMS[i].id], ccToValue(PIKO_PARAMS[i], d2));
      } else if (st === 0xc0) setInst(d1 % 8);
    },
    powerOn: () => powerSw.set(1),
    powerOff: () => powerSw.set(0),
  };
}
