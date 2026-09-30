// 5台目：TYPOTRON TT-109（PC キーボードそのものを魔改造した楽器）の画面。
// 目の前の PC キーボードでそのまま弾ける。画面のキーは押されたキーが光り、各キーの役目が小さく書いてある。
import './typo.css';
import { Knob, momentary } from '../../core/controls';
import { PowerHints } from '../../core/power';
import { Board, CC_POWER, noteName, applyCtl, ccMap, ccToValue, type Ctl, type HostApi, type ToyUI } from '../../core/ui';
import type { FromToy } from '../../host/protocol';
import {
  LAYOUT, NAV, NUMPAD, RAW_NOTE, TYPO_KEYS, SCALE_STEPS, TYPO_INDEX, TYPO_KEY_INDEX, TYPO_PARAMS, type Role, type TypoParamId,
} from './params';
import type { TypoDisplay } from './dsp/engine';

const W = 1780;
const H = 850;
const U = 62; // キー 1 個の幅
const X0 = 209; // キーボードの左端
const Y0 = 292; // F キーの段の上端
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const HELP = `
<h3>TYPOTRON TT-109：キーボードそのものが楽器</h3>
<table>
  <tr><td>Z 段 / A 段 / Q 段 / 数字段</td><td>音階（下の段ほど低い。1 段上がると約 4 度上）</td></tr>
  <tr><td>Space</td><td>SUSTAIN（押している間、音が伸びる）</td></tr>
  <tr><td>左 Shift / 右 Shift</td><td>押している間 1 オクターブ下 / 上</td></tr>
  <tr><td>Enter</td><td>打った音の「行」をループ再生（もう一度で止める）</td></tr>
  <tr><td>BS / Esc</td><td>行の最後の 1 文字を消す / 行を全部消す</td></tr>
  <tr><td>Ins</td><td>上書きモード（ループ中に打つと、今鳴っている所を書き換える）</td></tr>
  <tr><td>Del</td><td>CORRUPT（押している間、音が壊れる）</td></tr>
  <tr><td>Tab</td><td>STUTTER（押している間、同じ所を繰り返す）</td></tr>
  <tr><td>Caps</td><td>LATCH（押した音が離しても鳴りっぱなし。もう一度押すと止まる）</td></tr>
  <tr><td>← →</td><td>ピッチベンド（押している間）</td></tr>
  <tr><td>↑ ↓</td><td>移調（音階 1 つ分ずつ）</td></tr>
  <tr><td>Home / End</td><td>テンポ + / −</td></tr>
  <tr><td>F1〜F4</td><td>波形 PULSE / SAW / BELL / NOISE</td></tr>
  <tr><td>F5〜F8</td><td>音階 MAJOR / MINOR / PENTA / BENT</td></tr>
  <tr><td>F9〜F12</td><td>キーボードの故障：GHOST / SCAN / BOUNCE / OVERFLOW（ON/OFF）</td></tr>
  <tr><td>テンキー・無変換・変換・かな</td><td>ドラム</td></tr>
  <tr><td>POWER</td><td>キーボード左上の大きな緑の POWER ボタン（押すたびに ON / OFF）。電源 OFF のときは Enter キーでも入る</td></tr>
  <tr><td>PgUp / PgDn</td><td>電源 ON / OFF</td></tr>
</table>
<p>F6・F7・F11・F12 などはブラウザによっては先に取られてしまうことがあります。そのときは画面のキーをクリックしてください。</p>
<p>MIDI（チャンネル5）：ノートはそのままの音の高さ、CC でノブ、プログラムチェンジで波形、CC119 で電源</p>`;

interface CapDef { code: string; label: string; role: Role; fnLabel?: string; x: number; y: number; w: number; h: number }

function allCaps(): CapDef[] {
  const caps: CapDef[] = [];
  LAYOUT.forEach((row, r) => {
    let x = 0;
    for (const k of row) {
      if (k.code) caps.push({ code: k.code, label: k.label, role: k.role, fnLabel: k.fnLabel, x, y: r === 0 ? 0 : r + 0.3, w: k.w, h: 1 });
      x += k.w;
    }
  });
  for (const k of NAV) caps.push({ ...k, x: 15.5 + k.x, y: k.y + 0.3 - (k.y >= 4 ? 0 : 0), w: 1, h: 1 });
  for (const k of NUMPAD) caps.push({ ...k, x: 19 + k.x, y: k.y + 0.3, w: k.w ?? 1, h: k.h ?? 1 });
  return caps;
}

