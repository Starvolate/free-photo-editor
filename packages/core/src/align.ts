// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Line up layers automatically (Auto-align layers): find the same points in two pictures of one scene, work out the map
 * between them, and move or turn every other shown picture layer onto the bottom one, as one undo step.
 * Also Stitch a panorama (Photomerge) and Blend photos automatically (Auto-blend layers): the same matching, then a mask on
 * each upper photo that fades it into the ones below along the middle of their overlap.
 * Loaded only by automate.ts (as '@free-photoeditor/core/align'), never from the core barrel, so the first screen stays small.
 *
 * Steps: grey and shrink to at most 1024 px (box average, then a light blur); Harris corners (Sobel, a 5 × 5 window, k 0.04,
 * 3 × 3 local peaks, spread over an 8 × 8 grid, none near the edge or near see-through pixels); a 15 × 15 patch round each
 * corner, turned to the patch's own brightness centroid and normalised (zero mean, unit variance), so brighter or darker
 * shots still match; matches by best correlation, kept only when both sides pick each other and clearly beat the second
 * best; RANSAC with a seeded generator for a shift (1 point), a shift and turn (2 points) and a perspective map (4 points),
 * each refitted by least squares on the points that agree; then the simplest map that explains nearly as many points.
 */
import { findLayer, hasPixels, isFolder, layerRect, type Bitmap, type Doc, type Layer, type LayerMask } from './document';
import { docCommand, snapshotDoc, type Command } from './history';
import { lockedInTree } from './tree';
import { combineCommands, homography, invert3, mapPoint, moveNode, quadOfRect, transformNode, warpBitmap, type Quad } from './transform';

const MAXG = 1024, PR = 7, OR = 9, EDGE = OR + 3, WANT = 300, GRID = 8, MIN_INLIERS = 8;

/** The shrink factor for a set of pictures: one grey pixel stands for f × f picture pixels, the same for all of them. */
export const shrinkFor = (bs: readonly Bitmap[]): number => Math.max(1, Math.ceil(Math.max(1, ...bs.map((b) => Math.max(b.width, b.height))) / MAXG));

interface Grey { w: number; h: number; v: Float32Array; ok: Uint8Array; }
function greyOf(b: Bitmap, f: number): Grey {
  const w = Math.max(1, Math.floor(b.width / f)), h = Math.max(1, Math.floor(b.height / f)), v = new Float32Array(w * h), ok = new Uint8Array(w * h), d = b.data;
  for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) {
    let s = 0, solid = 1;
    for (let y = gy * f; y < gy * f + f; y++) for (let x = gx * f; x < gx * f + f; x++) {
      const i = (y * b.width + x) * 4;
      s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (d[i + 3] < 255) solid = 0;
    }
    v[gy * w + gx] = s / (f * f); ok[gy * w + gx] = solid;
  }
  return { w, h, v: blur(v, w, h), ok };
}
function blur(v: Float32Array, w: number, h: number): Float32Array {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = (v[x > 0 ? i - 1 : i] + 2 * v[i] + v[x < w - 1 ? i + 1 : i]) / 4; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = (t[y > 0 ? i - w : i] + 2 * t[i] + t[y < h - 1 ? i + w : i]) / 4; }
  return o;
}
function box5(s: Float32Array, w: number, h: number): Float32Array {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 2; x < w - 2; x++) { const i = y * w + x; t[i] = s[i - 2] + s[i - 1] + s[i] + s[i + 1] + s[i + 2]; }
  for (let y = 2; y < h - 2; y++) for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = t[i - 2 * w] + t[i - w] + t[i] + t[i + w] + t[i + 2 * w]; }
  return o;
}
const at = (g: Grey, x: number, y: number): number => {
  const x0 = Math.floor(x), y0 = Math.floor(y), ax = x - x0, ay = y - y0, i = y0 * g.w + x0, v = g.v;
  return (v[i] * (1 - ax) + v[i + 1] * ax) * (1 - ay) + (v[i + g.w] * (1 - ax) + v[i + g.w + 1] * ax) * ay;
};
/** Where the true peak sits between three samples (a parabola through them), as an offset of -0.5 to 0.5. */
const sub = (a: number, c: number, b: number): number => { const d = a - 2 * c + b; return d < 0 ? Math.max(-0.5, Math.min(0.5, (a - b) / (2 * d))) : 0; };

