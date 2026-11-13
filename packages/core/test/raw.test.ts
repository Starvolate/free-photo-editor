// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Photo developing (core/fx/raw.ts) on hand-checked pixels. Each expected number below was worked out by hand from
 * the formula named beside it (sRGB's transfer curve, Kim et al.'s Planckian locus, an equidistant fisheye), not read
 * back from the code.
 */
import { describe, expect, it } from 'vitest';
import { runEffect } from '../src/fx';
import { DEVELOP_REST, estimateTilt, kelvinWhite, rotateFill, type Planes } from '../src/fx/raw';

type Px = [number, number, number];
function img(w: number, h: number, f: (x: number, y: number) => Px): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...f(x, y), 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}
const dev = (src: ReturnType<typeof img>, p: Record<string, number>): Uint8ClampedArray => runEffect({ kind: 'develop', params: p }, src);
const at = (d: Uint8ClampedArray, w: number, x: number, y: number): Px => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]];
const lum = (p: Px): number => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const near = (a: Px, b: Px, tol = 1): void => { for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c]), `${a} vs ${b}`).toBeLessThanOrEqual(tol); };
const grey = (v: number) => (): Px => [v, v, v];
function planes(w: number, h: number, f: (x: number, y: number) => number): Planes {
  const n = w * h, r = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r[y * w + x] = f(x, y);
  return { w, h, r, g: r.slice(), b: r.slice() };
}

