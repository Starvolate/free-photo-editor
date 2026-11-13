// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Smart layers: a layer that keeps its original picture, where its corners land, and a list of live filters. The layer's
 * own pixels are only the finished picture (a cache), rebuilt from the original every time one of those changes, so
 * making it smaller and then bigger again gives back the original pixels exactly. Loaded on first use (`./smart`); the
 * web module calls `installSmartHooks()` so Free transform and Picture size reach smart layers.
 */
import { SMART, findLayer, type Bitmap, type Doc, type Layer, type SmartLayer } from './document';
import { homography, mapPoint, quadBounds, quadOfRect, warpBitmap, warpMask, type Placed, type Quad } from './transform';
import { resizeBitmap } from './imageops';
import { runJob, type JobSpec } from './jobs';
import { runEffect } from './fx';
import type { Rect } from './geometry';
import type { Command } from './history';

/** Runs one live filter over a picture. */
export type FilterRun = (spec: JobSpec, src: Bitmap) => Uint8ClampedArray;
/** The menu's own engines: the effects engine for `op: 'fx'` (box, motion, lens blur, smart sharpen, …), the job engine for the
 * rest (smooth blur, sharpen). `runJob` alone throws on 'fx', so Picture size on a layer with a live box blur needs this. */
export const plainRun: FilterRun = (spec, src) => (spec.op === 'fx' ? runEffect(spec, src) : runJob(spec, src));
/** How far outside the canvas a smart layer's picture is kept: one canvas size on every side. */
export const keepArea = (doc: Doc): Rect => { const pad = Math.max(doc.width, doc.height); return { x: -pad, y: -pad, w: doc.width + 2 * pad, h: doc.height + 2 * pad }; };

/** The quad as a whole-pixel box when it is upright, not mirrored and lands on whole pixels; otherwise null. */
export function uprightBox(q: Quad, eps = 1e-3): Rect | null {
  const x0 = Math.round(q[0].x), y0 = Math.round(q[0].y), x1 = Math.round(q[2].x), y1 = Math.round(q[2].y);
  if (x1 <= x0 || y1 <= y0) return null;
  const n = (a: number, b: number): boolean => Math.abs(a - b) < eps;
  return n(q[0].x, x0) && n(q[3].x, x0) && n(q[1].x, x1) && n(q[2].x, x1) && n(q[0].y, y0) && n(q[1].y, y0) && n(q[2].y, y1) && n(q[3].y, y1)
    ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
/**
 * The original on a quad whose corners sit on whole pixels with its sides along the axes: upright, quarter-turned or mirrored
 * (all 8 ways). Each pixel is copied, never blended, so turning and flipping back gives the same bytes. Null for any other quad.
 */
export function gridPlace(src: Bitmap, q: Quad, eps = 1e-3): Placed | null {
  if (!q.every((p) => Math.abs(p.x - Math.round(p.x)) < eps && Math.abs(p.y - Math.round(p.y)) < eps)) return null;
  const [a, b, c, d] = q.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  // e: where the original's top edge runs, f: where its left edge runs. Each lies along one axis, and they differ.
  const ex = b.x - a.x, ey = b.y - a.y, fx = d.x - a.x, fy = d.y - a.y;
  if (!!ex === !!ey || !!fx === !!fy || !!ex === !!fx || c.x !== b.x + fx || c.y !== b.y + fy) return null;
  const sw = Math.abs(ex + ey), sh = Math.abs(fx + fy), W = ex ? sw : sh, H = ex ? sh : sw;
  const x0 = Math.min(a.x, c.x), y0 = Math.min(a.y, c.y), img = sw === src.width && sh === src.height ? src.data : resizeBitmap(src, sw, sh);
  if (ex > 0 && fy > 0) return { x: x0, y: y0, width: W, height: H, data: img === src.data ? img.slice() : img };
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x0 + x + 0.5 - a.x, py = y0 + y + 0.5 - a.y, u = Math.floor((px * ex + py * ey) / sw), v = Math.floor((px * fx + py * fy) / sh), j = (v * sw + u) * 4;
    out.set(img.subarray(j, j + 4), (y * W + x) * 4);
  }
  return { x: x0, y: y0, width: W, height: H, data: out };
}
/** The original picture with its corners on `q` (document space). On whole pixels along the axes it is copied, else warped. */
export function placeSource(src: Bitmap, q: Quad, limit?: Rect): Placed | null {
  return gridPlace(src, q) ?? warpBitmap(src, q, true, limit);
}
/** The smart layer's corners in document space, for a layer at (x, y). */
export const docQuad = (s: SmartLayer, x: number, y: number): Quad => s.quad.map((p) => ({ x: p.x + x, y: p.y + y })) as Quad;
/** Build the finished picture: the original, placed on the document-space quad `q`, then every live filter that is on. */
export function renderSmart(s: SmartLayer, q: Quad, run: FilterRun = plainRun, limit?: Rect): { geom: Placed; smart: SmartLayer } | null {
  const g = placeSource(s.source, q, limit);
  if (!g) return null;
  if (s.filtersOn !== false) for (const f of s.filters) if (f.on) g.data = run(f.spec, g);
  return { geom: g, smart: { ...s, quad: q.map((p) => ({ x: p.x - g.x, y: p.y - g.y })) as Quad } };
}

