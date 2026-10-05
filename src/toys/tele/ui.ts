// 6台目：TELEKEY TK-6（ブラウン管モニター付きの魔改造キーボード）の画面。
// ・映像：WebGL でグリッチ 24 種。入力はタブ共有・動画ファイル・Web カメラ・テスト映像
// ・音：エンジン（Worklet）で同じキーのグリッチ。いま効いているグリッチはエンジンからも届くので、
//        シーケンサーで鳴らしたキーでも映像が一緒に壊れる
import './tele.css';
import { Knob, SteppedKnob, Toggle, momentary } from '../../core/controls';
import { PowerHints } from '../../core/power';
import { Board, CC_POWER, ccMap, ccToValue, type HostApi, type ToyUI } from '../../core/ui';
import type { FromToy } from '../../host/protocol';
import {
  BASE_NAMES, BURSTS, GLITCHES, TELE_INDEX, TELE_KEYS, TELE_KEY_INDEX, TELE_LAYOUT, TELE_NAV, TELE_PARAMS, type Role, type TeleParamId,
} from './params';
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
  <tr><td>入力</td><td>モニターの下で TAB / FILE / CAM / TEST を選ぶ（最初は Web カメラ。使えなければテスト映像）</td></tr>
  <tr><td>Q〜［ ・ A〜］</td><td>押している間だけ効くグリッチ（映像＋音が同時に壊れる。キーの下に映像／音の名前）</td></tr>
  <tr><td>Z〜＼</td><td>音を足す楽器キー（ビープ・ノイズ・ドラム・ドローンなど。音階つき）</td></tr>
  <tr><td>Space</td><td>FREEZE（押している間、今の映像と音をつかんで繰り返す）</td></tr>
  <tr><td>1〜0</td><td>キューポイント（最初は 10%〜90%・0%）。Shift＋数字で今の位置を登録</td></tr>
  <tr><td>- ^ ¥</td><td>再生を遅く / 速く / 元の速さ（ファイル・テスト映像）</td></tr>
  <tr><td>↑ ↓</td><td>音のピッチ ±半音（取り込んだ音）</td></tr>
  <tr><td>← →</td><td>5 秒戻る / 進む</td></tr>
  <tr><td>BS</td><td>RELEASE（効いているグリッチを全部止める）</td></tr>
  <tr><td>Home</td><td>再生 / 一時停止</td></tr>
  <tr><td>RESET</td><td>モニターの右下の大きな緑のボタン。押すと再起動（電源はいつも ON。最初に画面をさわると入る）</td></tr>
  <tr><td>PgUp / PgDn</td><td>電源 ON / OFF</td></tr>
  <tr><td>F1〜F5</td><td>GLITCH ボタン：今の BASE の一発グリッチ（左パネルに名前）</td></tr>
  <tr><td>F6〜F10</td><td>BASE 1〜5（TAPE / DIGITAL / SIGNAL / BEEP / MELTDOWN）</td></tr>
  <tr><td>Enter / BS</td><td>HOLD（今効いているグリッチをつかんで離しても続ける）/ RELEASE（全部解除）</td></tr>
  <tr><td>F11 / F12 / Tab</td><td>LFO の行き先 / キー混線 / 歪みの種類</td></tr>
  <tr><td>Esc</td><td>RESET（全部止めて、ピッチも元に戻す）</td></tr>
