// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Photo developing (13 Nov 2026): the Develop RAW sheet's one effect, `develop`, for any photo (JPEG, PNG or a decoded
 * camera file). Every stage reads its own settings and is skipped while they rest, so the resting sheet changes no
 * pixel. Stages run in a photo developer's order: stuck dots, film negative, lens shape, level, white balance, black and
 * white points, starting curve, highlights and shadows, zones, haze, detail by size, clarity, colour mixer, colour
 * grading, noise, capture sharpening, vignette, and last the clipping overlay (shown while editing, never applied).
 * Radii follow the edited box's size, so the small preview and the full-size Apply agree. All maths here is written
 * for this project; the published methods it follows are named where they are used.
 */
import type { Bitmap } from '../document';
import { blurPlane, clamp, extremePlane, innerBox, num, smoothstep, type Box, type Fx, type P } from './lib';

/** The box's colour as float planes, 0..1 in the picture's own (sRGB) encoding. */
export interface Planes { w: number; h: number; r: Float32Array; g: Float32Array; b: Float32Array; }
const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const enc = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const on = (p: P, k: string): boolean => num(p, k, 0) !== 0;
const chans = (im: Planes): Float32Array[] => [im.r, im.g, im.b];
const lumaPlane = (im: Planes): Float32Array => { const L = new Float32Array(im.w * im.h); for (let i = 0; i < L.length; i++) L[i] = lum(im.r[i], im.g[i], im.b[i]); return L; };
/** Adds (L' - L) to every channel: a brightness change that keeps the colour. */
function addLuma(im: Planes, L: Float32Array, L2: Float32Array): void {
  for (let i = 0; i < L.length; i++) { const d = L2[i] - L[i]; im.r[i] += d; im.g[i] += d; im.b[i] += d; }
}
/** An exact Gaussian blur of one plane (separable kernel, edges repeated), for the small radii deconvolution needs. */
export function gauss(f: Float32Array, W: number, H: number, sigma: number): Float32Array {
  if (!(sigma > 0.05)) return f.slice();
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const t = new Float32Array(f.length), o = new Float32Array(f.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += k[i + r] * f[y * W + clamp(x + i, 0, W - 1)];
    t[y * W + x] = a;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += k[i + r] * t[clamp(y + i, 0, H - 1) * W + x];
    o[y * W + x] = a;
  }
  return o;
}
/** Bilinear sample of one plane, edges repeated. */
function sample(f: Float32Array, W: number, H: number, x: number, y: number): number {
  x = clamp(x, 0, W - 1); y = clamp(y, 0, H - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const a = f[y0 * W + x0] + (f[y0 * W + x1] - f[y0 * W + x0]) * fx, b = f[y1 * W + x0] + (f[y1 * W + x1] - f[y1 * W + x0]) * fx;
  return a + (b - a) * fy;
}
/** Moves every pixel: `fn` gives, for an output pixel, where in the box to read it from. */
function remap(im: Planes, fn: (x: number, y: number) => [number, number]): void {
  const { w, h } = im, src = chans(im).map((c) => c.slice());
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [sx, sy] = fn(x, y), i = y * w + x;
    im.r[i] = sample(src[0], w, h, sx, sy); im.g[i] = sample(src[1], w, h, sx, sy); im.b[i] = sample(src[2], w, h, sx, sy);
  }
}

// ---------- stuck dots and film ----------
/** A pixel brighter than all eight neighbours by more than `thr` (0..1) in a channel is a stuck dot: it takes their average. */
export function hotPixels(im: Planes, thr: number): number {
  const { w, h } = im;
  let fixed = 0;
  for (const c of chans(im)) {
    const s = c.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let mx = -1, sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const v = s[yy * w + xx];
        if (v > mx) mx = v;
        sum += v; n++;
      }
      if (n && s[y * w + x] > mx + thr) { c[y * w + x] = sum / n; fixed++; }
    }
  }
  return fixed;
}
/** The value below which `q` (0..1) of a plane lies, read from a 1024-step histogram. */
function quantile(f: Float32Array, q: number): number {
  const hist = new Uint32Array(1024);
  for (let i = 0; i < f.length; i++) hist[clamp(Math.round(f[i] * 1023), 0, 1023)]++;
  let acc = 0;
  const want = q * f.length;
  for (let k = 0; k < 1024; k++) { acc += hist[k]; if (acc >= want) return k / 1023; }
  return 1;
}
/** Scanned negative to positive: each channel is divided by the film's clear base (its brightest part), turned over, then stretched. */
export function negative(im: Planes): void {
  for (const c of chans(im)) {
    const base = Math.max(1e-3, quantile(c, 0.995));
    for (let i = 0; i < c.length; i++) c[i] = 1 - Math.min(1, c[i] / base);
    const lo = quantile(c, 0.005), hi = Math.max(lo + 1e-3, quantile(c, 0.995));
    for (let i = 0; i < c.length; i++) c[i] = (c[i] - lo) / (hi - lo);
  }
}

