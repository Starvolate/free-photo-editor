// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { applyLook, fillShape, glyphCorners, hardEdges, replaceText, shapeSpans, stretchKeyword, warpGlyphs, type GlyphBox, type GlyphSpot } from '../src/textwarp';
import { DEFAULT_TEXT_STYLE, fontString, type TextStyle } from '../src/vector';

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

  it('stacks up-down letters one size apart, and starts each further line one line-gap to the left', () => {
    // "AB" on the first line (baseline 20), "C" on the next (baseline 44), size 20: columns at x 10 and 10 - 24 = -14.
    const gs: GlyphBox[] = [{ x: 0, w: 10, base: 20 }, { x: 10, w: 12, base: 20 }, { x: 0, w: 8, base: 44 }];
    expect(warpGlyphs(gs, { style: 'vertical', bend: 0 }, 20)).toEqual([
      { x: 10, y: 20, angle: 0, sy: 1 }, { x: 10, y: 40, angle: 0, sy: 1 }, { x: -14, y: 20, angle: 0, sy: 1 }]);
  });
  it('cuts letter edges at half for sharp text, keeping the colour', () => {
    const d = new Uint8ClampedArray([9, 9, 9, 0, 9, 9, 9, 127, 9, 9, 9, 128, 9, 9, 9, 255]);
    expect([...hardEdges(d)]).toEqual([9, 9, 9, 0, 9, 9, 9, 0, 9, 9, 9, 255, 9, 9, 9, 255]);
  });
  it('finds and replaces exactly, or ignoring capitals, with special characters as plain letters', () => {
    expect(replaceText('Cat cat CAT', 'cat', 'dog')).toEqual({ text: 'Cat dog CAT', count: 1 });
    expect(replaceText('Cat cat CAT', 'cat', 'dog', false)).toEqual({ text: 'dog dog dog', count: 3 });
    expect(replaceText('a.b.c', '.', '$&')).toEqual({ text: 'a$&b$&c', count: 2 });
    expect(replaceText('abc', '', 'x')).toEqual({ text: 'abc', count: 0 });
  });
});

describe('text that fills a shape, letter widths and saved looks (part 5)', () => {
  // "aaaa bbbb cccc": every letter (and space) 10 px wide in one straight line from x 0; size 20, lines 24 apart.
  const text = 'aaaa bbbb cccc', chars = [...text], gs: GlyphBox[] = chars.map((_, i) => ({ x: i * 10, w: 10, base: 16 }));
  const o = { size: 20, advance: 24, align: 'left' as const };
  const spots = (r: (GlyphSpot | null)[]): (number[] | null)[] => r.map((s) => (s ? [s.x, s.y] : null));
  it('finds the runs inside an outline at a height', () => {
    // A right triangle (0,0) (100,0) (0,100): at height y the inside runs from 0 to 100 − y.
    expect(shapeSpans([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], 20)).toEqual([[0, 80]]);
    // A ring from two squares (0..100 and 40..60): two runs either side of the hole.
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }, { x: 40, y: 40 }, { x: 40, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 40 }, { x: 40, y: 40 }];
    expect(shapeSpans(ring, 50)).toEqual([[0, 40], [60, 100]]);
  });
  it('wraps words into a box 95 wide: two words fit on the first line, the third goes under', () => {
    const box = [{ x: 0, y: 0 }, { x: 95, y: 0 }, { x: 95, y: 100 }, { x: 0, y: 100 }];
    // Baselines at 0.8 × 20 = 16, then 16 + 24 = 40; each letter's middle is 5 past its left edge; spaces are not drawn.
    expect(spots(fillShape(gs, chars, box, o))).toEqual([[5, 16], [15, 16], [25, 16], [35, 16], null, [55, 16], [65, 16], [75, 16], [85, 16], null,
      [5, 40], [15, 40], [25, 40], [35, 40]]);
    // Centred: the first line is 90 wide in 95, so it starts 2.5 in; the second is 40 wide, so it starts 27.5 in.
    const mid = spots(fillShape(gs, chars, box, { ...o, align: 'center' }));
    expect([mid[0], mid[5], mid[10]]).toEqual([[7.5, 16], [57.5, 16], [32.5, 40]]);
  });
  it('narrows the lines down a triangle, breaks a long word, and hides what does not fit', () => {
    const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    // Line 1 (band 1..20) has 80 inside: "aaaa". Line 2 (band 25..44) has 56: "bbbb". Line 3 (band 49..68) has 32: only
    // "ccc" (30). Line 4 (band 73..92) has 8, less than one letter size, so it is skipped; line 5 would pass the bottom.
    expect(spots(fillShape(gs, chars, tri, o))).toEqual([[5, 16], [15, 16], [25, 16], [35, 16], null, [5, 40], [15, 40], [25, 40], [35, 40], null,
      [5, 64], [15, 64], [25, 64], null]);
  });
  it('starts each paragraph on a new line', () => {
    const two = [...'ab'].map((_, i) => ({ x: i * 10, w: 10, base: 16 })).concat([...'cd'].map((_, i) => ({ x: i * 10, w: 10, base: 40 })));
    const box = [{ x: 0, y: 0 }, { x: 95, y: 0 }, { x: 95, y: 100 }, { x: 0, y: 100 }];
    expect(spots(fillShape(two, [...'abcd'], box, o))).toEqual([[5, 16], [15, 16], [5, 40], [15, 40]]);
  });
  it('maps a width to the nearest word a browser knows, and writes the weight into the font', () => {
    expect([stretchKeyword(100), stretchKeyword(80), stretchKeyword(140), stretchKeyword(40), stretchKeyword(300)])
      .toEqual(['normal', 'condensed', 'extra-expanded', 'ultra-condensed', 'ultra-expanded']);
    const st: TextStyle = { ...DEFAULT_TEXT_STYLE, font: 'serif', size: 30 };
    expect(fontString(st)).toBe('400 30px serif');
    expect(fontString({ ...st, bold: true })).toBe('700 30px serif');
    expect(fontString({ ...st, bold: true, weight: 350, italic: true })).toBe('italic 350 30px serif');
  });
  it('puts a saved look on a style: everything, only the letters, or only the lines', () => {
    const mine: TextStyle = { ...DEFAULT_TEXT_STYLE, font: 'serif', size: 20, color: '#111111', align: 'left', lineHeight: 1.2 };
    const look: TextStyle = { ...DEFAULT_TEXT_STYLE, font: 'monospace', size: 64, color: '#ff0000', bold: true, align: 'center', lineHeight: 2, weight: 800 };
    expect(applyLook(mine, look, 'all')).toEqual(look);
    expect(applyLook(mine, look, 'letters')).toEqual({ ...look, align: 'left', lineHeight: 1.2 });
    expect(applyLook(mine, look, 'lines')).toEqual({ ...mine, align: 'center', lineHeight: 2 });
  });
});
