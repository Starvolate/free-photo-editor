// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Path operations, each checked against numbers worked out by hand (areas, corners, boxes). */
import { describe, expect, it } from 'vitest';
import { anchorAt, bezierAt, segments, type Subpath } from '../src/path';
import {
  booleanSubpaths, mirrorSubpaths, offsetSubpaths, resample, rotateCopies, roughenSubpaths, spiralSubpath, splitPieces, starSubpath,
  subpathsBounds, traceAlpha, tracedArea, uniteAll,
} from '../src/pathops';

const rect = (x: number, y: number, w: number, h: number): Subpath =>
  ({ closed: true, anchors: [anchorAt(x, y), anchorAt(x + w, y), anchorAt(x + w, y + h), anchorAt(x, y + h)] });
const box = (s: Subpath[]): number[] => { const b = subpathsBounds(s); return b ? [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 100) / 100) : []; };
const count = (s: Subpath[]): number => s.reduce((n, p) => n + p.anchors.length, 0);

describe('combine two shapes (100 px squares overlapping by 50 x 50)', () => {
  const A = [rect(0, 0, 100, 100)], B = [rect(50, 50, 100, 100)];
  it('unite: 100² + 100² − 50² = 17,500 px², an 8-corner outline 150 x 150', () => {
    const u = booleanSubpaths(A, B, 'unite');
    expect(tracedArea(u)).toBeCloseTo(17500, 0);
    expect(box(u)).toEqual([0, 0, 150, 150]);
    expect(u.length).toBe(1);
    expect(count(u)).toBe(8);
  });
  it('subtract: 10,000 − 2,500 = 7,500 px², an L of 6 corners in the first square', () => {
    const s = booleanSubpaths(A, B, 'subtract');
    expect(tracedArea(s)).toBeCloseTo(7500, 0);
    expect(box(s)).toEqual([0, 0, 100, 100]);
    expect(count(s)).toBe(6);
  });
  it('intersect: the 50 x 50 overlap', () => {
    const i = booleanSubpaths(A, B, 'intersect');
    expect(tracedArea(i)).toBeCloseTo(2500, 0);
    expect(box(i)).toEqual([50, 50, 50, 50]);
  });
  it('exclude: 17,500 − 2,500 = 15,000 px² in two L pieces that touch only at corners', () => {
    const x = booleanSubpaths(A, B, 'exclude');
    expect(tracedArea(x)).toBeCloseTo(15000, 0);
    expect(x.length).toBe(2);
  });
  it('a hole survives: a 100 px ring with a 50 px hole is 7,500 px²; cutting off its top half leaves 5,000 − 1,250', () => {
    const ring = [rect(0, 0, 100, 100), rect(25, 25, 50, 50)];
    const u = uniteAll([ring]);
    expect(u.length).toBe(2);
    expect(tracedArea(u)).toBeCloseTo(7500, 0);
    expect(tracedArea(booleanSubpaths(ring, [rect(-10, -10, 120, 60)], 'subtract'))).toBeCloseTo(3750, 0);
  });
});

describe('grow or shrink by a distance', () => {
  it('grows a 100 px square by 10: box −10..110 (within ¾ px), area 100² + 4·100·10 + π·10² (round corners)', () => {
    const g = offsetSubpaths([rect(0, 0, 100, 100)], 10);
    const b = box(g);
    for (const [v, want] of b.map((v, i) => [v, [-10, -10, 120, 120][i]])) expect(Math.abs(v - want), `box ${b}`).toBeLessThanOrEqual(0.75);
    expect(Math.abs(tracedArea(g) - (10000 + 4000 + Math.PI * 100)) / 14314).toBeLessThan(0.01);
  });
  it('shrinks it by 10: an 80 px square, 6,400 px²', () => {
    const s = offsetSubpaths([rect(0, 0, 100, 100)], -10);
    for (const [v, want] of box(s).map((v, i) => [v, [10, 10, 80, 80][i]])) expect(Math.abs(v - want)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(tracedArea(s) - 6400) / 6400).toBeLessThan(0.01);
  });
});

describe('split and mirror', () => {
  it('splits a ring and a square into two pieces; the hole stays with its ring', () => {
    const parts = splitPieces([rect(0, 0, 100, 100), rect(25, 25, 50, 50), rect(200, 0, 10, 10)]);
    expect(parts.map((p) => p.length)).toEqual([2, 1]);
    expect(box(parts[1])).toEqual([200, 0, 10, 10]);
  });
  it('mirrors half an outline across its right edge into one closed outline: (100,0) (0,50) (100,100) + (200,50)', () => {
    const half: Subpath = { closed: false, anchors: [anchorAt(100, 0), anchorAt(0, 50), anchorAt(100, 100)] };
    const m = mirrorSubpaths([half], 'right');
    expect(m.length).toBe(1);
    expect(m[0].closed).toBe(true);
    expect(m[0].anchors.map((a) => [a.x, a.y])).toEqual([[100, 0], [0, 50], [100, 100], [200, 50]]);
  });
  it('mirrors a closed 50 x 100 box across its right edge and joins it into a 100 x 100 square', () => {
    const j = mirrorSubpaths([rect(0, 0, 50, 100)], 'right');
    expect(tracedArea(j)).toBeCloseTo(10000, 0);
    expect(count(j)).toBe(4);
    expect(box(mirrorSubpaths([rect(0, 0, 50, 100)], 'bottom', false)[1] ? [mirrorSubpaths([rect(0, 0, 50, 100)], 'bottom', false)[1]] : [])).toEqual([0, 100, 50, 100]);
  });
});

