// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Bending a layer (13 Nov 2026): a 4 × 4 grid of handles, a flat surface re-angled by its four corners, pins, and a cage.
 * They run as filters (the editor's worker loads them with the other families on first use), so the dialog previews
 * them live while handles move and Apply keeps the result as one undo step.
 *
 * Every handle is a percentage of the edited box (0 is the left or top pixel, 100 the right or bottom one), so the
 * small preview and the full-size Apply agree. Content can move inside the box only; what a bend uncovers turns
 * see-through. All maths here is written for this project:
 * - the grid is the bicubic surface through its 16 points (Lagrange form), so each handle moves that exact point;
 * - pins use moving least squares (Schaefer, McPhail and Warren, 2006), rigid or similar, drawn through a fine
 *   triangle mesh so every pin lands exactly where it was dragged;
 * - the cage uses mean value coordinates (Floater, 2003) against the moved cage, read back into the drawn one.
 */
import type { Bitmap } from './document';
import { homography, invert3, type Quad } from './transform';
import { clamp, premul, unpremul, type Box, type Fx, type P } from './fx/lib';

type Pt = [number, number];
const num = (p: P, k: string, d: number): number => { const v = p[k]; return typeof v === 'number' && Number.isFinite(v) ? v : d; };
/** A handle setting (percent of the box) as a picture position. */
export const atPct = (b: Box, px: number, py: number): Pt => [b.x + (px / 100) * Math.max(0, b.w - 1), b.y + (py / 100) * Math.max(0, b.h - 1)];

/** Bilinear read of premultiplied pixels where everything outside the box counts as see-through (no smeared edges). */
export function sampleClear(pm: Float32Array, W: number, b: Box, x: number, y: number, out: Float32Array): void {
  out[0] = out[1] = out[2] = out[3] = 0;
  if (!(x > b.x - 1 && y > b.y - 1 && x < b.x + b.w && y < b.y + b.h)) return;
  const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
  for (let k = 0; k < 4; k++) {
    const px = fx + (k & 1), py = fy + (k >> 1);
    if (px < b.x || py < b.y || px >= b.x + b.w || py >= b.y + b.h) continue;
    const w = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty), i = (py * W + px) * 4;
    out[0] += pm[i] * w; out[1] += pm[i + 1] * w; out[2] += pm[i + 2] * w; out[3] += pm[i + 3] * w;
  }
}
/** Straight colour back, with every pixel outside the box kept exactly as it was. */
function finish(src: Bitmap, b: Box, out: Float32Array): Uint8ClampedArray {
  const res = unpremul(out), d = src.data, W = src.width;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < W; x++) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
    const i = (y * W + x) * 4;
    res[i] = d[i]; res[i + 1] = d[i + 1]; res[i + 2] = d[i + 2]; res[i + 3] = d[i + 3];
  }
  return res;
}
/** For every pixel of the box, `from` names where its colour comes from (null keeps the pixel as it was). */
export function pullDraw(src: Bitmap, b: Box, from: (x: number, y: number) => Pt | null | 'clear'): Uint8ClampedArray {
  const W = src.width, pm = premul(src), out = pm.slice(), px = new Float32Array(4);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const s = from(x, y), i = (y * W + x) * 4;
    if (s === null) continue;
    if (s === 'clear') { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
    sampleClear(pm, W, b, s[0], s[1], px);
    out.set(px, i);
  }
  return finish(src, b, out);
}
/**
 * Draws the box through a forward map: an n × n grid of cells over the box, each corner moved by `to`, each triangle
 * filled through its own inverse (barycentric) map. Pixels no triangle covers come out see-through.
 */
export function meshDraw(src: Bitmap, b: Box, to: (x: number, y: number) => Pt, n = 32): Uint8ClampedArray {
  const W = src.width, pm = premul(src), out = pm.slice(), px = new Float32Array(4);
  for (let y = b.y; y < b.y + b.h; y++) out.fill(0, (y * W + b.x) * 4, (y * W + b.x + b.w) * 4);
  const cols = Math.max(1, Math.min(n, b.w - 1)), rows = Math.max(1, Math.min(n, b.h - 1)), sx: number[] = [], sy: number[] = [], dx: number[] = [], dy: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const x = b.x + (Math.max(0, b.w - 1) * i) / cols, y = b.y + (Math.max(0, b.h - 1) * j) / rows, d = to(x, y);
    sx.push(x); sy.push(y); dx.push(d[0]); dy.push(d[1]);
  }
  const tri = (a: number, c: number, e: number): void => {
    const x0 = dx[a], y0 = dy[a], x1 = dx[c], y1 = dy[c], x2 = dx[e], y2 = dy[e], den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-9) return;
    const lo = Math.max(b.x, Math.floor(Math.min(x0, x1, x2))), hi = Math.min(b.x + b.w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const top = Math.max(b.y, Math.floor(Math.min(y0, y1, y2))), bot = Math.min(b.y + b.h - 1, Math.ceil(Math.max(y0, y1, y2))), e9 = -1e-7;
    for (let y = top; y <= bot; y++) for (let x = lo; x <= hi; x++) {
      const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den, l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den, l2 = 1 - l0 - l1;
      if (l0 < e9 || l1 < e9 || l2 < e9) continue;
      sampleClear(pm, W, b, l0 * sx[a] + l1 * sx[c] + l2 * sx[e], l0 * sy[a] + l1 * sy[c] + l2 * sy[e], px);
      out.set(px, (y * W + x) * 4);
    }
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, c = a + 1, e = a + cols + 1, f = e + 1;
    tri(a, c, f); tri(a, f, e);
  }
  return finish(src, b, out);
}

