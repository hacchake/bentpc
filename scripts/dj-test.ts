// 3台目 SPIN-TOT の自動テスト：全リズム（隠し含む）・全パッド・ディスク・鍵盤・改造パーツ
import { DjEngine } from '../src/toys/dj/dsp/engine';
import { DJ_DISC_TOUCH, DJ_NOTE_COUNT, DJ_PAD, DJ_PLAY, type DjParamId } from '../src/toys/dj/params';

const SR = 48000;
let fail = 0;
const ng = (m: string) => { fail++; console.log('NG', m); };
const bad = (b: Float32Array) => b.some((x) => !Number.isFinite(x) || Math.abs(x) > 1.01);
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);
const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };
function run(e: DjEngine, sec: number): Float32Array {
  const out = new Float32Array(Math.floor((SR * sec) / 128) * 128);
  const buf = new Float32Array(128);
  for (let i = 0; i < out.length / 128; i++) { e.process(buf); out.set(buf, i * 128); }
  return out;
}
const t0 = performance.now();
const proto = new DjEngine(SR);
console.log(`起動（音の ROM 作成）${(performance.now() - t0).toFixed(0)}ms`);
function fresh(s: Partial<Record<DjParamId, number>> = {}): DjEngine {
  const e = new DjEngine(SR);
  e.powerOn();
  for (const [k, v] of Object.entries(s)) e.setParamById(k as DjParamId, v);
  run(e, 0.6);
  return e;
}
void proto;

// リズム 28 種
const outs: Float32Array[] = [];
for (let r = 0; r < 28; r++) {
  const e = fresh({ rhythm: r });
  e.keyDown(DJ_PLAY);
  const o = run(e, 2);
  outs.push(o);
  if (rms(o) < 0.01 || bad(o)) ng(`リズム ${r + 1} rms ${rms(o)}`);
}
let minD = 9; for (let i = 0; i < 28; i++) for (let j = i + 1; j < 28; j++) minD = Math.min(minD, diff(outs[i], outs[j]));
console.log('リズム 28 種：一番似ている組の差', minD.toFixed(4));
if (minD < 0.005) ng('似すぎたリズムがある');

// パッド 10 セット × 6
for (let b = 0; b < 10; b++) for (let p = 0; p < 6; p++) {
  const e = fresh({ sfxBank: b });
  e.keyDown(DJ_PAD + p);
  const o = run(e, 0.4);
  if (rms(o) < 0.005 || bad(o)) ng(`パッド ${b}-${p}`);
}
console.log('パッド 60：確認');

// 鍵盤 10 音色 × 13 鍵、アルペジオ
for (let inst = 0; inst < 10; inst++) {
  const e = fresh({ instrument: inst });
  for (let k = 0; k < DJ_NOTE_COUNT; k++) {
    e.keyDown(k);
    const o = run(e, 0.12);
    e.keyUp(k);
    if (rms(o) < 0.005 || bad(o)) ng(`鍵盤 音色${inst} 鍵${k}`);
  }
}
{
  const e = fresh({ kbPattern: 1 });
  e.keyDown(0); e.keyDown(4);
  if (rms(run(e, 1)) < 0.01) ng('アルペジオが鳴らない');
}
console.log('鍵盤：確認');

// ディスク 21 種：回すと鳴り、離すと止まる
for (let d = 0; d < 21; d++) {
  const e = fresh({ discFx: d });
  e.keyDown(DJ_DISC_TOUCH);
  e.setParamById('discSpeed', 1.2);
  const o = run(e, 0.6);
  e.setParamById('discSpeed', 0);
  e.keyUp(DJ_DISC_TOUCH);
  run(e, 1.5);
  const after = run(e, 0.3);
  if (rms(o) < 0.005 || bad(o)) ng(`ディスク ${d} が鳴らない`);
  if (rms(after) > 0.003) ng(`ディスク ${d} が止まらない`);
}
{
  const e = fresh({ discFx: 1 });
  e.keyDown(DJ_DISC_TOUCH); e.setParamById('discSpeed', -1.5);
  if (rms(run(e, 0.5)) < 0.005) ng('逆回しで鳴らない');
}
console.log('ディスク：確認');

// 改造パーツ（リズム再生中との差）
const base = (s: Partial<Record<DjParamId, number>> = {}, during?: (e: DjEngine) => void) => {
  const e = fresh({ rhythm: 3, ...s });
  e.keyDown(DJ_PLAY);
  e.keyDown(0); e.keyDown(4); e.keyDown(7);
  run(e, 0.2);
  during?.(e);
  return run(e, 1.5);
};
const clean = base();
const checks: [string, Partial<Record<DjParamId, number>>, ((e: DjEngine) => void)?][] = [
  ['PITCH 粗調整', { pitchOn: 1, pitchCoarse: 0.8 }],
  ['PITCH 微調整', { pitchOn: 1, pitchFine: 0.9 }],
  ['PITCH OFF なら効かない', { pitchOn: 0, pitchCoarse: 0.9 }],
  ['光センサー（暗い）', { lightOn: 1, light: 0.1 }],
  ['STOP（移動停止）', {}, (e) => e.setParamById('halt', 1)],
  ['DIST', { dist1On: 1, dist1: 0.7 }],
  ['DIST 2', { dist2On: 1, dist2: 0.7 }],
  ['FEEDBACK / RHYTHM', { feedback: 0.9, fbSource: 0 }],
  ['FEEDBACK / DISC', { feedback: 0.9, fbSource: 1 }],
  ['FEEDBACK / MASTER', { feedback: 0.9, fbSource: 2 }],
  ['RHYTHM EFFECT', { rhythmFx: 1 }],
];
for (const [name, s, during] of checks) {
  const o = base(s, during);
  const d = diff(o, clean);
  console.log(`${name.padEnd(20)} diff ${d.toFixed(4)} rms ${rms(o).toFixed(4)}`);
  if (bad(o)) ng(`${name} で異常値`);
  if (name.includes('効かない') ? d > 0.001 : d < 0.003) ng(`${name} の効き方がおかしい`);
}
{
  const o = base({}, (e) => e.setParamById('halt', 1));
  if (rms(o.subarray(-SR / 2)) > 0.02) ng('STOP で止まりきらない');
}
{
  const o = base({ pitchOn: 1, pitchCoarse: 1, lightOn: 1, light: 0, dist1On: 1, dist1: 1, dist2On: 1, dist2: 1, feedback: 1, fbSource: 2, rhythm: 25 });
  if (bad(o)) ng('全部盛りで異常値');
  console.log('全部盛り rms', rms(o).toFixed(4));
}
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
