// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The compositor: every layer that meets a rectangle, mixed bottom to top. Everything that reads the stack goes through
 * here (the screen, the eyedropper, export, PSD previews, the command line and MCP), so all of them see the same picture.
 * Pass 1 prepares each mask over the rectangle; pass 2 is the row loop. Layers without masks give the same bytes as before.
 *
 * Folders and clipping (design 3): the tree is derived from parentId and order, then drawn recursively in the same row
 * loop. A pass-through folder draws its contents straight onto what is below and mixes the result back by opacity × mask;
 * any other folder draws onto a clear sheet that is blended down like one layer. A clip group draws its base's colour at
 * full strength inside the base's shape, then each clipped node, and is blended down with the base's mode and opacity.
 * Each nesting level reuses one Float32 row, so memory stays a few rows wide at any size.
 */
import { SEPARABLE, hash01, nonSeparable, type BlendLayer, type BlendMode } from './blend';
import type { RGBA } from './color';
import { intersect, type Rect } from './geometry';
import { maskRows, type MaskRows } from './mask';
import { buildTree, type TreeNode } from './tree';

/** True when any node is in a folder, clipped, or is not a plain pixel layer. */
const isTree = (layers: readonly BlendLayer[]): boolean =>
  layers.some((l) => l.parentId !== undefined || !!l.clip || (l.kind !== undefined && l.kind !== 'pixel'));

/** Composite layers (index 0 = bottom) for one document rectangle. Returns rect-sized RGBA. */
export function compositeRect(layers: readonly BlendLayer[], r: Rect, background: RGBA | null = null): Uint8ClampedArray {
  return isTree(layers) ? compositeTree(layers, r, background) : compositeFlat(layers, r, background);
}

/** Today's loop for a list of plain pixel layers: byte-identical to W5 and S1, and the fastest path. */
function compositeFlat(layers: readonly BlendLayer[], r: Rect, background: RGBA | null): Uint8ClampedArray {
  const w = Math.max(0, r.w), h = Math.max(0, r.h);
  const out = new Uint8ClampedArray(w * h * 4);
  if (!w || !h) return out;
  const acc = new Float32Array(w * 4);
  const mix = new Float64Array(3);
  const bR = background ? background.r / 255 : 0, bG = background ? background.g / 255 : 0;
  const bB = background ? background.b / 255 : 0, bA = background ? background.a / 255 : 0;
  const list = layers.filter((l) => l.visible && l.opacity > 0 && l.x < r.x + w && l.y < r.y + h && l.x + l.width > r.x && l.y + l.height > r.y);
  // Pass 1: each mask is prepared once over the part of the layer this rectangle needs (soft edges read their neighbours).
  const masks = list.map((l) => (l.mask ? maskRows(l.mask, intersect(r, { x: l.x, y: l.y, w: l.width, h: l.height }) as Rect) : null));
  const mrow = new Float32Array(w);
  for (let row = 0; row < h; row++) {
    const y = r.y + row;
    for (let i = 0; i < w * 4; i += 4) { acc[i] = bR; acc[i + 1] = bG; acc[i + 2] = bB; acc[i + 3] = bA; }
    for (let j = 0; j < list.length; j++) {
      const L = list[j], mk = masks[j];
      const ly = y - L.y;
      if (ly < 0 || ly >= L.height) continue;
      const x0 = Math.max(r.x, L.x), x1 = Math.min(r.x + w, L.x + L.width);
      if (x0 >= x1) continue;
      const mode = L.blendMode;
      const sep = SEPARABLE[mode];
      const plain = mode === 'normal' || mode === 'dissolve';
      const dissolve = mode === 'dissolve';
      const d = L.data;
      const k255 = L.opacity / 255;
      let si = (ly * L.width + (x0 - L.x)) * 4;
      let ai = (x0 - r.x) * 4;
      if (mk) mk(y, x0, x1, mrow);
      for (let x = x0; x < x1; x++, si += 4, ai += 4) {
        let as = d[si + 3] * k255;
        if (mk) as *= mrow[x - x0];
        if (as <= 0) continue;
        if (dissolve) { if (hash01(x, y) >= as) continue; as = 1; }
        const sr = d[si] / 255, sg = d[si + 1] / 255, sb = d[si + 2] / 255;
        const ab = acc[ai + 3], br = acc[ai], bg = acc[ai + 1], bb = acc[ai + 2];
        let mr = sr, mg = sg, mb = sb;
        if (!plain && ab > 0) {
          if (sep) { mr = sep(br, sr); mg = sep(bg, sg); mb = sep(bb, sb); }
          else { nonSeparable(mode, br, bg, bb, sr, sg, sb, mix); mr = mix[0]; mg = mix[1]; mb = mix[2]; }
          mr = (1 - ab) * sr + ab * mr; mg = (1 - ab) * sg + ab * mg; mb = (1 - ab) * sb + ab * mb;
        }
        const k = ab * (1 - as);
        const ao = as + k;
        acc[ai] = (as * mr + k * br) / ao; acc[ai + 1] = (as * mg + k * bg) / ao;
        acc[ai + 2] = (as * mb + k * bb) / ao; acc[ai + 3] = ao;
      }
    }
    const o = row * w * 4;
    for (let i = 0; i < w * 4; i++) out[o + i] = acc[i] * 255;
  }
  return out;
}

