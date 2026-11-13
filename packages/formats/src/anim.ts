// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/// <reference path="./ambient.d.ts" />
/**
 * Moving pictures, written for Free Photo Editor: animated GIF, moving PNG (APNG) and moving WebP open with every frame
 * as a layer, and any picture saves as an animation with one frame per layer. GIF colours are reduced by gifenc (MIT);
 * WebP frames are packed by the browser's own WebP encoder and joined into one file here.
 */
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { CREDIT, buildXmp, concatBytes, latin1Decode, latin1Encode, makePngChunk, pngChunks, utf8Encode, webpChunks, type Bitmap, type Decoded, type FormatCodec, type FormatHost } from '@free-photoeditor/core';
import { PNG_SIG, be32, creditChunk, decodePngData, ihdr, pngPayload, readPngHead } from './png';
import { blit, clearRect, docFromFrames, framesOf, isOpaque, riff, startsWith, type Frame } from './util';

export interface Movie { width: number; height: number; frames: { bmp: Bitmap; delay: number }[]; }

function lzwGif(min: number, data: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count), prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4098);
  const clear = 1 << min, eoi = clear + 1;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = min + 1, mask = (1 << size) - 1, avail = clear + 2, old = -1, first = 0, datum = 0, bits = 0, op = 0;
  for (let i = 0; i < data.length && op < count; i++) {
    datum |= data[i] << bits; bits += 8;
    while (bits >= size && op < count) {
      let code = datum & mask;
      datum >>>= size; bits -= size;
      if (code === clear) { size = min + 1; mask = (1 << size) - 1; avail = clear + 2; old = -1; continue; }
      if (code === eoi) return out;
      if (old === -1) { out[op++] = suffix[code]; old = code; first = suffix[code]; continue; }
      const inCode = code;
      let sp = 0;
      if (code >= avail) { stack[sp++] = first; code = old; }
      while (code >= clear && sp < 4096) { stack[sp++] = suffix[code]; code = prefix[code]; }
      first = suffix[code];
      stack[sp++] = first;
      if (avail < 4096) { prefix[avail] = old; suffix[avail] = first; avail++; if ((avail & mask) === 0 && avail < 4096) { size++; mask += avail; } }
      old = inCode;
      while (sp > 0 && op < count) out[op++] = stack[--sp];
    }
  }
  return out;
}
export function decodeGif(b: Uint8Array): Movie {
  const sig = latin1Decode(b, 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('This is not a GIF file.');
  const W = b[6] | (b[7] << 8), H = b[8] | (b[9] << 8), packed = b[10];
  if (!W || !H) throw new Error('This GIF has no size.');
  let p = 13, gct: Uint8Array | null = null;
  if (packed & 0x80) { const n = 3 << ((packed & 7) + 1); gct = b.subarray(p, p + n); p += n; }
  const canvas = new Uint8ClampedArray(W * H * 4), frames: Movie['frames'] = [];
  let delay = 0, disposal = 0, tIndex = -1;
  const skip = (): void => { while (p < b.length) { const n = b[p++]; if (!n) break; p += n; } };
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xf9 && b[p] >= 4) { const f = b[p + 1]; disposal = (f >> 2) & 7; delay = (b[p + 2] | (b[p + 3] << 8)) * 10; tIndex = f & 1 ? b[p + 4] : -1; }
      skip();
      continue;
    }
    if (t !== 0x2c) break;
    const fx = b[p] | (b[p + 1] << 8), fy = b[p + 2] | (b[p + 3] << 8), fw = b[p + 4] | (b[p + 5] << 8), fh = b[p + 6] | (b[p + 7] << 8), fp = b[p + 8];
    p += 9;
    let ct = gct;
    if (fp & 0x80) { const n = 3 << ((fp & 7) + 1); ct = b.subarray(p, p + n); p += n; }
    const min = b[p++], parts: Uint8Array[] = [];
    while (p < b.length) { const n = b[p++]; if (!n) break; parts.push(b.subarray(p, p + n)); p += n; }
    const idx = lzwGif(Math.max(2, Math.min(11, min)), concatBytes(...parts), fw * fh), rows: number[] = [];
    if (fp & 0x40) { for (const [s, st] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = s; y < fh; y += st) rows.push(y); }
    else for (let y = 0; y < fh; y++) rows.push(y);
    const saved = disposal === 3 ? canvas.slice() : null;
    for (let r = 0; r < fh; r++) {
      const y = fy + rows[r];
      if (y >= H) continue;
      for (let x = 0; x < fw; x++) {
        const xx = fx + x, k = idx[r * fw + x];
        if (xx >= W || k === tIndex || !ct || k * 3 + 2 >= ct.length) continue;
        const o = (y * W + xx) * 4;
        canvas[o] = ct[k * 3]; canvas[o + 1] = ct[k * 3 + 1]; canvas[o + 2] = ct[k * 3 + 2]; canvas[o + 3] = 255;
      }
    }
    frames.push({ bmp: { width: W, height: H, data: canvas.slice() }, delay: delay || 100 });
    if (disposal === 2) clearRect(canvas, W, H, fx, fy, fw, fh); else if (saved) canvas.set(saved);
    delay = 0; disposal = 0; tIndex = -1;
  }
  if (!frames.length) throw new Error('This GIF has no pictures in it.');
  return { width: W, height: H, frames };
}
/**
 * A GIF (moving when there is more than one frame) with the credit in a comment block. `loop` is how many times it plays
 * (0 = forever): once means no loop block at all; n times writes n - 1 repeats, as browsers play the first time plus the repeats.
 */
