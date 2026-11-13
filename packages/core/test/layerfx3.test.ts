// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The rest of the layer effects (batch effects 3): raised edge, satin sheen, pattern overlay, the blur effect, blend by
 * brightness, and colour fade and pattern layers. Hand-checked pixels on small squares, then the proof that bands and odd
 * regions give the same bytes as the whole picture with all of them on at once.
 */
import { describe, expect, it } from 'vitest';
import { compositeRect, hasLayerFx, needsLayerFx, type BlendLayer, type FxBevel, type LayerEffects, type RGBA } from '../src';
import { addLayerFx, createFillOf, emptyEffects, fxReachOf, installLayerFx } from '../src/layerfx';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 }, BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 }, GREY: RGBA = { r: 128, g: 128, b: 128, a: 255 };
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 }, WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };
function layer(x: number, y: number, w: number, h: number, c: RGBA | ((i: number) => RGBA), fx?: LayerEffects): BlendLayer {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const k = typeof c === 'function' ? c(i) : c; data.set([k.r, k.g, k.b, k.a], i * 4); }
  return { visible: true, opacity: 1, blendMode: 'normal', x, y, width: w, height: h, data, ...(fx ? { fx } : {}) };
}
const at = (px: Uint8ClampedArray, w: number, x: number, y: number): number[] => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
const fx = (f: Partial<LayerEffects>): LayerEffects => ({ ...emptyEffects(), ...f });
const bevel = (b: Partial<FxBevel>): FxBevel => ({ on: true, style: 'inner', method: 'chisel', depth: 100, up: true, size: 2, soften: 0, angle: 90, altitude: 30,
  light: { color: WHITE, blend: 'screen', opacity: 1 }, dark: { color: BLACK, blend: 'multiply', opacity: 1 }, ...b });
const R16 = { x: 0, y: 0, w: 16, h: 16 };

