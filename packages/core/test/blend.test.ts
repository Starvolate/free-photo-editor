// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { BLEND_MODES, blendChannel, compositeRect, createLayer, type BlendMode } from '../src/index';

const one = (mode: BlendMode, back: number[], src: number[], opacity = 1): number[] => {
  const b = createLayer('b', 1, 1, { data: new Uint8ClampedArray(back) });
  const s = createLayer('s', 1, 1, { data: new Uint8ClampedArray(src) });
  s.blendMode = mode;
  s.opacity = opacity;
  return Array.from(compositeRect([b, s], { x: 0, y: 0, w: 1, h: 1 }));
};

describe('blend maths', () => {
  it('separable modes follow the published formulas', () => {
    const cases: [BlendMode, number, number, number][] = [
      ['multiply', 0.5, 0.5, 0.25], ['screen', 0.5, 0.5, 0.75], ['overlay', 0.25, 0.5, 0.25], ['overlay', 0.75, 0.5, 0.75],
      ['overlay', 0.25, 1, 0.5], ['darken', 0.3, 0.6, 0.3], ['lighten', 0.3, 0.6, 0.6], ['difference', 0.3, 0.8, 0.5],
      ['exclusion', 0.5, 0.5, 0.5], ['color-dodge', 0.5, 0.5, 1], ['color-burn', 0.5, 0.5, 0], ['soft-light', 0.5, 0.5, 0.5],
      ['hard-light', 0.5, 0.25, 0.25], ['linear-burn', 0.7, 0.6, 0.3], ['linear-dodge', 0.7, 0.6, 1], ['subtract', 0.7, 0.2, 0.5],
      ['divide', 0.3, 0.6, 0.5], ['hard-mix', 0.6, 0.5, 1], ['hard-mix', 0.4, 0.5, 0], ['pin-light', 0.9, 0.2, 0.4],
      ['linear-light', 0.5, 0.75, 1], ['vivid-light', 0.5, 0.75, 1],
    ];
    for (const [m, b, s, want] of cases) expect(blendChannel(m, b, s), m).toBeCloseTo(want, 6);
  });
  it('normal at 50% opacity mixes halfway', () => expect(one('normal', [0, 0, 0, 255], [255, 255, 255, 255], 0.5)).toEqual([128, 128, 128, 255]));
  it('multiply and screen on opaque pixels', () => {
    expect(one('multiply', [128, 128, 128, 255], [255, 0, 0, 255])).toEqual([128, 0, 0, 255]);
    expect(one('screen', [128, 0, 0, 255], [0, 0, 128, 255])).toEqual([128, 0, 128, 255]);
  });
  it('a blend mode over nothing is plain paint, and a clear source leaves the backdrop', () => {
    expect(one('multiply', [0, 0, 0, 0], [200, 100, 50, 255])).toEqual([200, 100, 50, 255]);
    expect(one('screen', [10, 20, 30, 255], [255, 255, 255, 0])).toEqual([10, 20, 30, 255]);
  });
  it('half-transparent over half-transparent uses source-over alpha', () => {
    const p = one('normal', [255, 0, 0, 128], [0, 0, 255, 128]);
    expect(p[3]).toBe(192);
    expect(Math.abs(p[0] - 85)).toBeLessThanOrEqual(1);
    expect(Math.abs(p[2] - 170)).toBeLessThanOrEqual(1);
  });
  it('colour modes keep hue, saturation and brightness where they belong', () => {
    const lumi = one('luminosity', [255, 0, 0, 255], [128, 128, 128, 255]);
    expect(lumi[0]).toBe(255); expect(lumi[1]).toBe(lumi[2]); expect(lumi[1]).toBeGreaterThan(40);
    const col = one('color', [128, 128, 128, 255], [255, 0, 0, 255]);
    expect(col[0]).toBeGreaterThan(col[1]); expect(col[1]).toBe(col[2]);
    const hue = one('hue', [100, 100, 100, 255], [0, 0, 255, 255]);
    expect(hue[0]).toBe(hue[1]); expect(hue[1]).toBe(hue[2]);
  });
  it('every mode stays in range and composites alpha by source-over', () => {
    const want = Math.round((180 / 255 + (200 / 255) * (1 - 180 / 255)) * 255);
    for (const m of BLEND_MODES) {
      if (m === 'dissolve') continue;
      const p = one(m, [10, 200, 30, 200], [240, 20, 128, 180]);
      expect(p.every((v) => Number.isInteger(v) && v >= 0 && v <= 255), m).toBe(true);
      expect(p[3], m).toBe(want);
    }
  });
  it('layers composite at their offsets, bottom first, skipping hidden ones', () => {
    const bottom = createLayer('b', 4, 4, { fill: { r: 0, g: 0, b: 255, a: 255 } });
    const top = createLayer('t', 2, 2, { x: 1, y: 1, fill: { r: 255, g: 0, b: 0, a: 255 } });
    const out = compositeRect([bottom, top], { x: 0, y: 0, w: 4, h: 4 });
    const at = (x: number, y: number): number[] => Array.from(out.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(at(0, 0)).toEqual([0, 0, 255, 255]); expect(at(1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(2, 2)).toEqual([255, 0, 0, 255]); expect(at(3, 3)).toEqual([0, 0, 255, 255]);
    top.visible = false;
    expect(Array.from(compositeRect([bottom, top], { x: 1, y: 1, w: 1, h: 1 }))).toEqual([0, 0, 255, 255]);
  });
  it('dissolve gives pixels that are either fully there or absent', () => {
    const l = createLayer('d', 10, 10, { fill: { r: 9, g: 9, b: 9, a: 128 } });
    l.blendMode = 'dissolve';
    const out = compositeRect([l], { x: 0, y: 0, w: 10, h: 10 });
    let on = 0;
    for (let i = 3; i < out.length; i += 4) { expect([0, 255]).toContain(out[i]); if (out[i]) on++; }
    expect(on).toBeGreaterThan(30); expect(on).toBeLessThan(70);
  });
});
