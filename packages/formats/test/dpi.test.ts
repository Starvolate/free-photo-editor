// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Print resolution (DPI) in the format add-ons: TIFF tags 282/283/296 (read back on open), BMP pixels per metre, the PDF
 * page size and the JPEG XL Exif box; then outside tools read the DPI back (exiftool and pdfimages, required on CI).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREDIT, createDocument, latin1Decode, readDpi, tiffResolution, type Bitmap } from '@free-photoeditor/core';
import { codec as bmpCodec, encodeBmp } from '../src/bmp';
import { codec as pdfCodec, encodePdf } from '../src/pdf';
import { codec as tiffCodec, decodeTiff, encodeTiffPages, readTiff } from '../src/tiff';
import { isoBoxes, withJxlCredit } from '../src/wasm';

const solid = (w: number, h: number): Bitmap => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : 90 + (i % 7) * 20)) });
const OPTS = { quality: 1, multi: false, delay: 100 };
const has = (cmd: string, arg: string): boolean => !spawnSync(cmd, [arg], { stdio: 'ignore' }).error;
const CI = !!process.env.CI, EXIFTOOL = has('exiftool', '-ver');
const dv = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

describe('print resolution in the format add-ons', () => {
  it('writes the TIFF resolution tags and reads them back as the picture DPI', async () => {
    const t = readTiff(encodeTiffPages([{ bmp: solid(30, 20), name: 'p' }], CREDIT, 'lzw', 300)).ifds[0].tags;
    expect([t.get(282), t.get(283), t.get(296)]).toEqual([[300], [300], [2]]);
    expect(decodeTiff(encodeTiffPages([{ bmp: solid(30, 20), name: 'p' }], CREDIT, 'lzw', 72.5)).doc.dpi).toBe(72.5);
    const doc = createDocument(30, 20);
    expect(readDpi(await tiffCodec.encode!(doc, { ...OPTS, dpi: 500 }, {}))).toBe(500);
    expect(decodeTiff(await tiffCodec.encode!(doc, OPTS, {})).doc.dpi).toBe(72);
  });
  it('writes BMP pixels per metre', async () => {
    expect(dv(encodeBmp(solid(4, 4), 300)).getInt32(38, true)).toBe(11811);
    expect(dv(encodeBmp(solid(4, 4))).getInt32(42, true)).toBe(2835);
    expect(dv(await bmpCodec.encode!(createDocument(4, 4), { ...OPTS, dpi: 600 }, {})).getInt32(38, true)).toBe(23622);
  });
  it('sizes PDF pages from the DPI', async () => {
    expect(latin1Decode(encodePdf([solid(600, 300)], CREDIT, 300))).toContain('/MediaBox [0 0 144 72]');
    expect(latin1Decode(encodePdf([solid(600, 300)]))).toContain('/MediaBox [0 0 600 300]');
    expect(latin1Decode(await pdfCodec.encode!(createDocument(500, 250), { ...OPTS, dpi: 500 }, {}))).toContain('/MediaBox [0 0 72 36]');
  });
  it('adds an Exif box with the resolution to JPEG XL', () => {
    const out = withJxlCredit(new Uint8Array([0xff, 0x0a, 1, 2, 3]), CREDIT, 300), box = isoBoxes(out).find((b) => b.type === 'Exif');
    expect(isoBoxes(out).map((b) => b.type)).toEqual(['JXL ', 'ftyp', 'xml ', 'Exif', 'jxlc']);
    expect(box ? tiffResolution(out, box.start + 12, box.end) : null).toBe(300);
  });
  it.skipIf(!CI && !EXIFTOOL)('is read back by outside tools: exiftool for TIFF and BMP, pdfimages for PDF', () => {
    expect(EXIFTOOL, 'exiftool must be on the CI runner').toBe(true);
    const dir = mkdtempSync(path.join(tmpdir(), 'fpe-dpi-')), tif = path.join(dir, 'x1-300.tif'), bmp = path.join(dir, 'x1-300.bmp'), pdf = path.join(dir, 'x1-300.pdf');
    writeFileSync(tif, encodeTiffPages([{ bmp: solid(600, 400), name: 'p' }], CREDIT, 'lzw', 300));
    writeFileSync(bmp, encodeBmp(solid(60, 40), 300));
    writeFileSync(pdf, encodePdf([solid(600, 400)], CREDIT, 300));
    const ex = (f: string, ...tags: string[]): string => spawnSync('exiftool', ['-G1', '-s', ...tags.map((t) => '-' + t), f], { encoding: 'utf8' }).stdout;
    const t = ex(tif, 'XResolution', 'YResolution', 'ResolutionUnit'), b = ex(bmp, 'PixelsPerMeterX', 'PixelsPerMeterY');
    const list = CI || has('pdfimages', '-v') ? spawnSync('pdfimages', ['-list', pdf], { encoding: 'utf8' }).stdout : '';
    console.log(`exiftool x1-300.tif:\n${t}exiftool x1-300.bmp:\n${b}pdfimages -list x1-300.pdf:\n${list}`);
    expect(t).toMatch(/XResolution\s*:\s*300\b/);
    expect(t).toMatch(/ResolutionUnit\s*:\s*inches/);
    expect(b).toMatch(/PixelsPerMeterX\s*:\s*11811\b/);
    if (list) {
      const row = list.split('\n').find((l) => /^\s*1\s+0\s+image\b/.test(l))?.trim().split(/\s+/) ?? [];
      expect([row[3], row[4], row[12], row[13]]).toEqual(['600', '400', '300', '300']);
    }
  });
});
