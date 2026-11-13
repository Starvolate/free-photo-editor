// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Liquify's field, seam carving, frequency separation and deblur (core/warp.ts), each against numbers worked out by hand. */
import { describe, expect, it } from 'vitest';
import { compositeDoc, createDocument, createLayer, type Bitmap } from '../src/index';
import { runEffect } from '../src/fx/index';
import { falloff, fieldAt, liquifyDab, liquifyDraw, newField, textureLayer } from '../src/warp';

const grey = (vals: number[], h = 1): Bitmap => {
  const w = vals.length, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) vals.forEach((v, x) => data.set([v, v, v, 255], (y * w + x) * 4));
  return { width: w, height: h, data };
};
const row = (out: Uint8ClampedArray, n: number): number[] => Array.from({ length: n }, (_, x) => out[x * 4]);

describe('Push pixels like liquid (Liquify)', () => {
  it('a huge push of (2, 0) moves the centre by exactly (−2, 0)', () => {
    const f = newField(21, 21);
    liquifyDab(f, 'push', 10, 10, 1000, 1, 2, 0);
    expect(fieldAt(f, 10, 10)[0]).toBeCloseTo(-2, 5);
    expect(fieldAt(f, 10, 10)[1]).toBeCloseTo(0, 5);
  });
  it('a bloat of radius 8 and strength 0.2 moves a point 4 px right of the centre by −0.45', () => {
    expect(falloff(16, 8, 0.2)).toBeCloseTo(0.1125, 6);
    const f = newField(21, 21);
    liquifyDab(f, 'bloat', 10, 10, 8, 0.2);
    expect(f.dx[10 * 21 + 14]).toBeCloseTo(-0.45, 5);
    expect(f.dy[10 * 21 + 14]).toBeCloseTo(0, 5);
    // Shrink is the mirror image, and Undo the push at full strength puts the point back.
    const g = newField(21, 21);
    liquifyDab(g, 'pucker', 10, 10, 8, 0.2);
    expect(g.dx[10 * 21 + 14]).toBeCloseTo(0.45, 5);
    liquifyDab(f, 'restore', 10, 10, 1000, 1);
    expect(f.dx[10 * 21 + 14]).toBeCloseTo(0, 3);
  });
  it('a half-size field of −2 everywhere shifts the full-size picture right by 4', () => {
    const vals = Array.from({ length: 16 }, (_, x) => x * 10), src = grey(vals, 2), f = newField(8, 1);
    f.dx.fill(-2);
    const out = liquifyDraw(src, f);
    for (let x = 4; x < 16; x++) expect(Math.abs(out[x * 4] - vals[x - 4]), `x ${x}`).toBeLessThanOrEqual(1);
    // The edge smears instead of turning see-through.
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(255);
  });
});

describe('Stretch without squashing people (seam carving)', () => {
  const carve = (vals: number[], tw: number, extra = {}): number[] => row(runEffect({ kind: 'seam-scale', params: { tw, ...extra } }, grey(vals)), tw);
  it('takes out the plainest pixels to narrow', () => {
    expect(carve([50, 50, 50, 200, 200, 200], 4)).toEqual([50, 200, 200, 200]);
  });
  it('keeps a protected box whole', () => {
    expect(carve([50, 50, 50, 200, 200, 200], 4, { px: 0, py: 0, pw: 2, ph: 1 })).toEqual([50, 50, 50, 200]);
  });
  it('doubles the plainest pixels to widen', () => {
    const out = runEffect({ kind: 'seam-scale', params: { w: 4, tw: 5 } }, grey([0, 0, 0, 200, 9]));
    expect(row(out, 5)).toEqual([0, 0, 0, 0, 200]);
  });
  it('narrows a picture in height too, and clears the rest of the box', () => {
    const src = grey([10, 20, 30], 6), out = runEffect({ kind: 'seam-scale', params: { th: 4 } }, src);
    expect(row(out, 3)).toEqual([10, 20, 30]);
    for (let x = 0; x < 3; x++) { expect(out[(3 * 3 + x) * 4 + 3]).toBe(255); expect(out[(4 * 3 + x) * 4 + 3]).toBe(0); }
  });
});

describe('Smooth a face by detail layers (frequency separation)', () => {
  it('texture is (original − blur)/2 + 127.5, rounded: 200 over 150 gives 153, and 150 + 306 − 255 = 201', () => {
    expect(Array.from(textureLayer([200, 200, 200, 255], [150, 150, 150, 255]))).toEqual([153, 153, 153, 255]);
  });
  it('the blurred layer under the texture in Linear light gives the original back within 1', () => {
    const W = 6, orig = new Uint8ClampedArray(W * 4), blur = new Uint8ClampedArray(W * 4);
    [200, 10, 128, 255, 0, 77].forEach((v, x) => { orig.set([v, 255 - v, (v * 3) % 256, 255], x * 4); blur.set([150, 60, 128, 200, 40, 90].map((b) => [b, 255 - b, 100, 255])[x], x * 4); });
    const d = createDocument(W, 1), base = createLayer('Photo', W, 1, { data: orig.slice() }), lo = createLayer('Colour and tone', W, 1, { data: blur });
    const hi = createLayer('Texture', W, 1, { data: textureLayer(orig, blur) });
    hi.blendMode = 'linear-light';
    d.layers = [base, lo, hi];
    const out = compositeDoc(d, { x: 0, y: 0, w: W, h: 1 });
    for (let i = 0; i < orig.length; i++) if (i % 4 !== 3) expect(Math.abs(out[i] - orig[i]), `channel ${i}`).toBeLessThanOrEqual(1);
  });
});

describe('Fix a blurry photo (deblur)', () => {
  it('leaves a flat picture exactly as it was', () => {
    const src = grey(Array(12).fill(97), 9), out = runEffect({ kind: 'deblur', params: { size: 2, rounds: 10 } }, src);
    expect(Array.from(out)).toEqual(Array.from(src.data));
  });
  it('brings a blurred step closer to the sharp step', () => {
    const sharp = Array.from({ length: 24 }, (_, x) => (x < 12 ? 40 : 220));
    // The step blurred by hand with the same even blur deblur assumes (a Gaussian of 1 px), rounded to whole levels.
    const k = [-3, -2, -1, 0, 1, 2, 3].map((i) => Math.exp(-(i * i) / 2)), s = k.reduce((a, b) => a + b, 0);
    const soft = sharp.map((_, x) => Math.round(k.reduce((a, w, j) => a + (w / s) * sharp[Math.max(0, Math.min(23, x + j - 3))], 0)));
    const blurred = grey(soft, 4).data;
    const run = (rounds: number): Uint8ClampedArray => runEffect({ kind: 'deblur', params: { size: 1, rounds } }, { width: 24, height: 4, data: blurred });
    const err = (d: ArrayLike<number>): number => sharp.reduce((s, v, x) => s + Math.abs(d[(24 + x) * 4] - v), 0);
    const e0 = err(blurred), e8 = err(run(8)), e30 = err(run(30));
    // More rounds get closer still; each round is one more correction.
    expect(e8, `${e8} against ${e0}`).toBeLessThan(e0);
    expect(e30, `${e30} against ${e8}`).toBeLessThan(e8);
  });
});
