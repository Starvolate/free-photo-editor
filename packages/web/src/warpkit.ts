// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Bend and push (13 Nov 2026), loaded the first time one of them runs (commands.ts WARP_IDS): Bend with a 4 × 4 grid,
 * Re-angle a flat surface, Bend around pins and the Cage, as filter dialogs whose handles sit on the picture. The
 * maths is core/warp.ts, which the editor's worker runs; the dialog previews every handle move and Apply is one undo
 * step. Also two retouch dialogs that reuse filters the editor already has: a median smooth and an edge-keeping blur
 * for skin. Loading this file adds them to ADJ and their handle sets to HANDLES.
 */
import { PLANE, cageOf, gridOf, pinsOf } from '@free-photoeditor/core/warp';
import type { JobParams, Rect } from '@free-photoeditor/core';
import { ADJ, type AdjDef, type Ctl } from './commands';
import { HANDLES, type Guide, type Handle, type HandleSet } from './handles';

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
};
Object.assign(ADJ, WARP_ADJ);
Object.assign(HANDLES, WARP_HANDLES);
