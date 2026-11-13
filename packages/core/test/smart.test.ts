// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Smart layers: the kept original comes back exactly after shrinking and growing; convert and rasterize undo cleanly. */
import { beforeAll, describe, expect, it } from 'vitest';
import { compositeDoc, createDocument, createLayer, cropDocument, flatten, resizeDocument, transformLayer, quadOfRect, type Doc, type Layer } from '../src/index';
import { convertToSmart, installSmartHooks, rasterizeSmart, renderSmart, uprightBox } from '../src/smart';
import { readPsdDocument, writePsdDocument } from '../src/psd';

/** An 8 × 8 hand pattern: every pixel different, so any resampling shows. Pixel (x, y) = (x*30, y*30, x+y*8, 255). */
function pattern(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) d.set([x * 30, y * 30, x + y * 8, 255], (y * 8 + x) * 4);
  return d;
}
function docWith(): { doc: Doc; l: Layer } {
  const doc = createDocument(8, 8, null), l = doc.layers[0];
  l.data = pattern();
  return { doc, l };
}
beforeAll(() => installSmartHooks());

describe('smart layers', () => {
  it('Make a smart layer keeps the picture on screen and the original safe; undo and redo swap it', () => {
    const { doc, l } = docWith(), before = compositeDoc(doc, { x: 0, y: 0, w: 8, h: 8 });
    const c = convertToSmart(l);
    expect(c).not.toBeNull();
    expect(l.kind).toBe('smart');
    expect([...(l.smart?.source.data ?? [])]).toEqual([...pattern()]);
    expect(l.smart?.source.data).not.toBe(l.data);
    expect([...compositeDoc(doc, { x: 0, y: 0, w: 8, h: 8 })]).toEqual([...before]);
    c?.undo(doc);
    expect(l.kind).toBeUndefined();
    expect(l.smart).toBeUndefined();
    c?.redo(doc);
    expect(l.kind).toBe('smart');
  });

  it('Picture size 50% then back to 100% gives back the original pixels exactly; a plain layer does not', () => {
    const plain = docWith(), smart = docWith();
    convertToSmart(smart.l);
    for (const d of [plain.doc, smart.doc]) { resizeDocument(d, 4, 4); resizeDocument(d, 8, 8); }
    expect(smart.doc.layers[0].width).toBe(8);
    expect([...smart.doc.layers[0].data]).toEqual([...pattern()]);
    expect([...plain.doc.layers[0].data]).not.toEqual([...pattern()]);
    // Pixel (3, 2) is (90, 60, 19, 255) by the hand formula.
    expect([...smart.doc.layers[0].data.subarray((2 * 8 + 3) * 4, (2 * 8 + 3) * 4 + 4)]).toEqual([90, 60, 19, 255]);
  });

  it('Free transform down and back up, after a move, gives back the original pixels exactly', () => {
    const doc = createDocument(20, 20, null), l = createLayer('Pic', 8, 8, { x: 2, y: 3, data: pattern() });
    doc.layers.push(l);
    convertToSmart(l);
    l.x += 5; // a move changes only x and y
    transformLayer(doc, l, quadOfRect({ x: 7, y: 3, w: 4, h: 4 }));
    expect([l.x, l.y, l.width, l.height]).toEqual([7, 3, 4, 4]);
    transformLayer(doc, l, quadOfRect({ x: 7, y: 3, w: 8, h: 8 }));
    expect([l.x, l.y, l.width, l.height]).toEqual([7, 3, 8, 8]);
    expect([...l.data]).toEqual([...pattern()]);
  });

  it('a turned quad is not an upright box; an upright whole-pixel one is', () => {
    expect(uprightBox(quadOfRect({ x: 1, y: 2, w: 3, h: 4 }))).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(uprightBox([{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 3, y: 5 }, { x: -1, y: 4 }])).toBeNull();
  });

  it('a live filter switched off leaves the original; switched on, it changes the picture', () => {
    const src = { width: 8, height: 8, data: pattern() }, q = quadOfRect({ x: 0, y: 0, w: 8, h: 8 });
    const blur = { id: 'f1', cmd: 'filter.blur-gaussian', spec: { op: 'gaussian-blur' as const, params: { radius: 2 } }, on: false };
    const off = renderSmart({ source: src, quad: q, filters: [blur] }, q);
    expect([...(off?.geom.data ?? [])]).toEqual([...pattern()]);
    const on = renderSmart({ source: src, quad: q, filters: [{ ...blur, on: true }] }, q);
    expect([...(on?.geom.data ?? [])]).not.toEqual([...pattern()]);
    expect([...src.data]).toEqual([...pattern()]);
  });

  it('Turn back into pixels keeps the picture and drops the original; undo brings the smart layer back', () => {
    const { doc, l } = docWith();
    convertToSmart(l);
    const c = rasterizeSmart(l);
    expect(l.kind).toBeUndefined();
    expect(l.smart).toBeUndefined();
    expect([...l.data]).toEqual([...pattern()]);
    c?.undo(doc);
    expect(l.kind).toBe('smart');
    expect(rasterizeSmart(createLayer('x', 1, 1))).toBeNull();
  });

  it('Crop moves a smart layer and keeps every pixel past the new edges', () => {
    const { doc, l } = docWith();
    convertToSmart(l);
    cropDocument(doc, { x: 2, y: 2, w: 4, h: 4 });
    const s = doc.layers[0];
    expect([s.x, s.y, s.width, s.height]).toEqual([-2, -2, 8, 8]);
    // Document pixel (1, 0) is original pixel (3, 2) = (90, 60, 19, 255).
    expect([...compositeDoc(doc, { x: 1, y: 0, w: 1, h: 1 })]).toEqual([90, 60, 19, 255]);
    expect([...s.data]).toEqual([...pattern()]);
  });

  it('PSD keeps a smart layer as plain pixels', () => {
    const { doc, l } = docWith();
    convertToSmart(l);
    const back = readPsdDocument(writePsdDocument(doc)).doc;
    expect(back.layers[0].kind ?? 'pixel').toBe('pixel');
    expect([...flatten(back).data]).toEqual([...flatten(doc).data]);
  });
});
