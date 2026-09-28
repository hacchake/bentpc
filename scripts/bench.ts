// 処理速度の目安：2 台を同時に 10 秒ぶん動かすのに何秒かかるか
import { Engine } from '../src/toys/blippy/dsp/engine';
import { PikoEngine } from '../src/toys/piko/dsp/engine';
const SR = 48000;
const a = new Engine(SR), b = new PikoEngine(SR);
a.powerOn(); b.powerOn();
b.setParamById('feedback', 0.6); b.setParamById('dist', 0.5); b.setParamById('fizz', 0.4); b.setParamById('hipass', 0.3); b.setParamById('cpuPower', 0.5);
b.setParamById('envHold', 1);
for (let k = 0; k < 8; k++) b.keyDown(k * 3);
b.keyDown(37);
a.setParamById('mode', 7); a.setParamById('glitch1', 1); a.setParamById('glitch2', 1);
const buf = new Float32Array(128);
const t0 = performance.now();
for (let i = 0; i < (SR * 10) / 128; i++) { if (i % 300 === 0) a.keyDown(10); a.process(buf); b.process(buf); }
const sec = (performance.now() - t0) / 1000;
console.log(`10 秒ぶんの処理に ${sec.toFixed(2)} 秒（負荷 ${((sec / 10) * 100).toFixed(1)}%）`);
