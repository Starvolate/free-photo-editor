// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Batch view-tools: the maths behind the oval, row and column selections, Measure, colour markers, notes, guides, snapping,
 * the pixel grid, print size, composition guides and Select the sharp parts, on numbers and pixels. */
import { describe, expect, it } from 'vitest';
import { countSelected } from '@free-photoeditor/core';
import {
  compositionLines, focusMask, hex, hitGuide, hitPin, lineMask, measure, nextGuide, ovalMask, ovalPoints, pixelGridRange, printZoom, snapPoint,
  type Guide,
} from '../src/viewkit';

describe('Select an oval (elliptical marquee)', () => {
  it('selects the area of the oval inside the dragged box, and a circle with Shift', () => {
    const m = ovalMask(200, 100, { x: 20, y: 10 }, { x: 180, y: 90 });
    expect(countSelected(m) / (Math.PI * 80 * 40)).toBeGreaterThan(0.98);
    expect(countSelected(m) / (Math.PI * 80 * 40)).toBeLessThan(1.02);
    expect(m.data[50 * 200 + 100]).toBe(255);
    expect(m.data[12 * 200 + 22]).toBe(0);
    const pts = ovalPoints({ x: 0, y: 0 }, { x: 60, y: 20 }, true), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(60, 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(60, 0);
  });
  it('works when dragged up and to the left', () => {
    expect(countSelected(ovalMask(100, 100, { x: 90, y: 90 }, { x: 10, y: 10 }))).toBe(countSelected(ovalMask(100, 100, { x: 10, y: 10 }, { x: 90, y: 90 })));
  });
});

describe('Select one row or one column (single row and column marquee)', () => {
  it('selects exactly one pixel line right across or down the picture', () => {
    const row = lineMask(40, 30, 7.6, false), col = lineMask(40, 30, 12.2, true);
    expect(countSelected(row)).toBe(40);
    expect(countSelected(col)).toBe(30);
    expect(row.data[7 * 40]).toBe(255);
    expect(row.data[7 * 40 + 39]).toBe(255);
    expect(col.data[29 * 40 + 12]).toBe(255);
    expect(countSelected(lineMask(40, 30, -5, false))).toBe(40);
    expect(lineMask(40, 30, 99, true).data[39]).toBe(255);
  });
});

describe('Measure (ruler)', () => {
  it('gives the length and the angle as on a protractor', () => {
    const m = measure({ x: 10, y: 50 }, { x: 40, y: 10 });
    expect(m.length).toBe(50);
    expect(m.angle).toBeCloseTo(53.13, 2);
    expect(measure({ x: 0, y: 0 }, { x: -10, y: 0 }).angle).toBeCloseTo(180, 5);
    expect(measure({ x: 0, y: 0 }, { x: 0, y: 10 }).angle).toBeCloseTo(-90, 5);
    expect(measure({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ length: 0, angle: 0, dx: 0, dy: 0 });
  });
});

describe('Guide lines, locking and snapping', () => {
  it('adds new guides down the middle, then across, then at the thirds', () => {
    const g: Guide[] = [];
    for (let i = 0; i < 4; i++) g.push(nextGuide(g, 300, 120));
    expect(g).toEqual([{ dir: 'v', at: 150 }, { dir: 'h', at: 60 }, { dir: 'v', at: 100 }, { dir: 'h', at: 40 }]);
  });
  it('grabs the guide nearest the press, and none while guides are locked', () => {
    const g: Guide[] = [{ dir: 'v', at: 100 }, { dir: 'h', at: 50 }];
    expect(hitGuide(g, { x: 102, y: 10 }, 2, false)).toBe(0);
    expect(hitGuide(g, { x: 10, y: 49 }, 1, false)).toBe(1);
    expect(hitGuide(g, { x: 110, y: 10 }, 1, false)).toBe(-1);
    expect(hitGuide(g, { x: 100, y: 10 }, 1, true)).toBe(-1);
  });
  it('snaps to guides and to the edges and middle, on each axis by itself', () => {
    const g: Guide[] = [{ dir: 'v', at: 70 }, { dir: 'h', at: 33 }];
    expect(snapPoint({ x: 72, y: 31 }, 200, 100, g, 3)).toEqual({ x: 70, y: 33 });
    expect(snapPoint({ x: 98, y: 98 }, 200, 100, g, 3)).toEqual({ x: 100, y: 100 });
    expect(snapPoint({ x: 1.5, y: 20 }, 200, 100, g, 3)).toEqual({ x: 0, y: 20 });
  });
});

describe('Colour markers and sticky notes', () => {
  it('finds the pin under a press within a few screen pixels, and writes colours as hex', () => {
    const pins = [{ x: 10, y: 10 }, { x: 50, y: 50 }];
    expect(hitPin(pins, { x: 51, y: 52 }, 1)).toBe(1);
    expect(hitPin(pins, { x: 30, y: 30 }, 1)).toBe(-1);
    expect(hitPin(pins, { x: 13, y: 10 }, 4)).toBe(-1);
    expect(hex([255, 8, 128, 255])).toBe('#ff0880');
  });
});

describe('Pixel grid, print size and composition guides', () => {
  it('draws pixel edges only for the columns and rows on screen, from 800% up', () => {
    expect(pixelGridRange(4, 0, 0, 800, 600, 1000, 1000)).toBeNull();
    expect(pixelGridRange(10, -200, -50, 800, 600, 1000, 1000)).toEqual({ x0: 20, x1: 100, y0: 5, y1: 65 });
    expect(pixelGridRange(16, 100, 100, 800, 600, 10, 10)).toEqual({ x0: 0, x1: 10, y0: 0, y1: 10 });
  });
  it('shows a 300 dpi picture at a third of its pixels and a 72 dpi one at 4/3', () => {
    expect(printZoom(300)).toBeCloseTo(0.32, 5);
    expect(printZoom(undefined)).toBeCloseTo(96 / 72, 5);
    expect(printZoom(0)).toBeCloseTo(96 / 72, 5);
  });
  it('places thirds and golden-ratio lines', () => {
    expect(compositionLines(0)).toEqual([]);
    expect(compositionLines(1)).toEqual([1 / 3, 2 / 3]);
    expect(compositionLines(2)).toEqual([0.382, 0.618]);
  });
});

describe('Select the sharp parts (focus area)', () => {
  it('selects the detailed half and leaves the smooth half', () => {
    const w = 120, hgt = 80, data = new Uint8ClampedArray(w * hgt * 4);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      const v = x < w / 2 ? ((x >> 1) + (y >> 1)) % 2 ? 230 : 25 : 128 + Math.round((x - w / 2) / 4);
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
    const m = focusMask({ width: w, height: hgt, data });
    let left = 0, right = 0;
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) if (m.data[y * w + x]) { if (x < w / 2 - 6) left++; else if (x >= w / 2 + 6) right++; }
    expect(left / ((w / 2 - 6) * hgt)).toBeGreaterThan(0.95);
    expect(right).toBe(0);
  });
  it('selects nothing in a flat picture', () => {
    expect(countSelected(focusMask({ width: 20, height: 20, data: new Uint8ClampedArray(1600).fill(90) }))).toBe(0);
  });
});
