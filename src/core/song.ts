// 曲データ（シーケンサー）の形と、録音した生の操作を「音符」「ツマミの動き」に変える関数。
// 時間はすべて拍（beat）で持つ。テンポを変えても位置関係は変わらない。
// Worklet（再生・録音）と画面（編集）の両方が同じ関数を使うので、表示と音が必ず一致する。

import type { ComposeInfo } from '../compose/types';

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
  /** どのおもちゃを鳴らすか（省略時はトラックの並び順 = おもちゃ番号）。1 台に複数のトラックを持てる */
  toy?: number;
  /** トラックの名前（「ビート」「メロディ」など） */
  name?: string;
  /** 鍵：自動作曲で作り直しても残す */
  lock?: boolean;
  /** 手で弾いた録音をこのトラックに入れる（おもちゃごとに 1 つ） */
  rec?: boolean;
  /** 中身がなくても表示する行（"k:キー番号" / "p:パラメーター番号"） */
  show?: string[];
  /** 自動作曲のパート名（"blippy:melody" など。作り直すときの目印） */
  part?: string;
}

/** 曲の区切り（イントロ・サビなど）。start は拍 */
export interface Section {
  name: string;
  start: number;
}

// ---- 音符の「キー番号」の特別な範囲 ----
/** 1000 + パラメーター番号：押している間だけ 1 になるボタン（GLITCH・RESET など momentary のパラメーター） */
export const BTN = 1000;
/** 2000〜：システム操作 */
export const SYS_CRASH = 2000; // 音符の長さの間クラッシュ（音が張り付いて止まる）→ 終わりで RESET・再起動
export const SYS_POWER_ON = 2001; // 電源 ON（起動音）
export const SYS_POWER_OFF = 2002; // 電源 OFF
export const SYS_NAMES: Record<number, string> = { [SYS_CRASH]: 'CRASH→再起動', [SYS_POWER_ON]: 'POWER ON', [SYS_POWER_OFF]: 'POWER OFF' };

export interface Song {
  version: 1;
  bpm: number;
  bars: number; // 4/4 拍子の小節数 = ループの長さ
  metronome: boolean;
  tracks: SeqTrack[]; // 基本はおもちゃ 1 台 = 1 トラック（並び順 = おもちゃ番号）。toy を書けば 1 台に何本でも
  // ---- スタジオ用（無ければ従来どおり） ----
  title?: string;
  /** 乱数のシード。あると「頭から再生」のたびにおもちゃを新品に作り直す（同じ曲なら毎回同じ音） */
  seed?: number;
  /** ループ範囲（拍）。無ければ曲全体をループ。on=false なら最後まで鳴らして止まる */
  loop?: { on: boolean; start: number; end: number };
  sections?: Section[];
  /** ノブ（連続値）の点と点の間をなめらかにつなぐ */
  ramp?: boolean;
  /** テスト信号のコード進行（MIDI ノート番号の組、1 小節ずつ） */
  chords?: number[][];
  /** 自動作曲で作った曲：どの作曲方法・どの設定で作ったか */
  compose?: ComposeInfo;
  /** ミキサー：おもちゃごとの音量・左右・ミュート・ソロ（並び順 = おもちゃ番号。無ければ 0dB・自動で並べる） */
  mix?: (MixCh | null)[];
  /** 曲の置き場（songlib）での番号：上書き保存の先 */
  libId?: string;
}

/** ミキサーの 1 台分 */
export interface MixCh {
  /** 音量（dB、-60〜+6。-60 で無音） */
  gain: number;
  /** 左右（-1〜+1）。null = 自動（鳴った順にバンドのように並べる） */
  pan: number | null;
  mute?: boolean;
  solo?: boolean;
}
/** ミキサーの設定から、おもちゃ toy の音量（倍率）。ソロのおもちゃがあれば、ほかは鳴らさない */
export function mixGain(mix: Song['mix'], toy: number): number {
  const c = mix?.[toy];
  if (mix?.some((m) => m?.solo)) { if (!c?.solo) return 0; } else if (c?.mute) return 0;
  const db = c?.gain ?? 0;
  return db <= -60 ? 0 : Math.pow(10, db / 20);
}

/** トラック i が鳴らすおもちゃの番号 */
export const trackToy = (s: Song, i: number) => s.tracks[i]?.toy ?? i;

/** 曲の中で音符・ノブの動きが入っているおもちゃ（曲の中の番号、小さい順） */
export function usedToys(song: Song, count: number): number[] {
  const set = new Set<number>();
  song.tracks.forEach((tr, i) => { const t = trackToy(song, i); if (t < count && (tr.notes.length || tr.autos.length)) set.add(t); });
  return [...set].sort((a, b) => a - b);
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
    const tr = song.tracks[recTrack(song, t.toy)];
    if (!tr) continue;
    tr.notes.push(...t.notes);
    tr.autos.push(...t.autos);
    tr.notes.sort((a, b) => a.start - b.start);
    tr.autos.sort((a, b) => a.t - b.t);
  }
}

/** おもちゃ toy の録音を入れるトラック（rec の付いたもの → そのおもちゃの最初のトラック） */
export function recTrack(song: Song, toy: number): number {
  const mine = song.tracks.map((_, i) => i).filter((i) => trackToy(song, i) === toy);
  return mine.find((i) => song.tracks[i].rec) ?? mine[0] ?? toy;
}

/**
 * パラメーターの値を拍 beat の位置で求める（点が無ければ undefined）。
 * ramp なら点と点の間を直線でつなぐ（連続値のノブだけ）。autos は t の順に並んでいること
 */
export function autoValueAt(autos: SeqAuto[], index: number, beat: number, ramp: boolean): number | undefined {
  let prev: SeqAuto | undefined;
  for (const a of autos) {
    if (a.index !== index) continue;
    if (a.t > beat) {
      if (prev && ramp) return prev.v + ((a.v - prev.v) * (beat - prev.t)) / Math.max(1e-9, a.t - prev.t);
      return prev?.v;
    }
    prev = a;
  }
  return prev?.v;
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
