// おもちゃの画面一覧（UI 側）。並び順 = おもちゃ番号。エンジン一覧（src/toys/engines.ts）と揃える。
import type { ToyUIFactory } from '../core/ui';
import { mountBlippy } from './blippy/ui/panel';
import { mountDj } from './dj/ui';
import { mountPiko } from './piko/ui';
import { mountVroom } from './vroom/ui';

export const TOY_UIS: ToyUIFactory[] = [mountBlippy, mountPiko, mountDj, mountVroom];
