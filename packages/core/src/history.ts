// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Undo and redo. Every edit is a Command that is already applied when it is pushed. Pixel commands keep only
 * the "before" pixels; the "after" pixels are read back at undo time, so the undo stack costs half the memory.
 */
import { findLayer, indexOfLayer, readRegion, setGeom, writeRegion, type Doc, type Layer, type LayerGeom, type Selection } from './document';
import type { Rect } from './geometry';
import { placeLayer } from './mask';

export interface Command { readonly label: string; readonly bytes: number; undo(doc: Doc): void; redo(doc: Doc): void; }
interface Entry { cmd: Command; id: number; }
let serial = 0;

export class History {
  private done: Entry[] = [];
  private undone: Entry[] = [];
  limit: number;
  maxBytes: number;
  constructor(limit = 60, maxBytes = 768 * 1024 * 1024) { this.limit = Math.max(1, limit); this.maxBytes = maxBytes; }
  push(cmd: Command | null | undefined): void {
    if (!cmd) return;
    this.done.push({ cmd, id: ++serial });
    this.undone = [];
    this.trim();
  }
  undo(doc: Doc): Command | null {
    const e = this.done.pop();
    if (!e) return null;
    e.cmd.undo(doc);
    this.undone.push(e);
    return e.cmd;
  }
  redo(doc: Doc): Command | null {
    const e = this.undone.pop();
    if (!e) return null;
    e.cmd.redo(doc);
    this.done.push(e);
    return e.cmd;
  }
  get canUndo(): boolean { return this.done.length > 0; }
  get canRedo(): boolean { return this.undone.length > 0; }
  get undoLabel(): string | null { return this.done.length ? this.done[this.done.length - 1].cmd.label : null; }
  get redoLabel(): string | null { return this.undone.length ? this.undone[this.undone.length - 1].cmd.label : null; }
  get length(): number { return this.done.length; }
  /** An id for the current state, to tell whether the picture changed since it was last saved. */
  stateId(): number { return this.done.length ? this.done[this.done.length - 1].id : 0; }
  clear(): void { this.done = []; this.undone = []; }
  /** Step names for a History panel: steps done (oldest first), then steps undone (next first); `index` = steps done. */
  entries(): { labels: string[]; index: number } {
    return { labels: [...this.done.map((e) => e.cmd.label), ...this.undone.slice().reverse().map((e) => e.cmd.label)], index: this.done.length };
  }
  /** Each step's id, in the order of `entries().labels`; an id stays with its step through undo and redo. */
  stepIds(): number[] { return [...this.done.map((e) => e.id), ...this.undone.slice().reverse().map((e) => e.id)]; }
  private trim(): void {
    let total = 0;
    for (const e of this.done) total += e.cmd.bytes;
    while (this.done.length > this.limit || (total > this.maxBytes && this.done.length > 1)) total -= (this.done.shift() as Entry).cmd.bytes;
  }
}

export interface Patch { r: Rect; before: Uint8ClampedArray; }
/** Pixel changes on one layer, as rectangles in layer coordinates with their old pixels. */
export function patchesCommand(label: string, layerId: string, patches: Patch[]): Command {
  let after: Uint8ClampedArray[] | null = null;
  let bytes = 0;
  for (const p of patches) bytes += p.before.length;
  return {
    label, bytes,
    undo(doc) {
      const l = findLayer(doc, layerId);
      if (!l) return;
      after = patches.map((p) => readRegion(l, p.r));
      for (const p of patches) writeRegion(l, p.r, p.before);
    },
    redo(doc) {
      const l = findLayer(doc, layerId);
      if (!l || !after) return;
      patches.forEach((p, i) => writeRegion(l, p.r, (after as Uint8ClampedArray[])[i]));
      after = null;
    },
  };
}
export const pixelCommand = (label: string, layerId: string, r: Rect, before: Uint8ClampedArray): Command =>
  patchesCommand(label, layerId, [{ r, before }]);
/** A change of a layer's size or position together with its pixels (buffers are swapped, not copied). */
export function geomCommand(label: string, layerId: string, before: LayerGeom, after: LayerGeom): Command {
  return {
    label, bytes: before.data.length,
    undo(doc) { const l = findLayer(doc, layerId); if (l) setGeom(l, before); },
    redo(doc) { const l = findLayer(doc, layerId); if (l) setGeom(l, after); },
  };
}
export function addLayerCommand(layer: Layer, index: number, prevActive: string, label = 'New layer'): Command {
  let obj = layer;
  return {
    label, bytes: layer.data.length,
    redo(doc) { doc.layers.splice(index, 0, obj); doc.activeId = obj.id; },
    undo(doc) {
      const i = indexOfLayer(doc, obj.id);
      if (i >= 0) { obj = doc.layers[i]; doc.layers.splice(i, 1); }
      doc.activeId = prevActive;
    },
  };
}
export function removeLayerCommand(layer: Layer, index: number, prevActive: string, nextActive: string, label = 'Delete layer'): Command {
  let obj = layer;
  return {
    label, bytes: 0,
    redo(doc) {
      const i = indexOfLayer(doc, obj.id);
      if (i >= 0) { obj = doc.layers[i]; doc.layers.splice(i, 1); }
      doc.activeId = nextActive;
    },
    undo(doc) { doc.layers.splice(index, 0, obj); doc.activeId = prevActive; },
  };
}
export function reorderCommand(from: number, to: number, label = 'Move layer'): Command {
  const move = (doc: Doc, a: number, b: number): void => { const [l] = doc.layers.splice(a, 1); doc.layers.splice(b, 0, l); };
  return { label, bytes: 0, redo(doc) { move(doc, from, to); }, undo(doc) { move(doc, to, from); } };
}
export type LayerProps = Partial<Pick<Layer, 'name' | 'visible' | 'opacity' | 'blendMode' | 'x' | 'y' | 'locked' | 'mask'>>;
/** Set layer properties. A move (x or y) carries a linked mask with it; a mask is swapped as a whole (a value object). */
export function applyProps(l: Layer, p: LayerProps): void {
  const { x, y, mask, ...rest } = p;
  if ('mask' in p) { if (mask) l.mask = mask; else delete l.mask; }
  if (x !== undefined || y !== undefined) placeLayer(l, x ?? l.x, y ?? l.y);
  Object.assign(l, rest);
}
export function propsCommand(layerId: string, before: LayerProps, after: LayerProps, label = 'Layer change'): Command {
  return {
    label, bytes: 0,
    undo(doc) { const l = findLayer(doc, layerId); if (l) applyProps(l, before); },
    redo(doc) { const l = findLayer(doc, layerId); if (l) applyProps(l, after); },
  };
}
export interface DocState { width: number; height: number; layers: Layer[]; activeId: string; selection: Selection | null; }
export const snapshotDoc = (doc: Doc): DocState => ({
  width: doc.width, height: doc.height, layers: doc.layers.map((l) => ({ ...l })), activeId: doc.activeId,
  selection: doc.selection ? { ...doc.selection } : null,
});
export function restoreDoc(doc: Doc, s: DocState): void {
  doc.width = s.width; doc.height = s.height; doc.layers = s.layers.map((l) => ({ ...l }));
  doc.activeId = s.activeId; doc.selection = s.selection ? { ...s.selection } : null;
}
export function docCommand(label: string, before: DocState, after: DocState): Command {
  let bytes = 0;
  for (const l of after.layers) bytes += l.data.length + (l.mask?.data.length ?? 0);
  return { label, bytes, undo(doc) { restoreDoc(doc, before); }, redo(doc) { restoreDoc(doc, after); } };
}
