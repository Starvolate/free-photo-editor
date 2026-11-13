// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Tap to select's steps around the model: where a tap lands in the model's square, and how its answer comes back to picture size. */
import { describe, expect, it } from 'vitest';
import { asType, deepestPoint, segEncoderInput, segFrame, segMask, segOutputs, segPromptFeeds, unionMask } from '../src/segment';

const flat = (w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });

describe('the model square', () => {
  it('fits the long side to 1024 and keeps the shape (SAM), or squeezes into the square (SAM 2)', () => {
    expect(segFrame('sam', 640, 480)).toEqual({ sx: 1.6, sy: 1.6, rw: 1024, rh: 768 });
    expect(segFrame('sam-onnx', 480, 640)).toEqual({ sx: 1.6, sy: 1.6, rw: 768, rh: 1024 });
    expect(segFrame('sam2', 640, 480)).toEqual({ sx: 1.6, sy: 1024 / 480, rw: 1024, rh: 1024 });
    expect(segFrame('efficientsam', 640, 480)).toEqual({ sx: 1, sy: 1, rw: 640, rh: 480 });
  });
  it('pads below and to the right with 0 after setting against the mean (SAM)', () => {
    const t = segEncoderInput('sam', flat(64, 32));
    expect(t.dims).toEqual([1, 3, 1024, 1024]);
    const d = t.data as Float32Array;
    expect(d[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    expect(d[600 * 1024 + 10]).toBe(0);
    expect(segEncoderInput('sam-onnx', flat(64, 32)).dims).toEqual([512, 1024, 3]);
    expect(segEncoderInput('efficientsam', flat(64, 32)).dims).toEqual([1, 3, 32, 64]);
  });
});

describe('prompts', () => {
  it('scales taps into the square and labels them', () => {
    const f = segPromptFeeds('sam', { points: [{ x: 100, y: 50, add: true }, { x: 10, y: 20, add: false }] }, 640, 480);
    expect(Array.from(f.input_points.data as Float32Array)).toEqual([160, 80, 16, 32]);
    expect(Array.from(f.input_labels.data as BigInt64Array)).toEqual([1n, 0n]);
    expect(f.input_points.dims).toEqual([1, 1, 2, 2]);
  });
  it("adds Meta's 'not a point' when there is no box, and box corners as labels 2 and 3", () => {
    const a = segPromptFeeds('sam-onnx', { points: [{ x: 100, y: 50, add: true }] }, 640, 480);
    expect(Array.from(a.point_labels.data as Float32Array)).toEqual([1, -1]);
    expect(Array.from(a.orig_im_size.data as Float32Array)).toEqual([480, 640]);
    const b = segPromptFeeds('efficientsam', { points: [], box: { x: 10, y: 20, w: 30, h: 40 } }, 640, 480);
    expect(Array.from(b.batched_point_coords.data as Float32Array)).toEqual([10, 20, 40, 60]);
    expect(Array.from(b.batched_point_labels.data as Float32Array)).toEqual([2, 3]);
    expect(Array.from(b.orig_im_size.data as BigInt64Array)).toEqual([480n, 640n]);
  });
  it('turns a box into a tap at its middle where the export takes no box (SAM)', () => {
    const f = segPromptFeeds('sam', { points: [], box: { x: 0, y: 0, w: 100, h: 50 } }, 640, 480);
    expect(Array.from(f.input_points.data as Float32Array)).toEqual([80, 40]);
  });
  it('changes a value type when the model asks for another', () => {
    const t = asType({ type: 'float32', data: new Float32Array([1, 0]), dims: [2] }, 'int64');
    expect(t.type).toBe('int64');
    expect(Array.from(t.data as BigInt64Array)).toEqual([1n, 0n]);
  });
});

describe('answers', () => {
  it('maps the padded 256 grid back to the picture, keeps the best-rated or the largest, and cuts to a box', () => {
    // 640 x 480 picture: it fills 256 x 192 of the grid. Candidate 0 covers the grid's left half, candidate 1 everything.
    const P = 256 * 256, data = new Float32Array(3 * P).fill(-1);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) data[y * 256 + x] = 1;
    data.fill(1, P, 2 * P);
    const masks = { data, dims: [1, 1, 3, 256, 256] };
    const best = segMask('sam', masks, [0.9, 0.5, 0.1], 640, 480);
    expect(best[100 * 640 + 100]).toBe(255);
    expect(best[100 * 640 + 500]).toBe(0);
    const largest = segMask('sam', masks, [0.9, 0.5, 0.1], 640, 480, 'largest');
    expect(largest[100 * 640 + 500]).toBe(255);
    const cut = segMask('sam', masks, [0.1, 0.9, 0.1], 640, 480, 'best', { x: 0, y: 0, w: 10, h: 10 });
    expect(cut[5 * 640 + 5]).toBe(255);
    expect(cut[50 * 640 + 50]).toBe(0);
  });
  it("skips Meta's single-answer mask when three candidates follow it", () => {
    const data = new Float32Array(4 * 4).fill(-1);
    data[0] = 5; // candidate 0 (the single answer) rated highest, but it is skipped
    data.fill(5, 8, 12);
    const m = segMask('sam-onnx', { data, dims: [1, 4, 2, 2] }, [0.99, 0.1, 0.8, 0.2], 2, 2);
    expect(Array.from(m)).toEqual([255, 255, 255, 255]);
  });
  it('finds output names', () => {
    expect(segOutputs(['iou_scores', 'pred_masks'])).toEqual({ masks: 'pred_masks', scores: 'iou_scores' });
    expect(segOutputs(['masks', 'iou_predictions', 'low_res_masks'])).toEqual({ masks: 'masks', scores: 'iou_predictions' });
  });
});

describe('prompting from another mask', () => {
  it('taps the deepest pixel of a mask, and joins two masks', () => {
    const w = 21, h = 11, m = new Uint8Array(w * h);
    for (let y = 1; y < 10; y++) for (let x = 1; x < 20; x++) m[y * w + x] = 255;
    const p = deepestPoint(m, w, h);
    expect(p && Math.abs(p.y - 5.5)).toBeLessThanOrEqual(1);
    expect(p?.add).toBe(true);
    expect(deepestPoint(new Uint8Array(4), 2, 2)).toBeNull();
    expect(Array.from(unionMask([0, 200, 30], [100, 0, 30]))).toEqual([100, 200, 30]);
  });
});
