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
import { clamp, luma, premul, unpremul, type Box, type Fx, type P } from './fx/lib';

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

// ---------- Push pixels like liquid (Liquify) ----------
/**
 * Liquify keeps one field of moves at the preview's size, read backwards: the picture at p shows the source at p + d(p).
 * Each brush dab composes a small move into the field, so strokes build on each other, and Undo the push eases the field
 * back to zero. Apply scales the field up to the layer and reads the layer once, with its edges clamped (no holes).
 */
export interface Field { w: number; h: number; dx: Float32Array; dy: Float32Array; }
export const LIQUIFY_TOOLS = ['push', 'pucker', 'bloat', 'twirl', 'restore'] as const;
export type LiquifyTool = (typeof LIQUIFY_TOOLS)[number];
export const newField = (w: number, h: number): Field => ({ w, h, dx: new Float32Array(w * h), dy: new Float32Array(w * h) });
/** The field at a fractional position (bilinear; outside it, the nearest edge). */
export function fieldAt(f: Field, x: number, y: number): Pt {
  const cx = clamp(x, 0, f.w - 1), cy = clamp(y, 0, f.h - 1), x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(f.w - 1, x0 + 1), y1 = Math.min(f.h - 1, y0 + 1), tx = cx - x0, ty = cy - y0;
  const a = y0 * f.w + x0, b = y0 * f.w + x1, c = y1 * f.w + x0, e = y1 * f.w + x1;
  const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, we = tx * ty;
  return [f.dx[a] * wa + f.dx[b] * wb + f.dx[c] * wc + f.dx[e] * we, f.dy[a] * wa + f.dy[b] * wb + f.dy[c] * wc + f.dy[e] * we];
}
/** How strongly a dab of radius R and strength s acts at squared distance r2 from its centre: s·(1 − r²/R²)². */
export const falloff = (r2: number, R: number, s: number): number => (r2 >= R * R ? 0 : s * (1 - r2 / (R * R)) ** 2);
/**
 * One dab at (cx, cy) with radius R and strength s: every point p it covers now reads from q, so d(p) = (q − p) + d_old(q).
 * Push drags along (vx, vy); Grow (bloat) and Shrink (pucker) push out from or pull in to the centre; Twirl turns by up to
 * `turn` radians; Undo the push eases the field back towards the untouched picture.
 */
