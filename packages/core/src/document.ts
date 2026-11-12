// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The document model: a size, layers from bottom (index 0) to top, the active layer and a selection. */
import { compositeRect, type BlendMode } from './blend';
import { WHITE, type RGBA } from './color';
import { contains, intersect, union, type Rect } from './geometry';

export interface Bitmap { width: number; height: number; data: Uint8ClampedArray; }
export interface Layer {
  id: string; name: string; visible: boolean; opacity: number; blendMode: BlendMode;
  /** Locked layers refuse every edit until unlocked. */
  locked?: boolean;
  /** Position of the layer's top-left pixel in the document; layers may extend past the canvas. */
  x: number; y: number; width: number; height: number;
  /** RGBA, straight alpha, width * height * 4 bytes. */
  data: Uint8ClampedArray;
}
/** A selected area. Without `alpha` the whole rectangle is selected; `alpha` (w * h) allows soft or shaped masks. */
export interface Selection extends Rect { alpha?: Uint8Array | null; }
export interface Doc { width: number; height: number; layers: Layer[]; activeId: string; selection: Selection | null; }
export interface LayerGeom { x: number; y: number; width: number; height: number; data: Uint8ClampedArray; }

let counter = 0;
export function newId(): string {
  counter += 1;
  return 'l' + counter.toString(36) + Math.floor(Math.random() * 0xffffff).toString(36);
}
export function fillBuffer(data: Uint8ClampedArray, c: RGBA): void {
  for (let i = 0; i < data.length; i += 4) { data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = c.a; }
}
export function createLayer(name: string, width: number, height: number,
  init: { x?: number; y?: number; fill?: RGBA | null; data?: Uint8ClampedArray } = {}): Layer {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  let data = init.data;
  if (data && data.length !== w * h * 4) throw new Error('Layer pixels do not match the layer size');
  if (!data) { data = new Uint8ClampedArray(w * h * 4); if (init.fill) fillBuffer(data, init.fill); }
  return { id: newId(), name, visible: true, opacity: 1, blendMode: 'normal', x: init.x ?? 0, y: init.y ?? 0, width: w, height: h, data };
}
export function createDocument(width: number, height: number, background: RGBA | null = WHITE): Doc {
  const layer = createLayer(background ? 'Background' : 'Layer 1', width, height, { fill: background });
  return { width: layer.width, height: layer.height, layers: [layer], activeId: layer.id, selection: null };
}
export function documentFromBitmap(bmp: Bitmap, name = 'Background'): Doc {
  const layer = createLayer(name, bmp.width, bmp.height, { data: bmp.data });
  return { width: bmp.width, height: bmp.height, layers: [layer], activeId: layer.id, selection: null };
}
export const docRect = (d: Doc): Rect => ({ x: 0, y: 0, w: d.width, h: d.height });
export const layerRect = (l: Layer): Rect => ({ x: l.x, y: l.y, w: l.width, h: l.height });
export const indexOfLayer = (doc: Doc, id: string): number => doc.layers.findIndex((l) => l.id === id);
export const findLayer = (doc: Doc, id: string): Layer | undefined => doc.layers.find((l) => l.id === id);
export const activeLayer = (doc: Doc): Layer | undefined => findLayer(doc, doc.activeId);
export const duplicateLayer = (l: Layer, name = l.name + ' copy'): Layer => ({ ...l, id: newId(), name, data: l.data.slice() });
export function nextLayerName(doc: Doc): string {
  const names = new Set(doc.layers.map((l) => l.name));
  let n = doc.layers.length + 1;
  while (names.has('Layer ' + n)) n++;
  return 'Layer ' + n;
}
/** Copy a rectangle given in layer coordinates (must lie inside the layer). */
export function readRegion(l: { width: number; data: Uint8ClampedArray }, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y + y) * l.width + r.x) * 4;
    out.set(l.data.subarray(s, s + r.w * 4), y * r.w * 4);
  }
  return out;
}
export function writeRegion(l: { width: number; data: Uint8ClampedArray }, r: Rect, src: Uint8ClampedArray): void {
  for (let y = 0; y < r.h; y++) l.data.set(src.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * l.width + r.x) * 4);
}
/** A document area (or the whole layer when null) as a rectangle in the layer's own coordinates. */
export function layerRegion(l: Layer, docArea: Rect | null): Rect | null {
  const lr = layerRect(l);
  const a = docArea ? intersect(docArea, lr) : lr;
  return a ? { x: a.x - l.x, y: a.y - l.y, w: a.w, h: a.h } : null;
}
export const geomOf = (l: Layer): LayerGeom => ({ x: l.x, y: l.y, width: l.width, height: l.height, data: l.data });
export function setGeom(l: Layer, g: LayerGeom): void { l.x = g.x; l.y = g.y; l.width = g.width; l.height = g.height; l.data = g.data; }
/** Enlarge a layer so it covers `area`. Returns the old geometry, or null when nothing changed. */
export function growLayerToCover(l: Layer, area: Rect): LayerGeom | null {
  const lr = layerRect(l);
  if (contains(lr, area)) return null;
  const u = union(lr, area) as Rect;
  const prev = geomOf(l);
  const data = new Uint8ClampedArray(u.w * u.h * 4);
  for (let y = 0; y < l.height; y++) data.set(l.data.subarray(y * l.width * 4, (y + 1) * l.width * 4), ((y + l.y - u.y) * u.w + (l.x - u.x)) * 4);
  setGeom(l, { x: u.x, y: u.y, width: u.w, height: u.h, data });
  return prev;
}
/** Selection coverage 0..255 at a document pixel. */
export function selectionAlpha(sel: Selection | null, x: number, y: number): number {
  if (!sel) return 255;
  if (x < sel.x || y < sel.y || x >= sel.x + sel.w || y >= sel.y + sel.h) return 0;
  return sel.alpha ? sel.alpha[(y - sel.y) * sel.w + (x - sel.x)] : 255;
}
export const compositeDoc = (doc: Doc, r: Rect, background: RGBA | null = null): Uint8ClampedArray => compositeRect(doc.layers, r, background);
export const flatten = (doc: Doc, background: RGBA | null = null): Bitmap =>
  ({ width: doc.width, height: doc.height, data: compositeRect(doc.layers, docRect(doc), background) });
export function samplePixel(doc: Doc, x: number, y: number, layer?: Layer): RGBA | null {
  x = Math.floor(x); y = Math.floor(y);
  if (layer) {
    const lx = x - layer.x, ly = y - layer.y;
    if (lx < 0 || ly < 0 || lx >= layer.width || ly >= layer.height) return null;
    const i = (ly * layer.width + lx) * 4;
    return { r: layer.data[i], g: layer.data[i + 1], b: layer.data[i + 2], a: layer.data[i + 3] };
  }
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  const p = compositeRect(doc.layers, { x, y, w: 1, h: 1 });
  return { r: p[0], g: p[1], b: p[2], a: p[3] };
}
/** True when any pixel of the flattened picture is not fully opaque. */
export function compositeHasTransparency(doc: Doc): boolean {
  for (let y = 0; y < doc.height; y += 64) {
    const px = compositeRect(doc.layers, { x: 0, y, w: doc.width, h: Math.min(64, doc.height - y) });
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
  }
  return false;
}
