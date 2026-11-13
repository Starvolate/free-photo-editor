// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The second filters batch (13 Nov 2026): each census filter is Ready with a handler, its dialog loads on first use, and
 * each effect does what its plain help line says on pixels worked out by hand (the sums are in the comments).
 */
import { describe, expect, it, vi } from 'vitest';
import { FX_KINDS, runEffect } from '@free-photoeditor/core/fx';
import type { Editor } from '../src/app';
import { ADJ, BATCH2_IDS, HANDLERS } from '../src/commands';
import { BY_ID } from '../src/registry';
import { NEW_ROWS } from '../src/registry-union';

type P = Record<string, number>;
type Bmp = { width: number; height: number; data: Uint8ClampedArray };
const bmp = (w: number, h: number, f: (x: number, y: number) => number[]): Bmp => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
const grey = (v: number): number[] => [v, v, v, 255];
const run = (kind: string, src: Bmp, params: P = {}): Uint8ClampedArray => runEffect({ kind, params }, src);
const px = (d: ArrayLike<number>, w: number, x: number, y: number): number[] => Array.from({ length: 4 }, (_, c) => d[(y * w + x) * 4 + c]);
const reds = (d: ArrayLike<number>): number[] => Array.from({ length: d.length / 4 }, (_, i) => d[i * 4]);