/** A matchable point: where it is (picture pixels, pixel centres at .5) and its normalised, turned patch. */
export interface Feat { x: number; y: number; p: Float32Array; }
/** The corners of a picture that can be matched, at most about 300, spread over the picture. */
export function features(b: Bitmap, f = shrinkFor([b])): Feat[] {
  const g = greyOf(b, f), { w, h, v, ok } = g;
  if (w < 2 * EDGE + 8 || h < 2 * EDGE + 8) return [];
  const xx = new Float32Array(w * h), yy = new Float32Array(w * h), xy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = v[i - w + 1] + 2 * v[i + 1] + v[i + w + 1] - v[i - w - 1] - 2 * v[i - 1] - v[i + w - 1];
    const gy = v[i + w - 1] + 2 * v[i + w] + v[i + w + 1] - v[i - w - 1] - 2 * v[i - w] - v[i - w + 1];
    xx[i] = gx * gx; yy[i] = gy * gy; xy[i] = gx * gy;
  }
  const sxx = box5(xx, w, h), syy = box5(yy, w, h), sxy = box5(xy, w, h), R = new Float32Array(w * h);
  let max = 0;
  for (let i = 0; i < w * h; i++) { const a = sxx[i], c = syy[i], e = sxy[i], r = a * c - e * e - 0.04 * (a + c) * (a + c); R[i] = r; if (r > max) max = r; }
  if (max <= 0) return [];
  // Grey pixels that are not fully solid, summed, so a corner near see-through or a cut edge is never used.
  const W1 = w + 1, I = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) I[(y + 1) * W1 + x + 1] = (ok[y * w + x] ? 0 : 1) + I[y * W1 + x + 1] + I[(y + 1) * W1 + x] - I[y * W1 + x];
  const cand: { x: number; y: number; r: number }[] = [];
  for (let y = EDGE; y < h - EDGE; y++) for (let x = EDGE; x < w - EDGE; x++) {
    const i = y * w + x, r = R[i];
    if (r <= max * 0.001) continue;
    if (r <= R[i - w - 1] || r <= R[i - w] || r <= R[i - w + 1] || r <= R[i - 1] || r < R[i + 1] || r < R[i + w - 1] || r < R[i + w] || r < R[i + w + 1]) continue;
    const x0 = x - EDGE, y0 = y - EDGE, x1 = x + EDGE + 1, y1 = y + EDGE + 1;
    if (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0] > 0) continue;
    cand.push({ x, y, r });
  }
  cand.sort((a, c) => c.r - a.r);
  const cw = Math.ceil(w / GRID), ch = Math.ceil(h / GRID), per = Math.ceil(WANT / (GRID * GRID)) * 2, used = new Map<number, number>(), out: Feat[] = [];
  for (const c of cand) {
    const cell = Math.floor(c.y / ch) * GRID + Math.floor(c.x / cw), n = used.get(cell) ?? 0;
    if (n >= per) continue;
    used.set(cell, n + 1);
    const i = c.y * w + c.x, cx = c.x + sub(R[i - 1], R[i], R[i + 1]), cy = c.y + sub(R[i - w], R[i], R[i + w]);
    // The patch's own direction: towards its brightness centroid (the same in a turned copy, so turned shots still match).
    let m10 = 0, m01 = 0;
    for (let dy = -OR; dy <= OR; dy++) for (let dx = -OR; dx <= OR; dx++) if (dx * dx + dy * dy <= OR * OR) { const val = v[(c.y + dy) * w + c.x + dx]; m10 += dx * val; m01 += dy * val; }
    const a = Math.atan2(m01, m10), co = Math.cos(a), si = Math.sin(a), p = new Float32Array((2 * PR + 1) ** 2);
    let k = 0, s = 0, s2 = 0;
    for (let q = -PR; q <= PR; q++) for (let u = -PR; u <= PR; u++) { const val = at(g, cx + u * co - q * si, cy + u * si + q * co); p[k++] = val; s += val; s2 += val * val; }
    const n2 = p.length, mean = s / n2, vr = s2 / n2 - mean * mean;
    if (vr < 4) continue;
    const sd = Math.sqrt(vr * n2);
    for (let j = 0; j < n2; j++) p[j] = (p[j] - mean) / sd;
    out.push({ x: (cx + 0.5) * f, y: (cy + 0.5) * f, p });
    if (out.length >= WANT) break;
  }
  return out;
}