// ---------- lens shape and level ----------
/** Fisheye to flat: an equidistant fisheye whose field of view `fov` (degrees) spans the diagonal becomes a rectilinear picture. */
export function defish(im: Planes, fov: number): void {
  const { w, h } = im, cx = (w - 1) / 2, cy = (h - 1) / 2, R = Math.hypot(cx, cy), half = (clamp(fov, 60, 240) * Math.PI) / 360, f = R / half;
  remap(im, (x, y) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r < 1e-6) return [x, y];
    const k = (f * Math.atan(r / f)) / r;
    return [cx + dx * k, cy + dy * k];
  });
}
/** The tilt (degrees, -20..20) of the picture's strongest straight lines near level or upright, from a weighted vote of edge directions. */
export function estimateTilt(im: Planes): number {
  const { w, h } = im, L = lumaPlane(im), bins = new Float64Array(161);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1];
    const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
    const m = Math.hypot(gx, gy);
    if (m < 0.2) continue;
    let a = (Math.atan2(gy, gx) * 180) / Math.PI - 90;
    while (a <= -45) a += 90;
    while (a > 45) a -= 90;
    if (Math.abs(a) > 20) continue;
    const k = (a + 20) * 4, k0 = Math.floor(k), t = k - k0;
    bins[k0] += m * (1 - t);
    if (k0 < 160) bins[k0 + 1] += m * t;
  }
  let best = 80, bv = -1;
  for (let k = 0; k < 161; k++) { const v = bins[k] + 0.5 * ((bins[k - 1] ?? 0) + (bins[k + 1] ?? 0)); if (v > bv) { bv = v; best = k; } }
  return bv > 0 ? best / 4 - 20 : 0;
}
/** Turns the box by `deg` about its centre and zooms just enough that no empty corner shows. */
export function rotateFill(im: Planes, deg: number): void {
  const { w, h } = im, a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), cx = (w - 1) / 2, cy = (h - 1) / 2;
  const zoom = Math.max((w * Math.abs(c) + h * Math.abs(s)) / w, (w * Math.abs(s) + h * Math.abs(c)) / h);
  remap(im, (x, y) => { const dx = (x - cx) / zoom, dy = (y - cy) / zoom; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; });
}

