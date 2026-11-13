// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Path operations, part 2: slice, hatch lines, stitch lines, in-between shapes, repeat and bend along a line, thick and thin strokes, dashes and arrowheads. Every number is worked out by hand in its comment. */
import { describe, expect, it } from 'vitest';
import { anchorAt, type Subpath } from '../src/path';
import { comicPanels, envelopeCorners, envelopeSubpaths } from '../src/pathops';
import {
  arrowHead, dashLine, divideSubpaths, hatchSubpaths, interpolateSubpaths, patternAlong, powerStroke, ringPoints, stitchSubpaths, subpathsBounds, tracedArea,
} from '../src/pathops';

const rect = (x: number, y: number, w: number, h: number): Subpath => ({ closed: true, anchors: [anchorAt(x, y), anchorAt(x + w, y), anchorAt(x + w, y + h), anchorAt(x, y + h)] });
const line = (...p: [number, number][]): Subpath => ({ closed: false, anchors: p.map(([x, y]) => anchorAt(x, y)) });
const len = (s: Subpath): number => { const p = ringPoints(s); let n = 0; for (let i = 1; i < p.length; i++) n += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return n; };
const box = (subs: Subpath[]): number[] => { const b = subpathsBounds(subs); return b ? [b.x, b.y, b.x + b.w, b.y + b.h].map((v) => Math.round(v * 100) / 100) : []; };

describe('slice a shape along another (divide)', () => {
  it('cuts a 100 px square by an overlapping one into the part outside (7,500 px²) and the overlap (2,500 px²)', () => {
    const g = divideSubpaths([rect(0, 0, 100, 100)], [rect(50, 50, 100, 100)]);
    expect(g.length).toBe(2);
    const areas = g.map(tracedArea).sort((a, b) => a - b);
    expect(Math.abs(areas[0] - 2500)).toBeLessThan(30);
    expect(Math.abs(areas[1] - 7500)).toBeLessThan(30);
  });
  it('a band across a 300 × 100 bar leaves three pieces of 10,000 px² each', () => {
    const g = divideSubpaths([rect(0, 0, 300, 100)], [rect(100, -50, 100, 200)]);
    expect(g.length).toBe(3);
    for (const a of g.map(tracedArea)) expect(Math.abs(a - 10000)).toBeLessThan(60);
  });
});

describe('hatch lines', () => {
  it('fills a 100 px square with 10 level lines 10 px apart, at y = 5, 15 … 95, each 100 px long', () => {
    const h = hatchSubpaths([rect(0, 0, 100, 100)], 10, 0);
    expect(h.length).toBe(10);
    expect(h.map((s) => s.anchors[0].y)).toEqual([5, 15, 25, 35, 45, 55, 65, 75, 85, 95]);
    expect(h.every((s) => !s.closed && s.anchors.length === 2 && Math.abs(len(s) - 100) < 1e-9)).toBe(true);
  });
  it('keeps a hole empty: lines at y 25 … 75 cross a 60 px hole and split in two (16 lines, 4·100 + 12·20 = 640 px)', () => {
    const h = hatchSubpaths([rect(0, 0, 100, 100), rect(20, 20, 60, 60)], 10, 0);
    expect(h.length).toBe(16);
    expect(h.reduce((n, s) => n + len(s), 0)).toBeCloseTo(640, 6);
  });
  it('turns the lines to 90° (upright) and crosses them (20 lines)', () => {
    const up = hatchSubpaths([rect(0, 0, 100, 100)], 10, 90);
    expect(up.length).toBe(10);
    expect(up.every((s) => Math.abs(s.anchors[0].x - s.anchors[1].x) < 1e-6 && Math.abs(len(s) - 100) < 1e-6)).toBe(true);
    expect(hatchSubpaths([rect(0, 0, 100, 100)], 10, 0, true).length).toBe(20);
  });
});