/** A matched pair: a point of the moving picture (p) and the same point of the reference (q). */
interface Pair { px: number; py: number; qx: number; qy: number; }
/** Best-correlation matches, kept only when both sides pick each other and the best clearly beats the second best. */
export function matchFeatures(A: readonly Feat[], B: readonly Feat[]): Pair[] {
  const n = A.length, m = B.length;
  if (!n || !m) return [];
  const S = new Float32Array(n * m), L = A[0].p.length, bestB = new Int32Array(m).fill(-1), sB = new Float32Array(m).fill(-2);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const a = A[i].p, b = B[j].p;
    let d = 0;
    for (let k = 0; k < L; k++) d += a[k] * b[k];
    S[i * m + j] = d;
    if (d > sB[j]) { sB[j] = d; bestB[j] = i; }
  }
  const out: Pair[] = [];
  for (let i = 0; i < n; i++) {
    let s1 = -2, s2 = -2, j1 = -1;
    for (let j = 0; j < m; j++) { const d = S[i * m + j]; if (d > s1) { s2 = s1; s1 = d; j1 = j; } else if (d > s2) s2 = d; }
    if (j1 >= 0 && s1 >= 0.8 && s1 - s2 >= 0.04 && bestB[j1] === i) out.push({ px: B[j1].x, py: B[j1].y, qx: A[i].x, qy: A[i].y });
  }
  return out;
}

