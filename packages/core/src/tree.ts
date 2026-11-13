// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The layer tree (design 2.1, rules L1 and L2). `doc.layers` stays one flat list, bottom to top. A folder's contents are
 * the unbroken run directly below the folder's own entry, so the folder sits on top of its contents, as in a PSD. The tree
 * is derived here when needed and never stored. Every structure edit goes through this file, and a node always moves with
 * its whole subtree.
 */
import { createFolder, hasPixels, isFolder, layerRect, newId, nextLayerName, type Doc, type Layer } from './document';
import { union, type Rect } from './geometry';
import type { Command } from './history';

/** The tree fields every node carries (Layer and the compositor's BlendLayer both fit). */
export interface TreeFields { id?: string; kind?: string; parentId?: string; }
export interface TreeNode<L extends TreeFields = Layer> { layer: L; index: number; parent: TreeNode<L> | null; children: TreeNode<L>[]; depth: number; }

/**
 * The tree from parentId and list order, O(n). A parent must be a folder higher in the list (so a cycle can't form);
 * anything else counts as top level. Children are bottom to top.
 */
export function buildTree<L extends TreeFields>(layers: readonly L[]): TreeNode<L>[] {
  const byId = new Map<string, TreeNode<L>>();
  const nodes = layers.map((layer, index) => {
    const n: TreeNode<L> = { layer, index, parent: null, children: [], depth: 0 };
    if (layer.id) byId.set(layer.id, n);
    return n;
  });
  const roots: TreeNode<L>[] = [];
  for (const n of nodes) {
    const p = n.layer.parentId ? byId.get(n.layer.parentId) : undefined;
    if (p && p.layer.kind === 'folder' && p.index > n.index) { n.parent = p; p.children.push(n); } else roots.push(n);
  }
  for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i]; n.depth = n.parent ? n.parent.depth + 1 : 0; }
  return roots;
}

const idMap = (layers: readonly Layer[]): Map<string, Layer> => new Map(layers.map((l) => [l.id, l]));
/** True when `l` sits inside the folder `folderId`, at any depth. */
function within(m: Map<string, Layer>, l: Layer, folderId: string): boolean {
  let p = l.parentId, guard = m.size + 1;
  while (p && guard-- > 0) { if (p === folderId) return true; p = m.get(p)?.parentId; }
  return false;
}
/** The folders around a node, nearest first. */
export function ancestors(layers: readonly Layer[], id: string): Layer[] {
  const m = idMap(layers), out: Layer[] = [];
  let p = m.get(id)?.parentId, guard = m.size + 1;
  while (p && guard-- > 0) { const f = m.get(p); if (!f) break; out.push(f); p = f.parentId; }
  return out;
}
export const depthOf = (layers: readonly Layer[], id: string): number => ancestors(layers, id).length;
/** Shown on the canvas: the node and every folder around it are visible. */
export const shownInTree = (layers: readonly Layer[], l: Layer): boolean => l.visible && ancestors(layers, l.id).every((a) => a.visible);
/** Locked by itself or by a folder around it. */
export const lockedInTree = (layers: readonly Layer[], l: Layer): boolean => !!l.locked || ancestors(layers, l.id).some((a) => a.locked);
/** The list positions [first, last] of a node and everything inside it; `last` is the node's own entry. */
export function subtreeRange(layers: readonly Layer[], id: string): [number, number] | null {
  const end = layers.findIndex((l) => l.id === id);
  if (end < 0) return null;
  let start = end;
  if (isFolder(layers[end])) { const m = idMap(layers); while (start > 0 && within(m, layers[start - 1], id)) start--; }
  return [start, end];
}
/** The node and everything inside it, bottom to top (the node last). */
export function subtreeOf(layers: readonly Layer[], id: string): Layer[] {
  const r = subtreeRange(layers, id);
  return r ? layers.slice(r[0], r[1] + 1) : [];
}
/** The positions of the nodes in the same folder as `id` (itself included), bottom to top. */
export function siblingIndexes(layers: readonly Layer[], id: string): number[] {
  const l = layers.find((x) => x.id === id);
  if (!l) return [];
  const out: number[] = [];
  layers.forEach((x, i) => { if ((x.parentId ?? '') === (l.parentId ?? '')) out.push(i); });
  return out;
}
/** The nearest node below in the same folder (its own entry), or null at the bottom of the folder. */
export function siblingBelow(layers: readonly Layer[], id: string): Layer | null {
  const s = siblingIndexes(layers, id), i = layers.findIndex((l) => l.id === id), k = s.indexOf(i);
  return k > 0 ? layers[s[k - 1]] : null;
}
export function siblingAbove(layers: readonly Layer[], id: string): Layer | null {
  const s = siblingIndexes(layers, id), i = layers.findIndex((l) => l.id === id), k = s.indexOf(i);
  return k >= 0 && k < s.length - 1 ? layers[s[k + 1]] : null;
}
/** Where a node can change the picture: its pixels, or for a folder everything inside it. Null when it has nothing. */
export function effectiveBox(layers: readonly Layer[], l: Layer): Rect | null {
  if (!isFolder(l)) return hasPixels(l) ? layerRect(l) : null;
  let u: Rect | null = null;
  for (const c of subtreeOf(layers, l.id)) if (c !== l && hasPixels(c)) u = union(u, layerRect(c));
  return u;
}
/** The number of layers with pixels (folders and other nodes aside). */
export const pixelLayerCount = (layers: readonly Layer[]): number => layers.filter(hasPixels).length;

