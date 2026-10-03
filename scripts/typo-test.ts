// 5台目 TYPOTRON の自動テスト：全キーが何かするか、行バッファのループ、キーボードの故障（改造）が効くか
import { TypoEngine } from '../src/toys/typo/dsp/engine';
import { RAW_NOTE, TYPO_KEYS, TYPO_KEY_INDEX, type TypoParamId } from '../src/toys/typo/params';

const SR = 48000;
let fail = 0;
const ng = (m: string) => { fail++; console.log('NG', m); };
const bad = (b: Float32Array) => b.some((x) => !Number.isFinite(x) || Math.abs(x) > 1.01);
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);
const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };
const K = (code: string) => { const k = TYPO_KEY_INDEX.get(code); if (k === undefined) throw new Error(code); return k; };
function run(e: TypoEngine, sec: number): Float32Array {
  const out = new Float32Array(Math.floor((SR * sec) / 128) * 128);
  const buf = new Float32Array(128);
  for (let i = 0; i < out.length / 128; i++) { e.process(buf); out.set(buf, i * 128); }
  return out;
}
function fresh(s: Partial<Record<TypoParamId, number>> = {}): TypoEngine {
  const e = new TypoEngine(SR);
  e.keyDown(K('PageUp')); e.keyUp(K('PageUp'));
  for (const [k, v] of Object.entries(s)) e.setParamById(k as TypoParamId, v);
  run(e, 0.5);
  return e;
}
const tap = (e: TypoEngine, code: string, sec = 0.15) => { e.keyDown(K(code)); const o = run(e, sec); e.keyUp(K(code)); return o; };