// ---- Maps from the moving picture to the reference (row-major 3 × 3) --------------------------------------------------
const mul3 = (a: number[], b: number[]): number[] => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => { const r = Math.floor(k / 3), c = k % 3; return a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; });
const shiftM = (tx: number, ty: number): number[] => [1, 0, tx, 0, 1, ty, 0, 0, 1];
function shiftOf(ps: readonly Pair[]): number[] {
  let x = 0, y = 0;
  for (const p of ps) { x += p.qx - p.px; y += p.qy - p.py; }
  return shiftM(x / ps.length, y / ps.length);
}
/** A shift, turn and even resize, by least squares (exact for two points). */
function turnOf(ps: readonly Pair[]): number[] | null {
  let pcx = 0, pcy = 0, qcx = 0, qcy = 0;
  for (const p of ps) { pcx += p.px; pcy += p.py; qcx += p.qx; qcy += p.qy; }
  pcx /= ps.length; pcy /= ps.length; qcx /= ps.length; qcy /= ps.length;
  let sa = 0, sb = 0, nn = 0;
  for (const p of ps) {
    const dx = p.px - pcx, dy = p.py - pcy, ex = p.qx - qcx, ey = p.qy - qcy;
    sa += dx * ex + dy * ey; sb += dx * ey - dy * ex; nn += dx * dx + dy * dy;
  }
  if (nn < 100) return null;
  const a = sa / nn, b = sb / nn;
  return [a, -b, qcx - a * pcx + b * pcy, b, a, qcy - b * pcx - a * pcy, 0, 0, 1];
}
function solveN(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}
/** A perspective map: exact for four points, least squares (on centred, scaled points) for more. */
function perspOf(ps: readonly Pair[]): number[] | null {
  if (ps.length === 4) return homography(ps.map((p) => ({ x: p.px, y: p.py })) as Quad, ps.map((p) => ({ x: p.qx, y: p.qy })) as Quad);
  const norm = (xs: number[], ys: number[]): number[] => {
    const cx = xs.reduce((s, x) => s + x, 0) / xs.length, cy = ys.reduce((s, y) => s + y, 0) / ys.length;
    const md = xs.reduce((s, x, i) => s + Math.hypot(x - cx, ys[i] - cy), 0) / xs.length || 1, k = Math.SQRT2 / md;
    return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
  };
  const Tp = norm(ps.map((p) => p.px), ps.map((p) => p.py)), Tq = norm(ps.map((p) => p.qx), ps.map((p) => p.qy));
  const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0)), Atb = new Array<number>(8).fill(0);
  const add = (r: number[], v: number): void => { for (let i = 0; i < 8; i++) { Atb[i] += r[i] * v; for (let j = 0; j < 8; j++) AtA[i][j] += r[i] * r[j]; } };
  for (const p of ps) {
    const a = mapPoint(Tp, p.px, p.py), b = mapPoint(Tq, p.qx, p.qy);
    add([a.x, a.y, 1, 0, 0, 0, -b.x * a.x, -b.x * a.y], b.x);
    add([0, 0, 0, a.x, a.y, 1, -b.y * a.x, -b.y * a.y], b.y);
  }
  const h = solveN(AtA, Atb);
  if (!h) return null;
  const k = Tq[0], iTq = [1 / k, 0, -Tq[2] / k, 0, 1 / k, -Tq[5] / k, 0, 0, 1], H = mul3(iTq, mul3([...h, 1], Tp));
  return Math.abs(H[8]) < 1e-12 ? null : H.map((x) => x / H[8]);
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function inliers(m: number[], ps: readonly Pair[], tol: number): number[] {
  const out: number[] = [], t2 = tol * tol;
  ps.forEach((p, i) => { const q = mapPoint(m, p.px, p.py); if ((q.x - p.qx) ** 2 + (q.y - p.qy) ** 2 <= t2) out.push(i); });
  return out;
}
/** RANSAC: try maps from `need` random pairs (every pair once for a shift), keep the one most pairs agree with, refit on those. */
function ransac(ps: readonly Pair[], need: number, fit: (s: readonly Pair[]) => number[] | null, tries: number, tol: number, rnd: () => number): { m: number[]; n: number } | null {
  if (ps.length < need) return null;
  let best: number[] = [];
  for (let t = 0; t < (need === 1 ? ps.length : tries); t++) {
    const pick: number[] = need === 1 ? [t] : [];
    while (pick.length < need) { const i = Math.floor(rnd() * ps.length); if (!pick.includes(i)) pick.push(i); }
    const m = fit(pick.map((i) => ps[i]));
    if (!m) continue;
    const inl = inliers(m, ps, tol);
    if (inl.length > best.length) best = inl;
  }
  // Enough agreeing points: eight, or at least four when nearly every match agrees (a picture with little detail).
  if (best.length < Math.max(need + 2, 4) || (best.length < MIN_INLIERS && best.length < 0.8 * ps.length)) return null;
  let m = fit(best.map((i) => ps[i]));
  for (let round = 0; round < 3 && m; round++) {
    const inl = inliers(m, ps, tol);
    if (inl.length < best.length) break;
    best = inl;
    const next = fit(best.map((i) => ps[i]));
    if (!next) break;
    m = next;
  }
  return m ? { m, n: best.length } : null;
}
/** A sensible map for a picture of this size: corners in front of the camera, still a convex shape, between half and twice the area. */
function sane(m: number[], w: number, h: number): boolean {
  const c = quadOfRect({ x: 0, y: 0, w, h });
  if (c.some((p) => m[6] * p.x + m[7] * p.y + m[8] <= 0)) return false;
  const q = c.map((p) => mapPoint(m, p.x, p.y));
  let sign = 0, area = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], d = q[(i + 2) % 4], cr = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
    area += a.x * b.y - b.x * a.y;
  }
  const k = Math.abs(area / 2) / (w * h);
  return k > 0.5 && k < 2;
}

export type FitKind = 'shift' | 'turn' | 'perspective';
/** How the moving picture maps onto the reference: `m` takes its pixels (pixel centres at .5) to the reference's. */
export interface Fit { kind: FitKind; m: number[]; inliers: number; matches: number; }
/**
 * The map that lines picture `b` up with `a`, or null when too few points agree (two different scenes, or too little
 * detail). The simplest map is chosen whose agreeing points are within 10 % of the richest; a map that moves no corner
 * more than half a pixel away from a plain shift is a shift.
 */
