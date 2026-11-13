// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The document model: a size, layers from bottom (index 0) to top, the active layer and a selection. */
import type { VectorPath } from './path';
import type { BlendMode } from './blend';
import { compositeRect } from './composite';
import { WHITE, type RGBA } from './color';
import { contains, intersect, union, type Rect } from './geometry';
import type { LayerContent } from './vector';
import type { JobSpec } from './jobs';

export interface Bitmap { width: number; height: number; data: Uint8ClampedArray; }
export interface Layer {
  id: string; name: string; visible: boolean; opacity: number; blendMode: BlendMode;
  /** Locked layers refuse every edit until unlocked. */
  locked?: boolean;
  /** Position of the layer's top-left pixel in the document; layers may extend past the canvas. */
  x: number; y: number; width: number; height: number;
  /** RGBA, straight alpha, width * height * 4 bytes. */
  data: Uint8ClampedArray;
  /** Text and shape layers: what the layer is made of, so it stays editable (vector.ts). */
  content?: LayerContent;
  /** Hides parts of the layer without deleting pixels (mask.ts). A value object: a change replaces the whole object. */
  mask?: LayerMask;
  /** What the node is (tree.ts). Absent = 'pixel', so old autosaves, files and tests load unchanged. */
  kind?: LayerKind;
  /** The folder it sits in; absent = the top level. A folder's contents are the unbroken run directly below it. */
  parentId?: string;
  /** Drawn only inside its base: the nearest node below it, in the same folder, that is not clipped itself. */
  clip?: boolean;
  /** Folders: true = the contents mix straight into everything below (the default for new folders). */
  passThrough?: boolean;
  /** Folders: shown open in the Layers panel. View state: saved, but never an undo step. */
  open?: boolean;
  /** Small PSD fields read but not modelled, written back unchanged. A value object. */
  psdKeep?: Record<string, unknown>;
  /** Editable light and colour layers (kind 'adjust'): the dialog it came from and its settings. A value object. */
  adjust?: AdjustLayer;
  /** Colour layers (kind 'fill'): what fills the canvas. A value object. */
  fill?: FillLayer;
  /** Layer effects (design 2.7): shadows, glows, outlines and overlays drawn live from the layer's shape. A value object. */
  fx?: LayerEffects;
  /** 0..1: how solid the layer's own pixels are; its effects stay (Fill). Absent = 1. */
  fillOpacity?: number;  /** A colour tag, to find the layer again (Find layers). Absent = none. */
  label?: LayerLabel;
  /** Notes and tags written on the layer (Find layers searches them). A value object. */
  meta?: LayerMeta;
}
/** The colour tags a layer can carry. */
export type LayerLabel = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'grey';
/** Notes and tags kept with a layer. A value object: a change replaces the whole object. */
export interface LayerMeta { notes: string; tags: string[]; }
/** What every layer effect has: switched on, how it mixes, and how strong it is (0..1). */
export interface FxBase { on: boolean; blend: BlendMode; opacity: number; psd?: unknown; }
/** A drop shadow or an inner shadow: angle in degrees (where the light comes from), distance, spread (%; choke for inner) and size in px. */
export interface FxShadow extends FxBase { color: RGBA; angle: number; distance: number; spread: number; size: number; }
/** An outer or inner glow: spread (%) and size in px; an inner glow shines from the edge or the centre. */
export interface FxGlow extends FxBase { color: RGBA; spread: number; size: number; from?: 'edge' | 'centre'; }
export interface FxColor extends FxBase { color: RGBA; }
/** One colour stop of a gradient overlay: `at` from 0 to 1. */
export interface FxStop { at: number; color: RGBA; }
export interface FxGradient extends FxBase { stops: FxStop[]; shape: 'linear' | 'radial'; angle: number; scale: number; reverse: boolean; }
export interface FxStroke extends FxBase { size: number; where: 'inside' | 'centre' | 'outside'; color: RGBA; }
export interface FxSatin extends FxBase { color: RGBA; angle: number; distance: number; size: number; invert: boolean; }
export interface FxPattern extends FxBase { pattern: string; scale: number; }
/** The layer's effects. The kinds that allow several copies are lists; the others are one each. A value object. */
export interface LayerEffects {
  on: boolean;
  dropShadow: FxShadow[]; innerShadow: FxShadow[]; colorOverlay: FxColor[]; gradientOverlay: FxGradient[]; stroke: FxStroke[];
  outerGlow?: FxGlow; innerGlow?: FxGlow; satin?: FxSatin; patternOverlay?: FxPattern; bevel?: unknown;
}
/** True when the layer has at least one effect switched on (and its effects as a whole are on). */
export function hasLayerFx(l: { fx?: LayerEffects }): boolean {
  const f = l.fx;
  if (!f || !f.on) return false;
  const on = (e: { on: boolean } | undefined): boolean => !!e && e.on;
  return f.dropShadow.some(on) || f.innerShadow.some(on) || f.colorOverlay.some(on) || f.gradientOverlay.some(on) || f.stroke.some(on)
    || on(f.outerGlow) || on(f.innerGlow);
}
/**
 * An editable light and colour layer (design 2.5): `from` is the Image › Adjustments dialog's id (it picks the controls and
 * the name), `job` the same numbers-only settings the dialog runs; null = kept from a file but not drawn here.
 */
