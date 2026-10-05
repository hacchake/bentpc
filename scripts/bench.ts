// 処理速度の目安：7 台の合奏（自動作曲）を鳴らして、全体と、おもちゃ・仕上げごとの負荷（実時間に対する割合）を出す。
// 実行：npx tsx scripts/bench.ts（スマホはこの数倍重い。全体が 100% を超えると音が途切れる）
import { defaultComposer } from '../src/compose/rules';
import { TOY_ENGINES } from '../src/toys/engines';
import { MasterBus } from '../src/host/master';
import { renderSongStereo, songSeconds } from '../src/studio/render';
const KINDS = ['blippy', 'piko', 'dj', 'vroom', 'typo', 'tele', 'sampler'] as const;
const names = ['blippy', 'piko', 'dj', 'vroom', 'typo', 'tele', 'sampler', 'manekko'];
const times = new Map<string, number>();
const add = (k: string, t: number) => times.set(k, (times.get(k) ?? 0) + t);
// エンジンを包んで時間を測る
TOY_ENGINES.forEach((mk, id) => {
  (TOY_ENGINES as any)[id] = (sr: number, seed?: number) => {
    const e = mk(sr, seed) as any;
    for (const m of ['process', 'processStereo']) if (e[m]) { const f = e[m].bind(e); e[m] = (...a: any[]) => { const t = performance.now(); const r = f(...a); add(names[id], performance.now() - t); return r; }; }
    return e;
  };
});
const mp = MasterBus.prototype.process;
MasterBus.prototype.process = function (...a: any[]) { const t = performance.now(); const r = (mp as any).apply(this, a); add('master', performance.now() - t); return r; };
const C = defaultComposer();
const ids = [0, 1, 2, 3, 4, 5, 6];
const s = C.compose({ settings: { seed: 99, style: 'beat', chaos: 0.8, lengthSec: 30, bpm: 124 }, toys: ids.map((id, i) => ({ toy: i, kind: KINDS[id] })) });
const t0 = performance.now();
renderSongStereo(s, 48000, { toys: ids });
const total = performance.now() - t0, dur = songSeconds(s) * 1000;
console.log('全体', (total / dur * 100).toFixed(1) + '%');
[...times].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(k.padEnd(8), (v / dur * 100).toFixed(1) + '%'));