export function fitPair(A: readonly Feat[], B: readonly Feat[], bw: number, bh: number, f: number): Fit | null {
  const ps = matchFeatures(A, B), tol = 2 * f, rnd = mulberry32(0x5eed);
  const found: Fit[] = [];
  const add = (kind: FitKind, r: { m: number[]; n: number } | null): void => { if (r && sane(r.m, bw, bh)) found.push({ kind, m: r.m, inliers: r.n, matches: ps.length }); };
  add('shift', ransac(ps, 1, shiftOf, 0, tol, rnd));
  add('turn', ransac(ps, 2, turnOf, 400, tol, rnd));
  add('perspective', ransac(ps, 4, perspOf, 800, tol, rnd));
  if (!found.length) return null;
  const most = Math.max(...found.map((x) => x.inliers)), fit = found.find((x) => x.inliers >= 0.9 * most) as Fit;
  if (fit.kind !== 'shift') {
    const mid = mapPoint(fit.m, bw / 2, bh / 2), tx = mid.x - bw / 2, ty = mid.y - bh / 2;
    if (quadOfRect({ x: 0, y: 0, w: bw, h: bh }).every((p) => { const q = mapPoint(fit.m, p.x, p.y); return Math.hypot(q.x - p.x - tx, q.y - p.y - ty) < 0.5; }))
      return { ...fit, kind: 'shift', m: shiftM(tx, ty) };
  }
  return fit;
}
/** The map that lines picture `b` up with picture `a` (both whole bitmaps), or null when they cannot be matched. */
export function matchBitmaps(a: Bitmap, b: Bitmap, f = shrinkFor([a, b])): Fit | null {
  return fitPair(features(a, f), features(b, f), b.width, b.height, f);
}

/** What Line up layers did: the reference layer and the other layers by name, by what happened to them. */
export interface AlignResult { cmd: Command | null; ref: string; moved: string[]; same: string[]; missed: string[]; locked: string[]; }
/** Shown picture layers (not text, shapes, folders, light-and-colour or fill layers), which are the ones that can be matched. */
const usable = (l: Layer): boolean => l.visible && !isFolder(l) && (l.kind ?? 'pixel') === 'pixel' && !l.content && hasPixels(l);
/**
 * Line up every shown picture layer with the bottom one, which stays put: a shift moves the layer (no redrawing), a turn
 * or perspective change redraws it by its four corners. All of it is one undo step. Null when fewer than two layers can
 * be matched.
 */
export function autoAlign(doc: Doc, label = 'Line up layers automatically'): AlignResult | null {
  const ls = doc.layers.filter(usable);
  if (ls.length < 2) return null;
  const [ref, ...rest] = ls, f = shrinkFor(ls), A = features(ref, f), cmds: (Command | null)[] = [];
  const r: AlignResult = { cmd: null, ref: ref.name, moved: [], same: [], missed: [], locked: [] };
  for (const l of rest) {
    if (lockedInTree(doc.layers, l) || l.locked) { r.locked.push(l.name); continue; }
    const fit = A.length ? fitPair(A, features(l, f), l.width, l.height, f) : null;
    if (!fit) { r.missed.push(l.name); continue; }
    const M = mul3(shiftM(ref.x, ref.y), mul3(fit.m, shiftM(-l.x, -l.y)));
    if (fit.kind === 'shift') {
      const dx = Math.round(M[2]), dy = Math.round(M[5]);
      if (!dx && !dy) { r.same.push(l.name); continue; }
      cmds.push(moveNode(doc, l.id, dx, dy, label));
    } else {
      const to = quadOfRect(layerRect(l)).map((p) => mapPoint(M, p.x, p.y)) as Quad, c = transformNode(doc, l.id, to, label);
      if (!c) { r.missed.push(l.name); continue; }
      cmds.push(c);
    }
    r.moved.push(findLayer(doc, l.id)?.name ?? l.name);
  }
  r.cmd = combineCommands(label, cmds);
  return r;
}

