// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Bend and push (13 Nov 2026), loaded the first time one of them runs (commands.ts WARP_IDS): Bend with a 4 × 4 grid,
 * Re-angle a flat surface, Bend around pins and the Cage, as filter dialogs whose handles sit on the picture. The
 * maths is core/warp.ts, which the editor's worker runs; the dialog previews every handle move and Apply is one undo
 * step. Also two retouch dialogs that reuse filters the editor already has: a median smooth and an edge-keeping blur
 * for skin. Loading this file adds them to ADJ and their handle sets to HANDLES.
 *
 * Part 3: Push pixels like liquid (Liquify) on the sheet's own preview, Stretch without squashing people (seam carving,
 * run in the worker), Smooth a face by detail layers (frequency separation), Fix a blurry photo (deblur, a filter dialog),
 * and Fit canvas, moved here so the first screen does not carry it.
 */
import {
  LIQUIFY_TOOLS, PLANE, cageOf, gridOf, liquifyDab, liquifyDraw, newField, pinsOf, textureLayer, type LiquifyTool,
} from '@free-photoeditor/core/warp';
import {
  activeLayer, createLayer, docCommand, fitCanvas, hasPixels, layersBox, snapshotDoc, type Bitmap, type Doc, type JobParams, type JobSpec, type Layer, type Rect,
} from '@free-photoeditor/core';
import { geomOf, layerDataCommand } from '@free-photoeditor/core/selection-more';
import { ADJ, type AdjDef, type Ctl } from './commands';
import { h } from './dom';
import { HANDLES, type Guide, type Handle, type HandleSet } from './handles';
import type { ToolHost } from './toolkit';

type Pt = [number, number];
const val = (p: JobParams, k: string, d: number): number => { const v = p[k]; return typeof v === 'number' && Number.isFinite(v) ? v : d; };
/** A handle setting (percent of the box, 0 = first pixel, 100 = last) as a picture position, and back. */
export const at = (b: Rect, x: number, y: number): Pt => [b.x + (x / 100) * Math.max(0, b.w - 1), b.y + (y / 100) * Math.max(0, b.h - 1)];
const lim = (v: number): number => Math.round(Math.max(-50, Math.min(150, v)) * 100) / 100;
export const pctOf = (b: Rect, x: number, y: number): Pt => [lim(((x - b.x) / Math.max(1, b.w - 1)) * 100), lim(((y - b.y) / Math.max(1, b.h - 1)) * 100)];
const line = (a: Pt, c: Pt, dash = false): Guide => ({ kind: 'line', x: a[0], y: a[1], x2: c[0], y2: c[1], dash });
const ring = (pts: Pt[], dash = false): Guide[] => pts.map((a, i) => line(a, pts[(i + 1) % pts.length], dash));
const key = (k: string, s: string): number => Number(k.slice(s.length));

// ---------- the 4 × 4 grid ----------
const mesh: HandleSet = {
  draw(p, b) {
    const g = gridOf(p).map(([x, y]) => at(b, x, y)), guides: Guide[] = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      if (i < 3) guides.push(line(g[j * 4 + i], g[j * 4 + i + 1]));
      if (j < 3) guides.push(line(g[j * 4 + i], g[j * 4 + i + 4]));
    }
    return { guides, handles: g.map(([x, y], k) => ({ key: 'g' + k, x, y })) };
  },
  drag(k, x, y, p, b) { const n = key(k, 'g'), [px, py] = pctOf(b, x, y); p[`g${n}x`] = px; p[`g${n}y`] = py; },
};
/** The 16 grid settings for a shape: `f` names how far each point (column i, row j) moves, in percent of the box. */
export function gridFill(f: (i: number, j: number) => Pt): Record<string, number> {
  const o: Record<string, number> = {};
  for (let k = 0; k < 16; k++) { const i = k % 4, j = k >> 2, [dx, dy] = f(i, j); o[`g${k}x`] = (i * 100) / 3 + dx; o[`g${k}y`] = (j * 100) / 3 + dy; }
  return o;
}
const mid = (t: number): number => (t === 1 || t === 2 ? 1 : 0);
export const SHAPES: readonly string[] = ['Your own (drag the handles)', 'Arc', 'Bulge', 'Flag', 'Wave'];
export const SHAPE_FILLS: ReadonlyArray<Record<string, number>> = [
  gridFill(() => [0, 0]),
  gridFill((i) => [0, -15 * mid(i)]),
  gridFill((i, j) => [12 * ((i - 1.5) / 1.5) * mid(j), 12 * ((j - 1.5) / 1.5) * mid(i)]),
  gridFill((i) => [0, [0, -10, 10, 0][i]]),
  gridFill((i, j) => [[0, 6, -6, 0][j], [0, -10, 10, 0][i]]),
];

