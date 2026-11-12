// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Light and colour adjustments beyond the first four (levels, curves, exposure, vibrance, colour balance, black and
 * white mix, photo filter, channel mixer, posterize, threshold, gradient map, selective colour, shadows and highlights,
 * desaturate, equalize and the three automatic fixes). Straight-alpha RGBA in, new pixels out; alpha is kept.
 * Automatic fixes read their statistics from the pixels they are given (the selected area or the whole layer).
 */
import type { Bitmap } from './document';
import { gaussianBlur } from './filters';
import { clamp } from './geometry';

export type ToneKind = 'levels' | 'curves' | 'exposure' | 'vibrance' | 'color-balance' | 'bw-mix' | 'photo-filter' | 'channel-mixer'
  | 'posterize' | 'threshold' | 'gradient-map' | 'selective-color' | 'shadows-highlights' | 'desaturate' | 'equalize'
  | 'auto-tone' | 'auto-contrast' | 'auto-color';
export const TONE_KINDS: readonly ToneKind[] = ['levels', 'curves', 'exposure', 'vibrance', 'color-balance', 'bw-mix', 'photo-filter',
  'channel-mixer', 'posterize', 'threshold', 'gradient-map', 'selective-color', 'shadows-highlights', 'desaturate', 'equalize',
  'auto-tone', 'auto-contrast', 'auto-color'];
export type ToneParams = Record<string, number | undefined>;

export const PHOTO_FILTERS: ReadonlyArray<readonly [string, number, number, number]> = [
  ['Warming', 236, 138, 0], ['Cooling', 0, 109, 255], ['Red', 234, 26, 26], ['Orange', 243, 132, 23], ['Yellow', 249, 227, 28],
  ['Green', 25, 201, 25], ['Cyan', 29, 203, 234], ['Blue', 29, 53, 234], ['Violet', 155, 29, 234], ['Magenta', 227, 24, 227],
  ['Sepia', 172, 122, 51], ['Underwater', 0, 194, 177]];
export const GRADIENT_MAPS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [number, number, number]>]> = [
  ['Black to white', [[0, 0, 0], [255, 255, 255]]], ['Sepia', [[38, 22, 10], [160, 110, 60], [255, 244, 220]]],
  ['Blue and orange', [[18, 32, 92], [255, 168, 64]]], ['Night and gold', [[8, 10, 38], [96, 40, 120], [255, 214, 120]]],
  ['Infrared', [[0, 0, 0], [150, 0, 90], [255, 140, 0], [255, 255, 214]]]];
export const COLOR_FAMILIES = ['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas', 'Whites', 'Neutrals', 'Blacks'] as const;

