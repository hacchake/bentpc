// ボーカルに何が混ざって残ったかを調べる：答えのわかる曲の楽器ごとの音（stems）と、取り出した歌の「歌でない部分」をくらべる。
// 実行：npx tsx scripts/cover-leak.ts 0 3 6   （数字は cover-bench の曲の番号）。残りのうち楽器で説明できない分は、歌そのものの欠け・ゆがみ
import { separateVocal, to22k } from '../src/cover/vocal';
import { genSong } from './lib/songgen';
import { SONGS } from './cover-bench';
for (const i of process.argv.slice(2).map(Number)) {
  const o = SONGS[i], g = genSong(o);
  const sep = separateVocal([g.L, g.R], g.sr);
  const V = to22k(g.vocal, g.sr), est = sep.vocal, n = Math.min(V.length, est.length);
  const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let k = 0; k < n; k++) s += a[k] * b[k]; return s; };
  const gv = dot(est, V) / dot(V, V);
  const res = Float32Array.from(est.subarray(0, n), (v, k) => v - gv * V[k]);
  const re = dot(res, res);
  const parts: string[] = [];
  for (const [name, st] of Object.entries(g.stems)) {
    const S = to22k(st, g.sr), c = dot(res, S), e = (c * c) / dot(S, S);
    parts.push(`${name} ${(100 * e / re).toFixed(0)}%`);
  }
  console.log(o.label, 'residual', (10 * Math.log10(re / (gv * gv * dot(V, V)))).toFixed(1), 'dB |', parts.join(' '));
}