describe('Develop RAW: the develop effect', () => {
  it('changes no pixel while every setting rests', () => {
    const src = img(30, 20, (x, y) => [x * 8, y * 12, (x * y) % 255]);
    expect(dev(src, { ...DEVELOP_REST })).toEqual(src.data);
  });
  it('white balance: 6500 K to 3000 K turns a grey patch blue and keeps its brightness', () => {
    // Kim et al.: 3000 K sits at x 0.4366, y 0.4042; as linear sRGB its light is (2.089, 1, 0.322), so grey 128 (linear 0.2159)
    // takes gains (0.479, 0.945, 3.082) after keeping grey's brightness: 90, 125, 213.
    const w = kelvinWhite(3000);
    expect(w[0]).toBeCloseTo(2.089, 2);
    expect(w[2]).toBeCloseTo(0.322, 2);
    const out = at(dev(img(8, 8, grey(128)), { wbT: 3000 }), 8, 4, 4);
    near(out, [90, 125, 213]);
    expect(Math.abs(lum(out) - 128)).toBeLessThanOrEqual(6);
  });
  it('white balance: the grey picker makes the picked colour neutral', () => {
    const out = at(dev(img(9, 9, () => [200, 150, 100]), { wbPick: 1, gx: 50, gy: 50 }), 9, 4, 4);
    expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(1);
  });
  it('black and white points: 20 becomes black, 235 white, 128 stays', () => {
    const src = img(4, 1, (x) => { const v = [10, 20, 128, 235][x]; return [v, v, v]; }), out = dev(src, { bp: 20, wp: 235 });
    // (128 - 20) / (235 - 20) * 255 = 128.09.
    expect([0, 1, 2, 3].map((x) => at(out, 4, x, 0)[0])).toEqual([0, 0, 128, 255]);
  });
  it('starting curve "Strong": 3v² - 2v³ takes 64 to 40 and 192 to 216, ends fixed', () => {
    const src = img(4, 1, (x) => { const v = [0, 64, 192, 255][x]; return [v, v, v]; }), out = dev(src, { base: 3 });
    expect([0, 1, 2, 3].map((x) => at(out, 4, x, 0)[0])).toEqual([0, 40, 216, 255]);
  });
  it('vignette: the centre stays and the corner goes black at -100; -50 halves the corner light (128 to 92)', () => {
    const src = img(101, 101, grey(128));
    let out = dev(src, { vig: -100, vMid: 50, vFea: 0 });
    expect(at(out, 101, 50, 50)).toEqual([128, 128, 128]);
    expect(at(out, 101, 0, 0)).toEqual([0, 0, 0]);
    // Linear 0.2159 * 0.5 = 0.1079, which sRGB encodes as 92.4.
    out = dev(src, { vig: -50, vMid: 50, vFea: 0 });
    near(at(out, 101, 0, 0), [92, 92, 92]);
    expect(at(out, 101, 50, 50)).toEqual([128, 128, 128]);
  });
  it('stuck dots: a lone 255 in a field of 100 becomes 100; a faint 130 stays', () => {
    const src = img(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 255, 255] : x === 1 && y === 1 ? [130, 130, 130] : [100, 100, 100])), out = dev(src, { hot: 1, hotT: 40 });
    expect(at(out, 9, 4, 4)).toEqual([100, 100, 100]);
    expect(at(out, 9, 1, 1)).toEqual([130, 130, 130]);
  });
  it('tone equalizer: every zone +50 is one stop brighter, so 118 becomes 162', () => {
    // 118 is linear 0.1812; twice that is 0.3623, which sRGB encodes as 162.2.
    near(at(dev(img(6, 6, grey(118)), { teB: 50, teS: 50, teM: 50, teH: 50, teW: 50 }), 6, 3, 3), [162, 162, 162]);
  });
  it('colour mixer: red shifted +100 turns 30° to orange (255, 128, 0); blue is left alone', () => {
    const src = img(2, 1, (x) => (x ? [0, 0, 255] : [255, 0, 0])), out = dev(src, { mH0: 100 });
    expect(at(out, 2, 0, 0)).toEqual([255, 128, 0]);
    expect(at(out, 2, 1, 0)).toEqual([0, 0, 255]);
  });
  it('colour grading: blue-teal darks tint a dark grey and keep its brightness', () => {
    const out = at(dev(img(4, 4, grey(51)), { gSh: 210, gSa: 100 }), 4, 1, 1);
    expect(out[2]).toBeGreaterThan(out[0] + 20);
    expect(Math.abs(lum(out) - 51)).toBeLessThanOrEqual(1);
  });
  it('highlights and shadows: bright areas calm down, dark ones open up, the middle stays', () => {
    // 240: light weight smoothstep(0.5, 1, 0.941) = 0.962, so -0.962 stops: 178.4. 30: dark weight 0.860 x 1.2 = 1.03 stops up: 45.3.
    near(at(dev(img(20, 20, grey(240)), { hl: -100 }), 20, 10, 10), [178, 178, 178]);
    near(at(dev(img(20, 20, grey(30)), { sh: 100 }), 20, 10, 10), [45, 45, 45]);
    near(at(dev(img(20, 20, grey(128)), { hl: -100, sh: 100 }), 20, 10, 10), [128, 128, 128]);
  });
  it('clipping warning: pure white shows red, pure black blue, the rest untouched', () => {
    const src = img(3, 1, (x) => [[255, 255, 255], [0, 0, 0], [120, 80, 40]][x] as Px), out = dev(src, { clip: 1 });
    expect([at(out, 3, 0, 0), at(out, 3, 1, 0), at(out, 3, 2, 0)]).toEqual([[255, 0, 0], [0, 64, 255], [120, 80, 40]]);
  });
  it('film negative: an orange negative of a grey ramp turns into a neutral ramp, dark to light', () => {
    // Film base (230, 153, 102); a positive tone t leaves base * (1 - t) on the film.
    const src = img(11, 3, (x) => { const t = 0.05 + x * 0.09; return [230 * (1 - t), 153 * (1 - t), 102 * (1 - t)]; }), out = dev(src, { neg: 1 });
    const row = Array.from({ length: 11 }, (_, x) => at(out, 11, x, 1));
    for (const p of row) expect(Math.max(...p) - Math.min(...p), String(p)).toBeLessThanOrEqual(3);
    for (let x = 1; x < 11; x++) expect(row[x][1]).toBeGreaterThan(row[x - 1][1]);
  });
  it('de-fish: the centre stays and the edge reads from f·atan(r/f) (r 50 reads 37.7 out, red 75)', () => {
    // 101 x 101, a 180° fisheye across the diagonal: f = 70.71 / (π/2) = 45.02; 45.02 · atan(50 / 45.02) = 37.71.
    const src = img(101, 101, (x) => [2 * Math.abs(x - 50), 0, 0]), out = dev(src, { fish: 1, fov: 180 });
    expect(at(out, 101, 50, 50)[0]).toBe(0);
    expect(Math.abs(at(out, 101, 100, 50)[0] - 75)).toBeLessThanOrEqual(1);
  });
  it('upright: finds a 3° tilt in tilted stripes, and levelling leaves under half a degree', () => {
    const tan = Math.tan((3 * Math.PI) / 180), im = planes(200, 150, (x, y) => 0.5 + 0.4 * Math.sin((2 * Math.PI * (y - x * tan)) / 18));
    const t = estimateTilt(im);
    expect(Math.abs(t - 3)).toBeLessThanOrEqual(0.5);
    rotateFill(im, t);
    const inner = planes(120, 90, (x, y) => im.r[(y + 30) * 200 + x + 40]);
    expect(Math.abs(estimateTilt(inner))).toBeLessThanOrEqual(0.5);
  });
  const contrast = (d: Uint8ClampedArray, w: number, a: [number, number], b: [number, number]): number => Math.abs(at(d, w, a[0], a[1])[0] - at(d, w, b[0], b[1])[0]);
  it('dehaze: half haze over two colours comes off (dark channel prior), so they move apart', () => {
    // Sky 230 is the haze colour A = 0.902. Scene colours (0, 51, 102) and (0, 153, 204) seen through half haze read (115, 140.5, 166) and
    // (115, 191.5, 217). Their dark channel is 0.5, so t = 1 - 0.95 x 0.5 = 0.525 and green comes back as (0.551 - 0.902) / 0.525 + 0.902
    // = 0.233 (60) and (0.751 - 0.902) / 0.525 + 0.902 = 0.614 (157); blue 166 comes back as 0.424 (108).
    const src = img(60, 40, (x, y) => (y < 10 ? [230, 230, 230] : x < 30 ? [115, 140.5, 166] : [115, 191.5, 217])), out = dev(src, { haze: 100 });
    near(at(out, 60, 10, 30), [11, 60, 108], 3);
    expect(Math.abs(at(out, 60, 50, 30)[1] - 157)).toBeLessThanOrEqual(3);
  });
  it('clarity and detail by size: an edge and a fine texture get stronger', () => {
    const edge = img(80, 20, (x) => (x < 40 ? [102, 102, 102] : [153, 153, 153])), out = dev(edge, { clar: 100 });
    expect(at(out, 80, 38, 10)[0]).toBeLessThan(102);
    expect(at(out, 80, 41, 10)[0]).toBeGreaterThan(153);
    const tex = img(40, 40, (x, y) => ((x + y) % 2 ? [140, 140, 140] : [116, 116, 116])), t2 = dev(tex, { clvF: 100 });
    expect(contrast(t2, 40, [20, 20], [21, 20])).toBeGreaterThan(30);
  });
  it('measured denoise: grain on a flat grey drops by over half, a hard edge stays', () => {
    let s = 7;
    const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const src = img(40, 40, (x) => { const v = (x < 20 ? 60 : 200) + (rnd() - 0.5) * 40; return [v, v, v]; }), out = dev(src, { dn: 100, dnC: 50 });
    const sd = (d: Uint8ClampedArray): number => { let a = 0, q = 0, n = 0; for (let y = 5; y < 35; y++) for (let x = 3; x < 15; x++) { const v = d[(y * 40 + x) * 4]; a += v; q += v * v; n++; } return Math.sqrt(q / n - (a / n) ** 2); };
    expect(sd(out)).toBeLessThan(sd(src.data) * 0.5);
    expect(at(out, 40, 22, 20)[0] - at(out, 40, 17, 20)[0]).toBeGreaterThan(110);
  });
  it('capture sharpening: a soft edge gets a steeper step', () => {
    const src = img(40, 10, (x) => { const v = 50 + 150 / (1 + Math.exp(-(x - 19.5) / 1.2)); return [v, v, v]; }), out = dev(src, { cs: 100, csR: 1.2 });
    const step = (d: Uint8ClampedArray): number => at(d, 40, 20, 5)[0] - at(d, 40, 19, 5)[0];
    expect(step(out)).toBeGreaterThan(step(src.data) * 1.2);
  });
});
