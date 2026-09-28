// マイク取り込みの変換テスト：48kHz の「声っぽい音」を 8kHz・8bit にできるか
import { toChipSample } from '../src/toys/blippy/dsp/mic';
const SR = 48000;
const raw = new Float32Array(SR * 2);
for (let i = SR * 0.3; i < SR * 1.2; i++) raw[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR);
const s = toChipSample(raw, SR);
console.log('長さ', s ? (s.length / 8000).toFixed(2) + '秒' : 'null', '無音→', toChipSample(new Float32Array(SR), SR));
process.exit(s && s.length > 6000 && s.length < 9000 ? 0 : 1);
