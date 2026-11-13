// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The steps around each model, with no browser and no model inside, so they are tested on their own with a tiny stand-in
 * model: pictures into model inputs, model answers into masks and pictures, tiles for big pictures, and a filled area
 * blended back in with soft edges.
 */
export interface Rgba { width: number; height: number; data: Uint8ClampedArray; }
export interface Box { x: number; y: number; w: number; h: number; }
const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * The picture at tw x th as three planes (red, green, blue) of values from 0 to 1. See-through pixels count as white.
 * Shrinking averages every pixel under each new one; enlarging blends the four nearest.
 */
export function toPlanes(src: Rgba, tw: number, th: number): Float32Array {
  const { width: w, height: h, data: s } = src, n = tw * th, out = new Float32Array(3 * n);
  const px = (i: number, c: number): number => (s[i + c] * s[i + 3] + 255 * (255 - s[i + 3])) / 65025;
  if (tw <= w && th <= h) {
    for (let y = 0; y < th; y++) {
      const y0 = Math.floor((y * h) / th), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / th));
      for (let x = 0; x < tw; x++) {
        const x0 = Math.floor((x * w) / tw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / tw));
        let r = 0, g = 0, b = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * w + xx) * 4; r += px(i, 0); g += px(i, 1); b += px(i, 2); }
        const k = 1 / ((y1 - y0) * (x1 - x0)), o = y * tw + x;
        out[o] = r * k; out[n + o] = g * k; out[2 * n + o] = b * k;
      }
    }
    return out;
  }
  for (let y = 0; y < th; y++) {
    const sy = clampN(((y + 0.5) * h) / th - 0.5, 0, h - 1), y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < tw; x++) {
      const sx = clampN(((x + 0.5) * w) / tw - 0.5, 0, w - 1), x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0, o = y * tw + x;
      for (let c = 0; c < 3; c++) {
        const top = px((y0 * w + x0) * 4, c) * (1 - fx) + px((y0 * w + x1) * 4, c) * fx, bot = px((y1 * w + x0) * 4, c) * (1 - fx) + px((y1 * w + x1) * 4, c) * fx;
        out[c * n + o] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return out;
}
export const IMAGENET_MEAN = [0.485, 0.456, 0.406], IMAGENET_STD = [0.229, 0.224, 0.225];
/** The subject model's input (U²-Net): size x size planes, divided by their brightest value as its authors do, then set against the ImageNet mean and spread. */
export function maskInput(src: Rgba, size: number): Float32Array {
  const p = toPlanes(src, size, size), n = size * size;
  let mx = 0;
  for (let i = 0; i < p.length; i++) if (p[i] > mx) mx = p[i];
  const k = mx > 0 ? 1 / mx : 1;
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) p[c * n + i] = (p[c * n + i] * k - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
  return p;
}
/** The subject model's answer (pw x ph, about 0 to 1) as a w x h mask from 0 to 255: stretched to the full range, then enlarged smoothly. No clear subject gives an empty mask. */
export function maskFromPrediction(pred: ArrayLike<number>, pw: number, ph: number, w: number, h: number): Uint8Array {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pw * ph; i++) { const v = pred[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const out = new Uint8Array(w * h);
  if (!(hi - lo >= 0.05)) return out;
  const k = 255 / (hi - lo);
  for (let y = 0; y < h; y++) {
    const sy = clampN(((y + 0.5) * ph) / h - 0.5, 0, ph - 1), y0 = Math.floor(sy), y1 = Math.min(ph - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = clampN(((x + 0.5) * pw) / w - 0.5, 0, pw - 1), x0 = Math.floor(sx), x1 = Math.min(pw - 1, x0 + 1), fx = sx - x0;
      const v = (pred[y0 * pw + x0] * (1 - fx) + pred[y0 * pw + x1] * fx) * (1 - fy) + (pred[y1 * pw + x0] * (1 - fx) + pred[y1 * pw + x1] * fx) * fy;
      out[y * w + x] = Math.round(clampN((v - lo) * k, 0, 255));
    }
  }
  return out;
}

/** A tile: the part it fills, and `read`, the bigger part fed to the model so the tile's edges have context. */
export interface Tile extends Box { read: Box; }
/** Cut a w x h picture into tiles of at most `size` a side, each read with up to `pad` pixels of context around it. */
export function planTiles(w: number, h: number, size: number, pad: number): Tile[] {
  const out: Tile[] = [];
  for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
    const tw = Math.min(size, w - x), th = Math.min(size, h - y), rx = Math.max(0, x - pad), ry = Math.max(0, y - pad);
    out.push({ x, y, w: tw, h: th, read: { x: rx, y: ry, w: Math.min(w, x + tw + pad) - rx, h: Math.min(h, y + th + pad) - ry } });
  }
  return out;
}
/** A super-resolution model: colour planes (0 to 1) of a w x h tile in, the planes of the bigger tile out. */
export type Run = (planes: Float32Array, w: number, h: number) => Promise<ArrayLike<number>>;
export interface TileOpts { tile?: number; pad?: number; onTile?: (done: number, total: number) => void; }
/**
 * Make a picture `scale` times bigger, tile by tile. Colours go through the model; the see-through channel is enlarged
 * smoothly. Each tile keeps only its own middle, so neighbouring tiles meet without seams.
 */
export async function upscaleTiled(src: Rgba, scale: number, run: Run, o: TileOpts = {}): Promise<Rgba> {
  const { width: w, height: h, data: s } = src, W = w * scale, H = h * scale, out = new Uint8ClampedArray(W * H * 4);
  const tiles = planTiles(w, h, o.tile ?? 192, o.pad ?? 12);
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k], r = t.read, n = r.w * r.h, planes = new Float32Array(3 * n);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) * w + r.x + x) * 4, j = y * r.w + x;
      planes[j] = s[i] / 255; planes[n + j] = s[i + 1] / 255; planes[2 * n + j] = s[i + 2] / 255;
    }
    const res = await run(planes, r.w, r.h), rw = r.w * scale, rn = rw * r.h * scale;
    if (res.length !== 3 * rn) throw new Error('The model gave an answer of the wrong size.');
    const ox = (t.x - r.x) * scale, oy = (t.y - r.y) * scale;
    for (let y = 0; y < t.h * scale; y++) for (let x = 0; x < t.w * scale; x++) {
      const q = (oy + y) * rw + ox + x, d = ((t.y * scale + y) * W + t.x * scale + x) * 4;
      out[d] = res[q] * 255; out[d + 1] = res[rn + q] * 255; out[d + 2] = res[2 * rn + q] * 255;
    }
    o.onTile?.(k + 1, tiles.length);
  }
  enlargeAlpha(src, out, scale);
  return { width: W, height: H, data: out };
}
function enlargeAlpha(src: Rgba, out: Uint8ClampedArray, scale: number): void {
  const { width: w, height: h, data: s } = src, W = w * scale, H = h * scale;
  let opaque = true;
  for (let i = 3; i < s.length; i += 4) if (s[i] !== 255) { opaque = false; break; }
  if (opaque) { for (let i = 3; i < out.length; i += 4) out[i] = 255; return; }
  for (let y = 0; y < H; y++) {
    const sy = clampN((y + 0.5) / scale - 0.5, 0, h - 1), y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = clampN((x + 0.5) / scale - 0.5, 0, w - 1), x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      out[(y * W + x) * 4 + 3] = (s[(y0 * w + x0) * 4 + 3] * (1 - fx) + s[(y0 * w + x1) * 4 + 3] * fx) * (1 - fy) + (s[(y1 * w + x0) * 4 + 3] * (1 - fx) + s[(y1 * w + x1) * 4 + 3] * fx) * fy;
    }
  }
}
/** Half the width and height: each new pixel is the average of four, weighted by how solid each one is. */
export function halve(src: Rgba): Rgba {
  const { width: w, height: h, data: s } = src, W = Math.max(1, w >> 1), H = Math.max(1, h >> 1), out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = (Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)) * 4, al = s[i + 3];
      r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al;
    }
    const d = (y * W + x) * 4;
    if (a > 0) { out[d] = r / a; out[d + 1] = g / a; out[d + 2] = b / a; }
    out[d + 3] = a / 4;
  }
  return { width: W, height: H, data: out };
}