// ---------- the 4 × 4 grid ----------
/** The cubic through four evenly spaced points (Lagrange weights at t in 0..1, nodes 0, 1/3, 2/3, 1). */
export function lagrange4(t: number): [number, number, number, number] {
  const a = 3 * t, l = [0, 1, 2, 3].map((k) => [0, 1, 2, 3].reduce((m, j) => (j === k ? m : (m * (a - j)) / (k - j)), 1));
  return l as [number, number, number, number];
}
/** The 16 grid points (g0..g15, row by row, x and y in percent); missing ones sit evenly over the box. */
export function gridOf(p: P): Pt[] {
  const g: Pt[] = [];
  for (let k = 0; k < 16; k++) g.push([num(p, `g${k}x`, ((k % 4) * 100) / 3), num(p, `g${k}y`, (Math.floor(k / 4) * 100) / 3)]);
  return g;
}
/** Where the grid surface puts the point (u, v) of the box (0..1 each), in percent: the surface passes through every handle. */
export function gridAt(g: readonly Pt[], u: number, v: number): Pt {
  const lu = lagrange4(u), lv = lagrange4(v);
  let x = 0, y = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const w = lu[i] * lv[j]; x += w * g[j * 4 + i][0]; y += w * g[j * 4 + i][1]; }
  return [x, y];
}
const meshWarp: Fx = (src, p, b) => {
  const g = gridOf(p), sw = Math.max(1, b.w - 1), sh = Math.max(1, b.h - 1);
  return meshDraw(src, b, (x, y) => { const q = gridAt(g, (x - b.x) / sw, (y - b.y) / sh); return atPct(b, q[0], q[1]); });
};

// ---------- a flat surface re-angled by its corners ----------
const quadOf = (p: P, k: string, b: Box, d: readonly Pt[]): Quad =>
  d.map((c, i) => { const [x, y] = atPct(b, num(p, `${k}${i}x`, c[0]), num(p, `${k}${i}y`, c[1])); return { x, y }; }) as Quad;
/** The plane's corners where the dialog starts them: an inset rectangle, clockwise from the top left. */
export const PLANE: readonly Pt[] = [[25, 25], [75, 25], [75, 75], [25, 75]];
const perspectiveWarp: Fx = (src, p, b) => {
  const m = homography(quadOf(p, 'a', b, PLANE), quadOf(p, 'b', b, PLANE)), inv = m && invert3(m);
  if (!inv) return src.data.slice();
  return pullDraw(src, b, (x, y) => {
    const w = inv[6] * x + inv[7] * y + inv[8];
    return Math.abs(w) < 1e-9 ? 'clear' : [(inv[0] * x + inv[1] * y + inv[2]) / w, (inv[3] * x + inv[4] * y + inv[5]) / w];
  });
};

// ---------- pins: moving least squares ----------
/**
 * Where a point goes when pins at `from` are dragged to `to` (moving least squares). `rigid` keeps every part's size;
 * otherwise parts may also grow or shrink evenly. One pin moves everything along; a point on a pin lands on its target.
 */
