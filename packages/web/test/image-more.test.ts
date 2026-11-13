// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Image extras (filters batch 2, part 4): Soften the last change, shades of grey and turn by any angle, on pixels worked
 * out by hand (the sums are in the comments), plus their Ready rows and handlers.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDocument, createLayer, History, pixelCommand, turnDocument, type Doc } from '@free-photoeditor/core';
import type { Editor } from '../src/app';
import { HANDLERS } from '../src/commands';
import { BY_ID } from '../src/registry';
import { fadeMix, grayData, grayDocument, rotateDocument, turnedSize } from '../src/image-more';

const IDS = ['edit.fade', 'image.mode-gray', 'image.rotate-any'];
const doc = (w: number, h: number, f: (x: number, y: number) => number[]): Doc => {
  const d = createDocument(w, h), data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  d.layers = [createLayer('Picture', w, h, { data })];
  d.activeId = d.layers[0].id;
  return d;
};

describe('image extras', () => {
  it('are Ready, with handlers that load the module on first use', async () => {
    for (const id of IDS) { expect(BY_ID.get(id)?.status, id).toBe('ready'); expect(HANDLERS[id], id).toBeTruthy(); }
    const imageMore = vi.fn(async () => undefined), e = { doc: {}, lastChange: null, imageMore } as unknown as Editor;
    expect(HANDLERS['edit.fade'].enabled(e)).toBe(false);
    expect(HANDLERS['image.mode-gray'].enabled(e)).toBe(true);
    await HANDLERS['image.rotate-any'].run(e);
    expect(imageMore).toHaveBeenCalledWith('image.rotate-any');
  });
  it('soften: 25% of a change from 200 grey to 100 grey leaves 175; a see-through pixel brings in only the new colour', () => {
    // 200 + (100 - 200) x 0.25 = 175. Second pixel: before is see-through black, after is solid red 240.
    // alpha 0 + 255 x 0.25 = 63.75, so 64; red (0 + 240 x 255 x 0.25) / 63.75 = 240, not a mix with the hidden black.
    const before = new Uint8ClampedArray([200, 200, 200, 255, 0, 0, 0, 0]), after = new Uint8ClampedArray([100, 100, 100, 255, 240, 0, 0, 255]);
    expect(Array.from(fadeMix(before, after, 25))).toEqual([175, 175, 175, 255, 240, 0, 0, 64]);
    expect(Array.from(fadeMix(before, after, 100))).toEqual(Array.from(after));
    expect(Array.from(fadeMix(before, after, 0))).toEqual([200, 200, 200, 255, 0, 0, 0, 0]);
  });
  it('soften as an undo step: undo removes the softening first, then the filter', () => {
    // A "filter" turns the 2 x 1 layer from 200 to 100; soften to 50% gives 150; undo gives 100, undo again 200.
    const d = doc(2, 1, () => [200, 200, 200, 255]), l = d.layers[0], r = { x: 0, y: 0, w: 2, h: 1 }, hist = new History();
    const before = l.data.slice();
    l.data.fill(100); for (let i = 3; i < 8; i += 4) l.data[i] = 255;
    hist.push(pixelCommand('Sharpen', l.id, r, before));
    const after = l.data.slice();
    l.data.set(fadeMix(before, after, 50));
    hist.push(pixelCommand('Soften Sharpen', l.id, r, after));
    expect(l.data[0]).toBe(150);
    hist.undo(d); expect(l.data[0]).toBe(100);
    hist.undo(d); expect(l.data[0]).toBe(200);
  });
  it('shades of grey: red 200, green 100, blue 50 becomes 0.299 x 200 + 0.587 x 100 + 0.114 x 50 = 124, as one undo step', () => {
    // 59.8 + 58.7 + 5.7 = 124.2, so 124. Alpha 128 stays.
    expect(Array.from(grayData(new Uint8ClampedArray([200, 100, 50, 128])))).toEqual([124, 124, 124, 128]);
    const d = doc(1, 1, () => [255, 0, 0, 255]), cmd = grayDocument(d);
    expect(Array.from(d.layers[0].data)).toEqual([76, 76, 76, 255]); // 0.299 x 255 = 76.2
    cmd?.undo(d);
    expect(Array.from(d.layers[0].data)).toEqual([255, 0, 0, 255]);
  });
  it('turn by any angle: the canvas grows to hold the corners, and a quarter turn matches Rotate 90° clockwise pixel for pixel', () => {
    // 10 x 10 at 45°: 10 x (cos 45 + sin 45) = 14.14, so 15. 30 x 20 at 90° is 20 x 30, not 21 x 31.
    expect(turnedSize(10, 10, 45)).toEqual({ w: 15, h: 15 });
    expect(turnedSize(30, 20, 90)).toEqual({ w: 20, h: 30 });
    expect(turnedSize(30, 20, -30)).toEqual({ w: 36, h: 33 }); // 25.98 + 10 = 35.98; 15 + 17.32 = 32.32
    const f = (x: number, y: number): number[] => [x * 60, y * 100, 7, 255];
    const a = doc(3, 2, f), b = doc(3, 2, f);
    rotateDocument(a, 90);
    turnDocument(b, 'cw');
    expect([a.width, a.height, a.layers[0].x, a.layers[0].y, a.layers[0].width, a.layers[0].height]).toEqual([2, 3, 0, 0, 2, 3]);
    expect(Array.from(a.layers[0].data)).toEqual(Array.from(b.layers[0].data));
  });
  it('turn by any angle: 45° on a 2 x 2 solid square leaves its centre solid and its new corners see-through, as one undo step', () => {
    // 2 x 2 at 45° needs 2.83, so 3 x 3. The middle pixel (1.5, 1.5) maps back to the old centre: solid.
    // The corner pixel (0.5, 0.5) maps back to (-0.41, 1), left of the old left edge: see-through.
    const d = doc(2, 2, () => [90, 90, 90, 255]), cmd = rotateDocument(d, 45), l = d.layers[0];
    expect([d.width, d.height]).toEqual([3, 3]);
    const at = (x: number, y: number): number[] => { const i = ((y - l.y) * l.width + (x - l.x)) * 4; return Array.from(l.data.subarray(i, i + 4)); };
    expect(at(1, 1)).toEqual([90, 90, 90, 255]);
    expect(at(0, 0)[3]).toBe(0);
    cmd?.undo(d);
    expect([d.width, d.height, d.layers[0].width]).toEqual([2, 2, 2]);
    expect(rotateDocument(d, 360)).toBeNull();
  });
});
