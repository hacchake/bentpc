// 自動作曲ユニット（おもちゃの横に後付けした改造基板ふうのパネル）。
// ・自動作曲ボタン：押すたびに新しいシードで作る
// ・SEED：表示と手入力（入れると、そのシードで作る）
// ・STYLE（26 種類。演歌・レゲエ・ドラムンベース・IDM など。◀ ▶ か一覧から選ぶ）
// ・参加するおもちゃ（何台かで 1 つの曲にする）
// ・壊れ度・LENGTH（30 秒／1 分／2 分／3 分）・BPM
// ・セクションだけ作り直す
// 鍵（トラックを残す）はシーケンサーのトラック名の横の 🔒。
import './panel.css';
import { Knob, SteppedKnob, momentary } from '../core/controls';
import type { Song } from '../core/song';
import { Board } from '../core/ui';
import { defaultComposer } from './rules';
import { LENGTHS, STYLE_GROUPS, STYLE_IDS, styleOf } from './styles';
import type { ComposeSettings, ComposeToy } from './types';

export const PANEL_W = 340;
export const PANEL_H = 900;
const LENGTH_NAMES = ['30秒', '1分', '2分', '3分'];

/** 曲に入れられるおもちゃ（参加ボタンの 1 つ） */
export interface ComposeChoice extends ComposeToy {
  /** ボタンの表示（短く） */
  name: string;
}

export interface ComposerHost {
  /** 曲に入れられるおもちゃ（曲の中の番号と種類） */
  choices: ComposeChoice[];
  /** 最初に参加させるおもちゃ（toy 番号） */
  defaultToys: number[];
  /** いつも参加するおもちゃ（このパネルが付いているおもちゃ。外せない） */
  fixed?: number;
  /** 設定を覚えておく名前（おもちゃごと） */
  storeKey: string;
  song(): Song;
  /** 作った曲をシーケンサーに入れる（play なら頭から鳴らす） */
  load(song: Song, play: boolean): void;
  togglePlay(): void;
  /** 作ったとき（URL を書き換える）。toys = 参加したおもちゃの toy 番号 */
  onCompose?(st: ComposeSettings, toys: number[]): void;
  /** URL をコピー */
  share(st: ComposeSettings, toys: number[]): void;
}

export function newSeed(): number {
  return 1 + Math.floor(Math.random() * 999998);
}

export interface ComposerPanel {
  root: HTMLElement;
  refresh(): void;
  settings(): ComposeSettings;
  /** 設定を入れて作る（URL から開いたとき）。toys を渡すと参加するおもちゃもそれにする */
  composeWith(st: ComposeSettings, play: boolean, toys?: number[]): void;
}