</table>
<p>右のパネル：GLITCH AMT（グリッチの強さ）・LFO（映像／音／両方をうねらせる）・FEEDBACK（映像も音も自分に返る）・DIST（CLIP／CRUSH）・SPEED/PITCH・DRY/WET・MASTER。
CROSSTALK を ON にすると、キーが混線して隣のキーも効いたり、押すたびに別の効果になったりします。</p>
<p>● REC VIDEO（モニター左上）：加工後の映像と音を録画して WebM で保存。音だけなら上のバーの REC（WAV）。</p>
<p>HEAT の LED：やりすぎると機械が熱くなり、勝手にグリッチ・砂嵐・音の張り付きが起きます（固まりません）。手を離せば冷めます。Esc（RESET）ですぐ冷やせます。</p>
<p>他人の著作物（動画・音楽）を加工・録画・公開するときは、権利者の許可を得てください。</p>
<p>TAB モード：「TAB を取り込む」→ Chrome の画面で「タブ」を選び、動画を再生しているタブを選択 →「タブの音声も共有する」にチェック →「共有」。
取り込んだタブの音は、こちらで加工した音だけが聞こえるように自動で止まります。</p>
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

export function mountTele(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-tele';
  root.innerHTML = `
    <div class="tk-side left"><div class="tk-guide">
      <b>入力ソースの使い方</b>
      <p><i>CAM</i>：Web カメラ（最初はこれ。許可しなければ <i>TEST</i> のテスト映像になります）。</p>
      <p><i>TAB</i>：動画を別のタブで再生しておき、「TAB を取り込む」→「タブ」→ そのタブを選ぶ →<u>「タブの音声も共有する」をオン</u>→ 共有。映像も音も全部壊せます。</p>
      <p><i>FILE</i>：手持ちの動画ファイル（ドラッグ＆ドロップでも）。</p>
      <p class="tk-rights">他人の動画・音楽を加工・録画・公開するときは、権利者の許可を得てください。</p>
    </div></div>
    <div class="tk-side right"></div>
    <svg class="tk-wires" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <path d="M 230 612 C 230 700, 330 660, 360 720" class="w1" />
      <path d="M 380 612 C 390 680, 360 690, 372 760" class="w2" />
      <path d="M 1560 612 C 1560 700, 1470 660, 1440 720" class="w3" />
      <path d="M 1420 612 C 1410 690, 1440 690, 1430 780" class="w1" />
    </svg>
    <div class="tk-monitor">
      <div class="tk-screen">
        <canvas data-id="gl"></canvas>
        <div class="tk-osd" data-id="osd">NO SIGNAL</div>
      </div>
      <div class="tk-brand">TELEKEY <b>TK-6</b></div>
      <div class="tk-vrec"><button data-id="vrec" title="加工後の映像と音を録画（WebM）">● REC VIDEO</button><span data-id="vtime"></span></div>
      <div class="tk-glass"></div>
      <div class="tk-src">
        <button data-src="tab">TAB を取り込む</button>
        <button data-src="file">FILE</button>
        <button data-src="cam">CAM</button>
        <button data-src="test">TEST</button>
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
  let pipe: VideoPipeline | null = null;
  try {
    pipe = new VideoPipeline($('gl') as HTMLCanvasElement);
  } catch {
    osd.textContent = 'WebGL2 が使えません';
  }
  const sources = new Sources((src) => api.connectVideo(src));
  const setNote = (t: string, warn = false) => { note.textContent = t; note.classList.toggle('warn', warn); };
  sources.onChange = (kind: SourceKind, label: string) => {
    root.dataset.src = kind;
    root.querySelectorAll('[data-src]').forEach((el) => el.classList.toggle('sel', (el as HTMLElement).dataset.src === kind));
    setNote(label, label.includes('音声なし'));
    cues.clear();
    // テスト映像のときは、エンジンがテスト信号（音）を入力の代わりに使う
    api.post({ type: 'signal', on: kind === 'test' });
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

  // 改造パーツの値（エンジンから届く。シーケンサーのツマミの動きにも付いていく）
  const fxv = { fb: 0, dist: 0, dtype: 0, mix: 1, speed: 0.5, lfoR: 0.3, lfoD: 0, lfoT: 2, snow: 0, burst: 0 };
  let lfoPh = 0;
  let heat = 0;
  let heatPh = 0;
  const screen = root.querySelector('.tk-screen') as HTMLElement;
  let prevT = 0;
  let started = false;
  let viewFrozen = false;
  const frame = (now: number) => {
    const t = now / 1000;
    const dt = Math.min(0.1, t - prevT);
    prevT = t;
    const m = powered ? activeMask() : 0;
    const fz = powered && (localFreeze || engineFreeze);
    // LFO（映像に向いているとき）：グリッチの強さと画面全体を揺らす
    lfoPh = (lfoPh + dt * 0.05 * Math.pow(400, fxv.lfoR)) % 1;
    const lfoVid = powered && fxv.lfoT !== 1 ? Math.sin(2 * Math.PI * lfoPh) * fxv.lfoD : 0;
    leds.lfo?.classList.toggle('lit', fxv.lfoD > 0.02 && Math.sin(2 * Math.PI * lfoPh) > 0);
    // 熱：熱いほど LED が速く点滅し、画面が震える
    heatPh = (heatPh + dt * (1 + heat * 14)) % 1;
    leds.heat?.classList.toggle('lit', heat > 0.15 && heatPh < 0.5);
    leds.heat?.style.setProperty('--hot', String(Math.min(1, heat)));
    const shake = powered && heat > 0.6 ? (heat - 0.6) * 6 : 0;
    screen.style.transform = shake ? `translate(${(Math.random() - 0.5) * shake}px, ${(Math.random() - 0.5) * shake}px)` : '';
    const level = Math.max(0.1, Math.min(1, (0.35 + 0.65 * amount) * (1 + 0.5 * lfoVid)));
    if (pipe) {
      for (let n = 0; n < 24; n++) pipe.g[n] = m & (1 << n) ? level : 0;
      // 押した瞬間の画を取っておく（FREEZE・FRAME HOLD）
      if ((fz && !prevFreeze) || (m & ~prevActive & (1 << 12))) pipe.grabHold();
      pipe.freeze = fz || viewFrozen;
      pipe.flash = flash;
      pipe.seed = (pipe.seed + 0.37) % 1000;
      pipe.knobs = { fbk: fxv.fb, dist: fxv.dist, dtype: fxv.dtype, mixv: fxv.mix, lfo: lfoVid, snow: powered ? fxv.snow : 0 };
      if (root.offsetParent !== null) {
        if (sources.kind === 'test') sources.test.draw(now);
        pipe.render(sources.frameSource, t, powered, powered && sources.kind === 'none');
      }
    }
    flash *= 0.8;
    prevActive = m;
    prevFreeze = fz;
    osd.hidden = !powered || sources.kind !== 'none';
    // 初めて画面に出たとき：Web カメラをデモとして開く（許可されなければテスト映像）
    if (!started && root.offsetParent !== null) {
      started = true;
      if (sources.kind === 'none') {
        // 許可を待つ間もテスト映像を映しておき、カメラが使えたら切り替える
        sources.openTest();
        setNote('Web カメラの許可を待っています（許可しなければテスト映像のまま）');
        sources.openCam().catch(() => {
          if (sources.kind === 'test') setNote('カメラが使えないので、テスト映像を映しています（CAM で再挑戦・TAB / FILE で別の入力）');
        });
      }
    }
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
  const fileIn = $('file') as HTMLInputElement;
  root.querySelectorAll<HTMLElement>('[data-src]').forEach((el) => el.addEventListener('click', () => {
    const s = el.dataset.src;
    if (s === 'tab') void tryOpen(() => sources.openTab());
    else if (s === 'file') fileIn.click();
    else if (s === 'cam') void tryOpen(() => sources.openCam());
    else if (s === 'test') sources.openTest();
    else sources.close();
  }));
  fileIn.addEventListener('change', () => { const f = fileIn.files?.[0]; if (f) void tryOpen(() => sources.openFile(f)); fileIn.value = ''; });
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('video/')) void tryOpen(() => sources.openFile(f));
  });

  // ================= 録画：モニターの映像（WebGL）＋全体の音を WebM に =================
  const vrecBtn = $('vrec');
  const vtime = $('vtime');
  let recorder: MediaRecorder | null = null;
  let recChunks: Blob[] = [];
  let recStart = 0;
  let recTimer = 0;
  const stopVideoRec = () => recorder?.state === 'recording' && recorder.stop();
  vrecBtn.addEventListener('click', async () => {
    if (recorder?.state === 'recording') { stopVideoRec(); return; }
    const canvas = $('gl') as HTMLCanvasElement;
    const vs = canvas.captureStream(30);
    const as = await api.outputStream();
    const stream = new MediaStream([...vs.getVideoTracks(), ...as.getAudioTracks()]);
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined);
    recChunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(recTimer);
      vrecBtn.classList.remove('on');
      vtime.textContent = '';
      const blob = new Blob(recChunks, { type: 'video/webm' });
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, '0');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `telekey-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setNote('録画を保存しました（WebM）');
    };
    recorder.start(1000);
    recStart = performance.now();
    vrecBtn.classList.add('on');
    recTimer = window.setInterval(() => {
      const sec = Math.floor((performance.now() - recStart) / 1000);
      vtime.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }, 250);
  });

  // ================= 電源・LED（改造パネルはフェーズ3） =================
  // モニターの右下：大きな POWER ボタン（押すたびに ON / OFF）
  leds.power = b.place('led green', 1285, 408);
  const powerBtn = b.place('dome green big power', 1285, 462);
  b.label('POWER', 1285, 508, 'power-label');
  leds.level = b.place('led', 1285, 590);
  b.label('AUDIO IN', 1285, 610, 'tk-lbl');
  // api.start() は押した瞬間に呼ぶ（ブラウザの「最初の操作まで音を出せない」決まりを、この操作で解除する）
  const powerOn = () => void api.start().then(() => api.post({ type: 'power', on: true }));
  const powerOff = () => api.post({ type: 'power', on: false });
  momentary(powerBtn, () => (powered ? powerOff() : powerOn()));
  const hints = new PowerHints(root, powerBtn, leds.power, { x: 1236, y: 462, side: 'left' });
  let heatSaid = -1e9;

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
  const setP = (id: TeleParamId, v: number) => setParam(TELE_INDEX[id], v);
  const def = (id: TeleParamId) => TELE_PARAMS[TELE_INDEX[id]];

  // ================= 改造パーツ（左：GLITCH×5・BASE・HOLD/RELEASE） =================
  const viaKey = (code: string) => ({ press: () => keyCtl.get(code)?.press(), release: () => keyCtl.get(code)?.release() });
  b.tape('GLITCH', 230, 296, false, -2);
  const burstLabels: HTMLElement[] = [];
  [0, 1, 2, 3, 4].forEach((i) => {
    const x = 90 + i * 70;
    const k = viaKey(`F${i + 1}`);
    momentary(b.place('dome big', x, 345), k.press, k.release);
    b.label(String(i + 1), x, 318, 'tk-hand');
    burstLabels.push(b.label('', x, 380, 'tk-lbl small'));
  });
  b.tape('BASE', 110, 420, false, 3);
  const baseKnob = new SteppedKnob(b.knob('black big', 110, 482), 5, 0, (v) => setP('base', v), 240);
  const ticks = b.place('ticks', 110, 482);
  for (let i = 0; i < 5; i++) {
    const a = ((-120 + i * 60) * Math.PI) / 180;
    const s = document.createElement('span');
    s.textContent = String(i + 1);
    s.style.left = `${Math.sin(a) * 46}px`;
    s.style.top = `${-Math.cos(a) * 46}px`;
    ticks.appendChild(s);
  }
  const baseName = b.label('TAPE', 110, 548, 'tk-hand');
  const showBase = (v: number) => {
    baseName.textContent = BASE_NAMES[v];
    burstLabels.forEach((el, i) => { el.textContent = BURSTS[v][i].name; });
  };
  showBase(0);
  const holdK = viaKey('Enter'), relK = viaKey('Backspace');
  momentary(b.place('dome big', 250, 482), holdK.press, holdK.release);
  b.label('HOLD', 250, 516, 'tk-hand');
  momentary(b.place('dome black big', 345, 482), relK.press, relK.release);
  b.label('RELEASE', 345, 516, 'tk-hand');
  leds.burst = b.place('led', 250, 570);
  b.label('BURST', 250, 590, 'tk-lbl');
  leds.hold = b.place('led yellow', 345, 570);
  b.label('HOLD', 345, 590, 'tk-lbl');
  for (const [x, y] of [[48, 58], [412, 58], [48, 600], [412, 600]]) b.place('screw', x, y);

  // ================= 改造パーツ（右：ノブ 8・トグル 3・LED） =================
  b.tape('MOD / DO NOT TOUCH', 1550, 70, false, 1);
  const knobs: [TeleParamId, string][] = [
    ['amount', 'GLITCH AMT'], ['lfoRate', 'LFO RATE'], ['lfoDepth', 'LFO DEPTH'], ['feedback', 'FEEDBACK'],
    ['dist', 'DIST'], ['speed', 'SPEED/PITCH'], ['mix', 'DRY / WET'], ['volume', 'MASTER'],
  ];
  const knobCtl = new Map<TeleParamId, Knob>();
  knobs.forEach(([id, name], i) => {
    const x = 1420 + (i % 4) * 90, y = i < 4 ? 140 : 262;
    knobCtl.set(id, new Knob(b.knob(i === 7 ? 'black big' : 'red big', x, y), def(id), (v) => setP(id, v)));
    b.label(name, x, y + 44, 'tk-hand');
  });
  const distSw = new Toggle(b.place('toggle', 1430, 410), 2, 0, (v) => setP('distType', v));
  b.label('CRUSH', 1430, 372, 'tk-lbl');
  b.label('CLIP', 1430, 448, 'tk-lbl');
  b.label('DIST TYPE', 1430, 470, 'tk-hand');
  const lfoSw = new Toggle(b.place('toggle', 1560, 410), 3, 2, (v) => setP('lfoTarget', v));
  b.label('VIDEO', 1600, 386, 'tk-lbl');
  b.label('AUDIO', 1600, 410, 'tk-lbl');
  b.label('BOTH', 1600, 434, 'tk-lbl');
  b.label('LFO →', 1560, 470, 'tk-hand');
  const xtSw = new Toggle(b.place('toggle', 1690, 410), 2, 0, (v) => setP('crosstalk', v));
  b.label('ON', 1690, 372, 'tk-lbl');
  b.label('CROSSTALK', 1690, 470, 'tk-hand');
  leds.lfo = b.place('led yellow', 1430, 540);
  b.label('LFO', 1430, 560, 'tk-lbl');
  leds.heat = b.place('led heat', 1560, 540);
  b.label('HEAT', 1560, 560, 'tk-lbl');
  leds.xt = b.place('led', 1690, 540);
  b.label('XTALK', 1690, 560, 'tk-lbl');
  for (const [x, y] of [[1368, 58], [1732, 58], [1368, 600], [1732, 600]]) b.place('screw', x, y);
  const ctlFor = (id: TeleParamId): { set(v: number, notify?: boolean): void } | undefined =>
    knobCtl.get(id) ?? ({ base: baseKnob, distType: distSw, lfoTarget: lfoSw, crosstalk: xtSw } as Partial<Record<TeleParamId, { set(v: number, notify?: boolean): void }>>)[id];
  const instKeys = TELE_KEYS.map((k, i) => ({ k, i })).filter((x) => x.k.role.r === 'inst');
  const midiHeld = new Map<number, number>();
  return {
    title: 'TELEKEY TK-6',
    powerButton: powerBtn,
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
      hints.update(powered);
      if (powered && (st.fx.heat ?? 0) > 0.9 && performance.now() - heatSaid > 20000) {
        heatSaid = performance.now();
        hints.say('熱すぎ！勝手にグリッチが暴れてるぞ。手を離すと冷める。すぐ冷やすなら <b>Esc</b>（RESET）', 6000, true);
      }
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
      // 改造パーツの値（キーボードやシーケンサーで変わったときも、ツマミの見た目を合わせる）
      const f = st.fx;
      if ((f.burst ?? 0) !== fxv.burst) { fxv.burst = f.burst ?? 0; flash = Math.max(flash, 0.35); }
      Object.assign(fxv, { fb: f.fb ?? 0, dist: f.dist ?? 0, dtype: f.dtype ?? 0, mix: f.mix ?? 1, speed: f.speed ?? 0.5, lfoR: f.lfoR ?? 0.3, lfoD: f.lfoD ?? 0, lfoT: f.lfoT ?? 2, snow: f.snow ?? 0 });
      amount = f.amount ?? amount;
      sources.setKnobRate(Math.pow(2, ((f.speed ?? 0.5) - 0.5) * 2));
      distSw.set(f.dtype ?? 0, false);
      lfoSw.set(f.lfoT ?? 2, false);
      xtSw.set(st.leds.xt ?? 0, false);
      if ((f.base ?? 0) !== baseKnob.value) baseKnob.set(f.base ?? 0, false);
      showBase(f.base ?? 0);
      leds.burst.classList.toggle('lit', st.leds.burst > 0);
      leds.hold.classList.toggle('lit', st.leds.hold > 0);
      leds.xt.classList.toggle('lit', st.leds.xt > 0);
      heat = f.heat ?? 0;
    },
    keyDown(e) {
      // 電源 OFF のとき：Enter で電源 ON。ほかのキーは POWER ボタンを光らせて教える
      if (!powered && e.code === 'Enter') { if (!e.repeat) powerOn(); return true; }
      const k = keyCtl.get(e.code);
      if (!k) return false;
      if (!powered && e.code !== 'PageUp' && e.code !== 'PageDown' && !e.repeat) hints.nudge();
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
        if (i !== undefined) {
          const v = ccToValue(TELE_PARAMS[i], d2);
          const c = ctlFor(TELE_PARAMS[i].id);
          if (c) c.set(v);
          else setParam(i, v);
        }
      }
    },
    powerOn,
    powerOff,
    showKey(key, on) {
      if (key >= 1000) return;
      capEls[key]?.classList.toggle('down', on);
      // シーケンサーが押したキューや再生操作も、映像に効かせる
      const r = TELE_KEYS[key]?.role;
      if (!on || !r || !powered) return;
      if (r.r === 'cue') sources.seekFraction(r.n / 10);
      else if (r.r === 'inst') flash = Math.max(flash, 0.1);
      else if (r.r === 'fn' && r.f === 'playPause') sources.playPause();
      else if (r.r === 'fn' && r.f === 'seekBack') sources.seekBy(-5);
      else if (r.r === 'fn' && r.f === 'seekFwd') sources.seekBy(5);
    },
    showParam(index, v) {
      const p = TELE_PARAMS[index];
      if (!p) return;
      if (p.id === 'amount') amount = v;
      ctlFor(p.id)?.set(v, false);
      if (p.id === 'base') showBase(Math.round(v));
    },
    freezeView(on) {
      if (on && !viewFrozen) pipe?.grabHold();
      viewFrozen = on;
    },
    keyKind(key) {
      const r = TELE_KEYS[key]?.role.r;
      return r === 'glitch' || r === 'inst' ? 'play' : 'button';
    },
    setTestClock(clock) {
      started = true; // スタジオでは Web カメラを自動で開かない
      sources.test.external = clock;
      sources.test.jump(0); // 呼び直すたびにキューで飛んだ分を戻す（頭から再生するとき）
      if (clock && sources.kind !== 'test') sources.openTest();
    },
  };
}
