// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * W6 S3 (design 2.5, 2.6, 3.1): editable light and colour layers and the solid colour layer. Each of the 15 kinds, at
 * 100% with no mask over one opaque layer, gives exactly the bytes of its Image › Adjustments dialog (the same ADJ entry,
 * the same engine), at the starting settings and with one setting changed. Then mixing, scope, splitting, the stroke
 * cache, the colour layer, and one undo step.
 */
import { describe, expect, it } from 'vitest';
import {
  StrokeCache, addNode, checkTree, compositeRect, createAdjustLayer, createDocument, createFillLayer, createFolder, createLayer, propsCommand,
  runJob, type JobSpec, type Layer,
} from '@free-photoeditor/core';
import { ADJ, HANDLERS } from '../src/commands';
import { BY_ID } from '../src/registry';

const KINDS = ['brightness', 'levels', 'curves', 'exposure', 'vibrance', 'hue', 'color-balance', 'bw', 'photo-filter', 'channel-mixer', 'invert',
  'posterize', 'threshold', 'gradient-map', 'selective-color'];
const W = 37, H = 23, ALL = { x: 0, y: 0, w: W, h: H };
function photo(seed: number, w = W, h = H, x = 0, y = 0, alpha = 255): Layer {
  const l = createLayer('p' + seed, w, h, { x, y }), d = l.data;
  for (let i = 0, k = 0; i < d.length; i += 4, k++) { d[i] = (k * 37 + seed * 11) & 255; d[i + 1] = (k * 91 + seed * 7) & 255; d[i + 2] = (k * 13 + 200 * seed) & 255; d[i + 3] = alpha; }
  return l;
}
const specOf = (id: string, change: boolean): JobSpec => {
  const def = ADJ[id], params: Record<string, number> = {};
  for (const c of def.controls) params[c.key] = c.value;
  const c = def.controls[0];
  if (change && c) {
    if (c.type === 'select') params[c.key] = (c.value + 1) % (c.options?.length ?? 2);
    else if (c.type === 'check') params[c.key] = c.value ? 0 : 1;
    else { const lo = c.min ?? 0, hi = c.max ?? 100; params[c.key] = Math.round(lo + (hi - lo) * 0.3) === c.value ? Math.round(lo + (hi - lo) * 0.7) : Math.round(lo + (hi - lo) * 0.3); }
  }
  return { op: def.op, kind: def.kind, params };
};

