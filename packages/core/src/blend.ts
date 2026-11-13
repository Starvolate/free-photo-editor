// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Blend modes: how a layer mixes with what is below it. The separable modes and the colour modes
 * follow the public W3C "Compositing and Blending Level 1" formulas; alpha uses source-over.
 */
import type { LayerMask } from './document';

export const BLEND_MODES = ['normal', 'dissolve', 'darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color',
  'lighten', 'screen', 'color-dodge', 'linear-dodge', 'lighter-color', 'overlay', 'soft-light', 'hard-light',
  'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'difference', 'exclusion', 'subtract', 'divide', 'hue',
  'saturation', 'color', 'luminosity'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal', dissolve: 'Dissolve', darken: 'Darken', multiply: 'Multiply', 'color-burn': 'Colour burn',
  'linear-burn': 'Linear burn', 'darker-color': 'Darker colour', lighten: 'Lighten', screen: 'Screen',
  'color-dodge': 'Colour dodge', 'linear-dodge': 'Add (linear dodge)', 'lighter-color': 'Lighter colour',
  overlay: 'Overlay', 'soft-light': 'Soft light', 'hard-light': 'Hard light', 'vivid-light': 'Vivid light',
  'linear-light': 'Linear light', 'pin-light': 'Pin light', 'hard-mix': 'Hard mix', difference: 'Difference',
  exclusion: 'Exclusion', subtract: 'Subtract', divide: 'Divide', hue: 'Hue', saturation: 'Saturation',
  color: 'Colour', luminosity: 'Luminosity',
};
export const BLEND_GROUPS: ReadonlyArray<{ label: string; modes: readonly BlendMode[] }> = [
  { label: 'Basic', modes: ['normal', 'dissolve'] },
  { label: 'Darken', modes: ['darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color'] },
  { label: 'Lighten', modes: ['lighten', 'screen', 'color-dodge', 'linear-dodge', 'lighter-color'] },
  { label: 'Contrast', modes: ['overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix'] },
  { label: 'Compare', modes: ['difference', 'exclusion', 'subtract', 'divide'] },
  { label: 'Colour', modes: ['hue', 'saturation', 'color', 'luminosity'] },
];
export const isBlendMode = (v: unknown): v is BlendMode => typeof v === 'string' && (BLEND_MODES as readonly string[]).includes(v);

type Sep = (b: number, s: number) => number;
const screen: Sep = (b, s) => b + s - b * s;
const colorDodge: Sep = (b, s) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
const colorBurn: Sep = (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const hardLight: Sep = (b, s) => (s <= 0.5 ? b * 2 * s : screen(b, 2 * s - 1));
const softLight: Sep = (b, s) => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
};
export const SEPARABLE: Partial<Record<BlendMode, Sep>> = {
  normal: (_b, s) => s, dissolve: (_b, s) => s, multiply: (b, s) => b * s, screen,
  overlay: (b, s) => hardLight(s, b), darken: (b, s) => Math.min(b, s), lighten: (b, s) => Math.max(b, s),
  'color-dodge': colorDodge, 'color-burn': colorBurn, 'hard-light': hardLight, 'soft-light': softLight,
  difference: (b, s) => Math.abs(b - s), exclusion: (b, s) => b + s - 2 * b * s,
  'linear-burn': (b, s) => Math.max(0, b + s - 1), 'linear-dodge': (b, s) => Math.min(1, b + s),
  subtract: (b, s) => Math.max(0, b - s), divide: (b, s) => (s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s)),
  'vivid-light': (b, s) => (s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * s - 1)),
  'linear-light': (b, s) => Math.min(1, Math.max(0, b + 2 * s - 1)),
  'pin-light': (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  'hard-mix': (b, s) => (b + s >= 1 ? 1 : 0),
};
/** One channel of a separable mode, backdrop b and source s in 0..1. Colour modes return s. */
export function blendChannel(mode: BlendMode, b: number, s: number): number {
  const f = SEPARABLE[mode];
  return f ? f(b, s) : s;
}

const lum = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b;
function clipColor(c: Float64Array): void {
  const l = lum(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  if (n < 0 && l - n > 0) { const k = l / (l - n); for (let i = 0; i < 3; i++) c[i] = l + (c[i] - l) * k; }
  if (x > 1 && x - l > 0) { const k = (1 - l) / (x - l); for (let i = 0; i < 3; i++) c[i] = l + (c[i] - l) * k; }
}
function setLum(c: Float64Array, l: number): void {
  const d = l - lum(c[0], c[1], c[2]);
  c[0] += d; c[1] += d; c[2] += d;
  clipColor(c);
}
const sat = (r: number, g: number, b: number): number => Math.max(r, g, b) - Math.min(r, g, b);
function setSat(c: Float64Array, s: number): void {
  let hi = 0, lo = 0;
  for (let i = 1; i < 3; i++) { if (c[i] > c[hi]) hi = i; if (c[i] < c[lo]) lo = i; }
  if (hi === lo || c[hi] === c[lo]) { c[0] = c[1] = c[2] = 0; return; }
  const mid = 3 - hi - lo;
  c[mid] = ((c[mid] - c[lo]) * s) / (c[hi] - c[lo]);
  c[hi] = s; c[lo] = 0;
}
export function nonSeparable(mode: BlendMode, br: number, bg: number, bb: number, sr: number, sg: number, sb: number, o: Float64Array): void {
  const src = (): void => { o[0] = sr; o[1] = sg; o[2] = sb; };
  const back = (): void => { o[0] = br; o[1] = bg; o[2] = bb; };
  switch (mode) {
    case 'hue': src(); setSat(o, sat(br, bg, bb)); setLum(o, lum(br, bg, bb)); return;
    case 'saturation': back(); setSat(o, sat(sr, sg, sb)); setLum(o, lum(br, bg, bb)); return;
    case 'color': src(); setLum(o, lum(br, bg, bb)); return;
    case 'luminosity': back(); setLum(o, lum(sr, sg, sb)); return;
    case 'darker-color': if (lum(sr, sg, sb) < lum(br, bg, bb)) src(); else back(); return;
    case 'lighter-color': if (lum(sr, sg, sb) > lum(br, bg, bb)) src(); else back(); return;
    default: src();
  }
}
export function hash01(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The parts of a layer the compositor reads. The mask is optional, so callers that pass plain objects keep working. */
export interface BlendLayer {
  visible: boolean; opacity: number; blendMode: BlendMode;
  x: number; y: number; width: number; height: number; data: Uint8ClampedArray;
  mask?: LayerMask;
  /** The tree fields (document.ts): plain objects without them are plain pixel layers at the top level. */
  id?: string; kind?: 'pixel' | 'folder' | 'adjust' | 'fill'; parentId?: string; clip?: boolean; passThrough?: boolean;
}
