// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * More ways to make and change a selection, and more layer commands (the select-and-layers batch, 13 Nov 2026).
 * Pure functions on masks and pixels, so each one is unit-tested on real numbers; the web module (selmore.ts) loads
 * this file on first use, never on the first screen. Masks are picture-sized, 0 (not selected) to 255 (selected).
 */
import type { RGBA } from './color';
import { createLayer, type Doc, type Layer, type LayerGeom, type LayerKind, type LayerLabel, type LayerMask } from './document';
import type { Rect } from './geometry';
import { docCommand, snapshotDoc, type Command } from './history';
import { blurPlane, contractMask, distanceSquared, emptyMask, expandMask, featherMask, maskBounds, smoothMask, type Mask, type Pixels } from './selection';
import { siblingIndexes, subtreeRange } from './tree';

/** Brightness 0..255 of one pixel (Rec. 709 weights, the ones a screen uses). */
export const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Select by brightness: pixels from `lo` to `hi` are fully selected; outside, the selection fades to nothing over
 * `soft` levels (0 = a hard edge). See-through pixels count as much as they show.
 */
export function luminanceMask(src: Pixels, lo: number, hi: number, soft: number): Mask {
  const m = emptyMask(src.width, src.height), d = src.data;
  if (lo > hi) [lo, hi] = [hi, lo];
  for (let i = 0; i < m.data.length; i++) {
    const y = luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]), dist = y < lo ? lo - y : y > hi ? y - hi : 0;
    const v = dist === 0 ? 1 : soft > 0 && dist < soft ? 1 - dist / soft : 0;
    m.data[i] = Math.round(v * d[i * 4 + 3]);
  }
  return m;
}
/** One colour channel (0 red, 1 green, 2 blue) as a selection: the brighter that channel, the more it is selected. */
export function channelMask(src: Pixels, ch: 0 | 1 | 2): Mask {
  const m = emptyMask(src.width, src.height), d = src.data;
  for (let i = 0; i < m.data.length; i++) m.data[i] = Math.round((d[i * 4 + ch] * d[i * 4 + 3]) / 255);
  return m;
}
/** How much a layer mask lets through at picture pixel (x, y), 0..255: its grey value (`outside` beyond its box), eased by its density. */
export function maskValueAt(mk: LayerMask, x: number, y: number): number {
  const inBox = x >= mk.x && y >= mk.y && x < mk.x + mk.width && y < mk.y + mk.height;
  const v = inBox ? mk.data[(y - mk.y) * mk.width + (x - mk.x)] : mk.outside;
  return 255 - mk.density * (255 - v);
}
/**
 * A layer's solid parts as a selection on a picture `w` x `h`: as selected as the layer is opaque, and, when its layer mask
 * is switched on, as much as the mask shows it (the mask's soft edge setting is not added).
 */
export function alphaMask(l: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'data' | 'mask'>, w: number, h: number): Mask {
  const m = emptyMask(w, h), mk = l.mask?.enabled ? l.mask : undefined;
  const x0 = Math.max(0, l.x), y0 = Math.max(0, l.y), x1 = Math.min(w, l.x + l.width), y1 = Math.min(h, l.y + l.height);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const a = l.data[((y - l.y) * l.width + (x - l.x)) * 4 + 3];
    m.data[y * w + x] = mk ? Math.round((a * maskValueAt(mk, x, y)) / 255) : a;
  }
  return m;
}
/**
 * Fill holes: every gap inside the selection (pixels under half selected, not reaching the picture's edge) of at most
 * `maxArea` pixels becomes fully selected. Gaps joined to the edge are the outside, never a hole.
 */
export function removeHoles(m: Mask, maxArea: number): Mask {
  const { width: w, height: h } = m, out = { width: w, height: h, data: m.data.slice() }, seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h), comp: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || m.data[s] >= 128) continue;
    let n = 0, edge = false;
    comp.length = 0;
    stack[n++] = s;
    seen[s] = 1;
    while (n) {
      const p = stack[--n], x = p % w, y = (p - x) / w;
      comp.push(p);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && !seen[q] && m.data[q] < 128) { seen[q] = 1; stack[n++] = q; }
    }
    if (!edge && comp.length <= maxArea) for (const p of comp) out.data[p] = 255;
  }
  return out;
}
/** Round the outer corners of a selection to radius `r` (shrink by r, then grow by r back: corners come back round). */
export const roundCorners = (m: Mask, r: number): Mask => (r > 0 ? expandMask(contractMask(m, r), r) : m);

