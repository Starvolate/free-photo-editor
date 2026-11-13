// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Paths: outlines made of cubic Bezier curves, drawn with the pen and kept in the document beside the selection.
 * A path holds subpaths; a subpath is a row of anchors, open or closed; each anchor has an in handle and an out handle in
 * picture coordinates (a handle on its anchor means a straight side). A smooth anchor keeps its two handles in one line.
 * Pure functions on plain data: no DOM, nothing runs when the module loads. Turning a path into a selection fills every
 * subpath at once with the even-odd rule, so holes survive; turning a selection into a path traces its 50% edge.
 */
import type { Point, Rect } from './geometry';
import type { Mask } from './selection';
import type { Selection } from './document';

export interface Anchor { x: number; y: number; inX: number; inY: number; outX: number; outY: number; smooth: boolean; }
export interface Subpath { anchors: Anchor[]; closed: boolean; }
/** A named outline. The work path is the one the pen draws into when no other path is picked. */
export interface VectorPath { id: string; name: string; work?: boolean; subpaths: Subpath[]; }
export type Cubic = [Point, Point, Point, Point];
export interface AnchorHit { sub: number; idx: number; part: 'anchor' | 'in' | 'out'; d: number; }
export interface SegmentHit { sub: number; seg: number; t: number; d: number; at: Point; }

let serial = 0;
export const newPathId = (): string => 'p' + (++serial).toString(36) + Math.floor(Math.random() * 0xffffff).toString(36);
/** A corner anchor with no handles. */
export const anchorAt = (x: number, y: number): Anchor => ({ x, y, inX: x, inY: y, outX: x, outY: y, smooth: false });
export const clonePath = (p: VectorPath): VectorPath =>
  ({ ...p, subpaths: p.subpaths.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ ...a })) })) });
export const clonePaths = (ps: readonly VectorPath[] | undefined): VectorPath[] => (ps ?? []).map(clonePath);
export const countAnchors = (p: VectorPath): number => p.subpaths.reduce((n, s) => n + s.anchors.length, 0);

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const handleIn = (a: Anchor): Point => ({ x: a.inX, y: a.inY });
const handleOut = (a: Anchor): Point => ({ x: a.outX, y: a.outY });
const hasIn = (a: Anchor): boolean => a.inX !== a.x || a.inY !== a.y;
const hasOut = (a: Anchor): boolean => a.outX !== a.x || a.outY !== a.y;

/** The curves of a subpath, in order; a closed one ends with the curve back to its first anchor. */
export function segments(s: Subpath): Cubic[] {
  const a = s.anchors, n = a.length, out: Cubic[] = [];
  const last = s.closed && n > 1 ? n : n - 1;
  for (let k = 0; k < last; k++) {
    const p = a[k], q = a[(k + 1) % n];
    out.push([{ x: p.x, y: p.y }, handleOut(p), handleIn(q), { x: q.x, y: q.y }]);
  }
  return out;
}
export function bezierAt(c: Cubic, t: number): Point {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}
const straight = (c: Cubic): boolean => c[1].x === c[0].x && c[1].y === c[0].y && c[2].x === c[3].x && c[2].y === c[3].y;
/** How many straight pieces a curve is drawn with: about one per 6 px of its control polygon, at least 4, at most 200. */
const pieces = (c: Cubic): number => (straight(c) ? 1 : Math.min(200, Math.max(4, Math.ceil((dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3])) / 6))));
/** A subpath as a row of points (a closed one does not repeat its first point at the end). */
export function subpathPoints(s: Subpath): Point[] {
  const a = s.anchors;
  if (!a.length) return [];
  const out: Point[] = [{ x: a[0].x, y: a[0].y }];
  for (const c of segments(s)) { const n = pieces(c); for (let k = 1; k <= n; k++) out.push(bezierAt(c, k / n)); }
  if (s.closed && out.length > 1) out.pop();
  return out;
}
/** The box round a path's drawn curves, or null when it has no anchors. */
export function pathBounds(p: VectorPath): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of p.subpaths) for (const q of subpathPoints(s)) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
/** SVG path data (M, C, L, Z) for a path: for drawing it with Path2D, thumbnails and the command line. */
export function pathData(p: VectorPath): string {
  const f = (v: number): string => String(Math.round(v * 100) / 100);
  const parts: string[] = [];
  for (const s of p.subpaths) {
    if (!s.anchors.length) continue;
    parts.push(`M${f(s.anchors[0].x)} ${f(s.anchors[0].y)}`);
    for (const c of segments(s)) parts.push(straight(c) ? `L${f(c[3].x)} ${f(c[3].y)}` : `C${f(c[1].x)} ${f(c[1].y)} ${f(c[2].x)} ${f(c[2].y)} ${f(c[3].x)} ${f(c[3].y)}`);
    if (s.closed) parts.push('Z');
  }
  return parts.join(' ');
}

