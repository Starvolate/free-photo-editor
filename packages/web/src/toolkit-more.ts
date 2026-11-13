// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Batch tools, part 1: Turn the view (rotate view) and Crop and straighten (perspective crop). Rides in the tool kit's
 * chunk, so it loads on first use. The maths is plain functions at the top, tested on numbers and pixels.
 *
 * Turning the view never touches pixels: the renderer draws the whole stage turned about its centre, and pointer, wheel
 * and pinch input are turned back before any tool sees them (input.ts), so every tool keeps working in the same space.
 */
import { docCommand, hasPixels, homography, invert3, mapPoint, snapshotDoc, type Command, type Doc, type DocState, type Layer, type Quad } from '@free-photoeditor/core';
import type { ToolId } from './commands';
import { h } from './dom';
import type { PointerInfo, Pt } from './input';
import type { ToolHost } from './toolkit';

export const MORE_TOOLS = new Set<ToolId>(['turn', 'crop-quad']);

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
}

export function createMoreKit(host: ToolHost): MoreKit {
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
  let quad: Quad | null = null, quadDoc: Doc | null = null, grab: { k: 'corner'; i: number } | { k: 'box'; a: Pt } | null = null;
  const ensureQuad = (): Quad | null => {
    const d = doc();
    if (!d) return null;
    if (!quad || quadDoc !== d) { quad = startQuad(d.width, d.height); quadDoc = d; }
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

  return {
    claims: (t) => MORE_TOOLS.has(t),
    busy: () => !!turnDrag || !!grab,
    start(p) {
      const t = host.tool();
      if (t === 'turn') { turnDrag = { a0: angleOf(p), t0: host.turn() }; return; }
      if (t === 'crop-quad') {
        const q = ensureQuad();
        if (!q) return;
        const z = host.view().zoom;
        let best = -1, bd = 14;
        q.forEach((c, i) => { const dd = dist(c, p) * z; if (dd < bd) { bd = dd; best = i; } });
        grab = best >= 0 ? { k: 'corner', i: best } : { k: 'box', a: p };
      }
    },
    move(p, i) {
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
      if (turnDrag) { this.move(p, i); turnDrag = null; host.refreshOptions(); return; }
      if (grab) { this.move(p, i); grab = null; host.refreshOptions(); }
    },
    cancel() { turnDrag = null; grab = null; },
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
      if (t === 'crop-quad') {
        ensureQuad();
        const s = quad ? quadSize(quad) : null;
        bar.append(
          hint(s ? `Result ${s.w} × ${s.h} px` : ''),
          btn('Straighten and crop', 'quad-apply', applyQuad, 'Straighten the four-cornered area into a rectangle and crop to it, as one step you can undo. Enter does the same.', true),
          btn('Start again', 'quad-reset', resetQuad, 'Put the four corners back to where they started. Esc does the same.'),
          hint('Drag the four round corners onto the corners of a slanted surface (a sign, a page, a screen), or drag a new box.'));
      }
    },
    overlay(ctx) {
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
      turnDrag = null; grab = null;
      if (prev === 'crop-quad' && next !== 'crop-quad') quad = null;
      if (next === 'crop-quad') { ensureQuad(); host.render(); }
    },
    state: () => ({ turn: turnDegrees(host.turn()), quad: quad ? quad.map((c) => ({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 })) : null }),
  };
}
