// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * More ways to make and change a selection, and more layer commands (the select-and-layers batch, 13 Nov 2026).
 * Pure functions on masks and pixels, so each one is unit-tested on real numbers; the web module (selmore.ts) loads
 * this file on first use, never on the first screen. Masks are picture-sized, 0 (not selected) to 255 (selected).
 */
import type { RGBA } from './color';
import { createLayer, type Doc, type Layer, type LayerGeom } from './document';
import type { Rect } from './geometry';
import { docCommand, snapshotDoc, type Command } from './history';
import { contractMask, emptyMask, expandMask, maskBounds, type Mask, type Pixels } from './selection';
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
/** A layer's solid parts as a selection on a picture `w` x `h`: as selected as the layer is opaque. */
export function alphaMask(l: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'data'>, w: number, h: number): Mask {
  const m = emptyMask(w, h);
  const x0 = Math.max(0, l.x), y0 = Math.max(0, l.y), x1 = Math.min(w, l.x + l.width), y1 = Math.min(h, l.y + l.height);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m.data[y * w + x] = l.data[((y - l.y) * l.width + (x - l.x)) * 4 + 3];
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
