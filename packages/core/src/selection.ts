// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Selections as masks. A Mask covers the whole picture, 0 (not selected) to 255 (selected), so every selection tool can
 * combine, grow, shrink and soften the same way; the document keeps the compact form (document.ts Selection: the bounding
 * box plus its alpha). Lasso, magic wand, quick select, colour range and the Select menu's changes all live here.
 */
import type { RGBA } from './color';
import type { Layer, Selection } from './document';
import type { Point, Rect } from './geometry';

export interface Mask { width: number; height: number; data: Uint8Array; }
/** Pixels to look at: RGBA, straight alpha, width * height * 4 bytes. */
export interface Pixels { width: number; height: number; data: Uint8ClampedArray; }
/** How a new selection meets the old one: replace it, add to it, take it away, or keep only the overlap. */
export type SelMode = 'new' | 'add' | 'subtract' | 'intersect';

export const emptyMask = (w: number, h: number): Mask => ({ width: w, height: h, data: new Uint8Array(w * h) });

export function maskFromSelection(sel: Selection | null, w: number, h: number): Mask {
  const m = emptyMask(w, h);
  if (!sel) return m;
  const x0 = Math.max(0, sel.x), y0 = Math.max(0, sel.y), x1 = Math.min(w, sel.x + sel.w), y1 = Math.min(h, sel.y + sel.h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m.data[y * w + x] = sel.alpha ? sel.alpha[(y - sel.y) * sel.w + (x - sel.x)] : 255;
  return m;
}
/** The smallest box holding every pixel at or above `min`. */
export function maskBounds(m: Mask, min = 1): Rect | null {
  let x0 = m.width, y0 = -1, x1 = -1, y1 = -1;
  for (let y = 0; y < m.height; y++) {
    const row = y * m.width;
    let a = -1, b = -1;
    for (let x = 0; x < m.width; x++) if (m.data[row + x] >= min) { if (a < 0) a = x; b = x; }
    if (a < 0) continue;
    if (y0 < 0) y0 = y;
    y1 = y;
    if (a < x0) x0 = a;
    if (b > x1) x1 = b;
  }
  return y0 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
/** The compact selection for a mask: its bounding box, with alpha only when the box is not fully selected. */
export function selectionFromMask(m: Mask): Selection | null {
  const b = maskBounds(m);
  if (!b) return null;
  const alpha = new Uint8Array(b.w * b.h);
  let full = true;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const v = m.data[(b.y + y) * m.width + b.x + x];
    alpha[y * b.w + x] = v;
    if (v !== 255) full = false;
  }
  return { ...b, alpha: full ? null : alpha };
}
export function combineMasks(base: Mask | null, m: Mask, mode: SelMode): Mask {
  if (!base || mode === 'new') return m;
  const out = emptyMask(m.width, m.height), a = base.data, b = m.data, o = out.data;
  for (let i = 0; i < o.length; i++) {
    o[i] = mode === 'add' ? Math.max(a[i], b[i]) : mode === 'subtract' ? (a[i] * (255 - b[i]) + 127) / 255 : (a[i] * b[i] + 127) / 255;
  }
  return out;
}
export function invertMask(m: Mask): Mask {
  const out = emptyMask(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) out.data[i] = 255 - m.data[i];
  return out;
}
/** Number of pixels at least half selected. */
export function countSelected(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i] >= 128) n++;
  return n;
}
/** A layer's pixels placed on a picture-sized sheet (see-through where the layer does not reach). */
export function layerOnCanvas(l: Layer, w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  const x0 = Math.max(0, l.x), y0 = Math.max(0, l.y), x1 = Math.min(w, l.x + l.width), y1 = Math.min(h, l.y + l.height);
  for (let y = y0; y < y1; y++) {
    const s = ((y - l.y) * l.width + (x0 - l.x)) * 4;
    if (x1 > x0) data.set(l.data.subarray(s, s + (x1 - x0) * 4), (y * w + x0) * 4);
  }
  return { width: w, height: h, data };
}