// ---------- a flat surface: mark its corners, then re-angle it ----------
const plane: HandleSet = {
  draw(p, b) {
    const A = PLANE.map((c, i) => at(b, val(p, `a${i}x`, c[0]), val(p, `a${i}y`, c[1]))), B = PLANE.map((c, i) => at(b, val(p, `b${i}x`, c[0]), val(p, `b${i}y`, c[1])));
    const second = val(p, 'step', 0) === 1, show = second ? B : A;
    return { guides: second ? [...ring(A, true), ...ring(B)] : ring(A), handles: show.map(([x, y], i) => ({ key: (second ? 'b' : 'a') + i, x, y, big: true })) };
  },
  drag(k, x, y, p, b) {
    const i = key(k, k[0]), [px, py] = pctOf(b, x, y);
    if (k[0] === 'b') { p[`b${i}x`] = px; p[`b${i}y`] = py; return; }
    // Marking the surface moves its re-angled corner along, so a finished re-angle keeps its shape.
    const ax = val(p, `a${i}x`, PLANE[i][0]), ay = val(p, `a${i}y`, PLANE[i][1]);
    p[`b${i}x`] = lim(val(p, `b${i}x`, PLANE[i][0]) + px - ax); p[`b${i}y`] = lim(val(p, `b${i}y`, PLANE[i][1]) + py - ay);
    p[`a${i}x`] = px; p[`a${i}y`] = py;
  },
};

// ---------- pins ----------
export const MAX_PINS = 24;
const pins: HandleSet = {
  draw(p, b) {
    const { from, to } = pinsOf(p), guides: Guide[] = [], handles: Handle[] = [];
    to.forEach((q, i) => {
      const s = at(b, from[i][0], from[i][1]), e = at(b, q[0], q[1]);
      if (Math.hypot(s[0] - e[0], s[1] - e[1]) > 0.5) guides.push(line(s, e, true));
      handles.push({ key: 'q' + i, x: e[0], y: e[1], big: true });
    });
    return { guides, handles };
  },
  drag(k, x, y, p, b) { const i = key(k, 'q'), [px, py] = pctOf(b, x, y); p[`q${i}x`] = px; p[`q${i}y`] = py; },
  add(x, y, p, b) {
    const n = Math.max(0, Math.round(val(p, 'n', 0)));
    if (n >= MAX_PINS) return null;
    const [px, py] = pctOf(b, x, y);
    p[`p${n}x`] = p[`q${n}x`] = px; p[`p${n}y`] = p[`q${n}y`] = py; p.n = n + 1;
    return 'q' + n;
  },
};

