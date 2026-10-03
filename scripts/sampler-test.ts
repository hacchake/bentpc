// サンプラー（PAKU-PAKU 16）の音の中心の検査：鳴る・GATE・LOOP・REV・ミュートグループ・POLY・音程・フィルター・録音・工場出荷の音
import { mkdirSync, writeFileSync } from 'node:fs';
import { SamplerEngine } from '../src/sampler/dsp/engine';
import { factoryBank, factoryParams } from '../src/sampler/dsp/factory';
import { defaultPad, type SampleBuf } from '../src/sampler/dsp/types';

const SR = 48000;
const B = 128;
let fails = 0;
const ng = (m: string) => { fails++; console.log('NG', m); };
const ok = (m: string) => console.log('OK', m);

/** sec 秒ぶん鳴らして、左右を返す */
function run(e: SamplerEngine, sec: number, input?: Float32Array): [Float32Array, Float32Array] {
  const n = Math.ceil((sec * SR) / B) * B;
  const L = new Float32Array(n), R = new Float32Array(n);
  const l = new Float32Array(B), r = new Float32Array(B);
  for (let o = 0; o < n; o += B) {
    const inp = input ? input.subarray(o, o + B) : null;
    e.process(inp && inp.length === B ? inp : null, null, l, r);
    L.set(l, o); R.set(r, o);
  }
  return [L, R];
}
const rms = (x: Float32Array, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const at = (sec: number) => Math.round(sec * SR);

/** 1 秒の 440Hz（左右同じ） */
const tone = (sec = 1, hz = 440): SampleBuf => {
  const x = new Float32Array(Math.round(sec * 44100));
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * hz * i) / 44100) * 0.5;
  return { sr: 44100, ch: [x] };
};
/** ゼロ交差の数から周波数 */
const freq = (x: Float32Array, a: number, b: number) => { let z = 0; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) z++; return (z * SR) / (b - a); };

