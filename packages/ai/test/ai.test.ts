// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The AI add-on's own steps with a tiny stand-in model (the real models run in the browser test, e2e/ai.e2e.test.ts). */
import { selectionAlpha, selectionFromMask } from '@free-photoeditor/core';
import { describe, expect, it } from 'vitest';
import { downloadSize, estimateSeconds, mb } from '../src/index';
import { MODELS, ORT_VERSION, RUNTIMES } from '../src/models';
import {
  IMAGENET_MEAN, IMAGENET_STD, blendFill, contextBox, fillOnly, halve, inpaintInputs, maskFromPrediction, maskInput, planTiles, toPlanes, upscaleTiled, type Rgba,
} from '../src/process';

const pic = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
/** A stand-in super-resolution model: every pixel becomes a 2 x 2 block (nearest neighbour). */
const nearest2 = async (p: Float32Array, w: number, h: number): Promise<Float32Array> => {
  const n = w * h, W = w * 2, N = W * h * 2, out = new Float32Array(3 * N);
  for (let c = 0; c < 3; c++) for (let y = 0; y < h * 2; y++) for (let x = 0; x < W; x++) out[c * N + y * W + x] = p[c * n + (y >> 1) * w + (x >> 1)];
  return out;
};

describe('model inputs', () => {
  it('shrinks by averaging and counts see-through pixels as white', () => {
    const p = toPlanes(pic(2, 2, (x, y) => [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [9, 9, 9, 0]][y * 2 + x] as [number, number, number, number]), 1, 1);
    expect(Array.from(p)).toEqual([0.5, 0.5, 0.5]);
  });
  it('divides by the brightest value, then uses the ImageNet mean and spread (as U²-Net was trained)', () => {
    const p = maskInput(pic(4, 4, () => [128, 128, 128, 255]), 2);
    for (let c = 0; c < 3; c++) for (let i = 0; i < 4; i++) expect(p[c * 4 + i]).toBeCloseTo((1 - IMAGENET_MEAN[c]) / IMAGENET_STD[c], 5);
  });
});

describe('mask to selection', () => {
  it('a stand-in subject model on a sun picture: the selection covers the sun, not the sky', () => {
    const sun = pic(64, 48, (x, y) => (Math.hypot(x - 40, y - 20) < 10 ? [255, 210, 110, 255] : [60, 110, 190, 255]));
    const input = maskInput(sun, 16), pred = new Float32Array(256);
    for (let i = 0; i < 256; i++) pred[i] = input[i] > 1 ? 0.95 : 0.02;
    const mask = maskFromPrediction(pred, 16, 16, 64, 48), sel = selectionFromMask({ width: 64, height: 48, data: mask });
    expect(sel).not.toBeNull();
    expect(selectionAlpha(sel, 40, 20)).toBeGreaterThan(200);
    expect(selectionAlpha(sel, 5, 40)).toBeLessThan(30);
  });
  it('a flat answer (no clear subject) gives an empty mask, so nothing is selected', () => {
    const mask = maskFromPrediction(new Float32Array(16).fill(0.001), 4, 4, 8, 8);
    expect(selectionFromMask({ width: 8, height: 8, data: mask })).toBeNull();
  });
  it('stretches the answer to the full range and enlarges it smoothly', () => {
    const m = maskFromPrediction([0.2, 0.8, 0.2, 0.8], 2, 2, 4, 2);
    expect(Array.from(m)).toEqual([0, 64, 191, 255, 0, 64, 191, 255]);
  });
});