// ---------- the cage ----------
export const MAX_CAGE = 24;
/** Writes a whole cage back into the settings (after a point is added, every later point moves up one place). */
export function setCage(p: JobParams, drawn: Pt[], moved: Pt[]): void {
  p.n = drawn.length;
  drawn.forEach((o, i) => { p[`o${i}x`] = o[0]; p[`o${i}y`] = o[1]; p[`c${i}x`] = moved[i][0]; p[`c${i}y`] = moved[i][1]; });
}
/** Which edge of the cage a press is nearest to (the new point goes in after its first corner). */
export function nearestEdge(poly: readonly Pt[], x: number, y: number): number {
  let best = 0, bd = Infinity;
  poly.forEach((a, i) => {
    const c = poly[(i + 1) % poly.length], dx = c[0] - a[0], dy = c[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0, d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
const cage: HandleSet = {
  draw(p, b) {
    const c = cageOf(p), O = c.drawn.map((q) => at(b, q[0], q[1])), M = c.moved.map((q) => at(b, q[0], q[1])), second = val(p, 'step', 0) === 1;
    const show = second ? M : O;
    return { guides: second ? [...ring(O, true), ...ring(M)] : ring(O), handles: show.map(([x, y], i) => ({ key: (second ? 'c' : 'o') + i, x, y })) };
  },
  drag(k, x, y, p, b) {
    const i = key(k, k[0]), [px, py] = pctOf(b, x, y), c = cageOf(p);
    if (k[0] === 'o') {
      const dx = px - c.drawn[i][0], dy = py - c.drawn[i][1];
      c.drawn[i] = [px, py]; c.moved[i] = [lim(c.moved[i][0] + dx), lim(c.moved[i][1] + dy)];
    } else c.moved[i] = [px, py];
    setCage(p, c.drawn, c.moved);
  },
  add(x, y, p, b) {
    if (val(p, 'step', 0) === 1) return null;
    const c = cageOf(p);
    if (c.drawn.length >= MAX_CAGE) return null;
    const q = pctOf(b, x, y), e = nearestEdge(c.drawn, q[0], q[1]) + 1;
    c.drawn.splice(e, 0, q); c.moved.splice(e, 0, [q[0], q[1]]);
    setCage(p, c.drawn, c.moved);
    return 'o' + e;
  },
};

const SEL = (k: string, label: string, help: string, options: readonly string[], fills?: Ctl['fills']): Ctl => ({ key: k, label, help, value: 0, type: 'select', options, fills });
const R = (k: string, label: string, help: string, min: number, max: number, value: number, unit = ''): Ctl => ({ key: k, label, help, min, max, value, step: 1, unit });
export const WARP_HANDLES: Record<string, HandleSet> = { mesh, plane, pins, cage };
export const WARP_ADJ: Record<string, AdjDef> = {
  'edit.warp': { op: 'fx', kind: 'mesh-warp', handles: 'mesh', controls: [
    SEL('preset', 'Ready-made bend', 'Start from a shape, then drag any of the 16 handles: each one moves that exact point of the picture.', SHAPES, SHAPE_FILLS)] },
  'edit.perspective-warp': { op: 'fx', kind: 'perspective-warp', handles: 'plane', controls: [
    SEL('step', 'Step', 'First put the four corners on the corners of a flat surface, like a wall or a sign. Then pick step 2 and drag them to where they should be.',
      ['1. Mark the flat surface', '2. Re-angle it'])] },
  'edit.pin-warp': { op: 'fx', kind: 'pin-warp', handles: 'pins', controls: [
    SEL('style', 'How it bends', 'Click the picture to add pins, then drag a pin. Rigid keeps every part its size, like a puppet; Stretchy lets parts grow or shrink.',
      ['Rigid', 'Stretchy'])] },
  'edit.cage': { op: 'fx', kind: 'cage-warp', handles: 'cage', controls: [
    SEL('step', 'Step', 'First drag the points round the part you want to change (click near the cage to add a point). Then pick step 2 and move the points to reshape it.',
      ['1. Draw the cage', '2. Move the cage'])] },
  'retouch.median-brush': { op: 'fx', kind: 'median', controls: [
    R('radius', 'Strength', 'How wide an area each pixel is smoothed over. The median keeps edges sharper than a blur does.', 1, 20, 3, 'px')] },
  'retouch.smooth-skin': { op: 'fx', kind: 'surface-blur', controls: [
    R('radius', 'Smoothness', 'How wide an area the skin is smoothed over.', 1, 30, 8, 'px'),
    R('threshold', 'Keep edges', 'Edges with more contrast than this stay sharp, so eyes, lips and hair keep their detail.', 2, 100, 20)] },
  'retouch.deblur': { op: 'fx', kind: 'deblur', controls: [
    { key: 'size', label: 'Blur size', help: 'How wide the blur in the photo is, in pixels. Start small: too large a number adds halos.', min: 0.5, max: 8, value: 1.5, step: 0.5, unit: 'px' },
    R('rounds', 'Rounds', 'How many times the picture is corrected. More is sharper but slower, and can bring out speckle.', 1, 30, 8)] },
};
Object.assign(ADJ, WARP_ADJ);
Object.assign(HANDLES, WARP_HANDLES);

// ---------- part 3: sheets with their own preview or settings ----------
/** What the part-3 sheets need beyond the tool host: the worker, and fitting the view after the canvas changes size. */
export interface WarpHost extends ToolHost {
  job(spec: JobSpec, src: Bitmap): Promise<Uint8ClampedArray>;
  fit(): void;
}
export const WARP_MORE_IDS = ['filter.liquify', 'edit.smart-scale', 'retouch.frequency-separation'];
const LQ = { size: 0, strength: 50 }, FS = { radius: 6 };
const bodies = new Map<string, HTMLElement>();
/** A sheet with Cancel and Apply (the same shape as selmore.ts's). */
function dialog(host: WarpHost, key: string, title: string, fields: HTMLElement[], apply: () => void | Promise<void>): void {
  let body = bodies.get(key);
  if (!body) { body = h('div', { class: 'fpe-stack', 'data-testid': 'wm-' + key }); bodies.set(key, body); }
  body.replaceChildren(...fields, h('div', { class: 'fpe-actions' },
    h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'wm-cancel', onclick: () => host.closeSheet() }, 'Cancel'),
    h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'wm-apply', onclick: () => { host.closeSheet(); void apply(); } }, 'Apply')));
  host.sheet('wm-' + key, title, body);
}
const note = (text: string): HTMLElement => h('p', { class: 'fpe-note' }, text);
function seg<T extends string>(label: string, help: string, opts: [T, string][], value: T, pick: (v: T) => void, testid: string): HTMLElement {
  const g = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': label });
  const paint = (): void => { for (const b of g.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.v === value)); };
  for (const [v, text] of opts) g.append(h('button', { type: 'button', 'data-v': v, 'data-testid': `${testid}-${v}`, onclick: () => { value = v; pick(v); paint(); } }, text));
  paint();
  return h('div', { class: 'fpe-field', 'data-help-title': label, 'data-help': help }, h('span', {}, label), g);
}
/** The active layer when its pixels may change; otherwise says why and gives null. */
function pixelLayer(host: WarpHost): { d: Doc; l: Layer } | null {
  const d = host.doc(), l = d ? activeLayer(d) : undefined;
  if (!d || !l) return null;
  if (!hasPixels(l)) { host.toast('Pick a picture layer first. Folders and light and colour layers have no pixels of their own.'); return null; }
  if (!host.editable(l, true)) return null;
  if (!l.visible) { host.toast('This layer is hidden. Show it to change it.'); return null; }
  return { d, l };
}
/** The same layer again after the sheet closes (it may have been deleted meanwhile). */
const again = (host: WarpHost, id: string): { d: Doc; l: Layer } | null => {
  const d = host.doc(), l = d?.layers.find((x) => x.id === id);
  return d && l ? { d, l } : null;
};

