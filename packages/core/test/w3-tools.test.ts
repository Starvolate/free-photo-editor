// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** W3 tools: selections, fills, retouching, transforms, text layout and shapes, checked on small known pictures. */
import { describe, expect, it } from 'vitest';
import {
  EffectStroke, History, addLayer, alignLayer, borderMask, bucketFill, colorRangeMask, contentBounds, contentCommand, contractMask, countSelected,
  createDocument, createLayer, currentContent, distributeLayers, emptyMask, expandMask, featherMask, fillGradient, gradientT, growMask, healPatch,
  homography, invert3, layerAt, layoutText, mapPoint, maskBounds, maskFromSelection, patchArea, polygonMask, quadOfRect, quickSelectMask,
  redEye, selectionFromMask, selectionOutline, shapeBounds, shapePoints, similarMask, smoothMask, strokeSelection, toneShift, transformLayer,
  transformSelection, wandMask, warpBitmap, DEFAULT_TEXT_STYLE, type Doc, type Layer, type Pixels, type ShapeContent,
} from '../src/index';

const px = (l: Layer, x: number, y: number): number[] => { const i = ((y - l.y) * l.width + (x - l.x)) * 4; return [...l.data.subarray(i, i + 4)]; };
function picture(w: number, h: number, f: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}
function docOf(p: Pixels): Doc {
  const d = createDocument(p.width, p.height, null);
  d.layers[0].data.set(p.data);
  return d;
}
const rectMask = (w: number, h: number, r: { x: number; y: number; w: number; h: number }) => maskFromSelection(r, w, h);

describe('selection masks', () => {
  it('fills a lasso outline with soft edges', () => {
    const m = polygonMask(40, 40, [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }]);
    expect(maskBounds(m)).toEqual({ x: 10, y: 10, w: 20, h: 20 });
    expect(countSelected(m)).toBe(400);
    const tri = polygonMask(40, 40, [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 }]);
    expect(Math.abs(countSelected(tri) - 800)).toBeLessThan(45);
    expect(tri.data[39 * 40 + 39]).toBe(0);
  });
  it('magic wand selects touching or all similar colours, within the tolerance', () => {
    const p = picture(30, 10, (x) => (x < 10 || x >= 20 ? [200, 0, 0, 255] : [0, 0, 200, 255]));
    expect(countSelected(wandMask(p, 2, 2, 10, true))).toBe(100);
    expect(countSelected(wandMask(p, 2, 2, 10, false))).toBe(200);
    expect(countSelected(wandMask(p, 15, 2, 255, true))).toBe(300);
  });
  it('grows into similar neighbours, and finds similar colours everywhere', () => {
    const p = picture(30, 10, (x) => (x < 10 || x >= 20 ? [200, 0, 0, 255] : [0, 0, 200, 255]));
    const seed = rectMask(30, 10, { x: 0, y: 0, w: 3, h: 3 });
    expect(countSelected(growMask(p, seed, 20))).toBe(100);
    expect(countSelected(similarMask(p, seed, 20))).toBe(200);
  });
  it('expands, contracts, feathers, borders and smooths', () => {
    const m = rectMask(60, 60, { x: 20, y: 20, w: 10, h: 10 });
    expect(maskBounds(expandMask(m, 3), 128)).toEqual({ x: 17, y: 17, w: 16, h: 16 });
    expect(maskBounds(contractMask(m, 3), 128)).toEqual({ x: 23, y: 23, w: 4, h: 4 });
    const f = featherMask(m, 4);
    expect(f.data[25 * 60 + 25]).toBeGreaterThan(200);
    expect(f.data[25 * 60 + 20]).toBeGreaterThan(60);
    expect(f.data[25 * 60 + 20]).toBeLessThan(200);
    expect((maskBounds(f) as { w: number }).w).toBeGreaterThan(10);
    const b = borderMask(rectMask(60, 60, { x: 10, y: 10, w: 40, h: 40 }), 6);
    expect(b.data[30 * 60 + 30]).toBe(0);
    expect(b.data[30 * 60 + 10]).toBeGreaterThan(128);
    const speck = rectMask(60, 60, { x: 10, y: 10, w: 30, h: 30 });
    speck.data[50 * 60 + 50] = 255;
    const s = smoothMask(speck, 3);
    expect(s.data[50 * 60 + 50]).toBe(0);
    expect(s.data[25 * 60 + 25]).toBe(255);
  });
  it('turns masks into compact selections and outlines', () => {
    const m = polygonMask(40, 40, [{ x: 5, y: 5 }, { x: 35, y: 5 }, { x: 5, y: 35 }]);
    const sel = selectionFromMask(m);
    expect(sel?.alpha).toBeTruthy();
    expect(selectionOutline(sel as NonNullable<typeof sel>).length % 4).toBe(0);
    expect(selectionOutline({ x: 1, y: 2, w: 3, h: 4 }).length).toBe(16);
    expect(selectionFromMask(rectMask(10, 10, { x: 2, y: 2, w: 3, h: 3 }))).toEqual({ x: 2, y: 2, w: 3, h: 3, alpha: null });
  });
  it('selects a colour range and paints to select (quick select stops at edges)', () => {
    const p = picture(40, 20, (x) => (x < 20 ? [30, 120, 220, 255] : [240, 200, 40, 255]));
    const c = colorRangeMask(p, { r: 30, g: 120, b: 220, a: 255 }, 40);
    expect(c.data[5]).toBe(255);
    expect(c.data[30]).toBe(0);
    const q = quickSelectMask(p, [{ x: 5, y: 10 }, { x: 8, y: 10 }], 2);
    expect(countSelected(q)).toBe(400);
  });
});