// ---------- light ----------
/** The colour of a glowing black body at `k` kelvin as linear sRGB (Kim et al. 2002's fit of the Planckian locus), green = 1. */
export function kelvinWhite(k: number): [number, number, number] {
  const T = clamp(k, 1667, 25000), t = 1e3 / T, t2 = t * t, t3 = t2 * t;
  const x = T <= 4000 ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.17991 : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.24039;
  const y = T <= 2222 ? -1.1063814 * x ** 3 - 1.3481102 * x * x + 2.18555832 * x - 0.20219683
    : T <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x * x + 2.09137015 * x - 0.16748867 : 3.081758 * x ** 3 - 5.8733867 * x * x + 3.75112997 * x - 0.37001483;
  const X = x / y, Z = (1 - x - y) / y;
  const r = 3.2406 * X - 1.5372 - 0.4986 * Z, g = -0.9689 * X + 1.8758 + 0.0415 * Z, b = 0.0557 * X - 0.204 + 1.057 * Z;
  return [r / g, 1, b / g];
}
/** White balance gains (linear light): the scene was lit at `k` kelvin, and `tint` (-100 green .. 100 magenta) pulls green. Grey keeps its brightness. */
export function wbGains(k: number, tint: number, pick?: [number, number, number]): [number, number, number] {
  const ref = kelvinWhite(6500), wt = kelvinWhite(k), g = [ref[0] / wt[0], 1, ref[2] / wt[2]];
  g[1] *= 1 - (clamp(tint, -100, 100) / 100) * 0.3;
  if (pick) { const m = lum(pick[0], pick[1], pick[2]); for (let c = 0; c < 3; c++) g[c] *= m / Math.max(1e-4, pick[c]); }
  const n = lum(g[0], g[1], g[2]);
  return [g[0] / n, g[1] / n, g[2] / n];
}
function whiteBalance(im: Planes, p: P): void {
  let pick: [number, number, number] | undefined;
  if (on(p, 'wbPick')) {
    const px = Math.round((clamp(num(p, 'gx', 50), 0, 100) / 100) * (im.w - 1)), py = Math.round((clamp(num(p, 'gy', 50), 0, 100) / 100) * (im.h - 1));
    const acc = [0, 0, 0];
    let n = 0;
    for (let y = py - 2; y <= py + 2; y++) for (let x = px - 2; x <= px + 2; x++) {
      if (x < 0 || y < 0 || x >= im.w || y >= im.h) continue;
      const i = y * im.w + x;
      acc[0] += lin(im.r[i]); acc[1] += lin(im.g[i]); acc[2] += lin(im.b[i]); n++;
    }
    pick = [acc[0] / n, acc[1] / n, acc[2] / n];
  }
  const g = wbGains(num(p, 'wbT', 6500), num(p, 'wbTint', 0), pick), cs = chans(im);
  for (let c = 0; c < 3; c++) { const f = cs[c]; for (let i = 0; i < f.length; i++) f[i] = enc(Math.max(0, lin(f[i]) * g[c])); }
}
/** The starting curves: none, gentle, medium, strong, and a film-like one with soft blacks and whites. */
export function baseCurve(v: number, kind: number): number {
  const k = [0, 0.35, 0.65, 1, 0.6][kind] ?? 0, x = clamp(v, 0, 1), s = x + k * (x * x * (3 - 2 * x) - x);
  return kind === 4 ? 0.03 + 0.94 * s : s;
}
function highlightsShadows(im: Planes, hl: number, sh: number): void {
  const L = lumaPlane(im), Lb = blurPlane(L, im.w, im.h, Math.max(2, Math.hypot(im.w, im.h) / 120));
  for (let i = 0; i < L.length; i++) {
    const ev = (hl / 100) * smoothstep(0.5, 1, Lb[i]) + (sh / 100) * 1.2 * (1 - smoothstep(0, 0.5, Lb[i]));
    if (!ev) continue;
    const m = Math.pow(2, ev);
    im.r[i] = enc(lin(im.r[i]) * m); im.g[i] = enc(lin(im.g[i]) * m); im.b[i] = enc(lin(im.b[i]) * m);
  }
}
/** Zone centres of the tone equalizer, in stops below white: blacks, shadows, middle tones, lights, whites. */
export const ZONES = [-7, -4.5, -2.5, -1, 0];
export function zoneGain(ev: number, zones: readonly number[]): number {
  let s = 0, ws = 0;
  for (let z = 0; z < 5; z++) { const d = ev - ZONES[z], w = Math.exp(-(d * d) / (2 * 1.2 * 1.2)); s += w * zones[z]; ws += w; }
  return ws > 0 ? s / ws : 0;
}
function toneEqualizer(im: Planes, zones: number[]): void {
  const n = im.w * im.h, E = new Float32Array(n);
  for (let i = 0; i < n; i++) E[i] = Math.log2(Math.max(1 / 4096, lum(lin(im.r[i]), lin(im.g[i]), lin(im.b[i]))));
  const Eb = blurPlane(E, im.w, im.h, Math.max(1, Math.hypot(im.w, im.h) / 300)), stops = zones.map((z) => (z / 100) * 2);
  for (let i = 0; i < n; i++) {
    const m = Math.pow(2, zoneGain(Eb[i], stops));
    im.r[i] = enc(lin(im.r[i]) * m); im.g[i] = enc(lin(im.g[i]) * m); im.b[i] = enc(lin(im.b[i]) * m);
  }
}
/** Haze: the dark channel prior (He, Sun and Tang 2009). Positive amounts lift haze, negative ones add it. */
function dehaze(im: Planes, amount: number): void {
  const { w, h } = im, n = w * h, rad = Math.max(2, Math.round(Math.min(w, h) / 60)), D = new Float32Array(n);
  for (let i = 0; i < n; i++) D[i] = Math.min(im.r[i], im.g[i], im.b[i]);
  // The haze colour: the average of the haziest 0.1% (the top of the dark channel), found from a histogram, not a sort.
  const dark = extremePlane(D, w, h, rad, false), top = quantile(dark, 0.999), A = [0, 0, 0];
  let cnt = 0;
  // Half a histogram step of slack: quantile() returns its step's centre, which can sit just above the values in it.
  for (let i = 0; i < n; i++) if (dark[i] >= top - 1 / 2046) { A[0] += im.r[i]; A[1] += im.g[i]; A[2] += im.b[i]; cnt++; }
  for (let c = 0; c < 3; c++) A[c] = Math.max(0.05, A[c] / Math.max(1, cnt));
  const cs = chans(im);
  if (amount < 0) {
    const k = (-amount / 100) * 0.6;
    for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) cs[c][i] += (A[c] - cs[c][i]) * k;
    return;
  }
  for (let i = 0; i < n; i++) D[i] = Math.min(im.r[i] / A[0], im.g[i] / A[1], im.b[i] / A[2]);
  const t = blurPlane(extremePlane(D, w, h, rad, false), w, h, rad), om = 0.95 * (amount / 100);
  for (let i = 0; i < n; i++) {
    const tt = Math.max(0.1, 1 - om * t[i]);
    for (let c = 0; c < 3; c++) cs[c][i] = (cs[c][i] - A[c]) / tt + A[c];
  }
}

