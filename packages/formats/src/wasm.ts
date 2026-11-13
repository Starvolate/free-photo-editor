// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/// <reference path="./ambient.d.ts" />
/**
 * AVIF and JPEG XL through jSquash's WebAssembly codecs (Apache-2.0; libavif and libjxl, BSD), and HEIC/HEIF through
 * libheif-js (LGPL-3.0; libde265, LGPL-3.0). Each library loads only when its format is first used. The browser's own
 * decoder is tried first, so Safari opens HEIC and JPEG XL without any download.
 */
import { CREDIT, buildXmp, concatBytes, flatten, latin1Decode, latin1Encode, utf8Encode, type Bitmap, type Decoded, type FormatCodec, type FormatHost } from '@free-photoeditor/core';
import { docOf, isoBox } from './util';

const asImageData = (b: Bitmap): ImageData => ({ data: b.data, width: b.width, height: b.height, colorSpace: 'srgb' }) as unknown as ImageData;
const one = (bmp: Bitmap, notes: string[] = []): Decoded => ({ doc: docOf(bmp.width, bmp.height, [{ name: 'Background', bmp }]), notes });
async function native(bytes: Uint8Array, mime: string, host: FormatHost): Promise<Bitmap | null> {
  if (!host.decodeStill) return null;
  try { return await host.decodeStill(bytes, mime); } catch { return null; }
}
const fromImageData = (d: ImageData | null | undefined, what: string): Bitmap => {
  if (!d || !d.width) throw new Error(`This ${what} file couldn't be read.`);
  return { width: d.width, height: d.height, data: d.data };
};

export async function encodeAvif(bmp: Bitmap, quality: number): Promise<Uint8Array> {
  const { default: encode } = await import('@jsquash/avif/encode.js');
  return new Uint8Array(await encode(asImageData(bmp), quality >= 1 ? { lossless: true } : { quality: Math.round(quality * 100), speed: 6 }));
}
export const avifCodec: FormatCodec = {
  async decode(bytes, host) {
    const bmp = await native(bytes, 'image/avif', host);
    if (bmp) return one(bmp);
    const { default: decode } = await import('@jsquash/avif/decode.js');
    return one(fromImageData(await decode(bytes.slice().buffer), 'AVIF'));
  },
  encode: async (doc, o) => encodeAvif(flatten(doc), o.quality),
};

export interface IsoBoxInfo { type: string; start: number; end: number; }
export function isoBoxes(b: Uint8Array): IsoBoxInfo[] {
  const out: IsoBoxInfo[] = [], dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let p = 0; p + 8 <= b.length; ) {
    let size = dv.getUint32(p);
    if (size === 1 && p + 16 <= b.length) size = Number(dv.getBigUint64(p + 8));
    else if (size === 0) size = b.length - p;
    if (size < 8) break;
    out.push({ type: latin1Decode(b, p + 4, p + 8), start: p, end: Math.min(b.length, p + size) });
    p += size;
  }
  return out;
}
const JXL_SIG = new Uint8Array([0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
/** Put the credit (XMP, in an "xml " box) into a JPEG XL file, wrapping a bare codestream in the container. */
export function withJxlCredit(b: Uint8Array, credit: string = CREDIT): Uint8Array {
  const xml = isoBox('xml ', utf8Encode(buildXmp(credit)));
  if (b[0] === 0xff && b[1] === 0x0a) return concatBytes(JXL_SIG, isoBox('ftyp', concatBytes(latin1Encode('jxl '), new Uint8Array(4), latin1Encode('jxl '))), xml, isoBox('jxlc', b));
  const ft = isoBoxes(b).find((x) => x.type === 'ftyp');
  return ft ? concatBytes(b.subarray(0, ft.end), xml, b.subarray(ft.end)) : b;
}
export async function encodeJxl(bmp: Bitmap, quality: number): Promise<Uint8Array> {
  const { default: encode } = await import('@jsquash/jxl/encode.js');
  return withJxlCredit(new Uint8Array(await encode(asImageData(bmp), quality >= 1 ? { lossless: true } : { quality: Math.round(quality * 100), effort: 7 })));
}
export const jxlCodec: FormatCodec = {
  async decode(bytes, host) {
    const bmp = await native(bytes, 'image/jxl', host);
    if (bmp) return one(bmp);
    const { default: decode } = await import('@jsquash/jxl/decode.js');
    return one(fromImageData(await decode(bytes.slice().buffer), 'JPEG XL'));
  },
  encode: async (doc, o) => encodeJxl(flatten(doc), o.quality),
};

interface HeifImage {
  get_width(): number; get_height(): number; is_primary?(): boolean; free?(): void;
  display(img: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: { data: Uint8ClampedArray } | null) => void): void;
}
interface HeifLib { HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } }
export const heicCodec: FormatCodec = {
  async decode(bytes, host) {
    const bmp = await native(bytes, 'image/heic', host);
    if (bmp) return one(bmp);
    const factory = (await import('libheif-js/libheif-wasm/libheif-bundle.mjs')).default;
    const lib = (await Promise.resolve(factory())) as HeifLib;
    const images = new lib.HeifDecoder().decode(bytes);
    if (!images || !images.length) throw new Error("This HEIC file couldn't be read.");
    const im = images.find((i) => i.is_primary?.()) ?? images[0], w = im.get_width(), h = im.get_height();
    const data = await new Promise<Uint8ClampedArray>((res, rej) => im.display({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h },
      (d) => (d ? res(d.data) : rej(new Error("This HEIC file couldn't be read.")))));
    for (const i of images) i.free?.();
    return one({ width: w, height: h, data }, images.length > 1 ? ['This file holds more than one picture; the main one was opened.'] : []);
  },
};
