// ラック・スタジオに並べる PAKU-PAKU 16 の画面（小さい版）。
// 音と設定は、サンプラーのページ（sampler.html）でこのブラウザに保存したものを読む（無ければ工場出荷の音）。
// 音を作り直すのはサンプラーのページで。ここではパッドを叩く・メロディ／ベースに使うパッドを決める・シーケンサーで録る・自動作曲。
import './toy.css';
import { Knob, momentary } from '../../core/controls';
import { noteName, type HostApi, type ToyUI } from '../../core/ui';
import type { FromToy } from '../../host/protocol';
import type { BendState } from '../dsp/bend';
import type { FxSlot } from '../dsp/fx';
import { BANK_NAMES, PADS, PAD_COUNT, defaultPad, padLabel, type PadParams, type SampleBuf } from '../dsp/types';
import { loadAll, loadMeta } from '../store';
import { BASS_KEY, BASS_ROOT_KEY, KEY_COUNT, MELO_ROOT_KEY, SAMPLER_PARAMS, SP, type SamplerCustom, type SamplerDisplay } from './engine';

const W = 760;
const H = 960;
const KEYMAP: Record<string, number> = {
  KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3, KeyA: 4, KeyS: 5, KeyD: 6, KeyF: 7,
  KeyQ: 8, KeyW: 9, KeyE: 10, KeyR: 11, Digit1: 12, Digit2: 13, Digit3: 14, Digit4: 15,
};

const HELP = `
<h3>PAKU-PAKU 16（サンプラー）</h3>
<table>
  <tr><td>POWER</td><td>左上の赤いボタン（パクッ、パクッと鳴って起動）。電源 OFF のときは Enter キーでも入る</td></tr>
  <tr><td>パッド</td><td>押すと鳴る。シーケンサーではキー A-01〜J-16 の行になる</td></tr>
  <tr><td>A〜J</td><td>バンクの切り替え（PC は [ ]）</td></tr>
  <tr><td>Z X C V・A S D F・Q W E R・1 2 3 4</td><td>いまのバンクのパッド 1〜16（下の段から）</td></tr>
  <tr><td>♪ MELO / BASS</td><td>いま選んでいるパッドを、メロディ用・ベース用にする。シーケンサーの「♪」「BASS」の行で、そのパッドの音を音程を変えて弾ける（自動作曲もこれを使う。最初は B-09 TOY PNO と B-02 BASS C）</td></tr>
  <tr><td>BEND</td><td>ノブを上げるほど基板のジャンパー線が増えて壊れる（0 ならサンプラーのページの設定）</td></tr>
  <tr><td>音を作る</td><td>「サンプラーを開く」で PAKU-PAKU 16 のページへ。録音・チョップ・エフェクト・パターンはそちらで。戻ったら「↻ 読み直す」</td></tr>
  <tr><td>自動作曲</td><td>バンク A をドラム（1 KICK・2 SNARE・3 CL HAT・4 OP HAT・5 CLAP・11 BOOM・12 LOFI SN・13 CRASH）、メロディ・ベースのパッドで曲を作る</td></tr>
  <tr><td>MIDI</td><td>ノート 36〜51 = いまのバンクのパッド 1〜16、CC1 = BEND</td></tr>
</table>`;

