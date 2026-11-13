// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Stitch a panorama and Blend photos automatically (core/align.ts) on a real photo (e2e/fixtures/mug.png, CC0, see
 * SOURCE.md) cut into overlapping pieces with a known shift: two side by side come back as the photo; the right one turned
 * 5° and made darker is turned back, and the seam fades over about 40 px instead of a hard step; three pieces cut along
 * the height come back as the photo through the middle one. Every number below was worked out by hand before the code ran.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePng } from '@free-photoeditor/formats/png';
import { createLayer, flatten, warpBitmap, type Bitmap, type Doc, type Layer } from '@free-photoeditor/core';
import { blendSeams, seamMask, stitch } from '@free-photoeditor/core/align';

const png = decodePng(readFileSync(fileURLToPath(new URL('../e2e/fixtures/mug.png', import.meta.url))));
const photo: Bitmap = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
const W = photo.width, H = photo.height;

/** The photo's pixels in the box x, y, w, h. */
function cut(x: number, y: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(photo.data.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
  return out;
}
/** The pieces as the panorama sheet opens them: one layer each, all at 0, 0, the first at the bottom. */
function docOf(ls: Layer[]): Doc {
  return { width: Math.max(...ls.map((l) => l.width)), height: Math.max(...ls.map((l) => l.height)), layers: ls, activeId: ls[ls.length - 1].id, selection: null };
}
/** Mean and largest difference of the red, green and blue levels from the photo (times k) over a box of the photo, whose
 * top left corner sits at ox, oy in the result. */
function diff(b: Bitmap, x0: number, y0: number, x1: number, y1: number, k = 1, ox = 0, oy = 0): { mean: number; max: number } {
  let s = 0, n = 0, max = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) {
    const d = Math.abs(b.data[((y + oy) * b.width + x + ox) * 4 + c] - photo.data[(y * W + x) * 4 + c] * k);
    s += d; n++; if (d > max) max = d;
  }
  return { mean: s / n, max };
}

