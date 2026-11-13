// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Reading and writing picture files in Node. sharp (Apache-2.0, with libvips under LGPL-3.0) decodes PNG, JPEG, WebP,
 * GIF, AVIF and SVG the way a browser shows them: turned upright by the camera's orientation tag, in sRGB, 8 bits per
 * channel, the first frame only, SVG drawn at least 1024 pixels on its long side. BMP and ICO are read here, PSD by the
 * engine (ag-psd). Every file written gets the credit in its metadata through the engine's own code, exactly as the web
 * app does. sharp never changes a picture: every edit is the engine's.
 */
import sharp from 'sharp';
import { CREDIT, WHITE, documentFromBitmap, flatten, injectMetadata, readJpegSoftware, readPngText, webpInfo, type Bitmap, type Doc,
  type ExportFormat } from '@free-photoeditor/core';
import { readPsdDocument, writePsdDocument } from '@free-photoeditor/core/psd';

export type ReadFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'avif' | 'svg' | 'ico' | 'psd';
export type WriteFormat = ExportFormat;
export const READ_FORMATS: readonly ReadFormat[] = ['png', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico', 'psd'];
export const WRITE_FORMATS: readonly WriteFormat[] = ['png', 'jpeg', 'webp', 'psd'];
export const FORMAT_NAMES: Record<ReadFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', gif: 'GIF', bmp: 'BMP', avif: 'AVIF', svg: 'SVG', ico: 'ICO', psd: 'PSD' };
export const tooBig = (maxPixels: number): Error =>
  new Error(`This picture has more than ${+(maxPixels / 1e6).toFixed(1)} million pixels, the most this run allows.`);

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));
export function detectFormat(b: Uint8Array): ReadFormat | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === '8BPS') return 'psd';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico';
  if (ascii(b, 4, 4) === 'ftyp') {
    const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    if (/avif|avis/.test(ascii(b, 8, Math.max(4, Math.min(size, 64, b.length) - 8)))) return 'avif';
  }
  const head = new TextDecoder().decode(b.subarray(0, 2048)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

function plainSharpError(e: unknown, maxPixels: number): Error {
  const m = e instanceof Error ? e.message : String(e);
  if (/pixel limit/i.test(m)) return tooBig(maxPixels);
  return new Error(`The picture could not be read (${m.replace(/\s+/g, ' ').trim()}).`);
}
async function viaSharp(bytes: Uint8Array, maxPixels: number, density?: number): Promise<Bitmap> {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: maxPixels, autoOrient: true, pages: 1, ...(density ? { density } : {}) })
      .toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || data.length !== info.width * info.height * 4) throw new Error('unexpected pixel layout');
    return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
  } catch (e) { throw plainSharpError(e, maxPixels); }
}

