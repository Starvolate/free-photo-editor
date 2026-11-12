// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Shared helpers for the filter families: reading settings, the edited box inside the working bitmap, seeded noise,
 * premultiplied sampling (so see-through areas never bleed dark edges), rank filters and edge maps. Straight RGBA in.
 */
import type { Bitmap } from '../document';
import { boxesForGauss } from '../filters';

export type P = Record<string, number | undefined>;
/** The part of the working bitmap being edited; the rest is neighbouring pixels a filter may read. */
export interface Box { x: number; y: number; w: number; h: number; }
export type Fx = (src: Bitmap, p: P, b: Box) => Uint8ClampedArray;

export const num = (p: P, k: string, d: number): number => { const v = p[k]; return typeof v === 'number' && Number.isFinite(v) ? v : d; };
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;
export const smoothstep = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
/** 0xRRGGBB to its three parts. */
export const rgbOf = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** The edited box: settings `ix`, `iy`, `iw`, `ih`, or the whole bitmap. */
export function innerBox(src: Bitmap, p: P): Box {
  const x = clamp(Math.round(num(p, 'ix', 0)), 0, src.width - 1), y = clamp(Math.round(num(p, 'iy', 0)), 0, src.height - 1);
  return { x, y, w: clamp(Math.round(num(p, 'iw', src.width - x)), 1, src.width - x), h: clamp(Math.round(num(p, 'ih', src.height - y)), 1, src.height - y) };
}
/** Seeded hash noise in [0, 1): the same position and seed always give the same number, so preview and apply agree. */
export function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x632be5ab, 0x165667b1) ^ Math.imul((s | 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1]. */
export function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Several octaves of value noise (fractal noise), in [0, 1]. */
export function fbm(x: number, y: number, octaves: number, s: number): number {
  let sum = 0, amp = 1, total = 0, f = 1;
  for (let o = 0; o < octaves; o++) { sum += amp * vnoise(x * f, y * f, s + o * 31); total += amp; amp *= 0.5; f *= 2.03; }
  return sum / total;
}
/** Premultiplied float copy: colour times opacity. */
export function premul(src: Bitmap): Float32Array {
  const d = src.data, f = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3]; }
  return f;
}
/** Back to straight colour; fully see-through pixels become (0, 0, 0, 0). */
export function unpremul(f: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3];
    if (!(a > 0.5)) continue;
    const k = 255 / a;
    out[i] = f[i] * k; out[i + 1] = f[i + 1] * k; out[i + 2] = f[i + 2] * k; out[i + 3] = a;
  }
  return out;
}
/** Reads premultiplied pixels at any position with bilinear smoothing; past the box it repeats the edge or wraps round. */
export function makeSampler(pm: Float32Array, W: number, b: Box, wrap = false): (x: number, y: number, out: Float32Array) => void {
  const x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
  const ix = (v: number): number => (wrap ? b.x + ((((v - b.x) % b.w) + b.w) % b.w) : v < b.x ? b.x : v > x1 ? x1 : v);
  const iy = (v: number): number => (wrap ? b.y + ((((v - b.y) % b.h) + b.h) % b.h) : v < b.y ? b.y : v > y1 ? y1 : v);
  return (x, y, out) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) { x = b.x; y = b.y; }
    const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
    const xa = ix(fx), xb = ix(fx + 1), ya = iy(fy), yb = iy(fy + 1);
    const i00 = (ya * W + xa) * 4, i10 = (ya * W + xb) * 4, i01 = (yb * W + xa) * 4, i11 = (yb * W + xb) * 4;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    for (let c = 0; c < 4; c++) out[c] = pm[i00 + c] * w00 + pm[i10 + c] * w10 + pm[i01 + c] * w01 + pm[i11 + c] * w11;
  };
}
/** Moves pixels: for every pixel of the box, `fn` names where its colour comes from. Pixels outside the box are kept. */
export function warp(src: Bitmap, b: Box, fn: (x: number, y: number, o: Float64Array) => void, wrap = false): Uint8ClampedArray {
  const W = src.width, pm = premul(src), get = makeSampler(pm, W, b, wrap), out = pm.slice(), px = new Float32Array(4), o = new Float64Array(2);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    fn(x, y, o);
    get(o[0], o[1], px);
    out.set(px, (y * W + x) * 4);
  }
  const res = unpremul(out), d = src.data;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < W; x++) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
    const i = (y * W + x) * 4;
    res[i] = d[i]; res[i + 1] = d[i + 1]; res[i + 2] = d[i + 2]; res[i + 3] = d[i + 3];
  }
  return res;
}
/** One channel (0 red, 1 green, 2 blue, 3 brightness) as floats, weighted by opacity. */
export function planeOf(src: Bitmap, c: number): Float32Array {
  const d = src.data, f = new Float32Array(src.width * src.height);
  for (let j = 0, i = 0; j < f.length; j++, i += 4) f[j] = ((c === 3 ? luma(d[i], d[i + 1], d[i + 2]) : d[i + c]) * d[i + 3]) / 255;
  return f;
}
/** Edge strength of a plane (Sobel): about 0 on flat areas, up to about 255 on hard edges. */
export function sobel(L: Float32Array, W: number, H: number): Float32Array {
  const E = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const ya = (y > 0 ? y - 1 : 0) * W, yb = y * W, yc = (y < H - 1 ? y + 1 : y) * W;
    for (let x = 0; x < W; x++) {
      const xa = x > 0 ? x - 1 : 0, xc = x < W - 1 ? x + 1 : x;
      const gx = L[ya + xc] + 2 * L[yb + xc] + L[yc + xc] - L[ya + xa] - 2 * L[yb + xa] - L[yc + xa];
      const gy = L[yc + xa] + 2 * L[yc + x] + L[yc + xc] - L[ya + xa] - 2 * L[ya + x] - L[ya + xc];
      E[yb + x] = Math.sqrt(gx * gx + gy * gy) / 4;
    }
  }
  return E;
}
export const edgeMap = (src: Bitmap): Float32Array => sobel(planeOf(src, 3), src.width, src.height);
function boxPass(src: Float32Array, dst: Float32Array, n: number, count: number, step: number, lineStep: number, r: number): void {
  const k = 2 * r + 1;
  for (let l = 0; l < count; l++) {
    const o = l * lineStep;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[o + clamp(i, 0, n - 1) * step];
    for (let i = 0; i < n; i++) {
      dst[o + i * step] = acc / k;
      acc += src[o + Math.min(n - 1, i + r + 1) * step] - src[o + Math.max(0, i - r) * step];
    }
  }
}
/** Gaussian-like blur of one float plane (three box passes), repeating the edges. */
export function blurPlane(f: Float32Array, W: number, H: number, sigma: number): Float32Array {
  const a = f.slice();
  if (!(sigma > 0.2)) return a;
  const t = new Float32Array(f.length);
  for (const size of boxesForGauss(sigma, 3)) {
    const r = (size - 1) >> 1;
    if (r < 1) continue;
    boxPass(a, t, W, H, 1, W, r);
    boxPass(t, a, H, W, W, 1, r);
  }
  return a;
}
/** Running maximum (or minimum) over 2r+1 neighbours of a line, in linear time (van Herk / Gil-Werman). */
function runExtreme(a: Float32Array, n: number, r: number, max: boolean, out: Float32Array, g: Float32Array, hh: Float32Array): void {
  const k = 2 * r + 1, m = n + 2 * r, none = max ? -Infinity : Infinity;
  const at = (i: number): number => { const j = i - r; return j < 0 || j >= n ? none : a[j]; };
  const pick = (u: number, v: number): number => (max ? (u > v ? u : v) : u < v ? u : v);
  for (let i = 0; i < m; i++) g[i] = i % k === 0 ? at(i) : pick(g[i - 1], at(i));
  for (let i = m - 1; i >= 0; i--) hh[i] = i === m - 1 || (i + 1) % k === 0 ? at(i) : pick(hh[i + 1], at(i));
  for (let j = 0; j < n; j++) out[j] = pick(hh[j], g[j + 2 * r]);
}
/** Square maximum (or minimum) filter of a float plane. */
export function extremePlane(f: Float32Array, W: number, H: number, r: number, max: boolean): Float32Array {
  const len = Math.max(W, H), line = new Float32Array(len), res = new Float32Array(len), g = new Float32Array(len + 2 * r), hh = new Float32Array(len + 2 * r);
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) line[x] = f[y * W + x];
    runExtreme(line, W, r, max, res, g, hh);
    for (let x = 0; x < W; x++) tmp[y * W + x] = res[x];
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) line[y] = tmp[y * W + x];
    runExtreme(line, H, r, max, res, g, hh);
    for (let y = 0; y < H; y++) out[y * W + x] = res[y];
  }
  return out;
}
/** Each colour channel becomes its square neighbourhood's highest (or lowest) value; see-through pixels take no part. */
export function minMax(src: Bitmap, rad: number, max: boolean, b: Box): Uint8ClampedArray {
  const { width: W, height: H, data: d } = src, out = d.slice(), none = max ? -Infinity : Infinity, f = new Float32Array(W * H), r = Math.max(1, Math.round(rad));
  for (let c = 0; c < 3; c++) {
    for (let j = 0; j < W * H; j++) f[j] = d[j * 4 + 3] ? d[j * 4 + c] : none;
    const e = extremePlane(f, W, H, r, max);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const j = y * W + x;
      if (d[j * 4 + 3] && Number.isFinite(e[j])) out[j * 4 + c] = e[j];
    }
  }
  return out;
}
/**
 * Rank filter with sliding histograms (Huang): each colour channel becomes the value at `q` of its square
 * neighbourhood (0 lowest, 0.5 the middle value, 1 highest). See-through pixels take no part; opacity is kept.
 */
