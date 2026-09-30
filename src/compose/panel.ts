// 自動作曲ユニット（おもちゃの横に後付けした改造基板ふうのパネル）。
// ・自動作曲ボタン：押すたびに新しいシードで作る
// ・SEED：表示と手入力（入れると、そのシードで作る）
// ・STYLE（5 段）・壊れ度・LENGTH（30 秒／1 分／2 分／3 分）・BPM
// ・セクションだけ作り直す
// 鍵（トラックを残す）はシーケンサーのトラック名の横の 🔒。
import './panel.css';
import { Knob, SteppedKnob, momentary } from '../core/controls';
import type { Song } from '../core/song';
import { Board } from '../core/ui';
import { defaultComposer } from './rules';
import { LENGTHS, STYLES, STYLE_IDS } from './styles';
import type { ComposeSettings, ComposeToy } from './types';

export const PANEL_W = 340;
export const PANEL_H = 800;
const STYLE_SHORT = ['素朴', 'ビート', 'アンビ', 'ノイズ', '崩壊'];
const LENGTH_NAMES = ['30秒', '1分', '2分', '3分'];

export interface ComposerHost {
  /** 作曲するおもちゃ（曲の中の番号と種類） */
  toys: ComposeToy[];
  /** 設定を覚えておく名前（おもちゃごと） */
  storeKey: string;
  song(): Song;
  /** 作った曲をシーケンサーに入れて、頭から鳴らす */
  load(song: Song): void;
  togglePlay(): void;
}

export function newSeed(): number {
  return 1 + Math.floor(Math.random() * 999998);
}

export function mountComposerPanel(host: ComposerHost): { root: HTMLElement; refresh(): void; settings(): ComposeSettings } {
  const root = document.createElement('div');
  root.className = 'compose-panel';
  root.style.width = `${PANEL_W}px`;
  root.style.height = `${PANEL_H}px`;
  const b = new Board(root);

  // ---- 設定（このブラウザに覚えておく） ----
  let st: ComposeSettings = { seed: 1, style: 'beat', chaos: 0.5, lengthSec: 60, bpm: STYLES.beat.bpm };
  try {
    st = { ...st, ...JSON.parse(localStorage.getItem(host.storeKey) ?? '{}') };
  } catch {
    // 読めなければ最初の設定
  }
  const save = () => {
    try {
      localStorage.setItem(host.storeKey, JSON.stringify(st));
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

  // ---- STYLE・壊れ度 ----
  b.label('STYLE', 92, 330, 'cp-lbl');
  const styleKnob = new SteppedKnob(b.knob('black big', 92, 402), 5, Math.max(0, STYLE_IDS.indexOf(st.style)), (v) => {
    st.style = STYLE_IDS[v];
    st.bpm = STYLES[st.style].bpm;
    bpmKnob.set(bpmToK(st.bpm), false);
    show();
    save();
  }, 240);
  const ticks = b.place('ticks cp-ticks', 92, 402);
  STYLE_SHORT.forEach((n, i) => {
    const a = ((-120 + i * 60) * Math.PI) / 180;
    const s = document.createElement('span');
    s.textContent = n;
    s.style.left = `${Math.sin(a) * 54}px`;
    s.style.top = `${-Math.cos(a) * 50 + 6}px`;
    ticks.appendChild(s);
  });
  const styleName = b.label('', 92, 476, 'cp-val');
  b.label('壊れ度', 250, 330, 'cp-lbl');
  const chaosKnob = new Knob(b.knob('red big', 250, 402), { default: 0.5 }, (v) => { st.chaos = Math.round(v * 100) / 100; show(); save(); });
  chaosKnob.set(st.chaos, false);
  const chaosVal = b.label('', 250, 476, 'cp-val');

  // ---- LENGTH・BPM ----
  b.label('LENGTH', 92, 520, 'cp-lbl');
  const lenKnob = new SteppedKnob(b.knob('black', 92, 574), 4, Math.max(0, LENGTHS.indexOf(st.lengthSec)), (v) => { st.lengthSec = LENGTHS[v]; show(); save(); }, 180);
  const lenVal = b.label('', 92, 624, 'cp-val');
  b.label('BPM', 250, 520, 'cp-lbl');
  const range = () => STYLES[st.style].bpmRange;
  const bpmToK = (bpm: number) => (bpm - range()[0]) / (range()[1] - range()[0]);
  const bpmKnob = new Knob(b.knob('chrome', 250, 574), { default: bpmToK(STYLES[st.style].bpm) }, (v) => {
    st.bpm = Math.round(range()[0] + v * (range()[1] - range()[0]));
    show();
    save();
  });
  bpmKnob.set(bpmToK(st.bpm), false);
  const bpmVal = b.label('', 250, 624, 'cp-val');

  // ---- セクションだけ作り直す・再生 ----
  const secBox = b.place('cp-sec', 170, 676, '<select></select>');
  const secSel = secBox.querySelector('select') as HTMLSelectElement;
  const regen = b.place('cp-btn', 170, 712, 'このセクションだけ作り直す');
  const playBtn = b.place('cp-btn play', 170, 752, '▶ 再生 / ■ 停止');
  b.label('🔒 残したいトラックは、シーケンサーのトラック名の横の鍵', 170, 786, 'cp-sub small');

  const show = () => {
    seedIn.value = String(st.seed);
    styleName.textContent = STYLES[st.style].name;
    chaosVal.textContent = `${Math.round(st.chaos * 100)}%`;
    lenVal.textContent = LENGTH_NAMES[LENGTHS.indexOf(st.lengthSec)] ?? `${st.lengthSec}秒`;
    bpmVal.textContent = String(st.bpm);
  };
  show();
  void lenKnob;
  void styleKnob;

  const compose = (section?: number) => {
    const song = defaultComposer().compose({ settings: { ...st }, toys: host.toys, base: host.song(), section });
    host.load(song);
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
  for (const el of [seedIn, secSel]) {
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
  return { root, refresh, settings: () => ({ ...st }) };
}