describe('stitch lines between two lines', () => {
  it('joins two level 100 px lines 50 px apart with 5 upright lines at x = 0, 25, 50, 75, 100', () => {
    const s = stitchSubpaths(line([0, 0], [100, 0]), line([0, 50], [100, 50]), 5);
    expect(s.map((q) => q.anchors[0].x)).toEqual([0, 25, 50, 75, 100]);
    expect(s.every((q) => q.anchors[0].y === 0 && q.anchors[1].y === 50 && q.anchors[1].x === q.anchors[0].x)).toBe(true);
  });
});

describe('in-between shapes (interpolate)', () => {
  // Squares of side 20 and 60 round (100, 100): halfway is a square of side 40, 1,600 px², four corners.
  it('blends a small square into a big one: one step is the 40 px square', () => {
    const [mid] = interpolateSubpaths(rect(90, 90, 20, 20), rect(70, 70, 60, 60), 1);
    expect(mid.anchors.length).toBe(4);
    expect(tracedArea([mid])).toBeCloseTo(1600, 6);
    expect(box([mid])).toEqual([80, 80, 120, 120]);
  });
  it('matches a ring drawn the other way round, so the steps never twist', () => {
    const big = rect(70, 70, 60, 60), back: Subpath = { closed: true, anchors: big.anchors.slice().reverse() };
    expect(tracedArea(interpolateSubpaths(rect(90, 90, 20, 20), back, 1))).toBeCloseTo(1600, 6);
  });
  it('three steps between two level lines 100 px apart sit at y = 25, 50, 75', () => {
    const s = interpolateSubpaths(line([0, 0], [100, 0]), line([100, 100], [0, 100]), 3);
    expect(s.map((q) => q.anchors.map((a) => Math.round(a.y)))).toEqual([[25, 25], [50, 50], [75, 75]]);
    expect(s.map((q) => [q.anchors[0].x, q.anchors[1].x])).toEqual([[0, 100], [0, 100], [0, 100]]);
  });
});

describe('repeat or bend a shape along a line', () => {
  it('lays ten 10 px squares along a level 100 px line, centred on it (1,000 px² in all)', () => {
    const out = patternAlong([rect(0, 0, 10, 10)], line([0, 100], [100, 100]));
    expect(out.length).toBe(10);
    expect(tracedArea(out)).toBeCloseTo(1000, 6);
    expect(box([out[0]])).toEqual([0, 95, 10, 105]);
    expect(box([out[9]])).toEqual([90, 95, 100, 105]);
    expect(out.every((s) => s.anchors.length === 4)).toBe(true);
  });
  it('a 5 px gap fits 7 copies (7·15 − 5 = 100)', () => {
    expect(patternAlong([rect(0, 0, 10, 10)], line([0, 100], [100, 100]), 5).length).toBe(7);
  });
  it('bends the copies round a circle of radius 100: 63 copies, every point 95 to 105 px from the centre', () => {
    const circle: Subpath = { closed: true, anchors: Array.from({ length: 360 }, (_, i) => anchorAt(200 + 100 * Math.cos((i * Math.PI) / 180), 200 + 100 * Math.sin((i * Math.PI) / 180))) };
    const out = patternAlong([rect(0, 0, 10, 10)], circle);
    expect(out.length).toBe(63);
    const r = out.flatMap((s) => s.anchors.map((a) => Math.hypot(a.x - 200, a.y - 200)));
    expect(Math.min(...r)).toBeGreaterThan(94.9);
    expect(Math.max(...r)).toBeLessThan(105.1);
  });
  it('bend stretches one copy over the whole line: a 10 px square becomes 100 × 10 (1,000 px²)', () => {
    const out = patternAlong([rect(0, 0, 10, 10)], line([0, 100], [100, 100]), 0, true);
    expect(out.length).toBe(1);
    expect(box(out)).toEqual([0, 95, 100, 105]);
    expect(tracedArea(out)).toBeCloseTo(1000, 6);
  });
});

