// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Batch tools: the maths behind Turn the view, Crop and straighten and Trace along edges, on numbers and pixels worked by hand. */
import { describe, expect, it } from 'vitest';
import { createDocument, type Doc, type Quad } from '@free-photoeditor/core';
import { dragTurn, edgeAt, edgePath, lumaOf, perspectiveCrop, snapToEdge, quadGrid, quadOk, quadSize, startQuad, turnDegrees, turnPoint, unturnPoint, wrapTurn } from '../src/toolkit-more';

const deg = (d: number): number => (d * Math.PI) / 180;

describe('Turn the view (rotate view)', () => {
  it('turns a screen point a quarter turn about the centre, worked by hand', () => {
    // Centre (100, 50); the point 10 px right of it goes 10 px below it after +90° (y grows downward on screen).
    const p = turnPoint(110, 50, 100, 50, deg(90));
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.y).toBeCloseTo(60, 9);
    const q = turnPoint(100, 40, 100, 50, deg(90)); // 10 px above -> 10 px right
    expect(q.x).toBeCloseTo(110, 9);
    expect(q.y).toBeCloseTo(50, 9);
    // 180°: (130, 70) -> mirrored through the centre to (70, 30).
    const r = turnPoint(130, 70, 100, 50, deg(180));
    expect(r.x).toBeCloseTo(70, 9);
    expect(r.y).toBeCloseTo(30, 9);
  });
  it('turns a screen point back to the very same picture point (screen -> picture -> screen)', () => {
    for (const a of [-170, -45, 0, 30, 90, 179]) {
      const t = turnPoint(321.5, 87.25, 640, 400, deg(a)), back = unturnPoint(t.x, t.y, 640, 400, deg(a));
      expect(back.x).toBeCloseTo(321.5, 9);
      expect(back.y).toBeCloseTo(87.25, 9);
    }
  });
  it('keeps the angle between -180° and 180°, and snaps to 15° steps with Shift', () => {
    expect(turnDegrees(deg(190))).toBe(-170);
    expect(turnDegrees(deg(-190))).toBe(170);
    expect(turnDegrees(deg(360))).toBe(0);
    expect(wrapTurn(deg(180))).toBeCloseTo(Math.PI, 9);
    // Started at 10°, the pointer swept from 0° to 40°: 50°; with Shift, the nearest 15° step is 45°.
    expect(turnDegrees(dragTurn(deg(10), 0, deg(40), false))).toBe(50);
    expect(turnDegrees(dragTurn(deg(10), 0, deg(40), true))).toBe(45);
  });
});

/** A 100 × 100 picture: black left of x = 50, white from x = 50 (one pixel layer, fully opaque). */
function halves(): Doc {
  const d = createDocument(100, 100), l = d.layers[0];
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) { const i = (y * 100 + x) * 4, v = x < 50 ? 0 : 255; l.data[i] = v; l.data[i + 1] = v; l.data[i + 2] = v; l.data[i + 3] = 255; }
  return d;
}
const px = (d: Doc, x: number, y: number): number => d.layers[0].data[(y * d.layers[0].width + x) * 4];

