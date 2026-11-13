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

// ---- walking along a line (part 2): slice, hatch, stitch, blend, repeat, bend, dashes and thick-and-thin strokes --------
/** A point on a line and the way the line runs there (a unit step). */
export interface Spot { x: number; y: number; tx: number; ty: number; }
/** A row of points measured along its length: `at(s)` is the spot `s` pixels along it; `stops` are the lengths at its points. */
export interface Walk { length: number; closed: boolean; ring: Point[]; stops: number[]; at(s: number): Spot; }
export function walk(pts: readonly Point[], closed: boolean): Walk {
  const ring = closed && pts.length > 1 ? [...pts, pts[0]] : pts.slice(), stops = [0];
  for (let i = 1; i < ring.length; i++) stops.push(stops[i - 1] + Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y));
  const L = stops[stops.length - 1] ?? 0;
  return {
    length: L, closed, ring, stops,
    at(s: number): Spot {
      if (ring.length < 2 || !L) return { x: ring[0]?.x ?? 0, y: ring[0]?.y ?? 0, tx: 1, ty: 0 };
      const t = closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
      let lo = 0, hi = stops.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (stops[m] <= t) lo = m; else hi = m; }
      while (lo < stops.length - 2 && stops[lo + 1] === stops[lo]) lo++;
      while (lo > 0 && stops[lo + 1] === stops[lo]) lo--;
      const seg = stops[lo + 1] - stops[lo] || 1, dx = ring[lo + 1].x - ring[lo].x, dy = ring[lo + 1].y - ring[lo].y, u = Math.max(0, Math.min(1, (t - stops[lo]) / seg));
      return { x: ring[lo].x + dx * u, y: ring[lo].y + dy * u, tx: dx / seg, ty: dy / seg };
    },
  };
}
/** `n` evenly spaced spots: from end to end of an open line, or round a ring. */
export function spots(w: Walk, n: number): Spot[] {
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) out.push(w.at(w.closed ? (i * w.length) / n : n > 1 ? (i * w.length) / (n - 1) : w.length / 2));
  return out;
}
/** The points of one piece; a closed piece does not repeat its first point at the end. */
export function ringPoints(s: Subpath): Point[] {
  const p = subpathPoints(s).map((q) => ({ x: q.x, y: q.y }));
  if (s.closed && p.length > 1 && Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y) < 1e-9) p.pop();
  return p;
}
const walkOf = (s: Subpath): Walk => walk(ringPoints(s), s.closed);
/** Drop points that sit exactly on the straight line between their neighbours (so a square stays four corners). */
function tidy(pts: Point[], closed: boolean): Point[] {
  const n = pts.length, out: Point[] = [];
  if (n < 3) return pts;
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { out.push(pts[i]); continue; }
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n], L = Math.hypot(c.x - a.x, c.y - a.y);
    const along = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
    if (!(L && along && Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) <= 1e-6 * L)) out.push(b);
  }
  return out.length >= (closed ? 3 : 2) ? out : pts;
}
/** Extra points so no step along the row is longer than `max` px (the corners stay). */
function densify(pts: readonly Point[], closed: boolean, max: number): Point[] {
  const out: Point[] = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    out.push({ x: a.x, y: a.y });
    if (!closed && i === n - 1) break;
    const b = pts[(i + 1) % n], k = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / max);
    for (let j = 1; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  return out;
}
const lineOf = (pts: readonly Point[], closed: boolean): Subpath => ({ anchors: pts.map((p) => anchorAt(p.x, p.y)), closed });

/** Slice outline `a` along the edge of `b`: the parts of `a` outside `b` and the parts inside it, each piece on its own. */
export function divideSubpaths(a: readonly Subpath[], b: readonly Subpath[], tol = 0.5): Subpath[][] {
  return [...splitPieces(booleanSubpaths(a, b, 'subtract', tol)), ...splitPieces(booleanSubpaths(a, b, 'intersect', tol))].filter((g) => g.length);
}