describe('thick and thin strokes (power stroke)', () => {
  it('an even 10 px width along a 100 px line is a 100 × 10 bar (1,000 px², four corners)', () => {
    const [o] = powerStroke(line([0, 0], [100, 0]), 10, 10, 10);
    expect(o.closed).toBe(true);
    expect(o.anchors.length).toBe(4);
    expect(tracedArea([o])).toBeCloseTo(1000, 6);
  });
  it('0 → 10 → 0 px is two triangles of ½·50·10 = 250 px² each (500 px²)', () => {
    expect(tracedArea(powerStroke(line([0, 0], [100, 0]), 0, 10, 0))).toBeCloseTo(500, 6);
  });
});

describe('dashes and arrowheads', () => {
  it('a 10 px dash and 5 px gap along 100 px gives 7 dashes (0–10, 15–25 … 90–100), 70 px drawn', () => {
    const d = dashLine([{ x: 0, y: 0 }, { x: 100, y: 0 }], false, [10, 5]);
    expect(d.map((p) => [p[0].x, p[p.length - 1].x].map((v) => Math.round(v * 1e6) / 1e6))).toEqual([[0, 10], [15, 25], [30, 40], [45, 55], [60, 70], [75, 85], [90, 100]]);
  });
  it('a dash round a corner keeps the corner', () => {
    const [first] = dashLine([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], false, [15, 100]);
    expect(first).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]);
  });
  it('dots every 10 px along 100 px are 10 dots; no gap means one solid line', () => {
    const dots = dashLine([{ x: 0, y: 0 }, { x: 100, y: 0 }], false, [0, 10]);
    expect(dots.map((p) => p[0].x)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(dashLine([{ x: 0, y: 0 }, { x: 100, y: 0 }], false, [5, 0]).length).toBe(1);
  });
  it('a 20 px arrowhead at the end of a level line has its tip at (100, 0) and its base at x = 80, 10 px each side', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(arrowHead(pts, false, 20)).toEqual([{ x: 100, y: 0 }, { x: 80, y: 10 }, { x: 80, y: -10 }]);
    expect(arrowHead(pts, true, 20).map((p) => [p.x + 0, p.y + 0])).toEqual([[0, 0], [20, -10], [20, 10]]);
  });
});

describe('comic panels', () => {
  it('fills a 960 x 640 page with 2 rows of 3 panels, 40 px in from the edge and 20 px apart, in reading order', () => {
    // Width: (960 - 2·40 - 2·20) / 3 = 280 per panel. Height: (640 - 2·40 - 20) / 2 = 270 per panel.
    const p = comicPanels(960, 640, 2, 3, 20, 40), xy = (s: Subpath) => s.anchors.map((a) => [a.x, a.y]);
    expect(p.length).toBe(6);
    expect(p.every((s) => s.closed && s.anchors.length === 4)).toBe(true);
    expect(xy(p[0])).toEqual([[40, 40], [320, 40], [320, 310], [40, 310]]);
    expect(xy(p[1])).toEqual([[340, 40], [620, 40], [620, 310], [340, 310]]);
    expect(xy(p[5])).toEqual([[640, 330], [920, 330], [920, 600], [640, 600]]);
  });
  it('gives nothing when the gaps and margins leave no room, and rounds rows and columns to at least 1', () => {
    expect(comicPanels(100, 100, 2, 2, 80, 10)).toEqual([]); // (100 - 2·10 - 80) / 2 = 0 px per panel
    expect(comicPanels(100, 100, 0, 0.4, 5, 10).map((s) => s.anchors.map((a) => [a.x, a.y]))).toEqual([[[10, 10], [90, 10], [90, 90], [10, 90]]]);
  });
});

