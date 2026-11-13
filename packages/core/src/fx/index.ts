// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Every filter family in one module that loads on first use: the editor's Web Worker imports it the first time a
 * filter runs, so the first screen never downloads it. `runEffect` takes the job's kind and numeric settings. The
 * settings `ix`, `iy`, `iw`, `ih` name the edited box inside the working bitmap (the rest is neighbouring pixels it
 * may read), and `fg`, `bg` carry the main and second colours as 0xRRGGBB. All maths here is written for this project.
 */
import type { Bitmap } from '../document';
import { BLURS } from './blurs';
import { LIGHT } from './light';
import { innerBox, type Fx, type P } from './lib';
import { LOOKS } from './looks';
import { MORE } from './more';
import { WARPS } from '../warp';
import { MORE2 } from './more2';
import { RAW } from './raw';
import type { FxKind } from './meta';

export { FX_KINDS, fxReach, type FxKind } from './meta';
export { contrastRatio, HUES, LEVELS, pressChroma, textColour, toLab, wcagLum } from './light';
export type { Box } from './lib';

const FX: Record<FxKind, Fx> = { ...BLURS, ...LOOKS, ...MORE, ...MORE2, ...LIGHT,
  ...WARPS };

/** Runs one effect on a bitmap and returns new pixels of the same size. Pixels outside the edited box are kept. */
export function runEffect(spec: { kind?: string; params?: P }, src: Bitmap): Uint8ClampedArray {
  const f = FX[spec.kind as FxKind] ?? RAW[spec.kind ?? ''];
  if (!f) throw new Error(`Unknown effect: ${spec.kind ?? '(none)'}.`);
  if (!src.width || !src.height) return src.data.slice();
  const p = spec.params ?? {};
  return f(src, p, innerBox(src, p));
}
