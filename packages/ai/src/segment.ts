// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Tap to select without the model: what goes into a Segment Anything style model and what comes out. A tap or a box in
 * picture pixels becomes the model's prompt, and the model's candidate masks become one picture-sized mask (0 or 255).
 * Four ONNX layouts exist for this family, and the model check (model-check/sam.check.ts) screened one of each, so all four
 * are written here; the worker uses the layout of the model it ships. Nothing here downloads or runs a model.
 */
import { IMAGENET_MEAN, IMAGENET_STD, toPlanes, type Box, type Rgba } from './process';

/**
 * `sam`: the Hugging Face SAM export (SlimSAM). `sam-onnx`: Meta's own SAM export, with the picture's scaling inside the
 * model (MobileSAM). `efficientsam`: EfficientSAM's own export. `sam2`: the Hugging Face SAM 2 export.
 */
export type SegLayout = 'sam' | 'sam-onnx' | 'efficientsam' | 'sam2';
/** A tap in picture pixels: `add` keeps what is under it, otherwise it is left out. */
export interface SegPoint { x: number; y: number; add: boolean; }
export interface SegPrompt { points: SegPoint[]; box?: Box | null; }
/** A model input before it becomes an ONNX Runtime tensor. */
export interface TensorSpec { type: 'float32' | 'int64'; data: Float32Array | BigInt64Array; dims: number[]; }
/** Which candidate mask to keep: the one the model rates best (its own default), or the largest (the whole object). */
export type SegPick = 'best' | 'largest';
/** The side of the square the family's image encoders work on. */
export const SEG_SIZE = 1024;

/** How the picture sits in the model's square: the scale from picture pixels on each axis, and the part of the square it fills. */
export function segFrame(layout: SegLayout, w: number, h: number): { sx: number; sy: number; rw: number; rh: number } {
  if (layout === 'sam2') return { sx: SEG_SIZE / w, sy: SEG_SIZE / h, rw: SEG_SIZE, rh: SEG_SIZE };
  if (layout === 'efficientsam') return { sx: 1, sy: 1, rw: w, rh: h };
  const s = SEG_SIZE / Math.max(w, h), rw = Math.max(1, Math.round(w * s)), rh = Math.max(1, Math.round(h * s));
  return { sx: rw / w, sy: rh / h, rw, rh };
}

/** The image encoder's input. See-through pixels count as white, as for the other AI tools. */
export function segEncoderInput(layout: SegLayout, src: Rgba): TensorSpec {
  const { width: w, height: h } = src, f = segFrame(layout, w, h);
  if (layout === 'efficientsam') return { type: 'float32', data: toPlanes(src, w, h), dims: [1, 3, h, w] };
  const p = toPlanes(src, f.rw, f.rh), n = f.rw * f.rh;
  if (layout === 'sam-onnx') {
    // Height x width x 3, from 0 to 255: the model sets them against its mean and pads to the square itself.
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = p[c * n + i] * 255;
    return { type: 'float32', data: out, dims: [f.rh, f.rw, 3] };
  }
  // Three planes set against the ImageNet mean and spread; for `sam` the rest of the square stays 0, its padding.
  const S = SEG_SIZE, N = S * S, out = new Float32Array(3 * N);
  for (let c = 0; c < 3; c++) {
    const m = IMAGENET_MEAN[c], sd = IMAGENET_STD[c];
    for (let y = 0; y < f.rh; y++) for (let x = 0; x < f.rw; x++) out[c * N + y * S + x] = (p[c * n + y * f.rw + x] - m) / sd;
  }
  return { type: 'float32', data: out, dims: [1, 3, S, S] };
}

