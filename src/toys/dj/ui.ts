// 3台目：SPIN-TOT DJ-28（魔改造 子供用 DJ セット）の画面
import { rectOf, pt } from '../../core/view';
import './dj.css';
import { Knob, SteppedKnob, Toggle, momentary } from '../../core/controls';
import { PowerHints } from '../../core/power';
import { Board, CC_POWER, noteName, applyCtl, ccMap, ccToValue, type Ctl, type HostApi, type ToyUI } from '../../core/ui';
import type { FromToy } from '../../host/protocol';
import { DISC_NAMES } from './dsp/sounds';
import {
  DJ_DISC_TOUCH, DJ_FIRST_NOTE, DJ_KEY_COUNT, DJ_INDEX, DJ_NOTE_COUNT, DJ_PAD, DJ_PARAMS, DJ_PAUSE, DJ_PLAY, DJ_TEMPO_DOWN, DJ_TEMPO_UP, type DjParamId,
} from './params';

const W = 1600;
const H = 930;

const HELP = `
<h3>SPIN-TOT DJ-28 のキー操作</h3>
<table>
  <tr><td>A W S E D F T G Y H U J K</td><td>鍵盤（C〜C）</td></tr>
  <tr><td>Z X C V B N</td><td>SOUND EFFECT パッド</td></tr>
  <tr><td>. / ,</td><td>ディスクを前に回す／逆に回す（押している間）</td></tr>
  <tr><td>1 2 3 4</td><td>リズム 1-7 / 8-14 / 15-21 / 22-28（隠し）。押すたびに次へ</td></tr>
  <tr><td>5 6 7</td><td>ディスクの音 1-7 / 8-14 / 15-21</td></tr>
  <tr><td>8 9 0 - ^</td><td>EFFECT SELECTION（パッドの音のセット）</td></tr>
  <tr><td>Space</td><td>リズム PLAY / PAUSE</td></tr>
  <tr><td>Enter</td><td>RHYTHM EFFECT（押している間、刻む）</td></tr>
  <tr><td>Backspace</td><td>STOP（押している間、テープのように止まる）</td></tr>
  <tr><td>↑ ↓</td><td>テンポ</td></tr>
  <tr><td>← →</td><td>INSTRUMENT（鍵盤の音色）</td></tr>
  <tr><td>Tab</td><td>KEYBOARD PATTERN 1 / 2（2 = アルペジオ）</td></tr>
  <tr><td>P / L</td><td>PITCH スイッチ / LIGHT スイッチ</td></tr>
  <tr><td>POWER</td><td>右下の大きな緑の POWER ボタン（OFF は右の青いボタン）。電源 OFF のときは Enter キーでも入る</td></tr>
  <tr><td>PageUp / PageDown</td><td>電源 ON / OFF</td></tr>
</table>
<p>ディスクはマウスでつかんで回すとスクラッチ。光センサー（左右の丸いレンズ）はマウスを近づけると影になり、LIGHT スイッチ ON で音程が下がる。押さえるとまっ暗。</p>
<p>MIDI（チャンネル3）：ノート 60〜72 = 鍵盤、36〜41 = パッド、CC でノブ、プログラムチェンジでリズム、CC119 で電源</p>`;

