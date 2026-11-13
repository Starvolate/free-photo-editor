// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Batch tools, part 1: Turn the view (rotate view) and Crop and straighten (perspective crop). Rides in the tool kit's
 * chunk, so it loads on first use. The maths is plain functions at the top, tested on numbers and pixels.
 *
 * Turning the view never touches pixels: the renderer draws the whole stage turned about its centre, and pointer, wheel
 * and pinch input are turned back before any tool sees them (input.ts), so every tool keeps working in the same space.
 */
import { compositeDoc, docCommand, docRect, hasPixels, homography, mapPoint, polygonMask, snapshotDoc, type Command, type Doc, type DocState, type Layer, type Mask, type Quad, type SelMode } from '@free-photoeditor/core';
import type { ToolId } from './commands';
import { h } from './dom';
import type { PointerInfo, Pt } from './input';
import { download } from './io';
import { addSlice, clearSlices, dropLastSlice, sliceBox, slicesOf, slicesZip } from './slices';
import type { ToolHost } from './toolkit';

export const MORE_TOOLS = new Set<ToolId>(['turn', 'crop-quad', 'lasso-edge', 'slice']);
/** The tools whose options bar this kit draws (Trace along edges uses the selection bar in toolkit.ts). */
export const MORE_BAR = new Set<ToolId>(['turn', 'crop-quad', 'slice']);

// ---------- Trace along edges (edge-snapping lasso): the maths ----------
/** The brightness of every pixel (0..255), see-through counted as dark. Taken once per outline, not per point. */
export function lumaOf(src: Uint8ClampedArray, w: number, h: number): Float32Array {
  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) L[i] = (0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2]) * (src[j + 3] / 255);
  return L;
}
/** How sharply the brightness changes at a pixel (central differences; the picture's border repeats). */
export function edgeAt(L: Float32Array, w: number, h: number, x: number, y: number): number {
  const xa = x > 0 ? x - 1 : x, xb = x < w - 1 ? x + 1 : x, ya = y > 0 ? y - 1 : y, yb = y < h - 1 ? y + 1 : y;
  return Math.hypot(L[y * w + xb] - L[y * w + xa], L[yb * w + x] - L[ya * w + x]);
}
const cell = (v: number, n: number): number => Math.min(n - 1, Math.max(0, Math.floor(v)));
/** The pixel with the strongest edge within `r` pixels of p (the nearest of equals); p's own pixel when no edge is there. */
export function snapToEdge(L: Float32Array, w: number, h: number, p: Pt, r: number): Pt {
  const cx = cell(p.x, w), cy = cell(p.y, h), R = Math.ceil(r);
  let best: Pt = { x: cx, y: cy }, bg = -1, bd = Infinity;
  for (let y = Math.max(0, cy - R); y <= Math.min(h - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(w - 1, cx + R); x++) {
    const dd = (x - cx) ** 2 + (y - cy) ** 2;
    if (dd > r * r) continue;
    const g = edgeAt(L, w, h, x, y);
    if (g > bg + 1e-3 || (g > bg - 1e-3 && dd < bd)) { bg = Math.max(g, bg); bd = dd; best = { x, y }; }
  }
  return bg < 8 ? { x: cx, y: cy } : best; // under 8 brightness levels is no edge at all
}
/**
 * The cheapest way from pixel a to pixel b along strong edges (Dijkstra with a binary heap) inside the two points' box
 * plus `pad`: each step costs 1 - edge / strongest edge in the box, plus a little so the way stays short; diagonals × √2.
 * A box over `limit` pixels falls back to the straight line.
 */
export function edgePath(L: Float32Array, w: number, h: number, a: Pt, b: Pt, pad = 20, limit = 400_000): Pt[] {
  const x0 = Math.max(0, Math.min(a.x, b.x) - pad), x1 = Math.min(w - 1, Math.max(a.x, b.x) + pad);
  const y0 = Math.max(0, Math.min(a.y, b.y) - pad), y1 = Math.min(h - 1, Math.max(a.y, b.y) + pad), bw = x1 - x0 + 1, n = bw * (y1 - y0 + 1);
  if (n > limit || n <= 0) return [a, b];
  const cost = new Float32Array(n);
  let gmax = 0;
  for (let k = 0; k < n; k++) { cost[k] = edgeAt(L, w, h, x0 + (k % bw), y0 + Math.floor(k / bw)); if (cost[k] > gmax) gmax = cost[k]; }
  for (let k = 0; k < n; k++) cost[k] = (gmax > 0 ? 1 - cost[k] / gmax : 1) + 0.05;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n), hk: number[] = [], hv: number[] = [];
  const push = (key: number, v: number): void => {
    let i = hk.length;
    hk.push(key); hv.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= key) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
    hk[i] = key; hv[i] = v;
  };
  const pop = (): number => {
    const top = hv[0], key = hk.pop() as number, v = hv.pop() as number, m = hk.length;
    if (m) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= m) break; if (c + 1 < m && hk[c + 1] < hk[c]) c++; if (hk[c] >= key) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
      hk[i] = key; hv[i] = v;
    }
    return top;
  };
  const s = (a.y - y0) * bw + a.x - x0, t = (b.y - y0) * bw + b.x - x0, bh = n / bw;
  dist[s] = 0; push(0, s);
  while (hk.length) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === t) break;
    const ux = u % bw, uy = (u - ux) / bw;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const vx = ux + dx, vy = uy + dy;
      if ((!dx && !dy) || vx < 0 || vy < 0 || vx >= bw || vy >= bh) continue;
      const v = vy * bw + vx, nd = dist[u] + cost[v] * (dx && dy ? Math.SQRT2 : 1);
      if (!done[v] && nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); }
    }
  }
  const out: Pt[] = [];
  for (let k = t; k >= 0; k = prev[k]) { out.push({ x: x0 + (k % bw), y: y0 + Math.floor(k / bw) }); if (k === s) break; }
  return out[out.length - 1]?.x === a.x && out[out.length - 1]?.y === a.y ? out.reverse() : [a, b];
}

