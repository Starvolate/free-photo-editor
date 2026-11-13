// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Camera RAW (DNG and the raw files of most cameras) through LibRaw compiled to WebAssembly (libraw-wasm, ISC; LibRaw
 * itself used under the LGPL-2.1), which runs in its own worker and loads only when a raw file is first opened. The
 * develop step (brightness, warm or cool, green or pink) is written for Free Photo Editor.
 */
import type { Bitmap, FormatCodec } from '@free-photoeditor/core';
import { docOf } from './util';

export interface RawImage { width: number; height: number; rgb: Uint8Array | Uint16Array; bits: number; colors: number; }
export async function decodeRaw(bytes: Uint8Array): Promise<RawImage> {
  const { default: LibRaw } = await import('libraw-wasm');
  const raw = new LibRaw();
  try {
    await raw.open(bytes.slice(), { useCameraWb: true, outputBps: 8 });
    const img = await raw.imageData();
    if (!img || !img.width || !img.height || !img.data) throw new Error("This camera file couldn't be read.");
    return { width: img.width, height: img.height, rgb: img.data, bits: img.bits || 8, colors: img.colors || 3 };
  } finally { raw.dispose(); }
}
export interface Develop { /** Stops of light, -3 to 3. */ exposure: number; /** -100 cooler to 100 warmer. */ warmth: number; /** -100 greener to 100 pinker. */ tint: number; }
export const NO_DEVELOP: Develop = { exposure: 0, warmth: 0, tint: 0 };
const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toScreen = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
/** The developed picture; `maxSide` makes a quick small preview. */
export function develop(img: RawImage, s: Develop, maxSide = 0): Bitmap {
  const big = Math.max(img.width, img.height), step = maxSide && big > maxSide ? big / maxSide : 1;
  const w = Math.max(1, Math.round(img.width / step)), h = Math.max(1, Math.round(img.height / step)), c = img.colors || 3;
  const k = 2 ** s.exposure, kr = k * (1 + (0.3 * s.warmth) / 100), kb = k * (1 - (0.3 * s.warmth) / 100), kg = k * (1 - (0.2 * s.tint) / 100);
  const max = img.bits > 8 ? 65535 : 255, lin = new Float32Array(max + 1), OUT = 4096, back = new Uint8Array(OUT + 1);
  for (let i = 0; i <= max; i++) lin[i] = toLinear(i / max);
  for (let i = 0; i <= OUT; i++) back[i] = Math.round(toScreen(i / OUT) * 255);
  const q = (v: number): number => back[v >= 1 ? OUT : v <= 0 ? 0 : Math.round(v * OUT)], out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y * step));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x * step)), i = (sy * img.width + sx) * c, o = (y * w + x) * 4;
      out[o] = q(lin[img.rgb[i]] * kr); out[o + 1] = q(lin[img.rgb[c > 1 ? i + 1 : i]] * kg); out[o + 2] = q(lin[img.rgb[c > 2 ? i + 2 : i]] * kb); out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}
export const codec: FormatCodec = {
  async decode(bytes) { const bmp = develop(await decodeRaw(bytes), NO_DEVELOP); return { doc: docOf(bmp.width, bmp.height, [{ name: 'Background', bmp }]), notes: [] }; },
};
