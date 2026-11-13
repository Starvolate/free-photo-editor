// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/// <reference path="./ambient.d.ts" />
/**
 * The format add-ons: descriptions only. Each codec is its own module, loaded the first time its format is opened or
 * saved, so none of them weighs on the editor's first screen. `registerAllFormats()` plugs them into the engine.
 */
import { latin1Decode, registerFormat, type FormatDef } from '@free-photoeditor/core';
import { extOf, startsWith } from './util';

export const RAW_EXTS = new Set(['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'ptx', 'srw', 'x3f',
  '3fr', 'fff', 'iiq', 'erf', 'mef', 'mos', 'mrw', 'kdc', 'dcr', 'dcs', 'k25', 'raw', 'gpr', 'ari', 'bay', 'cap', 'eip', 'mdc', 'pxn']);
const TGA_EXTS = ['tga', 'icb', 'vda', 'vst', 'tpic'];
const tiffMagic = (h: Uint8Array): boolean => startsWith(h, [0x49, 0x49, 42, 0]) || startsWith(h, [0x4d, 0x4d, 0, 42]);
/** True for a TIFF whose first directory has the DNG version tag (50706): a camera RAW file. */
export function hasDngTag(h: Uint8Array): boolean {
  if (!tiffMagic(h) || h.length < 8) return false;
  const le = h[0] === 0x49, dv = new DataView(h.buffer, h.byteOffset, h.byteLength), off = dv.getUint32(4, le);
  if (off + 2 > h.length) return false;
  for (let i = 0, n = dv.getUint16(off, le); i < n; i++) {
    const e = off + 2 + i * 12;
    if (e + 2 > h.length) break;
    if (dv.getUint16(e, le) === 50706) return true;
  }
  return false;
}
function brands(h: Uint8Array): string[] {
  if (!startsWith(h, 'ftyp', 4)) return [];
  const size = Math.min(h.length, ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0), out = [latin1Decode(h, 8, 12)];
  for (let p = 16; p + 4 <= size; p += 4) out.push(latin1Decode(h, p, p + 4));
  return out;
}
const isAvif = (h: Uint8Array): boolean => brands(h).some((b) => b === 'avif' || b === 'avis');
const HEIF = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2'];
const isZip = (h: Uint8Array): boolean => startsWith(h, [0x50, 0x4b, 3, 4]);
const zipMime = (h: Uint8Array, mime: string): boolean => isZip(h) && startsWith(h, 'mimetype', 30) && startsWith(h, mime, 38 + (h[28] | (h[29] << 8)));
function apngHead(h: Uint8Array): boolean {
  if (!startsWith(h, [137, 80, 78, 71, 13, 10, 26, 10])) return false;
  for (let p = 8; p + 8 <= h.length; ) {
    const len = ((h[p] << 24) | (h[p + 1] << 16) | (h[p + 2] << 8) | h[p + 3]) >>> 0, t = latin1Decode(h, p + 4, p + 8);
    if (t === 'acTL') return true;
    if (t === 'IDAT') return false;
    p += 12 + len;
  }
  return false;
}
const never = (): boolean => false;