describe('Crop and straighten (perspective crop)', () => {
  it('sizes the result by the longer of each pair of opposite edges', () => {
    // Top 60, bottom 80; left and right both sqrt(10² + 80²) = 80.62.
    expect(quadSize([{ x: 20, y: 10 }, { x: 80, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }])).toEqual({ w: 80, h: 81 });
    expect(startQuad(200, 100)).toEqual([{ x: 20, y: 10 }, { x: 180, y: 10 }, { x: 180, y: 90 }, { x: 20, y: 90 }]);
  });
  it('refuses a twisted or flat quad', () => {
    expect(quadOk([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(true);
    expect(quadOk([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
    expect(quadOk([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
  });
  it('a straight box is a plain crop: the pixels land exactly', () => {
    const d = createDocument(100, 100), l = d.layers[0];
    for (let i = 0; i < 100 * 100; i++) { l.data[i * 4] = i % 100; l.data[i * 4 + 1] = Math.floor(i / 100); l.data[i * 4 + 2] = 7; l.data[i * 4 + 3] = 255; }
    const cmd = perspectiveCrop(d, [{ x: 10, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 50 }, { x: 10, y: 50 }]);
    expect(cmd?.label).toBe('Crop and straighten');
    expect([d.width, d.height]).toEqual([50, 30]);
    const o = d.layers[0].data;
    expect([o[0], o[1], o[2], o[3]]).toEqual([10, 20, 7, 255]); // (0, 0) was (10, 20)
    const j = (29 * 50 + 49) * 4;
    expect([o[j], o[j + 1]]).toEqual([59, 49]); // (49, 29) was (59, 49)
  });
  it('straightens a trapezoid: the middle line of the slanted shape becomes the middle of the result', () => {
    const d = halves();
    const q: Quad = [{ x: 20, y: 10 }, { x: 80, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
    const cmd = perspectiveCrop(d, q);
    expect([d.width, d.height]).toEqual([80, 81]);
    // The shape is mirror-symmetric about x = 50, so x = 50 in the picture maps to x = 40 in the result.
    for (const y of [0, 20, 40, 60, 80]) {
      expect(px(d, 5, y)).toBe(0);
      expect(px(d, 38, y)).toBe(0);
      expect(px(d, 41, y)).toBe(255);
      expect(px(d, 75, y)).toBe(255);
    }
    // One undo puts the picture back as it was, size and pixels.
    cmd?.undo(d);
    expect([d.width, d.height]).toEqual([100, 100]);
    const fresh = halves().layers[0].data;
    expect(d.layers[0].data).toEqual(fresh);
    cmd?.redo(d);
    expect([d.width, d.height]).toEqual([80, 81]);
  });
  it('draws the grid inside the quad through its perspective', () => {
    const g = quadGrid([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }]);
    expect(g).toHaveLength(4);
    expect(g[0][0].x).toBeCloseTo(10, 6);
    expect(g[1][0].y).toBeCloseTo(10, 6);
  });
});

describe('Trace along edges (edge-snapping lasso)', () => {
  // 40 x 40: black where x < 20, white from x = 20 on. Brightness 0 | 255.
  const W = 40, H = 40, px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const v = i % W < 20 ? 0 : 255; px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
  const L = lumaOf(px, W, H);
  it('measures the edge only on the two columns that meet it, worked by hand', () => {
    expect(L[19]).toBe(0);
    expect(L[20]).toBeCloseTo(255, 3);
    // Central difference: at x = 19, L(20) - L(18) = 255; at x = 20, L(21) - L(19) = 255; one column further out, 0.
    expect(edgeAt(L, W, H, 19, 7)).toBeCloseTo(255, 3);
    expect(edgeAt(L, W, H, 20, 7)).toBeCloseTo(255, 3);
    expect(edgeAt(L, W, H, 18, 7)).toBe(0);
    expect(edgeAt(L, W, H, 21, 7)).toBe(0);
    // See-through counts as dark: a white pixel at alpha 0 has brightness 0.
    expect(lumaOf(new Uint8ClampedArray([255, 255, 255, 0]), 1, 1)[0]).toBe(0);
  });
  it('snaps a point 3 px away onto the edge, the nearer of the two edge columns', () => {
    expect(snapToEdge(L, W, H, { x: 16.4, y: 5.2 }, 8)).toEqual({ x: 19, y: 5 });
    expect(snapToEdge(L, W, H, { x: 22.9, y: 30 }, 8)).toEqual({ x: 20, y: 30 });
    // Out of reach (radius 4 from x = 12): no edge, so the point stays on its own pixel.
    expect(snapToEdge(L, W, H, { x: 12.5, y: 9.5 }, 4)).toEqual({ x: 12, y: 9 });
  });
  it('follows the edge from one end to the other: every point on x = 19 or 20, each a neighbour of the last', () => {
    const a = snapToEdge(L, W, H, { x: 16, y: 5 }, 8), b = snapToEdge(L, W, H, { x: 23, y: 35 }, 8);
    const path = edgePath(L, W, H, a, b);
    expect(path[0]).toEqual({ x: 19, y: 5 });
    expect(path[path.length - 1]).toEqual({ x: 20, y: 35 });
    for (const q of path) expect([19, 20], JSON.stringify(q)).toContain(q.x);
    for (let k = 1; k < path.length; k++) expect(Math.max(Math.abs(path[k].x - path[k - 1].x), Math.abs(path[k].y - path[k - 1].y))).toBe(1);
    // 30 rows down and one column across: 30 steps, so 31 points.
    expect(path).toHaveLength(31);
    // A box too big for the limit falls back to the straight line.
    expect(edgePath(L, W, H, a, b, 20, 10)).toEqual([a, b]);
  });
});
