// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The speed target (design 3.4): a 12 MP picture (4000 × 3000) with 30 layers redraws every frame of a 300 px soft brush
 * stroke fast enough. The stroke paints a masked full-size layer in the middle of the stack, through the same dirty-area
 * and stroke-cache path the web app uses. It needs about 400 MB, so it runs only with BENCH=1 (the CI check job).
 * Since S3 the 3 adjustment layers and the clipped solid fill are the real nodes. A second case times one frame of a slider
 * drag on the Levels layer: the settings change, then one time-sliced band (bandRows) of the full stack is drawn, as the
 * web app's renderNow does. S4 adds the effects.
 */
import { describe, expect, it } from 'vitest';
import { StrokeCache, Stroke, bandRows, compositeRect, createAdjustLayer, createFillLayer, createFolder, createLayer, type Doc, type Layer, type LayerMask } from '../src/index';

const W = 4000, H = 3000, LIMIT_MS = 150;
function photo(name: string, seed: number, w = W, h = H, x = 0, y = 0): Layer {
  const l = createLayer(name, w, h, { x, y }), d = l.data;
  for (let yy = 0, i = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++, i += 4) {
    d[i] = (xx * 7 + seed * 31) & 255; d[i + 1] = (yy * 5 + seed * 17) & 255; d[i + 2] = ((xx ^ yy) + seed) & 255; d[i + 3] = 255;
  }
  return l;
}
function paintedMask(seed: number): LayerMask {
  const w = 2000, h = 1500, data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = ((x + y + seed) >> 3) & 1 ? 255 : 40;
  return { x: 1000, y: 750, width: w, height: h, data, outside: 255, enabled: true, linked: true, density: 1, feather: 2 };
}
function benchDoc(): { doc: Doc; target: Layer } {
  const layers: Layer[] = [];
  const add = (l: Layer, parent?: Layer): Layer => { if (parent) l.parentId = parent.id; layers.push(l); return l; };
  add(photo('Photo 1', 1));
  add({ ...photo('Photo 2', 2), mask: paintedMask(2) });
  add(createLayer('Empty 1', W, H));
  // folder one, pass through: 9 smaller layers
  const f1 = createFolder('Folder pass through'), f2 = { ...createFolder('Folder normal'), passThrough: false };
  for (let i = 0; i < 9; i++) add({ ...photo('Small ' + i, 10 + i, 1000, 1000, (i * 400) % 3000, (i * 300) % 2000), opacity: 0.8 }, f1);
  add(f1);
  const target = add({ ...photo('Photo 3 (painted)', 3), mask: paintedMask(3) });
  add({ ...photo('Photo 4', 4), opacity: 0.5 });
  add({ ...createFillLayer('Fill (clipped)', { r: 200, g: 120, b: 40, a: 255 }), clip: true, blendMode: 'overlay' });
  for (let i = 0; i < 9; i++) add({ ...photo('Small ' + (9 + i), 30 + i, 1000, 1000, (i * 350) % 3000, (i * 250) % 2000), blendMode: i % 2 ? 'multiply' : 'normal' }, f2);
  add(f2);
  add({ ...photo('Photo 5', 5), opacity: 0.3, blendMode: 'screen' });
  add({ ...photo('Photo 6', 6, W, H), opacity: 0.2 });
  add({ ...createAdjustLayer('Light and dark balance', 'image.adj-levels', { op: 'adjust', kind: 'levels', params: { inB: 12, gamma: 1.1, inW: 240, outB: 0, outW: 255 } }), opacity: 0.8 });
  add(createAdjustLayer('Colour and strength', 'image.adj-hue', { op: 'adjust', kind: 'hue-saturation', params: { hue: 10, saturation: 15, lightness: 0 } }));
  add(createAdjustLayer('Tone curve', 'image.adj-curves', { op: 'adjust', kind: 'curves', params: { p0: 0, p1: 70, p2: 135, p3: 200, p4: 255 } }));
  add(createLayer('Empty 2', W, H));
  // the order rule: a folder's contents directly below it (built that way above)
  return { doc: { width: W, height: H, layers, activeId: target.id, selection: null }, target };
}

describe.runIf(process.env.BENCH === '1')('the speed target', () => {
  it(`each frame of a 300 px soft stroke on a 12 MP, 30-layer picture is under ${LIMIT_MS} ms`, () => {
    const { doc, target } = benchDoc();
    expect(doc.layers.filter((l) => l.kind !== 'folder').length).toBe(30); // plus the 2 folders
    const stroke = new Stroke(doc, target, { size: 300, hardness: 0, opacity: 1, color: { r: 20, g: 220, b: 90, a: 255 }, erase: false, spacing: 0.25 });
    // The picture is on screen before anyone paints, so the compositor has run: draw one area first, as the app has.
    compositeRect(doc.layers, { x: 0, y: 0, w: 512, h: 512 });
    const cache = new StrokeCache(doc.layers, target);
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      stroke.add({ x: 500 + i * 75, y: 1500 + Math.sin(i / 4) * 300 });
      const r = stroke.takeDirty();
      if (!r) continue;
      const t0 = performance.now();
      cache.composite(r);
      times.push(performance.now() - t0);
    }
    stroke.end();
    const sorted = times.slice().sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)], worst = sorted[sorted.length - 1];
    console.log(`W6 S2 speed: ${times.length} frames, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms (limit ${LIMIT_MS} ms); frames: ${times.map((t) => t.toFixed(0)).join(' ')}`);
    expect(worst).toBeLessThan(LIMIT_MS);
  }, 600000);
  it(`each frame of a slider drag on a Light and dark balance layer over the same picture is under ${LIMIT_MS} ms`, () => {
    const { doc } = benchDoc();
    const lv = doc.layers.find((l) => l.adjust?.from === 'image.adj-levels') as Layer, rows = bandRows(W), times: number[] = [];
    compositeRect(doc.layers, { x: 0, y: 0, w: 512, h: 512 });
    for (let i = 0; i < 8; i++) {
      // a drag tick replaces the settings object (L4), marks the canvas, and the next frame draws one band
      lv.adjust = { from: 'image.adj-levels', job: { op: 'adjust', kind: 'levels', params: { inB: 10 + i * 9, gamma: 1, inW: 255, outB: 0, outW: 255 } } };
      const t0 = performance.now();
      compositeRect(doc.layers, { x: 0, y: (i * rows * 3) % (H - rows), w: W, h: rows });
      times.push(performance.now() - t0);
    }
    const worst = Math.max(...times);
    console.log(`W6 S3 slider speed: band ${W} x ${rows}, worst ${worst.toFixed(1)} ms (limit ${LIMIT_MS} ms); frames: ${times.map((t) => t.toFixed(0)).join(' ')}`);
    expect(worst).toBeLessThan(LIMIT_MS);
  }, 600000);
});