export function mountTypo(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-typo';
  root.innerHTML = `
    <div class="tt-plate">
      <div class="tt-brand">TYPOTRON <b>TT-109</b><i>circuit bent</i></div>
      <div class="tt-lcd"><div class="tt-line" data-id="line"></div><div class="tt-info" data-id="info"></div></div>
    </div>
    <div class="tt-case"></div>
    <div class="tt-keys" data-id="keys"></div>`;
  const $ = (id: string) => root.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const b = new Board(root);
  const setParam = (id: TypoParamId, v: number) => api.post({ type: 'param', index: TYPO_INDEX[id], value: v });
  const def = (id: TypoParamId) => TYPO_PARAMS[TYPO_INDEX[id]];
  const ctl: Partial<Record<TypoParamId, Ctl>> = {};
  const leds: Record<string, HTMLElement> = {};

  // ================= 増設したツマミ（上の金属板） =================
  const knobs: [TypoParamId, string][] = [
    ['volume', 'VOLUME'], ['decay', 'DECAY'], ['tone', 'TONE'], ['drive', 'DRIVE'], ['crush', 'CRUSH'], ['echo', 'ECHO'],
    ['tempo', 'TEMPO'], ['bendRange', 'BEND RNG'], ['ghostAmt', 'GHOST'], ['scanRate', 'SCAN RATE'], ['bounceAmt', 'BOUNCE'], ['click', 'CLICK'],
  ];
  knobs.forEach(([id, name], i) => {
    const x = 800 + i * 80, y = 110;
    ctl[id] = new Knob(b.knob(i < 6 ? 'red' : i < 8 ? 'black' : 'chrome', x, y), def(id), (v) => setParam(id, v));
    b.label(name, x, y + 36, 'tt-lbl');
  });
  const ledNames: [string, string][] = [
    ['power', 'POWER'], ['loop', 'LOOP'], ['latch', 'LATCH'], ['overwrite', 'OVR'], ['stutter', 'STUT'], ['corrupt', 'CORRUPT'],
    ['ghost', 'GHOST'], ['scan', 'SCAN'], ['bounce', 'BOUNCE'], ['overflow', 'OVERFLOW'],
  ];
  ledNames.forEach(([id, name], i) => {
    const x = 830 + i * 92;
    leds[id] = b.place(`led ${id === 'power' ? 'green' : id === 'loop' || id === 'latch' ? 'yellow' : ''}`, x, 200);
    b.label(name, x, 222, 'tt-lbl');
  });
  for (const [x, y] of [[44, 40], [1736, 40], [44, 234], [1736, 234]]) b.place('screw', x, y);
  // キーボードの左上に大きな POWER ボタン（押すたびに ON / OFF）
  let poweredNow = false;
  const powerOn = () => void api.start().then(() => api.post({ type: 'power', on: true }));
  const powerOff = () => api.post({ type: 'power', on: false });
  const powerLed = b.place('led green', 120, 368);
  const powerBtn = b.place('dome green big power', 120, 430);
  momentary(powerBtn, () => (poweredNow ? powerOff() : powerOn()));
  b.label('POWER', 120, 478, 'power-label');
  const hints = new PowerHints(root, powerBtn, powerLed, { x: 176, y: 430, side: 'right' });

  // ================= キーボード =================
  const keysEl = $('keys');
  const capEls = new Map<string, HTMLElement>();
  const noteCaps: { el: HTMLElement; row: number; col: number }[] = [];
  const bendCaps: Partial<Record<string, HTMLElement>> = {};
  const waveCaps: HTMLElement[] = [];
  const scaleCaps: HTMLElement[] = [];
  const keyCtl = new Map<string, { press(): void; release(): void }>();
  for (const c of allCaps()) {
    const el = document.createElement('div');
    el.className = `tt-key role-${c.role.r}`;
    if (c.role.r === 'note') el.classList.add(`row${c.role.row}`);
    el.style.left = `${X0 + c.x * U}px`;
    el.style.top = `${Y0 + c.y * U}px`;
    el.style.width = `${c.w * U - 5}px`;
    el.style.height = `${c.h * U - 5}px`;
    el.innerHTML = `<span class="top">${c.label}</span><span class="fn">${c.fnLabel ?? ''}</span>`;
    keysEl.appendChild(el);
    capEls.set(c.code, el);
    if (c.role.r === 'note') noteCaps.push({ el, row: c.role.row, col: c.role.col });
    if (c.role.r === 'bend') bendCaps[c.role.p] = el;
    if (c.role.r === 'wave') waveCaps[c.role.n] = el;
    if (c.role.r === 'scale') scaleCaps[c.role.n] = el;
    const idx = TYPO_KEY_INDEX.get(c.code);
    if (idx === undefined) continue;
    const down = () => {
      if (c.code === 'PageUp') void api.start().then(() => api.post({ type: 'power', on: true }));
      if (c.code === 'PageDown') api.post({ type: 'power', on: false });
      api.post({ type: 'key', key: idx, down: true });
    };
    keyCtl.set(c.code, momentary(el, down, () => api.post({ type: 'key', key: idx, down: false })));
  }

  // 音のキーの下に音名を出す（音階・移調・オクターブで変わる）
  let scale = 0, transpose = 0, oct = 0, wave = 0;
  const relabel = () => {
    const st = SCALE_STEPS[scale];
    for (const n of noteCaps) {
      const deg = n.col + n.row * 3 + transpose;
      const o = Math.floor(deg / st.length);
      const semi = st[((deg % st.length) + st.length) % st.length];
      const midi = 48 + o * 12 + Math.round(semi) + oct * 12;
      (n.el.querySelector('.fn') as HTMLElement).textContent = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}${semi % 1 ? '~' : ''}`;
    }
    waveCaps.forEach((el, i) => el.classList.toggle('sel', i === wave));
    scaleCaps.forEach((el, i) => el.classList.toggle('sel', i === scale));
  };
  relabel();

  // ================= 画面の液晶 =================
  const lineEl = $('line');
  const infoEl = $('info');
  const showDisplay = (d: TypoDisplay) => {
    lineEl.innerHTML = '';
    [...d.line].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch;
      if (i === d.cursor) s.className = 'cur';
      lineEl.appendChild(s);
    });
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '_';
    lineEl.appendChild(caret);
    infoEl.textContent = d.info || 'POWER ボタン（Enter）で電源 ON';
  };
  showDisplay({ line: '', cursor: -1, info: '' });

  // ================= PC キーボード =================
  const cc = ccMap(TYPO_PARAMS);
  const midiHeld = new Set<number>();
  return {
    title: 'TYPOTRON TT-109',
    powerButton: powerBtn,
    paramDefs: TYPO_PARAMS,
    keyCount: TYPO_KEYS.length,
    keyName: (k) => (k >= RAW_NOTE ? `MIDI ${noteName(k - RAW_NOTE)}` : TYPO_KEYS[k] ? `${TYPO_KEYS[k].label} ${TYPO_KEYS[k].role.r === 'note' ? '' : TYPO_KEYS[k].code}`.trim() : `KEY ${k}`),
    width: W,
    height: H,
    root,
    help: HELP,
    onMessage(m: FromToy) {
      if (m.type === 'display') showDisplay(m.display as TypoDisplay);
      else if (m.type === 'status') {
        const st = m.status;
        leds.power.classList.toggle('lit', st.powered);
        powerLed.classList.toggle('lit', st.powered);
        poweredNow = st.powered;
        hints.update(st.powered);
        for (const id of ['loop', 'latch', 'overwrite', 'stutter', 'corrupt', 'ghost', 'scan', 'bounce', 'overflow']) leds[id].classList.toggle('lit', st.leds[id] > 0.5);
        for (const p of ['ghost', 'scan', 'bounce', 'overflow']) bendCaps[p]?.classList.toggle('sel', st.leds[p] > 0.5);
        capEls.get('CapsLock')?.classList.toggle('sel', st.leds.latch > 0.5);
        capEls.get('Insert')?.classList.toggle('sel', st.leds.overwrite > 0.5);
        capEls.get('Enter')?.classList.toggle('sel', st.leds.loop > 0.5);
        const f = st.fx;
        if (f.scale !== scale || f.transpose !== transpose || f.oct !== oct || f.wave !== wave) {
          scale = f.scale ?? 0; transpose = f.transpose ?? 0; oct = f.oct ?? 0; wave = f.wave ?? 0;
          relabel();
        }
      }
    },
    keyDown(e) {
      // 電源 OFF のとき：Enter で電源 ON。ほかのキーは POWER を光らせて教える
      if (!hints.powered && e.code === 'Enter') { if (!e.repeat) void powerOn(); return true; }
      if (!hints.powered && e.code !== 'PageUp' && e.code !== 'PageDown' && !e.repeat && keyCtl.has(e.code)) hints.nudge();
      const k = keyCtl.get(e.code);
      if (!k) return false;
      if (!e.repeat) k.press();
      return true;
    },
    keyUp(e) {
      keyCtl.get(e.code)?.release();
    },
    releaseAll() {
      keyCtl.forEach((k) => k.release());
    },
    midi(status, d1, d2) {
      const st = status & 0xf0;
      if (st === 0x90 && d2 > 0) { midiHeld.add(d1); api.post({ type: 'key', key: RAW_NOTE + d1, down: true }); }
      else if ((st === 0x80 || st === 0x90) && midiHeld.delete(d1)) api.post({ type: 'key', key: RAW_NOTE + d1, down: false });
      else if (st === 0xb0) {
        if (d1 === CC_POWER) {
          if (d2 >= 64) void api.start().then(() => api.post({ type: 'power', on: true }));
          else api.post({ type: 'power', on: false });
        }
        const i = cc.get(d1);
        if (i === undefined) return;
        const p = TYPO_PARAMS[i];
        const v = ccToValue(p, d2);
        if (ctl[p.id]) applyCtl(ctl[p.id], v);
        else setParam(p.id, v);
      } else if (st === 0xc0) setParam('wave', d1 % 4);
    },
    powerOn,
    powerOff,
  };
}
