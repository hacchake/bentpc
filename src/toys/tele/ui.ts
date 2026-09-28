// 6台目：TELEKEY TK-6（ブラウン管モニター付きの魔改造キーボード）の画面。
// ・映像：WebGL でグリッチ 24 種（YouTube のときは再生の操作＋上に重ねる効果）
// ・音：エンジン（Worklet）で同じキーのグリッチ。いま効いているグリッチはエンジンからも届くので、
//        シーケンサーで鳴らしたキーでも映像が一緒に壊れる
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
  <tr><td>Q〜［ ・ A〜］</td><td>押している間だけ効くグリッチ（映像＋音が同時に壊れる。キーの下に映像／音の名前）</td></tr>
  <tr><td>Z〜＼</td><td>音を足す楽器キー（ビープ・ノイズ・ドラム・ドローンなど。音階つき）</td></tr>
  <tr><td>Space</td><td>FREEZE（押している間、今の映像と音をつかんで繰り返す）</td></tr>
  <tr><td>1〜0</td><td>キューポイント（最初は 10%〜90%・0%）。Shift＋数字で今の位置を登録</td></tr>
  <tr><td>- ^ ¥</td><td>再生を遅く / 速く / 元の速さ（YouTube・ファイル）</td></tr>
  <tr><td>↑ ↓</td><td>音のピッチ ±半音（取り込んだ音）</td></tr>
  <tr><td>← →</td><td>5 秒戻る / 進む</td></tr>
  <tr><td>BS</td><td>RELEASE（効いているグリッチを全部止める）</td></tr>
  <tr><td>Home</td><td>再生 / 一時停止</td></tr>
  <tr><td>PgUp / PgDn</td><td>電源 ON / OFF</td></tr>