/** Null when the list is a sound tree; otherwise what is wrong, in plain words. Tests run it after every structure edit. */
export function checkTree(layers: readonly Layer[]): string | null {
  const at = new Map<string, number>();
  for (let i = 0; i < layers.length; i++) {
    if (at.has(layers[i].id)) return `Two layers share the id ${layers[i].id}.`;
    at.set(layers[i].id, i);
  }
  const m = idMap(layers);
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!l.parentId) continue;
    const p = m.get(l.parentId);
    if (!p) return `${l.name} sits in a folder that is missing.`;
    if (!isFolder(p)) return `${l.name} sits inside ${p.name}, which is not a folder.`;
    if ((at.get(p.id) as number) <= i) return `${l.name} is above its folder ${p.name}.`;
  }
  for (let e = 0; e < layers.length; e++) {
    const f = layers[e];
    if (!isFolder(f)) continue;
    let n = 0;
    for (const l of layers) if (within(m, l, f.id)) n++;
    for (let k = 1; k <= n; k++) if (e - k < 0 || !within(m, layers[e - k], f.id)) return `The contents of ${f.name} are not together under it.`;
  }
  return null;
}
/**
 * Make any list a sound tree (run on every load: PSD, ORA, autosave, the command line). A missing, non-folder or looping
 * parent becomes the top level; a broken run is regrouped in order under its folder. A sound list comes back unchanged.
 */
export function repairTree(layers: Layer[]): Layer[] {
  const m = idMap(layers);
  for (const l of layers) {
    if (!l.parentId) continue;
    const p = m.get(l.parentId);
    let bad = !p || !isFolder(p) || p === l;
    if (!bad) { let q = p, guard = m.size + 1; while (q?.parentId && guard-- > 0) { if (q.parentId === l.id) { bad = true; break; } q = m.get(q.parentId); } if (guard <= 0) bad = true; }
    if (bad) delete l.parentId;
  }
  const kids = new Map<string, Layer[]>(), roots: Layer[] = [];
  for (const l of layers) { if (l.parentId) { const k = kids.get(l.parentId); if (k) k.push(l); else kids.set(l.parentId, [l]); } else roots.push(l); }
  const out: Layer[] = [];
  const emit = (l: Layer): void => { for (const c of kids.get(l.id) ?? []) emit(c); out.push(l); };
  roots.forEach(emit);
  return out.every((l, i) => l === layers[i]) ? layers : out;
}

// ---------- structure edits: each returns the new order and the new parent of each moved node ----------

/** A structure change: the full order and every parent, by id, before and after. */
export interface Shape { ids: string[]; parents: (string | undefined)[]; activeId: string; }
const shapeOf = (layers: readonly Layer[], activeId: string): Shape => ({ ids: layers.map((l) => l.id), parents: layers.map((l) => l.parentId), activeId });
/**
 * Undo entry for any structure change (design 5: `moveNodesCommand`). It works by id, so layer objects swapped by other
 * undo steps are found again; layers present on one side only are kept here while they are out of the document.
 */
