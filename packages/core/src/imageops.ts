// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Whole-picture and whole-layer operations: picture size, canvas size, turning and flipping, trim, reveal all,
 * merging and flattening, and the inverse selection. Each applies its change and returns the Command for the history.
 */
import { WHITE, type RGBA } from './color';
import { compositeRect } from './composite';
import { activeLayer, hasPixels, isFolder, createLayer, docRect, flatten, geomOf, indexOfLayer, layerRect, selectionAlpha, type Bitmap, type Doc, type Layer,
  type LayerMask, type Selection } from './document';
import { plusMask, shiftMask } from './mask';
import { union, type Rect } from './geometry';
import { docCommand, geomCommand, snapshotDoc, type Command, type DocState } from './history';
import { cropDocument } from './ops';
import { effectiveBox, repairTree, shownInTree, siblingBelow, subtreeOf, subtreeRange } from './tree';

export type Resample = 'smooth' | 'pixel';
export type Turn = 'cw' | 'ccw' | '180' | 'flip-h' | 'flip-v';
const TURN_LABEL: Record<Turn, string> = { cw: 'Turn right 90°', ccw: 'Turn left 90°', '180': 'Turn 180°', 'flip-h': 'Mirror left to right', 'flip-v': 'Flip top to bottom' };

function commit(doc: Doc, label: string, before: DocState, after: DocState): Command {
  const cmd = docCommand(label, before, after);
  cmd.redo(doc);
  return cmd;
}
/** Tent-filter weights: averages over the footprint when shrinking, blends neighbours when enlarging. */
function weights(srcLen: number, dstLen: number): { idx: Int32Array; w: Float32Array; n: number } {
  const scale = srcLen / dstLen, support = Math.max(1, scale), n = Math.ceil(support) * 2 + 1;
  const idx = new Int32Array(dstLen * n), w = new Float32Array(dstLen * n);
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) * scale - 0.5, start = Math.floor(center - support) + 1;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const j = start + k, t = Math.max(0, 1 - Math.abs(j - center) / support);
      idx[i * n + k] = Math.min(srcLen - 1, Math.max(0, j));
      w[i * n + k] = t;
      sum += t;
    }
    if (sum > 0) for (let k = 0; k < n; k++) w[i * n + k] /= sum;
  }
  return { idx, w, n };
}
/** Redraw pixels at a new size. "smooth" works on premultiplied colour so see-through edges never darken. */
export function resizeBitmap(src: Bitmap, w: number, h: number, mode: Resample = 'smooth'): Uint8ClampedArray {
  const sw = src.width, sh = src.height, s = src.data, out = new Uint8ClampedArray(w * h * 4);
  if (mode === 'pixel') {
    for (let y = 0; y < h; y++) {
      const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / w)), i = (y * w + x) * 4, j = (sy * sw + sx) * 4;
        out[i] = s[j]; out[i + 1] = s[j + 1]; out[i + 2] = s[j + 2]; out[i + 3] = s[j + 3];
      }
    }
    return out;
  }
  const pre = new Float32Array(sw * sh * 4);
  for (let i = 0; i < pre.length; i += 4) { const a = s[i + 3] / 255; pre[i] = s[i] * a; pre[i + 1] = s[i + 1] * a; pre[i + 2] = s[i + 2] * a; pre[i + 3] = s[i + 3]; }
  const hx = weights(sw, w), hy = weights(sh, h), tmp = new Float32Array(w * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0, o = x * hx.n; k < hx.n; k++) {
      const wt = hx.w[o + k];
      if (!wt) continue;
      const j = (y * sw + hx.idx[o + k]) * 4;
      r += pre[j] * wt; g += pre[j + 1] * wt; b += pre[j + 2] * wt; a += pre[j + 3] * wt;
    }
    const i = (y * w + x) * 4;
    tmp[i] = r; tmp[i + 1] = g; tmp[i + 2] = b; tmp[i + 3] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0, o = y * hy.n; k < hy.n; k++) {
      const wt = hy.w[o + k];
      if (!wt) continue;
      const j = (hy.idx[o + k] * w + x) * 4;
      r += tmp[j] * wt; g += tmp[j + 1] * wt; b += tmp[j + 2] * wt; a += tmp[j + 3] * wt;
    }
    const i = (y * w + x) * 4;
    if (a > 0.5) { const f = 255 / a; out[i] = r * f; out[i + 1] = g * f; out[i + 2] = b * f; out[i + 3] = a; }
  }
  return out;
}
/** Turn or flip a grey mask's pixels. */
function turnGrey(d: Uint8Array, w: number, h: number, t: Turn): Uint8Array {
  const swap = t === 'cw' || t === 'ccw', W = swap ? h : w, H = swap ? w : h, out = new Uint8Array(d.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sx: number, sy: number;
    if (t === 'cw') { sx = y; sy = h - 1 - x; } else if (t === 'ccw') { sx = w - 1 - y; sy = x; } else if (t === '180') { sx = w - 1 - x; sy = h - 1 - y; }
    else if (t === 'flip-h') { sx = w - 1 - x; sy = y; } else { sx = x; sy = h - 1 - y; }
    out[y * W + x] = d[sy * w + sx];
  }
  return out;
}
/** A mask turned with the frame it sits in (the layer's box or the canvas); (nx, ny) is the frame's top-left afterwards. */
export function turnMask(m: LayerMask, f: Rect, nx: number, ny: number, t: Turn): LayerMask {
  const bx = m.x, by = m.y, w = m.width, h = m.height, swap = t === 'cw' || t === 'ccw';
  let x: number, y: number;
  if (t === 'cw') { x = nx + f.y + f.h - (by + h); y = ny + bx - f.x; } else if (t === 'ccw') { x = nx + by - f.y; y = ny + f.x + f.w - (bx + w); }
  else if (t === '180') { x = nx + f.x + f.w - (bx + w); y = ny + f.y + f.h - (by + h); }
  else if (t === 'flip-h') { x = nx + f.x + f.w - (bx + w); y = ny + by - f.y; } else { x = nx + bx - f.x; y = ny + f.y + f.h - (by + h); }
  return { ...m, x, y, width: swap ? h : w, height: swap ? w : h, data: w && h ? turnGrey(m.data, w, h, t) : m.data };
}
/** A mask redrawn at a new picture scale, placed the way its layer is. */
export function resizeMask(m: LayerMask, sx: number, sy: number, mode: Resample = 'smooth'): LayerMask {
  const x = Math.round(m.x * sx), y = Math.round(m.y * sy);
  if (!m.width || !m.height) return { ...m, x, y };
  const nw = Math.max(1, Math.round(m.width * sx)), nh = Math.max(1, Math.round(m.height * sy)), rgba = new Uint8ClampedArray(m.data.length * 4);
  for (let i = 0; i < m.data.length; i++) { rgba[i * 4] = m.data[i]; rgba[i * 4 + 3] = 255; }
  const px = resizeBitmap({ width: m.width, height: m.height, data: rgba }, nw, nh, mode), data = new Uint8Array(nw * nh);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4];
  return { ...m, x, y, width: nw, height: nh, data };
}
const withMask = (l: Layer, f: (m: LayerMask) => LayerMask): { mask?: LayerMask } => (l.mask ? { mask: f(l.mask) } : {});
/** Picture size: every layer is redrawn at the new scale. */
export function resizeDocument(doc: Doc, width: number, height: number, mode: Resample = 'smooth'): Command | null {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  if (w === doc.width && h === doc.height) return null;
  const sx = w / doc.width, sy = h / doc.height, before = snapshotDoc(doc);
  const layers = doc.layers.map((l) => {
    const nw = Math.max(1, Math.round(l.width * sx)), nh = Math.max(1, Math.round(l.height * sy));
    return { ...l, x: Math.round(l.x * sx), y: Math.round(l.y * sy), width: nw, height: nh, data: resizeBitmap(l, nw, nh, mode), ...withMask(l, (m) => resizeMask(m, sx, sy, mode)) };
  });
  return commit(doc, 'Picture size', before, { width: w, height: h, layers, activeId: doc.activeId, selection: null });
}
/**
 * Canvas size: more or less room around the picture. `ax`, `ay` (0, 0.5 or 1) say which side stays put. With `fill`,
 * the bottom layer is extended with that colour; otherwise new room is see-through.
 */