describe('fills', () => {
  it('places every point along the five kinds of colour fade', () => {
    const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
    expect(gradientT('linear', 0, 50, a, b)).toBe(0);
    expect(gradientT('linear', 50, 9, a, b)).toBeCloseTo(0.5);
    expect(gradientT('reflected', -50, 0, a, b)).toBeCloseTo(0.5);
    expect(gradientT('radial', 0, 60, a, b)).toBeCloseTo(0.6);
    expect(gradientT('diamond', 30, 30, a, b)).toBeCloseTo(0.6);
    expect(gradientT('angle', 0, -10, a, b)).toBeCloseTo(0.25);
  });
  it('fills a layer with a fade, and undo brings the old pixels back', () => {
    const d = createDocument(100, 10), l = d.layers[0], h = new History();
    h.push(fillGradient(d, l, { kind: 'linear', from: { x: 0, y: 5 }, to: { x: 100, y: 5 }, stops: [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }], opacity: 1 }));
    expect(px(l, 0, 5)[0]).toBeLessThan(5);
    expect(px(l, 99, 5)[0]).toBeGreaterThan(250);
    expect(Math.abs(px(l, 50, 5)[0] - 128)).toBeLessThan(5);
    h.undo(d);
    expect(px(l, 0, 5)).toEqual([255, 255, 255, 255]);
  });
  it('fills only the touching area of similar colour with the paint bucket', () => {
    const d = docOf(picture(30, 10, (x) => (x < 10 || x >= 20 ? [200, 0, 0, 255] : [0, 0, 200, 255]))), l = d.layers[0];
    bucketFill(d, l, 2, 2, { color: { r: 0, g: 255, b: 0, a: 255 }, tolerance: 10, contiguous: true, allLayers: false, opacity: 1 });
    expect(px(l, 2, 2)).toEqual([0, 255, 0, 255]);
    expect(px(l, 25, 2)).toEqual([200, 0, 0, 255]);
  });
  it('outlines a selection inside its edge', () => {
    const d = createDocument(50, 50), l = d.layers[0];
    d.selection = { x: 10, y: 10, w: 30, h: 30 };
    strokeSelection(d, l, { width: 4, color: { r: 255, g: 0, b: 0, a: 255 }, where: 'inside', opacity: 1 });
    expect(px(l, 11, 25)).toEqual([255, 0, 0, 255]);
    expect(px(l, 25, 25)).toEqual([255, 255, 255, 255]);
    expect(px(l, 8, 25)).toEqual([255, 255, 255, 255]);
  });
});

