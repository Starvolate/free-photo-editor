// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Path operations (Shapes & text, 13 Nov 2026): combine two shapes (unite, subtract, keep the overlap, keep what does not
 * overlap), join or split pieces, grow or shrink an outline, mirror it, spin copies round a centre, give it a hand-drawn
 * wobble, and draw star and spiral outlines. Pure functions on the path model of path.ts; no DOM, nothing runs on load.
 *
 * The area operations work on a fine grid: each outline is filled (even-odd, so holes count) at up to 4 cells per
 * picture pixel, the cells are combined, and the edge is traced back into curves. Results are true to about half a pixel,
 * and touching or shared edges never break them (the classic weak spot of exact polygon clipping).
 * The web app loads this file on first use through `@free-photoeditor/core/pathops`, so the first screen never carries it.
 */
import type { Point, Rect } from './geometry';
import type { Selection } from './document';
import { contractMask, expandMask, type Mask } from './selection';
import { anchorAt, polygonsMask, selectionToPath, subpathPoints, type Anchor, type Subpath } from './path';

export type BoolOp = 'unite' | 'subtract' | 'intersect' | 'exclude';
export type MirrorAxis = 'right' | 'left' | 'bottom' | 'top';

/** An anchor moved by a point function (its two handles move with it). */
export function mapAnchor(a: Anchor, f: (p: Point) => Point): Anchor {
  const p = f({ x: a.x, y: a.y }), i = f({ x: a.inX, y: a.inY }), o = f({ x: a.outX, y: a.outY });
  return { x: p.x, y: p.y, inX: i.x, inY: i.y, outX: o.x, outY: o.y, smooth: a.smooth };
}
export const mapSubpaths = (subs: readonly Subpath[], f: (p: Point) => Point): Subpath[] =>
  subs.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => mapAnchor(a, f)) }));
export const cloneSubpaths = (subs: readonly Subpath[]): Subpath[] => subs.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ ...a })) }));
/** The same piece walked the other way round (each anchor's in and out handles swap). */
export const reverseSubpath = (s: Subpath): Subpath =>
  ({ closed: s.closed, anchors: s.anchors.slice().reverse().map((a) => ({ ...a, inX: a.outX, inY: a.outY, outX: a.inX, outY: a.inY })) });

