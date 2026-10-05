// サンプラー（PAKU-PAKU 16）の音の中心の検査：鳴る・GATE・LOOP・REV・ミュートグループ・POLY・音程・フィルター・録音・工場出荷の音
import { mkdirSync, writeFileSync } from 'node:fs';
import { SamplerEngine } from '../src/sampler/dsp/engine';
import { FACTORY_BANKS, factoryBank, factoryParams, factorySound } from '../src/sampler/dsp/factory';
import { ROOTS } from '../src/sampler/dsp/factory2';
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
  for (let b = 0; b < FACTORY_BANKS; b++) {
    const bank = factoryBank(b);
    const quiet: string[] = [];
    for (const s of bank) {
      let peak = 0;
      for (const v of s.buf.ch[0]) peak = Number.isFinite(v) ? Math.max(peak, Math.abs(v)) : 99;
      if (!(peak > 0.3 && peak <= 1) || rms(s.buf.ch[0]) < 0.005) quiet.push(`${s.name}(${peak.toFixed(2)})`);
    }
    const L = 'ABCDEFG'[b];
    bank.length === 16 && !quiet.length ? ok(`バンク ${L} の 16 音（${bank.map((s) => s.name).join(' / ')}）`) : ng(`バンク ${L} の音量がおかしい：${quiet.join(' ')}`);
    // 全部を順に鳴らして WAV に
    const e = new SamplerEngine(SR);
    bank.forEach((s, i) => { e.setSample(i, s.buf); e.setParams(i, factoryParams(s)); });
    const out: Float32Array[] = [];
    for (let i = 0; i < 16; i++) { e.trigger(i, 1); const [L] = run(e, 0.45); out.push(L); e.releasePad(i); e.stopAll(); }
    const all = new Float32Array(out.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of out) { all.set(x, o); o += x.length; }
    writeFileSync(`out/sampler-bank${L}.raw`, Buffer.from(all.buffer));
  }
  // 1 音ずつ作っても（画面の液晶用）、まとめて作ったのと同じ音
  const same = [40, 77, 111].every((pad) => JSON.stringify(Array.from(factorySound(pad)!.buf.ch[0].slice(0, 400))) === JSON.stringify(Array.from(factoryBank(Math.floor(pad / 16))[pad % 16].buf.ch[0].slice(0, 400))));
  same ? ok('1 音ずつ作っても同じ音') : ng('1 音ずつ作ると違う音になる');
  // 頭と終わりがなめらか（プチッと鳴らない）
  const clicky: string[] = [];
  for (let b = 0; b < FACTORY_BANKS; b++) factoryBank(b).forEach((s) => { for (const x of s.buf.ch) if (Math.abs(x[0]) > 1e-6 || Math.abs(x[x.length - 1]) > 1e-6) clicky.push(s.name); });
  clicky.length ? ng(`頭か終わりが切れている：${clicky.join(' ')}`) : ok('工場出荷の音は、頭も終わりもなめらか（プチッと鳴らない）');
  // 音程のある楽器は、書いてある高さで鳴る（自己相関。オクターブ違いは許す）
  const off: string[] = [];
  for (const [ps, root] of Object.entries(ROOTS)) {
    const pad = Number(ps), x = factorySound(pad)!.buf.ch[0], f0 = 440 * Math.pow(2, (root - 69) / 12), o0 = 11025, N = 4096;
    let best = 0, lag0 = 0;
    for (let lag = Math.floor(44100 / (f0 * 2.2)); lag < 44100 / (f0 / 2.2); lag++) {
      let c = 0, e1 = 0, e2 = 0;
      for (let i = 0; i < N; i++) { c += x[o0 + i] * x[o0 + i + lag]; e1 += x[o0 + i] ** 2; e2 += x[o0 + i + lag] ** 2; }
      c /= Math.sqrt(e1 * e2) + 1e-9;
      if (c > best) { best = c; lag0 = lag; }
    }
    const cents = 1200 * Math.log2(44100 / lag0 / f0), fold = Math.abs(((cents % 1200) + 1800) % 1200 - 600);
    if (fold > 40) off.push(`${pad}(${cents.toFixed(0)})`);
  }
  off.length ? ng(`音程がずれている：${off.join(' ')}`) : ok(`音程のある ${Object.keys(ROOTS).length} 音は、書いてある高さで鳴る`);
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