// ---------- Turn the view: the maths ----------
const TAU = Math.PI * 2;
/** An angle in radians brought into (-180°, 180°]. */
export function wrapTurn(r: number): number {
  let a = r % TAU;
  if (a <= -Math.PI) a += TAU;
  if (a > Math.PI) a -= TAU;
  return Math.abs(a) < 1e-9 ? 0 : a;
}
/** Where an unturned screen point shows when the view is turned by `r` about (cx, cy). */
export function turnPoint(x: number, y: number, cx: number, cy: number, r: number): Pt {
  const c = Math.cos(r), s = Math.sin(r), dx = x - cx, dy = y - cy;
  return { x: cx + c * dx - s * dy, y: cy + s * dx + c * dy };
}
/** The unturned screen point under a screen point (the inverse of turnPoint). */
export const unturnPoint = (x: number, y: number, cx: number, cy: number, r: number): Pt => turnPoint(x, y, cx, cy, -r);
/** Degrees, rounded to one decimal, for the readout. */
export const turnDegrees = (r: number): number => Math.round((wrapTurn(r) * 1800) / Math.PI) / 10;
/** The new turn while dragging: the start turn plus the angle the pointer swept round the centre. Shift snaps to 15°. */
export function dragTurn(start: number, a0: number, a1: number, snap: boolean): number {
  const t = wrapTurn(start + a1 - a0), step = Math.PI / 12;
  return snap ? wrapTurn(Math.round(t / step) * step) : t;
}

