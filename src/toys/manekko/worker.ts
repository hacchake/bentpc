// MANEKKO の解析を画面とは別の流れ（Web Worker）で：曲の解析 → ボーカルを取り出す。画面が固まらないように
import { analyze, bassPitch, melodyFromVocal, refineHarmony, refineStems } from '../../cover/analyze';
import { separateVocal, splitInst, to22k, type InstStems } from '../../cover/vocal';
import { aiSeparate } from '../../cover/ai';

/** ai：AI（Demucs）で楽器ごとに分ける（使えなければ、いつもの方式に戻す） */
interface Req { ch: Float32Array[]; sr: number; ai?: boolean }

self.onmessage = async (e: MessageEvent<Req>) => {
  const { ch, sr, ai } = e.data;
  const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);
  try {
    const P0 = ai ? 0.3 : 0.6;
    const analysis = analyze(ch, sr, (f, what) => post({ type: 'progress', f: f * P0, what }));
    const mono = new Float32Array(ch[0].length);
    for (const c of ch) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / ch.length;
    const orig = to22k(mono, sr);
    let sep: { sr: number; vocal: Float32Array; inst: Float32Array } | null = null, stems: InstStems | null = null;
    if (ai) {
      // AI（Demucs）：歌・ドラム・ベース・その他に分ける。使えなければ（ダウンロードできない・メモリが足りない…）いつもの方式で
      try {
        const r = await aiSeparate(ch, sr, (f, what) => post({ type: 'progress', f: P0 + f * (0.97 - P0), what }));
        stems = { drums: r.drums, bass: r.bass, other: r.other };
        const n = Math.min(r.vocal.length, orig.length);
        sep = { sr: 22050, vocal: r.vocal.slice(0, n), inst: Float32Array.from({ length: n }, (_, i) => r.drums[i] + r.bass[i] + r.other[i]) };
      } catch (err) {
        post({ type: 'note', message: `AI で分けられなかったので、いつもの方式で分けます（${String((err as Error)?.message ?? err).slice(0, 80)}）` });
      }
    }
    if (!sep || !stems) {
      const s1 = separateVocal(ch, sr, (f) => post({ type: 'progress', f: P0 + f * 0.25, what: 'ボーカルを取り出しています' }));
      sep = s1;
      // 伴奏をさらにドラム・ベース・その他に分けて、ドラムとベースを聞き取り直す
      stems = splitInst(s1.inst, bassPitch(orig), (f) => post({ type: 'progress', f: P0 + 0.25 + f * 0.12, what: '楽器ごとに分けています' }));
    }
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
