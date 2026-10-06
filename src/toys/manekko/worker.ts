// MANEKKO の解析を画面とは別の流れ（Web Worker）で：曲の解析 → ボーカルを取り出す。画面が固まらないように
import { analyze, bassPitch, melodyFromVocal, refineHarmony, refineStems } from '../../cover/analyze';
import { separateVocal, splitInst, to22k } from '../../cover/vocal';

interface Req { ch: Float32Array[]; sr: number }

self.onmessage = (e: MessageEvent<Req>) => {
  const { ch, sr } = e.data;
  const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);
  try {
    const analysis = analyze(ch, sr, (f, what) => post({ type: 'progress', f: f * 0.6, what }));
    const sep = separateVocal(ch, sr, (f) => post({ type: 'progress', f: 0.6 + f * 0.25, what: 'ボーカルを取り出しています' }));
    const mono = new Float32Array(ch[0].length);
    for (const c of ch) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / ch.length;
    const orig = to22k(mono, sr);
    // 伴奏をさらにドラム・ベース・その他に分けて、ドラムとベースを聞き取り直す
    const stems = splitInst(sep.inst, bassPitch(orig), (f) => post({ type: 'progress', f: 0.85 + f * 0.12, what: '楽器ごとに分けています' }));
    // 2 回目：歌を抜いた伴奏から調とコードを、取り出した歌からメロディを、聞き取り直す（混ざらないので正しく取りやすい）
    post({ type: 'progress', f: 0.98, what: 'メロディを聞き取り直しています' });
    refineHarmony(sep.inst, analysis);
    refineStems(stems, analysis);
    const mv = melodyFromVocal(sep.vocal, analysis);
    if (mv) analysis.melody = mv;
    // サンプリング用に、元の曲のモノラル（元のサンプルレートのまま）も
    post({ type: 'done', analysis, sr: sep.sr, vocal: sep.vocal, inst: sep.inst, orig, hi: mono, hiSr: sr }, [sep.vocal.buffer, sep.inst.buffer, orig.buffer, mono.buffer]);
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
