// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Filling and retouching: colour fades (gradients), the paint bucket, outlining a selection, red-eye repair, healing, and the
 * effect brushes (clone, heal, spot heal, dodge, burn, sponge, blur, sharpen, smudge, colour replacement, history brush and
 * the background eraser). Every change returns the Command that undoes it.
 */
import type { RGBA } from './color';
import { compositeDoc, docRect, findLayer, geomOf, growLayerToCover, layerRect, readRegion, selectionAlpha, writeRegion,
  type Doc, type Layer, type Selection } from './document';
import { clamp01, expandRect, intersect, union, type Point, type Rect } from './geometry';
import { geomCommand, patchesCommand, pixelCommand, type Command } from './history';
import { distanceSquared, layerOnCanvas, maskBounds, maskFromSelection, wandMask, type Mask, type Pixels } from './selection';
import type { StrokePoint } from './stroke';

// ---------- colour fades ----------
export type GradientKind = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
export const GRADIENT_KINDS: GradientKind[] = ['linear', 'radial', 'angle', 'reflected', 'diamond'];
export interface GradientOptions { kind: GradientKind; from: Point; to: Point; stops: RGBA[]; opacity: number; reverse?: boolean; }
/** Where a point sits along the fade: 0 at the start point, 1 at the end point. */
export function gradientT(kind: GradientKind, x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1e-9, px = x - a.x, py = y - a.y;
  switch (kind) {
    case 'linear': return clamp01((px * dx + py * dy) / len2);
    case 'reflected': return clamp01(Math.abs(px * dx + py * dy) / len2);
    case 'radial': return clamp01(Math.hypot(px, py) / Math.sqrt(len2));
    case 'diamond': return clamp01((Math.abs(px * dx + py * dy) + Math.abs(px * dy - py * dx)) / len2);
    case 'angle': { let t = (Math.atan2(dy, dx) - Math.atan2(py, px)) / (2 * Math.PI); t -= Math.floor(t); return t; }
  }
}
/** The colour at `t` (0..1) between evenly spaced stops, mixed with see-through handled correctly. */
export function gradientColor(stops: RGBA[], t: number, out: RGBA = { r: 0, g: 0, b: 0, a: 0 }): RGBA {
  if (stops.length === 1) return Object.assign(out, stops[0]);
  const pos = clamp01(t) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(pos)), f = pos - i, s = stops[i], e = stops[i + 1];
  const a = s.a * (1 - f) + e.a * f;
  out.a = a;
  if (a <= 0) { out.r = s.r * (1 - f) + e.r * f; out.g = s.g * (1 - f) + e.g * f; out.b = s.b * (1 - f) + e.b * f; return out; }
  out.r = (s.r * s.a * (1 - f) + e.r * e.a * f) / a; out.g = (s.g * s.a * (1 - f) + e.g * e.a * f) / a; out.b = (s.b * s.a * (1 - f) + e.b * e.a * f) / a;
  return out;
}
/** Lay colour `c` with strength `k` (0..1) over the pixel at `i` (normal blending, straight alpha). */
export function over(d: Uint8ClampedArray, i: number, c: RGBA, k: number): void {
  const sa = (c.a / 255) * k;
  if (sa <= 0) return;
  const da = d[i + 3] / 255, oa = sa + da * (1 - sa);
  d[i] = (c.r * sa + d[i] * da * (1 - sa)) / oa; d[i + 1] = (c.g * sa + d[i + 1] * da * (1 - sa)) / oa;
  d[i + 2] = (c.b * sa + d[i + 2] * da * (1 - sa)) / oa; d[i + 3] = oa * 255;
}
/**
 * Paint every pixel of `area` (picture pixels; the selection and the canvas limit it) on layer `l`, growing the layer to
 * cover it. `px` changes the pixel at index `i` of `d` for picture point x, y. Soft selections blend; `useSel` false ignores it.
 */
