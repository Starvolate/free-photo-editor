// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { createFolder, createLayer, type Doc } from '../src/document';
import { History } from '../src/history';
import { emptyMask, type Mask } from '../src/selection';
import { checkTree } from '../src/tree';
import {
  alphaMask, channelMask, contentBox, cropToContent, floatSelection, invertAlpha, luminanceMask, removeAlpha, removeHoles, reversedOrder,
  roughenMask, roundCorners, splitByColour,
} from '../src/selection-more';

/** A 1-row picture from grey levels (or [r, g, b, a] pixels). */
const row = (px: number[][]) => ({ width: px.length, height: 1, data: new Uint8ClampedArray(px.flat()) });
const grey = (v: number, a = 255) => [v, v, v, a];
/** A w x h mask with a filled box. */
function box(w: number, h: number, x0: number, y0: number, bw: number, bh: number): Mask {
  const m = emptyMask(w, h);
  for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) m.data[y * w + x] = 255;
  return m;
}
const at = (m: Mask, x: number, y: number): number => m.data[y * m.width + x];

describe('select by brightness, channel and layer', () => {
  it('selects a brightness range with a soft edge', () => {
    // Levels 0, 90, 100, 150, 200, 210, 255 with the range 100..200 and a 20-level fade:
    // 90 and 210 are 10 levels out (half selected), 0 and 255 far out (not selected).
    const m = luminanceMask(row([grey(0), grey(90), grey(100), grey(150), grey(200), grey(210), grey(255)]), 100, 200, 20);
    expect([...m.data]).toEqual([0, 128, 255, 255, 255, 128, 0]);
    // A hard edge, a half see-through pixel counts half, and a reversed range is the same range.
    expect([...luminanceMask(row([grey(90), grey(150, 128)]), 200, 100, 0).data]).toEqual([0, 128]);
  });
  it('uses brightness as a screen sees it: pure green is brighter than pure blue', () => {
    const m = luminanceMask(row([[0, 255, 0, 255], [0, 0, 255, 255]]), 128, 255, 0);
    expect([...m.data]).toEqual([255, 0]); // green 182, blue 18
  });
  it('turns one colour channel into a selection', () => {
    const src = row([[200, 10, 0, 255], [100, 50, 0, 128]]);
    expect([...channelMask(src, 0).data]).toEqual([200, 50]);
    expect([...channelMask(src, 1).data]).toEqual([10, 25]);
  });
  it("selects a layer's solid pixels where it sits on the picture", () => {
    const l = createLayer('a', 2, 1, { x: 1, y: 1, data: new Uint8ClampedArray([9, 9, 9, 255, 9, 9, 9, 64]) });
    const m = alphaMask(l, 4, 3);
    expect([...m.data]).toEqual([0, 0, 0, 0, 0, 255, 64, 0, 0, 0, 0, 0]);
  });
});

describe('change the selection', () => {
  it('fills small holes but never the outside or a big hole', () => {
    const m = box(12, 12, 1, 1, 10, 10);
    m.data[3 * 12 + 3] = 0; // a 1-pixel hole
    for (let y = 6; y < 9; y++) for (let x = 6; x < 9; x++) m.data[y * 12 + x] = 0; // a 9-pixel hole
    const a = removeHoles(m, 4);
    expect([at(a, 3, 3), at(a, 7, 7), at(a, 0, 0)]).toEqual([255, 0, 0]);
    const b = removeHoles(m, 9);
    expect([at(b, 3, 3), at(b, 7, 7), at(b, 0, 0), at(b, 11, 11)]).toEqual([255, 255, 0, 0]);
  });
  it('rounds the corners of a box and keeps its sides', () => {
    const r = roundCorners(box(40, 40, 10, 10, 20, 20), 6);
    expect(at(r, 10, 10)).toBe(0); // the corner pixel is cut off
    expect(at(r, 20, 10)).toBe(255); // the middle of the top side stays
    expect(at(r, 10, 20)).toBe(255);
    expect(at(r, 20, 20)).toBe(255);
    expect(at(r, 5, 5)).toBe(0);
  });
  it('roughens only the edge, the same way each time', () => {
    const m = box(40, 40, 10, 10, 20, 20), r = roughenMask(m, 4, 6, 3);
    for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) expect(at(r, x, y)).toBe(255);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (x < 5 || y < 5 || x > 34 || y > 34) expect(at(r, x, y)).toBe(0);
    let changed = 0;
    for (let i = 0; i < m.data.length; i++) if (m.data[i] !== r.data[i]) changed++;
    expect(changed).toBeGreaterThan(20);
    expect([...roughenMask(m, 4, 6, 3).data]).toEqual([...r.data]);
  });
});

