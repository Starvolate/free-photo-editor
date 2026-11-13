// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * TGA (Truevision Targa), written for Free Photo Editor. Opens colour, grey and palette files, plain or run-length
 * packed, any corner first. Saves 24 or 32 bits run-length packed, top row first, with the credit in the picture's ID
 * field and in the TGA 2.0 extension area's software field.
 */
import { CREDIT, concatBytes, flatten, latin1Encode, type Bitmap, type FormatCodec } from '@free-photoeditor/core';
import { docOf, isOpaque } from './util';

const FOOTER = 'TRUEVISION-XFILE.\0';
export function decodeTga(b: Uint8Array): Bitmap {
  if (b.length < 18) throw new Error('This TGA file is too short.');
  const idLen = b[0], cmType = b[1], type = b[2], cmFirst = b[3] | (b[4] << 8), cmLen = b[5] | (b[6] << 8), cmBits = b[7];
  const w = b[12] | (b[13] << 8), h = b[14] | (b[15] << 8), depth = b[16], desc = b[17];
  if (![1, 2, 3, 9, 10, 11].includes(type) || !w || !h || ![8, 15, 16, 24, 32].includes(depth)) throw new Error("This TGA file is of a kind this editor can't read.");
  let p = 18 + idLen;
  const cmBytes = Math.ceil(cmBits / 8), cmap = cmType === 1 ? b.subarray(p, p + cmLen * cmBytes) : null;
  if (cmType === 1) p += cmLen * cmBytes;
  const px = Math.ceil(depth / 8), n = w * h;
  let src: Uint8Array;
  if (type < 9) src = b.subarray(p, p + n * px);
  else {
    src = new Uint8Array(n * px);
    let o = 0;
    while (o < src.length && p < b.length) {
      const hd = b[p++], cnt = (hd & 0x7f) + 1;
      if (hd & 0x80) { const v = b.subarray(p, p + px); p += px; for (let k = 0; k < cnt && o < src.length; k++, o += px) src.set(v, o); }
      else { const len = Math.min(cnt * px, src.length - o); src.set(b.subarray(p, p + len), o); o += len; p += cnt * px; }
    }
  }
  const alphaBits = desc & 0x0f, top = (desc & 0x20) !== 0, right = (desc & 0x10) !== 0;
  let attr = -1;
  if (b.length > 26 + 18 && String.fromCharCode(...b.subarray(b.length - 18)) === FOOTER) {
    const ext = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(b.length - 26, true);
    if (ext && ext + 495 <= b.length - 26) attr = b[ext + 494];
  }
  const colour = (v: Uint8Array, o: number, bits: number, out: Uint8ClampedArray, at: number): void => {
    if (bits === 8) { out[at] = out[at + 1] = out[at + 2] = v[o]; out[at + 3] = 255; return; }
    if (bits === 15 || bits === 16) {
      const c = v[o] | (v[o + 1] << 8);
      out[at] = (((c >> 10) & 31) * 255) / 31; out[at + 1] = (((c >> 5) & 31) * 255) / 31; out[at + 2] = ((c & 31) * 255) / 31;
      out[at + 3] = bits === 16 && alphaBits ? (c & 0x8000 ? 255 : 0) : 255;
      return;
    }
    out[at] = v[o + 2]; out[at + 1] = v[o + 1]; out[at + 2] = v[o]; out[at + 3] = bits === 32 ? v[o + 3] : 255;
  };
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const sx = i % w, sy = (i / w) | 0, x = right ? w - 1 - sx : sx, y = top ? sy : h - 1 - sy, at = (y * w + x) * 4;
    if (type === 1 || type === 9) {
      const idx = (px === 2 ? src[i * 2] | (src[i * 2 + 1] << 8) : src[i]) - cmFirst;
      if (cmap && idx >= 0 && idx < cmLen) colour(cmap, idx * cmBytes, cmBits === 32 ? 32 : cmBits, out, at);
    } else colour(src, i * px, depth, out, at);
  }
  let anyAlpha = false;
  for (let i = 3; i < out.length && !anyAlpha; i += 4) if (out[i]) anyAlpha = true;
  if (attr === 0 || attr === 1 || attr === 2 || !anyAlpha || (depth === 32 && !alphaBits && attr !== 3 && attr !== 4)) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { width: w, height: h, data: out };
}
function packRow(row: Uint8Array, w: number, px: number, out: number[]): void {
  const same = (a: number, c: number): boolean => { for (let k = 0; k < px; k++) if (row[a * px + k] !== row[c * px + k]) return false; return true; };
  for (let i = 0; i < w; ) {
    let run = 1;
    while (i + run < w && run < 128 && same(i, i + run)) run++;
    if (run > 1) { out.push(0x80 | (run - 1)); for (let k = 0; k < px; k++) out.push(row[i * px + k]); i += run; continue; }
    let m = 1;
    while (i + m < w && m < 128 && !(i + m + 1 < w && same(i + m, i + m + 1))) m++;
    out.push(m - 1);
    for (let k = 0; k < m * px; k++) out.push(row[i * px + k]);
    i += m;
  }
}
export function encodeTga(bmp: Bitmap, credit: string = CREDIT): Uint8Array {
  const { width: w, height: h, data } = bmp, alpha = !isOpaque(data), px = alpha ? 4 : 3, id = latin1Encode(credit.slice(0, 255));
  const head = new Uint8Array(18);
  head[0] = id.length; head[2] = 10; head[12] = w & 255; head[13] = w >> 8; head[14] = h & 255; head[15] = h >> 8;
  head[16] = px * 8; head[17] = (alpha ? 8 : 0) | 0x20;
  const body: number[] = [], row = new Uint8Array(w * px);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, o = x * px; row[o] = data[s + 2]; row[o + 1] = data[s + 1]; row[o + 2] = data[s]; if (alpha) row[o + 3] = data[s + 3]; }
    packRow(row, w, px, body);
  }
  const ext = new Uint8Array(495), dv = new DataView(ext.buffer);
  dv.setUint16(0, 495, true);
  ext.set(latin1Encode(credit.split(',')[0].slice(0, 40)), 426);
  dv.setUint16(467, 10, true); ext[469] = 0x20;
  ext[494] = alpha ? 3 : 0;
  const main = concatBytes(head, id, new Uint8Array(body));
  const foot = new Uint8Array(26);
  new DataView(foot.buffer).setUint32(0, main.length, true);
  foot.set(latin1Encode(FOOTER), 8);
  return concatBytes(main, ext, foot);
}
/** The software name a TGA 2.0 file carries, if any. */
export function tgaSoftware(b: Uint8Array): string | null {
  if (b.length < 26 || String.fromCharCode(...b.subarray(b.length - 18)) !== FOOTER) return null;
  const ext = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(b.length - 26, true);
  if (!ext || ext + 467 > b.length) return null;
  return String.fromCharCode(...b.subarray(ext + 426, ext + 467)).replace(/\0[\s\S]*$/, '');
}
export const codec: FormatCodec = {
  decode: async (bytes) => { const bmp = decodeTga(bytes); return { doc: docOf(bmp.width, bmp.height, [{ name: 'Background', bmp }]), notes: [] }; },
  encode: async (doc) => encodeTga(flatten(doc)),
};
