// 6台目 TELEKEY の自動テスト：取り込んだ音の通り道、24 種の音グリッチ、FREEZE、楽器キー 11 種
import { TeleEngine } from '../src/toys/tele/dsp/engine';
import { GLITCHES, TELE_KEYS, TELE_KEY_INDEX } from '../src/toys/tele/params';

const SR = 48000;
let fail = 0;
const ng = (m: string) => { fail++; console.log('NG', m); };
const bad = (b: Float32Array) => b.some((x) => !Number.isFinite(x) || Math.abs(x) > 1.01);
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);
const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };
const K = (code: string) => TELE_KEY_INDEX.get(code)!;

// 取り込んだ音の代わり：音程が動くのこぎり波＋少しのサイン（決まった値）
let ph = 0, t = 0;
const src = () => { t++; ph = (ph + (220 + 110 * Math.sin(t / 9000)) / SR) % 1; return (ph * 2 - 1) * 0.4 + Math.sin(t / 37) * 0.05; };
function run(e: TeleEngine, sec: number, input = true): Float32Array {
  const out = new Float32Array(Math.floor((SR * sec) / 128) * 128);
  const b = new Float32Array(128), inp = new Float32Array(128);
  for (let i = 0; i < out.length / 128; i++) {
    for (let j = 0; j < 128; j++) inp[j] = input ? src() : 0;
    e.process(b, input ? inp : undefined);
    out.set(b, i * 128);
  }
  return out;
}
const fresh = () => { t = 0; ph = 0; const e = new TeleEngine(SR); e.powerOn(); run(e, 0.3); return e; };

// 電源 OFF では通らない
{
  t = 0;
  const e = new TeleEngine(SR);
  if (rms(run(e, 0.3)) > 0.001) ng('電源 OFF で音が出る');
}
const dry = run(fresh(), 1);
console.log('そのままの音 rms', rms(dry).toFixed(4));
if (rms(dry) < 0.05) ng('取り込んだ音が通らない');

// 24 種のグリッチ：どれもそのままの音と違い、互いにも違う
const outs: Float32Array[] = [];
GLITCHES.forEach((g, n) => {
  const code = TELE_KEYS.find((k) => k.role.r === 'glitch' && k.role.n === n)!.code;
  const e = fresh();
  e.keyDown(K(code));
  const o = run(e, 1);
  outs.push(o);
  const d = diff(o, dry);
  if (bad(o)) ng(`${g.a} で異常値`);
  if (d < 0.01) ng(`${g.a} が効いていない（差 ${d.toFixed(4)}）`);
});
let minD = 9, pair = '';
for (let i = 0; i < 24; i++) for (let j = i + 1; j < 24; j++) { const d = diff(outs[i], outs[j]); if (d < minD) { minD = d; pair = `${GLITCHES[i].a} と ${GLITCHES[j].a}`; } }
console.log(`音グリッチ 24 種：一番似ている組 ${pair} 差 ${minD.toFixed(4)}`);
if (minD < 0.005) ng('似すぎたグリッチがある');

// 離すと戻る
{
  const e = fresh();
  e.keyDown(K('KeyQ')); run(e, 0.5); e.keyUp(K('KeyQ'));
  run(e, 0.2);
  if (e.mask !== 0) ng('離してもグリッチが残る');
}
// FREEZE：入力が変わっても同じ断片を繰り返す（周期的になる）
{
  const e = fresh();
  e.keyDown(K('Space'));
  const o = run(e, 1);
  const seg = Math.floor(SR * 0.12);
  let d = 0;
  for (let i = SR * 0.3; i < SR * 0.3 + seg; i++) d += Math.abs(o[i] - o[i + seg]);
  console.log('FREEZE の周期のずれ', (d / seg).toFixed(5));
  if (d / seg > 0.01) ng('FREEZE で同じ断片を繰り返していない');
}
// 楽器キー 11 種：入力がなくても鳴る
{
  const insts = TELE_KEYS.filter((k) => k.role.r === 'inst');
  const silent: string[] = [];
  for (const k of insts) {
    const e = new TeleEngine(SR);
    e.powerOn();
    run(e, 0.2, false);
    e.keyDown(K(k.code));
    const o = run(e, 0.3, false);
    e.keyUp(K(k.code));
    if (rms(o) < 0.01 || bad(o)) silent.push(k.label);
  }
  console.log(`楽器キー ${insts.length} 個：鳴らない = ${silent.join(' ') || 'なし'}`);
  if (silent.length) ng('鳴らない楽器キーがある');
}
// ↑ でピッチが変わる
{
  const e = fresh();
  e.keyDown(K('ArrowUp')); e.keyDown(K('ArrowUp')); e.keyDown(K('ArrowUp'));
  if (diff(run(e, 1), dry) < 0.01) ng('↑ のピッチが効いていない');
}
// 全部押しても壊れない
{
  const e = fresh();
  for (const k of TELE_KEYS) if (k.role.r === 'glitch' || k.role.r === 'inst') e.keyDown(K(k.code));
  const o = run(e, 1.5);
  if (bad(o)) ng('全部押しで異常値');
  console.log('全部押し rms', rms(o).toFixed(4));
}
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
