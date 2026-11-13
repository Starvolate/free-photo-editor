// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Smart layers: the kept original comes back exactly after shrinking and growing; convert and rasterize undo cleanly. */
import { beforeAll, describe, expect, it } from 'vitest';
import { compositeDoc, createDocument, createLayer, cropDocument, flatten, resizeDocument, transformLayer, quadOfRect, type Doc, type Layer } from '../src/index';
import { convertToSmart, docQuad, installSmartHooks, rasterizeSmart, renderSmart, updateSmart, uprightBox } from '../src/smart';
import { commitResult, runJob } from '../src/index';
import { createFolder, effectiveBox, layerAt, mergeDown, mergeDownRefusal, mergeVisible, transformNode, turnDocument, turnLayer } from '../src/index';
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

/** A smart layer from a w × h picture whose red channel counts 1, 2, 3, … row by row (green 0, blue 0, opaque). */
function counted(w: number, h: number): { doc: Doc; l: Layer } {
  const doc = createDocument(w, h, null), l = doc.layers[0];
  l.data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) l.data.set([i + 1, 0, 0, 255], i * 4);
  convertToSmart(l);
  return { doc, l };
}
const reds = (l: Layer): number[] => [...l.data].filter((_, i) => i % 4 === 0);
const smartOf = (doc: Doc): Layer => doc.layers.find((x) => x.kind === 'smart') as Layer;

