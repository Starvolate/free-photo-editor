// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Every filter family, one case per filter: the effect happens and is the same every time, see-through areas behave,
 * and a selection limits it (also a selection touching the layer edge). Then a few exact checks per family.
 */
import { describe, expect, it } from 'vitest';
import {
  activeLayer, commitResult, documentFromBitmap, editRegion, innerOf, paddedRegion, readRegion, type Bitmap, type Rect,
} from '../src/index';
import { FX_KINDS, fxReach, runEffect, type FxKind } from '../src/fx/index';

type P = Record<string, number | undefined>;
const W = 32, H = 24;
const img = (w: number, h: number, f: (x: number, y: number) => number[]): Bitmap => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
/** A busy little photo with a see-through top-left corner. */
const photo = (): Bitmap => img(W, H, (x, y) => {
  if (x < 4 && y < 4) return [0, 0, 0, 0];
  const ring = Math.hypot(x - 16, y - 12) < 6 ? 90 : 0;
  return [(x * 9 + ring) % 256, (y * 11 + ((x >> 2) % 2) * 60) % 256, ((x ^ y) * 7) % 256, 255];
});
/** White everywhere except a see-through block whose hidden colour is black. */
const white = (): Bitmap => img(W, H, (x, y) => (x >= 6 && x < 12 && y >= 8 && y < 14 ? [0, 0, 0, 0] : [255, 255, 255, 255]));
const flat = (v: number): Bitmap => img(16, 16, () => [v, v, v, 255]);

const CASES: Record<FxKind, P> = {
  'box-blur': { radius: 2 }, 'motion-blur': { angle: 30, distance: 8 }, 'radial-blur': { mode: 0, amount: 30 }, 'surface-blur': { radius: 3, threshold: 60 },
  'smart-blur': { radius: 3, threshold: 60 }, average: { strength: 100 }, 'lens-blur': { radius: 3, bright: 40, threshold: 150 },
  'field-blur': { b1: 0, b2: 4 }, 'iris-blur': { blur: 4, rw: 20, rh: 20, feather: 30 }, 'tilt-blur': { blur: 4, band: 10, fade: 10 },
  'smart-sharpen': { amount: 200, radius: 1, noise: 0, halo: 0 }, 'sharpen-edges': { amount: 200, radius: 1, edge: 5 },
  'add-noise': { amount: 30, seed: 3 }, 'reduce-noise': { strength: 80, detail: 0, color: 60 }, median: { radius: 1 }, dust: { radius: 1, threshold: 0 },
  despeckle: { radius: 1, edge: 255 }, pinch: { amount: 60 }, twirl: { angle: 120 }, ripple: { amount: 200, size: 0 }, wave: { wavelength: 10, amplitude: 3 },
  polar: { mode: 0 }, spherize: { amount: 80 }, zigzag: { amount: 80, ridges: 3 }, displace: { hscale: 40, vscale: 40, size: 6, seed: 2 }, shear: { amount: 60 },
  emboss: {}, 'find-edges': {}, solarize: { level: 100 }, 'oil-paint': { radius: 2, levels: 8, shine: 50 }, wind: { length: 10 }, diffuse: { radius: 2 },
  tiles: { count: 4, offset: 30, fill: 2 }, extrude: { size: 6, depth: 10 }, 'trace-contour': { level: 100 }, 'glowing-edges': {},
  mosaic: { size: 4 }, crystallize: { size: 5 }, pointillize: { size: 5, bg: 0xffffff }, halftone: { radius: 4 }, mezzotint: {}, facet: { radius: 2 },
  fragment: { distance: 2 }, clouds: { size: 8, fg: 0x102030, bg: 0xe0d0c0 }, 'diff-clouds': { size: 8 }, fibers: { variance: 4, strength: 16 },
  'high-pass': { radius: 2 }, maximum: { radius: 1 }, minimum: { radius: 1 }, offset: { dx: 50, dy: 25 }, custom: { k7: -1, k11: -1, k12: 5, k13: -1, k17: -1 },
  'spin-blur': { angle: 90, size: 100 }, 'lens-fix': { distort: 40, vignette: 40 }, glass: { distort: 10, smooth: 1 }, 'ocean-ripple': { size: 2, amount: 14 },
  'lens-flare': { bright: 150 }, lighting: { bumps: 50 }, 'color-to-alpha': { which: 0 }, dither: { tones: 2 }, 'replace-color': { fuzz: 120, hue: 120, light: 30 },
  'reduce-colors': { count: 4 }, indexed: { palette: 3 },
  kaleidoscope: { repeats: 3 }, 'alien-map': { cycles: 3 }, bloom: { threshold: 60, size: 6, strength: 120 }, 'edge-detect': { method: 0 }, deinterlace: { keep: 0 },
  destripe: { width: 4 }, 'video-degrade': { pattern: 0, size: 1, strength: 80 }, lowlight: { dark: 80 }, 'bump-map': { depth: 40 }, 'star-burst': { length: 30 },
  'edge-keep-blur': { radius: 2, keep: 60 }, antialias: { edge: 10 },
};
const KEEPS_ALPHA = new Set<FxKind>(['add-noise', 'reduce-noise', 'median', 'dust', 'despeckle', 'smart-sharpen', 'sharpen-edges', 'surface-blur', 'smart-blur',
  'average', 'emboss', 'find-edges', 'solarize', 'oil-paint', 'wind', 'trace-contour', 'glowing-edges', 'pointillize', 'halftone', 'mezzotint', 'facet',
  'diff-clouds', 'high-pass', 'maximum', 'minimum', 'custom', 'lens-flare', 'lighting', 'dither', 'replace-color', 'reduce-colors', 'indexed',
  'alien-map', 'bloom', 'edge-detect', 'destripe', 'video-degrade', 'lowlight', 'bump-map', 'star-burst', 'edge-keep-blur']);
