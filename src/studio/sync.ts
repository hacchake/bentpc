// 再生を画面に映す（スタジオ・ラック共通）：曲データと再生位置から、
// 「今押されているキー」「今のノブ・スイッチの値」「クラッシュ中か」を求めて、各おもちゃに見せる。
// 音は Worklet が鳴らし、見た目は同じ曲データから作るので、ずれない。
import { autoValueAt, trackToy, SYS_CRASH, type Song } from '../core/song';
import type { ToyUI } from '../core/ui';

export interface ViewSync {
  /** 毎フレーム呼ぶ */
  frame(beat: number, playing: boolean): void;
  /** 頭から再生する前：ノブやスイッチを初期値に戻す（おもちゃが新品になるので） */
  resetViews(): void;
  /** 止めたとき：光っているキーを消し、クラッシュ表示を戻す */
  clearViews(): void;
  crashed(toy: number): boolean;
}

export function createViewSync(toys: ToyUI[], song: () => Song, onCrash: (toy: number, on: boolean) => void): ViewSync {
  const lit = toys.map(() => new Set<number>());
  const shown = toys.map(() => new Map<number, number>());
  const crashed = toys.map(() => false);
  const setCrash = (toy: number, on: boolean) => {
    if (crashed[toy] === on) return;
    crashed[toy] = on;
    toys[toy].freezeView?.(on);
    onCrash(toy, on);
  };
  return {
    crashed: (toy) => crashed[toy],
    resetViews() {
      toys.forEach((t, toy) => {
        t.paramDefs.forEach((p, i) => { if (p.kind !== 'momentary') t.showParam?.(i, p.default); });
        shown[toy].clear();
      });
    },
    clearViews() {
      toys.forEach((t, toy) => {
        lit[toy].forEach((k) => t.showKey?.(k, false));
        lit[toy].clear();
        setCrash(toy, false);
      });
    },
    frame(beat, playing) {
      if (!playing) return;
      const s = song();
      toys.forEach((t, toy) => {
        const want = new Set<number>();
        let crash = false;
        let used = false;
        s.tracks.forEach((tr, i) => {
          if (tr.mute || trackToy(s, i) !== toy) return;
          used = true;
          for (const n of tr.notes) {
            if (n.start > beat) break;
            if (beat < n.start + n.len) { if (n.key === SYS_CRASH) crash = true; else if (n.key < 2000) want.add(n.key); }
          }
          const params = new Set(tr.autos.map((a) => a.index));
          params.forEach((idx) => {
            const def = t.paramDefs[idx];
            if (!def || def.kind === 'momentary') return;
            const v = autoValueAt(tr.autos, idx, beat, !!s.ramp && def.kind === 'continuous');
            if (v === undefined) return;
            const prev = shown[toy].get(idx);
            if (prev === undefined || Math.abs(prev - v) > 0.002) { shown[toy].set(idx, v); t.showParam?.(idx, v); }
          });
        });
        if (!used && !lit[toy].size) return;
        lit[toy].forEach((k) => { if (!want.has(k)) t.showKey?.(k, false); });
        want.forEach((k) => { if (!lit[toy].has(k)) t.showKey?.(k, true); });
        lit[toy] = want;
        setCrash(toy, crash);
      });
    },
  };
}