// ---------- detail ----------
/** Detail by size: fine, medium and large layers of brightness, each turned up or down on its own. */
function contrastLevels(im: Planes, fine: number, mid: number, large: number): void {
  const { w, h } = im, d = Math.hypot(w, h), L = lumaPlane(im);
  const b1 = blurPlane(L, w, h, Math.max(1, d / 900)), b2 = blurPlane(L, w, h, Math.max(3, d / 200)), b3 = blurPlane(L, w, h, Math.max(9, d / 50)), L2 = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) L2[i] = L[i] + (fine / 100) * 1.5 * (L[i] - b1[i]) + (mid / 100) * 1.5 * (b1[i] - b2[i]) + (large / 100) * 1.5 * (b2[i] - b3[i]);
  addLuma(im, L, L2);
}
/** Clarity: mid-size local contrast, strongest in the middle tones. */
function clarity(im: Planes, amount: number): void {
  const L = lumaPlane(im), B = blurPlane(L, im.w, im.h, Math.max(1.5, Math.hypot(im.w, im.h) / 80)), L2 = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) { const m = 1 - (2 * L[i] - 1) ** 2; L2[i] = L[i] + (amount / 100) * 1.2 * m * (L[i] - B[i]); }
  addLuma(im, L, L2);
}
/** How much noise the picture carries (Immerkaer 1996's fast estimate), as a standard deviation on 0..1. */
export function noiseSigma(L: Float32Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let s = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    s += Math.abs(L[i - w - 1] - 2 * L[i - w] + L[i - w + 1] - 2 * L[i - 1] + 4 * L[i] - 2 * L[i + 1] + L[i + w - 1] - 2 * L[i + w] + L[i + w + 1]);
  }
  return (Math.sqrt(Math.PI / 2) * s) / (6 * (w - 2) * (h - 2));
}
/** Measured-noise clean-up: an edge-keeping average of brightness tuned to the noise found, and a softer blur of the colour noise. */
function denoise(im: Planes, amount: number, colour: number): void {
  const { w, h } = im, n = w * h, Y = lumaPlane(im), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) { Cb[i] = im.b[i] - Y[i]; Cr[i] = im.r[i] - Y[i]; }
  let Y2 = Y;
  if (amount > 0) {
    const sr = Math.max(0.004, noiseSigma(Y, w, h)) * (1 + (amount / 100) * 2.5), inv = 1 / (2 * sr * sr);
    Y2 = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, v = Y[i];
      let acc = 0, ws = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = clamp(x + dx, 0, w - 1), yy = clamp(y + dy, 0, h - 1), u = Y[yy * w + xx], d = u - v;
        const wt = Math.exp(-(dx * dx + dy * dy) / 4.5 - d * d * inv);
        acc += wt * u; ws += wt;
      }
      Y2[i] = acc / ws;
    }
  }
  const sc = colour > 0 ? 0.5 + (colour / 100) * 3 : 0, Cb2 = sc ? gauss(Cb, w, h, sc) : Cb, Cr2 = sc ? gauss(Cr, w, h, sc) : Cr;
  for (let i = 0; i < n; i++) {
    const r = Y2[i] + Cr2[i], b = Y2[i] + Cb2[i];
    im.r[i] = r; im.b[i] = b; im.g[i] = (Y2[i] - 0.2126 * r - 0.0722 * b) / 0.7152;
  }
}
/** Capture sharpening: a few rounds of Richardson-Lucy deconvolution of brightness with a round blur of `sigma` pixels. */
export function deconvolve(L: Float32Array, w: number, h: number, sigma: number, rounds: number): Float32Array {
  let u = L.slice();
  for (let k = 0; k < rounds; k++) {
    const est = gauss(u, w, h, sigma), ratio = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) ratio[i] = L[i] / Math.max(1e-4, est[i]);
    const corr = gauss(ratio, w, h, sigma), next = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) next[i] = clamp(u[i] * corr[i], 0, 1.5);
    u = next;
  }
  return u;
}

