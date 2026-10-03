// 波形の編集画面（液晶とノブの所に重ねて出す）。
// WAVE：START・END・LOOP の印をドラッグ／CHOP：切り分けてパッドに並べる／TEMPO FIT：BPM を推定して TEMPO に合わせる
import { equalMarks, estimateBpm, onsetMarks, slice, stretch } from './dsp/edit';
import { PADS, defaultPad, padLabel, type PadParams, type SampleBuf } from './dsp/types';

export interface EditHost {
  root: HTMLElement;
  cur(): number;
  bpm(): number;
  sample(pad: number): SampleBuf | null;
  params(pad: number): PadParams;
  name(pad: number): string;
  setParam<K extends keyof PadParams>(pad: number, key: K, v: PadParams[K]): void;
  setPad(pad: number, name: string, data: SampleBuf | null, p: PadParams): void;
  trig(pad: number): void;
  release(pad: number): void;
  msg(text: string, ms?: number): void;
  /** からっぽのバンク（無ければ -1） */
  emptyBank(): number;
  goBank(b: number): void;
  onClose(): void;
  pushUndo(pad: number): void;
}

export interface EditorApi {
  close(): void;
  refresh(): void;
  drawPlay(pos: [number, number][]): void;
}

type Section = 'wave' | 'chop' | 'fit';
type Marker = 'start' | 'end' | 'loopStart';

