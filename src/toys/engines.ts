// おもちゃのエンジン一覧（Worklet 側）。並び順 = おもちゃ番号。UI 側の一覧（src/toys/uis.ts）と揃える。
import type { ToyEngine } from '../core/toy';
import { Engine as BlippyEngine } from './blippy/dsp/engine';
import { DjEngine } from './dj/dsp/engine';
import { PikoEngine } from './piko/dsp/engine';
import { TeleEngine } from './tele/dsp/engine';
import { TypoEngine } from './typo/dsp/engine';
import { VroomEngine } from './vroom/dsp/engine';
import { SamplerToy } from '../sampler/toy/engine';

// seed を渡すと、そのシードの乱数で作る（スタジオの「同じ曲なら毎回同じ音」用）
export const TOY_ENGINES: ((sampleRate: number, seed?: number) => ToyEngine)[] = [
  (sr, seed) => new BlippyEngine(sr, seed),
  (sr, seed) => new PikoEngine(sr, seed),
  (sr, seed) => new DjEngine(sr, seed),
  (sr, seed) => new VroomEngine(sr, seed),
  (sr, seed) => new TypoEngine(sr, seed),
  (sr, seed) => new TeleEngine(sr, seed),
  // 7 台目：サンプラー PAKU-PAKU 16（音の作り込みは専用のページ sampler.html）
  (sr) => new SamplerToy(sr),
];
