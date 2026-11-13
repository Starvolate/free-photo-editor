// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The light and colour batch (13 Nov 2026): each tool is Ready with a handler, its dialog loads on first use, and each
 * one does what its plain help line says on pixels whose results were worked out by hand (the sums are in the comments).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Doc } from '@free-photoeditor/core';
import { contrastRatio, runEffect, toLab, wcagLum } from '@free-photoeditor/core/fx';
import type { Editor } from '../src/app';
import { ADJ, HANDLERS, LIGHT_IDS } from '../src/commands';
import { BY_ID } from '../src/registry';
import '../src/registry-union';

type P = Record<string, number>;
type Bmp = { width: number; height: number; data: Uint8ClampedArray };
const bmp = (w: number, h: number, f: (x: number, y: number) => number[]): Bmp => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
const one = (c: number[]): Bmp => bmp(1, 1, () => [...c, 255]);
const run = (kind: string, src: Bmp, params: P = {}): Uint8ClampedArray => runEffect({ kind, params }, src);
const px = (d: ArrayLike<number>, w: number, x: number, y: number): number[] => Array.from({ length: 4 }, (_, c) => d[(y * w + x) * 4 + c]);
const near = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1): void => { for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i]), `channel ${i}`).toBeLessThanOrEqual(tol); };
const hue = (c: ArrayLike<number>): number => { const o = [0, 0, 0]; toLab(c[0], c[1], c[2], o); return Math.atan2(o[2], o[1]) * (180 / Math.PI); };

