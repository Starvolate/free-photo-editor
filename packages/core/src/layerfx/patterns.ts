// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The built-in patterns (design 2.6), drawn by code so they are our own and the same on every machine, plus patterns made
 * from part of a picture. Both the pattern overlay effect and the pattern layer use them, tiled from the document's
 * top-left corner. Loaded with the effects module, never on the first screen.
 */
import type { RGBA } from '../color';
import type { PatternImage } from '../document';

/** Each pattern: its id (saved in files), its plain name, and the colour its Layers swatch shows. */
export const PATTERNS: readonly { id: string; plain: string; swatch: RGBA }[] = [
  { id: 'fpe:checks', plain: 'Checks', swatch: { r: 178, g: 178, b: 178, a: 255 } },
  { id: 'fpe:dots', plain: 'Dots', swatch: { r: 215, g: 215, b: 215, a: 255 } },
  { id: 'fpe:stripes', plain: 'Stripes', swatch: { r: 196, g: 196, b: 196, a: 255 } },
  { id: 'fpe:grid', plain: 'Grid', swatch: { r: 221, g: 221, b: 221, a: 255 } },
  { id: 'fpe:diagonal', plain: 'Diagonal lines', swatch: { r: 206, g: 206, b: 206, a: 255 } },
  { id: 'fpe:bricks', plain: 'Bricks', swatch: { r: 172, g: 88, b: 64, a: 255 } },
  { id: 'fpe:grain', plain: 'Grain', swatch: { r: 128, g: 128, b: 128, a: 255 } },
  { id: 'fpe:linen', plain: 'Linen', swatch: { r: 214, g: 205, b: 184, a: 255 } },
];
/** The light and the ink of the two-tone patterns, 0..1. */
const LIGHT = 235 / 255, INK = 120 / 255;
const mod = (a: number, n: number): number => ((a % n) + n) % n;
/** A fixed noise value from 0 to 1 for an integer point (the same on every run). */
function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export interface PatternSource { pattern: string; scale: number; image?: PatternImage; }
/** The pattern's colour at document pixel (x, y), straight RGBA from 0 to 1, written to out[o..o+3]. Scale 2 = twice as big. */
export function patternPixel(p: PatternSource, x: number, y: number, out: Float32Array, o: number): void {
  const s = Math.max(0.05, p.scale || 1), u = Math.floor(x / s), v = Math.floor(y / s), im = p.image;
  if (im && im.width > 0 && im.height > 0) {
    const i = (mod(v, im.height) * im.width + mod(u, im.width)) * 4;
    out[o] = im.data[i] / 255; out[o + 1] = im.data[i + 1] / 255; out[o + 2] = im.data[i + 2] / 255; out[o + 3] = im.data[i + 3] / 255;
    return;
  }
  out[o + 3] = 1;
  if (p.pattern === 'fpe:bricks') {
    const row = Math.floor(v / 8), col = Math.floor((u + (row & 1 ? 8 : 0)) / 16);
    if (mod(v, 8) === 0 || mod(u + (row & 1 ? 8 : 0), 16) === 0) { out[o] = 222 / 255; out[o + 1] = 216 / 255; out[o + 2] = 206 / 255; return; }
    const k = 0.9 + 0.2 * hash(col, row);
    out[o] = (172 / 255) * k; out[o + 1] = (88 / 255) * k; out[o + 2] = (64 / 255) * k;
    return;
  }
  if (p.pattern === 'fpe:linen') {
    const k = 1 - 0.12 * ((mod(u, 4) < 2) !== (mod(v, 4) < 2) ? 1 : 0) - 0.08 * hash(u, v);
    out[o] = (226 / 255) * k; out[o + 1] = (218 / 255) * k; out[o + 2] = (198 / 255) * k;
    return;
  }
  let t: number;
  switch (p.pattern) {
    case 'fpe:dots': { const dx = mod(u, 12) - 5.5, dy = mod(v, 12) - 5.5; t = dx * dx + dy * dy <= 9 ? 1 : 0; break; }
    case 'fpe:stripes': t = mod(v, 12) < 4 ? 1 : 0; break;
    case 'fpe:grid': t = mod(u, 16) === 0 || mod(v, 16) === 0 ? 1 : 0; break;
    case 'fpe:diagonal': t = mod(u + v, 12) < 3 ? 1 : 0; break;
    case 'fpe:grain': out[o] = out[o + 1] = out[o + 2] = 0.35 + 0.3 * hash(u, v); return;
    default: t = (Math.floor(u / 8) + Math.floor(v / 8)) & 1; // checks, 8 px squares
  }
  out[o] = out[o + 1] = out[o + 2] = LIGHT + (INK - LIGHT) * t;
}
