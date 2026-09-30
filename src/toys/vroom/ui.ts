// 4台目：VROOMBOX VR-5（魔改造 子供用ドライブ・ダッシュボード）の画面
import './vroom.css';
import { Knob, SteppedKnob, SteppedSlider, Toggle, momentary } from '../../core/controls';
import { PowerHints } from '../../core/power';
import { Board, CC_POWER, noteName, applyCtl, ccMap, ccToValue, type Ctl, type HostApi, type ToyUI } from '../../core/ui';
import type { FromToy } from '../../host/protocol';
import { GEARS, STATIONS, V_KEY_COUNT, V_CRASH, V_HORN, V_NOTE, V_NOTE_BASE, V_NOTE_COUNT, V_PRESET, V_START, VROOM_INDEX, VROOM_PARAMS, type VroomParamId } from './params';

const W = 1800;
const H = 900;
const OX = 340; // おもちゃ本体の左端

const HELP = `
<h3>VROOMBOX VR-5 のキー操作</h3>
<table>
  <tr><td>POWER</td><td>左の POWER の札のイグニッションキー（クリックで ON、ON のままクリックでエンジン始動）。電源 OFF のときは Enter キーでも入る</td></tr>
  <tr><td>PageUp / PageDown</td><td>キーを ON / OFF</td></tr>
  <tr><td>Enter</td><td>エンジン始動（押している間セルが回る）</td></tr>
  <tr><td>↑ または W</td><td>アクセル（押している間）</td></tr>
  <tr><td>← →</td><td>ハンドル</td></tr>
  <tr><td>Z / X</td><td>ギアを下げる / 上げる（N・1〜5）</td></tr>
  <tr><td>Space</td><td>ホーン</td></tr>
  <tr><td>T</td><td>ターボ（押している間）</td></tr>
  <tr><td>1〜8</td><td>ラジオのプリセット（HIJACK 中はエンジンの音階 ド〜ド）</td></tr>
  <tr><td>R</td><td>ラジオの局を切り替え</td></tr>
  <tr><td>S / V / B / C</td><td>サイレン / ウインカー / ワイパー / クラッシュ</td></tr>
  <tr><td>Backspace</td><td>STARTER LOOP（押している間）</td></tr>
  <tr><td>H / U</td><td>PRESET HIJACK / TUNE スイッチ</td></tr>
</table>
<p>ハンドルは縁をつかんで回す（離すと戻る）。真ん中を押すとホーン。ペダルは押し下げている間だけ踏む。</p>
<p>改造パネル：FIRING ORDER のスイッチで点火を間引くと、低回転でリズムになる。TUNE で回転が音階にそろう。</p>
<p>MIDI（チャンネル4）：ノート 36〜95 でエンジンを直接弾く、CC1 = ハンドル、CC2 = アクセル、CC でノブ、プログラムチェンジでラジオ、CC119 でキー</p>`;