export function paintArea(doc: Doc, l: Layer, label: string, area: Rect | null, px: (x: number, y: number, d: Uint8ClampedArray, i: number) => void, useSel = true): Command | null {
  const sel = useSel ? doc.selection : null;
  let clip = intersect(area ?? docRect(doc), docRect(doc));
  if (clip && sel) clip = intersect(clip, sel);
  if (!clip) return null;
  const grown = growLayerToCover(l, clip);
  const r = { x: clip.x - l.x, y: clip.y - l.y, w: clip.w, h: clip.h };
  const before = readRegion(l, r), res = before.slice();
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) px(clip.x + x, clip.y + y, res, (y * r.w + x) * 4);
  if (sel?.alpha) {
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const a = selectionAlpha(sel, clip.x + x, clip.y + y) / 255, i = (y * r.w + x) * 4;
      for (let c = 0; c < 4; c++) res[i + c] = before[i + c] + (res[i + c] - before[i + c]) * a;
    }
  }
  writeRegion(l, r, res);
  if (grown) return geomCommand(label, l.id, grown, geomOf(l));
  return pixelCommand(label, l.id, r, before);
}
/** Gradient tool: fill the selected area (or the whole picture) with a colour fade from `from` to `to`. */
export function fillGradient(doc: Doc, l: Layer, o: GradientOptions, label = 'Colour fade'): Command | null {
  const stops = o.reverse ? [...o.stops].reverse() : o.stops, c: RGBA = { r: 0, g: 0, b: 0, a: 0 }, op = clamp01(o.opacity);
  return paintArea(doc, l, label, null, (x, y, d, i) => { gradientColor(stops, gradientT(o.kind, x + 0.5, y + 0.5, o.from, o.to), c); over(d, i, c, op); });
}
export interface BucketOptions { color: RGBA; tolerance: number; contiguous: boolean; allLayers: boolean; opacity: number; }
/** Paint bucket: fill the area of similar colour around the clicked point. */
export function bucketFill(doc: Doc, l: Layer, x: number, y: number, o: BucketOptions): Command | null {
  const src: Pixels = o.allLayers ? { width: doc.width, height: doc.height, data: compositeDoc(doc, docRect(doc)) } : layerOnCanvas(l, doc.width, doc.height);
  const m = wandMask(src, x, y, o.tolerance, o.contiguous), b = maskBounds(m);
  if (!b) return null;
  const op = clamp01(o.opacity);
  return paintArea(doc, l, 'Fill an area', b, (px, py, d, i) => { const k = m.data[py * doc.width + px]; if (k) over(d, i, o.color, (k / 255) * op); });
}
/** Magic eraser: make the area of similar colour around the clicked point see-through. */
export function magicErase(doc: Doc, l: Layer, x: number, y: number, tolerance: number, contiguous: boolean, allLayers: boolean): Command | null {
  const src: Pixels = allLayers ? { width: doc.width, height: doc.height, data: compositeDoc(doc, docRect(doc)) } : layerOnCanvas(l, doc.width, doc.height);
  const m = wandMask(src, x, y, tolerance, contiguous), b = maskBounds(m), lr = intersect(b ?? { x: 0, y: 0, w: 0, h: 0 }, layerRect(l));
  if (!lr) return null;
  const r = { x: lr.x - l.x, y: lr.y - l.y, w: lr.w, h: lr.h }, before = readRegion(l, r), res = before.slice();
  for (let yy = 0; yy < r.h; yy++) for (let xx = 0; xx < r.w; xx++) {
    const k = m.data[(lr.y + yy) * doc.width + lr.x + xx] * (selectionAlpha(doc.selection, lr.x + xx, lr.y + yy) / 255);
    const i = (yy * r.w + xx) * 4;
    res[i + 3] = res[i + 3] * (1 - k / 255);
  }
  writeRegion(l, r, res);
  return pixelCommand('Erase similar colour', l.id, r, before);
}
export type StrokeWhere = 'inside' | 'center' | 'outside';
/** Edit > Stroke: draw a line `width` pixels wide along the selection's edge, inside it, centred on it or outside it. */
export function strokeSelection(doc: Doc, l: Layer, o: { width: number; color: RGBA; where: StrokeWhere; opacity: number }): Command | null {
  const sel = doc.selection;
  if (!sel || o.width <= 0) return null;
  const m = maskFromSelection(sel, doc.width, doc.height), pad = Math.ceil(o.width) + 2;
  const win = expandRect({ x: sel.x, y: sel.y, w: sel.w, h: sel.h }, pad);
  const at = (i: number): boolean => {
    const x = win.x + (i % win.w), y = win.y + ((i / win.w) | 0);
    return x >= 0 && y >= 0 && x < doc.width && y < doc.height && m.data[y * doc.width + x] >= 128;
  };
  const dOut = distanceSquared(win.w, win.h, at), dIn = distanceSquared(win.w, win.h, (i) => !at(i));
  const [lo, hi] = o.where === 'inside' ? [-o.width, 0] : o.where === 'outside' ? [0, o.width] : [-o.width / 2, o.width / 2];
  const op = clamp01(o.opacity);
  return paintArea(doc, l, 'Outline the selection', win, (x, y, d, i) => {
    const k = (y - win.y) * win.w + (x - win.x), s = at(k) ? -(Math.sqrt(dIn[k]) - 0.5) : Math.sqrt(dOut[k]) - 0.5;
    const cov = clamp01(Math.min(s - lo, hi - s) + 0.5);
    if (cov > 0) over(d, i, o.color, cov * op);
  }, false);
}
/** Red eye: find the red pupil around the clicked point and darken it, keeping the catch-light. Null when nothing red is there. */
export function redEye(doc: Doc, l: Layer, x: number, y: number, o: { size: number; darken: number }): Command | null {
  const R = Math.max(4, o.size), area = intersect({ x: Math.floor(x - R), y: Math.floor(y - R), w: Math.ceil(2 * R) + 1, h: Math.ceil(2 * R) + 1 }, intersect(layerRect(l), docRect(doc)) ?? { x: 0, y: 0, w: 0, h: 0 });
  if (!area) return null;
  const r = { x: area.x - l.x, y: area.y - l.y, w: area.w, h: area.h }, before = readRegion(l, r), w = r.w, h = r.h;
  const red = (p: number): number => { const i = p * 4; return before[i + 3] < 64 ? 0 : before[i] - Math.max(before[i + 1], before[i + 2]); };
  let seed = -1, best = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const dx = area.x + xx + 0.5 - x, dy = area.y + yy + 0.5 - y;
    if (dx * dx + dy * dy > (R / 2) * (R / 2)) continue;
    const v = red(yy * w + xx);
    if (v > best) { best = v; seed = yy * w + xx; }
  }
  if (seed < 0 || best < 25) return null;
  const thr = Math.max(14, best * 0.25), m = new Float32Array(w * h), stack = [seed];
  const inside = (p: number): boolean => { const dx = area.x + (p % w) + 0.5 - x, dy = area.y + ((p / w) | 0) + 0.5 - y; return dx * dx + dy * dy <= R * R; };
  m[seed] = 1;
  while (stack.length) {
    const p = stack.pop() as number, px = p % w, py = (p / w) | 0;
    for (const q of [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1]) {
      if (q >= 0 && !m[q] && inside(q) && red(q) > thr) { m[q] = 1; stack.push(q); }
    }
  }
  const soft = new Float32Array(w * h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    let s = 0, n = 0;
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const X = xx + k, Y = yy + j; if (X >= 0 && Y >= 0 && X < w && Y < h) { s += m[Y * w + X]; n++; } }
    soft[yy * w + xx] = Math.max(m[yy * w + xx], s / n);
  }
  const res = before.slice(), dk = 1 - 0.45 * clamp01(o.darken);
  for (let p = 0; p < w * h; p++) {
    const k = soft[p];
    if (!k) continue;
    const i = p * 4, g = before[i + 1], b = before[i + 2], target = ((g + b) / 2) * dk;
    res[i] = before[i] + (Math.min(before[i], target) - before[i]) * k; res[i + 1] = g + (g * dk - g) * k; res[i + 2] = b + (b * dk - b) * k;
  }
  writeRegion(l, r, res);
  return pixelCommand('Fix red eyes', l.id, r, before);
}