// ---------- colour ----------
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
}
export function hsl2rgb(hh: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((((hh / 60) % 2) + 2) % 2 - 1)), m = l - c / 2, k = Math.floor((((hh % 360) + 360) % 360) / 60);
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
  return [r + m, g + m, b + m];
}
/** The colour mixer's eight bands by hue: red, orange, yellow, green, aqua, blue, purple, magenta. */
export const BANDS = [0, 30, 60, 120, 180, 240, 270, 300];
/** How much each band owns a hue: the two nearest band centres share it, linearly. */
export function bandWeights(hue: number): number[] {
  const w = new Array(8).fill(0), hh = ((hue % 360) + 360) % 360;
  for (let k = 0; k < 8; k++) {
    const a = BANDS[k], b = k === 7 ? 360 : BANDS[k + 1];
    if (hh >= a && hh < b) { const t = (hh - a) / (b - a); w[k] = 1 - t; w[(k + 1) % 8] += t; break; }
  }
  return w;
}
function colourMixer(im: Planes, p: P): void {
  const H = BANDS.map((_, k) => num(p, 'mH' + k, 0)), S = BANDS.map((_, k) => num(p, 'mS' + k, 0)), Lg = BANDS.map((_, k) => num(p, 'mL' + k, 0));
  for (let i = 0; i < im.r.length; i++) {
    const [hh, s, l] = rgb2hsl(clamp(im.r[i], 0, 1), clamp(im.g[i], 0, 1), clamp(im.b[i], 0, 1));
    if (s < 1e-6) continue;
    const w = bandWeights(hh);
    let dh = 0, ds = 0, dl = 0;
    for (let k = 0; k < 8; k++) if (w[k]) { dh += w[k] * H[k]; ds += w[k] * S[k]; dl += w[k] * Lg[k]; }
    if (!dh && !ds && !dl) continue;
    const [r, g, b] = hsl2rgb(hh + (dh / 100) * 30, clamp(s * (1 + ds / 100), 0, 1), clamp(l + (dl / 100) * 0.5 * s * (dl > 0 ? 1 - l : l) * 2, 0, 1));
    im.r[i] = r; im.g[i] = g; im.b[i] = b;
  }
}
/** Colour grading: a colour for the darks, the middle tones and the lights, each mixed in by its amount; brightness stays. */
function colourGrading(im: Planes, p: P): void {
  const zones = ['gS', 'gM', 'gH'].map((z) => {
    const [r, g, b] = hsl2rgb(num(p, z + 'h', 0), 1, 0.5), y = lum(r, g, b), a = (num(p, z + 'a', 0) / 100) * 0.25;
    return [(r - y) * a, (g - y) * a, (b - y) * a];
  });
  const bal = num(p, 'gBal', 0) / 200;
  for (let i = 0; i < im.r.length; i++) {
    const L = clamp(lum(im.r[i], im.g[i], im.b[i]) + bal, 0, 1), ws = (1 - L) ** 2, wh = L * L, wm = 1 - ws - wh;
    const w = [ws, wm, wh];
    for (let z = 0; z < 3; z++) { im.r[i] += w[z] * zones[z][0]; im.g[i] += w[z] * zones[z][1]; im.b[i] += w[z] * zones[z][2]; }
  }
}