export function liquifyDab(f: Field, tool: LiquifyTool, cx: number, cy: number, R: number, s: number, vx = 0, vy = 0, turn = 0.35): void {
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(f.w - 1, Math.ceil(cx + R)), y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(f.h - 1, Math.ceil(cy + R));
  if (x0 > x1 || y0 > y1) return;
  const ow = x1 - x0 + 1, nx = new Float32Array(ow * (y1 - y0 + 1)), ny = new Float32Array(nx.length), hit = new Uint8Array(nx.length);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x - cx, py = y - cy, w = falloff(px * px + py * py, R, s), k = (y - y0) * ow + x - x0, i = y * f.w + x;
    if (w <= 0) continue;
    hit[k] = 1;
    if (tool === 'restore') { const keep = 1 - Math.min(1, w); nx[k] = f.dx[i] * keep; ny[k] = f.dy[i] * keep; continue; }
    let qx: number, qy: number;
    if (tool === 'push') { qx = x - w * vx; qy = y - w * vy; }
    else if (tool === 'bloat') { qx = x - px * w; qy = y - py * w; }
    else if (tool === 'pucker') { qx = x + px * w; qy = y + py * w; }
    else { const a = -turn * w, c = Math.cos(a), sn = Math.sin(a); qx = cx + c * px - sn * py; qy = cy + sn * px + c * py; }
    const [ox, oy] = fieldAt(f, qx, qy);
    nx[k] = qx - x + ox; ny[k] = qy - y + oy;
  }
  // Written after every read, so one dab only ever reads the field as it was before it.
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = (y - y0) * ow + x - x0;
    if (hit[k]) { f.dx[y * f.w + x] = nx[k]; f.dy[y * f.w + x] = ny[k]; }
  }
}
/** Bilinear read of premultiplied pixels with the position held inside the bitmap (edges smear instead of turning clear). */
function sampleEdge(pm: Float32Array, W: number, H: number, x: number, y: number, out: Float32Array, o: number): void {
  const cx = clamp(x, 0, W - 1), cy = clamp(y, 0, H - 1), x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = cx - x0, ty = cy - y0, a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, e = (y1 * W + x1) * 4;
  const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, we = tx * ty;
  for (let k = 0; k < 4; k++) out[o + k] = pm[a + k] * wa + pm[b + k] * wb + pm[c + k] * wc + pm[e + k] * we;
}
/** A bitmap drawn through a field of any size: the field and its moves are scaled to the bitmap, then read once. */
export function liquifyDraw(src: Bitmap, f: Field): Uint8ClampedArray {
  const W = src.width, H = src.height, sx = f.w / W, sy = f.h / H, pm = premul(src), out = new Float32Array(pm.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [dx, dy] = fieldAt(f, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
    sampleEdge(pm, W, H, x + dx / sx, y + dy / sy, out, (y * W + x) * 4);
  }
  return unpremul(out);
}

// ---------- Stretch without squashing people (content-aware scale) ----------
/**
 * Seam carving (Avidan and Shamir, 2007), written for this project: paths of plain pixels from top to bottom are taken out
 * to narrow a picture, or doubled to widen it, so busy parts such as faces keep their shape. The seams are found on a copy
 * of at most about 300,000 pixels, then the same choice is mapped onto every full-size pixel; height works on the picture
 * turned on its side. A protected box costs so much that no seam crosses it while another way exists.
 */
const CARVE_PX = 300_000;
/** For a w × h grid of brightness: how many times each cell is kept after `k` seams (0 or 1 when narrowing, 1 or 2 when widening). */
export function seamPlan(L: Float32Array, w: number, h: number, k: number, shrink: boolean, guard: Uint8Array | null = null): Uint8Array {
  const mult = new Uint8Array(w * h).fill(1), cols = Array.from({ length: h }, () => Int32Array.from({ length: w }, (_, i) => i));
  const cost = new Float64Array(w * h), from = new Int8Array(w * h);
  let n = w;
  for (let s = 0; s < Math.min(k, w - 1); s++) {
    for (let r = 0; r < h; r++) {
      const row = cols[r], up = cols[Math.max(0, r - 1)], dn = cols[Math.min(h - 1, r + 1)], o = r * w;
      for (let c = 0; c < n; c++) {
        let e = Math.abs(L[o + row[Math.min(n - 1, c + 1)]] - L[o + row[Math.max(0, c - 1)]])
          + Math.abs(L[Math.min(h - 1, r + 1) * w + dn[c]] - L[Math.max(0, r - 1) * w + up[c]]);
        if (guard && guard[o + row[c]]) e += 1e5;
        let best = 0;
        if (r) {
          const p = (r - 1) * w;
          let m = cost[p + c];
          if (c > 0 && cost[p + c - 1] < m) { m = cost[p + c - 1]; best = -1; }
          if (c < n - 1 && cost[p + c + 1] < m) { m = cost[p + c + 1]; best = 1; }
          e += m;
        }
        cost[o + c] = e; from[o + c] = best;
      }
    }
    let c = 0;
    for (let x = 1; x < n; x++) if (cost[(h - 1) * w + x] < cost[(h - 1) * w + c]) c = x;
    for (let r = h - 1; r >= 0; r--) {
      const row = cols[r];
      mult[r * w + row[c]] = shrink ? 0 : 2;
      row.copyWithin(c, c + 1, n);
      c += from[r * w + c];
      c = Math.max(0, Math.min(n - 1, c));
    }
    n--;
  }
  return mult;
}
/** Premultiplied pixels (w × h) narrowed or widened to tw columns along seams, each row resampled to exactly tw. */
function carveWidth(pm: Float32Array, w: number, h: number, tw: number, guard: Box | null): Float32Array {
  if (tw === w) return pm.slice();
  const s = Math.min(1, Math.sqrt(CARVE_PX / (w * h))), ws = Math.max(1, Math.round(w * s)), hs = Math.max(1, Math.round(h * s));
  const L = new Float32Array(ws * hs), G = guard ? new Uint8Array(ws * hs) : null;
  for (let r = 0; r < hs; r++) for (let c = 0; c < ws; c++) {
    const x = Math.min(w - 1, Math.floor(((c + 0.5) * w) / ws)), y = Math.min(h - 1, Math.floor(((r + 0.5) * h) / hs)), i = (y * w + x) * 4;
    L[r * ws + c] = luma(pm[i], pm[i + 1], pm[i + 2]);
    if (G && guard && x >= guard.x && x < guard.x + guard.w && y >= guard.y && y < guard.y + guard.h) G[r * ws + c] = 1;
  }
  const mult = seamPlan(L, ws, hs, Math.round((Math.abs(tw - w) * ws) / w), tw < w, G);
  const out = new Float32Array(tw * h * 4), xs = new Float32Array(2 * w + 1);
  for (let y = 0; y < h; y++) {
    const r = Math.min(hs - 1, Math.floor((y * hs) / h));
    let n = 0;
    for (let x = 0; x < w; x++) {
      const m = mult[r * ws + Math.min(ws - 1, Math.floor((x * ws) / w))];
      if (m >= 1) xs[n++] = x;
      if (m === 2) xs[n++] = Math.min(w - 1, x + 0.5);
    }
    if (!n) xs[n++] = 0;
    for (let j = 0; j < tw; j++) {
      const t = n === tw ? j : clamp(((j + 0.5) * n) / tw - 0.5, 0, n - 1), a = Math.floor(t), b = Math.min(n - 1, a + 1), f = t - a;
      const sx = xs[a] * (1 - f) + xs[b] * f, x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), g = sx - x0;
      const i0 = (y * w + x0) * 4, i1 = (y * w + x1) * 4, o = (y * tw + j) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = pm[i0 + k] * (1 - g) + pm[i1 + k] * g;
    }
  }
  return out;
}
function turn(pm: Float32Array, w: number, h: number): Float32Array {
  const o = new Float32Array(pm.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) o[(x * h + y) * 4 + k] = pm[(y * w + x) * 4 + k];
  return o;
}
/** Premultiplied pixels (w × h) carved to tw × th, keeping a protected box (in the same pixels) out of every seam. */
export function carve(pm: Float32Array, w: number, h: number, tw: number, th: number, guard: Box | null = null): Float32Array {
  const a = carveWidth(pm, w, h, tw, guard);
  if (th === h) return a;
  const g = guard ? { x: guard.y, y: Math.round((guard.x * tw) / w), w: guard.h, h: Math.max(1, Math.round((guard.w * tw) / w)) } : null;
  return turn(carveWidth(turn(a, tw, h), h, tw, th, g), th, tw);
}
/**
 * The box's top-left w × h pixels (all of it by default) carved to tw × th (`tw`, `th`), written from the box's top-left
 * corner; the rest of the box turns see-through. `px, py, pw, ph` protect a box, in pixels from the box's corner.
 */