</table>
<p>TAB モード：「TAB を取り込む」→ Chrome の画面で「タブ」を選び、YouTube などのタブを選択 →「タブの音声も共有する」にチェック →「共有」。
取り込んだタブの音は、こちらで加工した音だけが聞こえるように自動で止まります。</p>
<p>YOUTUBE モード：ブラウザの決まりで、埋め込み動画の中身（映像・音）は直接加工できません。
グリッチキーは、再生そのもの（連打・一時停止・速度・ジャンプ・ミュートの明滅）と、上に重ねる効果で壊します。楽器キーの音は足せます。</p>
<p>MIDI（チャンネル6）：ノート 48〜 = 楽器キー、CC でノブ、CC119 で電源</p>`;

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

/** YouTube モードでの壊し方：上に重ねる効果（CSS）と、再生の操作 */
type YtAction = 'stutter' | 'pause' | 'slow' | 'fast' | 'jump' | 'mute';
const YT: { css: (t: number) => { filter?: string; transform?: string; opacity?: number }; act?: YtAction }[] = [
  { css: (t) => ({ filter: `saturate(3) hue-rotate(${(t * 400) % 360}deg)`, transform: `translateX(${Math.sin(t * 50) * 8}px)` }), act: 'stutter' }, // RGB SHIFT
  { css: (t) => ({ transform: `skewX(${Math.sin(t * 23) * 12}deg)` }) }, // SCAN SHIFT
  { css: () => ({ filter: 'blur(2px) contrast(2)' }), act: 'jump' }, // DATAMOSH
  { css: () => ({ filter: 'contrast(3) brightness(1.3)' }) }, // PIXEL SORT
  { css: () => ({ filter: 'blur(5px) contrast(5) saturate(2)' }) }, // MOSAIC
  { css: () => ({ filter: 'contrast(4) saturate(2)' }) }, // POSTERIZE
  { css: () => ({ filter: 'invert(1)' }) }, // INVERT
  { css: () => ({ transform: 'scaleX(-1)' }) }, // MIRROR
  { css: (t) => ({ transform: `rotate(${(t * 90) % 360}deg) scale(1.6)` }) }, // KALEIDO
  { css: () => ({ filter: 'saturate(0.3)' }), act: 'slow' }, // SLIT SCAN
  { css: (t) => ({ transform: `scale(${1.08 + 0.04 * Math.sin(t * 8)}) rotate(2deg)` }) }, // FEEDBACK
  { css: () => ({ filter: 'contrast(2)' }), act: 'jump' }, // BLOCK NOISE
  { css: () => ({}), act: 'pause' }, // FRAME HOLD
  { css: (t) => ({ transform: `translateY(${((t * 300) % 480) - 240}px)` }) }, // V-ROLL
  { css: (t) => ({ transform: `skewX(${Math.sin(t * 9) * 20}deg)` }) }, // H-SYNC
  { css: () => ({ filter: 'grayscale(1) contrast(20)' }) }, // THRESHOLD
  { css: () => ({ filter: 'grayscale(1) invert(1) contrast(6)' }) }, // EDGE
  { css: (t) => ({ transform: `scale(${1.4 + 0.3 * Math.sin(t * 6)})` }) }, // ZOOM
  { css: (t) => ({ transform: `rotate(${Math.sin(t * 1.3) * 25}deg) scale(1.3)` }) }, // TWIST
  { css: () => ({ filter: 'saturate(6) blur(1px)' }) }, // CHROMA BLEED
  { css: () => ({ filter: 'brightness(1.2)' }), act: 'fast' }, // ECHO TRAIL
  { css: () => ({ transform: 'scale(0.5)' }) }, // SPLIT
  { css: (t) => ({ opacity: Math.floor(t * 12) % 2 ? 1 : 0.1 }), act: 'mute' }, // STROBE
  { css: (t) => ({ filter: 'blur(1.5px)', transform: `translateY(${(t * 40) % 30}px) scaleY(1.25)` }) }, // MELT
];

export function mountTele(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-tele';
  root.innerHTML = `
    <div class="tk-side left"><div class="tk-guide">
      <b>入力ソースの使い方</b>
      <p><i>TAB</i>（おすすめ）：YouTube などを別のタブで再生しておき、「TAB を取り込む」→「タブ」→ そのタブを選ぶ →<u>「タブの音声も共有する」をオン</u>→ 共有。映像も音も全部壊せます。</p>
      <p><i>YOUTUBE</i>：URL を貼って LOAD。中身は加工できないので、再生そのものを操作して壊します。</p>
      <p><i>FILE / CAM</i>：手持ちの動画ファイル（ドラッグ＆ドロップでも）、または Web カメラ。</p>
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
  let amount: number = TELE_PARAMS[TELE_INDEX.amount].default;

  // ================= 映像 =================
  const osd = $('osd');
  const note = $('note');
  const ytEl = $('yt');
  const ytFx = $('ytfx');
  let pipe: VideoPipeline | null = null;
  try {
    pipe = new VideoPipeline($('gl') as HTMLCanvasElement);
  } catch {
    osd.textContent = 'WebGL2 が使えません';
  }
  const sources = new Sources(ytEl, (src) => api.connectVideo(src));
  const setNote = (t: string, warn = false) => { note.textContent = t; note.classList.toggle('warn', warn); };
  sources.onChange = (kind: SourceKind, label: string) => {
    root.dataset.src = kind;
    root.querySelectorAll('[data-src]').forEach((el) => el.classList.toggle('sel', (el as HTMLElement).dataset.src === kind));
    setNote(kind === 'youtube' ? `${label} ／ YouTube モードは動画の中身を加工できません（再生の操作と重ねる効果で壊します）` : label, label.includes('音声なし'));
    cues.clear();
  };

  // ---- グリッチの状態：自分で押したもの ∪ エンジンから届いたもの（シーケンサー再生など） ----
  const localG = new Set<number>();
  let engineMask = 0;
  let localFreeze = false, engineFreeze = false;
  let flash = 0;
  let lastHits = 0;
  let prevActive = 0;
  let prevFreeze = false;
  const activeMask = () => { let m = engineMask; localG.forEach((n) => { m |= 1 << n; }); return m; };

  const frame = (now: number) => {
    const t = now / 1000;
    const m = powered ? activeMask() : 0;
    const fz = powered && (localFreeze || engineFreeze);
    const level = 0.35 + 0.65 * amount;
    if (pipe) {
      for (let n = 0; n < 24; n++) pipe.g[n] = m & (1 << n) ? level : 0;
      // 押した瞬間の画を取っておく（FREEZE・FRAME HOLD）
      if ((fz && !prevFreeze) || (m & ~prevActive & (1 << 12))) pipe.grabHold();
      pipe.freeze = fz;
      pipe.flash = flash;
      pipe.seed = (pipe.seed + 0.37) % 1000;
      if (root.offsetParent !== null) pipe.render(sources.frameSource, t, powered, powered && sources.kind === 'none');
    }
    flash *= 0.8;
    // ---- YouTube：再生の操作と、重ねる効果 ----
    if (sources.kind === 'youtube') {
      const filters: string[] = [], transforms: string[] = [];
      let opacity = 1;
      for (let n = 0; n < 24; n++) {
        const on = (m & (1 << n)) !== 0, was = (prevActive & (1 << n)) !== 0;
        const fx = YT[n];
        if (on) {
          const c = fx.css(t);
          if (c.filter) filters.push(c.filter);
          if (c.transform) transforms.push(c.transform);
          if (c.opacity !== undefined) opacity = Math.min(opacity, c.opacity);
        }
        if (fx.act && on && !was) sources.startAction(fx.act);
        if (fx.act && !on && was) sources.stopAction(fx.act);
      }
      if (fz && !prevFreeze) sources.startAction('stutter');
      if (!fz && prevFreeze) sources.stopAction('stutter');
      ytEl.style.filter = filters.join(' ');
      ytEl.style.transform = transforms.join(' ');
      ytEl.style.opacity = String(opacity);
      ytFx.classList.toggle('glitching', m !== 0 || fz);
      ytFx.style.setProperty('--flash', String(flash));
    }
    prevActive = m;
    prevFreeze = fz;
    osd.hidden = !powered || sources.kind !== 'none';
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- 入力を開く ----
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
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('video/')) void tryOpen(() => sources.openFile(f));
  });

  // ================= 電源・LED（改造パネルはフェーズ3） =================
  leds.power = b.place('led green', 1250, 590);
  b.label('POWER', 1250, 610, 'tk-lbl');
  leds.level = b.place('led', 1290, 590);
  b.label('AUDIO IN', 1290, 610, 'tk-lbl');
  const powerOn = () => void api.start().then(() => api.post({ type: 'power', on: true }));
  const powerOff = () => api.post({ type: 'power', on: false });

  // ================= キーボード =================
  const cues = new Map<number, number>(); // キュー番号 → 秒（Shift＋数字で登録）
  const keysEl = $('keys');
  const keyCtl = new Map<string, { press(shift?: boolean): void; release(): void }>();
  const capEls: HTMLElement[] = [];
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
    if (idx !== undefined) capEls[idx] = el;
    let down = false;
    const role = c.role;
    const press = (shift = false) => {
      if (down) return;
      down = true;
      el.classList.add('down');
      if (powered) {
        switch (role.r) {
          case 'glitch': localG.add(role.n); break;
          case 'inst': flash = Math.max(flash, [0.08, 0.08, 0.1, 0.25, 0.18, 0.05, 0.03, 0.15, 0.06, 0.08, 0.1][role.n]); break;
          case 'cue':
            if (shift) { cues.set(role.n, sources.currentTime); setNote(`CUE ${role.n} を ${sources.currentTime.toFixed(1)} 秒に登録しました`); }
            else if (cues.has(role.n)) sources.seekTo(cues.get(role.n)!);
            else sources.seekFraction(role.n / 10);
            break;
          case 'fn':
            switch (role.f) {
              case 'freeze': localFreeze = true; break;
              case 'release': localG.clear(); break;
              case 'playPause': sources.playPause(); break;
              case 'seekBack': sources.seekBy(-5); break;
              case 'seekFwd': sources.seekBy(5); break;
              case 'slower': sources.setBaseRate(sources.rate / 1.25); setNote(`再生速度 ×${sources.rate.toFixed(2)}`); break;
              case 'faster': sources.setBaseRate(sources.rate * 1.25); setNote(`再生速度 ×${sources.rate.toFixed(2)}`); break;
              case 'speedReset': sources.setBaseRate(1); setNote('再生速度 ×1'); break;
            }
            break;
        }
      }
      if (role.r === 'fn' && role.f === 'powerOn') powerOn();
      if (role.r === 'fn' && role.f === 'powerOff') powerOff();
      if (idx !== undefined) api.post({ type: 'key', key: idx, down: true });
    };
    const release = () => {
      if (!down) return;
      down = false;
      el.classList.remove('down');
      if (role.r === 'glitch') localG.delete(role.n);
      if (role.r === 'fn' && role.f === 'freeze') localFreeze = false;
      if (idx !== undefined) api.post({ type: 'key', key: idx, down: false });
    };
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); press(e.shiftKey); e.preventDefault(); });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    keyCtl.set(c.code, { press, release });
  }

  const cc = ccMap(TELE_PARAMS);
  const setParam = (i: number, v: number) => {
    if (i === TELE_INDEX.amount) amount = v;
    api.post({ type: 'param', index: i, value: v });
  };
  const instKeys = TELE_KEYS.map((k, i) => ({ k, i })).filter((x) => x.k.role.r === 'inst');
  const midiHeld = new Map<number, number>();
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
      return d.role.r === 'glitch' ? `${d.label} ${GLITCHES[d.role.n].v}` : d.role.r === 'inst' ? `${d.label} ${['BEEP', 'BEEP', 'NOISE', 'KICK', 'SNARE', 'HAT', 'DRONE', 'ZAP', 'BLIP', 'BUZZ', 'CHIRP'][d.role.n]}` : d.label;
    },
    onMessage(m: FromToy) {
      if (m.type !== 'status') return;
      const st = m.status;
      powered = st.powered;
      leds.power.classList.toggle('lit', powered);
      leds.level.classList.toggle('lit', st.leds.level > 0.1);
      root.classList.toggle('powered', powered);
      engineMask = st.fx.mask ?? 0;
      engineFreeze = (st.fx.freeze ?? 0) > 0;
      // シーケンサーが鳴らした楽器キーでも画面が光る
      if ((st.fx.hits ?? 0) !== lastHits) {
        lastHits = st.fx.hits ?? 0;
        flash = Math.max(flash, 0.12);
      }
      // エンジン側で効いているグリッチキーも画面のキーを光らせる
      TELE_KEYS.forEach((k, i) => { if (k.role.r === 'glitch') capEls[i]?.classList.toggle('lit', (engineMask & (1 << k.role.n)) !== 0); });
    },
    keyDown(e) {
      const k = keyCtl.get(e.code);
      if (!k) return false;
      if (!e.repeat) k.press(e.shiftKey);
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
      if (st === 0x90 || st === 0x80) {
        // ノート 48〜：楽器キー（11 個を繰り返し）
        const on = st === 0x90 && d2 > 0;
        if (on) {
          const x = instKeys[((d1 - 48) % instKeys.length + instKeys.length) % instKeys.length];
          midiHeld.set(d1, x.i);
          api.post({ type: 'key', key: x.i, down: true });
          flash = Math.max(flash, 0.1);
        } else if (midiHeld.has(d1)) {
          api.post({ type: 'key', key: midiHeld.get(d1)!, down: false });
          midiHeld.delete(d1);
        }
      } else if (st === 0xb0) {
        if (d1 === CC_POWER) (d2 >= 64 ? powerOn() : powerOff());
        const i = cc.get(d1);
        if (i !== undefined) setParam(i, ccToValue(TELE_PARAMS[i], d2));
      }
    },
    powerOn,
    powerOff,
  };
}
