// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Small fixtures made on the fly in a temporary folder, and a way to run the command line and keep what it says. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { Bitmap } from '@free-photoeditor/core';
import type { Io } from '../src/cli';

export const tempDir = (): string => mkdtempSync(path.join(os.tmpdir(), 'fpe-test-'));
/** A colourful test picture; some pixels are partly see-through. */
export function pattern(w: number, h: number, alpha = true): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    d[i] = (x * 37 + y * 11) & 255; d[i + 1] = (x * 5 + y * 23) & 255; d[i + 2] = (x * y * 3 + 40) & 255;
    d[i + 3] = alpha && (x + y) % 7 === 0 ? 96 + ((x * 13) & 127) : 255;
  }
  return d;
}
export function writePng(file: string, b: Bitmap): void {
  const png = new PNG({ width: b.width, height: b.height });
  png.data = Buffer.from(b.data);
  writeFileSync(file, PNG.sync.write(png));
}
export function readPng(file: string): Bitmap {
  const p = PNG.sync.read(readFileSync(file));
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
}
export const px = (b: Bitmap, x: number, y: number): number[] => Array.from(b.data.subarray((y * b.width + x) * 4, (y * b.width + x) * 4 + 4));
export function capture(cwd: string): { io: Io; out: string[]; err: string[]; text: () => string } {
  const out: string[] = [], err: string[] = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s), cwd }, out, err, text: () => [...out, ...err].join('\n') };
}
/** A 24-bit BMP file (bottom-up rows), written by hand. */
export function bmp24(b: Bitmap): Uint8Array {
  const { width: w, height: h } = b, stride = Math.ceil((w * 3) / 4) * 4, out = new Uint8Array(54 + stride * h), dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d; dv.setUint32(2, out.length, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = 54 + (h - 1 - y) * stride + x * 3, i = (y * w + x) * 4;
    out[o] = b.data[i + 2]; out[o + 1] = b.data[i + 1]; out[o + 2] = b.data[i];
  }
  return out;
}
/** An icon with one 32-bit entry (colours with alpha, then the 1-bit mask). */
export function ico32(b: Bitmap): Uint8Array {
  const { width: w, height: h } = b, ms = Math.ceil(w / 32) * 4, dib = 40 + w * h * 4 + ms * h, out = new Uint8Array(22 + dib), dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, 1, true); out[6] = w; out[7] = h; dv.setUint16(10, 1, true); dv.setUint16(12, 32, true);
  dv.setUint32(14, dib, true); dv.setUint32(18, 22, true);
  dv.setUint32(22, 40, true); dv.setInt32(26, w, true); dv.setInt32(30, h * 2, true); dv.setUint16(34, 1, true); dv.setUint16(36, 32, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = 62 + ((h - 1 - y) * w + x) * 4, i = (y * w + x) * 4;
    out[o] = b.data[i + 2]; out[o + 1] = b.data[i + 1]; out[o + 2] = b.data[i]; out[o + 3] = b.data[i + 3];
  }
  return out;
}
/** An icon whose one entry is a PNG file. */
export function icoPng(png: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(22 + png.length), dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, 1, true); out[6] = w; out[7] = h; dv.setUint16(10, 1, true); dv.setUint16(12, 32, true);
  dv.setUint32(14, png.length, true); dv.setUint32(18, 22, true); out.set(png, 22);
  return out;
}