describe('retouching', () => {
  it('darkens a red pupil and leaves a grey picture alone', () => {
    const d = docOf(picture(40, 40, (x, y) => ((x - 20) ** 2 + (y - 20) ** 2 < 36 ? [220, 40, 40, 255] : [120, 120, 120, 255]))), l = d.layers[0];
    expect(redEye(d, l, 20, 20, { size: 12, darken: 0.5 })).toBeTruthy();
    expect(px(l, 20, 20)[0]).toBeLessThan(60);
    const g = docOf(picture(20, 20, () => [120, 120, 120, 255]));
    expect(redEye(g, g.layers[0], 10, 10, { size: 8, darken: 0.5 })).toBeNull();
  });
  it('heals: the patch takes its light from the surroundings', () => {
    const w = 20, h = 20, t = new Uint8ClampedArray(w * h * 4).fill(100), s = new Uint8ClampedArray(w * h * 4).fill(50), m = new Uint8Array(w * h);
    for (let y = 6; y < 14; y++) for (let x = 6; x < 14; x++) { m[y * w + x] = 255; t.set([255, 255, 255, 255], (y * w + x) * 4); }
    const out = healPatch(t, s, m, w, h);
    expect(Math.abs(out[(10 * w + 10) * 4] - 100)).toBeLessThan(4);
  });
  it('copies pixels with the clone stamp, and undo restores them', () => {
    const d = docOf(picture(60, 20, (x) => (x < 30 ? [255, 0, 0, 255] : [0, 0, 255, 255]))), l = d.layers[0], h = new History();
    const s = new EffectStroke(d, l, { kind: 'clone', size: 8, hardness: 1, strength: 1, offset: { x: -30, y: 0 } });
    s.add({ x: 45, y: 10 });
    s.add({ x: 50, y: 10 });
    expect(px(l, 47, 10)).toEqual([255, 0, 0, 255]);
    h.push(s.end('Copy an area'));
    h.undo(d);
    expect(px(l, 47, 10)).toEqual([0, 0, 255, 255]);
  });
  it('removes a spot with spot healing and with patch', () => {
    const mk = (): Doc => docOf(picture(80, 80, (x, y) => ((x - 40) ** 2 + (y - 40) ** 2 < 16 ? [10, 10, 10, 255] : [180 + (x % 3), 170, 160, 255])));
    const d = mk(), l = d.layers[0], s = new EffectStroke(d, l, { kind: 'spot-heal', size: 14, hardness: 0.8, strength: 1 });
    s.add({ x: 40, y: 40 });
    s.finishHeal();
    expect(px(l, 40, 40)[0]).toBeGreaterThan(150);
    const d2 = mk();
    d2.selection = { x: 34, y: 34, w: 12, h: 12 };
    expect(patchArea(d2, d2.layers[0], { x: 20, y: 0 })).toBeTruthy();
    expect(px(d2.layers[0], 40, 40)[0]).toBeGreaterThan(150);
  });
  it('dodges, burns, sponges, blurs and smudges', () => {
    expect(toneShift(100, 0.6, 'midtones', true)).toBeGreaterThan(100);
    expect(toneShift(100, 0.6, 'midtones', false)).toBeLessThan(100);
    const d = docOf(picture(40, 20, () => [200, 60, 60, 255])), l = d.layers[0];
    const sp = new EffectStroke(d, l, { kind: 'sponge', size: 10, hardness: 1, strength: 1, more: false });
    sp.add({ x: 10, y: 10 });
    const [r, g] = px(l, 10, 10);
    expect(r - g).toBeLessThan(140);
    const e = docOf(picture(40, 20, (x) => (x < 20 ? [0, 0, 0, 255] : [255, 255, 255, 255]))), el = e.layers[0];
    const bl = new EffectStroke(e, el, { kind: 'blur', size: 8, hardness: 1, strength: 1 });
    for (let i = 0; i < 6; i++) bl.add({ x: 20, y: 5 + i * 2 });
    expect(px(el, 20, 10)[0]).toBeGreaterThan(20);
    expect(px(el, 20, 10)[0]).toBeLessThan(250);
    const sm = new EffectStroke(e, el, { kind: 'smudge', size: 6, hardness: 1, strength: 0.9 });
    for (let x = 5; x <= 30; x += 1) sm.add({ x, y: 15 });
    expect(px(el, 24, 15)[0]).toBeLessThan(200);
  });
});

