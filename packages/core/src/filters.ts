// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Filters. Gaussian blur is three box blurs (a standard close approximation) on premultiplied pixels, so
 * transparent areas never bleed dark edges. Sharpen is an unsharp mask built on that blur.
 */
import type { Bitmap } from './document';

/** Box widths whose three passes approximate a Gaussian of the given sigma. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}
export function boxH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const n = 2 * r + 1, last = w - 1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + Math.min(last, Math.max(0, k)) * 4 + c];
      for (let x = 0; x < w; x++) {
        dst[row + x * 4 + c] = acc / n;
        acc += src[row + Math.min(last, x + r + 1) * 4 + c] - src[row + Math.max(0, x - r) * 4 + c];
      }
    }
  }
}
export function boxV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const n = 2 * r + 1, last = h - 1, stride = w * 4;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      const col = x * 4 + c;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[Math.min(last, Math.max(0, k)) * stride + col];
      for (let y = 0; y < h; y++) {
        dst[y * stride + col] = acc / n;
        acc += src[Math.min(last, y + r + 1) * stride + col] - src[Math.max(0, y - r) * stride + col];
      }
    }
  }
}
/** Gaussian blur; `radius` is the blur's sigma in pixels. Returns new pixels of the same size. */
export function gaussianBlur(src: Bitmap, radius: number): Uint8ClampedArray {
  const { width: w, height: h, data } = src;
  const n = w * h * 4;
  if (!(radius > 0.2) || !w || !h) return data.slice();
  const a = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i += 4) {
    const al = data[i + 3];
    a[i] = (data[i] * al) / 255; a[i + 1] = (data[i + 1] * al) / 255; a[i + 2] = (data[i + 2] * al) / 255; a[i + 3] = al;
  }
  for (const size of boxesForGauss(radius, 3)) {
    const r = (size - 1) >> 1;
    if (r < 1) continue;
    boxH(a, b, w, h, r);
    boxV(b, a, w, h, r);
  }
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i += 4) {
    const al = a[i + 3];
    if (!al) continue;
    out[i] = (a[i] * 255) / al; out[i + 1] = (a[i + 1] * 255) / al; out[i + 2] = (a[i + 2] * 255) / al; out[i + 3] = al;
  }
  return out;
}
/** Unsharp mask: pushes each pixel away from its blurred neighbourhood. `amount` 0..5, `threshold` 0..255. */
export function sharpen(src: Bitmap, amount = 1, radius = 1, threshold = 0): Uint8ClampedArray {
  const blurred = gaussianBlur(src, radius), d = src.data, out = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = d[i + c], diff = v - blurred[i + c];
      out[i + c] = Math.abs(diff) < threshold ? v : v + amount * diff;
    }
    out[i + 3] = d[i + 3];
  }
  return out;
}
