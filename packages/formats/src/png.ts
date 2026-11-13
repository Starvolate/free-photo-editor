// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * PNG written and read in plain TypeScript (no canvas), so layered and animated formats work in any JavaScript host.
 * Reads every PNG kind: grey, colour, palette, with or without see-through, 1 to 16 bits, interlaced or not.
 */
import { unzlibSync, zlibSync } from 'fflate';
import { CREDIT, concatBytes, latin1Decode, latin1Encode, makePngChunk, pngChunks, type Bitmap } from '@free-photoeditor/core';

export const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
export const be32 = (v: number): Uint8Array => new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
export interface PngHead { width: number; height: number; depth: number; ctype: number; interlace: number; plte: Uint8Array | null; trns: Uint8Array | null; }
export function ihdr(width: number, height: number, depth: number, ctype: number): Uint8Array {
  const d = new Uint8Array(13);
  d.set(be32(width), 0); d.set(be32(height), 4); d[8] = depth; d[9] = ctype;
  return d;
}
/** Rows filtered (the filter with the smallest sum, row by row) and compressed: the image data of a PNG. */
export function pngPayload(bmp: Bitmap, rgb: boolean, level = 6): Uint8Array {
  const { width: w, height: h, data } = bmp, bpp = rgb ? 3 : 4, stride = w * bpp;
  const raw = new Uint8Array((stride + 1) * h), cand = new Uint8Array(stride);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0, s = y * w * 4, o = 0; x < w; x++, s += 4) {
      cur[o++] = data[s]; cur[o++] = data[s + 1]; cur[o++] = data[s + 2];
      if (!rgb) cur[o++] = data[s + 3];
    }
    const out = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    let best = 0, bestSum = Infinity;
    for (let ft = 0; ft < 5; ft++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0, x = cur[i];
        let v: number;
        if (ft === 0) v = x;
        else if (ft === 1) v = x - a;
        else if (ft === 2) v = x - b;
        else if (ft === 3) v = x - ((a + b) >> 1);
        else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        v &= 255;
        cand[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = ft; out.set(cand); }
    }
    raw[y * (stride + 1)] = best;
    const t = prev; prev = cur; cur = t;
  }
  return zlibSync(raw, { level: level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 });
}
export const creditChunk = (credit: string): Uint8Array =>
  makePngChunk('tEXt', concatBytes(latin1Encode('Software'), new Uint8Array(1), latin1Encode(credit)));
