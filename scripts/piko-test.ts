// 2台目 PIKOTONE の自動テスト：全鍵・全音色・全リズム・デモ・改造パーツが効くか、壊れた値が出ないか。
import { writeFileSync, mkdirSync } from 'node:fs';
import { PikoEngine } from '../src/toys/piko/dsp/engine';
import { INSTRUMENTS, KEY_DEMO, KEY_START, PAD_KEY, PIKO_NOTE_COUNT, RHYTHMS, type PikoParamId } from '../src/toys/piko/params';

const SR = 48000;
let fail = 0;
const ng = (msg: string) => { fail++; console.log('NG', msg); };
const bad = (b: Float32Array) => b.some((x) => !Number.isFinite(x) || Math.abs(x) > 1.01);
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);
const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };

function run(e: PikoEngine, sec: number): Float32Array {
  const out = new Float32Array(Math.floor((SR * sec) / 128) * 128);
  const buf = new Float32Array(128);
  for (let i = 0; i < out.length / 128; i++) { e.process(buf); out.set(buf, i * 128); }
  return out;
}
function fresh(setup: Partial<Record<PikoParamId, number>> = {}): PikoEngine {
  const e = new PikoEngine(SR);
  for (const [k, v] of Object.entries(setup)) e.setParamById(k as PikoParamId, v);
  e.powerOn();
  run(e, 0.3);
  return e;
}
/** 和音を 1 秒鳴らす */
function chord(setup: Partial<Record<PikoParamId, number>> = {}, sec = 1): Float32Array {
  const e = fresh(setup);
  for (const k of [7, 11, 14]) e.keyDown(k);
  return run(e, sec);
}

// ---- 全鍵 × 全音色 ----
for (let inst = 0; inst < 8; inst++) {
  const e = fresh({ instrument: inst });
  const silent: number[] = [];
  for (let k = 0; k < PIKO_NOTE_COUNT; k++) {
    e.keyDown(k);
    const o = run(e, 0.15);
    e.keyUp(k);
    if (rms(o) < 0.005) silent.push(k);
    if (bad(o)) ng(`${INSTRUMENTS[inst]} 鍵 ${k} で異常値`);
  }
  run(e, 0.5);
  if (silent.length) ng(`${INSTRUMENTS[inst]} 無音の鍵: ${silent.join(' ')}`);
}
console.log('全鍵 × 全音色：確認');

// ---- 全リズム・パッド・デモ ----
for (let r = 0; r < 8; r++) {
  const e = fresh({ rhythm: r });
  e.keyDown(KEY_START);
  const o = run(e, 2);
  if (rms(o) < 0.01 || bad(o)) ng(`リズム ${RHYTHMS[r]} rms ${rms(o)}`);
}
for (let p = 0; p < 4; p++) {
  const e = fresh();
  e.keyDown(PAD_KEY + p);
  if (rms(run(e, 0.3)) < 0.005) ng(`パッド ${p} が鳴らない`);
}
{
  const e = fresh();
  e.keyDown(KEY_DEMO);
  const o = run(e, 6);
  if (rms(o) < 0.02 || bad(o)) ng('デモが鳴らない');
  mkdirSync('out', { recursive: true });
  writeWav('out/piko-demo.wav', o);
}
console.log('リズム・パッド・デモ：確認');

// ---- 改造パーツが効くか（和音との違い） ----
const clean = chord();
const checks: [string, Partial<Record<PikoParamId, number>>][] = [
  ['AMP POWER 下げ', { ampPower: 0.2 }],
  ['CPU POWER 下げ', { cpuPower: 0.15 }],
  ['AMP TOUCH 1', { ampTouch1: 0.8 }],
  ['AMP TOUCH 2', { ampTouch2: 0.8 }],
  ['AMP TOUCH 3', { ampTouch3: 0.8 }],
  ['PITCH BEND 1', { bendTouch1: 0.8 }],
  ['PITCH BEND 2', { bendTouch2: 0.8 }],
  ['PITCH BEND 3', { bendTouch3: 0.8 }],
  ['PITCH（ON・高め）', { pitchOn: 1, pitch: 0.85 }],
  ['ENV LEN 短く', { envLen: 0, instrument: 2 }],
  ['DIST', { dist: 0.8 }],
  ['FIZZ', { fizz: 0.8 }],
  ['HIPASS', { hipass: 0.7 }],
  ['HIPASS RESO', { hipass: 0.6, hipassMode: 1 }],
  ['FEEDBACK SHORT', { feedback: 0.9 }],
  ['FEEDBACK LONG', { feedback: 0.9, feedbackMode: 1 }],
  ['INST HOLD 1+3', { instHold1: 1, instHold3: 1, instrument: 6 }],
  ['VIBRATO', { vibrato: 1 }],
];
for (const [name, s] of checks) {
  const o = chord(s);
  const d = diff(o, clean);
  console.log(`${name.padEnd(18)} diff ${d.toFixed(4)} rms ${rms(o).toFixed(4)}`);
  if (bad(o)) ng(`${name} で異常値`);
  if (d < 0.003) ng(`${name} が効いていない`);
}
// HOLD：離しても鳴り続ける
{
  const e = fresh({ envHold: 1, instrument: 2 });
  e.keyDown(7); run(e, 0.1); e.keyUp(7);
  if (rms(run(e, 3).subarray(-SR)) < 0.01) ng('ENV HOLD で音が伸びない');
}
// GLITCH：スネアが発振する
{
  const a = fresh({ rhythm: 3 }); a.keyDown(KEY_START);
  const b = fresh({ rhythm: 3, glitch: 1 }); b.keyDown(KEY_START);
  const d = diff(run(a, 2), run(b, 2));
  console.log('GLITCH（リズム）diff', d.toFixed(4));
  if (d < 0.01) ng('GLITCH が効いていない');
}
// 電源 OFF で無音
{
  const e = fresh(); e.keyDown(7); e.powerOff();
  if (rms(run(e, 0.5).subarray(-SR / 4)) > 0.001) ng('電源 OFF で音が残る');
}
// 全部盛りでも壊れない
{
  const o = chord({ ampPower: 0, cpuPower: 0, dist: 1, fizz: 1, hipass: 1, hipassMode: 1, feedback: 1, ampTouch1: 1, ampTouch2: 1, ampTouch3: 1, bendTouch3: 1, glitch: 1, instHold2: 1, instHold5: 1 }, 3);
  if (bad(o)) ng('全部盛りで異常値');
  console.log('全部盛り rms', rms(o).toFixed(4));
}
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);

function writeWav(path: string, data: Float32Array) {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
  data.forEach((x, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2));
  writeFileSync(path, b);
}
