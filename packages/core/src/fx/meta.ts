// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The filter families' names. They load with the effects (./index), on first use; how far each one reads around the
 * edited area is in reach.ts, which the first screen loads to size a filter's working area.
 */
export const FX_KINDS = [
  'box-blur', 'motion-blur', 'radial-blur', 'surface-blur', 'smart-blur', 'average', 'lens-blur', 'field-blur', 'iris-blur', 'tilt-blur',
  'smart-sharpen', 'sharpen-edges', 'add-noise', 'reduce-noise', 'median', 'dust', 'despeckle',
  'pinch', 'twirl', 'ripple', 'wave', 'polar', 'spherize', 'zigzag', 'displace', 'shear',
  'emboss', 'find-edges', 'solarize', 'oil-paint', 'wind', 'diffuse', 'tiles', 'extrude', 'trace-contour', 'glowing-edges',
  'mosaic', 'crystallize', 'pointillize', 'halftone', 'mezzotint', 'facet', 'fragment',
  'clouds', 'diff-clouds', 'fibers', 'high-pass', 'maximum', 'minimum', 'offset', 'custom',
  'spin-blur', 'lens-fix', 'glass', 'ocean-ripple', 'lens-flare', 'lighting', 'color-to-alpha', 'dither', 'replace-color', 'reduce-colors', 'indexed',
  'kaleidoscope', 'alien-map', 'bloom', 'edge-detect', 'deinterlace', 'destripe', 'video-degrade', 'lowlight', 'bump-map', 'star-burst', 'edge-keep-blur', 'antialias',
  'outline', 'newsprint', 'dents', 'cartoon', 'sketch', 'linocut', 'patterns', 'stroke-blur', 'wrap-blur',
  'tiling', 'page-curl', 'illusion', 'fractal', 'superpixels', 'noise-pattern', 'detail-diffuse',
  'hue-chroma', 'rotate-colours', 'text-contrast', 'local-threshold', 'retinex', 'tone-map', 'harmonize', 'palette-edit', 'gamut-warning',
] as const;
export type FxKind = (typeof FX_KINDS)[number];
// How far each effect reads, and the banded ones, live in reach.ts so the first screen does not carry this list.
export { BANDED, fxReach } from './reach';
