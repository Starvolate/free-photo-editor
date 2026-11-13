// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The author's credit inside every exported file, with no visible watermark: PNG tEXt "Software", JPEG EXIF
 * Software (tag 0x0131) plus XMP CreatorTool, WebP XMP (with a VP8X header). PSD gets XMP through psd.ts.
 * The print resolution (DPI) goes in with it: PNG pHYs, JPEG JFIF density plus EXIF X/YResolution, WebP EXIF, and
 * tiff:XResolution in every XMP packet. dpi.ts has the readers and the print-size maths.
 */
import { CREDIT } from './credit';
import { concatBytes, latin1Decode, latin1Encode, utf8Decode, utf8Encode } from './text';

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b: Uint8Array, start = 0, end = b.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const be32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function putBe32(b: Uint8Array, o: number, v: number): void { b[o] = v >>> 24; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; }
function putLe32(b: Uint8Array, o: number, v: number): void { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = v >>> 24; }
/** A print resolution as a TIFF rational: whole numbers over 1, otherwise in thousandths. */
export function rationalOf(dpi: number): [number, number] { return Number.isInteger(dpi) ? [dpi, 1] : [Math.round(dpi * 1000), 1000]; }
/**
 * The resolution in a TIFF block (a TIFF file, or the EXIF inside JPEG, WebP and JPEG XL) starting at `t`: XResolution
 * (282) in ResolutionUnit (296: 2 inches, the default; 3 centimetres), in dots per inch to tenths. Null when absent.
 */
export function tiffResolution(b: Uint8Array, t: number, end: number = b.length): number | null {
  if (t + 8 > end) return null;
  const le = b[t] === 0x49;
  if (!le && b[t] !== 0x4d) return null;
  const u16 = (o: number): number => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
  const u32 = (o: number): number => (le ? le32(b, t + o) : be32(b, t + o));
  const ifd = u32(4);
  if (t + ifd + 2 > end) return null;
  let x = 0, unit = 2;
  for (let i = 0, n = u16(ifd); i < n && t + ifd + 14 + i * 12 <= end; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e);
    if (tag === 282 && u16(e + 2) === 5) { const o = u32(e + 8); if (t + o + 8 <= end) x = u32(o) / (u32(o + 4) || 1); }
    else if (tag === 296) unit = u16(e + 8);
  }
  const dpi = Math.round((unit === 3 ? x * 2.54 : unit === 2 ? x : 0) * 10) / 10;
  return dpi >= 1 && dpi <= 10000 ? dpi : null;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export const xmlEscape = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);
/** The XMP packet: the credit as CreatorTool, and the print resolution (tiff:XResolution) when given. */
export function buildXmp(creatorTool: string = CREDIT, dpi?: number): string {
  const r = dpi && dpi > 0 ? rationalOf(dpi).join('/') : '';
  const res = r ? ` xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:XResolution="${r}" tiff:YResolution="${r}" tiff:ResolutionUnit="2"` : '';
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    `  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="${xmlEscape(creatorTool)}"${res}/>\n` +
    ' </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>';
}