const hash = (x: number, y: number, s: number): number => {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return ((n >>> 0) / 4294967295) * 2 - 1;
};
/** Smooth random numbers -1..1, `grain` pixels between bumps. */
function noise(x: number, y: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/**
 * Roughen the edge (hand-torn): each pixel takes the selection from a spot up to `amount` pixels away, chosen by smooth
 * random numbers with bumps `grain` pixels apart. The same `seed` gives the same tear. Pixels further than `amount` from
 * the edge never change.
 */
export function roughenMask(m: Mask, amount: number, grain: number, seed = 1): Mask {
  const { width: w, height: h } = m, out = emptyMask(w, h), g = Math.max(1, grain);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.round(x + amount * noise(x / g, y / g, seed)), sy = Math.round(y + amount * noise(x / g, y / g, seed + 7919));
    out.data[y * w + x] = sx < 0 || sy < 0 || sx >= w || sy >= h ? 0 : m.data[sy * w + sx];
  }
  return out;
}

// ---- Layers -----------------------------------------------------------------------------------------------------------
/** A change of one layer's place, size and pixels as one undo step. The arrays are never changed in place. */
export function layerDataCommand(label: string, id: string, before: LayerGeom, after: LayerGeom): Command {
  const put = (d: Doc, g: LayerGeom): void => {
    const l = d.layers.find((x) => x.id === id);
    if (l) { l.x = g.x; l.y = g.y; l.width = g.width; l.height = g.height; l.data = g.data; }
  };
  return { label, bytes: before.data.length + after.data.length, undo: (d) => put(d, before), redo: (d) => put(d, after) };
}
export const geomOf = (l: Layer): LayerGeom => ({ x: l.x, y: l.y, width: l.width, height: l.height, data: l.data });

/** The box (picture coordinates) holding every pixel of the layer that is at all solid; null when it is empty. */
export function contentBox(l: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'data'>): Rect | null {
  const a = { width: l.width, height: l.height, data: new Uint8Array(l.width * l.height) };
  for (let i = 0; i < a.data.length; i++) a.data[i] = l.data[i * 4 + 3];
  const b = maskBounds(a);
  return b ? { x: b.x + l.x, y: b.y + l.y, w: b.w, h: b.h } : null;
}
/** The layer shrunk to its content: null when it already fits, or has nothing to keep. */
export function cropToContent(l: Layer): LayerGeom | null {
  const b = contentBox(l);
  if (!b || (b.w === l.width && b.h === l.height)) return null;
  const data = new Uint8ClampedArray(b.w * b.h * 4), ox = b.x - l.x, oy = b.y - l.y;
  for (let y = 0; y < b.h; y++) data.set(l.data.subarray(((oy + y) * l.width + ox) * 4, ((oy + y) * l.width + ox + b.w) * 4), y * b.w * 4);
  return { x: b.x, y: b.y, width: b.w, height: b.h, data };
}
/** Every see-through part filled with `bg` (as if laid on it), and the layer fully solid. Null when nothing is see-through. */
export function removeAlpha(data: Uint8ClampedArray, bg: RGBA): Uint8ClampedArray | null {
  let any = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { any = true; break; }
  if (!any) return null;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    out[i] = Math.round((data[i] * a + bg.r * (255 - a)) / 255);
    out[i + 1] = Math.round((data[i + 1] * a + bg.g * (255 - a)) / 255);
    out[i + 2] = Math.round((data[i + 2] * a + bg.b * (255 - a)) / 255);
    out[i + 3] = 255;
  }
  return out;
}
/** Solid becomes see-through and see-through becomes solid; colours stay. */
export function invertAlpha(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = data.slice();
  for (let i = 3; i < out.length; i += 4) out[i] = 255 - out[i];
  return out;
}
/**
 * Lift the selected pixels of `l` into a new layer just above it (Layer via Cut): the new layer holds them, cut to the
 * selection's box, and they leave `l`. One undo step. Null when the selection holds none of the layer's pixels.
 */