const seamScale: Fx = (src, p, b) => {
  const w = clamp(Math.round(num(p, 'w', b.w)), 1, b.w), h = clamp(Math.round(num(p, 'h', b.h)), 1, b.h);
  const tw = clamp(Math.round(num(p, 'tw', w)), 1, 4 * w), th = clamp(Math.round(num(p, 'th', h)), 1, 4 * h), W = src.width;
  const pm = premul(src), box = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) box.set(pm.subarray(((b.y + y) * W + b.x) * 4, ((b.y + y) * W + b.x + w) * 4), y * w * 4);
  const pw = num(p, 'pw', 0), ph = num(p, 'ph', 0), guard = pw >= 1 && ph >= 1 ? { x: num(p, 'px', 0), y: num(p, 'py', 0), w: pw, h: ph } : null;
  const res = carve(box, w, h, tw, th, guard), out = pm.slice();
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = ((b.y + y) * W + b.x + x) * 4;
    if (x < tw && y < th) out.set(res.subarray((y * tw + x) * 4, (y * tw + x) * 4 + 4), i);
    else out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
  }
  return finish(src, b, out);
};

// ---------- Smooth a face by detail layers (frequency separation) ----------
/**
 * The texture layer: (original − blurred) / 2 + 127.5 per colour, rounded, alpha from the original. Put over the blurred
 * layer in Linear light (b + 2s − 1), the two give the original back to within 1 level.
 */
export function textureLayer(orig: ArrayLike<number>, blur: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(orig.length);
  for (let i = 0; i < orig.length; i += 4) {
    for (let k = 0; k < 3; k++) out[i + k] = Math.round((orig[i + k] - blur[i + k]) / 2 + 127.5);
    out[i + 3] = orig[i + 3];
  }
  return out;
}

// ---------- Fix a blurry photo (deblur) ----------
/**
 * Richardson-Lucy deconvolution (Richardson 1972, Lucy 1974), written for this project: the picture is guessed again and
 * again, each round asking how the guess would look blurred and correcting it by how far that is from the photo. It
 * assumes a mild, even (Gaussian) blur of `size` pixels; strong motion blur is not rescued. Alpha is kept.
 */
function gaussKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}
function blurPlane(src: Float32Array, W: number, H: number, k: Float32Array, tmp: Float32Array, out: Float32Array): void {
  const r = (k.length - 1) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += k[i + r] * src[y * W + Math.max(0, Math.min(W - 1, x + i))];
    tmp[y * W + x] = s;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += k[i + r] * tmp[Math.max(0, Math.min(H - 1, y + i)) * W + x];
    out[y * W + x] = s;
  }
}
const deblur: Fx = (src, p, b) => {
  const W = src.width, H = src.height, N = W * H, k = gaussKernel(clamp(num(p, 'size', 1.5), 0.5, 8)), rounds = clamp(Math.round(num(p, 'rounds', 8)), 1, 30);
  const out = src.data.slice(), d = new Float32Array(N), u = new Float32Array(N), est = new Float32Array(N), tmp = new Float32Array(N), q = new Float32Array(N);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < N; i++) d[i] = u[i] = src.data[i * 4 + c];
    for (let n = 0; n < rounds; n++) {
      blurPlane(u, W, H, k, tmp, est);
      for (let i = 0; i < N; i++) est[i] = d[i] / Math.max(est[i], 1e-3);
      blurPlane(est, W, H, k, tmp, q);
      for (let i = 0; i < N; i++) u[i] = Math.max(0, Math.min(255, u[i] * q[i]));
    }
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) out[(y * W + x) * 4 + c] = Math.round(u[y * W + x]);
  }
  return out;
};

export const WARPS = { 'mesh-warp': meshWarp, 'perspective-warp': perspectiveWarp, 'pin-warp': pinWarp, 'cage-warp': cageWarp, 'seam-scale': seamScale, deblur };
export const WARP_KINDS = Object.keys(WARPS) as (keyof typeof WARPS)[];