// ---------- the tree path ----------

/** One node ready to draw over the rectangle: its span (document coordinates), mask rows and, for folders, contents. */
interface Prep {
  l: BlendLayer; folder: boolean;
  x0: number; x1: number; y0: number; y1: number;
  mk: MaskRows | null; mrow: Float32Array | null;
  kids: Item[] | null;
  /** Folders: the isolated sheet, or the pass-through "before" copy. */
  sheet: Float32Array | null;
}
/** A node, or a clip group: a base with the clipped nodes directly above it (`run`, possibly all off this rectangle). */
interface Item { base: Prep; run: Item[] | null; sheet: Float32Array | null; shape: Float32Array | null; }
interface Ctx { rx: number; w: number; mix: Float64Array; }
interface Prepared { root: Item[]; c: Ctx; }
/** The mask rows, made on first use: a resumed frame never draws the nodes below the painted one, so their masks wait. */
function lazyMask(m: NonNullable<BlendLayer['mask']>, r: Rect): MaskRows {
  let f: MaskRows | null | undefined;
  return (y, x0, x1, out) => {
    if (f === undefined) f = maskRows(m, r);
    if (f) f(y, x0, x1, out); else out.fill(1, 0, x1 - x0);
  };
}

/**
 * Pass 1: the tree culled to the rectangle. Hidden nodes go (a hidden base takes its clip group with it). Whether a
 * group is a clip group depends only on which nodes are shown, never on the rectangle, so any split of the picture into
 * bands or tiles does the same arithmetic at every pixel.
 */
function prepare(layers: readonly BlendLayer[], r: Rect): Prepared {
  const w = r.w, h = r.h, c: Ctx = { rx: r.x, w, mix: new Float64Array(3) };
  const shown = (l: BlendLayer): boolean => l.visible && l.opacity > 0;
  const prep = (n: TreeNode<BlendLayer>): Prep | null => {
    const l = n.layer;
    if (!shown(l)) return null;
    if (l.kind === 'folder') {
      const kids = items(n.children);
      if (!kids.length) return null;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const k of kids) { x0 = Math.min(x0, k.base.x0); x1 = Math.max(x1, k.base.x1); y0 = Math.min(y0, k.base.y0); y1 = Math.max(y1, k.base.y1); }
      const mk = l.mask ? lazyMask(l.mask, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) : null;
      return { l, folder: true, x0, x1, y0, y1, mk, mrow: mk ? new Float32Array(w) : null, kids, sheet: new Float32Array(w * 4) };
    }
    if (l.kind && l.kind !== 'pixel') return null; // adjustment and fill layers are drawn from S3 on
    const x0 = Math.max(r.x, l.x), x1 = Math.min(r.x + w, l.x + l.width), y0 = Math.max(r.y, l.y), y1 = Math.min(r.y + h, l.y + l.height);
    if (x0 >= x1 || y0 >= y1) return null;
    const mk = l.mask ? lazyMask(l.mask, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) : null;
    return { l, folder: false, x0, x1, y0, y1, mk, mrow: mk ? new Float32Array(w) : null, kids: null, sheet: null };
  };
  const items = (nodes: TreeNode<BlendLayer>[]): Item[] => {
    const groups: { base: TreeNode<BlendLayer>; run: TreeNode<BlendLayer>[] }[] = [];
    for (const n of nodes) {
      const g = groups[groups.length - 1];
      if (n.layer.clip && g) g.run.push(n); else groups.push({ base: n, run: [] });
    }
    const out: Item[] = [];
    for (const g of groups) {
      const base = prep(g.base);
      if (!base) continue;
      const shownRun = g.run.filter((n) => shown(n.layer));
      if (!shownRun.length) { out.push({ base, run: null, sheet: null, shape: null }); continue; }
      const run: Item[] = [];
      for (const n of shownRun) { const p = prep(n); if (p) run.push({ base: p, run: null, sheet: null, shape: null }); }
      out.push({ base, run, sheet: new Float32Array(w * 4), shape: new Float32Array(w) });
    }
    return out;
  };
  return { root: items(buildTree(layers)), c };
}

