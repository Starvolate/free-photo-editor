// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The brush engine. A stroke paints round dabs into a per-stroke coverage mask, so overlapping dabs never build up
 * past the stroke's opacity. Original pixels are kept per 64 px tile; they become the undo data when the stroke ends.
 */
import { clamp01, intersect, union, type Rect } from './geometry';
import type { RGBA } from './color';
import { docRect, growLayerToCover, selectionAlpha, setGeom, writeRegion, type Doc, type Layer, type LayerGeom, type Selection } from './document';
import { geomCommand, patchesCommand, type Command } from './history';

export interface BrushOptions {
  /** Diameter in document pixels. */ size: number;
  /** 0 = soft edge, 1 = hard edge. */ hardness: number;
  /** 0..1, the most a single stroke can cover. */ opacity: number;
  color: RGBA; erase: boolean;
  /** Distance between dabs as a fraction of the diameter. */ spacing?: number;
}
/**
 * A point of the stroke. `size` and `flow` let pen pressure and tilt change each dab. `pressure` (0..1) and `tilt` (0..1)
 * are the pen's own readings, for the brush dynamics (paint-more.ts); the plain brush ignores them.
 */
export interface StrokePoint { x: number; y: number; size?: number; flow?: number; pressure?: number; tilt?: number; }
const T = 64;
export interface Tile { r: Rect; orig: Uint8ClampedArray; mask: Uint8Array; }

export class Stroke {
  readonly layer: Layer;
  protected readonly o: BrushOptions;
  protected readonly clip: Rect | null;
  protected readonly sel: Selection | null;
  protected readonly tiles = new Map<number, Tile>();
  private readonly grownFrom: LayerGeom | null;
  protected readonly cols: number;
  private last: { x: number; y: number; size: number; flow: number } | null = null;
  private carry = 0;
  protected dirty: Rect | null = null;
  protected all: Rect | null = null;

