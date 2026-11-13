// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Never lose work. A moment after each change, and whenever the page is hidden, the open pictures are copied into this
 * browser's own storage (IndexedDB). Nothing leaves the device. Each editor window keeps its own copies under a session
 * id, held by a Web Lock while the window is open; on the next start, copies whose window is gone are offered back
 * ("Bring back your last pictures?", Restore or Discard). Closing a picture removes its copy. Undo steps are not kept.
 */
import type { Doc, Layer } from '@free-photoeditor/core';

export interface SavedPicture { key: string; session: string; name: string; order: number; width: number; height: number; layers: number; savedAt: number; }
/** One open picture as the editor sees it. `tab` only has to stay the same object while the picture is open. */
export interface OpenPicture { tab: object; doc: Doc; name: string; state: number; }
export interface SaverHost { pictures(): OpenPicture[]; busy(): boolean; }

const DB = 'free-photo-editor', META = 'meta', PIXELS = 'pixels', LOCK = 'fpe-autosave:';
const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction): Promise<void> => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('aborted')); });
type Locks = { request(name: string, cb: () => Promise<void>): Promise<void>; query(): Promise<{ held?: { name?: string }[] }> };
const locks = (): Locks | null => (typeof navigator !== 'undefined' && (navigator as Navigator & { locks?: Locks }).locks) || null;

/** A copy of the document with only plain data in it (pixels stay typed arrays), safe to store. */
export function plainDoc(d: Doc, withContent = true): Doc {
  const layer = (l: Layer): Layer => {
    const out: Layer = { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, x: l.x, y: l.y, width: l.width, height: l.height, data: l.data };
    if (l.locked) out.locked = true;
    if (withContent && l.content) out.content = l.content;
    return out;
  };
  const s = d.selection;
  return { width: d.width, height: d.height, activeId: d.activeId, layers: d.layers.map(layer),
    selection: s ? { x: s.x, y: s.y, w: s.w, h: s.h, ...(s.alpha ? { alpha: s.alpha } : {}) } : null };
}
/** "photo.jpg and 2 more" */
export function namesText(list: { name: string }[]): string {
  if (!list.length) return '';
  if (list.length === 1) return list[0].name;
  if (list.length === 2) return `${list[0].name} and ${list[1].name}`;
  return `${list[0].name}, ${list[1].name} and ${list.length - 2} more`;
}

export class Autosave {
  readonly session: string;
  enabled = true;
  /** Copies written and copies waiting, for About and tests. */
  writes = 0;
  lastError: string | null = null;
  private db: Promise<IDBDatabase> | null = null;
  private keys = new WeakMap<object, string>();
  private ids = new WeakMap<Doc, number>();
  private saved = new Map<string, string>();
  private n = 0;
  private docN = 0;
  private timer = 0;
  private running: Promise<void> | null = null;
  private again = false;
  private release: (() => void) | null = null;