// ================= フェーズ3 =================
{
  const { FX_LIST } = await import('../src/sampler/dsp/fx');
  const loopBuf = factoryBank(1)[0].buf;
  const bad: string[] = [];
  let worst = 0;
  for (const [i, d] of FX_LIST.entries()) {
    const k = [...d.def];
    if (d.id === 'looper' || d.id === 'tapestop') k[1] = 1; // 押しっぱなしの状態で試す
    if (d.id === 'scatter') k[1] = 1;
    if (d.id === 'isolator') k[0] = 0; // 初期値は素通しなので、低音を消して試す
    if (d.id === 'eq') { k[0] = 0.9; k[2] = 0.1; }
    const mk = (on: boolean) => {
      const e = new SamplerEngine(SR);
      e.bpm = 90;
      e.setSample(0, loopBuf);
      e.setParams(0, { ...defaultPad(), loop: true, bus: 1 });
      e.setFx(0, { type: i, on, k });
      e.trigger(0, 1);
      return e;
    };
    const t0 = performance.now();
    const [a] = run(mk(true), 2);
    worst = Math.max(worst, (performance.now() - t0) / 2000);
    const [b] = run(mk(false), 2);
    let diff = 0, finite = true, peak = 0;
    for (let j = 0; j < a.length; j++) { diff += Math.abs(a[j] - b[j]); if (!Number.isFinite(a[j])) finite = false; peak = Math.max(peak, Math.abs(a[j])); }
    diff /= a.length;
    if (!finite || diff < 1e-4 || rms(a) < 0.005) bad.push(`${d.name}(差 ${diff.toExponential(1)}・音量 ${rms(a).toFixed(3)})`);
  }
  bad.length ? ng(`エフェクトがおかしい：${bad.join(' ')}`) : ok(`エフェクト ${FX_LIST.length} 種：どれも音が変わる・壊れない（いちばん重いもので 1 秒あたり ${(worst * 1000).toFixed(1)}ms）`);
  // 置き場所：BUS 2 に送ったパッドは BUS 1 のエフェクトを通らない
  {
    const e = new SamplerEngine(SR);
    e.setSample(0, tone());
    e.setParams(0, { ...defaultPad(), bus: 2 });
    e.setFx(0, { type: 1, on: true, k: [0, 0, 0, 1] }); // BUS 1 の ISOLATOR で全部消す
    e.trigger(0, 1);
    const [L] = run(e, 0.3);
    rms(L, at(0.05), at(0.25)) > 0.1 ? ok('送り先：BUS 2 のパッドは BUS 1 のエフェクトを通らない') : ng('送り先');
  }
  // ベンド：全部つなぐと音が変わり、熱がたまり、外すと冷める
  {
    const e = new SamplerEngine(SR);
    e.setSample(0, loopBuf);
    e.setParams(0, { ...defaultPad(), loop: true });
    e.bender.st = { wires: [true, true, true, true, true, true], amount: 0.8, speed: 0.8 };
    e.trigger(0, 1);
    const [L] = run(e, 6);
    const hot = e.bender.heat;
    const finite = L.every((v) => Number.isFinite(v) && Math.abs(v) <= 1);
    e.bender.st = { ...e.bender.st, wires: [false, false, false, false, false, false] };
    run(e, 8);
    const ref = new SamplerEngine(SR);
    ref.setSample(0, loopBuf);
    ref.setParams(0, { ...defaultPad(), loop: true });
    ref.trigger(0, 1);
    const [R] = run(ref, 6);
    let diff = 0;
    for (let j = 0; j < L.length; j++) diff += Math.abs(L[j] - R[j]);
    finite && diff / L.length > 0.01 && hot > 0.05 && e.bender.heat < hot / 2
      ? ok(`BEND：6 本つなぐと壊れた音（熱 ${hot.toFixed(2)}）→ 外すと冷める（${e.bender.heat.toFixed(2)}）・音割れなし`)
      : ng(`BEND ${finite} ${diff / L.length} ${hot} ${e.bender.heat}`);
  }
}