const f32 = (a: number[]): Float32Array => new Float32Array(a);
const i64 = (a: number[]): BigInt64Array => BigInt64Array.from(a, (v) => BigInt(Math.round(v)));
/** The same values as another type, when a model's own description asks for int64 where float32 was written (or back). */
export function asType(t: TensorSpec, type: string | undefined): TensorSpec {
  if (!type || type === t.type) return t;
  if (type === 'int64') return { type: 'int64', data: i64(Array.from(t.data as ArrayLike<number | bigint>, Number)), dims: t.dims };
  if (type === 'float32') return { type: 'float32', data: f32(Array.from(t.data as ArrayLike<number | bigint>, Number)), dims: t.dims };
  return t;
}

/**
 * The prompt decoder's inputs (without the image embeddings), by input name. A box goes in as its two corners where the
 * layout takes them (labels 2 and 3); the `sam` export takes no box, so a box adds a tap at its middle there and the
 * answer is cut to the box afterwards (`segMask`'s `clip`).
 */
export function segPromptFeeds(layout: SegLayout, prompt: SegPrompt, w: number, h: number): Record<string, TensorSpec> {
  const f = segFrame(layout, w, h), b = prompt.box ?? null;
  const pts = prompt.points.map((p) => [p.x * f.sx, p.y * f.sy, p.add ? 1 : 0]);
  const corners = b ? [[b.x * f.sx, b.y * f.sy, 2], [(b.x + b.w) * f.sx, (b.y + b.h) * f.sy, 3]] : [];
  const xy = (a: number[][]): Float32Array => f32(a.flatMap((p) => [p[0], p[1]])), lab = (a: number[][]): number[] => a.map((p) => p[2]);
  if (layout === 'sam' || layout === 'sam2') {
    const all = layout === 'sam' && b ? [...pts, [(b.x + b.w / 2) * f.sx, (b.y + b.h / 2) * f.sy, 1]] : pts, n = all.length;
    const feeds: Record<string, TensorSpec> = {
      input_points: { type: 'float32', data: xy(all), dims: [1, 1, n, 2] }, input_labels: { type: 'int64', data: i64(lab(all)), dims: [1, 1, n] },
    };
    if (layout === 'sam2') feeds.input_boxes = { type: 'float32', data: f32(b ? [corners[0][0], corners[0][1], corners[1][0], corners[1][1]] : []), dims: [1, b ? 1 : 0, 4] };
    return feeds;
  }
  if (layout === 'sam-onnx') {
    // Meta's export wants a "not a point" at (0, 0) labelled -1 when there is no box.
    const all = [...pts, ...(b ? corners : [[0, 0, -1]])], n = all.length;
    return {
      point_coords: { type: 'float32', data: xy(all), dims: [1, n, 2] }, point_labels: { type: 'float32', data: f32(lab(all)), dims: [1, n] },
      mask_input: { type: 'float32', data: new Float32Array(256 * 256), dims: [1, 1, 256, 256] }, has_mask_input: { type: 'float32', data: f32([0]), dims: [1] },
      // The decoder enlarges its four masks to this size, so a big photo is asked at the model's own scale (long side 1024):
      // the taps are already in that space, and segMask maps any mask size back to the picture.
      orig_im_size: { type: 'float32', data: f32(Math.max(w, h) > SEG_SIZE ? [f.rh, f.rw] : [h, w]), dims: [2] },
    };
  }
  const all = [...pts, ...corners], n = all.length;
  return {
    batched_point_coords: { type: 'float32', data: xy(all), dims: [1, 1, n, 2] }, batched_point_labels: { type: 'float32', data: f32(lab(all)), dims: [1, 1, n] },
    orig_im_size: { type: 'int64', data: i64([h, w]), dims: [2] },
  };
}

/** Output names: the candidate masks (scores, not yet cut at 0) and how good the model rates each. */
export function segOutputs(names: readonly string[]): { masks: string; scores: string } {
  const masks = names.find((n) => /mask/i.test(n) && !/low_res/i.test(n)) ?? names[0];
  return { masks, scores: names.find((n) => /iou/i.test(n)) ?? names[1] };
}