/** Blend n pixels of `src` (bytes with div 255, or a Float32 sheet with div 1) onto `acc`: today's formulas. */
function blendSpan(acc: Float32Array, ai: number, src: Uint8ClampedArray | Float32Array, si: number, k: number, div: number,
  n: number, x0: number, y: number, mode: BlendMode, mrow: Float32Array | null, mix: Float64Array): void {
  const sep = SEPARABLE[mode], plain = mode === 'normal' || mode === 'dissolve', dissolve = mode === 'dissolve';
  for (let j = 0; j < n; j++, si += 4, ai += 4) {
    let as = src[si + 3] * k;
    if (mrow) as *= mrow[j];
    if (as <= 0) continue;
    if (dissolve) { if (hash01(x0 + j, y) >= as) continue; as = 1; }
    const sr = src[si] / div, sg = src[si + 1] / div, sb = src[si + 2] / div;
    const ab = acc[ai + 3], br = acc[ai], bg = acc[ai + 1], bb = acc[ai + 2];
    let mr = sr, mg = sg, mb = sb;
    if (!plain && ab > 0) {
      if (sep) { mr = sep(br, sr); mg = sep(bg, sg); mb = sep(bb, sb); }
      else { nonSeparable(mode, br, bg, bb, sr, sg, sb, mix); mr = mix[0]; mg = mix[1]; mb = mix[2]; }
      mr = (1 - ab) * sr + ab * mr; mg = (1 - ab) * sg + ab * mg; mb = (1 - ab) * sb + ab * mb;
    }
    const kk = ab * (1 - as);
    const ao = as + kk;
    acc[ai] = (as * mr + kk * br) / ao; acc[ai + 1] = (as * mg + kk * bg) / ao;
    acc[ai + 2] = (as * mb + kk * bb) / ao; acc[ai + 3] = ao;
  }
}
const clearSpan = (s: Float32Array, c: Ctx, x0: number, x1: number): void => { s.fill(0, (x0 - c.rx) * 4, (x1 - c.rx) * 4); };
function drawItems(list: Item[], from: number, to: number, acc: Float32Array, y: number, lo: number, hi: number, c: Ctx): void {
  for (let i = from; i < to; i++) drawItem(list[i], acc, y, lo, hi, c);
}
function drawItem(it: Item, acc: Float32Array, y: number, lo: number, hi: number, c: Ctx): void {
  const b = it.base;
  if (y < b.y0 || y >= b.y1) return;
  const x0 = Math.max(lo, b.x0), x1 = Math.min(hi, b.x1);
  if (x0 >= x1) return;
  if (!it.run) { drawNode(b, acc, y, x0, x1, c); return; }
  startClip(it, y, x0, x1, c);
  drawItems(it.run, 0, it.run.length, it.sheet as Float32Array, y, x0, x1, c);
  finishClip(it, acc, y, x0, x1, c);
}
function drawNode(p: Prep, acc: Float32Array, y: number, x0: number, x1: number, c: Ctx): void {
  const l = p.l;
  if (!p.folder) {
    if (p.mk) p.mk(y, x0, x1, p.mrow as Float32Array);
    blendSpan(acc, (x0 - c.rx) * 4, l.data, ((y - l.y) * l.width + (x0 - l.x)) * 4, l.opacity / 255, 255, x1 - x0, x0, y, l.blendMode, p.mrow, c.mix);
    return;
  }
  const kids = p.kids as Item[], s = p.sheet as Float32Array;
  if (l.passThrough) {
    s.set(acc.subarray((x0 - c.rx) * 4, (x1 - c.rx) * 4), (x0 - c.rx) * 4);
    drawItems(kids, 0, kids.length, acc, y, x0, x1, c);
    finishPass(p, acc, y, x0, x1, c);
  } else {
    clearSpan(s, c, x0, x1);
    drawItems(kids, 0, kids.length, s, y, x0, x1, c);
    sheetDown(p, acc, y, x0, x1, c);
  }
}
/** Pass through: out = before mixed towards after by opacity × mask (premultiplied); unchanged pixels stay exact. */
function finishPass(p: Prep, acc: Float32Array, y: number, x0: number, x1: number, c: Ctx): void {
  const bef = p.sheet as Float32Array, op = p.l.opacity, mr = p.mrow;
  if (p.mk) p.mk(y, x0, x1, mr as Float32Array);
  for (let x = x0, j = 0; x < x1; x++, j++) {
    const t = mr ? op * mr[j] : op;
    if (t >= 1) continue;
    const i = (x - c.rx) * 4, ba = bef[i + 3], aa = acc[i + 3];
    if (aa === ba && acc[i] === bef[i] && acc[i + 1] === bef[i + 1] && acc[i + 2] === bef[i + 2]) continue;
    const a = ba + (aa - ba) * t;
    if (!(a > 0)) { acc[i] = acc[i + 1] = acc[i + 2] = acc[i + 3] = 0; continue; }
    for (let ch = 0; ch < 3; ch++) acc[i + ch] = (bef[i + ch] * ba + (acc[i + ch] * aa - bef[i + ch] * ba) * t) / a;
    acc[i + 3] = a;
  }
}
/** An isolated folder's sheet blended down like one layer, with the folder's mode, opacity and mask. */
function sheetDown(p: Prep, acc: Float32Array, y: number, x0: number, x1: number, c: Ctx): void {
  if (p.mk) p.mk(y, x0, x1, p.mrow as Float32Array);
  const ai = (x0 - c.rx) * 4;
  blendSpan(acc, ai, p.sheet as Float32Array, ai, p.l.opacity, 1, x1 - x0, x0, y, p.l.blendMode, p.mrow, c.mix);
}
/** A clip group's sheet: the base's colour at full strength wherever its shape (alpha × mask) is above zero. */
function startClip(it: Item, y: number, x0: number, x1: number, c: Ctx): void {
  const b = it.base, s = it.sheet as Float32Array, sh = it.shape as Float32Array, mr = b.mrow;
  let src: Uint8ClampedArray | Float32Array, si: number, div: number;
  if (b.folder) {
    // a folder used as a base is drawn isolated, even when it is pass through (design 2.3)
    const f = b.sheet as Float32Array, kids = b.kids as Item[];
    clearSpan(f, c, x0, x1);
    drawItems(kids, 0, kids.length, f, y, x0, x1, c);
    src = f; si = (x0 - c.rx) * 4; div = 1;
  } else { const l = b.l; src = l.data; si = ((y - l.y) * l.width + (x0 - l.x)) * 4; div = 255; }
  if (b.mk) b.mk(y, x0, x1, mr as Float32Array);
  for (let x = x0, j = 0; x < x1; x++, j++, si += 4) {
    const i = (x - c.rx) * 4;
    let a = src[si + 3] / div;
    if (mr) a *= mr[j];
    sh[x - c.rx] = a;
    if (a > 0) { s[i] = src[si] / div; s[i + 1] = src[si + 1] / div; s[i + 2] = src[si + 2] / div; s[i + 3] = 1; }
    else { s[i] = s[i + 1] = s[i + 2] = s[i + 3] = 0; }
  }
}
function finishClip(it: Item, acc: Float32Array, y: number, x0: number, x1: number, c: Ctx): void {
  const s = it.sheet as Float32Array, sh = it.shape as Float32Array, l = it.base.l;
  for (let x = x0; x < x1; x++) s[(x - c.rx) * 4 + 3] *= sh[x - c.rx];
  const ai = (x0 - c.rx) * 4;
  blendSpan(acc, ai, s, ai, l.opacity, 1, x1 - x0, x0, y, l.blendMode, null, c.mix);
}
function fillBackground(acc: Float32Array, background: RGBA | null): void {
  const bR = background ? background.r / 255 : 0, bG = background ? background.g / 255 : 0;
  const bB = background ? background.b / 255 : 0, bA = background ? background.a / 255 : 0;
  for (let i = 0; i < acc.length; i += 4) { acc[i] = bR; acc[i + 1] = bG; acc[i + 2] = bB; acc[i + 3] = bA; }
}
function compositeTree(layers: readonly BlendLayer[], r: Rect, background: RGBA | null): Uint8ClampedArray {
  const w = Math.max(0, r.w), h = Math.max(0, r.h);
  const out = new Uint8ClampedArray(w * h * 4);
  if (!w || !h) return out;
  const P = prepare(layers, { x: r.x, y: r.y, w, h }), acc = new Float32Array(w * 4);
  for (let row = 0; row < h; row++) {
    fillBackground(acc, background);
    drawItems(P.root, 0, P.root.length, acc, r.y + row, r.x, r.x + w, P.c);
    const o = row * w * 4;
    for (let i = 0; i < w * 4; i++) out[o + i] = acc[i] * 255;
  }
  return out;
}

