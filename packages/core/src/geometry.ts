// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Whole-pixel rectangles and small number helpers shared by the engine. */
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Point { x: number; y: number; }

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
}
export const contains = (o: Rect, i: Rect): boolean => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
export function rectFromPoints(a: Point, b: Point): Rect {
  const x0 = Math.floor(Math.min(a.x, b.x)), y0 = Math.floor(Math.min(a.y, b.y));
  const x1 = Math.ceil(Math.max(a.x, b.x)), y1 = Math.ceil(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const expandRect = (r: Rect, n: number): Rect => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });
export const isEmptyRect = (r: Rect | null | undefined): boolean => !r || r.w <= 0 || r.h <= 0;
export function roundRect(r: Rect): Rect {
  const x0 = Math.floor(r.x), y0 = Math.floor(r.y);
  return { x: x0, y: y0, w: Math.ceil(r.x + r.w) - x0, h: Math.ceil(r.y + r.h) - y0 };
}