export function mountVroom(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-vroom';
  root.innerHTML = `
    <svg class="vr-wires" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <path d="M 330 180 C 360 180, 350 120, ${OX + 60} 130" />
      <path d="M 330 640 C 370 640, 350 700, ${OX + 60} 720" />
    </svg>
    <div class="vr-plate"></div>
    <div class="vr-body"></div>
    <div class="vr-dash">
      <div class="vr-gauge tach"><svg viewBox="-110 -110 220 220" data-id="tach"></svg></div>
      <div class="vr-gauge speedo"><svg viewBox="-110 -110 220 220" data-id="speedo"></svg><div class="vr-speed" data-id="speed">---</div></div>
      <div class="vr-radio"><div class="vr-radio-lcd" data-id="radioLcd">RADIO OFF</div></div>
    </div>
    <div class="vr-wheel" data-id="wheel">
      <svg viewBox="-240 -240 480 480">
        <circle r="220" class="rim" /><circle r="190" class="rim-in" />
        <path d="M -190 0 L -60 20 L 60 20 L 190 0 L 60 -20 L -60 -20 Z" class="spoke" />
        <path d="M -30 40 L 30 40 L 20 190 L -20 190 Z" class="spoke" />
        <circle r="70" class="hub" />
        <text y="10" class="hub-text">HORN</text>
        <rect x="-8" y="-222" width="16" height="30" class="mark" />
      </svg>
    </div>
    <div class="vr-hub" data-id="hub"></div>`;
  const $ = (id: string) => root.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const b = new Board(root);
  const setParam = (id: VroomParamId, v: number) => api.post({ type: 'param', index: VROOM_INDEX[id], value: v });
  const def = (id: VroomParamId) => VROOM_PARAMS[VROOM_INDEX[id]];
  const ctl: Partial<Record<VroomParamId, Ctl>> = {};
  const leds: Record<string, HTMLElement> = {};
  const key = (k: number, down: boolean) => api.post({ type: 'key', key: k, down });
  const lbl = (t: string, x: number, y: number, cls = '') => b.label(t, x, y, `vr-lbl ${cls}`);

  // ================= メーター（SVG） =================
  const gauge = (svg: SVGElement, max: number, step: number, red: number) => {
    let html = '<circle r="104" class="face" />';
    for (let v = 0; v <= max; v += step) {
      const a = ((-120 + (v / max) * 240) * Math.PI) / 180;
      const x1 = Math.sin(a) * 92, y1 = -Math.cos(a) * 92, x2 = Math.sin(a) * 80, y2 = -Math.cos(a) * 80;
      html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${v >= red ? 'tick red' : 'tick'}" />`;
      html += `<text x="${Math.sin(a) * 66}" y="${-Math.cos(a) * 66 + 4}" class="num">${max > 1000 ? v / 1000 : v}</text>`;
    }
    html += '<line x1="0" y1="10" x2="0" y2="-86" class="needle" /><circle r="9" class="cap" />';
    svg.innerHTML = html;
    return svg.querySelector('.needle') as SVGLineElement;
  };
  const tachNeedle = gauge($('tach') as unknown as SVGElement, 8000, 1000, 7000);
  const speedNeedle = gauge($('speedo') as unknown as SVGElement, 200, 20, 999);
  const setNeedle = (n: SVGLineElement, v: number, max: number, shake = 0) => {
    const a = -120 + Math.min(1.06, v / max) * 240 + shake;
    n.setAttribute('transform', `rotate(${a})`);
  };
  setNeedle(tachNeedle, 0, 8000);
  setNeedle(speedNeedle, 0, 200);
  lbl('RPM ×1000', OX + 250, 300, 'light');
  lbl('km/h', OX + 1130, 300, 'light');

  // ================= ラジオ =================
  const radioLcd = $('radioLcd');
  let station = 0, hijack = false;
  const showRadio = () => {
    radioLcd.textContent = hijack ? 'HIJACK ♪' : station ? `${STATIONS[station]}  ${['', '88.3', '92.7', '1440'][station]}` : 'RADIO OFF';
  };
  const setStation = (v: number) => { station = v; setParam('station', v); showRadio(); };
  ctl.station = { set: (v: number) => setStation(v) };
  const presetCtl = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const x = OX + 610 + (i % 4) * 60, y = i < 4 ? 250 : 296;
    const el = b.place('vr-preset', x, y, String(i + 1));
    return momentary(el, () => {
      if (hijack) key(V_PRESET + i, true);
      else setStation([1, 2, 3, 0][i % 4]);
    }, () => { if (hijack) key(V_PRESET + i, false); });
  });

  // ランプ
  leds.left = b.place('vr-arrow', OX + 480, 336, '◀');
  leds.right = b.place('vr-arrow', OX + 920, 336, '▶');
  leds.engine = b.place('vr-lamp', OX + 650, 336, 'ENGINE');
  leds.turbo = b.place('vr-lamp blue', OX + 750, 336, 'TURBO');

  // ================= 左：キー・スイッチ類 =================
  let powered = false, cranking = false;
  const keyEl = b.place('vr-key', OX + 150, 420, '<div class="vr-key-head"></div>');
  lbl('OFF   ON   START', OX + 150, 372, 'light');
  b.label('POWER', OX + 150, 340, 'power-label');
  const powerLed = b.place('led green', OX + 210, 340);
  const setKeyPos = (pos: number) => keyEl.style.setProperty('--rot', `${[-50, 0, 50][pos]}deg`);
  const powerOn = async () => { await api.start(); api.post({ type: 'power', on: true }); powered = true; setKeyPos(1); };
  const powerOff = () => { api.post({ type: 'power', on: false }); powered = false; setKeyPos(0); };
  const crank = (on: boolean) => { if (on === cranking) return; cranking = on; key(V_START, on); setKeyPos(on ? 2 : powered ? 1 : 0); };
  keyEl.addEventListener('pointerdown', (e) => {
    keyEl.setPointerCapture(e.pointerId);
    if (!powered) void powerOn();
    else crank(true);
    e.preventDefault();
  });
  keyEl.addEventListener('pointerup', () => crank(false));
  keyEl.addEventListener('pointercancel', () => crank(false));
  momentary(b.place('vr-small', OX + 150, 480, 'KEY OFF'), powerOff);
  const hints = new PowerHints(root, keyEl, powerLed, { x: OX + 215, y: 420, side: 'right' });
  setKeyPos(0);

  const toggleBtn = (id: VroomParamId, x: number, y: number, name: string, color: string) => {
    const el = b.place(`vr-btn ${color}`, x, y, name);
    let v = 0;
    const set = (nv: number) => { v = nv; el.classList.toggle('sel', !!v); setParam(id, v); };
    el.addEventListener('pointerdown', () => set(v ? 0 : 1));
    ctl[id] = { set };
    return { cycle: () => set(v ? 0 : 1) };
  };
  const sirenBtn = toggleBtn('siren', OX + 90, 570, 'SIREN', 'blue');
  const signalBtn = toggleBtn('signal', OX + 210, 570, 'SIGNAL', 'green');
  const wiperBtn = toggleBtn('wipers', OX + 90, 650, 'WIPERS', 'green');
  const crashBtn = momentary(b.place('vr-btn red', OX + 210, 650, 'CRASH!'), () => key(V_CRASH, true), () => key(V_CRASH, false));
  ctl.volume = new Knob(b.knob('black', OX + 150, 760), def('volume'), (v) => setParam('volume', v));
  lbl('VOLUME', OX + 150, 792, 'light');

  // ================= ハンドル =================
  const wheelEl = $('wheel');
  let wheelAngle = 0, grabbing = false, grabOffset = 0, sentWheel = 0, wheelKey = 0;
  const angleAt = (e: PointerEvent) => {
    const r = wheelEl.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  wheelEl.addEventListener('pointerdown', (e) => {
    wheelEl.setPointerCapture(e.pointerId);
    grabbing = true;
    grabOffset = angleAt(e) - wheelAngle;
    e.preventDefault();
  });
  wheelEl.addEventListener('pointermove', (e) => {
    if (!grabbing) return;
    let a = angleAt(e) - grabOffset;
    while (a > 180) a -= 360;
    while (a < -180) a += 360;
    wheelAngle = Math.max(-135, Math.min(135, a));
  });
  const letGo = () => { grabbing = false; };
  wheelEl.addEventListener('pointerup', letGo);
  wheelEl.addEventListener('pointercancel', letGo);
  const hornBtn = momentary($('hub'), () => key(V_HORN, true), () => key(V_HORN, false));
  ctl.wheel = { set: (v: number) => { wheelAngle = v * 135; } };

  // ================= 右：ギア・ペダル・ターボ =================
  lbl('GEAR', OX + 1210, 372, 'light');
  const gearEl = b.place('vr-gear', OX + 1210, 540, '<div class="thumb"></div>');
  const gearLabels = GEARS.map((g, i) => lbl(g, OX + 1250, 425 + i * 46, 'light'));
  const gear = new SteppedSlider(gearEl, 6, 0, (v) => { setParam('gear', v); gearLabels.forEach((l, j) => l.classList.toggle('on', j === v)); }, true);
  ctl.gear = gear;
  gearLabels[0].classList.add('on');
  lbl('ACCEL', OX + 1340, 372, 'light');
  const pedal = b.place('vr-pedal', OX + 1340, 560, '<div class="vr-pedal-top"></div>');
  let throttle = 0, pedalHeld = false, keyGas = false, sentThrottle = 0;
  const setPedal = (v: number) => { throttle = v; pedal.style.setProperty('--v', String(v)); };
  const pickPedal = (e: PointerEvent) => { const r = pedal.getBoundingClientRect(); setPedal(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))); };
  pedal.addEventListener('pointerdown', (e) => { pedal.setPointerCapture(e.pointerId); pedalHeld = true; pickPedal(e); e.preventDefault(); });
  pedal.addEventListener('pointermove', (e) => { if (pedalHeld) pickPedal(e); });
  const pedalUp = () => { pedalHeld = false; };
  pedal.addEventListener('pointerup', pedalUp);
  pedal.addEventListener('pointercancel', pedalUp);
  ctl.throttle = { set: (v: number) => setPedal(v) };
  const turboBtn = momentary(b.place('vr-btn orange big', OX + 1210, 780, 'TURBO'), () => setParam('turbo', 1), () => setParam('turbo', 0));
  ctl.turbo = turboBtn;
  b.place('vr-sticker', OX + 1340, 800, 'VR-5');

  // ================= 改造パネル（左の金属板） =================
  b.tape('FIRING ORDER', 175, 100, false, -1);
  for (let i = 0; i < 8; i++) {
    const id = `cyl${i + 1}` as VroomParamId;
    const x = 70 + (i % 4) * 70, y = i < 4 ? 160 : 240;
    ctl[id] = new Toggle(b.place('toggle small', x, y), 2, 1, (v) => setParam(id, v));
    lbl(String(i + 1), x, y - 34);
  }
  const camKnob = new SteppedKnob(b.knob('black', 175, 330), 6, 5, (v) => setParam('cam', v + 3), 250);
  ctl.cam = { set: (v: number) => camKnob.set(v - 3) };
  lbl('CAM  3 · 4 · 5 · 6 · 7 · 8', 175, 368);
  const knobP = (id: VroomParamId, x: number, y: number, name: string) => {
    ctl[id] = new Knob(b.knob('red', x, y), def(id), (v) => setParam(id, v));
    lbl(name, x, y + 32);
  };
  knobP('redline', 80, 440, 'REDLINE');
  knobP('spark', 175, 440, 'SPARK');
  knobP('radioBleed', 270, 440, 'RADIO BLEED');
  knobP('turboFb', 80, 540, 'TURBO FB');
  ctl.turboFbOn = new Toggle(b.place('toggle small', 140, 540), 2, 0, (v) => setParam('turboFbOn', v));
  const swP = (id: VroomParamId, x: number, name: string) => {
    const t = new Toggle(b.place('toggle small', x, 640), 2, 0, (v) => { setParam(id, v); if (id === 'hijack') { hijack = !!v; showRadio(); } });
    ctl[id] = t;
    lbl(name, x, 608);
    return t;
  };
  const tuneSw = swP('tune', 60, 'TUNE');
  const hijackSw = swP('hijack', 135, 'HIJACK');
  swP('hornBend', 210, 'HORN BEND');
  swP('grind', 285, 'GRIND');
  b.tape('STARTER LOOP', 90, 710, false, 1);
  const loopBtn = momentary(b.place('dome big', 90, 760), () => setParam('starterLoop', 1), () => setParam('starterLoop', 0));
  ctl.starterLoop = loopBtn;
  const touch = (id: VroomParamId, x: number, name: string) => {
    const el = b.place('stud', x, 760);
    let y0 = 0;
    const set = (v: number) => { setParam(id, v); el.style.setProperty('--glow', String(v)); el.classList.toggle('down', v > 0); };
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); y0 = e.clientY; set(0.7); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(Math.max(0.15, Math.min(1, 0.7 + (y0 - e.clientY) / 150))); });
    el.addEventListener('pointerup', () => set(0));
    el.addEventListener('pointercancel', () => set(0));
    lbl(name, x, 794);
    ctl[id] = { set };
  };
  touch('chassis', 200, 'CHASSIS');
  touch('hazard', 275, 'HAZARD');
  for (const [x, y] of [[36, 36], [314, 36], [36, 864], [314, 864]]) b.place('screw', x, y);
  b.tape('CIRCUIT BENT', OX + 700, 860, false, -1);

  // ================= アニメーション（ハンドル・ペダル・キーボード操作） =================
  let prev = performance.now();
  const anim = (now: number) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    // ハンドル：離すとバネで戻る。キーボードでも回せる
    if (wheelKey) wheelAngle = Math.max(-135, Math.min(135, wheelAngle + wheelKey * 220 * dt));
    else if (!grabbing) wheelAngle *= Math.exp(-dt / 0.12);
    wheelEl.style.transform = `rotate(${wheelAngle}deg)`;
    const w = wheelAngle / 135;
    if (Math.abs(w - sentWheel) > 0.01 || (w !== sentWheel && Math.abs(w) < 0.01)) { sentWheel = Math.abs(w) < 0.01 ? 0 : w; setParam('wheel', sentWheel); }
    // ペダル：離すと戻る。キーボードの ↑ は徐々に踏み込む
    if (keyGas) setPedal(Math.min(1, throttle + dt * 1.5));
    else if (!pedalHeld && throttle > 0) setPedal(Math.max(0, throttle - dt * 4));
    if (Math.abs(throttle - sentThrottle) > 0.005 || (throttle === 0 && sentThrottle !== 0)) { sentThrottle = throttle; setParam('throttle', throttle); }
    requestAnimationFrame(anim);
  };
  requestAnimationFrame(anim);

  // ================= PC キーボード =================
  const DIG = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'];
  const hold = (on: () => void, off: () => void) => ({ press: on, release: off });
  const momentaryFor = (code: string) => {
    const i = DIG.indexOf(code);
    if (i >= 0) return presetCtl[i];
    switch (code) {
      case 'Space': return hornBtn;
      case 'KeyT': return turboBtn;
      case 'KeyC': return crashBtn;
      case 'Backspace': return loopBtn;
      case 'Enter': return hold(() => { if (powered) crank(true); }, () => crank(false));
      case 'ArrowUp': case 'KeyW': return hold(() => { keyGas = true; }, () => { keyGas = false; });
      case 'ArrowLeft': return hold(() => { wheelKey = -1; }, () => { if (wheelKey < 0) wheelKey = 0; });
      case 'ArrowRight': return hold(() => { wheelKey = 1; }, () => { if (wheelKey > 0) wheelKey = 0; });
    }
    return null;
  };
  const actions: Record<string, () => void> = {
    KeyZ: () => gear.set(Math.max(0, gear.value - 1)),
    KeyX: () => gear.set(Math.min(5, gear.value + 1)),
    KeyR: () => setStation((station + 1) % 4),
    KeyS: () => sirenBtn.cycle(),
    KeyV: () => signalBtn.cycle(),
    KeyB: () => wiperBtn.cycle(),
    KeyH: () => hijackSw.cycle(),
    KeyU: () => tuneSw.cycle(),
    PageUp: () => void powerOn(),
    PageDown: powerOff,
  };
  const cc = ccMap(VROOM_PARAMS);
  const midiNotes = new Set<number>();

  return {
    title: 'VROOMBOX VR-5',
    powerButton: keyEl,
    paramDefs: VROOM_PARAMS,
    keyCount: V_KEY_COUNT,
    keyName: (k) => (k < 8 ? `PRESET ${k + 1}` : k === V_HORN ? 'HORN' : k === V_CRASH ? 'CRASH' : k === V_START ? 'START' : k >= V_NOTE ? `ENGINE ${noteName(V_NOTE_BASE + k - V_NOTE)}` : `KEY ${k}`),
    width: W,
    height: H,
    root,
    help: HELP,
    onMessage(m: FromToy) {
      if (m.type === 'display') {
        $('speed').textContent = (m.display as { text: string }).text || '---';
      } else if (m.type === 'status') {
        const st = m.status;
        powered = st.powered;
        powerLed.classList.toggle('lit', st.powered);
        hints.update(st.powered);
        const rpm = st.fx.rpm ?? 0;
        setNeedle(tachNeedle, rpm, 8000, rpm > 7400 ? (Math.random() - 0.5) * 6 : 0);
        setNeedle(speedNeedle, st.fx.speed ?? 0, 200);
        leds.engine.classList.toggle('lit', st.leds.running > 0);
        leds.turbo.classList.toggle('lit', st.leds.turbo > 0);
        leds.left.classList.toggle('lit', st.leds.signal > 0);
        leds.right.classList.toggle('lit', st.leds.signal > 0);
        root.classList.toggle('powered', st.powered);
        if (!st.powered) setKeyPos(0);
      }
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
      [...presetCtl, hornBtn, turboBtn, crashBtn, loopBtn].forEach((m) => m.release());
      crank(false);
      keyGas = false;
      wheelKey = 0;
    },
    midi(status, d1, d2) {
      const st = status & 0xf0;
      if (st === 0x90 || st === 0x80) {
        const k = d1 - V_NOTE_BASE;
        if (k < 0 || k >= V_NOTE_COUNT) return;
        if (st === 0x90 && d2 > 0) { midiNotes.add(k); key(V_NOTE + k, true); }
        else if (midiNotes.delete(k)) key(V_NOTE + k, false);
      } else if (st === 0xb0) {
        if (d1 === CC_POWER) (d2 >= 64 ? powerOn() : powerOff());
        const i = cc.get(d1);
        if (i !== undefined) applyCtl(ctl[VROOM_PARAMS[i].id], ccToValue(VROOM_PARAMS[i], d2));
      } else if (st === 0xc0) setStation(d1 % 4);
    },
    powerOn: () => void powerOn(),
    powerOff,
  };
}
