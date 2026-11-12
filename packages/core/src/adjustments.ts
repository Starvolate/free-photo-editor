// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Colour adjustments, pixel by pixel. Alpha is kept as it is. */
import { clamp } from './geometry';
import { hslToRgbInto, rgbToHslInto } from './color';

export type AdjustKind = 'brightness-contrast' | 'hue-saturation' | 'invert' | 'black-white';
export interface AdjustParams { brightness?: number; contrast?: number; hue?: number; saturation?: number; lightness?: number; }
export const ADJUST_LABELS: Record<AdjustKind, string> = {
  'brightness-contrast': 'Brightness and contrast', 'hue-saturation': 'Hue and saturation', invert: 'Invert', 'black-white': 'Black and white',
};
/** Brightness and contrast as a 256-entry lookup table; both run from -100 to 100. */
export function brightnessContrastLut(brightness: number, contrast: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const b = clamp(brightness, -100, 100) * 1.28, c = clamp(contrast, -100, 100) * 1.28;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  for (let v = 0; v < 256; v++) lut[v] = f * (v + b - 128) + 128;
  return lut;
}
export function adjust(src: Uint8ClampedArray, kind: AdjustKind, p: AdjustParams = {}, out: Uint8ClampedArray = new Uint8ClampedArray(src.length)): Uint8ClampedArray {
  const n = src.length;
  if (kind === 'invert') {
    for (let i = 0; i < n; i += 4) { out[i] = 255 - src[i]; out[i + 1] = 255 - src[i + 1]; out[i + 2] = 255 - src[i + 2]; out[i + 3] = src[i + 3]; }
    return out;
  }
  if (kind === 'black-white') {
    for (let i = 0; i < n; i += 4) {
      const g = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      out[i] = g; out[i + 1] = g; out[i + 2] = g; out[i + 3] = src[i + 3];
    }
    return out;
  }
  if (kind === 'brightness-contrast') {
    const lut = brightnessContrastLut(p.brightness ?? 0, p.contrast ?? 0);
    for (let i = 0; i < n; i += 4) { out[i] = lut[src[i]]; out[i + 1] = lut[src[i + 1]]; out[i + 2] = lut[src[i + 2]]; out[i + 3] = src[i + 3]; }
    return out;
  }
  const dh = clamp(p.hue ?? 0, -180, 180) / 360, ds = clamp(p.saturation ?? 0, -100, 100) / 100, dl = clamp(p.lightness ?? 0, -100, 100) / 100;
  if (!dh && !ds && !dl) { out.set(src); return out; }
  const t = new Float64Array(3);
  for (let i = 0; i < n; i += 4) {
    rgbToHslInto(src[i] / 255, src[i + 1] / 255, src[i + 2] / 255, t);
    let h = t[0] + dh;
    h -= Math.floor(h);
    const s = clamp(t[1] * (1 + ds), 0, 1);
    const l = dl >= 0 ? t[2] + (1 - t[2]) * dl : t[2] * (1 + dl);
    hslToRgbInto(h, s, l, t);
    out[i] = t[0] * 255; out[i + 1] = t[1] * 255; out[i + 2] = t[2] * 255; out[i + 3] = src[i + 3];
  }
  return out;
}