// ---------- the stroke cache (design 3.2) ----------

/** One step on the way from the top level down to the painted node. */
interface Level { items: Item[]; idx: number; kind: 'root' | 'pass' | 'iso' | 'clip'; }
const holds = (p: Prep, t: BlendLayer): boolean => p.l === t || (!!p.kids && p.kids.some((it) => holds(it.base, t) || !!it.run?.some((x) => holds(x.base, t))));
/** The levels from the top down to the painted node; it stops early when the node is inside a clip group's base. */
function findPath(root: Item[], t: BlendLayer): Level[] | null {
  const levels: Level[] = [];
  let items = root, kind: Level['kind'] = 'root';
  for (;;) {
    const idx = items.findIndex((it) => holds(it.base, t) || !!it.run?.some((x) => holds(x.base, t)));
    if (idx < 0) return null;
    levels.push({ items, idx, kind });
    const it = items[idx];
    if (it.base.l === t) return levels;
    if (it.run) {
      if (!it.run.some((x) => holds(x.base, t))) return levels; // inside the base: the whole group is redrawn
      items = it.run; kind = 'clip'; continue;
    }
    items = it.base.kids as Item[]; kind = it.base.l.passThrough ? 'pass' : 'iso';
  }
}
/** Kept rows for one tile; `plain` when the painted node draws nothing there (hidden, or off this tile), so it is drawn whole. */
interface TileRows { r: Rect; rows: Float32Array[]; shapes: (Float32Array | null)[]; plain: boolean; }