/** The anchor or handle nearest `pt` within `r` (an anchor wins over a handle at the same spot). Handles on their anchor do not count. */
export function hitAnchor(p: VectorPath, pt: Point, r: number, handles = true): AnchorHit | null {
  let best: AnchorHit | null = null;
  const consider = (sub: number, idx: number, part: AnchorHit['part'], q: Point, bias: number): void => {
    const d = dist(q, pt);
    if (d <= r && (!best || d + bias < best.d)) best = { sub, idx, part, d: d + bias };
  };
  p.subpaths.forEach((s, si) => s.anchors.forEach((a, k) => {
    consider(si, k, 'anchor', a, -0.01);
    if (handles && hasIn(a)) consider(si, k, 'in', handleIn(a), 0);
    if (handles && hasOut(a)) consider(si, k, 'out', handleOut(a), 0);
  }));
  return best;
}
/** The nearest point on any of the path's curves, within `r`. */
export function hitSegment(p: VectorPath, pt: Point, r: number): SegmentHit | null {
  let best: SegmentHit | null = null;
  p.subpaths.forEach((s, si) => segments(s).forEach((c, k) => {
    const N = 48;
    let bt = 0, bd = Infinity;
    for (let i = 0; i <= N; i++) { const d = dist(bezierAt(c, i / N), pt); if (d < bd) { bd = d; bt = i / N; } }
    let lo = Math.max(0, bt - 1 / N), hi = Math.min(1, bt + 1 / N);
    for (let i = 0; i < 24; i++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (dist(bezierAt(c, m1), pt) < dist(bezierAt(c, m2), pt)) hi = m2; else lo = m1;
    }
    const t = (lo + hi) / 2, at = bezierAt(c, t), d = dist(at, pt);
    if (d <= r && (!best || d < best.d)) best = { sub: si, seg: k, t, d, at };
  }));
  return best;
}

/** Add an anchor on curve `seg` at `t` without changing the shape (de Casteljau). Returns the new anchor's index. */
export function splitSegment(s: Subpath, seg: number, t: number): number {
  const n = s.anchors.length, a = s.anchors[seg], b = s.anchors[(seg + 1) % n];
  const c = segments(s)[seg];
  if (!c) return -1;
  const p01 = lerp(c[0], c[1], t), p12 = lerp(c[1], c[2], t), p23 = lerp(c[2], c[3], t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), m = lerp(p012, p123, t);
  const line = straight(c);
  const added: Anchor = line ? anchorAt(m.x, m.y) : { x: m.x, y: m.y, inX: p012.x, inY: p012.y, outX: p123.x, outY: p123.y, smooth: true };
  if (!line) { a.outX = p01.x; a.outY = p01.y; b.inX = p23.x; b.inY = p23.y; }
  s.anchors.splice(seg + 1, 0, added);
  return seg + 1;
}
/** Remove an anchor; a subpath left with fewer than two anchors is no longer closed. */
export function deleteAnchor(s: Subpath, idx: number): void {
  s.anchors.splice(idx, 1);
  if (s.anchors.length < 2) s.closed = false;
}
/** Drop subpaths with no anchors. */
export function dropEmpty(p: VectorPath): void { p.subpaths = p.subpaths.filter((s) => s.anchors.length > 0); }
export function moveAnchor(a: Anchor, dx: number, dy: number): void {
  a.x += dx; a.y += dy; a.inX += dx; a.inY += dy; a.outX += dx; a.outY += dy;
}
/**
 * Put one handle at (x, y). A smooth anchor turns its other handle to stay in line (keeping that handle's own length);
 * `alone` moves only this handle and makes the anchor a corner.
 */
