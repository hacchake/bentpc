// 6台目 TELEKEY の自動テスト（フェーズ1）：取り込んだ音が電源 ON のときだけ通る
import { TeleEngine } from '../src/toys/tele/dsp/engine';
const SR = 48000;
let fail = 0;
const e = new TeleEngine(SR);
const inp = new Float32Array(128).map((_, i) => Math.sin(i / 5) * 0.5);
const out = new Float32Array(128);
const peak = (b: Float32Array) => b.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
for (let i = 0; i < 100; i++) e.process(out, inp);
if (peak(out) > 0.001) { fail++; console.log('NG 電源 OFF で音が出る'); }
e.powerOn();
for (let i = 0; i < 400; i++) e.process(out, inp);
console.log('電源 ON の出力ピーク', peak(out).toFixed(3));
if (peak(out) < 0.2) { fail++; console.log('NG 取り込んだ音が通らない'); }
e.process(out);
if (out.some((x) => !Number.isFinite(x))) { fail++; console.log('NG 入力なしで異常値'); }
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
