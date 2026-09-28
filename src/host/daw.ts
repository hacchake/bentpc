// シーケンサーの編集画面（画面の下から出てくるパネル）。
// ・トランスポート：再生／停止、操作の録音（オーバーダブ）、BPM、小節数、グリッド、メトロノーム
// ・トラック：おもちゃ 1 台 = 1 トラック（ミュートつき）
// ・ピアノロール：音符の選択・移動・長さ変更・追加・削除・クオンタイズ
// ・オートメーション：ツマミの動きを点で表示し、ドラッグ・追加・削除
// ・元に戻す／やり直し、曲の保存・読み込み、BOUNCE（WAV 書き出し）
import './daw.css';
import { clampSong, cloneSong, emptySong, mergeTake, songBeats, type SeqNote, type Song, type takeFromRaw } from '../core/song';
import type { ToyUI } from '../core/ui';

const STORE = 'bentpc.song.v1';
const ROW_H = 18;
const GUTTER = 110; // 行の名前を書く左の幅
const GRIDS: [string, number][] = [['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['OFF', 0]];

export interface DawHost {
  toys: ToyUI[];
  send(song: Song): void;
  transport(play: boolean, from?: number): void;
  record(on: boolean, take: number): void;
  bounce(): void;
  activeToy(): number;
  onOpenChange(open: boolean): void;
}

export class Daw {
  song: Song;
  open = false;
  focused = false; // 最後にパネルの中をクリックした（キー操作を編集に使う）
  private el: HTMLElement;
  private roll: HTMLCanvasElement;
  private lane: HTMLCanvasElement;
  private track = 0;
  private sel = new Set<SeqNote>();
  private selAuto = -1;
  private laneParam = -1;
  private pxPerBeat = 60;
  private viewStart = 0; // 表示の左端（拍）
  private scrollY = 0;
  private grid = 0.25;
  private playhead = 0;
  private playing = false;
  private recording = false;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private extraRows = new Map<number, Set<number>>(); // 手で足した行（トラックごと）
  private $: (id: string) => HTMLElement;

  constructor(private host: DawHost) {
    this.song = this.load() ?? emptySong(host.toys.length);
    while (this.song.tracks.length < host.toys.length) this.song.tracks.push({ mute: false, notes: [], autos: [] });
    this.el = document.createElement('div');
    this.el.id = 'daw';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="daw-bar">
        <button data-id="home" title="最初へ">⏮</button>
        <button data-id="play" title="再生／停止（パネル内で Space）">▶</button>
        <button data-id="rec" class="rec" title="操作を録音（重ね録り）">● REC</button>
        <span class="pos" data-id="pos">1.1</span>
        <button data-id="undo" title="元に戻す（Ctrl+Z）">↶ UNDO</button>
        <button data-id="redo" title="やり直し（Ctrl+Y）">↷</button>
        <label>BPM <input data-id="bpm" type="number" min="40" max="300" step="1"></label>
        <label>小節 <select data-id="bars">${[1, 2, 4, 8, 16, 32].map((b) => `<option>${b}</option>`).join('')}</select></label>
        <label>グリッド <select data-id="grid">${GRIDS.map(([n], i) => `<option value="${i}">${n}</option>`).join('')}</select></label>
        <label class="chk"><input data-id="metro" type="checkbox"> メトロノーム</label>
        <span class="sp"></span>
        <button data-id="quant" title="選んだ音符（なければ全部）をグリッドにそろえる">QUANTIZE</button>
        <button data-id="del" title="選んだ音符・点を消す（Delete）">削除</button>
        <button data-id="clear" title="このトラックを空にする">トラックを空に</button>
        <button data-id="zin" title="拡大">＋</button><button data-id="zout" title="縮小">－</button>
        <button data-id="bounce" title="曲を最初から最後まで鳴らして WAV に書き出す">BOUNCE</button>
        <button data-id="save" title="曲をファイルに保存">保存</button>
        <button data-id="load" title="曲のファイルを読み込む">読込</button>
        <input data-id="file" type="file" accept=".json,application/json" hidden>
        <button data-id="close" title="閉じる">✕</button>
      </div>
      <div class="daw-main">
        <div class="daw-tracks" data-id="tracks"></div>
        <div class="daw-edit">
          <canvas data-id="roll"></canvas>
          <div class="daw-lanebar">
            <span>ツマミの動き：</span><select data-id="param"></select>
            <span>行を追加：</span><select data-id="addrow"></select>
            <span class="hint">音符：ダブルクリックで追加・ドラッグで移動・右端で長さ・右クリックで削除 ／ 点：ダブルクリックで追加・ドラッグ・右クリックで削除</span>
          </div>
          <canvas data-id="lane"></canvas>
        </div>
      </div>`;
    document.body.appendChild(this.el);
    this.$ = (id) => this.el.querySelector(`[data-id="${id}"]`) as HTMLElement;
    this.roll = this.$('roll') as HTMLCanvasElement;
    this.lane = this.$('lane') as HTMLCanvasElement;
    this.bindBar();
    this.bindRoll();
    this.bindLane();
    this.el.addEventListener('pointerdown', () => { this.focused = true; });
    window.addEventListener('pointerdown', (e) => { if (!this.el.contains(e.target as Node)) this.focused = false; }, true);
    window.addEventListener('resize', () => this.draw());
    this.refreshAll();
  }

  // ================= 公開：main.ts から =================
  toggle(open = !this.open): void {
    this.open = open;
    this.el.hidden = !open;
    if (open) this.selectTrack(this.host.activeToy());
    this.host.onOpenChange(open);
    this.draw();
  }

  get height(): number {
    return this.open ? this.el.offsetHeight : 0;
  }

  /** Worklet の再生位置 */
  setPos(beat: number, playing: boolean, recording: boolean): void {
    const changed = playing !== this.playing || recording !== this.recording;
    this.playhead = beat;
    this.playing = playing;
    this.recording = recording;
    if (changed) this.refreshBar();
    const bar = Math.floor(beat / 4) + 1, bt = Math.floor(beat % 4) + 1;
    this.$('pos').textContent = `${bar}.${bt}`;
    if (this.open) {
      // 再生位置が見えなくなったら表示を送る
      const w = this.roll.clientWidth - GUTTER;
      if (playing && (beat < this.viewStart || beat > this.viewStart + w / this.pxPerBeat)) this.viewStart = Math.max(0, beat - 1);
      this.draw();
    }
  }

  /** 録音したテイクを曲に足す（Worklet でも同じものが足されている） */
  addTake(data: ReturnType<typeof takeFromRaw>): void {
    mergeTake(this.song, data);
    this.persist();
    this.refreshTracks();
    this.draw();
  }

  /** パネルに注目しているときのキー操作。処理したら true */
  keyDown(e: KeyboardEvent): boolean {
    if (!this.open || !this.focused) return false;
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return false;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { this.undo(); return true; }
    if (ctrl && e.code === 'KeyY') { this.redo(); return true; }
    if (ctrl && e.code === 'KeyA') { this.sel = new Set(this.tr().notes); this.draw(); return true; }
    if (ctrl) return false;
    switch (e.code) {
      case 'Delete': case 'Backspace': this.deleteSel(); return true;
      case 'Space': this.togglePlay(); return true;
      case 'Escape': this.sel.clear(); this.selAuto = -1; this.draw(); return true;
      case 'ArrowLeft': case 'ArrowRight': this.nudge((e.code === 'ArrowLeft' ? -1 : 1) * (this.grid || 0.125), 0); return true;
      case 'ArrowUp': case 'ArrowDown': this.nudge(0, e.code === 'ArrowUp' ? 1 : -1); return true;
    }
    return false;
  }

  // ================= 内部 =================
  private tr() {
    return this.song.tracks[this.track];
  }

  private commit(): void {
    clampSong(this.song);
    this.persist();
    this.host.send(cloneSong(this.song));
    this.refreshTracks();
    this.draw();
  }

  private snapshot(): void {
    this.undoStack.push(JSON.stringify(this.song));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(JSON.stringify(this.song));
    this.song = JSON.parse(s);
    this.sel.clear();
    this.refreshAll();
    this.commit();
  }

  private redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(JSON.stringify(this.song));
    this.song = JSON.parse(s);
    this.sel.clear();
    this.refreshAll();
    this.commit();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.song));
    } catch {
      // 保存できなくても使える
    }
  }

  private load(): Song | null {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
      return s && s.version === 1 && Array.isArray(s.tracks) ? s : null;
    } catch {
      return null;
    }
  }

  /** 起動時に Worklet へ曲を送る */
  sendInitial(): void {
    this.host.send(cloneSong(this.song));
  }

  private togglePlay(): void {
    if (this.playing) this.host.transport(false);
    else this.host.transport(true);
  }

  private nextTake(): number {
    let m = 0;
    for (const t of this.song.tracks) for (const n of [...t.notes, ...t.autos]) m = Math.max(m, n.take);
    return m + 1;
  }

  private bindBar(): void {
    const on = (id: string, f: () => void) => this.$(id).addEventListener('click', f);
    on('home', () => { this.host.transport(this.playing, 0); if (!this.playing) { this.playhead = 0; this.viewStart = 0; this.draw(); } });
    on('play', () => this.togglePlay());
    on('rec', () => {
      if (!this.recording) { this.snapshot(); this.host.record(true, this.nextTake()); }
      else this.host.record(false, 0);
    });
    on('undo', () => this.undo());
    on('redo', () => this.redo());
    on('quant', () => this.quantize());
    on('del', () => this.deleteSel());
    on('clear', () => { this.snapshot(); this.tr().notes = []; this.tr().autos = []; this.sel.clear(); this.commit(); });
    on('zin', () => { this.pxPerBeat = Math.min(400, this.pxPerBeat * 1.5); this.draw(); });
    on('zout', () => { this.pxPerBeat = Math.max(8, this.pxPerBeat / 1.5); this.draw(); });
    on('bounce', () => this.host.bounce());
    on('close', () => this.toggle(false));
    on('save', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(this.song, null, 1)], { type: 'application/json' }));
      a.download = 'bentpc-song.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    const file = this.$('file') as HTMLInputElement;
    on('load', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const s = JSON.parse(await f.text());
        if (s.version !== 1 || !Array.isArray(s.tracks)) throw new Error();
        this.snapshot();
        this.song = s;
        while (this.song.tracks.length < this.host.toys.length) this.song.tracks.push({ mute: false, notes: [], autos: [] });
        this.refreshAll();
        this.commit();
      } catch {
        alert('曲のファイルを読み込めませんでした');
      }
      file.value = '';
    });
    const bpm = this.$('bpm') as HTMLInputElement;
    bpm.addEventListener('change', () => { this.snapshot(); this.song.bpm = Math.max(40, Math.min(300, Number(bpm.value) || 120)); this.commit(); });
    const bars = this.$('bars') as HTMLSelectElement;
    bars.addEventListener('change', () => { this.snapshot(); this.song.bars = Number(bars.value); this.commit(); });
    const grid = this.$('grid') as HTMLSelectElement;
    grid.value = '2';
    grid.addEventListener('change', () => { this.grid = GRIDS[Number(grid.value)][1]; this.draw(); });
    const metro = this.$('metro') as HTMLInputElement;
    metro.addEventListener('change', () => { this.song.metronome = metro.checked; this.commit(); });
    (this.$('param') as HTMLSelectElement).addEventListener('change', (e) => { this.laneParam = Number((e.target as HTMLSelectElement).value); this.selAuto = -1; this.draw(); });
    const addrow = this.$('addrow') as HTMLSelectElement;
    addrow.addEventListener('change', () => {
      const k = Number(addrow.value);
      if (k >= 0) {
        if (!this.extraRows.has(this.track)) this.extraRows.set(this.track, new Set());
        this.extraRows.get(this.track)!.add(k);
        this.draw();
      }
      addrow.value = '-1';
    });
  }

  private refreshAll(): void {
    this.refreshBar();
    this.refreshTracks();
    this.refreshSelects();
  }

  private refreshBar(): void {
    (this.$('bpm') as HTMLInputElement).value = String(this.song.bpm);
    (this.$('bars') as HTMLSelectElement).value = String(this.song.bars);
    (this.$('metro') as HTMLInputElement).checked = this.song.metronome;
    this.$('play').textContent = this.playing ? '■' : '▶';
    this.$('play').classList.toggle('on', this.playing);
    this.$('rec').classList.toggle('on', this.recording);
  }

  private refreshTracks(): void {
    const box = this.$('tracks');
    box.innerHTML = '';
    this.host.toys.forEach((t, i) => {
      const tr = this.song.tracks[i];
      const row = document.createElement('div');
      row.className = `daw-track${i === this.track ? ' sel' : ''}`;
      row.innerHTML = `<b>${i + 1}. ${t.title}</b><small>${tr.notes.length} 音 / ${tr.autos.length} 点</small><button class="mute${tr.mute ? ' on' : ''}" title="ミュート">M</button>`;
      row.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).classList.contains('mute')) { this.snapshot(); tr.mute = !tr.mute; this.commit(); return; }
        this.selectTrack(i);
      });
      box.appendChild(row);
    });
  }

  private selectTrack(i: number): void {
    this.track = i;
    this.sel.clear();
    this.selAuto = -1;
    this.refreshTracks();
    this.refreshSelects();
    this.draw();
  }

  private refreshSelects(): void {
    const toy = this.host.toys[this.track];
    const used = new Set(this.tr().autos.map((a) => a.index));
    const ps = this.$('param') as HTMLSelectElement;
    ps.innerHTML = '<option value="-1">（選ぶ）</option>' + toy.paramDefs.map((p, i) => `<option value="${i}">${used.has(i) ? '● ' : ''}${p.name}</option>`).join('');
    if (this.laneParam < 0 && used.size) this.laneParam = [...used][0];
    if (this.laneParam >= toy.paramDefs.length) this.laneParam = -1;
    ps.value = String(this.laneParam);
    const ar = this.$('addrow') as HTMLSelectElement;
    ar.innerHTML = '<option value="-1">（キーを選ぶ）</option>' + Array.from({ length: toy.keyCount }, (_, k) => `<option value="${k}">${toy.keyName(k)}</option>`).join('');
  }

  /** ピアノロールの行（使っているキー＋手で足した行。上ほど番号が大きい） */
  private rows(): number[] {
    const s = new Set(this.tr().notes.map((n) => n.key));
    this.extraRows.get(this.track)?.forEach((k) => s.add(k));
    return [...s].sort((a, b) => b - a);
  }

  private snap(b: number): number {
    return this.grid ? Math.round(b / this.grid) * this.grid : b;
  }

  private quantize(): void {
    if (!this.grid) return;
    this.snapshot();
    const list = this.sel.size ? [...this.sel] : this.tr().notes;
    for (const n of list) {
      n.start = this.snap(n.start);
      n.len = Math.max(this.grid, this.snap(n.len));
    }
    this.commit();
  }

  private deleteSel(): void {
    if (!this.sel.size && this.selAuto < 0) return;
    this.snapshot();
    const tr = this.tr();
    tr.notes = tr.notes.filter((n) => !this.sel.has(n));
    if (this.selAuto >= 0) tr.autos.splice(this.selAuto, 1);
    this.sel.clear();
    this.selAuto = -1;
    this.commit();
  }

  private nudge(dBeat: number, dRow: number): void {
    if (!this.sel.size) return;
    this.snapshot();
    const rows = this.rows();
    for (const n of this.sel) {
      n.start = Math.max(0, n.start + dBeat);
      if (dRow) {
        const i = rows.indexOf(n.key) - dRow;
        if (i >= 0 && i < rows.length) n.key = rows[i];
      }
    }
    this.commit();
  }

  // ================= ピアノロール =================
  private xOf(beat: number): number {
    return GUTTER + (beat - this.viewStart) * this.pxPerBeat;
  }
  private beatOf(x: number): number {
    return (x - GUTTER) / this.pxPerBeat + this.viewStart;
  }

  private hit(x: number, y: number): { note?: SeqNote; edge?: boolean; row: number; key?: number } {
    const rows = this.rows();
    const row = Math.floor((y + this.scrollY) / ROW_H);
    const key = rows[row];
    if (key === undefined) return { row };
    for (const n of [...this.tr().notes].reverse()) {
      if (n.key !== key) continue;
      const x0 = this.xOf(n.start), x1 = this.xOf(n.start + n.len);
      if (x >= x0 && x <= x1 + 2) return { note: n, edge: x > x1 - 6, row, key };
    }
    return { row, key };
  }

  private bindRoll(): void {
    const c = this.roll;
    let drag: { mode: 'move' | 'len'; x0: number; y0: number; orig: Map<SeqNote, { start: number; len: number; key: number }> } | null = null;
    const pt = (e: PointerEvent | MouseEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const [x, y] = pt(e);
      const h = this.hit(x, y);
      if (h.note) { this.snapshot(); this.tr().notes = this.tr().notes.filter((n) => n !== h.note); this.sel.delete(h.note); this.commit(); }
    });
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const [x, y] = pt(e);
      if (x < GUTTER) return;
      const h = this.hit(x, y);
      if (!h.note) { if (!e.shiftKey) this.sel.clear(); this.draw(); return; }
      if (!this.sel.has(h.note)) { if (!e.shiftKey) this.sel.clear(); this.sel.add(h.note); }
      c.setPointerCapture(e.pointerId);
      this.snapshot();
      drag = { mode: h.edge ? 'len' : 'move', x0: x, y0: y, orig: new Map([...this.sel].map((n) => [n, { start: n.start, len: n.len, key: n.key }])) };
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      const [x, y] = pt(e);
      if (!drag) {
        const h = x > GUTTER ? this.hit(x, y) : { edge: false };
        c.style.cursor = h.edge ? 'ew-resize' : 'default';
        return;
      }
      const db = (x - drag.x0) / this.pxPerBeat;
      const dr = Math.round((y - drag.y0) / ROW_H);
      const rows = this.rows();
      for (const [n, o] of drag.orig) {
        if (drag.mode === 'len') n.len = Math.max(this.grid || 1 / 32, this.snap(o.start + o.len + db) - o.start);
        else {
          n.start = Math.max(0, this.snap(o.start + db));
          const ri = rows.indexOf(o.key) + dr;
          if (ri >= 0 && ri < rows.length) n.key = rows[ri];
        }
      }
      this.draw();
    });
    const end = () => { if (drag) { drag = null; this.commit(); } };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      const [x, y] = pt(e);
      if (x < GUTTER) return;
      const h = this.hit(x, y);
      if (h.note || h.key === undefined) return;
      this.snapshot();
      const start = Math.max(0, this.grid ? Math.floor(this.beatOf(x) / this.grid) * this.grid : this.beatOf(x));
      const n: SeqNote = { key: h.key, start, len: this.grid || 0.25, take: 0 };
      this.tr().notes.push(n);
      this.sel = new Set([n]);
      this.commit();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) { this.pxPerBeat = Math.max(8, Math.min(400, this.pxPerBeat * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); }
      else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.viewStart = Math.max(0, this.viewStart + (e.deltaX || e.deltaY) / this.pxPerBeat);
      else this.scrollY = Math.max(0, Math.min(Math.max(0, this.rows().length * ROW_H - c.clientHeight), this.scrollY + e.deltaY));
      this.draw();
    }, { passive: false });
  }

  // ================= ツマミの動き（オートメーション） =================
  private bindLane(): void {
    const c = this.lane;
    const pt = (e: PointerEvent | MouseEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const def = () => this.host.toys[this.track].paramDefs[this.laneParam];
    const vOf = (y: number) => { const d = def(); const k = 1 - Math.max(0, Math.min(1, (y - 6) / (c.clientHeight - 12))); const v = d.min + (d.max - d.min) * k; return d.kind === 'continuous' ? v : Math.round(v); };
    const yOf = (v: number) => { const d = def(); return 6 + (1 - (v - d.min) / (d.max - d.min || 1)) * (c.clientHeight - 12); };
    const pick = (x: number, y: number) => this.tr().autos.findIndex((a) => a.index === this.laneParam && Math.abs(this.xOf(a.t) - x) < 7 && Math.abs(yOf(a.v) - y) < 7);
    let dragging = false;
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.laneParam < 0) return;
      const [x, y] = pt(e);
      const i = pick(x, y);
      if (i >= 0) { this.snapshot(); this.tr().autos.splice(i, 1); this.selAuto = -1; this.commit(); }
    });
    c.addEventListener('pointerdown', (e) => {
      if (this.laneParam < 0 || e.button !== 0) return;
      const [x, y] = pt(e);
      this.selAuto = pick(x, y);
      if (this.selAuto >= 0) { this.snapshot(); dragging = true; c.setPointerCapture(e.pointerId); }
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging || this.selAuto < 0) return;
      const [x, y] = pt(e);
      const a = this.tr().autos[this.selAuto];
      a.t = Math.max(0, this.snap(this.beatOf(x)));
      a.v = vOf(y);
      this.draw();
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      const a = this.tr().autos[this.selAuto];
      this.tr().autos.sort((p, q) => p.t - q.t);
      this.selAuto = this.tr().autos.indexOf(a);
      this.commit();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      if (this.laneParam < 0) return;
      const [x, y] = pt(e);
      if (x < GUTTER) return;
      this.snapshot();
      const a = { index: this.laneParam, t: Math.max(0, this.snap(this.beatOf(x))), v: vOf(y), take: 0 };
      this.tr().autos.push(a);
      this.tr().autos.sort((p, q) => p.t - q.t);
      this.selAuto = this.tr().autos.indexOf(a);
      this.refreshSelects();
      this.commit();
    });
  }

  // ================= 描画 =================
  draw(): void {
    if (!this.open) return;
    this.drawRoll();
    this.drawLane();
  }

  private fit(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  private drawGrid(g: CanvasRenderingContext2D, h: number): void {
    const w = g.canvas.clientWidth;
    const end = songBeats(this.song);
    const step = this.grid || 0.25;
    for (let b = Math.floor(this.viewStart / step) * step; b <= end && this.xOf(b) < w; b += step) {
      const x = this.xOf(b);
      if (x < GUTTER) continue;
      g.fillStyle = b % 4 === 0 ? '#5a5566' : b % 1 === 0 ? '#3a3542' : '#2a2630';
      g.fillRect(Math.round(x), 0, 1, h);
    }
    // 曲の終わりより後ろは暗く
    const xe = this.xOf(end);
    if (xe < w) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(Math.max(GUTTER, xe), 0, w - xe, h); }
  }

  private drawPlayhead(g: CanvasRenderingContext2D, h: number): void {
    const x = this.xOf(this.playhead);
    if (x >= GUTTER) { g.fillStyle = this.recording ? '#ff4a3d' : '#7dff6a'; g.fillRect(Math.round(x), 0, 2, h); }
  }

  private drawRoll(): void {
    const c = this.roll;
    const g = this.fit(c);
    const w = c.clientWidth, h = c.clientHeight;
    g.fillStyle = '#1d1a22';
    g.fillRect(0, 0, w, h);
    const rows = this.rows();
    const toy = this.host.toys[this.track];
    rows.forEach((k, i) => {
      const y = i * ROW_H - this.scrollY;
      if (y + ROW_H < 0 || y > h) return;
      g.fillStyle = i % 2 ? '#211e27' : '#24212b';
      g.fillRect(GUTTER, y, w - GUTTER, ROW_H);
    });
    this.drawGrid(g, h);
    // 音符
    const byRow = new Map(rows.map((k, i) => [k, i]));
    for (const n of this.tr().notes) {
      const i = byRow.get(n.key);
      if (i === undefined) continue;
      const y = i * ROW_H - this.scrollY;
      const x0 = this.xOf(n.start), x1 = this.xOf(n.start + n.len);
      if (x1 < GUTTER || x0 > w || y + ROW_H < 0 || y > h) continue;
      const sel = this.sel.has(n);
      g.fillStyle = sel ? '#ffe066' : `hsl(${(this.track * 67 + 10) % 360} 70% ${this.tr().mute ? 35 : 58}%)`;
      g.fillRect(Math.max(GUTTER, x0), y + 2, Math.max(3, x1 - Math.max(GUTTER, x0) - 1), ROW_H - 4);
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(Math.max(GUTTER, x1 - 4), y + 2, 3, ROW_H - 4);
    }
    this.drawPlayhead(g, h);
    // 左の行名
    g.fillStyle = '#141217';
    g.fillRect(0, 0, GUTTER, h);
    g.font = '11px "Share Tech Mono", monospace';
    g.textBaseline = 'middle';
    rows.forEach((k, i) => {
      const y = i * ROW_H - this.scrollY;
      if (y + ROW_H < 0 || y > h) return;
      g.fillStyle = '#cfc8da';
      g.fillText(toy.keyName(k).slice(0, 15), 6, y + ROW_H / 2);
    });
    if (!rows.length) {
      g.fillStyle = '#8a8396';
      g.font = '14px sans-serif';
      g.fillText('● REC を押しておもちゃを弾くと、ここに音符が並びます（「行を追加」で手で書くこともできます）', GUTTER + 12, 24);
    }
  }

  private drawLane(): void {
    const c = this.lane;
    const g = this.fit(c);
    const w = c.clientWidth, h = c.clientHeight;
    g.fillStyle = '#17151b';
    g.fillRect(0, 0, w, h);
    this.drawGrid(g, h);
    if (this.laneParam >= 0) {
      const d = this.host.toys[this.track].paramDefs[this.laneParam];
      const yOf = (v: number) => 6 + (1 - (v - d.min) / (d.max - d.min || 1)) * (h - 12);
      const pts = this.tr().autos.map((a, i) => ({ a, i })).filter((p) => p.a.index === this.laneParam);
      g.strokeStyle = '#6fd3ff';
      g.lineWidth = 2;
      g.beginPath();
      pts.forEach(({ a }, j) => {
        const x = this.xOf(a.t), y = yOf(a.v);
        if (j === 0) g.moveTo(x, y);
        else { g.lineTo(x, yOf(pts[j - 1].a.v)); g.lineTo(x, y); }
      });
      if (pts.length) g.lineTo(this.xOf(songBeats(this.song)), yOf(pts[pts.length - 1].a.v));
      g.stroke();
      for (const { a, i } of pts) {
        g.fillStyle = i === this.selAuto ? '#ffe066' : '#6fd3ff';
        g.beginPath();
        g.arc(this.xOf(a.t), yOf(a.v), 4.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.drawPlayhead(g, h);
    g.fillStyle = '#141217';
    g.fillRect(0, 0, GUTTER, h);
    g.fillStyle = '#cfc8da';
    g.font = '11px "Share Tech Mono", monospace';
    g.fillText(this.laneParam >= 0 ? this.host.toys[this.track].paramDefs[this.laneParam].name.slice(0, 15) : '（ツマミを選ぶ）', 6, 16);
  }
}