// すべてのキーで少なくとも打鍵音が鳴る。音のキーとドラムは音が出る
{
  const silent: string[] = [];
  for (const k of TYPO_KEYS) {
    if (k.code === 'PageDown') continue;
    const e = fresh();
    const o = tap(e, k.code, 0.12);
    if (rms(o) < 0.002 || bad(o)) silent.push(k.code);
  }
  console.log(`${TYPO_KEYS.length} キー：無音 = ${silent.join(' ') || 'なし'}`);
  if (silent.length) ng('鳴らないキーがある');
}
// 4 波形 × 4 音階 で音が変わる
{
  const outs: Float32Array[] = [];
  for (let w = 0; w < 4; w++) for (let s = 0; s < 4; s++) {
    const e = fresh({ wave: w, scale: s });
    for (const c of ['KeyZ', 'KeyC', 'KeyB']) e.keyDown(K(c));
    e.keyDown(K('KeyS')); e.keyDown(K('KeyW'));
    outs.push(run(e, 0.5));
  }
  let minD = 9;
  for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) minD = Math.min(minD, diff(outs[i], outs[j]));
  console.log('波形×音階 16 通り：一番似ている組の差', minD.toFixed(4));
  if (minD < 0.003) ng('波形・音階が効いていない');
}
// 行バッファ：打つ → Enter でループ → Backspace で減る → Esc で消える
{
  const e = fresh();
  for (const c of ['KeyH', 'KeyE', 'KeyL', 'KeyL', 'KeyO']) tap(e, c, 0.05);
  if (e.display.line !== 'HELLO') ng(`行バッファ: ${e.display.line}`);
  run(e, 1);
  tap(e, 'Enter', 0.05);
  const loop = run(e, 2);
  console.log('行バッファ', e.display.line, 'ループ rms', rms(loop).toFixed(4));
  if (rms(loop) < 0.01) ng('ループが鳴らない');
  tap(e, 'Backspace', 0.05);
  if (e.display.line !== 'HELL') ng('Backspace で消えない');
  tap(e, 'Escape', 0.05);
  run(e, 2);
  if (e.display.line !== '' || rms(run(e, 0.5)) > 0.01) ng('Esc で止まらない');
}
// 行の長さは無制限：300 文字打っても全部残り、ループで最後まで回る
{
  const e = fresh();
  const keys = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH'];
  for (let i = 0; i < 300; i++) tap(e, keys[i % keys.length], 0.01);
  const n = [...e.display.line].length;
  tap(e, 'Enter', 0.01);
  let maxStep = 0;
  for (let t = 0; t < 80; t++) { run(e, 0.25); maxStep = Math.max(maxStep, e.display.cursor); }
  console.log('長い行', n, '文字・ループの位置の最大', maxStep);
  if (n !== 300) ng(`行が ${n} 文字で止まった`);
  if (maxStep < 40) ng('長い行のループが先まで進まない');
}
// 押しっぱなしの機能
const held = (codes: string[], s: Partial<Record<TypoParamId, number>> = {}, sec = 1) => {
  const e = fresh(s);
  for (const c of codes) e.keyDown(K(c));
  return run(e, sec);
};
const chord = ['KeyA', 'KeyD', 'KeyG'];
const clean = held(chord);
const checks: [string, string[], Partial<Record<TypoParamId, number>>][] = [
  ['Shift 左（オクターブ下）', ['ShiftLeft', ...chord], {}],
  ['Shift 右（オクターブ上）', ['ShiftRight', ...chord], {}],
  ['← ベンド', [...chord, 'ArrowLeft'], {}],
  ['Delete（CORRUPT）', [...chord, 'Delete'], {}],
  ['Tab（STUTTER）', [...chord, 'Tab'], {}],
  ['GHOST', chord, { ghost: 1, ghostAmt: 1 }],
  ['SCAN', chord, { scan: 1 }],
  ['BOUNCE', chord, { bounce: 1, bounceAmt: 1 }],
  ['DRIVE', chord, { drive: 0.8 }],
  ['CRUSH', chord, { crush: 0.8 }],
  ['ECHO', chord, { echo: 0.9 }],
  ['TONE', chord, { tone: 0.1 }],
  ['DECAY', chord, { decay: 1 }],
];
for (const [name, codes, s] of checks) {
  const o = held(codes, s);
  const d = diff(o, clean);
  console.log(`${name.padEnd(22)} diff ${d.toFixed(4)}`);
  if (bad(o)) ng(`${name} で異常値`);
  if (d < 0.003) ng(`${name} が効いていない`);
}
// ↑ 移調・LATCH・SUSTAIN・OVERFLOW・MIDI ノート
{
  const a = held(['KeyA']); const e = fresh(); tap(e, 'ArrowUp', 0.01); e.keyDown(K('KeyA'));
  if (diff(run(e, 1), a) < 0.003) ng('↑ 移調が効いていない');
}
{
  const e = fresh(); tap(e, 'CapsLock', 0.01); tap(e, 'KeyA', 0.05); run(e, 1);
  if (rms(run(e, 0.5)) < 0.01) ng('LATCH で伸びない');
  const f = fresh(); f.keyDown(K('Space')); tap(f, 'KeyA', 0.05); run(f, 0.3);
  if (rms(run(f, 0.3)) < 0.01) ng('SUSTAIN で伸びない');
}
{
  const mk = (s: Partial<Record<TypoParamId, number>>) => { const e = fresh(s); for (const c of ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM']) tap(e, c, 0.03); tap(e, 'Enter', 0.01); return run(e, 3); };
  if (diff(mk({ overflow: 1 }), mk({})) < 0.005) ng('OVERFLOW が効いていない');
}
{
  const e = fresh(); e.keyDown(RAW_NOTE + 60);
  if (rms(run(e, 0.3)) < 0.01) ng('MIDI ノートで鳴らない');
}
{
  const e = fresh(); e.keyDown(K('KeyA')); tap(e, 'PageDown', 0.01); run(e, 0.3);
  if (rms(run(e, 0.3)) > 0.001) ng('電源 OFF で音が残る');
}
{
  const o = held(['ShiftRight', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'Delete', 'Tab', 'ArrowRight'], { ghost: 1, ghostAmt: 1, bounce: 1, bounceAmt: 1, scan: 1, scanRate: 1, drive: 1, crush: 1, echo: 1, wave: 3 }, 2);
  if (bad(o)) ng('全部盛りで異常値');
  console.log('全部盛り rms', rms(o).toFixed(4));
}
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