export function mountComposerPanel(host: ComposerHost): ComposerPanel {
  const root = document.createElement('div');
  root.className = 'compose-panel';
  root.style.width = `${PANEL_W}px`;
  root.style.height = `${PANEL_H}px`;
  const b = new Board(root);

  // ---- 設定（このブラウザに覚えておく） ----
  let st: ComposeSettings = { seed: 1, style: 'beat', chaos: 0.5, lengthSec: 60, bpm: styleOf('beat').bpm };
  let sel = new Set(host.defaultToys);
  try {
    st = { ...st, ...JSON.parse(localStorage.getItem(host.storeKey) ?? '{}') };
    const saved = JSON.parse(localStorage.getItem(`${host.storeKey}.toys`) ?? 'null');
    if (Array.isArray(saved)) sel = new Set(saved.filter((t) => host.choices.some((c) => c.toy === t)));
  } catch {
    // 読めなければ最初の設定
  }
  if (!STYLE_IDS.includes(st.style)) st.style = 'beat';
  const fixSel = () => {
    if (host.fixed !== undefined) sel.add(host.fixed);
    if (!sel.size) host.defaultToys.forEach((t) => sel.add(t));
  };
  fixSel();
  const selected = () => host.choices.filter((c) => sel.has(c.toy)).map((c) => c.toy);
  const save = () => {
    try {
      localStorage.setItem(host.storeKey, JSON.stringify(st));
      localStorage.setItem(`${host.storeKey}.toys`, JSON.stringify(selected()));
    } catch {
      // 保存できなくても使える
    }
  };

  b.tape('AUTO COMPOSER', 170, 34, false, -2);
  b.label('自動作曲ユニット（後付け）', 170, 66, 'cp-sub');

  // ---- 自動作曲ボタン ----
  const go = b.place('dome big compose', 170, 128);
  b.label('自動作曲', 170, 174, 'power-label cp-go');
  b.label('押すたびに新しい曲', 170, 196, 'cp-sub');

  // ---- SEED ----
  b.label('SEED', 170, 230, 'cp-lbl');
  const seedBox = b.place('cp-seed', 170, 262, '<input type="number" min="1" step="1" spellcheck="false">');
  const seedIn = seedBox.querySelector('input') as HTMLInputElement;
  const again = b.place('cp-btn', 170, 304, 'この設定で作り直す');

  // ---- STYLE：◀ 一覧 ▶ と、そのスタイルの説明 ----
  b.label('STYLE', 170, 340, 'cp-lbl');
  const prevBtn = b.place('cp-btn cp-arrow', 34, 380, '◀');
  const nextBtn = b.place('cp-btn cp-arrow', 306, 380, '▶');
  const styleBox = b.place('cp-style', 170, 380, '<select></select>');
  const styleSel = styleBox.querySelector('select') as HTMLSelectElement;
  styleSel.innerHTML = STYLE_GROUPS.map((g) => `<optgroup label="${g}">${
    STYLE_IDS.filter((id) => styleOf(id).group === g).map((id) => `<option value="${id}">${styleOf(id).name}</option>`).join('')
  }</optgroup>`).join('');
  const styleDesc = b.label('', 170, 424, 'cp-sub small cp-desc');
  const setStyle = (id: string) => {
    st.style = id;
    st.bpm = styleOf(id).bpm;
    bpmKnob.set(bpmToK(st.bpm), false);
    show();
    save();
  };
  styleSel.addEventListener('change', () => setStyle(styleSel.value));
  const stepStyle = (d: number) => setStyle(STYLE_IDS[(STYLE_IDS.indexOf(st.style) + d + STYLE_IDS.length) % STYLE_IDS.length]);
  prevBtn.addEventListener('click', () => stepStyle(-1));
  nextBtn.addEventListener('click', () => stepStyle(1));

  // ---- 参加するおもちゃ（何台かで 1 つの曲） ----
  b.label('参加するおもちゃ', 170, 470, 'cp-lbl small');
  const chipBox = b.place('cp-chips', 170, 516);
  const chips = host.choices.map((c) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cp-chip';
    el.textContent = c.name;
    if (c.toy === host.fixed) el.title = 'このおもちゃの作曲ユニットなので、いつも参加';
    el.addEventListener('click', () => {
      if (c.toy === host.fixed) return;
      if (sel.has(c.toy)) { if (sel.size > 1) sel.delete(c.toy); } else sel.add(c.toy);
      show();
      save();
    });
    chipBox.appendChild(el);
    return el;
  });
  const chipNote = b.label('', 170, 562, 'cp-sub small');

  // ---- 壊れ度・LENGTH・BPM ----
  b.label('壊れ度', 62, 600, 'cp-lbl');
  const chaosKnob = new Knob(b.knob('red', 62, 646), { default: 0.5 }, (v) => { st.chaos = Math.round(v * 100) / 100; show(); save(); });
  chaosKnob.set(st.chaos, false);
  const chaosVal = b.label('', 62, 692, 'cp-val');
  b.label('LENGTH', 170, 600, 'cp-lbl');
  const lenKnob = new SteppedKnob(b.knob('black', 170, 646), 4, Math.max(0, LENGTHS.indexOf(st.lengthSec)), (v) => { st.lengthSec = LENGTHS[v]; show(); save(); }, 180);
  const lenVal = b.label('', 170, 692, 'cp-val');
  b.label('BPM', 278, 600, 'cp-lbl');
  const range = () => styleOf(st.style).bpmRange;
  const bpmToK = (bpm: number) => (bpm - range()[0]) / (range()[1] - range()[0]);
  const bpmKnob = new Knob(b.knob('chrome', 278, 646), { default: bpmToK(styleOf(st.style).bpm) }, (v) => {
    st.bpm = Math.round(range()[0] + v * (range()[1] - range()[0]));
    show();
    save();
  });
  bpmKnob.set(bpmToK(st.bpm), false);
  const bpmVal = b.label('', 278, 692, 'cp-val');

  // ---- セクションだけ作り直す・再生 ----
  const secBox = b.place('cp-sec', 170, 744, '<select></select>');
  const secSel = secBox.querySelector('select') as HTMLSelectElement;
  const regen = b.place('cp-btn', 170, 782, 'このセクションだけ作り直す');
  const playBtn = b.place('cp-btn play', 98, 828, '▶ 再生 / ■ 停止');
  const shareBtn = b.place('cp-btn', 252, 828, '🔗 URL をコピー');
  b.label('🔒 残したいトラックは、シーケンサーのトラック名の横の鍵', 170, 870, 'cp-sub small');

  const show = () => {
    seedIn.value = String(st.seed);
    const sd = styleOf(st.style);
    styleSel.value = st.style;
    styleDesc.textContent = `${sd.desc}（BPM ${sd.bpm} 前後）`;
    host.choices.forEach((c, i) => {
      chips[i].classList.toggle('on', sel.has(c.toy));
      chips[i].classList.toggle('fixed', c.toy === host.fixed);
    });
    const n = sel.size;
    chipNote.textContent = n > 1 ? `${n} 台で 1 つの曲：リズム係・メロディの掛け合い・ブレイクのソロを分担` : '押すと、ほかのおもちゃも同じ曲に入る';
    chaosVal.textContent = `${Math.round(st.chaos * 100)}%`;
    lenVal.textContent = LENGTH_NAMES[LENGTHS.indexOf(st.lengthSec)] ?? `${st.lengthSec}秒`;
    bpmVal.textContent = String(st.bpm);
  };
  show();

  const compose = (section?: number, play = true, fresh = false) => {
    // fresh：URL から開いたとき。このブラウザの鍵のトラックを混ぜない（誰が開いても同じ曲に）
    const toys = host.choices.filter((c) => sel.has(c.toy)).map(({ toy, kind }) => ({ toy, kind }));
    const song = defaultComposer().compose({ settings: { ...st }, toys, base: fresh ? undefined : host.song(), section });
    host.load(song, play);
    host.onCompose?.({ ...st }, selected());
    refresh();
  };
  momentary(go, () => { st.seed = newSeed(); show(); save(); compose(); });
  seedIn.addEventListener('change', () => {
    const v = Math.floor(Number(seedIn.value));
    if (!Number.isFinite(v) || v < 1) { show(); return; }
    st.seed = v;
    save();
    compose();
  });
  // 入力欄の中のキーは、おもちゃの演奏に行かないように
  for (const el of [seedIn, secSel, styleSel]) {
    el.addEventListener('keydown', (e) => e.stopPropagation());
    el.addEventListener('keyup', (e) => e.stopPropagation());
  }
  again.addEventListener('click', () => compose());
  regen.addEventListener('click', () => {
    const i = Number(secSel.value);
    if (secSel.value === '' || !Number.isFinite(i)) return;
    compose(i);
  });
  playBtn.addEventListener('click', () => host.togglePlay());
  shareBtn.addEventListener('click', () => host.share({ ...st }, selected()));

  /** シーケンサーの曲が変わったら、セクションの一覧を作り直す */
  function refresh(): void {
    const s = host.song();
    const can = !!s.compose && s.sections?.length;
    const prev = secSel.value;
    secSel.innerHTML = can
      ? s.sections!.map((x, i) => `<option value="${i}">${i + 1}. ${x.name}（${x.start / 4 + 1} 小節〜）</option>`).join('')
      : '<option value="">（自動作曲した曲だけ）</option>';
    if (can && prev && Number(prev) < s.sections!.length) secSel.value = prev;
    regen.classList.toggle('disabled', !can);
  }
  queueMicrotask(refresh); // シーケンサーができてから
  return {
    root,
    refresh,
    settings: () => ({ ...st }),
    composeWith(next, play, toys) {
      st = { ...next };
      if (toys) {
        const ok = toys.filter((t) => host.choices.some((c) => c.toy === t));
        if (ok.length) sel = new Set(ok);
        fixSel();
      }
      chaosKnob.set(st.chaos, false);
      lenKnob.set(Math.max(0, LENGTHS.indexOf(st.lengthSec)), false);
      bpmKnob.set(bpmToK(st.bpm), false);
      show();
      save();
      compose(undefined, play, true);
    },
  };
}
