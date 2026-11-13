// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Layer masks (W6 S1). A mask is a grey picture over the document: 255 shows the layer, 0 hides it, grey half shows it.
 * Only the painted box is stored; every pixel beyond it has the `outside` value. Masks are value objects: a change
 * replaces the whole object with a copy that carries the change. The one exception is painting, which writes into
 * `data` and keeps its own undo step (maskPatchCommand). This file imports only types from the document and the history,
 * so the compositor can use it without an import cycle.
 */
import type { Doc, Layer, LayerMask, Selection } from './document';
import type { Command } from './history';
import { intersect, union, type Rect } from './geometry';

export const maskBox = (m: LayerMask): Rect => ({ x: m.x, y: m.y, w: m.width, h: m.height });
/** A new mask with nothing painted yet (it costs no memory): everything shows (255) or everything hides (0). */
export const emptyLayerMask = (outside: 0 | 255): LayerMask =>
  ({ x: 0, y: 0, width: 0, height: 0, data: new Uint8Array(0), outside, enabled: true, linked: true, density: 1, feather: 0 });
/** The stored value at a document pixel, before the soft edge, the density and the on/off switch. */
export function maskAt(m: LayerMask, x: number, y: number): number {
  const lx = x - m.x, ly = y - m.y;
  return lx >= 0 && ly >= 0 && lx < m.width && ly < m.height ? m.data[ly * m.width + lx] : m.outside;
}
/** A copy that owns its pixels: duplicating a layer never shares a mask buffer. */
export const copyMask = (m: LayerMask): LayerMask => ({ ...m, data: m.data.slice() });
/** The same mask moved; the pixels are shared because they do not change. */
export const shiftMask = (m: LayerMask, dx: number, dy: number): LayerMask => (dx || dy ? { ...m, x: m.x + dx, y: m.y + dy } : m);
/** Move a layer to (x, y). A linked mask moves with it; an unlinked one stays where it is. */
export function placeLayer(l: { x: number; y: number; mask?: LayerMask }, x: number, y: number): void {
  if (l.mask?.linked) l.mask = shiftMask(l.mask, x - l.x, y - l.y);
  l.x = x; l.y = y;
}
/** The part of a mask kept by cutting the canvas to `cr`, in the new canvas's coordinates. */
export function cropMask(m: LayerMask, cr: Rect): LayerMask {
  const ir = m.width && m.height ? intersect(maskBox(m), cr) : null;
  if (!ir) return { ...m, x: 0, y: 0, width: 0, height: 0, data: new Uint8Array(0) };
  const data = new Uint8Array(ir.w * ir.h);
  for (let y = 0; y < ir.h; y++) { const s = (ir.y - m.y + y) * m.width + (ir.x - m.x); data.set(m.data.subarray(s, s + ir.w), y * ir.w); }
  return { ...m, x: ir.x - cr.x, y: ir.y - cr.y, width: ir.w, height: ir.h, data };
}

/** How far a soft edge reaches, in pixels: the blur reads this far around each pixel. */
export const featherReach = (feather: number): number => (feather > 0 ? Math.ceil(feather * 1.5) : 0);
function kernel(feather: number): Float32Array {
  const R = featherReach(feather), s = Math.max(0.5, feather / 2), k = new Float32Array(2 * R + 1);
  let sum = 0;
  for (let i = -R; i <= R; i++) { k[i + R] = Math.exp(-(i * i) / (2 * s * s)); sum += k[i + R]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}
/**
 * The stored values (0..255) over `r` with the soft edge applied. It reads the mask `featherReach` pixels around `r`,
 * so any split of the picture into rows, bands or tiles gives the same values.
 */
export function featheredPlane(m: LayerMask, r: Rect): Float32Array {
  const R = featherReach(m.feather), k = kernel(m.feather), W = r.w + 2 * R, H = r.h + 2 * R, ox = r.x - R, oy = r.y - R;
  const src = new Float32Array(W * H).fill(m.outside);
  const ib = m.width && m.height ? intersect(maskBox(m), { x: ox, y: oy, w: W, h: H }) : null;
  if (ib) for (let y = ib.y; y < ib.y + ib.h; y++) for (let x = ib.x; x < ib.x + ib.w; x++) src[(y - oy) * W + (x - ox)] = m.data[(y - m.y) * m.width + (x - m.x)];
  const tmp = new Float32Array(r.w * H), out = new Float32Array(r.w * r.h);
  for (let y = 0; y < H; y++) for (let x = 0; x < r.w; x++) {
    let s = 0;
    for (let i = 0; i < k.length; i++) s += k[i] * src[y * W + x + i];
    tmp[y * r.w + x] = s;
  }
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    let s = 0;
    for (let i = 0; i < k.length; i++) s += k[i] * tmp[(y + i) * r.w + x];
    out[y * r.w + x] = s;
  }
  return out;
}
/** Fills `out[0 .. x1 - x0)` with how much of the layer shows (0..1) along row y. */
export type MaskRows = (y: number, x0: number, x1: number, out: Float32Array) => void;
/**
 * The mask as the compositor reads it over `r`, or null when it changes nothing (switched off, or density 0).
 * The value is 255 − density × (255 − m), where m is the stored value with the soft edge applied.
 */