describe('light and colour batch', () => {
  it('makes the batch Ready with handlers, loads the dialogs on first use, and leaves the rest Planned with reasons', async () => {
    const ids = [...LIGHT_IDS, 'image.export-lut'];
    for (const id of ids) { expect(BY_ID.get(id)?.status, id).toBe('ready'); expect(HANDLERS[id], id).toBeTruthy(); }
    for (const id of ['image.soft-proof', 'image.mode-32', 'image.profiles', 'image.spot-channels', 'image.apply', 'image.sample-colorize', 'image.decompose']) {
      expect(BY_ID.get(id)?.status, id).toBe('planned');
      expect(HANDLERS[id], id).toBeUndefined();
      expect(BY_ID.get(id)?.help, id).toMatch(/^Not built/);
    }
    for (const id of LIGHT_IDS) expect(ADJ[id], id).toBeUndefined();
    const openAdjust = vi.fn(async () => undefined), e = { doc: {}, openAdjust } as unknown as Editor;
    await HANDLERS['image.retinex'].run(e);
    expect(openAdjust).toHaveBeenCalledWith('image.retinex');
    for (const id of LIGHT_IDS) { expect(ADJ[id]?.op, id).toBe('fx'); for (const c of ADJ[id].controls) expect(c.help.length, `${id} ${c.key}`).toBeLessThanOrEqual(160); }
    // The .cube file needs a visible light and colour layer to save.
    const lut = HANDLERS['image.export-lut'];
    expect(lut.enabled({ doc: { layers: [] } } as unknown as Editor)).toBe(false);
    expect(lut.enabled({ doc: { layers: [{ kind: 'adjust', visible: true }] } } as unknown as Editor)).toBe(true);
  });

  it('hue and chroma: nothing at zero, greys stay grey, no chroma is grey', () => {
    const ramp = bmp(8, 1, (x) => [x * 36, 255 - x * 30, (x * 90) % 256, 255]);
    near(run('hue-chroma', ramp, { hue: 0, chroma: 0, light: 0 }), ramp.data);
    near(run('hue-chroma', one([128, 128, 128]), { hue: 90, chroma: 50 }), [128, 128, 128, 255]);
    const g = run('hue-chroma', one([200, 60, 30]), { chroma: -100 });
    expect(Math.abs(g[0] - g[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(g[1] - g[2])).toBeLessThanOrEqual(1);
    // A half turn sends red-orange to the blue-green side.
    const t = run('hue-chroma', one([220, 60, 30]), { hue: 180, chroma: 0 });
    expect(t[2]).toBeGreaterThan(t[0]);
  });

  it('spins only the chosen colour range', () => {
    // Orange (255, 128, 0) sits at about 55 degrees, inside the oranges (60 +- 35); blue sits at about 264, outside.
    const src = bmp(2, 1, (x) => (x ? [0, 0, 255, 255] : [255, 128, 0, 255]));
    const out = run('rotate-colours', src, { from: 1, to: 5, width: 70, soft: 0 });
    expect(px(out, 2, 1, 0)).toEqual([0, 0, 255, 255]);
    const o = px(out, 2, 0, 0);
    expect(o[2]).toBeGreaterThan(o[0]);
    // Turned by 264 - 60 = 204 degrees; the screen's range clips the new blue a few degrees.
    expect(Math.abs((((hue(o) - hue([255, 128, 0]) - 204) % 360) + 540) % 360 - 180)).toBeLessThan(6);
  });

  it('measures WCAG contrast and fixes only the parts that fail', async () => {
    expect(contrastRatio(wcagLum(0, 0, 0), wcagLum(255, 255, 255))).toBeCloseTo(21, 6);
    expect(contrastRatio(wcagLum(0x76, 0x76, 0x76), wcagLum(255, 255, 255))).toBeCloseTo(4.54, 2);
    // White text, AA (4.5): grey 128 is 3.95 to 1 and fails. Darkened in linear light to luminance 1.05 / 4.53 - 0.05 = 0.1818,
    // which is the byte 118 (4.54 to 1). Grey 48 already passes and is kept exactly.
    const src = bmp(2, 1, (x) => (x ? [48, 48, 48, 255] : [128, 128, 128, 255]));
    const out = run('text-contrast', src, { text: 3, level: 0 });
    expect(Array.from(out)).toEqual([118, 118, 118, 255, 48, 48, 48, 255]);
    expect(contrastRatio(wcagLum(118, 118, 118), 1)).toBeGreaterThanOrEqual(4.5);
    const { contrastInfo } = await import('../src/light-more');
    expect(contrastInfo({ text: 3, level: 0 }, src.data)).toMatch(/lowest contrast is 3\.9 to 1, and 50% of the area fails AA, normal text/);
    expect(contrastInfo({ text: 3, level: 1 }, one([30, 30, 30]).data)).toMatch(/passes AA, large text everywhere/);
  });

  it('local threshold: dark strokes on unevenly lit paper come out black on white', () => {
    // Paper brightens from 130 to 208 left to right; the strokes are 70 darker than the paper around them.
    const stroke = (x: number): boolean => x === 10 || x === 11 || x === 28 || x === 29;
    const src = bmp(40, 10, (x) => { const v = 130 + 2 * x - (stroke(x) ? 70 : 0); return [v, v, v, 255]; });
    const out = run('local-threshold', src, { radius: 15, offset: 10 });
    for (const x of [10, 11, 28, 29]) expect(px(out, 40, x, 5), `stroke ${x}`).toEqual([0, 0, 0, 255]);
    for (const x of [2, 20, 37]) expect(px(out, 40, x, 5), `paper ${x}`).toEqual([255, 255, 255, 255]);
  });

  it('retinex lifts the dark half to the average and keeps the bright half', () => {
    // Average brightness is (40 + 200) / 2 = 120; far from the edge the light on the dark half is 40, so the gain is 120 / 40 = 3.
    const src = bmp(40, 20, (x) => (x < 20 ? [40, 40, 40, 255] : [200, 200, 200, 255]));
    expect(px(run('retinex', src, { radius: 4, amount: 100, lift: 1 }), 40, 2, 10)).toEqual([120, 120, 120, 255]);
    expect(px(run('retinex', src, { radius: 4, amount: 100, lift: 1 }), 40, 37, 10)).toEqual([200, 200, 200, 255]);
    // Half strength: 40 * sqrt(3) = 69.3.
    expect(px(run('retinex', src, { radius: 4, amount: 50, lift: 1 }), 40, 2, 10)).toEqual([69, 69, 69, 255]);
  });

  it('tone mapping squeezes the dark half toward the bright one', () => {
    // In stops: log2(32/255 + 1/256) = -2.9502 and log2(224/255 + 1/256) = -0.1806. Squeezing by half puts the dark base at
    // -1.5654; 2^-1.5654 - 1/256 = 0.3340, against 0.1255 before, a gain of 2.661: 32 becomes 85. The brightest place stays.
    const src = bmp(40, 20, (x) => (x < 20 ? [32, 32, 32, 255] : [224, 224, 224, 255]));
    const out = run('tone-map', src, { squeeze: 50, detail: 120, radius: 2, bright: 0 });
    near(px(out, 40, 2, 10), [85, 85, 85, 255]);
    expect(px(out, 40, 37, 10)).toEqual([224, 224, 224, 255]);
  });

  it('harmony with one colour brings every hue to the main hue', () => {
    // Soft colours, so the turned ones stay inside the screen's range and keep their exact hue.
    const src = bmp(2, 1, (x) => (x ? [110, 150, 115, 255] : [165, 110, 100, 255]));
    const out = run('harmonize', src, { scheme: 0, amount: 100 });
    expect(Math.abs(hue(px(out, 2, 0, 0)) - hue(px(out, 2, 1, 0)))).toBeLessThan(2);
    // A picture of one colour is already in harmony with itself.
    near(run('harmonize', one([220, 40, 40]), { scheme: 0, amount: 100 }), [220, 40, 40, 255]);
  });

  it('changes one main colour and leaves the others', () => {
    // Red covers 6 of 10 columns, so it is the most used colour; a half turn makes it blue-green, the blue stays.
    const src = bmp(10, 2, (x) => (x < 6 ? [210, 30, 30, 255] : [30, 40, 200, 255]));
    const out = run('palette-edit', src, { h1: 180 });
    const red = px(out, 10, 1, 0);
    expect(red[1]).toBeGreaterThan(red[0]);
    expect(red[2]).toBeGreaterThan(red[0]);
    near(px(out, 10, 8, 1), [30, 40, 200, 255]);
  });

  it('greys out colours a press is likely to miss, or pulls them in', () => {
    // Screen blue (chroma 0.31) is far past the press estimate (about 0.10 at its lightness); grey and a dull skin tone are not.
    const src = bmp(3, 1, (x) => [[0, 0, 255, 255], [128, 128, 128, 255], [200, 160, 140, 255]][x]);
    const out = run('gamut-warning', src, { mode: 0, grey: 50 });
    const b = px(out, 3, 0, 0);
    expect(b[0]).toBe(b[1]);
    expect(b[1]).toBe(b[2]);
    expect(Array.from(out.slice(4))).toEqual(Array.from(src.data.slice(4)));
    const pulled = px(run('gamut-warning', src, { mode: 1 }), 3, 0, 0);
    expect(pulled).not.toEqual([0, 0, 255, 255]);
    expect(pulled[2]).toBeGreaterThan(pulled[0]);
  });

  it('writes a .cube file other editors read: size line, red fastest, exact identity, layers applied', async () => {
    const { cubeText } = await import('../src/light-more');
    const lines = (d: unknown): string[] => cubeText(d as Doc, 3).trim().split('\n');
    const id = lines({ layers: [] });
    expect(id.slice(0, 4)).toEqual(['TITLE "Free Photo Editor adjustments"', 'LUT_3D_SIZE 3', 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0']);
    expect(id.length).toBe(4 + 27);
    expect(id[4]).toBe('0.000000 0.000000 0.000000');
    expect(id[5]).toBe('0.500000 0.000000 0.000000');
    expect(id[7]).toBe('0.000000 0.500000 0.000000');
    expect(id[30]).toBe('1.000000 1.000000 1.000000');
    for (const l of id.slice(4)) expect(l).toMatch(/^\d\.\d{6} \d\.\d{6} \d\.\d{6}$/);
    const inv = { kind: 'adjust', visible: true, opacity: 1, adjust: { job: { op: 'adjust', kind: 'invert', params: {} } } };
    const neg = lines({ layers: [inv] });
    expect(neg[4]).toBe('1.000000 1.000000 1.000000');
    expect(neg[30]).toBe('0.000000 0.000000 0.000000');
    // Half opacity: black inverted is 255, half of it 127.5, kept as the byte 128 (128 / 255 = 0.501961).
    expect(lines({ layers: [{ ...inv, opacity: 0.5 }] })[4]).toBe('0.501961 0.501961 0.501961');
    expect(lines({ layers: [{ ...inv, visible: false }] })).toEqual(id);
  });
});