  constructor(private host: SaverHost) {
    this.session = (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));
  }
  /** Holds this window's lock, so other windows know its copies are still in use. */
  start(): void {
    const l = locks();
    if (!l || this.release) return;
    void l.request(LOCK + this.session, () => new Promise<void>((res) => { this.release = res; })).catch(() => undefined);
  }
  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(META)) r.result.createObjectStore(META, { keyPath: 'key' });
        if (!r.result.objectStoreNames.contains(PIXELS)) r.result.createObjectStore(PIXELS, { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('The browser storage is busy.'));
    }).catch((e: unknown) => { this.db = null; throw e; }));
  }
  /** Something changed: save a moment later. */
  touch(): void {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 1200);
  }
  /** Save now (also used before a reload and when the page is hidden). */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.enabled) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    this.running = this.pass().catch((e: unknown) => {
      this.lastError = e instanceof Error ? e.message : String(e);
    }).finally(() => {
      this.running = null;
      if (this.again) { this.again = false; this.touch(); }
    });
    return this.running;
  }
  private idOf(d: Doc): number {
    let id = this.ids.get(d);
    if (!id) { id = ++this.docN; this.ids.set(d, id); }
    return id;
  }
  private async pass(): Promise<void> {
    if (this.host.busy()) { this.touch(); return; }
    const pics = this.host.pictures(), live = new Set<string>(), sigs = new Map<string, string>();
    const writes: [SavedPicture, Doc][] = [];
    pics.forEach((p, i) => {
      let key = this.keys.get(p.tab);
      if (!key) { key = `${this.session}:${++this.n}`; this.keys.set(p.tab, key); }
      live.add(key);
      const sig = `${p.state}|${p.name}|${i}|${this.idOf(p.doc)}|${p.doc.layers.length}`;
      sigs.set(key, sig);
      if (this.saved.get(key) !== sig) {
        writes.push([{ key, session: this.session, name: p.name, order: i, width: p.doc.width, height: p.doc.height, layers: p.doc.layers.length, savedAt: Date.now() }, p.doc]);
      }
    });
    const gone = [...this.saved.keys()].filter((k) => !live.has(k));
    if (!writes.length && !gone.length) return;
    const db = await this.open();
    const tx = db.transaction([META, PIXELS], 'readwrite'), meta = tx.objectStore(META), px = tx.objectStore(PIXELS);
    for (const [m, d] of writes) {
      meta.put(m);
      try { px.put({ key: m.key, doc: plainDoc(d) }); } catch { px.put({ key: m.key, doc: plainDoc(d, false) }); }
    }
    for (const k of gone) { meta.delete(k); px.delete(k); }
    await done(tx);
    for (const [m] of writes) this.saved.set(m.key, sigs.get(m.key) ?? '');
    for (const k of gone) this.saved.delete(k);
    this.writes += writes.length;
    this.lastError = null;
  }
  /** Copies left by editor windows that are closed now (or that crashed). */
  async leftBehind(): Promise<SavedPicture[]> {
    try {
      const db = await this.open();
      const all = await req(db.transaction(META, 'readonly').objectStore(META).getAll()) as SavedPicture[];
      const l = locks();
      const held = new Set(l ? ((await l.query()).held ?? []).map((x) => x.name ?? '') : []);
      return all.filter((m) => m.session !== this.session && !held.has(LOCK + m.session))
        .sort((a, b) => a.savedAt === b.savedAt ? a.order - b.order : a.session === b.session ? a.order - b.order : a.savedAt - b.savedAt);
    } catch { return []; }
  }
  /** The stored pictures, ready to open again. */
  async load(list: SavedPicture[]): Promise<{ doc: Doc; name: string }[]> {
    const db = await this.open(), store = db.transaction(PIXELS, 'readonly').objectStore(PIXELS);
    const got = await Promise.all(list.map((m) => req(store.get(m.key)) as Promise<{ doc?: Doc } | undefined>));
    return got.flatMap((g, i) => (g?.doc ? [{ doc: g.doc, name: list[i].name }] : []));
  }
  /** Delete copies (Discard, or after they were brought back and saved again under this window). */
  async forget(list: { key: string }[]): Promise<void> {
    if (!list.length) return;
    const db = await this.open(), tx = db.transaction([META, PIXELS], 'readwrite');
    for (const m of list) { tx.objectStore(META).delete(m.key); tx.objectStore(PIXELS).delete(m.key); }
    await done(tx);
  }
  /** Safety copies off: remove this window's copies and stop. */
  async disable(): Promise<void> {
    this.enabled = false;
    clearTimeout(this.timer);
    const mine = [...this.saved.keys()].map((key) => ({ key }));
    this.saved.clear();
    this.keys = new WeakMap();
    await this.forget(mine).catch(() => undefined);
  }
  enable(): void { this.enabled = true; this.touch(); }
  stop(): void {
    clearTimeout(this.timer);
    this.release?.();
    this.release = null;
  }
}
