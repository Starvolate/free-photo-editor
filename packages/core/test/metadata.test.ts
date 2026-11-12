// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import * as jpeg from 'jpeg-js';
import { readPsd } from 'ag-psd';
import { CREDIT, createDocument, injectMetadata, readJpegSoftware, readJpegXmp, readPngText, webpInfo } from '../src/index';
import { writePsdDocument } from '../src/psd';

const W = 9, H = 7;
const rgba = new Uint8Array(W * H * 4);
for (let i = 0; i < rgba.length; i += 4) rgba.set([(i * 3) % 256, (i * 7) % 256, (i * 11) % 256, 255], i);
const samples = JSON.parse(readFileSync(new URL('./fixtures/webp-samples.json', import.meta.url), 'utf8')) as Record<string, string>;

describe('credit in exported files', () => {
  it('PNG: tEXt Software, and the file still decodes to the same pixels', () => {
    const png = new PNG({ width: W, height: H });
    png.data = Buffer.from(rgba);
    const bytes = new Uint8Array(PNG.sync.write(png));
    const out = injectMetadata(bytes, 'png');
    expect(readPngText(out).Software).toBe(CREDIT);
    const back = PNG.sync.read(Buffer.from(out));
    expect([back.width, back.height]).toEqual([W, H]);
    expect(Buffer.compare(back.data, Buffer.from(rgba))).toBe(0);
  });
  it('JPEG: EXIF Software and XMP after the JFIF header, and it still decodes', () => {
    const bytes = new Uint8Array(jpeg.encode({ width: W, height: H, data: Buffer.from(rgba) }, 90).data);
    const out = injectMetadata(bytes, 'jpeg');
    expect(readJpegSoftware(out)).toBe(CREDIT);
    expect(readJpegXmp(out)).toContain(CREDIT);
    if (bytes[3] === 0xe0) expect(out[3]).toBe(0xe0);
    const dec = jpeg.decode(Buffer.from(out), { useTArray: true }), plain = jpeg.decode(Buffer.from(bytes), { useTArray: true });
    expect([dec.width, dec.height]).toEqual([W, H]);
    expect(Buffer.compare(Buffer.from(dec.data), Buffer.from(plain.data))).toBe(0);
  });
  it('WebP (real files from Chrome): XMP chunk, VP8X header, sizes and alpha intact', () => {
    expect(Object.keys(samples).length).toBeGreaterThanOrEqual(3);
    for (const [name, b64] of Object.entries(samples)) {
      const bytes = new Uint8Array(Buffer.from(b64, 'base64')), before = webpInfo(bytes);
      const out = injectMetadata(bytes, 'webp'), info = webpInfo(out);
      expect(info.chunks[0], name).toBe('VP8X'); expect(info.flags & 0x04, name).toBe(4); expect(info.xmp, name).toContain(CREDIT);
      expect([info.width, info.height], name).toEqual([before.width, before.height]); expect(info.alpha, name).toBe(before.alpha);
      expect(out.length, name).toBe(8 + new DataView(out.buffer, out.byteOffset).getUint32(4, true));
      expect(out.length % 2, name).toBe(0);
      expect(webpInfo(injectMetadata(out, 'webp')).chunks.filter((c) => c === 'XMP ').length, name).toBe(1);
    }
  });
  it('PSD: the credit is in the XMP file info', () => {
    const psd = readPsd(writePsdDocument(createDocument(4, 4)) as never, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true } as never) as { imageResources?: { xmpMetadata?: string } };
    expect(psd.imageResources?.xmpMetadata).toContain(CREDIT);
  });
});