/** Fill a closed outline (picture pixels) with soft edges: four sub-rows per row and exact cover along each. Even-odd. */
export function polygonMask(w: number, h: number, pts: Point[]): Mask {
  const m = emptyMask(w, h);
  if (pts.length < 3) return m;
  const S = 4;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h, Math.ceil(maxY));
  const acc = new Float32Array(w + 1), xs: number[] = [];
  for (let y = y0; y < y1; y++) {
    acc.fill(0);
    let any = false;
    for (let s = 0; s < S; s++) {
      const sy = y + (s + 0.5) / S;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y <= sy) !== (b.y <= sy)) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.min(w, xs[k])), xb = Math.max(0, Math.min(w, xs[k + 1]));
        if (xb <= xa) continue;
        any = true;
        const ia = Math.floor(xa), ib = Math.floor(xb);
        if (ia === ib) { acc[ia] += xb - xa; continue; }
        acc[ia] += ia + 1 - xa;
        for (let x = ia + 1; x < ib; x++) acc[x] += 1;
        if (ib < w) acc[ib] += xb - ib;
      }
    }
    if (!any) continue;
    const row = y * w;
    for (let x = 0; x < w; x++) if (acc[x] > 0) m.data[row + x] = Math.min(255, Math.round((acc[x] / S) * 255));
  }
  return m;
}
/** Points around an oval that fits the box (for oval selections and shapes). */
export function ellipsePoints(r: Rect, n = 96): Point[] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, out: Point[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push({ x: cx + (Math.cos(a) * r.w) / 2, y: cy + (Math.sin(a) * r.h) / 2 }); }
  return out;
}

const pixelOf = (d: Uint8ClampedArray, i: number): RGBA => ({ r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] });
/** The largest difference in red, green, blue or see-through between a pixel and a colour. */
const diffTo = (d: Uint8ClampedArray, i: number, c: RGBA): number =>
  Math.max(Math.abs(d[i] - c.r), Math.abs(d[i + 1] - c.g), Math.abs(d[i + 2] - c.b), Math.abs(d[i + 3] - c.a));