// ---------- healing ----------
function guess(D: Float32Array, known: Uint8Array, w: number, h: number): void {
  const row = new Float32Array(w * h), col = new Float32Array(w * h), hasR = new Uint8Array(w * h), hasC = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1;
    for (let x = 0; x <= w; x++) {
      const i = y * w + x;
      if (x < w && !known[i]) continue;
      if (last >= 0 && x < w && x - last > 1) for (let k = last + 1; k < x; k++) { const t = (k - last) / (x - last); row[y * w + k] = D[y * w + last] * (1 - t) + D[i] * t; hasR[y * w + k] = 1; }
      if (x < w) last = x;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1;
    for (let y = 0; y <= h; y++) {
      const i = y * w + x;
      if (y < h && !known[i]) continue;
      if (last >= 0 && y < h && y - last > 1) for (let k = last + 1; k < y; k++) { const t = (k - last) / (y - last); col[k * w + x] = D[last * w + x] * (1 - t) + D[i] * t; hasC[k * w + x] = 1; }
      if (y < h) last = y;
    }
  }
  for (let i = 0; i < w * h; i++) if (!known[i]) D[i] = hasR[i] && hasC[i] ? (row[i] + col[i]) / 2 : hasR[i] ? row[i] : hasC[i] ? col[i] : 0;
}
/**
 * Healing: lay `source` over the masked part of `target`, then correct its light and colour so it meets the surroundings
 * with no seam. The difference between target and source around the edge is spread smoothly across the inside (a membrane).
 */
