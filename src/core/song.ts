// 曲データ（シーケンサー）の形と、録音した生の操作を「音符」「ツマミの動き」に変える関数。
// 時間はすべて拍（beat）で持つ。テンポを変えても位置関係は変わらない。
// Worklet（再生・録音）と画面（編集）の両方が同じ関数を使うので、表示と音が必ず一致する。

/** 音符：あるキーを start 拍から len 拍押す */
export interface SeqNote {
  key: number;
  start: number;
  len: number;
  take: number; // 何回目の録音か（取り消し用）
}

/** ツマミの動き：t 拍でパラメーター index を v にする */
export interface SeqAuto {
  index: number;
  t: number;
  v: number;
  take: number;
}

export interface SeqTrack {
  mute: boolean;
  notes: SeqNote[];
  autos: SeqAuto[];
}

export interface Song {
  version: 1;
  bpm: number;
  bars: number; // 4/4 拍子の小節数 = ループの長さ
  metronome: boolean;
  tracks: SeqTrack[]; // おもちゃ 1 台 = 1 トラック（並び順 = おもちゃ番号）
}

/** 録音中に集めた生の操作 */
export type RawEvent =
  | { toy: number; kind: 'key'; key: number; down: boolean; beat: number }
  | { toy: number; kind: 'param'; index: number; value: number; beat: number };

export function emptySong(toys: number): Song {
  return { version: 1, bpm: 120, bars: 4, metronome: true, tracks: Array.from({ length: toys }, () => ({ mute: false, notes: [], autos: [] })) };
}

export const songBeats = (s: Song) => s.bars * 4;

/**
 * 生の操作を音符とツマミの動きに変える。
 * end は録音を区切った位置（ループの終わり）。押しっぱなしのキーは end で切る。
 */
export function takeFromRaw(raw: RawEvent[], take: number, end: number): { toy: number; notes: SeqNote[]; autos: SeqAuto[] }[] {
  const byToy = new Map<number, { notes: SeqNote[]; autos: SeqAuto[] }>();
  const get = (toy: number) => {
    let t = byToy.get(toy);
    if (!t) byToy.set(toy, (t = { notes: [], autos: [] }));
    return t;
  };
  const open = new Map<string, number>(); // "toy:key" → 押し始めた拍
  const lastAuto = new Map<string, number>(); // 間引き用
  for (const e of [...raw].sort((a, b) => a.beat - b.beat)) {
    if (e.kind === 'key') {
      const id = `${e.toy}:${e.key}`;
      if (e.down) {
        if (!open.has(id)) open.set(id, e.beat);
      } else if (open.has(id)) {
        const s = open.get(id)!;
        open.delete(id);
        get(e.toy).notes.push({ key: e.key, start: s, len: Math.max(1 / 64, e.beat - s), take });
      }
    } else {
      // ツマミは 1/64 拍より細かい変化を間引く（最後の値は必ず残す）
      const id = `${e.toy}:${e.index}`;
      const autos = get(e.toy).autos;
      const prev = lastAuto.get(id);
      if (prev !== undefined && e.beat - autos[prev].t < 1 / 64 && autos[prev].index === e.index) {
        autos[prev].v = e.value;
      } else {
        lastAuto.set(id, autos.length);
        autos.push({ index: e.index, t: e.beat, v: e.value, take });
      }
    }
  }
  for (const [id, s] of open) {
    const [toy, key] = id.split(':').map(Number);
    get(toy).notes.push({ key, start: s, len: Math.max(1 / 64, end - s), take });
  }
  return [...byToy].map(([toy, t]) => ({ toy, ...t }));
}

/** 録ったテイクを曲に足す（オーバーダブ） */
export function mergeTake(song: Song, take: ReturnType<typeof takeFromRaw>): void {
  for (const t of take) {
    const tr = song.tracks[t.toy];
    if (!tr) continue;
    tr.notes.push(...t.notes);
    tr.autos.push(...t.autos);
    tr.notes.sort((a, b) => a.start - b.start);
    tr.autos.sort((a, b) => a.t - b.t);
  }
}

/** 曲の長さに収まるように整える（はみ出た音は切る） */
export function clampSong(song: Song): void {
  const end = songBeats(song);
  for (const tr of song.tracks) {
    tr.notes = tr.notes.filter((n) => n.start < end && n.start >= 0);
    for (const n of tr.notes) n.len = Math.max(1 / 64, Math.min(n.len, end - n.start));
    tr.autos = tr.autos.filter((a) => a.t >= 0 && a.t < end);
  }
}

export const cloneSong = (s: Song): Song => JSON.parse(JSON.stringify(s));