describe('Stitch a panorama', () => {
  it('two pieces side by side (0-230 and 130-360, 100 px overlap) come back as the photo, with a 40 px fade in the middle', () => {
    const a = createLayer('left', 230, H, { data: cut(0, 0, 230, H) }), b = createLayer('right', 230, H, { data: cut(130, 0, 230, H) }), doc = docOf([a, b]);
    const r = stitch(doc);
    expect(r?.cmd).toBeTruthy();
    expect([doc.width, doc.height]).toEqual([W, H]);
    expect(r?.ref).toBe('left');
    expect(doc.layers.map((l) => [l.x, l.y])).toEqual([[0, 0], [130, 0]]);
    const d = diff(flatten(doc), 0, 0, W, H);
    expect(d.max).toBeLessThanOrEqual(1);
    // The right piece's mask on row 240: the overlap is doc x 130 to 229, its middle 179.5; hidden at its own edge, half at
    // the middle (0.5 -/+ 1/40 either side: 121 and 134), whole from 40 / 2 px past the middle, and beyond the overlap.
    const m = doc.layers[1].mask, at = (x: number): number => (m ? m.data[240 * m.width + x - 130] : -1);
    expect([at(130), at(160), at(179), at(180), at(199), at(230), at(359)]).toEqual([0, 0, 121, 134, 255, 255, 255]);
    expect(doc.layers[0].mask).toBeUndefined();
    r?.cmd?.undo(doc);
    expect([doc.width, doc.height, doc.layers[1].x, !!doc.layers[1].mask]).toEqual([230, H, 0, false]);
  });

  it('the right piece turned 5° and darker (85 %) is turned back onto the left one; the seam fades instead of stepping', () => {
    const right: Bitmap = { width: 230, height: H, data: cut(130, 0, 230, H) }, t = 5 * Math.PI / 180, cx = 115, cy = H / 2;
    const T = (x: number, y: number): { x: number; y: number } => ({ x: cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t), y: cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t) });
    const g = warpBitmap(right, [T(0, 0), T(230, 0), T(230, H), T(0, H)]);
    if (!g) throw new Error('The test shot could not be made');
    for (let i = 0; i < g.data.length; i += 4) for (let c = 0; c < 3; c++) g.data[i + c] = Math.round(g.data[i + c] * 0.85);
    const doc = docOf([createLayer('left', 230, H, { data: cut(0, 0, 230, H) }), createLayer('turned', g.width, g.height, { data: g.data })]);
    const r = stitch(doc);
    expect(r?.cmd).toBeTruthy();
    expect(r?.ref).toBe('left');
    // The turned piece's see-through corners stick out once turned back, so the canvas grows and the left piece (the
    // reference, unchanged) sits at ox, oy in it.
    const out = flatten(doc), ox = doc.layers[0].x, oy = doc.layers[0].y;
    expect(doc.width).toBeGreaterThan(W);
    // Left of the overlap only the reference shows: the same pixels.
    expect(diff(out, 0, 0, 125, H, 1, ox, oy).max).toBeLessThanOrEqual(1);
    // Right of the overlap, the turned piece back in place: the darker photo, within two resamplings (turned, turned back).
    expect(diff(out, 240, 30, 350, H - 30, 0.85, ox, oy).mean).toBeLessThan(6);
    // Across the overlap, column by column (rows 40 to 440), the result over the photo goes from 1 to 0.85 in small steps:
    // a hard seam would step by 0.15 at one column; a 40 px fade steps by about 0.15 / 40 = 0.004.
    const ratio: number[] = [];
    for (let x = 120; x < 250; x++) {
      let s = 0, p = 0;
      for (let y = 40; y < H - 40; y++) for (let c = 0; c < 3; c++) { s += out.data[((y + oy) * out.width + x + ox) * 4 + c]; p += photo.data[(y * W + x) * 4 + c]; }
      ratio.push(s / p);
    }
    expect(ratio[0]).toBeGreaterThan(0.99);
    expect(ratio[ratio.length - 1]).toBeLessThan(0.87);
    expect(Math.max(...ratio.slice(1).map((v, i) => Math.abs(v - ratio[i])))).toBeLessThan(0.02);
  });

  it('three pieces cut along the height (0-220, 130-350, 260-480) come back as the photo through the middle one', () => {
    const doc = docOf([createLayer('top', W, 220, { data: cut(0, 0, W, 220) }), createLayer('middle', W, 220, { data: cut(0, 130, W, 220) }),
      createLayer('bottom', W, 220, { data: cut(0, 260, W, 220) })]);
    const r = stitch(doc);
    expect(r?.ref).toBe('middle');
    expect(r?.placed).toEqual(['top', 'middle', 'bottom']);
    expect([doc.width, doc.height]).toEqual([W, H]);
    expect(doc.layers.map((l) => l.y)).toEqual([0, 130, 260]);
    expect(diff(flatten(doc), 0, 0, W, H).max).toBeLessThanOrEqual(1);
  });

  it('an unrelated picture is left out and named; one usable layer gives null', () => {
    const noise = new Uint8ClampedArray(230 * H * 4);
    let s = 7;
    for (let i = 0; i < noise.length; i++) { s = (s * 1103515245 + 12345) >>> 0; noise[i] = i % 4 === 3 ? 255 : s >>> 24; }
    const doc = docOf([createLayer('left', 230, H, { data: cut(0, 0, 230, H) }), createLayer('noise', 230, H, { data: noise })]);
    const r = stitch(doc);
    expect([r?.cmd, r?.missed]).toEqual([null, ['noise']]);
    expect(stitch(docOf([createLayer('one', 10, 10)]))).toBeNull();
  });
});

describe('Blend photos automatically', () => {
  it('two lined-up pieces get the same seam as the panorama; a layer inside another has no seam', () => {
    const a = createLayer('left', 230, H, { data: cut(0, 0, 230, H) }), b = createLayer('right', 230, H, { data: cut(130, 0, 230, H), x: 130 });
    const doc: Doc = { width: W, height: H, layers: [a, b], activeId: b.id, selection: null };
    const r = blendSeams(doc);
    expect([r?.blended, r?.none]).toEqual([['right'], []]);
    expect(seamMask(b, [a])?.data[240 * 230 + 50]).toBe(134);
    expect(diff(flatten(doc), 0, 0, W, H).max).toBeLessThanOrEqual(1);
    r?.cmd?.undo(doc);
    expect(doc.layers[1].mask).toBeUndefined();
    const small = createLayer('inside', 50, 50, { data: cut(10, 10, 50, 50), x: 10, y: 10 });
    expect(seamMask(small, [a])).toBeNull();
  });
});
