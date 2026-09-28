// リズム 28 種の作り方。1〜21 は元のおもちゃの範囲、22〜28 は改造で出てくる「隠しパターン」。
// どれも 1 小節のステップ列（ドラム＋ベース）で、個体シードから決まる。

import { Rng, hashSeed } from '../../../core/rng';

export interface DjPattern {
  steps: number;
  bpm: number;
  /** ステップごとの音：k=キック s=スネア h=ハット o=オープン c=クラップ z=ザップ */
  hits: string[];
  /** ステップごとのベース（半音。null = 休み） */
  bass: (number | null)[];
  root: number; // ベースの基準（MIDI）
  kit: number; // ドラムキットの種類 0..3
  /** 隠しパターンの癖 */
  reverse: number; // 逆再生になる確率
  wobble: number; // 1 音ごとの音程のばらつき（半音）
  skip: number; // ステップを飛ばす確率
}

const GENRES = [
  // 1〜7：ヒップホップ
  { bpm: [86, 96], k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', bass: 'x.....x...x..x..' },
  // 8〜14：ハウス／テクノ
  { bpm: [118, 128], k: 'x...x...x...x...', s: '....c.......c...', h: '..o...o...o...o.', bass: '..x...x...x...x.' },
  // 15〜21：ブレイクビーツ／エレクトロ
  { bpm: [110, 138], k: 'x.........x.....', s: '....x.......x...', h: 'x.xxx.x.x.xxx.x.', bass: 'x..x..x.x..x....' },
];

export function makePattern(seed: number, id: number): DjPattern {
  const r = new Rng(hashSeed(seed, 'rhythm', id));
  const bank = Math.floor(id / 7);
  if (bank < 3) {
    const g = GENRES[bank];
    const hits: string[] = [];
    for (let i = 0; i < 16; i++) {
      let s = '';
      if (g.k[i] === 'x' || (r.chance(0.08) && i % 2 === 1)) s += 'k';
      if (g.s[i] === 'x') s += 's';
      if (g.s[i] === 'c') s += r.chance(0.5) ? 'c' : 'cs';
      if (g.h[i] === 'x' && !r.chance(0.1)) s += 'h';
      if (g.h[i] === 'o') s += 'o';
      if (i > 11 && r.chance(0.15)) s += r.pick(['s', 'c', 'h']);
      hits.push(s);
    }
    const scale = r.pick([[0, 3, 5, 7, 10], [0, 2, 3, 5, 7, 8, 10], [0, 5, 7, 12]]);
    const bass = [...g.bass].map((c) => (c === 'x' || r.chance(0.1) ? r.pick(scale) + (r.chance(0.2) ? 12 : 0) : null));
    bass[0] = 0;
    return {
      steps: 16, bpm: Math.round(r.range(g.bpm[0], g.bpm[1])), hits, bass,
      root: 36 + r.int(8), kit: bank, reverse: 0, wobble: 0, skip: 0,
    };
  }
  // ---- 22〜28：隠しパターン（拍子も音もおかしい） ----
  const steps = [5, 7, 11, 13, 9, 15, 6][id - 21];
  const hits: string[] = [];
  const bass: (number | null)[] = [];
  for (let i = 0; i < steps; i++) {
    hits.push(['k', 's', 'h', 'o', 'c', 'z'].filter(() => r.chance(0.32)).join('') || (i === 0 ? 'k' : ''));
    bass.push(r.chance(0.5) ? r.int(24) - 6 : null);
  }
  return {
    steps, bpm: Math.round(r.range(70, 170)), hits, bass, root: 30 + r.int(14), kit: 3,
    reverse: r.range(0.1, 0.6), wobble: r.range(0.5, 7), skip: r.range(0, 0.25),
  };
}