// ================= フェーズ4 =================
{
  const { emptyPattern } = await import('../src/sampler/dsp/seq');
  const { renderOffline, wavBytes, midiBytes, packProject, unpackProject, lengthBeats } = await import('../src/sampler/dsp/export');
  const click = new Float32Array(200); click.fill(0.8);
  const onsetsOf = (L: Float32Array) => { const o: number[] = []; for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > 0.2 && (i === 0 || Math.abs(L[i - 1]) < 0.01)) o.push(i / SR); return o; };
  // ---- 再生：4 つ打ち（120BPM）が 0.5 秒ごと・ループする ----
  {
    const e = new SamplerEngine(SR);
    e.bpm = 120;
    e.setSample(0, { sr: SR, ch: [click] });
    e.seq.setPattern(0, { bars: 1, events: [0, 1, 2, 3].map((t) => ({ t, pad: 0, vel: 1, len: 0.1 })) });
    e.transport(true, 'pattern', 0);
    const [L] = run(e, 4.2);
    const o = onsetsOf(L);
    o.length === 9 && o.every((t, i) => Math.abs(t - i * 0.5) < 0.0005) ? ok('パターン：4 つ打ちが 0.5 秒ごとぴったり・2 周目へ続く') : ng(`パターン ${o.map((t) => t.toFixed(4)).join(' ')}`);
  }
  // ---- 拍子：3/4 のパターン（1 小節 = 3 拍）は 1.5 秒で 1 周する ----
  {
    const e = new SamplerEngine(SR);
    e.bpm = 120;
    e.setSample(0, { sr: SR, ch: [click] });
    e.seq.setPattern(0, { bars: 1, meter: 3, events: [{ t: 0, pad: 0, vel: 1, len: 0.1 }] });
    e.transport(true, 'pattern', 0);
    const [L] = run(e, 3.2);
    const o = onsetsOf(L);
    o.length === 3 && o.every((t, i) => Math.abs(t - i * 1.5) < 0.0005) ? ok('拍子 3/4：1 小節のパターンが 1.5 秒ごとに 1 周') : ng(`拍子 3/4 ${o.map((t) => t.toFixed(4)).join(' ')}`);
  }
  // ---- スイング：16 分の裏が遅れる ----
  {
    const e = new SamplerEngine(SR);
    e.bpm = 120;
    e.setSample(0, { sr: SR, ch: [click] });
    e.seq.setPattern(0, { bars: 1, events: [{ t: 0.25, pad: 0, vel: 1, len: 0.1 }] });
    e.seq.setSwing(0.66);
    e.transport(true, 'pattern', 0);
    const [L] = run(e, 0.5);
    const o = onsetsOf(L);
    Math.abs(o[0] - (0.25 + 0.16 * 0.5) * 0.5) < 0.001 ? ok(`SWING 66%：16 分の裏が ${(o[0] * 1000).toFixed(1)}ms（ふつうは 125ms）`) : ng(`SWING ${o}`);
  }
  // ---- 録音：クオンタイズして入る・次の周で鳴る・画面に知らせる ----
  {
    const e = new SamplerEngine(SR);
    e.bpm = 120;
    e.setSample(0, { sr: SR, ch: [click] });
    let added = 0;
    e.onSeqAdd = () => added++;
    e.seq.setPattern(0, { bars: 1, events: [] });
    e.seq.quant = 0.25;
    e.transport(true, 'pattern', 0, true);
    run(e, 0.51); // 1 拍 ＋ 少し → 1 拍目にそろう
    e.trigger(0, 1);
    run(e, 0.05);
    e.releasePad(0);
    run(e, 1.5); // 2 周目のはじめまで
    const [L] = run(e, 0.6);
    const ev = e.seq.patterns[0].events[0];
    const o = onsetsOf(L);
    ev && Math.abs(ev.t - 1) < 1e-6 && added === 1 && o.length === 1 && Math.abs(o[0] - 0.5 + 0.06) < 0.02
      ? ok('録音：クオンタイズして 1 拍目に入り、次の周で鳴る')
      : ng(`録音 ${JSON.stringify(ev)} ${added} ${o}`);
  }
  // ---- ソング：P1 ×2 → P2 ×1 で止まる。書き出し（WAV）・MIDI・プロジェクトファイル ----
  {
    const pats = Array.from({ length: 16 }, emptyPattern);
    pats[0] = { bars: 1, events: [{ t: 0, pad: 0, vel: 1, len: 0.1 }] };
    pats[1] = { bars: 2, events: [{ t: 0, pad: 1, vel: 0.5, len: 0.1 }, { t: 4, pad: 1, vel: 0.5, len: 0.1 }] };
    const samples: (SampleBuf | null)[] = Array.from({ length: 160 }, () => null);
    samples[0] = { sr: SR, ch: [click] };
    samples[1] = { sr: SR, ch: [click] };
    const setup = { samples, params: Array.from({ length: 160 }, defaultPad), fx: (await import('../src/sampler/dsp/fx')).defaultSlots(), bpm: 120, swing: 0.5, patterns: pats, song: [{ ptn: 0, reps: 2 }, { ptn: 1, reps: 1 }] };
    const beats = lengthBeats(setup, 'song', 0);
    const g = renderOffline(setup, 'song', 0, SR, 1, 1);
    let res = g.next();
    while (!res.done) res = g.next();
    const [L, R] = res.value;
    const o = onsetsOf(L);
    beats === 16 && Math.abs(L.length / SR - 9) < 0.01 && o.length === 4 && [0, 2, 4, 6].every((t, i) => Math.abs(o[i] - t) < 0.001)
      ? ok('ソング：P1 ×2 → P2 で 16 拍（8 秒＋余韻）、4 回ぴったり鳴る')
      : ng(`ソング ${beats} ${L.length / SR} ${o}`);
    const w = wavBytes(L, R, SR);
    String.fromCharCode(...w.subarray(0, 4)) === 'RIFF' && w.length === 44 + L.length * 4 ? ok('WAV 書き出し（16bit ステレオ）') : ng('WAV');
    const m = midiBytes(setup, 'song', 0);
    const noteOns = [...m].filter((b, i) => (b & 0xf0) === 0x90 && i > 22).length;
    String.fromCharCode(...m.subarray(0, 4)) === 'MThd' && noteOns >= 4 ? ok('MIDI 書き出し（バンク = チャンネル、パッド = ノート 36〜）') : ng('MIDI');
    const pads = [{ pad: 0, name: 'CLICK', params: { ...defaultPad(), pitch: 3 }, sample: samples[0] }];
    const back = unpackProject<{ x: number }>(packProject({ x: 7 }, pads));
    back.meta.x === 7 && back.pads[0].name === 'CLICK' && back.pads[0].params.pitch === 3 && Math.abs(back.pads[0].sample!.ch[0][10] - 0.8) < 1e-3
      ? ok('プロジェクトファイル：保存して読み戻せる') : ng('プロジェクトファイル');
  }
}