export function resizeCanvas(doc: Doc, width: number, height: number, ax = 0.5, ay = 0.5, fill: RGBA | null = null): Command | null {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  if (w === doc.width && h === doc.height) return null;
  const dx = Math.round((w - doc.width) * ax), dy = Math.round((h - doc.height) * ay), before = snapshotDoc(doc);
  const layers = doc.layers.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy, ...withMask(l, (m) => shiftMask(m, dx, dy)) }));
  if (fill && fill.a > 0 && layers.length) {
    const b = layers[0], data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = fill.r; data[i + 1] = fill.g; data[i + 2] = fill.b; data[i + 3] = fill.a; }
    for (let y = Math.max(0, b.y); y < Math.min(h, b.y + b.height); y++) for (let x = Math.max(0, b.x); x < Math.min(w, b.x + b.width); x++) {
      const j = ((y - b.y) * b.width + (x - b.x)) * 4, i = (y * w + x) * 4, a = b.data[j + 3] / 255;
      for (let c = 0; c < 3; c++) data[i + c] = b.data[j + c] * a + data[i + c] * (1 - a);
      data[i + 3] = Math.max(data[i + 3], b.data[j + 3]);
    }
    layers[0] = { ...b, x: 0, y: 0, width: w, height: h, data };
  }
  return commit(doc, 'Canvas size', before, { width: w, height: h, layers, activeId: doc.activeId, selection: null });
}
/** Turn or flip a block of pixels. */
export function turnPixels(b: Bitmap, t: Turn): Bitmap {
  const w = b.width, h = b.height, s = b.data, swap = t === 'cw' || t === 'ccw', W = swap ? h : w, H = swap ? w : h;
  const out = new Uint8ClampedArray(s.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sx: number, sy: number;
    if (t === 'cw') { sx = y; sy = h - 1 - x; } else if (t === 'ccw') { sx = w - 1 - y; sy = x; } else if (t === '180') { sx = w - 1 - x; sy = h - 1 - y; }
    else if (t === 'flip-h') { sx = w - 1 - x; sy = y; } else { sx = x; sy = h - 1 - y; }
    const i = (y * W + x) * 4, j = (sy * w + sx) * 4;
    out[i] = s[j]; out[i + 1] = s[j + 1]; out[i + 2] = s[j + 2]; out[i + 3] = s[j + 3];
  }
  return { width: W, height: H, data: out };
}
/** Turn or flip the whole picture: every layer and the canvas. */
export function turnDocument(doc: Doc, t: Turn): Command {
  const W = doc.width, H = doc.height, before = snapshotDoc(doc);
  const layers = doc.layers.map((l) => {
    const p = turnPixels(l, t);
    let x = l.x, y = l.y;
    if (t === 'cw') { x = H - (l.y + l.height); y = l.x; } else if (t === 'ccw') { x = l.y; y = W - (l.x + l.width); }
    else if (t === '180') { x = W - (l.x + l.width); y = H - (l.y + l.height); } else if (t === 'flip-h') x = W - (l.x + l.width); else y = H - (l.y + l.height);
    return { ...l, x, y, width: p.width, height: p.height, data: p.data, ...withMask(l, (m) => turnMask(m, { x: 0, y: 0, w: W, h: H }, 0, 0, t)) };
  });
  const swap = t === 'cw' || t === 'ccw';
  return commit(doc, TURN_LABEL[t], before, { width: swap ? H : W, height: swap ? W : H, layers, activeId: doc.activeId, selection: null });
}
/** Turn or flip the active layer around its own centre. */
export function turnLayer(doc: Doc, t: Turn): Command | null {
  const l = activeLayer(doc);
  if (!l) return null;
  const p = turnPixels(l, t), cx = l.x + l.width / 2, cy = l.y + l.height / 2, nx = Math.round(cx - p.width / 2), ny = Math.round(cy - p.height / 2);
  const mb = l.mask, ma = mb?.linked ? turnMask(mb, layerRect(l), nx, ny, t) : mb;
  const g = geomCommand(TURN_LABEL[t], l.id, geomOf(l), { x: nx, y: ny, width: p.width, height: p.height, data: p.data });
  const cmd = ma === mb ? g : plusMask(g, l.id, mb, ma);
  cmd.redo(doc);
  return cmd;
}
/** The part of the flattened picture that is not see-through (or, when the corner is solid, not the corner colour). */
export function trimBounds(doc: Doc): Rect | null {
  const f = flatten(doc).data, W = doc.width, H = doc.height, alphaMode = f[3] < 255;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const keep = alphaMode ? f[i + 3] > 0 : f[i] !== f[0] || f[i + 1] !== f[1] || f[i + 2] !== f[2] || f[i + 3] !== f[3];
    if (!keep) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export function trimDocument(doc: Doc): Command | null {
  const r = trimBounds(doc);
  if (!r || (r.w === doc.width && r.h === doc.height)) return null;
  return cropDocument(doc, r);
}
/** Grow the canvas so every layer fits inside it. */
export function revealAll(doc: Doc): Command | null {
  let u: Rect | null = docRect(doc);
  for (const l of doc.layers) u = union(u, layerRect(l));
  const r = u as Rect;
  if (r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height) return null;
  const before = snapshotDoc(doc);
  const layers = doc.layers.map((l) => ({ ...l, x: l.x - r.x, y: l.y - r.y, ...withMask(l, (m) => shiftMask(m, -r.x, -r.y)) }));
  return commit(doc, 'Reveal all', before, { width: r.w, height: r.h, layers, activeId: doc.activeId, selection: null });
}
/** Why merge down can't run on the active node, in plain words; null when it can. */
export function mergeDownRefusal(doc: Doc): string | null {
  const a = activeLayer(doc);
  if (!a) return 'Choose a layer first.';
  if (isFolder(a)) return null; // merges the folder into one layer
  if (!hasPixels(a)) return 'This layer has no pixels of its own to merge.';
  const below = siblingBelow(doc.layers, a.id);
  if (!below) return 'There is no layer below it in the same folder.';
  if (isFolder(below)) return 'The layer below is a folder: open it, or merge the folder first.';
  if (!hasPixels(below)) return 'The layer below has no pixels of its own.';
  return null;
}
/**
 * Combine the active layer with the one below it in the same folder, baked as it looks (mask and clipping drawn in); the
 * result keeps the lower layer's name, opacity, blend and place. An active folder is merged into one layer in its place.
 */
export function mergeDown(doc: Doc): Command | null {
  const top = activeLayer(doc);
  if (!top || mergeDownRefusal(doc)) return null;
  if (isFolder(top)) return mergeFolder(doc, top.id);
  const below = siblingBelow(doc.layers, top.id) as Layer, i = indexOfLayer(doc, top.id);
  const r = union(layerRect(top), layerRect(below)) as Rect, before = snapshotDoc(doc);
  const base: Layer = { ...below, visible: true, opacity: 1, blendMode: 'normal', clip: false };
  delete base.parentId;
  const upper: Layer = { ...top };
  delete upper.parentId;
  const data = compositeRect([base, upper], r, null);
  const merged: Layer = { ...below, x: r.x, y: r.y, width: r.w, height: r.h, data };
  delete merged.mask; // the masks are drawn into the merged pixels
  const layers = doc.layers.slice();
  layers.splice(i - 1, 2, merged);
  return commit(doc, 'Merge down', before, { width: doc.width, height: doc.height, layers, activeId: merged.id, selection: doc.selection ? { ...doc.selection } : null });
}
/** Merge the folder: everything inside drawn into one pixel layer in the folder's place, with its name, opacity and blend. */
export function mergeFolder(doc: Doc, id: string): Command | null {
  const sub = subtreeOf(doc.layers, id), f = sub[sub.length - 1];
  if (!f || !isFolder(f)) return null;
  const box = effectiveBox(doc.layers, f) ?? { x: 0, y: 0, w: 1, h: 1 };
  const nodes = sub.map((l) => (l === f ? { ...f, visible: true, opacity: 1, blendMode: 'normal' as const, passThrough: false, clip: false, parentId: undefined } : l));
  const merged: Layer = { id: f.id, name: f.name, visible: f.visible, opacity: f.opacity, blendMode: f.blendMode, x: box.x, y: box.y, width: box.w, height: box.h,
    data: compositeRect(nodes, box, null) };
  if (f.locked) merged.locked = true;
  if (f.parentId) merged.parentId = f.parentId;
  if (f.clip) merged.clip = true;
  const r = subtreeRange(doc.layers, id) as [number, number], before = snapshotDoc(doc);
  const layers = [...doc.layers.slice(0, r[0]), merged, ...doc.layers.slice(r[1] + 1)];
  return commit(doc, 'Merge the folder', before, { width: doc.width, height: doc.height, layers, activeId: merged.id, selection: doc.selection ? { ...doc.selection } : null });
}
/** Combine every shown node into one layer, placed where the lowest shown layer was. Hidden layers stay as they are. */
export function mergeVisible(doc: Doc): Command | null {
  const shown = doc.layers.filter((l) => hasPixels(l) && shownInTree(doc.layers, l));
  if (shown.length < 2) return null;
  let u: Rect | null = null;
  for (const l of shown) u = union(u, layerRect(l));
  const r = u as Rect, first = doc.layers.indexOf(shown[0]), before = snapshotDoc(doc);
  const merged: Layer = { ...shown[0], opacity: 1, blendMode: 'normal', locked: false, x: r.x, y: r.y, width: r.w, height: r.h, data: compositeRect(doc.layers, r, null) };
  delete merged.mask;
  delete merged.parentId;
  delete merged.clip;
  // Kept: hidden nodes with what is inside them. A kept node whose folder is merged moves to the nearest kept folder.
  const keep = doc.layers.filter((l) => !shownInTree(doc.layers, l) || (isFolder(l) && !subtreeOf(doc.layers, l.id).some((c) => shown.includes(c))));
  const kept = new Set(keep), byId = new Map(doc.layers.map((l) => [l.id, l]));
  const layers = keep.map((l) => {
    let p = l.parentId;
    while (p && !kept.has(byId.get(p) as Layer)) p = byId.get(p)?.parentId;
    const c = { ...l };
    if (p) c.parentId = p; else delete c.parentId;
    return c;
  });
  layers.splice(doc.layers.slice(0, first).filter((l) => kept.has(l)).length, 0, merged);
  return commit(doc, 'Merge visible', before, { width: doc.width, height: doc.height, layers: repairTree(layers), activeId: merged.id, selection: doc.selection ? { ...doc.selection } : null });
}
/** One layer with everything you see, on a solid background (white unless given). Hidden layers are dropped. */
export function flattenDocument(doc: Doc, background: RGBA | null = WHITE): Command | null {
  if (doc.layers.length < 2) return null;
  const before = snapshotDoc(doc), l = createLayer('Background', doc.width, doc.height, { data: flatten(doc, background).data });
  return commit(doc, 'Flatten', before, { width: doc.width, height: doc.height, layers: [l], activeId: l.id, selection: null });
}
/** Everything that is not selected now. Null when nothing (or everything) is selected. */
export function inverseSelection(doc: Doc): Selection | null {
  const s = doc.selection;
  if (!s) return null;
  const W = doc.width, H = doc.height, alpha = new Uint8Array(W * H);
  let any = false;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = 255 - selectionAlpha(s, x, y); alpha[y * W + x] = a; if (a) any = true; }
  return any ? { x: 0, y: 0, w: W, h: H, alpha } : null;
}