// ---- Stitch a panorama, and blend the seams ------------------------------------------------------------------------------
/** How wide the fade along a seam is, in picture pixels (narrower where the overlap is narrower). */
export const FEATHER = 40;
/** Distance to the nearest marked pixel (two passes, steps of 1 and the square root of 2); very far when none is marked. */
function distTo(set: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h), D = Math.SQRT2;
  for (let i = 0; i < w * h; i++) d[i] = set[i] ? 0 : 1e9;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let v = d[i];
    if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) { v = Math.min(v, d[i - w] + 1); if (x > 0) v = Math.min(v, d[i - w - 1] + D); if (x < w - 1) v = Math.min(v, d[i - w + 1] + D); }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    let v = d[i];
    if (!v) continue;
    if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < h - 1) { v = Math.min(v, d[i + w] + 1); if (x < w - 1) v = Math.min(v, d[i + w + 1] + D); if (x > 0) v = Math.min(v, d[i + w - 1] + D); }
    d[i] = v;
  }
  return d;
}
const solidAt = (l: Layer, x: number, y: number): boolean => {
  const lx = x - l.x, ly = y - l.y;
  return lx >= 0 && ly >= 0 && lx < l.width && ly < l.height && l.data[(ly * l.width + lx) * 4 + 3] >= 128;
};
/**
 * The seam mask for layer `l` over the layers below it: it shows `l` where nothing below covers, hides it near its own
 * edges where the photos below go on, and fades over FEATHER px along the middle of the overlap (the line as far from its
 * own edge as from theirs). Null when there is no seam: no overlap, or one covers the other completely.
 */
export function seamMask(l: Layer, below: readonly Layer[]): LayerMask | null {
  const w = l.width + 2, h = l.height + 2, E = new Uint8Array(w * h), F = new Uint8Array(w * h), both = new Uint8Array(w * h);
  let nE = 0, nF = 0, nB = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = l.x + x - 1, Y = l.y + y - 1, me = solidAt(l, X, Y), lo = below.some((b) => solidAt(b, X, Y)), i = y * w + x;
    if (lo && !me) { E[i] = 1; nE++; } else if (me && !lo) { F[i] = 1; nF++; } else if (me && lo) { both[i] = 1; nB++; }
  }
  if (!nB || !nE || !nF) return null;
  const dE = distTo(E, w, h), dF = distTo(F, w, h), data = new Uint8Array(l.width * l.height).fill(255);
  for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) {
    const i = (y + 1) * w + x + 1;
    if (!both[i]) continue;
    const a = dE[i], b = dF[i], k = 0.5 + (a - b) / Math.max(1, Math.min(FEATHER, a + b));
    data[y * l.width + x] = Math.round(255 * Math.max(0, Math.min(1, k)));
  }
  return { x: l.x, y: l.y, width: l.width, height: l.height, data, outside: 255, enabled: true, linked: true, density: 1, feather: 0 };
}
/** Give every upper layer of `st` (bottom first) its seam mask; returns the names that got one. */
function maskSeams(st: Layer[]): string[] {
  const out: string[] = [];
  st.forEach((l, t) => { const m = t ? seamMask(l, st.slice(0, t)) : null; if (m) { l.mask = m; out.push(l.name); } });
  return out;
}

const isShift = (m: number[]): boolean => Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[3]) < 1e-9 && Math.abs(m[4] - 1) < 1e-9 && !m[6] && !m[7];
/** What Stitch did: the photo the others were matched to, the photos placed (all of them, the reference too), those left out. */
export interface StitchResult { cmd: Command | null; ref: string; placed: string[]; missed: string[]; }
/**
 * Stitch a panorama from the shown picture layers: every pair is matched; the photo most points agree with stays as it is
 * (the lowest one on a tie); each other photo is moved, turned or bent onto it, directly or through a third photo; the
 * canvas grows to hold them all; each upper photo gets a seam mask. One undo step. Null when fewer than two can be used.
 */