  constructor(doc: Doc, layer: Layer, options: BrushOptions, selection: Selection | null = doc.selection) {
    this.layer = layer;
    this.o = { ...options, color: { ...options.color } };
    this.sel = selection && selection.alpha ? selection : null;
    this.clip = selection ? intersect(selection, docRect(doc)) : docRect(doc);
    this.grownFrom = this.clip ? growLayerToCover(layer, this.clip) : null;
    this.cols = Math.ceil(layer.width / T);
  }
  add(p: StrokePoint): void {
    const size = Math.max(0.5, p.size ?? this.o.size);
    const flow = clamp01(p.flow ?? 1);
    const l = this.last;
    if (!l) { this.dab(p.x, p.y, size, flow); this.last = { x: p.x, y: p.y, size, flow }; return; }
    const dx = p.x - l.x, dy = p.y - l.y, dist = Math.hypot(dx, dy);
    const step = Math.max(0.5, Math.min(size, l.size) * (this.o.spacing ?? 0.12));
    let t = step - this.carry;
    while (t <= dist) {
      const f = dist > 0 ? t / dist : 1;
      this.dab(l.x + dx * f, l.y + dy * f, l.size + (size - l.size) * f, l.flow + (flow - l.flow) * f);
      t += step;
    }
    this.carry = dist - (t - step);
    this.last = { x: p.x, y: p.y, size, flow };
  }
  /** Document area changed since the last call (for redrawing). */
  takeDirty(): Rect | null { const d = this.dirty; this.dirty = null; return d; }
  get touched(): Rect | null { return this.all; }
  get changed(): boolean { return this.tiles.size > 0; }
  /** Finish the stroke and return its undo entry (null when it painted nothing). */
  end(label = this.o.erase ? 'Eraser' : 'Brush stroke'): Command | null {
    const L = this.layer;
    if (!this.tiles.size) { if (this.grownFrom) setGeom(L, this.grownFrom); return null; }
    if (this.grownFrom) return geomCommand(label, L.id, this.grownFrom, { x: L.x, y: L.y, width: L.width, height: L.height, data: L.data });
    return patchesCommand(label, L.id, [...this.tiles.values()].map((t) => ({ r: t.r, before: t.orig })));
  }
  /** Throw the stroke away (for example when a second finger turns it into a pinch). Returns the area to redraw. */
  cancel(): Rect | null {
    for (const t of this.tiles.values()) writeRegion(this.layer, t.r, t.orig);
    if (this.grownFrom) setGeom(this.layer, this.grownFrom);
    this.tiles.clear();
    return this.all;
  }
  protected tile(tx: number, ty: number, key: number): Tile {
    const L = this.layer;
    const r = { x: tx * T, y: ty * T, w: Math.min(T, L.width - tx * T), h: Math.min(T, L.height - ty * T) };
    const orig = new Uint8ClampedArray(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) { const s = ((r.y + y) * L.width + r.x) * 4; orig.set(L.data.subarray(s, s + r.w * 4), y * r.w * 4); }
    const t: Tile = { r, orig, mask: new Uint8Array(r.w * r.h) };
    this.tiles.set(key, t);
    return t;
  }
  /** Paint one round dab (the brush power-ups in paint-more.ts copy, mirror and wrap it). */
  protected dab(cx: number, cy: number, diameter: number, flow: number): void {
    const c = this.clip;
    if (!c) return;
    const r = Math.max(0.5, diameter / 2);
    const x0 = Math.max(c.x, Math.floor(cx - r - 1)), y0 = Math.max(c.y, Math.floor(cy - r - 1));
    const x1 = Math.min(c.x + c.w, Math.ceil(cx + r + 1)), y1 = Math.min(c.y + c.h, Math.ceil(cy + r + 1));
    if (x0 >= x1 || y0 >= y1) return;
    const L = this.layer, data = L.data, lw = L.width;
    const feather = Math.max(1, r * (1 - clamp01(this.o.hardness)));
    const start = r - feather;
    const op = clamp01(this.o.opacity), erase = this.o.erase, col = this.o.color, sel = this.sel;
    let tile: Tile | null = null, tkey = -1, any = false;
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - cy, ly = y - L.y, ty = (ly / T) | 0;
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - cx, d = Math.sqrt(dx * dx + dy * dy);
        let cov: number;
        if (d <= start) cov = 1;
        else { const t = (d - start) / (feather + 0.5); if (t >= 1) continue; cov = 1 - t * t * (3 - 2 * t); }
        let m = cov * flow * 255;
        if (sel) m = (m * selectionAlpha(sel, x, y)) / 255;
        m = Math.round(m);
        if (m <= 0) continue;
        const lx = x - L.x, tx = (lx / T) | 0, key = ty * this.cols + tx;
        if (key !== tkey) { tile = this.tiles.get(key) ?? this.tile(tx, ty, key); tkey = key; }
        const t = tile as Tile;
        const ti = (ly - t.r.y) * t.r.w + (lx - t.r.x);
        if (m <= t.mask[ti]) continue;
        t.mask[ti] = m;
        any = true;
        const oi = ti * 4, di = (ly * lw + lx) * 4, o = t.orig, sa = (m / 255) * op;
        if (erase) {
          data[di] = o[oi]; data[di + 1] = o[oi + 1]; data[di + 2] = o[oi + 2]; data[di + 3] = o[oi + 3] * (1 - sa);
        } else {
          const da = o[oi + 3] / 255, k = da * (1 - sa), oa = sa + k;
          data[di] = (col.r * sa + o[oi] * k) / oa; data[di + 1] = (col.g * sa + o[oi + 1] * k) / oa;
          data[di + 2] = (col.b * sa + o[oi + 2] * k) / oa; data[di + 3] = oa * 255;
        }
      }
    }
    if (any) { const d = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; this.dirty = union(this.dirty, d); this.all = union(this.all, d); }
  }
}
