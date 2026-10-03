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

// ================= フェーズ2 =================
// ---- LOOP の戻り先：2 周目からは loopStart から ----
{
  const x = new Float32Array(44100);
  for (let i = 0; i < x.length; i++) x[i] = i < 22050 ? 0.8 : 0; // 前半だけ音
  const e = new SamplerEngine(SR);
  e.setSample(0, { sr: 44100, ch: [x] });
  e.setParams(0, { ...defaultPad(), loop: true, loopStart: 0.5 });
  e.trigger(0, 1);
  const [L] = run(e, 2.5);
  rms(L, at(0.1), at(0.4)) > 0.3 && rms(L, at(1.3), at(2.4)) < 1e-3 ? ok('LOOP の戻り先（2 周目からは後半だけ）') : ng('LOOP の戻り先');
}
// ---- ロール：1/16 で 120BPM → 0.125 秒ごと ----
{
  const click = new Float32Array(441); click.fill(0.9);
  const e = new SamplerEngine(SR);
  e.bpm = 120;
  e.setSample(0, { sr: 44100, ch: [click] });
  e.setParams(0, { ...defaultPad(), poly: true });
  e.setRoll(true, 0.25);
  e.trigger(0, 1);
  const [L] = run(e, 1.01);
  e.releasePad(0);
  const [L2] = run(e, 0.5);
  const onsets: number[] = [];
  for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > 0.2 && (i === 0 || Math.abs(L[i - 1]) < 0.01)) onsets.push(i / SR);
  const even = onsets.length >= 8 && onsets.every((t, i) => Math.abs(t - i * 0.125) < 0.002);
  even && rms(L2, at(0.1), at(0.5)) < 1e-4 ? ok(`ROLL 1/16：${onsets.length} 回・0.125 秒ごとぴったり・離すと止まる`) : ng(`ROLL ${onsets.map((t) => t.toFixed(3)).join(' ')}`);
}
// ---- 16 レベル（音程を足す） ----
{
  const e = new SamplerEngine(SR);
  e.setSample(0, tone());
  e.trigger(0, 1, { pitch: 7 });
  const [L] = run(e, 0.4);
  const f = freq(L, at(0.05), at(0.35));
  Math.abs(f - 440 * Math.pow(2, 7 / 12)) < 8 ? ok(`16 LEVELS PITCH +7 → ${f.toFixed(1)}Hz`) : ng(`16 LEVELS ${f}`);
}
// ---- 編集：ノーマライズ・切り詰め・チョップ・ストレッチ・BPM ----
{
  const { normalize, trim, equalMarks, onsetMarks, slice, stretch, estimateBpm } = await import('../src/sampler/dsp/edit');
  const t = tone(1);
  const nrm = normalize(t);
  Math.abs(Math.max(...nrm.ch[0]) - 0.98) < 0.01 ? ok('NORMALIZE') : ng('NORMALIZE');
  Math.abs(trim(t, 0.25, 0.75).ch[0].length - 22050) < 3 ? ok('TRIM') : ng('TRIM');
  slice(t, equalMarks(8)).length === 8 ? ok('CHOP 等分 8') : ng('CHOP 等分');
  const loop = factoryBank(1)[0].buf; // 90 BPM・2 小節のビート（キック・スネアが 11 発 ＋ ハット）
  const om = onsetMarks(loop, 0.5, 16);
  om.length >= 6 && om.length <= 15 ? ok(`CHOP AUTO：ビートから ${om.length + 1} 切れ`) : ng(`CHOP AUTO ${om.length}`);
  const bpm = estimateBpm(loop);
  Math.abs(bpm - 90) < 1 ? ok(`BPM の推定：${bpm}（正解 90）`) : ng(`BPM の推定 ${bpm}`);
  const st = stretch(tone(1), 1.5);
  const e = new SamplerEngine(SR);
  e.setSample(0, st);
  e.trigger(0, 1);
  const [L] = run(e, 1.6);
  const f = freq(L, at(0.2), at(1.3));
  Math.abs(st.ch[0].length / 44100 - 1.5) < 0.01 && Math.abs(f - 440) < 6 ? ok(`STRETCH ×1.5：長さ ${(st.ch[0].length / 44100).toFixed(2)} 秒・音程 ${f.toFixed(1)}Hz のまま`) : ng(`STRETCH ${st.ch[0].length} ${f}`);
}

console.log(fails ? `失敗 ${fails} 件` : 'すべて OK');
process.exit(fails ? 1 : 0);
