// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The few print helpers the first screen needs (Picture size and the export toast). The Export sheet's DPI section
 * (export-dpi.ts) loads only when Export opens, so the first screen stays inside its budget.
 */
import { printSize, type Command, type PrintUnit } from '@free-photoeditor/core';

/** Types with a place for the DPI in the file. GIF, ICO, TGA, SVG and OpenRaster have none. */
export const HOLDS: ReadonlySet<string> = new Set(['png', 'jpeg', 'webp', 'psd', 'tiff', 'pdf', 'bmp', 'avif', 'jxl']);
/** Whether the saved file stores the DPI. Moving (animated) PNG and WebP files keep none yet. */
export const holdsDpi = (fmt: string, multi = false): boolean => HOLDS.has(fmt) && !(multi && (fmt === 'png' || fmt === 'webp'));
export const n2 = (x: number): string => String(Math.round(x * 100) / 100);
export const UNIT_LABEL: Record<PrintUnit, string> = { cm: 'cm', in: 'inches', mm: 'mm' };
/** "5.08 × 3.39 cm (2 × 1.33 in)": how big these pixels print at this DPI. */
export function printText(width: number, height: number, dpi: number): string {
  const p = printSize(width, height, dpi);
  return `${n2(p.cm[0])} × ${n2(p.cm[1])} cm (${n2(p.in[0])} × ${n2(p.in[1])} in)`;
}
/** Two steps as one undo step (Picture size: new pixels and a new DPI together). */
export function joinCommands(a: Command | null, b: Command | null): Command | null {
  if (!a || !b) return a ?? b;
  return { label: a.label, bytes: a.bytes + b.bytes, undo: (d) => { b.undo(d); a.undo(d); }, redo: (d) => { a.redo(d); b.redo(d); } };
}