/** The box round the drawn curves of some pieces, or null when they have no anchors. */
export function subpathsBounds(subs: readonly Subpath[]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of subs) for (const p of subpathPoints(s)) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
/** Signed area of a ring of points (positive when it runs clockwise on screen, y down). */
export function ringArea(pts: readonly Point[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return -s / 2;
}
/**
 * The area of an outline traced by these functions: outer edges and hole edges run opposite ways round, so their signed
 * areas add up to the filled area (a ring's hole takes itself away).
 */
export const tracedArea = (subs: readonly Subpath[]): number => Math.abs(subs.reduce((n, s) => n + ringArea(subpathPoints(s)), 0));

// ---- the fine grid ----------------------------------------------------------------------------------------------------
interface Frame { ox: number; oy: number; k: number; w: number; h: number; }
const MAX_CELLS = 4_000_000;
const MAX_PIXELS = 25_000_000;
function frameOf(groups: readonly (readonly Subpath[])[], pad: number): Frame | null {
  const b = subpathsBounds(groups.flat());
  if (!b) return null;
  const ox = Math.floor(b.x - pad) - 1, oy = Math.floor(b.y - pad) - 1;
  const W = Math.ceil(b.x + b.w + pad) + 1 - ox, H = Math.ceil(b.y + b.h + pad) + 1 - oy;
  if (W * H > MAX_PIXELS) throw new Error('This outline is too big to work on here (more than 25 million pixels across its box).');
  const k = Math.max(1, Math.min(4, Math.floor(Math.sqrt(MAX_CELLS / (W * H)))));
  return { ox, oy, k, w: W * k, h: H * k };
}
/** Fill pieces on the grid, even-odd; open pieces close themselves, as a selection from a path does. */
const fill = (subs: readonly Subpath[], f: Frame): Mask =>
  polygonsMask(f.w, f.h, subs.map((s) => subpathPoints(s).map((p) => ({ x: (p.x - f.ox) * f.k, y: (p.y - f.oy) * f.k }))));
/** Trace the grid's half-filled edge back into pieces in picture pixels; `tol` is how far (pixels) it may stray. */
function trace(m: Mask, f: Frame, tol: number): Subpath[] {
  const sel: Selection = { x: 0, y: 0, w: m.width, h: m.height, alpha: m.data };
  // Points stay corners where the edge turns by more than 22.5 degrees, so the corners of combined shapes stay sharp.
  const p = selectionToPath(sel, Math.max(0.5, tol * f.k), 'Work path', Math.PI / 8);
  return p ? mapSubpaths(p.subpaths, (q) => ({ x: q.x / f.k + f.ox, y: q.y / f.k + f.oy })) : [];
}

/** Combine two shapes: unite them, cut b out of a, keep only their overlap, or keep only what does not overlap. */
export function booleanSubpaths(a: readonly Subpath[], b: readonly Subpath[], op: BoolOp, tol = 0.5): Subpath[] {
  const f = frameOf([a, b], 1);
  if (!f) return [];
  const A = fill(a, f).data, B = fill(b, f).data, out = new Uint8Array(A.length);
  for (let i = 0; i < A.length; i++) {
    const x = A[i], y = B[i];
    out[i] = op === 'unite' ? Math.max(x, y) : op === 'subtract' ? Math.min(x, 255 - y) : op === 'intersect' ? Math.min(x, y) : Math.abs(x - y);
  }
  return trace({ width: f.w, height: f.h, data: out }, f, tol);
}
/** Unite any number of shapes into one. */
export function uniteAll(groups: readonly (readonly Subpath[])[], tol = 0.5): Subpath[] {
  const f = frameOf(groups, 1);
  if (!f) return [];
  const out = new Uint8Array(f.w * f.h);
  for (const g of groups) { const m = fill(g, f).data; for (let i = 0; i < out.length; i++) if (m[i] > out[i]) out[i] = m[i]; }
  return trace({ width: f.w, height: f.h, data: out }, f, tol);
}
/** Grow (by > 0) or shrink (by < 0) the filled area of an outline by `by` pixels; grown corners come out round. */
export function offsetSubpaths(subs: readonly Subpath[], by: number, tol = 0.5): Subpath[] {
  if (!by) return cloneSubpaths(subs);
  const f = frameOf([subs], Math.max(0, by) + 1);
  if (!f) return [];
  const m = fill(subs, f), r = Math.abs(by) * f.k;
  return trace(by > 0 ? expandMask(m, r) : contractMask(m, r), f, tol);
}

const inside = (pt: Point, ring: readonly Point[]): boolean => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    if ((ring[i].y > pt.y) !== (ring[j].y > pt.y) && pt.x < ((ring[j].x - ring[i].x) * (pt.y - ring[i].y)) / (ring[j].y - ring[i].y) + ring[i].x) c = !c;
  return c;
};
/** Split an outline into its separate pieces. A hole stays with the piece round it, so a ring stays a ring. */
export function splitPieces(subs: readonly Subpath[]): Subpath[][] {
  const rings = subs.map((s) => subpathPoints(s)), area = rings.map((r) => Math.abs(ringArea(r)));
  const parent = subs.map((s, i) => {
    if (!s.closed || !rings[i].length) return -1;
    let depth = 0, best = -1;
    subs.forEach((t, j) => {
      if (j === i || !t.closed || area[j] <= area[i] || !inside(rings[i][0], rings[j])) return;
      depth++;
      if (best < 0 || area[j] < area[best]) best = j;
    });
    return depth % 2 ? best : -1;
  });
  const groups = new Map<number, Subpath[]>();
  subs.forEach((s, i) => { if (parent[i] < 0 || parent[parent[i]] >= 0) groups.set(i, [cloneSubpaths([s])[0]]); });
  subs.forEach((s, i) => { const p = parent[i]; if (p >= 0 && groups.has(p) && !groups.has(i)) groups.get(p)?.push(cloneSubpaths([s])[0]); });
  return [...groups.values()];
}

/** True when an anchor's two handles point exactly away from each other (a smooth point). */
function lined(a: Anchor): boolean {
  const ix = a.inX - a.x, iy = a.inY - a.y, ox = a.outX - a.x, oy = a.outY - a.y;
  if ((!ix && !iy) || (!ox && !oy)) return false;
  return Math.abs(ix * oy - iy * ox) < 1e-6 * Math.hypot(ix, iy) * Math.hypot(ox, oy) && ix * ox + iy * oy < 0;
}
/**
 * Mirror an outline across one edge of its box. With `join`, an open piece whose ends sit on that edge becomes one
 * closed outline (draw half a heart, get the heart), and closed pieces are united with their mirror image.
 */