describe('editable light and colour layers', () => {
  for (const k of KINDS) {
    const id = 'image.adj-' + k;
    it(`${k}: the layer gives the dialog's exact bytes, at the start and with one setting changed`, () => {
      expect(ADJ[id]?.op).toBe('adjust');
      expect(BY_ID.get('layer.adj-' + k)?.status).toBe('ready');
      expect(HANDLERS['layer.adj-' + k]).toBeTruthy();
      for (const change of [false, true]) {
        if (change && !ADJ[id].controls.length) continue;
        const base = photo(3), spec = specOf(id, change), adj = createAdjustLayer('a', id, spec);
        const want = runJob(spec, { width: W, height: H, data: base.data });
        expect(Array.from(compositeRect([base, adj], ALL))).toEqual(Array.from(want));
      }
    });
  }
  const inv: JobSpec = { op: 'adjust', kind: 'invert', params: {} };
  it('mixes by opacity, hides cleanly, and never changes alpha', () => {
    const base = photo(5, W, H, 0, 0, 160), plain = compositeRect([base], ALL);
    const half = { ...createAdjustLayer('a', 'image.adj-invert', inv), opacity: 0.5 };
    const out = compositeRect([base, half], ALL);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i + 3]).toBe(plain[i + 3]);
      for (let c = 0; c < 3; c++) expect(Math.abs(out[i + c] - (plain[i + c] + (255 - plain[i + c] - plain[i + c]) * 0.5))).toBeLessThanOrEqual(1);
    }
    expect(Array.from(compositeRect([base, { ...half, visible: false }], ALL))).toEqual(Array.from(plain));
  });
  it('clipped, it changes only the layer below; in a folder that is not pass through, only what is inside', () => {
    const bg = createLayer('bg', W, H, { fill: { r: 100, g: 100, b: 100, a: 255 } }), sq = createLayer('sq', 10, 10, { x: 5, y: 5, fill: { r: 200, g: 40, b: 0, a: 255 } });
    const clipped = { ...createAdjustLayer('a', 'image.adj-invert', inv), clip: true };
    const out = compositeRect([bg, sq, clipped], ALL);
    expect(Array.from(out.slice(0, 4))).toEqual([100, 100, 100, 255]);
    const at = (6 * W + 6) * 4;
    expect(Array.from(out.slice(at, at + 4))).toEqual([55, 215, 255, 255]);
    const f = { ...createFolder('f'), passThrough: false }, inSq = { ...sq, parentId: f.id }, inAdj = { ...createAdjustLayer('a', 'image.adj-invert', inv), parentId: f.id };
    const iso = compositeRect([bg, inSq, inAdj, f], ALL);
    expect(Array.from(iso)).toEqual(Array.from(out));
    const pass = compositeRect([bg, inSq, inAdj, { ...f, passThrough: true }], ALL);
    expect(Array.from(pass.slice(0, 4))).toEqual([155, 155, 155, 255]);
    expect(checkTree([bg, inSq, inAdj, f])).toBeNull();
  });
  it('splitting into rows and tiles gives the same bytes, and the stroke cache matches the plain draw', () => {
    const lv = createAdjustLayer('lv', 'image.adj-levels', specOf('image.adj-levels', true)), cv = createAdjustLayer('cv', 'image.adj-curves', specOf('image.adj-curves', true));
    const target = { ...photo(7, 20, 15, 4, 3), opacity: 0.7 }, layers = [photo(1), cv, target, { ...lv, opacity: 0.6, blendMode: 'overlay' as const }];
    const whole = compositeRect(layers, ALL), stitched = new Uint8ClampedArray(whole.length);
    for (const r of [{ x: 0, y: 0, w: 20, h: 11 }, { x: 20, y: 0, w: 17, h: 11 }, { x: 0, y: 11, w: 20, h: 12 }, { x: 20, y: 11, w: 17, h: 12 }]) {
      const part = compositeRect(layers, r);
      for (let y = 0; y < r.h; y++) stitched.set(part.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * W + r.x) * 4);
    }
    expect(Array.from(stitched)).toEqual(Array.from(whole));
    const cache = new StrokeCache(layers, target, null, 16);
    expect(Array.from(cache.composite(ALL))).toEqual(Array.from(whole));
    target.data.fill(90, 0, 400);
    expect(Array.from(cache.composite(ALL))).toEqual(Array.from(compositeRect(layers, ALL)));
  });
  it('a solid colour layer draws like a full picture of that colour, and one undo step swaps its settings back', () => {
    const red = { r: 220, g: 30, b: 60, a: 255 }, base = photo(2), fill = { ...createFillLayer('c', red), opacity: 0.5, blendMode: 'multiply' as const };
    const same = { ...createLayer('same', W, H, { fill: red }), opacity: 0.5, blendMode: 'multiply' as const };
    expect(Array.from(compositeRect([base, fill], ALL))).toEqual(Array.from(compositeRect([base, same], ALL)));
    expect(Array.from(compositeRect([createFillLayer('c', red)], { x: 3, y: 2, w: 1, h: 1 }))).toEqual([220, 30, 60, 255]);
    expect(BY_ID.get('layer.fill-color')?.status).toBe('ready');
    const doc = createDocument(W, H), f = createFillLayer('Colour 1', red);
    const add = addNode(doc, f, 'Solid colour layer');
    expect(add && doc.layers[doc.layers.length - 1]).toBe(f);
    const before = f.fill, after = { type: 'solid' as const, color: { r: 0, g: 0, b: 255, a: 255 } };
    f.fill = after;
    const cmd = propsCommand(f.id, { fill: before }, { fill: after }, 'Change the colour');
    cmd.undo(doc);
    expect(f.fill).toBe(before);
    cmd.redo(doc);
    expect(f.fill).toBe(after);
  });
});
