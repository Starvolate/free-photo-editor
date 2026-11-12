// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The filter families' names and how far each one reads around the edited area. Tiny on purpose: the editor's first
 * screen loads this to size a filter's working area, while the maths itself (./index) loads on first use.
 */
type P = Record<string, number | undefined>;

export const FX_KINDS = [
  'box-blur', 'motion-blur', 'radial-blur', 'surface-blur', 'smart-blur', 'average', 'lens-blur', 'field-blur', 'iris-blur', 'tilt-blur',
  'smart-sharpen', 'sharpen-edges', 'add-noise', 'reduce-noise', 'median', 'dust', 'despeckle',
  'pinch', 'twirl', 'ripple', 'wave', 'polar', 'spherize', 'zigzag', 'displace', 'shear',
  'emboss', 'find-edges', 'solarize', 'oil-paint', 'wind', 'diffuse', 'tiles', 'extrude', 'trace-contour', 'glowing-edges',
  'mosaic', 'crystallize', 'pointillize', 'halftone', 'mezzotint', 'facet', 'fragment',
  'clouds', 'diff-clouds', 'fibers', 'high-pass', 'maximum', 'minimum', 'offset', 'custom',
] as const;
export type FxKind = (typeof FX_KINDS)[number];

const n = (p: P, k: string, d: number): number => { const v = p[k]; return typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : d; };
const gauss = (sigma: number): number => Math.ceil(sigma * 3) + 2;
const REACH: Partial<Record<FxKind, (p: P) => number>> = {
  'box-blur': (p) => n(p, 'radius', 6) + 1,
  'motion-blur': (p) => n(p, 'distance', 20) / 2 + 2,
  'radial-blur': () => 24,
  'surface-blur': (p) => n(p, 'radius', 5) + 1,
  'smart-blur': (p) => n(p, 'radius', 5) + 2,
  'lens-blur': (p) => n(p, 'radius', 10) + 1,
  'field-blur': (p) => gauss(Math.max(n(p, 'b1', 0), n(p, 'b2', 20))),
  'iris-blur': (p) => gauss(n(p, 'blur', 12)),
  'tilt-blur': (p) => gauss(n(p, 'blur', 12)),
  'smart-sharpen': (p) => gauss(n(p, 'radius', 1.5)) + 1,
  'sharpen-edges': (p) => gauss(n(p, 'radius', 1)) + 1,
  'reduce-noise': (p) => gauss(n(p, 'color', 50) * 0.04) + 3,
  median: (p) => n(p, 'radius', 2), dust: (p) => n(p, 'radius', 2), despeckle: (p) => n(p, 'radius', 1) + 1,
  emboss: (p) => n(p, 'height', 3) + 1, 'find-edges': () => 1, 'oil-paint': (p) => n(p, 'radius', 4) + 1,
  wind: (p) => n(p, 'length', 30), diffuse: (p) => n(p, 'radius', 4), 'trace-contour': () => 1,
  'glowing-edges': (p) => n(p, 'width', 2) + gauss(n(p, 'smooth', 5) * 0.3) + 1,
  facet: (p) => n(p, 'radius', 3), fragment: (p) => n(p, 'distance', 4),
  'high-pass': (p) => gauss(n(p, 'radius', 4)), maximum: (p) => n(p, 'radius', 2), minimum: (p) => n(p, 'radius', 2), custom: () => 2,
};
/** How many pixels around the edited area an effect reads (0 for effects that only move or recolour pixels inside it). */
export function fxReach(kind: string | undefined, p: P = {}): number {
  const f = REACH[kind as FxKind];
  return f ? Math.ceil(f(p)) : 0;
}
