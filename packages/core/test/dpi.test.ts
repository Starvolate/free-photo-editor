// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Print resolution (DPI): the bytes each format stores, reading them back, the print-size maths and the PSD round trip. */
import { describe, expect, it } from 'vitest';
import {
  CREDIT, buildExif, buildXmp, concatBytes, createDocument, docDpi, dpiForPrint, injectMetadata, injectWebpXmp, jpegSampling, jpegSegments,
  latin1Encode, makePngChunk, parsePrintSize, pngChunks, printPixels, printSize, printTarget, readDpi, readJpegDpi, readJpegSoftware, readPngDpi,
  readPngText, setDocDpi, setJpegDpi, setPngDpi, tiffResolution, webpInfo,
} from '../src/index';
import { readPsdDocument, writePsdDocument } from '../src/psd';

const be = (v: number): number[] => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const le = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];
function fakePng(): Uint8Array {
  return concatBytes(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), makePngChunk('IHDR', new Uint8Array([...be(4), ...be(3), 8, 6, 0, 0, 0])),
    makePngChunk('IDAT', new Uint8Array([1, 2, 3])), makePngChunk('IEND', new Uint8Array(0)));
}
/** A JPEG's headers only: SOI, JFIF (units 0, density 1:1), a frame header with these luma sampling factors, a scan header. */
function fakeJpeg(y = 0x11, jfif = true): Uint8Array {
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0, 17, 8, 0, 3, 0, 4, 3, 1, y, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0];
  return new Uint8Array([0xff, 0xd8, ...(jfif ? app0 : []), ...sof, ...sos, 1, 2, 3, 0xff, 0xd9]);
}
function fakeWebp(w = 4, h = 3): Uint8Array {
  const bits = (w - 1) | ((h - 1) << 14), body = [...latin1Encode('WEBPVP8L'), 5, 0, 0, 0, 0x2f, ...le(bits), 0];
  return new Uint8Array([...latin1Encode('RIFF'), ...le(body.length), ...body]);
}
const count = (b: Uint8Array, marker: number): number => jpegSegments(b).filter((s) => s.marker === marker).length;