// PNG
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
export const isPng = (b: Uint8Array): boolean => b.length > 8 && PNG_SIG.every((v, i) => b[i] === v);
export interface PngChunk { type: string; start: number; dataStart: number; length: number; end: number; }
export function pngChunks(b: Uint8Array): PngChunk[] {
  if (!isPng(b)) throw new Error('Not a PNG file');
  const out: PngChunk[] = [];
  for (let p = 8; p + 12 <= b.length; ) {
    const length = be32(b, p), type = latin1Decode(b, p + 4, p + 8), end = p + 12 + length;
    if (end > b.length) throw new Error('A PNG chunk runs past the end of the file');
    out.push({ type, start: p, dataStart: p + 8, length, end });
    p = end;
    if (type === 'IEND') break;
  }
  return out;
}
export function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const c = new Uint8Array(12 + data.length);
  putBe32(c, 0, data.length); c.set(latin1Encode(type), 4); c.set(data, 8);
  putBe32(c, 8 + data.length, crc32(c, 4, 8 + data.length));
  return c;
}
export function injectPngText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const chunks = pngChunks(png);
  if (!chunks.length || chunks[0].type !== 'IHDR') throw new Error('The PNG has no header chunk');
  const at = chunks[0].end;
  return concatBytes(png.subarray(0, at), makePngChunk('tEXt', concatBytes(latin1Encode(keyword), new Uint8Array(1), latin1Encode(text))), png.subarray(at));
}
/** Store the print resolution in a PNG (pHYs, whole pixels per metre) right after the header, replacing any there. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const chunks = pngChunks(png);
  if (!chunks.length || chunks[0].type !== 'IHDR') throw new Error('The PNG has no header chunk');
  const ppm = Math.round(dpi / 0.0254), d = new Uint8Array(9);
  putBe32(d, 0, ppm); putBe32(d, 4, ppm); d[8] = 1;
  const rest = chunks.slice(1).filter((c) => c.type !== 'pHYs').map((c) => png.subarray(c.start, c.end));
  return concatBytes(png.subarray(0, chunks[0].end), makePngChunk('pHYs', d), ...rest);
}
export function readPngText(png: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of pngChunks(png)) {
    if (c.type !== 'tEXt') continue;
    const z = png.indexOf(0, c.dataStart);
    if (z > 0 && z < c.dataStart + c.length) out[latin1Decode(png, c.dataStart, z)] = latin1Decode(png, z + 1, c.dataStart + c.length);
  }
  return out;
}

// JPEG
export interface JpegSegment { marker: number; start: number; dataStart: number; end: number; }
export function jpegSegments(b: Uint8Array): JpegSegment[] {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('Not a JPEG file');
  const out: JpegSegment[] = [];
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    if (marker === 0xff) { p += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { p += 2; continue; }
    const len = (b[p + 2] << 8) | b[p + 3];
    out.push({ marker, start: p, dataStart: p + 4, end: p + 2 + len });
    if (marker === 0xda) break;
    p += 2 + len;
  }
  return out;
}
/**
 * A big-endian TIFF block for EXIF. IFD0 holds Software (0x0131, ASCII) and, with a print resolution, XResolution
 * (0x011A) and YResolution (0x011B) as rationals with ResolutionUnit (0x0128) = 2, inches; entries in tag order.
 */
export function buildExif(software: string, dpi?: number): Uint8Array {
  const sw = latin1Encode(software + '\0'), res = dpi && dpi > 0 ? rationalOf(dpi) : null, n = res ? 4 : 1;
  const data = 8 + 2 + n * 12 + 4, swAt = data + (res ? 16 : 0);
  const t = new Uint8Array(swAt + sw.length), dv = new DataView(t.buffer);
  t[0] = 0x4d; t[1] = 0x4d; dv.setUint16(2, 42); dv.setUint32(4, 8); dv.setUint16(8, n);
  let e = 10;
  const entry = (tag: number, type: number, count: number, value: number): void => {
    dv.setUint16(e, tag); dv.setUint16(e + 2, type); dv.setUint32(e + 4, count);
    if (type === 3) dv.setUint16(e + 8, value); else dv.setUint32(e + 8, value);
    e += 12;
  };
  if (res) {
    entry(0x011a, 5, 1, data); entry(0x011b, 5, 1, data + 8); entry(0x0128, 3, 1, 2);
    for (const o of [data, data + 8]) { dv.setUint32(o, res[0]); dv.setUint32(o + 4, res[1]); }
  }
  entry(0x0131, 2, sw.length, swAt);
  dv.setUint32(e, 0);
  t.set(sw, swAt);
  return t;
}
function app1(payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  if (len > 0xffff) throw new Error('The metadata block is too large for JPEG');
  const s = new Uint8Array(len + 2);
  s[0] = 0xff; s[1] = 0xe1; s[2] = len >> 8; s[3] = len & 255; s.set(payload, 4);
  return s;
}
const EXIF_HEAD = latin1Encode('Exif\0\0');
const XMP_HEAD = latin1Encode('http://ns.adobe.com/xap/1.0/\0');
export function injectJpegMetadata(jpeg: Uint8Array, software: string, xmp: string, dpi?: number): Uint8Array {
  if (dpi) jpeg = setJpegDpi(jpeg, dpi);
  let at = 2;
  for (const s of jpegSegments(jpeg)) { if (s.marker === 0xe0) at = s.end; else break; }
  return concatBytes(jpeg.subarray(0, at), app1(concatBytes(EXIF_HEAD, buildExif(software, dpi))), app1(concatBytes(XMP_HEAD, utf8Encode(xmp))), jpeg.subarray(at));
}
/** Store the print resolution in a JPEG's JFIF header: patched in place when there is one, added after SOI when not. */
export function setJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  const v = Math.max(1, Math.min(65535, Math.round(dpi)));
  for (const s of jpegSegments(jpeg)) {
    const d = s.dataStart;
    if (s.marker !== 0xe0 || d + 12 > s.end || latin1Decode(jpeg, d, d + 5) !== 'JFIF\0') continue;
    const out = jpeg.slice();
    out[d + 7] = 1; out[d + 8] = v >> 8; out[d + 9] = v & 255; out[d + 10] = v >> 8; out[d + 11] = v & 255;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, v >> 8, v & 255, v >> 8, v & 255, 0, 0]);
  return concatBytes(jpeg.subarray(0, 2), app0, jpeg.subarray(2));
}
/**
 * How a JPEG keeps colour, from its frame header: '4:4:4' (every colour pixel), '4:2:2' (colour at half width), '4:2:0'
 * (colour at half width and height), 'grey', or the raw factors. Null when there is no frame header.
 */
