// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Bent text and text along a line (Shapes & text, part 3). A text layer keeps its words and a `warp`; each time the words
 * are drawn, this moves every letter to its place on the bend and turns it to follow it. So the text stays text: the
 * words can be changed, the bend changed or taken off, at any time. Pure numbers in, numbers out (no DOM).
 */
import type { Point } from './geometry';
import { walk } from './pathops';

export type WarpStyle = 'arc' | 'arch' | 'bulge' | 'wave' | 'flag' | 'circle' | 'path' | 'vertical';
/** How a text layer's letters are bent. */
export interface TextWarp {
  style: WarpStyle;
  /** −100…100: how far, and which way (a negative arc smiles, a positive one frowns like a rainbow). */ bend: number;
  /** 'path': the line the words run along, as points, and whether it closes into a ring. */ path?: Point[]; closed?: boolean;
  /** 'path': how far along the line the words start, in pixels. */ start?: number;
}
/** One letter before bending: its left edge, its width and its line's baseline, in picture pixels. */
export interface GlyphBox { x: number; w: number; base: number; }
/** Where a letter is drawn after bending: the middle of its baseline, its turn (radians, clockwise) and its height scale. */
export interface GlyphSpot { x: number; y: number; angle: number; sy: number; }

const clampBend = (b: number): number => Math.max(-100, Math.min(100, Number.isFinite(b) ? b : 0)) / 100;

/**
 * Place each letter on the bend. Lines below the first stay the same distance under it, measured across the bend.
 * A letter that runs off the end of an open line comes back null (it is not drawn).
 */
export function warpGlyphs(gs: readonly GlyphBox[], warp: TextWarp, size: number): (GlyphSpot | null)[] {
  if (!gs.length) return [];
  const x0 = Math.min(...gs.map((g) => g.x)), x1 = Math.max(...gs.map((g) => g.x + g.w)), W = Math.max(1e-9, x1 - x0), xm = (x0 + x1) / 2;
  const ref = gs[0].base, b = clampBend(warp.bend), a = Math.abs(b);
  if (warp.style === 'vertical') {
    // Up-down text: letters stand upright one under another, one size apart, from the first line's baseline down. Each
    // further line is a column one line-gap to the LEFT of the one before, as vertical type runs in Japanese and Chinese.
    let j = 0, last = NaN;
    return gs.map((g) => {
      if (g.base !== last) { j = 0; last = g.base; }
      return { x: x0 + size / 2 - (g.base - ref), y: ref + size * j++, angle: 0, sy: 1 };
    });
  }
  if (warp.style === 'path') {
    const pts = warp.path ?? [];
    if (pts.length < 2) return gs.map((g) => ({ x: g.x + g.w / 2, y: g.base, angle: 0, sy: 1 }));
    const wk = walk(pts, !!warp.closed), start = warp.start ?? 0;
    return gs.map((g) => {
      const s = start + g.x + g.w / 2 - x0, dy = g.base - ref;
      if (!wk.closed && (s < 0 || s > wk.length)) return null;
      const p = wk.at(s);
      // The normal (−ty, tx) points to the right of the way the line runs: below it, for a line drawn left to right.
      return { x: p.x - p.ty * dy, y: p.y + p.tx * dy, angle: Math.atan2(p.ty, p.tx), sy: 1 };
    });
  }
  return gs.map((g): GlyphSpot => {
    const cx = g.x + g.w / 2, u = (cx - x0) / W, dy = g.base - ref;
    if (!b) return { x: cx, y: g.base, angle: 0, sy: 1 };
    switch (warp.style) {
      case 'arc': case 'arch': case 'circle': {
        // The letters' baseline is laid round a circle: half of it at full bend for an arc, all of it for a circle.
        const turn = warp.style === 'circle' ? 2 * Math.PI : Math.PI, R = W / (a * turn), phi = (u - 0.5) * a * turn;
        const r = b > 0 ? R - dy : R + dy, s = Math.sign(b);
        // The circle's centre sits R below the first baseline (or above it, for a negative bend).
        const x = xm + r * Math.sin(phi), y = ref + s * (R - r * Math.cos(phi));
        // An arch moves the letters the same way but keeps them standing upright.
        return { x, y, angle: warp.style === 'arch' ? 0 : s * phi, sy: 1 };
      }
      case 'bulge': {
        // Letters in the middle grow (or shrink) about a point 0.35 of the size above the baseline, the ends stay.
        const sy = Math.max(0.05, 1 + 0.6 * b * Math.sin(Math.PI * u));
        return { x: cx, y: g.base + (sy - 1) * 0.35 * size, angle: 0, sy };
      }
      case 'wave': case 'flag': {
        // A wave runs two full waves across the words and turns each letter with it; a flag runs one and a half, letters upright.
        const k = warp.style === 'wave' ? 2 : 1.5, amp = 0.25 * size * b, th = 2 * Math.PI * k * u;
        const slope = (-amp * 2 * Math.PI * k * Math.cos(th)) / W;
        return { x: cx, y: g.base - amp * Math.sin(th), angle: warp.style === 'wave' ? Math.atan(slope) : 0, sy: 1 };
      }
    }
    return { x: cx, y: g.base, angle: 0, sy: 1 };
  });
}

/** The corners of a letter of width `w` drawn at a spot (a box from `up` above its baseline to `down` below it). */
export function glyphCorners(s: GlyphSpot, w: number, up: number, down: number): Point[] {
  const c = Math.cos(s.angle), n = Math.sin(s.angle);
  return [[-w / 2, -up * s.sy], [w / 2, -up * s.sy], [w / 2, down * s.sy], [-w / 2, down * s.sy]].map(([px, py]) => ({ x: s.x + px * c - py * n, y: s.y + px * n + py * c }));
}

/**
 * Sharp letter edges (anti-aliasing off): every pixel is either fully the text colour or empty, cut at half. Changes the
 * RGBA pixels in place (straight alpha, as the canvas gives them back).
 */
export function hardEdges(data: Uint8ClampedArray): Uint8ClampedArray {
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] >= 128 ? 255 : 0;
  return data;
}

/**
 * Find and replace in one text: every place `find` occurs (exactly as typed, or ignoring capitals) becomes `put`. Special
 * characters are plain letters here, in both boxes. Returns the new text and how many places changed.
 */
export function replaceText(text: string, find: string, put: string, matchCase = true): { text: string; count: number } {
  if (!find) return { text, count: 0 };
  let count = 0;
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  return { text: text.replace(re, () => { count++; return put; }), count };
}
