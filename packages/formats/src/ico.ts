// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * ICO save, written for Free Photo Editor: the picture fitted into squares of 16 to 256 pixels (only sizes up to the
 * picture's own), each stored as a PNG carrying the credit. Browsers open ICO themselves.
 */
import { CREDIT, concatBytes, flatten, resizeBitmap, type Bitmap, type FormatCodec } from '@free-photoeditor/core';
import { encodePng } from './png';

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
export function squareFit(b: Bitmap, s: number): Bitmap {
  const k = s / Math.max(b.width, b.height), w = Math.max(1, Math.round(b.width * k)), h = Math.max(1, Math.round(b.height * k));
  const small = w === b.width && h === b.height ? b.data : resizeBitmap(b, w, h, 'smooth');
  const out = new Uint8ClampedArray(s * s * 4), ox = (s - w) >> 1, oy = (s - h) >> 1;
  for (let y = 0; y < h; y++) out.set(small.subarray(y * w * 4, (y + 1) * w * 4), ((y + oy) * s + ox) * 4);
  return { width: s, height: s, data: out };
}
export function encodeIco(bmp: Bitmap, credit: string = CREDIT): Uint8Array {
  const side = Math.max(bmp.width, bmp.height), sizes = ICO_SIZES.filter((s) => s <= Math.max(16, side));
  const pngs = sizes.map((s) => encodePng(squareFit(bmp, s), credit, 9));
  const dir = new Uint8Array(6 + sizes.length * 16), dv = new DataView(dir.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, sizes.length, true);
  let off = dir.length;
  sizes.forEach((s, i) => {
    const o = 6 + i * 16;
    dir[o] = s >= 256 ? 0 : s; dir[o + 1] = s >= 256 ? 0 : s;
    dv.setUint16(o + 4, 1, true); dv.setUint16(o + 6, 32, true); dv.setUint32(o + 8, pngs[i].length, true); dv.setUint32(o + 12, off, true);
    off += pngs[i].length;
  });
  return concatBytes(dir, ...pngs);
}
export const codec: FormatCodec = { encode: async (doc) => encodeIco(flatten(doc)) };