export function jpegSampling(jpeg: Uint8Array): string | null {
  for (const s of jpegSegments(jpeg)) {
    if (s.marker < 0xc0 || s.marker > 0xcf || s.marker === 0xc4 || s.marker === 0xc8 || s.marker === 0xcc) continue;
    const n = jpeg[s.dataStart + 5], f: number[] = [];
    for (let i = 0; i < n; i++) f.push(jpeg[s.dataStart + 7 + i * 3]);
    if (n === 1) return 'grey';
    if (f.every((x) => x === f[0])) return '4:4:4';
    if (f.slice(1).every((x) => x === 0x11)) { if (f[0] === 0x22) return '4:2:0'; if (f[0] === 0x21) return '4:2:2'; }
    return f.map((x) => x.toString(16)).join(',');
  }
  return null;
}
export function readJpegSoftware(jpeg: Uint8Array): string | null {
  for (const s of jpegSegments(jpeg)) {
    if (s.marker !== 0xe1 || latin1Decode(jpeg, s.dataStart, s.dataStart + 6) !== 'Exif\0\0') continue;
    const t = s.dataStart + 6, le = jpeg[t] === 0x49;
    const u16 = (o: number): number => (le ? jpeg[t + o] | (jpeg[t + o + 1] << 8) : (jpeg[t + o] << 8) | jpeg[t + o + 1]);
    const u32 = (o: number): number => (le ? le32(jpeg, t + o) : be32(jpeg, t + o));
    const ifd = u32(4);
    for (let i = 0, n = u16(ifd); i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) !== 0x0131) continue;
      const count = u32(e + 4), off = count <= 4 ? e + 8 : u32(e + 8);
      return latin1Decode(jpeg, t + off, t + off + count).replace(/\0+$/, '');
    }
  }
  return null;
}
export function readJpegXmp(jpeg: Uint8Array): string | null {
  for (const s of jpegSegments(jpeg)) {
    if (s.marker === 0xe1 && latin1Decode(jpeg, s.dataStart, s.dataStart + XMP_HEAD.length) === latin1Decode(XMP_HEAD)) {
      return utf8Decode(jpeg, s.dataStart + XMP_HEAD.length, s.end);
    }
  }
  return null;
}