describe('filters batch 2', () => {
  it('makes the batch Ready, with handlers, and leaves the rows it did not build Planned', () => {
    expect(NEW_ROWS.length).toBeGreaterThan(200);
    expect(BATCH2_IDS.length).toBe(12);
    for (const id of BATCH2_IDS) { expect(BY_ID.get(id)?.status, id).toBe('ready'); expect(HANDLERS[id], id).toBeTruthy(); }
    for (const id of ['filter.depth-blur', 'filter.blur-variable', 'filter.long-shadow', 'filter.page-curl', 'filter.gallery', 'image.mode-gray', 'image.rotate-any', 'edit.fade']) {
      expect(BY_ID.get(id)?.status, id).toBe('planned');
      expect(HANDLERS[id], id).toBeUndefined();
    }
  });
  it('loads each dialog on first use, then opens it', async () => {
    for (const id of BATCH2_IDS) expect(ADJ[id], id).toBeUndefined();
    const openAdjust = vi.fn(async () => undefined), e = { doc: {}, openAdjust } as unknown as Editor;
    await HANDLERS['filter.bloom'].run(e);
    expect(openAdjust).toHaveBeenCalledWith('filter.bloom');
    for (const id of BATCH2_IDS) {
      expect(ADJ[id]?.op, id).toBe('fx');
      expect(FX_KINDS as readonly string[]).toContain(ADJ[id]?.kind);
      expect(ADJ[id]?.controls.length, id).toBeGreaterThan(0);
    }
  });

  it('kaleidoscope: with 2 repeats the four mirror points round the centre all show the lower-right one', () => {
    // 21 by 21, centre (10, 10). (13, 12) is in the first slice (33.7 degrees), so it stays; (7, 12), (7, 8) and (13, 8)
    // are its mirror images across the upright and level lines, so they take its colour.
    const src = bmp(21, 21, (x, y) => [x * 12, y * 12, (x * 7 + y * 3) % 256, 255]), out = run('kaleidoscope', src, { repeats: 2 });
    const want = px(src.data, 21, 13, 12);
    for (const [x, y] of [[13, 12], [7, 12], [7, 8], [13, 8]]) expect(px(out, 21, x, y), `${x},${y}`).toEqual(want);
  });
  it('weird colour shift: black becomes 127.5 + 127.5 sin(0, 120, 240 degrees)', () => {
    // 127.5 rounds to 128; 127.5 + 110.42 = 237.9; 127.5 - 110.42 = 17.1.
    expect(px(run('alien-map', bmp(2, 2, () => grey(0))), 2, 0, 0)).toEqual([128, 238, 17, 255]);
  });
  it('glow around lights: flat 200 grey with the threshold at 100 screens 129.03 of glow over it', () => {
    // glow = 200 x (200 - 100) / 155 = 129.03; 255 - 55 x (255 - 129.03) / 255 = 227.83, so 228. Below the threshold: unchanged.
    expect(px(run('bloom', bmp(8, 8, () => grey(200)), { threshold: 100, strength: 100, size: 6 }), 8, 4, 4)).toEqual([228, 228, 228, 255]);
    expect(px(run('bloom', bmp(8, 8, () => grey(90)), { threshold: 100 }), 8, 4, 4)).toEqual(grey(90));
  });
  it('edge detectors: a black-to-white step gives 255 on the edge pixels and 0 away from it, by each method', () => {
    const src = bmp(6, 3, (x) => grey(x < 3 ? 0 : 255));
    expect(reds(run('edge-detect', src, { method: 0 })).slice(6, 12)).toEqual([0, 0, 255, 255, 0, 0]); // Sobel: 4 x 255 / 4
    expect(reds(run('edge-detect', src, { method: 1 })).slice(6, 12)).toEqual([0, 0, 255, 255, 0, 0]); // Prewitt: 3 x 255 / 3
    expect(reds(run('edge-detect', src, { method: 2 })).slice(6, 12)).toEqual([0, 0, 255, 0, 0, 0]); // Roberts: hypot(255, 255) / root 2
    expect(reds(run('edge-detect', src, { method: 3 })).slice(6, 12)).toEqual([0, 0, 255, 255, 0, 0]); // Laplace: |0 - 255|, |4 x 255 - 3 x 255|
    expect(reds(run('edge-detect', src, { method: 0, dark: 1 })).slice(6, 12)).toEqual([255, 255, 0, 0, 255, 255]);
  });
  it('fix interlace lines: the other lines become the average of the lines above and below', () => {
    const src = bmp(1, 5, (_, y) => grey([10, 50, 30, 90, 70][y]));
    expect(reds(run('deinterlace', src, { keep: 0 }))).toEqual([10, 20, 30, 50, 70]); // (10 + 30) / 2, (30 + 70) / 2
    expect(reds(run('deinterlace', src, { keep: 1 }))).toEqual([50, 50, 70, 90, 90]); // the edge lines copy their one neighbour
  });
  it('remove stripes: columns of 100 and 120 even out to 110, or half way at 50%', () => {
    const src = bmp(4, 2, (x) => grey(x % 2 ? 120 : 100));
    expect(reds(run('destripe', src, { width: 10 }))).toEqual([110, 110, 110, 110, 110, 110, 110, 110]);
    expect(reds(run('destripe', src, { width: 10, strength: 50 })).slice(0, 4)).toEqual([105, 115, 105, 115]);
  });
  it('old TV: stripes keep one colour per column at 1.5 times, scan lines dim every other row', () => {
    const out = run('video-degrade', bmp(3, 2, () => grey(100)), { pattern: 0, size: 1, strength: 100 });
    expect([px(out, 3, 0, 0), px(out, 3, 1, 0), px(out, 3, 2, 0)]).toEqual([[150, 0, 0, 255], [0, 150, 0, 255], [0, 0, 150, 255]]);
    expect(px(run('video-degrade', bmp(3, 2, () => grey(100)), { pattern: 1, size: 1, strength: 100 }), 3, 0, 1)).toEqual([0, 150, 0, 255]);
    expect(reds(run('video-degrade', bmp(1, 2, () => grey(100)), { pattern: 2, size: 1, strength: 60 }))).toEqual([100, 40]);
  });
  it('night eye: fully dark, grey halves and pure red fades to near black grey', () => {
    // grey 100: seen as 0.05 x 100 + 0.45 x 100 + 0.5 x 100 = 100, dimmed by half = 50. Red 200: 0.05 x 200 = 10, halved = 5.
    expect(px(run('lowlight', bmp(1, 1, () => grey(100)), { dark: 100, blue: 0 }), 1, 0, 0)).toEqual(grey(50));
    expect(px(run('lowlight', bmp(1, 1, () => [200, 0, 0, 255]), { dark: 100, blue: 0 }), 1, 0, 0)).toEqual(grey(5));
  });
  it('bump map: flat stays flat, a slope facing the light gets lighter and the normal map tilts', () => {
    expect(px(run('bump-map', bmp(4, 4, () => grey(80)), { mode: 1 }), 4, 1, 1)).toEqual([128, 128, 255, 255]);
    expect(px(run('bump-map', bmp(4, 4, () => grey(80))), 4, 1, 1)).toEqual(grey(80));
    // Brightness rises 10 a pixel; at x = 4 the slope is (50 - 30) / 510 x 2 = 0.0784, so the surface leans left:
    // n = (-0.0782, 0, 0.9969). Lit from the left: 40 x 1.0751 = 43.0; from the right: 40 x 0.9187 = 36.75, so 37.
    const ramp = bmp(9, 3, (x) => grey(x * 10));
    expect(px(run('bump-map', ramp, { angle: 180 }), 9, 4, 1)).toEqual(grey(43));
    expect(px(run('bump-map', ramp, { angle: 0 }), 9, 4, 1)).toEqual(grey(37));
    expect(px(run('bump-map', ramp, { mode: 1 }), 9, 4, 1)).toEqual([118, 128, 255, 255]); // (1 - 0.0782) / 2 x 255 = 117.5
  });
  it('star burst: one white point gets rays along the level and upright lines, nothing between them', () => {
    // Ray length 10% of 29.7 = 2.97 px; 5 px out along a ray: 0.9 x e^(-5 / 2.97) x 255 = 42.6. At 36.9 degrees: none.
    const out = run('star-burst', bmp(21, 21, (x, y) => grey(x === 10 && y === 10 ? 255 : 0)));
    expect(out[(10 * 21 + 15) * 4]).toBe(43);
    expect(out[(15 * 21 + 10) * 4]).toBe(43);
    expect(px(out, 21, 14, 13)).toEqual(grey(0));
    expect(px(out, 21, 0, 0)).toEqual(grey(0));
    expect(px(out, 21, 10, 10)).toEqual(grey(255));
  });
  it('edge-keeping blur: a sharp step stays exact, a lone speck is pulled towards its surroundings', () => {
    const step = bmp(8, 4, (x) => grey(x < 4 ? 0 : 200));
    expect(Array.from(run('edge-keep-blur', step))).toEqual(Array.from(step.data));
    // Radius 1: spread 1 px, so side weights e^-0.5 and corners e^-1; a difference of 10 per colour weighs e^(-300 / 1800).
    // (110 + 100 x 3.898 x 0.8465) / (1 + 3.898 x 0.8465) = 439.9 / 4.299 = 102.3, so 102.
    const speck = bmp(5, 5, (x, y) => grey(x === 2 && y === 2 ? 110 : 100));
    expect(px(run('edge-keep-blur', speck, { radius: 1, keep: 30 }), 5, 2, 2)).toEqual(grey(102));
  });
  it('smooth jagged edges: a staircase softens, a straight edge stays crisp', () => {
    // At (3, 3) the edge runs at 45 degrees; samples half way into the next pixels along it read 255 x 0.2071 = 52.8 each,
    // mixed in at 80% / 3: 2 x 52.8 x 0.2667 = 28.2, so 28. Its partner across the step gets 255 - 28.
    const stairs = bmp(8, 8, (x, y) => grey(x > y ? 255 : 0)), out = run('antialias', stairs);
    expect(px(out, 8, 3, 3)).toEqual(grey(28));
    expect(px(out, 8, 4, 3)).toEqual(grey(227));
    expect(px(out, 8, 0, 7)).toEqual(grey(0));
    expect(px(out, 8, 7, 0)).toEqual(grey(255));
    const straight = bmp(8, 4, (x) => grey(x < 4 ? 0 : 255));
    expect(Array.from(run('antialias', straight))).toEqual(Array.from(straight.data));
  });
  it('touches only the selected box', () => {
    const src = bmp(12, 10, (x, y) => [(x * 23) % 256, (y * 29) % 256, (x * y * 7) % 256, 255]);
    for (const id of BATCH2_IDS) {
      const params: P = { ix: 3, iy: 2, iw: 6, ih: 5 };
      for (const c of ADJ[id].controls) params[c.key] = c.value;
      const out = run(ADJ[id].kind as string, src, params);
      for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) {
        if (x >= 3 && x < 9 && y >= 2 && y < 7) continue;
        expect(px(out, 12, x, y), `${id} ${x},${y}`).toEqual(px(src.data, 12, x, y));
      }
    }
  });
});