export function openEditor(h: EditHost, first: Section): EditorApi {
  const root = h.root;
  root.hidden = false;
  root.innerHTML = `
    <div class="pk-ed-head"><b>EDIT</b><span class="pk-ed-pad"></span>
      <span class="pk-seg pk-ed-secs"><button data-s="wave">〰 WAVE</button><button data-s="chop">✂ CHOP</button><button data-s="fit">⏱ TEMPO FIT</button></span>
      <button class="pk-ed-x" title="閉じる">✕</button></div>
    <canvas class="pk-ed-wave" width="1000" height="330"></canvas>
    <div class="pk-ed-body"></div>`;
  const cv = root.querySelector('canvas') as HTMLCanvasElement;
  const g = cv.getContext('2d')!;
  const body = root.querySelector('.pk-ed-body') as HTMLElement;
  let sec: Section = first;
  let pad = h.cur();
  let zoom = false;
  let sel: Marker = 'start';
  let play: [number, number][] = [];
  // チョップ
  let chopMode: 'equal' | 'auto' | 'manual' = 'equal';
  let chopN = 8;
  let sens = 0.5;
  let marks: number[] = [];
  // テンポ合わせ
  let sbpm = 0;

  const s = () => h.sample(pad);
  const p = () => h.params(pad);
  const view = (): [number, number] => {
    if (!zoom) return [0, 1];
    const a = Math.min(p().start, p().end), b = Math.max(p().start, p().end);
    const m = Math.max(0.01, (b - a) * 0.08);
    return [Math.max(0, a - m), Math.min(1, b + m)];
  };

  function regenMarks(): void {
    const smp = s();
    if (!smp) { marks = []; return; }
    if (chopMode === 'equal') marks = equalMarks(chopN);
    else if (chopMode === 'auto') marks = onsetMarks(smp, sens, 16);
  }

  // ---------------- 描く ----------------
  function draw(): void {
    const W = cv.width, H = cv.height;
    g.fillStyle = '#a9c98a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(40,60,20,.08)';
    for (let x = 0; x < W; x += 5) g.fillRect(x, 0, 1, H);
    const smp = s();
    if (!smp) return;
    const [a, b] = view();
    const d = smp.ch[0], n = d.length;
    g.fillStyle = '#20301a';
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor((a + ((b - a) * x) / W) * n), i1 = Math.max(i0 + 1, Math.floor((a + ((b - a) * (x + 1)) / W) * n));
      let lo = 0, hi = 0;
      for (let i = i0; i < Math.min(n, i1); i += Math.max(1, Math.floor((i1 - i0) / 48))) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
      const y0 = H / 2 - hi * (H / 2 - 6), y1 = H / 2 - lo * (H / 2 - 6);
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    const X = (f: number) => ((f - a) / (b - a)) * W;
    const pp = p();
    if (sec === 'chop') {
      g.fillStyle = '#c98a00';
      g.font = '700 16px "Share Tech Mono", monospace';
      const pts = [0, ...marks, 1];
      for (let i = 0; i < pts.length - 1; i++) {
        g.fillRect(X(pts[i]), 0, 2, H);
        g.fillText(String(i + 1), X(pts[i]) + 4, 16);
      }
    } else {
      g.fillStyle = 'rgba(30,45,15,.4)';
      g.fillRect(0, 0, X(Math.min(pp.start, pp.end)), H);
      g.fillRect(X(Math.max(pp.start, pp.end)), 0, W, H);
      const mk = (f: number, col: string, label: string, on: boolean) => {
        g.fillStyle = col;
        g.fillRect(X(f) - (on ? 2 : 1), 0, on ? 4 : 2, H);
        g.fillRect(X(f) - 18, H - 22, 36, 22);
        g.fillStyle = '#fff';
        g.font = '700 13px "Share Tech Mono", monospace';
        g.textAlign = 'center';
        g.fillText(label, X(f), H - 6);
        g.textAlign = 'left';
      };
      if (pp.loop || sel === 'loopStart') mk(Math.max(pp.loopStart, pp.start), '#1a5fb4', 'LP', sel === 'loopStart');
      mk(pp.start, '#1f8a3a', 'S', sel === 'start');
      mk(pp.end, '#c0281c', 'E', sel === 'end');
    }
    g.fillStyle = '#fff6b0';
    for (const [pd, pos] of play) if (pd === pad && pos >= a && pos <= b) g.fillRect(X(pos), 0, 2, H);
  }

  // ---------------- 波形をさわる ----------------
  const fracAt = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    const [a, b] = view();
    return a + (b - a) * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const pxDist = (f: number, e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    const [a, b] = view();
    return Math.abs(((f - a) / (b - a)) * r.width - (e.clientX - r.left));
  };
  let drag: { kind: 'marker'; m: Marker } | { kind: 'mark'; i: number; moved: boolean } | null = null;
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const f = fracAt(e);
    if (sec === 'chop') {
      // いちばん近い切れ目（18px 以内）をつかむ。手で切るモードなら、無ければ足す
      let best = -1, bd = 18;
      marks.forEach((m, i) => { const d = pxDist(m, e); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { drag = { kind: 'mark', i: best, moved: false }; return; }
      if (chopMode !== 'manual') { chopMode = 'manual'; renderBody(); }
      marks = [...marks, f].sort((x, y) => x - y);
      drag = { kind: 'mark', i: marks.indexOf(f), moved: true };
      draw();
      return;
    }
    // START・END・LOOP のうち近いもの（無ければ選んでいる印）を動かす
    const pp = p();
    const cands: [Marker, number][] = [['start', pp.start], ['end', pp.end], ['loopStart', Math.max(pp.loopStart, pp.start)]];
    let m: Marker = sel, bd = 24;
    for (const [k, v] of cands) { if (k === 'loopStart' && !pp.loop && sel !== 'loopStart') continue; const d = pxDist(v, e); if (d < bd) { bd = d; m = k; } }
    sel = m;
    drag = { kind: 'marker', m };
    setMarker(m, f);
    renderBody();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || !cv.hasPointerCapture(e.pointerId)) return;
    const f = fracAt(e);
    if (drag.kind === 'marker') setMarker(drag.m, f);
    else {
      drag.moved = true;
      marks[drag.i] = f;
      draw();
    }
  });
  const up = () => {
    if (drag?.kind === 'mark') {
      // 動かさずに離した切れ目は消す（手で切るモード）
      if (!drag.moved) { marks.splice(drag.i, 1); if (chopMode !== 'manual') { chopMode = 'manual'; renderBody(); } }
      marks.sort((x, y) => x - y);
      updateChopInfo();
      draw();
    }
    drag = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  function setMarker(m: Marker, f: number): void {
    const pp = p();
    f = Math.max(0, Math.min(1, f));
    if (m === 'start') f = Math.min(f, pp.end - 0.001);
    if (m === 'end') f = Math.max(f, pp.start + 0.001);
    if (m === 'loopStart') f = Math.max(pp.start, Math.min(f, pp.end - 0.001));
    h.setParam(pad, m, f);
    draw();
    updateWaveInfo();
  }

  // ---------------- 下の操作 ----------------
  const secs = (f: number) => { const smp = s(); return smp ? `${((f * smp.ch[0].length) / smp.sr).toFixed(3)}s` : ''; };
  function updateWaveInfo(): void {
    const el = body.querySelector('.pk-ed-info');
    if (el && sec === 'wave') { const pp = p(); el.textContent = `START ${secs(pp.start)}　END ${secs(pp.end)}　LOOP ${secs(Math.max(pp.loopStart, pp.start))}${pp.loop ? '' : '（LOOP オフ）'}`; }
  }
  function updateChopInfo(): void {
    const el = body.querySelector('.pk-ed-info');
    if (el && sec === 'chop') el.textContent = `${marks.length + 1} 切れ（最大 16 パッド）${chopMode === 'manual' ? '・波形をタップで切れ目を足す／切れ目をタップで消す' : ''}`;
  }
  function renderBody(): void {
    root.querySelectorAll<HTMLElement>('.pk-ed-secs button').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
    root.querySelector('.pk-ed-pad')!.textContent = `${padLabel(pad)} ${h.name(pad)}`;
    if (sec === 'wave') {
      body.innerHTML = `
        <div class="pk-grp"><button class="pk-btn mode" data-a="try">▶ 試す</button><button class="pk-btn gray${zoom ? ' lit' : ''}" data-a="zoom">🔍 ZOOM</button>
          <span class="pk-seg">${(['start', 'loopStart', 'end'] as Marker[]).map((m) => `<button data-m="${m}" class="${sel === m ? 'on' : ''}">${{ start: 'START', loopStart: 'LOOP', end: 'END' }[m]}</button>`).join('')}</span>
          <span class="pk-seg"><button data-n="-10">◀◀</button><button data-n="-1">◀</button><button data-n="1">▶</button><button data-n="10">▶▶</button></span>
          <button class="pk-btn gray" data-a="zero" title="いちばん近い、波が 0 を横切る所へ（プチッと鳴りにくい）">0 SNAP</button></div>
        <div class="pk-ed-info"></div>`;
      updateWaveInfo();
    } else if (sec === 'chop') {
      body.innerHTML = `
        <div class="pk-grp"><span class="pk-seg">${(['equal', 'auto', 'manual'] as const).map((m) => `<button data-c="${m}" class="${chopMode === m ? 'on' : ''}">${{ equal: '等分', auto: 'AUTO（立ち上がり）', manual: '手で' }[m]}</button>`).join('')}</span>
          ${chopMode === 'equal' ? `<span class="pk-seg">${[2, 4, 8, 16].map((n) => `<button data-k="${n}" class="${chopN === n ? 'on' : ''}">${n}</button>`).join('')}</span>` : ''}
          ${chopMode === 'auto' ? `<span class="pk-lbl">細かさ</span><button class="pk-btn gray" data-a="sens-">−</button><span class="pk-num">${Math.round(sens * 100)}</span><button class="pk-btn gray" data-a="sens+">＋</button>` : ''}
          ${chopMode === 'manual' ? '<button class="pk-btn gray" data-a="clear">切れ目を全部消す</button>' : ''}</div>
        <div class="pk-grp"><button class="pk-btn mode" data-a="try">▶ 試す</button><button class="pk-btn orange" data-a="place">→ パッドに並べる</button></div>
        <div class="pk-ed-info"></div>`;
      updateChopInfo();
    } else {
      const pp = p();
      body.innerHTML = `
        <div class="pk-grp"><span class="pk-lbl">この音の BPM</span><button class="pk-btn gray" data-a="b-">−</button><span class="pk-num">${sbpm.toFixed(1)}</span><button class="pk-btn gray" data-a="b+">＋</button>
          <span class="pk-seg"><button data-a="half">÷2</button><button data-a="dbl">×2</button></span><button class="pk-btn gray" data-a="est">推定し直す</button></div>
        <div class="pk-grp"><span class="pk-lbl">→ TEMPO ${h.bpm().toFixed(1)}</span><button class="pk-btn orange" data-a="stretch">音程そのまま（STRETCH）</button><button class="pk-btn mode" data-a="vari">速さだけ（PITCH で）</button><button class="pk-btn mode" data-a="try">▶ 試す</button></div>
        <div class="pk-ed-info">長さ ${secs(1)}・${sbpm ? `${((s()!.ch[0].length / s()!.sr) * sbpm / 60).toFixed(2)} 拍` : ''}${pp.pitch || pp.fine ? `・いまの PITCH ${pp.pitch} / FINE ${pp.fine}` : ''}</div>`;
    }
    body.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => act(b)));
    draw();
  }

  function act(b: HTMLButtonElement): void {
    const a = b.dataset.a;
    const smp = s();
    if (!smp) return;
    if (b.dataset.m) { sel = b.dataset.m as Marker; renderBody(); return; }
    if (b.dataset.n) {
      const f = p()[sel] + (Number(b.dataset.n) * 0.001 * smp.sr) / smp.ch[0].length; // 1ms ずつ
      setMarker(sel, f);
      return;
    }
    if (b.dataset.c) { chopMode = b.dataset.c as typeof chopMode; if (chopMode !== 'manual') regenMarks(); renderBody(); return; }
    if (b.dataset.k) { chopN = Number(b.dataset.k); regenMarks(); renderBody(); return; }
    switch (a) {
      case 'try': h.trig(pad); setTimeout(() => h.release(pad), 600); break;
      case 'zoom': zoom = !zoom; renderBody(); break;
      case 'zero': {
        const d = smp.ch[0], i = Math.round(p()[sel] * d.length);
        let best = i;
        for (let k = 0; k < smp.sr * 0.01; k++) {
          if (i + k + 1 < d.length && Math.sign(d[i + k]) !== Math.sign(d[i + k + 1])) { best = i + k; break; }
          if (i - k - 1 >= 0 && Math.sign(d[i - k]) !== Math.sign(d[i - k - 1])) { best = i - k; break; }
        }
        setMarker(sel, best / d.length);
        break;
      }
      case 'sens-': sens = Math.max(0, sens - 0.1); regenMarks(); renderBody(); break;
      case 'sens+': sens = Math.min(1, sens + 0.1); regenMarks(); renderBody(); break;
      case 'clear': marks = []; renderBody(); break;
      case 'place': placeSlices(); break;
      case 'b-': setSbpm(sbpm - 0.5); break;
      case 'b+': setSbpm(sbpm + 0.5); break;
      case 'half': setSbpm(sbpm / 2); break;
      case 'dbl': setSbpm(sbpm * 2); break;
      case 'est': setSbpm(estimateBpm(smp)); break;
      case 'stretch': {
        if (!sbpm) return;
        const ratio = sbpm / h.bpm();
        if (Math.abs(ratio - 1) < 0.002) { h.msg('もう TEMPO と同じです', 2000); return; }
        h.msg('ストレッチ中…');
        setTimeout(() => {
          h.pushUndo(pad);
          const out = stretch(smp, ratio);
          h.setPad(pad, h.name(pad), out, { ...p(), bpm: h.bpm(), start: 0, end: 1, loopStart: 0 });
          sbpm = h.bpm();
          h.msg(`音程そのまま、${h.bpm().toFixed(1)} BPM にしました（UNDO で戻せる）`, 3000);
          renderBody();
        }, 30);
        break;
      }
      case 'vari': {
        if (!sbpm) return;
        const cents = 1200 * Math.log2(h.bpm() / sbpm);
        if (Math.abs(cents) > 2400) { h.msg('速さが違いすぎます（2 オクターブまで）', 2500); return; }
        const semi = Math.round(cents / 100);
        const fine = Math.round(cents - semi * 100);
        h.setParam(pad, 'pitch', semi);
        h.setParam(pad, 'fine', Math.max(-50, Math.min(50, fine)));
        h.msg(`PITCH ${semi > 0 ? '+' : ''}${semi}・FINE ${fine} で ${h.bpm().toFixed(1)} BPM の速さ（音程も変わる）`, 3000);
        renderBody();
        break;
      }
    }
  }

  function setSbpm(v: number): void {
    sbpm = Math.round(Math.max(30, Math.min(300, v)) * 10) / 10;
    h.setParam(pad, 'bpm', sbpm);
    renderBody();
  }

  /** 切れ目で切って、からっぽのバンク（無ければいまのバンク）に並べる */
  function placeSlices(): void {
    const smp = s();
    if (!smp) return;
    const parts = slice(smp, marks).slice(0, PADS);
    if (parts.length < 2) { h.msg('切れ目がありません', 2000); return; }
    let b = h.emptyBank();
    if (b < 0) {
      b = Math.floor(pad / PADS);
      if (!confirm(`空いているバンクがありません。バンク ${'ABCDEFGHIJ'[b]} のパッド 1〜${parts.length} に上書きしますか？`)) return;
    }
    const src = p();
    const base = (h.name(pad) || 'SLICE').replace(/\s+/g, '').slice(0, 6);
    parts.forEach((part, i) => {
      h.setPad(b * PADS + i, `${base}#${i + 1}`, part, {
        ...defaultPad(), vol: src.vol, pan: src.pan, pitch: src.pitch, fine: src.fine,
        cutoff: src.cutoff, reso: src.reso, attack: src.attack, release: src.release, vel: src.vel,
      });
    });
    h.goBank(b);
    h.msg(`${parts.length} 切れをバンク ${'ABCDEFGHIJ'[b]} のパッド 1〜${parts.length} に並べました`, 3500);
    close();
  }

  // ---------------- 開く・閉じる ----------------
  root.querySelectorAll<HTMLButtonElement>('.pk-ed-secs button').forEach((b) => b.addEventListener('click', () => { sec = b.dataset.s as Section; renderBody(); }));
  root.querySelector('.pk-ed-x')!.addEventListener('click', () => close());
  const init = () => {
    pad = h.cur();
    const smp = s();
    sbpm = p().bpm || (smp ? estimateBpm(smp) : 120);
    regenMarks();
    renderBody();
  };
  init();
  function close(): void {
    root.hidden = true;
    root.innerHTML = '';
    h.onClose();
  }
  return {
    close,
    // 選んでいるパッドが変わったら、その音を編集する
    refresh: () => { if (h.cur() !== pad) init(); else { draw(); if (sec === 'wave') updateWaveInfo(); } },
    drawPlay: (pos) => { play = pos; draw(); },
  };
}
