// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Layer and area operations. Each applies its change and returns the Command to push on the history. */
import { activeLayer, createLayer, docRect, duplicateLayer, findLayer, indexOfLayer, layerRect, layerRegion, nextLayerName,
  readRegion, selectionAlpha, writeRegion, type Bitmap, type Doc, type Layer, type Selection } from './document';
import { expandRect, intersect, type Rect } from './geometry';
import type { RGBA } from './color';
import { cropMask } from './mask';
import { deleteNode, duplicateNode, pixelLayerCount, siblingBelow } from './tree';
import { isFolder } from './document';
import { addLayerCommand, docCommand, pixelCommand, propsCommand, removeLayerCommand, reorderCommand, snapshotDoc,
  type Command, type DocState, type LayerProps } from './history';

export function addLayer(doc: Doc, layer: Layer, index = indexOfLayer(doc, doc.activeId) + 1, label?: string): Command {
  const i = Math.max(0, Math.min(doc.layers.length, index));
  // A new node joins the folder of the node just below it, so every folder's contents stay together (tree.ts).
  const below = i > 0 ? doc.layers[i - 1] : undefined;
  if (below?.parentId) layer.parentId = below.parentId; else delete layer.parentId;
  const cmd = addLayerCommand(layer, i, doc.activeId, label);
  cmd.redo(doc);
  return cmd;
}
export const addEmptyLayer = (doc: Doc): Command => addLayer(doc, createLayer(nextLayerName(doc), doc.width, doc.height));
/** Duplicate the active node; a folder is copied with everything inside it. */
export function duplicateActive(doc: Doc): Command | null {
  const l = activeLayer(doc);
  if (!l) return null;
  if (isFolder(l)) return duplicateNode(doc, l.id);
  return addLayer(doc, duplicateLayer(l), indexOfLayer(doc, l.id) + 1, 'Duplicate layer');
}
/** Delete a node; a folder goes with everything inside it. The last layer with pixels can't be deleted. */
export function deleteLayer(doc: Doc, id: string): Command | null {
  const i = indexOfLayer(doc, id);
  if (i < 0) return null;
  if (isFolder(doc.layers[i])) return deleteNode(doc, id);
  if (pixelLayerCount(doc.layers) <= 1) return null;
  const next = (doc.layers[i + 1] ?? doc.layers[i - 1]).id;
  const cmd = removeLayerCommand(doc.layers[i], i, doc.activeId, doc.activeId === id ? next : doc.activeId);
  cmd.redo(doc);
  return cmd;
}
/** Show only inside the layer below · Create clipping mask: toggles `clip`. Null at the bottom of a folder (no base). */
export function toggleClip(doc: Doc, id: string): Command | null {
  const l = findLayer(doc, id);
  if (!l) return null;
  if (!l.clip && !siblingBelow(doc.layers, id)) return null;
  return setLayerProps(doc, id, { clip: l.clip ? undefined : true }, l.clip ? 'Show the whole layer' : 'Show only inside the layer below');
}
export function moveLayer(doc: Doc, from: number, to: number): Command | null {
  const n = doc.layers.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return null;
  const cmd = reorderCommand(from, to);
  cmd.redo(doc);
  return cmd;
}
const PROP_LABEL: Record<string, string> = { name: 'Rename layer', visible: 'Show or hide layer', opacity: 'Layer opacity', blendMode: 'Blend mode', x: 'Move layer', y: 'Move layer', passThrough: 'Folder blend' };
export function setLayerProps(doc: Doc, id: string, after: LayerProps, label?: string): Command | null {
  const l = findLayer(doc, id);
  if (!l) return null;
  const before: Record<string, unknown> = {};
  let changed = false;
  for (const k of Object.keys(after) as (keyof LayerProps)[]) { before[k] = l[k]; if (l[k] !== after[k]) changed = true; }
  if (!changed) return null;
  const cmd = propsCommand(id, before as LayerProps, after, label ?? PROP_LABEL[Object.keys(after)[0]] ?? 'Layer change');
  cmd.redo(doc);
  return cmd;
}
/** Mix a result into the layer through a soft selection mask. Plain rectangles need no mixing. */
function maskInto(l: Layer, r: Rect, before: Uint8ClampedArray, result: Uint8ClampedArray, sel: Selection | null): Uint8ClampedArray {
  if (!sel || !sel.alpha) return result;
  const out = new Uint8ClampedArray(result.length);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const a = selectionAlpha(sel, r.x + x + l.x, r.y + y + l.y) / 255, i = (y * r.w + x) * 4;
    for (let c = 0; c < 4; c++) out[i + c] = before[i + c] + (result[i + c] - before[i + c]) * a;
  }
  return out;
}
/** Where an edit applies on a layer: the selection within the canvas, or the whole layer. Layer coordinates. */
export function editRegion(doc: Doc, l: Layer): Rect | null {
  return doc.selection ? layerRegion(l, intersect(doc.selection, docRect(doc))) : layerRegion(l, null);
}
export function fillSelection(doc: Doc, l: Layer, c: RGBA, label = 'Fill'): Command | null {
  const r = editRegion(doc, l);
  if (!r) return null;
  const before = readRegion(l, r);
  const res = new Uint8ClampedArray(before.length);
  for (let i = 0; i < res.length; i += 4) { res[i] = c.r; res[i + 1] = c.g; res[i + 2] = c.b; res[i + 3] = c.a; }
  writeRegion(l, r, maskInto(l, r, before, res, doc.selection));
  return pixelCommand(label, l.id, r, before);
}
export const clearSelection = (doc: Doc, l: Layer): Command | null => fillSelection(doc, l, { r: 0, g: 0, b: 0, a: 0 }, 'Delete pixels');
/** The edit region grown by `pad` pixels and clipped to the layer, so blurs can read their neighbours. */
export function paddedRegion(l: Layer, r: Rect, pad: number): Rect {
  return intersect(expandRect(r, Math.max(0, Math.ceil(pad))), { x: 0, y: 0, w: l.width, h: l.height }) as Rect;
}
/** Cut the inner rectangle `r` out of a result computed on `padded`. */
export function innerOf(res: Uint8ClampedArray, padded: Rect, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y - padded.y + y) * padded.w + (r.x - padded.x)) * 4;
    out.set(res.subarray(s, s + r.w * 4), y * r.w * 4);
  }
  return out;
}
/** Write a computed result (already cut to `r`) and return its undo entry. `before` holds the old pixels of `r`. */
export function commitResult(doc: Doc, l: Layer, r: Rect, before: Uint8ClampedArray, result: Uint8ClampedArray, label: string): Command {
  writeRegion(l, r, maskInto(l, r, before, result, doc.selection));
  return pixelCommand(label, l.id, r, before);
}
/** Run an adjustment or filter on the selected part of a layer, right here (the web app uses a worker instead). */
export function applyToLayer(doc: Doc, l: Layer, label: string, fn: (src: Bitmap) => Uint8ClampedArray, pad = 0): Command | null {
  const r = editRegion(doc, l);
  if (!r) return null;
  const p = paddedRegion(l, r, pad);
  const res = fn({ width: p.w, height: p.h, data: readRegion(l, p) });
  return commitResult(doc, l, r, readRegion(l, r), innerOf(res, p, r), label);
}
/** Crop the canvas to `area`. Pixels outside it are removed from every layer. */
export function cropDocument(doc: Doc, area: Rect): Command | null {
  const cr = intersect(area, docRect(doc));
  if (!cr) return null;
  const before = snapshotDoc(doc);
  const layers = doc.layers.map((l) => {
    const ir = intersect(layerRect(l), cr), mask = l.mask ? { mask: cropMask(l.mask, cr) } : {};
    if (!ir) return { ...l, x: 0, y: 0, width: 1, height: 1, data: new Uint8ClampedArray(4), ...mask };
    return { ...l, x: ir.x - cr.x, y: ir.y - cr.y, width: ir.w, height: ir.h, data: readRegion(l, { x: ir.x - l.x, y: ir.y - l.y, w: ir.w, h: ir.h }), ...mask };
  });
  const after: DocState = { width: cr.w, height: cr.h, layers, activeId: doc.activeId, selection: null };
  const cmd = docCommand('Crop', before, after);
  cmd.redo(doc);
  return cmd;
}