describe('transforms and layout', () => {
  it('solves the corner map and redraws a layer twice as big', () => {
    const q = quadOfRect({ x: 0, y: 0, w: 10, h: 10 }), t = quadOfRect({ x: 5, y: 5, w: 20, h: 20 }), m = homography(q, t) as number[];
    expect(mapPoint(m, 10, 10).x).toBeCloseTo(25);
    expect(mapPoint(invert3(m) as number[], 25, 25).x).toBeCloseTo(10);
    const same = warpBitmap({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(200) }, quadOfRect({ x: 0, y: 0, w: 4, h: 4 }));
    expect([...(same?.data ?? [])].every((v) => v === 200)).toBe(true);
    const d = createDocument(100, 100), l = createLayer('Box', 10, 10, { x: 10, y: 10, fill: { r: 255, g: 0, b: 0, a: 255 } });
    addLayer(d, l, 1);
    const h = new History();
    h.push(transformLayer(d, l, quadOfRect({ x: 10, y: 10, w: 20, h: 20 })));
    expect([l.width, l.height]).toEqual([20, 20]);
    expect(px(l, 20, 20)).toEqual([255, 0, 0, 255]);
    h.undo(d);
    expect([l.width, l.height]).toEqual([10, 10]);
    const moved = transformSelection({ x: 10, y: 10, w: 10, h: 10 }, quadOfRect({ x: 30, y: 30, w: 10, h: 10 }), 100, 100);
    expect(moved && { x: moved.x, y: moved.y, w: moved.w, h: moved.h }).toEqual({ x: 30, y: 30, w: 10, h: 10 });
  });
  it('lines layers up, spaces them out and picks the layer under the pointer', () => {
    const d = createDocument(200, 100);
    const ids = [10, 40, 150].map((x, i) => { const l = createLayer('L' + i, 10, 10, { x, y: 20, fill: { r: 0, g: 0, b: 0, a: 255 } }); addLayer(d, l, d.layers.length); return l.id; });
    alignLayer(d, ids[0], { x: 0, y: 50, w: 200, h: 40 }, 'bottom');
    expect(contentBounds(d.layers[1])).toEqual({ x: 10, y: 80, w: 10, h: 10 });
    distributeLayers(d, ids, 'h');
    expect(d.layers[2].x).toBe(80);
    expect(layerAt(d, 85, 25)?.id).toBe(ids[1]);
    expect(layerAt(d, 5, 5)?.name).toBe('Background');
  });
  it('lays out text lines centred, with letter spacing', () => {
    const lay = layoutText({ kind: 'text', text: 'ab\nabcd', x: 100, y: 10, style: { ...DEFAULT_TEXT_STYLE, size: 20, align: 'center', letterSpacing: 2 } }, (s) => s.length * 10);
    expect(lay.lines[0]).toEqual({ text: 'ab', x: 89, y: 10, width: 22 });
    expect(lay.lines[1].y).toBe(34);
    expect(lay.box).toEqual({ x: 77, y: 10, w: 46, h: 48 });
  });
  it('outlines shapes, and keeps shape layers editable and undoable', () => {
    const s: ShapeContent = { kind: 'shape', shape: 'polygon', x0: 0, y0: 0, x1: 100, y1: 100, fill: '#ff0000', stroke: null, strokeWidth: 4, radius: 0, sides: 5, star: false, arrow: false };
    expect(shapePoints(s)).toHaveLength(5);
    expect(shapePoints({ ...s, star: true })).toHaveLength(10);
    expect(shapePoints({ ...s, shape: 'rounded', radius: 10 })).toHaveLength(36);
    expect(shapeBounds({ ...s, shape: 'rect', stroke: '#000000' })).toEqual({ x: -4, y: -4, w: 108, h: 108 });
    const d = createDocument(50, 50), l = createLayer('Shape', 10, 10);
    addLayer(d, l, 1);
    const h = new History();
    h.push(contentCommand(d, l.id, { ...s, at: { x: 0, y: 0 } }, { x: 0, y: 0, width: 20, height: 20, data: new Uint8ClampedArray(1600) }, 'Shape'));
    expect(l.width).toBe(20);
    l.x = 5;
    expect(currentContent(l)).toMatchObject({ x0: 5, x1: 105 });
    h.undo(d);
    expect(l.content).toBeUndefined();
    expect(l.width).toBe(10);
  });
  it('keeps an empty mask empty', () => {
    expect(maskBounds(emptyMask(5, 5))).toBeNull();
  });
});
