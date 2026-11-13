// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Cut into web pieces (slice tool): boxes, pieces and the ZIP, on pixels worked by hand. */
import { describe, expect, it } from 'vitest';
import { createDocument } from '@free-photoeditor/core';
import { unzipSync } from '@free-photoeditor/formats/zip';
import { addSlice, clearSlices, cutPiece, dropLastSlice, pieceName, sliceBox, slicesOf, slicesZip } from '../src/slices';

describe('Cut into web pieces (slice)', () => {
  it('turns two dragged points into a whole-pixel box inside the picture', () => {
    expect(sliceBox({ x: 30.4, y: 20.6 }, { x: 10.2, y: 5 }, 100, 50)).toEqual({ x: 10, y: 5, w: 20, h: 16 });
    // Dragged past the right and bottom edges: cut to the picture (100 × 50).
    expect(sliceBox({ x: 90, y: 40 }, { x: 140, y: 70 }, 100, 50)).toEqual({ x: 90, y: 40, w: 10, h: 10 });
    // Thinner than 2 px is not a piece.
    expect(sliceBox({ x: 10, y: 10 }, { x: 11, y: 40 }, 100, 50)).toBeNull();
  });
  it('cuts a piece out pixel for pixel', () => {
    // 4 × 3 picture; pixel (x, y) has red = 10x + y. The box (1, 1, 2, 2) holds red 11, 21 / 12, 22.
    const W = 4, H = 3, data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; data[i] = 10 * x + y; data[i + 3] = 255; }
    const p = cutPiece({ width: W, height: H, data }, { x: 1, y: 1, w: 2, h: 2 });
    expect([p.width, p.height]).toEqual([2, 2]);
    expect([p.data[0], p.data[4], p.data[8], p.data[12]]).toEqual([11, 21, 12, 22]);
  });
  it('keeps the boxes with that picture, takes the last away, clears them, and names the files in order', () => {
    const d = createDocument(100, 50), e = createDocument(100, 50);
    addSlice(d, { x: 0, y: 0, w: 10, h: 10 });
    addSlice(d, { x: 20, y: 0, w: 10, h: 10 });
    addSlice(d, { x: 40, y: 0, w: 10, h: 10 });
    expect(slicesOf(e)).toEqual([]);
    dropLastSlice(d);
    expect(slicesOf(d).map((r) => r.x)).toEqual([0, 20]);
    expect(clearSlices(d)).toBe(2);
    expect(slicesOf(d)).toEqual([]);
    expect([pieceName(1, 2), pieceName(12, 12), pieceName(7, 120)]).toEqual(['piece 01.png', 'piece 12.png', 'piece 007.png']);
  });
  it('saves every piece as a PNG of its own size in one ZIP', async () => {
    const d = createDocument(100, 50);
    addSlice(d, { x: 0, y: 0, w: 30, h: 20 });
    addSlice(d, { x: 50, y: 10, w: 40, h: 40 });
    const { bytes, count } = await slicesZip(d);
    expect(count).toBe(2);
    const files = unzipSync(bytes), names = Object.keys(files).sort();
    expect(names).toEqual(['piece 01.png', 'piece 02.png']);
    // A PNG's width and height sit in its header at bytes 16 and 20.
    const size = (b: Uint8Array): number[] => { const v = new DataView(b.buffer, b.byteOffset); return [v.getUint32(16), v.getUint32(20)]; };
    expect(size(files['piece 01.png'])).toEqual([30, 20]);
    expect(size(files['piece 02.png'])).toEqual([40, 40]);
    clearSlices(d);
    expect((await slicesZip(d)).count).toBe(0);
  });
});