// ---------- effects ----------
/** Post-crop vignette: how far a point is from the box centre on a shape between the box's own oval (0), a circle (100) and a rounded box (-100). */
export function vignetteWeight(x: number, y: number, w: number, h: number, mid: number, round: number, feather: number): number {
  const hw = Math.max(1, w / 2), hh = Math.max(1, h / 2), R = Math.sqrt(hw * hh), rho = clamp(round, -100, 100) / 100;
  const ax = rho > 0 ? hw + (R - hw) * rho : hw, ay = rho > 0 ? hh + (R - hh) * rho : hh, n = rho < 0 ? 2 - rho * 6 : 2;
  const dx = Math.abs(x + 0.5 - hw) / ax, dy = Math.abs(y + 0.5 - hh) / ay, d = Math.pow(dx ** n + dy ** n, 1 / n);
  const d0 = 0.3 + (clamp(mid, 0, 100) / 100) * 1, wd = 0.05 + (clamp(feather, 0, 100) / 100) * 1;
  return smoothstep(d0, d0 + wd, d);
}
function vignette(im: Planes, p: P): void {
  const a = clamp(num(p, 'vig', 0), -100, 100) / 100, mid = num(p, 'vMid', 50), rd = num(p, 'vRound', 0), fe = num(p, 'vFea', 50), cs = chans(im);
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const wgt = vignetteWeight(x, y, im.w, im.h, mid, rd, fe), i = y * im.w + x;
    if (!wgt) continue;
    for (const c of cs) c[i] = a < 0 ? enc(lin(clamp(c[i], 0, 1)) * (1 + a * wgt)) : c[i] + (1 - c[i]) * a * wgt;
  }
}

/** Every develop setting and its resting value: a stage runs only when one of its settings has moved. */
export const DEVELOP_REST: Readonly<Record<string, number>> = {
  hot: 0, hotT: 40, neg: 0, fish: 0, fov: 180, up: 0, ang: 0, wbT: 6500, wbTint: 0, wbPick: 0, gx: 50, gy: 50, bp: 0, wp: 255, base: 0, hl: 0, sh: 0,
  teB: 0, teS: 0, teM: 0, teH: 0, teW: 0, haze: 0, clvF: 0, clvM: 0, clvL: 0, clar: 0, gSh: 30, gSa: 0, gMh: 30, gMa: 0, gHh: 30, gHa: 0, gBal: 0,
  dn: 0, dnC: 0, cs: 0, csR: 0.8, vig: 0, vMid: 50, vRound: 0, vFea: 50, clip: 0,
  ...Object.fromEntries(BANDS.flatMap((_, k) => [['mH' + k, 0], ['mS' + k, 0], ['mL' + k, 0]])),
};
const moved = (p: P, ...keys: string[]): boolean => keys.some((k) => num(p, k, DEVELOP_REST[k]) !== DEVELOP_REST[k]);