// ---- ふつうに鳴る（ワンショット）：1 秒で終わる ----
{
  const e = new SamplerEngine(SR);
  e.setSample(0, tone());
  e.trigger(0, 1);
  const [L] = run(e, 1.5);
  const a = rms(L, at(0.1), at(0.9)), b = rms(L, at(1.1), at(1.4));
  a > 0.1 && b < 1e-4 ? ok(`ワンショット（鳴る ${a.toFixed(3)}・終わる ${b.toExponential(1)}）`) : ng(`ワンショット ${a} ${b}`);
  const f = freq(L, at(0.1), at(0.9));
  Math.abs(f - 440) < 5 ? ok(`音程そのまま（${f.toFixed(1)}Hz、サンプルのレート違いも直る）`) : ng(`音程 ${f}`);
}
// ---- 音程 +12 ----
{
  const e = new SamplerEngine(SR);
  e.setSample(0, tone());
  e.setParams(0, { ...defaultPad(), pitch: 12 });
  e.trigger(0, 1);
  const [L] = run(e, 0.4);
  const f = freq(L, at(0.05), at(0.35));
  Math.abs(f - 880) < 8 ? ok(`PITCH +12 → ${f.toFixed(1)}Hz`) : ng(`PITCH ${f}`);
}
// ---- GATE：離すと止まる ----
{
  const e = new SamplerEngine(SR);
  e.setSample(0, tone(2));
  e.setParams(0, { ...defaultPad(), gate: true, release: 0 });
  e.trigger(0, 1);
  run(e, 0.3);
  e.releasePad(0);
  const [L] = run(e, 0.3);
  rms(L, at(0.05), at(0.3)) < 1e-4 ? ok('GATE：離すと止まる') : ng('GATE が止まらない');
}
// ---- LOOP（GATE なし）：終わりを越えても鳴り続け、もう一度押すと止まる ----
{
  const e = new SamplerEngine(SR);
  e.setSample(0, tone(0.3));
  e.setParams(0, { ...defaultPad(), loop: true, release: 0 });
  e.trigger(0, 1);
  const [L] = run(e, 1.2);
  rms(L, at(0.8), at(1.2)) > 0.1 ? ok('LOOP：くり返す') : ng('LOOP が鳴り続けない');
  e.trigger(0, 1);
  const [L2] = run(e, 0.3);
  rms(L2, at(0.1), at(0.3)) < 1e-4 ? ok('LOOP：もう一度押すと止まる') : ng('LOOP が止まらない');
}
// ---- REV：逆再生（後ろが大きい音を、頭から大きく鳴らす） ----
{
  const x = new Float32Array(44100);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 0.05) * (i / x.length);
  const e = new SamplerEngine(SR);
  e.setSample(0, { sr: 44100, ch: [x] });
  e.setParams(0, { ...defaultPad(), reverse: true });
  e.trigger(0, 1);
  const [L] = run(e, 1);
  rms(L, 0, at(0.2)) > rms(L, at(0.7), at(0.9)) * 2 ? ok('REV：逆に鳴る') : ng('REV');
}
// ---- ミュートグループ：同じグループの後の音が前を止める ----
{
  const e = new SamplerEngine(SR);
  e.setSample(0, tone(2, 440));
  e.setSample(1, tone(0.05, 660));
  e.setParams(0, { ...defaultPad(), mute: 1 });
  e.setParams(1, { ...defaultPad(), mute: 1 });
  e.trigger(0, 1);
  run(e, 0.2);
  e.trigger(1, 1);
  const [L] = run(e, 0.5);
  rms(L, at(0.2), at(0.5)) < 1e-4 ? ok('MUTE GRP：オープンハイハットが止まる') : ng('MUTE GRP');
}
// ---- POLY：オフなら押し直しで 1 つ、オンなら重なる ----
{
  const count = (poly: boolean) => {
    const e = new SamplerEngine(SR);
    e.setSample(0, tone(2));
    e.setParams(0, { ...defaultPad(), poly });
    e.trigger(0, 1); run(e, 0.1); e.trigger(0, 1); run(e, 0.1);
    return e.playing().length;
  };
  count(false) === 1 && count(true) === 2 ? ok('POLY：オフ 1 音・オン 2 音') : ng(`POLY ${count(false)} ${count(true)}`);
}
// ---- ベロシティ・フィルター ----
{
  const lvl = (vel: number, cutoff = 1) => {
    const e = new SamplerEngine(SR);
    e.setSample(0, tone(1, 3000));
    e.setParams(0, { ...defaultPad(), cutoff });
    e.trigger(0, vel);
    const [L] = run(e, 0.5);
    return rms(L, at(0.1), at(0.4));
  };
  lvl(0.3) < lvl(1) * 0.7 ? ok('ベロシティ：弱く押すと小さい') : ng('ベロシティ');
  lvl(1, 0.4) < lvl(1) * 0.3 ? ok('CUTOFF：高い音が削れる') : ng('CUTOFF');
}
// ---- 録音：入力 → 止めると音になる。AUTO は音が来るまで待つ ----
{
  const e = new SamplerEngine(SR);
  const inp = new Float32Array(SR);
  for (let i = at(0.5); i < SR; i++) inp[i] = Math.sin(i * 0.1) * 0.5;
  e.recStart('input', true);
  run(e, 1, inp);
  const s = e.recStop();
  s && Math.abs(s.ch[0].length / SR - 0.5) < 0.02 ? ok(`録音（AUTO）：音が来てから ${(s.ch[0].length / SR).toFixed(2)} 秒`) : ng(`録音 ${s?.ch[0].length}`);
  // リサンプル
  e.setSample(3, s);
  e.recStart('output', false);
  e.trigger(3, 1);
  run(e, 0.6);
  const r = e.recStop();
  r && rms(r.ch[0]) > 0.05 ? ok('RESAMPLE：出している音を録れる') : ng('RESAMPLE');
}
// ---- 工場出荷の音：全部鳴る・大きすぎない ----
{
  mkdirSync('out', { recursive: true });
  for (const b of [0, 1] as const) {
    const bank = factoryBank(b);
    const quiet: string[] = [];
    for (const s of bank) {
      let peak = 0;
      for (const v of s.buf.ch[0]) peak = Math.max(peak, Math.abs(v));
      if (!(peak > 0.3 && peak <= 1)) quiet.push(`${s.name}(${peak.toFixed(2)})`);
    }
    quiet.length ? ng(`バンク ${'AB'[b]} の音量がおかしい：${quiet.join(' ')}`) : ok(`バンク ${'AB'[b]} の 16 音（${bank.map((s) => s.name).join(' / ')}）`);
    // 全部を順に鳴らして WAV に
    const e = new SamplerEngine(SR);
    bank.forEach((s, i) => { e.setSample(i, s.buf); e.setParams(i, factoryParams(s)); });
    const out: Float32Array[] = [];
    for (let i = 0; i < 16; i++) { e.trigger(i, 1); const [L] = run(e, 0.45); out.push(L); e.releasePad(i); e.stopAll(); }
    const all = new Float32Array(out.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of out) { all.set(x, o); o += x.length; }
    writeFileSync(`out/sampler-bank${'AB'[b]}.raw`, Buffer.from(all.buffer));
  }
  // 決まった音（シード付き）
  JSON.stringify(Array.from(factoryBank(0)[1].buf.ch[0].slice(0, 50))) === JSON.stringify(Array.from(factoryBank(0)[1].buf.ch[0].slice(0, 50)))
    ? ok('工場出荷の音はいつも同じ') : ng('工場出荷の音が毎回違う');
}
// ---- 32 音を超えても落ちない ----
{
  const e = new SamplerEngine(SR);
  e.setSample(0, tone(2));
  e.setParams(0, { ...defaultPad(), poly: true });
  for (let i = 0; i < 50; i++) e.trigger(0, 1);
  const [L] = run(e, 0.2);
  e.playing().length <= 32 && L.every((v) => Number.isFinite(v) && Math.abs(v) <= 1) ? ok('50 回連打：32 音まで・音割れなし') : ng('ボイスの取り合い');
}

console.log(fails ? `失敗 ${fails} 件` : 'すべて OK');
process.exit(fails ? 1 : 0);
