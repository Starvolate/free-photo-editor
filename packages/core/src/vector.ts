// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Text and shape layers. Such a layer keeps what it is made of (words and their style, or a shape and its colours) next to
 * its pixels, so it can be changed later without losing quality. The web app draws the pixels; this module holds the
 * description, the shape outlines and the text layout (a measuring function is passed in, so it needs no DOM).
 */
import { findLayer, geomOf, setGeom, type Doc, type Layer, type LayerGeom } from './document';
import type { Point, Rect } from './geometry';
import type { Command } from './history';
import type { TextWarp } from './textwarp';

export interface TextStyle {
  font: string; size: number; color: string; bold: boolean; italic: boolean;
  align: 'left' | 'center' | 'right';
  /** Distance between lines, as a multiple of the size. */ lineHeight: number;
  /** Extra space between letters, in pixels. */ letterSpacing: number;
  /** false: sharp letter edges, no anti-aliasing (textwarp.ts hardEdges). Missing means smooth. */ smooth?: boolean;
  /** Font weight 100 to 900 (variable fonts take any number between); missing means 400, or 700 when bold. */ weight?: number;
  /** Letter width as a percentage (textwarp.ts STRETCHES); missing means 100. */ stretch?: number;
  /** false: letter pairs are not fitted (kerning off). */ kerning?: boolean;
  /** Small capitals. */ caps?: 'normal' | 'small-caps' | 'all-small-caps';
}
export interface TextContent {
  kind: 'text'; text: string; x: number; y: number; style: TextStyle;
  /** Bent text or text along a line (textwarp.ts): the words stay words, the bend is drawn each time. */ warp?: TextWarp;
}
export type ShapeKind = 'rect' | 'rounded' | 'ellipse' | 'polygon' | 'line';
export interface ShapeContent {
  kind: 'shape'; shape: ShapeKind; x0: number; y0: number; x1: number; y1: number;
  fill: string | null; stroke: string | null; strokeWidth: number;
  /** Rounded rectangle: corner radius in pixels. */ radius: number;
  /** Polygon: number of sides (or points of a star). */ sides: number; star: boolean;
  /** Line: draw an arrow head at the end. */ arrow: boolean;
}
/** What a text or shape layer is made of. `at` is where the layer sat when its pixels were drawn. */
export type LayerContent = (TextContent | ShapeContent) & { at?: Point };
export const DEFAULT_TEXT_STYLE: TextStyle = { font: 'system-ui', size: 48, color: '#000000', bold: false, italic: false, align: 'left', lineHeight: 1.2, letterSpacing: 0 };
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
/** A CSS font string for a text style. */
export const fontString = (st: TextStyle, size = st.size): string =>
  `${st.italic ? 'italic ' : ''}${st.weight ?? (st.bold ? 700 : 400)} ${size}px ${GENERIC.has(st.font) ? st.font : `"${st.font.replace(/"/g, '')}"`}`;