export function healPatch(target: Uint8ClampedArray, source: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, iterations = 120): Uint8ClampedArray {
  const n = w * h, out = new Uint8ClampedArray(target.length), known = new Uint8Array(n), D = new Float32Array(n);
  for (let i = 0; i < n; i++) known[i] = mask[i] === 0 ? 1 : 0;
  for (let x = 0; x < w; x++) { known[x] = 1; known[(h - 1) * w + x] = 1; }
  for (let y = 0; y < h; y++) { known[y * w] = 1; known[y * w + w - 1] = 1; }
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < n; i++) D[i] = known[i] ? target[i * 4 + c] - source[i * 4 + c] : 0;
    guess(D, known, w, h);
    for (let it = 0; it < iterations; it++) {
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!known[i]) D[i] += 1.85 * ((D[i - 1] + D[i + 1] + D[i - w] + D[i + w]) / 4 - D[i]);
      }
    }
    for (let i = 0; i < n; i++) { const k = mask[i] / 255, t = target[i * 4 + c]; out[i * 4 + c] = t + (source[i * 4 + c] + D[i] - t) * k; }
  }
  return out;
}
/** A copy of the layer's pixels in rectangle `r` (layer coordinates) moved by `off`; outside the layer repeats its edge. */
function shifted(get: (lx: number, ly: number, i: number, out: Uint8ClampedArray) => void, r: Rect, off: Point, lw: number, lh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    get(Math.min(lw - 1, Math.max(0, r.x + x + off.x)), Math.min(lh - 1, Math.max(0, r.y + y + off.y)), (y * r.w + x) * 4, out);
  }
  return out;
}
/** For spot healing: the shift to a nearby clean area whose surroundings best match the spot's surroundings. */
export function bestOffset(get: (lx: number, ly: number, i: number, out: Uint8ClampedArray) => void, r: Rect, mask: Uint8Array, lw: number, lh: number): Point {
  const target = shifted(get, r, { x: 0, y: 0 }, lw, lh), size = Math.max(r.w, r.h);
  let best: Point = { x: size, y: 0 }, bestScore = Infinity;
  for (const dist of [size * 0.9, size * 1.4]) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, off = { x: Math.round(Math.cos(a) * dist), y: Math.round(Math.sin(a) * dist) };
    if (r.x + off.x < 0 || r.y + off.y < 0 || r.x + r.w + off.x > lw || r.y + r.h + off.y > lh) continue;
    const src = shifted(get, r, off, lw, lh);
    let s = 0, n = 0;
    for (let i = 0; i < r.w * r.h; i++) {
      if (mask[i]) continue;
      const j = i * 4;
      s += (target[j] - src[j]) ** 2 + (target[j + 1] - src[j + 1]) ** 2 + (target[j + 2] - src[j + 2]) ** 2; n++;
    }
    const score = n ? s / n : Infinity;
    if (score < bestScore) { bestScore = score; best = off; }
  }
  return best;
}
/** Patch: replace the selected area with the area `off` pixels away, healed so it blends in. */
export function patchArea(doc: Doc, l: Layer, off: Point, label = 'Patch'): Command | null {
  const sel = doc.selection;
  if (!sel) return null;
  const m = maskFromSelection(sel, doc.width, doc.height), b = maskBounds(m);
  const area = b ? intersect(expandRect(b, 3), layerRect(l)) : null;
  if (!area) return null;
  const r = { x: area.x - l.x, y: area.y - l.y, w: area.w, h: area.h }, before = readRegion(l, r), mask = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) mask[y * r.w + x] = m.data[(area.y + y) * doc.width + area.x + x];
  const get = (lx: number, ly: number, i: number, out: Uint8ClampedArray): void => { const s = (ly * l.width + lx) * 4; out[i] = l.data[s]; out[i + 1] = l.data[s + 1]; out[i + 2] = l.data[s + 2]; out[i + 3] = l.data[s + 3]; };
  const src = shifted(get, r, { x: Math.round(off.x), y: Math.round(off.y) }, l.width, l.height);
  writeRegion(l, r, healPatch(before, src, mask, r.w, r.h));
  return pixelCommand(label, l.id, r, before);
}