/**
 * Hatch lines across the filled area of an outline (even-odd, so holes stay empty): `gap` px apart, at `angle` degrees
 * (0 runs level); `cross` adds a second set at right angles. Each line is an open two-point piece.
 */
export function hatchSubpaths(subs: readonly Subpath[], gap: number, angle: number, cross = false): Subpath[] {
  const rings = subs.map(ringPoints).filter((r) => r.length > 2), g = Math.max(1, gap), out: Subpath[] = [];
  for (const deg of cross ? [angle, angle + 90] : [angle]) {
    const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    // Turn the outline so the lines run level, cut it with level lines, and turn the cuts back.
    const rot = rings.map((r) => r.map((p) => ({ x: p.x * cs + p.y * sn, y: -p.x * sn + p.y * cs })));
    let y0 = Infinity, y1 = -Infinity;
    for (const r of rot) for (const p of r) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    for (let k = 0, y = y0 + g / 2; y < y1; y = y0 + g / 2 + ++k * g) {
      const xs: number[] = [];
      for (const r of rot) for (let i = 0, j = r.length - 1; i < r.length; j = i++)
        if ((r[i].y > y) !== (r[j].y > y)) xs.push(r[i].x + ((y - r[i].y) * (r[j].x - r[i].x)) / (r[j].y - r[i].y));
      xs.sort((m, n) => m - n);
      const back = (x: number): Point => ({ x: x * cs - y * sn, y: x * sn + y * cs });
      for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-9) out.push(lineOf([back(xs[i]), back(xs[i + 1])], false));
    }
  }
  return out;
}

/** `count` straight lines from one line to another, spaced evenly along both, like string art. */
export function stitchSubpaths(a: Subpath, b: Subpath, count: number): Subpath[] {
  const n = Math.max(1, Math.round(count)), A = spots(walkOf(a), n), B = spots(walkOf(b), n);
  return A.map((p, i) => lineOf([p, B[i]], false));
}

/** `steps` in-between shapes from `a` to `b`: each point slides evenly from a's outline to the matching point of b's. */
export function interpolateSubpaths(a: Subpath, b: Subpath, steps: number, n = 96): Subpath[] {
  const closed = a.closed && b.closed, pa = ringPoints(a);
  let pb = ringPoints(b);
  if (closed && Math.sign(ringArea(pa)) !== Math.sign(ringArea(pb))) pb = pb.reverse();
  const A = spots(walk(pa, closed), n);
  let B = spots(walk(pb, closed), n);
  const d2 = (p: Point, q: Point): number => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
  if (closed) {
    // Turn b's points round to the start that lies closest overall (corners meet corners).
    let best = 0, bd = Infinity;
    for (let r = 0; r < n; r++) { let s = 0; for (let i = 0; i < n; i++) s += d2(A[i], B[(i + r) % n]); if (s < bd) { bd = s; best = r; } }
    B = [...B.slice(best), ...B.slice(0, best)];
  } else if (d2(A[0], B[0]) + d2(A[n - 1], B[n - 1]) > d2(A[0], B[n - 1]) + d2(A[n - 1], B[0])) B.reverse();
  const k = Math.max(1, Math.round(steps)), out: Subpath[] = [];
  for (let s = 1; s <= k; s++) {
    const t = s / (k + 1);
    out.push(lineOf(tidy(A.map((p, i) => ({ x: p.x + (B[i].x - p.x) * t, y: p.y + (B[i].y - p.y) * t })), closed), closed));
  }
  return out;
}

/**
 * Copies of a shape laid along a line, each bent to follow it: the shape's width runs along the line and its middle
 * sits on it, `gap` px between copies (a ring spreads them evenly). `stretch` lays one copy over the whole line (bend).
 */
