// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Free transform and friends: a layer (or the selection) is redrawn so its four corners land anywhere. Scale, turn, slant,
 * pull corners and perspective are all the same map (a 3 × 3 projective matrix). Also lining layers up and spacing them out.
 */
import { docRect, findLayer, geomOf, hasPixels, isFolder, layerRect, setGeom, type Bitmap, type Doc, type Layer, type LayerMask, type Selection } from './document';
import { placeLayer, plusMask } from './mask';
import { intersect, union, type Point, type Rect } from './geometry';
import { geomCommand, propsCommand, type Command } from './history';
import { effectiveBox, lockedInTree, subtreeOf } from './tree';
import { contentCommand } from './vector';

export type Quad = [Point, Point, Point, Point];
export const quadOfRect = (r: Rect): Quad => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
export function quadBounds(q: Quad): Rect {
  const xs = q.map((p) => p.x), ys = q.map((p) => p.y), x0 = Math.floor(Math.min(...xs)), y0 = Math.floor(Math.min(...ys));
  return { x: x0, y: y0, w: Math.ceil(Math.max(...xs)) - x0, h: Math.ceil(Math.max(...ys)) - y0 };
}
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
/** The projective map (row-major 3 × 3) that takes the corners of `from` onto the corners of `to`. */
export function homography(from: Quad, to: Quad): number[] | null {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}
export function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
export function mapPoint(m: number[], x: number, y: number): Point {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}
export interface Placed { x: number; y: number; width: number; height: number; data: Uint8ClampedArray; }
/**
 * Redraw `src` so its corners land on `to` (picture pixels). Smooth (bilinear, with extra samples when shrinking a lot) or
 * fast (nearest pixel, for live previews). Outside the shape is see-through. `limit` keeps the result to a box.
 */
