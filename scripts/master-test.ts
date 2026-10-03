// マスター（仕上げ）の検査：割れない・小さい音はほぼそのまま・左右に広がる・遅れは決まった分だけ・止めたら静かになる
import { MasterBus } from '../src/host/master';
import { pulseBL, sawBL } from '../src/core/blep';

const SR = 48000;
let fails = 0;
const ng = (m: string) => { fails++; console.log('NG', m); };
const ok = (m: string) => console.log('OK', m);
function run(x: Float32Array, m = new MasterBus(SR)): [Float32Array, Float32Array] {
  const L = new Float32Array(x.length), R = new Float32Array(x.length);
  for (let o = 0; o < x.length; o += 128) m.process(x.subarray(o, o + 128), L.subarray(o, o + 128), R.subarray(o, o + 128));
  return [L, R];
}
const rms = (a: Float32Array, s = 0, e = a.length) => { let q = 0; for (let i = s; i < e; i++) q += a[i] * a[i]; return Math.sqrt(q / (e - s)); };
const sine = (sec: number, hz: number, amp: number) => Float32Array.from({ length: Math.round(SR * sec) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR) * amp);

// 大きすぎる音（4 倍）でも -0.8dB を超えない
{
  const [L, R] = run(sine(2, 80, 4));
  let pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  pk <= 0.913 ? ok(`割れない：4 倍の音でも最大 ${pk.toFixed(3)}`) : ng(`最大 ${pk}`);
}
// 小さめの音はほぼそのまま（±3dB）
{
  const x = sine(2, 440, 0.1), [L] = run(x);
  const d = 20 * Math.log10(rms(L, SR, SR * 2) / rms(x, SR, SR * 2));
  Math.abs(d) < 3 ? ok(`小さい音はほぼそのまま（${d.toFixed(1)}dB）`) : ng(`小さい音 ${d}dB`);
}
// 左右に広がる（響き）・止めたら 1 秒で静かになる
{
  const x = new Float32Array(SR * 3);
  x.set(sine(1, 600, 0.3));
  const [L, R] = run(x);
  const side = Float32Array.from(L, (v, i) => (v - R[i]) / 2);
  const s = rms(side, SR / 2, SR), tail = rms(L, SR * 2, SR * 3);
  s > 0.003 && tail < 1e-4 ? ok(`左右に広がる（左右の差 ${s.toFixed(4)}）・止めたら静か（${tail.toExponential(1)}）`) : ng(`広がり ${s} 余韻 ${tail}`);
}
// 遅れ：インパルスが latency サンプル後に出る
{
  const m = new MasterBus(SR, { reverb: 0 });
  const x = new Float32Array(1024);
  x[100] = 0.5;
  const [L] = run(x, m);
  let at = -1, pk = 0;
  for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > pk) { pk = Math.abs(L[i]); at = i; }
  at === 100 + m.latency ? ok(`遅れは ${m.latency} サンプル（${((m.latency / SR) * 1000).toFixed(1)}ms）ぴったり`) : ng(`遅れ ${at - 100} / ${m.latency}`);
}
// 折り返しの少ない波形：形はそのまま（±1 に収まる・平均 0）
{
  let mx = 0, sum = 0;
  let ph = 0;
  for (let i = 0; i < SR; i++) { const a = sawBL(ph, 0.05), b = pulseBL(ph, 0.05, 0.3); mx = Math.max(mx, Math.abs(a), Math.abs(b)); sum += a; ph = (ph + 0.05) % 1; }
  mx <= 1.0001 && Math.abs(sum / SR) < 0.01 ? ok('帯域制限ののこぎり・矩形波：±1 に収まる') : ng(`BLEP ${mx} ${sum / SR}`);
}
console.log(fails ? `NG ${fails} 個` : 'すべて OK');
process.exit(fails ? 1 : 0);
