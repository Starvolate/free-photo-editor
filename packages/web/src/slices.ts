// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Cut into web pieces (the slice tool): the boxes a person drags over a picture, kept with that open picture until they
 * are cleared, and the pieces cut from the picture as it looks, each saved as a PNG in one ZIP. Rides in the tool kit's
 * chunk; the PNG and ZIP writers load only when the pieces are first saved.
 */
import { flatten, type Bitmap, type Doc, type Rect } from '@free-photoeditor/core';
import type { Zippable } from '@free-photoeditor/formats/zip';

interface At { x: number; y: number; }
const boxes = new WeakMap<Doc, Rect[]>();
/** The pieces of this open picture, in the order they were drawn. */
export const slicesOf = (d: Doc): Rect[] => boxes.get(d) ?? [];
export function addSlice(d: Doc, r: Rect): void { boxes.set(d, [...slicesOf(d), r]); }
export function dropLastSlice(d: Doc): void { const b = slicesOf(d).slice(0, -1); if (b.length) boxes.set(d, b); else boxes.delete(d); }
/** Remove every piece of this picture, and say how many there were (also for View › Remove slices). */
export function clearSlices(d: Doc): number { const n = slicesOf(d).length; boxes.delete(d); return n; }

/** The box between two picture points, on whole pixels and inside the picture; null when smaller than 2 × 2 px. */
export function sliceBox(a: At, b: At, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.round(Math.min(a.x, b.x))), y0 = Math.max(0, Math.round(Math.min(a.y, b.y)));
  const x1 = Math.min(w, Math.round(Math.max(a.x, b.x))), y1 = Math.min(h, Math.round(Math.max(a.y, b.y)));
  return x1 - x0 >= 2 && y1 - y0 >= 2 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
/** One piece: the pixels of box `r` copied out of the whole picture. */
export function cutPiece(pic: Bitmap, r: Rect): Bitmap {
  const data = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) data.set(pic.data.subarray(((r.y + y) * pic.width + r.x) * 4, ((r.y + y) * pic.width + r.x + r.w) * 4), y * r.w * 4);
  return { width: r.w, height: r.h, data };
}
/** The file name of piece k (counting from 1) of n: "piece 01.png". */
export const pieceName = (k: number, n: number): string => `piece ${String(k).padStart(Math.max(2, String(n).length), '0')}.png`;
/**
 * Every piece as a PNG in one ZIP (stored, not squeezed again: PNG already is). The picture is drawn once, as it looks;
 * a box left partly outside after a crop is cut to the picture, and one left wholly outside is skipped.
 */
export async function slicesZip(d: Doc): Promise<{ bytes: Uint8Array; count: number }> {
  const pic = flatten(d), list = slicesOf(d).map((r) => sliceBox(r, { x: r.x + r.w, y: r.y + r.h }, pic.width, pic.height)).filter((r): r is Rect => !!r);
  if (!list.length) return { bytes: new Uint8Array(0), count: 0 };
  const [{ encodePng }, { zipSync }] = await Promise.all([import('@free-photoeditor/formats/png'), import('@free-photoeditor/formats/zip')]);
  const files: Zippable = {};
  list.forEach((r, k) => { files[pieceName(k + 1, list.length)] = [encodePng(cutPiece(pic, r)), { level: 0 }]; });
  return { bytes: zipSync(files), count: list.length };
}