const FILLS = new Set<FxKind>(['clouds', 'fibers']);
const NO_DARK_EDGE = FX_KINDS.filter((k) => !KEEPS_ALPHA.has(k) && !FILLS.has(k) && k !== 'extrude');

const run = (k: FxKind, src: Bitmap, extra: P = {}): Uint8ClampedArray => runEffect({ kind: k, params: { ...CASES[k], ...extra } }, src);
const differs = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false; };
/** What the editor does: the selection (or layer) plus the filter's reach, with the edited box passed in the settings. */
function applyFx(k: FxKind, sel: Rect | null): { before: Uint8ClampedArray; after: Uint8ClampedArray } {
  const doc = documentFromBitmap(photo()), l = activeLayer(doc);
  if (!l) throw new Error('no layer');
  doc.selection = sel;
  const r = editRegion(doc, l);
  if (!r) throw new Error('no region');
  const p = paddedRegion(l, r, fxReach(k, CASES[k])), before = l.data.slice();
  const res = runEffect({ kind: k, params: { ...CASES[k], ix: r.x - p.x, iy: r.y - p.y, iw: r.w, ih: r.h } }, { width: p.w, height: p.h, data: readRegion(l, p) });
  commitResult(doc, l, r, readRegion(l, r), innerOf(res, p, r), k);
  return { before, after: l.data };
}
const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