// ---------- effect brushes ----------
export type EffectKind = 'clone' | 'heal' | 'spot-heal' | 'dodge' | 'burn' | 'sponge' | 'blur' | 'sharpen' | 'smudge' | 'color-replace' | 'history' | 'bg-erase';
export interface EffectOptions {
  kind: EffectKind; size: number; hardness: number;
  /** 0..1, how strong the effect is. */ strength: number;
  /** Clone and heal: where the copy comes from, as a shift in picture pixels (source = point + offset). */ offset?: Point;
  /** Dodge and burn: which tones change most. */ range?: 'shadows' | 'midtones' | 'highlights';
  /** Sponge: true for more colour, false for less. */ more?: boolean;
  /** Colour replacement: the new colour. */ color?: RGBA;
  /** Colour replacement and background eraser: how different a colour may be and still change (0..255). */ tolerance?: number;
  /** History brush: the layer as it was, to paint back. */ source?: { x: number; y: number; width: number; height: number; data: Uint8ClampedArray } | null;
}
const T = 64;
interface Tile { r: Rect; orig: Uint8ClampedArray; mask: Uint8Array; }
const MASKED: EffectKind[] = ['clone', 'heal', 'spot-heal', 'dodge', 'burn', 'sponge', 'color-replace', 'history'];
const lum = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b;
/** Dodge (lighten) or burn (darken) one channel value, most in the chosen tones. */
export function toneShift(c: number, e: number, range: 'shadows' | 'midtones' | 'highlights', lighten: boolean): number {
  const v = c / 255, k = range === 'shadows' ? (1 - v) * (1 - v) : range === 'highlights' ? v * v : 4 * v * (1 - v);
  return lighten ? c + (255 - c) * k * e : c - c * k * e;
}
/** The "colour" blend: hue and strength from `c`, lightness from the pixel. Writes into out[0..2]. */
export function colourBlend(r: number, g: number, b: number, c: RGBA, out: number[]): void {
  const L = lum(r, g, b), d = L - lum(c.r, c.g, c.b);
  let R = c.r + d, G = c.g + d, B = c.b + d;
  const l = lum(R, G, B), n = Math.min(R, G, B), x = Math.max(R, G, B);
  if (n < 0) { R = l + ((R - l) * l) / (l - n); G = l + ((G - l) * l) / (l - n); B = l + ((B - l) * l) / (l - n); }
  if (x > 255) { R = l + ((R - l) * (255 - l)) / (x - l); G = l + ((G - l) * (255 - l)) / (x - l); B = l + ((B - l) * (255 - l)) / (x - l); }
  out[0] = R; out[1] = G; out[2] = B;
}

/**
 * A stroke of an effect brush. Masked effects (clone, heal, dodge, burn, sponge, colour replacement, history brush) work from
 * the pixels as they were before the stroke and never build up past the strength, like the paint brush; dab effects (blur,
 * sharpen, smudge, background eraser) work on the pixels as they are now, dab after dab. Undo data is kept per 64 px tile.
 */
export class EffectStroke {
  readonly layer: Layer;
  readonly o: EffectOptions;
  private readonly clip: Rect | null;
  private readonly sel: Selection | null;
  private readonly tiles = new Map<number, Tile>();
  private readonly cols: number;
  private last: { x: number; y: number; size: number } | null = null;
  private carry = 0;
  private dirty: Rect | null = null;
  private all: Rect | null = null;
  private sampled: RGBA | null = null;
  private smear: Float32Array | null = null;
  private px = [0, 0, 0, 0];
  private mix = [0, 0, 0];