export function mls(from: readonly Pt[], to: readonly Pt[], x: number, y: number, rigid = true): Pt {
  const n = from.length;
  if (!n) return [x, y];
  let sw = 0, px = 0, py = 0, qx = 0, qy = 0;
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const d2 = (from[i][0] - x) ** 2 + (from[i][1] - y) ** 2;
    if (d2 < 1e-12) return [to[i][0], to[i][1]];
    w.push(1 / d2); sw += w[i];
    px += w[i] * from[i][0]; py += w[i] * from[i][1]; qx += w[i] * to[i][0]; qy += w[i] * to[i][1];
  }
  px /= sw; py /= sw; qx /= sw; qy /= sw;
  let cr = 0, ci = 0, mu = 0;
  for (let i = 0; i < n; i++) {
    const ax = from[i][0] - px, ay = from[i][1] - py, bx = to[i][0] - qx, by = to[i][1] - qy;
    cr += w[i] * (ax * bx + ay * by); ci += w[i] * (ax * by - ay * bx); mu += w[i] * (ax * ax + ay * ay);
  }
  const len = Math.hypot(cr, ci), k = rigid ? (len > 1e-12 ? 1 / len : 0) : mu > 1e-12 ? 1 / mu : 0;
  let rr = cr * k, ri = ci * k;
  if (rigid && len <= 1e-12) { rr = 1; ri = 0; }
  if (!rigid && mu <= 1e-12) { rr = 1; ri = 0; }
  const vx = x - px, vy = y - py;
  return [vx * rr - vy * ri + qx, vx * ri + vy * rr + qy];
}
/** The pins (p0..: where each was put, q0..: where it was dragged), in percent. */
export function pinsOf(p: P): { from: Pt[]; to: Pt[] } {
  const from: Pt[] = [], to: Pt[] = [], n = clamp(Math.round(num(p, 'n', 0)), 0, 24);
  for (let i = 0; i < n; i++) {
    const a: Pt = [num(p, `p${i}x`, 50), num(p, `p${i}y`, 50)];
    from.push(a); to.push([num(p, `q${i}x`, a[0]), num(p, `q${i}y`, a[1])]);
  }
  return { from, to };
}
const pinWarp: Fx = (src, p, b) => {
  const { from, to } = pinsOf(p), rigid = num(p, 'style', 0) === 0;
  const f = from.map((c) => atPct(b, c[0], c[1])), t = to.map((c) => atPct(b, c[0], c[1]));
  return meshDraw(src, b, (x, y) => mls(f, t, x, y, rigid), 48);
};

// ---------- the cage: mean value coordinates ----------
export function insidePoly(poly: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Mean value coordinates of (x, y) against a polygon: weights that sum to 1 and rebuild the point from the corners. */
export function meanValue(poly: readonly Pt[], x: number, y: number): number[] {
  const n = poly.length, s = poly.map(([px, py]) => [px - x, py - y]), r = s.map(([a, c]) => Math.hypot(a, c)), t: number[] = [];
  for (let i = 0; i < n; i++) if (r[i] < 1e-12) return poly.map((_, k) => (k === i ? 1 : 0));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, A = s[i][0] * s[j][1] - s[i][1] * s[j][0], D = s[i][0] * s[j][0] + s[i][1] * s[j][1];
    if (Math.abs(A) < 1e-12 && D < 0) { // on the edge from i to j: plain interpolation along it
      const w = poly.map(() => 0);
      w[i] = r[j] / (r[i] + r[j]); w[j] = r[i] / (r[i] + r[j]);
      return w;
    }
    t.push(Math.abs(A) < 1e-12 ? 0 : (r[i] * r[j] - D) / A);
  }
  const w = poly.map((_, i) => (t[(i + n - 1) % n] + t[i]) / r[i]), sum = w.reduce((a, c) => a + c, 0);
  return w.map((v) => v / sum);
}
/** The cage as drawn (o0..) and as moved (c0..), in percent; it starts as eight points round the middle of the box. */
export function cageOf(p: P): { drawn: Pt[]; moved: Pt[] } {
  const n = clamp(Math.round(num(p, 'n', 8)), 3, 24), drawn: Pt[] = [], moved: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2, o: Pt = [num(p, `o${i}x`, 50 + 30 * Math.cos(a)), num(p, `o${i}y`, 50 + 30 * Math.sin(a))];
    drawn.push(o); moved.push([num(p, `c${i}x`, o[0]), num(p, `c${i}y`, o[1])]);
  }
  return { drawn, moved };
}
const cageWarp: Fx = (src, p, b) => {
  const c = cageOf(p), o = c.drawn.map((q) => atPct(b, q[0], q[1])), m = c.moved.map((q) => atPct(b, q[0], q[1]));
  return pullDraw(src, b, (x, y) => {
    if (insidePoly(m, x, y)) {
      const w = meanValue(m, x, y);
      let sx = 0, sy = 0;
      for (let i = 0; i < w.length; i++) { sx += w[i] * o[i][0]; sy += w[i] * o[i][1]; }
      return [sx, sy];
    }
    return insidePoly(o, x, y) ? 'clear' : null;
  });
};

export const WARPS = { 'mesh-warp': meshWarp, 'perspective-warp': perspectiveWarp, 'pin-warp': pinWarp, 'cage-warp': cageWarp };
export const WARP_KINDS = Object.keys(WARPS) as (keyof typeof WARPS)[];
