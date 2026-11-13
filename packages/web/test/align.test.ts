// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Line up layers automatically (core/align.ts) on a real photo (e2e/fixtures/mug.png, CC0, see SOURCE.md): a copy moved,
 * made darker and noisier, and a copy turned 7° and moved, are both put back where they belong; the practice photo's
 * flattened copy moved 100 px down goes back exactly; two different pictures are left alone. Every number below was
 * worked out by hand from the known move before the code ran.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePng } from '@free-photoeditor/formats/png';
import { addLayer, createLayer, documentFromBitmap, findLayer, warpBitmap, type Bitmap, type Doc, type Layer } from '@free-photoeditor/core';
import { autoAlign, matchBitmaps } from '@free-photoeditor/core/align';

const png = decodePng(readFileSync(fileURLToPath(new URL('../e2e/fixtures/mug.png', import.meta.url))));
const photo: Bitmap = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
const W = photo.width, H = photo.height;

function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The same shot taken a moment later: darker (85 %) with a little sensor noise (up to ±4 levels). */
function darkerNoisy(b: Bitmap, seed: number): Uint8ClampedArray {
  const r = rnd(seed), out = new Uint8ClampedArray(b.data);
  for (let i = 0; i < out.length; i += 4) for (let c = 0; c < 3; c++) out[i + c] = b.data[i + c] * 0.85 + (r() * 8 - 4);
  return out;
}
function twoLayers(bottom: Bitmap, top: Layer): Doc {
  const doc = documentFromBitmap(bottom);
  addLayer(doc, top, 1);
  return doc;
}
/** Mean difference (red, 0..255) between a layer and the photo over an inner grid of picture points. */
function diff(l: Layer): number {
  let s = 0, n = 0;
  for (let y = 60; y < H - 60; y += 9) for (let x = 60; x < W - 60; x += 9) {
    const lx = x - l.x, ly = y - l.y;
    if (lx < 0 || ly < 0 || lx >= l.width || ly >= l.height || l.data[(ly * l.width + lx) * 4 + 3] < 255) continue;
    s += Math.abs(l.data[(ly * l.width + lx) * 4] - photo.data[(y * W + x) * 4]); n++;
  }
  return n > 100 ? s / n : 999;
}