export function warpBitmap(src: Bitmap, to: Quad, smooth = true, limit?: Rect): Placed | null {
  const H = homography(quadOfRect({ x: 0, y: 0, w: src.width, h: src.height }), to), inv = H ? invert3(H) : null;
  if (!inv) return null;
  let b: Rect | null = quadBounds(to);
  if (limit) b = intersect(b, limit);
  if (!b || b.w <= 0 || b.h <= 0) return null;
  const area = Math.abs(((to[2].x - to[0].x) * (to[3].y - to[1].y) - (to[3].x - to[1].x) * (to[2].y - to[0].y)) / 2);
  const scale = Math.sqrt(area / Math.max(1, src.width * src.height)), ss = !smooth ? 1 : scale < 0.25 ? 4 : scale < 0.5 ? 2 : 1;
  const sign = Math.sign(inv[6] * (to[0].x + to[2].x) / 2 + inv[7] * (to[0].y + to[2].y) / 2 + inv[8]) || 1;
  const out = new Uint8ClampedArray(b.w * b.h * 4), d = src.data, W = src.width, Hh = src.height;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    let r = 0, g = 0, bl = 0, a = 0, n = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      n++;
      const X = b.x + x + (sx + 0.5) / ss, Y = b.y + y + (sy + 0.5) / ss, w = inv[6] * X + inv[7] * Y + inv[8];
      if (w * sign <= 0) continue;
      const u = (inv[0] * X + inv[1] * Y + inv[2]) / w, v = (inv[3] * X + inv[4] * Y + inv[5]) / w;
      if (u < 0 || v < 0 || u >= W || v >= Hh) continue;
      if (!smooth) {
        const i = ((v | 0) * W + (u | 0)) * 4, al = d[i + 3];
        r += d[i] * al; g += d[i + 1] * al; bl += d[i + 2] * al; a += al;
        continue;
      }
      const fx = u - 0.5, fy = v - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const X0 = Math.min(W - 1, Math.max(0, x0 + k)), Y0 = Math.min(Hh - 1, Math.max(0, y0 + j));
        const wt = (k ? ax : 1 - ax) * (j ? ay : 1 - ay), i = (Y0 * W + X0) * 4, al = d[i + 3] * wt;
        r += d[i] * al; g += d[i + 1] * al; bl += d[i + 2] * al; a += al;
      }
    }
    if (a <= 0) continue;
    const o = (y * b.w + x) * 4;
    out[o] = r / a; out[o + 1] = g / a; out[o + 2] = bl / a; out[o + 3] = a / n;
  }
  return { x: b.x, y: b.y, width: b.w, height: b.h, data: out };
}
/** A linked mask redrawn by the same map as its layer (the layer's box, before the change, goes to `to`). */
export function warpMask(m: LayerMask, l: { x: number; y: number; width: number; height: number }, to: Quad, smooth: boolean, limit?: Rect): LayerMask {
  const H = m.width && m.height ? homography(quadOfRect({ x: 0, y: 0, w: l.width, h: l.height }), to) : null;
  if (!H) return m;
  const q = quadOfRect({ x: m.x - l.x, y: m.y - l.y, w: m.width, h: m.height }).map((p) => mapPoint(H, p.x, p.y)) as Quad;
  const inv = m.outside === 255, src = new Uint8ClampedArray(m.data.length * 4);
  for (let i = 0; i < m.data.length; i++) src[i * 4 + 3] = inv ? 255 - m.data[i] : m.data[i];
  const g = warpBitmap({ width: m.width, height: m.height, data: src }, q, smooth, limit);
  if (!g) return { ...m, x: 0, y: 0, width: 0, height: 0, data: new Uint8Array(0) };
  const data = new Uint8Array(g.width * g.height);
  for (let i = 0; i < data.length; i++) data[i] = inv ? 255 - g.data[i * 4 + 3] : g.data[i * 4 + 3];
  return { ...m, x: g.x, y: g.y, width: g.width, height: g.height, data };
}
/** Free transform of a layer: its corners go to `to`. Works far past the canvas but not without limit. A linked mask follows. */
export function transformLayer(doc: Doc, l: Layer, to: Quad, label = 'Free transform', smooth = true): Command | null {
  const before = geomOf(l), pad = Math.max(doc.width, doc.height), limit = { x: -pad, y: -pad, w: doc.width + 2 * pad, h: doc.height + 2 * pad };
  const g = warpBitmap({ width: l.width, height: l.height, data: l.data }, to, smooth, limit);
  if (!g) return null;
  const mb = l.mask, ma = mb?.linked ? warpMask(mb, l, to, smooth, limit) : mb;
  setGeom(l, g);
  const cmd = geomCommand(label, l.id, before, geomOf(l));
  if (ma === mb) return cmd;
  l.mask = ma;
  return plusMask(cmd, l.id, mb, ma);
}
/** Select > Transform selection: the selection's outline is redrawn so its box's corners land on `to`. */
export function transformSelection(sel: Selection, to: Quad, docW: number, docH: number): Selection | null {
  const src = new Uint8ClampedArray(sel.w * sel.h * 4);
  for (let i = 0; i < sel.w * sel.h; i++) src[i * 4 + 3] = sel.alpha ? sel.alpha[i] : 255;
  const g = warpBitmap({ width: sel.w, height: sel.h, data: src }, to, true, { x: 0, y: 0, w: docW, h: docH });
  if (!g) return null;
  let x0 = g.width, y0 = g.height, x1 = -1, y1 = -1;
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) if (g.data[(y * g.width + x) * 4 + 3]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha[y * w + x] = g.data[((y + y0) * g.width + x + x0) * 4 + 3];
  return { x: g.x + x0, y: g.y + y0, w, h, alpha };
}
/** Several changes undone and redone as one step. */
export function combineCommands(label: string, cmds: (Command | null)[]): Command | null {
  const list = cmds.filter((c): c is Command => !!c);
  if (!list.length) return null;
  return { label, bytes: list.reduce((s, c) => s + c.bytes, 0),
    undo(d) { for (let i = list.length - 1; i >= 0; i--) list[i].undo(d); }, redo(d) { for (const c of list) c.redo(d); } };
}
/** The part of a layer with visible pixels, in picture coordinates (null when it is empty). */
export function contentBounds(l: Layer): Rect | null {
  let x0 = l.width, y0 = -1, x1 = -1, y1 = -1;
  for (let y = 0; y < l.height; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < l.width; x++) if (l.data[(y * l.width + x) * 4 + 3]) { if (a < 0) a = x; b = x; }
    if (a < 0) continue;
    if (y0 < 0) y0 = y;
    y1 = y;
    if (a < x0) x0 = a;
    if (b > x1) x1 = b;
  }
  return y0 < 0 ? null : { x: l.x + x0, y: l.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
/** The topmost shown layer with a visible pixel at a picture point (for the Move tool's "pick the layer under the pointer"). */
export function layerAt(doc: Doc, x: number, y: number): Layer | null {
  x = Math.floor(x); y = Math.floor(y);
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i], lx = x - l.x, ly = y - l.y;
    if (!l.visible || lx < 0 || ly < 0 || lx >= l.width || ly >= l.height) continue;
    if (l.data[(ly * l.width + lx) * 4 + 3] > 16) return l;
  }
  return null;
}
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
/** How far a box must move so its chosen edge or centre lines up with the same edge or centre of `to`. */
export function alignShift(b: Rect, to: Rect, how: AlignEdge): Point {
  switch (how) {
    case 'left': return { x: to.x - b.x, y: 0 };
    case 'right': return { x: to.x + to.w - (b.x + b.w), y: 0 };
    case 'hcenter': return { x: Math.round(to.x + to.w / 2 - (b.x + b.w / 2)), y: 0 };
    case 'top': return { x: 0, y: to.y - b.y };
    case 'bottom': return { x: 0, y: to.y + to.h - (b.y + b.h) };
    case 'vcenter': return { x: 0, y: Math.round(to.y + to.h / 2 - (b.y + b.h / 2)) };
  }
}
function moveBy(l: Layer, dx: number, dy: number, label: string): Command | null {
  if (!dx && !dy) return null;
  const before = { x: l.x, y: l.y }, after = { x: l.x + dx, y: l.y + dy };
  placeLayer(l, after.x, after.y);
  return propsCommand(l.id, before, after, label);
}
/** Line up a layer's visible part with `to` (the selection or the whole picture). A folder lines up everything inside it. */
export function alignLayer(doc: Doc, id: string, to: Rect | null, how: AlignEdge): Command | null {
  const l = findLayer(doc, id), b = l ? nodeContentBounds(doc, l) : null;
  if (!l || !b) return null;
  const s = alignShift(b, to ?? docRect(doc), how);
  return moveNode(doc, id, s.x, s.y, 'Line up layers');
}
/** The nodes a move carries: the node itself and, for a folder, everything inside it, however deep (bottom to top). */
export const carriedNodes = (doc: Doc, id: string): Layer[] => subtreeOf(doc.layers, id);
/** True when moving the node would move something locked: the node, a folder it sits in, or any layer inside it. */
export function carriesLocked(doc: Doc, id: string): boolean {
  const l = findLayer(doc, id);
  return !l || lockedInTree(doc.layers, l) || carriedNodes(doc, id).some((c) => !!c.locked);
}
/** Where a node and everything it carries sit before a drag starts. */
export interface Spot { id: string; x: number; y: number; }
export const spotsOf = (doc: Doc, id: string): Spot[] => carriedNodes(doc, id).map((l) => ({ id: l.id, x: l.x, y: l.y }));
/** Put every carried node at its start plus (dx, dy), for a live drag (moveNode makes the undo step). Returns the area that changed. */
export function placeSpots(doc: Doc, spots: readonly Spot[], dx: number, dy: number): Rect | null {
  let r: Rect | null = null;
  for (const s of spots) {
    const l = findLayer(doc, s.id);
    if (!l) continue;
    const old = layerRect(l);
    placeLayer(l, s.x + dx, s.y + dy);
    if (!isFolder(l)) r = union(r, union(old, layerRect(l)));
  }
  return r;
}
/** Move a node by (dx, dy) as one undo step. A folder carries every layer inside it; linked masks follow. */
export function moveNode(doc: Doc, id: string, dx: number, dy: number, label = 'Move layer'): Command | null {
  if (!dx && !dy) return null;
  return combineCommands(label, carriedNodes(doc, id).map((l) => moveBy(l, dx, dy, label)));
}
/** A node's visible part in picture coordinates: a layer's own, or for a folder the union of every layer inside it. */
export function nodeContentBounds(doc: Doc, l: Layer): Rect | null {
  if (!isFolder(l)) return contentBounds(l);
  let u: Rect | null = null;
  for (const c of subtreeOf(doc.layers, l.id)) if (c !== l && hasPixels(c)) { const b = contentBounds(c); if (b) u = union(u, b); }
  return u;
}
/** Where a rectangle's corners go when the box `from` is warped onto `to`: one projective map for every layer in a folder. */
export function carryQuad(from: Quad, to: Quad, r: Rect): Quad | null {
  const m = homography(from, to);
  return m ? (quadOfRect(r).map((p) => mapPoint(m, p.x, p.y)) as Quad) : null;
}
/**
 * Free transform of a folder: every layer inside is warped by the one map that takes the folder's box to `to`, as one
 * undo step. Text and shape layers inside become plain pixels, as a single transformed one does. A layer is done by transformLayer.
 */
