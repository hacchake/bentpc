// 曲の置き場（このブラウザの IndexedDB）：名前を付けて何曲でも保存し、あとで開ける。
// localStorage（5MB ほど）に入りきらない大きな曲の自動保存にも使う。どこにも送らない
import type { Song } from './song';

export interface SongEntry {
  id: string;
  title: string;
  /** どのページの曲か（'rack' = ラック、'studio' = スタジオ） */
  page: string;
  updated: number;
  song: Song;
}

const DB = 'bentpc-songs';
const STORE = 'songs';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const req = f(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/** そのページの曲の一覧（新しい順。自動保存の分は除く） */
export async function listSongs(page: string): Promise<SongEntry[]> {
  const all = await tx<SongEntry[]>('readonly', (s) => s.getAll());
  return all.filter((e) => e.page === page && !e.id.startsWith('auto:')).sort((a, b) => b.updated - a.updated);
}
export const getSong = (id: string) => tx<SongEntry | undefined>('readonly', (s) => s.get(id));
export const putSong = (e: SongEntry) => tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(e)) as SongEntry));
export const deleteSong = (id: string) => tx('readwrite', (s) => s.delete(id));
export const newSongId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