export function patternAlong(shape: readonly Subpath[], along: Subpath, gap = 0, stretch = false): Subpath[] {
  const b = subpathsBounds(shape), w = walkOf(along);
  if (!b || !w.length || b.w <= 0) return [];
  const mid = b.y + b.h / 2, g = Math.max(0, gap), step = b.w + g;
  const pieces = shape.filter((s) => s.anchors.length > 1).map((s) => ({ closed: s.closed, pts: densify(ringPoints(s), s.closed, 2) }));
  const n = stretch ? 1 : w.closed ? Math.max(1, Math.round(w.length / step)) : Math.max(1, Math.floor((w.length + g) / step));
  const pitch = stretch ? 0 : w.closed ? w.length / n : step, sx = stretch ? w.length / b.w : 1, out: Subpath[] = [];
  for (let k = 0; k < n; k++)
    for (const p of pieces)
      out.push(lineOf(tidy(p.pts.map((q) => { const s = w.at(k * pitch + (q.x - b.x) * sx), v = q.y - mid; return { x: s.x - s.ty * v, y: s.y + s.tx * v }; }), p.closed), p.closed));
  return out;
}

/** A line turned into a filled outline whose width changes along it: `w0` px at the start, `w1` in the middle, `w2` at the end. */
export function powerStroke(line: Subpath, w0: number, w1: number, w2: number, step = 2): Subpath[] {
  const w = walkOf(line);
  if (!w.length) return [];
  const n = Math.max(2, Math.ceil(w.length / step)), left: Point[] = [], right: Point[] = [];
  const width = (t: number): number => Math.max(0, t <= 0.5 ? w0 + (w1 - w0) * t * 2 : w1 + (w2 - w1) * (t - 0.5) * 2) / 2;
  for (let i = 0; i < (w.closed ? n : n + 1); i++) {
    const t = i / n, s = w.at(t * w.length), hw = width(t);
    left.push({ x: s.x - s.ty * hw, y: s.y + s.tx * hw });
    right.push({ x: s.x + s.ty * hw, y: s.y - s.tx * hw });
  }
  right.reverse();
  return w.closed ? [lineOf(tidy(left, true), true), lineOf(tidy(right, true), true)] : [lineOf(tidy([...left, ...right], true), true)];
}

/** The part of a walked line from `s0` to `s1` px along it, corners included. */
export function sliceWalk(w: Walk, s0: number, s1: number): Point[] {
  const a = w.at(s0), b = w.at(s1), out: Point[] = [{ x: a.x, y: a.y }];
  for (let j = 1; j < w.stops.length - 1; j++) if (w.stops[j] > s0 && w.stops[j] < s1) out.push({ x: w.ring[j].x, y: w.ring[j].y });
  out.push({ x: b.x, y: b.y });
  return out;
}
/**
 * Dashes along a line: `pattern` is dash, gap, dash, gap… in px (an odd list repeats twice; a 0 dash is a dot, which a
 * round end draws). Returns each dash as a row of points; a pattern with no gap gives the whole line.
 */
export function dashLine(pts: readonly Point[], closed: boolean, pattern: readonly number[]): Point[][] {
  const w = walk(pts, closed), L = w.length, pat = (pattern.length % 2 ? [...pattern, ...pattern] : [...pattern]).map((v) => Math.max(0, v));
  if (!L) return [];
  if (!pat.some((v, i) => i % 2 === 1 && v > 0)) return [sliceWalk(w, 0, L)];
  const out: Point[][] = [];
  for (let s = 0, i = 0; s < L - 1e-9; i = (i + 1) % pat.length) {
    if (i % 2 === 0) out.push(sliceWalk(w, s, Math.min(L, s + pat[i])));
    s += pat[i];
  }
  return out;
}
/** A filled arrowhead (three points) whose tip is the end of a line (or its start), `size` px long and as wide. */
export function arrowHead(pts: readonly Point[], atStart: boolean, size: number): Point[] {
  const w = walk(pts, false), s = w.at(atStart ? 0 : w.length), dx = atStart ? -s.tx : s.tx, dy = atStart ? -s.ty : s.ty;
  const bx = s.x - dx * size, by = s.y - dy * size, hw = size / 2;
  return [{ x: s.x, y: s.y }, { x: bx - dy * hw, y: by + dx * hw }, { x: bx + dy * hw, y: by - dx * hw }];
}