export function maskRows(m: LayerMask, r: Rect): MaskRows | null {
  if (!m.enabled || !(m.density > 0)) return null;
  const k = Math.min(1, m.density) / 255;
  if (featherReach(m.feather) && r.w > 0 && r.h > 0) {
    const p = featheredPlane(m, r);
    return (y, x0, x1, out) => { const o = (y - r.y) * r.w - r.x; for (let x = x0; x < x1; x++) out[x - x0] = 1 - k * (255 - p[o + x]); };
  }
  const outside = 1 - k * (255 - m.outside);
  return (y, x0, x1, out) => {
    const ly = y - m.y;
    if (ly < 0 || ly >= m.height) { out.fill(outside, 0, x1 - x0); return; }
    const row = ly * m.width;
    for (let x = x0; x < x1; x++) { const lx = x - m.x; out[x - x0] = lx >= 0 && lx < m.width ? 1 - k * (255 - m.data[row + lx]) : outside; }
  };
}
/** The full value (0..255) at one pixel, soft edge, density and switch included, as the compositor uses it. */
export function maskValue(m: LayerMask, x: number, y: number): number {
  const rows = maskRows(m, { x, y, w: 1, h: 1 });
  if (!rows) return 255;
  const o = new Float32Array(1);
  rows(y, x, x + 1, o);
  return o[0] * 255;
}

const sameBox = (a: LayerMask, b: LayerMask): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.data === b.data;
const findLayer = (doc: Doc, id: string): Layer | undefined => doc.layers.find((l) => l.id === id);
function setMask(l: Layer, m: LayerMask | undefined): void { if (m) l.mask = m; else delete l.mask; }
/** Any change of a layer's mask as a whole (add, remove, invert, switch, link, density, soft edge): the objects are swapped. */
export function maskCommand(label: string, layerId: string, before: LayerMask | undefined, after: LayerMask | undefined): Command {
  return {
    label, bytes: (before && after && before.data !== after.data ? before.data.length : 0) + 64,
    undo(doc) { const l = findLayer(doc, layerId); if (l) setMask(l, before); },
    redo(doc) { const l = findLayer(doc, layerId); if (l) setMask(l, after); },
  };
}
/**
 * Painting on a mask: `rect` (in the mask's own pixels) with its old bytes. The new bytes are read back at undo time,
 * so the step costs one byte per changed pixel.
 */
export function maskPatchCommand(layerId: string, rect: Rect, before: Uint8Array, label = 'Paint on the mask'): Command {
  let after: Uint8Array | null = null;
  const io = (m: LayerMask, src: Uint8Array | null): Uint8Array => {
    const keep = new Uint8Array(rect.w * rect.h);
    for (let y = 0; y < rect.h; y++) {
      const s = (rect.y + y) * m.width + rect.x;
      keep.set(m.data.subarray(s, s + rect.w), y * rect.w);
      if (src) m.data.set(src.subarray(y * rect.w, (y + 1) * rect.w), s);
    }
    return keep;
  };
  return {
    label, bytes: before.length,
    undo(doc) { const m = findLayer(doc, layerId)?.mask; if (m) after = io(m, before); },
    redo(doc) { const m = findLayer(doc, layerId)?.mask; if (m && after) { io(m, after); after = null; } },
  };
}

/** Copy every value of a mask into a bigger box (filled with the outside value). */
function grown(m: LayerMask, b: Rect): LayerMask {
  const data = new Uint8Array(b.w * b.h).fill(m.outside);
  for (let y = 0; y < m.height; y++) data.set(m.data.subarray(y * m.width, (y + 1) * m.width), (m.y - b.y + y) * b.w + (m.x - b.x));
  return { ...m, x: b.x, y: b.y, width: b.w, height: b.h, data };
}
/** The grey a surface pixel stands for: its brightness times its coverage, so erasing hides. */
const fold1 = (d: Uint8ClampedArray, i: number): number => (((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29 + 128) >> 8) * d[i + 3] + 127) / 255 | 0;