export interface TextLine { text: string; x: number; y: number; width: number; }
export interface TextLayout { lines: TextLine[]; box: Rect; advance: number; }
/** Lay out point text: one line per paragraph, lined up left, centred or right of x; y is the top of the first line. */
export function layoutText(c: TextContent, measure: (s: string) => number): TextLayout {
  const st = c.style, advance = st.size * st.lineHeight, lines: TextLine[] = [];
  let left = Infinity, right = -Infinity;
  c.text.split('\n').forEach((t, i) => {
    const n = [...t].length, w = measure(t) + (n > 1 ? st.letterSpacing * (n - 1) : 0);
    const x = st.align === 'center' ? c.x - w / 2 : st.align === 'right' ? c.x - w : c.x;
    lines.push({ text: t, x, y: c.y + i * advance, width: w });
    left = Math.min(left, x); right = Math.max(right, x + w);
  });
  if (right < left) { left = c.x; right = c.x; }
  return { lines, advance, box: { x: left, y: c.y, w: right - left, h: lines.length * advance } };
}
/** The outline of a shape in picture pixels: corners of rectangles and polygons, points around ovals, the two ends of a line. */
export function shapePoints(s: ShapeContent): Point[] {
  const x = Math.min(s.x0, s.x1), y = Math.min(s.y0, s.y1), w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
  if (s.shape === 'line') return [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }];
  if (s.shape === 'rect' || (s.shape === 'rounded' && s.radius <= 0)) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const cx = x + w / 2, cy = y + h / 2, out: Point[] = [];
  if (s.shape === 'ellipse') {
    for (let i = 0; i < 96; i++) { const a = (i / 96) * Math.PI * 2; out.push({ x: cx + (Math.cos(a) * w) / 2, y: cy + (Math.sin(a) * h) / 2 }); }
    return out;
  }
  if (s.shape === 'polygon') {
    const n = Math.max(3, Math.round(s.sides)), k = s.star ? 2 * n : n;
    for (let i = 0; i < k; i++) {
      const a = -Math.PI / 2 + (i / k) * Math.PI * 2, f = s.star && i % 2 ? 0.5 : 1;
      out.push({ x: cx + (Math.cos(a) * w * f) / 2, y: cy + (Math.sin(a) * h * f) / 2 });
    }
    return out;
  }
  const r = Math.min(s.radius, w / 2, h / 2);
  const corner = (ccx: number, ccy: number, from: number): void => {
    for (let i = 0; i <= 8; i++) { const a = from + (i / 8) * (Math.PI / 2); out.push({ x: ccx + Math.cos(a) * r, y: ccy + Math.sin(a) * r }); }
  };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return out;
}
/** The arrow head of a line shape, as a triangle, or null. */
export function arrowHead(s: ShapeContent): Point[] | null {
  if (s.shape !== 'line' || !s.arrow) return null;
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0, len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const ux = dx / len, uy = dy / len, size = Math.max(10, s.strokeWidth * 3.5);
  const bx = s.x1 - ux * size, by = s.y1 - uy * size;
  return [{ x: s.x1, y: s.y1 }, { x: bx - uy * size * 0.55, y: by + ux * size * 0.55 }, { x: bx + uy * size * 0.55, y: by - ux * size * 0.55 }];
}
/** The box a shape's pixels need, including its outline. */
export function shapeBounds(s: ShapeContent): Rect {
  const pts = [...shapePoints(s), ...(arrowHead(s) ?? [])], pad = (s.stroke || s.shape === 'line' ? s.strokeWidth / 2 : 0) + 2;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), x0 = Math.floor(Math.min(...xs) - pad), y0 = Math.floor(Math.min(...ys) - pad);
  return { x: x0, y: y0, w: Math.ceil(Math.max(...xs) + pad) - x0, h: Math.ceil(Math.max(...ys) + pad) - y0 };
}
/** The content moved by dx, dy (after the layer itself was moved). */
export function moveContent(c: LayerContent, dx: number, dy: number): LayerContent {
  if (!dx && !dy) return c;
  if (c.kind === 'text') {
    const w = c.warp; // text along a line: its line moves too
    return { ...c, x: c.x + dx, y: c.y + dy, ...(w?.path && { warp: { ...w, path: w.path.map((p) => ({ x: p.x + dx, y: p.y + dy })) } }) };
  }
  return { ...c, x0: c.x0 + dx, y0: c.y0 + dy, x1: c.x1 + dx, y1: c.y1 + dy };
}
/** The content as it applies now: shifted by however far the layer moved since it was drawn. */
export function currentContent(l: Layer): LayerContent | null {
  const c = l.content;
  if (!c) return null;
  return c.at ? moveContent(c, l.x - c.at.x, l.y - c.at.y) : c;
}
/** Replace a layer's content and pixels together, as one undoable step. Content objects are never changed in place. */
export function contentCommand(doc: Doc, layerId: string, content: LayerContent | null, geom: LayerGeom | null, label: string): Command | null {
  const l = findLayer(doc, layerId);
  if (!l) return null;
  const before = { content: l.content ?? null, geom: geomOf(l) }, after = { content, geom: geom ?? geomOf(l) };
  const apply = (d: Doc, s: { content: LayerContent | null; geom: LayerGeom }): void => {
    const x = findLayer(d, layerId);
    if (!x) return;
    setGeom(x, s.geom);
    if (s.content) x.content = s.content; else delete x.content;
  };
  apply(doc, after);
  return { label, bytes: after.geom === before.geom ? 0 : after.geom.data.length, undo: (d) => apply(d, before), redo: (d) => apply(d, after) };
}