const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;
function lut3(s: Uint8ClampedArray, out: Uint8ClampedArray, lr: Uint8ClampedArray, lg: Uint8ClampedArray, lb: Uint8ClampedArray): Uint8ClampedArray {
  for (let i = 0; i < s.length; i += 4) { out[i] = lr[s[i]]; out[i + 1] = lg[s[i + 1]]; out[i + 2] = lb[s[i + 2]]; out[i + 3] = s[i + 3]; }
  return out;
}
/** Input black and white points, a middle-tone gamma (above 1 lightens) and the output range, as a lookup table. */
export function levelsLut(inB: number, gamma: number, inW: number, outB: number, outW: number): Uint8ClampedArray {
  const lo = clamp(inB, 0, 254), hi = clamp(inW, lo + 1, 255), g = clamp(gamma, 0.1, 9.99), lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = outB + (outW - outB) * Math.pow(clamp((v - lo) / (hi - lo), 0, 1), 1 / g);
  return lut;
}
/** A smooth curve through five points at inputs 0, 64, 128, 192 and 255 (monotone cubic, so it never overshoots). */
export function curveLut(ys: readonly number[]): Uint8ClampedArray {
  const xs = [0, 64, 128, 192, 255], n = xs.length, d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
  }
  const lut = new Uint8ClampedArray(256);
  for (let v = 0, k = 0; v < 256; v++) {
    while (k < n - 2 && v > xs[k + 1]) k++;
    const hh = xs[k + 1] - xs[k], t = (v - xs[k]) / hh, t2 = t * t, t3 = t2 * t;
    lut[v] = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * hh * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * hh * m[k + 1];
  }
  return lut;
}
interface Hist { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; n: number; }
function histogram(s: Uint8ClampedArray): Hist {
  const h: Hist = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256), n: 0 };
  for (let i = 0; i < s.length; i += 4) {
    if (!s[i + 3]) continue;
    h.r[s[i]]++; h.g[s[i + 1]]++; h.b[s[i + 2]]++; h.l[Math.round(luma(s[i], s[i + 1], s[i + 2]))]++; h.n++;
  }
  return h;
}
/** Stretch so the darkest and lightest values (ignoring a 0.1% tail) reach 0 and 255. */
function stretchLut(h: Uint32Array, n: number, clip = 0.001): Uint8ClampedArray {
  const cut = n * clip, lut = new Uint8ClampedArray(256);
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += h[lo]; if (acc > cut) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += h[hi]; if (acc > cut) break; }
  for (let v = 0; v < 256; v++) lut[v] = hi > lo ? ((v - lo) * 255) / (hi - lo) : v;
  return lut;
}
function familyWeight(f: number, r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), md = r + g + b - mx - mn;
  switch (f) {
    case 0: return r === mx && r > md ? (r - md) / 255 : 0;
    case 1: return b === mn ? (Math.min(r, g) - b) / 255 : 0;
    case 2: return g === mx && g > md ? (g - md) / 255 : 0;
    case 3: return r === mn ? (Math.min(g, b) - r) / 255 : 0;
    case 4: return b === mx && b > md ? (b - md) / 255 : 0;
    case 5: return g === mn ? (Math.min(r, b) - g) / 255 : 0;
    case 6: return mn > 128 ? (mn - 128) / 127 : 0;
    case 7: return (1 - (mx - mn) / 255) * (1 - Math.abs(luma(r, g, b) - 127.5) / 127.5);
    default: return mx < 128 ? (128 - mx) / 128 : 0;
  }
}

