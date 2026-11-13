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
    expect(BATCH2_IDS.length).toBe(21);
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

describe('filters batch 2, part 2: every look each row names', () => {
  const step = (lo: number, hi: number): Bmp => bmp(8, 1, (x) => grey(x < 4 ? lo : hi));
  const at = (d: ArrayLike<number>, w: number, x: number, y = 0): number => d[(y * w + x) * 4];
  const BW = { fg: 0x000000, bg: 0xffffff };

  it('traced outline and relief', () => {
    // Outline: at x = 3 and 4 the slope is 4 x (200 - 100) / 4 = 100, ink 100 / 128 = 0.78125, so 100 x 0.21875 = 21.9 and 200 x 0.21875 = 43.75.
    const o = run('outline', step(100, 200));
    expect([0, 3, 4, 7].map((x) => at(o, 8, x))).toEqual([100, 22, 44, 200]);
    // Relief, light from the right, height 1: x = 3 gains 200 - 100 = 100; x = 4 gains 100 too and clips at 255; flat parts keep their colour.
    const r = run('outline', step(100, 200), { look: 1, angle: 0, height: 1 });
    expect([0, 3, 4, 7].map((x) => at(r, 8, x))).toEqual([100, 200, 255, 200]);
  });
  it('ink drawing and pencil drawing', () => {
    // Ink, colour 50%: 100 pales to 255 - 155 x 0.5 = 177.5 and 200 to 227.5; next to the step the ink 0.78125 leaves 21.875% of that.
    const ink = run('sketch', step(100, 200));
    expect([0, 3, 4, 7].map((x) => at(ink, 8, x))).toEqual([178, 39, 50, 228]);
    // Pencil, softness 1: at x = 3 the blurred negative is (205 + 205 + 55) / 3 = 155, so 50 x 255 / 100 = 127.5; at x = 4 it is 105, so
    // 200 x 255 / 150 = 340, clipped to white; a flat area divides by itself and turns white paper.
    const pen = run('sketch', step(50, 200), { look: 1, size: 1 });
    expect([0, 3, 4, 7].map((x) => at(pen, 8, x))).toEqual([255, 128, 255, 255]);
  });
  it('halftone dots and engraved lines', () => {
    // Flat 128: darkness 127 / 255; dot radius 10 x 0.7072 x sqrt(0.498) = 4.991. Pixel (4, 4) sits 0.71 from the dot centre (5, 5): ink.
    // (0, 0) is 6.36 away: paper. (0, 3) is 4.743 away: covered 4.991 - 4.743 + 0.5 = 0.747, so 255 x 0.253 = 64.
    const g = bmp(10, 10, () => grey(128)), dots = run('newsprint', g, { size: 10, angle: 0 });
    expect([px(dots, 10, 4, 4)[0], px(dots, 10, 0, 0)[0], px(dots, 10, 0, 3)[0]]).toEqual([0, 255, 64]);
    expect(Array.from(new Set(reds(run('newsprint', bmp(10, 10, () => grey(255)), { size: 10 }))))).toEqual([255]);
    expect(Array.from(new Set(reds(run('newsprint', bmp(10, 10, () => grey(0)), { size: 10 }))))).toEqual([0]);
    // Lines 10 apart: each band's ink is 10 x 127 / 255 = 4.98 thick round its middle (5). Row 4 (centre 4.5) is ink, row 0 paper, and
    // row 2 (centre 2.5) is covered 2.49 - 2.5 + 0.5 = 0.49, so 255 x 0.51 = 130.
    const lines = run('newsprint', g, { look: 1, size: 10, angle: 0 });
    expect([4, 0, 2].map((y) => px(lines, 10, 3, y)[0])).toEqual([0, 255, 130]);
  });
  it('dents and mirror tiles', () => {
    const src = bmp(8, 8, (x, y) => [x * 10 + y, 0, 0, 255]);
    // Tiles of 4 mirrored both ways round their centres (1.5, 1.5) and (5.5, 5.5): (0, 0) shows (3, 3) and (5, 6) shows (6, 5).
    const both = run('dents', src, { look: 1, size: 4 });
    expect([px(both, 8, 0, 0)[0], px(both, 8, 5, 6)[0]]).toEqual([33, 65]);
    expect(px(run('dents', src, { look: 1, size: 4, flip: 1 }), 8, 0, 0)[0]).toBe(30);
    // Dents push each pixel at most 2 px, so on a 20-per-pixel ramp no pixel moves more than 40 (plus rounding); flat stays flat.
    const ramp = bmp(8, 8, (x) => grey(x * 20)), d = run('dents', ramp, { size: 4, amount: 2 });
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(Math.abs(px(d, 8, x, y)[0] - x * 20)).toBeLessThanOrEqual(41);
    expect(Array.from(d)).not.toEqual(Array.from(ramp.data));
    expect(Array.from(run('dents', bmp(6, 6, () => grey(90)), { amount: 20 }))).toEqual(Array.from(bmp(6, 6, () => grey(90)).data));
  });
  it('cartoon, photocopy, cubist squares and glass blocks', () => {
    // Reach 1: x = 3 (50) is darker than 90% of its neighbours' mean (50 + 50 + 200) / 3 = 100, so it is a black line. Elsewhere the colour
    // steps in fours (0, 85, 170, 255): 50 becomes 85 and 200 becomes 170. Photocopy prints only the line.
    const c = run('cartoon', step(50, 200), { size: 1 });
    expect([0, 2, 3, 4, 7].map((x) => at(c, 8, x))).toEqual([85, 85, 0, 170, 170]);
    const pc = run('cartoon', step(50, 200), { look: 1, size: 1 });
    expect([0, 3, 4, 7].map((x) => at(pc, 8, x))).toEqual([255, 0, 255, 255]);
    // Squares: on a red left half and a green right half, every pixel is red, green or the blue second colour, and all three show.
    const two = bmp(32, 32, (x) => (x < 16 ? [200, 0, 0, 255] : [0, 200, 0, 255])), cub = run('cartoon', two, { look: 2, tile: 8, bg: 0x0000ff });
    const seen = new Set<string>();
    for (let i = 0; i < 32 * 32; i++) seen.add(px(cub, 32, i % 32, Math.floor(i / 32)).join());
    expect([...seen].sort()).toEqual(['0,0,255,255', '0,200,0,255', '200,0,0,255']);
    // Glass blocks of 4 at full bend: (1, 1) looks at (0.5, 0.5), half way between 0 and 10 = 5; (2, 1) looks at (2.5, 0.5): 25 and 5.
    const ramp = bmp(8, 8, (x, y) => [x * 10, y * 10, 0, 255]), gl = run('cartoon', ramp, { look: 3, tile: 4, amount: 100 });
    expect([px(gl, 8, 1, 1), px(gl, 8, 2, 1)]).toEqual([[5, 5, 0, 255], [25, 5, 0, 255]]);
  });
  it('lino print and leaded glass', () => {
    // Flat 50 under the 128 level prints black; carved lines every 6 rows open where row % 6 < 3 x 50 / 128 = 1.17, so rows 0, 1, 6, 7.
    const lino = run('linocut', bmp(4, 12, () => grey(50)), { smooth: 0 });
    expect(Array.from({ length: 12 }, (_, y) => px(lino, 4, 1, y)[0])).toEqual([255, 255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0]);
    expect(Array.from(new Set(reds(run('linocut', bmp(4, 12, () => grey(50)), { smooth: 0, gouges: 0 }))))).toEqual([0]);
    expect(Array.from(new Set(reds(run('linocut', bmp(4, 12, () => grey(200))))))).toEqual([255]);
    // Leaded glass on a flat colour: each piece keeps that colour and the lead between pieces is black, and both show.
    const glass = run('linocut', bmp(40, 40, () => [30, 60, 90, 255]), { look: 1, cell: 12, lead: 2 }), kinds = new Set<string>();
    for (let i = 0; i < 1600; i++) kinds.add(px(glass, 40, i % 40, Math.floor(i / 40)).join());
    expect([...kinds].sort()).toEqual(['0,0,0,255', '30,60,90,255']);
  });
  it('patterns: grid, checkerboard, maze, spiral, sine waves and jigsaw, in the main colour over the second', () => {
    const blank = (w: number, h: number): Bmp => bmp(w, h, () => [0, 0, 0, 0]);
    // Grid every 10 px, lines 2 px: x or y within 2 of a multiple of 10 is a line (main colour, black here); the rest is white. Opaque.
    const grid = run('patterns', blank(20, 20), { ...BW, size: 10, width: 2 });
    expect([px(grid, 20, 0, 5), px(grid, 20, 5, 5), px(grid, 20, 5, 1), px(grid, 20, 11, 5)]).toEqual([[0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255]]);
    const chk = run('patterns', blank(20, 20), { ...BW, look: 1, size: 10 });
    expect([px(chk, 20, 0, 0)[0], px(chk, 20, 10, 0)[0], px(chk, 20, 10, 10)[0]]).toEqual([255, 0, 255]);
    // Maze: 6 px cells with 2 px walls in 50 x 38 make 8 x 6 = 48 cells. A maze with one path between any two cells has exactly 47
    // openings; count them by looking at the middle of each cell's west and north wall.
    const mz = run('patterns', blank(50, 38), { ...BW, look: 2, size: 6, width: 2 });
    let openings = 0;
    for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) {
      if (i > 0 && px(mz, 50, i * 6, j * 6 + 3)[0] === 255) openings++;
      if (j > 0 && px(mz, 50, i * 6 + 3, j * 6)[0] === 255) openings++;
    }
    expect(openings).toBe(47);
    expect([px(mz, 50, 0, 0)[0], px(mz, 50, 3, 3)[0], px(mz, 50, 49, 20)[0]]).toEqual([0, 255, 0]);
    // Spiral 8 px a turn round (8, 8): 2 px to the right is a quarter turn in (main colour), 6 px is three quarters (second colour).
    const sp = run('patterns', blank(17, 17), { ...BW, look: 3, size: 8 });
    expect([px(sp, 17, 10, 8)[0], px(sp, 17, 14, 8)[0]]).toEqual([0, 255]);
    // Sine waves 8 px long: 0.5 + 0.25 (sin x + sin y) of the way to black: 127.5 at (0, 0), 63.75 at (2, 0), 191.25 at (6, 0).
    const sn = run('patterns', blank(8, 8), { ...BW, look: 4, size: 8 });
    expect([0, 2, 6].map((x) => px(sn, 8, x, 0)[0])).toEqual([128, 64, 191]);
    // Jigsaw pieces of 20: the cut between the first two pieces is a line at (19, 2), but at (19, 10) a round tab joins the two sides.
    const jg = run('patterns', blank(40, 40), { ...BW, look: 5, size: 20, width: 1 });
    expect([px(jg, 40, 19, 2)[0], px(jg, 40, 5, 5)[0], px(jg, 40, 19, 10)[0]]).toEqual([0, 255, 255]);
  });
  it('stroke blur and wrap-around blur', () => {
    // Level strokes 5 long: an upright 1 px line is 1 of 5 samples, so the middle value is 0 and it goes; a level line stays.
    const upright = run('stroke-blur', bmp(9, 5, (x) => grey(x === 4 ? 255 : 0)), { angle: 0, jitter: 0, length: 2 });
    expect([px(upright, 9, 4, 2)[0], px(upright, 9, 3, 2)[0]]).toEqual([0, 0]);
    expect(px(run('stroke-blur', bmp(9, 5, (_, y) => grey(y === 2 ? 255 : 0)), { angle: 0, jitter: 0, length: 2 }), 9, 4, 2)[0]).toBe(255);
    // Wrap-around, radius 1: the 240 at the right end also reaches x = 0, so (240 + 0 + 0) / 3 = 80 there; x = 1 stays 0.
    const w = run('wrap-blur', bmp(6, 1, (x) => grey(x === 5 ? 240 : 0)), { radius: 1, edges: 0 });
    expect([0, 1, 4, 5].map((x) => at(w, 6, x))).toEqual([80, 0, 80, 80]);
    // Edges only, 2 px: on a 5 x 5 with 150 in the last column, (0, 2) blurs fully to 50, (3, 2) is 1 px in, so half: 25.
    const e = run('wrap-blur', bmp(5, 5, (x) => grey(x === 4 ? 150 : 0)), { radius: 1, edges: 2 });
    expect([0, 2, 3, 4].map((x) => at(e, 5, x, 2))).toEqual([50, 0, 25, 50]);
  });
});