describe('tilt an outline in perspective (envelope)', () => {
  /** Where the diagonals q0 to q2 and q1 to q3 cross. */
  const cross = (q: { x: number; y: number }[]): number[] => {
    const [a, b, c, d] = q, r = { x: c.x - a.x, y: c.y - a.y }, s = { x: d.x - b.x, y: d.y - b.y };
    const t = ((b.x - a.x) * s.y - (b.y - a.y) * s.x) / (r.x * s.y - r.y * s.x);
    return [a.x + t * r.x, a.y + t * r.y];
  };
  const at = (subs: Subpath[], i: number, j = 0): number[] => [subs[i].anchors[j].x, subs[i].anchors[j].y];
  it('leans a 100 px square back 20%: the top corners move 10 px in; the centre lands at (50, 400/9), where the diagonals cross', () => {
    const b = { x: 0, y: 0, w: 100, h: 100 }, q = envelopeCorners(b, 20, 0);
    expect(q.map((p) => [p.x, p.y])).toEqual([[10, 0], [90, 0], [100, 100], [0, 100]]);
    const out = envelopeSubpaths([rect(0, 0, 100, 100), line([50, 50]), line([0, 50])], b, q);
    out[0].anchors.forEach((a, i) => { expect(a.x).toBeCloseTo(q[i].x, 9); expect(a.y).toBeCloseTo(q[i].y, 9); });
    // The centre: w = 1 - 0.2 * 0.5 = 0.9, so x = (40 - 5 + 10) / 0.9 = 50 and y = 40 / 0.9 = 400/9; the diagonals cross at t = 4/9.
    expect(at(out, 1)[0]).toBeCloseTo(50, 9);
    expect(at(out, 1)[1]).toBeCloseTo(400 / 9, 9);
    expect(cross(q)[0]).toBeCloseTo(50, 9);
    expect(cross(q)[1]).toBeCloseTo(400 / 9, 9);
    // The middle of the left edge stays on the straight line from (10, 0) to (0, 100): (50/9, 400/9).
    expect(at(out, 2)[0]).toBeCloseTo(50 / 9, 9);
    expect(at(out, 2)[1]).toBeCloseTo(400 / 9, 9);
  });
  it('turns a 200 x 100 box 50%: the right side shrinks to 25..75 and the centre moves to (400/3, 50), towards the far side', () => {
    const b = { x: 0, y: 0, w: 200, h: 100 }, q = envelopeCorners(b, 0, 50);
    expect(q.map((p) => [p.x, p.y])).toEqual([[0, 0], [200, 25], [200, 75], [0, 100]]);
    const out = envelopeSubpaths([line([100, 50])], b, q);
    expect(at(out, 0)[0]).toBeCloseTo(400 / 3, 9);
    expect(at(out, 0)[1]).toBeCloseTo(50, 9);
  });
  it('with both sliders, the box corners land on the new corners and the centre where the diagonals cross; 0 and 0 change nothing', () => {
    const b = { x: 20, y: 10, w: 300, h: 150 }, q = envelopeCorners(b, -30, -60);
    // Lean -30%: the bottom edge 45 px in at each end; turn -60%: the left side 45 px in at each end.
    expect(q.map((p) => [p.x, p.y])).toEqual([[20, 55], [320, 10], [275, 160], [65, 115]]);
    const out = envelopeSubpaths([rect(20, 10, 300, 150), line([170, 85])], b, q);
    out[0].anchors.forEach((a, i) => { expect(a.x).toBeCloseTo(q[i].x, 9); expect(a.y).toBeCloseTo(q[i].y, 9); });
    expect(at(out, 1)[0]).toBeCloseTo(cross(q)[0], 9);
    expect(at(out, 1)[1]).toBeCloseTo(cross(q)[1], 9);
    const same = envelopeSubpaths([rect(20, 10, 300, 150)], b, envelopeCorners(b, 0, 0));
    expect(same[0].anchors.map((a) => [a.x, a.y])).toEqual([[20, 10], [320, 10], [320, 160], [20, 160]]);
    // 200% is held at 90%: the top corners of a 100 px box 45 px in.
    expect(envelopeCorners({ x: 0, y: 0, w: 100, h: 100 }, 200, 0).slice(0, 2).map((p) => [p.x, p.y])).toEqual([[45, 0], [55, 0]]);
  });
});
