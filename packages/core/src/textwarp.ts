// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Bent text and text along a line (Shapes & text, part 3). A text layer keeps its words and a `warp`; each time the words
 * are drawn, this moves every letter to its place on the bend and turns it to follow it. So the text stays text: the
 * words can be changed, the bend changed or taken off, at any time. Pure numbers in, numbers out (no DOM).
 */
import type { Point } from './geometry';
import type { TextStyle } from './vector';
import { walk } from './pathops';

export type WarpStyle = 'arc' | 'arch' | 'bulge' | 'wave' | 'flag' | 'circle' | 'path' | 'vertical' | 'shape';
/** How a text layer's letters are bent. */
export interface TextWarp {
  style: WarpStyle;
  /** −100…100: how far, and which way (a negative arc smiles, a positive one frowns like a rainbow). */ bend: number;
  /** 'path': the line the words run along, as points, and whether it closes into a ring. 'shape': the outline the words fill. */ path?: Point[]; closed?: boolean;
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

/** Where a level line at height y crosses a closed outline: the runs inside it, left to right (even-odd). */
export function shapeSpans(poly: readonly Point[], y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if ((a.y <= y) !== (b.y <= y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}
/** The runs inside the outline right across a band of lines: inside at its top, its middle and its bottom. */
function bandSpans(poly: readonly Point[], y0: number, y1: number): [number, number][] {
  let cur = shapeSpans(poly, y0);
  for (const y of [(y0 + y1) / 2, y1]) {
    const nx = shapeSpans(poly, y), out: [number, number][] = [];
    for (const [a, b] of cur) for (const [c, d] of nx) { const l = Math.max(a, c), r = Math.min(b, d); if (r > l) out.push([l, r]); }
    cur = out;
  }
  return cur;
}

/**
 * Text that fills a shape. The words are wrapped line by line into the widest run inside the outline at each line's
 * height, from the top of the outline down; a word too long for a run is broken between letters, a run narrower than one
 * letter size is skipped, and words that do not fit above the bottom are hidden (null). Each new paragraph starts a new
 * line. `gs` are the letters laid out straight (layoutText), `chars` the letters themselves; spaces come back null.
 */
export function fillShape(gs: readonly GlyphBox[], chars: readonly string[], poly: readonly Point[],
  o: { size: number; advance: number; align: 'left' | 'center' | 'right' }): (GlyphSpot | null)[] {
  const out: (GlyphSpot | null)[] = gs.map(() => null);
  if (poly.length < 3 || !gs.length) return out;
  const top = Math.min(...poly.map((p) => p.y)), bottom = Math.max(...poly.map((p) => p.y)), asc = o.size * 0.8;
  // Words: runs of letters that are not spaces, in reading order; a paragraph ends where the straight line changes.
  const words: { s: number; e: number; para: boolean }[] = [];
  for (let i = 0; i < gs.length; i++) {
    if (!chars[i].trim()) continue;
    const s = i;
    while (i + 1 < gs.length && chars[i + 1].trim() && gs[i + 1].base === gs[s].base) i++;
    words.push({ s, e: i, para: !words.length || gs[s].base !== gs[words[words.length - 1].e].base });
  }
  const right = (i: number): number => gs[i].x + gs[i].w;
  let k = 0, wi = 0, from = -1;
  while (wi < words.length) {
    const base = top + k * o.advance + asc;
    if (base + o.size * 0.2 > bottom) break;
    k++;
    const spans = bandSpans(poly, base - o.size * 0.75, base + o.size * 0.2);
    let best: [number, number] | null = null;
    for (const sp of spans) if (!best || sp[1] - sp[0] > best[1] - best[0]) best = sp;
    if (!best || best[1] - best[0] < o.size) continue;
    const room = best[1] - best[0];
    // Letters from glyph `first` to `last` go on this line, kept at their straight spacing.
    let first = -1, last = -1;
    while (wi < words.length) {
      const w = words[wi], s = from >= 0 ? from : w.s;
      if (first >= 0 && w.para && from < 0) break;
      const lead = first >= 0 ? first : s;
      if (right(w.e) - gs[lead].x <= room) { if (first < 0) first = s; last = w.e; from = -1; wi++; continue; }
      if (first >= 0) break;
      // One word wider than the line: as many of its letters as fit, the rest on the next line.
      let e = s;
      while (e + 1 <= w.e && right(e + 1) - gs[s].x <= room) e++;
      if (right(e) - gs[s].x > room) break;
      first = s; last = e; from = e + 1;
      break;
    }
    if (first < 0) continue;
    const lw = right(last) - gs[first].x, x0 = o.align === 'center' ? best[0] + (room - lw) / 2 : o.align === 'right' ? best[1] - lw : best[0];
    for (let i = first; i <= last; i++) if (chars[i].trim()) out[i] = { x: x0 + gs[i].x - gs[first].x + gs[i].w / 2, y: base, angle: 0, sy: 1 };
  }
  return out;
}

/** The nine letter widths a browser can ask a font for (canvas fontStretch takes these words only), as percentages. */
export const STRETCHES: [number, string][] = [
  [50, 'ultra-condensed'], [62.5, 'extra-condensed'], [75, 'condensed'], [87.5, 'semi-condensed'], [100, 'normal'],
  [112.5, 'semi-expanded'], [125, 'expanded'], [150, 'extra-expanded'], [200, 'ultra-expanded'],
];
/** The browser's word for the nearest of those widths to `pct`. */
export function stretchKeyword(pct: number): string {
  let best = STRETCHES[4];
  for (const s of STRETCHES) if (Math.abs(s[0] - pct) < Math.abs(best[0] - pct)) best = s;
  return best[1];
}

/** Which part of a saved text look to use: all of it, only the letters (character style), or only the lines (paragraph style). */
export type LookPart = 'all' | 'letters' | 'lines';
/** A text style with a saved look put on it. Letters: font, size, colour, weight, spacing and edges; lines: alignment and line gap. */
export function applyLook(st: TextStyle, look: TextStyle, part: LookPart): TextStyle {
  if (part === 'all') return { ...look };
  const lines: Partial<TextStyle> = { align: look.align, lineHeight: look.lineHeight };
  if (part === 'lines') return { ...st, ...lines };
  return { ...look, align: st.align, lineHeight: st.lineHeight };
}
