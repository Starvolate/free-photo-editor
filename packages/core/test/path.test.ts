// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import {
  anchorAt, bezierAt, clonePaths, countAnchors, deleteAnchor, subpathPoints, hitAnchor, hitSegment, makeCorner, makeSmooth, moveAnchor, moveHandle,
  pathBounds, pathData, pathMask, pullHandles, segments, selectionFromMask, selectionToPath, splitSegment, translatePath, type Mask, type Subpath,
  type VectorPath,
} from '../src';

const square = (x: number, y: number, s: number): Subpath =>
  ({ closed: true, anchors: [anchorAt(x, y), anchorAt(x + s, y), anchorAt(x + s, y + s), anchorAt(x, y + s)] });
const path = (...subpaths: Subpath[]): VectorPath => ({ id: 'p', name: 'Test', subpaths });
const sum = (m: Mask): number => m.data.reduce((n, v) => n + v, 0) / 255;
const disc = (w: number, h: number, cx: number, cy: number, r: number, hole = 0): Mask => {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    data[y * w + x] = d <= r && d >= hole ? 255 : 0;
  }
  return { width: w, height: h, data };
};
/** Share of pixels where two masks agree about being at least half selected. */
const agree = (a: Mask, b: Mask): number => {
  let same = 0, any = 0;
  for (let i = 0; i < a.data.length; i++) { const p = a.data[i] >= 128, q = b.data[i] >= 128; if (p || q) { any++; if (p === q) same++; } }
  return any ? same / any : 1;
};