/** Runs the develop stages on planes in place; returns whether any stage ran. */
export function developPlanes(im: Planes, p: P): boolean {
  let ran = false;
  const step = (ok: boolean, f: () => void): void => { if (ok) { f(); ran = true; } };
  step(on(p, 'hot'), () => hotPixels(im, (clamp(num(p, 'hotT', 40), 5, 100) / 100) * 0.5));
  step(on(p, 'neg'), () => negative(im));
  step(on(p, 'fish'), () => defish(im, num(p, 'fov', 180)));
  const turn = (num(p, 'up', 0) ? estimateTilt(im) : 0) + num(p, 'ang', 0);
  step(Math.abs(turn) > 1e-3, () => rotateFill(im, turn));
  step(moved(p, 'wbT', 'wbTint') || on(p, 'wbPick'), () => whiteBalance(im, p));
  step(moved(p, 'bp', 'wp'), () => {
    const lo = num(p, 'bp', 0) / 255, span = Math.max(1 / 255, num(p, 'wp', 255) / 255 - lo);
    for (const c of chans(im)) for (let i = 0; i < c.length; i++) c[i] = (c[i] - lo) / span;
  });
  step(moved(p, 'base'), () => { const k = num(p, 'base', 0); for (const c of chans(im)) for (let i = 0; i < c.length; i++) c[i] = baseCurve(c[i], k); });
  step(moved(p, 'hl', 'sh'), () => highlightsShadows(im, num(p, 'hl', 0), num(p, 'sh', 0)));
  step(moved(p, 'teB', 'teS', 'teM', 'teH', 'teW'), () => toneEqualizer(im, ['teB', 'teS', 'teM', 'teH', 'teW'].map((k) => num(p, k, 0))));
  step(moved(p, 'haze'), () => dehaze(im, num(p, 'haze', 0)));
  step(moved(p, 'clvF', 'clvM', 'clvL'), () => contrastLevels(im, num(p, 'clvF', 0), num(p, 'clvM', 0), num(p, 'clvL', 0)));
  step(moved(p, 'clar'), () => clarity(im, num(p, 'clar', 0)));
  step(moved(p, ...BANDS.flatMap((_, k) => ['mH' + k, 'mS' + k, 'mL' + k])), () => colourMixer(im, p));
  step(moved(p, 'gSa', 'gMa', 'gHa'), () => colourGrading(im, p));
  step(moved(p, 'dn', 'dnC'), () => denoise(im, num(p, 'dn', 0), num(p, 'dnC', 0)));
  step(moved(p, 'cs'), () => {
    const L = lumaPlane(im), L2 = deconvolve(L, im.w, im.h, clamp(num(p, 'csR', 0.8), 0.3, 3), Math.max(1, Math.round((num(p, 'cs', 0) / 100) * 10)));
    for (let i = 0; i < L.length; i++) { const k = L[i] > 1e-4 ? L2[i] / L[i] : 1; im.r[i] *= k; im.g[i] *= k; im.b[i] *= k; }
  });
  step(moved(p, 'vig'), () => vignette(im, p));
  return ran;
}

const develop: Fx = (src: Bitmap, p: P, b: Box) => {
  const W = src.width, d = src.data, n = b.w * b.h;
  const im: Planes = { w: b.w, h: b.h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = ((b.y + y) * W + b.x + x) * 4, j = y * b.w + x;
    im.r[j] = d[i] / 255; im.g[j] = d[i + 1] / 255; im.b[j] = d[i + 2] / 255;
  }
  const ran = developPlanes(im, p), clip = on(p, 'clip');
  const res = d.slice();
  if (!ran && !clip) return res;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = ((b.y + y) * W + b.x + x) * 4, j = y * b.w + x;
    let r = Math.round(clamp(im.r[j], 0, 1) * 255), g = Math.round(clamp(im.g[j], 0, 1) * 255), bl = Math.round(clamp(im.b[j], 0, 1) * 255);
    // The clipping warning paints burnt lights red and crushed darks blue; it is only ever shown, never applied.
    if (clip && d[i + 3]) { if (r >= 255 || g >= 255 || bl >= 255) { r = 255; g = 0; bl = 0; } else if (r <= 0 && g <= 0 && bl <= 0) { r = 0; g = 64; bl = 255; } }
    res[i] = r; res[i + 1] = g; res[i + 2] = bl;
  }
  return res;
};

/** The develop effect, by kind; core/fx's runEffect finds it here. */
export const RAW: Record<string, Fx> = { develop };
/** Runs the develop effect on a whole bitmap (tests and the scopes use it). */
export const runDevelop = (src: Bitmap, p: P): Uint8ClampedArray => develop(src, p, innerBox(src, p));
