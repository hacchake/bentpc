// 6台目 TELEKEY の自動テスト：取り込んだ音の通り道、24 種の音グリッチ、FREEZE、楽器キー 11 種
import { TeleEngine } from '../src/toys/tele/dsp/engine';
import { BURSTS, GLITCHES, TELE_KEYS, TELE_KEY_INDEX } from '../src/toys/tele/params';

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
// ---- フェーズ3：改造パーツ ----
{
  // GLITCH ボタン × BASE：25 種の一発グリッチがどれも音を変え、時間がたつと終わる
  const outs3: Float32Array[] = [];
  for (let b = 0; b < 5; b++) for (let n = 0; n < 5; n++) {
    const e = fresh();
    e.setParamById('base', b);
    e.keyDown(K('F' + (n + 1)));
    const o = run(e, 0.8);
    outs3.push(o);
    if (bad(o)) ng('一発グリッチ ' + b + '-' + n + ' で異常値');
    if (diff(o, dry.subarray(0, o.length)) < 0.01) ng('一発グリッチ ' + b + '-' + n + ' が効いていない');
    run(e, 1.5);
    if (e.status().leds.burst) ng('一発グリッチ ' + b + '-' + n + ' が終わらない');
  }
  let md = 9;
  let mp = '';
  for (let i = 0; i < 25; i++) for (let j = i + 1; j < 25; j++) { const d = diff(outs3[i], outs3[j]); if (d < md) { md = d; mp = BURSTS[Math.floor(i / 5)][i % 5].name + ' と ' + BURSTS[Math.floor(j / 5)][j % 5].name; } }
  console.log('一発グリッチ 25 種：一番似ている組', mp, '差', md.toFixed(4));
  if (md < 0.003) ng('似すぎた一発グリッチがある');
}
{
  // ノブ：FEEDBACK・DIST（2 種）・SPEED・LFO が効く
  const knobs: [string, Record<string, number>][] = [
    ['FEEDBACK', { feedback: 0.9 }], ['DIST CLIP', { dist: 0.8 }], ['DIST CRUSH', { dist: 0.8, distType: 1 }],
    ['SPEED', { speed: 0.8 }], ['LFO', { lfoDepth: 1, lfoRate: 0.6 }],
  ];
  for (const [name, set] of knobs) {
    const e = fresh();
    for (const [id, v] of Object.entries(set)) e.setParamById(id as 'dist', v);
    const o = run(e, 1);
    if (bad(o)) ng(name + ' で異常値');
    if (diff(o, dry) < 0.01) ng(name + ' が効いていない');
  }
  // DRY/WET = 0 ならグリッチを押しても元の音のまま
  const e = fresh(); e.setParamById('mix', 0); e.keyDown(K('KeyW'));
  if (diff(run(e, 1), dry) > 0.01) ng('DRY/WET 0 でもグリッチが混ざる');
}
{
  // HOLD：離してもグリッチが残る → RELEASE で消える
  const e = fresh();
  e.keyDown(K('KeyW')); e.keyDown(K('Enter')); e.keyUp(K('Enter')); e.keyUp(K('KeyW'));
  if (!(e.mask & 2)) ng('HOLD でつかめない');
  e.keyDown(K('Backspace'));
  if (e.mask) ng('RELEASE で消えない');
}
{
  // キー混線：同じキーを何度も押すと、効くグリッチがばらける
  const e = fresh(); e.setParamById('crosstalk', 1);
  const seen = new Set<number>();
  for (let i = 0; i < 30; i++) { e.keyDown(K('KeyT')); seen.add(e.mask); e.keyUp(K('KeyT')); }
  console.log('混線：同じキーで出たグリッチの組み合わせ', seen.size, '通り');
  if (seen.size < 3) ng('キー混線が効いていない');
}
// ---- フェーズ4：熱（やりすぎると暴発、離せば冷める。固まらない）----
for (const keys of [['KeyQ'], ['KeyQ', 'KeyW'], ['KeyQ', 'KeyW', 'KeyE']]) {
  const e = fresh();
  keys.forEach((c) => e.keyDown(K(c)));
  let first = -1, count = 0, prev = 0;
  for (let s = 0; s < 40; s++) {
    run(e, 0.5);
    const sp = e.status().fx.spon;
    if (sp && !prev) { count++; if (first < 0) first = s * 0.5; }
    prev = sp;
  }
  keys.forEach((c) => e.keyUp(K(c)));
  let cool = 0;
  while (e.heat > 0.45 && cool < 30) { run(e, 0.5); cool += 0.5; }
  run(e, 1);
  console.log(`GLITCH ${keys.length} 個押しっぱなし 20 秒：暴発開始 ${first}s / 暴発 ${count} 回 / 離して ${cool}s で落ち着く`);
  if (first < 0 && keys.length >= 2) ng('熱で暴発しない');
  if (cool >= 30) ng('冷めない');
  if (e.mask !== 0) ng('冷めた後もグリッチが残る（固まっている）');
}
{
  const e = fresh();
  for (let i = 0; i < 12; i++) { e.keyDown(K('F' + ((i % 5) + 1))); run(e, 0.1); }
  console.log('一発グリッチ連打 12 回の熱', e.heat.toFixed(2));
  if (e.heat < 0.45) ng('一発グリッチの連打で熱くならない');
  e.keyDown(K('Escape'));
  if (e.heat !== 0) ng('RESET で熱が戻らない');
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
