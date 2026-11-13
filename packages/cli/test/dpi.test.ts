// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Print resolution (DPI) on the command line: --dpi and --resize-to-print, read on open and kept on save, the best JPEG
 * keeping every colour pixel (4:4:4), and an outside tool (exiftool, required on CI) reading the DPI back.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREDIT, jpegSampling, jpegSegments, pngChunks, readDpi, readJpegDpi, readJpegSoftware, readPngDpi, readPngText } from '@free-photoeditor/core';
import { readPsdDocument } from '@free-photoeditor/core/psd';
import { run } from '../src/cli';
import { capture, pattern, readPng, tempDir, writePng } from './helpers';

const CI = !!process.env.CI, EXIFTOOL = !spawnSync('exiftool', ['-ver'], { stdio: 'ignore' }).error;
function folder(): string {
  const dir = tempDir();
  writePng(path.join(dir, 'a.png'), { width: 600, height: 400, data: pattern(600, 400, false) });
  return dir;
}
const file = (dir: string, f: string): Uint8Array => new Uint8Array(readFileSync(path.join(dir, f)));
async function cli(dir: string, ...args: string[]): Promise<{ code: number; text: string }> {
  const c = capture(dir), code = await run(args, c.io);
  return { code, text: [...c.out, ...c.err].join('\n') };
}

describe('print resolution on the command line', () => {
  it('--dpi writes the DPI and keeps every pixel', async () => {
    const dir = folder(), r = await cli(dir, 'convert', 'a.png', '--to', 'png', '--dpi', '300', '-o', 'b.png');
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/300 DPI prints 5\.08 × 3\.39 cm \(2 × 1\.33 in\)\. The pixels are unchanged/);
    const b = file(dir, 'b.png');
    expect(pngChunks(b).filter((c) => c.type === 'pHYs')).toHaveLength(1);
    expect([readPngDpi(b), readPngText(b).Software, readPng(path.join(dir, 'b.png')).width]).toEqual([300, CREDIT, 600]);
  });
  it('the best JPEG keeps every colour pixel (4:4:4), with one JFIF header and EXIF both at the DPI', async () => {
    const dir = folder();
    expect((await cli(dir, 'export', 'a.png', '--to', 'jpeg', '--quality', '1', '--dpi', '500', '-o', 'c.jpg')).code).toBe(0);
    const c = file(dir, 'c.jpg'), app0 = jpegSegments(c).filter((s) => s.marker === 0xe0);
    expect(app0).toHaveLength(1);
    expect([...c.subarray(app0[0].dataStart + 7, app0[0].dataStart + 12)]).toEqual([1, 0x01, 0xf4, 0x01, 0xf4]);
    expect([readJpegDpi(c), jpegSampling(c), readJpegSoftware(c)]).toEqual([500, '4:4:4', CREDIT]);
    await cli(dir, 'export', 'a.png', '--to', 'jpeg', '-o', 'small.jpg');
    expect(jpegSampling(file(dir, 'small.jpg'))).toBe('4:2:0');
  });
  it('--resize-to-print resamples to the print size at the DPI', async () => {
    const dir = folder();
    expect((await cli(dir, 'export', 'a.png', '--to', 'png', '--dpi', '300', '--resize-to-print', '10x15cm', '-o', 'd.png')).code).toBe(0);
    const d = readPng(path.join(dir, 'd.png'));
    expect([d.width, d.height, readPngDpi(file(dir, 'd.png'))]).toEqual([1181, 1772, 300]);
    await cli(dir, 'export', 'a.png', '--to', 'png', '--dpi', '300', '--resize-to-print', '10cm', '-o', 'e.png');
    const e = readPng(path.join(dir, 'e.png'));
    expect([e.width, e.height]).toEqual([1181, 787]);
  });
  it('reads the DPI on open and keeps it, PSD round trip included', async () => {
    const dir = folder();
    await cli(dir, 'convert', 'a.png', '--to', 'psd', '--dpi', '300', '-o', 'f.psd');
    expect(readPsdDocument(file(dir, 'f.psd')).doc.dpi).toBe(300);
    await cli(dir, 'convert', 'f.psd', '--to', 'jpeg', '-o', 'g.jpg');
    await cli(dir, 'convert', 'g.jpg', '--to', 'webp', '-o', 'h.webp');
    expect([readJpegDpi(file(dir, 'g.jpg')), readDpi(file(dir, 'h.webp'))]).toEqual([300, 300]);
    const info = JSON.parse((await cli(dir, 'info', 'h.webp', '--json')).text);
    expect(info.results[0]).toMatchObject({ dpi: 300, printSize: { cm: [5.08, 3.39], in: [2, 1.33] } });
  });
  it('says plainly when the DPI or the print size is wrong', async () => {
    const dir = folder();
    expect(await cli(dir, 'convert', 'a.png', '--to', 'png', '--dpi', '0')).toMatchObject({ code: 2, text: expect.stringMatching(/from 1 to 10000/) });
    expect(await cli(dir, 'convert', 'a.png', '--to', 'png', '--resize-to-print', '10x15')).toMatchObject({ code: 2, text: expect.stringMatching(/not a print size/) });
  });
  it.skipIf(!CI && !EXIFTOOL)('is read back by an outside tool (exiftool) from PNG, JPEG, WebP and PSD', async () => {
    expect(EXIFTOOL, 'exiftool must be on the CI runner').toBe(true);
    const dir = folder(), files = ['x1-300.png', 'x1-500.jpg', 'x1-300.webp', 'x1-300.psd'];
    for (const f of files) await cli(dir, 'export', 'a.png', '--quality', '1', '--dpi', f.includes('500') ? '500' : '300', '-o', f);
    const ex = (f: string): string => spawnSync('exiftool', ['-a', '-G1', '-s', '-XResolution', '-YResolution', '-ResolutionUnit', '-PixelsPerUnitX', '-PixelsPerUnitY',
      '-PixelUnits', path.join(dir, f)], { encoding: 'utf8' }).stdout;
    const got = Object.fromEntries(files.map((f) => [f, ex(f)]));
    console.log(files.map((f) => `exiftool ${f}:\n${got[f]}`).join(''));
    expect(got['x1-300.png']).toMatch(/PixelsPerUnitX\s*:\s*11811\b/);
    expect(got['x1-300.png']).toMatch(/PixelUnits\s*:\s*meters/);
    expect(got['x1-500.jpg']).toMatch(/\[JFIF\]\s+XResolution\s*:\s*500\b/);
    expect(got['x1-500.jpg']).toMatch(/\[IFD0\]\s+XResolution\s*:\s*500\b/);
    expect(got['x1-300.webp']).toMatch(/\[IFD0\]\s+XResolution\s*:\s*300\b/);
    expect(got['x1-300.psd']).toMatch(/\[Photoshop\]\s+XResolution\s*:\s*300\b/);
  });
});
