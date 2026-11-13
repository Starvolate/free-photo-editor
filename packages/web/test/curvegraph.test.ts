// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { CHANS, PRESETS, XS, pointsOf, presetIndex, valueAt } from '../src/curvegraph';

describe('Tone curve graph (UI-D)', () => {
  it('maps a place on the graph to a value: top white, bottom black', () => {
    expect([valueAt(0), valueAt(0.5), valueAt(1), valueAt(-1), valueAt(2)]).toEqual([255, 128, 0, 255, 0]);
  });
  it('reads the five points of each curve, unset points on the straight line', () => {
    expect(pointsOf({}, 'r')).toEqual([...XS]);
    expect(pointsOf({ p2: 150, r1: 90 }, 'p')).toEqual([0, 64, 150, 192, 255]);
    expect(pointsOf({ p2: 150, r1: 90 }, 'r')).toEqual([0, 90, 128, 192, 255]);
    expect(CHANS.map((c) => c[0])).toEqual(['p', 'r', 'g', 'b']);
  });
  it('names each ready shape, and none for a shape of your own', () => {
    PRESETS.forEach(([, ys], k) => expect(presetIndex(ys)).toBe(k));
    expect(PRESETS[0][1]).toEqual([...XS]);
    expect(presetIndex([0, 64, 129, 192, 255])).toBe(-1);
    for (const [, ys] of PRESETS) for (let i = 1; i < 5; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
  });
});