// WebP
export interface WebpChunk { fourcc: string; start: number; dataStart: number; size: number; }
export function webpChunks(b: Uint8Array): WebpChunk[] {
  if (latin1Decode(b, 0, 4) !== 'RIFF' || latin1Decode(b, 8, 12) !== 'WEBP') throw new Error('Not a WebP file');
  const riffEnd = 8 + le32(b, 4);
  if (riffEnd > b.length) throw new Error('The WebP file is shorter than its header says');
  const out: WebpChunk[] = [];
  for (let p = 12; p + 8 <= riffEnd; ) {
    const size = le32(b, p + 4);
    if (p + 8 + size > riffEnd) throw new Error('A WebP chunk runs past the end of the file');
    out.push({ fourcc: latin1Decode(b, p, p + 4), start: p, dataStart: p + 8, size });
    p += 8 + size + (size & 1);
  }
  return out;
}
export interface WebpInfo { width: number; height: number; alpha: boolean; lossless: boolean; chunks: string[]; flags: number; xmp: string | null; }
export function webpInfo(b: Uint8Array): WebpInfo {
  const chunks = webpChunks(b);
  let width = 0, height = 0, alpha = false, lossless = false, flags = 0, xmp: string | null = null;
  for (const c of chunks) {
    const d = c.dataStart;
    if (c.fourcc === 'VP8X') {
      flags = b[d]; alpha = (flags & 0x10) !== 0;
      width = 1 + (b[d + 4] | (b[d + 5] << 8) | (b[d + 6] << 16)); height = 1 + (b[d + 7] | (b[d + 8] << 8) | (b[d + 9] << 16));
    } else if (c.fourcc === 'VP8 ') {
      if (b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) throw new Error('Bad VP8 frame header');
      if (!width) { width = (b[d + 6] | (b[d + 7] << 8)) & 0x3fff; height = (b[d + 8] | (b[d + 9] << 8)) & 0x3fff; }
    } else if (c.fourcc === 'VP8L') {
      if (b[d] !== 0x2f) throw new Error('Bad VP8L signature');
      lossless = true;
      const bits = le32(b, d + 1);
      if (!width) { width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
      if ((bits >>> 28) & 1) alpha = true;
    } else if (c.fourcc === 'ALPH') alpha = true;
    else if (c.fourcc === 'XMP ') xmp = utf8Decode(b, d, d + c.size);
  }
  return { width, height, alpha, lossless, chunks: chunks.map((c) => c.fourcc), flags, xmp };
}
function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const c = new Uint8Array(8 + data.length + (data.length & 1));
  c.set(latin1Encode(fourcc), 0); putLe32(c, 4, data.length); c.set(data, 8);
  return c;
}
export function injectWebpXmp(webp: Uint8Array, xmp: string, exif?: Uint8Array): Uint8Array {
  const info = webpInfo(webp);
  const chunks = webpChunks(webp).filter((c) => c.fourcc !== 'XMP ' && !(exif && c.fourcc === 'EXIF'));
  const copy = (c: WebpChunk): Uint8Array => riffChunk(c.fourcc, webp.subarray(c.dataStart, c.dataStart + c.size));
  const body: Uint8Array[] = [];
  if (chunks[0] && chunks[0].fourcc === 'VP8X') {
    const head = copy(chunks[0]);
    head[8] |= 0x04 | (exif ? 0x08 : 0);
    body.push(head, ...chunks.slice(1).map(copy));
  } else {
    const head = new Uint8Array(10), w = info.width - 1, h = info.height - 1;
    head[0] = 0x04 | (exif ? 0x08 : 0) | (info.alpha ? 0x10 : 0);
    head[4] = w & 255; head[5] = (w >> 8) & 255; head[6] = (w >> 16) & 255;
    head[7] = h & 255; head[8] = (h >> 8) & 255; head[9] = (h >> 16) & 255;
    body.push(riffChunk('VP8X', head), ...chunks.map(copy));
  }
  if (exif) body.push(riffChunk('EXIF', exif));
  body.push(riffChunk('XMP ', utf8Encode(xmp)));
  const out = concatBytes(latin1Encode('RIFF'), new Uint8Array(4), latin1Encode('WEBP'), ...body);
  putLe32(out, 4, out.length - 8);
  return out;
}

export type RasterFormat = 'png' | 'jpeg' | 'webp';
/** Add the credit, and the print resolution (DPI) when given, to an encoded PNG, JPEG or WebP file. */
export function injectMetadata(bytes: Uint8Array, format: RasterFormat, credit: string = CREDIT, dpi?: number): Uint8Array {
  if (format === 'png') { const out = injectPngText(bytes, 'Software', credit); return dpi ? setPngDpi(out, dpi) : out; }
  if (format === 'jpeg') return injectJpegMetadata(bytes, credit, buildXmp(credit, dpi), dpi);
  return injectWebpXmp(bytes, buildXmp(credit, dpi), dpi ? buildExif(credit, dpi) : undefined);
}