export function mountDj(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-dj';
  root.innerHTML = `
    <div class="dj-left"><div class="dj-rings"></div></div>
    <div class="dj-mid"><div class="dj-padframe"></div><div class="dj-strip">SPIN-TOT <b>DJ-28</b></div></div>
    <div class="dj-kb"><div class="dj-grille"></div><div class="dj-keys" data-id="keys"></div></div>
    <div class="dj-display" data-id="display">--</div>
    <div class="dj-disc-ring"></div>
    <div class="dj-disc" data-id="disc"><div class="dj-label"><b>SPIN</b><i>TOT</i></div></div>`;
  const $ = (id: string) => root.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const b = new Board(root);
  const setParam = (id: DjParamId, v: number) => api.post({ type: 'param', index: DJ_INDEX[id], value: v });
  const def = (id: DjParamId) => DJ_PARAMS[DJ_INDEX[id]];
  const ctl: Partial<Record<DjParamId, Ctl>> = {};
  const leds: Record<string, HTMLElement> = {};
  const key = (k: number, down: boolean) => api.post({ type: 'key', key: k, down });
  const lbl = (t: string, x: number, y: number) => b.label(t, x, y, 'dj-lbl');
  const lblD = (t: string, x: number, y: number) => b.label(t, x, y, 'dj-lbl dark');
  const box = (t: string, x: number, y: number) => b.place('dj-box', x, y, t);

  // ================= 左ユニット：ピッチ・リズム／ディスク選択・光センサー =================
  b.tape('PITCH', 432, 300, true, 2);
  const pitchSw = new Toggle(b.place('toggle small', 400, 318), 2, 0, (v) => setParam('pitchOn', v));
  ctl.pitchOn = pitchSw;
  ctl.pitchCoarse = new Knob(b.knob('black', 110, 372), def('pitchCoarse'), (v) => setParam('pitchCoarse', v));
  lbl('COARSE', 110, 402);
  box('FINE', 330, 372);
  ctl.pitchFine = new Knob(b.knob('black', 390, 372), def('pitchFine'), (v) => setParam('pitchFine', v));

  let rhythm = 0, disc = 0, bank = 0, inst = 0;
  const setRhythm = (v: number) => { rhythm = v; setParam('rhythm', v); syncLeds(); };
  const setDisc = (v: number) => { disc = v; setParam('discFx', v); syncLeds(); };
  const rhythmBtns = [0, 1, 2, 3].map((g) => {
    const el = b.place('dj-dot blue', 82 + g * 50, 450);
    el.addEventListener('pointerdown', () => setRhythm(Math.floor(rhythm / 7) === g ? g * 7 + ((rhythm % 7) + 1) % 7 : g * 7));
    return el;
  });
  const discBtns = [0, 1, 2].map((g) => {
    const el = b.place('dj-dot red', 292 + g * 50, 450);
    el.addEventListener('pointerdown', () => setDisc(Math.floor(disc / 7) === g ? g * 7 + ((disc % 7) + 1) % 7 : g * 7));
    return el;
  });
  lbl('1-7 · 8-14 · 15-21', 132, 486);
  lbl('RHYTHM SELECTION', 132, 500);
  box('22-28', 232, 490);
  lbl('1-7 · 8-14 · 15-21', 342, 486);
  lbl('DISC EFFECT SELECTION', 342, 500);
  const discName = lbl('', 342, 516);
  function syncLeds(): void {
    rhythmBtns.forEach((el, g) => el.classList.toggle('sel', Math.floor(rhythm / 7) === g));
    discBtns.forEach((el, g) => el.classList.toggle('sel', Math.floor(disc / 7) === g));
    discName.textContent = DISC_NAMES[disc];
  }
  ctl.rhythm = { set: (v: number) => setRhythm(v) };
  ctl.discFx = { set: (v: number) => setDisc(v) };
  syncLeds();

  // 光センサー（左右の丸いレンズ）
  const sensors = [b.place('dj-sensor', 90, 562), b.place('dj-sensor', 410, 562)];
  b.tape('LIGHT', 40, 630, true, -2);
  const lightSw = new Toggle(b.place('toggle small', 76, 620), 2, 0, (v) => setParam('lightOn', v));
  ctl.lightOn = lightSw;
  let covered = false;
  let light = 1;
  let sentLight = 1;
  const setLight = (v: number) => {
    light = v;
    sensors.forEach((s) => s.style.setProperty('--dark', String(1 - v)));
  };
  window.addEventListener('pointermove', (e) => {
    if (root.offsetParent === null || covered) return;
    let d = Infinity;
    let scale = 1;
    for (const s of sensors) {
      const r = rectOf(s);
      scale = r.width / 44;
      d = Math.min(d, Math.hypot(pt(e).x - (r.left + r.width / 2), pt(e).y - (r.top + r.height / 2)) / scale);
    }
    setLight(Math.max(0, Math.min(1, (d - 20) / 200)));
  });
  document.addEventListener('pointerleave', () => { if (!covered) setLight(1); });
  sensors.forEach((s) => {
    s.addEventListener('pointerdown', (e) => { covered = true; s.setPointerCapture(e.pointerId); setLight(0); e.preventDefault(); });
    const up = () => { covered = false; setLight(1); };
    s.addEventListener('pointerup', up);
    s.addEventListener('pointercancel', up);
  });
  ctl.light = { set: (v: number) => setLight(v) };

  // ================= ディスク（スクラッチ） =================
  const discEl = $('disc');
  let angle = 0, lastAngle = 0, lastT = 0, spin = 0, touching = false, lastMove = 0, sentZero = true;
  const angleOf = (e: PointerEvent) => {
    const r = rectOf(discEl);
    return Math.atan2(pt(e).y - (r.top + r.height / 2), pt(e).x - (r.left + r.width / 2));
  };
  const sendSpeed = (v: number) => { setParam('discSpeed', Math.max(-4, Math.min(4, v))); sentZero = v === 0; };
  discEl.addEventListener('pointerdown', (e) => {
    discEl.setPointerCapture(e.pointerId);
    touching = true;
    lastAngle = angleOf(e);
    lastT = performance.now();
    lastMove = lastT;
    spin = 0;
    key(DJ_DISC_TOUCH, true);
    e.preventDefault();
  });
  discEl.addEventListener('pointermove', (e) => {
    if (!touching) return;
    const a = angleOf(e);
    let d = a - lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    const now = performance.now();
    const dt = Math.max(1, now - lastT) / 1000;
    angle += d;
    spin = spin * 0.5 + (d / dt) * 0.5; // ラジアン/秒
    lastAngle = a;
    lastT = now;
    lastMove = now;
    sendSpeed(spin / (2 * Math.PI * 0.55)); // 1 = レコードの普通の速さ（約 33 回転）
  });
  const release = () => {
    if (!touching) return;
    touching = false;
    sendSpeed(0);
    key(DJ_DISC_TOUCH, false);
  };
  discEl.addEventListener('pointerup', release);
  discEl.addEventListener('pointercancel', release);
  const label = discEl.querySelector('.dj-label') as HTMLElement;
  let prevT = performance.now();
  const anim = (now: number) => {
    const dt = (now - prevT) / 1000;
    prevT = now;
    if (touching && now - lastMove > 60 && !sentZero) { spin = 0; sendSpeed(0); } // 手を止めたら止まる
    if (!touching) { spin *= Math.exp(-dt / 0.15); angle += spin * dt; }
    label.style.transform = `rotate(${angle}rad)`;
    // 光センサーの値は画面の更新ごとにまとめて送る
    if (Math.abs(light - sentLight) > 0.02 || (light !== sentLight && (light === 0 || light === 1))) { sentLight = light; setParam('light', light); }
    requestAnimationFrame(anim);
  };
  requestAnimationFrame(anim);
  // キーボードでスクラッチ
  const scratchKey = (speed: number) => ({
    press: () => { touching = true; key(DJ_DISC_TOUCH, true); spin = speed * 2 * Math.PI * 0.55; lastMove = Infinity; sendSpeed(speed); },
    release: () => { lastMove = performance.now(); release(); },
  });
  const scratchFwd = scratchKey(1.5), scratchBack = scratchKey(-1.5);

  // ディスクのまわり：DIST・FEEDBACK・ソース切替・DIST 2
  lbl('DIST', 50, 700);
  ctl.dist1On = new Toggle(b.place('toggle small', 60, 730), 2, 0, (v) => setParam('dist1On', v));
  ctl.dist1 = new Knob(b.knob('black', 70, 800), def('dist1'), (v) => setParam('dist1', v));
  lbl('FEEDBACK', 150, 905);
  ctl.feedback = new Knob(b.knob('black big', 150, 862), def('feedback'), (v) => setParam('feedback', v));
  const fbSrc = new SteppedKnob(b.knob('black', 250, 880), 3, def('fbSource').default, (v) => setParam('fbSource', v), 180);
  ctl.fbSource = fbSrc;
  lbl('RHY', 220, 850); lbl('DISC', 250, 845); lbl('ALL', 282, 850);
  lbl('DIST 2', 440, 700);
  ctl.dist2On = new Toggle(b.place('toggle small', 432, 730), 2, 0, (v) => setParam('dist2On', v));
  ctl.dist2 = new Knob(b.knob('black', 422, 800), def('dist2'), (v) => setParam('dist2', v));
  leds.beat = b.place('led', 250, 330);

  // ================= 真ん中ユニット：パッド・エフェクト選択・リズム操作 =================
  const padCtl = [0, 1, 2, 3, 4, 5].map((p) => {
    const x = 580 + (p % 3) * 150, y = p < 3 ? 140 : 300;
    return momentary(b.place('dj-pad', x, y), () => key(DJ_PAD + p, true), () => key(DJ_PAD + p, false));
  });
  lblD('SOUND  EFFECT', 730, 222);
  const bankBtns = [0, 1, 2, 3, 4].map((i) => {
    const x = 560 + i * 85;
    lblD(`${i * 2 + 1}/${i * 2 + 2}`, x, 404);
    const el = b.place('dj-yellow', x, 428);
    el.addEventListener('pointerdown', () => setBank(bank === i * 2 ? i * 2 + 1 : i * 2));
    return el;
  });
  const bankView = box('EFFECT SELECTION 1', 620, 466);
  const setBank = (v: number) => {
    bank = v;
    bankBtns.forEach((el, i) => el.classList.toggle('sel', Math.floor(v / 2) === i));
    bankView.textContent = `EFFECT SELECTION ${v + 1}`;
    setParam('sfxBank', v);
  };
  ctl.sfxBank = { set: (v: number) => setBank(v) };
  setBank(0);

  lblD('RHYTHM EFFECT ✂', 745, 500);
  const fxBtn = momentary(b.place('dj-red', 745, 530), () => setParam('rhythmFx', 1), () => setParam('rhythmFx', 0));
  ctl.rhythmFx = fxBtn;
  lblD('PAUSE ⏸', 825, 500);
  const pauseEl = b.place('dj-red', 825, 530);
  const pauseBtn = momentary(pauseEl, () => key(DJ_PAUSE, true), () => key(DJ_PAUSE, false));
  lblD('PLAY ▶', 905, 500);
  const playEl = b.place('dj-red', 905, 530);
  const playBtn = momentary(playEl, () => key(DJ_PLAY, true), () => key(DJ_PLAY, false));
  const tempoUp = momentary(b.place('dj-grey', 770, 600, '▲'), () => key(DJ_TEMPO_UP, true), () => key(DJ_TEMPO_UP, false));
  const tempoDn = momentary(b.place('dj-grey', 880, 600, '▼'), () => key(DJ_TEMPO_DOWN, true), () => key(DJ_TEMPO_DOWN, false));
  lblD('▲ RHYTHM TEMPO ▼', 825, 638);
  b.tape('STOP', 958, 572, true, 1);
  const haltBtn = momentary(b.place('dome', 955, 634), () => setParam('halt', 1), () => setParam('halt', 0));
  ctl.halt = haltBtn;
  leds.halt = b.place('led', 955, 668);

  // 縦のスライダー（RHYTHM VOLUME / SOUND EFFECT VOLUME）
  const slider = (id: DjParamId, x: number, name: string) => {
    lblD(name, x, 668);
    const el = b.place('dj-slider', x, 790, '<div class="dj-thumb"></div>');
    const set = (v: number, notify = true) => { el.style.setProperty('--v', String(v)); if (notify) setParam(id, v); };
    const pick = (e: PointerEvent) => { const r = rectOf(el); set(Math.max(0, Math.min(1, 1 - (pt(e).y - r.top) / r.height))); };
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); pick(e); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) pick(e); });
    set(def(id).default, false);
    ctl[id] = { set };
  };
  slider('rhythmVol', 560, 'RHYTHM VOL');
  slider('sfxVol', 640, 'EFFECT VOL');
  lblD('AUX/CD', 795, 690);
  b.place('dj-blue', 760, 716); b.place('dj-blue', 830, 716);
  leds.power = b.place('led green', 795, 760);
  const powerOn = async () => { await api.start(); api.post({ type: 'power', on: true }); };
  const powerOff = () => api.post({ type: 'power', on: false });
  // 大きな POWER（ON）ボタンと、小さな OFF
  const powerBtn = b.place('dome green big power', 752, 800);
  momentary(powerBtn, () => void powerOn());
  b.label('POWER', 752, 846, 'power-label');
  momentary(b.place('dj-blue', 836, 800), powerOff);
  lblD('OFF', 836, 836);
  const hints = new PowerHints(root, powerBtn, leds.power, { x: 700, y: 800, side: 'left' });
  ctl.volume = new Knob(b.knob('blue big', 915, 770), def('volume'), (v) => setParam('volume', v));
  lblD('+   VOLUME   −', 915, 818);
  b.tape('CIRCUIT BENT', 915, 690, false, -2);

  // ================= 右ユニット：ミニ鍵盤 =================
  lbl('KEYBOARD PATTERN', 1062, 392);
  const patBtns = [0, 1].map((i) => {
    lbl(String(i + 1), 1032 + i * 60, 408);
    const el = b.place('dj-teal', 1032 + i * 60, 434);
    el.addEventListener('pointerdown', () => setPat(i));
    return el;
  });
  let pat = 0;
  const setPat = (v: number) => { pat = v; patBtns.forEach((el, i) => el.classList.toggle('sel', i === v)); setParam('kbPattern', v); };
  ctl.kbPattern = { set: (v: number) => setPat(v) };
  setPat(0);
  lbl('INSTRUMENT', 1320, 392);
  const instBtns = [0, 1, 2, 3, 4].map((i) => {
    const x = 1180 + i * 70;
    lbl(`${i * 2 + 1}/${i * 2 + 2}`, x, 408);
    const el = b.place('dj-teal', x, 434);
    el.addEventListener('pointerdown', () => setInst(inst === i * 2 ? i * 2 + 1 : i * 2));
    return el;
  });
  const setInst = (v: number) => { inst = v; instBtns.forEach((el, i) => el.classList.toggle('sel', Math.floor(v / 2) === i)); setParam('instrument', v); };
  ctl.instrument = { set: (v: number) => setInst(v) };
  setInst(0);

  const keysEl = $('keys');
  const keyCtl: { press: () => void; release: () => void }[] = [];
  const whiteW = 64;
  let white = 0;
  const blacks: HTMLElement[] = [];
  for (let k = 0; k < DJ_NOTE_COUNT; k++) {
    const pc = (DJ_FIRST_NOTE + k) % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(pc);
    const el = document.createElement('div');
    el.className = isBlack ? 'dj-key black' : 'dj-key';
    el.style.left = `${isBlack ? white * whiteW - 18 : white * whiteW}px`;
    if (!isBlack) { el.style.width = `${whiteW - 3}px`; white++; }
    (isBlack ? blacks : []).push(el);
    keysEl.appendChild(el);
    keyCtl[k] = momentary(el, () => key(k, true), () => key(k, false));
  }
  blacks.forEach((el) => keysEl.appendChild(el)); // 黒鍵を上に

  // ================= 表示 =================
  const display = $('display');

  // ================= PC キーボード =================
  const PIANO = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK'];
  const PADS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN'];
  const RB = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
  const DB = ['Digit5', 'Digit6', 'Digit7'];
  const EB = ['Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
  let running = false;
  const momentaryFor = (code: string) => {
    let i = PIANO.indexOf(code);
    if (i >= 0) return keyCtl[i];
    i = PADS.indexOf(code);
    if (i >= 0) return padCtl[i];
    if (code === 'Period') return scratchFwd;
    if (code === 'Comma') return scratchBack;
    if (code === 'Enter') return fxBtn;
    if (code === 'Backspace') return haltBtn;
    return null;
  };
  const tap = (m: { press(): void; release(): void }) => { m.press(); m.release(); };
  const click = (el: HTMLElement) => el.dispatchEvent(new PointerEvent('pointerdown'));
  const actions = (code: string): (() => void) | null => {
    let i = RB.indexOf(code);
    if (i >= 0) return () => click(rhythmBtns[i]);
    i = DB.indexOf(code);
    if (i >= 0) return () => click(discBtns[i]);
    i = EB.indexOf(code);
    if (i >= 0) return () => click(bankBtns[i]);
    const a: Record<string, () => void> = {
      Space: () => tap(running ? pauseBtn : playBtn),
      ArrowUp: () => tap(tempoUp),
      ArrowDown: () => tap(tempoDn),
      ArrowLeft: () => setInst((inst + 9) % 10),
      ArrowRight: () => setInst((inst + 1) % 10),
      Tab: () => setPat(1 - pat),
      KeyP: () => pitchSw.cycle(),
      KeyL: () => lightSw.cycle(),
      PageUp: () => void powerOn(),
      PageDown: powerOff,
    };
    return a[code] ?? null;
  };
  const cc = ccMap(DJ_PARAMS);

  return {
    title: 'SPIN-TOT DJ-28',
    powerButton: powerBtn,
    paramDefs: DJ_PARAMS,
    keyCount: DJ_KEY_COUNT,
    keyName: (k) => (k < DJ_NOTE_COUNT ? noteName(DJ_FIRST_NOTE + k) : ['PAD 1', 'PAD 2', 'PAD 3', 'PAD 4', 'PAD 5', 'PAD 6', 'PLAY', 'PAUSE', 'TEMPO+', 'TEMPO−', 'DISC'][k - DJ_PAD] ?? `KEY ${k}`),
    width: W,
    height: H,
    root,
    help: HELP,
    onMessage(m: FromToy) {
      if (m.type === 'display') {
        display.textContent = (m.display as { text: string }).text || '';
      } else if (m.type === 'status') {
        const st = m.status;
        leds.power.classList.toggle('lit', st.powered);
        hints.update(st.powered);
        leds.beat.classList.toggle('lit', st.leds.beat > 0);
        leds.halt.classList.toggle('lit', st.leds.halt > 0);
        running = st.leds.run > 0;
        playEl.classList.toggle('sel', running);
        root.classList.toggle('hidden-pattern', st.leds.hidden > 0);
        display.classList.toggle('off', !st.powered);
      }
    },
    keyDown(e) {
      // 電源 OFF のとき：Enter で電源 ON。ほかのキーは POWER を光らせて教える
      if (!hints.powered && e.code === 'Enter') { if (!e.repeat) void powerOn(); return true; }
      if (!hints.powered && e.code !== 'PageUp' && e.code !== 'PageDown' && !e.repeat && (momentaryFor(e.code) || actions(e.code))) hints.nudge();
      const m = momentaryFor(e.code);
      if (m) { if (!e.repeat) m.press(); return true; }
      const a = actions(e.code);
      if (a) { if (!e.repeat) a(); return true; }
      return false;
    },
    keyUp(e) {
      momentaryFor(e.code)?.release();
    },
    releaseAll() {
      [...keyCtl, ...padCtl, fxBtn, haltBtn, scratchFwd, scratchBack].forEach((m) => m.release());
    },
    midi(status, d1, d2) {
      const st = status & 0xf0;
      const on = st === 0x90 && d2 > 0;
      if (st === 0x90 || st === 0x80) {
        const k = d1 - DJ_FIRST_NOTE;
        const p = d1 - 36;
        const t = k >= 0 && k < DJ_NOTE_COUNT ? keyCtl[k] : p >= 0 && p < 6 ? padCtl[p] : null;
        if (t) (on ? t.press() : t.release());
      } else if (st === 0xb0) {
        if (d1 === CC_POWER) (d2 >= 64 ? powerOn() : powerOff());
        const i = cc.get(d1);
        if (i === undefined) return;
        const id = DJ_PARAMS[i].id;
        const v = ccToValue(DJ_PARAMS[i], d2);
        if (id === 'discSpeed') setParam('discSpeed', Math.abs(v) < 0.08 ? 0 : v);
        else applyCtl(ctl[id], v);
      } else if (st === 0xc0) setRhythm(d1 % 28);
    },
    powerOn: () => void powerOn(),
    powerOff,
  };
}