describe('tiling for Make it bigger', () => {
  it('covers every pixel exactly once, reading context only inside the picture', () => {
    const tiles = planTiles(300, 200, 128, 10), seen = new Uint8Array(300 * 200);
    for (const t of tiles) {
      for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) seen[y * 300 + x]++;
      expect(t.read.x).toBeGreaterThanOrEqual(0);
      expect(t.read.x + t.read.w).toBeLessThanOrEqual(300);
      expect(t.read.x <= t.x && t.read.y <= t.y && t.read.x + t.read.w >= t.x + t.w && t.read.y + t.read.h >= t.y + t.h).toBe(true);
    }
    expect(tiles.length).toBe(6);
    expect(seen.every((v) => v === 1)).toBe(true);
  });
  it('a stand-in model run tile by tile gives the same picture as one run on the whole, with no seams', async () => {
    const src = pic(37, 23, (x, y) => [(x * 7) % 256, (y * 11) % 256, (x * y) % 256, 255]);
    let calls = 0;
    const big = await upscaleTiled(src, 2, nearest2, { tile: 16, pad: 3, onTile: () => calls++ });
    expect([big.width, big.height]).toEqual([74, 46]);
    expect(calls).toBe(planTiles(37, 23, 16, 3).length);
    for (let y = 0; y < 46; y++) for (let x = 0; x < 74; x++) {
      const s = ((y >> 1) * 37 + (x >> 1)) * 4, d = (y * 74 + x) * 4;
      expect([big.data[d], big.data[d + 1], big.data[d + 2], big.data[d + 3]]).toEqual([src.data[s], src.data[s + 1], src.data[s + 2], 255]);
    }
  });
  it('enlarges the see-through channel smoothly and refuses an answer of the wrong size', async () => {
    const src = pic(4, 1, (x) => [200, 200, 200, x < 2 ? 0 : 255]);
    const big = await upscaleTiled(src, 2, nearest2, { tile: 8, pad: 0 });
    expect(big.data[3]).toBe(0);
    expect(big.data[7 * 4 + 3]).toBe(255);
    expect(big.data[3 * 4 + 3]).toBeGreaterThan(0);
    expect(big.data[3 * 4 + 3]).toBeLessThan(255);
    await expect(upscaleTiled(src, 2, async () => new Float32Array(5))).rejects.toThrow('wrong size');
  });
  it('2x comes from 4x halved: four pixels averaged by how solid each is', () => {
    const r = halve(pic(2, 2, (x, y) => (y ? [0, 0, 0, 0] : x ? [0, 0, 255, 255] : [255, 0, 0, 255])));
    expect([r.width, r.height]).toEqual([1, 1]);
    expect(Array.from(r.data).map((v) => Math.abs(v - [128, 0, 128, 128][Array.from(r.data).indexOf(v)]) <= 1)).toEqual([true, true, true, true]);
  });
});

describe('inpaint blending for Remove an object', () => {
  it('looks at the painted box with surroundings, staying inside the picture', () => {
    expect(contextBox({ x: 10, y: 10, w: 20, h: 20 }, 100, 80)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
    expect(contextBox({ x: 400, y: 300, w: 200, h: 100 }, 1000, 800)).toEqual({ x: 250, y: 150, w: 500, h: 400 });
  });
  it('sends colour planes and a mask where 255 keeps and 0 fills (MI-GAN, checked against the real model)', () => {
    const { image, keep } = inpaintInputs(pic(2, 1, (x) => [x ? 1 : 10, x ? 2 : 20, x ? 3 : 30, 255]), [0, 200]);
    expect(Array.from(image)).toEqual([10, 1, 20, 2, 30, 3]);
    expect(Array.from(keep)).toEqual([255, 0]);
  });
  it('blends the fill in: outside unchanged, inside the fill, soft in between, filled pixels solid', () => {
    const orig = pic(3, 1, (x) => [10, 20, 30, x === 2 ? 0 : 255]), fill = [200, 200, 200, 100, 100, 100, 50, 50, 50];
    const out = blendFill(orig, fill, [0, 255, 128]);
    expect(Array.from(out.slice(0, 8))).toEqual([10, 20, 30, 255, 200, 100, 50, 255]);
    expect(out[8]).toBeCloseTo(10 + 190 * (128 / 255), -0.5);
    expect(out[11]).toBe(128);
  });
  it('can also give the fill alone, as a see-through layer', () => {
    expect(Array.from(fillOnly([1, 2, 3, 4, 5, 6], [255, 0], 2))).toEqual([1, 3, 5, 255, 2, 4, 6, 0]);
  });
});

describe('downloads', () => {
  it('pins every model and the engine, with exact sizes, SHA-256 and free-for-commercial-use licences', () => {
    for (const m of Object.values(MODELS)) {
      expect(m.url).toMatch(/^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[0-9a-f]{40}\//);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(['MIT', 'Apache-2.0', 'BSD-3-Clause']).toContain(m.licence);
      expect(m.url.toLowerCase()).not.toMatch(/rmbg|briaai/);
    }
    for (const r of Object.values(RUNTIMES)) { expect(r.url).toContain(`onnxruntime-web@${ORT_VERSION}/`); expect(r.sha256).toMatch(/^[0-9a-f]{64}$/); }
  });
  it('says the first download in plain megabytes and estimates the time', async () => {
    expect(await downloadSize('subject', 'wasm')).toBe(RUNTIMES.wasm.transfer + MODELS.subject.transfer);
    expect(mb(RUNTIMES.wasm.transfer + MODELS.subject.transfer)).toBe('7.8');
    expect(mb(RUNTIMES.webgpu.transfer + MODELS.inpaint.transfer)).toBe('33');
    expect(await downloadSize('subject', 'wasm', true)).toBe(0);
    expect(estimateSeconds('upscale', 1e6, 'wasm')).toBeCloseTo(60);
    expect(estimateSeconds('upscale', 1e6, 'webgpu')).toBeCloseTo(4);
  });
});
