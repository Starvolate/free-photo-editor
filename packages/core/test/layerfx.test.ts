// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Layer effects (W6 S4, design 2.7): hand-checked pixels for each effect on a small square, the fixed order, Fill,
 * a region equal to the whole, the cache, and the rule that a flatten without the effects module throws.
 */
import { describe, expect, it } from 'vitest';
import { compositeRect, layerPixelsChanged, type BlendLayer, type LayerEffects, type RGBA } from '../src';
import { addLayerFx, emptyEffects, fxStats, installLayerFx } from '../src/layerfx';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 }, GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 }, BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 }, WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };
function square(x: number, y: number, w: number, h: number, c: RGBA, fx?: LayerEffects, extra: Partial<BlendLayer> = {}): BlendLayer {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = c.a; }
  return { visible: true, opacity: 1, blendMode: 'normal', x, y, width: w, height: h, data, ...(fx ? { fx } : {}), ...extra };
}
const at = (px: Uint8ClampedArray, w: number, x: number, y: number): number[] => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
const fx = (f: Partial<LayerEffects>): LayerEffects => ({ ...emptyEffects(), ...f });
const R8 = { x: 0, y: 0, w: 8, h: 8 };

describe('layer effects', () => {
  it('a flatten that meets effects without the module throws, so a missed load fails loudly', () => {
    const l = square(2, 2, 4, 4, RED, addLayerFx(undefined, 'drop-shadow'));
    expect(() => compositeRect([l], R8, WHITE)).toThrow(/layer effects/);
  });

  it('colour overlay covers exactly the shape', () => {
    installLayerFx();
    const l = square(2, 2, 4, 4, RED, fx({ colorOverlay: [{ on: true, blend: 'normal', opacity: 1, color: BLUE }] }));
    const out = compositeRect([l], R8, WHITE);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((x) => at(out, 8, x, 3))).toEqual([
      [255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 255, 255], [0, 0, 255, 255], [0, 0, 255, 255], [0, 0, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]]);
  });

  it('an outline outside, 1 px: full beside each edge, a soft corner at √2 px, nothing further', () => {
    installLayerFx();
    const l = square(2, 2, 4, 4, RED, fx({ stroke: [{ on: true, blend: 'normal', opacity: 1, size: 1, where: 'outside', color: GREEN }] }));
    const out = compositeRect([l], R8, null);
    // row 1 sits just above the square: corners are √2 from the nearest shape pixel, so 2 − √2 = 0.586 → 149
    expect([0, 1, 2, 5, 6, 7].map((x) => at(out, 8, x, 1))).toEqual([[0, 0, 0, 0], [0, 255, 0, 149], [0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 149], [0, 0, 0, 0]]);
    expect([1, 2, 5, 6].map((x) => at(out, 8, x, 2))).toEqual([[0, 255, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255]]);
    expect(at(out, 8, 3, 0)).toEqual([0, 0, 0, 0]);
  });

  it('drop shadow, hard (size 0): the shape moved by the distance away from the light, under the layer', () => {
    installLayerFx();
    const hard = { on: true, blend: 'normal' as const, opacity: 1, color: BLACK, spread: 0, size: 0 };
    // light from above (90°): the shadow falls 2 px down
    const down = compositeRect([square(2, 2, 2, 2, RED, fx({ dropShadow: [{ ...hard, angle: 90, distance: 2 }] }))], R8, WHITE);
    expect([1, 2, 3, 4, 5, 6].map((y) => at(down, 8, 2, y))).toEqual([[255, 255, 255, 255], [255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255]]);
    // light from the left (180°): 1 px to the right; inside the square the layer covers its shadow
    const right = compositeRect([square(2, 2, 4, 4, RED, fx({ dropShadow: [{ ...hard, angle: 180, distance: 1 }] }))], R8, WHITE);
    expect([1, 2, 5, 6, 7].map((x) => at(right, 8, x, 3))).toEqual([[255, 255, 255, 255], [255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255]]);
  });

  it('a soft drop shadow and an outer glow darken or lighten only outside the shape, fading with distance', () => {
    installLayerFx();
    const l = square(20, 20, 20, 20, RED, addLayerFx(addLayerFx(undefined, 'drop-shadow'), 'outer-glow'));
    const out = compositeRect([l], { x: 0, y: 0, w: 64, h: 64 }, { r: 128, g: 128, b: 128, a: 255 });
    expect(at(out, 64, 30, 30)).toEqual([255, 0, 0, 255]);
    const near = at(out, 64, 30, 42)[1], far = at(out, 64, 30, 50)[1];
    expect(near).not.toBe(128);
    expect(Math.abs(near - 128)).toBeGreaterThan(Math.abs(far - 128));
    expect(at(out, 64, 2, 2)).toEqual([128, 128, 128, 255]);
  });

  it('order: the outline lies over a colour overlay; inner shadow and inner glow stay inside the shape', () => {
    installLayerFx();
    const l = square(2, 2, 4, 4, RED, fx({
      colorOverlay: [{ on: true, blend: 'normal', opacity: 1, color: GREEN }],
      stroke: [{ on: true, blend: 'normal', opacity: 1, size: 1, where: 'inside', color: BLUE }],
    }));
    const out = compositeRect([l], R8, WHITE);
    expect([1, 2, 3, 4, 5, 6].map((x) => at(out, 8, x, 3))).toEqual([[255, 255, 255, 255], [0, 0, 255, 255], [0, 255, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]]);
    const inner = square(5, 5, 30, 30, RED, addLayerFx(addLayerFx(undefined, 'inner-shadow'), 'inner-glow'));
    const o2 = compositeRect([inner], { x: 0, y: 0, w: 40, h: 40 }, WHITE);
    expect(at(o2, 40, 2, 2)).toEqual([255, 255, 255, 255]);
    expect(at(o2, 40, 20, 20)).toEqual([255, 0, 0, 255]); // 15 px from every edge: beyond both effects' reach
    expect(at(o2, 40, 6, 6)).not.toEqual([255, 0, 0, 255]); // near the corner the light comes from, the edge changes
  });

  it('0% Fill hides the layer’s own pixels and keeps the outline; Fill without effects equals opacity', () => {
    installLayerFx();
    const l = square(2, 2, 4, 4, RED, fx({ stroke: [{ on: true, blend: 'normal', opacity: 1, size: 1, where: 'outside', color: GREEN }] }), { fillOpacity: 0 });
    const out = compositeRect([l], R8, null);
    expect(at(out, 8, 3, 3)[3]).toBe(0);
    expect(at(out, 8, 1, 3)).toEqual([0, 255, 0, 255]);
    const a = compositeRect([square(0, 0, 8, 8, WHITE), square(2, 2, 4, 4, RED, undefined, { opacity: 0.5 })], R8, null);
    const b = compositeRect([square(0, 0, 8, 8, WHITE), square(2, 2, 4, 4, RED, undefined, { fillOpacity: 0.5 })], R8, null);
    expect(b).toEqual(a);
  });

  it('effects switched off draw nothing: the bytes equal a layer without effects', () => {
    installLayerFx();
    const off = addLayerFx(undefined, 'drop-shadow');
    const l = square(2, 2, 4, 4, RED, { ...off, on: false });
    expect(compositeRect([l], R8, WHITE)).toEqual(compositeRect([square(2, 2, 4, 4, RED)], R8, WHITE));
  });

  it('a region, bands or odd tiles give the same bytes as one whole run, across tile edges', () => {
    installLayerFx();
    let f = emptyEffects();
    for (const k of ['drop-shadow', 'outer-glow', 'inner-shadow', 'inner-glow', 'gradient-overlay', 'stroke'] as const) f = addLayerFx(f, k, BLUE);
    f = { ...f, stroke: [{ ...f.stroke[0], where: 'centre', size: 4 }], dropShadow: [{ ...f.dropShadow[0], spread: 20, size: 7 }] };
    const W = 300, H = 260, data = new Uint8ClampedArray(200 * 150 * 4);
    for (let y = 0; y < 150; y++) for (let x = 0; x < 200; x++) { const i = (y * 200 + x) * 4, inside = (x - 100) ** 2 / 90 ** 2 + (y - 75) ** 2 / 60 ** 2 < 1; data[i] = x; data[i + 1] = y; data[i + 2] = 90; data[i + 3] = inside ? 255 : 0; }
    const layers: BlendLayer[] = [square(0, 0, W, H, { r: 200, g: 210, b: 220, a: 255 }), { visible: true, opacity: 0.9, blendMode: 'normal', x: 50, y: 60, width: 200, height: 150, data, fx: f }];
    const whole = compositeRect(layers, { x: 0, y: 0, w: W, h: H }, null);
    const bands = new Uint8ClampedArray(whole.length);
    for (let y = 0; y < H; y += 37) { const h = Math.min(37, H - y); bands.set(compositeRect(layers, { x: 0, y, w: W, h }, null), y * W * 4); }
    expect(bands).toEqual(whole);
    const part = compositeRect(layers, { x: 117, y: 121, w: 23, h: 19 }, null);
    for (let y = 0; y < 19; y++) expect(part.subarray(y * 23 * 4, (y + 1) * 23 * 4)).toEqual(whole.subarray(((121 + y) * W + 117) * 4, ((121 + y) * W + 140) * 4));
  });

  it('the cache: drawing again, or after an edit to another layer, computes nothing; an edit to the layer itself moves its shadow', () => {
    installLayerFx();
    const bg = square(0, 0, 64, 64, WHITE), l = square(10, 10, 10, 10, RED, addLayerFx(undefined, 'drop-shadow')), r = { x: 0, y: 0, w: 64, h: 64 };
    const first = compositeRect([bg, l], r, null);
    const n = fxStats.tiles;
    expect(compositeRect([bg, l], r, null)).toEqual(first);
    bg.data.fill(0, 0, 4 * 64); // another layer painted in place
    compositeRect([bg, l], r, null);
    expect(fxStats.tiles).toBe(n);
    l.data.fill(0); // the effect layer itself painted clear in place
    layerPixelsChanged();
    const after = compositeRect([bg, l], r, null);
    expect(fxStats.tiles).toBeGreaterThan(n);
    expect(at(after, 64, 20, 24)).toEqual([255, 255, 255, 255]); // no shape, no shadow
    expect(at(first, 64, 20, 24)).not.toEqual([255, 255, 255, 255]);
  });
});