describe('layer pixels', () => {
  it('crops a layer to its content', () => {
    const data = new Uint8ClampedArray(4 * 3 * 4);
    data.set([1, 2, 3, 255], (1 * 4 + 2) * 4); // pixel (2, 1)
    data.set([4, 5, 6, 10], (2 * 4 + 3) * 4); // pixel (3, 2)
    const l = createLayer('a', 4, 3, { x: 5, y: 7, data });
    expect(contentBox(l)).toEqual({ x: 7, y: 8, w: 2, h: 2 });
    const g = cropToContent(l)!;
    expect([g.x, g.y, g.width, g.height]).toEqual([7, 8, 2, 2]);
    expect([...g.data]).toEqual([1, 2, 3, 255, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5, 6, 10]);
    expect(cropToContent(createLayer('b', 2, 2, { fill: { r: 0, g: 0, b: 0, a: 255 } }))).toBeNull();
  });
  it('fills see-through parts with the background colour', () => {
    const out = removeAlpha(new Uint8ClampedArray([200, 100, 0, 255, 200, 100, 0, 51, 0, 0, 0, 0]), { r: 0, g: 0, b: 255, a: 255 })!;
    expect([...out]).toEqual([200, 100, 0, 255, 40, 20, 204, 255, 0, 0, 255, 255]);
    expect(removeAlpha(new Uint8ClampedArray([1, 2, 3, 255]), { r: 0, g: 0, b: 0, a: 255 })).toBeNull();
  });
  it('swaps solid and see-through', () => {
    expect([...invertAlpha(new Uint8ClampedArray([5, 6, 7, 255, 5, 6, 7, 0, 5, 6, 7, 55]))]).toEqual([5, 6, 7, 0, 5, 6, 7, 255, 5, 6, 7, 200]);
  });
  it('lifts the selected pixels into a new layer above, in one undo step', () => {
    const l = createLayer('Photo', 4, 4, { fill: { r: 10, g: 20, b: 30, a: 255 } });
    const doc: Doc = { width: 4, height: 4, layers: [l], activeId: l.id, selection: null }, hist = new History();
    const m = box(4, 4, 1, 1, 2, 1);
    m.data[1 * 4 + 2] = 128; // half selected
    const cmd = floatSelection(doc, l, m, 'Lifted')!;
    hist.push(cmd);
    expect(doc.layers.length).toBe(2);
    const n = doc.layers[1];
    expect([n.name, n.x, n.y, n.width, n.height, doc.activeId]).toEqual(['Lifted', 1, 1, 2, 1, n.id]);
    expect([...n.data]).toEqual([10, 20, 30, 255, 10, 20, 30, 128]);
    const src = doc.layers[0];
    expect([src.data[(1 * 4 + 1) * 4 + 3], src.data[(1 * 4 + 2) * 4 + 3], src.data[3]]).toEqual([0, 127, 255]);
    hist.undo(doc);
    expect(doc.layers.length).toBe(1);
    expect(doc.layers[0].data[(1 * 4 + 1) * 4 + 3]).toBe(255);
    expect(floatSelection(doc, doc.layers[0], emptyMask(4, 4), 'x')).toBeNull();
  });
  it('splits a layer into one layer per main colour, biggest first', () => {
    const red = [250, 0, 0, 255], red2 = [240, 10, 0, 255], blue = [0, 0, 250, 255], none = [0, 0, 0, 0];
    const g = splitByColour(row([red, red2, blue, none, red]), 2);
    expect(g.map((x) => x.count)).toEqual([3, 1]);
    expect([...g[0].data]).toEqual([...red, ...red2, ...none, ...none, ...red]);
    expect([...g[1].data]).toEqual([...none, ...none, ...blue, ...none, ...none]);
    expect(g[1].color).toEqual({ r: 0, g: 0, b: 250, a: 255 });
    expect(splitByColour(row([none]), 3)).toEqual([]);
  });
  it('reverses the stack in a folder, each folder moving with its contents', () => {
    const a = createLayer('a', 1, 1), b = createLayer('b', 1, 1), f = createFolder('F'), c = createLayer('c', 1, 1), d = createLayer('d', 1, 1);
    b.parentId = f.id;
    c.parentId = f.id;
    // Bottom to top: a, [b, c] inside F, F, d.
    const layers = [a, b, c, f, d];
    const top = reversedOrder(layers, d.id)!;
    expect(top.map((l) => l.name)).toEqual(['d', 'b', 'c', 'F', 'a']);
    expect(checkTree(top)).toBeNull();
    expect(reversedOrder(layers, b.id)!.map((l) => l.name)).toEqual(['a', 'c', 'b', 'F', 'd']);
    expect(reversedOrder([a], a.id)).toBeNull();
  });
});