// ---------- Crop and straighten: the maths ----------
const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
/** The straightened size: the longer of each pair of opposite edges (top/bottom, left/right), so no detail is lost. */
export function quadSize(q: Quad): { w: number; h: number } {
  return { w: Math.max(1, Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2])))), h: Math.max(1, Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2])))) };
}
/** A quad is usable when it is convex, not twisted and not tiny. */
export function quadOk(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4], z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-6) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  const s = quadSize(q);
  return s.w >= 2 && s.h >= 2;
}
/** The box inset by a tenth on each side: where the four corners start. */
export const startQuad = (w: number, h: number): Quad => {
  const x0 = w * 0.1, y0 = h * 0.1, x1 = w * 0.9, y1 = h * 0.9;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
};
/** Bilinear sample of straight-alpha RGBA at (u, v) (pixel centres at .5), premultiplied so see-through edges stay clean. */
function sampleInto(src: Uint8ClampedArray, W: number, H: number, u: number, v: number, out: Uint8ClampedArray, o: number): void {
  if (u < 0 || v < 0 || u >= W || v >= H) return;
  const fx = u - 0.5, fy = v - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    const X = Math.min(W - 1, Math.max(0, x0 + k)), Y = Math.min(H - 1, Math.max(0, y0 + j)), wt = (k ? ax : 1 - ax) * (j ? ay : 1 - ay);
    const i = (Y * W + X) * 4, al = src[i + 3] * wt;
    r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al;
  }
  if (a <= 0) return;
  out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a;
}
/** Every layer redrawn so the quad (picture pixels) fills a w × h rectangle: the picture after Crop and straighten. */
export function straightened(doc: Doc, q: Quad): DocState | null {
  if (!quadOk(q)) return null;
  const { w, h } = quadSize(q), toQuad: Quad = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  // Each output pixel centre maps back into the picture through the inverse of quad -> rectangle.
  const M = homography(toQuad, q);
  if (!M) return null;
  const layers = doc.layers.map((l): Layer => {
    if (!hasPixels(l)) return { ...l };
    const data = new Uint8ClampedArray(w * h * 4), m = l.mask;
    let md: Uint8Array | null = null;
    if (m) md = new Uint8Array(w * h).fill(m.outside ?? 0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = mapPoint(M, x + 0.5, y + 0.5), o = y * w + x;
      sampleInto(l.data, l.width, l.height, p.x - l.x, p.y - l.y, data, o * 4);
      if (m && md) {
        const u = Math.floor(p.x - m.x), v = Math.floor(p.y - m.y);
        if (u >= 0 && v >= 0 && u < m.width && v < m.height) md[o] = m.data[v * m.width + u];
      }
    }
    const out: Layer = { ...l, x: 0, y: 0, width: w, height: h, data, content: undefined };
    if (m && md) out.mask = { ...m, x: 0, y: 0, width: w, height: h, data: md };
    return out;
  });
  return { width: w, height: h, layers, activeId: doc.activeId, selection: null };
}
/** Crop and straighten as one History step. */
export function perspectiveCrop(doc: Doc, q: Quad): Command | null {
  const after = straightened(doc, q);
  if (!after) return null;
  const cmd = docCommand('Crop and straighten', snapshotDoc(doc), after);
  cmd.redo(doc);
  return cmd;
}
/** Where the inside grid lines run, as pairs of points, so the person can line the quad up with the surface. */
export function quadGrid(q: Quad, n = 3): [Pt, Pt][] {
  const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const H = homography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], q), out: [Pt, Pt][] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (H) { out.push([mapPoint(H, t, 0), mapPoint(H, t, 1)], [mapPoint(H, 0, t), mapPoint(H, 1, t)]); continue; }
    out.push([lerp(q[0], q[1], t), lerp(q[3], q[2], t)], [lerp(q[0], q[3], t), lerp(q[1], q[2], t)]);
  }
  return out;
}

// ---------- the kit ----------
export interface MoreKit {
  claims(t: ToolId): boolean;
  start(p: Pt, i: PointerInfo): void;
  move(p: Pt, i: PointerInfo): void;
  end(p: Pt, i: PointerInfo): void;
  cancel(): void;
  options(bar: HTMLElement, t: ToolId): void;
  overlay(ctx: CanvasRenderingContext2D): void;
  key(e: KeyboardEvent): boolean;
  toolChanged(prev: ToolId, next: ToolId): void;
  busy(): boolean;
  state(): Record<string, unknown>;
  toClient(x: number, y: number): Pt;
}

