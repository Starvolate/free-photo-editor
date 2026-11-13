// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * BMP save, written for Free Photo Editor: 24 bits for solid pictures, 32 bits with see-through (a version 4 header
 * that names the alpha channel), with the print resolution (DPI) as pixels per metre. BMP has no place for text, so it cannot carry the credit; browsers open BMP themselves.
 */
import { flatten, type Bitmap, type FormatCodec } from '@free-photoeditor/core';
import { isOpaque } from './util';

export function encodeBmp(bmp: Bitmap, dpi = 72): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const { width: w, height: h, data } = bmp, alpha = !isOpaque(data), head = alpha ? 108 : 40, px = alpha ? 4 : 3;
  const row = Math.ceil((w * px) / 4) * 4, off = 14 + head, out = new Uint8Array(off + row * h), dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d; dv.setUint32(2, out.length, true); dv.setUint32(10, off, true);
  dv.setUint32(14, head, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, px * 8, true);
  dv.setUint32(30, alpha ? 3 : 0, true); dv.setUint32(34, row * h, true); dv.setInt32(38, ppm, true); dv.setInt32(42, ppm, true);
  if (alpha) {
    dv.setUint32(54, 0x00ff0000, true); dv.setUint32(58, 0x0000ff00, true); dv.setUint32(62, 0x000000ff, true); dv.setUint32(66, 0xff000000, true);
    dv.setUint32(70, 0x73524742, true);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, o = off + (h - 1 - y) * row + x * px;
    out[o] = data[s + 2]; out[o + 1] = data[s + 1]; out[o + 2] = data[s];
    if (alpha) out[o + 3] = data[s + 3];
  }
  return out;
}
export const codec: FormatCodec = { encode: async (doc, o) => encodeBmp(flatten(doc), o.dpi) };
