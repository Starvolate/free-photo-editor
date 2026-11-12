// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { writePsd } from 'ag-psd';
import { CREDIT, addLayer, createDocument, createLayer, samplePixel } from '../src/index';
import { readPsdDocument, writePsdDocument } from '../src/psd';

describe('PSD', () => {
  it('round-trips a 2-layer document: names, order, offsets, opacity, blend mode, pixels', () => {
    const doc = createDocument(32, 24, { r: 20, g: 40, b: 200, a: 255 });
    doc.layers[0].name = 'Base blue';
    const top = createLayer('Red patch', 10, 8, { x: 5, y: 6, fill: { r: 230, g: 30, b: 30, a: 200 } });
    top.opacity = 0.6;
    top.blendMode = 'multiply';
    addLayer(doc, top);
    const bytes = writePsdDocument(doc);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('8BPS');
    const { doc: back, credit } = readPsdDocument(bytes);
    expect([back.width, back.height]).toEqual([32, 24]);
    expect(back.layers.map((l) => l.name)).toEqual(['Base blue', 'Red patch']);
    const t = back.layers[1];
    expect([t.x, t.y, t.width, t.height]).toEqual([5, 6, 10, 8]);
    expect(t.blendMode).toBe('multiply'); expect(t.opacity).toBeCloseTo(0.6, 2); expect(t.visible).toBe(true);
    expect(Array.from(t.data.slice(0, 4))).toEqual([230, 30, 30, 200]);
    expect(Array.from(back.layers[0].data.slice(0, 4))).toEqual([20, 40, 200, 255]);
    expect(samplePixel(back, 7, 8)).toEqual(samplePixel(doc, 7, 8));
    expect(credit).toBe(CREDIT);
  });
  it('keeps a hidden layer hidden', () => {
    const doc = createDocument(8, 8), l = createLayer('Hidden one', 8, 8);
    l.visible = false;
    addLayer(doc, l);
    const back = readPsdDocument(writePsdDocument(doc)).doc;
    expect(back.layers[1].name).toBe('Hidden one'); expect(back.layers[1].visible).toBe(false); expect(back.layers[0].visible).toBe(true);
  });
  it('opens a flat PSD without layers as one background layer', () => {
    const data = new Uint8ClampedArray(4 * 3 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([77, 88, 99, 255], i);
    const ab = writePsd({ width: 4, height: 3, imageData: { width: 4, height: 3, data } } as never, { generateThumbnail: false } as never);
    const { doc } = readPsdDocument(new Uint8Array(ab as unknown as ArrayBuffer));
    expect(doc.layers.length).toBe(1); expect(Array.from(doc.layers[0].data.slice(0, 3))).toEqual([77, 88, 99]);
  });
});
