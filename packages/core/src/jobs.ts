// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** One entry point for heavy pixel work, shared by the Web Worker and the main-thread fallback. */
import { adjust, type AdjustKind, type AdjustParams } from './adjustments';
import { gaussianBlur, sharpen } from './filters';
import type { Bitmap } from './document';

export type JobOp = 'adjust' | 'gaussian-blur' | 'sharpen';
export interface JobParams extends AdjustParams { radius?: number; amount?: number; }
export interface JobSpec { op: JobOp; kind?: AdjustKind; params?: JobParams; }
export const FILTER_LABELS: Record<'gaussian-blur' | 'sharpen', string> = { 'gaussian-blur': 'Gaussian blur', sharpen: 'Sharpen' };
/** How many neighbouring pixels a job needs to read around the edited area. */
export const jobPadding = (s: JobSpec): number => (s.op === 'adjust' ? 0 : Math.ceil((s.params?.radius ?? 1) * 3) + 2);
export function runJob(s: JobSpec, src: Bitmap): Uint8ClampedArray {
  if (s.op === 'gaussian-blur') return gaussianBlur(src, s.params?.radius ?? 4);
  if (s.op === 'sharpen') return sharpen(src, s.params?.amount ?? 1, s.params?.radius ?? 1);
  return adjust(src.data, s.kind ?? 'invert', s.params);
}
