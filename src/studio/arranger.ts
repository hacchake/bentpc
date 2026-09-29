// スタジオのシーケンサー画面（横 = 時間、縦 = トラック）。
// トラックごとに行が並ぶ：
//   ⚡ システム（電源・CRASH→再起動） / ● ボタン（GLITCH・HOLD・RESET など） / ♪ キー演奏
//   ⇄ スイッチ（モード・BASE・LOOP・DIST タイプなど：値の段） / ◠ ノブ（線グラフ）
// 上の目盛り：セクション名（イントロ・サビ…）、小節番号、ループ範囲。
// 編集はすべてマウス（ダブルクリックで追加・ドラッグで移動・右クリックで削除）とキー（Delete・Ctrl+Z など）。
import { autoValueAt, clampSong, cloneSong, mergeTake, songBeats, trackToy, BTN, SYS_CRASH, SYS_NAMES, SYS_POWER_OFF, SYS_POWER_ON, type SeqAuto, type SeqNote, type Song, type takeFromRaw } from '../core/song';
import { seqKeyName, type ToyUI } from '../core/ui';

const STORE = 'bentpc.studio.song.v1';
const GUTTER = 190;
const RULER_H = 44;
const H_HEAD = 24, H_NOTE = 16, H_SWITCH = 22, H_KNOB = 46;
const GRIDS: [string, number][] = [['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['OFF', 0]];
const SEC_COLORS = ['#5fa8ff', '#7ee07a', '#ffb347', '#ff6b8b', '#b58cff', '#4fd6c8', '#ffe066', '#ff8f5a'];

type Cat = 'sys' | 'btn' | 'play';
type Lane =
  | { kind: 'head'; tr: number; y: number; h: number }
  | { kind: 'note'; tr: number; key: number; cat: Cat; y: number; h: number }
  | { kind: 'switch' | 'knob'; tr: number; param: number; y: number; h: number };

export interface ArrangerHost {
  /** スタジオのおもちゃ（並び = 曲のトラックの toy 番号） */
  toys: ToyUI[];
  send(song: Song): void;
  transport(play: boolean, from?: number): void;
  record(on: boolean, take: number): void;
  /** 曲が変わった（画面の同期用） */
  onSong?(song: Song): void;
}

export class Arranger {
  song: Song;
  focused = false;
  readonly el: HTMLElement;
  private ruler: HTMLCanvasElement;
  private main: HTMLCanvasElement;
  private pxPerBeat = 22;
  private viewStart = 0;
  private scrollY = 0;
  private grid = 0.25;
  playhead = 0;
  playing = false;
  recording = false;
  private selTrack = 0;
  private sel = new Set<SeqNote>();
  private selAuto: SeqAuto | null = null;
  private clip: { notes: SeqNote[]; tr: number; from: number } | null = null;
  private collapsed = new Set<number>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private stress = new Map<number, Float32Array>(); // おもちゃ → 拍ごとの熱（1/4 拍きざみ）
  private lanesCache: Lane[] = [];
  private $: (id: string) => HTMLElement;
  private menu: HTMLSelectElement;

  constructor(private host: ArrangerHost, initial: () => Song) {
    this.song = this.load() ?? initial();
    this.el = document.createElement('div');
    this.el.className = 'arr';
    this.el.innerHTML = `
      <div class="arr-bar">
        <button data-id="home" title="最初へ（ループ中はループの頭へ）">⏮</button>
        <button data-id="play" title="再生／停止（Space）">▶</button>
        <button data-id="rec" class="rec" title="手で弾いた操作を録音（● の付いたトラックへ重ね録り）">● REC</button>
        <span class="pos" data-id="pos">1.1</span>
        <label>BPM <input data-id="bpm" type="number" min="40" max="300" step="1"></label>
        <label>長さ <input data-id="bars" type="number" min="1" max="400" step="1"> 小節</label>
        <label class="chk"><input data-id="loop" type="checkbox"> LOOP</label>
        <label>グリッド <select data-id="grid">${GRIDS.map(([n], i) => `<option value="${i}">${n}</option>`).join('')}</select></label>
        <label class="chk"><input data-id="metro" type="checkbox"> クリック</label>
        <label title="乱数のシード：同じ曲・同じシードなら、頭から再生するたびに同じグリッチになる">SEED <input data-id="seed" type="number" min="0" step="1"></label>
        <span class="sp"></span>
        <button data-id="undo" title="元に戻す（Ctrl+Z）">↶</button>
        <button data-id="redo" title="やり直し（Ctrl+Y）">↷</button>
        <button data-id="addtrack" title="トラックを追加">＋トラック</button>
        <button data-id="zout" title="縮小">－</button><button data-id="zin" title="拡大">＋</button>
        <button data-id="save" title="曲を JSON ファイルに保存">保存</button>
        <button data-id="load" title="曲の JSON ファイルを読み込む">読込</button>
        <span data-id="extra"></span>
        <input data-id="file" type="file" accept=".json,application/json" hidden>
      </div>
      <div class="arr-body">
        <canvas data-id="ruler" class="arr-ruler"></canvas>
        <canvas data-id="main" class="arr-main"></canvas>
        <select data-id="menu" class="arr-menu" size="14" hidden></select>
        <div class="arr-hint">ダブルクリック：追加 ／ ドラッグ：移動（音符の右端で長さ） ／ 右クリック：削除 ／ 空いた所をドラッグ：まとめて選ぶ ／ スイッチの点の上でホイール：値 ／
        目盛りの上段：セクション（ダブルクリックで追加・名前変更） ／ 下段：クリックで位置、ドラッグでループ範囲 ／ Ctrl+C・V・D：コピー・貼り付け・複製</div>
      </div>`;
    this.$ = (id) => this.el.querySelector(`[data-id="${id}"]`) as HTMLElement;
    this.ruler = this.$('ruler') as HTMLCanvasElement;
    this.main = this.$('main') as HTMLCanvasElement;
    this.menu = this.$('menu') as HTMLSelectElement;
    this.bindBar();
    this.bindRuler();
    this.bindMain();
    this.el.addEventListener('pointerdown', () => { this.focused = true; });
    window.addEventListener('pointerdown', (e) => { if (!this.el.contains(e.target as Node)) this.focused = false; }, true);
    new ResizeObserver(() => this.draw()).observe(this.el);
    this.refreshBar();
  }

  /** ツールバーの右端にボタンを足す（書き出しなど） */
  addButton(label: string, title: string, f: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', f);
    this.$('extra').appendChild(b);
    return b;
  }

  // ================= 外から =================
  /** 起動時・曲の差し替え */
  setSong(s: Song, undoable = true): void {
    if (undoable) this.snapshot();
    this.song = s;
    this.sel.clear();
    this.selAuto = null;
    this.stress.clear();
    this.refreshBar();
    this.commit();
  }

  sendInitial(): void {
    this.host.send(cloneSong(this.song));
    this.host.onSong?.(this.song);
  }

  setPos(beat: number, playing: boolean, recording: boolean): void {
    const changed = playing !== this.playing || recording !== this.recording;
    this.playhead = beat;
    this.playing = playing;
    this.recording = recording;
    if (changed) this.refreshBar();
    this.$('pos').textContent = this.posText(beat);
    // 再生位置が見えなくなったら表示を送る
    const w = this.main.clientWidth - GUTTER;
    if (playing && (beat < this.viewStart || beat > this.viewStart + (w / this.pxPerBeat) * 0.92)) this.viewStart = Math.max(0, beat - 2);
    this.draw();
  }

  addTake(data: ReturnType<typeof takeFromRaw>): void {
    mergeTake(this.song, data);
    this.persist();
    this.host.onSong?.(this.song);
    this.draw();
  }

  /** おもちゃの熱（ストレス）を今の再生位置に記録する */
  setStress(toy: number, heat: number): void {
    if (!this.playing) return;
    const n = songBeats(this.song) * 4;
    let a = this.stress.get(toy);
    if (!a || a.length !== n) this.stress.set(toy, (a = new Float32Array(n)));
    const i = Math.floor(this.playhead * 4);
    if (i >= 0 && i < n) a[i] = Math.max(a[i] * 0.5, heat);
  }

  posText(beat: number): string {
    const bar = Math.floor(beat / 4) + 1, bt = Math.floor(beat % 4) + 1;
    const sec = (beat * 60) / this.song.bpm;
    const sect = this.sectionAt(beat);
    return `${bar}.${bt}  ${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}${sect ? '  ' + sect : ''}`;
  }

  sectionAt(beat: number): string {
    let name = '';
    for (const s of this.song.sections ?? []) if (s.start <= beat + 1e-6) name = s.name;
    return name;
  }

  keyDown(e: KeyboardEvent): boolean {
    if (!this.focused) return false;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return false;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { this.undo(); return true; }
    if (ctrl && e.code === 'KeyY') { this.redo(); return true; }
    if (ctrl && e.code === 'KeyA') { this.sel = new Set(this.song.tracks[this.selTrack]?.notes ?? []); this.draw(); return true; }
    if (ctrl && e.code === 'KeyC') { this.copy(); return true; }
    if (ctrl && e.code === 'KeyV') { this.paste(); return true; }
    if (ctrl && e.code === 'KeyD') { this.duplicate(); return true; }
    if (ctrl) return false;
    switch (e.code) {
      case 'Delete': case 'Backspace': this.deleteSel(); return true;
      case 'Space': this.togglePlay(); return true;
      case 'Escape': this.sel.clear(); this.selAuto = null; this.draw(); return true;
      case 'ArrowLeft': case 'ArrowRight': this.nudge((e.code === 'ArrowLeft' ? -1 : 1) * (this.grid || 0.125)); return true;
    }
    return false;
  }

  // ================= 曲の変更 =================
  private tracksOfToy(toy: number): number[] {
    return this.song.tracks.map((_, i) => i).filter((i) => trackToy(this.song, i) === toy);
  }

  private commit(): void {
    clampSong(this.song);
    const end = songBeats(this.song);
    if (this.song.loop) {
      this.song.loop.start = Math.max(0, Math.min(this.song.loop.start, end - 1));
      this.song.loop.end = Math.max(this.song.loop.start + 1, Math.min(this.song.loop.end, end));
    }
    this.song.sections?.sort((a, b) => a.start - b.start);
    this.persist();
    this.host.send(cloneSong(this.song));
    this.host.onSong?.(this.song);
    this.draw();
  }

  private snapshot(): void {
    this.undoStack.push(JSON.stringify(this.song));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(JSON.stringify(this.song));
    this.song = JSON.parse(s);
    this.sel.clear();
    this.selAuto = null;
    this.refreshBar();
    this.commit();
  }

  private redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(JSON.stringify(this.song));
    this.song = JSON.parse(s);
    this.sel.clear();
    this.selAuto = null;
    this.refreshBar();
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

  private togglePlay(): void {
    this.host.transport(!this.playing, this.playing ? undefined : this.playhead);
  }

  private nextTake(): number {
    let m = 0;
    for (const t of this.song.tracks) for (const n of [...t.notes, ...t.autos]) m = Math.max(m, n.take);
    return m + 1;
  }

  private snap(b: number): number {
    return this.grid ? Math.round(b / this.grid) * this.grid : b;
  }

  private deleteSel(): void {
    if (!this.sel.size && !this.selAuto) return;
    this.snapshot();
    for (const tr of this.song.tracks) {
      tr.notes = tr.notes.filter((n) => !this.sel.has(n));
      tr.autos = tr.autos.filter((a) => a !== this.selAuto);
    }
    this.sel.clear();
    this.selAuto = null;
    this.commit();
  }

  private nudge(d: number): void {
    if (!this.sel.size) return;
    this.snapshot();
    for (const n of this.sel) n.start = Math.max(0, n.start + d);
    this.commit();
  }

  private selTrackOf(n: SeqNote): number {
    return this.song.tracks.findIndex((t) => t.notes.includes(n));
  }

  private copy(): void {
    if (!this.sel.size) return;
    const notes = [...this.sel];
    const tr = this.selTrackOf(notes[0]);
    const from = Math.min(...notes.map((n) => n.start));
    this.clip = { notes: notes.filter((n) => this.selTrackOf(n) === tr).map((n) => ({ ...n })), tr, from };
  }

  /** 貼り付け：再生位置（グリッドにそろえる）へ、同じトラックに */
  private paste(): void {
    if (!this.clip) return;
    const tr = this.song.tracks[this.clip.tr];
    if (!tr) return;
    this.snapshot();
    const at = this.grid ? Math.floor(this.playhead / this.grid) * this.grid : this.playhead;
    const added = this.clip.notes.map((n) => ({ ...n, start: n.start - this.clip!.from + at }));
    tr.notes.push(...added);
    tr.notes.sort((a, b) => a.start - b.start);
    this.sel = new Set(added);
    this.commit();
  }

  /** 複製：選んだ音符を、すぐ後ろ（小節単位）にもう一度 */
  private duplicate(): void {
    if (!this.sel.size) return;
    this.snapshot();
    const notes = [...this.sel];
    const s = Math.min(...notes.map((n) => n.start)), e = Math.max(...notes.map((n) => n.start + n.len));
    const span = Math.max(4, Math.ceil((e - s) / 4) * 4);
    const added: SeqNote[] = [];
    for (const n of notes) {
      const tr = this.song.tracks[this.selTrackOf(n)];
      const c = { ...n, start: n.start + span };
      tr.notes.push(c);
      added.push(c);
    }
    this.song.tracks.forEach((t) => t.notes.sort((a, b) => a.start - b.start));
    this.sel = new Set(added);
    this.commit();
  }

  // ================= ツールバー =================
  private bindBar(): void {
    const on = (id: string, f: () => void) => this.$(id).addEventListener('click', f);
    on('home', () => {
      const to = this.song.loop?.on ? this.song.loop.start : 0;
      this.playhead = to;
      this.viewStart = Math.max(0, to - 1);
      if (this.playing) this.host.transport(true, to);
      this.setPos(to, this.playing, this.recording);
    });
    on('play', () => this.togglePlay());
    on('rec', () => {
      if (!this.recording) { this.snapshot(); this.host.record(true, this.nextTake()); }
      else this.host.record(false, 0);
    });
    on('undo', () => this.undo());
    on('redo', () => this.redo());
    on('zin', () => { this.pxPerBeat = Math.min(300, this.pxPerBeat * 1.4); this.draw(); });
    on('zout', () => { this.pxPerBeat = Math.max(3, this.pxPerBeat / 1.4); this.draw(); });
    on('addtrack', () => {
      const names = this.host.toys.map((t, i) => `${i + 1}: ${t.title}`).join('\n');
      const a = prompt(`どのおもちゃのトラック？（番号）\n${names}`, '1');
      if (!a) return;
      const toy = Number(a) - 1;
      if (!this.host.toys[toy]) return;
      const name = prompt('トラックの名前', 'NEW') ?? 'NEW';
      this.snapshot();
      this.song.tracks.push({ mute: false, notes: [], autos: [], toy, name });
      this.selTrack = this.song.tracks.length - 1;
      this.commit();
    });
    on('save', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(this.song, null, 1)], { type: 'application/json' }));
      a.download = `${(this.song.title || 'studio-song').replace(/[\\/:*?"<>|]/g, '_')}.json`;
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
        this.setSong(s);
      } catch {
        alert('曲のファイルを読み込めませんでした');
      }
      file.value = '';
    });
    const num = (id: string, f: (v: number) => void) => this.$(id).addEventListener('change', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (!Number.isFinite(v)) return;
      this.snapshot();
      f(v);
      this.commit();
      this.refreshBar();
    });
    num('bpm', (v) => { this.song.bpm = Math.max(40, Math.min(300, Math.round(v))); });
    num('bars', (v) => { this.song.bars = Math.max(1, Math.min(400, Math.round(v))); });
    num('seed', (v) => { this.song.seed = Math.max(0, Math.floor(v)) >>> 0; });
    (this.$('loop') as HTMLInputElement).addEventListener('change', (e) => {
      this.snapshot();
      const on2 = (e.target as HTMLInputElement).checked;
      this.song.loop = { ...(this.song.loop ?? { start: 0, end: Math.min(16, songBeats(this.song)) }), on: on2 };
      this.commit();
    });
    (this.$('metro') as HTMLInputElement).addEventListener('change', (e) => { this.song.metronome = (e.target as HTMLInputElement).checked; this.commit(); });
    const grid = this.$('grid') as HTMLSelectElement;
    grid.value = '2';
    grid.addEventListener('change', () => { this.grid = GRIDS[Number(grid.value)][1]; this.draw(); });
    this.el.querySelectorAll('button').forEach((b) => { b.tabIndex = -1; b.addEventListener('mousedown', (e) => e.preventDefault()); });
    // 行を足すメニュー
    this.menu.addEventListener('change', () => {
      const v = this.menu.value;
      const tr = Number(this.menu.dataset.tr);
      this.menu.hidden = true;
      if (!v || !this.song.tracks[tr]) return;
      this.snapshot();
      const t = this.song.tracks[tr];
      t.show = [...new Set([...(t.show ?? []), v])];
      this.collapsed.delete(tr);
      this.commit();
    });
    this.menu.addEventListener('blur', () => { this.menu.hidden = true; });
    this.menu.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.menu.hidden = true; });
  }

  refreshBar(): void {
    (this.$('bpm') as HTMLInputElement).value = String(this.song.bpm);
    (this.$('bars') as HTMLInputElement).value = String(this.song.bars);
    (this.$('seed') as HTMLInputElement).value = String(this.song.seed ?? 0);
    (this.$('loop') as HTMLInputElement).checked = !!this.song.loop?.on;
    (this.$('metro') as HTMLInputElement).checked = this.song.metronome;
    this.$('play').textContent = this.playing ? '■' : '▶';
    this.$('play').classList.toggle('on', this.playing);
    this.$('rec').classList.toggle('on', this.recording);
  }

  private openMenu(tr: number, x: number, y: number): void {
    const t = this.song.tracks[tr];
    const toy = trackToy(this.song, tr);
    const ui = this.host.toys[toy];
    if (!ui) return;
    const opt = (v: string, label: string) => `<option value="${v}">${label}</option>`;
    const keys = Array.from({ length: ui.keyCount }, (_, k) => k);
    const play = keys.filter((k) => (ui.keyKind?.(k) ?? 'play') === 'play');
    const btns = keys.filter((k) => ui.keyKind?.(k) === 'button');
    const pdefs = ui.paramDefs.map((p, i) => ({ p, i }));
    this.menu.innerHTML = '<option value="">（行を選ぶ）</option>'
      + `<optgroup label="⚡ システム">${[SYS_POWER_ON, SYS_POWER_OFF, SYS_CRASH].map((k) => opt(`k:${k}`, SYS_NAMES[k])).join('')}</optgroup>`
      + `<optgroup label="● ボタン">${pdefs.filter(({ p }) => p.kind === 'momentary').map(({ p, i }) => opt(`k:${BTN + i}`, p.name)).join('')}${btns.map((k) => opt(`k:${k}`, ui.keyName(k))).join('')}</optgroup>`
      + `<optgroup label="♪ キー">${play.map((k) => opt(`k:${k}`, ui.keyName(k))).join('')}</optgroup>`
      + `<optgroup label="⇄ スイッチ">${pdefs.filter(({ p }) => p.kind === 'stepped' || p.kind === 'toggle').map(({ p, i }) => opt(`p:${i}`, p.name)).join('')}</optgroup>`
      + `<optgroup label="◠ ノブ">${pdefs.filter(({ p }) => p.kind === 'continuous').map(({ p, i }) => opt(`p:${i}`, p.name)).join('')}</optgroup>`;
    this.menu.dataset.tr = String(tr);
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${Math.max(0, y)}px`;
    this.menu.hidden = false;
    this.menu.value = '';
    this.menu.focus();
    void t;
  }

  // ================= 行の並び =================
  private cat(tr: number, key: number): Cat {
    if (key >= SYS_CRASH) return 'sys';
    if (key >= BTN) return 'btn';
    const ui = this.host.toys[trackToy(this.song, tr)];
    return ui?.keyKind?.(key) === 'button' ? 'btn' : 'play';
  }

  private lanes(): Lane[] {
    const out: Lane[] = [];
    let y = 0;
    this.song.tracks.forEach((t, tr) => {
      out.push({ kind: 'head', tr, y, h: H_HEAD });
      y += H_HEAD;
      if (this.collapsed.has(tr)) return;
      const ui = this.host.toys[trackToy(this.song, tr)];
      const keys = new Set(t.notes.map((n) => n.key));
      const params = new Set(t.autos.map((a) => a.index));
      for (const s of t.show ?? []) {
        const [k, v] = s.split(':');
        if (k === 'k') keys.add(Number(v));
        else params.add(Number(v));
      }
      const order: Record<Cat, number> = { sys: 0, btn: 1, play: 2 };
      [...keys].sort((a, b) => order[this.cat(tr, a)] - order[this.cat(tr, b)] || a - b).forEach((key) => {
        out.push({ kind: 'note', tr, key, cat: this.cat(tr, key), y, h: H_NOTE });
        y += H_NOTE;
      });
      const kindOf = (i: number) => (ui?.paramDefs[i]?.kind === 'continuous' ? 'knob' : 'switch');
      [...params].sort((a, b) => (kindOf(a) === kindOf(b) ? a - b : kindOf(a) === 'switch' ? -1 : 1)).forEach((param) => {
        const kind = kindOf(param);
        const h = kind === 'knob' ? H_KNOB : H_SWITCH;
        out.push({ kind, tr, param, y, h });
        y += h;
      });
    });
    this.lanesCache = out;
    return out;
  }

  private laneAt(y: number): Lane | undefined {
    const cy = y + this.scrollY;
    return this.lanesCache.find((l) => cy >= l.y && cy < l.y + l.h);
  }

  private xOf(beat: number): number {
    return GUTTER + (beat - this.viewStart) * this.pxPerBeat;
  }

  private beatOf(x: number): number {
    return (x - GUTTER) / this.pxPerBeat + this.viewStart;
  }

  // ================= 上の目盛り（セクション・小節・ループ） =================
  private bindRuler(): void {
    const c = this.ruler;
    const pt = (e: MouseEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const secHit = (x: number) => (this.song.sections ?? []).findIndex((s, i, arr) => {
      const x0 = this.xOf(s.start), x1 = i + 1 < arr.length ? this.xOf(arr[i + 1].start) : this.xOf(songBeats(this.song));
      return x >= x0 && x < x1;
    });
    let drag: { mode: 'loop' | 'seek' | 'sec'; b0: number; x0: number; idx?: number } | null = null;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const [x, y] = pt(e);
      if (x < GUTTER) return;
      c.setPointerCapture(e.pointerId);
      const b = Math.max(0, this.beatOf(x));
      if (y < 18) {
        const i = (this.song.sections ?? []).findIndex((s) => Math.abs(this.xOf(s.start) - x) < 6);
        if (i >= 0) { this.snapshot(); drag = { mode: 'sec', b0: b, x0: x, idx: i }; }
        return;
      }
      drag = { mode: 'seek', b0: b, x0: x };
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const [x] = pt(e);
      const b = Math.max(0, this.beatOf(x));
      if (drag.mode === 'sec') {
        const s = this.song.sections![drag.idx!];
        s.start = Math.max(0, Math.round(b));
        this.draw();
      } else if (drag.mode === 'seek' && Math.abs(x - drag.x0) > 5) {
        drag.mode = 'loop';
        this.snapshot();
      }
      if (drag.mode === 'loop') {
        const g = this.grid >= 1 ? this.grid : 1;
        const a = Math.round(drag.b0 / g) * g, z = Math.round(b / g) * g;
        this.song.loop = { on: true, start: Math.min(a, z), end: Math.max(a, z, Math.min(a, z) + g) };
        this.refreshBar();
        this.draw();
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const [x] = pt(e);
      if (drag.mode === 'seek') {
        const b = Math.max(0, this.snap(this.beatOf(x)));
        this.playhead = b;
        if (this.playing) this.host.transport(true, b);
        this.setPos(b, this.playing, this.recording);
      } else this.commit();
      drag = null;
    });
    c.addEventListener('dblclick', (e) => {
      const [x, y] = pt(e);
      if (x < GUTTER || y >= 18) return;
      const i = secHit(x);
      const cur = i >= 0 ? this.song.sections![i] : null;
      const near = cur && Math.abs(this.xOf(cur.start) - x) < 40;
      const name = prompt(near ? 'セクションの名前（空にすると消す）' : '新しいセクションの名前', near ? cur!.name : 'サビ');
      if (name === null) return;
      this.snapshot();
      this.song.sections ??= [];
      if (near) {
        if (name.trim()) cur!.name = name.trim();
        else this.song.sections.splice(i, 1);
      } else if (name.trim()) this.song.sections.push({ name: name.trim(), start: Math.max(0, Math.round(this.beatOf(x) / 4) * 4) });
      this.commit();
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const [x, y] = pt(e);
      if (y < 18) {
        const i = (this.song.sections ?? []).findIndex((s) => Math.abs(this.xOf(s.start) - x) < 30);
        if (i >= 0 && confirm(`セクション「${this.song.sections![i].name}」を消しますか？`)) { this.snapshot(); this.song.sections!.splice(i, 1); this.commit(); }
      } else if (this.song.loop?.on) { this.snapshot(); this.song.loop.on = false; this.refreshBar(); this.commit(); }
    });
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey) {
      const r = this.main.getBoundingClientRect();
      const b = this.beatOf(e.clientX - r.left);
      this.pxPerBeat = Math.max(3, Math.min(300, this.pxPerBeat * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      this.viewStart = Math.max(0, b - (e.clientX - r.left - GUTTER) / this.pxPerBeat);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.viewStart = Math.max(0, this.viewStart + (e.deltaX || e.deltaY) / this.pxPerBeat);
    else {
      const total = this.lanesCache.length ? this.lanesCache[this.lanesCache.length - 1].y + this.lanesCache[this.lanesCache.length - 1].h : 0;
      this.scrollY = Math.max(0, Math.min(Math.max(0, total - this.main.clientHeight + 20), this.scrollY + e.deltaY));
    }
    this.draw();
  }

  // ================= 本体（行） =================
  private noteAt(l: Lane, x: number): { n: SeqNote; edge: boolean } | null {
    if (l.kind !== 'note') return null;
    const notes = this.song.tracks[l.tr].notes;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.key !== l.key) continue;
      const x0 = this.xOf(n.start), x1 = this.xOf(n.start + n.len);
      if (x >= x0 && x <= Math.max(x1, x0 + 4) + 2) return { n, edge: x > x1 - 6 && x1 - x0 > 8 };
    }
    return null;
  }

  private defOf(l: Lane) {
    return l.kind === 'switch' || l.kind === 'knob' ? this.host.toys[trackToy(this.song, l.tr)]?.paramDefs[l.param] : undefined;
  }

  private knobY(l: Lane, v: number): number {
    const d = this.defOf(l)!;
    return l.y - this.scrollY + 4 + (1 - (v - d.min) / (d.max - d.min || 1)) * (l.h - 8);
  }

  private autoAt(l: Lane, x: number, y: number): SeqAuto | null {
    if (l.kind !== 'switch' && l.kind !== 'knob') return null;
    const pts = this.song.tracks[l.tr].autos.filter((a) => a.index === l.param);
    for (let i = pts.length - 1; i >= 0; i--) {
      const a = pts[i];
      if (Math.abs(this.xOf(a.t) - x) > 6) continue;
      if (l.kind === 'knob' && Math.abs(this.knobY(l, a.v) - y) > 8) continue;
      return a;
    }
    return null;
  }

  private bindMain(): void {
    const c = this.main;
    const pt = (e: MouseEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    type Drag =
      | { mode: 'move' | 'len'; x0: number; y0: number; tr: number; orig: Map<SeqNote, { start: number; len: number; key: number }> }
      | { mode: 'auto'; a: SeqAuto; lane: Lane }
      | { mode: 'box'; x0: number; y0: number; x1: number; y1: number; add: boolean };
    let drag: Drag | null = null;

    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const [x, y] = pt(e);
      const l = this.laneAt(y);
      if (!l || x < GUTTER) {
        // 行の名前を右クリック：中身の無い行を隠す
        if (l && l.kind !== 'head') {
          const t = this.song.tracks[l.tr];
          const id = l.kind === 'note' ? `k:${l.key}` : `p:${l.param}`;
          if (t.show?.includes(id)) { this.snapshot(); t.show = t.show.filter((s) => s !== id); this.commit(); }
        }
        return;
      }
      const h = this.noteAt(l, x);
      if (h) { this.snapshot(); const t = this.song.tracks[l.tr]; t.notes = t.notes.filter((n) => n !== h.n); this.sel.delete(h.n); this.commit(); return; }
      const a = this.autoAt(l, x, y);
      if (a) { this.snapshot(); const t = this.song.tracks[l.tr]; t.autos = t.autos.filter((p) => p !== a); this.selAuto = null; this.commit(); }
    });

    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.menu.hidden = true;
      const [x, y] = pt(e);
      const l = this.laneAt(y);
      if (!l) { this.sel.clear(); this.selAuto = null; this.draw(); return; }
      if (l.kind === 'head') {
        this.selTrack = l.tr;
        if (x < GUTTER) this.headClick(l.tr, x, y);
        this.draw();
        return;
      }
      if (x < GUTTER) { this.selTrack = l.tr; this.draw(); return; }
      this.selTrack = l.tr;
      if (l.kind === 'note') {
        const h = this.noteAt(l, x);
        if (!h) {
          if (!e.shiftKey) this.sel.clear();
          this.selAuto = null;
          drag = { mode: 'box', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey };
          c.setPointerCapture(e.pointerId);
          this.draw();
          return;
        }
        if (!this.sel.has(h.n)) { if (!e.shiftKey) this.sel.clear(); this.sel.add(h.n); }
        this.selAuto = null;
        c.setPointerCapture(e.pointerId);
        this.snapshot();
        drag = { mode: h.edge ? 'len' : 'move', x0: x, y0: y, tr: l.tr, orig: new Map([...this.sel].map((n) => [n, { start: n.start, len: n.len, key: n.key }])) };
      } else {
        const a = this.autoAt(l, x, y);
        this.selAuto = a;
        this.sel.clear();
        if (a) { this.snapshot(); drag = { mode: 'auto', a, lane: l }; c.setPointerCapture(e.pointerId); }
      }
      this.draw();
    });

    c.addEventListener('pointermove', (e) => {
      const [x, y] = pt(e);
      if (!drag) {
        const l = this.laneAt(y);
        const h = l && x >= GUTTER ? this.noteAt(l, x) : null;
        c.style.cursor = h?.edge ? 'ew-resize' : h ? 'grab' : 'default';
        return;
      }
      if (drag.mode === 'box') {
        drag.x1 = x;
        drag.y1 = y;
        const b0 = this.beatOf(Math.min(drag.x0, x)), b1 = this.beatOf(Math.max(drag.x0, x));
        const y0 = Math.min(drag.y0, y) + this.scrollY, y1 = Math.max(drag.y0, y) + this.scrollY;
        if (!drag.add) this.sel.clear();
        for (const l of this.lanesCache) {
          if (l.kind !== 'note' || l.y + l.h < y0 || l.y > y1) continue;
          for (const n of this.song.tracks[l.tr].notes) if (n.key === l.key && n.start + n.len > b0 && n.start < b1) this.sel.add(n);
        }
        this.draw();
        return;
      }
      if (drag.mode === 'auto') {
        const a = drag.a;
        a.t = Math.max(0, this.snap(this.beatOf(x)));
        if (drag.lane.kind === 'knob') {
          const d = this.defOf(drag.lane)!;
          const k = 1 - Math.max(0, Math.min(1, (y + this.scrollY - drag.lane.y - 4) / (drag.lane.h - 8)));
          a.v = d.min + (d.max - d.min) * k;
        }
        this.draw();
        return;
      }
      const db = (x - drag.x0) / this.pxPerBeat;
      // 上下：同じトラックの音符の行の中で動かす
      const dtr = drag.tr;
      const rows = this.lanesCache.filter((l): l is Extract<Lane, { kind: 'note' }> => l.kind === 'note' && l.tr === dtr);
      const dr = Math.round((y - drag.y0) / H_NOTE);
      for (const [n, o] of drag.orig) {
        if (drag.mode === 'len') n.len = Math.max(this.grid || 1 / 32, this.snap(o.start + o.len + db) - o.start);
        else {
          n.start = Math.max(0, this.snap(o.start + db));
          const ri = rows.findIndex((r) => r.key === o.key) + dr;
          if (dr && ri >= 0 && ri < rows.length) n.key = rows[ri].key;
          else if (!dr) n.key = o.key;
        }
      }
      this.draw();
    });

    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.mode === 'box') { this.draw(); return; }
      if (d.mode === 'auto') this.song.tracks[d.lane.tr].autos.sort((p, q) => p.t - q.t);
      this.song.tracks.forEach((t) => t.notes.sort((a, b) => a.start - b.start));
      this.commit();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('dblclick', (e) => {
      const [x, y] = pt(e);
      const l = this.laneAt(y);
      if (!l || l.kind === 'head' || x < GUTTER) return;
      const t = this.song.tracks[l.tr];
      const b = Math.max(0, this.grid ? Math.floor(this.beatOf(x) / this.grid) * this.grid : this.beatOf(x));
      if (l.kind === 'note') {
        if (this.noteAt(l, x)) return;
        this.snapshot();
        const n: SeqNote = { key: l.key, start: b, len: l.key === SYS_CRASH ? 4 : l.cat === 'sys' ? 0.5 : this.grid || 0.25, take: 0 };
        t.notes.push(n);
        t.notes.sort((p, q) => p.start - q.start);
        this.sel = new Set([n]);
      } else {
        if (this.autoAt(l, x, y)) return;
        const d = this.defOf(l)!;
        this.snapshot();
        let v: number;
        if (l.kind === 'knob') {
          const k = 1 - Math.max(0, Math.min(1, (y + this.scrollY - l.y - 4) / (l.h - 8)));
          v = d.min + (d.max - d.min) * k;
        } else {
          const cur = autoValueAt(t.autos, l.param, b, false) ?? d.default;
          v = cur + 1 > d.max ? d.min : cur + 1;
        }
        const a: SeqAuto = { index: l.param, t: this.snap(this.beatOf(x)), v, take: 0 };
        t.autos.push(a);
        t.autos.sort((p, q) => p.t - q.t);
        this.selAuto = a;
      }
      this.commit();
    });

    c.addEventListener('wheel', (e) => {
      // スイッチの点の上：値を上下
      const [x, y] = pt(e);
      const l = this.laneAt(y);
      if (l?.kind === 'switch' && !e.ctrlKey && !e.shiftKey) {
        const a = this.autoAt(l, x, y);
        if (a) {
          e.preventDefault();
          const d = this.defOf(l)!;
          this.snapshot();
          a.v = Math.max(d.min, Math.min(d.max, Math.round(a.v) + (e.deltaY < 0 ? 1 : -1)));
          this.selAuto = a;
          this.commit();
          return;
        }
      }
      this.wheel(e);
    }, { passive: false });
  }

  /** トラックの見出し（左）のボタン */
  private headClick(tr: number, x: number, y: number): void {
    const t = this.song.tracks[tr];
    if (x < 18) {
      if (this.collapsed.has(tr)) this.collapsed.delete(tr);
      else this.collapsed.add(tr);
    } else if (x >= GUTTER - 92 && x < GUTTER - 70) { this.snapshot(); t.mute = !t.mute; this.commit(); }
    else if (x >= GUTTER - 70 && x < GUTTER - 48) { this.snapshot(); t.lock = !t.lock; this.commit(); }
    else if (x >= GUTTER - 48 && x < GUTTER - 26) {
      // 録音先：同じおもちゃのトラックのうち 1 つだけ
      this.snapshot();
      for (const i of this.tracksOfToy(trackToy(this.song, tr))) this.song.tracks[i].rec = i === tr;
      this.commit();
    } else if (x >= GUTTER - 26) this.openMenu(tr, GUTTER - 20, y + RULER_H);
    else {
      const name = prompt('トラックの名前（空にするとトラックを消す）', t.name ?? '');
      if (name === null) return;
      this.snapshot();
      if (!name.trim()) {
        if (t.notes.length + t.autos.length && !confirm('中身があります。本当に消しますか？')) { this.undoStack.pop(); return; }
        this.song.tracks.splice(tr, 1);
      } else t.name = name.trim();
      this.commit();
    }
  }

  // ================= 描画 =================
  private fit(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  draw(): void {
    if (!this.el.isConnected) return;
    this.drawRuler();
    this.drawMain();
  }

  private trackColor(tr: number, l = 58): string {
    return `hsl(${(tr * 67 + 200) % 360} 70% ${l}%)`;
  }

  private drawRuler(): void {
    const c = this.ruler;
    const g = this.fit(c);
    const w = c.clientWidth;
    g.fillStyle = '#141217';
    g.fillRect(0, 0, w, RULER_H);
    const end = songBeats(this.song);
    // セクション
    const secs = this.song.sections ?? [];
    secs.forEach((s, i) => {
      const x0 = Math.max(GUTTER, this.xOf(s.start)), x1 = Math.min(w, this.xOf(i + 1 < secs.length ? secs[i + 1].start : end));
      if (x1 <= GUTTER || x0 >= w) return;
      g.fillStyle = SEC_COLORS[i % SEC_COLORS.length];
      g.globalAlpha = 0.85;
      g.fillRect(x0, 1, x1 - x0 - 1, 16);
      g.globalAlpha = 1;
      g.fillStyle = '#111';
      g.font = '700 11px sans-serif';
      g.save();
      g.beginPath();
      g.rect(x0, 0, x1 - x0 - 2, 18);
      g.clip();
      g.fillText(s.name, x0 + 4, 13);
      g.restore();
    });
    // ループ範囲
    const lp = this.song.loop;
    if (lp) {
      const x0 = Math.max(GUTTER, this.xOf(lp.start)), x1 = Math.min(w, this.xOf(lp.end));
      if (x1 > x0) { g.fillStyle = lp.on ? 'rgba(255, 200, 60, .45)' : 'rgba(255,255,255,.08)'; g.fillRect(x0, 19, x1 - x0, 24); }
    }
    // 小節番号
    const step = this.pxPerBeat * 4 < 26 ? (this.pxPerBeat * 16 < 26 ? 16 : 4) : 1;
    g.font = '11px "Share Tech Mono", monospace';
    for (let bar = Math.floor(this.viewStart / 4); bar * 4 <= end; bar++) {
      const x = this.xOf(bar * 4);
      if (x > w) break;
      if (x < GUTTER) continue;
      g.fillStyle = '#5a5566';
      g.fillRect(Math.round(x), 19, 1, 24);
      if (bar % step === 0) { g.fillStyle = '#cfc8da'; g.fillText(String(bar + 1), x + 3, 33); }
    }
    const xe = this.xOf(end);
    if (xe < w) { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(Math.max(GUTTER, xe), 0, w, RULER_H); }
    this.drawHead(g, RULER_H);
    g.fillStyle = '#141217';
    g.fillRect(0, 0, GUTTER, RULER_H);
    g.fillStyle = '#8a8396';
    g.font = '11px sans-serif';
    g.fillText('セクション（ダブルクリックで追加）', 6, 13);
    g.fillText('小節 ／ ドラッグでループ範囲', 6, 35);
  }

  private drawHead(g: CanvasRenderingContext2D, h: number): void {
    const x = this.xOf(this.playhead);
    if (x >= GUTTER) { g.fillStyle = this.recording ? '#ff4a3d' : '#7dff6a'; g.fillRect(Math.round(x), 0, 2, h); }
  }

  private drawMain(): void {
    const c = this.main;
    const g = this.fit(c);
    const w = c.clientWidth, h = c.clientHeight;
    g.fillStyle = '#1b1820';
    g.fillRect(0, 0, w, h);
    const lanes = this.lanes();
    const end = songBeats(this.song);
    const sy = this.scrollY;
    // 行の地
    for (const l of lanes) {
      const y = l.y - sy;
      if (y + l.h < 0 || y > h) continue;
      if (l.kind === 'head') { g.fillStyle = l.tr === this.selTrack ? '#3a3346' : '#2b2733'; g.fillRect(0, y, w, l.h); }
      else { g.fillStyle = l.kind === 'knob' ? '#1f1c25' : l.kind === 'switch' ? '#211d28' : (l.y / H_NOTE) % 2 < 1 ? '#221f28' : '#25222c'; g.fillRect(GUTTER, y, w, l.h); }
      g.fillStyle = '#100e13';
      g.fillRect(0, y + l.h - 1, w, 1);
    }
    // 拍と小節の線
    const step = this.grid && this.grid * this.pxPerBeat >= 6 ? this.grid : this.pxPerBeat >= 6 ? 1 : 4;
    for (let b = Math.floor(this.viewStart / step) * step; b <= end; b += step) {
      const x = this.xOf(b);
      if (x > w) break;
      if (x < GUTTER) continue;
      g.fillStyle = b % 16 === 0 ? '#6a6478' : b % 4 === 0 ? '#4a4556' : b % 1 === 0 ? '#34303c' : '#2a2731';
      g.fillRect(Math.round(x), 0, 1, h);
    }
    // セクションの境目
    for (const s of this.song.sections ?? []) {
      const x = this.xOf(s.start);
      if (x >= GUTTER && x <= w) { g.fillStyle = 'rgba(255,224,102,.5)'; g.fillRect(Math.round(x), 0, 2, h); }
    }
    // ループ範囲
    const lp = this.song.loop;
    if (lp?.on) {
      g.fillStyle = 'rgba(255,200,60,.05)';
      g.fillRect(Math.max(GUTTER, this.xOf(lp.start)), 0, this.xOf(lp.end) - Math.max(GUTTER, this.xOf(lp.start)), h);
    }
    // 中身
    for (const l of lanes) {
      const y = l.y - sy;
      if (y + l.h < 0 || y > h) continue;
      const t = this.song.tracks[l.tr];
      const toy = trackToy(this.song, l.tr);
      if (l.kind === 'head') {
        // 熱（ストレス）の記録
        const st = this.stress.get(toy);
        if (st) {
          g.fillStyle = 'rgba(255, 70, 40, .55)';
          for (let i = 0; i < st.length; i++) {
            if (!st[i]) continue;
            const x = this.xOf(i / 4);
            if (x < GUTTER || x > w) continue;
            const hh = Math.min(1, st[i]) * (l.h - 4);
            g.fillRect(x, y + l.h - 2 - hh, Math.max(1, this.pxPerBeat / 4), hh);
          }
        }
        // 音符の縮図
        g.fillStyle = this.trackColor(l.tr, 45);
        for (const n of t.notes) {
          const x0 = this.xOf(n.start);
          if (x0 > w || this.xOf(n.start + n.len) < GUTTER) continue;
          g.fillRect(Math.max(GUTTER, x0), y + 9, Math.max(1, n.len * this.pxPerBeat), 5);
        }
      } else if (l.kind === 'note') {
        for (const n of t.notes) {
          if (n.key !== l.key) continue;
          const x0 = this.xOf(n.start), x1 = this.xOf(n.start + n.len);
          if (x1 < GUTTER || x0 > w) continue;
          const sel = this.sel.has(n);
          g.fillStyle = sel ? '#ffe066' : l.cat === 'sys' ? (n.key === SYS_CRASH ? '#ff3b3b' : '#9dff7a') : l.cat === 'btn' ? '#ff9f43' : this.trackColor(l.tr, t.mute ? 32 : 60);
          const xa = Math.max(GUTTER, x0);
          g.fillRect(xa, y + 2, Math.max(3, x1 - xa - 1), l.h - 4);
          if (n.key === SYS_CRASH && x1 - xa > 30) { g.fillStyle = '#fff'; g.font = '700 10px sans-serif'; g.fillText('CRASH', xa + 3, y + l.h - 5); }
        }
      } else {
        const d = this.defOf(l);
        if (!d) continue;
        const pts = t.autos.filter((a) => a.index === l.param);
        if (l.kind === 'switch') {
          pts.forEach((a, i) => {
            const x0 = Math.max(GUTTER, this.xOf(a.t)), x1 = Math.min(w, this.xOf(i + 1 < pts.length ? pts[i + 1].t : end));
            if (x1 < GUTTER || x0 > w) return;
            const k = (a.v - d.min) / (d.max - d.min || 1);
            g.fillStyle = `hsl(${190 + k * 140} 55% ${30 + k * 20}%)`;
            g.fillRect(x0, y + 2, x1 - x0, l.h - 4);
            g.fillStyle = a === this.selAuto ? '#ffe066' : '#fff';
            g.fillRect(this.xOf(a.t), y + 1, 3, l.h - 2);
            g.font = '10px "Share Tech Mono", monospace';
            g.fillText(String(d.labels?.[Math.round(a.v) - d.min] ?? Math.round(a.v)), x0 + 5, y + l.h - 7);
          });
        } else {
          g.strokeStyle = '#6fd3ff';
          g.fillStyle = 'rgba(111, 211, 255, .15)';
          g.lineWidth = 2;
          if (pts.length) {
            g.beginPath();
            g.moveTo(GUTTER, this.knobY(l, pts[0].v));
            for (const a of pts) g.lineTo(this.xOf(a.t), this.knobY(l, a.v));
            g.lineTo(w, this.knobY(l, pts[pts.length - 1].v));
            g.stroke();
            g.lineTo(w, y + l.h);
            g.lineTo(GUTTER, y + l.h);
            g.fill();
            for (const a of pts) {
              g.fillStyle = a === this.selAuto ? '#ffe066' : '#6fd3ff';
              g.beginPath();
              g.arc(this.xOf(a.t), this.knobY(l, a.v), 3.5, 0, Math.PI * 2);
              g.fill();
            }
          }
        }
      }
    }
    const xe = this.xOf(end);
    if (xe < w) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(Math.max(GUTTER, xe), 0, w, h); }
    this.drawHead(g, h);
    // 左の名前
    g.fillStyle = '#141217';
    g.fillRect(0, 0, GUTTER, h);
    for (const l of lanes) {
      const y = l.y - sy;
      if (y + l.h < 0 || y > h) continue;
      const t = this.song.tracks[l.tr];
      const toy = trackToy(this.song, l.tr);
      const ui = this.host.toys[toy];
      g.textBaseline = 'middle';
      if (l.kind === 'head') {
        g.fillStyle = l.tr === this.selTrack ? '#3a3346' : '#221e28';
        g.fillRect(0, y, GUTTER, l.h);
        g.fillStyle = this.trackColor(l.tr);
        g.fillRect(0, y, 4, l.h);
        g.fillStyle = '#eee';
        g.font = '700 12px sans-serif';
        g.fillText(this.collapsed.has(l.tr) ? '▸' : '▾', 6, y + l.h / 2);
        const label = `${t.name ?? ui?.title ?? 'TRACK'}`;
        g.fillText(label.slice(0, 14), 20, y + l.h / 2 - 5);
        g.font = '9px sans-serif';
        g.fillStyle = '#9a93a8';
        g.fillText((ui?.title ?? '').slice(0, 18), 20, y + l.h / 2 + 7);
        const btn = (bx: number, txt: string, on: boolean, col: string) => {
          g.fillStyle = on ? col : '#3a3542';
          g.fillRect(bx, y + 3, 20, l.h - 6);
          g.fillStyle = on ? '#111' : '#bbb';
          g.font = '700 11px sans-serif';
          g.fillText(txt, bx + 5, y + l.h / 2);
        };
        btn(GUTTER - 92, 'M', t.mute, '#ffb347');
        btn(GUTTER - 70, t.lock ? '🔒' : '🔓', !!t.lock, '#ffe066');
        btn(GUTTER - 48, '●', !!t.rec || (this.tracksOfToy(toy)[0] === l.tr && !this.tracksOfToy(toy).some((i) => this.song.tracks[i].rec)), '#ff5a4f');
        btn(GUTTER - 26, '+', false, '#7dff6a');
      } else {
        const d = this.defOf(l);
        const icon = l.kind === 'note' ? (l.cat === 'sys' ? '⚡' : l.cat === 'btn' ? '●' : '♪') : l.kind === 'switch' ? '⇄' : '◠';
        const name = l.kind === 'note' && ui ? seqKeyName(ui, l.key) : d?.name ?? '';
        g.fillStyle = l.kind === 'note' && l.cat === 'sys' ? '#ff8a7a' : l.kind === 'note' && l.cat === 'btn' ? '#ffc27a' : l.kind === 'knob' ? '#8fdcff' : l.kind === 'switch' ? '#c8b0ff' : '#cfc8da';
        g.font = '11px "Share Tech Mono", monospace';
        g.fillText(`${icon} ${name}`.slice(0, 24), 14, y + l.h / 2);
      }
      g.textBaseline = 'alphabetic';
    }
    if (!this.song.tracks.length) {
      g.fillStyle = '#8a8396';
      g.font = '14px sans-serif';
      g.fillText('「＋トラック」でトラックを作ってください', GUTTER + 12, 30);
    }
  }
}