export function floatSelection(doc: Doc, l: Layer, m: Mask, name: string): Command | null {
  const box = maskBounds(m);
  if (!box) return null;
  const x0 = Math.max(box.x, l.x), y0 = Math.max(box.y, l.y), x1 = Math.min(box.x + box.w, l.x + l.width), y1 = Math.min(box.y + box.h, l.y + l.height);
  if (x1 <= x0 || y1 <= y0) return null;
  const fw = x1 - x0, fh = y1 - y0, lifted = new Uint8ClampedArray(fw * fh * 4), left = l.data.slice();
  let any = false;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = m.data[y * m.width + x], i = ((y - l.y) * l.width + (x - l.x)) * 4, o = ((y - y0) * fw + (x - x0)) * 4, a = l.data[i + 3];
    if (!k || !a) continue;
    lifted[o] = l.data[i]; lifted[o + 1] = l.data[i + 1]; lifted[o + 2] = l.data[i + 2];
    lifted[o + 3] = Math.round((a * k) / 255);
    left[i + 3] = Math.round((a * (255 - k)) / 255);
    any = true;
  }
  if (!any) return null;
  const before = snapshotDoc(doc), at = doc.layers.indexOf(l), n = createLayer(name, fw, fh, { x: x0, y: y0, data: lifted });
  if (l.parentId) n.parentId = l.parentId;
  l.data = left;
  doc.layers.splice(at + 1, 0, n);
  doc.activeId = n.id;
  return docCommand('Lift into a new layer', before, snapshotDoc(doc));
}
/**
 * Split a layer into one layer per main colour (at most `n`): the colours are found by k-means on the layer's solid
 * pixels, each pixel goes to the nearest one, and each group keeps its own original colours. Biggest group first.
 */