export function tone(src: Bitmap, kind: ToneKind, p: ToneParams = {}): Uint8ClampedArray {
  const s = src.data, n = s.length, out = new Uint8ClampedArray(n);
  const v = (k: string, d: number): number => { const x = p[k]; return typeof x === 'number' && Number.isFinite(x) ? x : d; };
  const copyA = (i: number): void => { out[i + 3] = s[i + 3]; };
  switch (kind) {
    case 'levels': { const l = levelsLut(v('inB', 0), v('gamma', 1), v('inW', 255), v('outB', 0), v('outW', 255)); return lut3(s, out, l, l, l); }
    case 'curves': { const l = curveLut([v('p0', 0), v('p1', 64), v('p2', 128), v('p3', 192), v('p4', 255)]); return lut3(s, out, l, l, l); }
    case 'exposure': {
      const k = Math.pow(2, v('ev', 0)), off = v('offset', 0), g = clamp(v('gamma', 1), 0.1, 10), l = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) l[i] = 255 * Math.pow(Math.pow(Math.max(0, Math.pow(i / 255, 2.2) * k + off), 1 / g), 1 / 2.2);
      return lut3(s, out, l, l, l);
    }
    case 'vibrance': {
      const vb = v('vibrance', 0) / 100, sa = v('saturation', 0) / 100;
      for (let i = 0; i < n; i += 4) {
        const r = s[i], g = s[i + 1], b = s[i + 2], L = luma(r, g, b), sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
        const k = Math.max(0, 1 + vb * (1 - sat)) * (1 + sa);
        out[i] = L + (r - L) * k; out[i + 1] = L + (g - L) * k; out[i + 2] = L + (b - L) * k; copyA(i);
      }
      return out;
    }
    case 'color-balance': {
      const sh = [v('sr', 0), v('sg', 0), v('sb', 0)], mi = [v('mr', 0), v('mg', 0), v('mb', 0)], hi = [v('hr', 0), v('hg', 0), v('hb', 0)];
      const keep = v('pl', 1) >= 0.5;
      for (let i = 0; i < n; i += 4) {
        const r = s[i], g = s[i + 1], b = s[i + 2], L0 = luma(r, g, b), L = L0 / 255;
        const ws = clamp(1 - L / 0.55, 0, 1), wh = clamp((L - 0.45) / 0.55, 0, 1), wm = 4 * L * (1 - L);
        let nr = r + (sh[0] * ws + mi[0] * wm + hi[0] * wh) * 0.6, ng = g + (sh[1] * ws + mi[1] * wm + hi[1] * wh) * 0.6, nb = b + (sh[2] * ws + mi[2] * wm + hi[2] * wh) * 0.6;
        if (keep) { const dl = L0 - luma(nr, ng, nb); nr += dl; ng += dl; nb += dl; }
        out[i] = nr; out[i + 1] = ng; out[i + 2] = nb; copyA(i);
      }
      return out;
    }
    case 'bw-mix': {
      const w = [v('reds', 40), v('yellows', 60), v('greens', 40), v('cyans', 60), v('blues', 20), v('magentas', 80)].map((x) => x / 100);
      for (let i = 0; i < n; i += 4) {
        const r = s[i], g = s[i + 1], b = s[i + 2];
        let y: number;
        if (r >= g && r >= b) y = g >= b ? b + (g - b) * w[1] + (r - g) * w[0] : g + (b - g) * w[5] + (r - b) * w[0];
        else if (g >= b) y = r >= b ? b + (r - b) * w[1] + (g - r) * w[2] : r + (b - r) * w[3] + (g - b) * w[2];
        else y = g >= r ? r + (g - r) * w[3] + (b - g) * w[4] : g + (r - g) * w[5] + (b - r) * w[4];
        out[i] = y; out[i + 1] = y; out[i + 2] = y; copyA(i);
      }
      return out;
    }
    case 'photo-filter': {
      const f = PHOTO_FILTERS[clamp(Math.round(v('color', 0)), 0, PHOTO_FILTERS.length - 1)], d = clamp(v('density', 25), 0, 100) / 100, keep = v('pl', 1) >= 0.5;
      for (let i = 0; i < n; i += 4) {
        const r = s[i], g = s[i + 1], b = s[i + 2];
        let nr = r + ((r * f[1]) / 255 - r) * d, ng = g + ((g * f[2]) / 255 - g) * d, nb = b + ((b * f[3]) / 255 - b) * d;
        if (keep) { const L1 = luma(nr, ng, nb); if (L1 > 0.5) { const k = luma(r, g, b) / L1; nr *= k; ng *= k; nb *= k; } }
        out[i] = nr; out[i + 1] = ng; out[i + 2] = nb; copyA(i);
      }
      return out;
    }
    case 'channel-mixer': {
      const m = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'].map((k, j) => v(k, j % 4 === 0 ? 100 : 0) / 100), mono = v('mono', 0) >= 0.5;
      for (let i = 0; i < n; i += 4) {
        const r = s[i], g = s[i + 1], b = s[i + 2], R = r * m[0] + g * m[1] + b * m[2];
        if (mono) { out[i] = R; out[i + 1] = R; out[i + 2] = R; } else { out[i] = R; out[i + 1] = r * m[3] + g * m[4] + b * m[5]; out[i + 2] = r * m[6] + g * m[7] + b * m[8]; }
        copyA(i);
      }
      return out;
    }
    case 'posterize': {
      const lv = clamp(Math.round(v('levels', 4)), 2, 255), l = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) l[i] = (Math.round((i / 255) * (lv - 1)) / (lv - 1)) * 255;
      return lut3(s, out, l, l, l);
    }
    case 'threshold': {
      const t = v('level', 128);
      for (let i = 0; i < n; i += 4) { const y = luma(s[i], s[i + 1], s[i + 2]) >= t ? 255 : 0; out[i] = y; out[i + 1] = y; out[i + 2] = y; copyA(i); }
      return out;
    }
    case 'gradient-map': {
      const stops = GRADIENT_MAPS[clamp(Math.round(v('preset', 0)), 0, GRADIENT_MAPS.length - 1)][1], rev = v('reverse', 0) >= 0.5;
      const pal = new Uint8ClampedArray(256 * 3), segs = stops.length - 1;
      for (let t = 0; t < 256; t++) {
        const x = ((rev ? 255 - t : t) / 255) * segs, k = Math.min(segs - 1, Math.floor(x)), f = x - k, a = stops[k], c = stops[k + 1];
        for (let ch = 0; ch < 3; ch++) pal[t * 3 + ch] = a[ch] + (c[ch] - a[ch]) * f;
      }
      for (let i = 0; i < n; i += 4) { const t = Math.round(luma(s[i], s[i + 1], s[i + 2])) * 3; out[i] = pal[t]; out[i + 1] = pal[t + 1]; out[i + 2] = pal[t + 2]; copyA(i); }
      return out;
    }
    case 'selective-color': {
      const f = clamp(Math.round(v('family', 0)), 0, 8), c = v('c', 0) / 100, m = v('m', 0) / 100, y = v('y', 0) / 100, k = v('k', 0) / 100;
      for (let i = 0; i < n; i += 4) {
        const r = s[i], g = s[i + 1], b = s[i + 2], w = familyWeight(f, r, g, b) * 128;
        out[i] = r - (c + k) * w; out[i + 1] = g - (m + k) * w; out[i + 2] = b - (y + k) * w; copyA(i);
      }
      return out;
    }
    case 'shadows-highlights': {
      const W = src.width, H = src.height, lm = new Uint8ClampedArray(n), sh = v('shadows', 35) / 100, hl = v('highlights', 0) / 100;
      for (let i = 0; i < n; i += 4) { const y = luma(s[i], s[i + 1], s[i + 2]); lm[i] = y; lm[i + 1] = y; lm[i + 2] = y; lm[i + 3] = 255; }
      const bl = gaussianBlur({ width: W, height: H, data: lm }, Math.max(0.5, v('radius', 30)));
      const table = new Uint8ClampedArray(64 * 256);
      for (let q = 0; q < 64; q++) {
        const local = q / 63, up = 1 + 2.2 * sh * (1 - local) ** 2, down = 1 + 1.6 * hl * local ** 2;
        for (let x = 0; x < 256; x++) table[q * 256 + x] = 255 * Math.pow(Math.pow(x / 255, 1 / up), down);
      }
      for (let i = 0; i < n; i += 4) {
        const o = Math.round((bl[i] / 255) * 63) * 256;
        out[i] = table[o + s[i]]; out[i + 1] = table[o + s[i + 1]]; out[i + 2] = table[o + s[i + 2]]; copyA(i);
      }
      return out;
    }
    case 'desaturate': {
      for (let i = 0; i < n; i += 4) { const y = (Math.max(s[i], s[i + 1], s[i + 2]) + Math.min(s[i], s[i + 1], s[i + 2])) / 2; out[i] = y; out[i + 1] = y; out[i + 2] = y; copyA(i); }
      return out;
    }
    case 'equalize': {
      const h = histogram(s), lut = new Uint8ClampedArray(256);
      let acc = 0, first = 0;
      for (let t = 0; t < 256; t++) if (h.l[t]) { first = h.l[t]; break; }
      for (let t = 0; t < 256; t++) { acc += h.l[t]; lut[t] = h.n > first ? Math.round(((acc - first) / (h.n - first)) * 255) : t; }
      for (let i = 0; i < n; i += 4) {
        const r = s[i], g = s[i + 1], b = s[i + 2], L = Math.round(luma(r, g, b)), L2 = lut[L];
        if (L > 0) { const k = L2 / L; out[i] = r * k; out[i + 1] = g * k; out[i + 2] = b * k; } else { out[i] = L2; out[i + 1] = L2; out[i + 2] = L2; }
        copyA(i);
      }
      return out;
    }
    case 'auto-tone': { const h = histogram(s); return lut3(s, out, stretchLut(h.r, h.n), stretchLut(h.g, h.n), stretchLut(h.b, h.n)); }
    case 'auto-contrast': {
      const h = histogram(s), all = new Uint32Array(256);
      for (let t = 0; t < 256; t++) all[t] = h.r[t] + h.g[t] + h.b[t];
      const l = stretchLut(all, h.n * 3);
      return lut3(s, out, l, l, l);
    }
    case 'auto-color': {
      const h = histogram(s), ls = [stretchLut(h.r, h.n), stretchLut(h.g, h.n), stretchLut(h.b, h.n)], hs = [h.r, h.g, h.b];
      const means = hs.map((hc, c) => { let sum = 0; for (let t = 0; t < 256; t++) sum += hc[t] * ls[c][t]; return h.n ? sum / h.n : 128; });
      const target = (means[0] + means[1] + means[2]) / 3;
      const luts = ls.map((l, c) => {
        const m = clamp(means[c], 1, 254), gam = clamp(Math.log(target / 255) / Math.log(m / 255), 0.5, 2), o = new Uint8ClampedArray(256);
        for (let t = 0; t < 256; t++) o[t] = 255 * Math.pow(l[t] / 255, gam);
        return o;
      });
      return lut3(s, out, luts[0], luts[1], luts[2]);
    }
  }
  out.set(s);
  return out;
}
