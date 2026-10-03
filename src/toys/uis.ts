// おもちゃの画面一覧（UI 側）。並び順 = おもちゃ番号。エンジン一覧（src/toys/engines.ts）と揃える。
import type { ToyUIFactory } from '../core/ui';
import { mountBlippy } from './blippy/ui/panel';
import { mountDj } from './dj/ui';
import { mountPiko } from './piko/ui';
import { mountTele } from './tele/ui';
import { mountTypo } from './typo/ui';
import { mountVroom } from './vroom/ui';
import { mountSamplerToy } from '../sampler/toy/ui';

export const TOY_UIS: ToyUIFactory[] = [mountBlippy, mountPiko, mountDj, mountVroom, mountTypo, mountTele, mountSamplerToy];