export function mountSamplerToy(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-pkt';
  root.innerHTML = `
    <div class="pkt-body">
      <div class="pkt-head">
        <div class="pkt-power"><div class="dome big pkt-pwr" data-id="power"></div><span class="pkt-led" data-id="led"></span><small>POWER</small></div>
        <b>PAKU-PAKU</b><span>16</span><i class="pkt-mouth"></i>
      </div>
      <div class="pkt-lcd"><div class="pkt-lcd-top"><b class="pkt-no">A-01</b><span class="pkt-name"></span><span class="pkt-st"></span></div><canvas class="pkt-wave" width="680" height="96"></canvas></div>
      <div class="pkt-row">
        <button class="pkt-btn" data-a="melo" title="いま選んでいるパッドをメロディ用に">♪ MELO</button><span class="pkt-val" data-id="melo"></span>
        <button class="pkt-btn" data-a="bass" title="いま選んでいるパッドをベース用に">BASS</button><span class="pkt-val" data-id="bass"></span>
        <div class="pkt-knob"><div class="knob black small" data-id="bend"><div class="cap"></div></div><small>BEND</small></div>
        <div class="pkt-knob"><div class="knob small" data-id="vol"><div class="cap"></div></div><small>VOL</small></div>
      </div>
      <div class="pkt-row">
        <button class="pkt-btn" data-a="reload" title="サンプラーのページで変えた音を読み直す">↻ 読み直す</button>
        <a class="pkt-btn" href="sampler.html" target="_blank" rel="noopener">サンプラーを開く ↗</a>
        <button class="pkt-btn" data-a="stop">■ STOP</button>
      </div>
      <div class="pkt-banks">${[...BANK_NAMES].map((b, i) => `<button data-b="${i}">${b}</button>`).join('')}</div>
      <div class="pkt-pads"></div>
    </div>`;
  const q = (s: string) => root.querySelector(s) as HTMLElement;
  const $ = (id: string) => q(`[data-id="${id}"]`);
  const names: string[] = Array.from({ length: PAD_COUNT }, () => '');
  const has: boolean[] = Array.from({ length: PAD_COUNT }, () => false);
  // 液晶の波形用：パッドの音と、鳴らす範囲（START・END）
  const bufs = new Map<number, SampleBuf>();
  const pparams = new Map<number, PadParams>();
  const peaks = new Map<number, Float32Array>();
  let playPos: [number, number][] = [];
  const wave = q('.pkt-wave') as HTMLCanvasElement;
  const wg = wave.getContext('2d')!;
  function peaksOf(pad: number): Float32Array | null {
    const s = bufs.get(pad);
    if (!s) return null;
    let pk = peaks.get(pad);
    if (pk) return pk;
    const W = wave.width, d = s.ch[0], n = d.length;
    pk = new Float32Array(W * 2);
    for (let x = 0; x < W; x++) {
      const a = Math.floor((x / W) * n), b = Math.max(a + 1, Math.floor(((x + 1) / W) * n));
      let lo = 0, hi = 0;
      for (let i = a; i < Math.min(n, b); i += Math.max(1, Math.floor((b - a) / 48))) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
      pk[x * 2] = lo; pk[x * 2 + 1] = hi;
    }
    peaks.set(pad, pk);
    return pk;
  }
  /** 液晶：いまのパッドの波形・鳴らす範囲（赤い線）・再生位置（明るい線） */
  function drawWave(): void {
    const W = wave.width, H2 = wave.height, c = wg;
    c.fillStyle = powered ? '#a9c98a' : '#6f7f5c';
    c.fillRect(0, 0, W, H2);
    c.fillStyle = 'rgba(40,60,20,.08)';
    for (let x = 0; x < W; x += 4) c.fillRect(x, 0, 1, H2);
    const pk = peaksOf(cur);
    if (!pk) {
      c.fillStyle = '#2b3a1c';
      c.font = '700 16px "Share Tech Mono", monospace';
      c.textAlign = 'center';
      c.fillText('からっぽ', W / 2, H2 / 2 + 6);
      c.textAlign = 'left';
      return;
    }
    c.fillStyle = '#20301a';
    for (let x = 0; x < W; x++) {
      const lo = pk[x * 2], hi = pk[x * 2 + 1];
      const y0 = H2 / 2 - hi * (H2 / 2 - 3), y1 = H2 / 2 - lo * (H2 / 2 - 3);
      c.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    const p = pparams.get(cur) ?? defaultPad();
    const xs = Math.min(p.start, p.end) * W, xe = Math.max(p.start, p.end) * W;
    c.fillStyle = 'rgba(30,45,15,.45)';
    c.fillRect(0, 0, xs, H2);
    c.fillRect(xe, 0, W - xe, H2);
    c.fillStyle = '#c0281c';
    c.fillRect(xs, 0, 2, H2);
    c.fillRect(xe - 2, 0, 2, H2);
    c.fillStyle = '#fff6b0';
    for (const [pd, ps] of playPos) if (pd === cur) c.fillRect(ps * W, 0, 2, H2);
  }
  const params = Float32Array.from(SAMPLER_PARAMS.map((p) => p.default));
  let bank = 0;
  let cur = 0;
  let powered = false;
  let sent: { key: string; data: SamplerCustom }[] = [];
  const lit = new Set<number>();
  const shown = new Set<number>();

  const padEls: HTMLElement[] = [];
  for (let row = 3; row >= 0; row--) for (let col = 0; col < 4; col++) {
    const i = row * 4 + col;
    const el = document.createElement('div');
    el.className = `pkt-pad r${row}`;
    el.innerHTML = `<span class="no">${i + 1}</span><span class="nm"></span>`;
    padEls[i] = el;
    q('.pkt-pads').appendChild(el);
  }
  const padText = (p: number) => `${padLabel(p)} ${names[p] || ''}`.trim();
  function render(): void {
    const melo = params[SP.meloPad] | 0, bass = params[SP.bassPad] | 0;
    for (let i = 0; i < PADS; i++) {
      const pad = bank * PADS + i;
      padEls[i].classList.toggle('empty', !has[pad]);
      padEls[i].classList.toggle('sel', pad === cur);
      padEls[i].classList.toggle('on', lit.has(pad) || shown.has(pad));
      padEls[i].classList.toggle('melo', pad === melo);
      padEls[i].classList.toggle('bass', pad === bass);
      (padEls[i].querySelector('.nm') as HTMLElement).textContent = names[pad];
    }
    root.querySelectorAll<HTMLElement>('.pkt-banks button').forEach((b) => {
      const k = Number(b.dataset.b);
      b.classList.toggle('on', k === bank);
      b.classList.toggle('has', has.slice(k * PADS, k * PADS + PADS).some(Boolean));
    });
    q('.pkt-no').textContent = padLabel(cur);
    q('.pkt-name').textContent = names[cur] || (has[cur] ? '—' : '（からっぽ）');
    $('melo').textContent = padText(melo);
    $('bass').textContent = padText(bass);
    $('led').classList.toggle('on', powered);
    drawWave();
    root.classList.toggle('off', !powered);
  }
  const setBank = (b: number) => { bank = (b + 10) % 10; cur = bank * PADS + (cur % PADS); render(); };
  root.querySelectorAll<HTMLElement>('.pkt-banks button').forEach((b) => b.addEventListener('click', () => setBank(Number(b.dataset.b))));

  // ---- パラメーター ----
  const setParam = (i: number, v: number) => { params[i] = v; api.post({ type: 'param', index: i, value: v }); render(); };
  const bendKnob = new Knob($('bend'), { default: 0 }, (v) => setParam(SP.bend, v));
  const volKnob = new Knob($('vol'), { default: 0.8 }, (v) => setParam(SP.volume, v));
  volKnob.set(0.8, false);
  q('[data-a="melo"]').addEventListener('click', () => setParam(SP.meloPad, cur));
  q('[data-a="bass"]').addEventListener('click', () => setParam(SP.bassPad, cur));
  const stopBtn = q('[data-a="stop"]');
  momentary(stopBtn, () => setParam(SP.stop, 1), () => setParam(SP.stop, 0));

  // ---- 電源 ----
  const pwr = $('power');
  const powerOn = () => { void api.start(); api.post({ type: 'power', on: true }); powered = true; render(); };
  const powerOff = () => { api.post({ type: 'power', on: false }); powered = false; render(); };
  pwr.addEventListener('click', () => (powered ? powerOff() : powerOn()));

  // ---- 音を送る（サンプラーのページで保存したもの。無ければエンジンの中の工場出荷の音のまま） ----
  async function load(): Promise<void> {
    q('.pkt-st').textContent = '読み込み中…';
    const [stored, meta] = await Promise.all([loadAll(), loadMeta<{ bpm?: number; fx?: FxSlot[]; bend?: BendState }>()]);
    names.fill('');
    has.fill(false);
    bufs.clear();
    pparams.clear();
    peaks.clear();
    sent = [];
    if (stored && stored.length) {
      for (const s of stored) {
        names[s.pad] = s.name;
        has[s.pad] = !!s.sample;
        if (s.sample) bufs.set(s.pad, s.sample);
        pparams.set(s.pad, { ...defaultPad(), ...s.params });
        const data: SamplerCustom = { kind: 'pad', pad: s.pad, data: s.sample, p: { ...defaultPad(), ...s.params } };
        sent.push({ key: `pad${s.pad}`, data });
        api.post({ type: 'custom', key: `pad${s.pad}`, data });
      }
    } else {
      // まだサンプラーを開いていない：工場出荷の音（エンジンにはもう入っている）
      const { factoryBank, factoryParams } = await import('../dsp/factory');
      for (const b of [0, 1] as const) factoryBank(b).forEach((s, i) => {
        const pad = b * PADS + i;
        names[pad] = s.name;
        has[pad] = true;
        bufs.set(pad, s.buf);
        pparams.set(pad, factoryParams(s));
      });
    }
    if (meta) {
      const m: SamplerCustom = { kind: 'meta', bpm: meta.bpm ?? 120, fx: Array.isArray(meta.fx) && meta.fx.length === 3 ? meta.fx : (await import('../dsp/fx')).defaultSlots(), bend: meta.bend };
      sent.push({ key: 'meta', data: m });
      api.post({ type: 'custom', key: 'meta', data: m });
    }
    q('.pkt-st').textContent = `${has.filter(Boolean).length} 音`;
    render();
  }
  q('[data-a="reload"]').addEventListener('click', () => void load());
  void load();

  // ---- 叩く ----
  const down = (i: number) => {
    const pad = bank * PADS + i;
    void api.start();
    api.post({ type: 'key', key: pad, down: true });
    lit.add(pad);
    cur = pad;
    render();
  };
  const up = (i: number) => {
    const pad = bank * PADS + i;
    api.post({ type: 'key', key: pad, down: false });
    lit.delete(pad);
    render();
  };
  padEls.forEach((el, i) => {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); down(i); });
    el.addEventListener('pointerup', () => up(i));
    el.addEventListener('pointercancel', () => up(i));
  });
  const held = new Set<number>();
  render();

  return {
    title: 'PAKU-PAKU 16',
    width: W,
    height: H,
    root,
    help: HELP,
    paramDefs: SAMPLER_PARAMS,
    keyCount: KEY_COUNT,
    powerButton: pwr,
    keyName: (k) => {
      if (k < PAD_COUNT) return `${padLabel(k)}${names[k] ? ` ${names[k]}` : ''}`;
      if (k < BASS_KEY) { const d = k - MELO_ROOT_KEY; return `♪ ${d > 0 ? '+' : ''}${d}（${noteName(72 + d)}）`; }
      const d = k - BASS_ROOT_KEY;
      return `BASS ${d > 0 ? '+' : ''}${d}（${noteName(36 + d)}）`;
    },
    keyKind: () => 'play',
    onMessage(m: FromToy) {
      if (m.type === 'display') {
        const d = m.display as SamplerDisplay;
        shown.clear();
        for (const p of d.playing) shown.add(p);
        playPos = d.pos ?? [];
        render();
      } else if (m.type === 'status' && m.status.powered !== powered) {
        powered = m.status.powered;
        render();
      }
    },
    keyDown(e) {
      if (e.code === 'Enter' && !powered) { powerOn(); return true; }
      const i = KEYMAP[e.code];
      if (i !== undefined) { if (!e.repeat && !held.has(i)) { held.add(i); down(i); } return true; }
      if (e.code === 'BracketLeft') { setBank(bank - 1); return true; }
      if (e.code === 'BracketRight') { setBank(bank + 1); return true; }
      return false;
    },
    keyUp(e) {
      const i = KEYMAP[e.code];
      if (i !== undefined && held.delete(i)) up(i);
    },
    releaseAll() {
      for (const i of held) up(i);
      held.clear();
    },
    midi(status, d1, d2) {
      const cmd = status & 0xf0, i = d1 - 36;
      if (cmd === 0xb0 && d1 === 1) { bendKnob.set(d2 / 127); return; }
      if (i < 0 || i >= PADS) return;
      if (cmd === 0x90 && d2 > 0) down(i);
      else if (cmd === 0x80 || cmd === 0x90) up(i);
    },
    powerOn,
    powerOff,
    showKey(key, on) {
      const pad = key < PAD_COUNT ? key : key < BASS_KEY ? params[SP.meloPad] | 0 : params[SP.bassPad] | 0;
      if (on) shown.add(pad); else shown.delete(pad);
      render();
    },
    showParam(index, v) {
      params[index] = v;
      if (index === SP.bend) bendKnob.set(v, false);
      if (index === SP.volume) volKnob.set(v, false);
      render();
    },
    customData: () => sent.map((s) => ({ key: s.key, data: s.data })),
  };
}
