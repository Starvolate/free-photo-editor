// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { glyphCorners, warpGlyphs, type GlyphBox, type GlyphSpot } from '../src/textwarp';

// Four letters 25 px wide from x 0 to 100 on a baseline at y 100: their middles are at x 12.5, 37.5, 62.5 and 87.5.
const ROW: GlyphBox[] = [0, 25, 50, 75].map((x) => ({ x, w: 25, base: 100 }));
const close = (s: GlyphSpot | null, x: number, y: number, deg: number, sy = 1): void => {
  expect(s).not.toBeNull();
  expect(s!.x).toBeCloseTo(x, 3);
  expect(s!.y).toBeCloseTo(y, 3);
  expect((s!.angle * 180) / Math.PI).toBeCloseTo(deg, 3);
  expect(s!.sy).toBeCloseTo(sy, 3);
};

describe('bent text: each letter on its bend', () => {
  it('no bend leaves every letter where it was', () => {
    const out = warpGlyphs(ROW, { style: 'arc', bend: 0 }, 40);
    out.forEach((s, i) => close(s, 12.5 + 25 * i, 100, 0));
  });

  it('a full arc lays 100 px of letters over half a circle of radius 100/π = 31.831 round (50, 131.831)', () => {
    // The middles sit at −67.5°, −22.5°, 22.5° and 67.5°: x = 50 + 31.831·sin, y = 131.831 − 31.831·cos.
    const out = warpGlyphs(ROW, { style: 'arc', bend: 100 }, 40);
    close(out[0], 20.592, 119.650, -67.5);
    close(out[1], 37.819, 102.423, -22.5);
    close(out[2], 62.181, 102.423, 22.5);
    close(out[3], 79.408, 119.650, 67.5);
  });

  it('a negative arc smiles: the same circle above the line, ends lifted and turned the other way', () => {
    const out = warpGlyphs(ROW, { style: 'arc', bend: -100 }, 40);
    close(out[0], 20.592, 80.350, 67.5);
    close(out[3], 79.408, 80.350, -67.5);
  });

  it('an arch moves letters like the arc but keeps them upright', () => {
    const out = warpGlyphs(ROW, { style: 'arch', bend: 100 }, 40);
    close(out[0], 20.592, 119.650, 0);
    close(out[2], 62.181, 102.423, 0);
  });

  it('a full circle wraps the letters right round a radius of 100/2π = 15.915', () => {
    // −135°, −45°, 45°, 135°: x = 50 + 15.915·sin, y = 115.915 − 15.915·cos.
    const out = warpGlyphs(ROW, { style: 'circle', bend: 100 }, 40);
    close(out[0], 38.746, 127.169, -135);
    close(out[1], 38.746, 104.662, -45);
    close(out[3], 61.254, 127.169, 135);
  });

  it('a second line stays its own distance under the first, across the bend', () => {
    // At −67.5° the second line (40 px lower) runs on a radius 31.831 − 40 = −8.169 from the same centre (through it, so x = 50 + 8.169·sin 67.5°).
    const out = warpGlyphs([...ROW, { x: 0, w: 25, base: 140 }], { style: 'arc', bend: 100 }, 40);
    close(out[4], 50 + 8.169 * Math.sin((67.5 * Math.PI) / 180), 131.831 + 8.169 * Math.cos((67.5 * Math.PI) / 180), -67.5);
  });

  it('a bulge grows the middle letters about a point 0.35 of the size above the baseline', () => {
    // Size 100, bend 100: scale 1 + 0.6·sin(π·u); at u = 0.125 sin = 0.38268 → 1.22961, baseline down 0.35·100·0.22961 = 8.036.
    const out = warpGlyphs(ROW, { style: 'bulge', bend: 100 }, 100);
    close(out[0], 12.5, 108.036, 0, 1.229610);
    close(out[1], 37.5, 119.401, 0, 1.554328);
    expect(warpGlyphs(ROW, { style: 'bulge', bend: -100 }, 100)[1]!.sy).toBeCloseTo(0.445672, 5);
  });

  it('a wave lifts letters by a quarter of the size on two waves across, turned with the slope; a flag stays upright', () => {
    // Size 40, bend 100: amp 10. u = 0.125 → θ = π/2, y = 100 − 10; slope 0 there. u = 0.375 → θ = 3π/2, y = 110.
    const out = warpGlyphs(ROW, { style: 'wave', bend: 100 }, 40);
    close(out[0], 12.5, 90, 0);
    close(out[1], 37.5, 110, 0);
    // One letter at u = 0.5: θ = 2π, y = 100, slope −10·4π/100 = −1.2566 → −51.5°.
    const mid = warpGlyphs([{ x: 0, w: 0, base: 100 }, { x: 50, w: 0, base: 100 }, { x: 100, w: 0, base: 100 }], { style: 'wave', bend: 100 }, 40);
    close(mid[1], 50, 100, (Math.atan(-0.4 * Math.PI) * 180) / Math.PI);
    // A flag: 1.5 waves, u = 0.125 → θ = 3π/8, y = 100 − 10·sin(67.5°) = 90.761.
    close(warpGlyphs(ROW, { style: 'flag', bend: 100 }, 40)[0], 12.5, 90.761, 0);
  });
});

describe('text along a line', () => {
  it('runs along a straight line from where it starts, and drops letters past its end', () => {
    const path = [{ x: 0, y: 0 }, { x: 60, y: 0 }];
    const out = warpGlyphs(ROW, { style: 'path', bend: 0, path, start: 5 }, 40);
    close(out[0], 17.5, 0, 0);
    close(out[1], 42.5, 0, 0);
    expect(out[2]).toBeNull();
    expect(out[3]).toBeNull();
  });

  it('turns round a corner and follows a downward line at 90°, a second line kept to its right', () => {
    const path = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }];
    const out = warpGlyphs([...ROW, { x: 75, w: 25, base: 120 }], { style: 'path', bend: 0, path }, 40);
    close(out[1], 37.5, 0, 0);
    close(out[2], 50, 12.5, 90);
    close(out[3], 50, 37.5, 90);
    // 20 px under the first line: to the right of a line running down is towards −x.
    close(out[4], 30, 37.5, 90);
  });

  it('wraps round a closed ring', () => {
    const ring = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
    const out = warpGlyphs(ROW, { style: 'path', bend: 0, path: ring, closed: true, start: 150 }, 40);
    // 150 + 12.5 = 162.5 round a 160 px ring is 2.5 px along the top.
    close(out[0], 2.5, 0, 0);
    close(out[1], 27.5, 0, 0);
  });

  it('gives the four corners of a turned letter', () => {
    const c = glyphCorners({ x: 10, y: 10, angle: Math.PI / 2, sy: 1 }, 20, 30, 10);
    expect(c.map((p) => [Math.round(p.x) + 0, Math.round(p.y) + 0])).toEqual([[40, 0], [40, 20], [0, 20], [0, 0]]);
  });
});