export interface MaskSurface {
  /** A stand-in document whose only layer is the grey surface, with the real layer's id and the real selection. */
  doc: Doc;
  /** The grey surface: R = G = B = the mask, alpha 255, covering the canvas plus the layer's box. */
  layer: Layer;
  /** Copy what changed inside `r` (document pixels; the whole surface when omitted) into the mask. Returns the changed box. */
  fold(r?: Rect | null): Rect | null;
  /** The undo step for everything folded since the surface was opened, or null when nothing changed. */
  finish(label?: string): Command | null;
}
/**
 * Lets every pixel tool and command work on a mask unchanged: run it on `surface.doc`, then `fold` the changed area back.
 * The mask's box grows when painting reaches past it.
 */
export function openMaskSurface(doc: Doc, l: Layer): MaskSurface {
  if (!l.mask) throw new Error('This layer has no mask');
  const start = l.mask;
  const U = union(union({ x: 0, y: 0, w: doc.width, h: doc.height }, { x: l.x, y: l.y, w: l.width, h: l.height }), start.width && start.height ? maskBox(start) : null) as Rect;
  const data = new Uint8ClampedArray(U.w * U.h * 4);
  for (let y = 0; y < U.h; y++) for (let x = 0; x < U.w; x++) {
    const v = maskAt(start, U.x + x, U.y + y), i = (y * U.w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  const layer: Layer = { id: l.id, name: l.name, visible: true, opacity: 1, blendMode: 'normal', x: U.x, y: U.y, width: U.w, height: U.h, data };
  const stand = { width: doc.width, height: doc.height, layers: [layer], activeId: l.id } as unknown as Doc;
  Object.defineProperty(stand, 'selection', { get: () => doc.selection, set: (v: Selection | null) => { doc.selection = v; }, enumerable: true });
  const orig = start.data.slice();
  let changed: Rect | null = null;
  return {
    doc: stand, layer,
    fold(r) {
      const s = layer, a = intersect(r ?? { x: s.x, y: s.y, w: s.width, h: s.height }, { x: s.x, y: s.y, w: s.width, h: s.height });
      let m = l.mask;
      if (!a || !m) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
        if (fold1(s.data, ((y - s.y) * s.width + (x - s.x)) * 4) === maskAt(m, x, y)) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) return null;
      const box: Rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      const mb = maskBox(m);
      if (!m.width || !m.height || intersect(mb, box)?.w !== box.w || intersect(mb, box)?.h !== box.h) {
        m = grown(m, m.width && m.height ? (union(mb, box) as Rect) : box);
        if (sameBox(start, l.mask as LayerMask)) start.data.set(orig);
        l.mask = m;
      }
      for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++)
        m.data[(y - m.y) * m.width + (x - m.x)] = fold1(s.data, ((y - s.y) * s.width + (x - s.x)) * 4);
      changed = union(changed, box);
      return box;
    },
    finish(label = 'Paint on the mask') {
      const m = l.mask;
      if (!changed || !m) return null;
      if (!sameBox(start, m)) return maskCommand(label, l.id, start, m);
      const r = intersect(changed, maskBox(m)) as Rect, rect = { x: r.x - m.x, y: r.y - m.y, w: r.w, h: r.h }, before = new Uint8Array(r.w * r.h);
      for (let y = 0; y < r.h; y++) { const s = (rect.y + y) * m.width + rect.x; before.set(orig.subarray(s, s + r.w), y * r.w); }
      return maskPatchCommand(l.id, rect, before, label);
    },
  };
}
/** Run one operation on the mask as if it were pixels, fold everything back, and return the undo step. */
export function withMaskSurface(doc: Doc, l: Layer, label: string, run: (d: Doc, surface: Layer) => unknown): Command | null {
  const s = openMaskSurface(doc, l);
  run(s.doc, s.layer);
  s.fold();
  return s.finish(label);
}

