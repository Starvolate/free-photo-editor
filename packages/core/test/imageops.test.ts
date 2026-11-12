// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import {
  addLayer, createDocument, createLayer, curveLut, inverseSelection, levelsLut, mergeDown, resizeCanvas, resizeDocument, selectionAlpha,
  tone, trimDocument, turnDocument, type Doc,
} from '../src/index';

const RED = { r: 255, g: 0, b: 0, a: 255 };
function doc(): Doc {
  const d = createDocument(100, 50, { r: 0, g: 0, b: 255, a: 255 });
  d.layers[0].data.set([255, 0, 0, 255], 0);
  return d;
}

describe('tone', () => {
  it('builds identity curves', () => {
    const lv = levelsLut(0, 1, 255, 0, 255), cv = curveLut([0, 64, 128, 192, 255]);
    for (let t = 0; t < 256; t++) { expect(lv[t]).toBe(t); expect(Math.abs(cv[t] - t)).toBeLessThanOrEqual(1); }
  });
  it('removes colour', () => {
    const out = tone({ width: 2, height: 1, data: new Uint8ClampedArray([200, 40, 10, 255, 10, 220, 90, 128]) }, 'desaturate');
    expect(out[0]).toBe(out[1]); expect(out[1]).toBe(out[2]); expect(out[4]).toBe(out[6]); expect(out[7]).toBe(128);
  });
});

describe('picture operations', () => {
  it('resizes the picture and undoes it', () => {
    const d = doc(), c = resizeDocument(d, 50, 25);
    expect([d.width, d.height, d.layers[0].width, d.layers[0].height]).toEqual([50, 25, 50, 25]);
    c?.undo(d);
    expect([d.width, d.height, d.layers[0].width]).toEqual([100, 50, 100]);
  });
  it('adds canvas around the middle', () => {
    const d = doc(), c = resizeCanvas(d, 120, 70, 0.5, 0.5, null);
    expect([d.width, d.height]).toEqual([120, 70]);
    const l = d.layers[0];
    expect([l.x + 0, l.y + 0].map(Math.abs).join() === '10,10' || [l.width, l.height].join() === '120,70').toBe(true);
    c?.undo(d);
    expect([d.width, d.height]).toEqual([100, 50]);
  });
  it('turns the picture clockwise', () => {
    const d = doc(), c = turnDocument(d, 'cw');
    expect([d.width, d.height]).toEqual([50, 100]);
    const l = d.layers[0], i = ((0 - l.y) * l.width + (49 - l.x)) * 4;
    expect([...l.data.slice(i, i + 4)]).toEqual([RED.r, RED.g, RED.b, RED.a]);
    c.undo(d);
    expect([d.width, d.height]).toEqual([100, 50]);
  });
  it('trims see-through edges', () => {
    const d = createDocument(100, 50, null);
    const block = new Uint8ClampedArray(10 * 10 * 4).fill(255);
    addLayer(d, createLayer('Block', 10, 10, { data: block, x: 20, y: 5 }), 1, 'Add');
    const c = trimDocument(d);
    expect([d.width, d.height]).toEqual([10, 10]);
    c?.undo(d);
    expect([d.width, d.height]).toEqual([100, 50]);
  });
  it('merges a layer down and undoes it', () => {
    const d = doc();
    addLayer(d, createLayer('Top', 10, 10, { data: new Uint8ClampedArray(400).fill(255), x: 5, y: 5 }), 1, 'Add');
    const c = mergeDown(d);
    expect(d.layers.length).toBe(1);
    c?.undo(d);
    expect(d.layers.length).toBe(2);
  });
  it('selects everything except a box', () => {
    const d = doc();
    d.selection = { x: 10, y: 10, w: 20, h: 20 };
    const inv = inverseSelection(d);
    expect(inv).not.toBeNull();
    if (!inv) return;
    expect(selectionAlpha(inv, 15, 15)).toBe(0);
    expect(selectionAlpha(inv, 2, 2)).toBe(255);
  });
});