export function transformNode(doc: Doc, id: string, to: Quad, label = 'Free transform', smooth = true): Command | null {
  const l = findLayer(doc, id);
  if (!l) return null;
  if (!isFolder(l)) return transformLayer(doc, l, to, label, smooth);
  const box = effectiveBox(doc.layers, l), from = box ? quadOfRect(box) : null;
  if (!from || !homography(from, to)) return null;
  const cmds: (Command | null)[] = [];
  for (const c of subtreeOf(doc.layers, id)) {
    const q = hasPixels(c) ? carryQuad(from, to, layerRect(c)) : null;
    if (!q) continue;
    const had = !!c.content;
    cmds.push(transformLayer(doc, c, q, label, smooth));
    if (had) cmds.push(contentCommand(doc, c.id, null, null, 'Turn into pixels'));
  }
  return combineCommands(label, cmds);
}
/** Space three or more layers so their centres are evenly apart, keeping the first and the last where they are. */
export function distributeLayers(doc: Doc, ids: string[], axis: 'h' | 'v'): Command | null {
  const items = ids.map((id) => { const l = findLayer(doc, id), b = l ? contentBounds(l) : null; return l && b ? { l, c: axis === 'h' ? b.x + b.w / 2 : b.y + b.h / 2 } : null; })
    .filter((x): x is { l: Layer; c: number } => !!x).sort((a, b) => a.c - b.c);
  if (items.length < 3) return null;
  const first = items[0].c, step = (items[items.length - 1].c - first) / (items.length - 1);
  return combineCommands('Space out layers', items.map((it, i) => {
    const d = Math.round(first + step * i - it.c);
    return moveBy(it.l, axis === 'h' ? d : 0, axis === 'v' ? d : 0, 'Space out layers');
  }));
}
