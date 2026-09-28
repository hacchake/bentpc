// 魔改造パーツの自動テスト：25 種のグリッチがすべて「違う音」になるか、LOOP/STRETCH/DIST が効くか。
import { Engine } from '../src/dsp/engine';
import { GLITCH_BASES, GLITCH_NAMES } from '../src/dsp/chip';

const SR = 48000;
function render(setup: (e: Engine) => void, sec = 1.5, during?: (e: Engine) => void, at = 20): Float32Array {
  const e = new Engine(SR);
  e.powerOn();
  const buf = new Float32Array(128);
  for (let i = 0; i < (SR * 3) / 128; i++) e.process(buf); // 起動待ち
  e.setParamById('mode', 7); // SAY（長い音声）
  for (let i = 0; i < (SR * 1) / 128; i++) e.process(buf);
  setup(e);
  e.keyDown(10); // K
  const out = new Float32Array(Math.floor((SR * sec) / 128) * 128);
  for (let i = 0; i < out.length / 128; i++) {
    if (i === at) during?.(e);
    e.process(buf);
    out.set(buf, i * 128);
  }
  return out;
}
const bad = (b: Float32Array) => b.some((x) => !Number.isFinite(x) || Math.abs(x) > 4);
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);
const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };

const clean = render(() => {});
console.log('clean rms', rms(clean).toFixed(4));
const outs: Float32Array[] = [];
let fail = 0;
for (let b = 0; b < 5; b++) for (let g = 0; g < 5; g++) {
  const o = render((e) => e.setParamById('base', b), 1.5, (e) => e.setParamById(`glitch${g + 1}` as 'glitch1', 1));
  const d = diff(o, clean);
  if (bad(o) || d < 0.002) { fail++; console.log('NG', GLITCH_BASES[b], GLITCH_NAMES[b][g], d); }
  outs.push(o);
  console.log(`${GLITCH_BASES[b]}-${g + 1} ${GLITCH_NAMES[b][g].padEnd(12)} rms ${rms(o).toFixed(4)} diff ${d.toFixed(4)}`);
}
// 25 種が互いに違うか
let minD = 1, pair = '';
for (let i = 0; i < 25; i++) for (let j = i + 1; j < 25; j++) { const d = diff(outs[i], outs[j]); if (d < minD) { minD = d; pair = `${i}-${j}`; } }
console.log('一番似ている組み合わせ', pair, minD.toFixed(4));
if (minD < 0.002) fail++;

const loop = render((e) => e.setParamById('loopSwitch', 0), 4);
console.log('LOOP 上: 4 秒後も鳴っている', rms(loop.subarray(-SR)).toFixed(4));
if (rms(loop.subarray(-SR)) < 0.005) fail++;
const hold = render(() => {}, 4, (e) => e.setParamById("loopHold", 1), 150);
console.log('LOOP HOLD: 4 秒後も鳴っている', rms(hold.subarray(-SR)).toFixed(4));
if (rms(hold.subarray(-SR)) < 0.005) fail++;
const stretch = render((e) => { e.setParamById('stretch', 1); e.setParamById('stretchHold', 0.8); }, 4);
const lenOf = (b: Float32Array) => { let l = 0; for (let i = 0; i < b.length; i++) if (Math.abs(b[i]) > 0.003) l = i; return l / SR; };
console.log('STRETCH: 長さ', lenOf(clean).toFixed(2), '→', lenOf(stretch).toFixed(2), '秒');
if (lenOf(stretch) < lenOf(clean) * 1.5) fail++;
for (const t of [0, 1]) {
  const d = render((e) => { e.setParamById('dist', 0.8); e.setParamById('distType', t); });
  console.log(`DIST type ${t}: diff ${diff(d, clean).toFixed(4)} bad=${bad(d)}`);
  if (bad(d) || diff(d, clean) < 0.005) fail++;
}
const muted = render((e) => e.setParamById('loopSwitch', 2));
console.log('LOOP 下(MUTE): rms', rms(muted).toFixed(5));
if (rms(muted) > 0.001) fail++;
console.log(fail ? `失敗 ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
