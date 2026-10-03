// ブラウザ内の保存（IndexedDB）。パッドごとに「設定・名前・音」を 1 件ずつ持つ。
// 保存できない環境（プライベートモードなど）でも、そのまま使える（保存されないだけ）。
import type { PadParams, SampleBuf } from './dsp/types';

export interface StoredPad {
  pad: number;
  name: string;
  params: PadParams;
  sample: SampleBuf | null;
}

const DB = 'paku16';
const STORE = 'pads';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'pad' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= open());

export async function loadAll(): Promise<StoredPad[] | null> {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).getAll();
      r.onsuccess = () => res(r.result as StoredPad[]);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return null;
  }
}

export async function savePads(items: StoredPad[]): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const t = d.transaction(STORE, 'readwrite');
      const s = t.objectStore(STORE);
      for (const it of items) s.put(it);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  } catch {
    // 保存できなくても使える
  }
}