describe('Line up layers automatically', () => {
  it('puts back a darker, noisier copy of a real photo moved 17 px right and 9 px up, exactly, as one undo step', () => {
    const top = createLayer('Second shot', W, H, { data: darkerNoisy(photo, 7), x: 17, y: -9 }), doc = twoLayers(photo, top);
    const r = autoAlign(doc);
    expect(r?.moved).toEqual(['Second shot']);
    const l = findLayer(doc, top.id) as Layer;
    expect([l.x, l.y]).toEqual([0, 0]);
    r?.cmd?.undo(doc);
    expect([l.x, l.y]).toEqual([17, -9]);
    r?.cmd?.redo(doc);
    expect([l.x, l.y]).toEqual([0, 0]);
  }, 30_000);

  it('finds a 7° turn plus a move on the real photo within 0.3° and 1 px, and turns the layer back onto the photo', () => {
    // The second shot: turned 7° about the middle, then moved 12 px right and 8 px up.
    const a = 7 * Math.PI / 180, cx = W / 2, cy = H / 2, tx = 12, ty = -8;
    const T = (x: number, y: number): { x: number; y: number } => ({ x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a) + tx, y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) + ty });
    const g = warpBitmap({ width: W, height: H, data: darkerNoisy(photo, 9) }, [T(0, 0), T(W, 0), T(W, H), T(0, H)]);
    expect(g).not.toBeNull();
    const moved = g as NonNullable<typeof g>, shot: Bitmap = { width: moved.width, height: moved.height, data: moved.data };
    const fit = matchBitmaps(photo, shot);
    expect(fit?.kind).toBe('turn');
    const m = fit?.m as number[];
    // The fit takes the shot's pixels back to the photo's: a turn of -7°.
    expect(Math.abs(Math.atan2(m[3], m[0]) * 180 / Math.PI + 7)).toBeLessThan(0.3);
    // Where a shot pixel truly comes from: undo the move, then the turn (about the middle).
    const back = (u: number, v: number): { x: number; y: number } => {
      const X = u + moved.x - tx - cx, Y = v + moved.y - ty - cy;
      return { x: cx + X * Math.cos(a) + Y * Math.sin(a), y: cy - X * Math.sin(a) + Y * Math.cos(a) };
    };
    for (const [u, v] of [[80, 90], [moved.width - 80, 90], [moved.width / 2, moved.height / 2], [80, moved.height - 90], [moved.width - 80, moved.height - 90]]) {
      const want = back(u, v), got = { x: (m[0] * u + m[1] * v + m[2]) / (m[6] * u + m[7] * v + m[8]), y: (m[3] * u + m[4] * v + m[5]) / (m[6] * u + m[7] * v + m[8]) };
      expect(Math.hypot(got.x - want.x, got.y - want.y), `${u},${v}`).toBeLessThan(1);
    }
    // In a picture: the turned layer goes back onto the photo (only the 85 % darkening and the resampling remain).
    const top = createLayer('Turned shot', moved.width, moved.height, { data: new Uint8ClampedArray(moved.data), x: moved.x, y: moved.y });
    for (let i = 0; i < top.data.length; i += 4) top.data[i] = Math.min(255, top.data[i] / 0.85); // undo the darkening of red, so the pixels can be compared
    const doc = twoLayers(photo, top), before = diff(top);
    const r = autoAlign(doc), l = findLayer(doc, top.id) as Layer;
    expect(r?.moved).toEqual(['Turned shot']);
    expect(before).toBeGreaterThan(15); // measured 22.9: the turned shot sits over the wrong parts of the photo
    expect(diff(l)).toBeLessThan(5); // measured 2.3: only the resampling is left
    r?.cmd?.undo(doc);
    expect(diff(findLayer(doc, top.id) as Layer)).toBe(before);
  }, 30_000);

  it('puts the practice photo, flattened, back from 100 px down (the workspace sweep does this)', () => {
    // The practice photo (app.ts makeSample at full size) with its sun drawn in, as Merge down leaves it.
    const Ws = 960, Hs = 640, data = new Uint8ClampedArray(Ws * Hs * 4);
    for (let y = 0; y < Hs; y++) for (let x = 0; x < Ws; x++) {
      const F = 16, hz = 0.58 * Hs, i = (y * Ws + x) * 4;
      let r: number, g: number, b: number;
      if (x < F || y < F || x >= Ws - F || y >= Hs - F) { r = 250; g = 250; b = 248; }
      else {
        const far = hz - 40 - 30 * Math.sin(x / 90) - 18 * Math.sin(x / 37 + 1), near = hz + 10 - 42 * Math.sin(x / 150 + 2) - 12 * Math.sin(x / 41);
        if (y < far) { const t = y / far; r = 52 + 150 * t; g = 92 + 110 * t; b = 158 + 60 * t; }
        else if (y < near) { const t = (y - far) / Math.max(1, near - far); r = 96 - 20 * t; g = 120 - 10 * t; b = 140 - 20 * t; }
        else if (y < hz + 70) { const t = (y - near) / 90; r = 58 - 18 * t; g = 112 - 30 * t; b = 58 - 16 * t; }
        else { const t = (y - hz - 70) / (Hs - hz - 70), rip = 8 * Math.sin(y * 0.9 + x * 0.02); r = 40 + 30 * (1 - t) + rip; g = 78 + 40 * (1 - t) + rip; b = 110 + 45 * (1 - t) + rip; }
      }
      const dd = Math.hypot(x - 840 - 89.5, y - 90 - 89.5) / 90, sa = dd < 0.8 ? 1 : dd < 1 ? (1 - dd) / 0.2 : 0;
      data[i] = r * (1 - sa) + 255 * sa; data[i + 1] = g * (1 - sa) + (200 + 40 * Math.max(0, 1 - dd)) * sa; data[i + 2] = b * (1 - sa) + 110 * sa; data[i + 3] = 255;
    }
    const top = createLayer('Background copy', Ws, Hs, { data: new Uint8ClampedArray(data), x: 0, y: 100 }), doc = twoLayers({ width: Ws, height: Hs, data }, top);
    const r = autoAlign(doc), l = findLayer(doc, top.id) as Layer;
    expect(r?.moved).toEqual(['Background copy']);
    expect([l.x, l.y]).toEqual([0, 0]);
  }, 30_000);

  it('leaves two different pictures alone and names the one it could not match', () => {
    const noise = (seed: number): Uint8ClampedArray => {
      const r = rnd(seed), d = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < d.length; i += 4) { const v = r() * 255; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; }
      return d;
    };
    const top = createLayer('Other scene', W, H, { data: noise(2), x: 5, y: 5 }), doc = twoLayers(photo, top);
    const r = autoAlign(doc);
    expect(r?.missed).toEqual(['Other scene']);
    expect(r?.cmd).toBeNull();
    expect([top.x, top.y]).toEqual([5, 5]);
    expect(autoAlign(documentFromBitmap(photo))).toBeNull();
  }, 30_000);
});