/** Scanline flood fill: every pixel reachable from `seeds` through pixels where `ok` holds, written as 255 into `m`. */
export function floodInto(m: Mask, seeds: number[], ok: (p: number) => boolean): Mask {
  const w = m.width, h = m.height, seen = m.data, stack = seeds.slice();
  while (stack.length) {
    const p = stack.pop() as number;
    if (seen[p] === 255) continue;
    const py = (p / w) | 0, row = py * w;
    let l = p - row, r = l;
    while (l > 0 && seen[row + l - 1] !== 255 && ok(row + l - 1)) l--;
    while (r < w - 1 && seen[row + r + 1] !== 255 && ok(row + r + 1)) r++;
    for (let x = l; x <= r; x++) seen[row + x] = 255;
    for (const ny of [py - 1, py + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inSpan = false;
      for (let x = l; x <= r; x++) {
        const q = nrow + x, good = seen[q] !== 255 && ok(q);
        if (good && !inSpan) { stack.push(q); inSpan = true; } else if (!good) inSpan = false;
      }
    }
  }
  return m;
}
/** Magic wand: pixels within `tolerance` (0 to 255) of the clicked colour; only those touching it, or all over the picture. */
export function wandMask(src: Pixels, x: number, y: number, tolerance: number, contiguous = true): Mask {
  const { width: w, height: h, data } = src, m = emptyMask(w, h);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return m;
  const seed = pixelOf(data, (y * w + x) * 4), ok = (p: number): boolean => diffTo(data, p * 4, seed) <= tolerance;
  if (!contiguous) { for (let p = 0; p < w * h; p++) if (ok(p)) m.data[p] = 255; return m; }
  return floodInto(m, [y * w + x], ok);
}
/** The colours found in a selection, as a box in colour space widened by `tolerance`. */
function colourBox(src: Pixels, m: Mask, tolerance: number): { lo: number[]; hi: number[] } | null {
  const lo = [255, 255, 255, 255], hi = [0, 0, 0, 0];
  let any = false;
  for (let p = 0; p < m.data.length; p++) {
    if (m.data[p] < 128) continue;
    any = true;
    for (let c = 0; c < 4; c++) { const v = src.data[p * 4 + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
  }
  if (!any) return null;
  return { lo: lo.map((v) => v - tolerance), hi: hi.map((v) => v + tolerance) };
}
const inBox = (d: Uint8ClampedArray, p: number, b: { lo: number[]; hi: number[] }): boolean => {
  for (let c = 0; c < 4; c++) { const v = d[p * 4 + c]; if (v < b.lo[c] || v > b.hi[c]) return false; }
  return true;
};
/** Select > Grow: add the neighbouring pixels whose colour is close to the colours already selected. */
export function growMask(src: Pixels, m: Mask, tolerance: number): Mask {
  const box = colourBox(src, m, tolerance);
  if (!box) return m;
  const w = m.width, h = m.height, out: Mask = { width: w, height: h, data: m.data.slice() }, seeds: number[] = [];
  for (let p = 0; p < m.data.length; p++) {
    if (m.data[p] < 128) continue;
    out.data[p] = 255;
    const x = p % w, y = (p / w) | 0;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && m.data[q] < 128 && inBox(src.data, q, box)) seeds.push(q);
    }
  }
  return floodInto(out, seeds, (q) => inBox(src.data, q, box));
}
/** Select > Similar: every pixel in the picture whose colour is close to the colours already selected. */
export function similarMask(src: Pixels, m: Mask, tolerance: number): Mask {
  const box = colourBox(src, m, tolerance);
  if (!box) return m;
  const out: Mask = { width: m.width, height: m.height, data: m.data.slice() };
  for (let p = 0; p < out.data.length; p++) if (inBox(src.data, p, box)) out.data[p] = 255;
  return out;
}
/** Select > Colour range: pixels near `color` are fully selected, fading out until `fuzziness` (0 to 255). */
export function colorRangeMask(src: Pixels, color: RGBA, fuzziness: number): Mask {
  const m = emptyMask(src.width, src.height), d = src.data, f = Math.max(1, fuzziness), inner = f * 0.4;
  for (let p = 0; p < m.data.length; p++) {
    const i = p * 4, dr = d[i] - color.r, dg = d[i + 1] - color.g, db = d[i + 2] - color.b;
    const dist = Math.sqrt((dr * dr + dg * dg + db * db) / 3);
    m.data[p] = dist <= inner ? (d[i + 3] ? 255 : 0) : dist >= f ? 0 : Math.round(((f - dist) / (f - inner)) * (d[i + 3] ? 255 : 0));
  }
  return m;
}

// ---------- distances, for grow, shrink, border and outlines ----------
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
/** Squared distance (exact, Euclidean) from every pixel of a w × h grid to the nearest pixel where `inside` holds. */
export function distanceSquared(w: number, h: number, inside: (i: number) => boolean): Float64Array {
  const INF = 1e20, g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = inside(i) ? 0 : INF;
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  return g;
}
/** The mask's busy area grown by `pad` and kept on the picture, as a window to work in. */
function windowOf(m: Mask, pad: number): Rect | null {
  const b = maskBounds(m);
  if (!b) return null;
  const x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad), x1 = Math.min(m.width, b.x + b.w + pad), y1 = Math.min(m.height, b.y + b.h + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** Select > Modify > Expand: grow the selection by `r` pixels, with a soft one-pixel edge. */
export function expandMask(m: Mask, r: number): Mask {
  const win = windowOf(m, Math.ceil(r) + 2);
  if (!win || r <= 0) return m;
  const out: Mask = { width: m.width, height: m.height, data: m.data.slice() };
  const d2 = distanceSquared(win.w, win.h, (i) => m.data[(win.y + ((i / win.w) | 0)) * m.width + win.x + (i % win.w)] >= 128);
  for (let i = 0; i < d2.length; i++) {
    const p = (win.y + ((i / win.w) | 0)) * m.width + win.x + (i % win.w), v = Math.round(Math.min(1, Math.max(0, r + 1 - Math.sqrt(d2[i]))) * 255);
    if (v > out.data[p]) out.data[p] = v;
  }
  return out;
}
/** Select > Modify > Contract: shrink the selection by `r` pixels. The picture's own edge does not count as an edge. */
export function contractMask(m: Mask, r: number): Mask {
  const win = windowOf(m, 2);
  if (!win || r <= 0) return m;
  const out: Mask = { width: m.width, height: m.height, data: m.data.slice() };
  const d2 = distanceSquared(win.w, win.h, (i) => m.data[(win.y + ((i / win.w) | 0)) * m.width + win.x + (i % win.w)] < 128);
  for (let i = 0; i < d2.length; i++) {
    const p = (win.y + ((i / win.w) | 0)) * m.width + win.x + (i % win.w), keep = Math.min(1, Math.max(0, Math.sqrt(d2[i]) - r));
    out.data[p] = Math.round(out.data[p] * keep);
  }
  return out;
}
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const inv = 1 / (2 * r + 1), n = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 1 : w;
  for (let ln = 0; ln < lines; ln++) {
    const o = horizontal ? ln * w : ln;
    let acc = 0;
    for (let k = 0; k <= Math.min(r, n - 1); k++) acc += src[o + k * step];
    for (let k = 0; k < n; k++) {
      dst[o + k * step] = acc * inv;
      const a = k + r + 1, b = k - r;
      if (a < n) acc += src[o + a * step];
      if (b >= 0) acc -= src[o + b * step];
    }
  }
}
/** Box sizes whose three passes approximate a Gaussian blur of the given sigma. */
function gaussBoxes(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2, mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4), mm = Math.round(mIdeal);
  return Array.from({ length: n }, (_, i) => ((i < mm ? wl : wu) - 1) / 2);
}
/** Blur one plane in place (three box passes each way), treating outside the plane as 0. */
export function blurPlane(plane: Float32Array, w: number, h: number, sigma: number): void {
  if (sigma <= 0) return;
  const tmp = new Float32Array(plane.length);
  for (const r of gaussBoxes(sigma)) { if (r < 1) continue; boxPass(plane, tmp, w, h, r, true); boxPass(tmp, plane, w, h, r, false); }
}
/** Select > Modify > Feather: soften the edge so changes fade out over about `r` pixels. */
export function featherMask(m: Mask, r: number): Mask {
  const pad = Math.ceil(r * 2) + 2, win = windowOf(m, pad);
  if (!win || r <= 0) return m;
  const plane = new Float32Array(win.w * win.h);
  for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) plane[y * win.w + x] = m.data[(win.y + y) * m.width + win.x + x];
  blurPlane(plane, win.w, win.h, r / 2);
  const out: Mask = { width: m.width, height: m.height, data: m.data.slice() };
  for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) out.data[(win.y + y) * m.width + win.x + x] = Math.round(Math.min(255, plane[y * win.w + x]));
  return out;
}
/** Select > Modify > Border: a soft band `width` pixels wide along the selection's edge. */
export function borderMask(m: Mask, width: number): Mask {
  const half = Math.max(0.5, width / 2), grown = expandMask(m, half), shrunk = contractMask(m, half), out = emptyMask(m.width, m.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.round((grown.data[i] * (255 - shrunk.data[i])) / 255);
  return featherMask(out, 1);
}
/** Select > Modify > Smooth: round off sharp corners and drop specks smaller than about `r` pixels. */
export function smoothMask(m: Mask, r: number): Mask {
  const win = windowOf(m, Math.ceil(r) * 2 + 2);
  if (!win || r <= 0) return m;
  const plane = new Float32Array(win.w * win.h);
  for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) plane[y * win.w + x] = m.data[(win.y + y) * m.width + win.x + x];
  blurPlane(plane, win.w, win.h, r / 1.5);
  const out = emptyMask(m.width, m.height);
  for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) {
    const v = plane[y * win.w + x];
    out.data[(win.y + y) * m.width + win.x + x] = v >= 160 ? 255 : v <= 96 ? 0 : Math.round(((v - 96) / 64) * 255);
  }
  return out;
}

