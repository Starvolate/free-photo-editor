// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** One entry point for heavy pixel work, shared by the Web Worker and the main-thread fallback. */
import { adjust, type AdjustKind, type AdjustParams } from './adjustments';
import type { Bitmap } from './document';
import { gaussianBlur, sharpen } from './filters';
import { BANDED, fxReach } from './fx/meta';
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
/** One band of a job split by rows: result rows [y0, y1) come from source rows [sy, sy + sh), run with `spec`. */
export interface JobBand { spec: JobSpec; y0: number; y1: number; sy: number; sh: number; }
/** Splits an effect on a bitmap `height` rows tall into bands of `rows` rows of its edited box, each reading `jobPadding` rows around it. */
export function splitJob(s: JobSpec, height: number, rows: number): JobBand[] {
  const p = s.params ?? {}, pad = jobPadding(s), step = Math.max(1, Math.round(rows));
  const iy = Math.min(Math.max(0, Math.round(p.iy ?? 0)), height - 1), ih = Math.min(Math.max(1, Math.round(p.ih ?? height - iy)), height - iy);
  const out: JobBand[] = [];
  for (let y0 = iy; y0 < iy + ih; y0 += step) {
    const y1 = Math.min(iy + ih, y0 + step), sy = Math.max(0, y0 - pad), sh = Math.min(height, y1 + pad) - sy;
    out.push({ spec: { op: s.op, kind: s.kind, params: { ...p, iy: y0 - sy, ih: y1 - y0 } }, y0, y1, sy, sh });
  }
  return out;
}
/**
 * Apply's bands for a progress bar: about 16 bands of the edited box, for effects whose pixels depend only on their
 * neighbours (BANDED); null for every other job, which runs in one go behind a moving bar.
 */
export function jobBands(s: JobSpec, height: number): JobBand[] | null {
  if (s.op !== 'fx' || !BANDED.has(s.kind ?? '')) return null;
  const ih = Math.round(s.params?.ih ?? height), rows = Math.max(16, 4 * jobPadding(s), Math.ceil(ih / 16));
  return rows < ih ? splitJob(s, height, rows) : null;
}
export function runJob(s: JobSpec, src: Bitmap): Uint8ClampedArray {
  if (s.op === 'fx') throw new Error('Effects run through runEffect from @free-photoeditor/core/fx.');
  if (s.op === 'gaussian-blur') return gaussianBlur(src, s.params?.radius ?? 4);
  if (s.op === 'sharpen') return sharpen(src, s.params?.amount ?? 1, s.params?.radius ?? 1, s.params?.threshold ?? 0);
  if (isTone(s.kind)) return tone(src, s.kind, s.params);
  return adjust(src.data, (s.kind ?? 'invert') as AdjustKind, (s.params ?? {}) as AdjustParams);
}
