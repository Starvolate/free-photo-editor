// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Print resolution: how many of the picture's pixels go into one inch of paper, called DPI (dots per inch) or PPI
 * (pixels per inch). It is one setting of the picture, 72 when a file does not say. It is read from every file that
 * stores it (PNG pHYs, JPEG JFIF and EXIF, WebP EXIF, TIFF; PSD in psd.ts) and written into every format with room for
 * it (metadata.ts, psd.ts and the format add-ons). DPI alone never adds detail: it only says how big the pixels print.
 * Only resampling (a new pixel size) changes the pixels.
 */
import type { Doc } from './document';
import type { Command } from './history';
import { isPng, jpegSegments, tiffResolution, webpChunks } from './metadata';
import { latin1Decode } from './text';

export const DEFAULT_DPI = 72;
export const MIN_DPI = 1;
export const MAX_DPI = 10000;
/** The quick picks, each with what it is for, in plain words. */
export const DPI_PICKS: readonly { dpi: number; use: string }[] = [
  { dpi: 72, use: 'screens' }, { dpi: 150, use: 'quick prints' }, { dpi: 300, use: 'print' }, { dpi: 500, use: 'fine print' }, { dpi: 600, use: 'fine print' },
];
/** Tenths are as fine as any format keeps a DPI (PNG and BMP store whole pixels per metre). */
export const roundDpi = (x: number): number => Math.round(x * 10) / 10;
export const isDpi = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= MIN_DPI && x <= MAX_DPI;
/** The picture's print resolution: its own setting, or 72. */
export const docDpi = (d: { dpi?: number }): number => (isDpi(d.dpi) ? d.dpi : DEFAULT_DPI);
export function checkDpi(x: number): number {
  if (!isDpi(x)) throw new Error(`The DPI must be a number from ${MIN_DPI} to ${MAX_DPI}, for example 300.`);
  return roundDpi(x);
}
const found = (x: number): number | null => { const r = roundDpi(x); return isDpi(r) ? r : null; };

