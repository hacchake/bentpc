// 4台目 VROOMBOX の自動テスト：始動・回転数・ギア・付属の音・改造パーツ
import { VroomEngine } from '../src/toys/vroom/dsp/engine';
import { V_CRASH, V_HORN, V_NOTE, V_PRESET, V_START, type VroomParamId } from '../src/toys/vroom/params';

const SR = 48000;
let fail = 0;
const ng = (m: string) => { fail++; console.log('NG', m); };
const bad = (b: Float32Array) => b.some((x) => !Number.isFinite(x) || Math.abs(x) > 1.01);
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);
const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };
function run(e: VroomEngine, sec: number): Float32Array {
  const out = new Float32Array(Math.floor((SR * sec) / 128) * 128);
  const buf = new Float32Array(128);
  for (let i = 0; i < out.length / 128; i++) { e.process(buf); out.set(buf, i * 128); }
  return out;
}
const t0 = performance.now();
new VroomEngine(SR);
console.log(`起動（ラジオの ROM 作成）${(performance.now() - t0).toFixed(0)}ms`);
function started(s: Partial<Record<VroomParamId, number>> = {}): VroomEngine {
  const e = new VroomEngine(SR);
  e.powerOn();
  for (const [k, v] of Object.entries(s)) e.setParamById(k as VroomParamId, v);
  e.keyDown(V_START); run(e, 1.3); e.keyUp(V_START);
  run(e, 0.5);
  return e;
}

// 始動
{
  const e = new VroomEngine(SR); e.powerOn();
  if (rms(run(e, 0.5)) > 0.001) ng('エンジンをかける前から鳴っている');
  e.keyDown(V_START);
  const crank = run(e, 1.3);
  e.keyUp(V_START);
  console.log('セル rms', rms(crank).toFixed(4), '→ かかった:', e.running);
  if (!e.running || rms(crank) < 0.01) ng('始動しない');
}
// アクセルで回転数が上がる・ギア
{
  const e = started();
  const idle = run(e, 1);
  const rpmIdle = e.rpm;
  e.setParamById('throttle', 1);
  const rev = run(e, 1.5);
  console.log(`回転数 アイドル ${rpmIdle.toFixed(0)} → 全開 ${e.rpm.toFixed(0)}`);
  if (e.rpm < 6000 || rpmIdle > 1000) ng('回転数がおかしい');
  if (diff(idle, rev.subarray(0, idle.length)) < 0.01) ng('アクセルで音が変わらない');
  e.setParamById('gear', 3);
  run(e, 2);
  console.log('3 速 スピード', e.speed.toFixed(0), 'km/h');
  if (e.speed < 50) ng('スピードが出ない');
  if (bad(rev)) ng('異常値');
}
// 付属の音
const extras: [string, (e: VroomEngine) => void][] = [
  ['HORN', (e) => e.keyDown(V_HORN)],
  ['CRASH', (e) => e.keyDown(V_CRASH)],
  ['SIREN', (e) => e.setParamById('siren', 1)],
  ['ウインカー', (e) => e.setParamById('signal', 1)],
  ['ワイパー', (e) => e.setParamById('wipers', 1)],
  ['ラジオ FM1', (e) => e.setParamById('station', 1)],
  ['ラジオ FM2', (e) => e.setParamById('station', 2)],
  ['ラジオ AM', (e) => e.setParamById('station', 3)],
  ['TURBO', (e) => { e.setParamById('throttle', 0.6); e.setParamById('turbo', 1); }],
];
const quiet = (() => { const e = new VroomEngine(SR); e.powerOn(); return e; });
for (const [name, act] of extras) {
  const e = name === 'TURBO' ? started() : quiet();
  act(e);
  const o = run(e, 1.2);
  if (rms(o) < 0.005 || bad(o)) ng(`${name} が鳴らない (${rms(o)})`);
}
console.log('付属の音：確認');

// 改造パーツ（アイドル＋少しアクセル）
const base = (s: Partial<Record<VroomParamId, number>> = {}) => { const e = started(s); e.setParamById('throttle', 0.3); return run(e, 1.5); };
const clean = base();
const checks: [string, Partial<Record<VroomParamId, number>>][] = [
  ['FIRING ORDER 間引き', { cyl2: 0, cyl3: 0, cyl5: 0, cyl7: 0 }],
  ['CAM 5', { cam: 5, cyl3: 0 }],
  ['REDLINE（全開）', { redline: 1, throttle: 1 }],
  ['SPARK', { spark: 0.8 }],
  ['TURBO FB', { turboFbOn: 1, turboFb: 0.9 }],
  ['RADIO BLEED', { station: 1, radioBleed: 0.9 }],
  ['TUNE', { tune: 1, throttle: 0.37 }],
  ['CHASSIS', { chassis: 0.8 }],
  ['HAZARD', { hazard: 0.8 }],
];
for (const [name, s] of checks) {
  const e = started(s);
  e.setParamById('throttle', s.throttle ?? 0.3);
  const o = run(e, 1.5);
  const d = diff(o, clean);
  console.log(`${name.padEnd(18)} diff ${d.toFixed(4)} rms ${rms(o).toFixed(4)}`);
  if (bad(o)) ng(`${name} で異常値`);
  if (d < 0.003) ng(`${name} が効いていない`);
}
{
  const e = started();
  e.setParamById('starterLoop', 1);
  const o = run(e, 1);
  if (diff(o, run(started(), 1)) < 0.003) ng('STARTER LOOP が効いていない');
}
{
  const e = started({ grind: 1, throttle: 0.5 });
  run(e, 0.5);
  const a = run(e, 0.1);
  e.setParamById('gear', 2);
  const b = run(e, 0.3);
  if (rms(b) <= rms(a)) ng('GEAR GRIND が鳴らない');
}
// HIJACK：プリセットで音階（エンジンをかけていなくても鳴る）
{
  const e = new VroomEngine(SR); e.powerOn(); e.setParamById('hijack', 1);
  e.keyDown(V_PRESET + 4);
  const o = run(e, 0.6);
  if (rms(o) < 0.01) ng('HIJACK で鳴らない');
  e.keyUp(V_PRESET + 4);
  e.keyDown(V_NOTE + 24); // MIDI ノート 60
  if (rms(run(e, 0.5)) < 0.01) ng('MIDI ノートで鳴らない');
}
// 電源 OFF
{
  const e = started({ throttle: 0.5 });
  e.powerOff();
  run(e, 0.3);
  if (rms(run(e, 0.3)) > 0.001) ng('電源 OFF で音が残る');
}
{
  const e = started({ redline: 1, throttle: 1, spark: 1, turboFbOn: 1, turboFb: 1, radioBleed: 1, station: 2, chassis: 1, hazard: 1, grind: 1, gear: 5, siren: 1, turbo: 1 });
  const o = run(e, 2);
  if (bad(o)) ng('全部盛りで異常値');
  console.log('全部盛り rms', rms(o).toFixed(4));
}
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
