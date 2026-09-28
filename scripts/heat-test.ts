// 「熱」のテスト：押し続けると暴発が増え、離すと冷めるか。固まらないか。
import { Engine } from '../src/dsp/engine';

const SR = 48000;
const e = new Engine(SR);
const buf = new Float32Array(128);
const run = (sec: number) => { let bursts = 0, prev = 0; for (let i = 0; i < (SR * sec) / 128; i++) { e.process(buf); if (e.heat.forced && !prev) bursts++; prev = e.heat.forced; } return bursts; };
e.powerOn(); run(3);
e.setParamById('mode', 7);
let fail = 0;
for (const n of [1, 2, 3]) {
  e.keyDown(10);
  for (let g = 1; g <= n; g++) e.setParamById(`glitch${g}` as 'glitch1', 1);
  let t = 0, first = -1, bursts = 0;
  while (t < 20) { const b = run(0.5); bursts += b; t += 0.5; if (b && first < 0) first = t; }
  console.log(`GLITCH ${n}個 押しっぱなし20秒: 熱 ${e.heat.value.toFixed(2)} / 暴発開始 ${first}s / 暴発 ${bursts}回`);
  for (let g = 1; g <= n; g++) e.setParamById(`glitch${g}` as 'glitch1', 0);
  let cool = 0; while (e.heat.value > 0.4 && cool < 30) { run(0.5); cool += 0.5; }
  console.log(`  離して暴発が止まるまで ${cool}s`);
  run(12);
  e.keyDown(10); run(0.2);
  if (!e.chip.playing) { console.log('  NG: 冷めた後キーで鳴らない'); fail++; }
}
console.log(fail ? `失敗 ${fail}` : 'すべて OK');
process.exit(fail ? 1 : 0);
