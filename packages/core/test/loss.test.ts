// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { addLayer, createDocument, createLayer, docFacts, lossReport } from '../src/index';

const ids = (r: ReturnType<typeof lossReport>): string[] => r.losses.map((l) => l.id);
describe('loss warning rules', () => {
  it('one opaque layer to PNG loses nothing', () => {
    const r = lossReport({ layers: 1, hidden: 0, transparent: false }, 'png');
    expect(r.losses).toEqual([]); expect(r.suggest).toBeNull(); expect(r.kept).toMatch(/Nothing is lost/);
  });
  it('layers to PNG are merged and PSD is offered', () => {
    const r = lossReport({ layers: 3, hidden: 1, transparent: true }, 'png');
    expect(ids(r)).toEqual(['layers', 'hidden']); expect(r.suggest).toBe('psd'); expect(r.losses[0].text).toMatch(/3 layers/);
  });
  it('JPEG of a layered picture: layers, transparency and quality, PSD offered', () => {
    const r = lossReport({ layers: 2, hidden: 0, transparent: true }, 'jpeg', 0.8);
    expect(ids(r)).toEqual(['layers', 'transparency', 'quality']); expect(r.suggest).toBe('psd');
    expect(r.losses[1].text).toMatch(/white/); expect(r.losses[2].text).toMatch(/80%/);
  });
  it('JPEG of a flat see-through picture offers PNG', () => {
    const r = lossReport({ layers: 1, hidden: 0, transparent: true }, 'jpeg', 1);
    expect(ids(r)).toEqual(['transparency', 'quality']); expect(r.suggest).toBe('png'); expect(r.losses[1].text).toMatch(/full quality/);
  });
  it('WebP keeps transparency but notes the quality', () => {
    expect(ids(lossReport({ layers: 1, hidden: 0, transparent: true }, 'webp', 0.9))).toEqual(['quality']);
    expect(ids(lossReport({ layers: 1, hidden: 0, transparent: true }, 'webp', 1))).toEqual([]);
  });
  it('PSD loses nothing', () => {
    const r = lossReport({ layers: 5, hidden: 2, transparent: true }, 'psd');
    expect(r.losses).toEqual([]); expect(r.kept).toMatch(/Nothing is lost/);
  });
  it('reads the facts from the document', () => {
    const doc = createDocument(4, 4);
    expect(docFacts(doc)).toEqual({ layers: 1, hidden: 0, transparent: false });
    const l = createLayer('x', 4, 4);
    l.visible = false;
    addLayer(doc, l);
    expect(docFacts(doc)).toEqual({ layers: 2, hidden: 1, transparent: false });
    expect(docFacts(createDocument(4, 4, null)).transparent).toBe(true);
  });
});