  constructor(doc: Doc, layer: Layer, o: EffectOptions, selection: Selection | null = doc.selection) {
    this.layer = layer;
    this.o = { ...o };
    this.sel = selection && selection.alpha ? selection : null;
    const area = selection ? intersect(selection, docRect(doc)) : docRect(doc);
    this.clip = area ? intersect(area, layerRect(layer)) : null;
    this.cols = Math.ceil(layer.width / T);
  }
  add(p: StrokePoint): void {
    const size = Math.max(1, p.size ?? this.o.size), l = this.last;
    if (!l) { this.dab(p.x, p.y, size); this.last = { x: p.x, y: p.y, size }; return; }
    const dx = p.x - l.x, dy = p.y - l.y, dist = Math.hypot(dx, dy);
    const step = Math.max(1, Math.min(size, l.size) * (MASKED.includes(this.o.kind) ? 0.12 : 0.25));
    let t = step - this.carry;
    while (t <= dist) { const f = t / (dist || 1); this.dab(l.x + dx * f, l.y + dy * f, l.size + (size - l.size) * f); t += step; }
    this.carry = dist - (t - step);
    this.last = { x: p.x, y: p.y, size };
  }
  takeDirty(): Rect | null { const d = this.dirty; this.dirty = null; return d; }
  get touched(): Rect | null { return this.all; }
  get changed(): boolean { return this.tiles.size > 0; }
  end(label: string): Command | null {
    if (!this.tiles.size) return null;
    return patchesCommand(label, this.layer.id, [...this.tiles.values()].map((t) => ({ r: t.r, before: t.orig })));
  }
  cancel(): Rect | null {
    for (const t of this.tiles.values()) writeRegion(this.layer, t.r, t.orig);
    this.tiles.clear();
    return this.all;
  }
  /** The layer pixel (layer coordinates) as it was before this stroke, into out[i..i+3]. */
  readonly orig = (lx: number, ly: number, i: number, out: Uint8ClampedArray | number[]): void => {
    const L = this.layer, t = this.tiles.get(((ly / T) | 0) * this.cols + ((lx / T) | 0));
    let s: number, d: Uint8ClampedArray;
    if (t) { s = ((ly - t.r.y) * t.r.w + (lx - t.r.x)) * 4; d = t.orig; } else { s = (ly * L.width + lx) * 4; d = L.data; }
    out[i] = d[s]; out[i + 1] = d[s + 1]; out[i + 2] = d[s + 2]; out[i + 3] = d[s + 3];
  };
  /**
   * Finish a heal or spot-heal stroke: the painted area is filled from its source (the clone offset, or for spot healing
   * the best-matching clean area nearby) and blended into its surroundings with no seam.
   */
  finishHeal(): Rect | null {
    const L = this.layer, a = this.all;
    if (!a || !this.tiles.size) return null;
    const lr = intersect(expandRect({ x: a.x - L.x, y: a.y - L.y, w: a.w, h: a.h }, 3), { x: 0, y: 0, w: L.width, h: L.height });
    if (!lr) return null;
    const mask = new Uint8Array(lr.w * lr.h), target = new Uint8ClampedArray(lr.w * lr.h * 4);
    for (let y = 0; y < lr.h; y++) for (let x = 0; x < lr.w; x++) {
      const lx = lr.x + x, ly = lr.y + y, t = this.tiles.get(((ly / T) | 0) * this.cols + ((lx / T) | 0));
      if (t) mask[y * lr.w + x] = t.mask[(ly - t.r.y) * t.r.w + (lx - t.r.x)];
      this.orig(lx, ly, (y * lr.w + x) * 4, target);
    }
    const off = this.o.kind === 'spot-heal' || !this.o.offset ? bestOffset(this.orig, lr, mask, L.width, L.height) : { x: Math.round(this.o.offset.x), y: Math.round(this.o.offset.y) };
    const src = shifted(this.orig, lr, off, L.width, L.height), res = healPatch(target, src, mask, lr.w, lr.h);
    for (let y = 0; y < lr.h; y++) for (let x = 0; x < lr.w; x++) {
      if (!mask[y * lr.w + x]) continue;
      const s = (y * lr.w + x) * 4, dI = ((lr.y + y) * L.width + lr.x + x) * 4;
      L.data[dI] = res[s]; L.data[dI + 1] = res[s + 1]; L.data[dI + 2] = res[s + 2]; L.data[dI + 3] = res[s + 3];
    }
    const d = { x: lr.x + L.x, y: lr.y + L.y, w: lr.w, h: lr.h };
    this.dirty = union(this.dirty, d);
    return d;
  }
  private tile(tx: number, ty: number, key: number): Tile {
    const L = this.layer, r = { x: tx * T, y: ty * T, w: Math.min(T, L.width - tx * T), h: Math.min(T, L.height - ty * T) };
    const t: Tile = { r, orig: readRegion(L, r), mask: new Uint8Array(r.w * r.h) };
    this.tiles.set(key, t);
    return t;
  }
  /** The effect's result for one pixel (layer coordinates lx, ly; picture coordinates x, y) from the original pixel o. */
  private value(lx: number, ly: number, o: Uint8ClampedArray, oi: number, out: number[]): boolean {
    const k = this.o.kind, L = this.layer;
    out[3] = o[oi + 3];
    if (k === 'clone' || k === 'heal') {
      const off = this.o.offset ?? { x: 0, y: 0 }, sx = Math.round(lx + off.x), sy = Math.round(ly + off.y);
      if (sx < 0 || sy < 0 || sx >= L.width || sy >= L.height) return false;
      this.orig(sx, sy, 0, out);
      return true;
    }
    if (k === 'spot-heal') { for (let c = 0; c < 3; c++) out[c] = (o[oi + c] + 150) / 2; return true; }
    if (k === 'history') {
      const s = this.o.source, x = lx + L.x - (s?.x ?? 0), y = ly + L.y - (s?.y ?? 0);
      if (!s || x < 0 || y < 0 || x >= s.width || y >= s.height) { out[0] = o[oi]; out[1] = o[oi + 1]; out[2] = o[oi + 2]; out[3] = 0; return true; }
      const j = (y * s.width + x) * 4;
      out[0] = s.data[j]; out[1] = s.data[j + 1]; out[2] = s.data[j + 2]; out[3] = s.data[j + 3];
      return true;
    }
    if (k === 'dodge' || k === 'burn') {
      for (let c = 0; c < 3; c++) out[c] = toneShift(o[oi + c], 0.65, this.o.range ?? 'midtones', k === 'dodge');
      return true;
    }
    if (k === 'sponge') {
      const g = lum(o[oi], o[oi + 1], o[oi + 2]), f = this.o.more === false ? 0.15 : 1.7;
      for (let c = 0; c < 3; c++) out[c] = g + (o[oi + c] - g) * f;
      return true;
    }
    if (k === 'color-replace') {
      const s = this.sampled, c = this.o.color;
      if (!s || !c) return false;
      const tol = this.o.tolerance ?? 48, d = Math.max(Math.abs(o[oi] - s.r), Math.abs(o[oi + 1] - s.g), Math.abs(o[oi + 2] - s.b));
      const w = d <= tol ? 1 : d >= tol * 1.5 + 8 ? 0 : 1 - (d - tol) / (tol * 0.5 + 8);
      if (w <= 0) return false;
      colourBlend(o[oi], o[oi + 1], o[oi + 2], c, this.mix);
      for (let ch = 0; ch < 3; ch++) out[ch] = o[oi + ch] + (this.mix[ch] - o[oi + ch]) * w;
      return true;
    }
    return false;
  }
  private dab(cx: number, cy: number, diameter: number): void {
    const c = this.clip;
    if (!c) return;
    const L = this.layer, data = L.data, lw = L.width, r = Math.max(0.5, diameter / 2);
    const x0 = Math.max(c.x, Math.floor(cx - r - 1)), y0 = Math.max(c.y, Math.floor(cy - r - 1));
    const x1 = Math.min(c.x + c.w, Math.ceil(cx + r + 1)), y1 = Math.min(c.y + c.h, Math.ceil(cy + r + 1));
    if (x0 >= x1 || y0 >= y1) return;
    const feather = Math.max(1, r * (1 - clamp01(this.o.hardness))), start = r - feather, st = clamp01(this.o.strength), k = this.o.kind;
    const masked = MASKED.includes(k);
    if (k === 'color-replace' && !this.sampled) {
      const lx = Math.min(lw - 1, Math.max(0, Math.round(cx) - L.x)), ly = Math.min(L.height - 1, Math.max(0, Math.round(cy) - L.y)), q = [0, 0, 0, 0];
      this.orig(lx, ly, 0, q);
      this.sampled = { r: q[0], g: q[1], b: q[2], a: q[3] };
    }
    // dab effects read a copy of the pixels under the dab (one pixel wider), so the result never reads its own writes
    let cur: Uint8ClampedArray | null = null, cw = 0, cxo = 0, cyo = 0;
    if (!masked) {
      cxo = Math.max(L.x, x0 - 1); cyo = Math.max(L.y, y0 - 1);
      const cx1 = Math.min(L.x + lw, x1 + 1), cy1 = Math.min(L.y + L.height, y1 + 1);
      cw = cx1 - cxo;
      cur = readRegion(L, { x: cxo - L.x, y: cyo - L.y, w: cw, h: cy1 - cyo });
      if (k === 'bg-erase') {
        const j = (Math.min(cy1 - cyo - 1, Math.max(0, Math.round(cy) - cyo)) * cw + Math.min(cw - 1, Math.max(0, Math.round(cx) - cxo))) * 4;
        this.sampled = { r: cur[j], g: cur[j + 1], b: cur[j + 2], a: cur[j + 3] };
      }
      if (k === 'smudge') {
        const S = Math.ceil(r) * 2 + 1, half = Math.ceil(r);
        if (!this.smear || this.smear.length !== S * S * 4) {
          this.smear = new Float32Array(S * S * 4);
          for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const X = Math.min(cw - 1, Math.max(0, Math.round(cx) - half + x - cxo)), Y = Math.min(cur.length / 4 / cw - 1, Math.max(0, Math.round(cy) - half + y - cyo));
            for (let ch = 0; ch < 4; ch++) this.smear[(y * S + x) * 4 + ch] = cur[(Y * cw + X) * 4 + ch];
          }
        }
      }
    }
    const ch = cur ? cur.length / 4 / cw : 0;
    const at = (x: number, y: number, ch2: number): number => {
      const X = Math.min(cw - 1, Math.max(0, x - cxo)), Y = Math.min(ch - 1, Math.max(0, y - cyo));
      return (cur as Uint8ClampedArray)[(Y * cw + X) * 4 + ch2];
    };
    const out = this.px;
    let tile: Tile | null = null, tkey = -1, any = false;
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - cy, ly = y - L.y, ty = (ly / T) | 0;
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - cx, d = Math.sqrt(dx * dx + dy * dy);
        let cov: number;
        if (d <= start) cov = 1;
        else { const t = (d - start) / (feather + 0.5); if (t >= 1) continue; cov = 1 - t * t * (3 - 2 * t); }
        if (this.sel) cov *= selectionAlpha(this.sel, x, y) / 255;
        let m = Math.round(cov * 255);
        if (m <= 0) continue;
        const lx = x - L.x, key = ty * this.cols + ((lx / T) | 0);
        if (key !== tkey) { tile = this.tiles.get(key) ?? this.tile((lx / T) | 0, ty, key); tkey = key; }
        const t = tile as Tile, ti = (ly - t.r.y) * t.r.w + (lx - t.r.x), di = (ly * lw + lx) * 4;
        if (masked) {
          if (m <= t.mask[ti]) continue;
          t.mask[ti] = m;
          if (!this.value(lx, ly, t.orig, ti * 4, out)) continue;
          const a = (m / 255) * st, o = t.orig, oi = ti * 4;
          for (let q = 0; q < 4; q++) data[di + q] = o[oi + q] + (out[q] - o[oi + q]) * a;
          any = true;
          continue;
        }
        if (m > t.mask[ti]) t.mask[ti] = m;
        const a = (m / 255) * st;
        if (k === 'blur' || k === 'sharpen') {
          for (let q = 0; q < 4; q++) {
            let s = 0;
            for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(x + i, y + j, q);
            const v = at(x, y, q), avg = s / 9, target = k === 'blur' ? avg : v + (v - avg) * 1.2;
            data[di + q] = v + (target - v) * a * (k === 'blur' ? 0.6 : 0.35);
          }
        } else if (k === 'smudge' && this.smear) {
          const S = Math.round(Math.sqrt(this.smear.length / 4)), half = (S - 1) / 2;
          const sx = Math.min(S - 1, Math.max(0, x - Math.round(cx) + half)), sy = Math.min(S - 1, Math.max(0, y - Math.round(cy) + half)), si = (sy * S + sx) * 4;
          for (let q = 0; q < 4; q++) data[di + q] = at(x, y, q) + (this.smear[si + q] - at(x, y, q)) * a * 0.9;
        } else if (k === 'bg-erase' && this.sampled) {
          const s = this.sampled, tol = this.o.tolerance ?? 40;
          const dd = Math.max(Math.abs(at(x, y, 0) - s.r), Math.abs(at(x, y, 1) - s.g), Math.abs(at(x, y, 2) - s.b));
          if (dd > tol) continue;
          data[di + 3] = at(x, y, 3) * (1 - a);
        }
        any = true;
      }
    }
    if (k === 'smudge' && this.smear) {
      const S = Math.round(Math.sqrt(this.smear.length / 4)), half = (S - 1) / 2;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const X = Math.round(cx) - half + x - L.x, Y = Math.round(cy) - half + y - L.y;
        if (X < 0 || Y < 0 || X >= lw || Y >= L.height) continue;
        for (let q = 0; q < 4; q++) this.smear[(y * S + x) * 4 + q] = data[(Y * lw + X) * 4 + q];
      }
    }
    if (any) { const d = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; this.dirty = union(this.dirty, d); this.all = union(this.all, d); }
  }
}
/** The layer with id `id` copied as it is now (for the history brush's source). */
export function layerSnapshot(doc: Doc, id: string): { x: number; y: number; width: number; height: number; data: Uint8ClampedArray } | null {
  const l = findLayer(doc, id);
  return l ? { x: l.x, y: l.y, width: l.width, height: l.height, data: l.data.slice() } : null;
}
