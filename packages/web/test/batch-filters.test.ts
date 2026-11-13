// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The batch filters (13 Nov 2026): each is Ready with a handler, its dialog loads on first use, and each effect does
 * what its plain help line says on known pixels.
 */
import { describe, expect, it, vi } from 'vitest';
import { FX_KINDS, runEffect } from '@free-photoeditor/core/fx';
import type { Editor } from '../src/app';
import { ADJ, BATCH_IDS, HANDLERS } from '../src/commands';
import { BY_ID } from '../src/registry';

type P = Record<string, number>;
const bmp = (w: number, h: number, f: (x: number, y: number) => number[]): { width: number; height: number; data: Uint8ClampedArray } => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
const photo = (): ReturnType<typeof bmp> => bmp(24, 16, (x, y) => [(x * 11) % 256, (y * 15 + x * 3) % 256, ((x ^ y) * 13) % 256, 255]);
const run = (kind: string, src: ReturnType<typeof bmp>, params: P): Uint8ClampedArray => runEffect({ kind, params }, src);
const px = (d: ArrayLike<number>, w: number, x: number, y: number): number[] => Array.from({ length: 4 }, (_, c) => d[(y * w + x) * 4 + c]);
const colours = (d: Uint8ClampedArray): Set<string> => { const s = new Set<string>(); for (let i = 0; i < d.length; i += 4) s.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); return s; };

describe('batch filters', () => {
  it('makes the batch Ready, with handlers, and leaves the rest of the area Planned', () => {
    expect(BATCH_IDS.length).toBe(11);
    for (const id of BATCH_IDS) { expect(BY_ID.get(id)?.status, id).toBe('ready'); expect(HANDLERS[id], id).toBeTruthy(); }
    for (const id of ['filter.blur-path', 'filter.raw', 'filter.perspective-plane', 'image.mode-16', 'image.mode-lab', 'image.mode-cmyk']) {
      expect(BY_ID.get(id)?.status, id).toBe('planned');
      expect(HANDLERS[id], id).toBeUndefined();
    }
    for (const id of ['image.mode-16', 'image.mode-lab', 'image.mode-cmyk']) expect(BY_ID.get(id)?.help, id).toMatch(/Not built/);
  });
  it('loads each dialog on first use, then opens it', async () => {
    for (const id of BATCH_IDS) expect(ADJ[id], id).toBeUndefined();
    const openAdjust = vi.fn(async () => undefined), e = { doc: {}, openAdjust } as unknown as Editor;
    await HANDLERS['filter.dither'].run(e);
    expect(openAdjust).toHaveBeenCalledWith('filter.dither');
    const kinds = BATCH_IDS.map((id) => ADJ[id]?.kind);
    for (const [i, k] of kinds.entries()) { expect(ADJ[BATCH_IDS[i]]?.op).toBe('fx'); expect(FX_KINDS as readonly string[]).toContain(k); }
    expect(new Set(kinds).size).toBe(BATCH_IDS.length);
  });

  it('colour to see-through clears white and keeps what is not white', () => {
    const src = bmp(3, 1, (x) => [[255, 255, 255, 255], [255, 128, 128, 255], [255, 0, 0, 255]][x]);
    const out = run('color-to-alpha', src, { which: 0 });
    expect(px(out, 3, 0, 0)[3]).toBe(0);
    const pink = px(out, 3, 1, 0);
    expect(pink[0]).toBe(255); expect(pink[1]).toBeLessThanOrEqual(1); expect(pink[3]).toBeGreaterThan(120); expect(pink[3]).toBeLessThan(135);
    expect(px(out, 3, 2, 0)).toEqual([255, 0, 0, 255]);
  });
  it('dither keeps only the tones asked for, in every pattern', () => {
    for (const method of [0, 1, 2]) {
      const out = run('dither', photo(), { tones: 2, method });
      for (let i = 0; i < out.length; i++) if (i % 4 !== 3) expect([0, 255]).toContain(out[i]);
    }
  });
  it('fewer colours keeps at most the count; palette colour keeps only its palette', () => {
    expect(colours(run('reduce-colors', photo(), { count: 5 })).size).toBeLessThanOrEqual(5);
    expect([...colours(run('indexed', photo(), { palette: 3, dither: 0 }))].sort()).toEqual(['0,0,0', '255,255,255']);
    for (const c of colours(run('indexed', photo(), { palette: 1 }))) for (const v of c.split(',')) expect(Number(v) % 51).toBe(0);
  });
  it('replace a colour changes the main colour and leaves far colours alone', () => {
    const src = bmp(2, 1, (x) => (x ? [0, 0, 255, 255] : [250, 10, 10, 255]));
    const out = run('replace-color', src, { from: 1, fg: 0xff0000, fuzz: 40, hue: 120, sat: 0, light: 0 });
    const red = px(out, 2, 0, 0);
    expect(red[1]).toBeGreaterThan(200); expect(red[0]).toBeLessThan(40);
    expect(px(out, 2, 1, 0)).toEqual([0, 0, 255, 255]);
  });
  it('lens flare only adds light, most at its centre', () => {
    const src = bmp(40, 30, () => [60, 60, 60, 255]), out = run('lens-flare', src, { x: 50, y: 50, bright: 100 });
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(src.data[i]);
    expect(px(out, 40, 20, 15)[0]).toBeGreaterThan(px(out, 40, 0, 0)[0] + 50);
  });
  it('lighting is brighter under the light than outside it, and keeps opacity', () => {
    const src = bmp(40, 30, () => [120, 120, 120, 200]), out = run('lighting', src, { x: 50, y: 50, size: 40 });
    expect(px(out, 40, 20, 15)[0]).toBeGreaterThan(120);
    expect(px(out, 40, 0, 0)[0]).toBeLessThan(60);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(200);
  });
  it('spin blur leaves everything outside its circle untouched', () => {
    const src = photo(), out = run('spin-blur', src, { angle: 90, size: 50 });
    expect(px(out, 24, 0, 0)).toEqual(px(src.data, 24, 0, 0));
    expect(px(out, 24, 23, 15)).toEqual(px(src.data, 24, 23, 15));
    expect(Array.from(out)).not.toEqual(Array.from(src.data));
  });
  it('lens fix with no bending keeps the middle and lightens the corners', () => {
    const src = bmp(41, 31, () => [100, 100, 100, 255]), out = run('lens-fix', src, { distort: 0, vignette: 60 });
    expect(px(out, 41, 20, 15)).toEqual([100, 100, 100, 255]);
    expect(px(out, 41, 0, 0)[0]).toBeGreaterThan(130);
  });
  it('glass and ocean ripple move pixels without changing a flat colour', () => {
    const flat = bmp(20, 20, () => [90, 140, 200, 255]);
    for (const k of ['glass', 'ocean-ripple']) {
      expect(Array.from(run(k, flat, {}))).toEqual(Array.from(flat.data));
      expect(Array.from(run(k, photo(), { distort: 10, amount: 12 }))).not.toEqual(Array.from(photo().data));
    }
  });
});