const BAD_BMP = 'This BMP file is damaged or uses a layout the editor cannot read.';
/** A Windows bitmap (DIB) as found in BMP files and inside icons. Icons store twice the height: colours, then a 1-bit mask. */
function decodeDib(b: Uint8Array, at: number, pixelsAt: number | null, icon: boolean, maxPixels: number): Bitmap {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (at + 16 > b.length) throw new Error(BAD_BMP);
  const hs = dv.getUint32(at, true);
  let w: number, hRaw: number, bpp: number, comp = 0, used = 0, palAt: number, palStride = 4;
  if (hs === 12) { w = dv.getUint16(at + 4, true); hRaw = dv.getInt16(at + 6, true); bpp = dv.getUint16(at + 10, true); palAt = at + 12; palStride = 3; }
  else if (hs >= 40 && at + 40 <= b.length) {
    w = dv.getInt32(at + 4, true); hRaw = dv.getInt32(at + 8, true); bpp = dv.getUint16(at + 14, true);
    comp = dv.getUint32(at + 16, true); used = dv.getUint32(at + 32, true); palAt = at + hs;
  } else throw new Error(BAD_BMP);
  const topDown = hRaw < 0, h = icon ? Math.floor(Math.abs(hRaw) / 2) : Math.abs(hRaw);
  if (w <= 0 || h <= 0 || ![1, 4, 8, 16, 24, 32].includes(bpp)) throw new Error(BAD_BMP);
  if (w * h > maxPixels) throw tooBig(maxPixels);
  let masks: number[] | null = null;
  if (comp === 3 || comp === 6) {
    const mAt = hs >= 52 ? at + 40 : at + hs;
    masks = [dv.getUint32(mAt, true), dv.getUint32(mAt + 4, true), dv.getUint32(mAt + 8, true), hs >= 56 || comp === 6 ? dv.getUint32(mAt + 12, true) : 0];
    if (hs < 52) palAt += comp === 6 ? 16 : 12;
  } else if (comp !== 0) throw new Error('This BMP file is compressed in a way the editor cannot read yet. Save it as PNG and try again.');
  else if (bpp === 16) masks = [0x7c00, 0x03e0, 0x001f, 0];
  const colors = bpp <= 8 ? (used || 1 << bpp) : 0;
  const pal: number[][] = [];
  for (let i = 0; i < colors && palAt + i * palStride + 3 <= b.length; i++) { const p = palAt + i * palStride; pal.push([b[p + 2], b[p + 1], b[p]]); }
  const stride = Math.floor((bpp * w + 31) / 32) * 4, dataAt = pixelsAt ?? palAt + colors * palStride;
  if (dataAt + stride * h > b.length) throw new Error(BAD_BMP);
  const shift = (m: number): number => { let s = 0; while (m && !((m >>> s) & 1)) s++; return s; };
  const chan = (v: number, m: number): number => { if (!m) return 0; const s = shift(m), top = m >>> s; return Math.round((((v & m) >>> s) * 255) / top); };
  const out = new Uint8ClampedArray(w * h * 4);
  let anyAlpha = false;
  for (let y = 0; y < h; y++) {
    const row = dataAt + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0, g = 0, bl = 0, a = 255;
      if (bpp <= 8) {
        const bit = x * bpp, idx = (b[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1), c = pal[idx] ?? [0, 0, 0];
        r = c[0]; g = c[1]; bl = c[2];
      } else if (bpp === 24) { bl = b[row + x * 3]; g = b[row + x * 3 + 1]; r = b[row + x * 3 + 2]; }
      else if (masks) {
        const v = bpp === 16 ? dv.getUint16(row + x * 2, true) : dv.getUint32(row + x * 4, true);
        r = chan(v, masks[0]); g = chan(v, masks[1]); bl = chan(v, masks[2]);
        if (masks[3]) { a = chan(v, masks[3]); if (a) anyAlpha = true; }
      } else { bl = b[row + x * 4]; g = b[row + x * 4 + 1]; r = b[row + x * 4 + 2]; a = b[row + x * 4 + 3]; if (a) anyAlpha = true; }
      out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = a;
    }
  }
  const alphaUsed = bpp === 32 && anyAlpha;
  if (bpp === 32 && !anyAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  if (icon && !alphaUsed) {
    const ms = Math.floor((w + 31) / 32) * 4, mAt = dataAt + stride * h;
    if (mAt + ms * h <= b.length) {
      for (let y = 0; y < h; y++) {
        const row = mAt + (topDown ? y : h - 1 - y) * ms;
        for (let x = 0; x < w; x++) if ((b[row + (x >> 3)] >> (7 - (x & 7))) & 1) out[(y * w + x) * 4 + 3] = 0;
      }
    }
  }
  return { width: w, height: h, data: out };
}
async function decodeIco(b: Uint8Array, maxPixels: number): Promise<Bitmap> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), count = dv.getUint16(4, true);
  let best = -1, score = -1;
  for (let i = 0; i < count && 6 + i * 16 + 16 <= b.length; i++) {
    const e = 6 + i * 16, s = (b[e] || 256) * (b[e + 1] || 256) * 64 + dv.getUint16(e + 6, true);
    if (s > score) { score = s; best = e; }
  }
  if (best < 0) throw new Error('This icon file has no pictures in it.');
  const size = dv.getUint32(best + 8, true), off = dv.getUint32(best + 12, true);
  if (off + size > b.length) throw new Error('This icon file is damaged.');
  const img = b.subarray(off, off + size);
  return img[0] === 0x89 && ascii(img, 1, 3) === 'PNG' ? viaSharp(img, maxPixels) : decodeDib(img, 0, null, true, maxPixels);
}