/**
 * One candidate mask at picture size, 0 or 255. `masks` is the decoder's mask output (its last three sizes are candidates,
 * height, width); `scores` rates each candidate. Meta's export also returns its single-answer mask first, which is skipped
 * when three others follow. A `clip` box keeps only what lies inside it.
 */
export function segMask(layout: SegLayout, masks: { data: ArrayLike<number>; dims: readonly number[] }, scores: ArrayLike<number>, w: number, h: number,
  pick: SegPick = 'best', clip: Box | null = null): Uint8Array {
  const d = masks.dims, n = d.length, K = d[n - 3] ?? 1, MH = d[n - 2], MW = d[n - 1], plane = MH * MW;
  const cands = K === 4 ? [1, 2, 3] : Array.from({ length: K }, (_, k) => k);
  // The `sam` answer covers the whole padded square, of which the picture fills the top left; the others cover the picture.
  const fr = layout === 'sam' ? segFrame(layout, w, h) : null, kx = (MW * (fr ? fr.rw / SEG_SIZE : 1)) / w, ky = (MH * (fr ? fr.rh / SEG_SIZE : 1)) / h;
  const cx0 = clip ? Math.max(0, Math.floor(clip.x)) : 0, cy0 = clip ? Math.max(0, Math.floor(clip.y)) : 0;
  const cx1 = clip ? Math.min(w, Math.ceil(clip.x + clip.w)) : w, cy1 = clip ? Math.min(h, Math.ceil(clip.y + clip.h)) : h;
  const v = masks.data;
  const render = (k: number): { m: Uint8Array; area: number } => {
    const m = new Uint8Array(w * h), o = k * plane;
    let area = 0;
    for (let y = cy0; y < cy1; y++) {
      const sy = Math.min(MH - 1, Math.max(0, (y + 0.5) * ky - 0.5)), y0 = Math.floor(sy), y1 = Math.min(MH - 1, y0 + 1), fy = sy - y0;
      for (let x = cx0; x < cx1; x++) {
        const sx = Math.min(MW - 1, Math.max(0, (x + 0.5) * kx - 0.5)), x0 = Math.floor(sx), x1 = Math.min(MW - 1, x0 + 1), fx = sx - x0;
        const s = (v[o + y0 * MW + x0] * (1 - fx) + v[o + y0 * MW + x1] * fx) * (1 - fy) + (v[o + y1 * MW + x0] * (1 - fx) + v[o + y1 * MW + x1] * fx) * fy;
        if (s > 0) { m[y * w + x] = 255; area++; }
      }
    }
    return { m, area };
  };
  if (pick === 'best') {
    let best = cands[0];
    for (const k of cands) if (scores[k] > scores[best]) best = k;
    return render(best).m;
  }
  let top = render(cands[0]);
  for (const k of cands.slice(1)) { const r = render(k); if (r.area > top.area) top = r; }
  return top.m;
}

/**
 * The pixel deepest inside a mask (farthest from its edge, counting mask values of 128 and up), as a tap: a safe place to
 * prompt from another model's answer. Null for an empty mask.
 */
export function deepestPoint(mask: ArrayLike<number>, w: number, h: number): SegPoint | null {
  const big = 1e9, dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = mask[i] >= 128 ? big : 0;
  // Two passes of the 3-4 chamfer distance; outside the picture counts as outside the mask.
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : dist[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (dist[i]) dist[i] = Math.min(dist[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
  }
  let best = -1, bx = 0, by = 0;
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (dist[i]) dist[i] = Math.min(dist[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    if (dist[i] > best) { best = dist[i]; bx = x; by = y; }
  }
  return best > 0 ? { x: bx + 0.5, y: by + 0.5, add: true } : null;
}

/** Both masks together: the larger value at each pixel. */
export function unionMask(a: ArrayLike<number>, b: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(a[i], b[i]);
  return out;
}
