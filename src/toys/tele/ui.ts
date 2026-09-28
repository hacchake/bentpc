// 6台目：TELEKEY TK-6（ブラウン管モニター付きの魔改造キーボード）の画面。
// フェーズ1：モニター＋キーボードの骨組み、3 つの入力モード、PC キーボードと画面のキーの連動。
import './tele.css';
import { Board, CC_POWER, ccMap, ccToValue, type HostApi, type ToyUI } from '../../core/ui';
import type { FromToy } from '../../host/protocol';
import { GLITCHES, TELE_INDEX, TELE_KEYS, TELE_KEY_INDEX, TELE_LAYOUT, TELE_NAV, TELE_PARAMS, type Role } from './params';
import { VideoPipeline } from './video/pipeline';
import { Sources, type SourceKind } from './video/sources';

const W = 1780;
const H = 1080;
const U = 58;
const X0 = 353;
const Y0 = 662;

const HELP = `
<h3>TELEKEY TK-6：映像＋音のグリッチ・マシン</h3>
<table>
  <tr><td>入力</td><td>モニターの下で YOUTUBE / TAB / FILE / CAM を選ぶ</td></tr>
  <tr><td>文字キー（Q〜］）</td><td>押している間だけ効くグリッチ（映像＋音）※フェーズ2</td></tr>
  <tr><td>Z〜＼</td><td>音を足す楽器キー ※フェーズ2</td></tr>
  <tr><td>1〜0</td><td>キューポイント（動画の 10%〜90%・0%）</td></tr>
  <tr><td>Space</td><td>FREEZE ※フェーズ2</td></tr>
  <tr><td>Home</td><td>再生 / 一時停止</td></tr>
  <tr><td>← →</td><td>5 秒戻る / 進む</td></tr>
  <tr><td>PgUp / PgDn</td><td>電源 ON / OFF</td></tr>
</table>
<p>TAB モード：「TAB を取り込む」→ Chrome の画面で「タブ」を選び、YouTube などのタブを選択 →「タブの音声も共有する」にチェック →「共有」。
取り込んだタブの音は、こちらで加工した音だけが聞こえるように自動で止まります。</p>
<p>YOUTUBE モード：ブラウザの決まりで、埋め込み動画の中身（映像・音）は直接加工できません。再生の操作と、上に重ねる効果で壊します。</p>
<p>MIDI（チャンネル6）：ノート = 楽器キー、CC でノブ、CC119 で電源</p>`;

interface Cap { code: string; label: string; role: Role; fnLabel?: string; x: number; y: number; w: number }

function caps(): Cap[] {
  const out: Cap[] = [];
  TELE_LAYOUT.forEach((row, r) => {
    let x = 0;
    for (const k of row) {
      if (k.code) out.push({ code: k.code, label: k.label, role: k.role, fnLabel: k.fnLabel, x, y: r === 0 ? 0 : r + 0.3, w: k.w });
      x += k.w;
    }
  });
  for (const k of TELE_NAV) out.push({ ...k, x: 15.5 + k.x, y: k.y + 0.3, w: 1 });
  return out;
}

