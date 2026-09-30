// 攻略本の「おすすめシード値コレクション」を選ぶ。
// 耳で聞けないので、実際に鳴らして測った数字で選ぶ：
//   セクションごとの音量の差（盛り上がりがはっきりしているほど良い）・全体の音量（ちょうど良い大きさ）・音割れ（少ないほど良い）
// 実行：npx tsx scripts/manual/seeds.ts → public/manual/img/seeds.json
import { writeFileSync } from 'node:fs';
import { Rng } from '../../src/core/rng';
import { songBeats } from '../../src/core/song';
import { defaultComposer } from '../../src/compose/rules';
import { styleOf, STYLE_IDS } from '../../src/compose/styles';
import type { ComposeSettings, ComposeToy, StyleId } from '../../src/compose/types';
import { settingsToQuery } from '../../src/compose/share';
import { renderSong } from '../../src/studio/render';

const SR = 16000;
const SITE = 'https://hacchake.github.io/bentpc/';
const CHAOS: Record<StyleId, number> = { plain: 0.3, beat: 0.6, ambient: 0.35, noise: 0.8, collapse: 0.8 };
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / Math.max(1, b.length));

function score(settings: ComposeSettings, toys: ComposeToy[], engineIds: number[]) {
  const s = defaultComposer().compose({ settings, toys });
  const a = renderSong(s, SR, { toys: engineIds });
  const at = (b: number) => Math.floor(((b * 60) / s.bpm) * SR);
  const secs = s.sections ?? [];
  const lv = secs.map((x, i) => rms(a.subarray(at(x.start), at(i + 1 < secs.length ? secs[i + 1].start : songBeats(s)))));
  const mean = rms(a);
  let clip = 0;
  for (const x of a) if (Math.abs(x) > 0.98) clip++;
  const contrast = Math.min(4, Math.max(...lv) / Math.max(0.01, Math.min(...lv)));
  const quiet = lv.filter((l) => l < 0.02).length;
  const sc = contrast - Math.abs(mean - 0.22) * 6 - (clip / a.length) * 60 - quiet * 0.8;
  return { sc, contrast, mean, clip: clip / a.length };
}

const picks: { where: 'studio' | 'rack'; style: StyleId; name: string; seed: number; chaos: number; url: string; contrast: number; mean: number }[] = [];
const r = new Rng(20260930);
for (const style of STYLE_IDS) {
  const st = styleOf(style);
  // スタジオ（トイPC ＋ TELEKEY）
  const cands: { seed: number; sc: number; contrast: number; mean: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const seed = 1 + r.int(999998);
    const settings = { seed, style, chaos: (CHAOS[style] ?? 0.5), lengthSec: 60, bpm: st.bpm };
    const m = score(settings, [{ toy: 0, kind: 'blippy' }, { toy: 1, kind: 'tele' }], [0, 5]);
    cands.push({ seed, ...m });
  }
  cands.sort((a, b) => b.sc - a.sc);
  for (const c of cands.slice(0, 2)) {
    const settings = { seed: c.seed, style, chaos: (CHAOS[style] ?? 0.5), lengthSec: 60, bpm: st.bpm };
    picks.push({ where: 'studio', style, name: st.name, seed: c.seed, chaos: (CHAOS[style] ?? 0.5), url: `${SITE}studio.html?${settingsToQuery(settings, { toys: '0,5' })}`, contrast: c.contrast, mean: c.mean });
  }
  // ラック（トイPC だけ）
  const solo: { seed: number; sc: number; contrast: number; mean: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const seed = 1 + r.int(999998);
    const settings = { seed, style, chaos: (CHAOS[style] ?? 0.5), lengthSec: 60, bpm: st.bpm };
    solo.push({ seed, ...score(settings, [{ toy: 0, kind: 'blippy' }], [0, 1, 2, 3, 4, 5]) });
  }
  solo.sort((a, b) => b.sc - a.sc);
  const b0 = solo[0];
  const s0 = { seed: b0.seed, style, chaos: (CHAOS[style] ?? 0.5), lengthSec: 60, bpm: st.bpm };
  picks.push({ where: 'rack', style, name: st.name, seed: b0.seed, chaos: (CHAOS[style] ?? 0.5), url: `${SITE}?${settingsToQuery(s0, { toy: '1' })}`, contrast: b0.contrast, mean: b0.mean });
  console.log(`${st.name}：スタジオ ${cands.slice(0, 2).map((c) => c.seed).join(', ')} ／ トイPC ${b0.seed}`);
}
writeFileSync('public/manual/img/seeds.json', JSON.stringify(picks, null, 1));