export function splitByColour(l: Pick<Layer, 'width' | 'height' | 'data'>, n: number): { color: RGBA; data: Uint8ClampedArray; count: number }[] {
  const d = l.data, total = l.width * l.height, idx: number[] = [];
  for (let p = 0; p < total; p++) if (d[p * 4 + 3] > 0) idx.push(p);
  if (!idx.length) return [];
  const step = Math.max(1, Math.floor(idx.length / 20000)), sample = idx.filter((_, k) => k % step === 0);
  const dist = (p: number, c: number[]): number => (d[p * 4] - c[0]) ** 2 + (d[p * 4 + 1] - c[1]) ** 2 + (d[p * 4 + 2] - c[2]) ** 2;
  const centres: number[][] = [[d[sample[0] * 4], d[sample[0] * 4 + 1], d[sample[0] * 4 + 2]]];
  while (centres.length < n) {
    let best = -1, far = 0;
    for (const p of sample) { const m = Math.min(...centres.map((c) => dist(p, c))); if (m > far) { far = m; best = p; } }
    if (best < 0) break;
    centres.push([d[best * 4], d[best * 4 + 1], d[best * 4 + 2]]);
  }
  const nearest = (p: number): number => { let k = 0, m = Infinity; centres.forEach((c, j) => { const v = dist(p, c); if (v < m) { m = v; k = j; } }); return k; };
  for (let it = 0; it < 8; it++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (const p of sample) { const s = sum[nearest(p)]; s[0] += d[p * 4]; s[1] += d[p * 4 + 1]; s[2] += d[p * 4 + 2]; s[3]++; }
    sum.forEach((s, j) => { if (s[3]) centres[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const groups = centres.map((c) => ({ color: { r: Math.round(c[0]), g: Math.round(c[1]), b: Math.round(c[2]), a: 255 }, data: new Uint8ClampedArray(d.length), count: 0 }));
  for (const p of idx) { const g = groups[nearest(p)]; g.data.set(d.subarray(p * 4, p * 4 + 4), p * 4); g.count++; }
  return groups.filter((g) => g.count > 0).sort((a, b) => b.count - a.count);
}
/** The whole stack in the active node's folder turned upside down, each folder moving with its contents. Null when fewer than two. */
export function reversedOrder(layers: readonly Layer[], id: string): Layer[] | null {
  const sibs = siblingIndexes(layers, id);
  if (sibs.length < 2) return null;
  const blocks = sibs.map((i) => subtreeRange(layers, layers[i].id) as [number, number]);
  const lo = blocks[0][0], hi = blocks[blocks.length - 1][1];
  return [...layers.slice(0, lo), ...blocks.reverse().flatMap(([a, b]) => layers.slice(a, b + 1)), ...layers.slice(hi + 1)];
}

// ---- Refine edge, clean edge colours, the selection editor ------------------------------------------------------------
export interface RefineOpts { radius: number; smooth: number; feather: number; shift: number; }
/**
 * Refine edge: first, within `radius` pixels of the edge, the selection follows the picture (edgeByColour); then it is
 * smoothed, its edge moved out (shift > 0) or in (shift < 0), and feathered, in that order. Each step is skipped at 0.
 */
export function refineEdge(src: Pixels, m: Mask, o: RefineOpts): Mask {
  let out = o.radius > 0 ? edgeByColour(src, m, o.radius) : m;
  if (o.smooth > 0) out = smoothMask(out, o.smooth);
  if (o.shift > 0) out = expandMask(out, o.shift);
  else if (o.shift < 0) out = contractMask(out, -o.shift);
  if (o.feather > 0) out = featherMask(out, o.feather);
  return out;
}
/**
 * The colour-aware edge. Pixels further than `r` from the edge are sure: inside or outside. Each pixel nearer the edge
 * is compared with the average colour of the sure inside around it (F) and of the sure outside around it (B), weighted
 * by distance, and is selected as far as its colour lies from B towards F (0 at B, 255 at F). Where F and B are less than
 * 20 levels apart, or one side has no sure pixels nearby, the edge stays as it was.
 */
export function edgeByColour(src: Pixels, m: Mask, r: number): Mask {
  const { width: w, height: h } = m, n = w * h, d = src.data, r2 = r * r, sure = new Int8Array(n);
  let dist = distanceSquared(w, h, (i) => m.data[i] < 128);
  for (let i = 0; i < n; i++) if (m.data[i] >= 128 && dist[i] > r2) sure[i] = 1;
  dist = distanceSquared(w, h, (i) => m.data[i] >= 128);
  for (let i = 0; i < n; i++) if (m.data[i] < 128 && dist[i] > r2) sure[i] = -1;
  const band: number[] = [];
  for (let i = 0; i < n; i++) if (!sure[i]) band.push(i);
  if (!band.length) return m;
  const vals = new Float32Array(band.length * 8), plane = new Float32Array(n), sigma = r + 1;
  for (let c = 0; c < 8; c++) {
    const side = c < 4 ? 1 : -1, ch = (c % 4) - 1;
    for (let i = 0; i < n; i++) plane[i] = sure[i] === side ? (ch < 0 ? 1 : d[i * 4 + ch]) : 0;
    blurPlane(plane, w, h, sigma);
    for (let k = 0; k < band.length; k++) vals[k * 8 + c] = plane[band[k]];
  }
  const out: Mask = { width: w, height: h, data: m.data.slice() };
  for (let k = 0; k < band.length; k++) {
    const v = vals.subarray(k * 8, k * 8 + 8);
    if (v[0] < 1e-4 || v[4] < 1e-4) continue;
    const br = v[5] / v[4], bg = v[6] / v[4], bb = v[7] / v[4], dr = v[1] / v[0] - br, dg = v[2] / v[0] - bg, db = v[3] / v[0] - bb;
    const den = dr * dr + dg * dg + db * db, p = band[k] * 4;
    if (den < 400) continue;
    const t = ((d[p] - br) * dr + (d[p + 1] - bg) * dg + (d[p + 2] - bb) * db) / den;
    out.data[band[k]] = Math.round(Math.min(1, Math.max(0, t)) * 255);
  }
  return out;
}
/**
 * Clean edge colours (Defringe; Decontaminate colours in Refine edge). `solid(i)` says how solid pixel i is (0..255).
 * Pixels that are fully solid and further than `width` pixels from anything less solid keep their colour; every other
 * pixel with some solidity takes the colour of the solid part next to it, spread outward ring by ring (the average of
 * its already-clean neighbours). `amount` 0..1 blends from the old colour to that. Alpha never changes. Null when no
 * pixel changes.
 */
export function cleanEdgeColours(data: Uint8ClampedArray, w: number, h: number, solid: (i: number) => number, width: number, amount = 1): Uint8ClampedArray | null {
  const n = w * h, thin = distanceSquared(w, h, (i) => solid(i) < 255), w2 = width * width;
  const state = new Uint8Array(n), col = new Float32Array(n * 3);
  let front: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = solid(i);
    if (s === 255 && thin[i] > w2) { state[i] = 1; col[i * 3] = data[i * 4]; col[i * 3 + 1] = data[i * 4 + 1]; col[i * 3 + 2] = data[i * 4 + 2]; }
    else if (s > 0) state[i] = 2;
  }
  const near = (p: number, f: (q: number) => void): void => {
    const x = p % w, y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h) f(yy * w + xx);
    }
  };
  for (let i = 0; i < n; i++) if (state[i] === 2) { let k = false; near(i, (q) => { if (state[q] === 1) k = true; }); if (k) { state[i] = 3; front.push(i); } }
  const done: number[] = [];
  while (front.length) {
    const got = front.map((p) => {
      let r = 0, g = 0, b = 0, c = 0;
      near(p, (q) => { if (state[q] === 1) { r += col[q * 3]; g += col[q * 3 + 1]; b += col[q * 3 + 2]; c++; } });
      return [r / c, g / c, b / c];
    });
    front.forEach((p, k) => { state[p] = 1; col.set(got[k], p * 3); done.push(p); });
    const next: number[] = [];
    for (const p of front) near(p, (q) => { if (state[q] === 2) { state[q] = 3; next.push(q); } });
    front = next;
  }
  const out = data.slice();
  let changed = false;
  for (const p of done) for (let c = 0; c < 3; c++) {
    const v = Math.round(data[p * 4 + c] + (col[p * 3 + c] - data[p * 4 + c]) * amount);
    if (v !== out[p * 4 + c]) { out[p * 4 + c] = v; changed = true; }
  }
  return changed ? out : null;
}
/**
 * One round dab of radius `r` (picture pixels) at (cx, cy), painted into the mask in place, with a one-pixel soft rim:
 * `add` raises pixels towards 255 (selected), otherwise lowers them towards 0. Gives the box it touched, or null.
 */
export function dabMask(m: Mask, cx: number, cy: number, r: number, add: boolean): Rect | null {
  const x0 = Math.max(0, Math.floor(cx - r - 1)), y0 = Math.max(0, Math.floor(cy - r - 1));
  const x1 = Math.min(m.width, Math.ceil(cx + r + 1)), y1 = Math.min(m.height, Math.ceil(cy + r + 1));
  if (x1 <= x0 || y1 <= y0) return null;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const cov = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
    if (!cov) continue;
    const p = y * m.width + x, v = Math.round(cov * 255);
    m.data[p] = add ? Math.max(m.data[p], v) : Math.min(m.data[p], 255 - v);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---- Find layers ------------------------------------------------------------------------------------------------------
export type LayerFindKind = Exclude<LayerKind, 'pixel'> | 'pixel' | 'text' | 'shape';
/** What a person would call the layer: picture, text, shape, folder, light and colour, or colour fill. */
export const layerKindOf = (l: Pick<Layer, 'kind' | 'content'>): LayerFindKind => (l.kind && l.kind !== 'pixel' ? l.kind : l.content?.kind ?? 'pixel');
/** Find layers: each condition left out matches everything. `text` looks in the name, the notes and the tags. */
export interface LayerFind { text?: string; kind?: LayerFindKind; label?: LayerLabel | 'none'; state?: 'hidden' | 'visible' | 'locked' | 'unlocked'; fx?: boolean; }
export function findLayers(layers: readonly Layer[], q: LayerFind): Layer[] {
  const t = q.text?.trim().toLowerCase();
  return layers.filter((l) => (!t || l.name.toLowerCase().includes(t) || !!l.meta?.notes.toLowerCase().includes(t) || !!l.meta?.tags.some((g) => g.toLowerCase().includes(t)))
    && (!q.kind || layerKindOf(l) === q.kind)
    && (!q.label || (l.label ?? 'none') === q.label)
    && (!q.state || (q.state === 'hidden' ? !l.visible : q.state === 'visible' ? l.visible : q.state === 'locked' ? !!l.locked : !l.locked))
    && (!q.fx || !!l.fx?.on));
}