/** Selection coverage over its own box, 0..255. */
function coverage(sel: Selection): Uint8Array {
  return sel.alpha ? sel.alpha.slice() : new Uint8Array(sel.w * sel.h).fill(255);
}
export type MaskKind = 'reveal' | 'hide' | 'selection' | 'hide-selection';
/** A new mask: reveal all, hide all, show only the selection, or hide the selection. */
export function makeMask(doc: Doc, kind: MaskKind): LayerMask | null {
  if (kind === 'reveal' || kind === 'hide') return emptyLayerMask(kind === 'reveal' ? 255 : 0);
  const s = doc.selection;
  if (!s || s.w <= 0 || s.h <= 0) return null;
  const data = coverage(s);
  if (kind === 'hide-selection') for (let i = 0; i < data.length; i++) data[i] = 255 - data[i];
  return { ...emptyLayerMask(kind === 'selection' ? 0 : 255), x: s.x, y: s.y, width: s.w, height: s.h, data };
}
const MASK_LABEL: Record<MaskKind, string> = { reveal: 'Add a mask', hide: 'Hide everything with a mask', selection: 'Mask from the selection', 'hide-selection': 'Hide the selection' };
export function addMask(doc: Doc, l: Layer, kind: MaskKind): Command | null {
  if (l.mask) return null;
  const m = makeMask(doc, kind);
  if (!m) return null;
  const cmd = maskCommand(MASK_LABEL[kind], l.id, undefined, m);
  cmd.redo(doc);
  return cmd;
}
export function deleteMask(doc: Doc, l: Layer): Command | null {
  if (!l.mask) return null;
  const cmd = maskCommand('Remove the mask', l.id, l.mask, undefined);
  cmd.redo(doc);
  return cmd;
}
export type MaskSettings = Partial<Pick<LayerMask, 'enabled' | 'linked' | 'density' | 'feather'>>;
const SET_LABEL: Record<keyof MaskSettings, string> = { enabled: 'Switch the mask on or off', linked: 'Link or unlink the mask', density: 'Mask density', feather: 'Mask soft edge' };
export function setMaskSettings(doc: Doc, l: Layer, s: MaskSettings, label?: string): Command | null {
  const m = l.mask;
  if (!m) return null;
  const keys = Object.keys(s) as (keyof MaskSettings)[];
  if (keys.every((k) => m[k] === s[k])) return null;
  const cmd = maskCommand(label ?? SET_LABEL[keys[0]], l.id, m, { ...m, ...s });
  cmd.redo(doc);
  return cmd;
}
/** Black becomes white and white becomes black: what was hidden shows, and what showed is hidden. */
export function invertLayerMask(doc: Doc, l: Layer): Command | null {
  const m = l.mask;
  if (!m) return null;
  const data = new Uint8Array(m.data.length);
  for (let i = 0; i < data.length; i++) data[i] = 255 - m.data[i];
  const cmd = maskCommand('Invert the mask', l.id, m, { ...m, data, outside: (255 - m.outside) as 0 | 255 });
  cmd.redo(doc);
  return cmd;
}
/** Make the mask permanent: the layer's see-through amount is multiplied by the mask (density and soft edge included). */
export function applyMask(doc: Doc, l: Layer): Command | null {
  const m = l.mask;
  if (!m) return null;
  const on = { ...m, enabled: true }, rows = maskRows(on, { x: l.x, y: l.y, w: l.width, h: l.height });
  const before = { data: l.data, mask: m }, data = l.data.slice(), row = new Float32Array(l.width);
  if (rows) for (let y = 0; y < l.height; y++) {
    rows(l.y + y, l.x, l.x + l.width, row);
    for (let x = 0; x < l.width; x++) { const i = (y * l.width + x) * 4 + 3; data[i] = Math.round(data[i] * row[x]); }
  }
  const swap = (doc2: Doc, s: { data: Uint8ClampedArray; mask?: LayerMask }): void => { const t = findLayer(doc2, l.id); if (t) { t.data = s.data; setMask(t, s.mask); } };
  const after = { data };
  const cmd: Command = { label: 'Make the mask permanent', bytes: l.data.length, undo(d) { swap(d, before); }, redo(d) { swap(d, after); } };
  cmd.redo(doc);
  return cmd;
}
/** A short fingerprint of a mask's settings and pixels, for tests and the page's state report (never the raw bytes). */
export function maskSummary(m: LayerMask): Record<string, unknown> {
  let h = 0x811c9dc5;
  for (let i = 0; i < m.data.length; i++) h = Math.imul(h ^ m.data[i], 0x01000193);
  return { x: m.x, y: m.y, w: m.width, h: m.height, outside: m.outside, enabled: m.enabled, linked: m.linked, density: m.density, feather: m.feather, sum: h >>> 0 };
}
/** A geometry step plus the mask change that goes with it, undone and redone as one step. */
export function plusMask(cmd: Command, layerId: string, before: LayerMask | undefined, after: LayerMask | undefined): Command {
  const m = maskCommand(cmd.label, layerId, before, after);
  return { label: cmd.label, bytes: cmd.bytes + m.bytes, undo(d) { m.undo(d); cmd.undo(d); }, redo(d) { cmd.redo(d); m.redo(d); } };
}