export type PrintUnit = 'in' | 'cm' | 'mm';
export const PRINT_UNITS: readonly PrintUnit[] = ['cm', 'in', 'mm'];
const PER_INCH: Record<PrintUnit, number> = { in: 1, cm: 2.54, mm: 25.4 };
export const toInches = (v: number, unit: PrintUnit): number => v / PER_INCH[unit];
export const fromInches = (inches: number, unit: PrintUnit): number => inches * PER_INCH[unit];
const r2 = (x: number): number => Math.round(x * 100) / 100;
export interface PrintSize { in: [number, number]; cm: [number, number]; mm: [number, number]; }
/** How big the picture prints at this DPI, to hundredths (tenths of a millimetre). */
export function printSize(width: number, height: number, dpi: number): PrintSize {
  const w = width / dpi, h = height / dpi;
  return { in: [r2(w), r2(h)], cm: [r2(w * 2.54), r2(h * 2.54)], mm: [Math.round(w * 254) / 10, Math.round(h * 254) / 10] };
}
/** The pixels one side needs to print `size` long at this DPI (at least 1). */
export const printPixels = (size: number, unit: PrintUnit, dpi: number): number => Math.max(1, Math.round(toInches(size, unit) * dpi));
/** The DPI at which `pixels` print `size` long: with resampling off the pixels stay and the DPI changes. */
export const dpiForPrint = (pixels: number, size: number, unit: PrintUnit): number => roundDpi(pixels / toInches(size, unit));
export interface PrintRequest { width?: number; height?: number; unit: PrintUnit; }
const UNIT_WORDS: Record<string, PrintUnit> = { cm: 'cm', mm: 'mm', in: 'in', inch: 'in', inches: 'in', '"': 'in' };
/** "10x15cm", "4 x 6 in", "210×297mm"; one side keeps the picture's shape ("10cm" is the width, "x15cm" the height). */
export function parsePrintSize(s: string): PrintRequest {
  const m = /^\s*(\d+(?:\.\d+)?)?\s*(?:[x×*]\s*(\d+(?:\.\d+)?)?)?\s*(cm|mm|inches|inch|in|")\s*$/i.exec(s);
  const width = m?.[1] ? Number(m[1]) : 0, height = m?.[2] ? Number(m[2]) : 0;
  if (!m || !(width > 0 || height > 0)) throw new Error(`"${s}" is not a print size. Write the width x the height and a unit, for example 10x15cm, 4x6in or 210x297mm.`);
  return { width: width || undefined, height: height || undefined, unit: UNIT_WORDS[(m[3] ?? 'in').toLowerCase()] ?? 'in' };
}
/** The pixel size a print size needs at this DPI. A side left out follows the picture's shape. */
export function printTarget(r: PrintRequest, dpi: number, cur: { width: number; height: number }): { width: number; height: number } {
  let width = r.width ? printPixels(r.width, r.unit, dpi) : 0, height = r.height ? printPixels(r.height, r.unit, dpi) : 0;
  if (!width) width = Math.max(1, Math.round((height * cur.width) / cur.height));
  if (!height) height = Math.max(1, Math.round((width * cur.height) / cur.width));
  return { width, height };
}
/** Change only the print resolution (the pixels stay), as one undoable step. Null when it is already that. */
export function setDocDpi(doc: Doc, dpi: number): Command | null {
  const before = doc.dpi, after = checkDpi(dpi);
  if (docDpi(doc) === after) return null;
  const put = (d: Doc, v: number | undefined): void => { if (v === undefined) delete d.dpi; else d.dpi = v; };
  put(doc, after);
  return { label: 'Print resolution', bytes: 16, undo: (d) => put(d, before), redo: (d) => put(d, after) };
}

const be32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
/** A PNG's DPI (pHYs, pixels per metre), or null. Reads only the chunks before the pixels, so a file's first bytes do. */
export function readPngDpi(b: Uint8Array): number | null {
  if (!isPng(b)) return null;
  for (let p = 8; p + 8 <= b.length; ) {
    const len = be32(b, p), type = latin1Decode(b, p + 4, p + 8), d = p + 8;
    if (type === 'IDAT' || type === 'IEND') return null;
    if (type === 'pHYs') return d + 9 <= b.length && b[d + 8] === 1 ? found(be32(b, d) * 0.0254) : null;
    p = d + len + 4;
  }
  return null;
}
/** A JPEG's DPI: EXIF X/YResolution first (it keeps fractions), then the JFIF density. Null when neither says. */
export function readJpegDpi(b: Uint8Array): number | null {
  let jfif: number | null = null;
  for (const s of jpegSegments(b)) {
    const d = s.dataStart;
    if (s.marker === 0xe1 && latin1Decode(b, d, d + 6) === 'Exif\0\0') {
      const r = tiffResolution(b, d + 6, Math.min(s.end, b.length));
      if (r) return r;
    } else if (s.marker === 0xe0 && jfif === null && d + 12 <= b.length && latin1Decode(b, d, d + 5) === 'JFIF\0') {
      const unit = b[d + 7], x = (b[d + 8] << 8) | b[d + 9];
      jfif = unit === 1 ? found(x) : unit === 2 ? found(x * 2.54) : null;
    }
  }
  return jfif;
}
/** A WebP's DPI from its EXIF chunk, or null. */
export function readWebpDpi(b: Uint8Array): number | null {
  for (const c of webpChunks(b)) {
    if (c.fourcc !== 'EXIF') continue;
    const at = latin1Decode(b, c.dataStart, c.dataStart + 6) === 'Exif\0\0' ? c.dataStart + 6 : c.dataStart;
    return tiffResolution(b, at, c.dataStart + c.size);
  }
  return null;
}
/** The DPI stored in a picture file (PNG, JPEG, WebP or TIFF bytes), or null when it has none. PSD is read by psd.ts. */
export function readDpi(b: Uint8Array): number | null {
  try {
    if (isPng(b)) return readPngDpi(b);
    if (b[0] === 0xff && b[1] === 0xd8) return readJpegDpi(b);
    if (latin1Decode(b, 0, 4) === 'RIFF' && latin1Decode(b, 8, 12) === 'WEBP') return readWebpDpi(b);
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42)) return tiffResolution(b, 0);
  } catch { /* unreadable metadata is not an error */ }
  return null;
}