describe('print resolution (DPI)', () => {
  it('works out the print size and the pixels a print size needs', () => {
    expect(printSize(3000, 2000, 300)).toEqual({ in: [10, 6.67], cm: [25.4, 16.93], mm: [254, 169.3] });
    expect(printSize(600, 400, 72).cm).toEqual([21.17, 14.11]);
    expect([printPixels(10, 'cm', 300), printPixels(15, 'cm', 300), printPixels(4, 'in', 500), printPixels(210, 'mm', 300)]).toEqual([1181, 1772, 2000, 2480]);
    expect(dpiForPrint(3000, 10, 'in')).toBe(300);
    expect(dpiForPrint(1181, 10, 'cm')).toBe(300);
    expect(printTarget({ width: 10, height: 15, unit: 'cm' }, 300, { width: 600, height: 400 })).toEqual({ width: 1181, height: 1772 });
    expect(printTarget({ width: 10, unit: 'cm' }, 300, { width: 600, height: 400 })).toEqual({ width: 1181, height: 787 });
    expect(parsePrintSize('10x15cm')).toEqual({ width: 10, height: 15, unit: 'cm' });
    expect(parsePrintSize(' 4 × 6 inches ')).toEqual({ width: 4, height: 6, unit: 'in' });
    expect(parsePrintSize('210*297mm')).toEqual({ width: 210, height: 297, unit: 'mm' });
    expect(parsePrintSize('x15cm')).toEqual({ width: undefined, height: 15, unit: 'cm' });
    expect(() => parsePrintSize('10x15')).toThrow(/not a print size/);
    expect(() => parsePrintSize('big')).toThrow(/10x15cm/);
  });
  it('is one setting of the picture: 72 until changed, changed as one undoable step', () => {
    const doc = createDocument(8, 6);
    expect(docDpi(doc)).toBe(72);
    const cmd = setDocDpi(doc, 300);
    expect(doc.dpi).toBe(300);
    expect(setDocDpi(doc, 300)).toBeNull();
    cmd?.undo(doc);
    expect(doc.dpi).toBeUndefined();
    cmd?.redo(doc);
    expect(docDpi(doc)).toBe(300);
    expect(() => setDocDpi(doc, 0)).toThrow(/from 1 to 10000/);
  });
  it('writes PNG pHYs in pixels per metre, replacing any there, and reads it back', () => {
    const p = setPngDpi(fakePng(), 300), ph = pngChunks(p).find((c) => c.type === 'pHYs');
    expect(pngChunks(p).map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect([...p.subarray(ph?.dataStart, (ph?.dataStart ?? 0) + 9)]).toEqual([0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1]);
    expect(readPngDpi(p)).toBe(300);
    const again = setPngDpi(setPngDpi(p, 72), 500);
    expect(pngChunks(again).filter((c) => c.type === 'pHYs')).toHaveLength(1);
    expect([readPngDpi(setPngDpi(p, 72)), readPngDpi(again), readPngDpi(setPngDpi(p, 600)), readPngDpi(fakePng())]).toEqual([72, 500, 600, null]);
    const out = injectMetadata(fakePng(), 'png', CREDIT, 300);
    expect(readPngText(out).Software).toBe(CREDIT);
    expect(readDpi(out)).toBe(300);
  });
  it('writes JPEG JFIF density and EXIF X/YResolution, patching the JFIF header in place', () => {
    const j = setJpegDpi(fakeJpeg(), 300), d = jpegSegments(j)[0].dataStart;
    expect(count(j, 0xe0)).toBe(1);
    expect([...j.subarray(d + 7, d + 12)]).toEqual([1, 0x01, 0x2c, 0x01, 0x2c]);
    expect(readJpegDpi(j)).toBe(300);
    const bare = setJpegDpi(fakeJpeg(0x11, false), 500);
    expect(jpegSegments(bare)[0].marker).toBe(0xe0);
    expect(readJpegDpi(bare)).toBe(500);
    const full = injectMetadata(fakeJpeg(), 'jpeg', CREDIT, 300.5);
    expect(count(full, 0xe0)).toBe(1);
    expect(readJpegSoftware(full)).toBe(CREDIT);
    expect(readJpegDpi(full)).toBe(300.5);
    expect(readDpi(injectMetadata(fakeJpeg(), 'jpeg', CREDIT, 600))).toBe(600);
  });
  it('reads how a JPEG keeps colour from its frame header (4:4:4 keeps every colour pixel)', () => {
    expect([jpegSampling(fakeJpeg(0x11)), jpegSampling(fakeJpeg(0x22)), jpegSampling(fakeJpeg(0x21))]).toEqual(['4:4:4', '4:2:0', '4:2:2']);
  });
  it('puts the resolution in EXIF with the tags in order, and in XMP', () => {
    const t = buildExif(CREDIT, 300), dv = new DataView(t.buffer);
    expect(dv.getUint16(8)).toBe(4);
    expect([0, 1, 2, 3].map((i) => dv.getUint16(10 + i * 12))).toEqual([0x011a, 0x011b, 0x0128, 0x0131]);
    expect(tiffResolution(t, 0)).toBe(300);
    expect(buildExif(CREDIT).length).toBe(26 + CREDIT.length + 1);
    expect(buildXmp(CREDIT, 300)).toContain('tiff:XResolution="300/1"');
    expect(buildXmp(CREDIT, 72.5)).toContain('tiff:YResolution="72500/1000"');
    expect(buildXmp(CREDIT)).not.toContain('tiff:');
  });
  it('writes WebP EXIF (with its VP8X flag) next to the XMP, and reads it back', () => {
    const w = injectMetadata(fakeWebp(), 'webp', CREDIT, 300), info = webpInfo(w);
    expect(info.chunks).toEqual(['VP8X', 'VP8L', 'EXIF', 'XMP ']);
    expect(info.flags & 0x08).toBe(0x08);
    expect(readDpi(w)).toBe(300);
    expect(webpInfo(injectWebpXmp(w, buildXmp(CREDIT))).chunks).toEqual(['VP8X', 'VP8L', 'EXIF', 'XMP ']);
  });
  it('keeps the DPI through a PSD round trip (resolution info, in pixels per inch)', () => {
    for (const dpi of [300, 500, 72.5]) {
      const doc = createDocument(40, 30);
      doc.dpi = dpi;
      expect(readPsdDocument(writePsdDocument(doc)).doc.dpi).toBe(dpi);
    }
    expect(readPsdDocument(writePsdDocument(createDocument(4, 4))).doc.dpi).toBe(72);
    expect(readPsdDocument(writePsdDocument(createDocument(4, 4), CREDIT, 600)).doc.dpi).toBe(600);
  });
});