/** The fields a smart change swaps, both ways. */
const KEYS = ['kind', 'smart', 'content', 'x', 'y', 'width', 'height', 'data', 'mask'] as const;
export type SmartState = Pick<Layer, (typeof KEYS)[number]>;
export function smartState(l: Layer): SmartState {
  const s: Record<string, unknown> = {};
  for (const k of KEYS) if (l[k] !== undefined) s[k] = l[k];
  return s as unknown as SmartState;
}
function setState(l: Layer, s: SmartState): void {
  const o = l as unknown as Record<string, unknown>, from = s as unknown as Record<string, unknown>;
  for (const k of KEYS) { if (from[k] === undefined) delete o[k]; else o[k] = from[k]; }
}
/** One undo step that swaps a layer's smart state (kind, original, quad, filters, cache, mask) both ways. */
export function smartCommand(label: string, layerId: string, before: SmartState, after: SmartState): Command {
  const extra = after.smart && after.smart.source !== before.smart?.source ? after.smart.source.data.length : 0;
  return {
    label, bytes: after.data.length + (after.data !== before.data ? before.data.length : 0) + extra,
    undo(doc) { const l = findLayer(doc, layerId); if (l) setState(l, before); },
    redo(doc) { const l = findLayer(doc, layerId); if (l) setState(l, after); },
  };
}
/** True for a layer that can become a smart layer: a plain picture, text or shape layer. */
export const canMakeSmart = (l: Layer | undefined): boolean => !!l && (!l.kind || l.kind === 'pixel');
/** Make a smart layer: the current pixels become the kept original, drawn where they are now (nothing changes on screen). */
export function convertToSmart(l: Layer): Command | null {
  if (!canMakeSmart(l)) return null;
  const before = smartState(l);
  const smart: SmartLayer = { source: { width: l.width, height: l.height, data: l.data.slice() }, quad: quadOfRect({ x: 0, y: 0, w: l.width, h: l.height }), filters: [] };
  setState(l, { ...before, kind: 'smart', smart, content: undefined });
  return smartCommand('Make a smart layer', l.id, before, smartState(l));
}
/** Turn back into pixels: the finished picture stays, the original and the live filters go. */
export function rasterizeSmart(l: Layer): Command | null {
  if (l.kind !== 'smart') return null;
  const before = smartState(l);
  setState(l, { ...before, kind: undefined, smart: undefined, data: l.data.slice() });
  return smartCommand('Turn back into pixels', l.id, before, smartState(l));
}
/** Redraw a smart layer after its quad or its filters change, as one undo step. */
export function updateSmart(doc: Doc, l: Layer, smart: SmartLayer, q: Quad, label: string, run: FilterRun = plainRun): Command | null {
  const r = renderSmart(smart, q, run, keepArea(doc));
  if (!r) return null;
  const before = smartState(l);
  setState(l, { ...before, ...r.geom, smart: r.smart });
  return smartCommand(label, l.id, before, smartState(l));
}
/** Free transform on a smart layer: the original's corners follow the same map, and the picture is redrawn from it. */
export function transformSmart(doc: Doc, l: Layer, to: Quad, label = 'Free transform', run: FilterRun = plainRun): Command | null {
  const s = l.smart;
  if (!s) return null;
  const H = homography(quadOfRect({ x: l.x, y: l.y, w: l.width, h: l.height }), to);
  if (!H) return null;
  const q = docQuad(s, l.x, l.y).map((p) => mapPoint(H, p.x, p.y)) as Quad;
  const limit = keepArea(doc), r = renderSmart(s, q, run, limit);
  if (!r) return null;
  const before = smartState(l), mb = l.mask;
  const ma = mb?.linked ? warpMask(mb, { x: l.x, y: l.y, width: l.width, height: l.height }, to, true, limit) : mb;
  setState(l, { ...before, ...r.geom, smart: r.smart, mask: ma });
  return smartCommand(label, l.id, before, smartState(l));
}
/** Picture size on a smart layer: the corners scale with the picture, and it is redrawn from the original. */
export function resizeSmart(l: Layer, sx: number, sy: number, run: FilterRun = plainRun): Partial<Layer> | null {
  const s = l.smart;
  if (!s) return null;
  const q = docQuad(s, l.x, l.y).map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
  const b = quadBounds(q);
  const r = renderSmart(s, q, run, { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 });
  return r ? { ...r.geom, smart: r.smart } : null;
}
/**
 * A quarter turn or flip of a smart layer: each corner moves inside the box `r` the way the pixels do (imageops turnPixels), the
 * box landing with its top-left at (nx, ny), and the picture is redrawn from the original. Turning back gives the same bytes.
 */
export function turnSmart(l: Layer, t: string, r: Rect, nx: number, ny: number, run: FilterRun = plainRun): Partial<Layer> | null {
  const s = l.smart;
  if (!s) return null;
  const q = docQuad(s, l.x, l.y).map((p) => {
    const u = p.x - r.x, v = p.y - r.y;
    const [x, y] = t === 'cw' ? [r.h - v, u] : t === 'ccw' ? [v, r.w - u] : t === '180' ? [r.w - u, r.h - v] : t === 'flip-h' ? [r.w - u, v] : [u, r.h - v];
    return { x: nx + x, y: ny + y };
  }) as Quad;
  const b = quadBounds(q), g = renderSmart(s, q, run, { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 });
  return g ? { ...g.geom, smart: g.smart } : null;
}
/** Lets Free transform, Picture size and the turns (always loaded) reach smart layers once this module is loaded. */
export function installSmartHooks(run: FilterRun = plainRun): void {
  SMART.transform = (doc, l, to, label) => transformSmart(doc, l, to as Quad, label, run);
  SMART.resize = (l, sx, sy) => resizeSmart(l, sx, sy, run);
  SMART.turn = (l, t, r, nx, ny) => turnSmart(l, t, r, nx, ny, run);
}
