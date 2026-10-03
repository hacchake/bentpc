// スタジオ（DAW）に並べる PAKU-PAKU 16 の画面（小さい版）。
// 音と設定は、サンプラーのページ（sampler.html）でこのブラウザに保存したものを読む（無ければ工場出荷の音）。
// 音を作り直すのはサンプラーのページで。ここではバンクを選んでパッドを叩く・シーケンサーで録る・鳴らす。
import './toy.css';
import type { HostApi, ToyUI } from '../../core/ui';
import type { FromToy } from '../../host/protocol';
import type { BendState } from '../dsp/bend';
import { factoryBank, factoryParams } from '../dsp/factory';
import { defaultSlots, type FxSlot } from '../dsp/fx';
import { BANK_NAMES, PADS, PAD_COUNT, defaultPad, padLabel, type PadParams, type SampleBuf } from '../dsp/types';
import { loadAll, loadMeta } from '../store';
import { SAMPLER_PARAMS, type SamplerCustom, type SamplerDisplay } from './engine';

const W = 760;
const H = 820;
const KEYMAP: Record<string, number> = {
  KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3, KeyA: 4, KeyS: 5, KeyD: 6, KeyF: 7,
  KeyQ: 8, KeyW: 9, KeyE: 10, KeyR: 11, Digit1: 12, Digit2: 13, Digit3: 14, Digit4: 15,
};

const HELP = `
<h3>PAKU-PAKU 16（サンプラー）</h3>
<table>
  <tr><td>パッド</td><td>押すと鳴る。シーケンサーではキー A-01〜J-16 の行になる</td></tr>
  <tr><td>A〜J</td><td>バンクの切り替え（PC は [ ]）</td></tr>
  <tr><td>Z X C V・A S D F・Q W E R・1 2 3 4</td><td>いまのバンクのパッド 1〜16（下の段から）</td></tr>
  <tr><td>音を作る</td><td>「サンプラーを開く」で PAKU-PAKU 16 のページへ。録音・チョップ・エフェクト・パターンはそちらで。戻ったら「↻ 読み直す」</td></tr>
  <tr><td>MIDI</td><td>ノート 36〜51 = いまのバンクのパッド 1〜16</td></tr>
</table>`;

export function mountSamplerToy(api: HostApi): ToyUI {
  const root = document.createElement('div');
  root.className = 'toy-root toy-pkt';
  root.innerHTML = `
    <div class="pkt-body">
      <div class="pkt-head"><b>PAKU-PAKU</b><span>16</span><i class="pkt-mouth"></i></div>
      <div class="pkt-lcd"><b class="pkt-pad">A-01</b><span class="pkt-name"></span><span class="pkt-st"></span></div>
      <div class="pkt-row">
        <button class="pkt-btn" data-a="reload" title="サンプラーのページで変えた音を読み直す">↻ 読み直す</button>
        <a class="pkt-btn" href="sampler.html" target="_blank" rel="noopener">サンプラーを開く ↗</a>
      </div>
      <div class="pkt-banks">${[...BANK_NAMES].map((b, i) => `<button data-b="${i}">${b}</button>`).join('')}</div>
      <div class="pkt-pads"></div>
    </div>`;
  const q = (s: string) => root.querySelector(s) as HTMLElement;
  const names: string[] = Array.from({ length: PAD_COUNT }, () => '');
  const has: boolean[] = Array.from({ length: PAD_COUNT }, () => false);
  let bank = 0;
  let cur = 0;
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
  function render(): void {
    for (let i = 0; i < PADS; i++) {
      const pad = bank * PADS + i;
      padEls[i].classList.toggle('empty', !has[pad]);
      padEls[i].classList.toggle('sel', pad === cur);
      padEls[i].classList.toggle('on', lit.has(pad) || shown.has(pad));
      (padEls[i].querySelector('.nm') as HTMLElement).textContent = names[pad];
    }
    root.querySelectorAll<HTMLElement>('.pkt-banks button').forEach((b) => {
      const k = Number(b.dataset.b);
      b.classList.toggle('on', k === bank);
      b.classList.toggle('has', has.slice(k * PADS, k * PADS + PADS).some(Boolean));
    });
    q('.pkt-pad').textContent = padLabel(cur);
    q('.pkt-name').textContent = names[cur] || (has[cur] ? '—' : '（からっぽ）');
  }
  const setBank = (b: number) => { bank = (b + 10) % 10; cur = bank * PADS + (cur % PADS); render(); };
  root.querySelectorAll<HTMLElement>('.pkt-banks button').forEach((b) => b.addEventListener('click', () => setBank(Number(b.dataset.b))));

  // ---- 音を送る（サンプラーのページで保存したもの。無ければ工場出荷の音） ----
  async function load(): Promise<void> {
    q('.pkt-st').textContent = '読み込み中…';
    const [stored, meta] = await Promise.all([loadAll(), loadMeta<{ bpm?: number; fx?: FxSlot[]; bend?: BendState }>()]);
    const pads: { pad: number; name: string; data: SampleBuf | null; p: PadParams }[] = [];
    if (stored && stored.length) for (const s of stored) pads.push({ pad: s.pad, name: s.name, data: s.sample, p: { ...defaultPad(), ...s.params } });
    else for (const b of [0, 1] as const) factoryBank(b).forEach((s, i) => pads.push({ pad: b * PADS + i, name: s.name, data: s.buf, p: factoryParams(s) }));
    names.fill('');
    has.fill(false);
    sent = [];
    for (const x of pads) {
      names[x.pad] = x.name;
      has[x.pad] = !!x.data;
      const data: SamplerCustom = { kind: 'pad', pad: x.pad, data: x.data, p: x.p };
      sent.push({ key: `pad${x.pad}`, data });
      api.post({ type: 'custom', key: `pad${x.pad}`, data });
    }
    const m: SamplerCustom = { kind: 'meta', bpm: meta?.bpm ?? 120, fx: Array.isArray(meta?.fx) && meta.fx.length === 3 ? meta.fx : defaultSlots(), bend: meta?.bend };
    sent.push({ key: 'meta', data: m });
    api.post({ type: 'custom', key: 'meta', data: m });
    q('.pkt-st').textContent = `${pads.filter((x) => x.data).length} 音`;
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
    keyCount: PAD_COUNT,
    keyName: (k) => `${padLabel(k)}${names[k] ? ` ${names[k]}` : ''}`,
    keyKind: () => 'play',
    onMessage(m: FromToy) {
      if (m.type === 'display') {
        const d = m.display as SamplerDisplay;
        shown.clear();
        for (const p of d.playing) shown.add(p);
        render();
      }
    },
    keyDown(e) {
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
      if (i < 0 || i >= PADS) return;
      if (cmd === 0x90 && d2 > 0) down(i);
      else if (cmd === 0x80 || cmd === 0x90) up(i);
    },
    powerOn() {},
    powerOff() {},
    showKey(key, on) {
      if (on) shown.add(key); else shown.delete(key);
      render();
    },
    customData: () => sent.map((s) => ({ key: s.key, data: s.data })),
  };
}