describe('layer effects, batch 3', () => {
  it('a pattern layer without the effects module throws when flattened, so a missed load fails loudly', () => {
    expect(() => compositeRect([createFillOf('pattern', 'P', 8, 8, BLACK, WHITE)], { x: 0, y: 0, w: 8, h: 8 }, WHITE)).toThrow(/layer effects/);
  });

  it('every new effect counts as an effect, reaches as far as it draws, and fade and pattern layers need the module', () => {
    for (const k of ['raised-edge', 'satin-sheen', 'pattern-overlay', 'blur', 'brightness-blend'] as const) expect(hasLayerFx({ fx: addLayerFx(undefined, k) }), k).toBe(true);
    expect(fxReachOf(fx({ bevel: bevel({ size: 5, soften: 3 }) }))).toBe(10);
    expect(fxReachOf(fx({ satin: { on: true, blend: 'multiply', opacity: 0.5, color: BLACK, angle: 19, distance: 11, size: 14, invert: true } }))).toBe(27);
    expect(fxReachOf(fx({ bevel: bevel({ size: 5 }), blur: { on: true, size: 4 } }))).toBe(11);
    expect(needsLayerFx(createFillOf('gradient', 'G', 8, 8, BLACK, WHITE))).toBe(true);
    expect(needsLayerFx({ kind: 'fill', fill: { type: 'solid', color: RED } })).toBe(false);
  });

  it('raised edge inside, chisel 2 px, light from above at 30°: the top edge lights to 235, the bottom edge shades to 0, the flat middle stays', () => {
    installLayerFx();
    // Top row (8,4): height 0.25, slope 0.375 × 2 → normal (0, −0.75, 1)/1.25, lit 0.9196 against flat 0.5 → 0.839 white screen
    // over grey 128: 0.839 + 0.161 × 0.502 = 0.920 → 235. Bottom row (8,11) faces away: shade 1 → black multiply → 0.
    const out = compositeRect([layer(4, 4, 8, 8, GREY, fx({ bevel: bevel({}) }))], R16, WHITE);
    expect(at(out, 16, 8, 4)).toEqual([235, 235, 235, 255]);
    expect(at(out, 16, 8, 11)).toEqual([0, 0, 0, 255]);
    expect(at(out, 16, 8, 8)).toEqual([128, 128, 128, 255]);
    expect(at(out, 16, 8, 3)).toEqual([255, 255, 255, 255]); // inner: nothing outside the shape
    // Pressed in (up off): the light and shade swap sides.
    const down = compositeRect([layer(4, 4, 8, 8, GREY, fx({ bevel: bevel({ up: false }) }))], R16, WHITE);
    expect(at(down, 16, 8, 4)).toEqual([0, 0, 0, 255]);
  });

  it('raised edge outside lights and shades what is below, beside the shape, and leaves the layer itself alone', () => {
    installLayerFx();
    const out = compositeRect([layer(4, 4, 8, 8, GREY, fx({ bevel: bevel({ style: 'outer' }) }))], R16, GREY);
    expect(at(out, 16, 8, 3)).toEqual([235, 235, 235, 255]); // just above: the same lit slope, now outside
    expect(at(out, 16, 8, 12)).toEqual([0, 0, 0, 255]);
    expect(at(out, 16, 8, 4)).toEqual([128, 128, 128, 255]);
    expect(at(out, 16, 8, 0)).toEqual([128, 128, 128, 255]); // past its size: untouched
  });

  it('satin sheen, hard (size 0), 1 px from the right: where the two moved copies differ, inside the shape only', () => {
    installLayerFx();
    const l = layer(2, 2, 4, 4, RED, fx({ satin: { on: true, blend: 'normal', opacity: 1, color: BLACK, angle: 0, distance: 1, size: 0, invert: false } }));
    const out = compositeRect([l], { x: 0, y: 0, w: 8, h: 8 }, WHITE);
    expect([1, 2, 3, 4, 5, 6].map((x) => at(out, 8, x, 3))).toEqual([[255, 255, 255, 255], [0, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255]]);
    // Inverted, the sheen lies where the copies agree.
    const inv = compositeRect([{ ...l, fx: fx({ satin: { ...(l.fx as LayerEffects).satin!, invert: true } }) }], { x: 0, y: 0, w: 8, h: 8 }, WHITE);
    expect([2, 3].map((x) => at(inv, 8, x, 3))).toEqual([[255, 0, 0, 255], [0, 0, 0, 255]]);
  });

  it('pattern overlay: the checks pattern (8 px squares, 235 and 120) from the document corner, twice as big at scale 2', () => {
    installLayerFx();
    const p = (scale: number): LayerEffects => fx({ patternOverlay: { on: true, blend: 'normal', opacity: 1, pattern: 'fpe:checks', scale } });
    const out = compositeRect([layer(0, 0, 16, 8, RED, p(1))], { x: 0, y: 0, w: 16, h: 8 }, WHITE);
    expect([0, 7, 8, 15].map((x) => at(out, 16, x, 0))).toEqual([[235, 235, 235, 255], [235, 235, 235, 255], [120, 120, 120, 255], [120, 120, 120, 255]]);
    const big = compositeRect([layer(0, 0, 16, 8, RED, p(2))], { x: 0, y: 0, w: 16, h: 8 }, WHITE);
    expect([8, 15].map((x) => at(big, 16, x, 0))).toEqual([[235, 235, 235, 255], [235, 235, 235, 255]]);
    // A pattern of its own (from a selection): 2 × 1, red then blue, tiled.
    const own = fx({ patternOverlay: { on: true, blend: 'normal', opacity: 1, pattern: 'own', scale: 1, image: { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) } } });
    const t = compositeRect([layer(0, 0, 4, 1, GREY, own)], { x: 0, y: 0, w: 4, h: 1 }, WHITE);
    expect([0, 1, 2].map((x) => at(t, 4, x, 0))).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [255, 0, 0, 255]]);
  });

  it('the blur effect spreads one white pixel by [1,3,6,7,6,3,1]/27 each way (size 3) and keeps the layer’s own pixels untouched', () => {
    installLayerFx();
    const l = layer(8, 8, 1, 1, WHITE, fx({ blur: { on: true, size: 3 } }));
    const out = compositeRect([l], { x: 0, y: 0, w: 17, h: 17 }, null);
    // (7/27)² = 0.0672 → 17; (6/27)(7/27) → 15; (3/27)(7/27) → 7; (1/27)(7/27) → 2; then nothing
    expect([8, 9, 10, 11, 12].map((x) => at(out, 17, x, 8))).toEqual([[255, 255, 255, 17], [255, 255, 255, 15], [255, 255, 255, 7], [255, 255, 255, 2], [0, 0, 0, 0]]);
    expect([...l.data]).toEqual([255, 255, 255, 255]);
  });

  it('blend by brightness: hidden over light parts below, half shown at 191, and by its own brightness', () => {
    installLayerFx();
    const below = [BLACK, BLACK, { r: 191, g: 191, b: 191, a: 255 }, WHITE];
    const bottom = layer(0, 0, 4, 1, (i) => below[i]);
    const top = layer(0, 0, 4, 1, RED, fx({ blendIf: { on: true, self: [0, 0, 255, 255], under: [0, 0, 128, 255] } }));
    const out = compositeRect([bottom, top], { x: 0, y: 0, w: 4, h: 1 }, null);
    // 191: (255 − 191) / 127 = 0.504 of red over grey 191 → 223, 95, 95
    expect([0, 2, 3].map((x) => at(out, 4, x, 0))).toEqual([[255, 0, 0, 255], [223, 95, 95, 255], [255, 255, 255, 255]]);
    const self = [BLACK, { r: 100, g: 100, b: 100, a: 255 }, WHITE];
    const own = layer(0, 0, 3, 1, (i) => self[i], addLayerFx(undefined, 'brightness-blend'));
    expect([0, 1, 2].map((x) => at(compositeRect([own], { x: 0, y: 0, w: 3, h: 1 }, BLUE), 3, x, 0))).toEqual([[0, 0, 0, 255], [100, 100, 100, 255], [0, 0, 255, 255]]);
  });

  it('colour fade and pattern layers cover the canvas, stay editable values, and draw exact rows', () => {
    installLayerFx();
    const g = createFillOf('gradient', 'Fade', 8, 1, BLACK, WHITE);
    if (g.fill?.type !== 'gradient') throw new Error('not a fade');
    g.fill = { ...g.fill, angle: 0 };
    // left to right across 8 px: t = 0.5 + (x + 0.5 − 4) / 8 → x 0: 0.0625 → 16; x 7: 0.9375 → 239
    const out = compositeRect([g], { x: 0, y: 0, w: 8, h: 1 }, null);
    expect([0, 7].map((x) => at(out, 8, x, 0))).toEqual([[16, 16, 16, 255], [239, 239, 239, 255]]);
    const p = createFillOf('pattern', 'Pattern', 16, 8, BLACK, WHITE);
    const pat = compositeRect([p], { x: 0, y: 0, w: 16, h: 8 }, null);
    expect([0, 8].map((x) => at(pat, 16, x, 0))).toEqual([[235, 235, 235, 255], [120, 120, 120, 255]]);
    expect(p.fill?.color).toEqual({ r: 178, g: 178, b: 178, a: 255 });
  });

  it('bands and odd regions equal the whole with raised edge, satin, pattern, blur, blend by brightness and a fade layer all on', () => {
    installLayerFx();
    const W = 260, H = 200;
    const base = createFillOf('gradient', 'Fade', W, H, BLUE, WHITE);
    const disc = layer(30, 40, 150, 110, (i) => {
      const x = i % 150, y = Math.floor(i / 150), d = Math.hypot(x - 75, y - 55);
      return { r: (x * 3) & 255, g: 120, b: (y * 2) & 255, a: Math.max(0, Math.min(255, Math.round((52 - d) * 40))) };
    }, fx({ bevel: bevel({ method: 'smooth', size: 6, soften: 2, angle: 120 }),
      satin: { on: true, blend: 'multiply', opacity: 0.5, color: BLACK, angle: 19, distance: 7, size: 5, invert: true },
      patternOverlay: { on: true, blend: 'multiply', opacity: 0.6, pattern: 'fpe:bricks', scale: 1.5 },
      dropShadow: [{ on: true, blend: 'multiply', opacity: 0.75, color: BLACK, angle: 120, distance: 6, spread: 0, size: 5 }],
      blur: { on: true, size: 3 }, blendIf: { on: true, self: [0, 0, 255, 255], under: [0, 40, 200, 255] } }));
    const whole = compositeRect([base, disc], { x: 0, y: 0, w: W, h: H }, WHITE);
    const bands = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y += 37) { const h = Math.min(37, H - y); bands.set(compositeRect([base, disc], { x: 0, y, w: W, h }, WHITE), y * W * 4); }
    expect(Buffer.from(bands).equals(Buffer.from(whole))).toBe(true);
    const r = { x: 101, y: 77, w: 59, h: 61 }, part = compositeRect([base, disc], r, WHITE);
    let same = true;
    for (let y = 0; y < r.h && same; y++) for (let x = 0; x < r.w; x++) if (at(part, r.w, x, y).join() !== at(whole, W, r.x + x, r.y + y).join()) { same = false; break; }
    expect(same).toBe(true);
  });
});