describe('smart layers: merges, auto-pick, folders, turns and flips', () => {
  it('Merge down and Merge visible give plain pixels with hand-checked values; undo brings the smart layer back', () => {
    for (const how of ['down', 'visible'] as const) {
      const doc = createDocument(2, 1, null), base = doc.layers[0];
      base.data = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
      convertToSmart(base);
      const top = createLayer('Top', 2, 1, { data: new Uint8ClampedArray([0, 0, 0, 0, 200, 100, 0, 255]) });
      doc.layers.push(top);
      doc.activeId = top.id;
      expect(mergeDownRefusal(doc)).toBeNull();
      const c = how === 'down' ? mergeDown(doc) : mergeVisible(doc);
      expect(c).not.toBeNull();
      expect(doc.layers).toHaveLength(1);
      const m = doc.layers[0];
      expect(m.kind).toBeUndefined();
      expect(m.smart).toBeUndefined();
      expect([...m.data]).toEqual([10, 20, 30, 255, 200, 100, 0, 255]);
      c?.undo(doc);
      expect(doc.layers).toHaveLength(2);
      expect(doc.layers[0].kind).toBe('smart');
    }
    // A smart layer on top merges into a plain one below it.
    const doc = createDocument(1, 1, null);
    doc.layers[0].data = new Uint8ClampedArray([1, 2, 3, 255]);
    const up = createLayer('Up', 1, 1, { data: new Uint8ClampedArray([9, 8, 7, 255]) });
    doc.layers.push(up);
    convertToSmart(up);
    doc.activeId = up.id;
    mergeDown(doc);
    expect(doc.layers.map((l) => [l.kind, [...l.data]])).toEqual([[undefined, [9, 8, 7, 255]]]);
  });

  it("The Move tool's auto-pick finds a smart layer under the pointer, and skips its see-through pixels", () => {
    const doc = createDocument(2, 1, null);
    doc.layers[0].data = new Uint8ClampedArray([5, 5, 5, 255, 5, 5, 5, 255]);
    const up = createLayer('Up', 2, 1, { data: new Uint8ClampedArray([0, 0, 0, 0, 90, 90, 90, 255]) });
    doc.layers.push(up);
    convertToSmart(up);
    expect(layerAt(doc, 1.5, 0.5)?.id).toBe(up.id);
    expect(layerAt(doc, 0.5, 0.5)?.id).toBe(doc.layers[0].id);
  });

  it('A folder counts its smart layers: its box, and Free transform on the folder moves the corners and gives the original back', () => {
    const { doc, l } = docWith();
    l.width = l.height = 4;
    l.data = pattern().slice(0, 64);
    convertToSmart(l);
    const f = createFolder('Group');
    l.parentId = f.id;
    doc.layers.push(f);
    expect(effectiveBox(doc.layers, f)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    const src = [...(l.smart?.source.data ?? [])];
    transformNode(doc, f.id, quadOfRect({ x: 0, y: 0, w: 8, h: 8 }));
    const big = smartOf(doc);
    expect([big.x, big.y, big.width, big.height]).toEqual([0, 0, 8, 8]);
    transformNode(doc, f.id, quadOfRect({ x: 2, y: 1, w: 4, h: 4 }));
    const back = smartOf(doc);
    expect([back.x, back.y, back.width, back.height]).toEqual([2, 1, 4, 4]);
    expect([...back.data]).toEqual(src);
  });

  it('Turns and flips move the kept corners: hand-checked pixels, four right turns or two flips give the same bytes, undo restores', () => {
    // 3 × 2 picture [1 2 3 / 4 5 6].
    const { doc, l } = counted(3, 2), quad0 = JSON.stringify(l.smart?.quad), bytes0 = [...l.data];
    const c = turnLayer(doc, 'cw') as NonNullable<ReturnType<typeof turnLayer>>;
    let s = smartOf(doc);
    expect([s.width, s.height]).toEqual([2, 3]);
    expect(reds(s)).toEqual([4, 1, 5, 2, 6, 3]);
    turnLayer(doc, 'flip-h');
    expect(reds(smartOf(doc))).toEqual([1, 4, 2, 5, 3, 6]); // a turn then a mirror: the original read down its columns
    turnLayer(doc, 'flip-h');
    turnLayer(doc, 'cw'); turnLayer(doc, 'cw'); turnLayer(doc, 'cw');
    s = smartOf(doc);
    expect([s.width, s.height]).toEqual([3, 2]);
    expect([...s.data]).toEqual(bytes0);
    expect(JSON.stringify(s.smart?.quad)).toBe(quad0);
    // Undo of a single turn puts the corners back.
    const d2 = counted(3, 2), t = turnLayer(d2.doc, '180');
    expect(reds(smartOf(d2.doc))).toEqual([6, 5, 4, 3, 2, 1]);
    t?.undo(d2.doc);
    expect(JSON.stringify(smartOf(d2.doc).smart?.quad)).toBe(quad0);
    expect(reds(smartOf(d2.doc))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(c).not.toBeNull();
  });

  it('Turning the whole picture moves a smart layer and its corners; right then left with a live blur gives the same bytes', () => {
    const doc = createDocument(4, 3, null), l = doc.layers[0];
    l.width = 2; l.height = 1; l.x = 1; l.y = 1;
    l.data = new Uint8ClampedArray([7, 0, 0, 255, 8, 0, 0, 255]);
    convertToSmart(l);
    turnDocument(doc, 'cw');
    let s = smartOf(doc);
    expect([doc.width, doc.height, s.x, s.y, s.width, s.height]).toEqual([3, 4, 1, 1, 1, 2]);
    expect(reds(s)).toEqual([7, 8]);
    turnDocument(doc, 'flip-v');
    expect(reds(smartOf(doc))).toEqual([8, 7]);
    turnDocument(doc, 'flip-v');
    turnDocument(doc, 'ccw');
    s = smartOf(doc);
    expect([doc.width, doc.height, s.x, s.y, s.width, s.height]).toEqual([4, 3, 1, 1, 2, 1]);
    expect(reds(s)).toEqual([7, 8]);
    // With a live Smooth blur on, a right turn then a left turn gives back the same bytes.
    const b = docWith();
    convertToSmart(b.l);
    const sm = b.l.smart as NonNullable<Layer['smart']>;
    const blur = { id: 'f1', cmd: 'filter.blur-gaussian', spec: { op: 'gaussian-blur' as const, params: { radius: 2 } }, on: true };
    updateSmart(b.doc, b.l, { ...sm, filters: [blur] }, docQuad(sm, 0, 0), 'Live blur');
    const blurred = [...smartOf(b.doc).data];
    turnDocument(b.doc, 'cw');
    turnDocument(b.doc, 'ccw');
    expect([...smartOf(b.doc).data]).toEqual(blurred);
  });
});
