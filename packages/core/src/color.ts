// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Colours: 0-255 RGBA with straight (not premultiplied) alpha, plus HSL helpers. */
export interface RGBA { r: number; g: number; b: number; a: number; }
export const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };
export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

export function parseHex(hex: string): RGBA | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return null;
  const n = (i: number): number => parseInt(s.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) : 255 };
}
export const toHex = (c: RGBA): string => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** r, g, b in 0..1 into out = [h 0..1, s 0..1, l 0..1]. */
export function rgbToHslInto(r: number, g: number, b: number, out: Float64Array): void {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) { out[0] = 0; out[1] = 0; out[2] = l; return; }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  out[0] = h / 6; out[1] = s; out[2] = l;
}
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
/** h, s, l in 0..1 into out = [r, g, b] in 0..1. */
export function hslToRgbInto(h: number, s: number, l: number, out: Float64Array): void {
  if (s === 0) { out[0] = out[1] = out[2] = l; return; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  out[0] = hue2rgb(p, q, h + 1 / 3); out[1] = hue2rgb(p, q, h); out[2] = hue2rgb(p, q, h - 1 / 3);
}