/** A PNG of the picture, with the credit in a Software text chunk. */
export function encodePng(bmp: Bitmap, credit: string = CREDIT, level = 6): Uint8Array {
  let rgb = true;
  for (let i = 3; i < bmp.data.length; i += 4) if (bmp.data[i] !== 255) { rgb = false; break; }
  return concatBytes(PNG_SIG, makePngChunk('IHDR', ihdr(bmp.width, bmp.height, 8, rgb ? 2 : 6)), creditChunk(credit),
    makePngChunk('IDAT', pngPayload(bmp, rgb, level)), makePngChunk('IEND', new Uint8Array(0)));
}
export function readPngHead(b: Uint8Array): PngHead & { idat: Uint8Array } {
  let head: PngHead | null = null, plte: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (const c of pngChunks(b)) {
    const d = b.subarray(c.dataStart, c.dataStart + c.length);
    if (c.type === 'IHDR') {
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      head = { width: dv.getUint32(0), height: dv.getUint32(4), depth: d[8], ctype: d[9], interlace: d[12], plte: null, trns: null };
    } else if (c.type === 'PLTE') plte = d;
    else if (c.type === 'tRNS') trns = d;
    else if (c.type === 'IDAT') idat.push(d);
  }
  if (!head) throw new Error('This PNG has no header.');
  return { ...head, plte, trns, idat: concatBytes(...idat) };
}
function unfilter(ft: number, cur: Uint8Array, prev: Uint8Array, bpp: number): void {
  const n = cur.length;
  switch (ft) {
    case 0: return;
    case 1: for (let i = bpp; i < n; i++) cur[i] += cur[i - bpp]; return;
    case 2: for (let i = 0; i < n; i++) cur[i] += prev[i]; return;
    case 3: for (let i = 0; i < n; i++) cur[i] += ((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1; return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[i] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      return;
    default: throw new Error('This PNG is damaged (a row has an unknown filter).');
  }
}
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
/** Decode compressed PNG image data into RGBA, given its header. */
export function decodePngData(hd: PngHead, z: Uint8Array): Bitmap {
  const raw = unzlibSync(z), { width: w, height: h, depth, ctype, plte, trns } = hd;
  const ch = ctype === 2 ? 3 : ctype === 4 ? 2 : ctype === 6 ? 4 : 1, bits = ch * depth, bpp = Math.max(1, bits >> 3), max = (1 << depth) - 1;
  const out = new Uint8ClampedArray(w * h * 4);
  const tr = trns ? new DataView(trns.buffer, trns.byteOffset, trns.byteLength) : null;
  const tGray = tr && ctype === 0 && trns && trns.length >= 2 ? tr.getUint16(0) : -1;
  const tRgb = tr && ctype === 2 && trns && trns.length >= 6 ? [tr.getUint16(0), tr.getUint16(2), tr.getUint16(4)] : null;
  const to8 = (v: number): number => (depth === 16 ? Math.round(v / 257) : depth === 8 ? v : Math.round((v * 255) / max));
  let pos = 0;
  for (const [x0, y0, dx, dy] of hd.interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const rowBytes = Math.ceil((pw * bits) / 8);
    let prev = new Uint8Array(rowBytes), cur = new Uint8Array(rowBytes);
    for (let r = 0; r < ph; r++) {
      const ft = raw[pos++];
      cur.fill(0); cur.set(raw.subarray(pos, pos + rowBytes)); pos += rowBytes;
      unfilter(ft, cur, prev, bpp);
      const s = (i: number): number => {
        if (depth === 8) return cur[i];
        if (depth === 16) return (cur[i * 2] << 8) | cur[i * 2 + 1];
        const bit = i * depth;
        return (cur[bit >> 3] >> (8 - depth - (bit & 7))) & max;
      };
      const y = y0 + r * dy;
      for (let i = 0; i < pw; i++) {
        const o = (y * w + x0 + i * dx) * 4;
        if (ctype === 3) {
          const k = s(i);
          if (plte && k * 3 + 2 < plte.length) { out[o] = plte[k * 3]; out[o + 1] = plte[k * 3 + 1]; out[o + 2] = plte[k * 3 + 2]; }
          out[o + 3] = trns && k < trns.length ? trns[k] : 255;
        } else if (ctype === 0 || ctype === 4) {
          const g = s(i * ch), v = to8(g);
          out[o] = out[o + 1] = out[o + 2] = v;
          out[o + 3] = ctype === 4 ? to8(s(i * ch + 1)) : g === tGray ? 0 : 255;
        } else {
          const r0 = s(i * ch), g0 = s(i * ch + 1), b0 = s(i * ch + 2);
          out[o] = to8(r0); out[o + 1] = to8(g0); out[o + 2] = to8(b0);
          out[o + 3] = ctype === 6 ? to8(s(i * ch + 3)) : tRgb && r0 === tRgb[0] && g0 === tRgb[1] && b0 === tRgb[2] ? 0 : 255;
        }
      }
      const t = prev; prev = cur; cur = t;
    }
  }
  return { width: w, height: h, data: out };
}
export function decodePng(b: Uint8Array): Bitmap {
  const hd = readPngHead(b);
  if (!hd.width || !hd.height) throw new Error('This PNG has no size.');
  return decodePngData(hd, hd.idat);
}
export const pngText = (b: Uint8Array, key: string): string | null => {
  for (const c of pngChunks(b)) {
    if (c.type !== 'tEXt') continue;
    const z = b.indexOf(0, c.dataStart);
    if (z > 0 && latin1Decode(b, c.dataStart, z) === key) return latin1Decode(b, z + 1, c.dataStart + c.length);
  }
  return null;
};