/**
 * While a stroke paints one node, keeps per 128 px tile the rows just below it at every level of its path (the open
 * sheets of isolated folders and clip groups included), so each frame redraws only the node and what is above it.
 * Exact by construction: a cached frame equals an uncached one. Make a new one for each stroke; drop it at the end.
 */
export class StrokeCache {
  private readonly tiles = new Map<string, TileRows>();
  private bytes = 0;
  private dead = false;
  private depth = 0;
  /** For tests and the status line: tiles kept, levels on the path, and whether it fell back to plain drawing. */
  get stats(): { tiles: number; depth: number; dead: boolean } {
    let kept = 0;
    for (const t of this.tiles.values()) if (!t.plain) kept++;
    return { tiles: kept, depth: this.depth, dead: this.dead };
  }
  constructor(private readonly layers: readonly BlendLayer[], private readonly target: BlendLayer,
    private readonly background: RGBA | null = null, private readonly T = 128, private readonly cap = 256 * 1024 * 1024) {}
  /** The picture over `r`, as compositeRect gives it. */
  composite(r: Rect): Uint8ClampedArray {
    const w = Math.max(0, r.w), h = Math.max(0, r.h), T = this.T;
    if (this.dead || !w || !h) return compositeRect(this.layers, r, this.background);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let ty = Math.floor(r.y / T); ty * T < r.y + h; ty++) for (let tx = Math.floor(r.x / T); tx * T < r.x + w; tx++) {
      const tr = { x: tx * T, y: ty * T, w: T, h: T }, sub = intersect(tr, r);
      if (!sub) continue;
      let tile = this.tiles.get(tx + ',' + ty);
      if (!tile) {
        tile = this.capture(tr);
        this.tiles.set(tx + ',' + ty, tile);
        for (const k of this.tiles.keys()) { if (this.bytes <= this.cap || this.tiles.size <= 1) break; const old = this.tiles.get(k) as TileRows; this.tiles.delete(k); this.bytes -= this.sizeOf(old); }
      }
      const px = tile.plain ? compositeRect(this.layers, sub, this.background) : this.resume(tile, sub);
      for (let y = 0; y < sub.h; y++) out.set(px.subarray(y * sub.w * 4, (y + 1) * sub.w * 4), ((sub.y - r.y + y) * w + (sub.x - r.x)) * 4);
    }
    return out;
  }
  private sizeOf(t: TileRows): number { return t.rows.reduce((s, a) => s + a.byteLength, 0) + t.shapes.reduce((s, a) => s + (a ? a.byteLength : 0), 0); }
  private capture(tr: Rect): TileRows {
    const P = prepare(this.layers, tr), levels = findPath(P.root, this.target);
    if (!levels) return { r: tr, rows: [], shapes: [], plain: true };
    this.depth = Math.max(this.depth, levels.length);
    const n = tr.w * tr.h;
    const tile: TileRows = { r: tr, rows: levels.map(() => new Float32Array(n * 4)), shapes: levels.map((L) => (L.kind === 'clip' ? new Float32Array(n) : null)), plain: false };
    this.bytes += this.sizeOf(tile);
    const acc = new Float32Array(tr.w * 4);
    for (let y = tr.y; y < tr.y + tr.h; y++) {
      fillBackground(acc, this.background);
      this.level(0, levels, acc, y, tr.x, tr.x + tr.w, true, tile, P.c);
    }
    return tile;
  }
  private resume(tile: TileRows, sub: Rect): Uint8ClampedArray {
    const P = prepare(this.layers, sub), levels = findPath(P.root, this.target);
    if (!levels || levels.length !== tile.rows.length) return compositeRect(this.layers, sub, this.background);
    const out = new Uint8ClampedArray(sub.w * sub.h * 4), acc = new Float32Array(sub.w * 4);
    for (let row = 0; row < sub.h; row++) {
      this.level(0, levels, acc, sub.y + row, sub.x, sub.x + sub.w, false, tile, P.c);
      const o = row * sub.w * 4;
      for (let i = 0; i < sub.w * 4; i++) out[o + i] = acc[i] * 255;
    }
    return out;
  }
  /** One level of the path: below the path item drawn and kept (capture), or read back from the tile (resume). */
  private level(k: number, levels: Level[], acc: Float32Array, y: number, lo: number, hi: number, cap: boolean, tile: TileRows, c: Ctx): void {
    const L = levels[k], ti = ((y - tile.r.y) * tile.r.w + (lo - tile.r.x)) * 4, ai = (lo - c.rx) * 4, n = (hi - lo) * 4;
    if (cap) { drawItems(L.items, 0, L.idx, acc, y, lo, hi, c); tile.rows[k].set(acc.subarray(ai, ai + n), ti); }
    else acc.set(tile.rows[k].subarray(ti, ti + n), ai);
    const it = L.items[L.idx];
    if (k === levels.length - 1) drawItem(it, acc, y, lo, hi, c);
    else this.pathItem(k, levels, it, acc, y, lo, hi, cap, tile, c);
    drawItems(L.items, L.idx + 1, L.items.length, acc, y, lo, hi, c);
  }
  /** The item on the path at level k, drawn exactly as drawItem does, with the level below it cached. */
  private pathItem(k: number, levels: Level[], it: Item, acc: Float32Array, y: number, lo: number, hi: number, cap: boolean, tile: TileRows, c: Ctx): void {
    const b = it.base, next = levels[k + 1];
    if (y < b.y0 || y >= b.y1) return;
    const x0 = Math.max(lo, b.x0), x1 = Math.min(hi, b.x1);
    if (x0 >= x1) return;
    if (next.kind === 'clip') {
      const sh = it.shape as Float32Array, keep = tile.shapes[k + 1] as Float32Array, ti = (y - tile.r.y) * tile.r.w + (x0 - tile.r.x);
      if (cap) { startClip(it, y, x0, x1, c); keep.set(sh.subarray(x0 - c.rx, x1 - c.rx), ti); }
      else sh.set(keep.subarray(ti, ti + x1 - x0), x0 - c.rx);
      this.level(k + 1, levels, it.sheet as Float32Array, y, x0, x1, cap, tile, c);
      finishClip(it, acc, y, x0, x1, c);
    } else if (next.kind === 'pass') {
      (b.sheet as Float32Array).set(acc.subarray((x0 - c.rx) * 4, (x1 - c.rx) * 4), (x0 - c.rx) * 4);
      this.level(k + 1, levels, acc, y, x0, x1, cap, tile, c);
      finishPass(b, acc, y, x0, x1, c);
    } else {
      clearSpan(b.sheet as Float32Array, c, x0, x1);
      this.level(k + 1, levels, b.sheet as Float32Array, y, x0, x1, cap, tile, c);
      sheetDown(b, acc, y, x0, x1, c);
    }
  }
}
