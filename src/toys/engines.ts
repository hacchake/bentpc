// おもちゃのエンジン一覧（Worklet 側）。並び順 = おもちゃ番号。UI 側の一覧（src/toys/uis.ts）と揃える。
import type { ToyEngine } from '../core/toy';
import { Engine as BlippyEngine } from './blippy/dsp/engine';
import { DjEngine } from './dj/dsp/engine';
import { PikoEngine } from './piko/dsp/engine';
import { VroomEngine } from './vroom/dsp/engine';

export const TOY_ENGINES: ((sampleRate: number) => ToyEngine)[] = [
  (sr) => new BlippyEngine(sr),
  (sr) => new PikoEngine(sr),
  (sr) => new DjEngine(sr),
  (sr) => new VroomEngine(sr),
];
