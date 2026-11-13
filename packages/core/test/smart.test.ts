// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Smart layers: the kept original comes back exactly after shrinking and growing; convert and rasterize undo cleanly. */
import { beforeAll, describe, expect, it } from 'vitest';
import { compositeDoc, createDocument, createLayer, cropDocument, flatten, resizeDocument, transformLayer, quadOfRect, type Doc, type Layer } from '../src/index';
import { convertToSmart, docQuad, installSmartHooks, rasterizeSmart, renderSmart, updateSmart, uprightBox } from '../src/smart';
import { commitResult, runJob } from '../src/index';
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

  it('a live average (effects engine) survives half size and back; switched off, the original returns exactly', () => {
    const { doc, l } = docWith();
    convertToSmart(l);
    const avg = { id: 'f1', cmd: 'filter.blur-average', spec: { op: 'fx' as const, kind: 'average', params: { strength: 100 } }, on: true };
    // The job engine alone refuses an effects-engine filter: Picture size would throw without the smart module's runner.
    expect(() => runJob(avg.spec, { width: 8, height: 8, data: pattern() })).toThrow();
    const s = l.smart;
    if (!s) throw new Error('not smart');
    expect(updateSmart(doc, l, { ...s, filters: [avg] }, docQuad(s, l.x, l.y), 'Live average')).not.toBeNull();
    // By hand: red and green average 30 × (0+…+7) / 8 = 105; blue averages (0+…+63) / 64 = 31.5, stored as 32.
    const flat = [...Array(64)].flatMap(() => [105, 105, 32, 255]);
    expect([...l.data]).toEqual(flat);
    resizeDocument(doc, 4, 4);
    expect([doc.layers[0].width, doc.layers[0].height]).toEqual([4, 4]);
    resizeDocument(doc, 8, 8);
    const m = doc.layers[0], t = m.smart;
    expect([...m.data]).toEqual(flat);
    if (!t) throw new Error('not smart');
    updateSmart(doc, m, { ...t, filtersOn: false }, docQuad(t, m.x, m.y), 'Switch live filters off');
    expect([...m.data]).toEqual([...pattern()]);
  });
  it("a live filter's preview covers the whole smart layer, whatever is selected", () => {
    const plain = docWith(), { doc, l } = docWith(), all = { x: 0, y: 0, w: 8, h: 8 }, after = new Uint8ClampedArray(256).fill(9);
    convertToSmart(l);
    // A 2 × 2 box selected in the top-left corner.
    for (const d of [plain.doc, doc]) d.selection = { x: 0, y: 0, w: 2, h: 2, alpha: new Uint8Array(4).fill(255) };
    commitResult(plain.doc, plain.l, all, pattern(), after, 'Smooth blur');
    expect([...plain.l.data.subarray(0, 4)]).toEqual([9, 9, 9, 9]);
    expect([...plain.l.data.subarray(8, 12)]).toEqual([...pattern().subarray(8, 12)]);
    commitResult(doc, l, all, pattern(), after, 'Live smooth blur');
    expect([...l.data]).toEqual([...after]);
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