export function moveHandle(a: Anchor, which: 'in' | 'out', x: number, y: number, alone = false): void {
  if (which === 'in') { a.inX = x; a.inY = y; } else { a.outX = x; a.outY = y; }
  if (alone) { a.smooth = false; return; }
  if (!a.smooth) return;
  const ox = which === 'in' ? a.outX : a.inX, oy = which === 'in' ? a.outY : a.inY;
  const len = Math.hypot(ox - a.x, oy - a.y), dx = x - a.x, dy = y - a.y, dl = Math.hypot(dx, dy);
  if (!len || !dl) return;
  const nx = a.x - (dx / dl) * len, ny = a.y - (dy / dl) * len;
  if (which === 'in') { a.outX = nx; a.outY = ny; } else { a.inX = nx; a.inY = ny; }
}
/** Pull matched handles out of an anchor: the out handle goes to (x, y), the in handle mirrors it. */
export function pullHandles(a: Anchor, x: number, y: number): void {
  a.outX = x; a.outY = y; a.inX = 2 * a.x - x; a.inY = 2 * a.y - y;
  a.smooth = hasOut(a);
}
export function makeCorner(a: Anchor): void { a.inX = a.outX = a.x; a.inY = a.outY = a.y; a.smooth = false; }
/** Give an anchor automatic smooth handles, lined up from its neighbours, each a third of the way to that neighbour. */
export function makeSmooth(s: Subpath, idx: number): void {
  const a = s.anchors[idx], n = s.anchors.length;
  if (n < 2) return;
  const prev = idx > 0 ? s.anchors[idx - 1] : s.closed ? s.anchors[n - 1] : null;
  const next = idx < n - 1 ? s.anchors[idx + 1] : s.closed ? s.anchors[0] : null;
  const from = prev ?? a, to = next ?? a;
  let dx = to.x - from.x, dy = to.y - from.y;
  const dl = Math.hypot(dx, dy);
  if (!dl) return;
  dx /= dl; dy /= dl;
  const li = prev ? dist(prev, a) / 3 : 0, lo = next ? dist(a, next) / 3 : 0;
  a.inX = a.x - dx * li; a.inY = a.y - dy * li; a.outX = a.x + dx * lo; a.outY = a.y + dy * lo;
  a.smooth = true;
}
export function translatePath(p: VectorPath, dx: number, dy: number): void {
  for (const s of p.subpaths) for (const a of s.anchors) moveAnchor(a, dx, dy);
}