/** Quick selection: paint over an area and the selection spreads to neighbouring pixels of similar colour, stopping at edges. */
export function quickSelectMask(src: Pixels, pts: Point[], radius: number): Mask {
  const { width: w, height: h, data } = src, m = emptyMask(w, h);
  if (!pts.length) return m;
  const r = Math.max(1, radius), seeds: number[] = [];
  let sr = 0, sg = 0, sb = 0, n = 0, bx0 = w, by0 = h, bx1 = 0, by1 = 0;
  const dab = (cx: number, cy: number): void => {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
        const p = y * w + x;
        if (m.data[p]) continue;
        m.data[p] = 1;
        seeds.push(p);
        sr += data[p * 4]; sg += data[p * 4 + 1]; sb += data[p * 4 + 2]; n++;
      }
    }
    bx0 = Math.min(bx0, cx); by0 = Math.min(by0, cy); bx1 = Math.max(bx1, cx); by1 = Math.max(by1, cy);
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1] ?? a, len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(len / (r / 2)));
    for (let s = 0; s < steps; s++) dab(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
    if (i === pts.length - 1) dab(a.x, a.y);
  }
  if (!n) return m;
  const mr = sr / n, mg = sg / n, mb = sb / n;
  let vr = 0;
  for (const p of seeds) vr += ((data[p * 4] - mr) ** 2 + (data[p * 4 + 1] - mg) ** 2 + (data[p * 4 + 2] - mb) ** 2) / 3;
  const thr = Math.min(64, Math.max(20, 2.5 * Math.sqrt(vr / n) + 14)), reach = r * 8;
  const lx = bx0 - reach, ly = by0 - reach, hx = bx1 + reach, hy = by1 + reach;
  const edge = (p: number): number => {
    const x = p % w, y = (p / w) | 0, i = p * 4;
    let e = 0;
    for (const q of [x > 0 ? p - 1 : p, x < w - 1 ? p + 1 : p, y > 0 ? p - w : p, y < h - 1 ? p + w : p]) {
      const j = q * 4;
      e = Math.max(e, Math.abs(data[i] - data[j]), Math.abs(data[i + 1] - data[j + 1]), Math.abs(data[i + 2] - data[j + 2]));
    }
    return e;
  };
  for (const p of seeds) m.data[p] = 0;
  return floodInto(m, seeds, (p) => {
    const x = p % w, y = (p / w) | 0;
    if (x < lx || x > hx || y < ly || y > hy) return false;
    const i = p * 4, dist = Math.sqrt(((data[i] - mr) ** 2 + (data[i + 1] - mg) ** 2 + (data[i + 2] - mb) ** 2) / 3);
    return dist <= thr && (dist <= thr * 0.5 || edge(p) < 56);
  });
}

/** The line between selected and unselected pixels (alpha 128 and up counts as selected), as segments x0 y0 x1 y1 in picture pixels. */
export function selectionOutline(sel: Selection): Float32Array {
  const { x: ox, y: oy, w, h } = sel, a = sel.alpha;
  if (!a) return new Float32Array([ox, oy, ox + w, oy, ox + w, oy, ox + w, oy + h, ox + w, oy + h, ox, oy + h, ox, oy + h, ox, oy]);
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && a[y * w + x] >= 128;
  const segs: number[] = [];
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const e = x < w && on(x, y - 1) !== on(x, y);
      if (e && start < 0) start = x;
      if (!e && start >= 0) { segs.push(ox + start, oy + y, ox + x, oy + y); start = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const e = y < h && on(x - 1, y) !== on(x, y);
      if (e && start < 0) start = y;
      if (!e && start >= 0) { segs.push(ox + x, oy + start, ox + x, oy + y); start = -1; }
    }
  }
  return new Float32Array(segs);
}