describe('copies round a centre, wobble, stars and spirals', () => {
  it('four copies of a 10 px square at (100,0) round (0,0) sit at 0°, 90°, 180° and 270°', () => {
    const c = rotateCopies([rect(95, -5, 10, 10)], 4, { x: 0, y: 0 }, false);
    expect(c.map((s) => box([s]).slice(0, 2).map((v) => Math.round(v)))).toEqual([[95, -5], [-5, 95], [-105, -5], [-5, -105]]);
  });
  it('a 100 px square and its 45° turn unite into an 8-point star: 2·100² − 2·100²·tan 22.5° = 11,716 px²', () => {
    const u = rotateCopies([rect(-50, -50, 100, 100)], 8, { x: 0, y: 0 });
    const want = 20000 - 2 * 10000 * Math.tan(Math.PI / 8);
    expect(Math.abs(tracedArea(u) - want) / want, `area ${tracedArea(u)} pieces ${u.length}`).toBeLessThan(0.005);
  });
  it('resamples a 400 px square outline every 10 px into 40 points on its edges', () => {
    const r = resample([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], true, 10);
    expect(r.length).toBe(40);
    expect(r[10]).toEqual({ x: 100, y: 0 });
    expect(r[25]).toEqual({ x: 50, y: 100 });
  });
  it('roughens: no wobble keeps every point on the square; a 5 px wobble moves points by at most 5 px, the same way for the same pattern', () => {
    const sq = [rect(0, 0, 100, 100)];
    const flat = roughenSubpaths(sq, 0, 10)[0].anchors;
    expect(flat.length).toBe(40);
    expect(flat.every((a) => a.x === 0 || a.x === 100 || a.y === 0 || a.y === 100)).toBe(true);
    const w = roughenSubpaths(sq, 5, 10, 7)[0].anchors;
    const moved = w.map((a, i) => Math.hypot(a.x - flat[i].x, a.y - flat[i].y));
    expect(Math.max(...moved)).toBeLessThanOrEqual(5 + 1e-9);
    expect(Math.max(...moved)).toBeGreaterThan(1);
    expect(roughenSubpaths(sq, 5, 10, 7)[0].anchors).toEqual(w);
    expect(roughenSubpaths(sq, 5, 10, 8)[0].anchors).not.toEqual(w);
  });
  it('a 5-point star (outer 100, inner 50): 10 corners, the first tip straight up, the next corner at −54°', () => {
    const s = starSubpath(0, 0, 5, 100, 50);
    expect(s.anchors.length).toBe(10);
    expect(s.anchors[0].x).toBeCloseTo(0, 9);
    expect(s.anchors[0].y).toBeCloseTo(-100, 9);
    expect(s.anchors[1].x).toBeCloseTo(50 * Math.cos((-54 * Math.PI) / 180), 9);
    expect(s.anchors[1].y).toBeCloseTo(50 * Math.sin((-54 * Math.PI) / 180), 9);
  });
  it('a 2-turn spiral from 0 to 100 px: 16 curves, half way at (50,0), the end at (100,0), each curve within 0.5 px of the true spiral', () => {
    const s = spiralSubpath(0, 0, 2, 0, 100);
    expect(s.anchors.length).toBe(17);
    expect(s.anchors[8].x).toBeCloseTo(50, 6);
    expect(s.anchors[8].y).toBeCloseTo(0, 6);
    expect(s.anchors[16].x).toBeCloseTo(100, 6);
    const b = 100 / (4 * Math.PI), dt = (4 * Math.PI) / 16;
    segments(s).forEach((c, i) => {
      const t = (i + 0.5) * dt, r = b * t, p = bezierAt(c, 0.5);
      expect(Math.hypot(p.x - r * Math.cos(t), p.y - r * Math.sin(t))).toBeLessThan(0.5);
    });
  });

  it('traces a mask into an outline in picture pixels, a hole as its own piece', () => {
    // 2 cells per pixel, the mask's corner at picture (10, 20). Cells 2..9 filled, cells 4..7 empty in the middle:
    // a ring whose outside runs from picture 11 to 15 (x) and 21 to 25 (y), its hole from 12 to 14 and 22 to 24.
    const w = 12, a = new Uint8Array(w * w);
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) if (x < 4 || x >= 8 || y < 4 || y >= 8) a[y * w + x] = 255;
    const subs = traceAlpha(a, w, w, 10, 20, 2, 0.25);
    const boxes = subs.map((s) => { const xs = s.anchors.map((q) => q.x), ys = s.anchors.map((q) => q.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })
      .sort((p, q) => p[0] - q[0]);
    expect(subs.length).toBe(2);
    expect(boxes.map((b) => b.map((v) => Math.round(v * 4) / 4))).toEqual([[11, 21, 15, 25], [12, 22, 14, 24]]);
  });
});