/** Fill polygons at once with the even-odd rule into a w x h mask, 4 sub-rows per pixel and exact coverage across. */
export function polygonsMask(w: number, h: number, polys: Point[][]): Mask {
  const m: Mask = { width: w, height: h, data: new Uint8Array(w * h) };
  const e: number[] = [];
  let minY = Infinity, maxY = -Infinity;
  for (const pts of polys) {
    if (pts.length < 3) continue;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      e.push(pts[j].x, pts[j].y, pts[i].x, pts[i].y);
      minY = Math.min(minY, pts[i].y); maxY = Math.max(maxY, pts[i].y);
    }
  }
  if (!e.length) return m;
  const S = 4, y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h, Math.ceil(maxY));
  const acc = new Float32Array(w + 1), xs: number[] = [];
  for (let y = y0; y < y1; y++) {
    acc.fill(0);
    let any = false;
    for (let s = 0; s < S; s++) {
      const sy = y + (s + 0.5) / S;
      xs.length = 0;
      for (let k = 0; k < e.length; k += 4) {
        const ax = e[k], ay = e[k + 1], bx = e[k + 2], by = e[k + 3];
        if ((ay <= sy) !== (by <= sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
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
/** The area inside a path (every subpath, open ones closed straight back), as a w x h mask. */
export const pathMask = (p: VectorPath, w: number, h: number): Mask => polygonsMask(w, h, p.subpaths.map(subpathPoints));

/** Thin a closed ring of points: keep only those that matter at `tol` pixels (Ramer-Douglas-Peucker, both halves). */
function simplifyRing(pts: Point[], tol: number): Point[] {
  if (pts.length < 4) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[0], pts[i]); if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, pts.length]];
  while (stack.length) {
    const [i, j] = stack.pop() as [number, number];
    const a = pts[i], b = pts[j % pts.length], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    let bi = -1, bd = tol;
    for (let k = i + 1; k < j; k++) {
      const q = pts[k], d = L ? Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / L : dist(q, a);
      if (d > bd) { bd = d; bi = k; }
    }
    if (bi > 0) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
const ringArea = (pts: Point[]): number => {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return s / 2;
};
/**
 * A path along a selection's edge (where it is at least half selected). A plain box becomes four corners. Each kept
 * point is smooth unless the outline turns there by more than 60 degrees. `tol` is how far, in pixels, the path may
 * stray from the traced edge (smaller keeps more points). Null when nothing is selected.
 */
export function selectionToPath(sel: Selection, tol = 2, name = 'Work path'): VectorPath | null {
  const { x: ox, y: oy, w, h } = sel, al = sel.alpha;
  if (w <= 0 || h <= 0) return null;
  if (!al) {
    const c = [anchorAt(ox, oy), anchorAt(ox + w, oy), anchorAt(ox + w, oy + h), anchorAt(ox, oy + h)];
    return { id: newPathId(), name, work: true, subpaths: [{ anchors: c, closed: true }] };
  }
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && al[y * w + x] >= 128;
  const W = w + 1, out = new Map<number, number[]>();
  const edge = (x0: number, y0: number, x1: number, y1: number): void => {
    const k = y0 * W + x0, list = out.get(k);
    if (list) list.push(y1 * W + x1); else out.set(k, [y1 * W + x1]);
  };
  // Every side between a selected and an unselected pixel, walked clockwise round the selected pixel (inside on the right).
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) edge(x, y, x + 1, y);
    if (!on(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) edge(x, y + 1, x, y);
  }
  const subpaths: Subpath[] = [];
  for (const [start, targets] of out) {
    while (targets.length) {
      const ring: Point[] = [];
      let from = start, to = targets.pop() as number;
      for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
        const fx = from % W, fy = (from - fx) / W, tx = to % W, ty = (to - tx) / W;
        ring.push({ x: fx, y: fy });
        if (to === start) break;
        const next = out.get(to);
        if (!next || !next.length) break;
        let pick = next.length - 1;
        if (next.length > 1) {
          // Where two selected pixels touch only at a corner, turn right: each pixel keeps its own outline.
          const dx = tx - fx, dy = ty - fy, rx = -dy, ry = dx;
          const r = next.findIndex((v) => { const vx = v % W, vy = (v - vx) / W; return vx - tx === rx && vy - ty === ry; });
          if (r >= 0) pick = r;
        }
        from = to; to = next.splice(pick, 1)[0];
      }
      // Keep only the corners of the pixel staircase, then thin it.
      const corners = ring.filter((p, i) => {
        const a = ring[(i + ring.length - 1) % ring.length], b = ring[(i + 1) % ring.length];
        return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
      });
      const pts = simplifyRing(corners, Math.max(0.5, tol));
      if (pts.length < 3 || Math.abs(ringArea(pts)) < 2) continue;
      const anchors = pts.map((p) => anchorAt(p.x + ox, p.y + oy));
      const sp: Subpath = { anchors, closed: true };
      anchors.forEach((a, i) => {
        const p = anchors[(i + anchors.length - 1) % anchors.length], q = anchors[(i + 1) % anchors.length];
        const a1 = Math.atan2(a.y - p.y, a.x - p.x), a2 = Math.atan2(q.y - a.y, q.x - a.x);
        let turn = Math.abs(a2 - a1);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (turn < Math.PI / 3) a.smooth = true;
      });
      // Handles from the original corner positions, so each smooth point is lined up with its real neighbours.
      const flags = anchors.map((a) => a.smooth);
      anchors.forEach((_, i) => { if (flags[i]) makeSmooth(sp, i); });
      subpaths.push(sp);
    }
  }
  return subpaths.length ? { id: newPathId(), name, work: true, subpaths } : null;
}