// ================= フェーズ5：スタジオ（DAW）に並べる =================
{
  const { renderSong } = await import('../src/studio/render');
  const { TOY_ENGINES } = await import('../src/toys/engines');
  const click = new Float32Array(400); click.fill(0.9);
  // サンプラーのページで入れた音（custom）が、工場出荷の音より優先される
  const customs = [{ toy: 0, data: { kind: 'pad', pad: 0, data: { sr: SR, ch: [click] }, p: defaultPad() } }];
  const song = {
    version: 1 as const, bpm: 120, bars: 1, metronome: false, seed: 1616,
    tracks: [{ toy: 0, mute: false, autos: [], notes: [0, 1, 2, 3].map((b) => ({ key: 0, start: b, len: 0.2, take: 0 })) }],
  };
  const a = renderSong(song, SR, { toys: [6], customs, tail: 0.5 });
  const b = renderSong(song, SR, { toys: [6], tail: 0.5 }); // 渡さなければ工場出荷の KICK
  const o: number[] = [];
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > 0.2 && (i === 0 || Math.abs(a[i - 1]) < 0.01)) o.push(i / SR);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  TOY_ENGINES.length >= 7 && rms(b) > 0.02 && [0.5, 1, 1.5].every((t) => o.some((x) => Math.abs(x - t) < 0.002)) /* 頭は電源の「パクッ」と重なる */ && diff / a.length > 0.01
    ? ok('スタジオ・ラックの 7 台目：工場出荷の音で鳴り、サンプラーのページの音（custom）で置き換わる（WAV 書き出しでも 0.5 秒ごと 4 発）')
    : ng(`スタジオ ${TOY_ENGINES.length} ${rms(b)} ${o} ${diff / a.length}`);
  // メロディ・ベースのキー：MELO PAD の音を音程を変えて弾く
  {
    const { SamplerToy, MELO_ROOT_KEY } = await import('../src/sampler/toy/engine');
    const t = new SamplerToy(SR);
    t.custom({ kind: 'pad', pad: 24, data: tone(), p: defaultPad() });
    t.powerOn();
    const out = new Float32Array(B);
    for (let i = 0; i < 200; i++) t.process(out); // 起動音が終わるまで
    t.keyDown(MELO_ROOT_KEY + 12);
    const L = new Float32Array(SR * 0.3);
    for (let o2 = 0; o2 + B <= L.length; o2 += B) { t.process(out); L.set(out, o2); }
    const f = freq(L, at(0.02), at(0.28));
    Math.abs(f - 880) < 10 ? ok(`♪ MELO のキー：+12 → ${f.toFixed(1)}Hz`) : ng(`MELO ${f}`);
  }
  // 増やしたバンク K〜P：キー 304〜 で鳴る（前のキー 0〜303 はそのまま）
  {
    const { SamplerToy, padKey, keyPad, KEY_COUNT } = await import('../src/sampler/toy/engine');
    const t = new SamplerToy(SR);
    t.custom({ kind: 'pad', pad: 255, data: tone(), p: defaultPad() });
    t.powerOn();
    const out = new Float32Array(B);
    for (let i = 0; i < 200; i++) t.process(out);
    t.keyDown(padKey(255));
    const L = new Float32Array(SR * 0.2);
    for (let o2 = 0; o2 + B <= L.length; o2 += B) { t.process(out); L.set(out, o2); }
    const f = freq(L, at(0.02), at(0.18));
    const round = [0, 159, 160, 255].every((p) => keyPad(padKey(p)) === p) && padKey(159) === 159 && padKey(160) === 304 && KEY_COUNT === 400;
    Math.abs(f - 440) < 10 && round ? ok(`バンク A〜P（256 パッド）：P-16 はキー ${padKey(255)} で鳴る（${f.toFixed(0)}Hz）・A〜J のキーは前のまま`) : ng(`バンク K〜P ${f} ${round}`);
  }
  // 和音のキー：CHORD PAD の音を重ねて弾き、1 音だけ離すとその音だけ止まる
  {
    const { SamplerToy, SP, CHORD_ROOT_KEY } = await import('../src/sampler/toy/engine');
    const t = new SamplerToy(SR);
    t.custom({ kind: 'pad', pad: 50, data: tone(2), p: { ...defaultPad(), gate: true, release: 0 } });
    t.setParam(SP.chordPad, 50);
    t.powerOn();
    const out = new Float32Array(B);
    for (let i = 0; i < 200; i++) t.process(out);
    t.keyDown(CHORD_ROOT_KEY);
    t.keyDown(CHORD_ROOT_KEY + 12);
    const grab = (sec: number) => { const L = new Float32Array(Math.round(SR * sec)); for (let o2 = 0; o2 + B <= L.length; o2 += B) { t.process(out); L.set(out, o2); } return L; };
    const both = grab(0.2);
    t.keyUp(CHORD_ROOT_KEY + 12);
    grab(0.05);
    const one = grab(0.2);
    const f1 = freq(one, at(0.02), at(0.18));
    Math.abs(f1 - 440) < 10 && rms(both) > rms(one) * 1.2 ? ok(`CHORD のキー：2 音重ねて、上の音だけ離すと ${f1.toFixed(0)}Hz が残る`) : ng(`CHORD ${f1} ${rms(both)} ${rms(one)}`);
  }
  // 後付けのツマミ：PITCH・CUTOFF・DRIVE・CRUSH・ECHO が音を変える
  {
    const { SamplerToy, SP } = await import('../src/sampler/toy/engine');
    const play = (set: (t: InstanceType<typeof SamplerToy>) => void) => {
      const t = new SamplerToy(SR);
      t.custom({ kind: 'pad', pad: 0, data: tone(0.5, 3000), p: defaultPad() });
      t.powerOn();
      const out = new Float32Array(B);
      for (let i = 0; i < 200; i++) t.process(out);
      set(t);
      t.keyDown(0);
      const L = new Float32Array(Math.round(SR * 0.8));
      for (let o2 = 0; o2 + B <= L.length; o2 += B) { t.process(out); L.set(out, o2); }
      return L;
    };
    const dry = play(() => {});
    const d = (x: Float32Array) => { let s2 = 0; for (let i = 0; i < x.length; i++) s2 += Math.abs(x[i] - dry[i]); return s2 / x.length; };
    const fp = freq(play((t) => t.setParam(SP.pitch, 12)), at(0.03), at(0.2)); // 2 倍の速さなので 0.25 秒で終わる
    const res = {
      cutoff: rms(play((t) => t.setParam(SP.cutoff, 0.3)), at(0.05), at(0.4)) < rms(dry, at(0.05), at(0.4)) * 0.3,
      drive: d(play((t) => t.setParam(SP.drive, 0.8))) > 0.01,
      crush: d(play((t) => t.setParam(SP.crush, 0.8))) > 0.01,
      echo: rms(play((t) => { t.setParam(SP.echo, 0.6); t.setParam(SP.echoTime, 0.3); }), at(0.55), at(0.8)) > 0.01,
      pitch: Math.abs(fp - 6000) < 60,
    };
    Object.values(res).every(Boolean) ? ok(`後付けのツマミ（PITCH +12 → ${fp.toFixed(0)}Hz・CUTOFF・DRIVE・CRUSH・ECHO）が効く`) : ng(`ツマミ ${JSON.stringify(res)} ${fp}`);
  }
}

console.log(fails ? `失敗 ${fails} 件` : 'すべて OK');
process.exit(fails ? 1 : 0);
