// エンジンの自動テスト：全モード・全キーを押して、音が出るか／NaN が出ないかを確かめる。
// あわせて各モードの音を WAV に書き出す（out/ フォルダ）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { Engine } from '../src/dsp/engine';
import { MODE_NAMES } from '../src/params';

const SR = 48000;
const e = new Engine(SR);
const buf = new Float32Array(128);
let nan = 0;
const rec: number[] = [];
const run = (sec: number) => {
  let p = 0;
  for (let b = 0; b < (SR * sec) / 128; b++) {
    e.process(buf);
    for (const x of buf) {
      if (Number.isNaN(x)) nan++;
      p = Math.max(p, Math.abs(x));
      rec.push(x);
    }
  }
  return p;
};

e.powerOn();
console.log('boot peak', run(2.5).toFixed(3), e.display.screen);
mkdirSync('out', { recursive: true });
for (let m = 0; m < 8; m++) {
  rec.length = 0;
  e.setParamById('mode', m);
  run(0.8);
  const silent: string[] = [];
  for (let k = 0; k < 40; k++) {
    e.keyDown(k);
    const p = run(m === 4 && k >= 26 ? 2.2 : 1.2);
    if (p < 0.01) silent.push(String(k));
  }
  console.log(`mode ${m} ${MODE_NAMES[m]}: silent keys = ${silent.join(' ')}`);
  writeWav(`out/mode${m}-${MODE_NAMES[m]}.wav`, rec);
}
console.log('NaN count', nan);

function writeWav(path: string, data: number[]) {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
  data.forEach((x, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2));
  writeFileSync(path, b);
}
