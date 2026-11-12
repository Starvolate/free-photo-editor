// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { History, adjust, applyToLayer, brightnessContrastLut, createDocument, gaussianBlur, runJob, sharpen, type Bitmap } from '../src/index';

const img = (w: number, h: number, f: (x: number, y: number) => number[]): Bitmap => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number): boolean => {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) return false;
  return a.length === b.length;
};

describe('adjustments and filters', () => {
  const src = img(16, 2, (x, y) => [x * 16, 255 - x * 16, (x * 40 + y * 90) % 256, 200]).data;
  it('invert twice is the identity and keeps alpha', () => {
    const once = adjust(src, 'invert');
    expect(once[0]).toBe(255 - src[0]); expect(once[3]).toBe(200);
    expect(Array.from(adjust(once, 'invert'))).toEqual(Array.from(src));
  });
  it('brightness and contrast: zero is the identity, brightness lifts, contrast spreads', () => {
    expect(Array.from(brightnessContrastLut(0, 0))).toEqual([...Array(256).keys()]);
    expect(brightnessContrastLut(50, 0)[100]).toBeGreaterThan(100);
    const c = brightnessContrastLut(0, 50);
    expect(c[200]).toBeGreaterThan(200); expect(c[50]).toBeLessThan(50); expect(c[128]).toBe(128);
  });
  it('hue and saturation: zero changes nothing, -100 is grey, two half turns come back', () => {
    expect(Array.from(adjust(src, 'hue-saturation', {}))).toEqual(Array.from(src));
    const grey = adjust(src, 'hue-saturation', { saturation: -100 });
    for (let i = 0; i < grey.length; i += 4) { expect(grey[i]).toBe(grey[i + 1]); expect(grey[i + 1]).toBe(grey[i + 2]); }
    const back = adjust(adjust(src, 'hue-saturation', { hue: 180 }), 'hue-saturation', { hue: 180 });
    expect(close(back, src, 2)).toBe(true);
  });
  it('black and white gives equal channels', () => {
    const bw = adjust(src, 'black-white');
    for (let i = 0; i < bw.length; i += 4) { expect(bw[i]).toBe(bw[i + 1]); expect(bw[i]).toBe(bw[i + 2]); expect(bw[i + 3]).toBe(200); }
  });
  it('gaussian blur keeps a flat colour flat and spreads a dot evenly', () => {
    const flat = img(20, 20, () => [10, 200, 30, 255]);
    expect(close(gaussianBlur(flat, 3), flat.data, 1)).toBe(true);
    const d = gaussianBlur(img(21, 21, (x, y) => (x === 10 && y === 10 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 2);
    const v = (x: number, y: number): number => d[(y * 21 + x) * 4];
    expect(v(10, 10)).toBeLessThan(255); expect(v(10, 10)).toBeGreaterThan(v(12, 10)); expect(v(12, 10)).toBeGreaterThan(0);
    expect(Math.abs(v(12, 10) - v(8, 10))).toBeLessThanOrEqual(1); expect(Math.abs(v(12, 10) - v(10, 12))).toBeLessThanOrEqual(1);
  });
  it('blur never darkens the edge of a transparent shape', () => {
    const b = gaussianBlur(img(20, 20, (x, y) => (x >= 5 && x < 15 && y >= 5 && y < 15 ? [255, 0, 0, 255] : [0, 0, 0, 0])), 2);
    let edges = 0;
    for (let i = 0; i < b.length; i += 4) if (b[i + 3] > 30 && b[i + 3] < 250) { edges++; expect(b[i]).toBeGreaterThanOrEqual(245); expect(b[i + 1]).toBeLessThanOrEqual(10); }
    expect(edges).toBeGreaterThan(20);
  });
  it('sharpen raises contrast at an edge', () => {
    const s = sharpen(img(20, 5, (x) => (x < 10 ? [100, 100, 100, 255] : [150, 150, 150, 255])), 1.5, 1);
    expect(s[(2 * 20 + 9) * 4]).toBeLessThan(100); expect(s[(2 * 20 + 10) * 4]).toBeGreaterThan(150);
  });
  it('adjustments stay inside the selection and undo cleanly', () => {
    const doc = createDocument(10, 10), h = new History(), L = doc.layers[0];
    doc.selection = { x: 0, y: 0, w: 5, h: 10 };
    h.push(applyToLayer(doc, L, 'Invert', (b) => runJob({ op: 'adjust', kind: 'invert' }, b)));
    expect(L.data[(5 * 10 + 2) * 4]).toBe(0); expect(L.data[(5 * 10 + 7) * 4]).toBe(255);
    h.undo(doc); expect(L.data[(5 * 10 + 2) * 4]).toBe(255);
    h.push(applyToLayer(doc, L, 'Blur', (b) => runJob({ op: 'gaussian-blur', params: { radius: 2 } }, b), 8));
    expect(L.data[(5 * 10 + 7) * 4]).toBe(255);
  });
});
