// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Batch tools, part 1: the maths behind Turn the view and Crop and straighten, on numbers and pixels worked by hand. */
import { describe, expect, it } from 'vitest';
import { createDocument, type Doc, type Quad } from '@free-photoeditor/core';
import { dragTurn, perspectiveCrop, quadGrid, quadOk, quadSize, startQuad, turnDegrees, turnPoint, unturnPoint, wrapTurn } from '../src/toolkit-more';

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