export function mountTele(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-tele';
  root.innerHTML = `
    <div class="tk-side left"><div class="tk-guide">
      <b>入力ソースの使い方</b>
      <p><i>TAB</i>（おすすめ）：YouTube などを別のタブで再生しておき、「TAB を取り込む」→「タブ」→ そのタブを選ぶ →<u>「タブの音声も共有する」をオン</u>→ 共有。映像も音も全部壊せます。</p>
      <p><i>YOUTUBE</i>：URL を貼って LOAD。中身は加工できないので、再生そのものを操作して壊します。</p>
      <p><i>FILE / CAM</i>：手持ちの動画ファイル、または Web カメラ。</p>
    </div></div>
    <div class="tk-side right"><div class="tk-mods">MOD PANEL<br><small>改造パーツはフェーズ3で取り付け</small></div></div>
    <div class="tk-monitor">
      <div class="tk-screen">
        <canvas data-id="gl"></canvas>
        <div class="tk-yt" data-id="yt"></div>
        <div class="tk-ytfx" data-id="ytfx"></div>
        <div class="tk-osd" data-id="osd">NO SIGNAL</div>
      </div>
      <div class="tk-brand">TELEKEY <b>TK-6</b></div>
      <div class="tk-src">
        <button data-src="youtube">YOUTUBE</button>
        <input data-id="url" type="text" placeholder="YouTube の URL を貼る" spellcheck="false">
        <button data-id="load">LOAD</button>
        <button data-src="tab">TAB を取り込む</button>
        <button data-src="file">FILE</button>
        <button data-src="cam">CAM</button>
        <button data-src="none" title="入力を外す">✕</button>
        <input data-id="file" type="file" accept="video/*" hidden>
      </div>
      <div class="tk-note" data-id="note"></div>
    </div>
    <div class="tk-case"></div>
    <div class="tk-keys" data-id="keys"></div>`;
  const $ = (id: string) => root.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const b = new Board(root);
  const leds: Record<string, HTMLElement> = {};
  let powered = false;

  // ================= 映像 =================
  const osd = $('osd');
  const note = $('note');
  let pipe: VideoPipeline | null = null;
  try {
    pipe = new VideoPipeline($('gl') as HTMLCanvasElement);
  } catch (e) {
    osd.textContent = 'WebGL2 が使えません';
  }
  const sources = new Sources($('yt'), (src) => api.connectVideo(src));
  const setNote = (t: string, warn = false) => { note.textContent = t; note.classList.toggle('warn', warn); };
  sources.onChange = (kind: SourceKind, label: string) => {
    root.dataset.src = kind;
    root.querySelectorAll('[data-src]').forEach((el) => el.classList.toggle('sel', (el as HTMLElement).dataset.src === kind || (kind === 'youtube' && (el as HTMLElement).dataset.src === 'youtube')));
    setNote(kind === 'youtube' ? `${label} ／ YouTube モードは動画の中身を加工できません（再生の操作と重ねる効果で壊します）` : label, label.includes('音声なし'));
  };
  const frame = (now: number) => {
    if (root.offsetParent !== null && pipe) pipe.render(sources.frameSource, now / 1000, powered);
    osd.hidden = !powered || sources.kind !== 'none';
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const tryOpen = async (f: () => Promise<void>) => {
    try {
      await api.start();
      await f();
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setNote(/Permission|NotAllowed/i.test(msg) ? '取り込みがキャンセルされました（許可されませんでした）' : `開けませんでした：${msg}`, true);
    }
  };
  const url = $('url') as HTMLInputElement;
  const fileIn = $('file') as HTMLInputElement;
  const loadUrl = () => { if (url.value.trim()) void tryOpen(() => sources.openYouTube(url.value)); };
  $('load').addEventListener('click', loadUrl);
  url.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { loadUrl(); url.blur(); } });
  url.addEventListener('keyup', (e) => e.stopPropagation());
  root.querySelectorAll<HTMLElement>('[data-src]').forEach((el) => el.addEventListener('click', () => {
    const s = el.dataset.src;
    if (s === 'youtube') { url.focus(); if (url.value.trim()) loadUrl(); }
    else if (s === 'tab') void tryOpen(() => sources.openTab());
    else if (s === 'file') fileIn.click();
    else if (s === 'cam') void tryOpen(() => sources.openCam());
    else sources.close();
  }));
  fileIn.addEventListener('change', () => { const f = fileIn.files?.[0]; if (f) void tryOpen(() => sources.openFile(f)); fileIn.value = ''; });
  // 動画ファイルをモニターにドラッグ＆ドロップ
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('video/')) void tryOpen(() => sources.openFile(f));
  });

  // ================= 電源・LED（仮置き。改造パネルはフェーズ3） =================
  leds.power = b.place('led green', 1250, 590);
  b.label('POWER', 1250, 610, 'tk-lbl');
  leds.level = b.place('led', 1290, 590);
  b.label('AUDIO IN', 1290, 610, 'tk-lbl');
  const powerOn = () => void api.start().then(() => api.post({ type: 'power', on: true }));
  const powerOff = () => api.post({ type: 'power', on: false });

  // ================= キーボード =================
  const keysEl = $('keys');
  const keyCtl = new Map<string, { press(): void; release(): void }>();
  for (const c of caps()) {
    const el = document.createElement('div');
    el.className = `tk-key role-${c.role.r}`;
    el.style.left = `${X0 + c.x * U}px`;
    el.style.top = `${Y0 + c.y * U}px`;
    el.style.width = `${c.w * U - 5}px`;
    el.style.height = `${U - 5}px`;
    const sub = c.role.r === 'glitch' ? `${GLITCHES[c.role.n].v}<br>${GLITCHES[c.role.n].a}` : (c.fnLabel ?? '');
    el.innerHTML = `<span class="top">${c.label}</span><span class="fn">${sub}</span>`;
    keysEl.appendChild(el);
    const idx = TELE_KEY_INDEX.get(c.code);
    let down = false;
    const press = () => {
      if (down) return;
      down = true;
      el.classList.add('down');
      if (c.role.r === 'fn') {
        switch (c.role.f) {
          case 'powerOn': powerOn(); break;
          case 'powerOff': powerOff(); break;
          case 'playPause': sources.playPause(); break;
          case 'seekBack': sources.seekBy(-5); break;
          case 'seekFwd': sources.seekBy(5); break;
        }
      } else if (c.role.r === 'cue') sources.seekFraction(c.role.n / 10);
      if (idx !== undefined) api.post({ type: 'key', key: idx, down: true });
    };
    const release = () => {
      if (!down) return;
      down = false;
      el.classList.remove('down');
      if (idx !== undefined) api.post({ type: 'key', key: idx, down: false });
    };
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); press(); e.preventDefault(); });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    keyCtl.set(c.code, { press, release });
  }

  const cc = ccMap(TELE_PARAMS);
  const setParam = (i: number, v: number) => api.post({ type: 'param', index: i, value: v });
  return {
    title: 'TELEKEY TK-6',
    width: W,
    height: H,
    root,
    help: HELP,
    paramDefs: TELE_PARAMS,
    keyCount: TELE_KEYS.length,
    keyName: (k) => {
      const d = TELE_KEYS[k];
      if (!d) return `KEY ${k}`;
      return d.role.r === 'glitch' ? `${d.label} ${GLITCHES[d.role.n].v}` : `${d.label}`;
    },
    onMessage(m: FromToy) {
      if (m.type !== 'status') return;
      powered = m.status.powered;
      leds.power.classList.toggle('lit', powered);
      leds.level.classList.toggle('lit', m.status.leds.level > 0.1);
      root.classList.toggle('powered', powered);
    },
    keyDown(e) {
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
      if (st === 0xb0) {
        if (d1 === CC_POWER) (d2 >= 64 ? powerOn() : powerOff());
        const i = cc.get(d1);
        if (i !== undefined) setParam(i, ccToValue(TELE_PARAMS[i], d2));
      }
      void TELE_INDEX;
    },
    powerOn,
    powerOff,
  };
}