export function moveNodesCommand(label: string, before: Shape, after: Shape, extra: Layer[] = []): Command {
  const pool = new Map(extra.map((l) => [l.id, l]));
  let bytes = 0;
  const inB = new Set(before.ids), inA = new Set(after.ids);
  for (const l of extra) if (!inB.has(l.id) || !inA.has(l.id)) bytes += l.data.length + (l.mask?.data.length ?? 0);
  const apply = (doc: Doc, s: Shape): void => {
    for (const l of doc.layers) pool.set(l.id, l);
    doc.layers = s.ids.map((id) => pool.get(id)).filter((l): l is Layer => !!l);
    s.ids.forEach((id, i) => { const l = pool.get(id); if (!l) return; const p = s.parents[i]; if (p) l.parentId = p; else delete l.parentId; });
    doc.activeId = s.activeId;
  };
  return { label, bytes, undo(doc) { apply(doc, before); }, redo(doc) { apply(doc, after); } };
}
/** Run a structure change on the document and return its undo entry (null when nothing changes). */
export function commitShape(doc: Doc, label: string, order: Layer[], parents: Map<Layer, string | undefined>, activeId = doc.activeId, extra: Layer[] = []): Command | null {
  const before = shapeOf(doc.layers, doc.activeId);
  const after: Shape = { ids: order.map((l) => l.id), parents: order.map((l) => (parents.has(l) ? parents.get(l) : l.parentId)), activeId };
  if (before.activeId === after.activeId && before.ids.length === after.ids.length && before.ids.every((id, i) => id === after.ids[i] && before.parents[i] === after.parents[i])) return null;
  const cmd = moveNodesCommand(label, before, after, [...doc.layers, ...extra]);
  cmd.redo(doc);
  return cmd;
}
function cut(layers: readonly Layer[], id: string): { rest: Layer[]; block: Layer[]; at: number } | null {
  const r = subtreeRange(layers, id);
  if (!r) return null;
  return { rest: [...layers.slice(0, r[0]), ...layers.slice(r[1] + 1)], block: layers.slice(r[0], r[1] + 1), at: r[0] };
}
export type Arrange = 'front' | 'forward' | 'backward' | 'back';
/**
 * Where a node goes for each arrange command (design 2.4): among its siblings with its whole subtree. Next to an open
 * folder it goes in (at the bottom when moving up, at the top when moving down); next to a closed folder it jumps over;
 * at a folder's edge it leaves the folder. Front and back stay inside the current folder. Null when it can't move.
 */
export function arrangePlan(layers: readonly Layer[], id: string, k: Arrange): { order: Layer[]; parentId: string | undefined } | null {
  const node = layers.find((l) => l.id === id), c = cut(layers, id);
  if (!node || !c) return null;
  const { rest, block } = c, pid = node.parentId, m = idMap(rest);
  const sibs: number[] = [];
  rest.forEach((x, i) => { if ((x.parentId ?? '') === (pid ?? '')) sibs.push(i); });
  const below = sibs.filter((i) => i < c.at), above = sibs.filter((i) => i >= c.at);
  const pr = pid ? subtreeRange(rest, pid) : null;
  const lo = pr ? pr[0] : 0, hi = pr ? pr[1] : rest.length;
  let at: number, parentId = pid;
  if (k === 'front') { if (!above.length) return null; at = hi; }
  else if (k === 'back') { if (!below.length) return null; at = lo; }
  else if (k === 'forward') {
    if (!above.length) { if (!pid) return null; at = hi + 1; parentId = m.get(pid)?.parentId; }
    else {
      const s = rest[above[0]];
      if (isFolder(s) && s.open) { at = (subtreeRange(rest, s.id) as [number, number])[0]; parentId = s.id; }
      else at = above[0] + 1;
    }
  } else {
    if (!below.length) { if (!pid) return null; at = lo; parentId = m.get(pid)?.parentId; }
    else {
      const si = below[below.length - 1], s = rest[si];
      if (isFolder(s) && s.open) { at = si; parentId = s.id; }
      else at = (subtreeRange(rest, s.id) as [number, number])[0];
    }
  }
  return { order: [...rest.slice(0, at), ...block, ...rest.slice(at)], parentId };
}
const ARRANGE_LABEL: Record<Arrange, string> = { front: 'Bring to the top', forward: 'Move layer up', backward: 'Move layer down', back: 'Send to the bottom' };
export function arrangeNode(doc: Doc, id: string, k: Arrange): Command | null {
  const p = arrangePlan(doc.layers, id, k), node = doc.layers.find((l) => l.id === id);
  if (!p || !node) return null;
  return commitShape(doc, ARRANGE_LABEL[k], p.order, new Map([[node, p.parentId]]));
}
/** A new empty, open folder directly above the active node, in the same folder (Folder of layers · Group). */
export function addFolder(doc: Doc, name = nextLayerName(doc, 'Folder')): Command | null {
  const f = createFolder(name), a = doc.layers.find((l) => l.id === doc.activeId);
  const at = a ? doc.layers.indexOf(a) + 1 : doc.layers.length;
  if (a?.parentId) f.parentId = a.parentId;
  const order = [...doc.layers.slice(0, at), f, ...doc.layers.slice(at)];
  return commitShape(doc, 'New folder', order, new Map(), f.id, [f]);
}
/** Wrap a node (with its subtree) in a new folder in its place (Put in a new folder · Group layers). */
export function groupNode(doc: Doc, id: string, name = nextLayerName(doc, 'Folder')): Command | null {
  const r = subtreeRange(doc.layers, id), node = doc.layers.find((l) => l.id === id);
  if (!r || !node) return null;
  const f = createFolder(name);
  if (node.parentId) f.parentId = node.parentId;
  const order = [...doc.layers.slice(0, r[1] + 1), f, ...doc.layers.slice(r[1] + 1)];
  return commitShape(doc, 'Put in a folder', order, new Map([[node, f.id]]), f.id, [f]);
}
/**
 * Take a folder apart (Take out of the folder · Ungroup layers): its contents keep their place and move up one level.
 * With a node inside a folder active, that node's folder is the one taken apart.
 */