/** The part of the picture the fill model looks at: the painted box, widened on every side by at least `min` pixels or three quarters of its size. */
export function contextBox(b: Box, w: number, h: number, min = 96): Box {
  const m = Math.max(min, Math.round(Math.max(b.w, b.h) * 0.75));
  const x0 = Math.max(0, b.x - m), y0 = Math.max(0, b.y - m), x1 = Math.min(w, b.x + b.w + m), y1 = Math.min(h, b.y + b.h + m);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** The fill model's inputs (MI-GAN): colour planes as bytes, and a mask where 255 keeps a pixel and 0 asks for it to be filled. */
export function inpaintInputs(src: Rgba, hole: ArrayLike<number>): { image: Uint8Array; keep: Uint8Array } {
  const n = src.width * src.height, image = new Uint8Array(3 * n), keep = new Uint8Array(n), s = src.data;
  for (let i = 0; i < n; i++) { const j = i * 4; image[i] = s[j]; image[n + i] = s[j + 1]; image[2 * n + i] = s[j + 2]; keep[i] = hole[i] > 0 ? 0 : 255; }
  return { image, keep };
}
/** Put a filled area back: where `soft` is 255 the model's colours, where 0 the original, in between a mix. Filled pixels become solid. */
export function blendFill(orig: Rgba, fill: ArrayLike<number>, soft: ArrayLike<number>): Uint8ClampedArray {
  const n = orig.width * orig.height, s = orig.data, out = new Uint8ClampedArray(s);
  for (let i = 0; i < n; i++) {
    const m = soft[i];
    if (!m) continue;
    const k = m / 255, j = i * 4;
    out[j] = s[j] + (fill[i] - s[j]) * k; out[j + 1] = s[j + 1] + (fill[n + i] - s[j + 1]) * k; out[j + 2] = s[j + 2] + (fill[2 * n + i] - s[j + 2]) * k;
    out[j + 3] = s[j + 3] + (255 - s[j + 3]) * k;
  }
  return out;
}
/** Only the filled area, as its own see-through layer: the model's colours, solid where `soft` is 255. */
export function fillOnly(fill: ArrayLike<number>, soft: ArrayLike<number>, n: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const j = i * 4; out[j] = fill[i]; out[j + 1] = fill[n + i]; out[j + 2] = fill[2 * n + i]; out[j + 3] = soft[i]; }
  return out;
}
