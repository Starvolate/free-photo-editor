// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Downloaded engine and model files, kept in the browser (IndexedDB) so they come down only once. IndexedDB also works
 * on a plain-http address such as a home network preview; where it is missing, nothing is kept and nothing breaks.
 */
const DB = 'free-photoeditor-ai', STORE = 'files';
let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  return (opening ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  }));
}
function ask<T>(mode: IDBTransactionMode, go: (s: IDBObjectStore) => IDBRequest, read: (r: unknown) => T, none: T): Promise<T> {
  return db().then((d) => new Promise<T>((resolve) => {
    if (!d) { resolve(none); return; }
    try {
      const q = go(d.transaction(STORE, mode).objectStore(STORE));
      q.onsuccess = () => resolve(read(q.result));
      q.onerror = () => resolve(none);
    } catch { resolve(none); }
  }));
}
export const getFile = (key: string): Promise<Uint8Array | null> =>
  ask('readonly', (s) => s.get(key), (r) => (r instanceof ArrayBuffer ? new Uint8Array(r) : null), null);
export const hasFile = (key: string): Promise<boolean> => ask('readonly', (s) => s.count(key), (r) => (r as number) > 0, false);
export const putFile = (key: string, bytes: Uint8Array): Promise<boolean> =>
  ask('readwrite', (s) => s.put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), key), () => true, false);