describe('every filter family', () => {
  it('has a case for every filter and nothing more', () => {
    expect(Object.keys(CASES).sort()).toEqual([...FX_KINDS].sort());
    expect(FX_KINDS.length).toBe(74);
  });
  it.each([...FX_KINDS])('%s changes the picture, the same way every time', (k) => {
    const src = photo(), a = run(k, src), b = run(k, src);
    expect(a.length).toBe(src.data.length);
    expect(differs(a, src.data)).toBe(true);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it.each([...FX_KINDS])('%s handles see-through pixels', (k) => {
    const src = photo(), out = run(k, src);
    if (KEEPS_ALPHA.has(k)) for (let i = 3; i < out.length; i += 4) expect(out[i], `alpha ${i}`).toBe(src.data[i]);
    else if (FILLS.has(k)) for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
    else for (let i = 3; i < out.length; i += 4) expect(Number.isFinite(out[i])).toBe(true);
    if (NO_DARK_EDGE.includes(k)) {
      const w = run(k, white());
      for (let i = 0; i < w.length; i += 4) if (w[i + 3] >= 8) expect(Math.min(w[i], w[i + 1], w[i + 2]), `${k} pixel ${i / 4}`).toBeGreaterThanOrEqual(245);
    }
  });
  it.each([...FX_KINDS])('%s stays inside the selection, also at the layer edge', (k) => {
    for (const sel of [{ x: 8, y: 6, w: 14, h: 10 }, { x: 0, y: 10, w: 12, h: 14 }]) {
      const { before, after } = applyFx(k, sel);
      let changedInside = false;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, same = after[i] === before[i] && after[i + 1] === before[i + 1] && after[i + 2] === before[i + 2] && after[i + 3] === before[i + 3];
        if (!inside(sel, x, y)) expect(same, `${k} changed ${x},${y} outside`).toBe(true);
        else if (!same) changedInside = true;
      }
      expect(changedInside, `${k} inside ${JSON.stringify(sel)}`).toBe(true);
    }
  });
});

describe('exact checks', () => {
  const at = (d: ArrayLike<number>, w: number, x: number, y: number): number[] => Array.from({ length: 4 }, (_, c) => d[(y * w + x) * 4 + c]);
  it('mosaic makes uniform blocks and average one colour', () => {
    const m = run('mosaic', photo());
    for (let by = 4; by < H; by += 4) for (let bx = 4; bx < W; bx += 4) for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) expect(at(m, W, x, y)).toEqual(at(m, W, bx, by));
    const a = run('average', photo()), first = at(a, W, 10, 10);
    for (let y = 4; y < H; y++) for (let x = 4; x < W; x++) expect(at(a, W, x, y)).toEqual(first);
  });
  it('maximum never darkens, minimum never lightens, median removes a speck', () => {
    const src = photo(), mx = run('maximum', src), mn = run('minimum', src);
    for (let i = 0; i < src.data.length; i++) if (i % 4 !== 3 && src.data[i - (i % 4) + 3]) { expect(mx[i]).toBeGreaterThanOrEqual(src.data[i]); expect(mn[i]).toBeLessThanOrEqual(src.data[i]); }
    const speck = flat(100);
    speck.data.set([255, 255, 255, 255], (8 * 16 + 8) * 4);
    expect(at(run('median', speck), 16, 8, 8)).toEqual([100, 100, 100, 255]);
    expect(at(run('dust', speck, { threshold: 20 }), 16, 8, 8)).toEqual([100, 100, 100, 255]);
  });
  it('offset slides and wraps round exactly', () => {
    const src = photo(), o = run('offset', src);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) expect(at(o, W, x, y)).toEqual(at(src.data, W, (x + W / 2) % W, (y - 6 + H) % H));
  });
  it('solarize, emboss and high pass behave on known tones', () => {
    const s = run('solarize', img(2, 1, (x) => (x ? [200, 50, 128, 255] : [100, 101, 255, 255])), { level: 128 });
    expect(Array.from(s)).toEqual([100, 101, 0, 255, 55, 50, 128, 255]);
    expect(at(run('emboss', flat(90)), 16, 8, 8)).toEqual([128, 128, 128, 255]);
    expect(at(run('high-pass', flat(90)), 16, 8, 8)).toEqual([128, 128, 128, 255]);
    expect(Array.from(run('custom', photo(), { k7: 0, k11: 0, k12: 1, k13: 0, k17: 0 }))).toEqual(Array.from(photo().data).map((v, i) => (photo().data[i - (i % 4) + 3] ? v : 0)));
  });
  it('clouds stay between the two colours and fill the area', () => {
    const c = run('clouds', photo());
    for (let i = 0; i < c.length; i += 4) {
      expect(c[i + 3]).toBe(255);
      expect(c[i]).toBeGreaterThanOrEqual(0x10); expect(c[i]).toBeLessThanOrEqual(0xe0);
      expect(c[i + 2]).toBeGreaterThanOrEqual(0x30); expect(c[i + 2]).toBeLessThanOrEqual(0xc0);
    }
  });
  it('iris and tilt-shift keep their sharp part sharp', () => {
    const src = photo(), iris = run('iris-blur', src, { blur: 6 }), tilt = run('tilt-blur', src, { blur: 6 });
    expect(at(iris, W, 16, 12)).toEqual(at(src.data, W, 16, 12));
    expect(differs(at(iris, W, 30, 22), at(src.data, W, 30, 22))).toBe(true);
    for (let x = 0; x < W; x++) expect(at(tilt, W, x, 12)).toEqual(at(src.data, W, x, 12));
    expect(differs(tilt.subarray(W * 4 * 22), src.data.subarray(W * 4 * 22))).toBe(true);
  });
  it('reaches only as far as it reads', () => {
    for (const k of ['pinch', 'twirl', 'polar', 'offset', 'mosaic', 'clouds', 'solarize'] as const) expect(fxReach(k, CASES[k])).toBe(0);
    expect(fxReach('box-blur', { radius: 30 })).toBeGreaterThan(30);
    expect(fxReach('lens-blur', { radius: 60 })).toBeGreaterThan(60);
    expect(fxReach('iris-blur', { blur: 10 })).toBeGreaterThan(30);
    expect(() => runEffect({ kind: 'nope' }, photo())).toThrow(/Unknown effect/);
  });
});