export function ungroupNode(doc: Doc, id: string): Command | null {
  const l = doc.layers.find((x) => x.id === id);
  const f = l && isFolder(l) ? l : l?.parentId ? doc.layers.find((x) => x.id === l.parentId) : undefined;
  if (!f) return null;
  const parents = new Map<Layer, string | undefined>();
  for (const c of doc.layers) if (c.parentId === f.id) parents.set(c, f.parentId);
  const order = doc.layers.filter((x) => x !== f);
  const kids = [...parents.keys()];
  const active = l === f ? (kids[kids.length - 1]?.id ?? order[Math.max(0, doc.layers.indexOf(f) - 1)]?.id ?? doc.activeId) : doc.activeId;
  return commitShape(doc, 'Take out of the folder', order, parents, active, [f]);
}
/** Copy a node with everything inside it (new ids, buffers copied), directly above the original. */
export function duplicateNode(doc: Doc, id: string): Command | null {
  const r = subtreeRange(doc.layers, id);
  if (!r) return null;
  const src = doc.layers.slice(r[0], r[1] + 1), ids = new Map<string, string>();
  for (const l of src) ids.set(l.id, newId());
  const copies = src.map((l) => {
    const c: Layer = { ...l, id: ids.get(l.id) as string, data: l.data.slice() };
    if (l.mask) c.mask = { ...l.mask, data: l.mask.data.slice() };
    if (l.parentId && ids.has(l.parentId)) c.parentId = ids.get(l.parentId);
    return c;
  });
  const top = copies[copies.length - 1];
  top.name = src[src.length - 1].name + ' copy';
  const order = [...doc.layers.slice(0, r[1] + 1), ...copies, ...doc.layers.slice(r[1] + 1)];
  return commitShape(doc, 'Duplicate layer', order, new Map(), top.id, copies);
}
/** Delete a node with everything inside it. At least one layer with pixels always stays. */
export function deleteNode(doc: Doc, id: string): Command | null {
  const r = subtreeRange(doc.layers, id);
  if (!r) return null;
  const order = [...doc.layers.slice(0, r[0]), ...doc.layers.slice(r[1] + 1)];
  if (!order.some(hasPixels)) return null;
  const next = doc.activeId === id || subtreeOf(doc.layers, id).some((l) => l.id === doc.activeId)
    ? (order[r[0]] ?? order[r[0] - 1]).id : doc.activeId;
  return commitShape(doc, 'Delete layer', order, new Map(), next);
}