export const FORMATS: FormatDef[] = [
  { id: 'raw', label: 'Camera RAW', mime: 'image/x-dcraw', ext: 'dng', exts: [...RAW_EXTS], open: true, save: false, caps: { alpha: 'none' }, keeps: '',
    sniff: (h, n) => RAW_EXTS.has(extOf(n)) || hasDngTag(h), load: () => import('./raw').then((m) => m.codec) },
  { id: 'tiff', label: 'TIFF', mime: 'image/tiff', ext: 'tif', exts: ['tif', 'tiff'], open: true, save: true, caps: { alpha: 'full', multi: 'pages' },
    keeps: 'TIFF keeps every pixel exactly, transparency included, for print and photo tools.', sniff: tiffMagic, load: () => import('./tiff').then((m) => m.codec) },
  { id: 'gif', label: 'GIF', mime: 'image/gif', ext: 'gif', exts: ['gif'], open: true, save: true, caps: { alpha: 'binary', palette: true, multi: 'frames' },
    keeps: 'GIF opens everywhere and can move.', sniff: (h) => startsWith(h, 'GIF8'), load: () => import('./anim').then((m) => m.gifCodec) },
  { id: 'apng', label: 'Moving PNG', mime: 'image/apng', ext: 'png', exts: ['apng'], open: true, save: false, caps: { alpha: 'full', multi: 'frames' }, keeps: '',
    sniff: apngHead, load: () => import('./anim').then((m) => m.apngCodec) },
  { id: 'webp-anim', label: 'Moving WebP', mime: 'image/webp', ext: 'webp', exts: [], open: true, save: false, caps: { alpha: 'full', lossy: true, multi: 'frames' }, keeps: '',
    sniff: (h) => startsWith(h, 'RIFF') && startsWith(h, 'WEBPVP8X', 8) && (h[20] & 0x02) !== 0, load: () => import('./anim').then((m) => m.webpAnimCodec) },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif', exts: ['avif'], open: true, save: true, caps: { alpha: 'full', lossy: true },
    keeps: 'AVIF makes very small files and keeps transparency.', sniff: isAvif, load: () => import('./wasm').then((m) => m.avifCodec) },
  { id: 'heic', label: 'HEIC', mime: 'image/heic', ext: 'heic', exts: ['heic', 'heif', 'hif'], open: true, save: false, caps: { alpha: 'full', lossy: true }, keeps: '',
    sniff: (h) => !isAvif(h) && brands(h).some((b) => HEIF.includes(b)), load: () => import('./wasm').then((m) => m.heicCodec) },
  { id: 'jxl', label: 'JPEG XL', mime: 'image/jxl', ext: 'jxl', exts: ['jxl'], open: true, save: true, caps: { alpha: 'full', lossy: true },
    keeps: 'JPEG XL makes very small files and keeps transparency.', sniff: (h) => startsWith(h, [0xff, 0x0a]) || startsWith(h, [0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]),
    load: () => import('./wasm').then((m) => m.jxlCodec) },
  { id: 'tga', label: 'TGA', mime: 'image/x-tga', ext: 'tga', exts: TGA_EXTS, open: true, save: true, caps: { alpha: 'full' },
    keeps: 'TGA keeps every pixel exactly, transparency included.', sniff: (_h, n) => TGA_EXTS.includes(extOf(n)), load: () => import('./tga').then((m) => m.codec) },
  { id: 'bmp', label: 'BMP', mime: 'image/bmp', ext: 'bmp', exts: ['bmp', 'dib'], open: false, save: true, caps: { alpha: 'full' },
    keeps: 'BMP keeps every pixel exactly, without compression.', sniff: never, load: () => import('./bmp').then((m) => m.codec) },
  { id: 'ico', label: 'ICO', mime: 'image/x-icon', ext: 'ico', exts: ['ico'], open: false, save: true, caps: { alpha: 'full', maxSide: 256 },
    keeps: 'ICO stores the picture as square website icons from 16 to 256 pixels.', sniff: never, load: () => import('./ico').then((m) => m.codec) },
  { id: 'pdf', label: 'PDF', mime: 'application/pdf', ext: 'pdf', exts: ['pdf'], open: true, save: true, caps: { alpha: 'full', multi: 'pages' },
    keeps: 'PDF keeps every pixel exactly and opens on every device.', sniff: (h) => latin1Decode(h, 0, Math.min(h.length, 1024)).includes('%PDF-'),
    load: () => import('./pdf').then((m) => m.codec) },
  { id: 'svg', label: 'SVG', mime: 'image/svg+xml', ext: 'svg', exts: ['svg'], open: false, save: true, caps: { alpha: 'full', layers: true },
    keeps: 'SVG keeps every layer; text and shapes stay sharp at any size, painted layers stay as pictures.', sniff: never, load: () => import('./svg').then((m) => m.codec) },
  { id: 'ora', label: 'OpenRaster', mime: 'image/openraster', ext: 'ora', exts: ['ora'], open: true, save: true, caps: { alpha: 'full', layers: true },
    keeps: 'OpenRaster keeps every layer with its name, order, visibility, opacity and place, for Krita, GIMP and MyPaint.',
    sniff: (h, n) => zipMime(h, 'image/openraster') || (isZip(h) && extOf(n) === 'ora'), load: () => import('./ora').then((m) => m.oraCodec) },
  { id: 'kra', label: 'Krita', mime: 'application/x-krita', ext: 'kra', exts: ['kra'], open: true, save: false, caps: { alpha: 'full' }, keeps: '',
    sniff: (h, n) => zipMime(h, 'application/x-krita') || (isZip(h) && extOf(n) === 'kra'), load: () => import('./ora').then((m) => m.kraCodec) },
];
/** Files we recognise but can't open yet, with what to do instead, in plain words. */
export const PLANNED_OPEN: { test: (head: Uint8Array, name: string) => boolean; message: string }[] = [
  { test: (h, n) => startsWith(h, 'gimp xcf') || extOf(n) === 'xcf',
    message: "GIMP's own files (.xcf) can't be opened yet; that is planned. In GIMP, use File > Export As to save a PSD or OpenRaster (.ora) file: both open here with their layers." },
];
/** Every file ending the add-ons open, for the file picker. */
export const OPEN_EXTS: string[] = [...new Set(FORMATS.filter((f) => f.open).flatMap((f) => f.exts))];
let done = false;
export function registerAllFormats(): void {
  if (done) return;
  done = true;
  for (const f of FORMATS) registerFormat(f);
}