export function encodeGif(frames: Frame[], credit: string = CREDIT, loop = 0): Uint8Array {
  const gif = GIFEncoder(), many = frames.length > 1;
  for (const f of frames) {
    const rgba = new Uint8Array(f.bmp.data.buffer, f.bmp.data.byteOffset, f.bmp.data.length);
    const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(rgba, palette, 'rgba4444'), ti = palette.findIndex((c) => c[3] === 0);
    gif.writeFrame(index, f.bmp.width, f.bmp.height, { palette, delay: Math.round(f.delay), repeat: many ? (loop > 0 ? loop - 1 || -1 : 0) : -1, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: many && ti >= 0 ? 2 : -1 });
  }
  gif.finish();
  const out = gif.bytes(), text = latin1Encode(credit), blocks: Uint8Array[] = [new Uint8Array([0x21, 0xfe])];
  for (let i = 0; i < text.length; i += 255) blocks.push(new Uint8Array([Math.min(255, text.length - i)]), text.subarray(i, i + 255));
  return concatBytes(out.subarray(0, out.length - 1), ...blocks, new Uint8Array([0, 0x3b]));
}
export function isApng(b: Uint8Array): boolean {
  if (!startsWith(b, PNG_SIG)) return false;
  for (let p = 8; p + 8 <= b.length; ) {
    const len = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0, t = latin1Decode(b, p + 4, p + 8);
    if (t === 'acTL') return true;
    if (t === 'IDAT') return false;
    p += 12 + len;
  }
  return false;
}
export function decodeApng(b: Uint8Array): Movie {
  const hd = readPngHead(b), frames: { fc: DataView; data: Uint8Array[] }[] = [];
  let cur: { fc: DataView; data: Uint8Array[] } | null = null;
  for (const c of pngChunks(b)) {
    const d = b.subarray(c.dataStart, c.dataStart + c.length);
    if (c.type === 'fcTL') { cur = { fc: new DataView(d.buffer, d.byteOffset, d.byteLength), data: [] }; frames.push(cur); }
    else if (c.type === 'IDAT') { if (cur && frames.length === 1) cur.data.push(d); }
    else if (c.type === 'fdAT' && cur) cur.data.push(d.subarray(4));
  }
  const W = hd.width, H = hd.height;
  if (!frames.length) return { width: W, height: H, frames: [{ bmp: decodePngData(hd, hd.idat), delay: 100 }] };
  const canvas = new Uint8ClampedArray(W * H * 4), out: Movie['frames'] = [];
  frames.forEach((f, i) => {
    const w = f.fc.getUint32(4), h = f.fc.getUint32(8), x = f.fc.getUint32(12), y = f.fc.getUint32(16);
    const num = f.fc.getUint16(20), den = f.fc.getUint16(22) || 100, blend = f.fc.getUint8(25);
    let dispose = f.fc.getUint8(24);
    if (i === 0 && dispose === 2) dispose = 1;
    const img = decodePngData({ ...hd, width: w, height: h }, concatBytes(...f.data));
    const saved = dispose === 2 ? canvas.slice() : null;
    blit(canvas, W, H, img, x, y, blend === 1);
    out.push({ bmp: { width: W, height: H, data: canvas.slice() }, delay: num ? Math.max(10, Math.round((num * 1000) / den)) : 100 });
    if (dispose === 1) clearRect(canvas, W, H, x, y, w, h); else if (saved) canvas.set(saved);
  });
  return { width: W, height: H, frames: out };
}
/** A moving PNG: one full frame per layer, with the credit in a Software text chunk. `loop`: how many times it plays (0 = forever). */
export function encodeApng(frames: Frame[], credit: string = CREDIT, loop = 0): Uint8Array {
  const W = frames[0].bmp.width, H = frames[0].bmp.height, rgb = frames.every((f) => isOpaque(f.bmp.data)), actl = new Uint8Array(8);
  actl.set(be32(frames.length), 0);
  actl.set(be32(Math.max(0, loop)), 4);
  const parts: Uint8Array[] = [PNG_SIG, makePngChunk('IHDR', ihdr(W, H, 8, rgb ? 2 : 6)), makePngChunk('acTL', actl), creditChunk(credit)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fc = new Uint8Array(26), dv = new DataView(fc.buffer);
    dv.setUint32(0, seq++); dv.setUint32(4, W); dv.setUint32(8, H); dv.setUint16(20, Math.min(65535, Math.round(f.delay))); dv.setUint16(22, 1000);
    parts.push(makePngChunk('fcTL', fc));
    const z = pngPayload(f.bmp, rgb);
    parts.push(i === 0 ? makePngChunk('IDAT', z) : makePngChunk('fdAT', concatBytes(be32(seq++), z)));
  });
  parts.push(makePngChunk('IEND', new Uint8Array(0)));
  return concatBytes(...parts);
}
const u24 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const put24 = (b: Uint8Array, o: number, v: number): void => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; };
export const isAnimatedWebp = (b: Uint8Array): boolean => startsWith(b, 'RIFF') && startsWith(b, 'WEBPVP8X', 8) && (b[20] & 0x02) !== 0;
function stillWebp(parts: Uint8Array[]): Uint8Array {
  const content = concatBytes(latin1Encode('WEBP'), ...parts), out = concatBytes(latin1Encode('RIFF'), new Uint8Array(4), content);
  new DataView(out.buffer).setUint32(4, content.length, true);
  return out;
}
export async function decodeAnimatedWebp(b: Uint8Array, host: FormatHost): Promise<Movie> {
  if (!host.decodeStill) throw new Error("This browser can't read WebP frames.");
  const chunks = webpChunks(b), x = chunks.find((c) => c.fourcc === 'VP8X');
  if (!x) throw new Error('This WebP file has no header.');
  const W = 1 + u24(b, x.dataStart + 4), H = 1 + u24(b, x.dataStart + 7), canvas = new Uint8ClampedArray(W * H * 4), out: Movie['frames'] = [];
  for (const c of chunks) {
    if (c.fourcc !== 'ANMF') continue;
    const d = c.dataStart, fx = 2 * u24(b, d), fy = 2 * u24(b, d + 3), fw = 1 + u24(b, d + 6), fh = 1 + u24(b, d + 9), dur = u24(b, d + 12), flags = b[d + 15];
    const inner: { fourcc: string; data: Uint8Array }[] = [];
    for (let p = d + 16; p + 8 <= d + c.size; ) {
      const size = (b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24)) >>> 0;
      inner.push({ fourcc: latin1Decode(b, p, p + 4), data: b.subarray(p + 8, p + 8 + size) });
      p += 8 + size + (size & 1);
    }
    const alph = inner.find((i) => i.fourcc === 'ALPH'), img = inner.find((i) => i.fourcc === 'VP8 ' || i.fourcc === 'VP8L');
    if (!img) continue;
    let parts: Uint8Array[] = [riff(img.fourcc, img.data)];
    if (alph) { const hx = new Uint8Array(10); hx[0] = 0x10; put24(hx, 4, fw - 1); put24(hx, 7, fh - 1); parts = [riff('VP8X', hx), riff('ALPH', alph.data), ...parts]; }
    const bmp = await host.decodeStill(stillWebp(parts), 'image/webp');
    blit(canvas, W, H, bmp, fx, fy, !(flags & 0x02));
    out.push({ bmp: { width: W, height: H, data: canvas.slice() }, delay: dur || 100 });
    if (flags & 0x01) clearRect(canvas, W, H, fx, fy, fw, fh);
  }
  if (!out.length) throw new Error('This WebP file has no frames this editor can read.');
  return { width: W, height: H, frames: out };
}
/** A moving WebP: each frame made by the host's WebP encoder, joined here, with the credit in XMP. `loop`: how many times it plays (0 = forever). */
export async function encodeAnimatedWebp(frames: Frame[], quality: number, host: FormatHost, credit: string = CREDIT, loop = 0): Promise<Uint8Array> {
  if (!host.encodeStill) throw new Error("This browser can't make WebP files.");
  const W = frames[0].bmp.width, H = frames[0].bmp.height, anmf: Uint8Array[] = [];
  let alpha = false;
  for (const f of frames) {
    if (!isOpaque(f.bmp.data)) alpha = true;
    const still = await host.encodeStill(f.bmp, 'image/webp', quality);
    const keep = webpChunks(still).filter((c) => c.fourcc === 'ALPH' || c.fourcc === 'VP8 ' || c.fourcc === 'VP8L');
    if (!keep.length) throw new Error("This browser's WebP frame could not be read.");
    const head = new Uint8Array(16);
    put24(head, 6, f.bmp.width - 1); put24(head, 9, f.bmp.height - 1); put24(head, 12, Math.min(0xffffff, Math.round(f.delay))); head[15] = 0x02;
    anmf.push(riff('ANMF', concatBytes(head, ...keep.map((c) => riff(c.fourcc, still.subarray(c.dataStart, c.dataStart + c.size))))));
  }
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02 | 0x04 | (alpha ? 0x10 : 0); put24(vp8x, 4, W - 1); put24(vp8x, 7, H - 1);
  return stillWebp([riff('VP8X', vp8x), riff('ANIM', new Uint8Array([0, 0, 0, 0, loop & 255, (loop >> 8) & 255])), ...anmf, riff('XMP ', utf8Encode(buildXmp(credit)))]);
}
const movieDoc = (m: Movie): Decoded => ({ doc: docFromFrames(m.width, m.height, m.frames),
  notes: m.frames.length > 1 ? [`Each of the ${m.frames.length} frames opened as its own layer; frame 1 shows. Turn the others on in Layers.`] : [] });
export const gifCodec: FormatCodec = { decode: async (b) => movieDoc(decodeGif(b)), encode: async (doc, o) => encodeGif(framesOf(doc, o.multi, o.delay), CREDIT, doc.loop) };
export const apngCodec: FormatCodec = { decode: async (b) => movieDoc(decodeApng(b)), encode: async (doc, o) => encodeApng(framesOf(doc, o.multi, o.delay), CREDIT, doc.loop) };
export const webpAnimCodec: FormatCodec = {
  decode: async (b, host) => movieDoc(await decodeAnimatedWebp(b, host)),
  encode: async (doc, o, host) => encodeAnimatedWebp(framesOf(doc, o.multi, o.delay), o.quality, host, CREDIT, doc.loop),
};