export interface AdjustLayer { from: string; job: JobSpec | null; psd?: unknown; }
/** A colour layer (design 2.6). Solid now; the colour fade and the pattern join it in the next part. */
export type FillLayer = { type: 'solid'; color: RGBA };
/** Pixel layers paint; folders hold other nodes (adjustment and fill layers come in later slices). */
export type LayerKind = 'pixel' | 'folder' | 'adjust' | 'fill';
/** True for nodes with pixels of their own to paint on: plain pixel, text and shape layers. */
export const hasPixels = (l: { kind?: LayerKind }): boolean => !l.kind || l.kind === 'pixel';
export const isFolder = (l: { kind?: LayerKind } | undefined): boolean => l?.kind === 'folder';
/** A layer mask: a grey picture over the document. 255 shows the layer, 0 hides it. */
export interface LayerMask {
  /** Document position of the painted part (may be 0 × 0). */
  x: number; y: number; width: number; height: number;
  /** width * height grey values: 255 shows, 0 hides. */
  data: Uint8Array;
  /** The value beyond the box (PSD "default colour"). */
  outside: 0 | 255;
  /** False = switched off: kept and saved, but not applied. */
  enabled: boolean;
  /** True = follows the layer when it moves or is transformed. */
  linked: boolean;
  /** 0..1: 1 = full strength, 0.5 = hidden parts half show. */
  density: number;
  /** Pixels: a soft edge added when drawn, never baked in. */
  feather: number;
}
/** A selected area. Without `alpha` the whole rectangle is selected; `alpha` (w * h) allows soft or shaped masks. */
export interface Selection extends Rect { alpha?: Uint8Array | null; }
export interface Doc {
  width: number; height: number; layers: Layer[]; activeId: string; selection: Selection | null;
  /** Print resolution in dots (pixels) per inch; 72 when not set (dpi.ts). It never changes the pixels. */
  dpi?: number;
  /** Outlines drawn with the pen (path.ts), kept beside the selection; plain data, so autosave keeps them. */
  paths?: VectorPath[];
}
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
/** A new empty folder: pass through and open, with the 1 × 1 clear placeholder every non-pixel node keeps. */
export function createFolder(name: string): Layer {
  return { id: newId(), name, visible: true, opacity: 1, blendMode: 'normal', x: 0, y: 0, width: 1, height: 1,
    data: new Uint8ClampedArray(4), kind: 'folder', passThrough: true, open: true };
}
/** A new editable light and colour layer: no pixels of its own (L3), drawn over everything below it. */
export function createAdjustLayer(name: string, from: string, job: JobSpec): Layer {
  return { id: newId(), name, visible: true, opacity: 1, blendMode: 'normal', x: 0, y: 0, width: 1, height: 1,
    data: new Uint8ClampedArray(4), kind: 'adjust', adjust: { from, job: { op: job.op, kind: job.kind, params: { ...job.params } } } };
}
/** A new solid colour layer: it covers the whole canvas with one colour you can change at any time. */
export function createFillLayer(name: string, color: RGBA): Layer {
  return { id: newId(), name, visible: true, opacity: 1, blendMode: 'normal', x: 0, y: 0, width: 1, height: 1,
    data: new Uint8ClampedArray(4), kind: 'fill', fill: { type: 'solid', color: { ...color } } };
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
export function duplicateLayer(l: Layer, name = l.name + ' copy'): Layer {
  const out: Layer = { ...l, id: newId(), name, data: l.data.slice() };
  if (l.mask) out.mask = { ...l.mask, data: l.mask.data.slice() };
  return out;
}
export function nextLayerName(doc: Doc, base = 'Layer'): string {
  const names = new Set(doc.layers.map((l) => l.name));
  let n = doc.layers.filter((l) => (base === 'Folder' ? isFolder(l) : !isFolder(l))).length + 1;
  while (names.has(base + ' ' + n)) n++;
  return base + ' ' + n;
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
