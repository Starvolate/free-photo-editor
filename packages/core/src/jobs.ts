// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** One entry point for heavy pixel work, shared by the Web Worker and the main-thread fallback. */
import { adjust, type AdjustKind, type AdjustParams } from './adjustments';
import type { Bitmap } from './document';
import { gaussianBlur, sharpen } from './filters';
import { fxReach } from './fx/meta';
import { TONE_KINDS, tone, type ToneKind } from './tone';

/** 'fx' is every filter family; it runs through runEffect in '@free-photoeditor/core/fx', loaded on first use. */
export type JobOp = 'adjust' | 'gaussian-blur' | 'sharpen' | 'fx';
/** Numbers only, so a job crosses to the worker as plain data. */
export type JobParams = Record<string, number | undefined>;
export interface JobSpec { op: JobOp; kind?: string; params?: JobParams; }
export const FILTER_LABELS: Record<'gaussian-blur' | 'sharpen', string> = { 'gaussian-blur': 'Gaussian blur', sharpen: 'Sharpen' };
const isTone = (k: string | undefined): k is ToneKind => !!k && (TONE_KINDS as readonly string[]).includes(k);
/** How many neighbouring pixels a job needs to read around the edited area. */
export function jobPadding(s: JobSpec): number {
  if (s.op === 'fx') return fxReach(s.kind, s.params);
  if (s.op === 'adjust') return s.kind === 'shadows-highlights' ? Math.ceil((s.params?.radius ?? 30) * 3) + 2 : 0;
  return Math.ceil((s.params?.radius ?? 1) * 3) + 2;
}
export function runJob(s: JobSpec, src: Bitmap): Uint8ClampedArray {
  if (s.op === 'fx') throw new Error('Effects run through runEffect from @free-photoeditor/core/fx.');
  if (s.op === 'gaussian-blur') return gaussianBlur(src, s.params?.radius ?? 4);
  if (s.op === 'sharpen') return sharpen(src, s.params?.amount ?? 1, s.params?.radius ?? 1, s.params?.threshold ?? 0);
  if (isTone(s.kind)) return tone(src, s.kind, s.params);
  return adjust(src.data, (s.kind ?? 'invert') as AdjustKind, (s.params ?? {}) as AdjustParams);
}