export function runWarpMore(id: string, host: WarpHost): void {
  const at = pixelLayer(host);
  if (!at) return;
  if (id === 'filter.liquify') liquify(host, at.l);
  else if (id === 'edit.smart-scale') smartScale(host, at.d, at.l);
  else if (id === 'retouch.frequency-separation') frequencySeparation(host, at.l);
}

const TOOLS: [LiquifyTool, string][] = [['push', 'Push'], ['pucker', 'Shrink'], ['bloat', 'Grow'], ['twirl', 'Twirl'], ['restore', 'Undo the push']];
/** How much one dab of each tool does at full strength (Push follows the pointer; the others build up while held). */
const PER_DAB: Record<LiquifyTool, number> = { push: 1, pucker: 0.08, bloat: 0.08, twirl: 0.5, restore: 0.25 };
/**
 * Liquify paints only on this sheet's preview: a copy of the layer at most 560 × 400. The field of moves is kept at that
 * size; Apply scales it up and redraws the layer once, as one undo step. The picture on the canvas does not change
 * until then.
 */
function liquify(host: WarpHost, l: Layer): void {
  const W = l.width, H = l.height, s = Math.min(1, 560 / W, 400 / H), w = Math.max(1, Math.round(W * s)), hh = Math.max(1, Math.round(H * s));
  const small = new Uint8ClampedArray(w * hh * 4);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(W - 1, Math.floor((x + 0.5) / s)), sy = Math.min(H - 1, Math.floor((y + 0.5) / s)), i = (sy * W + sx) * 4;
    small.set(l.data.subarray(i, i + 4), (y * w + x) * 4);
  }
  const src: Bitmap = { width: w, height: hh, data: small };
  let field = newField(w, hh), tool: LiquifyTool = 'push', touched = false, last: { x: number; y: number } | null = null, hold = 0, queued = false;
  let size = LQ.size || Math.max(20, Math.round(Math.min(W, H) / 4)), strength = LQ.strength;
  const cv = h('canvas', { width: w, height: hh, 'data-testid': 'lq-canvas', role: 'img', 'aria-label': 'A preview of the layer. Drag on it to push the pixels.',
    style: 'width:100%;height:auto;display:block;border-radius:6px;touch-action:none;cursor:crosshair;background:#fff' }) as HTMLCanvasElement;
  const draw = (): void => {
    queued = false;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(w, hh);
    img.data.set(liquifyDraw(src, field));
    ctx.putImageData(img, 0, 0);
  };
  const redraw = (): void => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  draw();
  const pt = (e: PointerEvent): { x: number; y: number } => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * w - 0.5, y: ((e.clientY - r.top) / Math.max(1, r.height)) * hh - 0.5 };
  };
  const dab = (x: number, y: number, vx = 0, vy = 0): void => {
    liquifyDab(field, tool, x, y, Math.max(1, (size * s) / 2), (strength / 100) * PER_DAB[tool], vx, vy);
    touched = true;
    redraw();
  };
  const stop = (): void => { last = null; if (hold) { clearInterval(hold); hold = 0; } };
  cv.addEventListener('pointerdown', (e) => {
    try { cv.setPointerCapture(e.pointerId); } catch { /* not captured: the brush still works inside the preview */ }
    last = pt(e);
    if (tool !== 'push') { dab(last.x, last.y); hold = window.setInterval(() => { if (last) dab(last.x, last.y); }, 40); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!last) return;
    const p = pt(e), dx = p.x - last.x, dy = p.y - last.y, R = Math.max(1, (size * s) / 2), n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, R / 4)));
    for (let k = 1; k <= n; k++) {
      const x = last.x + (dx * k) / n, y = last.y + (dy * k) / n;
      if (tool === 'push') dab(x - dx / n, y - dy / n, dx / n, dy / n); else dab(x, y);
    }
    last = p;
  });
  for (const ev of ['pointerup', 'pointercancel'] as const) cv.addEventListener(ev, stop);
  dialog(host, 'liquify', 'Push pixels like liquid · Liquify', [
    note('Drag on the preview to reshape the picture. Nothing changes on the canvas until you press Apply, and Apply is one undo step.'),
    cv,
    seg('Tool', 'Push (Forward warp) drags pixels along. Shrink (Pucker) and Grow (Bloat) work while you hold. Twirl turns them. Undo the push (Reconstruct) paints the picture back.',
      TOOLS, tool, (v) => { tool = v; }, 'lq-tool'),
    host.slider('Brush size', 'How wide the brush is, in picture pixels.', 4, Math.max(40, Math.round(Math.max(W, H) / 2)), size, ' px', (v) => { size = v; LQ.size = v; }, 'lq-size'),
    host.slider('Strength', 'How strongly each stroke moves the pixels.', 1, 100, strength, '%', (v) => { strength = v; LQ.strength = v; }, 'lq-strength'),
    h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'lq-reset', 'data-help-title': 'Start over',
      'data-help': 'Put the preview back as the layer is now.', onclick: () => { field = newField(w, hh); touched = false; redraw(); } }, 'Start over')),
  ], () => {
    stop();
    const at = again(host, l.id);
    if (!at) return;
    if (!touched || !field.dx.some((v, i) => Math.abs(v) > 1e-3 || Math.abs(field.dy[i]) > 1e-3)) { host.toast('Nothing was pushed, so the layer did not change. Drag on the preview first.'); return; }
    const g = geomOf(at.l), cmd = layerDataCommand('Push pixels like liquid', at.l.id, g, { ...g, data: liquifyDraw({ width: g.width, height: g.height, data: g.data }, field) });
    cmd.redo(at.d);
    host.push(cmd, true);
  });
}