export interface Decoded { doc: Doc; format: ReadFormat; notes: string[]; credit: string | null; }
/** Open a picture file's bytes as a document: one layer, or every layer of a PSD. */
export async function decodeImage(bytes: Uint8Array, maxPixels: number): Promise<Decoded> {
  const format = detectFormat(bytes);
  if (!format) throw new Error('This file is not a picture the editor can open. It opens PNG, JPEG, WebP, GIF, BMP, AVIF, SVG, ICO and PSD files.');
  if (format === 'psd') {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), h = dv.getUint32(14), w = dv.getUint32(18);
    if (w * h > maxPixels) throw tooBig(maxPixels);
    try {
      const r = readPsdDocument(bytes);
      return { doc: r.doc, format, notes: r.notes, credit: r.credit };
    } catch (e) { throw new Error(`This PSD file could not be read (${e instanceof Error ? e.message : String(e)}).`); }
  }
  let bmp: Bitmap;
  if (format === 'bmp') bmp = decodeDib(bytes, 14, new DataView(bytes.buffer, bytes.byteOffset).getUint32(10, true), false, maxPixels);
  else if (format === 'ico') bmp = await decodeIco(bytes, maxPixels);
  else if (format === 'svg') {
    let density: number | undefined;
    try {
      const m = await sharp(bytes, { limitInputPixels: maxPixels }).metadata();
      const long = Math.max(m.width ?? 0, m.height ?? 0);
      if (long > 0 && long < 1024) density = (72 * 1024) / long;
    } catch (e) { throw plainSharpError(e, maxPixels); }
    bmp = await viaSharp(bytes, maxPixels, density);
  } else bmp = await viaSharp(bytes, maxPixels);
  return { doc: documentFromBitmap(bmp), format, notes: [], credit: readCredit(bytes, format) };
}

/** The "made with" line stored inside a file, if any. */
export function readCredit(b: Uint8Array, f: ReadFormat): string | null {
  try {
    if (f === 'png') return readPngText(b)['Software'] ?? null;
    if (f === 'jpeg') return readJpegSoftware(b);
    if (f === 'webp') { const m = /CreatorTool="([^"]*)"/.exec(webpInfo(b).xmp ?? ''); return m ? m[1] : null; }
  } catch { /* unreadable metadata is not an error */ }
  return null;
}

/** Encode a document. Every file carries the credit, the same way the web app writes it. Quality runs 0..1. */
export async function encodeImage(doc: Doc, format: WriteFormat, quality = 0.92): Promise<Uint8Array> {
  if (format === 'psd') return writePsdDocument(doc, CREDIT);
  const flat = flatten(doc, format === 'jpeg' ? WHITE : null);
  const img = sharp(flat.data, { raw: { width: flat.width, height: flat.height, channels: 4 } });
  const q = Math.max(1, Math.min(100, Math.round(quality * 100)));
  const out = format === 'png' ? await img.png().toBuffer()
    : format === 'jpeg' ? await img.removeAlpha().jpeg({ quality: q }).toBuffer()
      : await img.webp(q >= 100 ? { lossless: true } : { quality: q }).toBuffer();
  return injectMetadata(new Uint8Array(out.buffer, out.byteOffset, out.length), format, CREDIT);
}
/** A small PNG to show an agent what the picture looks like (no credit: it is never saved as a file). */
export async function previewPng(bmp: Bitmap): Promise<Uint8Array> {
  const out = await sharp(bmp.data, { raw: { width: bmp.width, height: bmp.height, channels: 4 } }).png().toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.length);
}