export function mirrorSubpaths(subs: readonly Subpath[], axis: MirrorAxis, join = true, tol = 0.5): Subpath[] {
  const b = subpathsBounds(subs);
  if (!b) return [];
  const vert = axis === 'left' || axis === 'right';
  const c = axis === 'right' ? b.x + b.w : axis === 'left' ? b.x : axis === 'bottom' ? b.y + b.h : b.y;
  const f = vert ? (p: Point): Point => ({ x: 2 * c - p.x, y: p.y }) : (p: Point): Point => ({ x: p.x, y: 2 * c - p.y });
  const on = (a: Anchor): boolean => Math.abs((vert ? a.x : a.y) - c) < 0.5;
  const closed = subs.filter((s) => s.closed && s.anchors.length), open = subs.filter((s) => !s.closed && s.anchors.length), out: Subpath[] = [];
  for (const s of open) {
    const m = mapSubpaths([s], f)[0];
    if (!join || s.anchors.length < 2) { out.push(cloneSubpaths([s])[0], m); continue; }
    const back = reverseSubpath(m).anchors, anchors = s.anchors.map((a) => ({ ...a })), last = anchors[anchors.length - 1];
    if (on(last)) { const t = back.shift() as Anchor; last.outX = t.outX; last.outY = t.outY; last.smooth = lined(last); }
    anchors.push(...back);
    let shut = false;
    if (on(s.anchors[0]) && anchors.length > 2) {
      const t = anchors.pop() as Anchor, first = anchors[0];
      first.inX = t.inX; first.inY = t.inY; first.smooth = lined(first); shut = true;
    }
    out.push({ anchors, closed: shut });
  }
  if (closed.length) {
    const m = mapSubpaths(closed, f);
    out.push(...(join ? booleanSubpaths(closed, m, 'unite', tol) : [...cloneSubpaths(closed), ...m]));
  }
  return out;
}
/** `copies` copies of an outline spun round `centre` at even angles (the first is the original); `join` unites them. */
export function rotateCopies(subs: readonly Subpath[], copies: number, centre: Point, join = true, tol = 0.5): Subpath[] {
  const n = Math.max(1, Math.round(copies)), groups: Subpath[][] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n, cs = Math.cos(a), sn = Math.sin(a);
    groups.push(k ? mapSubpaths(subs, (p) => ({ x: centre.x + (p.x - centre.x) * cs - (p.y - centre.y) * sn, y: centre.y + (p.x - centre.x) * sn + (p.y - centre.y) * cs }))
      : cloneSubpaths(subs));
  }
  if (!join) return groups.flat();
  const shut = groups.map((g) => g.filter((s) => s.closed)), open = groups.flatMap((g) => g.filter((s) => !s.closed));
  return [...(shut[0].length ? uniteAll(shut, tol) : []), ...open];
}

/** A small seeded random number source (mulberry32), so the same pattern number always gives the same wobble. */
export function seeded(seed: number): () => number {
  let a = (Math.floor(seed) * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Points at even steps along a row of points (a closed ring wraps round; an open row keeps both ends). */
export function resample(pts: readonly Point[], closed: boolean, step: number): Point[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const ring = closed ? [...pts, pts[0]] : [...pts], cum = [0];
  for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y));
  const L = cum[cum.length - 1];
  if (!L) return [{ ...pts[0] }];
  const n = Math.max(closed ? 3 : 1, Math.round(L / Math.max(0.5, step))), out: Point[] = [];
  for (let k = 0, j = 0; k < (closed ? n : n + 1); k++) {
    const t = (k * L) / n;
    while (j < cum.length - 2 && cum[j + 1] < t) j++;
    const seg = cum[j + 1] - cum[j], u = seg ? Math.min(1, Math.max(0, (t - cum[j]) / seg)) : 0;
    out.push({ x: ring[j].x + (ring[j + 1].x - ring[j].x) * u, y: ring[j].y + (ring[j + 1].y - ring[j].y) * u });
  }
  return out;
}
/** A hand-drawn wobble: points every `size` pixels along the outline, each pushed sideways by up to `amount` pixels. */
export function roughenSubpaths(subs: readonly Subpath[], amount: number, size: number, seed = 1): Subpath[] {
  const rnd = seeded(seed);
  return subs.filter((s) => s.anchors.length > 1).map((s) => {
    const pts = resample(subpathPoints(s), s.closed, Math.max(1, size)), n = pts.length;
    const anchors = pts.map((p, i) => {
      const a = pts[s.closed ? (i + n - 1) % n : Math.max(0, i - 1)], b = pts[s.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, r = (rnd() * 2 - 1) * amount;
      return anchorAt(p.x - (dy / L) * r, p.y + (dx / L) * r);
    });
    return { anchors, closed: s.closed };
  });
}

/** A star: `points` outer tips at `outer` pixels from the centre and as many inner corners at `inner`; the first tip points up. */
export function starSubpath(cx: number, cy: number, points: number, outer: number, inner: number): Subpath {
  const n = Math.max(3, Math.round(points)), anchors: Anchor[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 ? inner : outer, a = -Math.PI / 2 + (i * Math.PI) / n;
    anchors.push(anchorAt(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return { anchors, closed: true };
}
/**
 * A spiral from `inner` to `outer` pixels round the centre in `turns` turns (its distance from the centre grows evenly
 * with the angle), drawn with eight smooth curves per turn; it starts to the right of the centre and turns clockwise.
 */
export function spiralSubpath(cx: number, cy: number, turns: number, inner: number, outer: number): Subpath {
  const T = Math.max(0.25, turns) * 2 * Math.PI, steps = Math.max(4, Math.ceil(Math.max(0.25, turns) * 8)), dt = T / steps, b = (outer - inner) / T;
  const anchors: Anchor[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i * dt, r = inner + b * t, cs = Math.cos(t), sn = Math.sin(t), x = cx + r * cs, y = cy + r * sn;
    const dx = (b * cs - r * sn) * (dt / 3), dy = (b * sn + r * cs) * (dt / 3);
    anchors.push({ x, y, inX: i ? x - dx : x, inY: i ? y - dy : y, outX: i < steps ? x + dx : x, outY: i < steps ? y + dy : y, smooth: i > 0 && i < steps });
  }
  return { anchors, closed: false };
}