export function rankFilter(src: Bitmap, rad: number, q: number, b: Box): Uint8ClampedArray {
  const { width: W, height: H, data: d } = src, out = d.slice(), r = Math.max(1, Math.round(rad));
  const hist = [new Int32Array(256), new Int32Array(256), new Int32Array(256)], med = [0, 0, 0], lt = [0, 0, 0];
  let n = 0;
  const add = (i: number, s: number): void => {
    if (!d[i + 3]) return;
    n += s;
    for (let c = 0; c < 3; c++) { const v = d[i + c]; hist[c][v] += s; if (v < med[c]) lt[c] += s; }
  };
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let c = 0; c < 3; c++) { hist[c].fill(0); med[c] = 0; lt[c] = 0; }
    n = 0;
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let yy = y0; yy <= y1; yy++) for (let xx = Math.max(0, b.x - r); xx <= Math.min(W - 1, b.x + r); xx++) add((yy * W + xx) * 4, 1);
    for (let x = b.x; x < b.x + b.w; x++) {
      if (x > b.x) {
        const xo = x - r - 1, xi = x + r;
        for (let yy = y0; yy <= y1; yy++) { if (xo >= 0) add((yy * W + xo) * 4, -1); if (xi < W) add((yy * W + xi) * 4, 1); }
      }
      const o = (y * W + x) * 4;
      if (!n || !d[o + 3]) continue;
      const t = Math.round((n - 1) * q);
      for (let c = 0; c < 3; c++) {
        const hc = hist[c];
        let m = med[c], l = lt[c];
        while (l > t) { m--; l -= hc[m]; }
        while (l + hc[m] <= t) { l += hc[m]; m++; }
        med[c] = m; lt[c] = l; out[o + c] = m;
      }
    }
  }
  return out;
}