export function createMoreKit(host: ToolHost, applyMask: (m: Mask, mode: SelMode, label: string) => void, modeOf: (i: PointerInfo) => SelMode): MoreKit {
  const doc = (): Doc | null => host.doc();
  const scr = (p: Pt): Pt => { const v = host.view(); return { x: v.panX + p.x * v.zoom, y: v.panY + p.y * v.zoom }; };
  const centre = (): Pt => { const c = host.canvas(); return { x: c.clientWidth / 2, y: c.clientHeight / 2 }; };
  /** The angle of a picture point round the stage centre, on screen as the person sees it (turned). */
  const angleOf = (p: Pt): number => {
    const s = scr(p), c = centre(), t = turnPoint(s.x, s.y, c.x, c.y, host.turn());
    return Math.atan2(t.y - c.y, t.x - c.x);
  };
  const btn = (text: string, testid: string, run: () => void, help: string, primary = false): HTMLElement =>
    h('button', { type: 'button', class: primary ? 'fpe-btn fpe-btn-primary' : 'fpe-btn fpe-btn-ghost', 'data-testid': testid, 'data-help-title': text, 'data-help': help, onclick: run }, text);
  const hint = (s: string): HTMLElement => h('span', { class: 'fpe-hint' }, s);

  // Turn the view.
  let turnDrag: { a0: number; t0: number } | null = null, readout: HTMLElement | null = null;
  const sayTurn = (): void => { if (readout) readout.textContent = `Turned ${turnDegrees(host.turn())}°`; };
  const setTurn = (r: number): void => { host.setTurn(wrapTurn(r)); sayTurn(); };
  const resetTurn = (): void => { setTurn(0); host.refreshOptions(); };

  // Crop and straighten: the quad lives with the open picture until applied or the tool changes.
  let quad: Quad | null = null, quadDoc: Doc | null = null, quadSizeAt = '', grab: { k: 'corner'; i: number } | { k: 'box'; a: Pt } | null = null;
  const ensureQuad = (): Quad | null => {
    const d = doc();
    if (!d) return null;
    // A new picture, or the same one at another size (an undo of the crop), starts the corners again.
    const at = `${d.width}x${d.height}`;
    if (!quad || quadDoc !== d || quadSizeAt !== at) { quad = startQuad(d.width, d.height); quadDoc = d; quadSizeAt = at; }
    return quad;
  };
  const applyQuad = (): void => {
    const d = doc(), q = ensureQuad();
    if (!d || !q) return;
    if (!quadOk(q)) { host.toast('The four corners cross or sit on one line. Drag them onto the corners of the slanted surface.'); return; }
    const cmd = perspectiveCrop(d, q);
    if (!cmd) { host.toast('That shape cannot be straightened. Move the corners apart and try again.'); return; }
    host.push(cmd, true);
    quad = null;
    host.refreshOptions();
    host.toast(`Cropped and straightened to ${d.width} × ${d.height} px.`);
  };
  const resetQuad = (): void => { quad = null; ensureQuad(); host.render(); };

  // Trace along edges: the brightness is taken once when the drag starts; a new point is fixed every 16 screen px.
  let trace: { L: Float32Array; W: number; H: number; pts: Pt[]; mode: SelMode } | null = null;
  const snapR = (): number => Math.min(24, Math.max(4, 8 / host.view().zoom));
  const traceTo = (p: Pt): void => {
    if (!trace) return;
    const { L, W, H, pts } = trace, last = pts[pts.length - 1], b = snapToEdge(L, W, H, p, snapR());
    if (b.x !== last.x || b.y !== last.y) pts.push(...edgePath(L, W, H, last, b).slice(1));
  };

  // Cut into web pieces: the boxes live with the open picture (slices.ts) until cleared.
  let cut: { a: Pt; b: Pt } | null = null;
  const savePieces = async (): Promise<void> => {
    const d = doc();
    if (!d) return;
    const { bytes, count } = await slicesZip(d);
    if (!count) { host.toast('Drag a box over each part you want as its own piece first.'); return; }
    const file = 'web pieces.zip';
    download(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), file, host.root);
    host.toast(`Saved ${count} piece${count === 1 ? '' : 's'} as PNG pictures in ${file}.`);
  };

  return {
    claims: (t) => MORE_TOOLS.has(t),
    busy: () => !!turnDrag || !!grab || !!trace || !!cut,
    start(p, i) {
      const t = host.tool();
      if (t === 'lasso-edge') {
        const d = doc();
        if (!d) return;
        const L = lumaOf(compositeDoc(d, docRect(d)), d.width, d.height);
        trace = { L, W: d.width, H: d.height, pts: [snapToEdge(L, d.width, d.height, p, snapR())], mode: modeOf(i) };
        host.render();
        return;
      }
      if (t === 'slice') { cut = { a: p, b: p }; return; }
      if (t === 'turn') { turnDrag = { a0: angleOf(p), t0: host.turn() }; return; }
      if (t === 'crop-quad') {
        const q = ensureQuad();
        if (!q) return;
        const z = host.view().zoom;
        let best = -1, bd = 22; // a 44 px target round each corner, for fingers
        q.forEach((c, i) => { const dd = dist(c, p) * z; if (dd < bd) { bd = dd; best = i; } });
        grab = best >= 0 ? { k: 'corner', i: best } : { k: 'box', a: p };
      }
    },
    move(p, i) {
      if (trace) {
        const l = trace.pts[trace.pts.length - 1];
        if (dist(l, p) * host.view().zoom >= 16) traceTo(p);
        host.render();
        return;
      }
      if (cut) { cut.b = p; host.render(); return; }
      if (turnDrag) { setTurn(dragTurn(turnDrag.t0, turnDrag.a0, angleOf(p), i.shift)); return; }
      const d = doc();
      if (!grab || !quad || !d) return;
      const c = { x: Math.min(d.width, Math.max(0, p.x)), y: Math.min(d.height, Math.max(0, p.y)) };
      if (grab.k === 'corner') quad[grab.i] = c;
      else {
        const a = grab.a;
        if (Math.abs(c.x - a.x) * host.view().zoom < 4 && Math.abs(c.y - a.y) * host.view().zoom < 4) return;
        quad = [{ x: a.x, y: a.y }, { x: c.x, y: a.y }, { x: c.x, y: c.y }, { x: a.x, y: c.y }];
      }
      host.render();
    },
    end(p, i) {
      if (trace) {
        traceTo(p);
        const tr = trace;
        trace = null;
        // Let go and the outline closes straight back to where it started.
        if (tr.pts.length >= 3) applyMask(polygonMask(tr.W, tr.H, tr.pts.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }))), tr.mode, 'Trace along edges');
        else host.toast('Drag slowly along the edge of what you want, all the way round.');
        host.render();
        return;
      }
      if (cut) {
        const d = doc(), c = cut, z = host.view().zoom;
        cut = null;
        const r = d && Math.abs(p.x - c.a.x) * z >= 4 && Math.abs(p.y - c.a.y) * z >= 4 ? sliceBox(c.a, p, d.width, d.height) : null;
        if (d && r) addSlice(d, r);
        else host.toast('Drag a box over the part you want as one piece.');
        host.refreshOptions();
        host.render();
        return;
      }
      if (turnDrag) { this.move(p, i); turnDrag = null; host.refreshOptions(); return; }
      if (grab) { this.move(p, i); grab = null; host.refreshOptions(); }
    },
    cancel() { turnDrag = null; grab = null; trace = null; cut = null; },
    options(bar, t) {
      if (t === 'turn') {
        readout = h('span', { class: 'fpe-hint', 'data-testid': 'turn-readout', 'aria-live': 'polite' });
        sayTurn();
        const step = (deg: number) => () => { setTurn(host.turn() + (deg * Math.PI) / 180); host.refreshOptions(); };
        bar.append(readout,
          btn('Turn left 15°', 'turn-left', step(-15), 'Turn the view 15 degrees to the left. The picture itself does not change.'),
          btn('Turn right 15°', 'turn-right', step(15), 'Turn the view 15 degrees to the right. The picture itself does not change.'),
          btn('Straight again', 'turn-reset', resetTurn, 'Put the view back level. Esc does the same while this tool is on.'),
          hint('Drag round the middle to turn the view, Shift for 15° steps. Only the view turns, never the pixels.'));
        return;
      }
      if (t === 'slice') {
        const d = doc(), n = d ? slicesOf(d).length : 0, off = (b: HTMLElement): HTMLElement => { if (!n) b.setAttribute('disabled', ''); return b; };
        bar.append(
          h('span', { class: 'fpe-hint', 'data-testid': 'slice-count' }, n ? `${n} piece${n === 1 ? '' : 's'}` : 'No pieces yet'),
          off(btn('Save the pieces', 'slice-save', () => void savePieces(), 'Save every piece as its own PNG picture, all in one ZIP file.', true)),
          off(btn('Remove the last piece', 'slice-undo', () => { const dd = doc(); if (dd) dropLastSlice(dd); host.refreshOptions(); host.render(); }, 'Take away the piece you drew last.')),
          off(btn('Clear the pieces', 'slice-clear', () => { const dd = doc(); if (dd) clearSlices(dd); host.refreshOptions(); host.render(); }, 'Remove every piece from this picture. The picture itself does not change.')),
          hint('Drag a box over each part you want as its own picture for a web page. The boxes stay with this open picture until you clear them.'));
        return;
      }
      if (t === 'crop-quad') {
        ensureQuad();
        const s = quad ? quadSize(quad) : null;
        bar.append(
          hint(!quad ? '' : quadOk(quad) && s ? `Result ${s.w} × ${s.h} px` : 'The corners cross or sit on one line (red outline): drag them apart.'),
          btn('Straighten and crop', 'quad-apply', applyQuad, 'Straighten the four-cornered area into a rectangle and crop to it, as one step you can undo. Enter does the same.', true),
          btn('Start again', 'quad-reset', resetQuad, 'Put the four corners back to where they started. Esc does the same.'),
          hint('Drag the four round corners onto the corners of a slanted surface (a sign, a page, a screen), or drag a new box.'));
      }
    },
    overlay(ctx) {
      if (trace) {
        const ptr = host.pointer(), s = trace.pts.map((c) => scr({ x: c.x + 0.5, y: c.y + 0.5 }));
        if (ptr) s.push(scr(ptr));
        ctx.save();
        ctx.beginPath();
        s.forEach((c, k) => (k ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.lineDashOffset = 5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.restore();
        return;
      }
      if (host.tool() === 'slice') {
        const d = doc(), list = d ? slicesOf(d).map((r, k) => ({ r, k: k + 1 })) : [];
        if (cut) list.push({ r: { x: Math.min(cut.a.x, cut.b.x), y: Math.min(cut.a.y, cut.b.y), w: Math.abs(cut.b.x - cut.a.x), h: Math.abs(cut.b.y - cut.a.y) }, k: 0 });
        ctx.save();
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        for (const { r, k } of list) {
          const a = scr(r), w = r.w * host.view().zoom, hh = r.h * host.view().zoom;
          ctx.setLineDash(k ? [] : [5, 5]);
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeRect(a.x, a.y, w, hh);
          ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.strokeRect(a.x, a.y, w, hh);
          if (!k) continue;
          const label = String(k), tw = ctx.measureText(label).width + 12;
          ctx.fillStyle = 'rgba(20,22,28,.85)'; ctx.fillRect(a.x + 4, a.y + 4, tw, 20);
          ctx.fillStyle = '#fff'; ctx.fillText(label, a.x + 10, a.y + 14);
        }
        ctx.restore();
        return;
      }
      if (host.tool() !== 'crop-quad') return;
      const q = ensureQuad();
      if (!q) return;
      const s = q.map(scr);
      ctx.save();
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, 2e5);
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(s[i].x, s[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fill('evenodd');
      ctx.beginPath();
      for (const [a, b] of quadGrid(q)) { const A = scr(a), B = scr(b); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); }
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(s[i].x, s[i].y);
      ctx.closePath();
      ctx.strokeStyle = quadOk(q) ? '#fff' : '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const c of s) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,.75)';
        ctx.stroke();
      }
      ctx.restore();
    },
    key(e) {
      const t = host.tool();
      if (t === 'turn' && e.key === 'Escape') { resetTurn(); return true; }
      if (t === 'crop-quad' && e.key === 'Enter') { applyQuad(); return true; }
      if (t === 'crop-quad' && e.key === 'Escape') { resetQuad(); host.refreshOptions(); return true; }
      return false;
    },
    toolChanged(prev, next) {
      turnDrag = null; grab = null; trace = null; cut = null;
      if (prev === 'crop-quad' && next !== 'crop-quad') quad = null;
      if (next === 'crop-quad') { ensureQuad(); host.render(); }
    },
    toClient(x, y) {
      const r = host.canvas().getBoundingClientRect(), s = scr({ x, y }), c = centre(), t = turnPoint(s.x, s.y, c.x, c.y, host.turn());
      return { x: r.left + t.x, y: r.top + t.y };
    },
    state: () => ({ slices: (() => { const d = doc(); return d ? slicesOf(d).length : 0; })(), turn: turnDegrees(host.turn()), quad: quad ? quad.map((c) => ({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 })) : null }),
  };
}