/** Seam carving runs in the worker on a copy padded to the larger of the two sizes; the top-left corner is the result. */
function smartScale(host: WarpHost, d: Doc, l: Layer): void {
  const W = l.width, H = l.height, cover = l.x <= 0 && l.y <= 0 && l.x + W >= d.width && l.y + H >= d.height;
  const sel = d.selection, guard = sel ? { x: sel.x - l.x, y: sel.y - l.y, w: sel.w, h: sel.h } : null;
  let tw = Math.max(1, Math.round(W * 0.8)), th = H, keep = guard ? 'yes' : 'no';
  dialog(host, 'scale', 'Stretch without squashing people · Content-aware scale', [
    note('Plain parts such as sky, sea or walls are squeezed out or stretched; busy parts such as people keep their shape. Select a part first to protect it fully.'),
    host.slider('Width', 'The new width of the layer, in pixels.', Math.max(1, Math.round(W / 4)), W * 2, tw, ' px', (v) => { tw = v; }, 'ss-width'),
    host.slider('Height', 'The new height of the layer, in pixels.', Math.max(1, Math.round(H / 4)), H * 2, th, ' px', (v) => { th = v; }, 'ss-height'),
    ...(guard ? [seg('Protect the selected part', 'Yes keeps the selected part exactly its shape; the change happens around it.', [['yes', 'Yes'], ['no', 'No']], keep, (v) => { keep = v; }, 'ss-keep')] : []),
  ], async () => {
    if (tw === W && th === H) { host.toast('That is the size it is now. Change the width or height first.'); return; }
    const PW = Math.max(W, tw), PH = Math.max(H, th), pad = new Uint8ClampedArray(PW * PH * 4);
    for (let y = 0; y < H; y++) pad.set(l.data.subarray(y * W * 4, (y + 1) * W * 4), y * PW * 4);
    const g = keep === 'yes' && guard ? { px: guard.x, py: guard.y, pw: guard.w, ph: guard.h } : {};
    let out: Uint8ClampedArray;
    try { out = await host.job({ op: 'fx', kind: 'seam-scale', params: { ix: 0, iy: 0, iw: PW, ih: PH, w: W, h: H, tw, th, ...g } }, { width: PW, height: PH, data: pad }); }
    catch { host.toast('This could not finish. Try a smaller change.'); return; }
    const at = again(host, l.id);
    if (!at) return;
    const data = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) data.set(out.subarray(y * PW * 4, y * PW * 4 + tw * 4), y * tw * 4);
    const before = snapshotDoc(at.d);
    at.l.data = data; at.l.width = tw; at.l.height = th;
    if (cover) { at.l.x = 0; at.l.y = 0; at.d.width = tw; at.d.height = th; at.d.selection = null; }
    host.push(docCommand('Stretch without squashing people', before, snapshotDoc(at.d)), true);
    if (cover) host.fit();
    host.toast(`The layer is now ${tw} × ${th} px.${cover ? ' The canvas changed size with it.' : ''}`);
  });
}