describe('paths', () => {
  it('draws a closed outline of corner points as straight sides, and fills it as a selection', () => {
    const p = path(square(10, 10, 40));
    expect(segments(p.subpaths[0])).toHaveLength(4);
    expect(subpathPoints(p.subpaths[0])).toHaveLength(4);
    expect(pathBounds(p)).toEqual({ x: 10, y: 10, w: 40, h: 40 });
    expect(pathData(p)).toBe('M10 10 L50 10 L50 50 L10 50 L10 10 Z');
    expect(sum(pathMask(p, 64, 64))).toBeCloseTo(1600, 0);
    const sel = selectionFromMask(pathMask(p, 64, 64));
    expect(sel && { x: sel.x, y: sel.y, w: sel.w, h: sel.h, alpha: sel.alpha }).toEqual({ x: 10, y: 10, w: 40, h: 40, alpha: null });
  });

  it('fills every subpath with the even-odd rule, so a ring keeps its hole; an open subpath closes itself', () => {
    const ring = path(square(0, 0, 60), square(20, 20, 20));
    const m = pathMask(ring, 64, 64);
    expect(sum(m)).toBeCloseTo(3600 - 400, 0);
    expect(m.data[30 * 64 + 30]).toBe(0);
    const open = path({ closed: false, anchors: [anchorAt(0, 0), anchorAt(40, 0), anchorAt(40, 40)] });
    expect(sum(pathMask(open, 64, 64))).toBeCloseTo(800, 0);
  });

  it('pulls matched handles, keeps a smooth point smooth, and lets a handle move alone into a corner', () => {
    const a = anchorAt(50, 50);
    pullHandles(a, 70, 50);
    expect([a.inX, a.inY, a.outX, a.outY, a.smooth]).toEqual([30, 50, 70, 50, true]);
    moveHandle(a, 'out', 50, 80);
    expect(a.inX).toBeCloseTo(50); expect(a.inY).toBeCloseTo(30);
    moveHandle(a, 'in', 10, 50, true);
    expect([a.inX, a.inY, a.outX, a.outY, a.smooth]).toEqual([10, 50, 50, 80, false]);
    moveAnchor(a, 5, -5);
    expect([a.x, a.y, a.inX, a.inY, a.outX, a.outY]).toEqual([55, 45, 15, 45, 55, 75]);
    makeCorner(a);
    expect([a.inX, a.outY, a.smooth]).toEqual([55, 45, false]);
  });

  it('adds a point on a curve without moving the curve, and removes points', () => {
    const s: Subpath = { closed: false, anchors: [anchorAt(0, 0), anchorAt(100, 0)] };
    pullHandles(s.anchors[0], 30, 60);
    pullHandles(s.anchors[1], 130, -40);
    const before = segments(s)[0];
    const idx = splitSegment(s, 0, 0.3);
    expect(idx).toBe(1);
    expect(s.anchors).toHaveLength(3);
    const mid = bezierAt(before, 0.3);
    expect(s.anchors[1].x).toBeCloseTo(mid.x, 6); expect(s.anchors[1].y).toBeCloseTo(mid.y, 6);
    expect(s.anchors[1].smooth).toBe(true);
    for (const t of [0.1, 0.2, 0.25]) { const q = bezierAt(segments(s)[0], t / 0.3), r = bezierAt(before, t); expect(Math.hypot(q.x - r.x, q.y - r.y)).toBeLessThan(1e-6); }
    for (const t of [0.5, 0.8, 0.95]) { const q = bezierAt(segments(s)[1], (t - 0.3) / 0.7), r = bezierAt(before, t); expect(Math.hypot(q.x - r.x, q.y - r.y)).toBeLessThan(1e-6); }
    const line = square(0, 0, 10);
    expect(splitSegment(line, 3, 0.5)).toBe(4);
    expect(line.anchors[4]).toMatchObject({ x: 0, y: 5, smooth: false });
    deleteAnchor(line, 4);
    expect(line.anchors).toHaveLength(4);
    deleteAnchor(line, 0); deleteAnchor(line, 0); deleteAnchor(line, 0);
    expect(line.closed).toBe(false);
  });

  it('finds points, handles and lines near the pointer, anchors first', () => {
    const s = square(0, 0, 100);
    pullHandles(s.anchors[1], 120, 0);
    const p = path(s);
    expect(hitAnchor(p, { x: 101, y: 1 }, 5)).toMatchObject({ sub: 0, idx: 1, part: 'anchor' });
    expect(hitAnchor(p, { x: 119, y: 2 }, 5)).toMatchObject({ idx: 1, part: 'out' });
    expect(hitAnchor(p, { x: 119, y: 2 }, 5, false)).toBeNull();
    expect(hitAnchor(p, { x: 50, y: 50 }, 5)).toBeNull();
    const h = hitSegment(p, { x: 2, y: 50 }, 5);
    expect(h).toMatchObject({ sub: 0, seg: 3 });
    expect(h?.t).toBeCloseTo(0.5, 2);
    expect(hitSegment(p, { x: 50, y: 50 }, 5)).toBeNull();
  });

  it('makes automatic smooth handles from the neighbours, and moves a whole path', () => {
    const s = square(0, 0, 90);
    makeSmooth(s, 1);
    const a = s.anchors[1];
    expect(a.smooth).toBe(true);
    expect(a.inX).toBeCloseTo(90 - 30 * Math.SQRT1_2, 6); expect(a.outY).toBeCloseTo(30 * Math.SQRT1_2, 6);
    const p = path(s), copy = clonePaths([p])[0];
    translatePath(p, 10, 20);
    expect(p.subpaths[0].anchors[0]).toMatchObject({ x: 10, y: 20 });
    expect(copy.subpaths[0].anchors[0]).toMatchObject({ x: 0, y: 0 });
    expect(countAnchors(copy)).toBe(4);
  });

  it('turns a box selection into four corners and a round one into a smooth closed outline that fills back the same', () => {
    const box = selectionToPath({ x: 5, y: 6, w: 30, h: 20, alpha: null });
    expect(box?.work).toBe(true);
    expect(box?.subpaths[0].anchors.map((a) => [a.x, a.y, a.smooth])).toEqual([[5, 6, false], [35, 6, false], [35, 26, false], [5, 26, false]]);
    const m = disc(120, 100, 60, 50, 40), sel = selectionFromMask(m);
    const p = selectionToPath(sel!);
    expect(p?.subpaths).toHaveLength(1);
    const sp = p!.subpaths[0];
    expect(sp.closed).toBe(true);
    expect(sp.anchors.length).toBeGreaterThan(6);
    expect(sp.anchors.length).toBeLessThan(40);
    expect(sp.anchors.every((a) => a.smooth)).toBe(true);
    expect(agree(pathMask(p!, 120, 100), m)).toBeGreaterThan(0.97);
  });

  it('keeps a hole when a ring selection becomes a path and back, and keeps squared corners as corners', () => {
    const m = disc(120, 120, 60, 60, 50, 25), p = selectionToPath(selectionFromMask(m)!)!;
    expect(p.subpaths).toHaveLength(2);
    const back = pathMask(p, 120, 120);
    expect(back.data[60 * 120 + 60]).toBe(0);
    expect(agree(back, m)).toBeGreaterThan(0.95);
    const L = new Uint8Array(40 * 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) L[y * 40 + x] = x < 20 || y >= 20 ? 255 : 0;
    const lp = selectionToPath({ x: 0, y: 0, w: 40, h: 40, alpha: L })!;
    expect(lp.subpaths[0].anchors).toHaveLength(6);
    expect(lp.subpaths[0].anchors.every((a) => !a.smooth)).toBe(true);
    expect(selectionToPath({ x: 0, y: 0, w: 4, h: 4, alpha: new Uint8Array(16) })).toBeNull();
  });
});
