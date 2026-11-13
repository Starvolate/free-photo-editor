// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * On-picture handles for the camera blurs (blur around a spot, miniature effect, gradual blur). Pure geometry in
 * picture pixels, no DOM: the editor draws the guides and handles these return, and dragging a handle sets the same
 * settings the dialog's sliders show, so keyboard, touch and mouse users all reach every setting.
 */
import type { JobParams, Rect } from '@free-photoeditor/core';

export interface Guide { kind: 'ellipse' | 'line'; x: number; y: number; rx?: number; ry?: number; x2?: number; y2?: number; dash?: boolean; }
export interface Handle { key: string; x: number; y: number; big?: boolean; }
export interface Guides { guides: Guide[]; handles: Handle[]; }
export interface HandleSet {
  /** Guides and handles for these settings over the edited box `b` (picture pixels). */
  draw(p: JobParams, b: Rect): Guides;
  /** A handle was dragged to (x, y): update the settings. */
  drag(key: string, x: number, y: number, p: JobParams, b: Rect): void;
  /**
   * A press away from every handle, at (x, y): true when it set something (the develop sheet's grey picker), or the key of
   * a handle it added there, ready to drag (pins, the cage); false or null to ignore the press.
   */
  press?(x: number, y: number, p: JobParams, b: Rect): boolean | string | null;
}

const val = (p: JobParams, k: string, d: number): number => p[k] ?? d;
const pct = (v: number): number => Math.round(Math.max(0, Math.min(100, v)));
const across = (x: number, b: Rect): number => pct(((x - b.x) / Math.max(1, b.w)) * 100);
const down = (y: number, b: Rect): number => pct(((y - b.y) / Math.max(1, b.h)) * 100);

const iris: HandleSet = {
  draw(p, b) {
    const cx = b.x + (val(p, 'cx', 50) / 100) * b.w, cy = b.y + (val(p, 'cy', 50) / 100) * b.h, rx = (val(p, 'rw', 25) / 100) * b.w, ry = (val(p, 'rh', 30) / 100) * b.h;
    const f = 1 - val(p, 'feather', 50) / 100;
    return {
      guides: [{ kind: 'ellipse', x: cx, y: cy, rx, ry }, { kind: 'ellipse', x: cx, y: cy, rx: rx * f, ry: ry * f, dash: true }],
      handles: [{ key: 'centre', x: cx, y: cy, big: true }, { key: 'width', x: cx + rx, y: cy }, { key: 'height', x: cx, y: cy - ry },
        { key: 'feather', x: cx - rx * f * Math.SQRT1_2, y: cy - ry * f * Math.SQRT1_2 }],
    };
  },
  drag(key, x, y, p, b) {
    const cx = b.x + (val(p, 'cx', 50) / 100) * b.w, cy = b.y + (val(p, 'cy', 50) / 100) * b.h;
    if (key === 'centre') { p.cx = across(x, b); p.cy = down(y, b); return; }
    if (key === 'width') { p.rw = Math.max(2, pct((Math.abs(x - cx) / Math.max(1, b.w)) * 100)); return; }
    if (key === 'height') { p.rh = Math.max(2, pct((Math.abs(y - cy) / Math.max(1, b.h)) * 100)); return; }
    const rx = Math.max(1, (val(p, 'rw', 25) / 100) * b.w), ry = Math.max(1, (val(p, 'rh', 30) / 100) * b.h);
    p.feather = Math.max(2, pct((1 - Math.min(1, Math.hypot((x - cx) / rx, (y - cy) / ry))) * 100));
  },
};
const tilt: HandleSet = {
  draw(p, b) {
    const cx = b.x + (val(p, 'cx', 50) / 100) * b.w, cy = b.y + (val(p, 'cy', 50) / 100) * b.h, a = (val(p, 'angle', 0) * Math.PI) / 180;
    const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, L = Math.hypot(b.w, b.h), band = (val(p, 'band', 15) / 100) * b.h, outer = band + (val(p, 'fade', 20) / 100) * b.h;
    const line = (o: number, dash: boolean): Guide => ({ kind: 'line', x: cx + nx * o - ux * L, y: cy + ny * o - uy * L, x2: cx + nx * o + ux * L, y2: cy + ny * o + uy * L, dash });
    const arm = Math.min(b.w, b.h) * 0.3;
    return {
      guides: [line(0, true), line(band, false), line(-band, false), line(outer, true), line(-outer, true)],
      handles: [{ key: 'centre', x: cx, y: cy, big: true }, { key: 'band', x: cx + nx * band, y: cy + ny * band }, { key: 'fade', x: cx + nx * outer, y: cy + ny * outer },
        { key: 'angle', x: cx + ux * arm, y: cy + uy * arm }],
    };
  },
  drag(key, x, y, p, b) {
    const cx = b.x + (val(p, 'cx', 50) / 100) * b.w, cy = b.y + (val(p, 'cy', 50) / 100) * b.h, a = (val(p, 'angle', 0) * Math.PI) / 180;
    const off = Math.abs(-(x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)), band = (val(p, 'band', 15) / 100) * b.h;
    if (key === 'centre') { p.cx = across(x, b); p.cy = down(y, b); } else if (key === 'band') p.band = pct((off / Math.max(1, b.h)) * 100);
    else if (key === 'fade') p.fade = Math.max(1, pct(((off - band) / Math.max(1, b.h)) * 100));
    else { let deg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI; if (deg > 90) deg -= 180; if (deg < -90) deg += 180; p.angle = Math.round(deg); }
  },
};
const field: HandleSet = {
  draw(p, b) {
    const x1 = b.x + (val(p, 'x1', 30) / 100) * b.w, y1 = b.y + (val(p, 'y1', 30) / 100) * b.h, x2 = b.x + (val(p, 'x2', 70) / 100) * b.w, y2 = b.y + (val(p, 'y2', 70) / 100) * b.h;
    const ring = (x: number, y: number, blur: number): Guide => ({ kind: 'ellipse', x, y, rx: 10 + blur, ry: 10 + blur, dash: true });
    return { guides: [{ kind: 'line', x: x1, y: y1, x2, y2, dash: true }, ring(x1, y1, val(p, 'b1', 0)), ring(x2, y2, val(p, 'b2', 20))],
      handles: [{ key: 'pin1', x: x1, y: y1, big: true }, { key: 'pin2', x: x2, y: y2, big: true }] };
  },
  drag(key, x, y, p, b) {
    if (key === 'pin1') { p.x1 = across(x, b); p.y1 = down(y, b); } else { p.x2 = across(x, b); p.y2 = down(y, b); }
  },
};
/** The camera blurs' sets (and the develop sheet's spot); warpkit.ts adds the bends' sets (grid, surface, pins, cage) when it loads. */
export const HANDLES: Record<string, HandleSet> = { iris, tilt, field };