/** Two layers above the active one: the picture blurred, and the fine detail in Linear light; together they look the same. */
function frequencySeparation(host: WarpHost, l: Layer): void {
  let radius = FS.radius;
  dialog(host, 'freq', 'Smooth a face by detail layers · Frequency separation', [
    note('Adds two layers above this one: Colour and tone (the picture blurred) and Texture (only the fine detail, such as pores). Smooth or paint on Colour and tone; the texture stays.'),
    host.slider('Detail size', 'Detail finer than this goes to the Texture layer. For skin pores, try 4 to 8 pixels.', 1, 50, radius, ' px', (v) => { radius = v; FS.radius = v; }, 'fs-radius'),
  ], async () => {
    let blur: Uint8ClampedArray;
    try { blur = await host.job({ op: 'gaussian-blur', params: { radius } }, { width: l.width, height: l.height, data: l.data.slice() }); }
    catch { host.toast('This could not finish. Try again.'); return; }
    const at = again(host, l.id);
    if (!at) return;
    const { d, l: base } = at, before = snapshotDoc(d), i = d.layers.indexOf(base);
    const lo = createLayer('Colour and tone', base.width, base.height, { x: base.x, y: base.y, data: blur });
    const hi = createLayer('Texture', base.width, base.height, { x: base.x, y: base.y, data: textureLayer(base.data, blur) });
    hi.blendMode = 'linear-light';
    if (base.parentId) lo.parentId = hi.parentId = base.parentId;
    d.layers.splice(i + 1, 0, lo, hi);
    d.activeId = lo.id;
    host.push(docCommand('Smooth a face by detail layers', before, snapshotDoc(d)), true);
    host.panels();
    host.toast('Added Colour and tone, and Texture above the layer. Smooth the skin on Colour and tone; the pores stay on Texture.');
  });
}

/** Fit the canvas to the selection, or round every layer's visible pixels; the layers keep all their pixels (one undo step). */
export function fitCanvasRun(host: WarpHost): void {
  const d = host.doc();
  if (!d) return;
  const s = d.selection, r = s ? { x: s.x, y: s.y, w: s.w, h: s.h } : layersBox(d);
  if (!r) { host.toast('Nothing to fit: every layer is empty.'); return; }
  const cmd = fitCanvas(d, r, s ? 'Fit canvas to selection' : 'Fit canvas to layers');
  if (!cmd) { host.toast('The canvas already fits.'); return; }
  host.push(cmd, true);
  host.fit();
  host.toast(`The canvas is now ${d.width} × ${d.height} px. Nothing was deleted: parts outside it are kept.`);
}
