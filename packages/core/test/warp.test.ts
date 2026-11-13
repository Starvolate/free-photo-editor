// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { carryQuad, createDocument, fitCanvas, layersBox, quadOfRect, type Bitmap } from '../src/index';
import { runEffect } from '../src/fx/index';
import { gridAt, gridOf, lagrange4, meanValue, meshDraw, mls } from '../src/warp';

/** A w × h opaque picture whose red value names the column and green the row (10 × column, 10 × row). */
function ramp(w: number, h: number): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([10 * x, 10 * y, 77, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}
const px = (b: { width: number }, d: Uint8ClampedArray, x: number, y: number): number[] => Array.from(d.slice((y * b.width + x) * 4, (y * b.width + x) * 4 + 4));
/** Every grid handle moved right by `dx` percent. */
const shifted = (dx: number): Record<string, number> => {
  const p: Record<string, number> = {};
  gridOf({}).forEach(([x, y], k) => { p[`g${k}x`] = x + dx; p[`g${k}y`] = y; });
  return p;
};

describe('the 4 × 4 grid', () => {
  it('passes through its handles (cubic weights checked by hand)', () => {
    expect(lagrange4(1 / 3).map((v) => +v.toFixed(12))).toEqual([0, 1, 0, 0]);
    // At the middle: (-1/16, 9/16, 9/16, -1/16).
    expect(lagrange4(0.5).map((v) => +v.toFixed(12))).toEqual([-0.0625, 0.5625, 0.5625, -0.0625]);
    const g = gridOf({});
    expect(gridAt(g, 0.25, 0.75).map((v) => +v.toFixed(9))).toEqual([25, 75]);
    const bent = gridOf({ g5x: 50, g5y: 20 });
    expect(gridAt(bent, 1 / 3, 1 / 3).map((v) => +v.toFixed(9))).toEqual([50, 20]);
  });
  it('gives the picture back untouched with the handles where they start', () => {
    const src = ramp(7, 5);
    expect(Array.from(runEffect({ kind: 'mesh-warp', params: {} }, src))).toEqual(Array.from(src.data));
    expect(Array.from(meshDraw(src, { x: 0, y: 0, w: 7, h: 5 }, (x, y) => [x, y], 4))).toEqual(Array.from(src.data));
  });
  it('moves the picture with the handles, and what it uncovers turns see-through', () => {
    // 5 pixels wide: 100% is 4 pixels, so 25% is one pixel to the right.
    const src = ramp(5, 3), out = runEffect({ kind: 'mesh-warp', params: shifted(25) }, src);
    expect(px(src, out, 3, 1)).toEqual([20, 10, 77, 255]);
    expect(px(src, out, 1, 2)).toEqual([0, 20, 77, 255]);
    expect(px(src, out, 0, 1)[3]).toBe(0);
  });
  it('bends only inside the edited box and keeps every pixel outside it', () => {
    const src = ramp(8, 6), out = runEffect({ kind: 'mesh-warp', params: { ...shifted(50), ix: 2, iy: 1, iw: 3, ih: 4 } }, src);
    // Box columns 2..4: 50% of 2 pixels is one pixel, so column 3 shows column 2.
    expect(px(src, out, 3, 2)).toEqual([20, 20, 77, 255]);
    expect(px(src, out, 2, 2)[3]).toBe(0);
    expect(px(src, out, 6, 2)).toEqual([60, 20, 77, 255]);
    expect(px(src, out, 3, 0)).toEqual([30, 0, 77, 255]);
  });
});

describe('re-angle a flat surface', () => {
  it('keeps the picture when the corners stay, and moves it when they move together', () => {
    const src = ramp(5, 5);
    expect(Array.from(runEffect({ kind: 'perspective-warp', params: {} }, src))).toEqual(Array.from(src.data));
    const p: Record<string, number> = {};
    [[25, 25], [75, 25], [75, 75], [25, 75]].forEach(([x, y], i) => { p[`b${i}x`] = x + 25; p[`b${i}y`] = y; });
    const out = runEffect({ kind: 'perspective-warp', params: p }, src);
    expect(px(src, out, 2, 3)).toEqual([10, 30, 77, 255]);
    expect(px(src, out, 0, 0)[3]).toBe(0);
  });
});

describe('pins (moving least squares)', () => {
  it('moves everything along with one pin, and lands every pin on its target', () => {
    expect(mls([[3, 4]], [[5, 1]], 10, 10)).toEqual([12, 7]);
    const from: [number, number][] = [[0, 0], [10, 0], [4, 8]], to: [number, number][] = [[1, 1], [12, 3], [2, 9]];
    for (let i = 0; i < 3; i++) expect(mls(from, to, from[i][0], from[i][1])).toEqual(to[i]);
  });
  it('turns the picture when two pins turn a quarter round (worked by hand)', () => {
    // Pins at (0, 0) and (10, 0) dragged to (0, 0) and (0, 10): (5, 5) goes to (-5, 5).
    const r = mls([[0, 0], [10, 0]], [[0, 0], [0, 10]], 5, 5);
    expect(r.map((v) => +v.toFixed(9))).toEqual([-5, 5]);
    // Pulled apart to twice the distance: rigid keeps the size (moves by the shift of the centre), stretchy doubles it.
    expect(mls([[0, 0], [10, 0]], [[0, 0], [20, 0]], 5, 5, true).map((v) => +v.toFixed(9))).toEqual([10, 5]);
    expect(mls([[0, 0], [10, 0]], [[0, 0], [20, 0]], 5, 5, false).map((v) => +v.toFixed(9))).toEqual([10, 10]);
  });
  it('bends real pixels: one pin dragged one pixel right moves the picture one pixel', () => {
    const src = ramp(5, 5), out = runEffect({ kind: 'pin-warp', params: { n: 1, p0x: 50, p0y: 50, q0x: 75, q0y: 50 } }, src);
    expect(px(src, out, 3, 2)).toEqual([20, 20, 77, 255]);
    expect(Array.from(runEffect({ kind: 'pin-warp', params: { n: 0 } }, src))).toEqual(Array.from(src.data));
  });
});

describe('the cage (mean value coordinates)', () => {
  it('weighs a square evenly at its middle, sums to one and rebuilds the point', () => {
    expect(meanValue([[0, 0], [1, 0], [1, 1], [0, 1]], 0.5, 0.5).map((v) => +v.toFixed(12))).toEqual([0.25, 0.25, 0.25, 0.25]);
    const poly: [number, number][] = [[0, 0], [4, 0], [5, 3], [2, 5], [-1, 3]], w = meanValue(poly, 1.3, 2.1);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(w.reduce((a, b, i) => a + b * poly[i][0], 0)).toBeCloseTo(1.3, 12);
    expect(w.reduce((a, b, i) => a + b * poly[i][1], 0)).toBeCloseTo(2.1, 12);
    expect(meanValue([[0, 0], [2, 0], [2, 2], [0, 2]], 1, 0)).toEqual([0.5, 0.5, 0, 0]);
  });
  it('moves the part inside the cage, clears where it was and keeps the rest', () => {
    // 9 × 9: 100% is 8 pixels. The cage is the square 0..4, moved 2 pixels right.
    const src = ramp(9, 9), p: Record<string, number> = { n: 4, step: 1 };
    [[0, 0], [50, 0], [50, 50], [0, 50]].forEach(([x, y], i) => { p[`o${i}x`] = x; p[`o${i}y`] = y; p[`c${i}x`] = x + 25; p[`c${i}y`] = y; });
    const out = runEffect({ kind: 'cage-warp', params: p }, src);
    expect(px(src, out, 4, 2)).toEqual([20, 20, 77, 255]);
    expect(px(src, out, 1, 2)[3]).toBe(0);
    expect(px(src, out, 7, 7)).toEqual([70, 70, 77, 255]);
  });
});

describe('repeat the last transform and fit the canvas', () => {
  it('repeats a transform from where the layer is now', () => {
    const half = carryQuad(quadOfRect({ x: 0, y: 0, w: 200, h: 100 }), quadOfRect({ x: 0, y: 0, w: 100, h: 50 }), { x: 0, y: 0, w: 100, h: 50 });
    expect(half?.map((c) => [+c.x.toFixed(9), +c.y.toFixed(9)])).toEqual([[0, 0], [50, 0], [50, 25], [0, 25]]);
    const moved = carryQuad(quadOfRect({ x: 0, y: 0, w: 10, h: 10 }), quadOfRect({ x: 30, y: 0, w: 10, h: 10 }), { x: 30, y: 0, w: 10, h: 10 });
    expect(moved?.[0].x).toBeCloseTo(60, 9);
  });
  it('fits the canvas round every layer without deleting anything, as one undo step', () => {
    const d = createDocument(100, 50, { r: 0, g: 0, b: 255, a: 255 });
    d.layers[0].x = -10;
    expect(layersBox(d)).toEqual({ x: -10, y: 0, w: 100, h: 50 });
    // Same size, only shifted: the layer moves back to 0 and the canvas keeps 100 × 50.
    const c = fitCanvas(d, layersBox(d)!);
    expect([d.width, d.height, d.layers[0].x, d.layers[0].width]).toEqual([100, 50, 0, 100]);
    c?.undo(d);
    expect(d.layers[0].x).toBe(-10);
    const s = fitCanvas(d, { x: 20, y: 10, w: 30, h: 20 });
    expect([d.width, d.height, d.layers[0].x, d.layers[0].y, d.layers[0].width]).toEqual([30, 20, -30, -10, 100]);
    s?.undo(d);
    expect(fitCanvas(createDocument(10, 10, { r: 0, g: 0, b: 255, a: 255 }), { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  });
});