export function stitch(doc: Doc, label = 'Stitch a panorama'): StitchResult | null {
  const ls = doc.layers.filter((l) => usable(l) && !l.locked && !lockedInTree(doc.layers, l));
  if (ls.length < 2) return null;
  const f = shrinkFor(ls), F = ls.map((l) => features(l, f)), fits = new Map<string, Fit>(), score = ls.map(() => 0);
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    const fit = F[i].length && F[j].length ? fitPair(F[i], F[j], ls[j].width, ls[j].height, f) : null;
    if (fit) { fits.set(i + ',' + j, fit); score[i] += fit.inliers; score[j] += fit.inliers; }
  }
  /** The map from photo b's pixels into photo a's. */
  const toward = (a: number, b: number): number[] | null => { const x = fits.get(Math.min(a, b) + ',' + Math.max(a, b)); return !x ? null : a < b ? x.m : invert3(x.m); };
  const r = score.indexOf(Math.max(...score)), ref = ls[r], res: StitchResult = { cmd: null, ref: ref.name, placed: [], missed: [] };
  const placed = new Map<string, { x: number; y: number; width: number; height: number; data: Uint8ClampedArray }>();
  ls.forEach((l, k) => {
    let m = k === r ? shiftM(0, 0) : toward(r, k);
    for (let j = 0; !m && j < ls.length; j++) { const a = j !== r && j !== k ? toward(r, j) : null, b = a ? toward(j, k) : null; if (a && b) m = mul3(a, b); }
    if (!m) { res.missed.push(l.name); return; }
    const p = isShift(m) ? { x: Math.round(m[2]), y: Math.round(m[5]), width: l.width, height: l.height, data: l.data }
      : warpBitmap(l, quadOfRect({ x: 0, y: 0, w: l.width, h: l.height }).map((q) => mapPoint(m as number[], q.x, q.y)) as Quad);
    if (p) placed.set(l.id, p); else res.missed.push(l.name);
  });
  if (placed.size < 2) return { ...res, missed: ls.filter((l) => l !== ref).map((l) => l.name) };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
  for (const [id, p] of placed) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.width); y1 = Math.max(y1, p.y + p.height);
    const l = findLayer(doc, id) as Layer;
    area += l.width * l.height;
  }
  // A canvas far bigger than the photos means a wrong match, never a panorama.
  if ((x1 - x0) * (y1 - y0) > 4 * area) return { ...res, missed: ls.filter((l) => l !== ref).map((l) => l.name) };
  const before = snapshotDoc(doc), dx = -x0 - ref.x, dy = -y0 - ref.y;
  doc.layers = doc.layers.map((l) => {
    const p = placed.get(l.id);
    if (!p) return { ...l, x: l.x + dx, y: l.y + dy, ...(l.mask ? { mask: { ...l.mask, x: l.mask.x + dx, y: l.mask.y + dy } } : {}) };
    const n: Layer = { ...l, x: p.x - x0, y: p.y - y0, width: p.width, height: p.height, data: p.data };
    delete n.mask;
    return n;
  });
  doc.width = x1 - x0; doc.height = y1 - y0; doc.selection = null;
  const st = doc.layers.filter((l) => placed.has(l.id));
  maskSeams(st);
  res.placed = st.map((l) => l.name);
  res.cmd = docCommand(label, before, snapshotDoc(doc));
  return res;
}
/** What Blend photos did: the layers that got a seam mask, and those with no seam (no overlap, or covered completely). */
export interface BlendResult { cmd: Command | null; blended: string[]; none: string[]; }
/**
 * Blend photos automatically: the shown picture layers stay where they are, and each upper one gets a seam mask (an old
 * mask is replaced), so overlapping photos fade into each other. One undo step. Null when fewer than two can be used.
 */
export function blendSeams(doc: Doc, label = 'Blend photos automatically'): BlendResult | null {
  const ids = new Set(doc.layers.filter((l) => usable(l) && !l.locked && !lockedInTree(doc.layers, l)).map((l) => l.id));
  if (ids.size < 2) return null;
  const before = snapshotDoc(doc);
  doc.layers = doc.layers.map((l) => (ids.has(l.id) ? { ...l } : l));
  const st = doc.layers.filter((l) => ids.has(l.id)), had = new Map(st.map((l) => [l.id, l.mask]));
  for (const l of st) delete l.mask;
  const blended = maskSeams(st), none = st.slice(1).filter((l) => !l.mask).map((l) => l.name);
  for (const l of st) if (!l.mask && had.get(l.id)) l.mask = had.get(l.id);
  if (!blended.length) { doc.layers = before.layers.map((l) => ({ ...l })); return { cmd: null, blended, none }; }
  return { cmd: docCommand(label, before, snapshotDoc(doc)), blended, none };
}
